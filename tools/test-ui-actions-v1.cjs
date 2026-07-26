const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function classList() {
  return {
    add() {},
    remove() {},
    toggle() {},
    contains() { return false; }
  };
}

const launcherNode = { classList: classList() };
const aiContext = {
  console,
  localStorage: storage(),
  navigator: {},
  document: {
    body: { classList: classList() },
    getElementById(id) { return id === "aiVisitLauncherModal" ? launcherNode : null; },
    querySelector() { return null; },
    addEventListener() {}
  },
  fetch() {
    return Promise.resolve({
      ok: true,
      json() { return Promise.resolve({ ok: true, found: false }); }
    });
  },
  MutationObserver: function() {
    this.observe = function() {};
    this.disconnect = function() {};
  },
  alert() {},
  confirm() { return true; },
  setTimeout() { return 0; },
  clearTimeout() {},
  setInterval() { return 0; }
};
aiContext.window = aiContext;
vm.runInNewContext(
  fs.readFileSync(path.join(root, "js", "ai-visit-session-v6.js"), "utf8"),
  aiContext,
  { filename: "ai-visit-session-v6.js" }
);

const holdDiagnostic = aiContext.window.JSAiVisitDiagnosticsV6433;
assert(holdDiagnostic, "AI visit hold diagnostics are missing");
const heldControl = holdDiagnostic.visitHoldControl(true, 3);
assert.strictEqual(heldControl.label, "보류해제");
assert.strictEqual(heldControl.className, "hold unhold");
assert.strictEqual(heldControl.action, "JSAiVisitV6.requestUnhold(3)");
const pendingControl = holdDiagnostic.visitHoldControl(false, 3);
assert.strictEqual(pendingControl.label, "보류");
assert.strictEqual(pendingControl.action, "JSAiVisitV6.holdCurrent()");

const operationsContext = {
  console,
  sessionStorage: storage(),
  localStorage: storage(),
  URLSearchParams,
  document: {
    body: { classList: classList() },
    visibilityState: "visible",
    getElementById() { return null; },
    addEventListener() {}
  },
  fetch() { return Promise.reject(new Error("network disabled in unit test")); },
  setTimeout() { return 0; },
  clearTimeout() {},
  setInterval() { return 0; }
};
operationsContext.window = operationsContext;
vm.runInNewContext(
  fs.readFileSync(path.join(root, "js", "operations-center-v7.js"), "utf8"),
  operationsContext,
  { filename: "operations-center-v7.js" }
);

const operationsDiagnostic = operationsContext.window.JSOperationsDiagnosticsV7151;
assert(operationsDiagnostic, "operations dashboard diagnostics are missing");
const reviewCard = operationsDiagnostic.dashboardCard(
  "검증 대기",
  6682,
  "사람의 판단이 필요한 원본",
  "warning",
  "reviews"
);
assert(reviewCard.includes("<button"), "review dashboard card must be a button");
assert(
  reviewCard.includes("onclick=\"switchOperationsTab('reviews')\""),
  "review dashboard card must open the review tab"
);
assert(reviewCard.includes("매물검증 바로 보기 →"));

const customerCard = operationsDiagnostic.dashboardCard(
  "고객 문의",
  5,
  "진행 중인 고객 조건",
  "",
  "active"
);
assert(
  customerCard.includes("onclick=\"openCustomerWorkQueue('active')\""),
  "existing customer dashboard navigation must remain unchanged"
);

console.log("UI action tests: OK");
