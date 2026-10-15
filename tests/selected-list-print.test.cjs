const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync("js/print.js", "utf8");

test("selected-list printing retains listing amounts and user notes without an AI observer", () => {
  const selected = [{name: "선택 매물", address: "서구 탄방동 1", room: "101호", type: "상가",
    deposit: 2000, rent: 90, fee: 5, premium: 100, area: 25, memo: "보존할 사용자 메모",
    landlordPhone: "010-0000-0000"}];
  let html = "", printed = 0;
  const context = {
    getSelectedPrintItems: () => selected,
    isDone: () => false,
    escapeHtml: value => String(value),
    setTimeout: fn => fn(),
    window: {open: () => ({document: {write: value => {html = value;}, close() {}},
      focus() {}, print: () => {printed++;}})}
  };
  // No document/MutationObserver is supplied: importing the retained print
  // module must no longer install a whole-page AI button observer.
  vm.runInNewContext(source, context);
  context.printSelectedList();
  assert.equal(printed, 1);
  assert.match(html, /JS부동산 선택 매물 리스트/);
  assert.match(html, /선택 매물/);
  assert.match(html, /보2000 \/ 월90 \/ 관5 \/ 권100/);
  assert.match(html, /보존할 사용자 메모/);
  assert.equal(selected[0].memo, "보존할 사용자 메모");
});
