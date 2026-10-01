import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { compactSaleSummary, handleD1GetAction, masterFallbackOriginal } from "../cloudflare/src/d1-api.js";
import { saleExtentProvider, withSaleExtentDisplay } from "../cloudflare/src/sale-extent-display.js";
import { daangnSaleFields } from "../cloudflare/src/sale-fields.js";

const base = { originalId: "source-test", source: "네이버", tradeType: "sale", saleCategory: "building",
  room: "지하1층", salePrice: 50000, area: 80, saleDetails: { scope: "unit", grossAreaM2: 264, totalDeposit: 0, monthlyIncome: 100 } };
const floorInfo = { targetFloor: "-", groundTotalFloor: "4", undergroundTotalFloor: "B1" };
const wholeDescription = "매물유형: 다가구\n대지면적: 100㎡\n연면적: 300㎡\n건물층수: 총3층\n총6세대";
const read = (source, raw, patch = {}) => withSaleExtentDisplay({ ...base, source,
  saleCategory: source === "당근" && raw.salesTypeV3?.type === "STORE" ? "commercial" : base.saleCategory,
  saleDetails: { ...base.saleDetails, descriptionText: raw.content || "" }, ...patch }, saleExtentProvider(raw, source));

test("Naver extent follows raw range or unit evidence instead of legacy scope and room", () => {
  const whole = read("네이버", { realEstateTypeCode: "D04", saleRaw: { detailInfo: { spaceInfo: { floorInfo } } } });
  assert.equal(whole.saleDetails.saleExtent, "whole_building");
  assert.equal(whole.saleDetails.scope, "unit");
  assert.equal(whole.room, "지하1층");
  for (const targetFloor of ["3", "3.0", "B2", "-1", "-1.00"]) {
    const unit = read("네이버", { realEstateTypeCode: "C03", saleRaw: { detailInfo: { spaceInfo: { floorInfo: { targetFloor, totalFloor: "5" } } } } },
      { saleDetails: { ...base.saleDetails, scope: "whole_building" } });
    assert.equal(unit.saleDetails.saleExtent, "unit");
    assert.equal(unit.saleDetails.scope, "whole_building");
  }
  for (const [code, floors] of [["D04", { targetFloor: "-" }], ["X99", floorInfo], ["D02", floorInfo],
    ["D04", { ...floorInfo, targetFloor: "" }], ["D04", { ...floorInfo, groundTotalFloor: 0 }]]) {
    assert.equal(read("네이버", { realEstateTypeCode: code, saleRaw: { detailInfo: { spaceInfo: { floorInfo: floors } } } }).saleDetails.saleExtent, "unknown");
  }
  for (const realEstateTypeCode of ["A01", "A02", "A05", "C01", "D01", "D02", "E04", "B01", "B02"]) {
    for (const targetFloor of ["저", "중", "고", "저층", "중층", "고층"]) {
      assert.equal(read("네이버", { realEstateTypeCode, saleRaw: { detailInfo: { spaceInfo: { floorInfo: { targetFloor, totalFloor: "20" } } } } }).saleDetails.saleExtent, "unit");
    }
  }
  for (const realEstateTypeCode of ["C03", "D03", "D04", "D05", "E02", "E03", "F01", "X99"]) {
    assert.equal(read("네이버", { realEstateTypeCode, saleRaw: { detailInfo: { spaceInfo: { floorInfo: { targetFloor: "중", totalFloor: "20" } } } } }).saleDetails.saleExtent, "unknown");
  }
});

test("Gongsil whole and unit evidence require explicit provider fields and conflicts stay unknown", () => {
  for (const TypeView of ["건물통", "통건물", "건물전체"]) {
    assert.equal(read("공실박스", { list: { TypeView, Ho: "전체", Ff: 3 } }).saleDetails.saleExtent, "whole_building");
    assert.equal(read("공실박스", { list: { TypeView, Ho: "301" } }).saleDetails.saleExtent, "unknown");
  }
  assert.equal(read("공실박스", { list: { TypeView: "다가구", Ho: "전체" } }).saleDetails.saleExtent, "whole_building");
  for (const list of [{ TypeView: "상가", Ho: "301호" }, { TypeView: "아파트", Ho: "101동 502" }, { TypeView: "사무실", Ff: -1 }, { TypeView: "APT", Ho: "1층", Ff: 1 }]) {
    assert.equal(read("공실박스", { list }).saleDetails.saleExtent, "unit");
  }
  for (const TypeView of ["APT", "APT분양권", "OFT", "OFT분양권"]) {
    assert.equal(read("공실박스", { list: { TypeView, Ho: "301" } }).saleDetails.saleExtent, "unit");
  }
  for (const list of [{ TypeView: "상가", Ho: "전체" }, { Ho: "전체" }, { TypeView: "빌딩", Ff: 3 }, {}, { TypeView: "상가", Ho: "0", Ff: 0 }]) {
    assert.equal(read("공실박스", { list }).saleDetails.saleExtent, "unknown");
  }
});

