// Conservative, label-based extraction. These are advertiser statements, not
// verified net income. Never convert after-interest income to gross rent.
export function koreanMoneyManwon(value) {
  const compact = String(value ?? "").replace(/\s/g, "").replace(/원$/, "");
  let invalid = false;
  const text = compact.replace(/\d[\d,.]*/g, (token, index) => {
    if (token.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) { invalid=true; return token; }
    const cleaned=token.replace(/,/g,'');
    // Dot grouping before 만/원 is distinct from decimal 억: 90.000만원
    // is 90,000만원; 8.0억 and 8.000억 both remain decimal 억.
    if (!token.includes(',') && /^\d{1,3}(?:\.\d{3})+$/.test(token) &&
        (/^만/.test(compact.slice(index+token.length)) || index+token.length===compact.length && /원\s*$/.test(String(value)))) return token.replace(/\./g,'');
    return cleaned;
  });
  if (invalid) return null;
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
  // A named financial amount such as 8억8천 omits only the trailing 만원.
  // Keep ambiguous bare remainders (8억8000) and mixed 원 tails out.
  if (match[1] && match[2] && !match[3] &&
      (!/[천백십]$/.test(match[2]) || /원\s*$/.test(String(value)))) return null;
  const amount = Number(match[1] || 0) * 10000 + small(match[2]) /
    (!match[1] && !match[3] ? 10000 : 1);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function saleDescriptionFields(content) {
  const text = String(content || "").slice(0, 24000);
  const warnings = [];
  const evidence = {};
  const partialFields = new Set();
  function unique(label, pattern, parse) {
    const matches = [...text.matchAll(pattern)].map(m => ({ value: parse(m[1]), text: m[0].trim() }))
      .filter(m => m.value != null && Number.isFinite(m.value));
    const values = [...new Set(matches.map(m => m.value))];
    if (values.length > 1) { warnings.push(label + " 설명값 충돌: 직접 확인 필요"); return null; }
    if (values.length === 1) evidence[label] = matches[0].text;
    return values.length === 1 ? values[0] : null;
  }
  // Keep quotes as exact substrings of the original for the source-jump UI.
  // A bare number still needs a unit. 억 + a lower named unit can omit 만원.
  const boundary = "(?:^|[^\\p{L}\\p{N}])";
  const wrappedMoney = "[0-9][0-9,. \\t]*억[ \\t]*\\r?\\n[ \\t]*[0-9][0-9,. \\t천백십]*(?:만\\s*원|만|천|백|십)";
  const money = "(" + wrappedMoney + "|[0-9][0-9,. \\t억천백십만]*(?:만\\s*원|억\\s*원|만|억|원|천|백|십))(?=\\s|$|[✅✔☑·,;/()▶▷●■◆◇🔸🔹⭐]|으로|에|이며|이고|입니다|임대)";
  const paired = [...text.matchAll(new RegExp(boundary + "(?:(?:현재|현|총|기존|기)\\s*)?보\\s*증\\s*금(?:액)?\\s*(?:/|및)\\s*(?:총\\s*)?월\\s*(?:세|차임|임대료)\\s*(?:\\(\\s*현재\\s*\\))?\\s*[:：]?\\s*" + money + "\\s*/\\s*" + money, "gu"))];
  const labelStart = m => m.index + (m[0].match(/^[^\p{L}\p{N}]+/u)?.[0].length || 0);
  function contextAt(start, end) {
    const before = text.slice(Math.max(0, start - 100), start).split(/[\r\n▶▷●■◆◇✅✔☑]/u).at(-1);
    const after = text.slice(end, end + 70).split(/[\r\n▶▷●■◆◇✅✔☑]/u)[0];
    return { before, after };
  }
  function projected(start, end) {
    const { before, after } = contextAt(start, end);
    return /만실\s*(?:시|기준)|예상\s*(?:임대|월세|수익)|시세|임대(?:를)?\s*원하실|전환\s*시/.test(before) ||
      /^(?:\s|[(),.;]){0,8}(?:예상|만실|시세)/.test(after) || /^.{0,30}(?:인상|증액)\s*(?:여지|가능|예정)?/.test(after);
  }
  function markPartial(label, start, quote) {
    const local = contextAt(start, start + quote.length).before;
    if (/(?:\d+\s*층|\d+\s*호(?!실)|일부\s*호실).{0,24}$/.test(local) && !/총|합계|전체|매매가|건물현황/.test(local + quote)) {
      partialFields.add(label === "보증금" ? "totalDeposit" : label === "월 임대수입" ? "monthlyIncome" : label === "이자 차감 월수익" ? "monthlyNetIncome" : "statedMonthlyIncome");
    }
  }
  function amount(label, names, monthly = false) {
    const matches = [];
    const rental = ["보증금", "월 임대수입", "이자 차감 월수익", "기준 미확인 월수익"].includes(label);
    const separator="(?:\\s*[:：=]\\s*|[ \\t]+[-–—][ \\t]+|\\s*)";
    for (const m of text.matchAll(new RegExp(boundary + "(?:" + names + ")" + separator + (monthly ? "(?:월\\s*)?" : "") + money, "gu"))) {
      // In '보증금 / 월세:4000만원 / 290만원', 4000 belongs to the deposit.
      const prefix = text.slice(Math.max(0, m.index - 25), m.index);
      if (label === "월 임대수입" && (/보\s*증\s*금(?:액)?\s*(?:\/|및)\s*$/.test(prefix) || /보\s*증\s*금(?:액)?\s*$/.test(prefix) && /^\//.test(m[0]))) continue;
      if (label === "월 임대수입" && /(?:순|이자\s*(?:차감|공제|제외))\s*$/.test(prefix)) continue;
      const afterMoney = text.slice(m.index + m[0].length, m.index + m[0].length + 45);
      if (label === "월 임대수입" && /^(?:\s|[(/,·]){0,8}(?:대출\s*)?이자\s*(?:차감|공제|제외)(?!\s*전)/.test(afterMoney)) continue;
      // A numbered next item / next line / floor is not a money suffix.
      if (/억\s*(?:원)?$/.test(m[1]) && /^[ \t]*(?:\d[\d,]*[ \t]*[천백십만]|[\d,]+(?=[ \t]*(?:$|[\r\n▶▷●■◆◇])))/u.test(text.slice(m.index + m[0].length))) {
        warnings.push(label + " 금액 단위 불완전: 직접 확인 필요");
        continue;
      }
      const value = koreanMoneyManwon(m[1]);
      if (value == null) { warnings.push(label + " 금액 표기 확인 필요"); continue; }
      if (rental && projected(labelStart(m), m.index + m[0].length)) {
        if (!warnings.includes("예상·만실·인상 금액: 기존 임대조건 계산 미적용")) warnings.push("예상·만실·인상 금액: 기존 임대조건 계산 미적용");
        continue;
      }
      if (rental) markPartial(label, labelStart(m), m[0]);
      matches.push({ value, text: m[0].trim() });
    }
    if (label === "보증금" || label === "월 임대수입") for (const m of paired) {
      if (projected(labelStart(m), m.index + m[0].length)) {
        warnings.push("예상·만실·인상 금액: 기존 임대조건 계산 미적용");
        continue;
      }
      const value = koreanMoneyManwon(m[label === "보증금" ? 1 : 2]);
      markPartial(label, labelStart(m), m[0]);
      if (value != null) matches.push({ value, text: m[0].trim() });
    }
    const values = [...new Set(matches.map(m => m.value))];
    if (values.length > 1) { warnings.push(label + " 설명값 충돌: 직접 확인 필요"); return null; }
    if (values.length === 1) evidence[label] = matches[0].text;
    return values.length === 1 ? values[0] : null;
  }
  const salePrice = amount("매매가", "매매가격|매도가격|매매가|매매금액|매매");
  const loanAmount = amount("융자", "융\\s*자(?:금(?:액)?)?|대\\s*출(?:\\s*금(?:액)?)?");
  const depositLabel="보\\s*증\\s*금(?:액)?";
  const totalDeposit = amount("보증금", "(?:(?:현재|현|기존)\\s*)?(?:" + "(?:총\\s*)?(?:임대|임차)\\s*"+depositLabel+"(?:\\s*(?:합계|총액|총합|합))?|"+depositLabel+"\\s*(?:합계|총액|총합|합)|총\\s*"+depositLabel+"|기\\s*"+depositLabel+"|"+depositLabel + ")");
  const monthlyIncome = amount("월 임대수입", "(?:(?:현재|현|총|기존|기)\\s*)?(?:월\\s*세\\s*(?:수\\s*입|수\\s*익|소\\s*득|합계|총액)?|월\\s*임대\\s*(?:료|수입|수익|합계|총액)|월\\s*차임)", true);
  const monthlyNetIncome = amount("이자 차감 월수익", "월\\s*(?:순\\s*)?수익\\s*\\(\\s*(?:대출\\s*)?이자\\s*(?:제외|차감|공제)(?:\\s*후)?\\s*\\)", true);
  const statedMonthlyIncome = amount("기준 미확인 월수익", "월\\s*(?:순\\s*)?수익", true);
  const investmentAmount = amount("실투자금", "실\\s*투\\s*자\\s*금");
  const advertisedYield = unique("광고 연 수익률", /연\s*수익[률율]?\s*[:：]?\s*([\d.]+)\s*%/g, Number);
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
    descriptionWarnings: [...new Set(warnings)], descriptionPartialFields: [...partialFields] };
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
  const result = { ...base, descriptionVersion: 4, descriptionText,
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
    if ((base.scope === "whole_building" || base.saleExtent === "whole_building") && described.descriptionPartialFields?.includes(field)) {
      result.descriptionWarnings.push("일부 층·호실 " + field + ": 건물 합계로 적용 보류");
      continue;
    }
    if (base[field] != null && Math.abs(base[field] - value) > 0.1) {
      const labels = { landAreaM2:"대지면적", grossAreaM2:"연면적", totalDeposit:"보증금", monthlyIncome:"월 임대수입",loanAmount:"융자" };
      result.descriptionWarnings.push((labels[field] || field) + ": 기본정보와 설명값 불일치 (기본 " + base[field] + " / 설명 " + value + ")");
    } else if (base[field] == null && (!priceConflict || /AreaM2$|householdCount/.test(field))) result[field] = value;
  }
  return result;
}
