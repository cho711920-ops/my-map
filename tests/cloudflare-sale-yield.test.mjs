import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { compactSaleSummary, handleD1GetAction } from "../cloudflare/src/d1-api.js";

const source = fs.readFileSync("js/listing-trade-ui-v1.js", "utf8");
const window = {};
const document = { getElementById: () => null, querySelector: () => null,
  documentElement: { setAttribute() {} } };
const context = { window, document };
vm.runInNewContext(source, context);
const ui = window.JSListingTradeV1;
const item = { tradeType: "sale", salePrice: 197000, saleCategory: "building", source: "공실박스",
  saleDetails: { scope: "whole_building", landAreaM2: 204.96, grossAreaM2: 409.59,
    totalDeposit: 50000, monthlyIncome: 695 } };

test("sale yield uses deposit-adjusted capital and annual income in the same units", () => {
  assert.equal(ui.saleYield(item).toFixed(2), "5.67");
  assert.equal(ui.saleYield({ ...item, salePrice: 195000, saleDetails: { totalDeposit: 13300, monthlyIncome: 1400 } }).toFixed(2), "9.25");
  assert.match(ui.saleYieldBadge(item), /수익률 5.67%/);
  assert.match(ui.saleDetailsHtml(item), /5.67% \(보증금 차감\)/);
  assert.match(ui.saleDetailsHtml(item), /대출이자·취득비용·세금·공실·운영비는 미반영/);
});

test("unknown, invalid and zero-denominator financial values never produce a misleading rate", () => {
  for (const value of [undefined, null, "", " ", "-", -1, Infinity, NaN, true]) {
    assert.equal(ui.saleYield({ ...item, saleDetails: { totalDeposit: value, monthlyIncome: 695 } }), null);
    assert.equal(ui.saleYield({ ...item, saleDetails: { totalDeposit: 50000, monthlyIncome: value } }), null);
  }
  for (const price of [0, null, -10, Infinity, 50000, 40000]) assert.equal(ui.saleYield({ ...item, salePrice: price }), null);
  assert.equal(ui.saleYield({ ...item, saleDetails: { totalDeposit: 0, monthlyIncome: 0 } }), 0);
  assert.match(ui.saleYieldBadge({ ...item, saleDetails: {} }), /수익률 확인 필요/);
  assert.equal(ui.saleYield({ ...item, tradeType: "lease" }), null);
  assert.equal(ui.saleYieldBadge({ ...item, tradeType: "lease" }), "");
});

test("main cards only use matching-source and matching-price metadata, not another listing's income", () => {
  const master = { ...item, saleDetails: undefined };
  const original = { ...item, saleDetails: undefined, saleSummary: compactSaleSummary(item) };
  assert.equal(ui.saleYield({ ...master, unifiedOriginalsV8: [original] }).toFixed(2), "5.67");
  for (const patch of [{ source: "네이버" }, { salePrice: 195000 }, { saleCategory: "house" }]) {
    assert.equal(ui.saleYield({ ...master, unifiedOriginalsV8: [{ ...original, ...patch }] }), null);
  }
  const changed = { ...original, link: "second", saleSummary: { ...original.saleSummary, monthlyIncome: 900 } };
  assert.equal(ui.saleYield({ ...master, unifiedOriginalsV8: [original, changed] }), null);
  assert.equal(ui.saleYield({ ...master, sourceLink: "first", unifiedOriginalsV8: [{ ...original, link: "first" }, changed] }).toFixed(2), "5.67");
});

test("sale area labels distinguish land, gross and exclusive space without inventing missing area", () => {
  const html = ui.saleAreaHtml(item);
  assert.match(html, /대지 <b>62평/); assert.match(html, /연 <b>123.9평/);
  const land = ui.saleAreaHtml({ ...item, saleCategory: "land", saleDetails: { scope: "land", landAreaM2: 167 } });
  assert.match(land, /토지 <b>50.5평/); assert.doesNotMatch(land, /연면적/);
  const unit = ui.saleAreaHtml({ ...item, saleDetails: { scope: "unit", exclusiveAreaM2: 33.05785 } });
  assert.match(unit, /대지 <b>미확인/); assert.match(unit, /연 <b>미확인/); assert.match(unit, /전용 <b>10평/);
  assert.doesNotMatch(ui.saleAreaHtml({ ...item, area: 124.3, saleDetails: {} }), /124.3/);
  assert.doesNotMatch(ui.saleAreaHtml({ ...item, saleDetails: { landAreaM2: '<img onerror="bad">' } }), /<img/);
});

test("compact API metadata is allowlisted and absent from lease payloads", () => {
  assert.equal(compactSaleSummary({ ...item, tradeType: "lease" }), "");
  const packed = compactSaleSummary({ ...item, saleDetails: { ...item.saleDetails, memo: "private", images: ["large"], monthlyIncome: null } });
  assert.equal(packed.landAreaM2, 204.96);
  assert.ok(!("monthlyIncome" in packed)); assert.ok(!("memo" in packed)); assert.ok(!("images" in packed));
});

test("list API forwards sale summary without forcing an individual detail request", async () => {
  const env = { DB: { prepare(sql) {
    return { bind() { return this; }, async all() {
      return { results: sql.includes("json_extract(raw_json")
        ? [{ rowid: 1, listing_id: "M-test", list_snapshot_json: JSON.stringify(item) }] : [] };
    } };
  } } };
  const result = await handleD1GetAction(env, {}, { action: "unifiedListings" });
  // groups are arrays of source rows, not a flattened representative.
  const row = result.groups["M-test"][0];
  assert.deepEqual(row[result.fields.indexOf("saleSummary")], compactSaleSummary(item));
});

test("legacy lease badge stays unchanged while sale cards use the new badge", () => {
  const script = fs.readFileSync("js/script.js", "utf8");
  const names = ["getRentPerPyeongValue", "getPyeongBadgeClass", "buildPyeongMiniBadge"];
  vm.runInNewContext(names.map(name => script.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"))[0]).join("\n"),
    Object.assign(context, { escapeHtml: String }));
  assert.equal(context.buildPyeongMiniBadge({ area: 10, rent: 40, fee: 0 }), '<span class="pyeong-mini-badge low">평당 4만</span>');
  assert.match(context.buildPyeongMiniBadge(item), /수익률 5.67%/);
  assert.doesNotMatch(context.buildPyeongMiniBadge(item), /평당/);
  assert.match(script, /JSListingTradeV1\.saleAreaHtml\(item\)/);
});
