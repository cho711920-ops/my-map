/* JS부동산 빠른등록/파서 전용 스크립트 */
function openQuickAddModal() {
  var modal = document.getElementById("quickAddModal");
  if (!modal) return;
  modal.style.display = "block";
  setQuickAddNow();
  setTimeout(function() {
    var raw = document.getElementById("qaRaw");
    if (raw) raw.focus();
  }, 80);
}


function closeQuickAddModal() {
  var modal = document.getElementById("quickAddModal");
  if (modal) modal.style.display = "none";
}


function setQuickAddNow(force) {
  var regDate = document.getElementById("qaRegDate");
  if (regDate && (force || !regDate.value)) {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, "0");
    var dd = String(now.getDate()).padStart(2, "0");
    var hh = String(now.getHours()).padStart(2, "0");
    var mi = String(now.getMinutes()).padStart(2, "0");
    regDate.value = yyyy + "-" + mm + "-" + dd + " " + hh + ":" + mi;
  }
}


function setupQuickAddShortcuts() {
  var raw = document.getElementById("qaRaw");
  var modal = document.getElementById("quickAddModal");

  if (raw) {
    raw.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        parseQuickAddText();
      }
    });
  }

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && modal && modal.style.display === "block") {
      closeQuickAddModal();
    }
  });
}


function onlyNumberText(value) {
  return String(value || "").replace(/,/g, "").replace(/만원/g, "").replace(/만/g, "").replace(/[^0-9.]/g, "");
}


function normalizePhone(value) {
  return String(value || "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
}


function findFirstMatch(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m && m[1]) return onlyNumberText(m[1]);
  }
  return "";
}


function setFieldIfEmpty(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (!el.value && value !== undefined && value !== null && String(value).trim() !== "") {
    el.value = String(value).trim();
  }
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

  var source = document.getElementById("qaSource").value || "외부";

  var addressMatch = compact.match(/((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)?\s*[가-힣0-9]+동\s*\d+(?:-\d+)?)/);
  setFieldIfEmpty("qaAddress", addressMatch ? addressMatch[1].replace(/\s+/g, " ").trim() : "");

  if (lines.length > 0) setFieldIfEmpty("qaName", lines[0].slice(0, 40));

  if (!document.getElementById("qaType").value) {
    if (/상가/.test(compact)) document.getElementById("qaType").value = "상가";
    else if (/사무실|오피스/.test(compact)) document.getElementById("qaType").value = "사무실";
    else if (/매매/.test(compact)) document.getElementById("qaType").value = "매매";
    else if (/전세/.test(compact)) document.getElementById("qaType").value = "전세";
    else document.getElementById("qaType").value = "월세";
  }

  var deposit = findFirstMatch(compact, [
    /보증금\s*([0-9,.]+)\s*(?:만원|만)?/,
    /보\s*([0-9,.]+)\s*\/\s*월/,
    /([0-9,.]+)\s*\/\s*[0-9,.]+/
  ]);

  var rent = findFirstMatch(compact, [
    /월세\s*([0-9,.]+)\s*(?:만원|만)?/,
    /월\s*([0-9,.]+)\s*(?:만원|만)?/,
    /[0-9,.]+\s*\/\s*([0-9,.]+)/
  ]);

  var fee = findFirstMatch(compact, [
    /관리비\s*([0-9,.]+)\s*(?:만원|만)?/,
    /관\s*([0-9,.]+)\s*(?:만원|만)?/
  ]);

  var premium = findFirstMatch(compact, [
    /권리금\s*([0-9,.]+)\s*(?:만원|만)?/,
    /권\s*([0-9,.]+)\s*(?:만원|만)?/
  ]);

  var areaMatch = compact.match(/([0-9]+(?:\.[0-9]+)?)\s*평/);
  var roomMatch = compact.match(/((?:지하\s*)?\d+층|\d+호|[Bb]\d+)/);
  var phones = compact.match(/01[016789][-\s]?[0-9]{3,4}[-\s]?[0-9]{4}/g) || [];

  setFieldIfEmpty("qaDeposit", deposit);
  setFieldIfEmpty("qaRent", rent);
  setFieldIfEmpty("qaFee", fee);
  setFieldIfEmpty("qaPremium", premium);
  setFieldIfEmpty("qaArea", areaMatch ? areaMatch[1] : "");
  setFieldIfEmpty("qaRoom", roomMatch ? roomMatch[1].replace(/\s+/g, "") : "");
  setFieldIfEmpty("qaLandlordPhone", phones[0] ? normalizePhone(phones[0]) : "");
  setFieldIfEmpty("qaTenantPhone", phones[1] ? normalizePhone(phones[1]) : "");

  var memoEl = document.getElementById("qaMemo");
  if (memoEl && !memoEl.value) memoEl.value = "출처:" + source + " / " + compact.slice(0, 260);

  updateQuickAddWarning();
}


