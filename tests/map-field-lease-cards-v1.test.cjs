const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const source = read("js/map-field-lease-cards-v1.js");
const mapSource = read("js/map.js");
function fn(name) {
  const start = mapSource.indexOf("function " + name + "(");
  const end = mapSource.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start, name);
  return mapSource.slice(start, end);
}
function harness() {
  const state = { enabled: true, mode: "lease", selected: [], details: [], more: [] };
  const ctx = {
    window: null, overlays: [], selectedItemKey: "",
    map: {getLevel: () => 3},
    JSFieldModeV1: {isFollowing: () => state.enabled},
    JSListingTradeV1: {getMode: () => state.mode, matchesItem: item => item.tradeType !== "sale"},
    formatListingRoomForCardV653: value => value === "1/4" ? "1층" : value,
    getItemFloorNumber: item => item.floor ?? null,
    isDone: item => item.state === "계약완료",
    selectListingOnMapV844: item => state.selected.push(item.propertyId),
    JSUnifiedListingsV8: {toggleCardDetail: value => state.details.push(decodeURIComponent(value))},
    openCluster: key => state.more.push(decodeURIComponent(key))
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return {ctx, state, api: ctx.JSFieldLeaseCardsV1};
}
function item(id, extra = {}) {
  return {propertyId: id, key: id + "|key", room: "1층", floor: 1,
    deposit: 1000, rent: 80, area: 25, tradeType: "lease", ...extra};
}
function group(items, key = "비공개 주소") { return {key, latlng: {lat: 36.35, lng: 127.38}, items}; }
function mount(ctx, api, items) {
  const cluster = api.clusters([group(items)])[0];
  ctx.overlays = [{__cluster: cluster}];
  return cluster;
}

test("field lease cards are opt-in, never used for building/land sale", () => {
  const {api, state} = harness();
  assert.equal(api.active(), true);
  state.enabled = false;
  assert.equal(api.active(), false);
  state.enabled = true;
  for (const mode of ["building_sale", "land_sale"]) {
    state.mode = mode;
    assert.equal(api.active(), false);
  }
});
test("GPS permission wait on a citywide map never creates thousands of price cards", () => {
  const {ctx, api} = harness();
  ctx.map.getLevel = () => 7;
  assert.equal(api.active(), false);
  ctx.map.getLevel = () => 2;
  assert.equal(api.active(), true);
});
test("two centered-line values use master room, pyeong and separated rent/deposit", () => {
  const {api} = harness();
  const values = api.lines(item("A", {room: "1/4", area: 25.5}));
  assert.equal(values.top, "1층 · 25.5평");
  assert.equal(values.bottom, "보 1,000 / 월 80");
});
test("unknown and explicit zero are distinct; invalid values are not money", () => {
  const {api} = harness();
  const values = api.lines(item("A", {room: "", area: 0, deposit: 0, rent: 0,
    displayValuePresence: {rent: false, deposit: true}}));
  assert.equal(values.top, "층수 - · 평수 -");
  assert.equal(values.bottom, "보 0 / 월 -");
  assert.equal(api.lines(item("B", {deposit: NaN, rent: -1})).bottom, "보 - / 월 -");
});
test("money retains the same two decimals as list and detail, without rounding cents away", () => {
  const {api} = harness();
  assert.equal(api.lines(item("A", {deposit: 1000.25, rent: 25.25})).bottom, "보 1,000.25 / 월 25.25");
});
test("nearby addresses remain separate at every field scale; no input mutation or extra data", () => {
  const {api} = harness();
  const items = [item("C", {floor: null}), item("B", {floor: 2}), item("A", {floor: 1})];
  const groups = [group(items, "첫 건물"), group([item("D")], "옆 건물")];
  const before = JSON.stringify(groups);
  const result = api.clusters(groups);
  assert.equal(result.length, 2);
  assert.equal(result[0].latlng, groups[0].latlng);
  assert.deepEqual(Array.from(result[0].items, row => row.propertyId), ["A", "B", "C"]);
  assert.equal(JSON.stringify(groups), before);
});
test("defensively excludes sales even if a caller supplies a mixed address", () => {
  const {api} = harness();
  const result = api.clusters([group([item("SALE", {tradeType: "sale"}), item("LEASE")]),
    group([item("LAND", {tradeType: "sale"})], "land")]);
  assert.equal(result.length, 1);
  assert.deepEqual(Array.from(result[0].items, row => row.propertyId), ["LEASE"]);
});
test("no visible address; escape rooms, safe inline tokens; preserve done marker", () => {
  const {ctx, api} = harness();
  const cluster = mount(ctx, api, [item("quote'id", {room: '<img onerror="boom">', state: "계약완료"})]);
  const html = api.content(cluster, " selected");
  assert.doesNotMatch(html, /<img|비공개 주소|quote'id/);
  assert.match(html, /&lt;img onerror=&quot;boom&quot;&gt;/);
  assert.match(html, /quote%27id/);
  assert.match(html, /계약완료/);
  assert.match(html, /field-lease-top-v1/);
  assert.match(html, /field-lease-price-v1/);
});
test("large same-address group bounds DOM without losing full membership or selected row", () => {
  const {ctx, api} = harness();
  const items = Array.from({length: 200}, (_, i) => item("ITEM-" + String(i).padStart(3, "0")));
  const cluster = mount(ctx, api, items);
  ctx.selectedItemKey = items[199].key;
  const html = api.content(cluster);
  assert.equal((html.match(/class="field-lease-row-v1/g) || []).length, 3);
  assert.match(html, /ITEM-199/);
  assert.match(html, /외 197개 더 보기/);
  assert.equal(cluster.items.length, 200);
});
test("click is scoped to current filtered overlays and stable property id; existing detail toggle is used", () => {
  const {ctx, api, state} = harness();
  const cluster = mount(ctx, api, [item("A"), item("B")]);
  const key = encodeURIComponent(cluster.key);
  const id = encodeURIComponent("id:B");
  assert.equal(api.open(key, id), true);
  assert.equal(api.open(key, id), true);
  assert.deepEqual(state.details, ["B", "B"]);
  assert.deepEqual(state.selected, ["B", "B"]);
  assert.deepEqual(state.more, []);
  assert.equal(api.open(key, encodeURIComponent("id:filtered-out")), false);
  assert.equal(api.open("%bad", id), false);
  ctx.overlays = [];
  assert.equal(api.open(key, id), false);
});
test("same legacy key cannot select the wrong property or hide the true fourth selection", () => {
  const {ctx, api} = harness();
  const items = ["A", "B", "C", "D"].map(id => item(id, {key: "same-legacy-key"}));
  const cluster = mount(ctx, api, items);
  ctx.selectedItemKey = "same-legacy-key";
  ctx.isLinkedListingSelectedV845 = value => value.propertyId === "D";
  const html = api.content(cluster);
  assert.match(html, /class="field-lease-row-v1 selected"[^>]*id%3AD/);
  assert.doesNotMatch(html, /class="field-lease-row-v1 selected"[^>]*id%3AA/);
});
test("moving from a pinned building to a new card synchronizes list, linked selection and snapshot", () => {
  const {ctx, api} = harness();
  const cluster = mount(ctx, api, [item("B")]);
  const calls = [];
  ctx.clearPinnedClusterSelectionV6515 = clear => calls.push(["clear", clear]);
  ctx.showList = items => calls.push(["list", items[0].propertyId]);
  ctx.selectListingOnMapV844 = value => calls.push(["select", value.propertyId]);
  ctx.pinCurrentClusterSelectionV6515 = () => calls.push(["pin"]);
  api.open(encodeURIComponent(cluster.key), encodeURIComponent("id:B"));
  assert.deepEqual(calls, [["clear", false], ["list", "B"], ["select", "B"], ["pin"]]);
});
test("more shows the exact existing group and stops responding after mode OFF", () => {
  const {ctx, api, state} = harness();
  const cluster = mount(ctx, api, [item("A")]);
  const key = encodeURIComponent(cluster.key);
  assert.equal(api.more(key), true);
  assert.deepEqual(state.more, [cluster.key]);
  state.enabled = false;
  assert.equal(api.more(key), false);
  assert.equal(api.open(key, encodeURIComponent("id:A")), false);
});
test("multi-selection preserves pinned/offscreen group ids while following the new detail selection", () => {
  const {ctx, api} = harness();
  const cluster = mount(ctx, api, [item("B")]);
  ctx.multiClusterMode = true;
  const pinnedIds = ["property:A", "property:B", "property:offscreen"];
  ctx.jsPinnedClusterSelectionV6515 = {itemIdentities: pinnedIds,
    snapshot: {selectedItemIdentity: "property:A", multiItemIdGroups: [["property:A"], ["property:offscreen"]]}};
  const snapshot = ctx.jsPinnedClusterSelectionV6515.snapshot;
  ctx.getStableItemIdentityV638 = value => "property:" + value.propertyId;
  ctx.clearPinnedClusterSelectionV6515 = () => {throw Error("must not clear multi pin");};
  ctx.showList = () => {throw Error("must not replace multi list");};
  ctx.pinCurrentClusterSelectionV6515 = () => {throw Error("must not drop offscreen groups");};
  api.open(encodeURIComponent(cluster.key), encodeURIComponent("id:B"));
  assert.equal(snapshot.selectedItemIdentity, "property:B");
  assert.equal(ctx.jsPinnedClusterSelectionV6515.itemIdentities, pinnedIds);
  assert.deepEqual(snapshot.multiItemIdGroups, [["property:A"], ["property:offscreen"]]);
});
test("actual map builder uses field address groups at levels 1/2/3 and retains old path OFF", () => {
  const {ctx, api, state} = harness();
  let level = 1;
  ctx.map = {getLevel: () => level};
  ctx.getAdministrativeClusterModeV655 = () => "";
  ctx.shouldUseWorldGridClustersV690 = () => true;
  ctx.filterClustersToMapViewportV690 = clusters => clusters;
  ctx.createExactAddressClustersV6519 = () => ["normal-exact"];
  ctx.createWorldGridClustersV690 = () => ["normal-grid"];
  vm.runInContext(fn("createClustersForCurrentZoomV655"), ctx);
  vm.runInContext(fn("buildClusterOverlayContentV655"), ctx);
  const groups = [group([item("A")]), group([item("B")], "second")];
  for (level of [1, 2, 3]) {
    const clusters = ctx.createClustersForCurrentZoomV655(groups);
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0].fieldLease, true);
    assert.match(ctx.buildClusterOverlayContentV655(clusters[0], " selected"), /field-lease-row-v1/);
  }
  state.enabled = false;
  assert.deepEqual(Array.from(ctx.createClustersForCurrentZoomV655(groups)), ["normal-grid"]);
  assert.equal(api.active(), false);
});
test("viewport dedupe distinguishes stationary ON/OFF, CSS counter-rotation includes cards", () => {
  const {ctx, state} = harness();
  ctx.map = {getLevel: () => 3, getCenter: () => ({getLat: () => 36.35, getLng: () => 127.38})};
  ctx.document = {getElementById: () => ({clientWidth: 390, clientHeight: 844})};
  vm.runInContext(fn("getMapViewportKeyV638"), ctx);
  const on = ctx.getMapViewportKeyV638();
  state.enabled = false;
  assert.notEqual(ctx.getMapViewportKeyV638(), on);
  assert.match(read("css/map-field-mode-v1.css"), /\.js-field-map-heading-up-v1 \.field-lease-card-v1,/);
  assert.match(read("css/map-field-mode-v1.css"), /align-items: center; gap: 3px/);
  assert.match(read("index.html"), /js\/map-field-lease-cards-v1\.js/);
});
