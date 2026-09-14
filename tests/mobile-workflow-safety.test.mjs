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

test("cancelled mobile sale-filter edits restore shared controls while applied edits remain", () => {
  const fields = [{value: "30", checked: false}, {value: "building"}];
  const context = {saleFilterSnapshot: null, document: {getElementById: () => ({querySelectorAll: () => fields})}};
  vm.createContext(context);
  vm.runInContext(functionSource(detail, "captureSaleFilterValues", "restoreSaleFilters") + "captureSaleFilterValues();", context);
  fields[0].value = "90";
  fields[0].checked = true;
  fields[1].value = "office";
  vm.runInContext("finishSaleFilterEdit(false);", context);
  assert.deepEqual(fields, [{value: "30", checked: false}, {value: "building"}]);
  vm.runInContext("captureSaleFilterValues();", context);
  fields[0].value = "50";
  vm.runInContext("finishSaleFilterEdit(true);", context);
  assert.equal(fields[0].value, "50");
  assert.equal(context.saleFilterSnapshot, null);
  assert.match(detail, /finishSaleFilterEdit\(!!\(options && options.applied\)\);\s*restoreSaleFilters\(\)/);
  assert.match(detail, /function apply\(\)[\s\S]*?close\(\{applied: true\}\)/);
});

test("More-to-dialog navigation records the visible trigger before opening its destination", () => {
  const calls = [];
  const trigger = {focus: () => calls.push("focus-visible-trigger")};
  const layer = {hidden: false, __jsReturnFocusV1: trigger};
  const context = {
    chrome: {querySelector: () => layer},
    closeMore: (options) => {assert.equal(options.restore, false); calls.push("close-more");}
  };
  vm.runInNewContext(functionSource(mobile, "closeMoreForNavigation", "closeMore") + "closeMoreForNavigation();", context);
  assert.deepEqual(calls, ["close-more", "focus-visible-trigger"]);
  assert.match(mobile, /closeMoreForNavigation\(\);\s*global.openListManager\("favorite"\)/);
});

test("mobile layer replacement waits for asynchronous back traversal before pushing its destination", () => {
  const more = {id: "more"};
  const favorites = {id: "favorites"};
  const calls = [];
  let openLayers = [more];
  const states = [{page: "fixture"}];
  let index = 0;
  let pendingDelta = 0;
  const history = {
    get state() {return states[index];},
    pushState(state) {states.splice(++index, states.length, state); calls.push("push");},
    go(delta) {pendingDelta = delta; calls.push("go");}
  };
  const context = {
    active: true, historySyncQueued: false, ignoreNextPop: false,
    historyLayers: [], closingFromBackToken: "", historySerial: 0,
    global: {history, location: {href: "http://127.0.0.1/"}},
    openMobileLayers: () => openLayers,
    queueLayerHistorySync: () => calls.push("reconcile")
  };
  vm.createContext(context);
  vm.runInContext(functionSource(mobile, "syncLayerHistory", "queueLayerHistorySync") +
    functionSource(mobile, "handleMobileBack", "handleMobileEscape"), context);
  vm.runInContext("syncLayerHistory();", context);
  assert.equal(index, 1);
  openLayers = [favorites];
  vm.runInContext("syncLayerHistory(); syncLayerHistory();", context);
  assert.deepEqual(calls, ["push", "go"], "no destination push while back traversal is pending");
  index += pendingDelta;
  vm.runInContext("handleMobileBack({}); syncLayerHistory();", context);
  assert.equal(index, 1);
  assert.equal(context.historyLayers[0].element, favorites);
  openLayers = [];
  vm.runInContext("syncLayerHistory();", context);
  index += pendingDelta;
  vm.runInContext("handleMobileBack({}); syncLayerHistory();", context);
  assert.equal(index, 0, "closing favorites returns to the application base entry, not the previous document");
  assert.equal(history.state.page, "fixture");
  assert.equal(context.historyLayers.length, 0);
});
