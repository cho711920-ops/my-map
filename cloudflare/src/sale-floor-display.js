import { canonicalNaverSaleType, NAVER_UNIT_TYPES, saleFloorTarget } from "./sale-target-evidence.js";
import { NAVER_PROPERTY_TYPES } from "./naver-property-types.js";

const clean = value => String(value ?? "").trim();

function floorCount(value, minimum = 1) {
  if (!["number", "string"].includes(typeof value) || clean(value) === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? number : null;
}

function basementCount(value) {
  const match = typeof value === "string" && value.trim().match(/^B([1-9]\d*)$/i);
  return floorCount(match ? match[1] : value, 0);
}

// Only decorate a source response. Never rewrite its stored physical scope,
// room, area or price: older collectors used a building's basement as its room.
export function withNaverSaleFloorDisplay(original, provider = {}) {
  if ((provider.source || original?.source) !== "네이버" || original?.tradeType !== "sale" ||
    original.saleCategory === "land" || original.saleDetails?.scope === "land") return original;
  const floors = provider.floorInfo;
  if (!floors || typeof floors !== "object" || Array.isArray(floors)) return original;
  const detail = { ...(original.saleDetails || {}) };
  const aboveGroundFloors = floorCount(floors.groundTotalFloor);
  const values = {
    aboveGroundFloors,
    belowGroundFloors: basementCount(floors.undergroundTotalFloor),
    totalFloors: floorCount(floors.totalFloor)
  };
  for (const [key, value] of Object.entries(values)) {
    if (value != null && floorCount(detail[key], key === "belowGroundFloors" ? 0 : 1) == null) detail[key] = value;
  }
  const target = clean(floors.targetFloor);
  const type = canonicalNaverSaleType(provider.propertyType);
  // Known house/building codes plus an explicitly absent unit target and a
  // ground count establish a building range. Unknown provider enums do not.
  const residence = clean(floors.residenceType);
  if (NAVER_PROPERTY_TYPES[type] && type !== "E03" && residence === "1") {
    detail.floorScope = "unit";
  } else if (NAVER_PROPERTY_TYPES[type] && type !== "E03" && residence === "2") {
    delete detail.floorScope;
    if (!NAVER_UNIT_TYPES.has(type) && !saleFloorTarget(target)) detail.floorScope = "whole_building";
  } else if (["C03", "C04", "C06", "D03", "D04", "D05"].includes(type) && target === "-" && aboveGroundFloors != null) {
    detail.floorScope = "whole_building";
  } else if (saleFloorTarget(target)) {
    detail.floorScope = "unit";
  }
  return { ...original, saleDetails: detail };
}
