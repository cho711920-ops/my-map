const assert = require("node:assert/strict");
const fs = require("node:fs");

const mapSource = fs.readFileSync("js/map.js", "utf8");
const scriptSource = fs.readFileSync("js/script.js", "utf8");
const htmlSource = fs.readFileSync("index.html", "utf8");

assert.match(
  mapSource,
  /function preservePinnedClusterSelectionDuringRelayoutV6517\(durationMs\)[\s\S]*?Date\.now\(\) \+ keepMs/
);


assert.match(
  mapSource,
  /Date\.now\(\) <= jsPinnedClusterSpatialChangeIgnoreUntilV6517[\s\S]*?jsPinnedClusterSelectionV6515\.spatialKey = getMapSpatialKeyV6515\(\)/
);


assert.match(
  mapSource,
  /addListener\(map, "dragstart"[\s\S]*?clearMapListSelectionForNavigationV6571\(\)/
);
assert.match(
  mapSource,
  /addListener\(map, "zoom_start"[\s\S]*?clearMapListSelectionForNavigationV6571\(\)/
);
assert.match(htmlSource, /map\.js\?v=8\.2\.22-full-initial-render/);
assert.match(htmlSource, /script\.js\?v=6\.10\.8-favorite-property-id/);

assert.doesNotMatch(
  scriptSource,
  /div\.onclick = function\(\) \{\s*openItem\(item\)/
);

console.log("cluster relayout pin tests passed");
