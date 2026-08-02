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
assert.match(script, /customerMatchMenuV721[\s\S]*?menuContactButtonV721 \+ navButtonV721 \+ roadviewButtonV721 \+ registerButtonV721 \+ editButtonV721/);
assert.match(
  script,
  /customerMatchMapActionsV721 =[\s\S]*?customerMatchMenuV721 \+ sourceLinkButton[\s\S]*?memoToggleButton \+ customerMatchControls/,
  "3번째 줄은 메뉴, 원본 링크/동일매물, 메모, 후보/보류 순서여야 합니다."
);
assert.match(script, /customer-match-choice-v719 introduce/);
assert.match(script, /customer-match-choice-v719 hold/);
assert.match(script, /closeCustomerMatchCardMenusV721/);
assert.match(script, /reusableCard\.classList\.contains\("customer-match-map-card-v721"\) !== isCustomerMatchMapCardV721\(item\)/);

assert.match(
  css,
  /customer-match-map-card-main-v721 \.item-compact-actions-v650\.customer-match-map-actions-v721[\s\S]*?grid-template-columns:\s*minmax\(146px, 1fr\) 50px auto/,
  "고객매칭 지도 카드의 3번째 줄은 한 줄 고정 배치여야 합니다."
);
assert.match(css, /customer-match-menu-panel-v721\[hidden\][\s\S]*?display:\s*none !important/);
assert.match(css, /item-source-link-btn\.active:not\(\.unified-expand-btn-v8\)[\s\S]*?background:\s*#0877dc !important/);
assert.match(css, /item-source-link-btn\.unified-expand-btn-v8[\s\S]*?background:\s*#e7f8ed !important/);
assert.match(css, /customer-match-map-actions-v721 \.customer-match-choice-v719[\s\S]*?width:\s*54px !important/);
assert.match(html, /unified-listings-v8\.css\?v=8\.0\.28-customer-match-map-menu/);
assert.match(html, /script\.js\?v=6\.5\.50-customer-match-map-menu/);

console.log("customer match map card renewal v7.21 tests passed");
