const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const script = fs.readFileSync("js/script.js", "utf8");
const aiVisit = fs.readFileSync("js/ai-visit-session-v6.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function extractFunction(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const brace = script.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < script.length; index += 1) {
    if (script[index] === "{") depth += 1;
    if (script[index] === "}") depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction("isConfirmedVisitItem"),
  extractFunction("removeFieldVisitMarkerFromMemo"),
  extractFunction("markFieldVisitConfirmedInMemo")
].join("\n"), context);

assert.equal(
  context.markFieldVisitConfirmedInMemo("(임장가자) / 주차 가능"),
  "(확인매물) / 주차 가능"
);
assert.equal(
  context.markFieldVisitConfirmedInMemo("(공실박스) / (확인매물) / 즉시 입주"),
  "(확인매물) / 즉시 입주"
);
assert.equal(context.markFieldVisitConfirmedInMemo("(임장가자)"), "(확인매물)");
assert.equal(context.isConfirmedVisitItem({ memo: "(확인매물) / 주차 가능" }), true);
assert.equal(context.isConfirmedVisitItem({ memo: "(임장가자)" }), false);

assert.match(script, /new IntersectionObserver\(function\(entries\)/);
assert.match(script, /duplicate-shimmer-visible-v812/);
assert.match(script, /rootMargin:\s*"80px 0px"/);
assert.match(css, /\.unified-expand-btn-v8\.duplicate-shimmer-visible-v812::after/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(aiVisit, /window\.markFieldVisitConfirmedInMemo\(value\)/);
assert.ok(html.includes("ai-visit-session-v6.js?v=6.4.37-confirmed-visit"));

console.log("confirmed visit and viewport-only duplicate shimmer v8.1.2 tests passed");
