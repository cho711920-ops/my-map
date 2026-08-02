const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function functionBody(name, nextName) {
  const start = script.indexOf(`function ${name}`);
  const end = nextName ? script.indexOf(`function ${nextName}`, start + 1) : script.length;
  assert.ok(start >= 0, `${name} 함수가 있어야 합니다.`);
  assert.ok(end > start, `${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return script.slice(start, end);
}

assert.match(script, /function buildNaverRoadviewCandidatesV658\(coords\)/);
assert.match(script, /var radiusMeters = 110;/);
assert.match(script, /주변 네이버 거리뷰를 확인하고 있습니다\. /);
assert.match(script, /"pano_status"[\s\S]*?tryNextNaverRoadviewCandidateV658\(\)/);

const startBody = functionBody("startNaverRoadviewV653", "warmNaverRoadviewSdkV658");
assert.match(startBody, /setPosition\(position\)/);
assert.match(startBody, /setTimeout\(markNaverRoadviewReadyV658, 0\)/);

const openBody = functionBody("openKakaoRoadview", "openPropertySourceLink");
assert.doesNotMatch(openBody, /naverRoadviewInstanceV653\s*=\s*null/);
assert.doesNotMatch(openBody, /setupRoadviewFullMap\(/);
assert.doesNotMatch(openBody, /destroyNaverRoadviewMapV654\(/);

const closeBody = functionBody("closeRoadviewModal", "formatListRegistrationDate");
assert.doesNotMatch(closeBody, /naverRoadviewInstanceV653\.setVisible\(false\)/);
assert.match(closeBody, /naverRoadviewInstanceV653\.destroy\(\)/);
assert.match(closeBody, /naverRoadviewInstanceV653\s*=\s*null/);
assert.doesNotMatch(closeBody, /destroyNaverRoadviewMapV654\(/);

const loadSdkBody = functionBody("loadNaverMapsSdkV653", "formatNaverPanoramaDateV653");
assert.match(loadSdkBody, /staleSdk\.remove\(\)/);
assert.match(loadSdkBody, /maps-panorama\.js/);

assert.match(script, /requestIdleCallback\(warmNaverRoadviewSdkV658/);
assert.match(script, /if \(mapActive && !roadviewFullMap && roadviewTargetPosition\)/);
assert.match(script, /if \(panoramaPosition\) setupNaverRoadviewMapV654\(panoramaPosition\)/);
assert.match(script, /\}, 6500\);/);
assert.ok(
  html.includes("script.js?v=6.5.62-naver-map-auth-guard"),
  "빠른 네이버 거리뷰 캐시 버전이 적용되어야 합니다."
);

console.log("naver roadview reliable reopen v6.5.60 tests passed");
