import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const mobile = readFileSync(new URL("../js/mobile-app-v1.js", import.meta.url), "utf8");
const detail = readFileSync(new URL("../js/mobile-detail-fix-v6.js", import.meta.url), "utf8");
function functionSource(source, name, nextName) {
  const start = source.indexOf("  function " + name + "(");
  const end = source.indexOf("  function " + nextName + "(", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
test("entering mobile mode copies the applied desktop query even if the hidden input retained focus", () => {
  const input = {value: ""};
  const source = {value: "괴정"};
  const context = {chrome: {querySelector: () => input}, document: {getElementById: () => source, activeElement: input}};
  vm.runInNewContext(functionSource(mobile, "syncSearchValue", "syncTradeMode") + "syncSearchValue(true);", context);
  assert.equal(input.value, "괴정");
  input.value = "작성중";
  vm.runInNewContext("syncSearchValue();", context);
  assert.equal(input.value, "작성중", "ordinary sync must not overwrite the focused editor");
  assert.match(mobile, /function activate\(\)[\s\S]*?syncSearchValue\(true\)/);
});
test("mobile market, save status and focus use shared state without duplicating sale IDs", () => {
  assert.match(mobile, /JSListingTradeV1\.onSelectorChange\(event.target\)/);
  assert.match(mobile, /js-listing-trade-mode-change", syncTradeMode/);
  assert.match(mobile, /js-mutation-status", syncSaveStatus/);
  assert.match(mobile, /keydown", handleMobileEscape, true/);
  assert.match(mobile, /event\.isComposing \|\| document\.querySelector\("dialog\[open\]"\)/);
  assert.match(detail, /target\.appendChild\(source\)/);
  assert.match(detail, /saleFilterAnchor\.parentNode\.insertBefore\(source, saleFilterAnchor\)/);
  assert.match(detail, /sheetRow.hidden = !!\(originalRow && originalRow.hidden\)/);
  assert.match(detail, /JSDialogFocusV1\.activate\(root/);
  assert.match(detail, /JSDialogFocusV1\.deactivate\(root\)/);
  assert.doesNotMatch(detail, /cloneNode/);
});
