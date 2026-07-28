const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const useRules = JSON.parse(read("data/building-use-rules.json"));
const procedureRules = JSON.parse(read("data/permit-procedure-rules.json"));
const useEngineSource = read("js/building-use-engine.js");
const diagnosisEngineSource = read("js/diagnosis-engine.js");
const step4Source = read("js/permit-diagnosis-step4.js");
const index = read("index.html");

assert(index.includes("building-use-engine.js"), "건축물 용도 엔진을 연결해야 합니다.");
assert(index.includes("diagnosis-engine.js"), "행정절차 판정 엔진을 연결해야 합니다.");
assert(index.includes("permit-diagnosis-step4.js"), "STEP 4 결과 UI를 연결해야 합니다.");
assert(step4Source.includes("동일 건물 합계 ") && step4Source.includes("㎡ 미만이면"),
  "업종별 면적 기준 미확인 시 두 절차 분기를 표시해야 합니다.");

const context = {
  window: {},
  fetch: () => Promise.reject(new Error("not used"))
};
vm.createContext(context);
vm.runInContext(useEngineSource, context);
vm.runInContext(diagnosisEngineSource, context);
const engine = context.window.PermitDiagnosisEngineV1;

function evaluate(use, level, sameBuildingArea, area = "100") {
  return engine.evaluate({
    industryId: "internet-computer-game",
    diagnosis: {
      input: { area },
      record: { use, level },
      zones: "일반상업지역"
    },
    sameBuildingRelevantUseArea: sameBuildingArea,
    useRules,
    procedureRules
  });
}

let result = evaluate("제2종 근린생활시설", "호실", 100);
assert.strictEqual(result.procedure.code, "NO_CHANGE", "제2종 근생과 500㎡ 미만 조건이면 변경 불필요 가능이어야 합니다.");

result = evaluate("제1종 근린생활시설", "층", 100);
assert.strictEqual(result.procedure.code, "NO_CHANGE", "제1종·제2종 상호 변경 예외를 반영해야 합니다.");

result = evaluate("판매시설", "층", 100);
assert.strictEqual(result.procedure.code, "REPORT", "판매시설에서 근린생활시설군으로 하향하면 신고 검토여야 합니다.");

result = evaluate("단독주택", "층", 100);
assert.strictEqual(result.procedure.code, "PERMIT", "주거업무시설군에서 근린생활시설군으로 상향하면 허가 검토여야 합니다.");

result = evaluate("제2종 근린생활시설", "층", 600, "600");
assert.strictEqual(result.procedure.code, "PERMIT", "500㎡ 이상 판매시설로 상향하면 허가 검토여야 합니다.");

result = evaluate("판매시설", "층", 600, "600");
assert.strictEqual(result.procedure.code, "NO_CHANGE", "현재와 목표가 모두 판매시설이면 용도변경 불필요 가능이어야 합니다.");

result = evaluate("제2종 근린생활시설", "층", undefined, "100");
assert.strictEqual(result.procedure.code, "UNDETERMINED", "동일 건물 합계가 없으면 전용면적만으로 확정하면 안 됩니다.");
assert(result.alternativeComparison, "미확인 면적은 500㎡ 이상 대안 절차도 계산해야 합니다.");

result = evaluate("단독주택 · 근린생활시설 · 주택", "건물", undefined, "76.03");
assert.strictEqual(result.procedure.code, "UNDETERMINED", "건물 전체 혼합용도를 해당 호실 용도로 단정하면 안 됩니다.");
assert(result.risks.some((value) => value.includes("층·호실")), "확인 범위 위험을 알려야 합니다.");

console.log("permit diagnosis step4 tests: ok");