test("Daangn whole-description evidence outranks its unreliable false default", () => {
  assert.equal(daangnSaleFields({ content: wholeDescription }).descriptionText, wholeDescription);
  assert.equal(read("당근", { isEntireBuilding: true, floor: 3, topFloor: 3 }).saleDetails.saleExtent, "whole_building");
  assert.equal(read("당근", { isEntireBuilding: false, floor: 3, salesTypeV3: { type: "TWO_ROOM" }, content: wholeDescription }).saleDetails.saleExtent, "whole_building");
  assert.equal(read("당근", { isEntireBuilding: false, floor: 3, salesTypeV3: { type: "STORE" } }).saleDetails.saleExtent, "unit");
  for (const floor of ["3.0", "4.00", "-1.0"]) {
    assert.equal(read("당근", { isEntireBuilding: false, floor, salesTypeV3: { type: "STORE" } }).saleDetails.saleExtent, "unit");
  }
  for (const floor of ["0.0", "-0.0", "3.5"]) {
    assert.equal(read("당근", { isEntireBuilding: false, floor, salesTypeV3: { type: "STORE" } }).saleDetails.saleExtent, "unknown");
  }
  for (const patch of [{ saleCategory: "multifamily" }, { saleDetails: { scope: "whole_building" } },
    { saleDetails: { scope: "unit", descriptionCategory: "multifamily" } }]) {
    assert.equal(read("당근", { isEntireBuilding: false, floor: "3.0", salesTypeV3: { type: "TWO_ROOM" } },
      { saleCategory: "other", ...patch }).saleDetails.saleExtent, "unknown");
  }
  for (const raw of [{ isEntireBuilding: false, topFloor: 3 }, { isEntireBuilding: "true" },
    { isEntireBuilding: false, floor: 3 }, { floor: 3, salesTypeV3: { type: "STORE" } },
    { isEntireBuilding: false, floor: 3, isAmbiguousFloor: true, salesTypeV3: { type: "STORE" } },
    { isEntireBuilding: false, salesTypeV3: { type: "TWO_ROOM" }, content: "다가구 전문" }]) {
    assert.equal(read("당근", raw).saleDetails.saleExtent, "unknown");
  }
});

test("direct-sale defaults, canonical rooms and stale extent values are never evidence", () => {
  const item = { ...base, source: "직접등록", room: "301호", saleCategory: "apartment",
    saleDetails: { scope: "whole_building", saleExtent: "whole_building", saleExtentEvidence: "old", totalDeposit: 0 } };
  const before = structuredClone(item);
  const shown = withSaleExtentDisplay(item);
  assert.equal(shown.saleDetails.saleExtent, "unknown");
  assert.equal(shown.saleDetails.scope, "whole_building");
  assert.deepEqual(item, before);
  const fallback = masterFallbackOriginal({ id: "M-direct", main_source: "직접등록", trade_type: "sale", sale_category: "apartment",
    room: "301호", sale_price: 50000, sale_details_json: JSON.stringify(item.saleDetails) });
  assert.equal(fallback.saleDetails.saleExtent, "unknown");
  assert.equal(fallback.saleSummary.saleExtent, "unknown");
  assert.equal(fallback.room, "301호");
});

test("extent is excluded from land and lease and compact evidence is bounded", () => {
  const known = { ...base, saleDetails: { ...base.saleDetails, saleExtent: "unit", saleExtentEvidence: "x".repeat(200) } };
  assert.equal(compactSaleSummary(known).saleExtent, "unit");
  assert.equal(compactSaleSummary(known).saleExtentEvidence.length, 100);
  for (const item of [{ ...known, tradeType: "lease" }, { ...known, saleCategory: "land" }]) {
    assert.equal(withSaleExtentDisplay(item), item);
    assert.ok(!Object.hasOwn(compactSaleSummary(item), "saleExtent"));
  }
});

