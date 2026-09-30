import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { NAVER_PROPERTY_TYPES, normalizeNaverPropertyType, resolveNaverSaleCategory } from "../cloudflare/src/naver-property-types.js";
import { normalizedRecord } from "../cloudflare/src/collector-api.js";

const source = fs.readFileSync(new URL("../js/naver-collector.js", import.meta.url), "utf8");
const context = { clean: value => String(value ?? "").trim() };
for (const name of ["REAL_ESTATE_TYPE_LABELS", "NAVER_SALE_CATEGORIES"]) {
  const match = source.match(new RegExp(`  var ${name} = \\{[^]*?\\n  \\};`));
  assert.ok(match, name);
  vm.runInNewContext(match[0], context);
}
for (const name of ["naverPropertyTypeLabel", "naverSaleCategory"]) {
  const match = source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, "m"));
  assert.ok(match, name);
  vm.runInNewContext(match[0], context);
}

test("every current and legacy Naver property type has identical Korean client/server mappings", () => {
  assert.equal(Object.isFrozen(NAVER_PROPERTY_TYPES), true);
  assert.match(source, /var VERSION = "6\.0\.6"/);
  assert.deepEqual(Object.keys(context.REAL_ESTATE_TYPE_LABELS).sort(), Object.keys(NAVER_PROPERTY_TYPES).sort());
  assert.deepEqual(Object.keys(context.NAVER_SALE_CATEGORIES).sort(), Object.keys(NAVER_PROPERTY_TYPES).sort());
  for (const [code, expected] of Object.entries(NAVER_PROPERTY_TYPES)) {
    assert.equal(Object.isFrozen(expected), true);
    assert.deepEqual(normalizeNaverPropertyType(code), { ...expected, code, recognized: true }, code);
    assert.equal(context.naverPropertyTypeLabel(code), expected.label, code);
    assert.equal(context.naverSaleCategory(code), expected.saleCategory, code);
    assert.equal(context.REAL_ESTATE_TYPE_LABELS[code], expected.label, code);
    assert.equal(context.NAVER_SALE_CATEGORIES[code], expected.saleCategory, code);
  }
});

test("current fin.land codes map to exact provider labels, not obsolete code meanings", () => {
  for (const [code, label] of [["A02", "오피스텔"], ["B01", "아파트분양권"], ["C02", "빌라/연립"],
    ["C03", "단독/다가구"], ["D03", "빌딩/건물"], ["D04", "상가건물"], ["E03", "토지/임야"]]) {
    assert.equal(normalizeNaverPropertyType(code.toLowerCase()).label, label);
    assert.equal(normalizeNaverPropertyType("", code).label, label);
  }
  assert.equal(normalizeNaverPropertyType("빌라", "C02").label, "빌라");
  assert.equal(resolveNaverSaleCategory("A02", "other"), "officetel");
  assert.equal(resolveNaverSaleCategory("A02", "commercial"), "officetel");
  assert.equal(resolveNaverSaleCategory("빌라", "other", "C02"), "villa");
  assert.equal(resolveNaverSaleCategory("상가", "land"), "land");
});

test("grouped houses and unsupported subtypes are not guessed from their code", () => {
  assert.equal(resolveNaverSaleCategory("C03", "other"), "house");
  assert.equal(resolveNaverSaleCategory("C03", "multifamily"), "multifamily");
  assert.equal(resolveNaverSaleCategory("다가구", "other", "C03"), "multifamily");
  assert.equal(resolveNaverSaleCategory("단독/다가구", "other"), "house");
  assert.equal(context.naverSaleCategory("C03", "단독/다가구"), "house");
  assert.equal(context.naverSaleCategory("C03", "다가구"), "multifamily");
  for (const code of ["A07", "E01", "G01"]) {
    assert.equal(resolveNaverSaleCategory(code, "other"), "other", code);
    assert.match(normalizeNaverPropertyType(code).label, /[가-힣]/);
  }
  assert.deepEqual(normalizeNaverPropertyType("X99"), {
    label: "기타(유형 확인 필요)", saleCategory: "other", code: "X99", recognized: false
  });
  assert.equal(context.naverPropertyTypeLabel("X99"), "기타(유형 확인 필요)");
  assert.equal(context.naverSaleCategory("X99"), "other");
});

test("old running collectors receive Korean classification without changing source evidence or financial/location fields", () => {
  for (const [code, entry] of Object.entries(NAVER_PROPERTY_TYPES)) {
    const payload = { articleNo: "26000001", category: code, realEstateTypeCode: code,
      saleCategory: "other", tradeTypeCode: "A1", salePrice: 35500, deposit: 2000, monthly: 70,
      jibunAddress: "대전광역시 서구 둔산동 12", floorInfo: "3층", areaSquareMeter: 33.05785,
      fee: 5, premium: 200, saleRaw: { spaceInfo: { landSpace: 200, floorSpace: 500 },
        priceInfo: { warrantyPrice: 100000000, rentPrice: 5000000 } } };
    const record = normalizedRecord("네이버", payload);
    assert.equal(record.category, entry.label, code);
    assert.equal(record.saleCategory, entry.saleCategory, code);
    assert.equal(record.saleDetails.sourceType, entry.label, code);
    assert.equal(record.sourceId, "네이버-26000001", code);
    assert.equal(record.tradeType, "sale", code);
    assert.equal(record.salePrice, 35500, code);
    assert.equal(record.deposit, 0, code);
    assert.equal(record.rent, 0, code);
    assert.equal(record.room, "3층", code);
    assert.equal(record.area, 10, code);
    assert.equal(record.saleDetails.scope, "unit", code);
    assert.equal(record.saleDetails.totalDeposit, 10000, code);
    assert.equal(record.saleDetails.monthlyIncome, 500, code);
    assert.equal(record.fee, 5, code);
    assert.equal(record.premium, 200, code);
    assert.equal(record.raw.category, code, code);
    assert.equal(record.raw.realEstateTypeCode, code, code);
    assert.equal(record.raw.saleCategory, "other", code);
  }
});

test("lease classification remains lease and retains its terms while type labels become Korean", () => {
  const record = normalizedRecord("네이버", { articleNo: "26000002", realEstateTypeCode: "D02",
    category: "D02", tradeTypeCode: "B2", deposit: 2000, monthly: 70, floorInfo: "102호", area: 15 });
  assert.equal(record.category, "상가점포");
  assert.equal(record.tradeType, "lease");
  assert.equal(record.saleCategory, "");
  assert.equal(record.salePrice, null);
  assert.equal(record.deposit, 2000);
  assert.equal(record.rent, 70);
  assert.equal(record.room, "102호");
  assert.equal(record.area, 15);
  assert.equal(record.saleDetails, undefined);
});
