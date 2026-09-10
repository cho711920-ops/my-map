const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync("js/print.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("AI report print control reacts to selection mutations without permanent polling", () => {
  assert.doesNotMatch(source, /setInterval\(addAIReportPrintButton/);
  assert.match(source, /new MutationObserver\(scheduleButtonRefresh\)/);
  assert.match(source, /attributeFilter:\s*\["class"\]/);
  assert.match(source, /__JS_AI_PRINT_BUTTON_OBSERVER__/);
  assert.match(html, /print\.js\?v=1\.0\.0&amp;selection-observer-v1=1/);
});
