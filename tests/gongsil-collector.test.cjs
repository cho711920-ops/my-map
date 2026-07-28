const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "gongsil-collector.js"),
  "utf8"
);

assert.match(source, /var VERSION = "1\.8\.2";/);
assert.match(
  source,
  /function importItemTotal\(records, metadata\)[\s\S]*?Math\.max\([\s\S]*?Number\(metadata\.found \|\| 0\)/
);
assert.match(
  source,
  /async function sendToAppsScript\(records, metadata, suppliedCollectorKey\)[\s\S]*?var itemsLength = importItemTotal\(records, metadata\);/
);

const helperSource = source.match(
  /function importItemTotal\(records, metadata\) \{[\s\S]*?\n  \}/
)[0];
const importItemTotal = new Function(
  `${helperSource}\nreturn importItemTotal;`
)();

assert.equal(
  importItemTotal(new Array(2354), {
    found: 2486,
    unchanged: 0,
    rejectedCount: 132
  }),
  2486
);
assert.equal(
  importItemTotal(new Array(300), {
    found: 2486,
    unchanged: 2050,
    rejectedCount: 136
  }),
  2486
);

const saveFunction = source.slice(
  source.indexOf("async function sendToAppsScript("),
  source.indexOf("async function sendAppsScriptBatch(")
);
const offsetPosition = saveFunction.indexOf("offset += batch.length;");
const checkpointPosition = saveFunction.indexOf(
  "localStorage.setItem(SAVE_PROGRESS_KEY",
  offsetPosition
);
const dashboardPosition = saveFunction.indexOf(
  "updateDashboard({",
  offsetPosition
);
assert.ok(offsetPosition >= 0);
assert.ok(checkpointPosition > offsetPosition);
assert.ok(dashboardPosition > checkpointPosition);
assert.match(
  saveFunction,
  /Boolean\(metadata\.complete\) && !stopped && Number\(totals\.failed \|\| 0\) === 0/
);

console.log("gongsil collector tests passed");
