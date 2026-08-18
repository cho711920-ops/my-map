const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const headers = fs.readFileSync(path.join(root, "_headers"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");

function functionBody(name, nextName) {
  const start = script.indexOf(`function ${name}`);
  const end = nextName
    ? script.indexOf(`function ${nextName}`, start + 1)
    : script.length;
  assert.ok(start >= 0, `${name} function must exist`);
  assert.ok(end > start, `${name} function boundary must exist`);
  return script.slice(start, end);
}

const csp = headers.match(/Content-Security-Policy:[^\r\n]+/);
assert.ok(csp, "Content-Security-Policy header must exist");
assert.match(csp[0], /script-src[^;]+https:\/\/oapi\.map\.naver\.com/);
assert.match(csp[0], /script-src[^;]+https:\/\/apis\.naver\.com/);

const recoverBody = functionBody(
  "recoverNaverMapsAuthStateV664",
  "loadNaverMapsSdkV653"
);
assert.match(recoverBody, /naverMapsAuthFailedV663 = false/);
assert.match(recoverBody, /classList\.remove\("naver-map-auth-failed-v663"\)/);
assert.match(recoverBody, /removeAttribute\("aria-hidden"\)/);

const unavailableBody = functionBody(
  "showNaverRoadviewUnavailableV664",
  "markNaverRoadviewReadyV658"
);
assert.doesNotMatch(unavailableBody, /switchRoadviewMode\("kakao"\)/);
assert.match(unavailableBody, /setupNaverRoadviewMapV654/);

const startBody = functionBody("startNaverRoadviewV653", "warmNaverRoadviewSdkV658");
const mapSetupIndex = startBody.indexOf("setupNaverRoadviewMapV654(position)");
const panoramaIndex = startBody.indexOf("new window.naver.maps.Panorama");
assert.ok(mapSetupIndex >= 0, "linked NAVER map must be initialized");
assert.ok(
  panoramaIndex > mapSetupIndex,
  "linked NAVER map must appear before panorama initialization"
);

assert.match(script, /\}, 12000\);/);
assert.doesNotMatch(script, /\}, 6500\);/);
assert.match(html, /script\.js\?v=6\.10\.1-brokerage-fee-filter/);

console.log("NAVER roadview runtime recovery v6.6.4 tests passed");
