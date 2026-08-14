const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
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

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const context = {
  kakao: { maps: { LatLng, Point } },
  encodeURIComponent,
  console
};
vm.createContext(context);
vm.runInContext([
  extractFunction("getAddressAdminRegionV655"),
  extractFunction("clearPinnedClusterSelectionV6515"),
  extractFunction("setAdministrativeListSelectionV6570"),
  extractFunction("clearAdministrativeListSelectionV6570"),
  extractFunction("clearMapListSelectionForNavigationV6571"),
  extractFunction("getAdministrativeListItemsV6570"),
  extractFunction("getAdministrativeClusterModeV655"),
  extractFunction("createAdministrativeClustersV655"),
  extractFunction("estimateAdministrativeClusterBoxV656"),
  extractFunction("administrativeBoxesOverlapV656"),
  extractFunction("resolveAdministrativeClusterPositionsV656"),
  extractFunction("getPremiumClusterSizeClassV635"),
  extractFunction("buildClusterOverlayContentV655")
].join("\n"), context);

context.jsAdministrativeListSelectionV6570 = null;

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getAddressAdminRegionV655("대전광역시 서구 괴정동 95-19"))),
  { district: "서구", neighborhood: "괴정동" }
);
assert.equal(context.getAdministrativeClusterModeV655(8), "district");
assert.equal(context.getAdministrativeClusterModeV655(7), "neighborhood");
assert.equal(context.getAdministrativeClusterModeV655(6), "");
assert.equal(context.getAdministrativeClusterModeV655(5), "");
assert.equal(context.getAdministrativeClusterModeV655(4), "");

const groups = [
  { key: "a", address: "서구 괴정동 1", latlng: new LatLng(36.33, 127.38), items: [{}, {}] },
  { key: "b", address: "서구 용문동 2", latlng: new LatLng(36.34, 127.39), items: [{}] },
  { key: "c", address: "유성구 봉명동 3", latlng: new LatLng(36.35, 127.34), items: [{}, {}, {}] }
];

const districts = context.createAdministrativeClustersV655(groups, "district");
assert.equal(districts.length, 2);
assert.equal(districts.find((item) => item.regionLabel === "서구").items.length, 3);
assert.equal(districts.find((item) => item.regionLabel === "유성구").items.length, 3);

const duplicateHeavyGroups = [
  { key: "heavy", address: "서구 괴정동 1", latlng: new LatLng(36.30, 127.38), items: Array.from({ length: 100 }, () => ({})) },
  { key: "light", address: "서구 괴정동 2", latlng: new LatLng(36.40, 127.40), items: [{}] }
];
const balancedCenter = context.createAdministrativeClustersV655(duplicateHeavyGroups, "neighborhood")[0];
assert.equal(balancedCenter.latlng.getLat().toFixed(2), "36.35");
assert.equal(balancedCenter.latlng.getLng().toFixed(2), "127.39");

const neighborhoods = context.createAdministrativeClustersV655(groups, "neighborhood");
assert.equal(neighborhoods.length, 3);
assert.ok(neighborhoods.some((item) => item.regionLabel === "괴정동"));
assert.ok(neighborhoods.some((item) => item.regionLabel === "용문동"));

context.setAdministrativeListSelectionV6570(
  neighborhoods.find((item) => item.regionLabel === "괴정동")
);
assert.equal(
  context.getAdministrativeListItemsV6570([
    { address: "대전광역시 서구 괴정동 95-19" },
    { address: "대전광역시 서구 용문동 219-8" },
    { address: "대전광역시 대덕구 법동 1" }
  ]).length,
  1,
  "동 클러스터를 누른 뒤 목록은 지도 범위가 아니라 선택한 동으로 고정되어야 합니다."
);
context.clearAdministrativeListSelectionV6570();
assert.equal(context.getAdministrativeListItemsV6570(groups).length, groups.length);

context.jsPinnedClusterSelectionV6515 = { itemIdentities: ["property:1"] };
context.jsPinnedClusterSpatialChangeIgnoreUntilV6517 = Date.now() + 1000;
context.selectedGroupKey = "cluster:1";
context.selectedGroupKeys = ["cluster:1"];
context.selectedItemKey = "property:1";
context.jsClusterSelectionMemoryV638 = {
  singleItemIds: ["property:1"],
  multiItemIdGroups: [["property:1"]]
};
context.setAdministrativeListSelectionV6570(neighborhoods[0]);
context.clearMapListSelectionForNavigationV6571();
assert.equal(context.jsPinnedClusterSelectionV6515, null);
assert.equal(context.jsAdministrativeListSelectionV6570, null);
assert.equal(context.selectedGroupKey, null);
assert.deepEqual(Array.from(context.selectedGroupKeys), []);
assert.equal(context.selectedItemKey, null);

assert.equal(context.getPremiumClusterSizeClassV635(1).trim(), "cluster-size-sm");
assert.equal(context.getPremiumClusterSizeClassV635(10).trim(), "cluster-size-md");
assert.equal(context.getPremiumClusterSizeClassV635(600).trim(), "cluster-size-xxl");
assert.match(context.buildClusterOverlayContentV655(districts[0], ""), /admin-region-cluster-v655/);
assert.match(context.buildClusterOverlayContentV655(districts[0], ""), /<span>매물 <b>3<\/b><\/span>/);
assert.equal(context.estimateAdministrativeClusterBoxV656({ regionLabel: "괴정동", items: Array(9999) }).height, 46);
assert.equal(
  context.administrativeBoxesOverlapV656(
    { left: 0, right: 68, top: 0, bottom: 46 },
    { left: 74, right: 142, top: 0, bottom: 46 },
    4
  ),
  false
);

