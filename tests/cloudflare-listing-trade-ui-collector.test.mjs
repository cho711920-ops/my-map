import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the market selector stays inside the search row without extra visible labels", async () => {
  const html = await read("../index.html");
  const css = await read("../css/listing-trade-v1.css");
  assert.match(html, /<div class="search-row">\s*<div class="listing-trade-mode-v1"[^>]*>\s*<select id="listingTradeModeSelectV1" aria-label="매물 시장"/);
  assert.match(html, /<\/select>\s*<\/div>\s*<input id="keyword"/);
  assert.doesNotMatch(html, /id="listingTradeModeLabelV1"|<label[^>]*for="listingTradeModeSelectV1"/);
  assert.match(css, /\.v6-toolbar-primary \.search-row\s*\{\s*grid-column: 1 !important;\s*grid-row: 1 !important;/);
  assert.match(css, /\.v6-toolbar-primary \.top-reset-btn\s*\{ grid-row: 1 !important;/);
  assert.match(css, /\.search-row #keyword\s*\{\s*grid-column: 2 !important;/);
  assert.match(css, /\.search-row \.search-btn\s*\{\s*grid-column: 3 !important;/);
  assert.match(css, /@media \(min-width: 769px\) and \(max-width: 899px\)/);
  assert.match(css, /width: min\(688px, calc\(100vw - 890px\)\)/);
});

test("the web starts in lease mode and isolates building and land sale listings", async () => {
  const ui = await read("../js/listing-trade-ui-v1.js");
  const html = await read("../index.html");
  const script = await read("../js/script.js");
  assert.match(ui, /var currentMode = "lease"/);
  assert.match(ui, /building_sale:[\s\S]*tradeType: "sale"/);
  assert.match(ui, /land_sale:[\s\S]*tradeType: "sale"/);
  assert.match(ui, /selected\.group === "land"/);
  assert.match(html, /상가임대[\s\S]*건물매매[\s\S]*토지매매/);
  assert.match(script, /JSListingTradeV1\.matchesItem\(item\)/);
  assert.match(script, /listing-sale-price-v1/);
});

test("the transaction selector resets cross-market price filters and keeps markets isolated", async () => {
  const ui = await read("../js/listing-trade-ui-v1.js");
  const elements = new Map([
    ["typeFilter", { value: "일반상가" }],
    ["minDeposit", { value: "1000", setAttribute() {} }],
    ["maxDeposit", { value: "5000", setAttribute() {} }]
  ]);
  let applied = 0;
  const window = {
    allItems: [],
    applyFilter() { applied += 1; },
    updateTypeOptions() {},
    dispatchEvent() {}
  };
  const document = {
    getElementById(id) { return elements.get(id) || null; },
    querySelector() { return null; },
    documentElement: { setAttribute() {} }
  };
  vm.runInNewContext(ui, {
    window, document,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  });
  assert.equal(window.JSListingTradeV1.getMode(), "lease");
  assert.equal(window.JSListingTradeV1.matchesItem({ tradeType: "lease" }), true);
  assert.equal(window.JSListingTradeV1.matchesItem({ tradeType: "sale", saleCategory: "land" }), false);
  window.JSListingTradeV1.setMode("building_sale");
  assert.equal(window.JSListingTradeV1.matchesItem({ tradeType: "sale", saleCategory: "commercial" }), true);
  assert.equal(window.JSListingTradeV1.matchesItem({ tradeType: "sale", saleCategory: "land" }), false);
  assert.equal(elements.get("typeFilter").value, "");
  assert.equal(elements.get("minDeposit").value, "");
  assert.equal(elements.get("maxDeposit").value, "");
  assert.equal(applied, 1);
  window.JSListingTradeV1.setMode("land_sale", { apply: false });
  assert.equal(window.JSListingTradeV1.matchesItem({ tradeType: "sale", saleCategory: "land" }), true);
  assert.equal(window.JSListingTradeV1.matchesItem({ tradeType: "sale", saleCategory: "building" }), false);
});

test("collector targets and completion checkpoints are split by trade type", async () => {
  const naver = await read("../js/naver-collector.js");
  const daangn = await read("../js/daangn-collector.js");
  const gongsil = await read("../js/gongsil-collector.js");
  const edge = await read("../edge-automation/extension/background.js");
  const server = await read("../cloudflare/src/collector-api.js");
  assert.match(naver, /key: "naver-" \+ tradeType \+ "-district-"/);
  assert.match(daangn, /key: "daangn-" \+ tradeType/);
  assert.match(gongsil, /key: "gongsil-" \+ tradeType/);
  assert.match(gongsil, /mixedTradeTypes/);
  assert.match(gongsil, /!mixedTradeTypes/);
  assert.match(edge, /tradeType: String\(target && target\.tradeType/);
  assert.match(server, /COALESCE\(NULLIF\(s\.trade_type,''\),'lease'\)=\?2/);
  assert.match(server, /listingTradeTypesCanMerge\(candidate\.trade_type, record\.tradeType\)/);
});