test("real SQLite narrow projections preserve boolean presence and list/detail extent parity without writes", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(value => value.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, migrations), "utf8"));
  const cases = [
    ["네이버", { realEstateTypeCode: "D04", saleRaw: { detailInfo: { spaceInfo: { floorInfo } } } }, "whole_building"],
    ["네이버", { realEstateTypeCode: "E02", saleRaw: { detailInfo: { spaceInfo: { floorInfo: { residenceType: "2", groundTotalFloor: "2", undergroundTotalFloor: "0", targetFloor: "-" } } } } }, "whole_building"],
    ["네이버", { realEstateTypeCode: "A07", roomInfo: "301호", saleRaw: { detailInfo: { spaceInfo: { floorInfo: { residenceType: "1", floorType: "30", targetFloor: "-", totalFloor: "5" } } } } }, "unit"],
    ["네이버", { realEstateTypeCode: "GM", saleRaw: { spaceInfo: { floorInfo } } }, "whole_building"],
    ["공실박스", { list: { TypeView: "건물통", Ho: "전체" } }, "whole_building"],
    ["공실박스", { list: { TypeView: "상가", Ho: "301" } }, "unit"],
    ["공실박스", { TypeView: "건물통", Ho: "전체" }, "whole_building"],
    ["공실박스", { TypeView: "", ViewType: " ", LndType: "APT", Ho: "", BfHo: "301", Ff: "", BfFloor: 3 }, "unit"],
    ["공실박스", { list: { TypeView: "", ViewType: "", LndType: "OFT", Ho: "문의" } }, "unit"],
    ["당근", { isEntireBuilding: true, floor: 3 }, "whole_building"],
    ["당근", { isEntireBuilding: false, floor: "3.0", salesTypeV3: { type: "STORE" } }, "unit"],
    ["당근", { floor: 3, salesTypeV3: { type: "STORE" } }, "unknown"],
    ["당근", { isEntireBuilding: "false", floor: 3, salesTypeV3: { type: "STORE" } }, "unknown"],
    ["당근", { isEntireBuilding: false, floor: 3, salesTypeV3: { type: "TWO_ROOM" }, content: wholeDescription }, "whole_building"],
    ["당근", { isEntireBuilding: false, floor: "3.0", salesTypeV3: { type: "TWO_ROOM" }, content: wholeDescription }, "whole_building", true],
    ["당근", { isEntireBuilding: false, floor: null, topFloor: 4, salesTypeV3: { type: "SPLIT_ONE_ROOM" } }, "unit"],
    ["당근", { isEntireBuilding: false, floor: "4.0", topFloor: "4.0", salesTypeV3: { type: "HOUSE" }, addressInfo: "옥상태양광설치 월수입450만원" }, "unknown"],
    ["당근", { isEntireBuilding: false, floor: "3.0", salesTypeV3: { type: "STORE" }, addressInfo: "건물 전체 매매", content: "현재 일부 임대 중" }, "whole_building", true],
    ["당근", { isEntireBuilding: false, floor: "3.0", salesTypeV3: { type: "STORE" }, content: "1~2층 전체매매" }, "unit", true],
    ["당근", { isEntireBuilding: true, salesTypeV3: { type: "STORE" }, content: "각 호실별 매매" }, "unknown", true],
    ["당근", { isEntireBuilding: false, topFloor: 5, salesTypeV3: { type: "TWO_ROOM" }, content: "중개대상물 종류 - 다가구주택\n세대수 - 15세대\n대지면적 - 약 67평 (223.5㎡)\n연면적 - 약 134평 (444.34㎡)\n총층수 - 5층" }, "whole_building", true],
    ["당근", { isEntireBuilding: true, salesTypeV3: { type: "HOUSE" }, content: "정원있는 2층집 ▶ 대지 100평에 지하1층 지상2층 매매 ▶ 복층형 2층집에 1층 방3개" }, "whole_building", true],
    ["당근", { isEntireBuilding: false, floor: "2.0", salesTypeV3: { type: "STORE" }, content: "상가 2층 매매, 사무실 전문 부동산. 채팅주시면 상담 어렵습니다. 원스톱 상담 가능" }, "unit", true],
    ["당근", { isEntireBuilding: false, floor: true, topFloor: true, salesTypeV3: { type: "STORE" } }, "unknown"],
    ["당근", { isEntireBuilding: false, floor: false, topFloor: false, salesTypeV3: { type: "STORE" } }, "unknown"],
    ["당근", { isEntireBuilding: false, floor: 3, salesTypeV3: { type: "STORE" }, content: "건물 전체매매" }, "whole_building", "\n\t"],
    ["당근", { isEntireBuilding: false, floor: 3, salesTypeV3: { type: "STORE" }, content: "건물 전체매매" }, "whole_building", "\u00a0\u3000"],
    ["공실박스", { TypeView: false, ViewType: "\t\n", LndType: "상가", Ho: "301", Ff: true }, "unit"]
  ];
  for (const [index, [source, raw, , omitDescription]] of cases.entries()) {
    db.prepare("INSERT INTO listings(id,property_id,status,trade_type) VALUES(?,?,'active','sale')").run(`M-${index}`, `M-${index}`);
    db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,trade_type,list_snapshot_json,raw_json) VALUES(?,?,?,?,1,'sale',?,?)")
      .run(`S-${index}`, `M-${index}`, source, String(index), JSON.stringify({ ...base, source, originalId: `S-${index}`,
        saleCategory: source === "당근" && raw.salesTypeV3?.type === "STORE" ? "commercial"
          : ["SPLIT_ONE_ROOM", "OPEN_ONE_ROOM"].includes(raw.salesTypeV3?.type) ? "one_room" : base.saleCategory,
        saleDetails: { ...base.saleDetails, descriptionText: typeof omitDescription === "string" ? omitDescription
          : omitDescription ? undefined : raw.content || "" } }), JSON.stringify(raw));
  }
  db.prepare("INSERT INTO listings(id,property_id,status,trade_type) VALUES('M-lease','M-lease','active','lease')").run();
  db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,trade_type,list_snapshot_json,raw_json) VALUES('S-lease','M-lease','당근','lease',1,'lease',?,?)")
    .run(JSON.stringify({ ...base, source: "당근", tradeType: "lease" }), JSON.stringify({ addressInfo: "임대 광고", content: "긴 임대 설명".repeat(4000) }));
  const before = JSON.stringify(db.prepare("SELECT list_snapshot_json, raw_json FROM listing_sources ORDER BY id").all());
  const queries = [];
  const projectedRows = [];
  const prepare = (sql, values = []) => {
    queries.push(sql);
    const indexes = [];
    const query = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return { bind(...bindings) { return prepare(sql, bindings); }, async all() {
      const results = db.prepare(query).all(...args());
      if (sql.includes("daangn_sale_extent_json")) projectedRows.push(...results);
      return { results };
    },
      async first() { return db.prepare(query).get(...args()) || null; } };
  };
  const env = { DB: { prepare } };
  const list = await handleD1GetAction(env, {}, { action: "unifiedListings" });
  assert.equal(projectedRows.find(row => row.listing_id === "M-lease").daangn_sale_extent_json, null,
    "lease rows never project advertisement text into the sale-only evidence adapter");
  for (const [index, [, , expected]] of cases.entries()) {
    const detail = await handleD1GetAction(env, {}, { action: "unifiedListingDetail", propertyId: `M-${index}` });
    const summary = list.groups[`M-${index}`][0][list.fields.indexOf("saleSummary")];
    assert.equal(summary.saleExtent, expected, `list ${index}`);
    assert.equal(detail.originals[0].saleDetails.saleExtent, expected, `detail ${index}`);
    assert.deepEqual(summary, compactSaleSummary(detail.originals[0]), `list/detail summary parity ${index}`);
    assert.equal(detail.originals[0].room, base.room);
    assert.equal(detail.originals[0].saleDetails.scope, base.saleDetails.scope);
    assert.equal(detail.originals[0].salePrice, base.salePrice);
    assert.equal(detail.originals[0].area, base.area);
    assert.equal(detail.originals[0].saleDetails.monthlyIncome, base.saleDetails.monthlyIncome);
  }
  assert.equal(JSON.stringify(db.prepare("SELECT list_snapshot_json, raw_json FROM listing_sources ORDER BY id").all()), before);
  assert.ok(queries.every(sql => /^\s*SELECT\b/.test(sql)));
  const projection = queries.find(sql => sql.includes("gongsil_sale_extent_json"));
  assert.match(projection, /substr\(json_extract\(raw_json, '\$\.content'\), 1, 12000\)/);
  assert.doesNotMatch(projection, /\bSELECT raw_json\b/);
  assert.doesNotMatch(JSON.stringify(list), /descriptionText|wholeMultifamily|매물유형: 다가구/);
});