function getQuickAddRowValues() {
  var source = document.getElementById("qaSource").value || "외부";
  var memo = document.getElementById("qaMemo").value || "";
  if (memo.indexOf("출처:") === -1) memo = "출처:" + source + (memo ? " / " + memo : "");

  return [
    document.getElementById("qaName").value,
    document.getElementById("qaAddress").value,
    document.getElementById("qaRoom").value,
    document.getElementById("qaType").value,
    onlyNumberText(document.getElementById("qaDeposit").value),
    onlyNumberText(document.getElementById("qaRent").value),
    onlyNumberText(document.getElementById("qaFee").value),
    onlyNumberText(document.getElementById("qaPremium").value),
    onlyNumberText(document.getElementById("qaArea").value),
    document.getElementById("qaLandlordPhone").value,
    document.getElementById("qaTenantPhone").value,
    memo,
    document.getElementById("qaState").value,
    document.getElementById("qaRegDate").value
  ];
}


function validateQuickAdd() {
  var address = (document.getElementById("qaAddress").value || "").trim();
  var name = (document.getElementById("qaName").value || "").trim();
  if (!address && !name) {
    alert("건물이름 또는 주소 중 하나는 입력해야 합니다.");
    return false;
  }
  return true;
}


function updateQuickAddWarning() {
  var box = document.getElementById("quickAddWarning");
  if (!box) return;
  var address = (document.getElementById("qaAddress").value || "").trim();
  var room = (document.getElementById("qaRoom").value || "").trim();
  if (!address) {
    box.style.display = "none";
    return;
  }

  var same = allItems.filter(function(item) {
    var sameAddress = item.address && address && item.address.replace(/\s+/g, "") === address.replace(/\s+/g, "");
    var sameRoom = !room || !item.room || item.room.replace(/\s+/g, "") === room.replace(/\s+/g, "");
    return sameAddress && sameRoom;
  });

  if (same.length > 0) {
    box.style.display = "block";
    box.innerHTML = "이미 비슷한 주소가 " + same.length + "개 있습니다. 중복 여부를 확인하세요.";
  } else {
    box.style.display = "none";
  }
}


function copyQuickAddRow() {
  if (!validateQuickAdd()) return;
  var values = getQuickAddRowValues();
  var rowText = values.map(function(v) {
    return String(v || "").replace(/\t/g, " ").replace(/\n/g, " ").trim();
  }).join("\t");

  function done() {
    alert("시트에 붙여넣을 한 줄을 복사했습니다.\n구글시트 맨 아래 첫 칸에 붙여넣으면 됩니다.\n\n입력칸은 새 등록을 위해 초기화됩니다.");
    clearQuickAddForm();
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(rowText).then(done).catch(function() { fallbackCopyText(rowText); });
  } else {
    fallbackCopyText(rowText);
  }
}


function fallbackCopyText(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  alert("시트에 붙여넣을 한 줄을 복사했습니다.\n\n입력칸은 새 등록을 위해 초기화됩니다.");
  clearQuickAddForm();
}


function saveQuickAddToSheet() {
  if (!validateQuickAdd()) return;
  if (!saveApiURL) {
    alert("자동등록 URL이 아직 연결되지 않았습니다.\nApps Script 배포 URL을 HTML의 saveApiURL에 넣어주세요.\n지금은 '시트 행 복사'를 사용할 수 있습니다.");
    return;
  }

  var values = getQuickAddRowValues();
  var btn = document.querySelector(".auto-save-btn");
  var oldText = btn ? btn.innerText : "";
  if (btn) {
    btn.innerText = "등록중...";
    btn.disabled = true;
  }

  fetch(saveApiURL, {
    method:"POST",
    mode:"no-cors",
    headers:{ "Content-Type":"text/plain;charset=utf-8" },
    body:JSON.stringify({ values: values })
  }).then(function() {
    alert("자동등록 요청을 보냈습니다.\n잠시 후 지도에 반영됩니다.");
    closeQuickAddModal();
    clearQuickAddForm();
    setTimeout(function() { loadSheet(true); }, 1500);
  }).catch(function(err) {
    console.error(err);
    alert("자동등록 요청 중 오류가 발생했습니다.\n연결 URL을 확인해주세요.");
  }).finally(function() {
    if (btn) {
      btn.innerText = oldText;
      btn.disabled = false;
    }
  });
}


