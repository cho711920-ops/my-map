const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "data", name), "utf8"));

const catalog = readJson("industry-catalog.json");
const master = readJson("industry-master.json");
const guidance = readJson("industry-critical-guidance.json");
const industries = [...catalog.industries, ...master.industries];
const ids = [...new Set(industries.map((industry) => industry.id))];

assert.strictEqual(ids.length, 44, "업종 마스터의 고유 업종 수가 변경되었습니다.");
assert.strictEqual(
  Object.keys(guidance.industries).length,
  ids.length,
  "업종별 누락 방지 프로필 수가 전체 업종 수와 다릅니다."
);

const requiredTemplateArrays = [
  "mustAsk",
  "site",
  "facility",
  "safety",
  "contractBlockers",
  "agencies",
  "sourceIds"
];

ids.forEach((id) => {
  const profile = guidance.industries[id];
  assert(profile, `${id}: 누락 방지 프로필이 없습니다.`);
  const template = guidance.templates[profile.template];
  assert(template, `${id}: 템플릿 ${profile.template}이 없습니다.`);
  requiredTemplateArrays.forEach((key) => {
    assert(Array.isArray(template[key]), `${id}: ${key} 템플릿 배열이 없습니다.`);
    assert(template[key].length > 0, `${id}: ${key} 템플릿이 비어 있습니다.`);
  });
  assert(Array.isArray(profile.specific), `${id}: 업종 고유 확인사항이 없습니다.`);
  assert(profile.specific.length >= 2, `${id}: 고유 확인사항이 2개 미만입니다.`);
  [...template.sourceIds, ...(profile.sourceIds || [])].forEach((sourceId) => {
    assert(guidance.sources[sourceId], `${id}: 공식 근거 ${sourceId}가 없습니다.`);
    assert(
      /^https:\/\/www\.law\.go\.kr\//.test(guidance.sources[sourceId].url),
      `${id}: 공식 법령 URL이 아닙니다.`
    );
  });
});

const step2 = fs.readFileSync(
  path.join(root, "js", "permit-diagnosis-step2.js"),
  "utf8"
);
const ui = fs.readFileSync(
  path.join(root, "js", "permit-diagnosis-ui.js"),
  "utf8"
);
assert(step2.includes("renderCriticalGuidanceCard"));
assert(step2.includes("계약 차단조건 확인"));
assert(ui.includes("industry-critical-guidance.json"));

console.log("permit industry critical guidance tests: ok (44/44)");
