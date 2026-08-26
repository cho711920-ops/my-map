const assert = require("node:assert/strict");
const fs = require("node:fs");

const mapSource = fs.readFileSync("js/map.js", "utf8");
const analysisSource = fs.readFileSync("js/analysis.js", "utf8");
const scriptSource = fs.readFileSync("js/script.js", "utf8");
const htmlSource = fs.readFileSync("index.html", "utf8");

assert.match(
  mapSource,
  /function preservePinnedClusterSelectionDuringRelayoutV6517\(durationMs\)[\s\S]*?Date\.now\(\) \+ keepMs/
);
assert.match(
  mapSource,
  /function openItem\(item\) \{[\s\S]*?preservePinnedClusterSelectionDuringRelayoutV6517\(1500\)/
);
assert.match(
  mapSource,
  /function openItem\(item\) \{[\s\S]*?getPinnedClusterItemsV6515\(\)[\s\S]*?선택 매물 [\s\S]*?스마트 매물카드/
);
assert.match(
  mapSource,
  /Date\.now\(\) <= jsPinnedClusterSpatialChangeIgnoreUntilV6517[\s\S]*?jsPinnedClusterSelectionV6515\.spatialKey = getMapSpatialKeyV6515\(\)/
);
assert.match(
  analysisSource,
  /function relayoutMapAfterAiPanel\(\) \{[\s\S]*?preservePinnedClusterSelectionDuringRelayoutV6517\(1500\)[\s\S]*?map\.relayout\(\)/
);
assert.match(
  analysisSource,
  /function closeAiSidePanel\(\) \{[\s\S]*?getPinnedClusterItemsV6515\(\)[\s\S]*?선택 매물/
);
assert.match(
  mapSource,
  /addListener\(map, "dragstart"[\s\S]*?clearMapListSelectionForNavigationV6571\(\)/
);
assert.match(
  mapSource,
  /addListener\(map, "zoom_start"[\s\S]*?clearMapListSelectionForNavigationV6571\(\)/
);
assert.match(htmlSource, /analysis\.js\?v=6\.3\.41-unique-linked-selection/);
assert.match(htmlSource, /map\.js\?v=8\.2\.20-transaction-check-cluster/);
assert.match(htmlSource, /script\.js\?v=6\.10\.8-favorite-property-id/);
assert.match(scriptSource, /더블클릭하면 스마트 매물카드 열기/);
assert.match(
  scriptSource,
  /div\.ondblclick = function\(event\) \{[\s\S]*?event\.target\.closest\("button, input, label, a, textarea, select, \.item-memo-panel"\)[\s\S]*?openItem\(item\)/
);
assert.doesNotMatch(
  scriptSource,
  /div\.onclick = function\(\) \{\s*openItem\(item\)/
);

console.log("smart card cluster pin tests passed");
