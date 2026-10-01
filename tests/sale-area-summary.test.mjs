import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { compactSaleSummary, handleD1GetAction, masterFallbackOriginal } from "../cloudflare/src/d1-api.js";
import { saleDescriptionAreas, withSaleAreaDisplay } from "../cloudflare/src/sale-area-display.js";
import { naverSaleFields, gongsilSaleFields } from "../cloudflare/src/sale-fields.js";

const description = "중개대상물 종류 - 다가구주택\n세대수 - 15세대\n" +
  "대지면적 - 약67평(223.5㎡)\n건축면적 - 약40평(134.05㎡)\n연면적 - 약134평(444.34㎡)\n총층수 - 5층";
const areas = { landAreaM2: 223.5, buildingAreaM2: 134.05, grossAreaM2: 444.34 };
const base = { originalId: "S-area", propertyId: "M-area", source: "당근", tradeType: "sale", saleCategory: "house",
  room: "원본 4층", area: 60, salePrice: 120000, deposit: 0, rent: 0,
  saleDetails: { scope: "unit", totalDeposit: 3500, monthlyIncome: 400 } };

test("advertisement areas retain explicit square metres in paired rounded pyeong labels", () => {
  assert.deepEqual(saleDescriptionAreas(description), areas);
  assert.deepEqual(saleDescriptionAreas(description.replace("대지면적", "🔶대지면적")), areas);
  assert.deepEqual(saleDescriptionAreas("전용면적: 59.5㎡ / 대지 100평 / 연면적 330.58 m² / 건축면적(건평): 70 m2"),
    { exclusiveAreaM2: 59.5, landAreaM2: 330.58, grossAreaM2: 330.58, buildingAreaM2: 70 });
  assert.deepEqual(saleDescriptionAreas("전용 20평"), { exclusiveAreaM2: 66.12 });
  assert.deepEqual(saleDescriptionAreas("대지면적: 1,223.50㎡\n대지면적: 1223.5㎡"), { landAreaM2: 1223.5 });
});

test("ambiguous, unitless, range, rate and contradictory advertised areas stay absent", () => {
  for (const text of ["건평 40평", "면적 50평", "공급면적 80㎡", "대지면적 100", "대지면적 -10㎡",
    "대지면적 0㎡", "대지면적 50~100평", "대지면적 50평~100평", "전용면적 60㎡ 이상",
    "전용면적 60㎡ 이하", "전용면적 60㎡ 미만", "대지 50평당 1000만원", "전용 20평대",
    "대지면적 100평(999㎡)", "대지면적 100㎡\n대지면적 200㎡", "전용면적 true㎡",
    "건축면적 협의", "임대지 100평", "연면적: 1,23㎡", "대지 -20평",
    "건물 매매. 임대중인 1층 상가 전용 20평입니다.", "본 매물 매매. 별도 소개 매물: 전용 100평 / 대지 200평",
    "대지 20평 / 200㎡", "전용 20평(임대중인 1층)",
    "건물 매매\n임대 중인 1층 상가\n전용면적:20평", "별도 소개 매물\n전용면적:100평\n대지면적:200평"]) {
    assert.deepEqual(saleDescriptionAreas(text), {}, text);
  }
  for (const content of [null, undefined, false, 100, [], {}]) assert.deepEqual(saleDescriptionAreas(content), {});
});