function clearQuickAddForm() {
  ["qaRaw","qaName","qaAddress","qaRoom","qaType","qaDeposit","qaRent","qaFee","qaPremium","qaArea","qaLandlordPhone","qaTenantPhone","qaMemo","qaRegDate"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });

  var source = document.getElementById("qaSource");
  if (source) source.value = "공실박스";

  var state = document.getElementById("qaState");
  if (state) state.value = "";

  var warning = document.getElementById("quickAddWarning");
  if (warning) {
    warning.style.display = "none";
    warning.innerHTML = "";
  }

  var preview = document.getElementById("quickAddPreview");
  if (preview) preview.innerHTML = "AI 분석 전입니다. 외부 매물 내용을 붙여넣고 AI 분석을 눌러주세요.";

  setQuickAddNow(true);

  var modal = document.getElementById("quickAddModal");
  var raw = document.getElementById("qaRaw");
  if (modal && modal.style.display === "block" && raw) {
    setTimeout(function() { raw.focus(); }, 50);
  }
}


function openGoogleSheet() {
  window.open("https://docs.google.com/spreadsheets/d/1zRWqjc7xVkiTnFHFujBNI72qr_aDCgxiQipQlnGgWmU/edit", "_blank");
}


function normalizeKoreanNumber(value) {
  var text = String(value || "").replace(/,/g, "").replace(/\s+/g, "").trim();
  if (!text) return "";
  if (/무권|무권리|없음|협의/.test(text)) return /무권|무권리|없음/.test(text) ? "0" : "";

  var total = 0;
  var hasUnit = false;

  var eok = text.match(/([0-9]+(?:\.[0-9]+)?)억/);
  if (eok) {
    total += parseFloat(eok[1]) * 10000;
    hasUnit = true;
  }

  var chun = text.match(/([0-9]+(?:\.[0-9]+)?)(?:천|천만)/);
  if (chun) {
    total += parseFloat(chun[1]) * 1000;
    hasUnit = true;
  }

  var man = text.match(/([0-9]+(?:\.[0-9]+)?)(?:만원|만)/);
  if (man) {
    total += parseFloat(man[1]);
    hasUnit = true;
  }

  if (hasUnit) return String(Math.round(total * 10) / 10).replace(/\.0$/, "");

  var plain = text.replace(/[^0-9.]/g, "");
  return plain;
}


function onlyNumberText(value) {
  return normalizeKoreanNumber(value);
}


function findFirstMatch(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m && m[1]) return normalizeKoreanNumber(m[1]);
  }
  return "";
}


function setFieldValue(id, value, overwrite) {
  var el = document.getElementById(id);
  if (!el) return;
  if (overwrite || !el.value) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      el.value = String(value).trim();
    }
  }
}


function pickTitleLine(lines) {
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;
    if (/010|보증금|월세|관리비|권리금|[0-9,.]+\s*\/\s*[0-9,.]+|평|만원|주소|매물번호|연락처/.test(line)) continue;
    if (line.length >= 2 && line.length <= 45) return line;
  }
  return lines[0] ? lines[0].slice(0, 40) : "";
}


function buildCleanMemo(raw, source) {
  var text = String(raw || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map(function(v) { return v.trim(); })
    .filter(Boolean)
    .join(" / ");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 320) text = text.slice(0, 320) + "...";
  return "출처:" + source + (text ? " / " + text : "");
}


