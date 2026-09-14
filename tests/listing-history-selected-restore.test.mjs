import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { previewListingHistoryRestore, restoreSelectedListingHistory } from "../cloudflare/src/listing-history-restore.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE listings(id TEXT PRIMARY KEY, property_id TEXT, title TEXT, deposit REAL, operating_memo TEXT, status TEXT, version INTEGER, updated_at TEXT);
    CREATE TABLE listing_history(id INTEGER PRIMARY KEY, listing_id TEXT, action TEXT, actor_email TEXT, before_json TEXT, after_json TEXT);
    CREATE TABLE listing_sources(id TEXT PRIMARY KEY, raw_json TEXT); CREATE TABLE listing_data_quality_holds(id TEXT PRIMARY KEY);
    INSERT INTO listings VALUES ('P1','P1','상가',3000,'최근상담','active',7,'now');
    INSERT INTO listing_sources VALUES ('S1','원본 검수 자료'); INSERT INTO listing_data_quality_holds VALUES ('H1');`);
  db.prepare("INSERT INTO listing_history VALUES (1,'P1','updateProperty','a',?,?)").run(
    JSON.stringify({deposit: 1000, operating_memo: "옛메모", status: "active", raw_json: "보존"}),
    JSON.stringify({deposit: 2000, operating_memo: "최근상담", status: "active", raw_json: "변경"}));
  let race = null;
  const env = {DB: {
    prepare(sql) { return {bind(...args) { return {sql, args, async first() { return db.prepare(sql).get(...args); }}; }}; },
    async batch(statements) {
      if (race) { race(db); race = null; }
      db.exec("BEGIN");
      try { const results = statements.map(({sql, args}) => ({meta: {changes: Number(db.prepare(sql).run(...args).changes)}})); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  }};
  return {env, db, race(fn) { race = fn; }};
}
const admin = {email: "admin@test.invalid", role: "admin"};

test("history preview offers only changed business fields and marks later edits", async () => {
  const {env, db} = fixture();
  const preview = await previewListingHistoryRestore(env, admin, {historyId: 1});
  assert.deepEqual(preview.fields.map((row) => row.field), ["deposit", "operating_memo"]);
  assert.equal(preview.fields[0].changedSinceHistory, true);
  assert.equal(preview.fields[1].changedSinceHistory, false);
  assert.equal(preview.expectedVersion, 7); db.close();
});

test("selected restore changes memo only, keeps newer price and preserves source/hold evidence", async () => {
  const {env, db} = fixture();
  const result = await restoreSelectedListingHistory(env, admin, {historyId: 1, expectedVersion: 7,
    fields: ["operating_memo"], expectedValues: {operating_memo: "최근상담"}});
  assert.equal(result.persisted, true);
  const listing = db.prepare("SELECT * FROM listings").get();
  assert.equal(listing.deposit, 3000); assert.equal(listing.operating_memo, "옛메모"); assert.equal(listing.version, 8);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 2);
  assert.equal(db.prepare("SELECT raw_json FROM listing_sources").get().raw_json, "원본 검수 자료");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_data_quality_holds").get().n, 1); db.close();
});

test("stale preview and unauthorized fields cannot restore", async () => {
  const {env, db} = fixture();
  await assert.rejects(restoreSelectedListingHistory(env, admin, {historyId: 1, expectedVersion: 6, fields: ["deposit"], expectedValues: {deposit:3000}}), {statusCode:409});
  await assert.rejects(restoreSelectedListingHistory(env, admin, {historyId: 1, expectedVersion:7, fields:["raw_json"], expectedValues:{raw_json:"a"}}), {statusCode:400});
  await assert.rejects(previewListingHistoryRestore(env, {role:"member"}, {historyId:1}), {statusCode:403});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 1); db.close();
});

test("concurrent update fails CAS without creating a false restore history", async () => {
  const {env, db, race} = fixture();
  race((connection) => connection.exec("UPDATE listings SET operating_memo='동시수정'"));
  await assert.rejects(restoreSelectedListingHistory(env, admin, {historyId:1, expectedVersion:7,
    fields:["operating_memo"], expectedValues:{operating_memo:"최근상담"}}), {statusCode:409});
  assert.equal(db.prepare("SELECT operating_memo FROM listings").get().operating_memo, "동시수정");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 1); db.close();
});
