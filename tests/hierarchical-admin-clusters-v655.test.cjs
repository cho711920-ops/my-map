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

const context = {
  kakao: { maps: { LatLng } },
  encodeURIComponent,
  console
};
vm.createContext(context);
vm.runInContext([
  extractFunction("getAddressAdminRegionV655"),
  extractFunction("getAdministrativeClusterModeV655"),
  extractFunction("createAdministrativeClustersV655"),
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

const neighborhoods = context.createAdministrativeClustersV655(groups, "neighborhood");
assert.equal(neighborhoods.length, 3);
assert.ok(neighborhoods.some((item) => item.regionLabel === "괴정동"));
assert.ok(neighborhoods.some((item) => item.regionLabel === "용문동"));

assert.equal(context.getPremiumClusterSizeClassV635(1).trim(), "cluster-size-sm");
assert.equal(context.getPremiumClusterSizeClassV635(10).trim(), "cluster-size-md");
assert.equal(context.getPremiumClusterSizeClassV635(600).trim(), "cluster-size-xxl");
assert.match(context.buildClusterOverlayContentV655(districts[0], ""), /admin-region-cluster-v655/);
assert.match(context.buildClusterOverlayContentV655(districts[0], ""), /매물 3/);

assert.match(source, /function openAdministrativeClusterV655[\s\S]*?targetLevel = cluster\.regionMode === "district" \? 6 : 4/);
assert.match(css, /admin-region-cluster-v655[\s\S]*?background: rgba\(255, 255, 255, \.94\)/);
assert.ok(html.includes("map.js?v=8.1.0-persistent-building-info"));
assert.ok(html.includes("style.css?v=6.5.31-hierarchical-admin-clusters"));

console.log("hierarchical admin cluster v6.5.5 tests passed");
