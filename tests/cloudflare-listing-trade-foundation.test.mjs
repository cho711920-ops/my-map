import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  LISTING_SALE_CATEGORIES,
  LISTING_TRADE_TYPES,
  listingTradeTypesCanMerge,
  normalizeListingSaleCategory,
  normalizeListingTradeType
} from "../cloudflare/src/listing-trade.js";

const migration = fs.readFileSync(
  new URL("../cloudflare/migrations/0019_listing_trade_foundation.sql", import.meta.url),
  "utf8"
);

test("legacy and monthly listings normalize to lease without accepting unknown trades", () => {
  assert.equal(normalizeListingTradeType("월세"), LISTING_TRADE_TYPES.LEASE);
  assert.equal(normalizeListingTradeType("MONTHLY_RENT"), LISTING_TRADE_TYPES.LEASE);
  assert.equal(normalizeListingTradeType(""), "");
  assert.equal(normalizeListingTradeType("", { legacyDefault: true }), LISTING_TRADE_TYPES.LEASE);
  assert.equal(normalizeListingTradeType("전세"), "");
});

test("sale listings normalize independently and receive canonical categories", () => {
  assert.equal(normalizeListingTradeType("매매"), LISTING_TRADE_TYPES.SALE);
  assert.equal(normalizeListingTradeType("BUY"), LISTING_TRADE_TYPES.SALE);
  assert.equal(normalizeListingSaleCategory("상가매매"), LISTING_SALE_CATEGORIES.COMMERCIAL);
  assert.equal(normalizeListingSaleCategory("다가구 매매"), LISTING_SALE_CATEGORIES.MULTIFAMILY);
  assert.equal(normalizeListingSaleCategory("공장/창고매매"), LISTING_SALE_CATEGORIES.FACTORY_WAREHOUSE);
});

test("lease and sale records can never share a representative boundary", () => {
  assert.equal(listingTradeTypesCanMerge("lease", "월세"), true);
  assert.equal(listingTradeTypesCanMerge("", "월세"), true);
  assert.equal(listingTradeTypesCanMerge("lease", "sale"), false);
  assert.equal(listingTradeTypesCanMerge("매매", "월세"), false);
});

test("the migration keeps every existing row as lease and adds isolated sale values", () => {
  for (const table of ["listings", "listing_sources", "collector_raw"]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*?trade_type TEXT NOT NULL DEFAULT 'lease'`));
  }
  assert.equal((migration.match(/ADD COLUMN sale_category/g) || []).length, 3);
  assert.equal((migration.match(/ADD COLUMN sale_price/g) || []).length, 3);
  assert.match(migration, /CHECK \(trade_type IN \('lease', 'sale'\)\)/);
  assert.match(migration, /idx_listings_trade_status/);
});
