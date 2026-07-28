const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const index = read("index.html");
const css = read("css/permit-diagnosis-v1.css");
const loader = read("js/industry-rule-loader.js");
const engineSource = read("js/facility-check-engine.js");
const ui = read("js/permit-diagnosis-step2.js");
const rule = JSON.parse(read("data/industry-rules/internet-computer-game.json"));

const buttonMatch = index.match(/id="permitDiagnosisOpenBtnV1"[\s\S]*?<\/button>/);
assert(buttonMatch, "입점 버튼이 필요합니다.");
assert(buttonMatch[0].includes("<span>입점</span>"), "버튼은 입점 두 글자를 표시해야 합니다.");
assert(!buttonMatch[0].includes("permit-diagnosis-open-icon"), "버튼에 중복 입 아이콘이 없어야 합니다.");
assert(css.includes("white-space: nowrap"), "입점 두 글자가 한 줄이어야 합니다.");

assert.strictEqual(rule.industryId, "internet-computer-game");
assert.strictEqual(rule.registrationType, "등록");
assert(rule.requiredBuildingUse.underThreshold.includes("500㎡ 미만"));
assert(rule.requiredBuildingUse.important.includes("전용면적만으로 판정하지 않고"));
assert(rule.checkGroups.length >= 6, "PC방 점검 분야가 충분해야 합니다.");
assert(rule.sources.length >= 5, "공식 법령 출처가 포함되어야 합니다.");

const checks = rule.checkGroups.flatMap((group) => group.checks);
assert(checks.length >= 20, "상세 시설 체크 항목이 충분해야 합니다.");
assert(checks.every((check) => check.id && check.label && check.note && check.severity));
assert(checks.some((check) => check.id === "education-zone"));
assert(checks.some((check) => check.id === "same-building-area"));
assert(checks.some((check) => check.id === "contract-power"));
assert(checks.some((check) => check.id === "food-operation"));

const context = { window: {} };
vm.createContext(context);
vm.runInContext(engineSource, context);
const engine = context.window.PermitFacilityCheckEngineV1;
const state = engine.createState(rule);
let result = engine.summarize(rule, state);
assert.strictEqual(result.UNKNOWN, checks.length, "초기 상태는 모두 UNKNOWN이어야 합니다.");
assert.strictEqual(result.status, "ORANGE", "핵심 미확인은 ORANGE여야 합니다.");

checks.forEach((check) => engine.setStatus(state, check.id, "YES"));
result = engine.summarize(rule, state);
assert.strictEqual(result.status, "GREEN", "모든 항목 확인 시 GREEN이어야 합니다.");
engine.setStatus(state, "building-ledger-use", "NO");
result = engine.summarize(rule, state);
assert.strictEqual(result.status, "RED", "핵심 불충족은 RED여야 합니다.");

assert(loader.includes("cache"), "규칙 로더는 반복 조회를 캐시해야 합니다.");
assert(ui.includes("STEP 6"), "영구 저장이 아직 연결되지 않았음을 안내해야 합니다.");
assert(index.includes("facility-check-engine.js"));
assert(index.includes("permit-diagnosis-step2.js"));

console.log("permit diagnosis step2 tests: ok");
