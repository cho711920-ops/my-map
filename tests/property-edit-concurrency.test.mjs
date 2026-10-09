import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { canonicalListingRoom } from "../cloudflare/src/floor.js";
import { listingTradeTypesCanMerge } from "../cloudflare/src/listing-trade.js";
import { reconcileMemoContacts } from "../cloudflare/src/d1-api.js";

const source = readFileSync(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const user = { email: "synthetic@example.invalid" };
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE listings(id TEXT PRIMARY KEY, property_id TEXT, title TEXT, building_name TEXT,
    room TEXT, deposit REAL, monthly_rent REAL, maintenance_fee REAL, premium REAL, area_m2 REAL,
    landlord_phone TEXT, tenant_phone TEXT, operating_memo TEXT, status TEXT, contacts_json TEXT,
    version INTEGER, updated_at TEXT, main_source TEXT, trade_type TEXT);
    CREATE TABLE listing_history(id INTEGER PRIMARY KEY, listing_id TEXT, action TEXT, actor_email TEXT,
    before_json TEXT, after_json TEXT);
    CREATE TABLE listing_sources(id TEXT PRIMARY KEY, listing_id TEXT, source TEXT, source_listing_id TEXT,
    active INTEGER, trade_type TEXT, list_snapshot_json TEXT, raw_json TEXT, updated_at TEXT);
    CREATE TABLE listing_media(id TEXT PRIMARY KEY, source_id TEXT, listing_id TEXT, updated_at TEXT);
    CREATE TABLE listing_contacts(id TEXT PRIMARY KEY, source_id TEXT, listing_id TEXT, updated_at TEXT);
    CREATE TABLE listing_data_quality_holds(id TEXT PRIMARY KEY);
    INSERT INTO listings VALUES('P1','P1','상가','상가','101호',1000,50,NULL,0,33,'','','메모','active','[]',1,'old','네이버','lease');
    INSERT INTO listing_sources VALUES('S1','P1','네이버','1',1,'lease','{}','원본 검수 자료','old');
    INSERT INTO listing_media VALUES('IMG','S1','P1','old');
    INSERT INTO listing_contacts VALUES('TEL','S1','P1','old');
    INSERT INTO listing_data_quality_holds VALUES('H1');`);
  let race;
  const env = { DB: {
    prepare(sql) {
      return { bind(...args) {
        const bindings = Object.fromEntries(args.map((value, index) => [String(index + 1), value]));
        return { sql, bindings,
          async first() { return db.prepare(sql).get(bindings) || null; },
          async all() { return { results: db.prepare(sql).all(bindings) }; }
        };
      } };
    },
    async batch(statements) {
      if (race) { race(db); race = null; }
      db.exec("BEGIN");
      try {
        const result = statements.map(({ sql, bindings }) => ({ meta: db.prepare(sql).run(bindings) }));
        db.exec("COMMIT"); return result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  } };
  const context = vm.createContext({ crypto, canonicalListingRoom, listingTradeTypesCanMerge, reconcileMemoContacts });
  for (const name of ["clean", "number", "parseJson", "propertyIdFrom", "propertyEditFieldsV1",
    "propertyEditConflictV1", "propertyEditPatchV1", "propertyEditRecoveryStatementsV1",
    "linkedSourceHistorySnapshot", "latestCompletedSourceSnapshot", "completionSourceRecoveryPlan", "updateProperty"]) {
    vm.runInContext(functionSource(name), context);
  }
  const originalValues = ["상가", "합성주소", "101호", "상가", 1000, 50, 0, 0, 33, "", "", "메모", "", "", "네이버"];
  const updated = { name: "상가", room: "101호", deposit: 1000, rent: 50, fee: 0, premium: 0,
    area: 33, landlordPhone: "", tenantPhone: "", memo: "메모", state: "", contacts: [] };
  return { db, env, race(fn) { race = fn; },
    body: { key: { propertyId: "P1" }, originalValues, updated },
    save(body) { return context.updateProperty(env, user, body); },
    row() { return db.prepare("SELECT * FROM listings").get(); },
    history() { return db.prepare("SELECT * FROM listing_history ORDER BY id").all(); }
  };
}

test("stale memo-only edit preserves another user's room and completed status", async () => {
  const h = fixture();
  h.db.exec("UPDATE listings SET room='102호',status='계약완료',version=3");
  h.body.updated.memo = "메모 수정";
  const result = await h.save(h.body);
  assert.equal(h.row().room, "102호");
  assert.equal(h.row().status, "계약완료");
  assert.equal(h.row().operating_memo, "메모 수정");
  assert.equal(h.row().maintenance_fee, null, "unchanged blank numeric field stays NULL");
  assert.equal(result.updated.room, "102호");
  assert.equal(result.updated.state, "계약완료");
  assert.equal(JSON.parse(h.history()[0].after_json).maintenance_fee, null);
  assert.equal(h.db.prepare("SELECT raw_json FROM listing_sources").get().raw_json, "원본 검수 자료");
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM listing_data_quality_holds").get().n, 1);
  h.db.close();
});

test("conflicting edits to the same room fail without mutation or history", async () => {
  const h = fixture();
  h.db.exec("UPDATE listings SET room='102호',version=2");
  h.body.updated.room = "103호";
  await assert.rejects(h.save(h.body), { statusCode: 409, code: "PROPERTY_EDIT_CONFLICT" });
  assert.equal(h.row().room, "102호"); assert.equal(h.history().length, 0); h.db.close();
});

test("missing original values and a deleted target fail closed", async () => {
  const h = fixture();
  await assert.rejects(h.save({ ...h.body, originalValues: undefined }), { statusCode: 409 });
  h.db.exec("UPDATE listings SET status='deleted'");
  h.body.updated.memo = "cannot undelete";
  await assert.rejects(h.save(h.body), { statusCode: 409 });
  assert.equal(h.row().status, "deleted"); assert.equal(h.history().length, 0); h.db.close();
});

test("unchanged stale form returns latest values without writes", async () => {
  const h = fixture();
  h.db.exec("UPDATE listings SET room='102호',status='계약완료',version=3");
  const result = await h.save(h.body);
  assert.equal(result.noChange, true); assert.equal(result.updated.room, "102호");
  assert.equal(h.row().version, 3); assert.equal(h.history().length, 0); h.db.close();
});

for (const incrementVersion of [true, false]) {
  test("between-read/write race is rejected, version increment=" + incrementVersion, async () => {
    const h = fixture(); h.body.updated.memo = "내 수정";
    h.race(db => db.exec("UPDATE listings SET room='동시 변경'" + (incrementVersion ? ",version=2" : "")));
    await assert.rejects(h.save(h.body), { statusCode: 409 });
    assert.equal(h.row().room, "동시 변경"); assert.equal(h.row().operating_memo, "메모");
    assert.equal(h.history().length, 0); h.db.close();
  });
}

function completedWithDetachedSource(h) {
  h.db.exec("UPDATE listings SET status='계약완료'; UPDATE listing_sources SET listing_id=NULL; UPDATE listing_media SET listing_id=NULL; UPDATE listing_contacts SET listing_id=NULL;");
  h.db.prepare("INSERT INTO listing_history(listing_id,action,actor_email,before_json,after_json) VALUES('P1','toggleDone','actor',?,?)")
    .run(JSON.stringify({ linkedSources: [{ id: "S1", active: 1 }] }), JSON.stringify({ status: "계약완료" }));
  h.body.originalValues[12] = "계약완료";
  h.body.updated.state = "";
}

test("failed restore CAS cannot create history or reconnect source/media/contact", async () => {
  const h = fixture(); completedWithDetachedSource(h);
  h.race(db => db.exec("UPDATE listings SET version=2"));
  await assert.rejects(h.save(h.body), { statusCode: 409 });
  assert.equal(h.row().status, "계약완료"); assert.equal(h.history().length, 1);
  for (const table of ["listing_sources", "listing_media", "listing_contacts"]) {
    assert.equal(h.db.prepare(`SELECT listing_id FROM ${table}`).get().listing_id, null);
  }
  h.db.close();
});

test("successful explicit restoration reconnects original source/media/contact atomically", async () => {
  const h = fixture(); completedWithDetachedSource(h);
  const result = await h.save(h.body);
  assert.equal(result.fullReload, true); assert.equal(result.restoredSourceCount, 1);
  assert.equal(h.row().status, "active"); assert.equal(h.history().length, 2);
  for (const table of ["listing_sources", "listing_media", "listing_contacts"]) {
    assert.equal(h.db.prepare(`SELECT listing_id FROM ${table}`).get().listing_id, "P1");
  }
  assert.equal(h.db.prepare("SELECT raw_json FROM listing_sources").get().raw_json, "원본 검수 자료");
  h.db.close();
});

test("failed recovery statement rolls back accepted edit and its history", async () => {
  const h = fixture(); completedWithDetachedSource(h);
  h.db.exec("CREATE TRIGGER fail_recovery BEFORE UPDATE ON listing_media BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  await assert.rejects(h.save(h.body), /synthetic failure/);
  assert.equal(h.row().status, "계약완료"); assert.equal(h.history().length, 1);
  assert.equal(h.db.prepare("SELECT listing_id FROM listing_sources").get().listing_id, null); h.db.close();
});

test("unchanged contacts are never replaced by stale form contacts", async () => {
  const h = fixture();
  const contacts = JSON.stringify([{ role: "임대인", phone: "010-1234-5678" }]);
  h.db.prepare("UPDATE listings SET contacts_json=?").run(contacts);
  h.body.updated.room = "102호";
  await h.save(h.body);
  assert.equal(h.row().contacts_json, contacts); h.db.close();
});
