const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file) => JSON.parse(read(file));

const catalog = readJson("data/industry-catalog.json").industries;
const master = readJson("data/industry-master.json").industries;
const buildingUses = readJson("data/building-use-rules.json");
const danranRule = readJson("data/industry-rules/danran-bar.json");
const entertainmentRule = readJson("data/industry-rules/entertainment-bar.json");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(read("js/industry-intent-parser.js"), context);
const parser = context.window.PermitIndustryIntentParserV1;
const results = parser.interpret("단란주점 자리를 찾습니다", catalog.concat(master), 4);

assert.strictEqual(results[0].industry.id, "danran-bar");
assert.strictEqual(results[0].industry.permitType, "허가");
assert(results[0].industry.expectedBuildingUse.includes("150㎡ 미만"));
assert.strictEqual(buildingUses.industryTargets["danran-bar"].thresholdSquareMeters, 150);
assert.strictEqual(buildingUses.industryTargets["danran-bar"].below.useTypeId, "neighborhood-2");
assert.strictEqual(buildingUses.industryTargets["danran-bar"].atOrAbove.useTypeId, "amusement");
assert.strictEqual(buildingUses.industryTargets["entertainment-bar"].fixed.useTypeId, "amusement");
assert.strictEqual(danranRule.registrationType, "허가");
assert(danranRule.requiredBuildingUse.underThreshold.includes("제2종 근린생활시설"));
assert(danranRule.requiredBuildingUse.atOrOverThreshold.includes("위락시설"));
assert.strictEqual(entertainmentRule.requiredBuildingUse.underThreshold, "면적과 관계없이 위락시설");

const loader = read("js/industry-rule-loader.js");
const html = read("index.html");
assert(loader.includes('"danran-bar": "data/industry-rules/danran-bar.json"'));
assert(loader.includes('"entertainment-bar": "data/industry-rules/entertainment-bar.json"'));
assert(html.includes("industry-rule-loader.js?v=1.5.0-danran-use"));
assert(html.includes("permit-diagnosis-ui.js?v=2.8.1-health-functional"));

console.log("danran bar industry tests: ok");
