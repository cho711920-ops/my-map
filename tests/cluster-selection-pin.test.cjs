const assert = require("node:assert/strict");
const fs = require("node:fs");

const mapSource = fs.readFileSync("js/map.js", "utf8");
const scriptSource = fs.readFileSync("js/script.js", "utf8");
const operationsSource = fs.readFileSync("js/operations-center-v7.js", "utf8");
const htmlSource = fs.readFileSync("index.html", "utf8");

assert.match(mapSource, /var jsPinnedClusterSelectionV6515 = null;/);
assert.match(mapSource, /pinCurrentClusterSelectionV6515\(\);\s*redrawSelectedMarkers\(\);/);
assert.match(
  mapSource,
  /var pinnedItems = getPinnedClusterItemsV6515\(\);\s*showList\(pinnedItems\.length\s*\? pinnedItems\s*:\s*getAdministrativeListItemsV6570\(jsLastRenderedItemsV639\)\);/
);
assert.match(mapSource, /addListener\(map, "dragstart"[\s\S]*?clearPinnedClusterSelectionV6515\(true\)/);
assert.match(mapSource, /addListener\(map, "zoom_start"[\s\S]*?clearPinnedClusterSelectionV6515\(true\)/);
assert.match(
  mapSource,
  /jsPinnedClusterSelectionV6515\.spatialKey !== getMapSpatialKeyV6515\(\)[\s\S]*?jsPinnedClusterSpatialChangeIgnoreUntilV6517[\s\S]*?clearPinnedClusterSelectionV6515\(true\)/
);
assert.match(scriptSource, /function resetFilter\(\)[\s\S]*?clearPinnedClusterSelectionV6515\(false\)/);
assert.match(
  scriptSource,
  /function applyFilter\(\)[\s\S]*?getPinnedClusterItemsV6515\(\)[\s\S]*?선택 매물/
);
assert.match(
  operationsSource,
  /window\.showSelectedCustomerMatchesOnMap = function\(\) \{[\s\S]*?clearPinnedClusterSelectionV6515\(true\)/
);
assert.match(
  operationsSource,
  /window\.clearCustomerMatchMapFilter = function\(\) \{[\s\S]*?clearPinnedClusterSelectionV6515\(true\)/
);
assert.match(htmlSource, /js\/map\.js\?v=8\.2\.16-fast-cache-snapshot/);
assert.match(htmlSource, /js\/script\.js\?v=6\.10\.4-filter-chips-selection/);
assert.match(htmlSource, /js\/operations-center-v7\.js\?v=7\.22\.5-shared-data-only/);

console.log("cluster selection pin tests passed");
