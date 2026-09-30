import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorAdminPost, normalizedRecord, normalizeReviewRecord } from "../cloudflare/src/collector-api.js";

const user = { email: "trade-boundary@test.invalid", role: "owner" };
const materialTables = ["listings", "listing_sources", "listing_media", "listing_contacts", "listing_history"];

function fixture(t, listingTrade = "lease", sourceTrade = "sale", existingSource = false) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const directory = new URL("../cloudflare/migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  const prepare = (sql, args = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, number) => {
      indexes.push(Number(number) - 1);
      return "?";
    });
    const params = () => indexes.length ? indexes.map(index => args[index]) : args;
    return {
      bind: (...values) => prepare(sql, values),
      async first() { return db.prepare(compiled).get(...params()) || null; },
      async all() { return { results: db.prepare(compiled).all(...params()) }; },
      async run() { return { meta: { changes: Number(db.prepare(compiled).run(...params()).changes) } }; }
    };
  };
  const env = { DB: { prepare, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } } };
  const record = normalizedRecord("당근", {
    originalId: "review-source", tradeType: sourceTrade,
    salesTypeV3: { type: "STORE" }, publicJibunAddress: "서구 탄방동 678", floor: 1, area: 36.3,
    trades: [{ type: "BUY", price: 35000 }, { type: "MONTH", deposit: 1000, monthlyPay: 45 }]
  });
  db.prepare(`INSERT INTO listings (id,main_source,address,room,trade_type,sale_category,sale_price,deposit,monthly_rent)
    VALUES ('M-target','직접등록','서구 탄방동 678','1층',?1,'commercial',?2,?3,?4)`)
    .run(listingTrade, listingTrade === "sale" ? 30000 : null, listingTrade === "sale" ? 0 : 2000, listingTrade === "sale" ? 0 : 50);
  db.prepare("INSERT INTO collector_sessions (id,source) VALUES ('session','당근')").run();
  if (existingSource) {
    db.prepare("INSERT INTO listings (id,trade_type,address) VALUES ('M-origin',?1,'서구 탄방동 678')").run(sourceTrade);
    db.prepare(`INSERT INTO listing_sources (id,listing_id,source,source_listing_id,trade_type,list_snapshot_json)
      VALUES ('O-existing','M-origin','당근',?1,?2,?3)`).run(record.sourceId, sourceTrade, JSON.stringify(record));
    db.prepare(`INSERT INTO listing_media (id,listing_id,source_id,media_type,external_url)
      VALUES ('I-existing','M-origin','O-existing','image','https://example.invalid/photo.jpg')`).run();
    db.prepare(`INSERT INTO listing_contacts (id,listing_id,source_id,role,phone,normalized_phone)
      VALUES ('C-existing','M-origin','O-existing','임대인','010-0000-0000','01000000000')`).run();
  }
  const enqueue = (value = record, id = "review", state = "review", result = {}) => {
    db.prepare(`INSERT INTO collector_raw (id,session_id,source,source_listing_id,trade_type,processing_state,payload_json,result_json)
      VALUES (?1,'session','당근',?2,?3,?4,?5,?6)`)
      .run(id, value.sourceId, value.tradeType === "sale" ? "sale" : "lease", state, JSON.stringify(value), JSON.stringify(result));
  };
  const snapshot = () => Object.fromEntries(materialTables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  const review = reviewAction => handleCollectorAdminPost(env, user, {
    action: "applyReviewBatch", reviewIds: ["review"], masterId: "M-target", reviewAction, manualMergeConfirmed: true
  });
  return { db, env, record, enqueue, snapshot, review };
}

for (const reviewAction of ["merge", "condition"]) {
  for (const [listingTrade, sourceTrade] of [["lease", "sale"], ["sale", "lease"]]) {
    test(`${reviewAction} rejects ${sourceTrade} into ${listingTrade} without moving sources or rewriting prices`, async t => {
      const f = fixture(t, listingTrade, sourceTrade, true);
      f.enqueue();
      const before = f.snapshot();
      const result = await f.review(reviewAction);
      assert.equal(result.processed, 0);
      assert.equal(result.failed, 1);
      assert.deepEqual(f.snapshot(), before);
      assert.equal(f.db.prepare("SELECT processing_state FROM collector_raw WHERE id='review'").get().processing_state, "review");
    });
  }
}

for (const tradeType of ["unsupported", "전세"]) {
  test(`an explicit unknown transaction ${tradeType} cannot merge as a legacy lease`, async t => {
    const f = fixture(t, "lease", "lease");
    f.enqueue({ ...f.record, tradeType });
    const before = f.snapshot();
    const result = await f.review("condition");
    assert.equal(result.failed, 1);
    assert.equal(result.processed, 0);
    assert.deepEqual(f.snapshot(), before);
  });
}

