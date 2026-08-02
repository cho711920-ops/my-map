const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const operations = fs.readFileSync("js/operations-center-v7.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const css = fs.readFileSync("css/operations-center-v7.css", "utf8");
const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);

assert.match(html, /고객별 매칭매물 관리/);
assert.match(html, /메인 매물리스트가 그대로 열립니다/);
assert.match(html, /operations-center-v7\.css\?v=7\.20\.3-customer-save-fast-feedback/);
assert.match(html, /operations-center-v7\.js\?v=7\.20\.3-customer-save-fast-feedback/);
assert.match(html, /script\.js\?v=6\.5\.51-customer-match-map-fixes/);
assert.match(operations, /syncCustomerMatchMapStatusV722/);

assert.match(operations, /customerView:\s*"before"/);
assert.match(operations, /① 고객 목록/);
assert.match(operations, /② ' \+ escape\(customerName\) \+ ' 고객 매칭매물/);
assert.match(operations, /customerViewButton\("before", "미팅전"/);
assert.match(operations, /customerViewButton\("after", "미팅후"/);
assert.match(operations, /customerViewButton\("paused", "보류"/);
assert.match(operations, /operations-customer-stats-v719/);
assert.doesNotMatch(operations, /operations-customer-phone-v719/);
assert.doesNotMatch(
  operations,
  /고객 매칭매물<\/b><span>' \+ escape\(customerConditionTextV719/
);
assert.match(operations, /compactResponse:\s*true/);
assert.match(operations, /applyCompactCustomerSaveV723/);
assert.match(operations, /restoreCustomerEditorAfterFailureV723/);
assert.match(operations, /window\.closeCustomerMemo\(\);[\s\S]*?apiPost\("addCustomerActivity"/);
assert.match(operations, />상담·미팅 메모<\/button>/);
assert.doesNotMatch(operations, />상담·미팅 기록<\/button>/);
assert.match(operations, /operations-match-listing-toolbar-v719/);
assert.match(operations, /출처 필터/);
assert.match(operations, /구분 필터/);
assert.match(operations, /층 필터/);
assert.match(operations, /renderCustomerMatchListingCardV719/);
assert.match(operations, /handleOperationsCustomerMatchToggleV719/);
assert.match(operations, /nextStatus = input && input\.checked \? selectedStatus : \(oldStatus === selectedStatus \? "신규" : oldStatus\)/);
assert.match(operations, /return apiPost\("updateCustomerMatch"/);

assert.match(script, /function addListItem\(item, appendTarget, customerMatchContextV719\)/);
assert.match(script, /window\.renderCustomerMatchListingCardV719/);
assert.match(script, /customer-match-choice-v719 introduce/);
assert.match(script, /customer-match-choice-v719 hold/);
assert.match(script, /actionContactButtonV654 \+/);

assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)!important/);
assert.match(css, /operations-customer-meta-v720/);
assert.match(css, /operations-customer-condition-v719\{[\s\S]*?font-size:14px!important/);
assert.match(css, /grid-template-rows:auto auto auto!important/);
assert.match(css, /item-source-link-btn\.active:not\(\.unified-expand-btn-v8\)/);
assert.match(css, /item-source-link-btn\.unified-expand-btn-v8/);
assert.match(css, /content:"메모"/);
assert.match(css, /operations-customer-grid\{display:grid;grid-template-columns:1fr!important/);
assert.match(css, /operations-match-listing-cards-v719\{display:grid;grid-template-columns:1fr/);
assert.match(css, /operations-match-listing-cards-v719 \.item-card-grid-v650\{grid-template-columns:96px minmax\(0,1fr\)!important/);
assert.match(css, /customer-match-choice-v719\.introduce/);
assert.match(css, /customer-match-choice-v719\.hold/);

assert.match(backend, /MM_MATCH_STATUSES = \["신규", "연락", "소개", "거절", "보류", "계약완료"\]/);
assert.match(backend, /function mmEnsureCustomerSystemReady_\(\)/);
assert.match(backend, /body\.compactResponse === true/);
assert.match(backend, /response\.customerRow/);

console.log("customer match split-list v7.19 tests passed");
