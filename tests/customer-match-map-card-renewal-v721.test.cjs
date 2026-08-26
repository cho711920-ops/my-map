const assert = require("node:assert/strict");
const fs = require("node:fs");

const script = fs.readFileSync("js/script.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(
  script,
  /function isCustomerMatchMapCardV721\(item, customerMatchContextV719\)[\s\S]*?operationsMatchPropertyIds\.has\(customerMatchPropertyIdV721\)[\s\S]*?min-width: 769px/,
  "고객매칭 지도 카드만 PC에서 별도 리뉴얼되어야 합니다."
);
assert.match(script, /standard-card-grid-v661 customer-match-map-card-grid-v721/);
assert.match(script, /standard-card-main-v661 customer-match-map-card-main-v721/);
assert.match(script, /customer-match-map-actions-v721/);
assert.match(script, /customer-match-menu-toggle-v721[^>]*[\s\S]*?>메뉴</);
assert.match(script, /customerMatchMenuV721[\s\S]*?navButtonV721 \+ roadviewButtonV721 \+ menuRegisterButtonV721 \+ menuEditButtonV721/);
assert.doesNotMatch(script, /menuContactButtonV721/);
assert.match(script, /menuRegisterButtonV721[\s\S]*?>건축물대장<\/button>/);
assert.match(script, /menuEditButtonV721[\s\S]*?>수정하기<\/span>/);
assert.match(
  script,
  /customerMatchMapActionsV721 =[\s\S]*?actionContactButtonV654 \+ customerMatchMenuV721 \+ sourceLinkButton[\s\S]*?memoToggleButton \+ customerMatchControls/,
  "3번째 줄은 연락처, 메뉴, 원본 링크/동일매물, 메모, 후보/보류 순서여야 합니다."
);
assert.match(script, /customer-match-choice-v719 introduce/);
assert.match(script, /customer-match-choice-v719 hold/);
assert.match(script, /closeCustomerMatchCardMenusV721/);
assert.match(script, /applyCardStatusVisualV722\(nextStatus\)/);
assert.match(script, /applyCardStatusVisualV722\(currentStatus\)/);
assert.match(script, /open-upward-v722/);
assert.match(script, /reusableCard\.classList\.contains\("customer-match-map-card-v721"\) !== isCustomerMatchMapCardV721\(item\)/);

assert.match(
  css,
  /customer-match-map-card-main-v721 \.item-compact-actions-v650\.customer-match-map-actions-v721[\s\S]*?grid-template-columns:\s*minmax\(181px, 1fr\) 50px auto/,
  "고객매칭 지도 카드의 3번째 줄은 한 줄 고정 배치여야 합니다."
);
assert.match(css, /customer-match-menu-panel-v721\[hidden\][\s\S]*?display:\s*none !important/);
assert.match(css, /item-source-link-btn\.active:not\(\.unified-expand-btn-v8\)[\s\S]*?background:\s*#0877dc !important/);
assert.match(css, /item-source-link-btn\.unified-expand-btn-v8[\s\S]*?background:\s*#e7f8ed !important/);
assert.match(css, /customer-match-map-actions-v721 \.customer-match-choice-v719[\s\S]*?width:\s*54px !important/);
assert.match(css, /customer-match-map-status-overlay-v722[\s\S]*?background:\s*rgba\(246, 251, 255, \.58\)/);
assert.match(css, /customer-match-map-status-overlay-v722 > button[\s\S]*?animation:\s*customer-map-return-sparkle-v8031 1\.45s ease-in-out infinite/);
assert.match(css, /customer-match-map-card-v721\.customer-match-introduced[\s\S]*?border-left-color:\s*#dc2626 !important/);
assert.match(css, /customer-match-map-card-v721\.customer-match-held[\s\S]*?border-left-color:\s*#1f2937 !important/);
assert.match(html, /id="customerMatchMapStatusOverlayV722"/);
assert.match(html, /id="customerMatchMapStatusOverlayV722"[\s\S]*?>메인화면으로 돌아가기<\/button>/);
assert.match(html, /unified-listings-v8\.css\?v=8\.1\.35-transaction-check-emphasis/);
assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id/);

console.log("customer match map card renewal v7.21 tests passed");