test("read adapter fills missing area slots only without mutating prices, categories or source data", () => {
  const original = { ...base, saleDetails: { ...base.saleDetails, descriptionText: description,
    landAreaM2: 200, buildingAreaM2: "", grossAreaM2: null } };
  const before = structuredClone(original);
  const result = withSaleAreaDisplay(original);
  assert.deepEqual(result.saleDetails, { ...original.saleDetails, landAreaM2: 200, buildingAreaM2: 134.05, grossAreaM2: 444.34 });
  assert.deepEqual(original, before);
  for (const field of ["originalId", "propertyId", "tradeType", "saleCategory", "room", "area", "salePrice", "deposit", "rent"]) {
    assert.equal(result[field], original[field], field);
  }
  for (const value of [0, false, [], {}, "unverified"]) {
    const item = { ...base, saleDetails: { descriptionText: description, buildingAreaM2: value } };
    assert.equal(withSaleAreaDisplay(item).saleDetails.buildingAreaM2, value, "do not overwrite an existing value");
  }
  for (const patch of [{ tradeType: "lease" }, { saleCategory: "land" }, { saleDetails: { scope: "land" } }]) {
    const item = { ...base, ...patch };
    assert.equal(withSaleAreaDisplay(item, { daangn: { description } }), item);
  }
  assert.equal(withSaleAreaDisplay(base, { daangn: { description: "건평 40평" } }), base);
  const separated = { ...base, saleDetails: { ...base.saleDetails, exclusiveAreaM2: 59.5, landAreaM2: 200,
    descriptionText: "별도 소개 매물\n전용면적:100평\n대지면적:200평\n건축면적:100㎡" } };
  assert.equal(withSaleAreaDisplay(separated), separated, "ambiguous section headings preserve all saved areas without supplementing missing ones");
});

test("compact summaries allow validated building area without carrying descriptions or raw data", () => {
  const item = withSaleAreaDisplay({ ...base, saleDetails: { ...base.saleDetails, descriptionText: description } });
  const summary = compactSaleSummary(item);
  for (const [key, value] of Object.entries(areas)) assert.equal(summary[key], value);
  assert.equal(compactSaleSummary({ ...base, saleDetails: { buildingAreaM2: "134.05" } }).buildingAreaM2, 134.05);
  for (const value of [undefined, null, "", " ", true, false, [], [25], {}, Infinity, NaN, -1]) {
    assert.ok(!Object.hasOwn(compactSaleSummary({ ...base, saleDetails: { buildingAreaM2: value } }), "buildingAreaM2"));
  }
  assert.doesNotMatch(JSON.stringify(summary), /description|134평|중개대상물/);
  for (const land of [{ ...item, saleCategory: "land" }, { ...item, saleDetails: { ...item.saleDetails, scope: "land" } }]) {
    assert.ok(!Object.hasOwn(compactSaleSummary(land), "buildingAreaM2"), "land compact payload remains unchanged");
    assert.equal(compactSaleSummary(land).landAreaM2, areas.landAreaM2);
  }
});

test("existing provider fields already distinguish exclusive, land, gross and building areas", () => {
  const naver = naverSaleFields({ category: "상가", saleCategory: "commercial", saleRaw: { detailInfo: { spaceInfo: {
    exclusiveSpace: 60, landSpace: 200, floorSpace: 400, buildingSpace: 100
  } } } });
  assert.deepEqual(Object.fromEntries(["exclusiveAreaM2", "landAreaM2", "grossAreaM2", "buildingAreaM2"].map(key => [key, naver[key]])),
    { exclusiveAreaM2: 60, landAreaM2: 200, grossAreaM2: 400, buildingAreaM2: 100 });
  const gongsil = gongsilSaleFields({ list: { TypeView: "건물통", LandAreaM2: 200, YunAreaM2: 400 },
    detail: { getbilbases: { ArchArea: 100 } } });
  assert.equal(gongsil.saleDetails.buildingAreaM2, 100);
  assert.equal(gongsil.saleDetails.landAreaM2, 200);
  assert.equal(gongsil.saleDetails.grossAreaM2, 400);
});

test("master fallback receives the same read-only advertised area supplement", () => {
  const row = { id: "M-master-area", trade_type: "sale", sale_category: "house", room: "4층", sale_price: 100000,
    sale_details_json: JSON.stringify({ scope: "unit", descriptionText: description }) };
  const before = structuredClone(row);
  const item = masterFallbackOriginal(row);
  for (const [key, value] of Object.entries(areas)) assert.equal(item.saleSummary[key], value);
  assert.equal(item.room, "4층");
  assert.deepEqual(row, before);
});

