const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const collectorPath = path.join(__dirname, "..", "js", "daangn-collector.js");
const installPath = path.join(__dirname, "..", "daangn-collector-install.html");
const collector = fs.readFileSync(collectorPath, "utf8");
const install = fs.readFileSync(installPath, "utf8");

assert.match(collector, /VERSION = "1\.0\.0"/);
assert.match(collector, /cluster_id/);
assert.match(collector, /clusterId/);
assert.match(collector, /danggeunStartJob/);
assert.match(collector, /danggeunRunJobChunk/);
assert.match(collector, /danggeunPauseJob/);
assert.match(collector, /안전중단/);
assert.match(collector, /완전수집/);
assert.match(collector, /101호와 102호는 별도/);
assert.match(collector, /당근 링크 최우선 유지/);
assert.match(install, /js\/daangn-collector\.js/);
assert.match(install, /URL을 복사하거나 붙여넣을 필요가 없습니다|URL 복사 없이/);

console.log("daangn map collector tests: ok");
