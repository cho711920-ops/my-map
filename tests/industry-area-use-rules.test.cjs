const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file) => JSON.parse(read(file));
const catalog = readJson("data/industry-catalog.json").industries;
const master = readJson("data/industry-master.json").industries;
const rules = readJson("data/industry-area-use-rules.json");
const all = [...new Map(catalog.concat(master).map((entry) => [entry.id, entry])).values()];

assert.strictEqual(all.length, 48, "전체 업종 수 변경 시 면적 규칙을 함께 갱신해야 합니다.");
for (const industry of all) {
  const templateId = rules.industries[industry.id];
  assert(templateId, `${industry.id}: 면적·용도 규칙 누락`);
  const template = rules.templates[templateId];
  assert(template, `${industry.id}: 템플릿 ${templateId} 누락`);
  assert(Array.isArray(template.bands) && template.bands.length > 0,
    `${industry.id}: 면적 구간 안내 누락`);
  assert(template.targetUse, `${industry.id}: 찾아야 할 매물 용도 누락`);
  assert(template.basis, `${industry.id}: 합산 기준 누락`);
  assert(template.note, `${industry.id}: 주의사항 누락`);
}

assert.strictEqual(rules.industries["rest-restaurant"], "food300");
assert.deepStrictEqual(
  rules.templates.food300.bands.map((band) => band.condition),
  ["300㎡ 미만", "300㎡ 이상"]
);
assert.strictEqual(rules.industries.fitness, "sports500");
assert(rules.templates.sports500.bands[1].buildingUse.includes("운동시설"));
assert.strictEqual(rules.industries["real-estate-office"], "office30_500");
assert.strictEqual(rules.templates.office30_500.bands.length, 3);
assert.strictEqual(rules.industries["motorcycle-repair"], "repair500");
assert(rules.templates.repair500.note.includes("배출시설"));

const ui = read("js/permit-diagnosis-ui.js");
const step2 = read("js/permit-diagnosis-step2.js");
const css = read("css/permit-diagnosis-v1.css");
assert(ui.includes("industry-area-use-rules.json?v=20260729-area1"));
assert(step2.includes("renderAreaUseRule(rule)"));
assert(css.includes(".permit-area-use-card-v1"));
assert(css.includes("grid-template-columns:repeat(2,minmax(0,1fr))"));

console.log("industry area use rules tests: ok (48/48)");
