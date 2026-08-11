const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "header-professional-v1.css"), "utf8");

assert.match(html, /header-professional-v1\.css\?v=1\.0\.0-tablet-single-row/);
assert.match(html, /class="js-brand-subtitle-v2">대전 상가 매물지도<\/small>/);

[
  'onclick="applyFilter()"',
  'onclick="toggleDetailFilter()"',
  'onclick="resetFilter()"',
  "onclick=\"openOperationsCenter('dashboard')\"",
  "onclick=\"openOperationsCenter('customers')\"",
  'onclick="JSUnifiedListingsV8.openTell()"',
  'onclick="startAiVisitPreview()"',
  'onclick="openQuickAddModal()"'
].forEach((handler) => assert.ok(html.includes(handler), `기존 상단 기능 연결 유지: ${handler}`));

assert.ok((html.match(/class="top-action-icon-v638"/g) || []).length >= 8, "상단 주요 기능에 선형 아이콘이 있어야 합니다.");

const labels = ["검색", "필터", "초기화", "운영현황", "고객매칭", "Tell", "AI임장하기", "빠른등록"];
let previous = -1;
labels.forEach((label) => {
  const index = html.indexOf(`<span>${label}</span>`, previous + 1);
  assert.ok(index > previous, `상단 메뉴 순서와 라벨 유지: ${label}`);
  previous = index;
});

assert.match(css, /@media \(min-width: 900px\)[\s\S]*grid-template-columns: minmax\(255px, 1fr\) max-content/);
assert.match(css, /grid-template-columns: 70px 76px 52px 84px 48px 90px/);
assert.match(css, /\.desktop-operations-action \{ grid-column: 1/);
assert.match(css, /\.quick-add-btn \{ grid-column: 6/);
assert.match(css, /\.map-quick-tools,[\s\S]*background: transparent !important/);
assert.match(css, /\.map-quick-tool-btn \{[\s\S]*background: rgba\(255, 255, 255, \.72\)/);
assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.top-action-icon-v638/);

console.log("professional header/tablet layout tests passed");
