import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const phonePattern = /(?<!\d)(?:01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|02[-.\s]?\d{3,4}[-.\s]?\d{4}|0[3-6][1-5][-.\s]?\d{3,4}[-.\s]?\d{4}|070[-.\s]?\d{3,4}[-.\s]?\d{4}|050\d[-.\s]?\d{4}[-.\s]?\d{4})(?!\d)/g;
const contactKey = /^(?:.*(?:phone|telephone|mobile|cellphone|tel)(?:number|no)?|contact(?:number)?|cpno)$/i;

function run(args, options = {}) {
  const wranglerArgs = args[0] === "exec" && args[1] === "wrangler" ? args.slice(2) : args;
  const result = spawnSync(process.execPath, [wrangler, ...wranglerArgs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Command failed: ${args.join(" ")}`);
  return result.stdout;
}

function query(sql) {
  const output = run(["exec", "wrangler", "d1", "execute", "js-map-primary", "--remote", "--json", "--command", sql]);
  const payload = JSON.parse(output);
  return payload[0]?.results || [];
}

function stripPhones(value) {
  return String(value == null ? "" : value)
    .replace(phonePattern, " ")
    .replace(/(?:☎️?\s*)?(?:상담\s*전화|문의\s*전화|전화\s*문의|연락처)\s*[:：]?\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function scrub(value, key = "") {
  if (contactKey.test(String(key || ""))) {
    if (Array.isArray(value)) return [];
    if (value && typeof value === "object") return {};
    return "";
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, scrub(childValue, childKey)]));
  }
  return typeof value === "string" ? stripPhones(value) : value;
}

function scrubJson(value) {
  const text = String(value || "");
  try {
    return JSON.stringify(scrub(JSON.parse(text)));
  } catch {
    return stripPhones(text);
  }
}

function quote(value) {
  return `'${String(value == null ? "" : value).replaceAll("'", "''")}'`;
}

function applyStatements(statements) {
  if (!apply || !statements.length) return;
  for (let index = 0; index < statements.length; index += 100) {
    const file = path.join(os.tmpdir(), `js-map-contact-purge-${process.pid}-${index}.sql`);
    fs.writeFileSync(file, `${statements.slice(index, index + 100).join("\n")}\n`, "utf8");
    try {
      run(["exec", "wrangler", "d1", "execute", "js-map-primary", "--remote", "--file", file, "--yes"]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
}

const listingRows = query(`SELECT property_id, main_source, operating_memo, landlord_phone, tenant_phone, contacts_json
  FROM listings WHERE status <> 'deleted' AND main_source IN ('네이버','당근') ORDER BY rowid`);
const listingStatements = [];
const changedPropertyIds = new Set();
let removedOccurrences = 0;
const removedNumbers = new Set();
for (const row of listingRows) {
  const memo = String(row.operating_memo || "");
  const matches = [...memo.matchAll(phonePattern)].map((match) => match[0]);
  const cleanedMemo = stripPhones(memo);
  const hasStoredContacts = Boolean(String(row.landlord_phone || "").trim() || String(row.tenant_phone || "").trim() || !["", "[]"].includes(String(row.contacts_json || "").trim()));
  if (cleanedMemo === memo && !hasStoredContacts) continue;
  removedOccurrences += matches.length;
  matches.forEach((number) => removedNumbers.add(number.replace(/\D/g, "")));
  changedPropertyIds.add(row.property_id);
  listingStatements.push(`UPDATE listings SET operating_memo=${quote(cleanedMemo)}, landlord_phone='', tenant_phone='', contacts_json='[]', version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE property_id=${quote(row.property_id)} AND main_source IN ('네이버','당근');`);
}

const sourceStatements = [];
let cursor = 0;
let sourceRowsChecked = 0;
let sourceRowsChanged = 0;
while (true) {
  const rows = query(`SELECT rowid AS cursor, id, listing_id, list_snapshot_json, raw_json
    FROM listing_sources WHERE source IN ('네이버','당근') AND rowid > ${cursor}
    ORDER BY rowid LIMIT 1000`);
  if (!rows.length) break;
  for (const row of rows) {
    cursor = Math.max(cursor, Number(row.cursor) || 0);
    sourceRowsChecked += 1;
    const snapshot = String(row.list_snapshot_json || "{}");
    const raw = String(row.raw_json || "{}");
    const cleanedSnapshot = scrubJson(snapshot);
    const cleanedRaw = scrubJson(raw);
    if (snapshot === cleanedSnapshot && raw === cleanedRaw) continue;
    sourceRowsChanged += 1;
    changedPropertyIds.add(row.listing_id);
    sourceStatements.push(`UPDATE listing_sources SET list_snapshot_json=${quote(cleanedSnapshot)}, raw_json=${quote(cleanedRaw)}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=${quote(row.id)} AND source IN ('네이버','당근');`);
  }
  if (rows.length < 1000) break;
}

sourceStatements.push(`DELETE FROM listing_contacts WHERE source_id IN (SELECT id FROM listing_sources WHERE source IN ('네이버','당근'));`);
applyStatements([...listingStatements, ...sourceStatements]);

if (apply) {
  const cacheKeys = ["api-cache/d1-sheet.csv", "api-cache/unified-listings.json",
    "api-cache/unified-listings-v3-source-search.json"];
  for (const key of cacheKeys) {
    run(["exec", "wrangler", "r2", "object", "delete", `js-map-media/${key}`, "--remote", "--force"]);
  }
}

console.log(JSON.stringify({
  applied: apply,
  listingsChecked: listingRows.length,
  listingsChanged: listingStatements.length,
  removedPhoneOccurrences: removedOccurrences,
  removedDistinctNumbers: removedNumbers.size,
  sourceRowsChecked,
  sourceRowsChanged,
  changedProperties: changedPropertyIds.size
}, null, 2));
