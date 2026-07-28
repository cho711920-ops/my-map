const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "js", "naver-collector.js"),
  "utf8"
);

assert.match(source, /FIN_ARTICLE_KEY_PATH = "\/front-api\/v1\/article\/key"/);
assert.match(source, /FIN_ARTICLE_BASIC_PATH = "\/front-api\/v1\/article\/basicInfo"/);
assert.match(source, /async function enrichNaverDetailBatch/);
assert.match(source, /hasExactNaverJibun/);
assert.match(source, /hasExactNaverFloorOrRoom/);
assert.match(source, /function finExactAddressText/);
assert.match(source, /keyResult\.address/);
assert.match(source, /유형이 이미 있어도 key API를 항상 조회/);
assert.match(source, /정확한 지번과 실제 층을 확인한 매물만 중복검사에 전달합니다/);
assert.match(source, /addressMissing: totals\.addressMissing/);
assert.doesNotMatch(
  source,
  /detailed\.listSnapshot\s*=\s*naverListSnapshot/,
  "상세주소를 목록 스냅샷에 섞으면 매일 모든 매물을 다시 상세조회하게 됩니다."
);

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const next = source.indexOf("\n  function ", start + 10);
  return source.slice(start, next < 0 ? source.length : next);
}

const addressContext = {};
vm.createContext(addressContext);
vm.runInContext(
  [
    "function clean(value) { return String(value == null ? '' : value).trim(); }",
    functionSource("hasExactNaverJibun"),
    functionSource("finAddressText"),
    functionSource("finExactAddressText"),
    "result = {",
    "  keyOnly: finExactAddressText('대전광역시 서구 둔산동', {jibun:'1000'}, {}),",
    "  fullKey: finExactAddressText('', {city:'대전광역시', division:'서구', sector:'둔산동', jibun:'1000-1'}, {}),",
    "  liKey: finExactAddressText('대전광역시 유성구', {li:'봉명동', jibun:'12-3'}, {})",
    "};"
  ].join("\n"),
  addressContext
);
assert.equal(addressContext.result.keyOnly, "대전광역시 서구 둔산동 1000");
assert.equal(addressContext.result.fullKey, "대전광역시 서구 둔산동 1000-1");
assert.equal(addressContext.result.liKey, "대전광역시 유성구 봉명동 12-3");

console.log("naver detail location tests passed");