context.document = {
  getElementById() {
    return { clientWidth: 400, clientHeight: 300 };
  }
};
context.map = {
  getProjection() {
    return {
      containerPointFromCoords(latlng) {
        return new Point(latlng.getLng(), latlng.getLat());
      },
      coordsFromContainerPoint(point) {
        return new LatLng(point.y, point.x);
      }
    };
  }
};
const collidingLabels = [
  { regionLabel: "괴정동", items: Array(120), latlng: new LatLng(150, 200) },
  { regionLabel: "용문동", items: Array(80), latlng: new LatLng(150, 200) },
  { regionLabel: "탄방동", items: Array(60), latlng: new LatLng(150, 200) }
];
context.resolveAdministrativeClusterPositionsV656(collidingLabels);
const displayPoints = collidingLabels.map((cluster) => [
  cluster.displayLatlng.getLng(),
  cluster.displayLatlng.getLat()
].join(":"));
assert.equal(new Set(displayPoints).size, 3);

context.document.getElementById = function() {
  return { clientWidth: 1000, clientHeight: 700 };
};
const denseDaejeonLabels = Array.from({ length: 80 }, (_, index) => ({
  regionLabel: `동${index + 1}`,
  items: Array(index + 1),
  latlng: new LatLng(350, 500)
}));
const placedDenseDaejeonLabels = context.resolveAdministrativeClusterPositionsV656(denseDaejeonLabels);
assert.ok(placedDenseDaejeonLabels.length > 0);
assert.ok(
  placedDenseDaejeonLabels.length < denseDaejeonLabels.length,
  "같은 위치에 몰린 동 이름표를 지도 전체로 밀어내지 말고 일부를 생략해야 합니다."
);

const denseBoxes = placedDenseDaejeonLabels.map((cluster) => {
  const size = context.estimateAdministrativeClusterBoxV656(cluster);
  const centerX = cluster.displayLatlng.getLng();
  const centerY = cluster.displayLatlng.getLat();
  return {
    left: centerX - size.width / 2,
    right: centerX + size.width / 2,
    top: centerY - size.height / 2,
    bottom: centerY + size.height / 2
  };
});
for (let firstIndex = 0; firstIndex < denseBoxes.length; firstIndex += 1) {
  for (let secondIndex = firstIndex + 1; secondIndex < denseBoxes.length; secondIndex += 1) {
    assert.equal(
      context.administrativeBoxesOverlapV656(denseBoxes[firstIndex], denseBoxes[secondIndex], 4),
      false,
      `대량 동 클러스터 ${firstIndex + 1}/${secondIndex + 1}가 겹치면 안 됩니다.`
    );
  }
}

assert.match(source, /function openAdministrativeClusterV655[\s\S]*?setAdministrativeListSelectionV6570\(cluster\)[\s\S]*?showList\(cluster\.items \|\| \[\]\)/);
assert.doesNotMatch(source, /function openAdministrativeClusterV655[\s\S]*?map\.setLevel\(/);
assert.doesNotMatch(source, /function openAdministrativeClusterV655[\s\S]*?map\.panTo\(/);
assert.match(source, /scheduleMapIdleRefreshV638[\s\S]*?getAdministrativeListItemsV6570\(jsLastRenderedItemsV639\)/);
assert.match(source, /function clearMapListSelectionForNavigationV6571\(\) \{[\s\S]*?clearPinnedClusterSelectionV6515\(true\);[\s\S]*?clearAdministrativeListSelectionV6570\(\);[\s\S]*?\}/);
assert.match(source, /addListener\(map, "dragstart"[\s\S]*?clearMapListSelectionForNavigationV6571\(\)/);
assert.match(source, /addListener\(map, "zoom_start"[\s\S]*?clearMapListSelectionForNavigationV6571\(\)/);
assert.match(source, /getFilteredItems\(\{\s*includeUnlocated: true,\s*ignoreMapBounds: true\s*\}\)/);
assert.match(scriptSource, /var ignoreMapBounds = !!\(options && options\.ignoreMapBounds\)/);
assert.match(scriptSource, /var inMap = ignoreMapBounds \|\| mobileGlobalKeywordSearch\s*\? true\s*:/);
assert.match(source, /position: cluster\.displayLatlng \|\| cluster\.latlng/);
assert.match(css, /js-world-grid-clusters-v690[\s\S]*?admin-region-cluster-v655[\s\S]*?min-width: 68px/);
assert.match(css, /js-world-grid-clusters-v690[\s\S]*?admin-region-cluster-v655[\s\S]*?background: rgba\(255, 255, 255, \.97\)/);
assert.match(css, /js-world-grid-clusters-v690[\s\S]*?admin-region-cluster-v655 span b[\s\S]*?color: #0877dc/);
assert.ok(html.includes("map.js?v=8.2.9-world-grid-viewport-count"));
assert.match(source, /var jsAutomaticDataRefreshIntervalV681 = 5 \* 60 \* 1000;/);
assert.match(source, /\}, jsAutomaticDataRefreshIntervalV681\);/);
assert.ok(html.includes("style.css?v=6.5.40-world-grid-clusters"));

console.log("hierarchical admin cluster v6.5.5 tests passed");
