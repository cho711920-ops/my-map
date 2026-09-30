import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi, normalizedRecord, compareListingSpace, manifestEntryMatch } from "../cloudflare/src/collector-api.js";

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const directory = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(file, directory), "utf8"));
  }
  const prepare = (sql, values = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, number) => { indexes.push(Number(number) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return {
      bind: (...parameters) => prepare(sql, parameters),
      async first() { return db.prepare(compiled).get(...args()) || null; },
      async all() { return { results: db.prepare(compiled).all(...args()) }; },
      async run() { return { meta: { changes: Number(db.prepare(compiled).run(...args()).changes) } }; }
    };
  };
  const env = { COLLECTOR_ACCESS_KEY: "test-only", DB: {
    prepare, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  } };
  const call = async body => {
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", {
      method: "POST", headers: { Origin: "https://fin.land.naver.com", "Content-Type": "application/json" },
      body: JSON.stringify({ collectorKey: "test-only", source: "네이버", ...body })
    }), env);
    const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const save = (...data) => call({ action: "saveNaverBatch", data });
  const manifest = item => {
    const record = normalizedRecord("네이버", item);
    return call({ action: "classifySourceManifest", entries: [{ ...record }] });
  };
  return { db, env, call, save, manifest };
}

const ad = (articleNo, overrides = {}) => ({
  articleNo, tradeType: "sale", saleCategory: "commercial", salePrice: 30000,
  category: "상가", buildingName: "시험상가", jibunAddress: "서구 탄방동 678", roomInfo: "1층",
  areaSquareMeter: 66.1157, latitude: 36.34, longitude: 127.38,
  listSnapshot: `snapshot-${articleNo}`, description: "시험용 매매", ...overrides
});

for (const saleCategory of ["commercial", "land", "other"]) {
  test(`${saleCategory}: ambiguous sale is published independently, never queued or forcibly merged`, async t => {
    const f = database(t);
    const first = ad("100", { saleCategory, spaceInfo: { landSpace: 165 }, roomInfo: saleCategory === "land" ? "" : "1층" });
    const second = { ...first, articleNo: "200", salePrice: 31000, listSnapshot: "snapshot-200" };
    await f.save(first);
    const before = f.db.prepare("SELECT * FROM listings").get();
    assert.equal(compareListingSpace(normalizedRecord("네이버", second), before).decision, "review");
    const result = await f.save(second);
    assert.equal(result.failed, 0, JSON.stringify(result));
    assert.equal(result.created, 1);
    assert.equal(result.review, 0);
    assert.equal(result.merged, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings").get().n, 2);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM collector_raw WHERE processing_state='review'").get().n, 0);
    assert.deepEqual(f.db.prepare("SELECT * FROM listings WHERE id=?").get(before.id), before);
    const again = await f.save(second);
    assert.equal(again.created, 0);
    assert.equal(again.review, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings").get().n, 2);
  });
}

test("exact sale duplicates may merge, but land and building at the same address never merge", async t => {
  const f = database(t);
  const result = await f.save(ad("100"), ad("200"), ad("300", { saleCategory: "land", spaceInfo: { landSpace: 66.1157 } }));
  assert.equal(result.failed, 0, JSON.stringify(result));
  assert.equal(result.review, 0);
  assert.equal(result.created, 2);
  assert.equal(result.merged, 1);
  assert.deepEqual(f.db.prepare("SELECT sale_category,COUNT(*) n FROM listings GROUP BY sale_category ORDER BY sale_category").all()
    .map(row => Object.values(row)), [["commercial", 1], ["land", 1]]);
});

