const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const collectorPath = path.join(__dirname, "..", "js", "daangn-collector.js");
const installPath = path.join(__dirname, "..", "daangn-collector-install.html");
const collector = fs.readFileSync(collectorPath, "utf8");
const install = fs.readFileSync(installPath, "utf8");

function loadFunction(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = collector.match(new RegExp(
    "(function " + escapedName + "\\([\\s\\S]*?\\n  \\})\\n\\n  function "
  ));
  assert.ok(match, name + " function must exist");
  return Function('"use strict";return (' + match[1] + ");")();
}

assert.match(collector, /VERSION = "1\.0\.1"/);
assert.match(collector, /cluster_id/);
assert.match(collector, /clusterId/);
assert.match(collector, /js_district/);
assert.match(collector, /handleMapMarkerClick/);
assert.match(collector, /syncSelectionFromLocation/);
assert.match(collector, /setInterval\(function \(\) \{ syncSelectionFromLocation\(false\); \}, 300\)/);
assert.match(collector, /\[0, 80, 220, 500, 900, 1500, 2500\]/);
assert.match(collector, /\[aria-label="Map marker"\]/);
assert.match(collector, /danggeunStartJob/);
assert.match(collector, /danggeunRunJobChunk/);
assert.match(collector, /danggeunPauseJob/);
assert.match(collector, /안전중단/);
assert.match(collector, /완전수집/);
assert.match(collector, /101호와 102호는 별도/);
assert.match(collector, /당근 링크 최우선 유지/);
assert.match(install, /js\/daangn-collector\.js/);
assert.match(install, /URL을 복사하거나 붙여넣을 필요가 없습니다|URL 복사 없이/);
assert.match(install, /당근 수집<\/strong>을 먼저 누릅니다/);
assert.match(install, /확대 후 숫자 클러스터/);

const districtFromMarkerText = loadFunction("districtFromMarkerText");
const clusterIdFromUrl = loadFunction("clusterIdFromUrl");
const findClusterIdDeep = loadFunction("findClusterIdDeep");

assert.equal(districtFromMarkerText("동구 매물 541"), "동구");
assert.equal(districtFromMarkerText("유성구매물 1,902"), "유성구");
assert.equal(districtFromMarkerText("516"), "");
assert.equal(
  clusterIdFromUrl("https://realty.daangn.com/map/x?cluster_id=REGION%3A1112&mv=1"),
  "REGION:1112"
);
assert.equal(
  findClusterIdDeep([{variables: {input: {nested: {clusterId: "CELL:abc"}}}}], 0),
  "CELL:abc"
);

console.log("daangn map collector tests: ok");
