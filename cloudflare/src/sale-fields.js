// Provider fields are retained separately: land is not exclusive floor area,
// total rent is not the monthly offer, and building use is not listing type.
const clean = (value) => String(value ?? "").trim();
const numeric = (value) => {
  if (value == null || clean(value) === "") return null;
  const result = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(result) && result >= 0 ? result : null;
};
const positive = (...values) => values.map(numeric).find((value) => value > 0) ?? null;
const present = (...values) => values.map(numeric).find((value) => value != null) ?? null;
const pyToM2 = (value) => value > 0 ? Math.round(value * 3.305785 * 100) / 100 : null;

export function saleCategoryFromLabel(value) {
  const text = clean(value).toLowerCase().replace(/[\s/_-]+/g, "");
  if (/토지|대지|임야|전답|^land$/.test(text)) return "land";
  if (/재건축|reconstruction/.test(text)) return "reconstruction";
  if (/재개발|redevelopment/.test(text)) return "redevelopment";
  if (/분양권|presale/.test(text)) return /오피스텔|officetel/.test(text) ? "officetel_presale" : "apartment_presale";
  if (/아파트|^apt$|apartment/.test(text)) return "apartment";
  if (/오피스텔|officetel/.test(text)) return "officetel";
  if (/다세대|빌라|villa/.test(text)) return "villa";
  if (/다가구|multifamily/.test(text)) return "multifamily";
  if (/상가주택|mixedhouse/.test(text)) return "mixed_house";
  if (/공장|창고|factory|warehouse/.test(text)) return "factory_warehouse";
  if (/단독|전원|주택|^house$|detachedhouse|countryhouse/.test(text)) return "house";
  if (/원룸|oneroom/.test(text)) return "one_room";
  if (/지식산업|knowledge/.test(text)) return "knowledge_center";
  if (/건물통|통건물|건물전체|건물|빌딩|building/.test(text)) return "building";
  if (/오피스|사무|office/.test(text)) return "office";
  if (/상가|점포|근린|commercial|store/.test(text)) return "commercial";
  return "other";
}

export const SALE_CATEGORY_LABELS = Object.freeze({
  commercial: "상가", office: "사무실", multifamily: "다가구", house: "단독/전원주택",
  mixed_house: "상가주택", building: "건물전체", land: "토지", factory_warehouse: "공장/창고",
  apartment: "아파트", villa: "빌라/다세대", officetel: "오피스텔", one_room: "원룸",
  reconstruction: "재건축", redevelopment: "재개발", apartment_presale: "아파트분양권",
  officetel_presale: "오피스텔분양권", knowledge_center: "지식산업센터", other: "기타"
});

