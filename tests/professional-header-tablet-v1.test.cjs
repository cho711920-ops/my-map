const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "header-professional-v1.css"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");

assert.match(html, /header-professional-v1\.css\?v=1\.1\.4-integrated-map-rail/);
assert.match(html, /class="js-brand-subtitle-v2">대전 상가 매물지도<\/small>/);

[
  'onclick="applyFilter()"',
  'onclick="toggleDetailFilter()"',
  'onclick="resetFilter()"',
  "onclick=\"openOperationsCenter('dashboard')\"",
  "onclick=\"openOperationsCenter('customers')\"",
  'onclick="JSUnifiedListingsV8.openTell()"',
  'onclick="startAiVisitPreview()"',
  'onclick="openQuickAddModal()"',
  'onclick="jsSecureLogout(this)"'
].forEach((handler) => assert.ok(html.includes(handler), `기존 상단 기능 연결 유지: ${handler}`));

assert.ok((html.match(/class="top-action-icon-v638"/g) || []).length >= 8, "상단 주요 기능에 선형 아이콘이 있어야 합니다.");

const labels = ["검색", "필터", "초기화", "운영현황", "고객매칭", "Tell", "AI임장하기", "빠른등록", "로그아웃"];
let previous = -1;
labels.forEach((label) => {
  const index = html.indexOf(`<span>${label}</span>`, previous + 1);
  assert.ok(index > previous, `상단 메뉴 순서와 라벨 유지: ${label}`);
  previous = index;
});

assert.match(css, /@media \(min-width: 900px\)[\s\S]*grid-template-columns: auto max-content/);
assert.match(css, /grid-template-columns: 66px 70px 70px 78px 0 84px 84px/);
assert.match(css, /\.desktop-operations-action \{ grid-column: 1/);
assert.match(css, /\.quick-add-btn \{ grid-column: 6/);
assert.match(css, /\.top-logout-btn-v1 \{ grid-column: 7/);
assert.match(css, /\.top-logout-btn-v1:hover \{[\s\S]*color: #c24141/);
assert.match(css, /\.map-quick-tools \{[\s\S]*background: transparent !important/);
assert.match(css, /\.map-quick-tools-inner \{[\s\S]*width: 50px !important;[\s\S]*border: 1px solid rgba\(151, 169, 191, \.58\) !important;[\s\S]*background: rgba\(255, 255, 255, \.82\) !important/);
assert.match(css, /\.map-quick-tools-inner::before \{[\s\S]*content: "도구";[\s\S]*border-bottom: 1px solid rgba\(151, 169, 191, \.42\);[\s\S]*background: transparent/);
assert.match(css, /\.map-quick-tool-btn \{[\s\S]*border-color: transparent !important;[\s\S]*border-radius: 8px !important;[\s\S]*background: rgba\(255, 255, 255, \.7\) !important;[\s\S]*box-shadow: none !important/);
assert.match(css, /\.map-quick-tool-btn \{[\s\S]*backdrop-filter: none !important/);
assert.match(css, /\.search-row \{[\s\S]*gap: 0 !important/);
assert.match(css, /\.search-row #keyword \{[\s\S]*border-right: 0 !important/);
assert.match(css, /\.quick-add-btn \.sync-indicator \{[\s\S]*display: none !important/);
assert.match(css, /width: min\(526px, calc\(100vw - 682px\)\) !important/);
assert.match(css, /width: min\(530px, calc\(100vw - 816px\)\) !important/);
assert.match(css, /grid-template-columns: 80px 84px 76px 94px 0 98px 98px/);
assert.match(css, /grid-template-columns: 92px 96px 84px 106px 0 108px 108px/);
assert.match(css, /@media \(min-width: 1200px\)[\s\S]*\.v6-toolbar-secondary\.v6-command-bar > \.top-logout-btn-v1 \{[\s\S]*font-size: 13px !important;[\s\S]*font-weight: 900 !important/);
assert.match(css, /\.top-logout-btn-v1 \.top-action-icon-v638 \{[\s\S]*width: 18px !important;[\s\S]*height: 18px !important/);
assert.match(css, /@media \(min-width: 1540px\)[\s\S]*font-size: 13px !important/);
assert.match(css, /@media \(min-width: 1540px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\) 76px !important/);
assert.match(css, /@media \(min-width: 1540px\)[\s\S]*\.quick-add-btn\.v6-secondary-action \{[\s\S]*font-size: 14px !important/);
assert.match(css, /\.map-quick-heart-btn \.map-quick-icon-v638 \{[\s\S]*display: block !important/);
assert.doesNotMatch(script, /btn\.innerHTML\s*=\s*"<span>다중/);
assert.match(script, /label\.textContent\s*=\s*"다중선택"/);
assert.ok((html.match(/class="map-quick-icon-v638"/g) || []).length >= 6);
assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.top-action-icon-v638/);

console.log("professional header/tablet layout tests passed");
