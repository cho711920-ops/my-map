const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const master = readJson("data/industry-master.json").industries;
const catalog = readJson("data/industry-catalog.json").industries;
const critical = readJson("data/industry-critical-guidance.json").industries;
const motorcycleIds = [
  "motorcycle-sales",
  "motorcycle-repair",
  "motorcycle-parts",
  "motorcycle-tuning"
];

for (const id of motorcycleIds) {
  const item = master.find((entry) => entry.id === id);
  assert(item, `${id} 업종 마스터 누락`);
  assert(item.keywords.some((keyword) => /바이크|오토바이|이륜차|모터사이클/.test(keyword)),
    `${id} 검색어 누락`);
  assert(critical[id], `${id} 중요 확인표 누락`);

  const rule = readJson(`data/industry-rules/${id}.json`);
  assert.strictEqual(rule.industryId, id);
  assert(rule.checkGroups.length >= 2, `${id} 상세 점검표 부족`);
  assert(rule.sources.every((source) => source.url.startsWith("https://")),
    `${id} 공식 출처 형식 오류`);
}

const fitness = catalog.find((entry) => entry.id === "fitness");
assert(fitness, "체력단련장업 카탈로그 누락");
assert(fitness.expectedBuildingUse.includes("500㎡ 미만"));
assert(fitness.expectedBuildingUse.includes("500㎡ 이상"));
assert(critical.fitness.specific.some((text) => text.includes("500㎡")));

const fitnessRule = readJson("data/industry-rules/fitness.json");
assert.strictEqual(fitnessRule.registrationType, "신고");
assert.strictEqual(fitnessRule.requiredBuildingUse.thresholdSquareMeters, 500);
assert(fitnessRule.requiredBuildingUse.underThreshold.includes("제2종 근린생활시설"));
assert(fitnessRule.requiredBuildingUse.atOrOverThreshold.includes("운동시설"));
assert(fitnessRule.checkGroups.some((group) =>
  group.checks.some((check) => check.id === "fitness-area-sum")));

const parserContext = { window: {} };
vm.createContext(parserContext);
vm.runInContext(
  fs.readFileSync(path.join(root, "js/industry-intent-parser.js"), "utf8"),
  parserContext
);
const parser = parserContext.window.PermitIndustryIntentParserV1;
const bikeMatches = parser.interpret("바이크 판매수리점", master, 6)
  .map((entry) => entry.industry.id);
assert(bikeMatches.includes("motorcycle-sales"), "띄어쓴 바이크 판매 검색 실패");
assert(bikeMatches.includes("motorcycle-repair"), "띄어쓴 바이크 수리 검색 실패");

const css = fs.readFileSync(path.join(root, "css/permit-diagnosis-v1.css"), "utf8");
assert(css.includes(".permit-critical-bottom-v1 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));"),
  "중요 확인표 마지막 줄이 동일한 2열 폭이 아님");

console.log("motorcycle and fitness rules tests: ok");
