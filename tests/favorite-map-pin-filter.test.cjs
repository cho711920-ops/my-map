const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/map.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (!depth) return source.slice(start, index + 1);
  }
  throw new Error(`Missing end of ${name}`);
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function harness(options = {}) {
  const items = [
    { propertyId: "removed", key: "old-a" },
    { propertyId: "kept", key: "old-b" },
    { key: "legacy-c" },
    { propertyId: "other", key: "old-d" }
  ];
  const ids = ["property:removed", "property:kept", "key:legacy-c"];
  const state = {
    window: { favoriteOnly: true, activeFavoriteFolderId: "folder-a" },
    allItems: items,
    jsPinnedClusterSelectionV6515: {
      spatialKey: "same-map-position",
      itemIdentities: ids.slice(),
      snapshot: {
        selectedItemIdentity: ids[0],
        singleItemIds: ids.slice(),
        multiItemIdGroups: [[ids[0]], [ids[1], ids[2]]],
        multiClusterMode: true
      }
    },
    jsClusterSelectionMemoryV638: { singleItemIds: ids.slice(), multiItemIdGroups: [[ids[0]], [ids[1], ids[2]]] },
    jsPinnedClusterSpatialChangeIgnoreUntilV6517: 100,
    selectedGroupKey: "old-cluster",
    selectedGroupKeys: ["cluster-a", "cluster-b"],
    selectedItemKey: "old-a",
    selectedListCardIdV845: "id:removed",
    jsLastRenderedItemsV639: [],
    shown: [],
    document: { getElementById() { return null; } },
    getAdministrativeListItemsV6570(itemsToShow) { return itemsToShow; },
    showList(itemsToShow) { state.shown.push(itemsToShow); },
    drawMapClustersOnlyV639() {
      state.snapshotAtMapDraw = plain(state.jsPinnedClusterSelectionV6515);
    },
    restoreClusterSelectionSnapshotV638(snapshot) { state.transientSnapshot = plain(snapshot); },
    ...options
  };
  vm.createContext(state);
  vm.runInContext([
    "getStableItemIdentityV638", "getPinnedClusterItemsV6515", "clearPinnedClusterSelectionV6515",
    "restrictFavoriteMapPinnedSelectionV1", "drawItems", "restorePinnedClusterSelectionAfterTransientUiV6525"
  ].map(extractFunction).join("\n"), state);
  state.getMapSpatialKeyV6515 = () => "same-map-position";
  return state;
}

test("favorite-map redraw removes deleted folder members from pinned rows and snapshots", () => {
  const state = harness();
  const kept = [state.allItems[1], state.allItems[2], state.allItems[3]];
  state.drawItems(kept);
  assert.deepEqual(plain(state.shown[0]), kept.slice(0, 2));
  assert.deepEqual(state.snapshotAtMapDraw.itemIdentities, ["property:kept", "key:legacy-c"]);
  assert.deepEqual(state.snapshotAtMapDraw.snapshot.singleItemIds, ["property:kept", "key:legacy-c"]);
  assert.deepEqual(state.snapshotAtMapDraw.snapshot.multiItemIdGroups, [["property:kept", "key:legacy-c"]]);
  assert.equal(state.snapshotAtMapDraw.snapshot.selectedItemIdentity, "");
  assert.equal(state.selectedItemKey, null);
  assert.equal(state.selectedListCardIdV845, null);
  assert.equal(state.jsPinnedClusterSelectionV6515.spatialKey, "same-map-position");
  assert.equal(state.allItems.length, 4, "only folder selection changes; originals remain available");
  assert.deepEqual(plain(state.jsClusterSelectionMemoryV638.multiItemIdGroups), [["property:kept", "key:legacy-c"]]);
});

test("returning from a detail or original link cannot resurrect the removed pinned member", () => {
  const state = harness();
  state.drawItems([state.allItems[1], state.allItems[2]]);
  state.restorePinnedClusterSelectionAfterTransientUiV6525();
  assert.deepEqual(plain(state.shown[1]), state.allItems.slice(1, 3));
  assert.deepEqual(state.transientSnapshot.singleItemIds, ["property:kept", "key:legacy-c"]);
  assert.equal(state.transientSnapshot.selectedItemIdentity, "");
});

test("removing the last selected cluster member clears that pin and shows remaining folder rows", () => {
  const state = harness();
  state.drawItems([state.allItems[3]]);
  assert.equal(state.jsPinnedClusterSelectionV6515, null);
  assert.deepEqual(plain(state.shown[0]), [state.allItems[3]]);
  assert.equal(state.selectedGroupKey, null);
  assert.deepEqual(plain(state.selectedGroupKeys), []);
  assert.deepEqual(plain(state.jsClusterSelectionMemoryV638), { singleItemIds: [], multiItemIdGroups: [] });
});

test("removing every folder member leaves an empty list instead of falling back to allItems", () => {
  const state = harness();
  state.drawItems([]);
  assert.equal(state.jsPinnedClusterSelectionV6515, null);
  assert.deepEqual(plain(state.shown[0]), []);
  assert.equal(state.window.favoriteOnly, true);
  assert.equal(state.window.activeFavoriteFolderId, "folder-a");
});

test("ordinary map and all-favorites filtering preserve their existing pinned behavior", () => {
  for (const windowState of [
    { favoriteOnly: false, activeFavoriteFolderId: "folder-a" },
    { favoriteOnly: true, activeFavoriteFolderId: "" },
    { favoriteOnly: false, activeFavoriteFolderId: "" }
  ]) {
    const state = harness({ window: windowState });
    const before = plain(state.jsPinnedClusterSelectionV6515);
    state.drawItems([state.allItems[3]]);
    assert.deepEqual(plain(state.jsPinnedClusterSelectionV6515), before);
    assert.deepEqual(plain(state.shown[0]), state.allItems.slice(0, 3));
  }
});

test("stable property IDs survive a refreshed key while nonremoved selection stays selected", () => {
  const state = harness();
  state.jsPinnedClusterSelectionV6515.snapshot.selectedItemIdentity = "property:kept";
  state.selectedItemKey = "old-b";
  state.selectedListCardIdV845 = "id:kept";
  const refreshed = { propertyId: "kept", key: "new-b" };
  state.allItems[1] = refreshed;
  state.drawItems([refreshed]);
  assert.deepEqual(plain(state.shown[0]), [refreshed]);
  assert.equal(state.jsPinnedClusterSelectionV6515.snapshot.selectedItemIdentity, "property:kept");
  assert.equal(state.selectedListCardIdV845, "id:kept");
});

test("folder map without a pin still renders the filtered rows normally", () => {
  const state = harness({ jsPinnedClusterSelectionV6515: null });
  state.drawItems([state.allItems[1]]);
  assert.deepEqual(plain(state.shown[0]), [state.allItems[1]]);
});
