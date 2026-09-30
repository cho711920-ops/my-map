import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Run the real ingestion path with local SQLite, without changing exports or
// contacting a provider. This catches future representative-update regressions.
const collectorUrl = new URL("../cloudflare/src/collector-api.js", import.meta.url);
const collectorCode = fs.readFileSync(collectorUrl, "utf8").replace(
  /\bfrom\s+(["'])(\.\/[^"']+)\1/g,
  (_, quote, relative) => `from ${quote}${new URL(relative, collectorUrl).href}${quote}`
) + "\nexport { ingestRecords, attachSource };";
const { ingestRecords, attachSource, normalizedRecord } = await import(`data:text/javascript;base64,${Buffer.from(collectorCode).toString("base64")}`);

function database(t) {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Network access is forbidden in this test"); });
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const name of fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(name, migrations), "utf8"));
  }
  const queries = [];
  const prepare = (sql, args = []) => {
    const positions = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, n) => { positions.push(Number(n) - 1); return "?"; });
    const params = () => positions.length ? positions.map(index => args[index]) : args;
    return {
      bind: (...values) => prepare(sql, values),
      async first() { queries.push(sql); return db.prepare(compiled).get(...params()) || null; },
      async all() { queries.push(sql); return { results: db.prepare(compiled).all(...params()) }; },
      async run() { queries.push(sql); return { meta: { changes: Number(db.prepare(compiled).run(...params()).changes) } }; }
    };
  };
  const env = { DB: { prepare, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } } };
  let sequence = 0;
  const save = async (provider, record) => {
    const result = await ingestRecords(env, provider, [record], { sessionId: `type-label-${++sequence}` });
    assert.equal(result.ok, true);
    assert.equal(result.failed, 0, JSON.stringify(result));
    assert.equal(result.review, 0, JSON.stringify(result));
    return result;
  };
  const applyCondition = async (provider, payload) => {
    const source = db.prepare("SELECT * FROM listing_sources WHERE source=?").get(provider);
    const record = normalizedRecord(provider, payload);
    record.providerSourceId = record.sourceId;
    record.sourceId = source.source_listing_id;
    return attachSource(env, record, source.listing_id, source.session_id, source, true, "test-condition");
  };
  return { db, save, applyCondition, queries };
}

function naver(overrides = {}) {
  return { articleNo: "26000001", tradeType: "sale", saleCategory: "other", salePrice: 30000,
    category: "A02", realEstateTypeCode: "A02", buildingName: "유형 검수", jibunAddress: "서구 둔산동 12",
    roomInfo: "1층", areaSquareMeter: 66.1157, listSnapshot: "type-before", ...overrides };
}

test("Korean labels are saved for new masters and snapshots, while equivalent old Naver type keys survive condition updates", async t => {
  const f = database(t);
  await f.save("네이버", naver());
  const created = f.db.prepare("SELECT * FROM listings").get();
  const source = f.db.prepare("SELECT * FROM listing_sources").get();
  assert.equal(created.listing_type, "오피스텔");
  assert.equal(JSON.parse(source.list_snapshot_json).type, "오피스텔");
  f.db.prepare("UPDATE listings SET listing_type='A02', sale_category='other' WHERE id=?").run(created.id);
  const before = f.db.prepare("SELECT * FROM listings").get();
  const legacyKey = row => [row.title, row.address, row.room, row.listing_type].join("|");
  f.queries.length = 0;
  await f.applyCondition("네이버", naver({ salePrice: 31000, listSnapshot: "type-after" }));
  const after = f.db.prepare("SELECT * FROM listings").get();
  const afterSource = f.db.prepare("SELECT * FROM listing_sources").get();
  assert.equal(legacyKey(after), legacyKey(before));
  assert.equal(after.id, before.id);
  assert.equal(after.listing_type, "A02");
  assert.equal(after.sale_category, "officetel");
  assert.equal(after.sale_price, 31000);
  assert.equal(afterSource.id, source.id);
  assert.equal(afterSource.source_listing_id, source.source_listing_id);
  assert.equal(JSON.parse(afterSource.list_snapshot_json).type, "오피스텔");
  assert.equal(JSON.parse(afterSource.raw_json).category, "A02");
  assert.equal(f.queries.filter(sql => /^SELECT main_source, operating_memo, status, trade_type, listing_type FROM listings/.test(sql)).length, 1);
});

test("an actual Naver type change is not hidden by legacy-key protection", async t => {
  const f = database(t);
  await f.save("네이버", naver());
  const before = f.db.prepare("SELECT * FROM listings").get();
  f.db.prepare("UPDATE listings SET listing_type='A02' WHERE id=?").run(before.id);
  await f.applyCondition("네이버", naver({ category: "C02", realEstateTypeCode: "C02", listSnapshot: "changed-type" }));
  const after = f.db.prepare("SELECT * FROM listings").get();
  assert.equal(after.id, before.id);
  assert.equal(after.listing_type, "빌라/연립");
  assert.equal(after.sale_category, "villa");
});

test("promotion from a different representative source does not retain its code as a Naver legacy key", async t => {
  const f = database(t);
  await f.save("네이버", naver());
  const before = f.db.prepare("SELECT * FROM listings").get();
  f.db.prepare("UPDATE listings SET main_source='공실박스', listing_type='A02' WHERE id=?").run(before.id);
  await f.save("네이버", naver({ salePrice: 31000, listSnapshot: "promoted-naver" }));
  const after = f.db.prepare("SELECT * FROM listings").get();
  assert.equal(after.id, before.id);
  assert.equal(after.main_source, "네이버");
  assert.equal(after.listing_type, "오피스텔");
});

test("a higher-priority different provider still replaces a Naver representative with its own Korean type", async t => {
  const f = database(t);
  await f.save("네이버", naver());
  const before = f.db.prepare("SELECT * FROM listings").get();
  f.db.prepare("UPDATE listings SET listing_type='A02' WHERE id=?").run(before.id);
  await f.save("당근", { originalId: "39000001", tradeType: "sale", salesTypeV3: { type: "OFFICETEL" },
    trades: [{ type: "BUY", price: 30000 }], publicJibunAddress: "서구 둔산동 12", floor: 1,
    area: 66.1157, buildingName: "유형 검수", listSnapshot: "promoted-daangn" });
  const after = f.db.prepare("SELECT * FROM listings WHERE id=?").get(before.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings").get().n, 1);
  assert.equal(after.main_source, "당근");
  assert.equal(after.listing_type, "오피스텔");
});
