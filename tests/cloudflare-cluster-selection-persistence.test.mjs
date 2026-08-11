import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const mapSource = fs.readFileSync("js/map.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function loadPinnedListHelper(context) {
  const match = mapSource.match(
    /function showListWithoutReleasingPinnedClusterV685\(fallbackItems\) \{[\s\S]*?\n\}/
  );
  assert.ok(match, "pinned-cluster list guard must exist");
  vm.createContext(context);
  vm.runInContext(`${match[0]}; this.helper = showListWithoutReleasingPinnedClusterV685;`, context);
  return context.helper;
}

test("late unified data keeps the selected cluster list", () => {
  const rendered = [];
  const context = {
    jsPinnedClusterSelectionV6515: { itemIdentities: ["property:1"] },
    getPinnedClusterItemsV6515: () => [{ propertyId: "1" }],
    showList: (items) => rendered.push(items)
  };
  const helper = loadPinnedListHelper(context);

  assert.equal(helper([{ propertyId: "all" }]), true);
  assert.deepEqual(rendered, [[{ propertyId: "1" }]]);
});

test("a transient missing pinned item never falls back to the full list", () => {
  const rendered = [];
  const context = {
    jsPinnedClusterSelectionV6515: { itemIdentities: ["property:1"] },
    getPinnedClusterItemsV6515: () => [],
    showList: (items) => rendered.push(items)
  };
  const helper = loadPinnedListHelper(context);

  assert.equal(helper([{ propertyId: "all" }]), true);
  assert.deepEqual(rendered, []);
});

test("idle and both asynchronous listing paths honor the pinned guard", () => {
  assert.match(
    mapSource,
    /var hasPinnedClusterList = !!jsPinnedClusterSelectionV6515 \|\| !!selectedGroupKey/
  );
  assert.equal(
    (mapSource.match(/showListWithoutReleasingPinnedClusterV685\(currentItems\)/g) || []).length,
    2
  );
  assert.match(html, /js\/map\.js\?v=8\.2\.2-pinned-cluster-list/);
});
