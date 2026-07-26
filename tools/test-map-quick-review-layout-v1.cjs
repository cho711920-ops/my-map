const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), "utf8");

const index = read("index.html");
const style = read("css", "style.css");
const map = read("js", "map.js");
const quickTools = read("js", "map-quick-tools-v657.js");
const script = read("js", "script.js");
const operations = read("js", "operations-collection-v8.js");
const operationsCss = read("css", "operations-collection-v8.css");

[
  'id="mapQuickTools"',
  'id="mapQuickViewBtn"',
  'id="mapQuickListBtn"',
  'id="multiClusterBtn"',
  'id="mapDistanceBtn"',
  'id="mapRadiusBtn"',
  'id="selectionActionBar"',
  'id="sourceFilter"',
  'id="floorQuickFilter"',
  "오늘 신규만",
  "임장할매물만",
  "계약완료 숨김",
  "찜❤️",
  "찜목록",
  "임장목록",
  "100m",
  "300m",
  "500m",
  "1km",
  "2km"
].forEach((needle) => assert(index.includes(needle), `index is missing ${needle}`));

assert(!index.includes('id="listPrintSelectedBtn"'), "duplicate list-header print button must be removed");
assert(index.includes("desktop-operations-action"), "desktop operations shortcut is missing");
assert(index.includes("desktop-customer-action"), "desktop customer shortcut is missing");
assert(index.includes("completeSelectedItems()"), "contract completion action is missing");
assert(index.includes("markSelectedAsVisited()"), "field visit completion action is missing");

assert(
  style.includes("@media (max-width: 768px)") &&
    style.includes(".map-quick-tools") &&
    style.includes("display: none !important"),
  "desktop-only quick toolbar guard is missing"
);
assert(/\.map-quick-tools\s*\{/.test(style), "quick toolbar layout is missing");
assert(style.includes(".selection-action-bar"), "selection action bar styling is missing");

assert(quickTools.includes("toggleDistanceMeasureV657"), "distance measuring is missing");
assert(quickTools.includes("startRadiusMeasureV657"), "radius measuring is missing");
assert(quickTools.includes("kakao.maps.Polyline"), "distance line rendering is missing");
assert(quickTools.includes("kakao.maps.Circle"), "radius circle rendering is missing");
assert(quickTools.includes("distancePoints.push(event.latLng)"), "multi-point distance measuring is missing");
assert(quickTools.includes("distanceLine.setPath(distancePoints)"), "distance route extension is missing");
assert(quickTools.includes("window.mapRadiusFilterV658 = {"), "radius list filter state is missing");
assert(!quickTools.includes("preventMap"), "measurement cleanup must not block later map input");
assert(script.includes("isItemWithinMapRadiusV658(item, radiusFilter)"), "radius filtering is not connected to the list");
assert(script.includes("matchSource") && script.includes("matchQuickFloor"), "source/floor quick filters are missing");
assert(style.includes("position: absolute !important") && style.includes("background: transparent !important"), "map tools must overlay the map");

assert(map.includes("Math.floor(point.x / gridSize)"), "grid-cluster X bucketing is missing");
assert(map.includes("Math.floor(point.y / gridSize)"), "grid-cluster Y bucketing is missing");
assert(map.includes("(cluster.cellX + 0.5) * gridSize"), "grid-cluster centering is missing");
assert(map.includes('if (value >= 100) return " cluster-size-lg"'), "large cluster size threshold is missing");
assert(map.includes('if (value >= 20) return " cluster-size-md"'), "medium cluster size threshold is missing");
assert(
  !/v6\.5\.7[\s\S]*?\.circle-marker\.gongsil-cluster\s*\{\s*background\s*:/i.test(style),
  "new cluster layout must not flatten source colors"
);

[
  "review-existing-panel",
  "review-existing-badge",
  "review-new-panel",
  "review-new-list",
  "review-item-compact",
  "review-item-checkbox",
  "toggleReviewGroupSelection",
  "applyReviewBatch"
].forEach((needle) => assert(operations.includes(needle), `review UI is missing ${needle}`));

assert(
  operationsCss.includes("border-left-width:7px") &&
    operationsCss.includes("background:#fff7f7"),
  "existing-property emphasis is missing"
);
assert(operationsCss.includes(".review-new-list{min-height:0"), "scrollable new-property list is missing");
assert(operationsCss.includes("min-height:61px"), "compact review rows are missing");
assert(
  operationsCss.includes("grid-template-columns:repeat(2,minmax(0,1fr))") &&
    operationsCss.includes("min-height:62px"),
  "multi-select high-density review grid is missing"
);
assert(
  operationsCss.includes("v7.17.1 모바일 검증카드") &&
    operationsCss.includes("grid-template-columns:22px 26px minmax(0,1fr)!important") &&
    operationsCss.includes("grid-column:1/-1"),
  "mobile review card layout recovery is missing"
);
assert(quickTools.includes("syncMapQuickToolGeometryV659"), "tablet map-tool geometry sync is missing");

console.log("Map quick tools and compact review layout tests: OK");
