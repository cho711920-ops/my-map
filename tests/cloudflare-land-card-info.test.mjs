import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { compactSaleSummary, handleD1GetAction } from "../cloudflare/src/d1-api.js";

const window = {};
vm.runInNewContext(fs.readFileSync("js/listing-trade-ui-v1.js", "utf8"), { window,
  document: { getElementById: () => null, querySelector: () => null, documentElement: { setAttribute() {} } } });
const ui = window.JSListingTradeV1;
const land = { tradeType: "sale", saleCategory: "land", salePrice: 41000, source: "공실박스",
  saleDetails: { scope: "land", landAreaM2: 167, landUse: "대", zoning: "제2종일반주거지역", buildingUse: "창고시설" } };

test("land list metadata includes only bounded saved land-use and zoning strings", () => {
  const summary = compactSaleSummary(land);
  assert.equal(summary.landUse, "대");
  assert.equal(summary.zoning, "제2종일반주거지역");
  assert.ok(!("buildingUse" in summary));
  const normalized = compactSaleSummary({ ...land, saleDetails: { scope: "land", landUse: "  종교용지  ", zoning: "자연녹지지역\n 일부" } });
  assert.equal(normalized.landUse, "종교용지"); assert.equal(normalized.zoning, "자연녹지지역 일부");
  assert.equal(compactSaleSummary({ ...land, saleDetails: { zoning: "가".repeat(300) } }).zoning.length, 160);
  for (const value of [null, undefined, "", "  ", 0, true, {}, []]) {
    const result = compactSaleSummary({ ...land, saleDetails: { landUse: value, zoning: value } });
    assert.ok(!("landUse" in result)); assert.ok(!("zoning" in result));
  }
});

test("land cards show land-use and zoning from compact payloads without a detail call", async () => {
  const env = { DB: { prepare(sql) { return { bind() { return this; }, async all() {
    return { results: sql.includes("json_extract(raw_json")
      ? [{ rowid: 1, listing_id: "M-land", list_snapshot_json: JSON.stringify(land) }] : [] };
  } }; } } };
  const result = await handleD1GetAction(env, {}, { action: "unifiedListings" });
  const original = Object.fromEntries(result.fields.map((field, i) => [field, result.groups["M-land"][0][i]]));
  assert.ok(!("saleDetails" in original));
  const master = { ...land, saleDetails: undefined, unifiedOriginalsV8: [original] };
  assert.match(ui.saleLandInfoHtml(master), /지목 <b>대<\/b>/);
  assert.match(ui.saleLandInfoHtml(master), /용도지역 <b>제2종일반주거지역<\/b>/);
  assert.match(fs.readFileSync("js/script.js", "utf8"), /saleCardV1 \? window.JSListingTradeV1.saleLandInfoHtml\(item\) : ''/);
});

test("land unknown values stay unknown and markup is escaped", () => {
  const unknown = ui.saleLandInfoHtml({ ...land, saleDetails: { scope: "land", buildingUse: "창고시설" } });
  assert.equal((unknown.match(/미확인/g) || []).length, 2);
  assert.doesNotMatch(unknown, /창고시설/);
  const partial = ui.saleLandInfoHtml({ ...land, saleDetails: { landUse: "대" } });
  assert.equal((partial.match(/미확인/g) || []).length, 1);
  const escaped = ui.saleLandInfoHtml({ ...land, saleDetails: { landUse: '<img src=x>', zoning: '"<script>&' } });
  assert.doesNotMatch(escaped, /<img|<script>/); assert.match(escaped, /&lt;img/); assert.match(escaped, /&amp;/);
});

test("land summary selection does not mix another source or conflicting zoning", () => {
  const original = { ...land, link: "https://example.test/land/1" };
  const master = { ...land, saleDetails: undefined, unifiedOriginalsV8: [original] };
  assert.match(ui.saleLandInfoHtml(master), /제2종일반주거지역/);
  assert.doesNotMatch(ui.saleLandInfoHtml({ ...master, source: "당근" }), /제2종일반주거지역/);
  const changed = { ...original, link: "https://example.test/land/2", saleDetails: { ...land.saleDetails, zoning: "자연녹지지역" } };
  const ambiguous = { ...master, unifiedOriginalsV8: [original, changed] };
  assert.doesNotMatch(ui.saleLandInfoHtml(ambiguous), /제2종일반주거지역|자연녹지지역/);
  assert.match(ui.saleLandInfoHtml({ ...ambiguous, sourceLink: original.link }), /제2종일반주거지역/);
});

test("lease and building-sale cards do not gain a land information row or extra API fields", () => {
  assert.equal(ui.saleLandInfoHtml({ ...land, tradeType: "lease" }), "");
  const building = { ...land, saleCategory: "building", saleDetails: { ...land.saleDetails, scope: "whole_building" } };
  assert.equal(ui.saleLandInfoHtml(building), "");
  assert.ok(!("zoning" in compactSaleSummary(building)));
  assert.ok(!("landUse" in compactSaleSummary(building)));
});
