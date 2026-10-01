const clean = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const legacyNaverTypes = { APT: "A01", OPST: "A02", JGC: "A04", ABYG: "B01", OBYG: "B02", VL: "C02",
  DSD: "A06", DDDGG: "C03", JWJT: "C04", SGJT: "D05", OR: "C01", JGB: "F01", TJ: "E03",
  GM: "D03", GJCG: "E02", APTHG: "E04" };
export const NAVER_UNIT_TYPES = new Set(["A01", "A02", "A04", "A05", "A06", "A07", "B01", "B02", "C01", "C02", "D01", "D02", "E04"]);

export function canonicalNaverSaleType(value) {
  const type = clean(value).toUpperCase();
  return legacyNaverTypes[type] || type;
}

export function saleFloorTarget(value) {
  const text = clean(value).replace(/\s+/g, "").replace(/^(-?[1-9]\d*)\.0+(층)?$/, "$1$2");
  if (/^(?:저|중|고)(?:층)?$/.test(text)) return text.replace(/층$/, "") + "층";
  const below = text.match(/^(?:B|지하|-)([1-9]\d*)(?:층)?$/i);
  if (below) return `지하${below[1]}층`.slice(0, 60);
  const above = text.match(/^([1-9]\d*)(?:층)?$/);
  return above ? `${above[1]}층`.slice(0, 60) : "";
}

export function saleRoomTarget(value, allowBare = false) {
  const text = clean(value).replace(/\s+/g, "");
  if (!text || text.length > 60 || /층|전체|비공개|미공개|미확인/.test(text)) return "";
  const pattern = /^(?:[가-힣A-Z0-9]+동)?(?:B[1-9]\d*|[1-9]\d*[A-Z]?)(?:호(?:실)?)?$/i;
  if (!pattern.test(text) || !allowBare && !/호(?:실)?$/.test(text)) return "";
  const result = text.replace(/호(?:실)?$/, "") + "호";
  return result.length <= 60 ? result : "";
}

// Read-time only: this deliberately does not normalize stored areas, prices or
// scope. Some ads use "면적 - 약 67평 (223.5㎡)" instead of colon labels.
export function describedWholeMultifamily(value) {
  const text = typeof value === "string" ? value.slice(0, 12000) : "";
  const one = (pattern, parse = Number) => {
    const values = [...new Set([...text.matchAll(pattern)].map(match => parse(match[1])).filter(number => Number.isFinite(number) && number > 0))];
    return values.length === 1 ? values[0] : null;
  };
  const area = label => one(new RegExp(label + "\\s*[:：-]\\s*(?:약\\s*)?([\\d,.]+(?:\\s*평\\s*[（(]\\s*[\\d,.]+)?\\s*(?:㎡|m²|m2|평))", "gi"), raw => {
    const square = raw.match(/([\d,.]+)\s*(?:㎡|m²|m2)/i);
    const pyeong = raw.match(/([\d,.]+)\s*평/);
    return square ? Number(square[1].replace(/,/g, "")) : pyeong ? Number(pyeong[1].replace(/,/g, "")) * 3.305785 : NaN;
  });
  const land = area("대지면적"), gross = area("연면적");
  const totalFloors = one(/(?:건물층수|총층수)\s*[:：-]\s*총?\s*(\d+)\s*개?층/g);
  const households = one(/(?:세대수\s*[:：-]\s*|총\s*)(\d+)\s*세대/g);
  const describedBuilding = /다가구\s*주택\s*(?:입니다|이며|으로)|(?:수익형\s*다가구|(?:매물(?:종류|유형)|중개대상물\s*종류)\s*[:：-]\s*다가구|다가구\s*(?:통매매|전체매매))/.test(text);
  return describedBuilding && land > 0 && gross >= land && totalFloors > 0 && households > 1
    ? { wholeMultifamily: true, totalFloors } : {};
}

