const assert = require("node:assert/strict");
const fs = require("node:fs");

const headers = fs.readFileSync("_headers", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");

const csp = headers.match(/Content-Security-Policy:[^\r\n]+/);
assert.ok(csp, "Content-Security-Policy header must exist");
assert.match(csp[0], /script-src[^;]+https:\/\/oapi\.map\.naver\.com/);
assert.match(csp[0], /script-src[^;]+https:\/\/apis\.naver\.com/);
assert.match(csp[0], /script-src[^;]+https:\/\/map\.pstatic\.net/);
assert.match(csp[0], /script-src[^;]+https:\/\/nrbe\.pstatic\.net/);

assert.match(script, /mapTypeId:\s*window\.naver\.maps\.MapTypeId\.NORMAL/);
assert.match(
  script,
  /Event\.addListener\([\s\S]*?naverRoadviewMapV654,[\s\S]*?"tilesloaded",[\s\S]*?markNaverRoadviewMapTilesReadyV665/
);
assert.match(script, /function verifyNaverRoadviewMapTilesV665\(\)/);
assert.match(script, /setMapTypeId\(window\.naver\.maps\.MapTypeId\.NORMAL\)/);
assert.match(script, /Event\.trigger\(naverRoadviewMapV654, "resize"\)/);
assert.match(html, /script\.js\?v=6\.10\.7-interaction-smooth/);

console.log("NAVER linked-map tiles v6.6.5 tests passed");
