const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const queue = fs.readFileSync("js/async-mutation-queue-v1.js", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");

assert.match(queue, /lastSavingCount > 0 && saving === 0 && failed === 0/);
assert.match(queue, /async-mutation-status-v1 completed/);
assert.match(queue, /indicator\.hidden = true/);
assert.match(html, /id="asyncMutationStatusV1"[^>]*hidden/);
assert.match(css, /\.unified-detail-drawer-v8 \{[\s\S]*?top: 68px;[\s\S]*?bottom: 0;/);
assert.match(css, /width: min\(420px, calc\(100vw - 650px\)\)/);
assert.match(unified, /function runDetailAction\(action, encodedPropertyId\)/);
assert.match(unified, /function loadDetail\(propertyId\)/);
assert.match(unified, /if \(state\.detailPending\[propertyId\]\) return state\.detailPending\[propertyId\]/);
assert.match(unified, /function scheduleDetailWarmup\(items\)/);
assert.match(unified, /detailRequestToken: 0/);
assert.match(unified, /requestToken !== state\.detailRequestToken/);

assert.match(d1, /async function unifiedDetail\(env, propertyId\)/);
assert.match(d1, /FROM listing_sources WHERE listing_id = \?1 AND active = 1/);
assert.match(d1, /FROM listing_media WHERE listing_id = \?1 AND status <> 'deleted'/);
assert.match(d1, /const originals = \(sourceResult\?\.results \|\| \[\]\)\.map/);
assert.match(d1, /snapshot\.photoCount = Math\.max\(images\.length/);
assert.match(d1, /masterFallbackOriginal\(master, fallbackImages\)/);

const quickToolsStart = html.indexOf('<aside id="mapQuickTools"');
const quickToolsEnd = html.indexOf("</aside>", quickToolsStart);
const roadview = html.indexOf('id="mapRoadviewSelectBtn"');
assert.ok(quickToolsStart >= 0 && roadview > quickToolsStart && roadview < quickToolsEnd);

console.log("desktop status and D1 detail layout tests passed");
