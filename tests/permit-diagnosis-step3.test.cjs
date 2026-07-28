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
  console.log("permit diagnosis step3 tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