function detectSourceFromRaw(raw) {
  var sourceEl = document.getElementById("qaSource");
  if (!sourceEl) return;
  var text = String(raw || "");
  if (/공실박스|gongsil/i.test(text)) sourceEl.value = "공실박스";
  else if (/네이버|naver/i.test(text)) sourceEl.value = "네이버";
  else if (/당근|daangn|karrot/i.test(text)) sourceEl.value = "당근";
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
  if (/상가|점포|가게|권리/.test(compact)) type = "상가";
  else if (/사무실|오피스|업무/.test(compact)) type = "사무실";
  else if (/매매/.test(compact)) type = "매매";
  else if (/전세/.test(compact)) type = "전세";
  else if (/월세|임대/.test(compact)) type = "월세";

  var deposit = findFirstMatch(compact, [
    /보증금\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)/,
    /보\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)\s*(?:\/|월)/,
    /([0-9,.]+\s*(?:억|천만|천|만원|만)?)\s*\/\s*[0-9,.]+/
  ]);

  var rent = findFirstMatch(compact, [
    /월세\s*([0-9,.]+\s*(?:만원|만)?)/,
    /월\s*([0-9,.]+\s*(?:만원|만)?)/,
    /[0-9,.]+\s*(?:억|천만|천|만원|만)?\s*\/\s*([0-9,.]+\s*(?:만원|만)?)/
  ]);

  var fee = findFirstMatch(compact, [
    /관리비\s*([0-9,.]+\s*(?:만원|만)?)/,
    /관\s*([0-9,.]+\s*(?:만원|만)?)/
  ]);

  var premium = "";
  if (/무권|무권리/.test(compact)) premium = "0";
  else premium = findFirstMatch(compact, [
    /권리금\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)/,
    /권\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)/
  ]);

  var areaMatch = compact.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:평|py|PY)/i);
  var roomMatch = compact.match(/((?:지하\s*)?\d+\s*층|[Bb]\s?\d+|\d+\s*호|[0-9]+F|[0-9]+층\s*[0-9]+호)/);
  var phones = compact.match(/01[016789][\-\s\.]?[0-9]{3,4}[\-\s\.]?[0-9]{4}/g) || [];

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


function getQuickAddObject() {
  return {
    source: document.getElementById("qaSource").value || "외부",
    name: document.getElementById("qaName").value || "",
    address: document.getElementById("qaAddress").value || "",
    room: document.getElementById("qaRoom").value || "",
    type: document.getElementById("qaType").value || "",
    deposit: onlyNumberText(document.getElementById("qaDeposit").value),
    rent: onlyNumberText(document.getElementById("qaRent").value),
    fee: onlyNumberText(document.getElementById("qaFee").value),
    premium: onlyNumberText(document.getElementById("qaPremium").value),
    area: onlyNumberText(document.getElementById("qaArea").value),
    landlordPhone: document.getElementById("qaLandlordPhone").value || "",
    tenantPhone: document.getElementById("qaTenantPhone").value || "",
    memo: document.getElementById("qaMemo").value || "",
    state: document.getElementById("qaState").value || "",
    regDate: document.getElementById("qaRegDate").value || ""
  };
}


function updateQuickAddPreview() {
  var box = document.getElementById("quickAddPreview");
  if (!box) return;
  var o = getQuickAddObject();
  var required = [
    ["건물이름", o.name], ["주소", o.address], ["구분", o.type],
    ["보증금", o.deposit], ["월세", o.rent], ["평수", o.area]
  ];
  var okCount = required.filter(function(x) { return String(x[1] || "").trim() !== ""; }).length;
  var status = okCount >= 5 ? '<span class="good">분석 양호</span>' : '<span class="warn">확인 필요</span>';
  var price = "보" + (o.deposit || "-") + " / 월" + (o.rent || "-") + " / 관" + (o.fee || "-") + " / 권" + (o.premium || "-") + " / " + (o.area || "-") + "평";
  box.innerHTML =
    '<b>AI 분석 미리보기</b> · ' + status + ' <span class="muted">(' + okCount + '/6 핵심항목)</span>' +
    '<div class="preview-row">' + escapeHtml(o.source) + ' · ' + escapeHtml(o.type || '구분없음') + ' · ' + escapeHtml(o.name || '건물이름 없음') + '</div>' +
    '<div class="preview-row">' + escapeHtml(o.address || '주소 없음') + ' / ' + escapeHtml(o.room || '호실 없음') + '</div>' +
    '<div class="preview-row">' + escapeHtml(price) + '</div>' +
    '<div class="preview-row">임대인 ' + escapeHtml(o.landlordPhone || '-') + ' / 세입자 ' + escapeHtml(o.tenantPhone || '-') + '</div>';
}


