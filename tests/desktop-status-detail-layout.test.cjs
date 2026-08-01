const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const queue = fs.readFileSync("js/async-mutation-queue-v1.js", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);

assert.match(queue, /lastSavingCount > 0 && saving === 0 && failed === 0/);
assert.match(queue, /async-mutation-status-v1 completed/);
assert.match(queue, /setTimeout\(function\(\) \{[\s\S]*?async-mutation-status-v1 idle[\s\S]*?\}, 3000\)/);
assert.match(queue, /indicator\.hidden = true/);
assert.match(html, /id="asyncMutationStatusV1"[^>]*hidden/);
assert.match(css, /\.async-mutation-status-v1 \{[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
assert.match(css, /v6-toolbar-secondary\.v6-command-bar > \.async-mutation-status-v1\[hidden\]/);

assert.match(unified, /document\.querySelector\("\.filters"\)/);
assert.match(unified, /toolbar\.getBoundingClientRect\(\)\.bottom/);
assert.match(css, /\.unified-detail-drawer-v8 \{[\s\S]*?top: 68px;[\s\S]*?bottom: 0;/);

assert.match(backend, /images: imageUrls\.slice\(\)/);
assert.match(backend, /if \(index > 0\) delete original\.images/);
assert.match(backend, /leftPriority - rightPriority/);
assert.match(unified, /Array\.isArray\(selected\.images\)[\s\S]*?selected\.images\.length >=/);
assert.match(unified, /var preload = new Image\(\)/);

const quickToolsStart = html.indexOf('<aside id="mapQuickTools"');
const quickToolsEnd = html.indexOf("</aside>", quickToolsStart);
const roadview = html.indexOf('id="mapRoadviewSelectBtn"');
assert.ok(quickToolsStart >= 0 && quickToolsEnd > quickToolsStart);
assert.ok(roadview > quickToolsStart && roadview < quickToolsEnd, "로드뷰 선택은 지도 세로 도구 안에 있어야 합니다.");
assert.equal(html.match(/id="mapRoadviewSelectBtn"/g).length, 1);
assert.match(css, /\.map-roadview-vertical-v8 \{/);
assert.match(css, /grid-template-columns: 80px 80px 58px 94px 104px/);
assert.match(css, /grid-template-columns: 48px 48px 42px 66px 74px/);

console.log("desktop status/detail layout tests passed");
