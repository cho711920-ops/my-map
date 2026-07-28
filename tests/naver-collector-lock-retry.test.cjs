const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "js", "naver-collector.js"),
  "utf8"
);

assert.match(source, /var VERSION = "5\.4\.1";/);
assert.match(source, /postBatchWithRetry\(batch, 6, session\)/);
assert.match(source, /다른 수집 \(\?:작업\|저장\)이 진행 중/);
assert.match(source, /Math\.min\(10000, 2000 \* attempt\)/);
assert.match(source, /var BATCH_SIZE = 100;/);

console.log("naver collector lock retry tests passed");
