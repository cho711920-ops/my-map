import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mapSource = fs.readFileSync("js/map.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("the single final listing render still honors the pinned cluster guard", () => {
  assert.match(
    mapSource,
    /var hasPinnedClusterList = !!jsPinnedClusterSelectionV6515 \|\| !!selectedGroupKey/
  );
  assert.match(mapSource, /if \(!hasPinnedClusterList && typeof showList === "function"\)/);
  assert.doesNotMatch(mapSource, /function showListWithoutReleasingPinnedClusterV685/);
  assert.match(mapSource, /Promise\.all\(\[[\s\S]*?sheetRequest,[\s\S]*?unifiedRequest\.catch/);
  assert.match(html, /js\/map\.js\?v=8\.2\.22-full-initial-render/);
});
