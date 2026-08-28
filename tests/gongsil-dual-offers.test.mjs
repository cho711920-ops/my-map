import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi, gongsilOfferRecords } from "../cloudflare/src/collector-api.js";
import { gongsilAdvertisedOffers, gongsilOfferSourceId, resolveGongsilOfferIds } from "../cloudflare/src/gongsil-offers.js";

const fixture = (id = "841436", fields = {}) => {
  const list = { Bfidx: id, TypeView: "상가", Ho: "107", Me: 37000, Bo: 2000, Mm: 150,
    Area: 11, TotBomoney: 0, TotMmmoney: 0, Photos: ["2026/08/real.png"], ...fields };
  return { externalId: id, tradeType: "sale", salePrice: list.Me,
    listSnapshot: JSON.stringify(list), raw: { list }, latitude: 36.34, longitude: 127.38,
    values: ["테스트상가", "서구 탄방동 678", "107호", "일반상가", 0, 0, 0, 0, 11, "", "", "(임장가자) 확인"],
    contactList: [{ role: "임대인", phone: "010-0000-0000" }] };
};

function database(t) {
  const db = new DatabaseSync(":memory:");
  for (const name of fs.readdirSync("cloudflare/migrations").filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(`cloudflare/migrations/${name}`, "utf8"));
  }
  t.after(() => db.close());
  const prepare = (sql, args = []) => {
    const numbers = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, n) => { numbers.push(Number(n) - 1); return "?"; });
    const params = () => (numbers.length ? numbers.map((n) => args[n]) : args);
    return { bind: (...values) => prepare(sql, values),
      async all() { return { results: db.prepare(compiled).all(...params()) }; },
      async first() { return db.prepare(compiled).get(...params()) || null; },
      async run() { const result = db.prepare(compiled).run(...params()); return { meta: { changes: Number(result.changes) } }; }
    };
  };
  const env = { COLLECTOR_ACCESS_KEY: "test-only", DB: { prepare,
    async batch(statements) { return Promise.all(statements.map((stmt) => stmt.run())); } } };
  const call = async (body) => {
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", {
      method: "POST", headers: { Origin: "https://www.gongsilbox.com", "Content-Type": "application/json" },
      body: JSON.stringify({ collectorKey: "test-only", source: "공실박스", collectorVersion: "2.2.4", ...body })
    }), env);
    const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const save = (record, sessionId = "test-session") => call({ action: "gongsilImportBatch", sessionId, records: [record] });
  const manifest = (record) => call({ action: "classifySourceManifest", sessionId: "manifest-session",
    entries: [{ sourceId: record.externalId, listSnapshot: record.listSnapshot, tradeType: record.tradeType,
      saleCategory: "commercial", salePrice: record.salePrice, room: "107호", area: 11, deposit: 0, rent: 0 }] });
  return { db, env, save, manifest, call };
}

test("explicit sale and rent become two independent offers with common media/contact/address", () => {
  const offers = gongsilOfferRecords(fixture());
  assert.equal(offers.length, 2);
  assert.deepEqual(offers.map((r) => [r.tradeType, r.salePrice, r.deposit, r.rent]),
    [["sale", 37000, 0, 0], ["lease", null, 2000, 150]]);
  assert.equal(offers[1].room, "107호");
  assert.deepEqual(offers[0].images, offers[1].images);
  assert.equal(offers[1].images.length, 1);
  assert.deepEqual(offers[0].contacts, offers[1].contacts);
  assert.equal(offers[0].address, offers[1].address);
  assert.equal(offers[1].saleDetails, undefined);
});

