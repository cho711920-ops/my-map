// Explicit provider measurements only. Never reinterpret generic area or derive
// FAR from gross floor area (its official numerator can be different).
export const NAVER_MEASUREMENT_FIELDS = Object.freeze({
  landAreaM2: "landSpace", buildingAreaM2: "buildingSpace", grossAreaM2: "floorSpace",
  exclusiveAreaM2: "exclusiveSpace", buildingCoverageRatio: "buildingCoverageRatio", floorAreaRatio: "floorAreaRatio"
});
export const NAVER_MEASUREMENT_PATHS = Object.freeze([
  "saleRaw.detailInfo.sizeInfo", "saleRaw.sizeInfo", "sizeInfo",
  "saleRaw.detailInfo.spaceInfo", "saleRaw.spaceInfo", "spaceInfo"
]);
const valid = (key, value) => {
  if (!["number", "string"].includes(typeof value) || !String(value).trim()) return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && (key !== "buildingCoverageRatio" || n <= 100) ? n : null;
};
export function saleMeasurements(candidates = {}) {
  if (!candidates || typeof candidates !== "object" || Array.isArray(candidates)) return {};
  return Object.fromEntries(Object.keys(NAVER_MEASUREMENT_FIELDS).flatMap(key => {
    const values = Array.isArray(candidates[key]) ? candidates[key] : [candidates[key]];
    const value = values.map(v => valid(key, v)).find(v => v != null);
    return value == null ? [] : [[key, value]];
  }));
}
export function naverSaleMeasurements(item = {}) {
  const containers = NAVER_MEASUREMENT_PATHS.map(path => path.split(".").reduce((o, k) => o?.[k], item));
  return saleMeasurements(Object.fromEntries(Object.entries(NAVER_MEASUREMENT_FIELDS)
    .map(([key, field]) => [key, containers.map(o => o?.[field])])));
}
export function gongsilSaleMeasurements(raw = {}) {
  const b = raw.detail?.getbilbases || {};
  return saleMeasurements({ buildingAreaM2: b.ArchArea, buildingCoverageRatio: b.BcRat, floorAreaRatio: b.VlRat });
}