export function gongsilSaleFields(raw = {}) {
  const list = raw.list || raw;
  const detail = raw.detail || {};
  const building = detail.getbilbases || {};
  const land = detail.getlands || {};
  const salePrice = positive(list.Me, list.SalePrice, list.DealPrice, list.SellPrice,
    list.TradingPrice, list.Ma, list.Mae);
  // TypeView is the explicit listing classification. In particular land with
  // use=warehouse remains land. Do not infer type from descriptive memo text.
  const sourceType = clean(list.TypeView || list.ViewType || list.LndType || list.BuildingType);
  const saleCategory = saleCategoryFromLabel(sourceType);
  const wholeBuilding = /건물통|통건물|건물전체/.test(sourceType) || clean(list.Ho) === "전체" && saleCategory !== "land";
  const landAreaM2 = positive(list.LandAreaM2) ?? pyToM2(positive(list.LandArea));
  const grossAreaM2 = positive(list.YunAreaM2) ?? pyToM2(positive(list.YunArea));
  const siteAreaM2 = saleCategory === "land"
    ? positive(list.AreaM2, list.BfArea, list.Areatxt) ?? pyToM2(positive(list.Area, list.Pyeong)) : null;
  const saleDetails = {
    sourceType, scope: saleCategory === "land" ? "land" : wholeBuilding ? "whole_building" : "unit",
    landAreaM2: landAreaM2 ?? siteAreaM2, grossAreaM2,
    totalDeposit: present(list.TotBomoney), monthlyIncome: present(list.TotMmmoney),
    // Extra parcels remain in the original description; never invent a second
    // canonical address from the memo or use brokerage contact/profile data.
    landUse: clean(land.LndCgrCodeNm || list.LandUse || list.Jimok),
    zoning: clean(land.PrposArea1Nm || list.UseArea || list.Zoning),
    roadAccess: clean(land.RoadSideCodeNm || list.RoadAccess),
    buildingUse: clean(building.MainPurpsCdNm || list.UseType || list.Usage),
    otherUse: clean(building.EtcPurps),
    buildingAreaM2: positive(building.ArchArea),
    aboveGroundFloors: present(building.GrndFlrCnt), belowGroundFloors: present(building.UgrndFlrCnt),
    approvalDate: clean(building.UseAprDay), householdCount: present(building.HhldCnt),
    familyCount: present(building.FmlyCnt)
  };
  return { salePrice, saleCategory, saleDetails, wholeBuilding,
    area: (saleCategory === "land" ? saleDetails.landAreaM2 : wholeBuilding ? grossAreaM2 : null) == null
      ? null : Math.round((saleCategory === "land" ? saleDetails.landAreaM2 : grossAreaM2) / 3.305785 * 10) / 10 };
}

export function naverSaleFields(item = {}) {
  const original = item.saleRaw || {};
  const detail = original.detailInfo || original;
  const space = detail.spaceInfo || detail.sizeInfo || original.spaceInfo || item.spaceInfo || {};
  const info = detail.articleDetailInfo || original.articleDetailInfo || {};
  const floors = info.floorDetailInfo || detail.floorDetailInfo || {};
  const price = detail.priceInfo || original.priceInfo || {};
  const saleCategory = saleCategoryFromLabel(item.saleCategory || item.category || item.realEstateTypeCode);
  const wholeBuilding = ["multifamily", "house", "mixed_house", "building"].includes(saleCategory);
  return {
    sourceType: clean(item.category || item.realEstateTypeCode),
    scope: saleCategory === "land" ? "land" : wholeBuilding ? "whole_building" : "unit",
    landAreaM2: positive(space.landSpace), grossAreaM2: positive(space.floorSpace),
    buildingAreaM2: positive(space.buildingSpace), exclusiveAreaM2: positive(space.exclusiveSpace),
    aboveGroundFloors: present(floors.groundFloorCount, info.groundFloorCount),
    belowGroundFloors: present(floors.undergroundFloorCount, info.undergroundFloorCount),
    // fin API money is won, unlike the normalized collector's manwon fields.
    totalDeposit: numeric(price.warrantyPrice) == null ? null : numeric(price.warrantyPrice) / 10000,
    monthlyIncome: numeric(price.rentPrice) == null ? null : numeric(price.rentPrice) / 10000
  };
}

export function daangnSaleFields(article = {}, category = "other") {
  return {
    sourceType: clean(article.salesTypeV3?.type || article.salesTypeV3?.__typename),
    scope: category === "land" ? "land" : article.isEntireBuilding ? "whole_building" : "unit",
    landAreaM2: positive(article.landArea, category === "land" ? article.area : null),
    grossAreaM2: positive(article.grossArea, article.isEntireBuilding ? article.area : null),
    exclusiveAreaM2: article.isEntireBuilding || category === "land" ? null : positive(article.area),
    roomCount: present(article.roomCount), bathroomCount: present(article.bathroomCount),
    maintenanceFee: present(article.totalManageCost),
    buildingUse: clean(article.buildingUse), approvalDate: clean(article.approvalDate),
    totalFloors: present(article.topFloor)
  };
}
