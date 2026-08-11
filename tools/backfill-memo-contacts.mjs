import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reconcileMemoContacts } from "../cloudflare/src/d1-api.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const apply = process.argv.includes("--apply");
const emitSql = process.argv.includes("--emit-sql");
const diagnose = process.argv.includes("--diagnose");

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `wrangler exited ${result.status}`);
  }
  return result.stdout.trim();
}

function sql(value) {
  return `'${String(value == null ? "" : value).replace(/'/g, "''")}'`;
}

function parseContacts(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const roleFilter = [
  "임대인", "임)", "임:", "임 ", "세입자", "임차인", "세)", "세:",
  "관리소장", "관리인", "주인", "건물주", "사장)", "사모)"
].map((label) => `operating_memo LIKE ${sql(`%${label}%`)}`).join(" OR ");
const query = `SELECT property_id, main_source, operating_memo, contacts_json
    , (SELECT json_extract(h.before_json, '$.contacts_json')
       FROM listing_history h
       WHERE h.listing_id=listings.id AND h.action='memoContactBackfill'
       ORDER BY h.id DESC LIMIT 1) AS prior_contacts_json
  FROM listings WHERE operating_memo LIKE '%0%' AND (${roleFilter}) ORDER BY property_id`;
const payload = JSON.parse(runWrangler([
  "d1", "execute", "js-map-primary", "--remote", "--json", "--command", query
]));
const rows = payload?.[0]?.results || [];
const changes = [];
const roleCounts = {};

for (const row of rows) {
  const current = parseContacts(row.contacts_json);
  const before = current.length ? current : parseContacts(row.prior_contacts_json);
  const after = reconcileMemoContacts(row.main_source, before, row.operating_memo);
  if (!after.length || JSON.stringify(before) === JSON.stringify(after)) continue;
  changes.push({ propertyId: row.property_id, before: row.contacts_json || "[]", after });
  for (const contact of after) roleCounts[contact.role] = (roleCounts[contact.role] || 0) + 1;
}

function buildStatements() {
  const now = new Date().toISOString();
  const statements = [];
  for (const change of changes) {
    const afterSql = `json_array(${change.after.map((contact) =>
      `json_object('role', ${sql(contact.role)}, 'phone', ${sql(contact.phone)})`).join(", ")})`;
    statements.push(`INSERT INTO listing_history
      (listing_id, action, actor_email, before_json, after_json)
      SELECT id, 'memoContactBackfill', 'codex-system',
        json_object('contacts_json', contacts_json),
        json_object('contacts_json', CAST(${afterSql} AS TEXT))
      FROM listings WHERE property_id=${sql(change.propertyId)} LIMIT 1;`);
    statements.push(`UPDATE listings SET contacts_json=CAST(${afterSql} AS TEXT),
      version=version+1, updated_at=${sql(now)} WHERE property_id=${sql(change.propertyId)};`);
  }
  return statements.join("\n");
}

if (emitSql) {
  process.stdout.write(changes.length ? buildStatements() : "SELECT 1;");
} else if (apply && changes.length) {
  const command = buildStatements();
  runWrangler(["d1", "execute", "js-map-primary", "--remote", "--json", "--command", command]);
}

if (!emitSql) {
  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    scanned: rows.length,
    changed: changes.length,
    roleCounts,
    ...(diagnose ? {
      changes: changes.map((change) => ({
        propertyId: change.propertyId,
        beforeType: Array.isArray(change.before) ? "array" : typeof change.before,
        beforeLength: String(change.before || "").length,
        beforeCount: parseContacts(change.before).length,
        afterCount: change.after.length,
        beforeRoles: parseContacts(change.before).map((contact) => contact.role),
        afterRoles: change.after.map((contact) => contact.role)
      }))
    } : {})
  }, null, 2));
}
