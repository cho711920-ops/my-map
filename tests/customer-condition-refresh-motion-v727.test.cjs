const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const operations = fs.readFileSync("js/operations-center-v7.js", "utf8");
const operationsCss = fs.readFileSync("css/operations-center-v7.css", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const unifiedCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");

assert.match(html, /operations-center-v7\.css\?v=7\.20\.6-transaction-candidates/);
assert.match(html, /operations-center-v7\.js\?v=7\.22\.2-data-access/);
assert.match(html, /unified-listings-v8\.css\?v=8\.0\.38-elevator-capacity/);
assert.match(html, /unified-listings-v8\.js\?v=8\.1\.21-data-access/);

assert.match(operations, /customerConditionRefreshV727:\s*\{ customerId: "", status: "idle" \}/);
assert.match(operations, /조건변경 저장 후 새로운 매물 업데이트 중/);
assert.match(operations, /customer-condition-refresh-v727 is-active" role="status" aria-live="polite"/);
assert.match(operations, /customerConditionRefreshHtmlV727\(customerId\)/);
assert.match(operations, /setCustomerConditionRefreshV727\(editingCustomerId, "active"\)/);
assert.match(operations, /var closeAnimation = closeCustomerEditorAnimatedV727\(\)/);
assert.match(operations, /waitForCustomerConditionFeedbackV727\(closeAnimation, feedbackStartedAt\)/);
assert.match(operations, /setCustomerConditionRefreshV727\("", "idle"\)/);
assert.match(operations, /setCustomerConditionRefreshV727\(editingCustomerId, "error"\)/);
assert.match(operations, /!Array\.isArray\(result\.matches\)[\s\S]*?loadCustomerMatches\(state\.selectedCustomerId\)/);
assert.match(operations, /state\.loadedMatchCustomerId !== state\.selectedCustomerId[\s\S]*?새 매칭 결과를 확인하지 못했습니다/);
assert.match(operations, /customer-crm-modal-closing-v727/);
assert.match(operationsCss, /@keyframes customerCrmDialogOutV727/);
assert.match(operationsCss, /@keyframes customerConditionPulseV727/);
assert.match(operationsCss, /customer-condition-refresh-v727[\s\S]*?color:#c91e2f/);

assert.match(unified, /function showDetailDrawerV827\(drawer\)/);
assert.match(unified, /global\.requestAnimationFrame\(function\(\)/);
assert.match(unified, /drawer\.classList\.add\("closing-v827"\)/);
assert.match(unified, /showDetailDrawerV827\(drawer\)/);
assert.match(unifiedCss, /translateX\(44px\) scale\(\.992\)/);
assert.match(unifiedCss, /unified-detail-drawer-v8\.closing-v827/);
assert.match(unifiedCss, /prefers-reduced-motion: reduce/);

console.log("customer condition refresh/detail motion v7.27 tests passed");
