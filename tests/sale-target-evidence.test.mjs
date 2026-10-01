import assert from "node:assert/strict";
import test from "node:test";
import { compactSaleSummary } from "../cloudflare/src/d1-api.js";
import { saleExtentProvider, withSaleExtentDisplay } from "../cloudflare/src/sale-extent-display.js";
import { describedWholeMultifamily, descriptionSaleTarget } from "../cloudflare/src/sale-target-evidence.js";

const base = { source: "당근", originalId: "S-test", propertyId: "M-test", tradeType: "sale", saleCategory: "other",
  salePrice: 90000, room: "기존 원본 표기", area: 134, saleDetails: { scope: "unit", exclusiveAreaM2: 444.34 } };
const shown = (source, raw, patch = {}) => withSaleExtentDisplay({ ...base, source, ...patch }, saleExtentProvider(raw, source));
const naver = (type, floors, extra = {}) => shown("네이버", { realEstateTypeCode: type,
  saleRaw: { detailInfo: { spaceInfo: { floorInfo: floors } } }, ...extra });

test("official Naver residence enums identify non-unit whole or partial sales without guessing from category", () => {
  for (const code of ["C03", "C04", "C06", "D03", "D04", "D05", "E01", "E02", "Z00", "F01", "DDDGG", "GM", "GJCG"]) {
    const whole = naver(code, { residenceType: "2", targetFloor: "-" });
    assert.equal(whole.saleDetails.saleExtent, "whole_building", code);
    assert.equal(whole.saleDetails.floorScope, "whole_building", code);
    assert.equal(whole.saleDetails.scope, "unit");
    assert.equal(whole.room, base.room);
    assert.equal(naver(code, { residenceType: "1", targetFloor: "-" }).saleDetails.saleExtent, "unit", code);
  }
  for (const code of ["A01", "A02", "A04", "A05", "A06", "A07", "B01", "B02", "C01", "D01", "D02", "E04", "APT", "OPST"]) {
    assert.equal(naver(code, { residenceType: "2", targetFloor: "-" }).saleDetails.saleExtent, "unknown", code);
    assert.equal(naver(code, { residenceType: "1", floorType: "40", targetFloor: "-" }).saleDetails.saleExtent, "unknown", code);
    const privateUnit = naver(code, { residenceType: "1", floorType: "30", targetFloor: "-", totalFloor: "20" });
    assert.equal(privateUnit.saleDetails.saleExtent, "unit", code);
    assert.equal(privateUnit.saleDetails.saleTargetFloor, "비공개", code);
    assert.equal(privateUnit.saleDetails.saleSourceFloorText, "비공개 / 총 20층", code);
  }
  for (const code of ["X99", "", "E03"]) assert.equal(naver(code, { residenceType: "2" }).saleDetails.saleExtent, "unknown", code);
  assert.equal(naver("D04", { residenceType: "2", targetFloor: "3" }).saleDetails.saleExtent, "unknown");
  assert.equal(naver("D04", { floorType: "40", targetFloor: "-" }).saleDetails.saleExtent, "unknown");
});

test("Naver target labels come only from actual floors or explicit rooms and basement absence is not invented", () => {
  for (const [raw, expected] of [["3.0", "3층"], ["-1", "지하1층"], ["B2", "지하2층"], ["중", "중층"], ["고층", "고층"]]) {
    const item = naver("A04", { residenceType: "1", targetFloor: raw, totalFloor: "8" }, { roomInfo: "301호" });
    assert.equal(item.saleDetails.saleTargetFloor, expected);
    assert.equal(item.saleDetails.saleTargetRoom, "301호");
  }
  for (const targetFloor of ["-", null, "", "0.0", "3.5"]) {
    assert.equal(naver("C03", { residenceType: "1", targetFloor }).saleDetails.saleTargetFloor, undefined);
  }
  const alternate = shown("네이버", { realEstateTypeCode: "GM", saleRaw: { spaceInfo: { floorInfo: {
    targetFloor: "-", groundTotalFloor: "2", undergroundTotalFloor: "0" } } } });
  assert.equal(alternate.saleDetails.saleExtent, "whole_building");
  assert.equal(alternate.saleDetails.aboveGroundFloors, 2);
  assert.equal(alternate.saleDetails.belowGroundFloors, 0);
});

