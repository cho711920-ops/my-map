const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
const cacheSource = fs.readFileSync("js/initial-listings-cache-v1.js", "utf8");
const mapSource = fs.readFileSync("js/map.js", "utf8");

function cacheApi() {
  const context = { Object, Array, Number, String, Date, Promise, Error, setTimeout };
  vm.runInNewContext(cacheSource, context);
  return context.JSInitialListingsCacheV1;
}

test("initial data warmup starts before the Kakao SDK and critical UI scripts", () => {
  const access = html.indexOf('src="js/data-access-v6.js?v=6.0.3-earliest-warmup"');
  const kakao = html.indexOf('src="https://dapi.kakao.com/v2/maps/sdk.js');
  const main = html.indexOf('data-auth-critical src="js/script.js');
  const cache = html.indexOf('data-auth-critical src="js/initial-listings-cache-v1.js');
  const parser = html.indexOf('data-auth-critical src="js/parser.js');
  const map = html.indexOf('data-auth-critical src="js/map.js');

  assert.ok(access >= 0 && access < kakao);
  assert.ok(kakao < main && main < cache && cache < parser && parser < map);
  assert.match(html, /parser\.js\?v=6\.4\.19-distinct-listing-save/);
  assert.match(mapSource, /setupQuickAddShortcuts\(\);/);
  assert.match(auth, /const criticalScripts = scripts\.filter/);
  assert.match(auth, /deferredAuthenticatedAssetsPromise/);
});

test("cache snapshots keep reusable listing data but exclude runtime map objects", () => {
  const api = cacheApi();
  const result = api.snapshot([{
    name: "테스트상가",
    propertyId: "P-1",
    address: "서구 둔산동 1",
    room: "1층",
    type: "일반상가",
    deposit: 1000,
    rent: 100,
    latitude: 36.35,
    longitude: 127.38,
    key: "runtime-key",
    latlng: { getLat() { return 36.35; } },
    unifiedOriginalsV8: [{ originalId: "runtime-duplicate" }],
    displayValuePresence: { deposit: true, rent: true }
  }], {
    ok: true,
    groups: { "P-1": [{ originalId: "O-1", thumbnail: "https://example.com/a.jpg" }] },
    sourceSearchIds: { "P-1": ["n:1"] }
  });

  assert.equal(result.schema, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].address, "서구 둔산동 1");
  assert.equal(result.items[0].latlng, undefined);
  assert.equal(result.items[0].unifiedOriginalsV8, undefined);
  assert.equal(result.unified.groups["P-1"][0].originalId, "O-1");
  assert.equal(api.usable(result), true);
});

test("the fast snapshot caps cards and duplicate metadata at the first 80 listings", () => {
  const api = cacheApi();
  const items = Array.from({ length: 100 }, (_, index) => ({
    propertyId: `P-${index}`,
    name: `매물 ${index}`,
    address: `서구 테스트동 ${index}`,
    room: "1층",
    type: "일반상가"
  }));
  const groups = Object.fromEntries(items.map((item) => [
    item.propertyId,
    [{ originalId: `O-${item.propertyId}` }]
  ]));
  const result = api.snapshot(items, { ok: true, groups, sourceSearchIds: {} });

  assert.equal(result.items.length, 80);
  assert.equal(result.itemCount, 80);
  assert.equal(result.totalItemCount, 100);
  assert.equal(Object.keys(result.unified.groups).length, 80);
  assert.equal(result.unified.groups["P-80"], undefined);
});

test("the map renders a cached snapshot first and always refreshes it from live D1 data", () => {
  assert.match(mapSource, /function showInitialListingsCacheV1\(snapshot\)/);
  assert.match(mapSource, /JSInitialListingsCacheV1\.read\(\)\.then/);
  assert.match(mapSource, /showInitialListingsCacheV1\(snapshot\)/);
  assert.match(mapSource, /저장된 최근 매물 먼저 표시 · 최신 전체목록 확인 중/);
  assert.match(mapSource, /showList\(getAdministrativeListItemsV6570\(currentItems\)\)/);
  assert.match(mapSource, /drawMapClustersOnlyV639\(currentItems\)/);
  assert.match(mapSource, /liveInitialDataAppliedV1 = true/);
  assert.match(mapSource, /JSInitialListingsCacheV1\.write\(liveInitialItemsForCacheV1, unifiedResult\)/);
  assert.match(auth, /JSInitialListingsCacheV1\.clear\(\)/);
});
