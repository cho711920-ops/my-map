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
  /allItems = rawItems;[\s\S]*?getFilteredItems\(\{ includeUnlocated: true \}\);[\s\S]*?showListWithoutReleasingPinnedClusterV685\(currentItems\);[\s\S]*?geocodeItems\(rawItems/
);
assert.match(mapSource, /개 목록 먼저 표시 · 지도 좌표 준비 중/);

console.log("initial list before geocode tests passed");