test("Gongsil bare and nested aliases identify unit type separately from disclosed floor and room", () => {
  for (const TypeView of ["APT", "APT분양권", "OFT", "OFT분양권", "빌라"]) {
    for (const Ho of ["로얄층", "문의", "", null]) {
      const item = shown("공실박스", { TypeView, Ho });
      assert.equal(item.saleDetails.saleExtent, "unit");
      assert.equal(item.saleDetails.saleTargetFloor, undefined);
      assert.equal(item.saleDetails.saleTargetRoom, undefined);
    }
  }
  const bare = shown("공실박스", { TypeView: "", ViewType: " ", LndType: "APT", Ho: "", BfHo: "301", Ff: "", BfFloor: 3 });
  assert.equal(bare.saleDetails.saleTargetRoom, "301호");
  assert.equal(bare.saleDetails.saleTargetFloor, "3층");
  assert.equal(shown("공실박스", { list: { TypeView: "APT", Ho: "저층" } }).saleDetails.saleTargetFloor, "저층");
  assert.equal(shown("공실박스", { TypeView: "건물통", Ho: "전체" }).saleDetails.saleExtent, "whole_building");
  assert.equal(shown("공실박스", { TypeView: "건물통", Ho: "301" }).saleDetails.saleExtent, "unknown");
  assert.equal(shown("공실박스", { TypeView: "상가", Ho: "문의" }).saleDetails.saleExtent, "unknown");
});

test("explicit advertised whole or individual sale outranks Daangn false defaults but not contradictions", () => {
  const raw = { isEntireBuilding: false, floor: "3.0", salesTypeV3: { type: "STORE" } };
  for (const content of ["본 매물은 상가건물 전체매매입니다.", "건물 전체를 매매합니다", "건물 전체(1~2층) 매매", "다가구 통 매매", "전체 건물 매매", "통건물 매매"]) {
    assert.equal(shown("당근", { ...raw, content }).saleDetails.saleExtent, "whole_building", content);
  }
  for (const [content, room, floor] of [["301호만 매매합니다", "301호", "3층"], ["301호만 판매합니다", "301호", "3층"], ["상가 2층 전체 매매", undefined, "2층"], ["구분매매 대상은 401호입니다", "401호", "3층"], ["1~2층 전체매매", undefined, "1~2층"]]) {
    const item = shown("당근", { ...raw, content });
    assert.equal(item.saleDetails.saleExtent, "unit", content);
    assert.equal(item.saleDetails.saleTargetRoom, room, content);
    assert.equal(item.saleDetails.saleTargetFloor, floor, content);
  }
  for (const content of ["건물 통매매 아님", "건물 통매매 구합니다", "건물 지분매매", "건물 전체 매매 (지분 50%)", "건물 전체 매매 (지분 50.0%)", "지분 1/2 매매, 건물 전체 매매", "건물 전체매매. 301호만 매매합니다."]) {
    assert.equal(shown("당근", { ...raw, content }).saleDetails.saleExtent, "unknown", content);
  }
  assert.equal(shown("당근", { ...raw, content: "건물 전체매매입니다. 통매매 전문 상담." }).saleDetails.saleExtent, "whole_building");
  assert.equal(shown("당근", { ...raw, content: "건물 통매매 전문" }).saleDetails.saleExtent, "unit");
  assert.equal(shown("당근", { ...raw, content: "건물 전체매매입니다. 지분매매 아닙니다." }).saleDetails.saleExtent, "whole_building");
  assert.equal(shown("당근", { ...raw, content: "지분매매가 아닌 전체 건물매매입니다" }).saleDetails.saleExtent, "whole_building");
  assert.equal(shown("당근", { ...raw, content: "매매가 1억, 대지지분 10평" }).saleDetails.saleExtent, "unit");
  assert.equal(shown("당근", { ...raw, isEntireBuilding: true, content: "301호만 매매합니다" }).saleDetails.saleExtent, "unknown");
  for (const content of ["건물 전체 임대", "일부 임대 중", "3층 건물입니다", "다가구 전문"]) {
    assert.notEqual(shown("당근", { ...raw, content }).saleDetails.saleExtent, "whole_building", content);
  }
  assert.equal(shown("당근", { ...raw, addressInfo: "다가구 통매매", content: "" }).saleDetails.saleExtent, "whole_building");
});

test("Daangn aliases do not require a public floor and unknown scope still preserves uninterpreted source floors", () => {
  for (const type of ["OPEN_ONE_ROOM", "SPLIT_ONE_ROOM"]) {
    for (const floor of [null, "4.0"]) {
      const item = shown("당근", { salesTypeV3: { type }, isEntireBuilding: false, floor, topFloor: 4 });
      assert.equal(item.saleDetails.saleExtent, "unit");
      assert.equal(item.saleDetails.saleTargetFloor, floor ? "4층" : undefined);
    }
  }
  const house = shown("당근", { salesTypeV3: { type: "HOUSE" }, isEntireBuilding: false, floor: "4.0", topFloor: "4.0",
    addressInfo: "옥상태양광설치 월수입450만원", roomCnt: 18, bathroomCnt: 17, content: "" });
  assert.equal(house.saleDetails.saleExtent, "unknown");
  assert.equal(house.saleDetails.saleTargetFloor, undefined);
  assert.equal(house.saleDetails.saleSourceFloorText, "4층 / 총 4층");
  assert.equal(compactSaleSummary(house).saleSourceFloorText, "4층 / 총 4층");
});

