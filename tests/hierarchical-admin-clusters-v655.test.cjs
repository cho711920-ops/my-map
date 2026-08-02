const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
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
  extractFunction("getAdministrativeClusterModeV655"),
  extractFunction("createAdministrativeClustersV655"),
  extractFunction("estimateAdministrativeClusterBoxV656"),
  extractFunction("administrativeBoxesOverlapV656"),
  extractFunction("resolveAdministrativeClusterPositionsV656"),
  extractFunction("getPremiumClusterSizeClassV635"),
  extractFunction("buildClusterOverlayContentV655")
].join("\n"), context);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getAddressAdminRegionV655("대전광역시 서구 괴정동 95-19"))),
  { district: "서구", neighborhood: "괴정동" }
);
assert.equal(context.getAdministrativeClusterModeV655(7), "district");
assert.equal(context.getAdministrativeClusterModeV655(6), "neighborhood");
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

assert.equal(context.getPremiumClusterSizeClassV635(1).trim(), "cluster-size-sm");
assert.equal(context.getPremiumClusterSizeClassV635(10).trim(), "cluster-size-md");
assert.equal(context.getPremiumClusterSizeClassV635(600).trim(), "cluster-size-xxl");
assert.match(context.buildClusterOverlayContentV655(districts[0], ""), /admin-region-cluster-v655/);
assert.match(context.buildClusterOverlayContentV655(districts[0], ""), /<span>매물 <b>3<\/b><\/span>/);
assert.equal(context.estimateAdministrativeClusterBoxV656({ regionLabel: "괴정동", items: Array(9999) }).height, 40);
assert.equal(
  context.administrativeBoxesOverlapV656(
    { left: 0, right: 54, top: 0, bottom: 40 },
    { left: 60, right: 114, top: 0, bottom: 40 },
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
context.resolveAdministrativeClusterPositionsV656(denseDaejeonLabels);
assert.equal(denseDaejeonLabels.filter((cluster) => cluster.displayLatlng).length, 80);

const denseBoxes = denseDaejeonLabels.map((cluster) => {
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

assert.match(source, /function openAdministrativeClusterV655[\s\S]*?targetLevel = cluster\.regionMode === "district" \? 6 : 4/);
assert.match(source, /position: cluster\.displayLatlng \|\| cluster\.latlng/);
assert.match(css, /admin-region-cluster-v655[\s\S]*?min-width: 54px/);
assert.match(css, /admin-region-cluster-v655[\s\S]*?background: rgba\(255, 255, 255, \.91\)/);
assert.match(css, /admin-region-cluster-v655 span b[\s\S]*?color: #0877dc/);
assert.ok(html.includes("map.js?v=8.1.2-admin-count-blue"));
assert.ok(html.includes("style.css?v=6.5.33-admin-count-confirmed"));

console.log("hierarchical admin cluster v6.5.5 tests passed");