test("sale investment income/memo never invents a lease; pure jeonse is not monthly rent", () => {
  assert.deepEqual(gongsilAdvertisedOffers({ Me: 85000, TotBomoney: 17880, TotMmmoney: 202,
    Memo: "보증금 1억7880만 월수익 202만", Jun: 30000, Jmm: 0 }).map((o) => o.tradeType), ["sale"]);
  assert.equal(gongsilAdvertisedOffers({ Me: 85000, Bo: 1000, Mm: -1 }).length, 1);
  assert.equal(gongsilAdvertisedOffers({ Me: 0, Bo: 0, Mm: 50 })[0].deposit, 0);
  assert.deepEqual(gongsilAdvertisedOffers({ Me: 50000, Jun: 60000, Jmm: 315 }).map((o) => o.tradeType), ["sale", "lease"]);
  assert.equal(gongsilAdvertisedOffers({ Moneys: [{ Ty: "매매", Price: 40000 }, { Ty: "월세", Bo: 2000, Mm: 150 }] }).length, 2);
});

test("legacy identity remains in its own market", () => {
  for (const type of ["sale", "lease"]) {
    const map = new Map([["123", type]]);
    assert.equal(gongsilOfferSourceId("123", type, map), "123");
    assert.equal(gongsilOfferSourceId("123", type === "sale" ? "lease" : "sale", map), `123::${type === "sale" ? "lease" : "sale"}`);
  }
});

test("real SQLite API: dual save, unchanged rescan, price update and single-offer rescan do not duplicate or cross markets", async (t) => {
  const { db, save, manifest } = database(t);
  const record = fixture();
  const result = await save(record);
  assert.equal(result.failed, 0, JSON.stringify(result));
  assert.equal(result.received, 1);
  assert.equal(result.offerReceived, 2);
  assert.equal(result.created, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM listing_contacts").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM listing_media").get().n, 2);
  const first = db.prepare("SELECT id,trade_type FROM listings ORDER BY trade_type").all();
  const classified = await manifest(record);
  assert.equal(classified.received, 1);
  assert.equal(classified.unchanged, 1, JSON.stringify(classified));
  assert.deepEqual(classified.needsDetail, []);
  await save(record, "second");
  const changed = fixture("841436", { Mm: 160 });
  assert.deepEqual((await manifest(changed)).needsDetail, ["841436"]);
  await save(changed, "third");
  const leaseOnly = fixture("841436", { Me: 0, Mm: 170 });
  leaseOnly.tradeType = "lease";
  await save(leaseOnly, "fourth");
  assert.deepEqual(db.prepare("SELECT id,trade_type FROM listings ORDER BY trade_type").all(), first);
  const snapshots = db.prepare("SELECT trade_type,list_snapshot_json FROM listing_sources").all();
  assert.equal(JSON.parse(snapshots.find((r) => r.trade_type === "sale").list_snapshot_json).salePrice, 37000);
  assert.equal(JSON.parse(snapshots.find((r) => r.trade_type === "lease").list_snapshot_json).rent, 170);
});

for (const legacyType of ["sale", "lease"]) test(`legacy ${legacyType} survives new opposite offer with its state and source ID`, async (t) => {
  const { db, save, manifest } = database(t);
  const existing = fixture("legacy", legacyType === "sale" ? { Bo: 0, Mm: 0 } : { Me: 0 });
  existing.tradeType = legacyType;
  await save(existing);
  db.exec(`UPDATE listing_sources SET source_listing_id='legacy'; UPDATE listings SET status='계약완료', operating_memo='(확인) 사용자 메모';`);
  const before = db.prepare("SELECT id, listing_id FROM listing_sources").get();
  const dual = fixture("legacy");
  assert.deepEqual((await manifest(dual)).needsDetail, ["legacy"]);
  const result = await save(dual, "dual");
  assert.equal(result.failed, 0, JSON.stringify(result));
  assert.equal(result.created, 1);
  assert.deepEqual(db.prepare("SELECT id, listing_id FROM listing_sources WHERE source_listing_id='legacy'").get(), before);
  const listing = db.prepare("SELECT status,operating_memo FROM listings WHERE id=?").get(before.listing_id);
  assert.equal(listing.status, "계약완료");
  assert.match(listing.operating_memo, /사용자 메모/);
});

