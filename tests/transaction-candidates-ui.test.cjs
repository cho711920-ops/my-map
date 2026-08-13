const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "cloudflare/src/d1-api.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "js/operations-center-v7.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(api, /"transactionCandidates"/);
assert.match(api, /HAVING SUM\(CASE WHEN s\.active=1 THEN 1 ELSE 0 END\)=0/);
assert.match(api, /MAX\(s\.missing_count\)>=3/);
assert.match(ui, /dashboardCard\("거래확인 후보"[\s\S]*?"transactions"\)/);
assert.match(ui, /window\.openTransactionCandidates = function/);
assert.match(ui, /window\.openTransactionCandidatePropertyV1 = function/);
assert.match(html, /operations-center-v7\.js\?v=7\.22\.4-overlay-exclusivity/);

console.log("transaction candidate list UI tests passed");
