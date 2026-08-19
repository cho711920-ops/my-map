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
assert.match(mapSource, /var jsLegacyDefaultMapLevelV690 = 7;/);
assert.match(
  mapSource,
  /new kakao\.maps\.Map[\s\S]*?level: shouldUseWorldGridClustersV690\(\)[\s\S]*?jsDefaultMapLevelV6524[\s\S]*?jsLegacyDefaultMapLevelV690/
);
assert.match(
  mapSource,
  /function relayoutMapPreservingCenterV690[\s\S]*?map\.relayout\(\);[\s\S]*?map\.setCenter\(center\)/
);
assert.match(
  mapSource,
  /function setupMapViewportRelayoutV690[\s\S]*?new ResizeObserver\(scheduleRelayout\)[\s\S]*?\[0, 140, 480\]/
);
assert.match(
  mapSource,
  /kakao\.maps\.load[\s\S]*?setupMapViewportRelayoutV690\(mapElementV6525\)/
);
assert.match(
  scriptSource,
  /function resetFilter\(\)[\s\S]*?window\.resetToDaejeonOverviewV6524\(\);/
);
assert.match(indexSource, /js\/script\.js\?v=6\.10\.4-filter-chips-selection/);
assert.match(indexSource, /js\/map\.js\?v=8\.2\.16-fast-cache-snapshot/);

console.log("default Daejeon map view tests passed");
