const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js", "operations-collection-v8.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(source, /repairing:\s*false/);
assert.match(source, /기존매물 1건 자동합치기/);
assert.match(source, /mergeSingleCandidateReviews/);
assert.match(source, /대표매물의 주소·가격·면적·대표사진은 변경하지 않았습니다/);
assert.match(source, /자동분류 정리 진행 중/);
assert.match(source, /onclick="repairRoomlessExactReviews\(\)">자동분류 정리/);
assert.match(source, /남은 자동검사/);
assert.match(html, /7\.26\.1-review-audit/);

console.log("review classification progress UI: ok");
