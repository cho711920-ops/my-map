import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { NAVER_PROPERTY_TYPES } from "../cloudflare/src/naver-property-types.js";

function setup() {
  const select = {value: "", options: [], set innerHTML(value) {this.options = [];}, appendChild(option) {this.options.push(option);}};
  const window = {dispatchEvent() {}};
  const document = {
    getElementById(id) {return id === "typeFilter" ? select : null;}, querySelector() {return null;},
    documentElement: {setAttribute() {}}, createElement() {return {};}
  };
  const context = vm.createContext({window, document, CustomEvent: class CustomEvent {}});
  vm.runInContext(fs.readFileSync("js/listing-trade-ui-v1.js", "utf8"), context);
  const script = fs.readFileSync("js/script.js", "utf8");
  for (const name of ["getListingTypeLabelV1", "updateTypeOptions", "normalizeSearchComparableText", "getSearchComparableFields", "buildSearchText", "itemKey"]) {
    const match = script.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return {ui: window.JSListingTradeV1, context, select};
}

test("all Naver codes have identical Korean frontend and ingestion labels/categories without mutating legacy identity", () => {
  const {ui, context} = setup();
  for (const [code, expected] of Object.entries(NAVER_PROPERTY_TYPES)) {
    const item = {name: "기존매물", address: "대전 서구", room: "3층", type: code, source: "네이버",
      tradeType: "sale", saleCategory: "other", propertyId: "existing-property", key: "legacy-key",
      salePrice: 12000, saleDetails: {scope: "unit", sourceType: code}};
    const before = JSON.stringify(item), key = context.itemKey(item);
    assert.equal(ui.displayType(item), expected.label, code);
    assert.equal(ui.normalizedSaleCategory(item), expected.saleCategory, code);
    assert.equal(ui.matchesItem(item, "lease"), false, code);
    assert.equal(ui.matchesItem(item, "land_sale"), expected.saleCategory === "land", code);
    assert.equal(ui.matchesItem(item, "building_sale"), expected.saleCategory !== "land", code);
    assert.equal(JSON.stringify(item), before, code);
    assert.equal(context.itemKey(item), key, code);
  }
});

test("dropdown groups old coded/new Korean types and restores the old selection", () => {
  const {ui, context, select} = setup();
  ui.setMode("building_sale", {apply: false});
  const items = [
    {type: "A02", source: "네이버", tradeType: "sale", saleCategory: "other"},
    {type: "오피스텔", source: "네이버", tradeType: "sale", saleCategory: "officetel"},
    {type: "B01", source: "naver", tradeType: "sale", saleCategory: "other"},
    {type: "E03", source: "네이버", tradeType: "sale", saleCategory: "other"},
    {type: "상가점포", source: "네이버", tradeType: "lease"}
  ];
  select.value = "A02";
  context.updateTypeOptions(items);
  assert.deepEqual(select.options.map(option => option.textContent).sort(), ["아파트분양권", "오피스텔"]);
  assert.equal(select.value, "오피스텔");
  assert.equal(items.filter(item => context.getListingTypeLabelV1(item) === select.value).length, 2);
  assert.match(context.buildSearchText(items[0]), /오피스텔/);
  assert.ok(context.getSearchComparableFields(items[0]).some(field => field.text === "오피스텔"));
});

test("unknown Naver codes remain reviewable, custom non-Naver types and explicit classifications are preserved", () => {
  const {ui} = setup();
  assert.equal(ui.displayType({type: "X99", source: "네이버"}), "기타(유형 확인 필요)");
  assert.equal(ui.displayType({type: "상가주택", source: "네이버"}), "상가주택");
  assert.equal(ui.displayType({type: "A02", source: "직접등록"}), "A02");
  assert.equal(ui.displayType({type: "custom", source: "공실박스"}), "custom");
  assert.equal(ui.displayType(null), "");
  assert.equal(ui.normalizedSaleCategory({type: "C03", source: "네이버", saleCategory: "multifamily"}), "multifamily");
  assert.equal(ui.normalizedSaleCategory({type: "C03", source: "네이버", saleCategory: "other"}), "house");
});
