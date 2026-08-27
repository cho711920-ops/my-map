// Exact two-row repair. Default is READ-ONLY production inspection + backup +
// in-memory forward/rollback validation. --apply is the only remote write path.
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { normalizedRecord } from "../cloudflare/src/collector-api.js";

const root = resolve(import.meta.dirname, "..");
const targets = [
  { id: "M-28c80292-455b-4354-bf5d-e1035a4cea47", sourceId: "O-6eb6b5c7-4eea-4746-89ba-e2cf2d3c2531", externalId: "678545", sale: 197000 },
  { id: "M-4954998f-e5b2-4fe0-a777-f5645539f374", sourceId: "O-85f4f2c6-369f-4098-bc9c-c878535d2ee1", externalId: "2613327", sale: 195000 }
];
const apply = process.argv.includes("--apply");
const backupRoot = process.argv.find(arg => arg.startsWith("--backup="))?.slice(9);
if (!backupRoot) throw new Error("Provide --backup=<private absolute directory outside git>");
const dir = resolve(backupRoot, `gongsil-sale-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const quote = value => value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const ids = targets.map(t => quote(t.id)).join(",");
function run(args) {
  const result = spawnSync(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), ...args], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
function query(sql) {
  return JSON.parse(run(["d1", "execute", "js-map-primary", "--remote", "--json", "--command", sql]))[0].results;
}
function readState() {
  return {
    listings: query(`SELECT * FROM listings WHERE id IN (${ids}) ORDER BY id`),
    listing_sources: query(`SELECT * FROM listing_sources WHERE listing_id IN (${ids}) ORDER BY id`),
    listing_history: query(`SELECT * FROM listing_history WHERE listing_id IN (${ids}) ORDER BY id`),
    listing_contacts: query(`SELECT * FROM listing_contacts WHERE listing_id IN (${ids}) ORDER BY id`),
    listing_media: query(`SELECT * FROM listing_media WHERE listing_id IN (${ids}) ORDER BY id`),
    customer_matches: query(`SELECT * FROM customer_matches WHERE listing_id IN (${ids}) ORDER BY customer_id,listing_id`),
    cloud_state: query(`SELECT * FROM cloud_state WHERE ${targets.map(t => `value_json LIKE '%${t.id}%'`).join(" OR ")} ORDER BY owner_email,scope,record_key`)
  };
}
function assignments(values) { return Object.entries(values).map(([key, value]) => `${key}=${quote(value)}`).join(","); }
function exactWhere(row) { return Object.entries(row).map(([key, value]) => `${key} IS ${quote(value)}`).join(" AND "); }
const before = readState();
assert.equal(before.listings.length, 2); assert.equal(before.listing_sources.length, 2);
assert.ok(before.listing_history.every(h => ["collectorCreated", "sourceMerged"].includes(h.action)), "User change or prior repair: inspect before proceeding");
const now = new Date().toISOString();
const changes = targets.map(target => {
  const listing = before.listings.find(l => l.id === target.id);
  const source = before.listing_sources.find(s => s.id === target.sourceId && s.listing_id === target.id && s.source_listing_id === target.externalId);
  assert.ok(source); assert.equal(source.source, "공실박스");
  assert.equal(listing.trade_type, "lease"); assert.equal(source.trade_type, "lease");
  assert.equal(listing.version, 1); assert.equal(listing.status, "active");
  const raw = JSON.parse(source.raw_json), old = JSON.parse(source.list_snapshot_json);
  assert.equal(Number(raw.list.Me), target.sale);
  const record = normalizedRecord("공실박스", { externalId: target.externalId, raw, values: [] });
  assert.equal(record.salePrice, target.sale); assert.equal(record.saleCategory, "building");
  assert.ok(record.area > 0); assert.equal(record.room, "전체");
  const snapshot = { ...old, tradeType: "sale", saleCategory: record.saleCategory, salePrice: record.salePrice,
    saleDetails: record.saleDetails, type: record.category, room: record.room, deposit: 0, rent: 0, area: record.area };
  const listingAfter = { ...listing, trade_type: "sale", sale_category: record.saleCategory, sale_price: record.salePrice,
    listing_type: record.category, room: record.room, deposit: 0, monthly_rent: 0, area_m2: record.area,
    version: listing.version + 1, updated_at: now };
  const sourceAfter = { ...source, trade_type: "sale", sale_category: record.saleCategory, sale_price: record.salePrice,
    list_snapshot_json: JSON.stringify(snapshot), snapshot_hash: "sale-sample-repair-20260827", updated_at: now };
  return { target, listing, source, listingAfter, sourceAfter };
});
function script(reverse = false) {
  const statements = ["-- Guarded exact-row repair; contacts/media/user state are never updated.",
    "CREATE TABLE _gongsil_sale_sample_guard (n INTEGER CHECK(n=2));"];
  for (const [key, table] of [["listing", "listings"], ["source", "listing_sources"]]) {
    statements.push(`INSERT INTO _gongsil_sale_sample_guard SELECT count(*) FROM ${table} WHERE ${changes.map(c => `(${exactWhere(c[reverse ? key + "After" : key])})`).join(" OR ")};`);
  }
  statements.push(`INSERT INTO _gongsil_sale_sample_guard SELECT count(*) FROM listing_sources WHERE listing_id IN (${ids});`);
  for (const c of changes) {
    for (const [key, table] of [["listing", "listings"], ["source", "listing_sources"]]) {
      const from = c[reverse ? key + "After" : key], to = c[reverse ? key : key + "After"];
      const changed = Object.fromEntries(Object.entries(to).filter(([column, value]) => value !== from[column]));
      statements.push(`UPDATE ${table} SET ${assignments(changed)} WHERE id=${quote(from.id)};`);
    }
    const oldState = reverse ? c.listingAfter : c.listing;
    const nextState = reverse ? c.listing : c.listingAfter;
    const select = row => Object.fromEntries(["trade_type", "sale_category", "sale_price", "deposit", "monthly_rent", "room", "area_m2"].map(k => [k,row[k]]));
    statements.push(`INSERT INTO listing_history(listing_id,source_id,action,actor_email,before_json,after_json) VALUES (${quote(c.target.id)},${quote(c.target.sourceId)},${quote(reverse ? "saleSampleRepairRollback" : "saleSampleRepair")},'codex-sale-repair',${quote(JSON.stringify(select(oldState)))},${quote(JSON.stringify(select(nextState)))});`);
  }
  statements.push("DROP TABLE _gongsil_sale_sample_guard;");
  return statements.join("\n");
}
const forward = script(), rollback = script(true);
// Execute the exact SQL on an isolated SQLite copy, including the optimistic
// concurrency guards and rollback; no database is uploaded or replaced.
const local = new DatabaseSync(":memory:");
for (const table of ["listings", "listing_sources"]) {
  const rows = before[table];
  local.exec(`CREATE TABLE ${table}(${Object.keys(rows[0]).map(key => `${key} ${key === "version" ? "INTEGER" : ""}`).join(",")});`);
  for (const row of rows) local.exec(`INSERT INTO ${table} VALUES (${Object.values(row).map(quote).join(",")});`);
}
local.exec("CREATE TABLE listing_history(listing_id,source_id,action,actor_email,before_json,after_json);");
local.exec(forward);
for (const c of changes) {
  assert.deepEqual({ ...local.prepare("SELECT * FROM listings WHERE id=?").get(c.target.id) }, c.listingAfter);
  assert.deepEqual({ ...local.prepare("SELECT * FROM listing_sources WHERE id=?").get(c.target.sourceId) }, c.sourceAfter);
}
local.exec(rollback);
for (const c of changes) assert.deepEqual({ ...local.prepare("SELECT * FROM listings WHERE id=?").get(c.target.id) }, c.listing);
local.exec("UPDATE listings SET version=version+1;");
assert.throws(() => local.exec(forward), /CHECK constraint/);
local.close();
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "before.json"), JSON.stringify(before, null, 2));
writeFileSync(resolve(dir, "repair.sql"), forward);
writeFileSync(resolve(dir, "rollback.sql"), rollback);
console.log(JSON.stringify({ backup: dir, localForwardRollbackAndConflictGuard: "passed", planned: changes.map(c => ({
  id: c.target.id, address: c.listing.address, salePrice: c.listingAfter.sale_price, area: c.listingAfter.area_m2
})), apply }));
if (apply) {
  run(["d1", "execute", "js-map-primary", "--remote", "--file", resolve(dir,"repair.sql"), "--yes"]);
  const after = readState();
  writeFileSync(resolve(dir, "after.json"), JSON.stringify(after, null, 2));
  for (const c of changes) {
    assert.deepEqual(after.listings.find(l => l.id === c.target.id), c.listingAfter);
    assert.deepEqual(after.listing_sources.find(s => s.id === c.target.sourceId), c.sourceAfter);
  }
  for (const table of ["listing_contacts", "listing_media", "customer_matches", "cloud_state"]) assert.deepEqual(after[table], before[table], `${table} preserved`);
  assert.equal(after.listing_history.length, before.listing_history.length + 2);
  assert.deepEqual(after.listing_history.filter(h => h.action !== "saleSampleRepair"), before.listing_history);
  console.log("Verified: only two listings and their source trade fields repaired; related assets and user state preserved.");
}
