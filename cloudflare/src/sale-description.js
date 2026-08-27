// Conservative, label-based extraction. These are advertiser statements, not
// verified net income. Never convert after-interest income to gross rent.
export function koreanMoneyManwon(value) {
  const text = String(value ?? "").replace(/[,\s]/g, "").replace(/원$/, "");
  if (!text || !/^[\d.억만천백십]+$/.test(text)) return null;
  function small(part) {
    if (!part) return 0;
    if (/^\d+(?:\.\d+)?$/.test(part)) return Number(part);
    let total = 0, rest = part, previous = Infinity;
    const units = { 천: 1000, 백: 100, 십: 10 };
    while (rest) {
      const match = rest.match(/^(\d+(?:\.\d+)?)?([천백십])/);
      if (!match) return /^\d+$/.test(rest) ? total + Number(rest) : NaN;
      if (units[match[2]] >= previous) return NaN;
      previous = units[match[2]];
      total += Number(match[1] || 1) * previous;
      rest = rest.slice(match[0].length);
    }
    return total;
  }
  const match = text.match(/^(?:(\d+(?:\.\d+)?)억)?([\d.천백십]*)(만)?$/);
  if (!match) return null;
  // Without 억/만, only explicit 원 amounts are accepted (e.g. 3000000원).
  if (!match[1] && !match[3] && !/원\s*$/.test(String(value))) return null;
  if (match[1] && match[2] && !match[3]) return null;
  const amount = Number(match[1] || 0) * 10000 + small(match[2]) /
    (!match[1] && !match[3] ? 10000 : 1);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function saleDescriptionFields(content) {
  const text = String(content || "").slice(0, 24000);
  const warnings = [];
  const evidence = {};
  function unique(label, pattern, parse) {
    const matches = [...text.matchAll(pattern)].map(m => ({ value: parse(m[1]), text: m[0].trim() }))
      .filter(m => m.value != null && Number.isFinite(m.value));
    const values = [...new Set(matches.map(m => m.value))];
    if (values.length > 1) { warnings.push(label + " 설명값 충돌: 직접 확인 필요"); return null; }
    if (values.length === 1) evidence[label] = matches[0].text;
    return values.length === 1 ? values[0] : null;
  }
  // An explicit money unit is mandatory, even when the colon is omitted.
  const money = "([0-9][0-9,. 억천백십만]*(?:만원|억원|만|억|원))(?=\\s|$|[✅✔☑·,;])";
  const amount = (label, names) => unique(label, new RegExp("(?:^|[\\s✅✔☑*·])(?:" + names + ")\\s*[:：]?\\s*" + money, "g"), koreanMoneyManwon);
  const salePrice = amount("매매가", "매매가|매매금액|매매");
  const loanAmount = amount("융자", "융자금|융자|대출금");
  const totalDeposit = amount("보증금", "보증금\\s*합계|총\\s*보증금|기보증금|보증금");
  const monthlyIncome = amount("월 임대수입", "월세수입|월\\s*임대수입|월세합계|총\\s*월세|월세");
  const monthlyNetIncome = amount("이자 차감 월수익", "월수익\\s*\\(이자(?:제외|차감|공제)\\)");
  const statedMonthlyIncome = amount("기준 미확인 월수익", "월수익");
  const investmentAmount = amount("실투자금", "실투자금|실 투자금");
  const advertisedYield = unique("광고 연 수익률", /연\s*수익[률율]\s*[:：]\s*([\d.]+)\s*%/g, Number);
  const area = (label, name) => unique(label, new RegExp(name + "\\s*[:：]\\s*([\\d,.]+)\\s*(?:㎡|m²|m2)", "gi"), s => Number(s.replace(/,/g, "")));
  const landAreaM2 = area("대지면적", "대지면적");
  const grossAreaM2 = area("연면적", "연면적");
  const totalFloors = unique("건물층수", /건물층수\s*[:：]\s*총?\s*(\d+)\s*개?층/g, Number);
  const householdCount = unique("세대구성", /총\s*(\d+)\s*세대/g, Number);
  // Promotional "다가구 전문" alone must never reclassify a unit/apartment.
  const wholeMultifamily = landAreaM2 > 0 && grossAreaM2 >= landAreaM2 &&
    totalFloors > 0 && householdCount > 1 &&
    /(?:수익형\s*다가구|매물(?:종류|유형)\s*[:：]\s*다가구|다가구\s*(?:통매매|전체매매))/.test(text);
  return { salePrice, loanAmount, totalDeposit, monthlyIncome, monthlyNetIncome,
    statedMonthlyIncome, investmentAmount, advertisedYield, landAreaM2, grossAreaM2,
    totalFloors, householdCount, wholeMultifamily, descriptionEvidence: evidence,
    descriptionWarnings: warnings };
}

export function naverSaleDescription(item = {}) {
  const raw = item.saleRaw || {};
  const detail = raw.detailInfo || raw;
  const info = detail.articleDetailInfo || raw.articleDetailInfo || {};
  return [...new Set([item.description, detail.description, detail.articleDescription,
    detail.articleFeatureDescription, info.description, info.articleDescription,
    info.articleFeatureDescription, info.articleDesc].filter(v => typeof v === "string" && v.trim()))].join("\n").slice(0, 12000);
}

// Basic fields remain authoritative. Description values remain separately
// visible when inconsistent, and never silently become the canonical sale price.
export function supplementSaleDescription(base, described, salePrice, descriptionText) {
  const result = { ...base, descriptionVersion: 1, descriptionText,
    descriptionEvidence: described.descriptionEvidence,
    descriptionWarnings: [...(described.descriptionWarnings || [])],
    descriptionFinancials: Object.fromEntries(["salePrice", "loanAmount", "totalDeposit", "monthlyIncome",
      "monthlyNetIncome", "statedMonthlyIncome", "investmentAmount", "advertisedYield"].map(k => [k,described[k]]).filter(([,v]) => v != null)) };
  const priceConflict = salePrice > 0 && described.salePrice != null && salePrice !== described.salePrice;
  if (priceConflict) result.descriptionWarnings.push("매매가: 기본정보와 설명값 불일치 · 설명 수익자료 계산 적용 보류");
  for (const field of ["landAreaM2", "grossAreaM2", "loanAmount", "totalDeposit", "monthlyIncome",
    "monthlyNetIncome", "statedMonthlyIncome", "investmentAmount", "advertisedYield", "householdCount"]) {
    const value = described[field];
    if (value == null) continue;
    if (base[field] != null && Math.abs(base[field] - value) > 0.1) {
      const labels = { landAreaM2:"대지면적", grossAreaM2:"연면적", totalDeposit:"보증금", monthlyIncome:"월 임대수입",loanAmount:"융자" };
      result.descriptionWarnings.push((labels[field] || field) + ": 기본정보와 설명값 불일치 (기본 " + base[field] + " / 설명 " + value + ")");
    } else if (base[field] == null && (!priceConflict || /AreaM2$|householdCount/.test(field))) result[field] = value;
  }
  return result;
}
