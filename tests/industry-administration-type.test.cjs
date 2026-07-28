const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const source = read("js/industry-administration-type.js");
const catalog = JSON.parse(read("data/industry-catalog.json")).industries;
const master = JSON.parse(read("data/industry-master.json")).industries;

const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const resolver = context.window.PermitIndustryAdministrationTypeV1;

assert.strictEqual(resolver.resolve("허가", "general-game").code, "PERMIT");
assert.strictEqual(resolver.resolve("인가", "daycare").code, "PERMIT");
assert.strictEqual(resolver.resolve("등록", "karaoke").code, "REGISTRATION");
assert.strictEqual(resolver.resolve("개설등록", "real-estate-office").code, "REGISTRATION");
assert.strictEqual(resolver.resolve("신고", "general-restaurant").code, "REPORT");
assert.strictEqual(resolver.resolve("품목별 확인", "retail-store").code, "FREE");
assert.strictEqual(resolver.resolve("사업별 확인", "office").code, "FREE");
assert.strictEqual(resolver.resolve("복수 신고·확인", "kids-cafe").code, "CONDITIONAL");

const allowed = new Set(["PERMIT", "REGISTRATION", "REPORT", "FREE", "CONDITIONAL"]);
catalog.concat(master).forEach((industry) => {
  const result = resolver.resolve(industry.permitType, industry.id);
  assert(allowed.has(result.code), `행정유형 누락: ${industry.id}`);
  assert(result.label && result.description && result.timing, `행정유형 설명 누락: ${industry.id}`);
});

console.log("industry administration type tests: ok");
