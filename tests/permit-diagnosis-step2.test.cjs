const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const index = read("index.html");
const css = read("css/permit-diagnosis-v1.css");
const loader = read("js/industry-rule-loader.js");
const engineSource = read("js/facility-check-engine.js");
const step2 = read("js/permit-diagnosis-step2.js");
const briefing = read("js/permit-broker-briefing.js");
const rule = JSON.parse(read("data/industry-rules/internet-computer-game.json"));

assert(index.includes("wastewater-capacity-engine.js?v=1.0.0"));
assert(index.includes("industry-administration-type.js?v=1.0.0"));
assert(index.includes("permit-diagnosis-step2.js?v=2.3.0"));
assert(index.includes("permit-broker-briefing.js?v=2.1.0"));
assert(css.includes(".permit-broker-guide-v2"));
assert(step2.includes("고객에게 먼저 물어볼 것"));
assert(step2.includes("찾아야 할 매물 용도"));
assert(step2.includes("계약 전 권장 확인"));
assert(step2.includes("fallbackRule"));
assert(step2.includes("관할확인형 안내"));
assert(step2.includes("정화조·오수 처리용량 계산"));
assert(step2.includes("이 업종의 행정유형"));
assert(briefing.includes("고객 설명용"));
assert(briefing.includes("업종·매물 사전 브리핑"));
assert(loader.includes("general-restaurant"));
assert(loader.includes("rest-restaurant"));

const context = { window: {} };
vm.createContext(context);
vm.runInContext(engineSource, context);
const engine = context.window.PermitFacilityCheckEngineV1;
const state = engine.createState(rule);
const checks = rule.checkGroups.flatMap((group) => group.checks);
let summary = engine.summarize(rule, state);
assert.strictEqual(summary.UNKNOWN, checks.length);
checks.forEach((check) => engine.setStatus(state, check.id, "YES"));
summary = engine.summarize(rule, state);
assert.strictEqual(summary.status, "GREEN");

console.log("permit diagnosis step2 tests: ok");
