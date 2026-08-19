const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const mapSource = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const css = [
  fs.readFileSync(path.join(root, "css", "style.css"), "utf8"),
  fs.readFileSync(path.join(root, "css", "app-final-overrides-v690.css"), "utf8")
].join("\n");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(name) {
  const start = mapSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const brace = mapSource.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < mapSource.length; index += 1) {
    if (mapSource[index] === "{") depth += 1;
    if (mapSource[index] === "}") depth -= 1;
    if (depth === 0) return mapSource.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

class LatLng {
  constructor(lat, lng) {
    this.lat = lat;
    this.lng = lng;
  }
  getLat() { return this.lat; }
  getLng() { return this.lng; }
}

const clusterContext = {
  kakao: { maps: { LatLng } },
  Number,
  Math,
  console
};
vm.createContext(clusterContext);
vm.runInContext([
  extractFunction("getWorldGridCellSizeMetersV690"),
  extractFunction("toWorldMercatorMetersV690"),
  extractFunction("createWorldGridClustersV690")
].join("\n"), clusterContext);

assert.equal(clusterContext.getWorldGridCellSizeMetersV690(6), 1280);
assert.equal(clusterContext.getWorldGridCellSizeMetersV690(5), 640);
assert.equal(clusterContext.getWorldGridCellSizeMetersV690(4), 320);
assert.equal(clusterContext.getWorldGridCellSizeMetersV690(3), 160);
assert.equal(clusterContext.getWorldGridCellSizeMetersV690(2), 80);

const groups = [
  { key: "a", latlng: new LatLng(36.3500, 127.3800), items: [{ key: "a" }] },
  { key: "b", latlng: new LatLng(36.3507, 127.3810), items: [{ key: "b" }] },
  { key: "c", latlng: new LatLng(36.3520, 127.3840), items: [{ key: "c" }] },
  { key: "d", latlng: new LatLng(36.3550, 127.3890), items: [{ key: "d" }] }
];

const level6 = clusterContext.createWorldGridClustersV690(groups, 6);
const level5 = clusterContext.createWorldGridClustersV690(groups, 5);
const level2 = clusterContext.createWorldGridClustersV690(groups, 2);
assert.ok(level6.length > 0);
assert.ok(level5.length >= level6.length, "동 다음 단계부터 확대할수록 큰 셀이 더 작은 셀로 분해되어야 합니다.");
assert.ok(level2.length >= level6.length, "확대할수록 고정 공간 셀이 같거나 더 잘게 나뉘어야 합니다.");
assert.ok(level6.every((cluster) => cluster.worldGrid));
assert.ok(level6.every((cluster) => /^world-grid:1280:-?\d+:-?\d+$/.test(cluster.key)));

const firstKeys = level6.map((cluster) => cluster.key);
clusterContext.map = { getCenter: () => new LatLng(0, 0) };
const afterVirtualDragKeys = clusterContext.createWorldGridClustersV690(groups, 6).map((cluster) => cluster.key);
assert.deepEqual(afterVirtualDragKeys, firstKeys, "지도 중심이 달라져도 같은 레벨의 셀 키는 바뀌면 안 됩니다.");
assert.doesNotMatch(extractFunction("createWorldGridClustersV690"), /containerPointFromCoords|getProjection/);

const engineContext = {
  window: {
    location: { search: "?clusterEngine=legacy" },
    localStorage: { getItem: () => "world-grid" },
    JS_MAP_CLUSTER_ENGINE_V690: ""
  },
  URLSearchParams,
  jsMapClusterEngineStorageKeyV690: "js_map_cluster_engine_v690",
  jsMapClusterEngineDefaultV690: "world-grid"
};
vm.createContext(engineContext);
vm.runInContext([
  extractFunction("normalizeMapClusterEngineV690"),
  extractFunction("getMapClusterEngineV690"),
  extractFunction("shouldUseWorldGridClustersV690")
].join("\n"), engineContext);
assert.equal(engineContext.getMapClusterEngineV690(), "legacy");
assert.equal(engineContext.shouldUseWorldGridClustersV690(), false);
engineContext.window.location.search = "?clusterEngine=world-grid";
assert.equal(engineContext.shouldUseWorldGridClustersV690(), true);

const viewportItems = [{ id: "viewport" }];
const globalItems = [{ id: "global" }];
const sourceContext = {
  window: { mapRadiusFilterV658: null },
  map: { getLevel: () => 6 },
  shouldUseWorldGridClustersV690: () => true,
  getAdministrativeClusterModeV655: (level) => level >= 8 ? "district" : (level === 7 ? "neighborhood" : ""),
  getFilteredItems: () => globalItems,
  Number
};
vm.createContext(sourceContext);
vm.runInContext(extractFunction("getStableClusterSourceItemsV690"), sourceContext);
assert.deepEqual(
  sourceContext.getStableClusterSourceItemsV690(viewportItems).map((item) => item.id),
  ["viewport"],
  "spatial clusters must use the exact current viewport listing set"
);
sourceContext.map.getLevel = () => 7;
assert.deepEqual(
  sourceContext.getStableClusterSourceItemsV690(viewportItems).map((item) => item.id),
  ["global"],
  "administrative clusters must keep whole-region totals"
);
sourceContext.window.mapRadiusFilterV658 = {};
assert.deepEqual(
  sourceContext.getStableClusterSourceItemsV690(viewportItems).map((item) => item.id),
  ["viewport"],
  "radius-filtered clusters must stay inside the selected radius"
);

assert.match(mapSource, /var jsMapClusterEngineDefaultV690 = "world-grid";/);
assert.match(mapSource, /useLegacy: function\(\) \{ return setMapClusterEngineV690\("legacy"\); \}/);
assert.match(
  mapSource,
  /function drawMapClustersOnlyV639[\s\S]*?getStableClusterSourceItemsV690\(items\)[\s\S]*?shouldUseWorldGridClustersV690\(\)[\s\S]*?groupByAddress\(clusterSourceItems\)/
);
assert.match(
  mapSource,
  /function createClustersForCurrentZoomV655[\s\S]*?filterClustersToMapViewportV690\(administrativeClusters, 80\)[\s\S]*?createWorldGridClustersV690\(addressGroups, level\)[\s\S]*?filterClustersToMapViewportV690\(spatialClusters, 120\)/
);
assert.match(
  mapSource,
  /function getStableClusterSourceItemsV690[\s\S]*?getAdministrativeClusterModeV655\(level\)[\s\S]*?return \(fallbackItems \|\| \[\]\)\.slice\(\)[\s\S]*?ignoreMapBounds: true/
);
assert.match(css, /js-world-grid-clusters-v690[\s\S]*?world-grid-cluster-v690/);
assert.match(css, /js-world-grid-clusters-v690 \.circle-marker\.world-grid-cluster-v690 \{[\s\S]*?border: 0 !important;/);
assert.match(css, /js-world-grid-clusters-v690[\s\S]*?admin-region-district-v690/);
assert.match(html, /style\.css\?v=6\.10\.0-module-split/);
assert.match(html, /map\.js\?v=8\.2\.18-unique-linked-selection/);

console.log("world grid cluster v6.9.0 tests passed");
