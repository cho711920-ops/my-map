const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const catalog = JSON.parse(read("data/industry-ksic11-catalog.json"));
const detailed = JSON.parse(read("data/industry-catalog.json")).industries;
const master = JSON.parse(read("data/industry-master.json")).industries;

assert.strictEqual(catalog.version, "KSIC11-2024-2-universal-v1");
assert.strictEqual(catalog.industries.length, 1205, "KSIC 제11차 세세분류 1,205개가 모두 있어야 합니다.");
assert.strictEqual(Object.keys(catalog.sections).length, 21, "KSIC 대분류 21개가 모두 있어야 합니다.");
assert.strictEqual(Object.keys(catalog.sectionAliases).length, 21, "업태 대분류 검색어 21개가 모두 있어야 합니다.");
assert(/^https:\/\/mods\.go\.kr\//.test(catalog.source.url), "분류 출처는 국가데이터처 공식 주소여야 합니다.");

const codes = new Set();
catalog.industries.forEach((row) => {
  assert(Array.isArray(row) && row.length === 3, "KSIC 행은 코드·명칭·대분류 구조여야 합니다.");
  assert(/^\d{5}$/.test(row[0]), `${row[0]}: 5자리 KSIC 코드가 아닙니다.`);
  assert(row[1].trim().length >= 2, `${row[0]}: 공식 명칭이 비어 있습니다.`);
  assert(catalog.sections[row[2]], `${row[0]}: 알 수 없는 대분류입니다.`);
  assert(!codes.has(row[0]), `${row[0]}: 중복 코드입니다.`);
  codes.add(row[0]);
});

Object.entries(catalog.briefings).forEach(([sectionId, briefing]) => {
  assert(catalog.sections[sectionId], `${sectionId}: 없는 대분류 브리핑입니다.`);
  assert(briefing.expectedBuildingUse, `${sectionId}: 예상 건축물 용도 안내가 없습니다.`);
  assert(briefing.legalArea, `${sectionId}: 확인 법령분야가 없습니다.`);
  assert(briefing.process.length >= 5, `${sectionId}: 진행순서가 부족합니다.`);
  assert(briefing.facilities.length >= 5, `${sectionId}: 시설 확인사항이 부족합니다.`);
  assert(briefing.extraChecks.length >= 5, `${sectionId}: 고객 질문이 부족합니다.`);
});

Object.keys(catalog.aliases).forEach((code) => {
  assert(codes.has(code), `${code}: 존재하지 않는 KSIC 코드의 별칭입니다.`);
  assert(catalog.aliases[code].length > 0, `${code}: 별칭이 비어 있습니다.`);
});

const context = { window: {} };
vm.createContext(context);
vm.runInContext(read("js/ksic-industry-adapter.js"), context);
vm.runInContext(read("js/industry-intent-parser.js"), context);
const adapter = context.window.PermitKsicIndustryAdapterV1;
const parser = context.window.PermitIndustryIntentParserV1;
assert(adapter && parser);

const expanded = adapter.expand(catalog);
assert.strictEqual(expanded.length, 1205);
expanded.forEach((industry) => {
  assert(/^ksic-\d{5}$/.test(industry.id), `${industry.id}: 변환 ID 오류`);
  assert(industry.process.length >= 5, `${industry.id}: 공통 브리핑 진행순서 누락`);
  assert(industry.facilities.length >= 5, `${industry.id}: 공통 브리핑 시설 누락`);
  assert(industry.extraChecks.length >= 5, `${industry.id}: 공통 브리핑 질문 누락`);
  assert.strictEqual(industry.ruleStatus, "AGENCY_CONFIRM");
  assert.strictEqual(industry.permitType, "품목·운영방식별 확인");
});
const sectionEntries = adapter.expandSections(catalog);
assert.strictEqual(sectionEntries.length, 21);
[
  ["도소매업", "ksic-section-G"],
  ["정보통신업", "ksic-section-J"],
  ["의료업", "ksic-section-Q"],
].forEach(([query, expectedId]) => {
  const results = parser.interpret(query, sectionEntries, 6);
  assert.strictEqual(results[0].industry.id, expectedId, `${query}: 업태 대분류 검색 오류`);
});

const cases = [
  ["문구점", "ksic-47612"],
  ["세무사사무소", "ksic-71202"],
  ["카센터", "ksic-95211"],
  ["입시학원", "ksic-85501"],
  ["동물병원", "ksic-73100"],
  ["중고가전매장", "ksic-47862"],
  ["56111", "ksic-56111"],
  ["곡물 및 기타 식량작물 재배업", "ksic-01110"],
  ["오토바이매장", "ksic-45302"],
  ["결혼정보회사", "ksic-96994"],
  ["택배대리점", "ksic-49401"],
  ["금은방", "ksic-47830"],
  ["주유소", "ksic-47711"],
  ["수영장", "ksic-91133"],
  ["오락실", "ksic-91221"],
  ["이발소", "ksic-96111"],
  ["옷가게", "ksic-47419"],
  ["무인아이스크림점", "ksic-47129"],
  ["반찬가게", "ksic-47223"],
  ["풋살장", "ksic-91139"],
];

cases.forEach(([query, expectedId]) => {
  const results = parser.interpret(query, expanded, 6);
  assert(results.length, `${query}: 검색 결과가 없습니다.`);
  assert.strictEqual(results[0].industry.id, expectedId, `${query}: 최상위 업종이 잘못되었습니다.`);
});

const detailedWithPriority = detailed.concat(master).map((industry) =>
  Object.assign({}, industry, { searchPriority: 30 })
);
const all = detailedWithPriority.concat(adapter.expandAll(catalog));
assert.strictEqual(all.length, 1308, "정밀업종 82개와 KSIC 대분류 21개·세세분류 1,205개가 함께 검색되어야 합니다.");
assert.strictEqual(
  parser.interpret("식품소분업", all, 6)[0].industry.id,
  "food-subdivision",
  "기존 정밀규칙 업종은 KSIC 일반후보보다 우선해야 합니다."
);
assert.strictEqual(
  parser.interpret("PC방", all, 6)[0].industry.id,
  "internet-computer-game",
  "기존 상세 PC방 규칙은 KSIC 일반후보보다 우선해야 합니다."
);

const ui = read("js/permit-diagnosis-ui.js");
const selector = read("js/industry-candidate-selector.js");
const step2 = read("js/permit-diagnosis-step2.js");
const index = read("index.html");
assert(ui.includes("industry-ksic11-catalog.json?v=20260731-universal1"));
assert(ui.includes("PermitKsicIndustryAdapterV1.expandAll"));
assert(ui.includes("1,205개 세세분류"));
assert(selector.includes("KSIC "));
assert(selector.includes("classificationSource"));
assert(step2.includes("industry.classificationSource"));
assert(step2.includes("industry.classificationNotice"));
assert(index.includes("ksic-industry-adapter.js?v=1.0.0"));
assert(index.includes("industry-intent-parser.js?v=1.2.0-ksic11"));
assert(index.includes("industry-candidate-selector.js?v=2.3.0-ksic11"));
assert(index.includes("permit-diagnosis-step2.js?v=2.8.0-ksic11"));
assert(index.includes("permit-diagnosis-ui.js?v=2.8.0-ksic11"));

console.log("KSIC universal industry search tests passed (1,205 + 21 + 82 = 1,308)");
