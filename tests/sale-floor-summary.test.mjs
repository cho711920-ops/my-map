import assert from "node:assert/strict";
import test from "node:test";
import { compactSaleSummary, handleD1GetAction } from "../cloudflare/src/d1-api.js";
import { withNaverSaleFloorDisplay } from "../cloudflare/src/sale-floor-display.js";

const floorKeys = ["aboveGroundFloors", "belowGroundFloors", "totalFloors"];
const unknownExtent = { saleExtent: "unknown", saleExtentEvidence: "원본 매매범위 근거 부족" };
const building = (floors = {}) => ({
  source: "네이버", tradeType: "sale", saleCategory: "building", salePrice: 120000,
  room: "전체", saleDetails: { scope: "whole_building", ...floors }
});

test("compact sale floors retain source scope and explicit no-basement evidence", () => {
  const item = building({ aboveGroundFloors: "5", belowGroundFloors: 0, totalFloors: 5 });
  const before = structuredClone(item);
  assert.deepEqual(compactSaleSummary(item), {
    ...unknownExtent, scope: "whole_building", aboveGroundFloors: 5, belowGroundFloors: 0, totalFloors: 5
  });
  assert.deepEqual(item, before);
  assert.deepEqual(compactSaleSummary({ ...item, saleCategory: "commercial", room: "3층",
    saleDetails: { ...item.saleDetails, scope: "unit", belowGroundFloors: 1 } }), {
    ...unknownExtent, scope: "unit", aboveGroundFloors: 5, belowGroundFloors: 1, totalFloors: 5
  });
});

test("missing, fractional and invalid floors never become zero or a floor range", () => {
  for (const value of [undefined, null, "", " ", "-", -1, 1.5, "1.5", Infinity, NaN, true, false, [], [5], {}]) {
    const summary = compactSaleSummary(building(Object.fromEntries(floorKeys.map(key => [key, value]))));
    for (const key of floorKeys) assert.ok(!(key in summary), `${key}: ${String(value)}`);
  }
  assert.deepEqual(compactSaleSummary(building({ aboveGroundFloors: 0, belowGroundFloors: "0", totalFloors: 0 })), {
    ...unknownExtent, scope: "whole_building", belowGroundFloors: 0
  });
  assert.deepEqual(compactSaleSummary(building({ totalFloors: 4 })), { ...unknownExtent, scope: "whole_building", totalFloors: 4 });
});

test("land and lease listings do not acquire building floor summaries", () => {
  const item = building({ aboveGroundFloors: 5, belowGroundFloors: 1, totalFloors: 6 });
  assert.equal(compactSaleSummary({ ...item, tradeType: "lease" }), "");
  for (const land of [{ ...item, saleCategory: "land" },
    { ...item, saleDetails: { ...item.saleDetails, scope: "land" } }]) {
    const summary = compactSaleSummary(land);
    for (const key of floorKeys) assert.ok(!(key in summary));
  }
});

test("initial unified list carries validated saved floor data without individual detail requests", async () => {
  const item = building({ aboveGroundFloors: 5, belowGroundFloors: 0, totalFloors: 5 });
  const env = { DB: { prepare(sql) {
    return { bind() { return this; }, async all() {
      return { results: sql.includes("json_extract(raw_json")
        ? [{ rowid: 1, listing_id: "M-floor", list_snapshot_json: JSON.stringify(item) }] : [] };
    } };
  } } };
  const result = await handleD1GetAction(env, {}, { action: "unifiedListings" });
  const row = result.groups["M-floor"][0];
  assert.deepEqual(row[result.fields.indexOf("saleSummary")], {
    ...unknownExtent, scope: "whole_building", aboveGroundFloors: 5, belowGroundFloors: 0, totalFloors: 5
  });
  assert.ok(!result.fields.includes("saleDetails"));
  assert.equal(row[result.fields.indexOf("room")], "전체");
  assert.equal(row[result.fields.indexOf("salePrice")], 120000);
});

const legacyNaver = {
  originalId: "naver-floor", source: "네이버", tradeType: "sale", saleCategory: "building", salePrice: 120000,
  room: "지하1층", area: 48, saleDetails: { scope: "unit", grossAreaM2: 160, totalDeposit: 2000, monthlyIncome: 100 }
};
const providerFloors = {
  targetFloor: "-", groundTotalFloor: "3", undergroundTotalFloor: "B1", floorType: "00", residenceType: "2"
};

test("legacy Naver building ranges are read-only display evidence, not changes to physical scope", () => {
  const before = structuredClone(legacyNaver);
  for (const propertyType of ["C03", "C04", "C06", "D03", "D04", "D05"]) {
    const result = withNaverSaleFloorDisplay(legacyNaver, { propertyType, floorInfo: providerFloors });
    assert.deepEqual(result, { ...legacyNaver, saleDetails: { ...legacyNaver.saleDetails,
      floorScope: "whole_building", aboveGroundFloors: 3, belowGroundFloors: 1 } });
    assert.deepEqual(compactSaleSummary(result), { ...unknownExtent, scope: "unit", grossAreaM2: 160,
      totalDeposit: 2000, monthlyIncome: 100, floorScope: "whole_building", aboveGroundFloors: 3, belowGroundFloors: 1 });
  }
  assert.deepEqual(legacyNaver, before);
});

