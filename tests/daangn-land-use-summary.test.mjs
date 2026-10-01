import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { compactSaleSummary, handleD1GetAction } from "../cloudflare/src/d1-api.js";

const labels = { SITE: "대", DRY_PADDY_FIELD: "전", PADDY_FIELD: "답", FORESTRY: "임야",
  ORCHARD: "과수원", WAREHOUSE_SITE: "창고용지", MISCELLANEOUS_LAND: "잡종지" };
const base = { source: "당근", tradeType: "sale", saleCategory: "land", room: "원본 토지 표기",
  salePrice: 42000, area: 100, deposit: 0, rent: 0,
  saleDetails: { scope: "land", landAreaM2: 330.58, zoning: "기존 용도지역", totalDeposit: 0, monthlyIncome: 0 } };

test("real SQLite landType projection recovers old Daangn land rows with list/detail parity and no writes", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(value => value.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const cases = [
    ...Object.entries(labels).map(([landType, expected]) => ({ name: landType, raw: { landType }, expected })),
    { name: "existing label wins", raw: { landType: "SITE" }, details: { landUse: "답" }, expected: "답" },
    { name: "missing details", raw: { landType: "SITE" }, snapshot: { saleDetails: undefined }, expected: "대" },
    { name: "scope identifies uncategorized legacy land", raw: { landType: "SITE" }, snapshot: { saleCategory: "" }, expected: "대" },
    { name: "explicit other category excluded", raw: { landType: "SITE" }, snapshot: { saleCategory: "other" }, expected: undefined },
    { name: "conflicting building category excluded", raw: { landType: "SITE" }, snapshot: { saleCategory: "building" }, expected: undefined },
    ...[null, "", "-", "—", "미확인", "확인 필요"].map(landUse => ({ name: `placeholder ${landUse}`,
      raw: { landType: "PADDY_FIELD" }, details: { landUse }, expected: "답" })),
    ...[null, "", "NEW_PROVIDER_CODE", "대지면적 100평", "대", true, 0, [], {}].map(landType => ({
      name: `unsupported ${JSON.stringify(landType)}`, raw: { landType }, expected: undefined })),
    { name: "no raw code", raw: { content: "대지면적 100평, 전원주택용 토지" }, expected: undefined },
    { name: "unknown code preserves label", raw: { landType: "FUTURE_CODE" }, details: { landUse: "전" }, expected: "전" },
    { name: "building excluded", raw: { landType: "SITE" }, snapshot: { saleCategory: "building" },
      details: { scope: "whole_building" }, expected: undefined },
    { name: "lease excluded", raw: { landType: "SITE" }, snapshot: { tradeType: "lease" }, expected: undefined },
    { name: "Naver excluded", raw: { landType: "SITE" }, snapshot: { source: "네이버" }, expected: undefined },
    { name: "Gongsil excluded", raw: { landType: "SITE" }, snapshot: { source: "공실박스" }, expected: undefined },
    { name: "direct entry excluded", raw: { landType: "SITE" }, snapshot: { source: "직접등록" }, expected: undefined }
  ];
  const snapshots = cases.map((item, index) => ({ ...base, originalId: `S-land-${index}`, propertyId: `M-land-${index}`,
    saleDetails: { ...base.saleDetails, ...item.details }, ...item.snapshot }));
  for (const [index, item] of cases.entries()) {
    const snapshot = snapshots[index];
    db.prepare("INSERT INTO listings(id,property_id,status,trade_type,room,sale_price,area_m2,sale_details_json) VALUES(?,?,'active',?,?,?,?,?)")
      .run(snapshot.propertyId, snapshot.propertyId, snapshot.tradeType, snapshot.room, snapshot.salePrice, snapshot.area,
        JSON.stringify(snapshot.saleDetails || {}));
    db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,trade_type,list_snapshot_json,raw_json) VALUES(?,?,?,?,1,?,?,?)")
      .run(snapshot.originalId, snapshot.propertyId, snapshot.source, String(index), snapshot.tradeType, JSON.stringify(snapshot),
        JSON.stringify({ ...item.raw, rawOnlyMarker: "DO_NOT_INCLUDE_RAW_PROVIDER_DATA_IN_LIST", rawBlob: "x".repeat(10000) }));
  }
  const storedState = () => JSON.stringify({ listings: db.prepare("SELECT * FROM listings ORDER BY id").all(),
    sources: db.prepare("SELECT * FROM listing_sources ORDER BY id").all() });
  const before = storedState();
  const queries = [];
  const prepare = (sql, values = []) => {
    queries.push(sql);
    const indexes = [];
    const query = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return { bind(...bindings) { return prepare(sql, bindings); },
      async all() { return { results: db.prepare(query).all(...args()) }; },
      async first() { return db.prepare(query).get(...args()) || null; } };
  };
  // Deliberately expose no mutation methods: the read adapter cannot update stored rows.
  const env = { DB: { prepare } };
  const list = await handleD1GetAction(env, {}, { action: "unifiedListings" });
  const listQueries = [...queries];
  assert.equal(list.originalCount, cases.length);
  const projection = listQueries.find(sql => sql.includes("daangn_land_type"));
  assert.match(projection, /CASE WHEN source='당근' THEN json_extract\(raw_json, '\$\.landType'\) END AS daangn_land_type/);
  assert.doesNotMatch(projection.replace(/json_(?:extract|type)\(raw_json,[^)]*\)/g, ""), /\braw_json\b/);
  assert.ok(listQueries.every(sql => !/SELECT id, source, list_snapshot_json, raw_json|WHERE listing_id =/.test(sql)),
    "initial list does not fetch individual listing details");
  assert.doesNotMatch(JSON.stringify(list), /DO_NOT_INCLUDE_RAW_PROVIDER_DATA_IN_LIST|rawBlob|landType|daangn_land_type|raw_json|list_snapshot_json/);
  assert.ok(Object.keys(labels).every(code => !JSON.stringify(list).includes(code)));

  for (const [index, item] of cases.entries()) {
    const snapshot = snapshots[index];
    const row = Object.fromEntries(list.fields.map((field, fieldIndex) => [field, list.groups[snapshot.propertyId][0][fieldIndex] ?? ""]));
    const detail = await handleD1GetAction(env, {}, { action: "unifiedListingDetail", propertyId: snapshot.propertyId });
    const original = detail.originals[0];
    assert.equal(row.saleSummary?.landUse, item.expected, `list: ${item.name}`);
    assert.equal(original.saleDetails?.landUse, item.expected, `detail: ${item.name}`);
    assert.deepEqual(row.saleSummary, compactSaleSummary(original), `compact/detail parity: ${item.name}`);
    for (const field of ["originalId", "source", "room", "tradeType", "saleCategory", "salePrice", "area", "deposit", "rent"]) {
      assert.equal(row[field], snapshot[field], `list preserves ${field}: ${item.name}`);
      assert.equal(original[field], snapshot[field], `detail preserves ${field}: ${item.name}`);
    }
    assert.equal(original.propertyId, snapshot.propertyId);
    for (const field of ["scope", "landAreaM2", "zoning", "totalDeposit", "monthlyIncome"]) {
      assert.equal(original.saleDetails?.[field], snapshot.saleDetails?.[field], `physical detail ${field}: ${item.name}`);
    }
  }
  assert.equal(storedState(), before);
  assert.ok(queries.every(sql => /^\s*SELECT\b/.test(sql)));
});

test("compact land summary keeps the recovered label without adding provider metadata", () => {
  const summary = compactSaleSummary({ ...base, saleDetails: { ...base.saleDetails, landUse: "답",
    landType: "PADDY_FIELD", daangn_land_type: "PADDY_FIELD", raw: { landType: "PADDY_FIELD" } } });
  assert.deepEqual(summary, { scope: "land", landAreaM2: 330.58, totalDeposit: 0, monthlyIncome: 0,
    landUse: "답", zoning: "기존 용도지역" });
});
