const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mapSource = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");

assert.match(scriptSource, /function getFilteredItems\(options\)/);
assert.match(scriptSource, /!item\.latlng \? includeUnlocated : bounds\.contain\(item\.latlng\)/);
assert.match(
  mapSource,
  /allItems = rawItems;[\s\S]*?getFilteredItems\(\{ includeUnlocated: true \}\);[\s\S]*?geocodeItems\(rawItems/
);
assert.doesNotMatch(mapSource, /개 목록 먼저 표시 · 지도 좌표 준비 중/);
assert.match(mapSource, /전체 매물 준비 중 · 지도 좌표/);
assert.doesNotMatch(mapSource, /allItems = progressItems/);
assert.match(mapSource, /function getSharedGeocodeRequestV691\(\)/);
assert.match(mapSource, /var allRowsAlreadyLocatedV691 = rawItems\.length > 0/);
assert.match(
  mapSource,
  /if \(allRowsAlreadyLocatedV691 && !isAuto\) \{[\s\S]*?applyFilter\(\);[\s\S]*?isLoadingSheet = false;[\s\S]*?return true;/
);
assert.match(
  mapSource,
  /allRowsAlreadyLocatedV691[\s\S]*?Promise\.resolve\(\{ ok: true, entries: \{\} \}\)[\s\S]*?getSharedGeocodeRequestV691\(\)/
);

console.log("initial list before geocode tests passed");
