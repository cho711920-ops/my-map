import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/mobile-detail-fix-v6.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/phone-filter-v1.css", import.meta.url), "utf8");
function fn(name, next) {
  const start = source.indexOf("  function " + name + "(");
  const end = next ? source.indexOf("  function " + next + "(", start) : source.indexOf('\n  window.addEventListener("js-listing-trade-mode-change"', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
function fixture(phone = true) {
  const originals = {minRent: {value: "70"}, sourceFilter: {value: "naver"}};
  const drafts = {minRent: {value: "90"}, sourceFilter: {value: "danggeun"}};
  const context = {
    FIELD_IDS: ["minRent"], PHONE_TOOLBAR_IDS: ["sourceFilter"],
    isDedicatedPhone: () => phone,
    originalField: (id) => originals[id], sheetField: (id) => drafts[id],
    window: {applyFilter: () => true}, close: (options) => {context.closed = options;}
  };
  vm.createContext(context);
  vm.runInContext(fn("syncToOriginal", "ensureSheet") + fn("apply"), context);
  return {context, originals, drafts};
}

test("phone filters commit copied toolbar controls only on Apply", () => {
  const {context, originals} = fixture();
  assert.equal(originals.sourceFilter.value, "naver");
  vm.runInContext("apply();", context);
  assert.equal(originals.sourceFilter.value, "danggeun");
  assert.equal(originals.minRent.value, "90");
  assert.equal(context.closed.applied, true);
});

test("tablet and narrow desktop apply leave their shared toolbar values unchanged", () => {
  const {context, originals} = fixture(false);
  vm.runInContext("apply();", context);
  assert.equal(originals.sourceFilter.value, "naver");
  assert.equal(originals.minRent.value, "90");
});

test("rejected phone Apply retains drafts but restores original values", () => {
  const {context, originals, drafts} = fixture();
  context.window.applyFilter = () => false;
  vm.runInContext("apply();", context);
  assert.equal(originals.sourceFilter.value, "naver");
  assert.equal(originals.minRent.value, "70");
  assert.equal(drafts.minRent.value, "90");
  assert.equal(context.closed, undefined);
});

test("throwing filter validation also restores shared phone values", () => {
  const {context, originals} = fixture();
  context.window.applyFilter = () => {throw new Error("validation unavailable");};
  assert.throws(() => vm.runInContext("apply();", context), /validation unavailable/);
  assert.equal(originals.minRent.value, "70");
  assert.equal(originals.sourceFilter.value, "naver");
});

test("phone Reset is staged and cancelled sale changes restore original shared IDs", () => {
  const {context, originals, drafts} = fixture();
  const saleFields = [{id: "saleLandMin", value: "20", checked: false}];
  context.saleFilterSnapshot = null;
  context.document = {getElementById: () => ({querySelectorAll: () => saleFields}), querySelector: () => ({textContent: ""})};
  vm.runInContext(fn("resetPhoneDraft", "syncSaleFilters") + fn("captureSaleFilterValues", "restoreSaleFilters"), context);
  vm.runInContext("captureSaleFilterValues(); resetPhoneDraft();", context);
  assert.equal(drafts.minRent.value, "");
  assert.equal(drafts.sourceFilter.value, "");
  assert.equal(originals.minRent.value, "70");
  assert.equal(originals.sourceFilter.value, "naver");
  assert.equal(saleFields[0].value, "");
  vm.runInContext("finishSaleFilterEdit(false);", context);
  assert.equal(saleFields[0].value, "20");
  assert.equal(saleFields[0].id, "saleLandMin");
});

test("phone additions are gated and no native toolbar event handlers are copied", () => {
  assert.match(source, /if \(!isDedicatedPhone\(\) \|\| root\.querySelector\("\.js-phone-filter-actions"\)\) return/);
  assert.match(source, /PHONE_TOOLBAR_IDS = \["sourceFilter", "typeFilter", "brokerageFeeFilter"\]/);
  assert.match(source, /document\.createElement\("option"\)/);
  assert.doesNotMatch(source, /cloneNode/);
  assert.match(source, /target\.appendChild\(source\)/, "sale filters still move as a single shared-ID instance");
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of withoutComments.split("}").filter((rule) => rule.trim())) {
    const selectors = rule.split("{")[0].trim().split(",");
    for (const selector of selectors) assert.match(selector.trim(), /^(?:\.js-phone-app-v2\b|\.js-phone-filter-only$)/);
  }
  assert.match(css, /font-size: 16px/);
  assert.match(css, /min-height: 48px/);
});
