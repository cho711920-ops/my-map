const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const catalog = JSON.parse(read("data/industry-catalog.json"));
const generalRule = JSON.parse(read("data/industry-rules/general-restaurant.json"));
const restRule = JSON.parse(read("data/industry-rules/rest-restaurant.json"));
const useRules = JSON.parse(read("data/building-use-rules.json"));
const procedureRules = JSON.parse(read("data/permit-procedure-rules.json"));
const parserSource = read("js/industry-intent-parser.js");
const useEngineSource = read("js/building-use-engine.js");
const diagnosisSource = read("js/diagnosis-engine.js");
const loaderSource = read("js/industry-rule-loader.js");

[generalRule, restRule].forEach((rule) => {
  assert(rule.checkGroups.length >= 5, `${rule.officialName} 체크분야가 충분해야 합니다.`);
  const checks = rule.checkGroups.flatMap((group) => group.checks);
  assert(checks.length >= 20, `${rule.officialName} 상세 체크항목이 충분해야 합니다.`);
  ["building-ledger-use", "industry-confirmation", "kitchen", "washing-drain",
    "hood-duct", "gas", "fire", "hygiene-education", "health-check", "filing-documents"]
    .forEach((id) => assert(checks.some((check) => check.id === id), `${rule.officialName}에 ${id}가 필요합니다.`));
  assert(rule.sources.every((source) => source.url.startsWith("https://www.law.go.kr") ||
    source.url.startsWith("https://law.go.kr")), "공식 법령 출처만 사용해야 합니다.");
});

assert(loaderSource.includes('"general-restaurant"'), "일반음식점 규칙을 연결해야 합니다.");
assert(loaderSource.includes('"rest-restaurant"'), "휴게음식점 규칙을 연결해야 합니다.");

const parserContext = { window: {} };
vm.createContext(parserContext);
vm.runInContext(parserSource, parserContext);
const candidates = parserContext.window.PermitIndustryIntentParserV1.interpret(
  "홀 테이블 몇 개를 놓고 작은 김밥집을 하려고 합니다.",
  catalog.industries,
  4
);
const candidateIds = candidates.map((entry) => entry.industry.id);
assert(candidateIds.includes("general-restaurant"), "김밥집은 일반음식점 후보를 보여야 합니다.");
assert(candidateIds.includes("rest-restaurant"), "김밥집은 휴게음식점 후보도 함께 보여야 합니다.");

const engineContext = { window: {}, fetch: () => Promise.reject(new Error("not used")) };
vm.createContext(engineContext);
vm.runInContext(useEngineSource, engineContext);
vm.runInContext(diagnosisSource, engineContext);
const engine = engineContext.window.PermitDiagnosisEngineV1;

let result = engine.evaluate({
  industryId: "general-restaurant",
  diagnosis: { input: { area: "40" }, record: { use: "제2종 근린생활시설", level: "호실" }, zones: "일반상업지역" },
  useRules,
  procedureRules
});
assert.strictEqual(result.procedure.code, "NO_CHANGE", "일반음식점과 제2종 근린생활시설이 맞으면 변경 불필요 가능이어야 합니다.");

result = engine.evaluate({
  industryId: "rest-restaurant",
  diagnosis: { input: { area: "40" }, record: { use: "제1종 근린생활시설", level: "호실" }, zones: "일반상업지역" },
  sameBuildingRelevantUseArea: 100,
  useRules,
  procedureRules
});
assert.strictEqual(result.procedure.code, "NO_CHANGE", "300㎡ 미만 휴게음식점과 제1종 근린생활시설이 맞으면 변경 불필요 가능이어야 합니다.");

result = engine.evaluate({
  industryId: "rest-restaurant",
  diagnosis: { input: { area: "40" }, record: { use: "제1종 근린생활시설", level: "호실" }, zones: "일반상업지역" },
  useRules,
  procedureRules
});
assert.strictEqual(result.procedure.code, "UNDETERMINED", "같은 건물 300㎡ 합계가 없으면 휴게음식점 용도를 확정하면 안 됩니다.");

console.log("permit diagnosis step7 tests: ok");
