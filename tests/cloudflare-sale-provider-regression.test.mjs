import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { normalizedRecord, isMonthlyCollectorRecord, compareListingSpace, manifestEntryMatch, mergeDaangnDetailWithList } from "../cloudflare/src/collector-api.js";
import { gongsilSaleFields, saleCategoryFromLabel } from "../cloudflare/src/sale-fields.js";
import { gongsilAdvertisedOffers } from "../cloudflare/src/gongsil-offers.js";

function collectorFunctions(file, names, context = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const selected = names.map((name) => {
    const match = source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
  vm.runInNewContext(selected + "\nthis.api = {" + names.join(",") + "};", context);
  return context.api;
}
const gongsil = collectorFunctions("../js/gongsil-collector.js", [
  "pick", "text", "numberValue", "gongsilAdvertisedOffers", "getRentalTerms", "getSaleCategory", "getTradeTerms",
  "getTradeOffers", "observedTradeTypes", "gongsilListSnapshot", "stableSnapshotJson"
]);
const rawBuilding = { Me: 197000, Bo: 2000, Mm: 45, TypeView: "건물통", Ho: "전체",
  LandArea: 62, YunArea: 123.9, Area: 40, TotBomoney: 50000, TotMmmoney: 695 };

test("real Gongsil Me beats ancillary Bo/Mm in both bookmarklet and server", () => {
  for (const raw of [rawBuilding, { ...rawBuilding, Me: 195000, Bo: 500, Mm: 59, Area: 0, YunArea: 124.3 }]) {
    const terms = gongsil.getTradeTerms(raw);
    assert.equal(terms.tradeType, "sale"); assert.equal(terms.salePrice, raw.Me);
    assert.equal(terms.deposit, 0); assert.equal(terms.rent, 0);
    const record = normalizedRecord("공실박스", { externalId: "test", tradeType: "lease",
      values: ["대원", "서구 월평동 893", "", "건물통", raw.Bo, raw.Mm, 0, 0, raw.Area],
      raw: { list: raw } });
    assert.equal(record.tradeType, "sale"); assert.equal(record.salePrice, raw.Me);
    assert.equal(record.room, "전체"); assert.equal(record.area, raw.YunArea);
    assert.equal(record.saleDetails.totalDeposit, 50000);
    assert.equal(record.saleDetails.monthlyIncome, 695);
  }
});

test("sale with no rental fields is collected, invalid sale and pure jeonse are not leases", () => {
  assert.equal(gongsil.getTradeTerms({ Me: 95000, TypeView: "건물통" }).salePrice, 95000);
  assert.equal(gongsil.getTradeTerms({ TradeType: "매매", Bo: 2000, Mm: 50 }), null);
  assert.equal(gongsil.getTradeTerms({ Jun: 20000, Mm: 0 }), null);
  assert.equal(gongsil.getTradeTerms({ Bo: 1000, Mm: 50 }).tradeType, "lease");
  assert.deepEqual(Array.from(gongsil.observedTradeTypes([rawBuilding, { Bo: 1000, Mm: 50 }])), ["lease", "sale"]);
});

test("Gongsil fingerprints include sale price and separate land/gross area changes", () => {
  const before = gongsil.gongsilListSnapshot(rawBuilding);
  for (const changed of [{ Me: 199000 }, { LandArea: 65 }, { YunArea: 140 }, { TotMmmoney: 800 }]) {
    assert.notEqual(gongsil.gongsilListSnapshot({ ...rawBuilding, ...changed }), before);
  }
});

test("client and server agree on simultaneous advertised offers, including zero deposits and secondary monthly terms", () => {
  for (const raw of [
    { Me: 37000, Bo: 2000, Mm: 150 },
    { Me: 37000, Bo: 0, Mm: 50 },
    { Me: 37000, Bo: 500, Mm: 0, Jun: 60000, Jmm: 315 },
    { Me: 37000, Bo: 0, Mm: 0, Moneys: [{ Ty: "전세", Bo: 1000, Mm: 0 }, { Type: "월세", Bo: 2000, Mm: 150 }] },
    { Me: 37000, TotBomoney: 5000, TotMmmoney: 150, Memo: "월세 수입 150" },
    { Me: 37000, Mm: 150 },
    { Me: 37000, Bo: -1, Mm: 150 }
  ]) {
    const fields = (offers) => Array.from(offers, (o) => [o.tradeType, o.deposit, o.rent]);
    assert.deepEqual(fields(gongsil.getTradeOffers(raw)), fields(gongsilAdvertisedOffers(raw)), JSON.stringify(raw));
  }
});

test("three land examples remain land even with warehouse use and without floors", () => {
  for (const [Me, Area, expected] of [[41000, 50.5, 41000], [52000, 63.8, 52000], [213000, 852, 213000]]) {
    const raw = { Me, Area, TypeView: "토지", UseType: "창고시설", Ho: "전체" };
    const detail = { getlands: { LndCgrCodeNm: "창", RoadSideCodeNm: "세로한면(불)", PrposArea1Nm: "개발한구역" } };
    assert.equal(gongsil.getSaleCategory(raw), "land");
    const row = normalizedRecord("공실박스", { externalId: String(Me), raw: { list: raw, detail },
      values: ["토지", "유성구 구암동 123-3", "1층", "토지"] });
    assert.equal(row.saleCategory, "land"); assert.equal(row.salePrice, expected);
    assert.equal(row.room, ""); assert.equal(row.area, Area);
    assert.equal(row.saleDetails.landUse, "창"); assert.equal(row.images.length, 0);
  }
});

test("apartment collection is allowed only for Gongsil, with separate unit preserved", () => {
  const row = normalizedRecord("공실박스", { externalId: "apt", raw: { list: { Me: 35000, TypeView: "아파트", Ho: "101동 502" } },
    values: ["아파트", "서구 둔산동 1", "101동 502호", "아파트", 0, 0, 0, 0, 30] });
  assert.equal(row.saleCategory, "apartment"); assert.match(row.room, /502/);
  assert.equal(isMonthlyCollectorRecord("공실박스", row), true);
  assert.equal(isMonthlyCollectorRecord("네이버", row), false);
  assert.equal(isMonthlyCollectorRecord("당근", row), false);
  assert.equal(isMonthlyCollectorRecord("네이버", { tradeType: "sale", saleCategory: "apartment_presale" }), true);
});

test("Daangn sale preserves actual property type and unknown fee; wrong requested offer is excluded", () => {
  const article = { originalId: "3909610", tradeType: "sale", salesTypeV3: { type: "HOUSE" },
    isEntireBuilding: true, area: 103.94, landArea: 93.04,
    trades: [{ type: "BUY", price: 35000 }], publicJibunAddress: "서구 괴정동 1" };
  const row = normalizedRecord("당근", article);
  assert.equal(row.saleCategory, "house"); assert.equal(row.room, "전체");
  assert.equal(row.saleDetails.grossAreaM2, 103.94); assert.equal(row.saleDetails.landAreaM2, 93.04);
  assert.equal(row.fee, null);
  const wrong = normalizedRecord("당근", { ...article, tradeType: "lease" });
  assert.equal(isMonthlyCollectorRecord("당근", wrong), false);
  const wrongNormalized = normalizedRecord("당근", { source: "당근", tradeType: "lease", raw: article });
  assert.equal(isMonthlyCollectorRecord("당근", wrongNormalized), false);
});

test("Naver whole building keeps land and floor area separate without treating ground floors as a unit", () => {
  const row = normalizedRecord("네이버", { articleNo: "2644987877", tradeType: "매매", salePrice: 58000,
    category: "다가구", floorInfo: "4층", areaSquareMeter: 447.93,
    saleRaw: { detailInfo: { spaceInfo: { landSpace: 263.47, floorSpace: 447.93 },
      priceInfo: { dealPrice: 580000000, warrantyPrice: 35000000, rentPrice: 4000000 } } } });
  assert.equal(row.saleCategory, "multifamily"); assert.equal(row.room, "전체");
  assert.equal(row.saleDetails.landAreaM2, 263.47); assert.equal(row.saleDetails.grossAreaM2, 447.93);
  assert.equal(row.saleDetails.totalDeposit, 3500); assert.equal(row.saleDetails.monthlyIncome, 400);
  assert.equal(row.deposit, 0); assert.equal(row.rent, 0);
});

test("Naver actual priceInfo.dealPrice wins over occupied building warrantyPrice", () => {
  const api = collectorFunctions("../js/naver-collector.js", ["normalize", "finKrwToManwon", "naverSaleCategory"], {
    clean: (x) => String(x ?? "").trim(), articleId: (x) => x.articleNo,
    finImageUrls: () => [], finFloorInfo: () => "", finAddressText: () => "",
    naverListingUrl: () => "", naverListSnapshot: () => "", location: { href: "" },
    TRADE_TYPE_LABELS: { A1: "매매" }, REAL_ESTATE_TYPE_LABELS: {}
  });
  const row = api.normalize({ articleNo: "2644987877", tradeType: "A1", realEstateTypeName: "다가구",
    priceInfo: { dealPrice: 580000000, warrantyPrice: 35000000, rentPrice: 4000000 } });
  assert.equal(Number(row.salePrice), 58000);
  assert.equal(row.saleCategory, "multifamily");
});

test("land, warehouse, house, multifamily and villa cannot be merged just for price and address", () => {
  const incoming = { tradeType: "sale", saleCategory: "land", salePrice: 35000, room: "", area: 30 };
  assert.equal(compareListingSpace(incoming, { ...incoming, saleCategory: "factory_warehouse" }).decision, "different");
  assert.equal(compareListingSpace({ ...incoming, saleCategory: "multifamily" }, { ...incoming, saleCategory: "villa" }).decision, "different");
  assert.equal(saleCategoryFromLabel("다세대"), "villa");
  assert.equal(saleCategoryFromLabel("WAREHOUSE"), "factory_warehouse");
  assert.equal(saleCategoryFromLabel("factory_warehouse"), "factory_warehouse");
  assert.equal(gongsilSaleFields({ list: { TypeView: "토지", UseType: "창고시설" } }).saleCategory, "land");
});

test("sale metadata changes cannot be skipped by the old rental material shortcut", () => {
  const entry = { tradeType: "sale", saleCategory: "building", salePrice: 197000, room: "전체", area: 123.9, listSnapshot: "changed-total-income" };
  const row = { trade_type: "sale", sale_price: 197000, snapshot_hash: "legacy-recovery", list_snapshot_json: JSON.stringify(entry) };
  assert.equal(manifestEntryMatch(entry, row), "");
  assert.equal(normalizedRecord("공실박스", { tradeType: "lease", raw: { list: { TradeType: "매매", Bo: 500, Mm: 20 } } }).tradeType, "sale");
  assert.equal(gongsil.getTradeTerms({ Me: 0, SalePrice: 35000 }).salePrice, 35000);
});

test("land detail never inherits a floor or incidental rental price from its list entry", () => {
  const row = mergeDaangnDetailWithList({ originalId: "land", salesTypeV3: { type: "LAND" }, trades: [{ type: "BUY", price: 50000 }] },
    { room: "1층", rent: 100, tradeType: "sale" }, "sale");
  assert.equal(row.saleCategory, "land"); assert.equal(row.room, ""); assert.equal(row.rent, 0);
});

test("sale detail renderer preserves missing values, escapes provider text and excludes lease", () => {
  const source = fs.readFileSync(new URL("../js/listing-trade-ui-v1.js", import.meta.url), "utf8");
  const window = {};
  vm.runInNewContext(source, { window, document: { getElementById: () => null, querySelector: () => null,
    documentElement: { setAttribute() {} } } });
  const details = { scope: "land", landAreaM2: 167, zoning: '<img src=x onerror="alert(1)">', monthlyIncome: null };
  const html = window.JSListingTradeV1.saleDetailsHtml({ tradeType: "sale", saleDetails: details });
  assert.match(html, /167㎡/); assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|월 임대수입|연면적/);
  assert.equal(window.JSListingTradeV1.saleDetailsHtml({ tradeType: "lease", saleDetails: details }), "");
  assert.equal(window.JSListingTradeV1.matchesItem({ tradeType: "sale", saleCategory: "apartment" }, "building_sale"), true);
});
