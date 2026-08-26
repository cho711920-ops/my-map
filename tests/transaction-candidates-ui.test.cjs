const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "cloudflare/src/d1-api.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "js/operations-center-v7.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/operations-center-v7.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(api, /"transactionCandidates"/);
assert.match(api, /HAVING SUM\(CASE WHEN s\.active=1 THEN 1 ELSE 0 END\)=0/);
assert.match(api, /MAX\(s\.missing_count\)>=3/);
assert.match(api, /lm\.external_url[\s\S]*?image_source\.last_collected_at/);
assert.match(api, /operating_memo[\s\S]*?thumbnail/);
assert.match(api, /LIMIT 2000/);
assert.match(ui, /dashboardCard\("거래확인 후보"[\s\S]*?"transactions"\)/);
assert.match(ui, /window\.openTransactionCandidates = function/);
assert.match(ui, /window\.openTransactionCandidatePropertyV1 = function/);
assert.match(ui, /operations-transaction-detail-v2/);
assert.match(ui, /현재 광고 미노출 · 마지막 정상 사진/);
assert.match(ui, /window\.completeTransactionCandidateV1 = function/);
assert.match(ui, /apiPost\("toggleDone"/);
assert.doesNotMatch(ui, /openTransactionCandidatePropertyV1[\s\S]{0,500}window\.closeOperationsCenter\(\)/);
assert.match(css, /operations-transaction-detail-v2/);
assert.match(css, /operations-transaction-complete-v2/);
assert.match(html, /operations-center-v7\.js\?v=7\.22\.6-inline-transactions/);

console.log("transaction candidate list UI tests passed");
