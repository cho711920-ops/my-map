const assert = require("node:assert/strict");
const fs = require("node:fs");

const script = fs.readFileSync("js/script.js", "utf8");
const css = fs.readFileSync("css/operations-center-v7.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

assert.match(script, /item-memo-label-v728/);
assert.match(script, /memoOpen \? '메모 ▲' : '메모 ▼'/);
assert.match(script, /isOpen \? '메모 ▲' : '메모 ▼'/);
assert.doesNotMatch(script, /buildMemoEmojiIconV664/);
assert.match(script, /toggleItemMemo\([^\n]+encodedKey[^\n]+this\)/);
assert.match(script, /var activeMemoCardV728 = null/);
assert.match(script, /function getMemoCardV655\(key, preferredCard\)/);

assert.match(css, /메인·고객매칭·고객지도 메모 버튼 공통 규격/);
assert.match(css, /\.item-memo-toggle \.item-memo-label-v728\s*\{[^}]*display:inline-flex!important/s);
assert.match(css, /\.standard-card-main-v661 \.item-compact-actions-v650>\.item-memo-toggle,[\s\S]*?#list \.customer-match-map-card-main-v721[\s\S]*?#operationsCustomersPanel[\s\S]*?width:52px!important/);
assert.match(css, /\.item-memo-toggle:after\{content:none!important;display:none!important\}/);
assert.match(html, /operations-center-v7\.css\?v=7\.20\.5-unified-memo-toggle/);
assert.match(html, /script\.js\?v=6\.5\.61-confirmed-visit-shimmer/);

console.log("unified memo toggle v7.28 tests passed");