test("actual multifamily advertisement structure is display-only evidence with no stored financial or area rewrites", () => {
  const content = "🔶 세대수 - 15세대\n🔶 대지면적 - 약 67평 (223.5㎡)\n🔶 건축면적 - 약 40평 (134.05㎡)\n🔶 연면적 - 약 134평 (444.34㎡)\n🔶 총층수 - 5층\n원룸촌에 위치한 다가구주택입니다.\n원룸, 1.5룸, 투룸 등으로 구성되어 있고, 내부 풀옵션으로 들어가있습니다.";
  assert.deepEqual(describedWholeMultifamily(content), { wholeMultifamily: true, totalFloors: 5 });
  assert.deepEqual(describedWholeMultifamily(content.replace("원룸촌에 위치한 다가구주택입니다.", "중개대상물 종류 - 다가구주택")), { wholeMultifamily: true, totalFloors: 5 });
  const input = structuredClone(base), before = structuredClone(input);
  const item = withSaleExtentDisplay(input, saleExtentProvider({ content, salesTypeV3: { type: "TWO_ROOM" }, isEntireBuilding: false, floor: null, topFloor: 5 }, "당근"));
  assert.equal(item.saleDetails.saleExtent, "whole_building");
  assert.equal(item.saleDetails.totalFloors, 5);
  assert.equal(item.saleDetails.scope, "unit");
  assert.equal(item.saleDetails.exclusiveAreaM2, 444.34);
  assert.equal(item.salePrice, base.salePrice);
  assert.equal(item.area, base.area);
  assert.equal(item.originalId, base.originalId);
  assert.deepEqual(input, before);
  for (const description of [content.replace("🔶 세대수 - 15세대", ""), content.replace("연면적 - 약 134평 (444.34㎡)", "연면적 - 100㎡"), content + "\n총층수 - 6층"]) {
    assert.notEqual(describedWholeMultifamily(description).wholeMultifamily, true);
  }
  for (const partial of ["각 호실별 매매", "세대별 분리매매", "건물 일부 지분만 매매", "호실별로 개별 매매", "각 세대별 매매", "건물 일부만 매매", "건물 1층 일부 매매", "건물 절반만 매매"]) {
    for (const isEntireBuilding of [false, true]) {
      const item = shown("당근", { content: content + "\n" + partial, salesTypeV3: { type: "TWO_ROOM" }, isEntireBuilding });
      assert.equal(item.saleDetails.saleExtent, "unknown", `${isEntireBuilding}: ${partial}`);
    }
  }
  assert.equal(shown("당근", { content: content + "\n301호만 판매합니다", salesTypeV3: { type: "TWO_ROOM" }, isEntireBuilding: false }).saleDetails.saleExtent, "unit");
  assert.equal(descriptionSaleTarget("다가구 통매매 전문").saleExtent, undefined);
});

test("building scale and broker promotion never override explicit provider scope", () => {
  const content = "정원있는 2층집 ▶ 대지 100평에 지하1층 지상2층 매매 ▶ 복층형 2층집에 1층 방3개";
  const whole = { salesTypeV3: { type: "HOUSE" }, isEntireBuilding: true, content };
  assert.equal(descriptionSaleTarget(content).saleExtent, undefined);
  assert.equal(shown("당근", whole).saleDetails.saleExtent, "whole_building");
  assert.equal(shown("당근", { ...whole, content: content + "\n301호만 매매합니다" }).saleDetails.saleExtent, "unknown");
  assert.equal(shown("당근", { ...whole, content: content + "\n2층만 매매합니다" }).saleDetails.saleExtent, "unknown");
  assert.equal(shown("당근", { ...whole, isEntireBuilding: false }, { saleCategory: "house" }).saleDetails.saleExtent, "unknown");
  for (const content of ["2층 매매, 사무실 전문 부동산", "상가 2층 매매, 채팅주시면 상담 어렵습니다", "상가 매매 원스톱 상담 가능"]) {
    const unit = shown("당근", { salesTypeV3: { type: "STORE" }, isEntireBuilding: false, floor: "2.0", content });
    assert.equal(unit.saleDetails.saleExtent, "unit", content);
    assert.equal(unit.saleDetails.saleTargetFloor, "2층", content);
  }
});
