const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
const unifiedCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const css = fs.readFileSync("css/style.css", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const listManager = fs.readFileSync("js/list-manager-v6.js", "utf8");
const listManagerCss = fs.readFileSync("css/list-manager-v6.css", "utf8");
const naver = fs.readFileSync("js/naver-collector.js", "utf8");
const daangn = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_당근수집기_v2_개별및클러스터.gs",
  "utf8"
);

assert.match(html, /<title>J S 부 동 산<\/title>/);
assert.match(html, /<div class="header">J S 부 동 산<\/div>/);
assert.ok(html.indexOf('id="detailBtn"') < html.indexOf('id="topResetBtn"'), "filter must appear before reset");
assert.match(auth, /<h1>J S 부 동 산<\/h1>/);
assert.match(unifiedCss, /grid-template-columns:\s*92px minmax\(0, 1fr\) !important/);
assert.match(unifiedCss, /grid-template-columns:\s*minmax\(500px, 600px\) max-content !important/);
assert.match(css, /\.customer-match-card-actions-v653 \{[\s\S]*?grid-template-rows:\s*22px 22px/);
assert.match(css, /\.customer-match-card-actions-v653 \.customer-match-inline-actions \{[\s\S]*?grid-row:\s*1/);
assert.match(css, /\.customer-match-card-actions-v653 \.item-action-left \{[\s\S]*?grid-row:\s*2/);
assert.match(css, /--cluster-fill:\s*rgba\(35, 132, 245, \.52\)/);
assert.match(css, /--cluster-text:\s*#ffffff/);
assert.doesNotMatch(unifiedCss, /^\s*\.source-gongsil\s*\{[^}]*color:/m);
assert.match(daangn, /image\.url \|\| image\.watermark \|\| image\.thumbnail/);
assert.doesNotMatch(daangn, /add\(image && image\.thumbnail\)/);
assert.match(daangn, /return urls\.slice\(0, 20\)/);
assert.match(naver, /function variantKey\(url\)/);
assert.match(naver, /return parsed\.origin \+ parsed\.pathname/);
assert.match(naver, /var mergedImages = finImageUrls\(/);
assert.match(script, /function buildCardActionIconV662\(type\)/);
assert.match(script, /phone: '<svg/);
assert.match(script, /roadview: '<svg/);
assert.match(script, /navigation: '<svg/);
assert.match(script, /settings: '<svg/);
assert.doesNotMatch(script, /function buildMemoEmojiIconV664\(\)/);
assert.match(script, /item-memo-label-v728/);
assert.match(script, /item-elevator-person-v662/);
assert.match(script, /item-elevator-divider-v665/);
assert.match(script, /M7 10V5m-2 2 2-2 2 2m-2 7v5/);
assert.match(script, /function buildFavoriteStarIconV663\(active\)/);
assert.match(script, /var quickTools = document\.getElementById\("mapQuickTools"\)/);
assert.match(script, /favorite-star-icon-v663/);
assert.ok(
  script.indexOf("item-edit-btn-v630") < script.indexOf("sourceLinkButton +", script.indexOf("item-edit-btn-v630")),
  "edit button must appear before the same-listing button"
);
assert.match(listManager, /id="lmNewPickerListName"/);
assert.match(listManager, /createList\(currentManagerType, itemKey, nameInput && nameInput\.value\)/);
assert.match(listManager, /id="lmNewManagedListName"/);
assert.match(listManager, /window\.togglePickerListItem = function \(input\)/);
assert.match(listManager, /onchange="togglePickerListItem\(this\)"/);
assert.match(listManager, /onclick="closeItemListPicker\(\)">완료/);
assert.match(listManagerCss, /\.lm-new-inline-form/);
assert.match(listManagerCss, /\.lm-manager-create-form/);
assert.match(listManager, /response\.json\(\)/);
assert.match(listManager, /js_list_sync_dirty_v6_/);
assert.match(unifiedCss, /grid-template-rows:\s*108px !important/);
assert.match(unifiedCss, /\.unified-expand-btn-v8 \{[\s\S]*?width:\s*88px !important/);
assert.match(unifiedCss, /\.source-danggeun \{[\s\S]*?color:\s*#f26119 !important/);
assert.match(unifiedCss, /\.source-naver \{[\s\S]*?color:\s*#03a94f !important/);
assert.match(unifiedCss, /column-gap:\s*12px !important/);
assert.match(unifiedCss, /column-gap:\s*10px !important/);
assert.match(unifiedCss, /grid-template-columns:\s*32px 32px 32px 32px 32px 94px !important/);
assert.match(unifiedCss, /grid-template-columns:\s*minmax\(0, 1fr\) 32px !important/);
assert.match(unifiedCss, /\.item-memo-toggle \.item-action-emoji-v664/);
assert.match(unifiedCss, /gap:\s*6px !important/);
assert.match(unifiedCss, /font-size:\s*15\.5px !important/);
assert.match(unifiedCss, /font-size:\s*14px !important/);

console.log("desktop card layout and media normalization tests passed");
