import { NAVER_PROPERTY_TYPES } from "./naver-property-types.js";
import { saleDescriptionFields } from "./sale-description.js";
import { withNaverSaleFloorDisplay } from "./sale-floor-display.js";

const clean = value => String(value ?? "").trim();
const compact = value => clean(value).replace(/\s+/g, "");
const floorTarget = value => /^(?:-?[1-9]\d*|B[1-9]\d*|지하[1-9]\d*)(?:층)?$/i.test(
  compact(value).replace(/^(-?[1-9]\d*)\.0+(층)?$/, "$1$2")
);
const unknown = (evidence = "원본 매매범위 근거 부족") => ({ saleExtent: "unknown", saleExtentEvidence: evidence });
const extent = (saleExtent, saleExtentEvidence) => ({ saleExtent, saleExtentEvidence });

function naverExtent(provider) {
  const type = clean(provider.propertyType).toUpperCase();
  const floors = provider.floorInfo || {};
  const target = clean(floors.targetFloor);
  const ground = typeof floors.groundTotalFloor === "string" || typeof floors.groundTotalFloor === "number"
    ? Number(floors.groundTotalFloor) : NaN;
  if (["C03", "C04", "C06", "D03", "D04", "D05"].includes(type) && target === "-" &&
    Number.isInteger(ground) && ground > 0) return extent("whole_building", "네이버 원본: 건물유형·전체 층 범위");
  if (NAVER_PROPERTY_TYPES[type] && NAVER_PROPERTY_TYPES[type].saleCategory !== "land" && floorTarget(target)) {
    return extent("unit", "네이버 원본: 해당층 지정");
  }
  if (["apartment", "officetel", "villa", "one_room", "office", "commercial", "knowledge_center", "apartment_presale", "officetel_presale"]
    .includes(NAVER_PROPERTY_TYPES[type]?.saleCategory) && /^(?:저|중|고)(?:층)?$/.test(target)) {
    return extent("unit", "네이버 원본: 구분유형·해당층 구간 지정");
  }
  return unknown();
}

function gongsilExtent(provider) {
  const value = provider.gongsil || {};
  const type = compact(value.typeView);
  const room = compact(value.ho);
  const wholeType = /^(?:건물통|통건물|건물전체|전체건물)(?:매매)?$/.test(type);
  const unitType = /^(?:상가|상가점포|구분상가|사무실|아파트|APT|APT분양권|OFT|OFT분양권|오피스텔|빌라|다세대|연립|원룸|지식산업센터)$/.test(type);
  const buildingType = /^(?:건물|빌딩|다가구|단독|단독주택|전원주택|상가주택|공장|창고|공장\/창고)$/.test(type);
  const specificRoom = /^(?:[가-힣A-Z0-9]+동)?(?:B[1-9]\d*|[1-9]\d*[A-Z]?)(?:호(?:실)?)?$/i.test(room) || floorTarget(room);
  const explicitPartial = /부분매매|구분매매/.test(type);
  if (wholeType && (specificRoom || explicitPartial)) return unknown("공실박스 원본: 건물전체·개별공간 표기 상충");
  if (wholeType) return extent("whole_building", "공실박스 원본: 건물전체 유형");
  if (room === "전체" && buildingType) return extent("whole_building", "공실박스 원본: 건물형 매물·전체 표기");
  if (room === "전체") return unknown();
  if (explicitPartial || unitType && (specificRoom || floorTarget(value.floor))) {
    return extent("unit", specificRoom ? "공실박스 원본: 구분유형·호실 지정" : "공실박스 원본: 개별공간 지정");
  }
  return unknown();
}

function daangnExtent(original, provider) {
  const value = provider.daangn || {};
  if (value.isEntireBuilding === true) return extent("whole_building", "당근 원본: 건물전체 선택");
  const type = clean(value.salesType).toUpperCase();
  // The saved description is available to both list and detail reads. Do not
  // add detail-only raw-content evidence that would change the list's extent.
  const description = original.saleDetails?.descriptionText || "";
  const described = saleDescriptionFields(description);
  // This provider can expose false even on an explicitly advertised whole
  // multifamily building. Require the existing strict description evidence.
  if (["ONE_ROOM", "TWO_ROOM", "THREE_ROOM", "VILLA", "MULTIFAMILY", "HOUSE", "OTHER"].includes(type) && described.wholeMultifamily) {
    return extent("whole_building", "당근 설명: 다가구 전체매매 근거");
  }
  // Legacy whole-building hints are not enough to confirm a whole sale, but
  // they do prevent a missing saved description from becoming a false unit.
  const wholeHint = original.saleDetails?.scope === "whole_building" || original.saleDetails?.descriptionCategory === "multifamily" ||
    ["building", "house", "mixed_house", "multifamily"].includes(original.saleCategory);
  if (!wholeHint && value.isEntireBuilding === false &&
    ["ONE_ROOM", "TWO_ROOM", "THREE_ROOM", "VILLA", "APARTMENT", "OFFICETEL", "STORE", "COMMERCIAL", "OFFICE", "KNOWLEDGE_INDUSTRY_CENTER"].includes(type) &&
    floorTarget(value.floor)) return extent("unit", "당근 원본: 개별공간·해당층 지정");
  return unknown();
}

// Display evidence is intentionally separate from legacy/default physical
// scope. In particular quick-add assigns whole_building to all non-land sales.
export function withSaleExtentDisplay(original, provider = {}) {
  if (original?.tradeType !== "sale" || original.saleCategory === "land" || original.saleDetails?.scope === "land") return original;
  const displayed = withNaverSaleFloorDisplay(original, provider);
  const source = provider.source || original.source;
  const result = source === "네이버" ? naverExtent(provider)
    : source === "공실박스" ? gongsilExtent(provider)
      : source === "당근" ? daangnExtent(original, provider) : unknown();
  return { ...displayed, saleDetails: { ...(displayed.saleDetails || {}), ...result } };
}

export function saleExtentProvider(raw = {}, source = "") {
  const list = raw.list || {};
  return {
    source,
    floorInfo: raw.saleRaw?.detailInfo?.spaceInfo?.floorInfo,
    propertyType: raw.realEstateTypeCode || raw.category,
    gongsil: { typeView: list.TypeView || list.ViewType || list.LndType || list.BuildingType,
      ho: list.Ho ?? list.BfHo ?? list.Room ?? list.Honame, floor: list.Ff ?? list.BfFloor ?? list.Floor ?? list.floor },
    daangn: { isEntireBuilding: raw.isEntireBuilding, salesType: raw.salesTypeV3?.type || raw.salesTypeV3?.__typename,
      floor: raw.isAmbiguousFloor === true ? null : raw.floor }
  };
}