test("a matching sale target cannot take a source already owned by a lease", async t => {
  const f = fixture(t, "sale", "sale", true);
  f.db.prepare("UPDATE listings SET trade_type='lease' WHERE id='M-origin'").run();
  f.db.prepare("UPDATE listing_sources SET trade_type='lease' WHERE id='O-existing'").run();
  f.enqueue();
  const before = f.snapshot();
  const result = await f.review("condition");
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(f.snapshot(), before);
});

for (const listingTrade of ["lease", "sale"]) {
  test(`legacy review without a transaction is accepted only by a ${listingTrade} target when compatible`, async t => {
    const f = fixture(t, listingTrade, "lease");
    const legacy = { ...f.record };
    delete legacy.tradeType;
    f.enqueue(legacy);
    const result = await f.review("merge");
    assert.equal(result.processed, listingTrade === "lease" ? 1 : 0);
    assert.equal(result.failed, listingTrade === "lease" ? 0 : 1);
    assert.equal(f.db.prepare("SELECT trade_type FROM listings WHERE id='M-target'").get().trade_type, listingTrade);
  });
}

for (const tradeType of ["lease", "sale"]) {
  test(`matching ${tradeType} review still updates its own market`, async t => {
    const f = fixture(t, tradeType, tradeType);
    f.enqueue();
    const result = await f.review("condition");
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 0);
    const listing = f.db.prepare("SELECT trade_type,deposit,monthly_rent,sale_price FROM listings WHERE id='M-target'").get();
    assert.deepEqual({ ...listing }, tradeType === "sale"
      ? { trade_type: "sale", deposit: 0, monthly_rent: 0, sale_price: 35000 }
      : { trade_type: "lease", deposit: 1000, monthly_rent: 45, sale_price: null });
  });
}

test("a stale opposite-market review alias is rejected while the matching canonical review succeeds", async t => {
  const f = fixture(t, "lease", "lease");
  f.enqueue();
  f.enqueue({ ...f.record, sourceId: "sale-alias", tradeType: "sale", saleCategory: "commercial", salePrice: 35000 },
    "alias", "duplicate", { action: "sameAsPendingReview", canonicalReviewId: "review" });
  const result = await f.review("merge");
  assert.equal(result.processed, 1);
  assert.equal(result.aliasesMerged, 0);
  assert.equal(result.aliasesFailed, 1);
  assert.deepEqual(f.db.prepare("SELECT trade_type FROM listing_sources").all().map(row => row.trade_type), ["lease"]);
  assert.match(f.db.prepare("SELECT error_text FROM collector_raw WHERE id='alias'").get().error_text, /임대.*매매/);
});

test("automatic repair cannot attach a stale opposite-market single candidate", async t => {
  const f = fixture(t, "lease", "sale");
  f.enqueue(f.record, "review", "review", { candidateIds: ["M-target"] });
  const before = f.snapshot();
  const result = await handleCollectorAdminPost(f.env, user, { action: "mergeSingleCandidateReviews", limit: 20 });
  assert.equal(result.merged, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(f.snapshot(), before);
  assert.match(f.db.prepare("SELECT error_text FROM collector_raw WHERE id='review'").get().error_text, /임대.*매매/);
});

test("review normalization preserves unsupported types so automatic repair cannot default them to lease", async t => {
  const f = fixture(t, "lease", "lease");
  const unknown = normalizeReviewRecord({ ...f.record, tradeType: "전세" });
  assert.equal(unknown.tradeType, "전세");
  assert.equal(normalizeReviewRecord({ trade_type: "UNSUPPORTED" }).tradeType, "UNSUPPORTED");
  assert.equal(normalizeReviewRecord({}).tradeType, "lease");
  f.enqueue(unknown, "review", "review", { candidateIds: ["M-target"] });
  const before = f.snapshot();
  const result = await handleCollectorAdminPost(f.env, user, { action: "mergeSingleCandidateReviews", limit: 20 });
  assert.equal(result.merged, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(f.snapshot(), before);
  assert.match(f.db.prepare("SELECT error_text FROM collector_raw WHERE id='review'").get().error_text, /거래유형/);
});

test("creating from a review cannot leave an orphan listing when its source belongs to the other market", async t => {
  const f = fixture(t, "sale", "sale", true);
  f.db.prepare("UPDATE listings SET trade_type='lease' WHERE id='M-origin'").run();
  f.db.prepare("UPDATE listing_sources SET trade_type='lease' WHERE id='O-existing'").run();
  f.enqueue();
  const before = f.snapshot();
  const result = await f.review("create");
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(f.snapshot(), before);
});

test("creating from an unsupported normalized review neither defaults to lease nor inserts a listing", async t => {
  const f = fixture(t, "lease", "lease");
  f.enqueue(normalizeReviewRecord({ ...f.record, tradeType: "전세" }));
  const before = f.snapshot();
  const result = await f.review("create");
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(f.snapshot(), before);
});
