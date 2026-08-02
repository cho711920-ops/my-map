const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const mapSource = fs.readFileSync("js/map.js", "utf8");
const htmlSource = fs.readFileSync("index.html", "utf8");

const helperMatch = mapSource.match(
  /function createExactAddressClustersV6519\(addressGroups\) \{[\s\S]*?\n\}/
);
assert.ok(helperMatch, "최대 확대 지번별 클러스터 함수가 필요합니다.");

const context = {};
vm.createContext(context);
vm.runInContext(helperMatch[0], context);

const clusters = context.createExactAddressClustersV6519([
  {
    key: "대전 서구 갈마동 1387",
    latlng: { lat: 36.1, lng: 127.1 },
    items: [{ propertyId: "M-1387-1" }, { propertyId: "M-1387-2" }]
  },
  {
    key: "대전 서구 갈마동 1388",
    latlng: { lat: 36.1001, lng: 127.1001 },
    items: [{ propertyId: "M-1388-1" }]
  }
]);

assert.equal(clusters.length, 2);
assert.equal(clusters[0].items.length, 2);
assert.equal(clusters[1].items.length, 1);
assert.notEqual(clusters[0].key, clusters[1].key);
assert.equal(clusters[0].exactAddress, true);
assert.equal(clusters[1].exactAddress, true);

assert.match(
  mapSource,
  /if \(map && Number\(map\.getLevel\(\)\) <= 1\) \{\s*return createExactAddressClustersV6519\(addressGroups\);/
);
assert.match(htmlSource, /js\/map\.js\?v=6\.5\.27-hierarchical-admin-clusters/);

console.log("max zoom address cluster tests passed");
