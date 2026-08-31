const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");

assert.match(script, /window\.navermap_authFailure = function\(\)/);
assert.match(script, /showNaverMapsAuthFallbackV663\(\)/);
assert.match(script, /destroyNaverRoadviewMapV654\(\)/);
assert.match(script, /classList\.add\("naver-map-auth-failed-v663"\)/);
assert.match(script, /mapPanel\.setAttribute\("aria-hidden", "true"\)/);
assert.match(script, /function recoverNaverMapsAuthStateV664\(\)/);
assert.match(script, /naverMapsAuthFailedV663 = false/);
assert.match(script, /classList\.remove\("naver-map-auth-failed-v663"\)/);
assert.match(script, /mapPanel\.removeAttribute\("aria-hidden"\)/);
assert.match(script, /if \(panoramaPosition && !naverMapsAuthFailedV663\)/);
assert.match(script, /var naverMapsNamespaceV663 = null/);
assert.match(script, /new mapsNamespace\.Size\(/);
assert.match(
  css,
  /\.naver-roadview-split-v654\.naver-map-auth-failed-v663[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/
);
assert.match(
  css,
  /\.naver-map-auth-failed-v663 > \.naver-roadview-map-panel-v654[\s\S]*?display:\s*none/
);
assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id/);
assert.match(html, /unified-listings-v8\.css\?v=8\.1\.39-live-merge-status/);

console.log("NAVER map authentication fallback v6.5.64 tests passed");
