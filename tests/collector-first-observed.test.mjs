import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleCollectorApi, handleCollectorAdminPost, normalizeReviewRecord } from "../cloudflare/src/collector-api.js";
import { advertisementObservationKey, verifiedObservationTimestamp, verifiedRawObservationAt,
  firstObservedAdvertisement } from "../cloudflare/src/collector-first-observed.js";

const now = "2026-10-16T03:00:00.000Z", past = "2026-10-12T03:00:00.000Z";
const payload = (id, extra = {}) => ({ source: "네이버", sourceId: id, tradeType: "lease", address: "서구 갈마동 361-14",
  deposit: 1000, rent: 50, area: 66.1, room: "101호", ...extra });
const raw = (id, extra = {}) => ({ id: "R-" + id, session_id: "historical-session", source: "네이버", source_listing_id: id, trade_type: "lease",
  processing_state: "awaiting_source_refresh", created_at: past, error_text: "", payload_json: JSON.stringify(payload(id)), ...extra });

function fixture(t) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(now) });
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("cloudflare/migrations").filter(name => name.endsWith(".sql")).sort()) db.exec(readFileSync("cloudflare/migrations/" + name, "utf8"));
  t.after(() => db.close());
  const queries = []; let failCounter = false;
  const prepare = (sql, values = []) => {
    const indexes = [], compiled = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return { bind: (...bindings) => prepare(sql, bindings),
      async all() { queries.push({ sql, values }); return { results: db.prepare(compiled).all(...args()) }; },
      async first() { return db.prepare(compiled).get(...args()) || null; },
      async run() {
        if (failCounter && /newSourceAds.*COALESCE/s.test(sql) && !/newSourceAdsReported/.test(sql)) throw new Error("synthetic atomic counter failure");
        return { meta: { changes: Number(db.prepare(compiled).run(...args()).changes) } };
      }
    };
  };
  const env = { COLLECTOR_ACCESS_KEY: "fixture-key", DB: { prepare, async batch(rows) {
    db.exec("BEGIN");
    try { const result = []; for (const row of rows) result.push(await row.run()); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  function insertRaw(row) {
    db.prepare("INSERT OR IGNORE INTO collector_sessions (id,source) VALUES (?,?)").run(row.session_id, row.source);
    const fields = Object.keys(row);
    db.prepare(`INSERT INTO collector_raw (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...Object.values(row));
  }
  const call = async body => {
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", { method: "POST",
      headers: { Origin: "https://fin.land.naver.com", "Content-Type": "application/json" },
      body: JSON.stringify({ collectorKey: "fixture-key", source: "네이버", ...body }) }), env);
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const ad = (id, extra = {}) => ({ articleNo: id, tradeType: "lease", category: "상가점포", buildingName: "검수상가",
    jibunAddress: "서구 갈마동 361-14", roomInfo: "101호", deposit: 1000, monthly: 50, areaSquareMeter: 66.1,
    listSnapshot: "synthetic-list", imageUrls: [], ...extra });
  const save = (rows, sessionId = "fixture-session") => call({ action: "saveNaverBatch", data: rows, sessionId });
  const totals = (sessionId = "fixture-session") => JSON.parse(db.prepare("SELECT totals_json FROM collector_sessions WHERE id=?").get(sessionId).totals_json);
  return { db, env, queries, insertRaw, call, ad, save, totals, failCounter: value => { failCounter = value; } };
}

test("evidence identities remain source/provider/market specific across qualified Naver and Gongsil IDs", () => {
  assert.equal(advertisementObservationKey("네이버", "네이버-123::lease", "lease"), advertisementObservationKey("네이버", "123", "lease"));
  assert.notEqual(advertisementObservationKey("네이버", "123", "lease"), advertisementObservationKey("당근", "123", "lease"));
  assert.notEqual(advertisementObservationKey("공실박스", "123::lease", "lease"), advertisementObservationKey("공실박스", "123::sale", "sale"));
  assert.equal(advertisementObservationKey("공실박스", "123::sale", "lease"), "");
  assert.equal(verifiedRawObservationAt(raw("123"), { source: "네이버", sourceId: "네이버-123::lease", tradeType: "lease", now }), past);
  assert.equal(verifiedRawObservationAt(raw("123", { trade_type: "sale" }), { source: "네이버", sourceId: "123", tradeType: "lease", now }), "");
});

test("timestamp validation rejects rollover/future/ambiguous values and preserves SQLite UTC and legacy KST days", () => {
  assert.equal(verifiedObservationTimestamp("2026-10-12 03:00:00", now), past);
  assert.equal(verifiedObservationTimestamp("2026-10-12T12:00:00+09:00", now), past);
  assert.equal(verifiedObservationTimestamp("26.10.12", now, { legacyDate: true }), "2026-10-11T15:00:00.000Z");
  for (const value of ["2026-02-30T00:00:00Z", "2026-10-17T00:00:00Z", "2026-10-12T24:00:00Z", "not-date", "2026-10-12", "2026-10-12T03:00:00+15:00"]) assert.equal(verifiedObservationTimestamp(value, now), "", value);
});

test("only a normal historical advertisement payload certifies prior observation", () => {
  const target = { source: "네이버", sourceId: "123", tradeType: "lease", now };
  for (const extra of [
    { processing_state: "error" }, { error_text: "주소 검증 실패" }, { created_at: "2026-02-30T00:00:00Z" },
    { created_at: "2027-01-01T00:00:00Z" }, { payload_json: "{}" }, { payload_json: "invalid" },
    { payload_json: JSON.stringify(payload("different")) }, { payload_json: JSON.stringify(payload("123", { tradeType: "sale", salePrice: 50000 })) },
    { payload_json: JSON.stringify(payload("123", { address: "갈마동 1층" })) },
    { payload_json: JSON.stringify(payload("123", { deposit: null, rent: null })) },
    { result_json: '{"action":"collectorError"}', processing_state: "processed" }
  ]) assert.equal(verifiedRawObservationAt(raw("123", extra), target), "", JSON.stringify(extra));
  for (const processing_state of ["review", "awaiting_source_refresh", "processed", "duplicate"]) {
    assert.equal(verifiedRawObservationAt(raw("123", { processing_state }), target), past);
  }
});

test("the earliest verified source or raw date wins without trusting invalid older observations", () => {
  const result = firstObservedAdvertisement({ source: "네이버", sourceId: "123", tradeType: "lease", now,
    sourceRows: [{ id: "S", source: "네이버", source_listing_id: "123::lease", trade_type: "lease", first_collected_at: "2026-10-14T03:00:00Z", created_at: now }],
    rawRows: [raw("123"), raw("123", { id: "bad", created_at: "2026-02-30T00:00:00Z" })] });
  assert.equal(result.firstObservedAt, past); assert.equal(result.previouslyObserved, true);
  assert.deepEqual(result.rawEvidenceIds, ["R-123"]); assert.deepEqual(result.sourceEvidenceIds, ["S"]);
});

test("historical pending advertisements publish without becoming new and keep original observation dates", async t => {
  const f = fixture(t);
  for (const [i, processing_state] of ["review", "awaiting_source_refresh", "processed", "duplicate"].entries()) f.insertRaw(raw("history-" + i, { processing_state }));
  const result = await f.save(Array.from({ length: 4 }, (_, i) => f.ad("history-" + i)));
  assert.equal(result.created, 1); assert.equal(result.newSourceAds, 0); assert.equal(f.totals().newSourceAds, 0);
  const master = f.db.prepare("SELECT first_collected_at,registration_at,created_at FROM listings").get();
  assert.equal(master.first_collected_at, past); assert.equal(master.registration_at, past); assert.equal(master.created_at, now);
  for (const row of f.db.prepare("SELECT first_collected_at,created_at,list_snapshot_json FROM listing_sources").all()) {
    assert.equal(row.first_collected_at, past); assert.equal(row.created_at, now); assert.equal(JSON.parse(row.list_snapshot_json).firstSeen, past);
  }
});

test("a genuinely new advertisement attached to an old master counts once without changing the master's first day", async t => {
  const f = fixture(t); f.insertRaw(raw("old")); await f.save([f.ad("old")]);
  const result = await f.save([f.ad("new")]);
  assert.equal(result.created, 0); assert.equal(result.merged, 1); assert.equal(result.newSourceAds, 1); assert.equal(f.totals().newSourceAds, 1);
  assert.equal(f.db.prepare("SELECT first_collected_at FROM listings").get().first_collected_at, past);
  assert.equal(f.db.prepare("SELECT first_collected_at FROM listing_sources WHERE source_listing_id LIKE '%new%'").get().first_collected_at, now);
  assert.equal((await f.save([f.ad("new")])).newSourceAds, 0);
});

test("opposite market, invalid payload and future raw rows cannot backdate or suppress a genuine new advertisement", async t => {
  const f = fixture(t);
  f.insertRaw(raw("market", { trade_type: "sale", payload_json: JSON.stringify(payload("market", { tradeType: "sale", salePrice: 50000 })) }));
  f.insertRaw(raw("future", { created_at: "2027-01-01T00:00:00Z" }));
  f.insertRaw(raw("invalid", { payload_json: "{}" }));
  f.insertRaw(raw("failed", { processing_state: "error" }));
  const result = await f.save(["market", "future", "invalid", "failed"].map(id => f.ad(id)));
  assert.equal(result.newSourceAds, 4); assert.equal(f.totals().newSourceAds, 4);
  assert.ok(f.db.prepare("SELECT first_collected_at FROM listing_sources").all().every(row => row.first_collected_at === now));
});

test("known unlinked source and reappearance preserve their first observation and never increment new ads", async t => {
  const f = fixture(t); await f.save([f.ad("return")]);
  f.db.prepare("UPDATE listing_sources SET listing_id=NULL,first_collected_at=?,created_at=?,active=0,updated_at=?").run(past, past, past);
  f.db.prepare("UPDATE listings SET status='deleted'").run();
  const result = await f.save([f.ad("return")], "relink");
  assert.equal(result.created, 1); assert.equal(result.newSourceAds, 0); assert.equal(f.totals("relink").newSourceAds, 0);
  assert.equal(f.db.prepare("SELECT first_collected_at FROM listings WHERE status<>'deleted'").get().first_collected_at, past);
  assert.equal(f.db.prepare("SELECT first_collected_at FROM listing_sources").get().first_collected_at, past);
});

test("old pending publication still commits the source and zero counter atomically", async t => {
  const f = fixture(t); f.insertRaw(raw("atomic")); f.failCounter(true);
  const failed = await f.save([f.ad("atomic")]);
  assert.equal(failed.failed, 1); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_sources").get().n, 0); assert.equal(f.totals().newSourceAds, 0);
  f.failCounter(false); const retried = await f.save([f.ad("atomic")]);
  assert.equal(retried.newSourceAds, 0); assert.equal(f.db.prepare("SELECT first_collected_at FROM listing_sources").get().first_collected_at, past);
});

test("Gongsil preserves the observed lease day without treating its newly advertised sale as old", async t => {
  const f = fixture(t);
  f.insertRaw(raw("box-one::lease", { source: "공실박스", payload_json: JSON.stringify(payload("box-one::lease", { source: "공실박스" })) }));
  const list = { Bfidx: "box-one", TypeView: "상가", Ho: "101", Me: 37000, Bo: 1000, Mm: 50, Area: 20 };
  const record = { externalId: "box-one", listSnapshot: JSON.stringify(list), raw: { list },
    values: ["검수상가", "서구 갈마동 361-14", "101호", "일반상가", 1000, 50, 0, 0, 20] };
  const result = await f.call({ action: "gongsilImportBatch", source: "공실박스", sessionId: "box-session", records: [record] });
  assert.equal(result.newSourceAds, 1);
  const sources = f.db.prepare("SELECT trade_type,first_collected_at FROM listing_sources ORDER BY trade_type").all();
  assert.deepEqual(sources.map(row => [row.trade_type, row.first_collected_at]), [["lease", past], ["sale", now]]);
});

test("manual review publication batches prior evidence and preserves the earliest date, not merely the selected queue row", async t => {
  const f = fixture(t);
  const record = normalizeReviewRecord(payload("네이버-review::lease"));
  f.insertRaw(raw("review", { id: "earliest", payload_json: JSON.stringify(record) }));
  f.insertRaw(raw("네이버-review::lease", { id: "selected", processing_state: "review", created_at: "2026-10-14T03:00:00Z",
    payload_json: JSON.stringify(record) }));
  const result = await handleCollectorAdminPost(f.env, { role: "owner", email: "synthetic@test.invalid" },
    { action: "applyReviewBatch", reviewIds: ["selected"], reviewAction: "create" });
  assert.equal(result.processed, 1); assert.equal(result.failed, 0);
  assert.equal(f.db.prepare("SELECT first_collected_at FROM listings").get().first_collected_at, past);
  assert.equal(f.db.prepare("SELECT first_collected_at FROM listing_sources").get().first_collected_at, past);
  assert.equal(f.totals("historical-session").newSourceAds, 0);
  assert.equal(f.queries.filter(query => query.sql.includes("'raw' AS evidence_kind")).length, 1);
});

test("wrapped Daangn historical payload aliases are equivalent in SQL projection and pure evidence validation", async t => {
  const f = fixture(t);
  f.insertRaw(raw("carrot-history::lease", { source: "당근", payload_json: JSON.stringify({ record: {
    providerSourceId: "carrot-history", source: "당근", trade_type: "lease", address: "서구 갈마동 361-14", deposit: 1000, monthly_rent: 50
  } }) }));
  const { loadFirstObservedAdvertisements } = await import("../cloudflare/src/collector-first-observed.js");
  const result = await loadFirstObservedAdvertisements(f.env, "당근", [{ sourceId: "carrot-history::lease", tradeType: "lease" }], new Map(), now);
  assert.equal(result.get(advertisementObservationKey("당근", "carrot-history", "lease")).firstObservedAt, past);
});

test("first-observation evidence uses bounded indexed batch reads, not one query per advertisement", async t => {
  const f = fixture(t);
  const result = await f.save(Array.from({ length: 90 }, (_, i) => f.ad("batch-" + i)));
  assert.equal(result.newSourceAds, 90);
  const evidence = f.queries.filter(query => query.sql.includes("'raw' AS evidence_kind"));
  assert.ok(evidence.length > 0 && evidence.length <= 5);
  assert.ok(evidence.every(query => query.values.length <= 81));
  const query = evidence[0], indexes = [], sql = query.sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
  const plan = f.db.prepare("EXPLAIN QUERY PLAN " + sql).all(...indexes.map(i => query.values[i]));
  assert.match(JSON.stringify(plan), /idx_collector_raw_source_listing_created/);
});
