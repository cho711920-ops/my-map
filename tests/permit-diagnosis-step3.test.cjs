const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const index = read("index.html");
const css = read("css/permit-diagnosis-v1.css");
const ui = read("js/permit-diagnosis-ui.js");
const adapterSource = read("js/building-data-adapter.js");
const step2 = read("js/permit-diagnosis-step2.js");

assert(index.includes("building-data-adapter.js"), "건축물대장 어댑터를 연결해야 합니다.");
assert(ui.includes("permitPublicDataBtnV1"), "공공데이터 조회 버튼이 필요합니다.");
assert(ui.includes("permitPublicDataResultsV1"), "공공데이터 결과 영역이 필요합니다.");
assert(css.includes(".permit-industry-detail-host-v1"), "상세진단 전체너비 영역이 필요합니다.");
assert(step2.includes('status === "YES" ? "충족"'), "확인 대신 충족을 표시해야 합니다.");
assert(step2.includes("permit:public-data-v1"), "공공데이터 자동판정 연동이 필요합니다.");

const context = {
  window: {
    PermitIndustryCandidateSelectorV1: {
      escapeHtml: (value) => String(value == null ? "" : value)
    }
  },
  URLSearchParams,
  fetch: () => Promise.reject(new Error("not used"))
};
vm.createContext(context);
vm.runInContext(adapterSource, context);
const adapter = context.window.PermitBuildingDataAdapterV1;

const sample = {
  buildings: [{
    managementKey: "B1",
    mainUse: "근린생활시설",
    floors: [{ floorNo: 2, floorName: "2층", mainUse: "제2종근린생활시설", area: 160 }],
    zones: [{ name: "일반상업지역" }]
  }],
  units: [{
    managementKey: "B1",
    roomName: "201호",
    floorNo: 2,
    floorName: "2층",
    mainUse: "제2종근린생활시설",
    areas: [{ areaType: "전유", area: 150, mainUse: "제2종근린생활시설" }]
  }]
};

const exact = adapter.selectRecord(sample, { floor: "2층", unit: "201호" });
assert.strictEqual(exact.level, "호실");
assert.strictEqual(exact.area, 150);
assert(exact.use.includes("제2종근린생활시설"));

const noGuess = adapter.selectRecord(sample, { floor: "2층", unit: "999호" });
assert.strictEqual(noGuess.level, "층", "없는 호실을 임의 생성하거나 일치시키면 안 됩니다.");
assert.strictEqual(adapter.sumKnown([null, null]), null, "미제공 숫자를 0으로 바꾸면 안 됩니다.");
assert.strictEqual(adapter.sumKnown([0, 0]), 0, "공식 API의 명시적 0은 0대로 표시해야 합니다.");

const aggregateSample = {
  buildings: [{ managementKey: "B2", mainUse: "근린생활시설" }],
  units: [
    {
      managementKey: "B2", roomName: "101호", floorNo: 1, mainUse: "사무소",
      areas: [{ areaType: "전유", area: 40, mainUse: "사무소" }]
    },
    {
      managementKey: "B2", roomName: "102호", floorNo: 1, mainUse: "휴게음식점",
      areas: [{ areaType: "전유", area: 100, mainUse: "휴게음식점" }]
    },
    {
      managementKey: "B2", roomName: "201호", floorNo: 2, mainUse: "일반음식점",
      areas: [{ areaType: "전유", area: 80, mainUse: "일반음식점" }]
    }
  ]
};
const proposedRecord = adapter.selectRecord(aggregateSample, { floor: "1층", unit: "101호" });
const proposedTotal = adapter.relatedUseArea(
  aggregateSample,
  { floor: "1층", unit: "101호", area: "40", industryId: "rest-restaurant" },
  proposedRecord
);
assert.strictEqual(proposedTotal.status, "EXACT");
assert.strictEqual(proposedTotal.value, 140, "기존 휴게음식점 합계에 새 호실 면적만 더해야 합니다.");
const existingRecord = adapter.selectRecord(aggregateSample, { floor: "1층", unit: "102호" });
const existingTotal = adapter.relatedUseArea(
  aggregateSample,
  { floor: "1층", unit: "102호", area: "100", industryId: "rest-restaurant" },
  existingRecord
);
assert.strictEqual(existingTotal.value, 100, "이미 관련 용도인 선택 호실을 중복 합산하면 안 됩니다.");
const incompleteSample = JSON.parse(JSON.stringify(aggregateSample));
incompleteSample.units[2].mainUse = "제1종 근린생활시설";
incompleteSample.units[2].areas[0].mainUse = "제1종 근린생활시설";
const incompleteRecord = adapter.selectRecord(incompleteSample, { floor: "1층", unit: "101호" });
assert.strictEqual(
  adapter.relatedUseArea(
    incompleteSample,
    { floor: "1층", unit: "101호", area: "40", industryId: "rest-restaurant" },
    incompleteRecord
  ).status,
  "UNKNOWN",
  "세부 용도가 빠진 호실이 있으면 자동합계를 확정하면 안 됩니다."
);

let checks = adapter.automaticChecks(exact, { area: "150" });
assert.strictEqual(checks["building-ledger-use"], "YES");
assert.strictEqual(checks["indoor-air-threshold"], undefined, "전용면적으로 영업시설 연면적을 추정하면 안 됩니다.");
assert.strictEqual(checks["same-building-area"], undefined, "같은 건축물 합계는 전용면적으로 추정하면 안 됩니다.");
assert.strictEqual(checks["education-zone"], undefined, "교육환경은 자료 없이 추정하면 안 됩니다.");

(async () => {
  const api = await import(pathToFileURL(path.join(root, "api/permit-public-data.js")).href + "?test=" + Date.now());
  assert.deepStrictEqual(api.validateParcel({
    sigunguCd: "30170", bjdongCd: "10400", platGbCd: "0", bun: "0123", ji: "0004"
  }), {
    sigunguCd: "30170", bjdongCd: "10400", platGbCd: "0", bun: "0123", ji: "0004"
  });
  assert.throws(() => api.validateParcel({
    sigunguCd: "3017x", bjdongCd: "10400", platGbCd: "0", bun: "0123", ji: "0004"
  }));
  const normalized = api.normalizeBuildingResponse({
    ok: true,
    action: "buildingRegister",
    buildings: sample.buildings,
    units: sample.units,
    source: "공식 테스트"
  });
  assert.strictEqual(normalized.action, "permitPublicData");
  assert.strictEqual(normalized.units.length, 1);
  const generalDiagnosis = adapter.buildDiagnosis({
    buildings: [{
      mainUse: "단독주택",
      indoorSelfParking: 0,
      outdoorSelfParking: 0,
      passengerElevators: 0,
      emergencyElevators: 0,
      floors: [],
      zones: []
    }],
    units: [],
    recordCounts: { zones: 0 }
  }, {
    floor: "",
    unit: "101호"
  }, {
    parcel: {},
    address: "대전 서구 탄방동 1283",
    roadAddress: "대전 서구 유등로669번길 58"
  });
  assert.strictEqual(generalDiagnosis.record.level, "건물");
  assert.strictEqual(generalDiagnosis.parking, 0);
  assert.strictEqual(generalDiagnosis.elevators, 0);
  assert(generalDiagnosis.scopeReason.includes("층 정보가 없어"));
  console.log("permit diagnosis step3 tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
