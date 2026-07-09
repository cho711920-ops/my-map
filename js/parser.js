/* === JS부동산 AI Parser v1.0.1 최종 오버라이드: 권1000/보2000/월100 등 복붙 약어 인식 강화 === */
function moneyValueFromLabel(text, labelPattern) {
  text = String(text || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  var re = new RegExp("(?:^|[^가-힣A-Za-z0-9])(?:" + labelPattern + ")\\s*[:：=\\-]?\\s*([0-9][0-9,.]*(?:\\s*(?:억|천만|천|만원|만))?)", "i");
  var m = text.match(re);
  if (m && m[1]) return normalizeKoreanNumber(m[1]);

  // 문장 맨 앞에서 바로 시작하는 경우 보정: 권1000, 보2000, 월110
  var re2 = new RegExp("^(?:" + labelPattern + ")\\s*[:：=\\-]?\\s*([0-9][0-9,.]*(?:\\s*(?:억|천만|천|만원|만))?)", "i");
  m = text.match(re2);
  if (m && m[1]) return normalizeKoreanNumber(m[1]);

  return "";
}

function slashPriceValue(text, index) {
  text = String(text || "").replace(/,/g, "").replace(/\s+/g, " ").trim();
  var m = text.match(/([0-9]+(?:\.[0-9]+)?(?:\s*(?:억|천만|천|만원|만))?)\s*\/\s*([0-9]+(?:\.[0-9]+)?(?:\s*(?:만원|만)?)?)/);
  if (!m) return "";
  return normalizeKoreanNumber(index === 1 ? m[1] : m[2]);
}

function parseQuickAddText() {
  var rawEl = document.getElementById("qaRaw");
  if (!rawEl) return;

  var raw = rawEl.value || "";
  var compact = raw.replace(/\s+/g, " ").trim();
  var lines = raw.split(/\n+/).map(function(v) { return v.trim(); }).filter(Boolean);

  if (!compact) {
    alert("외부 매물 내용을 먼저 붙여넣어 주세요.");
    return;
  }

  setQuickAddNow();
  detectSourceFromRaw(raw);
  var source = document.getElementById("qaSource").value || "외부";

  var addressPatterns = [
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)/
  ];
  var address = "";
  for (var ai = 0; ai < addressPatterns.length; ai++) {
    var am = compact.match(addressPatterns[ai]);
    if (am && am[1]) { address = am[1].replace(/\s+/g, " ").trim(); break; }
  }

  var title = pickTitleLine(lines);

  var type = "";
  if (/상가|점포|가게|권리|무권/.test(compact)) type = "상가";
  else if (/사무실|오피스|업무/.test(compact)) type = "사무실";
  else if (/매매/.test(compact)) type = "매매";
  else if (/전세/.test(compact)) type = "전세";
  else if (/월세|임대/.test(compact)) type = "월세";

  var deposit = moneyValueFromLabel(compact, "보증금|보");
  if (!deposit) deposit = slashPriceValue(compact, 1);

  var rent = moneyValueFromLabel(compact, "월세|월");
  if (!rent) rent = slashPriceValue(compact, 2);

  var fee = "";
  if (/관리비\s*(없음|무|무료|0원|0만원|0만)|관\s*(없음|무|무료)/.test(compact)) fee = "0";
  else fee = moneyValueFromLabel(compact, "관리비|관리|관");

  var premium = "";
  if (/무권|무권리|권무|권리금\s*(없음|무|0원|0만원|0만)|권\s*(없음|무|0원|0만원|0만)/.test(compact)) {
    premium = "0";
  } else if (/권리금\s*협의|권리\s*협의|권\s*협의/.test(compact)) {
    premium = "";
  } else {
    // 핵심 수정: 권1000, 권 1000, 권리1000, 권리금1000 모두 숫자 전체 인식
    premium = moneyValueFromLabel(compact, "권리금|권리|권");
  }

  var areaMatch = compact.match(/(?:약\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:평|py|PY)/i);
  var roomMatch = compact.match(/((?:지하\s*)?\d+\s*층|[Bb]\s?\d+|\d+\s*호|[0-9]+F|[0-9]+층\s*[0-9]+호)/);
  var phones = compact.match(/01[016789][\-\s\.]?[0-9]{3,4}[\-\s\.]?[0-9]{4}|0[2-6][0-9]?[\-\s\.]?[0-9]{3,4}[\-\s\.]?[0-9]{4}/g) || [];

  setFieldValue("qaAddress", address, false);
  setFieldValue("qaName", title, false);
  setFieldValue("qaType", type || "상가", false);
  setFieldValue("qaDeposit", deposit, false);
  setFieldValue("qaRent", rent, false);
  setFieldValue("qaFee", fee, false);
  setFieldValue("qaPremium", premium, false);
  setFieldValue("qaArea", areaMatch ? areaMatch[1] : "", false);
  setFieldValue("qaRoom", roomMatch ? roomMatch[1].replace(/\s+/g, "") : "", false);
  setFieldValue("qaLandlordPhone", phones[0] ? normalizePhone(phones[0].replace(/\./g, "-")) : "", false);
  setFieldValue("qaTenantPhone", phones[1] ? normalizePhone(phones[1].replace(/\./g, "-")) : "", false);

  var memoEl = document.getElementById("qaMemo");
  if (memoEl && !memoEl.value) memoEl.value = buildCleanMemo(raw, source);

  updateQuickAddWarning();
  updateQuickAddPreview();
}
