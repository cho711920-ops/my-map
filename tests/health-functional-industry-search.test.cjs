const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const master = JSON.parse(read("data/industry-master.json"));
const guidance = JSON.parse(read("data/industry-critical-guidance.json"));
const areaRules = JSON.parse(read("data/industry-area-use-rules.json"));

const healthIds = [
  "health-functional-specialized-manufacturing",
  "health-functional-venture-manufacturing",
  "health-functional-general-sales",
  "health-functional-private-label",
  "custom-health-functional-sales",
];
const expectedPermitTypes = {
  "health-functional-specialized-manufacturing": "허가",
  "health-functional-venture-manufacturing": "허가",
  "health-functional-general-sales": "신고",
  "health-functional-private-label": "신고",
  "custom-health-functional-sales": "신고",
};

healthIds.forEach((id) => {
  const industry = master.industries.find((entry) => entry.id === id);
  assert(industry, `${id}: 건강기능식품 법정 업종 누락`);
  assert.strictEqual(industry.permitType, expectedPermitTypes[id], `${id}: 행정유형 오류`);
  assert(industry.keywords.length >= 6, `${id}: 생활표현 검색어 부족`);
  assert(industry.process.length >= 5, `${id}: 진행순서 부족`);
  assert(industry.facilities.length >= 5, `${id}: 시설 브리핑 부족`);
  assert(industry.extraChecks.length >= 4, `${id}: 중개 확인사항 부족`);
  assert(guidance.industries[id], `${id}: 정밀 실무 브리핑 누락`);
  assert(areaRules.industries[id], `${id}: 건축물 용도 검토 규칙 누락`);
});

assert.strictEqual(
  guidance.industries["health-functional-specialized-manufacturing"].template,
  "healthFunctionalManufacturing"
);
assert.strictEqual(
  guidance.industries["health-functional-venture-manufacturing"].template,
  "healthFunctionalManufacturing"
);
assert.strictEqual(
  areaRules.industries["health-functional-specialized-manufacturing"],
  "manufacturing500"
);
assert.strictEqual(
  areaRules.industries["health-functional-venture-manufacturing"],
  "office30_500"
);

const context = { window: {} };
vm.createContext(context);
vm.runInContext(read("js/industry-intent-parser.js"), context);
const parser = context.window.PermitIndustryIntentParserV1;
const industries = master.industries.map((industry) =>
  Object.assign({}, industry, { searchPriority: 30 })
);
const topId = (query) => parser.interpret(query, industries, 6)[0].industry.id;

[
  ["건강식품", "health-functional-general-sales"],
  ["건강기능식품", "health-functional-general-sales"],
  ["건기식", "health-functional-general-sales"],
  ["영양제", "health-functional-general-sales"],
  ["홍삼판매", "health-functional-general-sales"],
  ["건강식품 OEM 브랜드", "health-functional-private-label"],
  ["맞춤 건강식품 소분", "custom-health-functional-sales"],
  ["영양제 제조 공장", "health-functional-specialized-manufacturing"],
  ["벤처기업 건강기능식품 위탁제조", "health-functional-venture-manufacturing"],
].forEach(([query, expectedId]) => {
  assert.strictEqual(topId(query), expectedId, `${query}: 건강식품 업종 검색 오류`);
});

const ui = read("js/permit-diagnosis-ui.js");
const index = read("index.html");
assert(ui.includes("industry-master.json?v=20260731-health-functional1"));
assert(ui.includes("industry-critical-guidance.json?v=20260731-health-functional1"));
assert(ui.includes("industry-area-use-rules.json?v=20260731-health-functional1"));
assert(index.includes("permit-diagnosis-ui.js?v=2.8.1-health-functional"));

console.log("health functional industry search tests passed (5 legal business types)");
