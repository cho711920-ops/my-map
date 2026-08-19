const assert = require("node:assert/strict");
const fs = require("node:fs");

const mapSource = fs.readFileSync("js/map.js", "utf8");
const scriptSource = fs.readFileSync("js/script.js", "utf8");
const htmlSource = fs.readFileSync("index.html", "utf8");

assert.match(mapSource, /function closeOpenListingDetailsForMapSelectionV6525\(\)/);
assert.match(
  mapSource,
  /function openCluster\(encodedKey\)[\s\S]*?jsMapUserNavigationIntentUntilV6525 = 0[\s\S]*?closeOpenListingDetailsForMapSelectionV6525\(\)[\s\S]*?selectedItemKey = null/
);
assert.match(
  mapSource,
  /JSUnifiedListingsV8\.close\(\)[\s\S]*?closeAiSidePanel\(\)/
);

assert.match(mapSource, /function markMapUserNavigationIntentV6525\(event\)/);
assert.match(mapSource, /target\.closest\("\.circle-marker"\)/);
assert.match(mapSource, /function shouldClearPinnedClusterForMapNavigationV6525\(\)/);
assert.match(mapSource, /document\.visibilityState === "hidden"[\s\S]*?return false/);
assert.match(mapSource, /classList\.contains\("roadview-modal-open"\)[\s\S]*?return false/);
assert.match(
  mapSource,
/addListener\(map, "dragstart"[\s\S]*?shouldClearPinnedClusterForMapNavigationV6525\(\)[\s\S]*?clearMapListSelectionForNavigationV6571\(\)[\s\S]*?keepPinnedClusterSelectionAcrossTransientUiV6525/
);
assert.match(
  mapSource,
/addListener\(map, "zoom_start"[\s\S]*?shouldClearPinnedClusterForMapNavigationV6525\(\)[\s\S]*?clearMapListSelectionForNavigationV6571\(\)[\s\S]*?keepPinnedClusterSelectionAcrossTransientUiV6525/
);
assert.match(
  mapSource,
  /document\.addEventListener\("visibilitychange"[\s\S]*?restorePinnedClusterSelectionAfterTransientUiV6525\(\)/
);
assert.match(
  scriptSource,
  /function openKakaoRoadview\(encodedKey\)[\s\S]*?keepPinnedClusterSelectionAcrossTransientUiV6525\(4000\)/
);
assert.match(
  scriptSource,
  /function closeRoadviewModal\(\)[\s\S]*?restorePinnedClusterSelectionAfterTransientUiV6525\(\)/
);

assert.match(htmlSource, /script\.js\?v=6\.10\.6-naver-history-deeplink/);
assert.match(htmlSource, /map\.js\?v=8\.2\.18-unique-linked-selection/);

console.log("cluster transient state v6.5.25 tests passed");
