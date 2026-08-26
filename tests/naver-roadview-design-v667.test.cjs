const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(
  path.join(root, "css", "unified-listings-v8.css"),
  "utf8"
);

assert.match(
  html,
  /class="roadview-view-controls-v667"[\s\S]*?class="roadview-view-tabs"[\s\S]*?class="roadview-header-divider-v667"/,
  "로드뷰 전환 버튼과 매물 정보 사이에 시각적 구분이 있어야 합니다."
);
assert.match(html, /class="roadview-history-icon-v667"/);
assert.match(html, /class="roadview-external-mark-v667"/);
assert.match(
  css,
  /\.roadview-history-button-v666\s*\{[\s\S]*?background:\s*#fff;[\s\S]*?color:\s*#475569;/,
  "과거사진 버튼은 선택 탭과 경쟁하지 않는 중립 보조 버튼이어야 합니다."
);
assert.match(
  css,
  /\.roadview-history-button-v666:hover:not\(:disabled\)\s*\{[\s\S]*?background:\s*#f0fbf5;/,
  "과거사진 버튼은 hover에서만 네이버 계열 색상을 보여야 합니다."
);
assert.match(
  html,
  /class="naver-roadview-map-legend-v667"[\s\S]*?class="target"[\s\S]*?매물 위치[\s\S]*?class="current"[\s\S]*?현재 거리뷰/,
  "연동 지도에는 두 마커의 의미를 설명하는 범례가 있어야 합니다."
);
assert.match(css, /\.naver-roadview-map-legend-v667 i\.target\s*\{[\s\S]*?#1877f2/);
assert.match(css, /\.naver-roadview-map-legend-v667 i\.current\s*\{[\s\S]*?#0cbf7a/);
assert.match(
  css,
  /\.naver-roadview-panorama-panel-v654\s*\{[\s\S]*?border-right:\s*1px solid #cbd5e1;[\s\S]*?box-shadow:/,
  "거리뷰와 연동 지도 사이에 선과 약한 그림자 경계가 있어야 합니다."
);
assert.match(
  css,
  /\.naver-map-auth-failed-v663 > \.naver-roadview-panorama-panel-v654\s*\{[\s\S]*?border-right:\s*0;[\s\S]*?box-shadow:\s*none;/,
  "연동 지도가 숨겨진 인증 실패 상태에서는 불필요한 경계도 없어야 합니다."
);
assert.match(html, /unified-listings-v8\.css\?v=8\.1\.35-transaction-check-emphasis/);

console.log("NAVER roadview visual polish v6.6.7 tests passed");
