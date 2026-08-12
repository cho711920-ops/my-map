const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
const unifiedCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const css = fs.readFileSync("css/style.css", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const listManager = fs.readFileSync("js/list-manager-v6.js", "utf8");
const collector = fs.readFileSync("cloudflare/src/collector-api.js", "utf8");

assert.match(html, /<title>J S 부 동 산<\/title>/);
assert.match(auth, /<h1 id="jsAuthTitle">JS부동산<\/h1>/);
assert.ok(html.indexOf('id="detailBtn"') < html.indexOf('id="topResetBtn"'));
assert.match(unifiedCss, /grid-template-columns:\s*92px minmax\(0, 1fr\) !important/);
assert.match(unifiedCss, /grid-template-columns:\s*minmax\(500px, 600px\) max-content !important/);
assert.match(css, /--cluster-fill:\s*rgba\(35, 132, 245, \.52\)/);
assert.match(css, /--cluster-text:\s*#ffffff/);
assert.match(script, /function buildCardActionIconV662\(type\)/);
assert.match(script, /function buildFavoriteStarIconV663\(active\)/);
assert.match(script, /item-memo-label-v728/);
assert.match(listManager, /id="lmNewPickerListName"/);
assert.match(listManager, /id="lmNewManagedListName"/);
assert.match(unifiedCss, /\.source-danggeun \{[\s\S]*?color:\s*#f26119 !important/);
assert.match(unifiedCss, /\.source-naver \{[\s\S]*?color:\s*#03a94f !important/);

assert.match(collector, /function uniqueUrls\(values\)/);
assert.match(collector, /raw\.url \|\| raw\.watermark \|\| raw\.thumbnail/);
assert.match(collector, /if \(output\.length >= 40\) break/);
assert.match(collector, /thumbnail:\s*record\.images\[0\] \|\| ""/);
assert.match(collector, /photoCount:\s*record\.images\.length/);

console.log("desktop card layout and Cloudflare media normalization tests passed");