test("sale does not disappear as an alias of somebody else's pending review", async t => {
  const f = database(t);
  const pending = normalizedRecord("네이버", ad("old-pending"));
  f.db.exec("INSERT INTO collector_sessions (id,source) VALUES ('pending-session','네이버')");
  f.db.prepare(`INSERT INTO collector_raw (id,session_id,source,source_listing_id,trade_type,processing_state,payload_json)
    VALUES ('pending','pending-session','네이버',?,'sale','review',?)`).run(pending.sourceId, JSON.stringify(pending));
  const result = await f.save(ad("new-sale"));
  assert.equal(result.created, 1);
  assert.equal(result.review, 0);
  assert.equal(result.duplicate, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings WHERE trade_type='sale'").get().n, 1);
});

test("a formerly pending sale is requested again and closed only after successful publication", async t => {
  const f = database(t);
  const item = ad("legacy-sale");
  await f.save(item);
  const saved = f.db.prepare("SELECT * FROM listing_sources").get();
  const record = normalizedRecord("네이버", item);
  f.db.prepare(`INSERT INTO collector_raw (id,session_id,source,source_listing_id,trade_type,processing_state,
    payload_json,snapshot_hash) VALUES ('old-sale',?,'네이버',?,'sale','review',?,?)`)
    .run(saved.session_id, record.sourceId, JSON.stringify(record), saved.snapshot_hash);
  f.db.prepare(`INSERT INTO collector_raw (id,session_id,source,source_listing_id,trade_type,processing_state,
    payload_json) VALUES ('keep-lease',?,'네이버',?,'lease','review',?)`)
    .run(saved.session_id, "네이버-lease-pending", JSON.stringify({ ...record, sourceId: "네이버-lease-pending", tradeType: "lease" }));
  // Simulate the legacy state before this offer ever had a representative.
  f.db.exec("DELETE FROM listing_media; DELETE FROM listing_contacts; DELETE FROM listing_history; DELETE FROM listing_sources; DELETE FROM listings;");
  const leaseBefore = f.db.prepare("SELECT * FROM collector_raw WHERE id='keep-lease'").get();
  const compared = await f.manifest(item);
  assert.deepEqual(compared.needsDetail, ["네이버-legacy-sale"]);
  assert.equal(compared.unchanged, 0);
  const result = await f.save(item);
  assert.equal(result.created, 1);
  assert.equal(result.review, 0);
  const review = f.db.prepare("SELECT * FROM collector_raw WHERE id='old-sale'").get();
  assert.equal(review.processing_state, "processed");
  assert.equal(JSON.parse(review.result_json).action, "directSalePublish");
  assert.deepEqual(f.db.prepare("SELECT * FROM collector_raw WHERE id='keep-lease'").get(), leaseBefore);
  assert.equal((await f.manifest(item)).unchanged, 1);
});

test("unusable price or exact address stays an error instead of a fake map listing or review", async t => {
  const f = database(t);
  const result = await f.save(ad("no-price", { salePrice: null }), ad("no-address", { jibunAddress: "서구 탄방동" }));
  assert.equal(result.failed, 2);
  assert.equal(result.created, 0);
  assert.equal(result.review, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM collector_raw WHERE processing_state='error'").get().n, 2);
});

test("lease ambiguity keeps the existing review workflow", async t => {
  const f = database(t);
  const common = { tradeType: "lease", salePrice: null, deposit: 1000, monthly: 50 };
  await f.save(ad("lease-1", { ...common, roomInfo: "1층" }), ad("lease-2", { ...common, roomInfo: "2층" }));
  const result = await f.save(ad("lease-3", { ...common, roomInfo: "" }));
  assert.equal(result.failed, 0);
  assert.equal(result.created, 0);
  assert.equal(result.review, 1);
});

test("qualified internal IDs never become a Naver original URL", () => {
  const record = normalizedRecord("네이버", ad(undefined, { sourceId: "네이버-123456::sale" }));
  assert.equal(record.link, "https://fin.land.naver.com/articles/123456");
});

test("even an identical fingerprint cannot classify the opposite market as unchanged", async t => {
  const f = database(t);
  const item = ad("shared-snapshot");
  await f.save(item);
  const row = f.db.prepare("SELECT * FROM listing_sources").get();
  assert.equal(manifestEntryMatch({ ...normalizedRecord("네이버", item), tradeType: "lease" }, row, "네이버"), "");
  assert.equal(manifestEntryMatch({ ...normalizedRecord("네이버", item), tradeType: "unknown" }, row, "네이버"), "");
  assert.equal(manifestEntryMatch(normalizedRecord("네이버", item), { ...row, trade_type: "unknown" }, "네이버"), "");
});
