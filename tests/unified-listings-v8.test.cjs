const assert = require("node:assert/strict");
const fs = require("node:fs");

const ui = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
const collector = fs.readFileSync("cloudflare/src/collector-api.js", "utf8");
const naver = fs.readFileSync("js/naver-collector.js", "utf8");
const gongsil = fs.readFileSync("js/gongsil-collector.js", "utf8");

assert.match(ui, /원본 링크 ↗/);
assert.match(ui, /별도 매물 분리/);
assert.match(ui, /원본 1개 합치기/);
assert.match(ui, /대표 전체 합치기/);
assert.match(ui, /unified-detail-source-row-v827[\s\S]*?unified-detail-source-link-v827[\s\S]*?unified-detail-actions-v8/);
assert.match(ui, /function openExternalLink\(encodedLink\)/);
assert.match(ui, /통합 저장·D1 확인 중입니다/);
assert.match(ui, /function originalImages\(original\)/);
assert.match(ui, /sourceUnavailable/);
assert.match(ui, /광고 미노출 · 확인 필요/);
assert.match(ui, /function detailDisplayImageUrl\(url\)/);
assert.match(ui, /function preloadDetailImage\(url, highPriority\)/);
assert.match(ui, /function preloadAdjacentDetailImages\(images, index\)/);
assert.match(ui, /images\[1\]/);
assert.match(ui, /images\[images\.length - 1\]/);
assert.match(ui, /function bindPhotoSwipe\(element, onStep\)/);
assert.doesNotMatch(ui, /slice\(1, 7\)/);
assert.match(ui, /s=960x960/);
assert.match(ui, /function stepDetailPhoto\(button, direction\)/);
assert.match(ui, /function loadTellContacts\(query\)/);
assert.match(ui, /function getCachedTellContacts\(query\)/);
assert.match(ui, /referrerpolicy="no-referrer"/);
assert.match(css, /unified-detail-drawer-v8\.open/);
assert.match(css, /unified-detail-actions-v8 \{ display: flex; flex-wrap: nowrap/);
assert.match(css, /unified-detail-source-link-v827/);
assert.match(css, /unified-detail-source-row-v827 \{[^}]*gap: 18px/);
assert.match(css, /unified-gallery-nav-v8/);
assert.match(css, /async-mutation-status-v1\.idle \{ display: none/);

assert.match(d1, /async function unifiedDetail\(env, propertyId\)/);
assert.match(d1, /unavailableRows/);
assert.match(d1, /HAVING SUM\(CASE WHEN s\.active=1 THEN 1 ELSE 0 END\)=0 AND MAX\(s\.missing_count\)>=3/);
assert.match(d1, /sourceUnavailable/);
assert.match(d1, /async function listingContacts\(env, propertyId\)/);
assert.match(d1, /async function moveOriginal\(env, user, body\)/);
assert.match(d1, /UPDATE listing_sources SET listing_id=\?1/);
assert.match(d1, /UPDATE listing_media SET listing_id=\?1/);
assert.match(d1, /UPDATE listing_contacts SET listing_id=\?1/);
assert.match(d1, /INSERT INTO listing_history/);
assert.match(d1, /source:\s*"D1"/);

assert.match(collector, /function uniqueUrls\(values\)/);
assert.match(collector, /thumbnail:\s*record\.images\[0\] \|\| ""/);
assert.match(naver, /function finImageUrls/);
assert.match(gongsil, /function collectMediaUrls/);

console.log("unified listings UI and D1 persistence tests passed");
