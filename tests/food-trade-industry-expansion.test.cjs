const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const catalog = JSON.parse(read("data/industry-catalog.json")).industries;
const master = JSON.parse(read("data/industry-master.json")).industries;
const guidance = JSON.parse(read("data/industry-critical-guidance.json"));
const areaRules = JSON.parse(read("data/industry-area-use-rules.json"));
const industries = catalog.concat(master);
const byId = new Map(industries.map((industry) => [industry.id, industry]));

const requiredIds = [
  "food-processing-manufacturing",
  "food-additive-manufacturing",
  "food-transport",
  "food-subdivision",
  "edible-ice-sales",
  "food-vending-machine",
  "food-private-label-distribution",
  "institutional-food-sales",
  "large-food-retail",
  "food-cold-storage",
  "food-container-packaging",
  "food-earthenware-manufacturing",
  "contract-food-service",
  "shared-kitchen",
  "food-irradiation",
  "group-cafeteria",
  "health-functional-general-sales",
  "health-functional-private-label",
  "custom-health-functional-sales",
  "imported-food-sales",
  "imported-food-purchase-agent",
  "imported-food-storage",
  "imported-food-declaration-agency",
  "meat-sales",
  "meat-byproduct-sales",
  "milk-sales",
  "livestock-private-label",
  "edible-egg-sales",
  "meat-instant-processing",
  "meat-packaging-processing",
  "livestock-storage",
  "livestock-transport"
];

assert.equal(new Set(industries.map((industry) => industry.id)).size, industries.length);
assert(industries.length >= 82);
requiredIds.forEach((id) => {
  const industry = byId.get(id);
  assert(industry, `${id}: 업종마스터 누락`);
  assert(industry.officialName && industry.commonName && industry.description);
  assert(["허가", "등록", "신고"].includes(industry.permitType));
  assert(Array.isArray(industry.keywords) && industry.keywords.length >= 4);
  assert(Array.isArray(industry.process) && industry.process.length >= 4);
  assert(Array.isArray(industry.facilities) && industry.facilities.length >= 4);
  assert(guidance.industries[id], `${id}: 중개 실무 확인표 누락`);
  assert(areaRules.industries[id], `${id}: 면적·건축물 용도 규칙 누락`);
});

const context = { window: {} };
vm.createContext(context);
vm.runInContext(read("js/industry-intent-parser.js"), context);
const parser = context.window.PermitIndustryIntentParserV1;

function topId(query) {
  const result = parser.interpret(query, industries, 5);
  assert(result.length, `${query}: 검색 결과 없음`);
  return result[0].industry.id;
}

assert.equal(topId("식품소분업"), "food-subdivision");
assert.equal(topId("견과류 소분 포장 판매"), "food-subdivision");
assert.equal(topId("식품 OEM PB 브랜드 유통"), "food-private-label-distribution");
assert.equal(topId("학교급식 식자재 납품"), "institutional-food-sales");
assert.equal(topId("식품 냉동창고 운영"), "food-cold-storage");
assert.equal(topId("맞춤 영양제 소분 판매"), "custom-health-functional-sales");
assert.equal(topId("해외직구 식품 구매대행"), "imported-food-purchase-agent");
assert.equal(topId("정육점 고기 판매"), "meat-sales");
assert.equal(topId("정육점 양념육 즉석가공"), "meat-instant-processing");

const ui = read("js/permit-diagnosis-ui.js");
const index = read("index.html");
assert(ui.includes("20260731-health-functional1"));
assert(index.includes("permit-diagnosis-ui.js?v=2.8.2-accessible-label"));

console.log("food trade industry expansion tests passed (32 new industries)");