// Only the selling subject is evidence: not tenancy, ads or buyer requests.
export function descriptionSaleTarget(value) {
  const text = typeof value === "string" ? value.slice(0, 12000) : "";
  const whole = [], unit = [];
  let buyerRequest = false, fractional = false, negated = false, partial = false;
  for (const clause of text.split(/[\n\r!?;。；]+|(?<!\d)\.|\.(?!\d)/)) {
    const part = clause.replace(/\s+/g, "").replace(/(?:일부)?지분(?:만)?(?:매매|판매)(?:은|는|가)?(?:아닙니다|아니며|아니고|아닌|아님|하지않습니다)/g, "");
    if (!part) continue;
    const wholePart = part.replace(/\((?:(?:지하|지상|B)?\d+층?(?:[~∼～-](?:지하|지상|B)?\d+층?)?)\)/gi, "");
    const partialScope = /(?:호실|세대)(?:별|별로|마다)(?:개별|분리)?(?:매매|판매)|(?:개별|분리|부분|구분)(?:매매|판매)|(?:건물|빌딩|상가|층|호실|세대).{0,12}(?:일부|절반)(?:만|를|을)?(?:매매|판매)/.test(part);
    const hasScope = partialScope || /(?:통|전체(?:를)?|일괄|부분|구분|통건물|전체건물)(?:매매|판매)|호(?:실)?(?:만|를|을|전체)?(?:매매|판매)|층(?:만|을|전체)?(?:매매|판매)/.test(wholePart);
    const fractionSale = /지분(?:율)?(?:[:：()]|일부|만|을|의|[\d./%])*(?:매매|판매)/.test(part) ||
      /(?:매매|판매)/.test(part) && /지분(?:율)?[:：]?(?:\d+(?:\.\d+)?%|\d+\/\d+)/.test(part);
    if (fractionSale) { fractional = true; continue; }
    if (!hasScope) continue;
    if (/아님|아닙|아니라|아닌|불가|제외|안함|안합니다|않/.test(part)) { negated = true; continue; }
    if (/구합니다|구해요|구함|찾습니다|찾아요|매수|매입(?:희망|원|합|할|하실)|(?:통|전체|일괄)매매시/.test(part)) {
      buyerRequest = true;
      continue;
    }
    // Broker promotions invalidate this sentence as evidence, not the
    // provider's separate, explicit selection of an individual unit.
    if (/전문|상담|예시/.test(part)) continue;
    // "지하1층 지상2층 매매" describes the building's size, not a sale of
    // the second floor. Remove only that scale phrase so an independently
    // stated "301호만 매매" or "2층만 매매" remains a conflicting unit target.
    let targetPart = part.replace(/지하[1-9]\d*층(?:[~∼～,·/-]|및)?지상[1-9]\d*층(?:을)?(?:매매|판매)/g, "");
    if (/[1-9]\d*층(?:집|건물)/.test(part)) targetPart = targetPart.replace(/(?:지상|총)[1-9]\d*층(?:을)?(?:매매|판매)/g, "");
    const room = targetPart.match(/((?:[가-힣A-Z0-9]+동)?(?:B[1-9]\d*|[1-9]\d*[A-Z]?)호(?:실)?)(?:만|를|을|전체)?(?:매매|판매)/i);
    const floorRange = targetPart.match(/((?:지하|지상|B)?[1-9]\d*층?[~∼～-](?:지하|지상|B)?[1-9]\d*층)(?:만|을|전체)?(?:매매|판매)/i);
    const floor = !floorRange && targetPart.match(/((?:지하|B|-)?[1-9]\d*층)(?:만|을|전체)?(?:매매|판매)/i);
    if (room || floor || floorRange) unit.push({ saleTargetRoom: saleRoomTarget(room?.[1]),
      saleTargetFloor: floorRange ? floorRange[1].replace(/[∼～]/g, "~").slice(0, 60) : saleFloorTarget(floor?.[1]) });
    if (/(?:건물|빌딩|다가구(?:주택)?|단독주택|상가주택)(?:은|는|을|를|의|[:：])?(?:전체(?:를)?|통|일괄)(?:매매|판매)|(?:통건물|전체건물)(?:을|를)?(?:매매|판매)/.test(wholePart)) whole.push(true);
    if (/(?:부분|구분)매매/.test(part) && !room && !floor) {
      const targetRoom = part.match(/((?:[가-힣A-Z0-9]+동)?[1-9]\d*호(?:실)?)/);
      const targetFloor = part.match(/((?:지하|B|-)?[1-9]\d*층)/i);
      if (targetRoom || targetFloor) unit.push({ saleTargetRoom: saleRoomTarget(targetRoom?.[1]), saleTargetFloor: saleFloorTarget(targetFloor?.[1]) });
      else partial = true;
    }
    if (partialScope && !room && !floor && !/(?:부분|구분)매매/.test(part)) partial = true;
  }
  if (fractional) return { blocked: true, fractional: true };
  if (partial) return { blocked: true, partial: true };
  if (whole.length && unit.length) return { blocked: true, conflict: true };
  if (negated && (whole.length || unit.length)) return { blocked: true, conflict: true };
  if (whole.length) return { saleExtent: "whole_building" };
  if (unit.length) {
    const rooms = [...new Set(unit.map(value => value.saleTargetRoom).filter(Boolean))];
    const floors = [...new Set(unit.map(value => value.saleTargetFloor).filter(Boolean))];
    if (rooms.length > 1 || floors.length > 1) return { blocked: true, conflict: true };
    return { saleExtent: "unit", saleTargetRoom: rooms[0] || "", saleTargetFloor: floors[0] || "" };
  }
  return buyerRequest || negated ? { blocked: true, negated } : {};
}