function updateQuickAddWarning() {
  var box = document.getElementById("quickAddWarning");
  if (!box) return;
  var address = (document.getElementById("qaAddress").value || "").trim();
  var room = (document.getElementById("qaRoom").value || "").trim();
  if (!address) {
    box.style.display = "none";
    updateQuickAddPreview();
    return;
  }

  var same = allItems.filter(function(item) {
    var sameAddress = item.address && address && item.address.replace(/\s+/g, "") === address.replace(/\s+/g, "");
    var sameRoom = !room || !item.room || item.room.replace(/\s+/g, "") === room.replace(/\s+/g, "");
    return sameAddress && sameRoom;
  });

  if (same.length > 0) {
    var first = same[0];
    box.style.display = "block";
    box.innerHTML = "⚠ 이미 비슷한 주소가 " + same.length + "개 있습니다. " +
      "첫 매물: " + escapeHtml(first.name || "") + " / 보" + first.deposit + " / 월" + first.rent + " / " + escapeHtml(first.room || "") +
      "<br>중복등록인지 확인 후 진행하세요.";
  } else {
    box.style.display = "none";
  }
  updateQuickAddPreview();
}


function getQuickAddRowValues() {
  var o = getQuickAddObject();
  var memo = o.memo || "";
  if (memo.indexOf("출처:") === -1) memo = "출처:" + o.source + (memo ? " / " + memo : "");

  return [
    o.name, o.address, o.room, o.type,
    o.deposit, o.rent, o.fee, o.premium, o.area,
    o.landlordPhone, o.tenantPhone, memo, o.state, o.regDate
  ];
}


function validateQuickAdd() {
  updateQuickAddWarning();
  var o = getQuickAddObject();
  if (!o.address && !o.name) {
    alert("건물이름 또는 주소 중 하나는 입력해야 합니다.");
    return false;
  }
  if (!o.deposit && !o.rent && !o.area) {
    return confirm("가격/평수 정보가 거의 비어 있습니다. 그래도 진행할까요?");
  }
  return true;
}


function clearQuickAddForm() {
  ["qaRaw","qaName","qaAddress","qaRoom","qaType","qaDeposit","qaRent","qaFee","qaPremium","qaArea","qaLandlordPhone","qaTenantPhone","qaMemo","qaRegDate"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });
  var state = document.getElementById("qaState");
  if (state) state.value = "";
  var preview = document.getElementById("quickAddPreview");
  if (preview) preview.innerHTML = "AI 분석 전입니다. 외부 매물 내용을 붙여넣고 AI 분석을 눌러주세요.";
  var warn = document.getElementById("quickAddWarning");
  if (warn) warn.style.display = "none";
  setQuickAddNow();
}


function openQuickAddModal() {
  var modal = document.getElementById("quickAddModal");
  if (!modal) return;
  modal.style.display = "block";
  setQuickAddNow();
  updateQuickAddPreview();
  setTimeout(function() {
    var raw = document.getElementById("qaRaw");
    if (raw) raw.focus();
  }, 80);
}


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


/* =========================================================
   v6.1 빠른등록 출처 O열 + 중복등록 방지
   ========================================================= */
function getQuickAddRowValues() {
  var o = getQuickAddObject();
  return [
    o.name, o.address, o.room, o.type,
    o.deposit, o.rent, o.fee, o.premium, o.area,
    o.landlordPhone, o.tenantPhone, o.memo, o.state, o.regDate, o.source
  ];
}

function normalizeQuickDuplicateTextV61(value) {
  return String(value == null ? "" : value).toLowerCase().replace(/\s+/g, "").replace(/대전광역시|대전시/g, "").replace(/[,()\[\]{}]/g, "");
}

function normalizeQuickDuplicateRoomV61(value) {
  return normalizeQuickDuplicateTextV61(value).replace(/호$/, "");
}

function normalizeQuickDuplicateNumberV61(value) {
  return String(value == null ? "" : value).replace(/[,만원원\s]/g, "");
}

function findQuickDuplicateV61(values) {
  var target = {
    name: normalizeQuickDuplicateTextV61(values[0]),
    address: normalizeQuickDuplicateTextV61(values[1]),
    room: normalizeQuickDuplicateRoomV61(values[2]),
    type: normalizeQuickDuplicateTextV61(values[3]),
    deposit: normalizeQuickDuplicateNumberV61(values[4]),
    rent: normalizeQuickDuplicateNumberV61(values[5])
  };
  var similar = null;
  for (var i = 0; i < (allItems || []).length; i++) {
    var item = allItems[i] || {};
    var current = {
      name: normalizeQuickDuplicateTextV61(item.name),
      address: normalizeQuickDuplicateTextV61(item.address),
      room: normalizeQuickDuplicateRoomV61(item.room),
      type: normalizeQuickDuplicateTextV61(item.type),
      deposit: normalizeQuickDuplicateNumberV61(item.deposit),
      rent: normalizeQuickDuplicateNumberV61(item.rent)
    };
    if (!target.address || target.address !== current.address) continue;
    var exactByRoom = target.room && current.room && target.room === current.room && target.type === current.type;
    var exactWithoutRoom = !target.room && !current.room && target.name === current.name && target.deposit === current.deposit && target.rent === current.rent;
    if (exactByRoom || exactWithoutRoom) return { type: "exact", item: item };
    if (!similar) similar = item;
  }
  return similar ? { type: "similar", item: similar } : null;
}