test("partial lease observation cannot revive sale; mixed/old finalization cannot count missing ads", async (t) => {
  const { db, save, call } = database(t);
  await save(fixture());
  db.exec("UPDATE listing_sources SET active=0, missing_count=3");
  await call({ action: "finalizeCollectionSession", sessionId: "partial", tradeType: "lease", complete: false,
    observedSourceIds: ["841436"], observedOffers: [{ sourceId: "841436", tradeType: "lease" }] });
  assert.deepEqual(db.prepare("SELECT trade_type,active,missing_count FROM listing_sources ORDER BY trade_type").all().map((r) => [...Object.values(r)]),
    [["lease", 1, 0], ["sale", 0, 3]]);
  const ids = Array.from({ length: 100 }, (_, i) => String(i));
  for (const offers of [undefined, ids.flatMap((sourceId) => [{ sourceId, tradeType: "sale" }, { sourceId, tradeType: "lease" }])]) {
    const result = await call({ action: "finalizeCollectionSession", sessionId: "mixed", tradeType: "sale",
      complete: true, validationVersion: 2, scope: "공실박스 전체", expectedCount: 100,
      manifestCount: 100, processedCount: 100, observedSourceIds: ids, observedOffers: offers });
    assert.equal(result.complete, false);
    assert.equal(result.missingMarked, 0);
  }
});

test("one batch retains both market candidates instead merging identical ads within each own market", async (t) => {
  const { db, call } = database(t);
  const result = await call({ action: "gongsilImportBatch", sessionId: "same-batch",
    records: [fixture("100"), fixture("200")] });
  assert.equal(result.failed, 0, JSON.stringify(result));
  assert.equal(result.received, 2);
  assert.equal(result.offerReceived, 4);
  assert.equal(result.created, 2);
  assert.equal(result.merged, 2);
  const rows = db.prepare("SELECT trade_type,count(*) n,count(DISTINCT listing_id) masters FROM listing_sources GROUP BY trade_type").all();
  assert.deepEqual(rows.map((r) => [r.trade_type, r.n, r.masters]), [["lease", 2, 1], ["sale", 2, 1]]);
});

test("complete single-market manifests still count missing only in that market", async (t) => {
  const { db, save, call } = database(t);
  await save(fixture("seen"));
  await save(fixture("missing"));
  const ids = ["seen", ...Array.from({ length: 99 }, (_, i) => `other-${i}`)];
  const result = await call({ action: "finalizeCollectionSession", sessionId: "full-lease", tradeType: "lease",
    complete: true, validationVersion: 2, scope: "공실박스 서구 전체", expectedCount: 100,
    manifestCount: 100, processedCount: 100, observedSourceIds: ids,
    observedOffers: ids.map((sourceId) => ({ sourceId, tradeType: "lease" })) });
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(result.missingMarked, 1);
  const rows = db.prepare("SELECT source_listing_id,missing_count FROM listing_sources ORDER BY source_listing_id").all();
  assert.deepEqual(rows.map((r) => [r.source_listing_id, r.missing_count]),
    [["missing::lease", 1], ["missing::sale", 0], ["seen::lease", 0], ["seen::sale", 0]]);
});

test("legacy pending review IDs are resolved separately from new opposite offers without modifying review data", async (t) => {
  const { db, env, call } = database(t);
  await call({ action: "classifySourceManifest", sessionId: "pending", entries: [] });
  db.prepare(`INSERT INTO collector_raw (id,session_id,source,source_listing_id,trade_type,processing_state,payload_json)
    VALUES ('review-sale','pending','공실박스','pending-id','sale','review','{}')`).run();
  const before = db.prepare("SELECT * FROM collector_raw").all();
  const resolved = await resolveGongsilOfferIds(env, [
    { sourceId: "pending-id", tradeType: "sale" }, { sourceId: "pending-id", tradeType: "lease" }
  ]);
  assert.deepEqual(resolved.map((r) => r.sourceId), ["pending-id", "pending-id::lease"]);
  assert.deepEqual(db.prepare("SELECT * FROM collector_raw").all(), before);
});
