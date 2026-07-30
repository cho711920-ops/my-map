const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "gongsil-collector.js"),
  "utf8"
);

assert.match(source, /var VERSION = "1\.9\.3";/);
assert.match(
  source,
  /var BUSY_RETRY_DELAYS = \[3000, 6000, 10000, 15000, 20000, 30000\];/
);
assert.match(
  source,
  /var detailItems = saveMetadata\.complete\s*\?\s*items\.slice\(\)\s*:\s*items\.filter/
);
const collectPhonesSource = source.slice(
  source.indexOf("async function collectPhones("),
  source.indexOf("function isTenantLabel(")
);
assert.ok(
  /appendContactFields\(buildingCandidates,\s*detail && detail\.bilinfo/.test(collectPhonesSource) &&
    /isCollectiveItem\(item,\s*detail\)\s*\?\s*listingCandidates\s*:\s*listingCandidates\.concat\(buildingCandidates\)/.test(collectPhonesSource),
  "일반건물은 건물 연락처를 사용하고 집합건물은 해당 호실 연락처만 사용해야 합니다."
);
assert.match(
  source,
  /function appendContactValue\(target, value\)[\s\S]*?"Mobile", "mobile", "Hp", "hp"/
);
assert.match(
  source,
  /"Ty2", "ty2", "Ty1", "ty1",\s*"TelType", "telType"/
);
assert.match(
  source,
  /duplicate: Number\(result\.duplicate \|\| 0\) \+ detailBaseProcessed/
);
assert.match(
  collectPhonesSource,
  /if \(!uniqueContacts\.length\) \{\s*throw new Error\(/,
  "공실박스 연락처가 비어 있으면 빈 매물을 저장하지 말고 제외 사유를 남겨야 합니다."
);
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
  /Boolean\(metadata\.complete\)[\s\S]*?!stopped[\s\S]*?Number\(totals\.failed \|\| 0\) === 0[\s\S]*?Number\(metadata\.rejectedCount \|\| 0\) === 0/
);
assert.match(
  source,
  /function isBusyMutationResult\(result\)[\s\S]*?function isBusyMutationError\(error\)/
);
assert.match(
  source,
  /async function classifyGongsilManifest\([\s\S]*?if \(isBusyMutationResult\(result\)\)[\s\S]*?offset -= chunkSize;[\s\S]*?continue;/
);
assert.match(
  source,
  /async function sendAppsScriptBatch\([\s\S]*?busyError\.isCollectorBusy = true/
);
assert.match(
  source,
  /async function finalizeGongsilSession\([\s\S]*?return finalizeGongsilSession\(metadata, collectorKey, complete, stopped\);/
);

console.log("gongsil collector tests passed");