test("real SQLite list/detail area parity is sale-only, source-local and performs no writes", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(value => value.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, migrations), "utf8"));
  const cases = [
    { name: "saved advertisement", details: { descriptionText: description }, raw: {}, expected: areas },
    { name: "raw advertisement", raw: { content: description }, expected: areas },
    { name: "blank description", details: { descriptionText: "\t\n\u00a0\u3000" }, raw: { content: description }, expected: areas },
    { name: "saved value wins", details: { landAreaM2: 200 }, raw: { content: description }, expected: { ...areas, landAreaM2: 200 } },
    { name: "saved description wins", details: { descriptionText: "건축면적 90㎡" }, raw: { content: description }, expected: { buildingAreaM2: 90 } },
    { name: "lease excluded", tradeType: "lease", raw: { content: description }, expected: {} },
    { name: "land excluded", saleCategory: "land", details: { scope: "land" }, raw: { content: description }, expected: {} },
    { name: "ambiguous area", raw: { content: "건평 40평" }, expected: {} },
    { name: "another source is not used", source: "네이버", raw: { content: description }, expected: {} }
  ];
  const snapshots = cases.map((item, i) => ({ ...base, source: item.source || base.source, originalId: `S-area-${i}`, propertyId: `M-area-${i}`,
    tradeType: item.tradeType || "sale", saleCategory: item.saleCategory || "house", saleDetails: { ...base.saleDetails, ...item.details } }));
  for (const [i, item] of cases.entries()) {
    const snapshot = snapshots[i];
    db.prepare("INSERT INTO listings(id,property_id,status,trade_type) VALUES(?,?,'active',?)").run(snapshot.propertyId, snapshot.propertyId, snapshot.tradeType);
    db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,trade_type,list_snapshot_json,raw_json) VALUES(?,?,?,?,1,?,?,?)")
      .run(snapshot.originalId, snapshot.propertyId, snapshot.source, String(i), snapshot.tradeType, JSON.stringify(snapshot),
        JSON.stringify({ ...item.raw, rawOnlyMarker: "DO_NOT_EXPOSE_AREA_RAW_DATA" }));
  }
  const storedState = () => JSON.stringify(db.prepare("SELECT * FROM listing_sources ORDER BY id").all());
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
  const env = { DB: { prepare } };
  const list = await handleD1GetAction(env, {}, { action: "unifiedListings" });
  assert.doesNotMatch(JSON.stringify(list), /DO_NOT_EXPOSE_AREA_RAW_DATA|descriptionText|raw_json/);
  for (const [i, item] of cases.entries()) {
    const snapshot = snapshots[i];
    const result = await handleD1GetAction(env, {}, { action: "unifiedListingDetail", propertyId: snapshot.propertyId });
    const original = result.originals[0];
    const summary = list.groups[snapshot.propertyId][0][list.fields.indexOf("saleSummary")] ?? "";
    assert.equal(JSON.stringify(summary), JSON.stringify(compactSaleSummary(original)), `summary parity: ${item.name}`);
    for (const key of ["exclusiveAreaM2", "landAreaM2", "grossAreaM2", "buildingAreaM2"]) {
      assert.equal(original.saleDetails[key], item.expected[key], `${item.name}: ${key}`);
    }
    for (const field of ["originalId", "propertyId", "source", "tradeType", "saleCategory", "room", "area", "salePrice", "deposit", "rent"]) {
      assert.equal(original[field], snapshot[field], `${item.name}: ${field}`);
    }
    assert.equal(original.saleDetails.scope, snapshot.saleDetails.scope);
    assert.equal(original.saleDetails.monthlyIncome, snapshot.saleDetails.monthlyIncome);
  }
  assert.equal(storedState(), before);
  assert.ok(queries.every(sql => /^\s*SELECT\b/.test(sql)));
});
