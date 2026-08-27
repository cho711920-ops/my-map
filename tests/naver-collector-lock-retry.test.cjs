const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "js", "naver-collector.js"),
  "utf8"
);

assert.match(source, /var VERSION = "6\.0\.0";/);
assert.match(source, /runAutomatic: runAutomatic/);
assert.match(source, /data-action="auto-register"/);
assert.match(source, /data-metric="updated"/);
assert.match(source, /data-metric="detailedDuplicates"/);
assert.match(source, /data-metric="skippedUnchanged"/);
assert.match(
  source,
  /session\.skippedUnchanged = classification\.unchanged;[\s\S]*?detailedDuplicates: Number\(sessionResult\.duplicate \|\| 0\),[\s\S]*?skippedUnchanged: classification\.unchanged/
);
assert.match(source, /postBatchWithRetry\(batch, 6, Object\.assign\(\{\}, session/);
assert.match(source, /다른 수집 \(\?:작업\|저장\)이 진행 중/);
assert.match(source, /Math\.min\(10000, 2000 \* attempt\)/);
assert.match(source, /var BATCH_SIZE = 100;/);
assert.doesNotMatch(source, /NAVER_ACCESS_KEY/);
assert.match(source, /validationVersion: 2/);
assert.match(source, /if \(state\.preparing && !state\.busy\)/);
assert.match(source, /state\.prepareId \+= 1/);
assert.match(source, /while \(state\.busy && Date\.now\(\) - readyStartedAt < 90000\)/);

console.log("naver collector lock retry tests passed");
