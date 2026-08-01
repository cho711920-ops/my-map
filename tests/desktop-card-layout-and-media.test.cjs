const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
const unifiedCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const css = fs.readFileSync("css/style.css", "utf8");
const naver = fs.readFileSync("js/naver-collector.js", "utf8");
const daangn = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_당근수집기_v2_개별및클러스터.gs",
  "utf8"
);

assert.match(html, /<title>J S 부 동 산<\/title>/);
assert.match(html, /<div class="header">J S 부 동 산<\/div>/);
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

console.log("desktop card layout and media normalization tests passed");
