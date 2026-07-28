const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const index = read("index.html");
const css = read("css/permit-diagnosis-v1.css");
const ui = read("js/permit-diagnosis-ui.js");
const parserSource = read("js/industry-intent-parser.js");
const catalog = JSON.parse(read("data/industry-catalog.json"));
const master = JSON.parse(read("data/industry-master.json"));

const button = index.match(/id="permitDiagnosisOpenBtnV1"[\s\S]*?<\/button>/);
assert(button, "업종 마스터 버튼이 필요합니다.");
assert(button[0].includes("<span>업종<br>마스터</span>"), "버튼은 업종/마스터 두 줄이어야 합니다.");
assert(css.includes("font: 800 11px/1.15 inherit"), "버튼 글씨는 작은 크기여야 합니다.");
assert(css.includes("@media (max-width: 768px)"), "모바일 제외 규칙이 필요합니다.");
assert(ui.includes("업종 실무안내"), "업종 실무안내 탭이 필요합니다.");
assert(ui.includes("선택 매물 확인"), "선택 매물 확인 탭이 필요합니다.");
assert(ui.includes("permitApplyChecklistV1"), "선택 매물 체크리스트 영역이 필요합니다.");
assert(ui.includes("permitBrokerBriefingV2"), "고객 브리핑 영역이 필요합니다.");
assert(ui.includes("function resetModal()"), "팝업을 다시 열 때 초기화해야 합니다.");
assert(master.industries.length >= 25, "공통 업종 마스터의 범위가 충분해야 합니다.");

const industries = catalog.industries.concat(master.industries);
const context = { window: {} };
vm.createContext(context);
vm.runInContext(parserSource, context);
const parser = context.window.PermitIndustryIntentParserV1;
const food = parser.interpret("손님이 작은 김밥집을 하려고 합니다", industries, 6);
assert(food.some((entry) => entry.industry.id === "general-restaurant"));
assert(food.some((entry) => entry.industry.id === "rest-restaurant"));
const pet = parser.interpret("애견호텔을 찾습니다", industries, 6);
assert.strictEqual(pet[0].industry.id, "pet-hotel");

console.log("permit diagnosis step1 tests: ok");
