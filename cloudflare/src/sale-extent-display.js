import { NAVER_PROPERTY_TYPES } from "./naver-property-types.js";
import { saleDescriptionFields } from "./sale-description.js";
import { withNaverSaleFloorDisplay } from "./sale-floor-display.js";
import { canonicalNaverSaleType, describedWholeMultifamily, descriptionSaleTarget, NAVER_UNIT_TYPES, saleFloorTarget, saleRoomTarget } from "./sale-target-evidence.js";

const clean = value => String(value ?? "").trim();
const compact = value => clean(value).replace(/\s+/g, "");
const first = (...values) => values.find(value => ["string", "number"].includes(typeof value) && clean(value) !== "");
const extent = (saleExtent, saleExtentEvidence, targets = {}) => ({ saleExtent, saleExtentEvidence, ...targets });
const unknown = (evidence = "원본 매매범위 근거 부족") => extent("unknown", evidence);

function naverExtent(provider) {
  const type = canonicalNaverSaleType(provider.propertyType);
  const floors = provider.floorInfo || {};
  if (!NAVER_PROPERTY_TYPES[type] || type === "E03") return unknown();
  const target = clean(floors.targetFloor);
  const residence = clean(floors.residenceType);
  const privateFloor = clean(floors.floorType) === "30";
  const targets = { saleTargetFloor: privateFloor ? "비공개" : saleFloorTarget(target), saleTargetRoom: saleRoomTarget(provider.room) };
  // Official provider enum: RESIDENCE_TYPE 방_일부=1, 전체=2. Whole in
  // a unit-type context does not establish ownership of the entire building.
  if (residence === "2") {
    if (NAVER_UNIT_TYPES.has(type) || saleFloorTarget(target)) return unknown("네이버 원본: 구분유형·전체 표기 상충");
    return extent("whole_building", "네이버 원본: 전체 매물 선택");
  }
  if (NAVER_UNIT_TYPES.has(type) && clean(floors.floorType) === "40") return unknown("네이버 원본: 구분유형·전체층 표기 확인 필요");
  if (residence === "1") return extent("unit", "네이버 원본: 일부 매물 선택", targets);
  const ground = typeof floors.groundTotalFloor === "string" || typeof floors.groundTotalFloor === "number"
    ? Number(floors.groundTotalFloor) : NaN;
  if (["C03", "C04", "C06", "D03", "D04", "D05"].includes(type) && target === "-" &&
    Number.isInteger(ground) && ground > 0) return extent("whole_building", "네이버 원본: 건물유형·전체 층 범위");
  if (saleFloorTarget(target) && !/^(?:저|중|고)층$/.test(saleFloorTarget(target)) ||
    NAVER_UNIT_TYPES.has(type) && (privateFloor || saleFloorTarget(target))) {
    return extent("unit", privateFloor ? "네이버 원본: 구분유형·해당층 비공개" : "네이버 원본: 해당층 지정", targets);
  }
  return unknown();
}

function gongsilExtent(provider) {
  const value = provider.gongsil || {};
  const type = compact(value.typeView).toUpperCase();
  const room = compact(value.ho);
  const wholeType = /^(?:건물통|통건물|건물전체|전체건물)(?:매매)?$/.test(type);
  const unitType = /^(?:상가|상가점포|구분상가|사무실|아파트|APT|APT분양권|OFT|OFT분양권|오피스텔|빌라|다세대|연립|원룸|지식산업센터)$/.test(type);
  const residentialUnit = /^(?:아파트|APT|APT분양권|OFT|OFT분양권|오피스텔|빌라|다세대|연립)$/.test(type);
  const buildingType = /^(?:건물|빌딩|다가구|단독|단독주택|전원주택|상가주택|공장|창고|공장\/창고)$/.test(type);
  const targetRoom = saleRoomTarget(room, true);
  const targetFloor = saleFloorTarget(value.floor) || (/층$/.test(room) ? saleFloorTarget(room) : "");
  const specificRoom = Boolean(targetRoom || /층$/.test(room) && saleFloorTarget(room));
  const explicitPartial = /부분매매|구분매매/.test(type);
  if (wholeType && (specificRoom || explicitPartial)) return unknown("공실박스 원본: 건물전체·개별공간 표기 상충");
  if (wholeType) return extent("whole_building", "공실박스 원본: 건물전체 유형");
  if (room === "전체" && buildingType) return extent("whole_building", "공실박스 원본: 건물형 매물·전체 표기");
  if (room === "전체") return unknown();
  if (explicitPartial || residentialUnit || unitType && (specificRoom || targetFloor)) {
    return extent("unit", residentialUnit ? "공실박스 원본: 개별 주거 유형" : "공실박스 원본: 개별공간 지정",
      { saleTargetFloor: targetFloor, saleTargetRoom: targetRoom });
  }
  return unknown();
}

