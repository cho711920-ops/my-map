const assert = require("node:assert/strict");
const fs = require("node:fs");

const ui = fs.readFileSync("js/operations-collection-v8.js", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
const collector = fs.readFileSync("cloudflare/src/collector-api.js", "utf8");

assert.match(ui, /검증목록을 최신화합니다/);
assert.match(ui, /실제 D1 저장·재확인/);
assert.match(ui, /reviewRowsRemovedVerified/);
assert.match(ui, /setTimeout\(function\(\) \{ loadReviews\(true, true\); \}, 0\)/);
assert.match(ui, /apiPost\("applyReviewBatch"/);



assert.match(collector, /"applyReviewBatch", "consolidateExistingMasters"/);
assert.match(collector, /async function applyReviewBatch/);
assert.match(collector, /reviewRowsRemovedVerified/);
assert.match(collector, /source:\s*"D1"/);



assert.match(d1, /persisted:\s*true/);

console.log("operations direct D1 save tests passed");
