// Naver's fin.land property-type codes are not the older APT/OPST codes.
// Keep the provider code intact and translate only its display/category fields.
// Source: property.pstatic.net/property-web/_next/static/chunks/0lkh64f61d8h1.js
const definitions = {
  A01: ["아파트", "apartment"], A02: ["오피스텔", "officetel"],
  A04: ["재건축", "reconstruction"], A05: ["연립", "villa"],
  A06: ["다세대", "villa"], A07: ["도시형생활주택", "other"],
  B01: ["아파트분양권", "apartment_presale"], B02: ["오피스텔분양권", "officetel_presale"],
  C01: ["원룸", "one_room"], C02: ["빌라/연립", "villa"],
  C03: ["단독/다가구", "house"], C04: ["전원주택", "house"], C06: ["한옥주택", "house"],
  D01: ["사무실", "office"], D02: ["상가점포", "commercial"],
  D03: ["빌딩/건물", "building"], D04: ["상가건물", "building"], D05: ["상가주택", "mixed_house"],
  E01: ["숙박/콘도", "other"], E02: ["공장/창고", "factory_warehouse"],
  E03: ["토지/임야", "land"], E04: ["지식산업센터", "knowledge_center"],
  F01: ["재개발", "redevelopment"], G01: ["고시원", "other"], Z00: ["기타", "other"],
  APT: ["아파트", "apartment"], OPST: ["오피스텔", "officetel"], JGC: ["재건축", "reconstruction"],
  ABYG: ["아파트분양권", "apartment_presale"], OBYG: ["오피스텔분양권", "officetel_presale"],
  VL: ["빌라/연립", "villa"], DSD: ["다세대", "villa"], DDDGG: ["단독/다가구", "house"],
  JWJT: ["전원주택", "house"], SGJT: ["상가주택", "mixed_house"], OR: ["원룸", "one_room"],
  JGB: ["재개발", "redevelopment"], TJ: ["토지/임야", "land"], GM: ["빌딩/건물", "building"],
  GJCG: ["공장/창고", "factory_warehouse"], APTHG: ["지식산업센터", "knowledge_center"]
};

export const NAVER_PROPERTY_TYPES = Object.freeze(Object.fromEntries(Object.entries(definitions)
  .map(([code, [label, saleCategory]]) => [code, Object.freeze({ label, saleCategory })])));

const clean = value => String(value ?? "").trim();
const compact = value => clean(value).toLowerCase().replace(/[\s/_-]+/g, "");
const codeLike = value => /^[A-Z][A-Z0-9_]*$/i.test(clean(value));
const categoryNames = new Set(["commercial", "office", "multifamily", "house", "mixed_house", "building", "land",
  "factory_warehouse", "apartment", "villa", "officetel", "one_room", "reconstruction", "redevelopment",
  "apartment_presale", "officetel_presale", "knowledge_center", "other"]);

function categoryFromLabel(value) {
  const text = compact(value);
  const exact = Object.values(NAVER_PROPERTY_TYPES).find(entry => compact(entry.label) === text);
  if (exact) return exact.saleCategory;
  if (/토지|대지|임야|전답/.test(text)) return "land";
  if (/재건축/.test(text)) return "reconstruction";
  if (/재개발/.test(text)) return "redevelopment";
  if (/분양권/.test(text)) return /오피스텔/.test(text) ? "officetel_presale" : "apartment_presale";
  if (/아파트/.test(text)) return "apartment";
  if (/오피스텔/.test(text)) return "officetel";
  if (/다세대|빌라|연립/.test(text)) return "villa";
  if (/상가주택/.test(text)) return "mixed_house";
  if (/단독/.test(text)) return "house";
  if (/다가구/.test(text)) return "multifamily";
  if (/공장|창고/.test(text)) return "factory_warehouse";
  if (/전원|한옥/.test(text)) return "house";
  if (/원룸/.test(text)) return "one_room";
  if (/지식산업/.test(text)) return "knowledge_center";
  if (/건물|빌딩/.test(text)) return "building";
  if (/오피스|사무/.test(text)) return "office";
  if (/상가|점포|근린/.test(text)) return "commercial";
  return "other";
}

export function normalizeNaverPropertyType(value, fallbackCode = "") {
  const text = clean(value);
  const primaryCode = text.toUpperCase();
  const secondaryCode = clean(fallbackCode).toUpperCase();
  const code = NAVER_PROPERTY_TYPES[primaryCode] ? primaryCode
    : secondaryCode || (codeLike(text) ? primaryCode : "");
  const entry = NAVER_PROPERTY_TYPES[code];
  if (entry) {
    const label = text && !codeLike(text) ? text : entry.label;
    // C03/DDDGG group detached houses and multifamily together. Only an
    // explicit provider label may identify the more specific multifamily type.
    const saleCategory = ["C03", "DDDGG"].includes(code) && categoryFromLabel(label) === "multifamily"
      ? "multifamily" : entry.saleCategory;
    return { label, saleCategory, code, recognized: true };
  }
  if (!text || codeLike(text)) {
    return { label: "기타(유형 확인 필요)", saleCategory: "other", code, recognized: false };
  }
  const saleCategory = categoryFromLabel(text);
  return { label: text, saleCategory, code, recognized: saleCategory !== "other" || text === "기타" };
}

export function resolveNaverSaleCategory(value, category, fallbackCode = "") {
  const normalized = normalizeNaverPropertyType(value, fallbackCode);
  const explicit = [...categoryNames].find(name => compact(name) === compact(category)) || categoryFromLabel(category);
  // Human/legacy Korean categories without provider-code evidence must keep
  // their explicitly supplied classification; this fix is not a data migration.
  if (!normalized.code && explicit !== "other") return explicit;
  if (normalized.saleCategory !== "other") {
    if (["C03", "DDDGG"].includes(normalized.code) && explicit === "multifamily") return explicit;
    return normalized.saleCategory;
  }
  return explicit || "other";
}