function daangnExtent(original, provider) {
  const value = provider.daangn || {};
  const type = clean(value.salesType).toUpperCase();
  const body = clean(original.saleDetails?.descriptionText) || value.description || "";
  const description = [value.tagline || "", body].filter(Boolean).join("\n").slice(0, 12000);
  const explicit = descriptionSaleTarget(description);
  if (value.isEntireBuilding === true) {
    if (explicit.saleExtent === "unit" || explicit.partial || explicit.fractional || explicit.conflict || explicit.negated) return unknown("당근 원본·설명: 매매범위 근거 상충");
    return extent("whole_building", "당근 원본: 건물전체 선택");
  }
  if (explicit.blocked) return unknown(explicit.conflict ? "당근 설명: 전체·개별 매매 근거 상충"
    : explicit.partial || explicit.fractional ? "당근 광고: 일부·지분매매 확인 필요" : "당근 설명: 범위 문맥 확인 필요");
  if (explicit.saleExtent) {
    return extent(explicit.saleExtent, "당근 설명: 명시된 매매 대상",
      explicit.saleExtent === "unit" ? { saleTargetFloor: explicit.saleTargetFloor || saleFloorTarget(value.floor),
        saleTargetRoom: explicit.saleTargetRoom || "" } : {});
  }
  const described = saleDescriptionFields(description);
  const structural = describedWholeMultifamily(description);
  if (["ONE_ROOM", "OPEN_ONE_ROOM", "SPLIT_ONE_ROOM", "TWO_ROOM", "THREE_ROOM", "VILLA", "MULTIFAMILY", "HOUSE", "OTHER"].includes(type) && (described.wholeMultifamily || structural.wholeMultifamily)) {
    const totalFloors = described.totalFloors || structural.totalFloors;
    return extent("whole_building", "당근 설명: 다가구 전체매매 근거",
      totalFloors > 0 && !(Number(original.saleDetails?.totalFloors) > 0) ? { totalFloors } : {});
  }
  const wholeHint = original.saleDetails?.scope === "whole_building" || original.saleDetails?.descriptionCategory === "multifamily" ||
    ["building", "house", "mixed_house", "multifamily"].includes(original.saleCategory);
  if (!wholeHint && value.isEntireBuilding === false &&
    ["ONE_ROOM", "OPEN_ONE_ROOM", "SPLIT_ONE_ROOM", "TWO_ROOM", "THREE_ROOM", "VILLA", "APARTMENT", "OFFICETEL", "STORE", "COMMERCIAL", "OFFICE", "KNOWLEDGE_INDUSTRY_CENTER"].includes(type) &&
    (saleFloorTarget(value.floor) || ["OPEN_ONE_ROOM", "SPLIT_ONE_ROOM"].includes(type))) {
    return extent("unit", saleFloorTarget(value.floor) ? "당근 원본: 개별공간·해당층 지정" : "당근 원본: 개별 원룸 유형",
      { saleTargetFloor: saleFloorTarget(value.floor) });
  }
  return unknown();
}

function sourceFloorText(provider, source) {
  const fields = source === "네이버" ? provider.floorInfo || {} : source === "당근" ? provider.daangn || {} : provider.gongsil || {};
  const floor = source === "네이버" && clean(fields.floorType) === "30" ? "비공개"
    : saleFloorTarget(source === "네이버" ? fields.targetFloor : fields.floor) ||
      (source === "공실박스" && /층$/.test(clean(fields.ho)) ? saleFloorTarget(fields.ho) : "");
  const rawTotal = source === "네이버" ? fields.totalFloor : source === "당근" ? fields.topFloor : null;
  const total = ["number", "string"].includes(typeof rawTotal) && clean(rawTotal) !== "" ? Number(rawTotal) : NaN;
  return [floor, Number.isInteger(total) && total > 0 ? `총 ${total}층` : ""].filter(Boolean).join(" / ").slice(0, 60);
}

// Display evidence never rewrites legacy/default physical scope or room.
export function withSaleExtentDisplay(original, provider = {}) {
  if (original?.tradeType !== "sale" || original.saleCategory === "land" || original.saleDetails?.scope === "land") return original;
  const displayed = withNaverSaleFloorDisplay(original, provider);
  const source = provider.source || original.source;
  const result = source === "네이버" ? naverExtent(provider)
    : source === "공실박스" ? gongsilExtent(provider)
      : source === "당근" ? daangnExtent(original, provider) : unknown();
  const details = { ...(displayed.saleDetails || {}), ...result };
  delete details.saleSourceFloorText;
  const sourceFloors = sourceFloorText(provider, source);
  if (sourceFloors) details.saleSourceFloorText = sourceFloors;
  for (const key of ["saleTargetFloor", "saleTargetRoom"]) {
    delete details[key];
    if (result.saleExtent === "unit" && typeof result[key] === "string" && result[key].trim()) details[key] = result[key].trim().slice(0, 60);
  }
  return { ...displayed, saleDetails: details };
}

export function saleExtentProvider(raw = {}, source = "") {
  const list = raw.list && typeof raw.list === "object" ? raw.list : raw;
  return {
    source,
    floorInfo: raw.saleRaw?.detailInfo?.spaceInfo?.floorInfo || raw.saleRaw?.spaceInfo?.floorInfo,
    propertyType: first(raw.realEstateTypeCode, raw.category),
    room: raw.roomInfo,
    gongsil: { typeView: first(list.TypeView, list.ViewType, list.LndType, list.BuildingType),
      ho: first(list.Ho, list.BfHo, list.Room, list.Honame), floor: first(list.Ff, list.BfFloor, list.Floor, list.floor) },
    daangn: { isEntireBuilding: raw.isEntireBuilding, salesType: first(raw.salesTypeV3?.type, raw.salesTypeV3?.__typename),
      floor: raw.isAmbiguousFloor === true ? null : raw.floor,
      topFloor: raw.topFloor,
      tagline: typeof raw.addressInfo === "string" ? raw.addressInfo.slice(0, 500) : "",
      description: typeof raw.content === "string" ? raw.content.slice(0, 12000) : "" }
  };
}
