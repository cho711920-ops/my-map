const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "unified-listings-v8.css"), "utf8");
const api = fs.readFileSync(path.join(root, "api", "naver-maps-config.js"), "utf8");

assert.match(
  html,
  /id="naverRoadviewTabBtn"[\s\S]*?class="roadview-view-tab active"[\s\S]*?>네이버맵<\/button>/,
  "네이버맵 탭이 첫 번째 기본 탭이어야 합니다."
);
assert.match(html, /id="roadviewTabBtn"[\s\S]*?>카카오맵<\/button>/);
assert.match(html, /id="roadviewMapTabBtn"[\s\S]*?>지도<\/button>/);
assert.match(html, /id="naverRoadviewPane" class="roadview-pane active"/);

assert.match(script, /currentRoadviewMode = "naver"/);
assert.match(
  script,
  /oapi\.map\.naver\.com\/openapi\/v3\/maps\.js\?ncpKeyId=[\s\S]*?submodules=panorama/,
  "공식 네이버 지도 SDK의 panorama 모듈을 로드해야 합니다."
);
assert.match(script, /new window\.naver\.maps\.Panorama\(container,/);
assert.match(script, /switchRoadviewMode\("naver"\)/);
assert.match(
  script,
  /function showNaverRoadviewUnavailableV664/,
  "네이버 거리뷰 실패 상태를 화면에 표시해야 합니다."
);
assert.doesNotMatch(
  script,
  /function showNaverRoadviewUnavailableV664[\s\S]*?switchRoadviewMode\("kakao"\)/,
  "네이버 실패 시 사용자의 탭 선택을 카카오로 강제 변경하면 안 됩니다."
);
assert.match(script, /location\.photodate \|\| location\.photoDate/);

assert.match(api, /process\.env\.NAVER_MAPS_NCP_KEY_ID/);
assert.doesNotMatch(api, /CLIENT_SECRET|NAVER_MAPS_NCP_KEY_ID\s*=\s*["']/);
assert.match(api, /Cache-Control", "no-store/);
assert.match(api, /NAVER_MAPS_INVALID_CONFIG/);
assert.match(api, /X-NCP-APIGW-API-KEY-ID/);
assert.match(script, /function isInvalidNaverMapsKeyV662/);

assert.match(css, /#naverRoadviewTabBtn\.active/);
assert.match(css, /\.naver-roadview-capture-info-v653/);
assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id/);
assert.match(html, /unified-listings-v8\.css\?v=8\.1\.40-smooth-photo-expand/);

console.log("NAVER-first roadview v6.5.53 tests passed");
