const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mapSource = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(
  mapSource,
  /var jsDefaultMapCenterV6524 = \{\s*lat: 36\.3504,\s*lng: 127\.3845\s*\};/
);
assert.match(mapSource, /var jsDefaultMapLevelV6524 = 7;/);
assert.match(
  mapSource,
  /new kakao\.maps\.Map[\s\S]*?level: jsDefaultMapLevelV6524/
);
assert.match(
  scriptSource,
  /function resetFilter\(\)[\s\S]*?window\.resetToDaejeonOverviewV6524\(\);/
);
assert.match(indexSource, /js\/script\.js\?v=6\.5\.45-photo-prefetch/);
assert.match(indexSource, /js\/map\.js\?v=6\.5\.26-immediate-list/);

console.log("default Daejeon map view tests passed");
