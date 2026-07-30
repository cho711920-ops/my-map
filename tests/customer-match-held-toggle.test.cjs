const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const operations = fs.readFileSync(path.join(root, "js", "operations-center-v7.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");

assert.match(
  html,
  /id="customerMatchHeldToggleV1"[\s\S]*onclick="toggleCustomerMatchHeldV1\(\)"[\s\S]*hidden>보류<\/button>/,
  "고객매칭 지도 세로도구에 기본 숨김 보류 버튼이 있어야 합니다."
);
assert.match(
  script,
  /customerMatchStatus !== "보류"\s*\|\|\s*!!window\.customerMatchHeldVisibleV1/,
  "보류 매물은 토글이 켜졌을 때만 필터를 통과해야 합니다."
);
assert.match(
  operations,
  /window\.customerMatchHeldVisibleV1 = false;[\s\S]*syncCustomerMatchHeldToggleV1\(\);/,
  "고객매칭 지도 진입 시 보류 표시 상태를 꺼야 합니다."
);
assert.match(
  operations,
  /window\.toggleCustomerMatchHeldV1 = function\(\)[\s\S]*window\.customerMatchHeldVisibleV1 = !window\.customerMatchHeldVisibleV1;[\s\S]*window\.applyFilter\(\)/,
  "보류 버튼은 상태를 반전하고 지도와 목록을 다시 그려야 합니다."
);
assert.match(
  css,
  /\.customer-match-held-toggle-v1\s*\{[^}]*background:\s*#334155/s,
  "비활성 보류 버튼은 어두운색이어야 합니다."
);
assert.match(
  css,
  /\.customer-match-held-toggle-v1\.on\s*\{[^}]*background:\s*#f59e0b/s,
  "활성 보류 버튼은 눈에 띄는 색이어야 합니다."
);

console.log("customer match held toggle tests passed");