function quickDuplicateSummaryV61(item) {
  if (!item) return "";
  var line1 = [item.address, item.room].filter(Boolean).join(" · ");
  var line2 = "보증금 " + (item.deposit || 0) + " / 월세 " + (item.rent || 0);
  return line1 + "\n" + line2;
}

function requestQuickDuplicateCheckV61(values) {
  return new Promise(function(resolve, reject) {
    if (!saveApiURL) {
      reject(new Error("자동등록 URL이 연결되지 않았습니다."));
      return;
    }

    var callbackName = "__jsQuickDuplicate_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    var script = document.createElement("script");
    var timer = setTimeout(function() {
      cleanup();
      reject(new Error("중복검사 응답 시간이 초과되었습니다."));
    }, 12000);

    function cleanup() {
      clearTimeout(timer);
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = function(response) {
      cleanup();
      resolve(response || {});
    };

    script.onerror = function() {
      cleanup();
      reject(new Error("중복검사 서버에 연결하지 못했습니다."));
    };

    script.src = saveApiURL +
      "?action=checkDuplicate" +
      "&values=" + encodeURIComponent(JSON.stringify(values)) +
      "&callback=" + encodeURIComponent(callbackName) +
      "&_=" + Date.now();

    document.head.appendChild(script);
  });
}

function sendQuickAddRequestV61(values, forceDuplicate, btn, oldText) {
  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "quickAdd",
      values: values,
      forceDuplicate: !!forceDuplicate
    })
  }).then(function() {
    alert("매물 등록 요청을 보냈습니다.\n잠시 후 지도에 반영됩니다.");
    closeQuickAddModal();
    clearQuickAddForm();
    setTimeout(function() { loadSheet(true); }, 1800);
  }).catch(function(err) {
    console.error(err);
    alert("자동등록 요청 중 오류가 발생했습니다.\n연결 URL을 확인해주세요.");
  }).finally(function() {
    if (btn) {
      btn.innerText = oldText;
      btn.disabled = false;
    }
  });
}

function saveQuickAddToSheet() {
  if (!validateQuickAdd()) return;
  if (!saveApiURL) {
    alert("자동등록 URL이 아직 연결되지 않았습니다.");
    return;
  }

  var values = getQuickAddRowValues();
  var btn = document.querySelector(".auto-save-btn");
  var oldText = btn ? btn.innerText : "";

  if (btn) {
    btn.innerText = "중복확인중...";
    btn.disabled = true;
  }

  requestQuickDuplicateCheckV61(values).then(function(response) {
    if (!response || response.ok === false) {
      throw new Error((response && response.message) || "중복검사에 실패했습니다.");
    }

    if (response.duplicateType === "exact") {
      var exactSummary = quickDuplicateSummaryV61(response.existing || {});
      alert("이미 등록된 매물입니다." + (exactSummary ? "\n\n" + exactSummary : ""));
      if (btn) {
        btn.innerText = oldText;
        btn.disabled = false;
      }
      return;
    }

    if (response.duplicateType === "similar") {
      var similarSummary = quickDuplicateSummaryV61(response.existing || {});
      var proceed = confirm(
        "같은 주소의 유사 매물이 있습니다." +
        (similarSummary ? "\n\n기존 매물\n" + similarSummary : "") +
        "\n\n그래도 등록할까요?"
      );

      if (!proceed) {
        if (btn) {
          btn.innerText = oldText;
          btn.disabled = false;
        }
        return;
      }

      if (btn) btn.innerText = "등록중...";
      sendQuickAddRequestV61(values, true, btn, oldText);
      return;
    }

    if (btn) btn.innerText = "등록중...";
    sendQuickAddRequestV61(values, false, btn, oldText);
  }).catch(function(error) {
    console.error(error);
    alert("중복등록 확인 중 오류가 발생했습니다.\n" + (error && error.message ? error.message : error));
    if (btn) {
      btn.innerText = oldText;
      btn.disabled = false;
    }
  });
}
