const assert = require("node:assert/strict");
const fs = require("node:fs");

const script = fs.readFileSync("js/script.js", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(script, /verification-pending-v661">미확인/);
assert.match(script, /verification-done-v661">확인/);
assert.match(script, /function isConfirmedVisitItem\(item\)/);
assert.match(script, /item\.memo = markFieldVisitConfirmedInMemo\(item\.memo \|\| ""\)/);
assert.match(script, /standard-card-grid-v661/);
assert.match(script, /standard-card-main-v661/);
assert.match(script, /customerMatchControls \? unifiedCardPartsV8\.badge : ''/);
assert.match(script, /var favoriteHeaderButtonV661 = "";/);
assert.doesNotMatch(script, /favoriteHeaderButtonV661 = !customerMatchControls/);
assert.match(script, /buildCardActionIconV662\('roadview'\)/);
assert.match(script, /buildCardActionIconV662\('settings'\)/);
assert.doesNotMatch(script, /buildMemoEmojiIconV664\(\)/);
assert.match(script, /div\.onpointerenter = function\(\)/);
assert.match(script, /JSUnifiedListingsV8\.prefetch/);
assert.match(script, /toggle\.innerHTML = '<span class="item-memo-label-v728">'/);
assert.match(script, /toggle\.setAttribute\("aria-label", "메모 " \+ \(isOpen \? "닫기" : "열기"\)\)/);

assert.match(unified, /masterMeta:\s*\{\}/);
assert.match(unified, /regDate:\s*text\(item\.regDate\)/);
assert.match(unified, /unified-detail-meta-v8/);
assert.match(unified, /동일매물 ' \+ count \+ '개/);
assert.doesNotMatch(unified, /원본 ' \+ count \+ '개 펼치기/);

assert.match(
  css,
  /\.standard-card-main-v661\s*\{[^}]*grid-template-rows:\s*minmax\(26px, auto\) minmax\(30px, auto\) 29px/s
);
assert.match(
  css,
  /\.standard-card-main-v661 \.item-compact-actions-v650\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 34px[^}]*overflow:\s*visible/s
);
assert.match(css, /\.verification-pending-v661\s*\{[^}]*background:\s*#ffe476/s);
assert.match(css, /\.verification-done-v661\s*\{[^}]*background:\s*#dff7e8/s);
assert.match(css, /\.standard-card-main-v661 \.item-head-favorite-v661\.on\s*\{[^}]*color:\s*#f1b900/s);
assert.match(css, /\.standard-card-main-v661 \.item-action-text-v661\s*\{[^}]*display:\s*none/s);
assert.match(css, /\.standard-card-main-v661 \.item-action-emoji-v661\s*\{[^}]*display:\s*inline/s);
assert.match(css, /grid-template-columns:\s*32px 44px 56px 44px 44px 104px/);
assert.match(css, /\.item-nav-btn \.item-action-text-v661,[\s\S]*?display:\s*inline !important/);
assert.match(css, /\.unified-expand-btn-v8 \{[\s\S]*?background:\s*#e7f8ed !important;[\s\S]*?font-size:\s*12\.5px !important/);

assert.match(html, /unified-listings-v8\.css\?v=8\.1\.40-smooth-photo-expand/);
assert.match(html, /unified-listings-v8\.js\?v=8\.1\.40-smooth-photo-expand/);
assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id/);

console.log("main listing three-line v6.6.1 tests passed");
