// Keep provider codes separate from saved physical fields. Only explicit,
// supported landType values can fill a missing land-use label.
// Verified against the land-type formatter used by Daangn's detail page:
// https://d38l55ixqz4pbn.cloudfront.net/realty-web/2026-09-v219-3f1001b/prod-kr/app/assets/services2-CYGdNunS.js
// SITE is shown as "대(垈)" there; omit the parenthetical Hanja in our label.
const DAANGN_LAND_USES = Object.freeze({
  SITE: "대",
  DRY_PADDY_FIELD: "전",
  PADDY_FIELD: "답",
  FORESTRY: "임야",
  ORCHARD: "과수원",
  WAREHOUSE_SITE: "창고용지",
  MISCELLANEOUS_LAND: "잡종지"
});

export function daangnLandUse(value) {
  if (typeof value !== "string") return "";
  return DAANGN_LAND_USES[value.trim().toUpperCase()] || "";
}

function hasLandUse(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text) && !/^(?:-|—|미확인|확인\s*필요)$/.test(text);
}

// Read-only recovery of already-collected originals. Never change room, keys,
// scope, money or area, and never overwrite an existing collected land use.
export function withDaangnLandUse(original, landType, source = original?.source) {
  if (source !== "당근" || original?.tradeType !== "sale" ||
    !(original.saleCategory === "land" || !original.saleCategory && original.saleDetails?.scope === "land")) return original;
  const landUse = daangnLandUse(landType);
  if (!landUse || hasLandUse(original.saleDetails?.landUse)) return original;
  return { ...original, saleDetails: { ...(original.saleDetails || {}), landUse } };
}
