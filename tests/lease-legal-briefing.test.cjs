const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const knowledge = JSON.parse(fs.readFileSync(path.join(root, "data/lease-legal-knowledge.json"), "utf8"));
const ui = fs.readFileSync(path.join(root, "js/lease-legal-briefing.js"), "utf8");
const api = fs.readFileSync(path.join(root, "api/permit-lease-legal.js"), "utf8");
const step2 = fs.readFileSync(path.join(root, "js/permit-diagnosis-step2.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(knowledge.version, /lease-legal/);
assert.match(knowledge.notice, /최종|확인|판단/);
assert.ok(Object.keys(knowledge.topics).length >= 9);
for (const topic of Object.values(knowledge.topics)) {
  assert.ok(topic.questions.length >= 3, `${topic.title}: 확인 질문 부족`);
  assert.ok(topic.contractPoints.length >= 2, `${topic.title}: 특약 주제 부족`);
  assert.ok(topic.precedentQueries.length >= 1, `${topic.title}: 판례 검색어 부족`);
  assert.ok(topic.sourceIds.length >= 1, `${topic.title}: 공식 출처 부족`);
}
assert.ok(knowledge.mediationExamples.length >= 4);
assert.ok(knowledge.mediationExamples.every((row) => row.url.startsWith("https://adrhome.reb.or.kr/")));
assert.match(ui, /조정사례는 당사자의 합의/);
assert.match(ui, /자동 법률판정은 하지 않습니다/);
assert.match(ui, /조회 실패를 판례 부재로 처리하지 않습니다/);
assert.match(api, /LAW_OPEN_DATA_OC/);
assert.match(api, /requireSession/);
assert.match(api, /Promise\.allSettled/);
assert.match(step2, /PermitLeaseLegalBriefingV1\.shell/);
assert.match(step2, /PermitLeaseLegalBriefingV1\.hydrate/);
assert.match(index, /lease-legal-briefing\.js/);

console.log("lease legal briefing tests: ok");
