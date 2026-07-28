const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "js", "naver-collector.js"),
  "utf8"
);

assert.match(source, /FIN_ARTICLE_KEY_PATH = "\/front-api\/v1\/article\/key"/);
assert.match(source, /FIN_ARTICLE_BASIC_PATH = "\/front-api\/v1\/article\/basicInfo"/);
assert.match(source, /async function enrichNaverDetailBatch/);
assert.match(source, /hasExactNaverJibun/);
assert.match(source, /hasExactNaverFloorOrRoom/);
assert.match(source, /정확한 지번과 실제 층을 확인한 매물만 중복검사에 전달합니다/);
assert.match(source, /addressMissing: totals\.addressMissing/);
assert.doesNotMatch(
  source,
  /detailed\.listSnapshot\s*=\s*naverListSnapshot/,
  "상세주소를 목록 스냅샷에 섞으면 매일 모든 매물을 다시 상세조회하게 됩니다."
);

console.log("naver detail location tests passed");
