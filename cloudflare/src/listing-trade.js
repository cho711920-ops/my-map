export const LISTING_TRADE_TYPES = Object.freeze({
  LEASE: "lease",
  SALE: "sale"
});

export const LISTING_SALE_CATEGORIES = Object.freeze({
  COMMERCIAL: "commercial",
  MULTIFAMILY: "multifamily",
  HOUSE: "house",
  BUILDING: "building",
  LAND: "land",
  FACTORY_WAREHOUSE: "factory_warehouse",
  OTHER: "other"
});

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeListingTradeType(value, { legacyDefault = false } = {}) {
  const normalized = clean(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return legacyDefault ? LISTING_TRADE_TYPES.LEASE : "";
  if (["lease", "rent", "monthly", "monthlyrent", "month", "월세", "임대", "상가임대"].includes(normalized)) {
    return LISTING_TRADE_TYPES.LEASE;
  }
  if (["sale", "buy", "purchase", "매매"].includes(normalized)) return LISTING_TRADE_TYPES.SALE;
  return "";
}

export function normalizeListingSaleCategory(value) {
  const normalized = clean(value).toLowerCase().replace(/[\s/_-]+/g, "");
  if (!normalized) return "";
  const aliases = new Map([
    ["commercial", LISTING_SALE_CATEGORIES.COMMERCIAL],
    ["상가", LISTING_SALE_CATEGORIES.COMMERCIAL],
    ["상가매매", LISTING_SALE_CATEGORIES.COMMERCIAL],
    ["multifamily", LISTING_SALE_CATEGORIES.MULTIFAMILY],
    ["다가구", LISTING_SALE_CATEGORIES.MULTIFAMILY],
    ["다가구매매", LISTING_SALE_CATEGORIES.MULTIFAMILY],
    ["house", LISTING_SALE_CATEGORIES.HOUSE],
    ["주택", LISTING_SALE_CATEGORIES.HOUSE],
    ["주택매매", LISTING_SALE_CATEGORIES.HOUSE],
    ["building", LISTING_SALE_CATEGORIES.BUILDING],
    ["건물", LISTING_SALE_CATEGORIES.BUILDING],
    ["건물매매", LISTING_SALE_CATEGORIES.BUILDING],
    ["land", LISTING_SALE_CATEGORIES.LAND],
    ["토지", LISTING_SALE_CATEGORIES.LAND],
    ["토지매매", LISTING_SALE_CATEGORIES.LAND],
    ["factorywarehouse", LISTING_SALE_CATEGORIES.FACTORY_WAREHOUSE],
    ["공장창고", LISTING_SALE_CATEGORIES.FACTORY_WAREHOUSE],
    ["공장창고매매", LISTING_SALE_CATEGORIES.FACTORY_WAREHOUSE],
    ["other", LISTING_SALE_CATEGORIES.OTHER],
    ["기타", LISTING_SALE_CATEGORIES.OTHER]
  ]);
  return aliases.get(normalized) || "";
}

export function listingTradeTypesCanMerge(left, right) {
  const leftType = normalizeListingTradeType(left, { legacyDefault: true });
  const rightType = normalizeListingTradeType(right, { legacyDefault: true });
  return Boolean(leftType && rightType && leftType === rightType);
}
