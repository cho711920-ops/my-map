const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const css = fs.readFileSync(
  path.join(root, "css", "unified-listings-v8.css"),
  "utf8"
);

assert.match(html, /class="naver-roadview-split-v654"/);
assert.match(html, /id="naverRoadviewContainer"/);
assert.match(html, /id="naverRoadviewMapV654"/);
assert.match(html, /파란 도로를 누르면 해당 위치의 거리뷰로 이동합니다/);

assert.match(script, /new window\.naver\.maps\.Map\(mapContainer,/);
assert.match(script, /new window\.naver\.maps\.StreetLayer\(\)/);
assert.match(script, /new window\.naver\.maps\.Panorama\(container,/);
assert.match(script, /"pano_changed"[\s\S]*?updateNaverRoadviewMapV654\(true\)/);
assert.match(script, /"pov_changed"[\s\S]*?updateNaverRoadviewDirectionV654\(\)/);
assert.match(
  script,
  /Event\.addListener\(naverRoadviewMapV654, "click"[\s\S]*?setPosition\(event\.coord\)/
);
assert.match(script, /naver-roadview-direction-marker-v654/);
assert.match(script, /naver-roadview-target-marker-v654/);
assert.match(script, /syncNaverRoadviewLayoutV654/);

assert.match(
  css,
  /\.naver-roadview-split-v654[\s\S]*?grid-template-columns:\s*minmax\(0, 2fr\) minmax\(320px, 1fr\)/
);
assert.match(css, /#naverRoadviewContainer img\.arrow_image[\s\S]*?drop-shadow/);
assert.match(
  css,
  /@media \(max-width: 768px\)[\s\S]*?\.naver-roadview-map-panel-v654\s*\{[\s\S]*?display:\s*none/
);

assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id/);
assert.match(html, /unified-listings-v8\.css\?v=8\.1\.36-contract-complete-label/);

console.log("NAVER split roadview v6.5.54 tests passed");
