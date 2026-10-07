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
function harness(moduleSource = source) {
  const state = { enabled: true, scale: 20, mode: "lease", selected: [], details: [], more: [] };
  const ctx = {
    window: null, overlays: [], selectedItemKey: "",
    map: {getLevel: () => 1},
    JSFieldModeV1: {isFollowing: () => state.enabled, state: () => state},
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
  vm.runInContext(moduleSource, ctx);
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

test("only 20m and 30m show lease cards; 50m hides cards even while waiting for a fresh GPS fix", () => {
  const {ctx, api, state} = harness();
  for (const [scale, level] of [[20, 1], [30, 2]]) {
    state.scale = scale;
    ctx.map.getLevel = () => level;
    assert.equal(api.active(), true);
  }
  state.scale = 50;
  assert.equal(api.active(), false, "a stale 30m camera cannot leave cards visible at selected 50m");
  ctx.map.getLevel = () => 3;
  assert.equal(api.active(), false);
  state.scale = 20;
  assert.equal(api.active(), false, "wait for the actual 20m/30m zoom before showing cards");
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
test("nearby addresses remain separate in lease-card mode; no input mutation or extra data", () => {
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

test("stale lease-card clicks at 50m cannot open old details or replace the current list", () => {
  const {ctx, api, state} = harness();
  const cluster = mount(ctx, api, [item("A")]);
  state.scale = 50;
  const key = encodeURIComponent(cluster.key);
  assert.equal(api.open(key, encodeURIComponent("id:A")), false);
  assert.equal(api.more(key), false);
  assert.deepEqual(state.details, []);
  assert.deepEqual(state.more, []);
  assert.deepEqual(state.selected, []);
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
test("actual map builder uses field address groups at levels 1/2 and retains old path at 50m or OFF", () => {
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
  for (level of [1, 2]) {
    const clusters = ctx.createClustersForCurrentZoomV655(groups);
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0].fieldLease, true);
    assert.match(ctx.buildClusterOverlayContentV655(clusters[0], " selected"), /field-lease-row-v1/);
  }
  level = 3;
  state.scale = 50;
  assert.deepEqual(Array.from(ctx.createClustersForCurrentZoomV655(groups)), ["normal-grid"]);
  assert.equal(api.active(), false);
  level = 1;
  state.scale = 20;
  state.enabled = false;
  assert.deepEqual(Array.from(ctx.createClustersForCurrentZoomV655(groups)), ["normal-exact"]);
  assert.equal(api.active(), false);
});
test("viewport dedupe distinguishes stationary ON/OFF, CSS counter-rotation includes the complete anchor", () => {
  const {ctx, state} = harness();
  ctx.map = {getLevel: () => 1, getCenter: () => ({getLat: () => 36.35, getLng: () => 127.38})};
  ctx.document = {getElementById: () => ({clientWidth: 390, clientHeight: 844})};
  vm.runInContext(fn("getMapViewportKeyV638"), ctx);
  const on = ctx.getMapViewportKeyV638();
  state.scale = 50;
  assert.notEqual(ctx.getMapViewportKeyV638(), on, "50m request invalidates stale GPS-wait cards at the same camera zoom");
  state.scale = 20;
  state.enabled = false;
  assert.notEqual(ctx.getMapViewportKeyV638(), on);
  assert.match(read("css/map-field-mode-v1.css"), /\.js-field-map-heading-up-v1 \.field-lease-anchor-v1,/);
  assert.doesNotMatch(read("css/map-field-mode-v1.css"), /\.js-field-map-heading-up-v1 \.field-lease-card-v1,/);
  assert.match(read("css/map-field-mode-v1.css"), /align-items: center; gap: 2px/);
  assert.match(read("css/map-field-mode-v1.css"), /min-width: 112px; max-width: 210px/);
  assert.match(read("css/map-field-mode-v1.css"), /min-height: 44px; flex-direction: column/);
  assert.match(read("index.html"), /js\/map-field-lease-cards-v1\.js/);
});

function placement(key, x = 400, y = 300, extra = {}) {
  return {key, point: {x, y}, width: 112, height: 46, ...extra};
}
function freezeDeep(value) {
  Object.values(value).forEach(entry => { if (entry && typeof entry === "object") freezeDeep(entry); });
  return Object.freeze(value);
}
function absoluteBox(result, rows) {
  const point = rows.find(row => row.key === result.key).point;
  return {left: point.x + result.x, top: point.y + result.y,
    right: point.x + result.x + result.width, bottom: point.y + result.y + result.height};
}
function overlapArea(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

test("one card remains centered 20px above its immutable geographic anchor", () => {
  const {api} = harness();
  const rows = freezeDeep([placement("A")]);
  const result = api.planLayout(rows, 800, 600);
  assert.equal(result.length, 1);
  assert.deepEqual({...result[0]}, {key: "A", x: -56, y: -66, width: 112, height: 46});
  assert.deepEqual(rows[0].point, {x: 400, y: 300});
  assert.equal(api.planLayout([], 800, 600).length, 0);
});

test("nearby cards separate without hiding any listing or covering the source points", () => {
  const {api} = harness();
  const rows = freezeDeep(Array.from({length: 6}, (_, index) => placement("P" + index, 395 + index * 2, 300)));
  const first = api.planLayout(rows, 800, 600);
  const boxes = Array.from(first, row => absoluteBox(row, rows));
  assert.equal(first.length, rows.length);
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    assert.ok(box.left >= 8 && box.top >= 8 && box.right <= 792 && box.bottom <= 592);
    for (const other of boxes.slice(index + 1)) assert.equal(overlapArea(box, other), 0);
    for (const {point} of rows) assert.equal(overlapArea(box,
      {left: point.x - 6, top: point.y - 6, right: point.x + 6, bottom: point.y + 6}), 0);
  }
  assert.equal(JSON.stringify(api.planLayout(rows, 800, 600)), JSON.stringify(first), "same input has deterministic placement");
});

test("selected cards have first choice and a noncolliding cached offset survives redraw", () => {
  const {api} = harness();
  const rows = freezeDeep([placement("A"), placement("Z", 400, 300, {selected: true})]);
  const result = api.planLayout(rows, 800, 600);
  assert.equal(result[0].key, "Z");
  assert.equal(result[0].x, -56);
  assert.equal(result[0].y, -66);
  assert.equal(overlapArea(absoluteBox(result[0], rows), absoluteBox(result[1], rows)), 0);
  const previous = freezeDeep([placement("A", 400, 300, {previous: {x: 20, y: -23}})]);
  const restored = api.planLayout(previous, 800, 600)[0];
  assert.equal(restored.x, 20);
  assert.equal(restored.y, -23);
});

test("obstacle-edge fallback separates cached tall and short cards in a narrow portrait viewport", () => {
  const {api} = harness();
  // Fixed rings used to leave 121px² of visible card overlap in this exact
  // selection/redraw state, although free space existed above an obstacle.
  const rows = freezeDeep([
    placement("1-1", 180, 296, {width: 120, height: 171, selected: false, previous: {x: -60, y: -191}}),
    placement("2-2", 179, 293, {width: 120, height: 46, selected: true, previous: {x: -60, y: 20}}),
    placement("3-3", 181, 292, {width: 120, height: 46, selected: false, previous: {x: 51, y: 50}})
  ]);
  const original = JSON.stringify(rows);
  const result = api.planLayout(rows, 360, 564);
  assert.deepEqual(Array.from(result, row => row.key).sort(), ["1-1", "2-2", "3-3"]);
  assert.equal(result[0].key, "2-2", "the selected card keeps placement priority");
  assert.equal(result[0].x, -60);
  assert.equal(result[0].y, 20, "the safe selected offset does not jump to resolve another card");
  const boxes = Array.from(result, row => absoluteBox(row, rows));
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    assert.ok(box.left >= 8 && box.top >= 8 && box.right <= 352 && box.bottom <= 556);
    for (const other of boxes.slice(index + 1)) assert.equal(overlapArea(box, other), 0, "all three complete cards remain visible without overlap");
    for (const {point} of rows) assert.equal(overlapArea(box,
      {left: point.x - 6, top: point.y - 6, right: point.x + 6, bottom: point.y + 6}), 0);
  }
  assert.equal(JSON.stringify(rows), original, "geographic anchors and cached inputs are immutable");
  assert.equal(JSON.stringify(api.planLayout(rows, 360, 564)), JSON.stringify(result));
  const nextRows = freezeDeep(rows.map(row => {
    const position = result.find(entry => entry.key === row.key);
    return {...row, previous: {x: position.x, y: position.y}};
  }));
  assert.equal(JSON.stringify(api.planLayout(nextRows, 360, 564)), JSON.stringify(result), "the resolved edge placements stay stable on the next redraw");
});

function shortLandscapeRows() {
  return freezeDeep([
    placement("1-1", 177.5, 146, {width: 120, height: 171, selected: false, previous: {x: 49.5, y: -138}}),
    placement("2-2", 176.5, 143, {width: 120, height: 46, selected: true, previous: {x: -60, y: 20}}),
    placement("3-3", 178.5, 142, {width: 120, height: 46, selected: false, previous: {x: -170.5, y: -124}})
  ]);
}

test("short landscape packing resolves a tall card blocked by greedy cached small-card placements", () => {
  const {api} = harness();
  const rows = shortLandscapeRows();
  const original = JSON.stringify(rows);
  const result = api.planLayout(rows, 355, 264);
  const canonical = positions => JSON.stringify(Array.from(positions).sort((a, b) => a.key.localeCompare(b.key)));
  assert.deepEqual(Array.from(result, row => row.key).sort(), ["1-1", "2-2", "3-3"]);
  const boxes = Array.from(result, row => absoluteBox(row, rows));
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    assert.ok(box.left >= 8 && box.top >= 8 && box.right <= 347 && box.bottom <= 256);
    for (const other of boxes.slice(index + 1)) assert.equal(overlapArea(box, other), 0);
    for (const {point} of rows) assert.equal(overlapArea(box,
      {left: point.x - 6, top: point.y - 6, right: point.x + 6, bottom: point.y + 6}), 0);
  }
  assert.equal(JSON.stringify(rows), original, "retry cannot mutate selection, source coordinates or prior offsets");
  assert.equal(canonical(api.planLayout(rows, 355, 264)), canonical(result));
  const nextRows = freezeDeep(rows.map(row => {
    const position = result.find(entry => entry.key === row.key);
    return {...row, previous: {x: position.x, y: position.y}};
  }));
  for (let redraw = 0; redraw < 3; redraw++) {
    assert.equal(canonical(api.planLayout(nextRows, 355, 264)), canonical(result),
      "a collision-free retry stays fixed on subsequent selected-first redraws");
  }
});

test("large-card retry is limited to one extra pass for colliding groups of at most 24 cards", () => {
  const signature = "  function placeRows(ordered, rows, width, height) {";
  assert.ok(source.includes(signature));
  const {ctx, api} = harness(source.replace(signature, signature + "\n    global.__layoutPassCount = (global.__layoutPassCount || 0) + 1;"));
  function passCount(rows, width, height) {
    ctx.__layoutPassCount = 0;
    api.planLayout(rows, width, height);
    return ctx.__layoutPassCount;
  }
  assert.equal(passCount([placement("single")], 800, 600), 1);
  assert.equal(passCount([placement("A", 180, 300), placement("B", 600, 300)], 800, 600), 1);
  assert.equal(passCount(shortLandscapeRows(), 355, 264), 2);
  const dense = count => Array.from({length: count}, (_, index) => placement("dense-" + index, 160, 100));
  assert.equal(passCount(dense(24), 320, 200), 2);
  assert.equal(passCount(dense(25), 320, 200), 1, "large groups must not double their placement work");
});

test("viewport edges clamp labels to eight pixels while preserving all original coordinates", () => {
  const {api} = harness();
  for (const [x, y] of [[1, 1], [399, 1], [1, 299], [399, 299]]) {
    const rows = freezeDeep([placement("edge", x, y)]);
    const box = absoluteBox(api.planLayout(rows, 400, 300)[0], rows);
    assert.ok(box.left >= 8 && box.top >= 8 && box.right <= 392 && box.bottom <= 292);
    assert.deepEqual(rows[0].point, {x, y});
  }
});

test("dense or undersized screens degrade to overlap rather than silently removing listings", () => {
  const {api} = harness();
  const rows = freezeDeep(Array.from({length: 80}, (_, index) => placement("dense-" + index, 160, 100)));
  for (const [width, height] of [[320, 200], [80, 40]]) {
    const result = api.planLayout(rows, width, height);
    assert.equal(result.length, rows.length);
    assert.equal(new Set(Array.from(result, row => row.key)).size, rows.length);
    for (const row of result) {
      assert.ok(Number.isFinite(row.x) && Number.isFinite(row.y));
      assert.equal(row.width, 112);
      assert.equal(row.height, 46);
    }
  }
});

test("leader tails attach to a real card edge and point toward the unchanged zero origin", () => {
  const {api} = harness();
  assert.deepEqual({...api.leaderFor(-56, -66, 112, 46)},
    {x: 0, y: -20, tipX: 0, tipY: -11, tailPath: "M -5 -20 L 0 -11 L 5 -20"});
  for (const [x, y, width, height] of [[20, -23, 112, 46], [-132, -23, 112, 46], [-56, 20, 112, 46], [80, -140, 210, 144], [-280, 100, 210, 46]]) {
    const leader = api.leaderFor(x, y, width, height);
    assert.ok(leader.x >= x && leader.x <= x + width && leader.y >= y && leader.y <= y + height);
    assert.ok(leader.x === x || leader.x === x + width || leader.y === y || leader.y === y + height);
    const edgeDistance = Math.hypot(leader.x, leader.y);
    const tipDistance = Math.hypot(leader.tipX, leader.tipY);
    assert.ok(tipDistance < edgeDistance);
    assert.ok(Math.abs(leader.x * leader.tipY - leader.y * leader.tipX) < 1e-8, "tail stays on the line to the origin");
    assert.ok(Math.hypot(leader.tipX - leader.x, leader.tipY - leader.y) <= 9.000001);
    assert.match(leader.tailPath, /^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/);
  }
});

test("tail, leader and location dot are decorative; only the original card buttons capture clicks", () => {
  const {ctx, api} = harness();
  const cluster = mount(ctx, api, [item("A")]);
  const html = api.content(cluster, " selected");
  assert.match(html, /class="field-lease-anchor-v1 selected" data-field-lease-key=/);
  assert.match(html, /<svg class="field-lease-leader-v1"[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.match(html, /class="field-lease-location-v1" aria-hidden="true"/);
  assert.equal((html.match(/onclick=/g) || []).length, 1);
  assert.equal((html.match(/<button/g) || []).length, 1);
  const css = read("css/map-field-mode-v1.css");
  for (const name of ["anchor", "leader", "location"]) {
    assert.match(css, new RegExp("\\.field-lease-" + name + "-v1\\s*\\{[^}]*pointer-events: none"));
  }
  assert.match(css, /\.field-lease-anchor-v1\s*\{[^}]*width: 0; height: 0;[^}]*transform-origin: 0 0/);
  assert.match(css, /\.field-lease-card-v1\s*\{[^}]*pointer-events: auto/);
  assert.match(html, /x2="0" y2="0"/);
});

function layoutHarness({railRect = null, mapLeft = 0, pointX = 398} = {}) {
  const setup = harness();
  const {ctx} = setup;
  const calls = [], frames = [], nodes = [];
  ctx.requestAnimationFrame = callback => { frames.push(callback); };
  const viewport = {get clientWidth() { calls.push("read:viewport-width"); return 800; },
    get clientHeight() { calls.push("read:viewport-height"); return 600; }, querySelectorAll: () => nodes,
    getBoundingClientRect() { calls.push("read:viewport-rect"); return {left: mapLeft}; }};
  const rail = railRect && {getBoundingClientRect() { calls.push("read:rail-rect"); return railRect; }};
  ctx.document = {getElementById: id => id === "map" ? viewport : id === "mapQuickTools" ? rail : null};
  ctx.getMapDisplayProjectionV1 = () => ({containerPointFromCoords(point) { calls.push("read:projection"); return point; }});
  for (let index = 0; index < 3; index++) {
    const key = "group-" + index;
    const point = Object.freeze({x: pointX + index, y: 300});
    const cluster = {key, fieldLease: true, latlng: point};
    ctx.overlays.push({__cluster: cluster});
    const card = {get offsetWidth() { calls.push("read:width:" + key); return 112; },
      get offsetHeight() { calls.push("read:height:" + key); return 46; }, classList: {contains: () => false},
      style: new Proxy({}, {set(target, name, value) { calls.push("write:style:" + key + ":" + name); target[name] = value; return true; }})};
    const lines = [0, 1].map(() => ({setAttribute(name, value) { calls.push("write:line:" + key + ":" + name); this[name] = value; }}));
    const tail = {setAttribute(name, value) { calls.push("write:tail:" + key); this[name] = value; }};
    nodes.push({key, point, card, lines, tail, getAttribute: () => key,
      querySelector: selector => selector === ".field-lease-card-v1" ? card : tail,
      querySelectorAll: () => lines});
  }
  return {...setup, calls, frames, nodes};
}

test("layout work coalesces to one RAF and batches every size/projection read before DOM writes", () => {
  const {api, frames, calls, nodes} = layoutHarness();
  for (let index = 0; index < 20; index++) api.scheduleLayout();
  assert.equal(frames.length, 1);
  assert.equal(calls.length, 0, "no synchronous measurements on repeated schedule requests");
  frames.shift()();
  const firstWrite = calls.findIndex(call => call.startsWith("write:"));
  assert.ok(firstWrite > 0);
  assert.equal(calls.slice(firstWrite).some(call => call.startsWith("read:")), false);
  assert.equal(calls.filter(call => call.startsWith("read:width:")).length, 3);
  for (const node of nodes) {
    assert.match(node.card.style.left, /^-?\d+(?:\.\d+)?px$/);
    assert.match(node.card.style.top, /^-?\d+(?:\.\d+)?px$/);
    assert.equal(node.card.style.transform, "none");
    assert.equal(node.lines[0].x1, node.lines[1].x1);
    assert.equal(node.lines[0].y1, node.lines[1].y1);
    assert.match(node.tail.d, /^M /);
    assert.equal(node.point.y, 300);
  }
  const prior = nodes.map(node => [node.card.style.left, node.card.style.top]);
  calls.length = 0;
  api.scheduleLayout();
  assert.equal(frames.length, 1, "coalescing guard releases after the completed frame");
  frames.shift()();
  assert.deepEqual(nodes.map(node => [node.card.style.left, node.card.style.top]), prior);
});

test("visible right-hand tools reserve label space using map-relative coordinates before any write", () => {
  const mapLeft = 100;
  const railRect = {left: 840, width: 44, height: 180};
  const {api, frames, calls, nodes} = layoutHarness({mapLeft, railRect, pointX: 770});
  api.scheduleLayout();
  frames.shift()();
  const firstWrite = calls.findIndex(call => call.startsWith("write:"));
  assert.ok(calls.indexOf("read:rail-rect") >= 0 && calls.indexOf("read:rail-rect") < firstWrite);
  assert.ok(calls.indexOf("read:viewport-rect") >= 0 && calls.indexOf("read:viewport-rect") < firstWrite);
  assert.equal(calls.slice(firstWrite).some(call => call.startsWith("read:")), false);
  for (const [index, node] of nodes.entries()) {
    const right = node.point.x + parseFloat(node.card.style.left) + 112;
    assert.ok(right <= railRect.left - mapLeft - 4 - 8,
      "the complete card stays left of tool-rail margin and the normal viewport padding");
    assert.equal(node.point.x, 770 + index, "only the label moves, never the geographic dot");
  }
});

test("hidden, left-hand and out-of-map tool rails do not reduce the original label viewport", () => {
  const positions = railRect => {
    const {api, frames, nodes} = layoutHarness({mapLeft: 100, pointX: 770, railRect});
    api.scheduleLayout();
    frames.shift()();
    return nodes.map(node => [node.point.x + parseFloat(node.card.style.left) + 112, node.card.style.top]);
  };
  const baseline = positions(null);
  assert.ok(baseline.some(([right]) => right > 728), "the fixture exercises space reserved by a visible right rail");
  for (const railRect of [
    {left: 840, width: 0, height: 180},
    {left: 840, width: 44, height: 0},
    {left: 120, width: 44, height: 180},
    {left: 1000, width: 44, height: 180}
  ]) assert.deepEqual(positions(railRect), baseline);
});

test("a queued layout rechecks OFF, sale, 50m and stale overlay state before touching cards", () => {
  for (const stop of [state => {state.enabled = false;}, state => {state.mode = "building_sale";}, state => {state.scale = 50;}]) {
    const {api, frames, calls, state} = layoutHarness();
    api.scheduleLayout();
    stop(state);
    frames.shift()();
    assert.deepEqual(calls, []);
  }
  const {api, ctx, frames, calls} = layoutHarness();
  api.scheduleLayout();
  ctx.overlays = [];
  frames.shift()();
  assert.equal(calls.some(call => call.startsWith("write:") || call.startsWith("read:width:")), false);
  assert.match(mapSource, /JSFieldLeaseCardsV1\.scheduleLayout\(\)/);
});
