import test from "node:test";
import assert from "node:assert/strict";
import { daangnLandUse, withDaangnLandUse } from "../cloudflare/src/land-use-display.js";
import { daangnSaleFields } from "../cloudflare/src/sale-fields.js";
import { normalizedRecord } from "../cloudflare/src/collector-api.js";

const labels = { SITE: "대", DRY_PADDY_FIELD: "전", PADDY_FIELD: "답", FORESTRY: "임야",
  ORCHARD: "과수원", WAREHOUSE_SITE: "창고용지", MISCELLANEOUS_LAND: "잡종지" };
const base = { source: "당근", tradeType: "sale", saleCategory: "land", sourceId: "L-1", propertyId: "P-1",
  room: "", salePrice: 42000, area: 100, saleDetails: { scope: "land", landAreaM2: 330.58, zoning: "기존 용도지역" } };

test("explicit Daangn land types map to Korean land-use labels; missing and unsupported inputs stay unknown", () => {
  for (const [code, label] of Object.entries(labels)) {
    assert.equal(daangnLandUse(code), label);
    assert.equal(daangnLandUse(" " + code.toLowerCase() + " "), label);
  }
  for (const value of [null, undefined, "", "  ", "NEW_PROVIDER_CODE", "대지면적 100평", "대", true, 0, [], {}]) {
    assert.equal(daangnLandUse(value), "");
  }
});

test("legacy land originals recover missing land use without changing physical values or identities", () => {
  for (const [code, label] of Object.entries(labels)) {
    const before = JSON.stringify(base);
    const shown = withDaangnLandUse(base, code);
    assert.equal(shown.saleDetails.landUse, label);
    assert.deepEqual(shown, { ...base, saleDetails: { ...base.saleDetails, landUse: label } });
    assert.equal(JSON.stringify(base), before);
  }
  for (const landUse of [undefined, null, "", "-", "—", "미확인", "확인 필요", 0, false]) {
    assert.equal(withDaangnLandUse({ ...base, saleDetails: { ...base.saleDetails, landUse } }, "SITE").saleDetails.landUse, "대");
  }
  const saved = { ...base, saleDetails: { ...base.saleDetails, landUse: "답" } };
  assert.equal(withDaangnLandUse(saved, "SITE"), saved);
  assert.equal(withDaangnLandUse(base, "UNSUPPORTED"), base);
  assert.equal(withDaangnLandUse(base, null), base);
});

test("lease, building sales and other providers are never decorated with a Daangn land type", () => {
  for (const item of [null, { ...base, tradeType: "lease" }, { ...base, source: "공실박스" },
    { ...base, source: "네이버" }, { ...base, saleCategory: "building", saleDetails: { scope: "whole_building" } },
    { ...base, saleCategory: "building", saleDetails: { scope: "land" } }]) {
    assert.equal(withDaangnLandUse(item, "SITE"), item);
  }
});

test("future Daangn land ingestion saves the same explicit label and does not guess from prose", () => {
  for (const [landType, label] of Object.entries(labels)) {
    const article = { originalId: "L-1", salesTypeV3: { type: "LAND" }, landType, area: 330.58,
      trades: [{ type: "BUY", price: 42000 }], tradeType: "sale", publicJibunAddress: "가상 토지 주소" };
    const details = daangnSaleFields(article, "land");
    assert.equal(details.landUse, label);
    const record = normalizedRecord("당근", article);
    assert.equal(record.saleDetails.landUse, label);
    assert.equal(record.raw.landType, landType);
    assert.equal(record.salePrice, 42000);
    assert.equal(record.saleCategory, "land");
    assert.equal(record.room, "");
    assert.equal(daangnSaleFields(article, "house").landUse, undefined);
  }
  assert.equal(daangnSaleFields({ content: "대지면적 100평, 전원주택용 토지" }, "land").landUse, undefined);
});