test("Naver house and mixed-house unit targets retain unit display with only the declared total", () => {
  for (const propertyType of ["C03", "D05"]) {
    const result = withNaverSaleFloorDisplay(legacyNaver, { propertyType,
      floorInfo: { targetFloor: "4", totalFloor: "5", groundTotalFloor: "-", undergroundTotalFloor: "-", residenceType: "1" } });
    assert.equal(result.saleDetails.floorScope, "unit");
    assert.equal(result.saleDetails.totalFloors, 5);
    assert.ok(!("aboveGroundFloors" in result.saleDetails));
    assert.ok(!("belowGroundFloors" in result.saleDetails));
    assert.equal(result.room, legacyNaver.room);
    assert.equal(result.saleDetails.scope, "unit");
  }
});

test("provider basement markers and absence remain distinct, without category or enum guesses", () => {
  for (const [value, expected] of [["B14", 14], ["0", 0], ["-", undefined], [null, undefined], ["", undefined], [-1, undefined]]) {
    const result = withNaverSaleFloorDisplay(legacyNaver, { propertyType: "D04",
      floorInfo: { ...providerFloors, undergroundTotalFloor: value } });
    assert.equal(result.saleDetails.belowGroundFloors, expected);
  }
  for (const patch of [{ propertyType: "D02" }, { propertyType: "building" }, { propertyType: "" },
    { floorInfo: { ...providerFloors, residenceType: undefined, targetFloor: "" } },
    { floorInfo: { ...providerFloors, residenceType: undefined, groundTotalFloor: "-" } }]) {
    const result = withNaverSaleFloorDisplay(legacyNaver, { propertyType: "D04", floorInfo: providerFloors, ...patch });
    assert.ok(!("floorScope" in result.saleDetails));
  }
  const declared = withNaverSaleFloorDisplay({ ...legacyNaver,
    saleDetails: { ...legacyNaver.saleDetails, aboveGroundFloors: 6, belowGroundFloors: 0 } },
  { propertyType: "D04", floorInfo: providerFloors });
  assert.equal(declared.saleDetails.aboveGroundFloors, 6);
  assert.equal(declared.saleDetails.belowGroundFloors, 0);
});

test("floor adapter excludes other sources, lease and land and leaves the input unchanged", () => {
  for (const patch of [{ source: "당근" }, { tradeType: "lease" }, { saleCategory: "land" },
    { saleDetails: { scope: "land" } }]) {
    const item = { ...legacyNaver, ...patch };
    assert.equal(withNaverSaleFloorDisplay(item, { propertyType: "D04", floorInfo: providerFloors }), item);
  }
});

test("list and detail responses recover the same legacy Naver floors using only local source data", async () => {
  const raw = { realEstateTypeCode: "D04", category: "D04", floorInfo: "-1/3",
    saleRaw: { detailInfo: { spaceInfo: { floorInfo: providerFloors } } } };
  let listProjection = "";
  const env = { DB: { prepare(sql) {
    return { bind() { return this; }, async all() {
      if (sql.includes("naver_floor_info_json")) {
        listProjection = sql;
        return { results: [{ rowid: 1, listing_id: "M-old-floor", source: "네이버",
          list_snapshot_json: JSON.stringify(legacyNaver), naver_floor_info_json: JSON.stringify(providerFloors), naver_property_type: "D04" }] };
      }
      if (sql.includes("SELECT id, source, list_snapshot_json, raw_json")) return { results: [{ id: "naver-floor", source: "네이버",
        list_snapshot_json: JSON.stringify(legacyNaver), raw_json: JSON.stringify(raw) }] };
      return { results: [] };
    } };
  } } };
  const list = await handleD1GetAction(env, {}, { action: "unifiedListings" });
  const detail = await handleD1GetAction(env, {}, { action: "unifiedListingDetail", propertyId: "M-old-floor" });
  const summary = list.groups["M-old-floor"][0][list.fields.indexOf("saleSummary")];
  assert.deepEqual(summary, compactSaleSummary(detail.originals[0]));
  assert.equal(summary.floorScope, "whole_building");
  assert.equal(summary.aboveGroundFloors, 3);
  assert.equal(summary.belowGroundFloors, 1);
  assert.equal(detail.originals[0].room, "지하1층");
  assert.equal(detail.originals[0].saleDetails.scope, "unit");
  assert.equal(detail.originals[0].salePrice, 120000);
  assert.equal(detail.originals[0].saleDetails.monthlyIncome, 100);
  assert.ok(!list.fields.includes("saleRaw"));
  assert.match(listProjection, /json_extract\(raw_json, '\$\.saleRaw\.detailInfo\.spaceInfo\.floorInfo'\)/);
  assert.doesNotMatch(listProjection, /\bSELECT\s+(?:[^\n]+,\s*)?raw_json\s*(?:,|FROM)/i);
});
