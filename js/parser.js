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
  var localDuplicate = findQuickDuplicateV61(values);
  if (localDuplicate) {
    var localSummary = quickDuplicateSummaryV61(localDuplicate.item || {});
    alert((localDuplicate.type === "exact" ? "이미 등록된 매물입니다." : "같은 주소의 기존 매물이 있어 등록을 차단했습니다.") + (localSummary ? "\n\n기존 매물\n" + localSummary : ""));
    return;
  }
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

  var addressEl = document.getElementById("qaAddress");
  var address = addressEl
    ? String(addressEl.value || "").trim()
    : "";

  if (!address) {
    box.style.display = "none";
    box.innerHTML = "";
    updateQuickAddPreview();
    return;
  }

  var normalizedAddress =
    typeof normalizeQuickDuplicateAddressV616 === "function"
      ? normalizeQuickDuplicateAddressV616(address)
      : address.replace(/\s+/g, "").toLowerCase();

  /*
   * 경고창은 정확한 중복 차단과 별개입니다.
   * 같은 주소의 기존 매물을 전부 보여줘 사용자가 호실·가격을 직접 비교할 수 있게 합니다.
   */
  var same = (allItems || []).filter(function(item) {
    var itemAddress =
      typeof normalizeQuickDuplicateAddressV616 === "function"
        ? normalizeQuickDuplicateAddressV616(item && item.address)
        : String(item && item.address || "").replace(/\s+/g, "").toLowerCase();

    return Boolean(
      normalizedAddress &&
      itemAddress &&
      normalizedAddress === itemAddress
    );
  });

  if (!same.length) {
    box.style.display = "none";
    box.innerHTML = "";
    updateQuickAddPreview();
    return;
  }

  var maxVisible = 5;
  var visibleItems = same.slice(0, maxVisible);

  var lines = visibleItems.map(function(item, index) {
    var name = escapeHtml(item && item.name || "건물이름 없음");
    var room = escapeHtml(item && item.room || "호실 없음");
    var deposit = escapeHtml(
      item && item.deposit !== undefined && item.deposit !== null && item.deposit !== ""
        ? item.deposit
        : "-"
    );
    var rent = escapeHtml(
      item && item.rent !== undefined && item.rent !== null && item.rent !== ""
        ? item.rent
        : "-"
    );

    return (
      '<div style="margin-top:8px; line-height:1.45;">' +
        '<b>' + (index + 1) + '.</b> ' + name + '<br>' +
        '<span style="padding-left:18px;">' + room + '</span><br>' +
        '<span style="padding-left:18px;">' + deposit + ' / ' + rent + '</span>' +
      '</div>'
    );
  });

  var remainder = same.length - visibleItems.length;

  box.style.display = "block";
  box.innerHTML =
    '<div><b>⚠ 비슷한 주소 ' + same.length + '건 발견</b></div>' +
    lines.join("") +
    (
      remainder > 0
        ? '<div style="margin-top:8px;">...외 ' + remainder + '건</div>'
        : ''
    ) +
    '<div style="margin-top:10px;">중복등록인지 확인 후 진행하세요.</div>';

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
    rent: normalizeQuickDuplicateNumberV61(values[5]),
    area: normalizeQuickDuplicateNumberV61(values[8])
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
      rent: normalizeQuickDuplicateNumberV61(item.rent),
      area: normalizeQuickDuplicateNumberV61(item.area)
    };
    if (!target.address || target.address !== current.address) continue;
    var exactByRoom = target.room && current.room && target.room === current.room;
    var samePriceArea = target.deposit === current.deposit && target.rent === current.rent && target.area === current.area;
    var exactByTermsWithMissingRoom = (!target.room || !current.room) && samePriceArea && target.type === current.type;
    var exactWithoutRoom = !target.room && !current.room && target.name === current.name && target.deposit === current.deposit && target.rent === current.rent;
    if (exactByRoom || exactByTermsWithMissingRoom || exactWithoutRoom) return { type: "exact", item: item };
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
  var localDuplicate = findQuickDuplicateV61(values);
  if (localDuplicate) {
    var localSummary = quickDuplicateSummaryV61(localDuplicate.item || {});
    alert((localDuplicate.type === "exact" ? "이미 등록된 매물입니다." : "같은 주소의 기존 매물이 있어 등록을 차단했습니다.") + (localSummary ? "\n\n기존 매물\n" + localSummary : ""));
    return;
  }
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
      alert(
        "같은 주소의 기존 매물이 있어 등록을 차단했습니다." +
        (similarSummary ? "\n\n기존 매물\n" + similarSummary : "")
      );
      if (btn) {
        btn.innerText = oldText;
        btn.disabled = false;
      }
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


/* =========================================================
   v6.1.2 조조 실사용 한줄 파서 최종 우선 규칙
   형식 예:
   서구 둔산동 2088 상가주택 101호 상가 20평 월500에55
   권1000 임010-... 세010-... @메모
   ========================================================= */
function parseQuickAddText() {
  var rawEl = document.getElementById("qaRaw");
  if (!rawEl) return;

  var raw = String(rawEl.value || "").trim();
  if (!raw) {
    alert("외부 매물 내용을 먼저 붙여넣어 주세요.");
    return;
  }

  setQuickAddNow();
  detectSourceFromRaw(raw);

  /* @ 뒤는 다른 항목으로 분석하지 않고 메모로만 사용 */
  var atIndex = raw.indexOf("@");
  var dataText = atIndex >= 0 ? raw.slice(0, atIndex) : raw;
  var atMemo = atIndex >= 0 ? raw.slice(atIndex + 1).trim() : "";
  var compact = dataText.replace(/\s+/g, " ").trim();
  var lines = dataText.split(/\n+/).map(function(v) { return v.trim(); }).filter(Boolean);

  var addressPatterns = [
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)/
  ];

  var address = "";
  var addressEnd = -1;
  for (var ai = 0; ai < addressPatterns.length; ai++) {
    var am = compact.match(addressPatterns[ai]);
    if (am && am[1]) {
      address = am[1].replace(/\s+/g, " ").trim();
      addressEnd = (am.index || 0) + am[0].length;
      break;
    }
  }

  /* 호실: B101/B01/B1, 101호, 1층 모두 지원 */
  var roomRegex = /((?:[Bb]\s*\d{1,4}|(?:지하|지)\s*\d{1,2}(?:층)?|-\d{1,2}(?:층)?|\d{1,4}\s*호|\d{1,2}\s*층))/;
  var roomSearchText = addressEnd >= 0 ? compact.slice(addressEnd).trim() : compact;
  var roomMatch = roomSearchText.match(roomRegex);
  var room = roomMatch ? roomMatch[1].replace(/\s+/g, "") : "";

  /* 실제 사용 순서에서 주소와 호실 사이 문자열을 건물이름으로 우선 인식 */
  var title = "";
  if (addressEnd >= 0 && roomMatch && typeof roomMatch.index === "number") {
    title = roomSearchText.slice(0, roomMatch.index).trim();
  }
  if (!title) title = pickTitleLine(lines);
  title = String(title || "")
    .replace(/^(?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)?\s*[가-힣0-9]+동\s*\d+(?:-\d+)?\s*/, "")
    .trim();

  /* 호실 뒤부터 평수 앞까지를 구분으로 우선 인식 */
  var type = "";
  if (roomMatch) {
    var afterRoom = roomSearchText.slice((roomMatch.index || 0) + roomMatch[0].length).trim();
    var beforeArea = afterRoom.split(/\d+(?:\.\d+)?\s*(?:평|py|PY)/i)[0].trim();
    var typeToken = beforeArea.match(/^(상가|사무실|오피스|점포|창고|주택|아파트|원룸|투룸|다가구|상가주택|매매|전세|월세|임대)/);
    if (typeToken) type = typeToken[1];
  }
  if (!type) {
    if (/사무실|오피스|업무/.test(compact)) type = "사무실";
    else if (/상가|점포|가게|권리|무권/.test(compact)) type = "상가";
    else if (/매매/.test(compact)) type = "매매";
    else if (/전세/.test(compact)) type = "전세";
    else if (/월세|임대/.test(compact)) type = "월세";
  }

  /* 조조식 월500에55 / 월500/55 */
  var monthlyPair = compact.match(/(?:^|\s)월\s*([0-9,.]+)\s*(?:에|\/|\-)\s*([0-9,.]+)(?=\s|$)/);
  var deposit = monthlyPair ? normalizeKoreanNumber(monthlyPair[1]) : moneyValueFromLabel(compact, "보증금|보");
  if (!deposit) deposit = slashPriceValue(compact, 1);

  var rent = monthlyPair ? normalizeKoreanNumber(monthlyPair[2]) : moneyValueFromLabel(compact, "월세|월");
  if (!rent) rent = slashPriceValue(compact, 2);

  var fee = "";
  if (/관리비\s*(없음|무|무료|0원|0만원|0만)|관\s*(없음|무|무료)/.test(compact)) fee = "0";
  else fee = moneyValueFromLabel(compact, "관리비|관리|관");

  var premium = "";
  if (/무권|무권리|권무|권리금\s*(없음|무|0원|0만원|0만)|권\s*(없음|무|0원|0만원|0만)/.test(compact)) {
    premium = "0";
  } else if (!/권리금\s*협의|권리\s*협의|권\s*협의/.test(compact)) {
    premium = moneyValueFromLabel(compact, "권리금|권리|권");
  }

  var areaMatch = compact.match(/(?:약\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:평|py|PY)/i);

  /* 임/세 라벨 전화번호를 우선 분리 */
  var phonePattern = "(01[016789][\\-\\s\\.]?[0-9]{3,4}[\\-\\s\\.]?[0-9]{4})";
  var landlordMatch = compact.match(new RegExp("(?:임대인|임)\\s*[:：]?\\s*" + phonePattern, "i"));
  var tenantMatch = compact.match(new RegExp("(?:세입자|세)\\s*[:：]?\\s*" + phonePattern, "i"));
  var phones = compact.match(/01[016789][\-\s\.]?[0-9]{3,4}[\-\s\.]?[0-9]{4}/g) || [];
  var landlordPhone = landlordMatch ? landlordMatch[1] : (phones[0] || "");
  var tenantPhone = tenantMatch ? tenantMatch[1] : (phones[1] || "");

  setFieldValue("qaAddress", address, true);
  setFieldValue("qaName", title, true);
  setFieldValue("qaRoom", room, true);
  setFieldValue("qaType", type || "상가", true);
  setFieldValue("qaDeposit", deposit, true);
  setFieldValue("qaRent", rent, true);
  setFieldValue("qaFee", fee, true);
  setFieldValue("qaPremium", premium, true);
  setFieldValue("qaArea", areaMatch ? areaMatch[1] : "", true);
  setFieldValue("qaLandlordPhone", landlordPhone ? normalizePhone(landlordPhone.replace(/\./g, "-")) : "", true);
  setFieldValue("qaTenantPhone", tenantPhone ? normalizePhone(tenantPhone.replace(/\./g, "-")) : "", true);

  var memoEl = document.getElementById("qaMemo");
  if (memoEl) {
    if (atIndex >= 0) {
      memoEl.value = atMemo;
    } else if (!memoEl.value) {
      /* 출처는 O열에 저장하므로 메모 앞에 출처를 붙이지 않음 */
      memoEl.value = String(dataText || "")
        .replace(/\r/g, "")
        .split(/\n+/)
        .map(function(v) { return v.trim(); })
        .filter(Boolean)
        .join(" / ")
        .replace(/\s+/g, " ")
        .slice(0, 320);
    }
  }

  updateQuickAddWarning();
  updateQuickAddPreview();
}


/* =========================================================
   v6.1.6 빠른등록 최종 보정
   - 주소 저장 시 대한민국/대전광역시/대전시/대전 접두어 제거
   - 주소 공백 차이를 무시하여 중복 비교
   - 같은 주소 + 같은 호실만 중복
   - 같은 주소 + 다른 호실은 등록 허용
   - 양쪽 모두 호실 공란이면 주소+보증금+월세+평수 동일 시 중복
   - Apps Script 수정 없이 브라우저에서 차단
   ========================================================= */

var quickAddPendingFingerprintsV616 = {};

function sanitizeQuickAddressV616(value) {
  var text = String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();

  /* 주소 맨 앞의 지역명만 제거합니다. 구 이름은 유지합니다. */
  var previous = "";
  while (text && previous !== text) {
    previous = text;
    text = text
      .replace(/^대한민국\s*/i, "")
      .replace(/^(?:대전광역시|대전시|대전)\s*/i, "")
      .trim();
  }

  return text;
}

function normalizeQuickDuplicateAddressV616(value) {
  return sanitizeQuickAddressV616(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[,.·ㆍ:;'"`()\[\]{}]/g, "");
}

function normalizeQuickDuplicateRoomV616(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/호$/, "")
    .replace(/^지하0*(\d+)$/, "b$1")
    .replace(/^지0*(\d+)$/, "b$1")
    .replace(/^-0*(\d+)$/, "b$1")
    .replace(/^b0*(\d+)$/, "b$1");
}

function normalizeQuickDuplicateNumberV616(value) {
  var text = String(value == null ? "" : value)
    .replace(/,/g, "")
    .replace(/만원|만|원|평|㎡|m²/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!text) return "";

  var number = Number(text);
  if (Number.isFinite(number)) {
    return String(number);
  }

  return text;
}

function getQuickDuplicateComparableV616(values) {
  return {
    address: normalizeQuickDuplicateAddressV616(values[1]),
    room: normalizeQuickDuplicateRoomV616(values[2]),
    deposit: normalizeQuickDuplicateNumberV616(values[4]),
    rent: normalizeQuickDuplicateNumberV616(values[5]),
    area: normalizeQuickDuplicateNumberV616(values[8])
  };
}

function findQuickDuplicateV61(values) {
  var target = getQuickDuplicateComparableV616(values);

  if (!target.address) return null;

  for (var i = 0; i < (allItems || []).length; i++) {
    var item = allItems[i] || {};
    var current = {
      address: normalizeQuickDuplicateAddressV616(item.address),
      room: normalizeQuickDuplicateRoomV616(item.room),
      deposit: normalizeQuickDuplicateNumberV616(item.deposit),
      rent: normalizeQuickDuplicateNumberV616(item.rent),
      area: normalizeQuickDuplicateNumberV616(item.area)
    };

    if (!current.address || target.address !== current.address) {
      continue;
    }

    var targetHasRoom = Boolean(target.room);
    var currentHasRoom = Boolean(current.room);

    /* 양쪽 모두 호실이 있으면 같은 호실일 때만 중복 */
    if (targetHasRoom && currentHasRoom) {
      if (target.room === current.room) {
        return { type: "exact", item: item };
      }
      continue;
    }

    /* 양쪽 모두 호실이 없을 때만 임대조건으로 중복 판정 */
    if (!targetHasRoom && !currentHasRoom) {
      if (
        target.deposit === current.deposit &&
        target.rent === current.rent &&
        target.area === current.area
      ) {
        return { type: "exact", item: item };
      }
    }

    /* 한쪽만 호실이 있으면 별도 매물 가능성이 있으므로 허용 */
  }

  return null;
}

function quickAddFingerprintV616(values) {
  var target = getQuickDuplicateComparableV616(values);

  if (target.room) {
    return target.address + "|room|" + target.room;
  }

  return [
    target.address,
    "terms",
    target.deposit,
    target.rent,
    target.area
  ].join("|");
}

/*
 * 최종 저장 직전에 주소 입력칸에서도 대전 접두어를 제거합니다.
 * 파서로 추출한 주소뿐 아니라 사용자가 직접 입력한 주소에도 적용됩니다.
 */
function normalizeQuickAddAddressFieldV616() {
  var addressEl = document.getElementById("qaAddress");
  if (!addressEl) return "";

  var cleaned = sanitizeQuickAddressV616(addressEl.value);
  addressEl.value = cleaned;
  return cleaned;
}

/*
 * Apps Script 중복검사 API는 수정하지 않습니다.
 * 현재 화면의 전체 매물(allItems) + 전송 대기 지문으로 빠른등록만 차단합니다.
 * 공실박스 추출 경로는 변경하지 않습니다.
 */
function saveQuickAddToSheet() {
  normalizeQuickAddAddressFieldV616();

  if (!validateQuickAdd()) return;

  if (!saveApiURL) {
    alert("자동등록 URL이 아직 연결되지 않았습니다.");
    return;
  }

  var values = getQuickAddRowValues();

  /* 행 배열에도 정리된 주소를 확실히 반영 */
  values[1] = sanitizeQuickAddressV616(values[1]);

  var localDuplicate = findQuickDuplicateV61(values);

  if (localDuplicate) {
    var summary = quickDuplicateSummaryV61(localDuplicate.item || {});
    alert(
      "이미 등록된 매물입니다.\n\n" +
      "주소·호실·보증금·월세가 모두 동일합니다." +
      (summary ? "\n\n기존 매물\n" + summary : "")
    );
    return;
  }

  var fingerprint = quickAddFingerprintV616(values);

  if (quickAddPendingFingerprintsV616[fingerprint]) {
    alert("이미 등록 요청 중인 매물입니다.\n잠시 후 다시 확인해주세요.");
    return;
  }

  quickAddPendingFingerprintsV616[fingerprint] = true;

  var btn = document.querySelector(".auto-save-btn");
  var oldText = btn ? btn.innerText : "";

  if (btn) {
    btn.innerText = "등록중...";
    btn.disabled = true;
  }

  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action: "quickAdd",
      values: values,
      forceDuplicate: false
    })
  }).then(function() {
    alert(
      "매물 등록 요청을 보냈습니다.\n" +
      "다음 매물을 계속 붙여넣을 수 있습니다."
    );

    /*
     * 연속 등록을 위해 빠른등록창은 닫지 않습니다.
     * 입력값만 비우고 붙여넣기 칸으로 포커스를 돌립니다.
     * 창은 사용자가 '닫기' 버튼 또는 ESC를 눌렀을 때만 닫힙니다.
     */
    clearQuickAddForm();

    var modal = document.getElementById("quickAddModal");
    var raw = document.getElementById("qaRaw");

    if (modal) {
      modal.style.display = "block";
    }

    setTimeout(function() {
      if (raw) raw.focus();
    }, 80);

    setTimeout(function() {
      loadSheet(true);
    }, 1800);
  }).catch(function(error) {
    console.error(error);
    delete quickAddPendingFingerprintsV616[fingerprint];
    alert("자동등록 요청 중 오류가 발생했습니다.\n연결 URL을 확인해주세요.");
  }).finally(function() {
    /*
     * 시트 반영 시간을 고려해 잠시 유지한 뒤 해제합니다.
     * 빠르게 등록 버튼을 연속 누르는 중복도 막습니다.
     */
    setTimeout(function() {
      delete quickAddPendingFingerprintsV616[fingerprint];
    }, 8000);

    if (btn) {
      btn.innerText = oldText;
      btn.disabled = false;
    }
  });
}

/*
 * 기존 최종 한 줄 파서를 감싼 후 주소만 정리합니다.
 * 기존 파싱 기능은 그대로 유지합니다.
 */
(function() {
  var originalParseQuickAddTextV616 = parseQuickAddText;

  parseQuickAddText = function() {
    originalParseQuickAddTextV616.apply(this, arguments);
    normalizeQuickAddAddressFieldV616();

    if (typeof updateQuickAddWarning === "function") {
      updateQuickAddWarning();
    }

    if (typeof updateQuickAddPreview === "function") {
      updateQuickAddPreview();
    }
  };
})();


/* =========================================================
   v6.2.6 빠른등록 중복 기준 + 출처별 임장가자 최종 보정

   중복 기준:
   - 호실 있음: 주소 + 호실 + 보증금 + 월세 모두 동일할 때만 중복
   - 양쪽 호실 없음: 주소 + 보증금 + 월세 모두 동일할 때만 중복
   - 서로 다른 호실: 별도 매물
   - 보증금 또는 월세가 다름: 별도 매물
   - 평수: 중복 판정에서 제외

   임장가자:
   - 공실박스 / 네이버 / 당근 출처는 메모에 (임장가자) 자동 추가
   - 이미 있으면 중복 추가하지 않음
   ========================================================= */

function isFieldVisitQuickAddSourceV626(source) {
  return /^(?:공실박스|네이버|당근)$/i.test(
    String(source || "").trim()
  );
}


function ensureQuickAddFieldVisitMemoV626() {
  var sourceEl = document.getElementById("qaSource");
  var memoEl = document.getElementById("qaMemo");

  if (!sourceEl || !memoEl) return;

  var source = String(sourceEl.value || "").trim();

  if (!isFieldVisitQuickAddSourceV626(source)) {
    return;
  }

  var memo = String(memoEl.value || "").trim();

  if (/\(\s*임장가자\s*\)/i.test(memo)) {
    return;
  }

  memoEl.value = memo
    ? "(임장가자) / " + memo
    : "(임장가자)";
}


function getQuickDuplicateComparableV616(values) {
  return {
    address: normalizeQuickDuplicateAddressV616(values[1]),
    room: normalizeQuickDuplicateRoomV616(values[2]),
    deposit: normalizeQuickDuplicateNumberV616(values[4]),
    rent: normalizeQuickDuplicateNumberV616(values[5])
  };
}


function findQuickDuplicateV61(values) {
  var target = getQuickDuplicateComparableV616(values);

  if (!target.address) return null;

  for (var i = 0; i < (allItems || []).length; i++) {
    var item = allItems[i] || {};

    var current = {
      address: normalizeQuickDuplicateAddressV616(item.address),
      room: normalizeQuickDuplicateRoomV616(item.room),
      deposit: normalizeQuickDuplicateNumberV616(item.deposit),
      rent: normalizeQuickDuplicateNumberV616(item.rent)
    };

    if (
      !current.address ||
      target.address !== current.address
    ) {
      continue;
    }

    var targetHasRoom = Boolean(target.room);
    var currentHasRoom = Boolean(current.room);

    /*
     * 양쪽 모두 호실이 있는 경우:
     * 주소·호실·보증금·월세가 전부 같을 때만 중복입니다.
     */
    if (targetHasRoom && currentHasRoom) {
      if (
        target.room === current.room &&
        target.deposit === current.deposit &&
        target.rent === current.rent
      ) {
        return {
          type: "exact",
          item: item
        };
      }

      continue;
    }

    /*
     * 양쪽 모두 호실이 없는 경우:
     * 주소·보증금·월세가 전부 같을 때만 중복입니다.
     */
    if (!targetHasRoom && !currentHasRoom) {
      if (
        target.deposit === current.deposit &&
        target.rent === current.rent
      ) {
        return {
          type: "exact",
          item: item
        };
      }
    }

    /*
     * 한쪽만 호실이 있으면 별도 매물로 허용합니다.
     */
  }

  return null;
}


function quickAddFingerprintV616(values) {
  var target = getQuickDuplicateComparableV616(values);

  return [
    target.address,
    target.room ? "room:" + target.room : "no-room",
    "deposit:" + target.deposit,
    "rent:" + target.rent
  ].join("|");
}


/*
 * 저장 직전에도 출처를 다시 확인하여 (임장가자)를 보장합니다.
 */
(function() {
  var previousSaveQuickAddToSheetV626 = saveQuickAddToSheet;

  saveQuickAddToSheet = function() {
    ensureQuickAddFieldVisitMemoV626();

    if (typeof updateQuickAddWarning === "function") {
      updateQuickAddWarning();
    }

    if (typeof updateQuickAddPreview === "function") {
      updateQuickAddPreview();
    }

    return previousSaveQuickAddToSheetV626.apply(this, arguments);
  };
})();


/*
 * AI 분석 직후에도 메모에 즉시 표시되도록 보정합니다.
 */
(function() {
  var previousParseQuickAddTextV626 = parseQuickAddText;

  parseQuickAddText = function() {
    var result = previousParseQuickAddTextV626.apply(this, arguments);

    ensureQuickAddFieldVisitMemoV626();

    if (typeof updateQuickAddWarning === "function") {
      updateQuickAddWarning();
    }

    if (typeof updateQuickAddPreview === "function") {
      updateQuickAddPreview();
    }

    return result;
  };
})();

/* =========================================================
   v6.3.5.1 빠른등록 중복매물 비교 UI
   - 최대 6건 표시
   - 번호 / 구분·호실 / 임대조건 / 평수만 표시
   - 전화번호 / 상태 / 등록일 / 주소 제외
   - 홀수 연한 파랑, 짝수 연한 녹색 교차 카드
   ========================================================= */
function formatQuickDuplicateNumberV6351(value) {
  var text = String(value == null ? "" : value).replace(/,/g, "").trim();
  if (text === "") return "-";

  var number = Number(text);
  if (!Number.isFinite(number)) return escapeHtml(text);

  return number.toLocaleString("ko-KR", {
    maximumFractionDigits: 1
  });
}

function updateQuickAddWarning() {
  var box = document.getElementById("quickAddWarning");
  if (!box) return;

  var addressEl = document.getElementById("qaAddress");
  var address = addressEl ? String(addressEl.value || "").trim() : "";

  if (!address) {
    box.style.display = "none";
    box.innerHTML = "";
    updateQuickAddPreview();
    return;
  }

  var normalizedAddress =
    typeof normalizeQuickDuplicateAddressV616 === "function"
      ? normalizeQuickDuplicateAddressV616(address)
      : address.replace(/\s+/g, "").toLowerCase();

  var same = (allItems || []).filter(function(item) {
    var itemAddress =
      typeof normalizeQuickDuplicateAddressV616 === "function"
        ? normalizeQuickDuplicateAddressV616(item && item.address)
        : String((item && item.address) || "").replace(/\s+/g, "").toLowerCase();

    return Boolean(
      normalizedAddress &&
      itemAddress &&
      normalizedAddress === itemAddress
    );
  });

  if (!same.length) {
    box.style.display = "none";
    box.innerHTML = "";
    updateQuickAddPreview();
    return;
  }

  var maxVisible = 6;
  var visibleItems = same.slice(0, maxVisible);

  var rows = visibleItems.map(function(item, index) {
    var type = escapeHtml((item && item.type) || (item && item.name) || "구분 없음");
    var room = escapeHtml((item && item.room) || "호실 없음");
    var area = formatQuickDuplicateNumberV6351(item && item.area);

    var condition = [
      "보 " + formatQuickDuplicateNumberV6351(item && item.deposit),
      "월 " + formatQuickDuplicateNumberV6351(item && item.rent),
      "관 " + formatQuickDuplicateNumberV6351(item && item.fee),
      "권 " + formatQuickDuplicateNumberV6351(item && item.premium)
    ].join(" / ");

    var toneClass = index % 2 === 0
      ? " quick-duplicate-row-blue-v6351"
      : " quick-duplicate-row-green-v6351";

    return (
      '<div class="quick-duplicate-row-v6351' + toneClass + '">' +
        '<div class="quick-duplicate-no-v6351">' + (index + 1) + '</div>' +
        '<div class="quick-duplicate-type-v6351">' +
          '<strong>' + type + '</strong>' +
          '<span>' + room + '</span>' +
        '</div>' +
        '<div class="quick-duplicate-condition-v6351">' + condition + '</div>' +
        '<div class="quick-duplicate-area-v6351">' + area + '평</div>' +
      '</div>'
    );
  });

  var remainder = same.length - visibleItems.length;

  box.style.display = "block";
  box.innerHTML =
    '<div class="quick-duplicate-head-v6351">' +
      '<strong>⚠ 비슷한 주소 ' + same.length + '건 발견</strong>' +
      '<span>구분·호실과 임대조건을 비교하세요.</span>' +
    '</div>' +
    '<div class="quick-duplicate-list-v6351">' + rows.join("") + '</div>' +
    (
      remainder > 0
        ? '<div class="quick-duplicate-more-v6351">외 ' + remainder + '건이 더 있습니다.</div>'
        : ''
    ) +
    '<div class="quick-duplicate-foot-v6351">중복등록인지 확인 후 진행하세요.</div>';

  updateQuickAddPreview();
}

/* =========================================================
   v6.3.6 빠른등록 중복판정 / 압축목록 / 즉시 안내

   중복 기준
   - 주소 + 호실 + 보증금 + 월세 + 평수 동일: 완전 중복 차단
   - 주소 + 호실 + 보증금 + 월세 동일, 평수 다름: 사용자 확인 후 등록
   - 같은 주소이지만 호실 또는 임대조건 다름: 참고 목록만 표시

   등록 UX
   - Apps Script 응답을 기다리지 않고 요청 직후 토스트 표시
   - 기존 확인형 성공 alert 제거
   ========================================================= */
function normalizeQuickDuplicateAreaV636(value) {
  var text = String(value == null ? "" : value)
    .replace(/,/g, "")
    .replace(/평(?:방미터|방미터제곱)?|㎡|m2|m²/gi, "")
    .trim();

  if (!text) return "";

  var number = Number(text);
  if (!Number.isFinite(number)) {
    return text.toLowerCase().replace(/\s+/g, "");
  }

  /* 빠른등록 데이터에서 공란이 0으로 읽히는 경우를 공란으로 통일 */
  if (Math.abs(number) < 0.000001) return "";

  return String(Math.round(number * 1000) / 1000);
}

function getQuickDuplicateComparableV636(values) {
  return {
    address: normalizeQuickDuplicateAddressV616(values[1]),
    room: normalizeQuickDuplicateRoomV616(values[2]),
    deposit: normalizeQuickDuplicateNumberV616(values[4]),
    rent: normalizeQuickDuplicateNumberV616(values[5]),
    area: normalizeQuickDuplicateAreaV636(values[8])
  };
}

function isSameQuickDuplicateUnitV636(target, current) {
  var targetHasRoom = Boolean(target.room);
  var currentHasRoom = Boolean(current.room);

  if (targetHasRoom && currentHasRoom) {
    return (
      target.room === current.room &&
      target.deposit === current.deposit &&
      target.rent === current.rent
    );
  }

  if (!targetHasRoom && !currentHasRoom) {
    return (
      target.deposit === current.deposit &&
      target.rent === current.rent
    );
  }

  /* 한쪽만 호실이 있으면 별도 매물 */
  return false;
}

/*
 * 마지막 선언이 기존 중복 함수를 대체합니다.
 * 완전 중복을 우선 탐색하고, 없을 때만 평수 차이 매물을 반환합니다.
 */
function findQuickDuplicateV61(values) {
  var target = getQuickDuplicateComparableV636(values);
  var areaMismatch = null;

  if (!target.address) return null;

  for (var i = 0; i < (allItems || []).length; i++) {
    var item = allItems[i] || {};
    var current = {
      address: normalizeQuickDuplicateAddressV616(item.address),
      room: normalizeQuickDuplicateRoomV616(item.room),
      deposit: normalizeQuickDuplicateNumberV616(item.deposit),
      rent: normalizeQuickDuplicateNumberV616(item.rent),
      area: normalizeQuickDuplicateAreaV636(item.area)
    };

    if (!current.address || target.address !== current.address) continue;
    if (!isSameQuickDuplicateUnitV636(target, current)) continue;

    if (target.area === current.area) {
      return {
        type: "exact",
        item: item
      };
    }

    if (!areaMismatch) {
      areaMismatch = {
        type: "areaMismatch",
        item: item
      };
    }
  }

  return areaMismatch;
}

function quickAddFingerprintV616(values) {
  var target = getQuickDuplicateComparableV636(values);

  return [
    target.address,
    target.room ? "room:" + target.room : "no-room",
    "deposit:" + target.deposit,
    "rent:" + target.rent,
    "area:" + (target.area || "blank")
  ].join("|");
}

function formatQuickAreaV636(value) {
  var normalized = normalizeQuickDuplicateAreaV636(value);
  if (!normalized) return "-";

  var number = Number(normalized);
  if (!Number.isFinite(number)) return normalized;

  return number.toLocaleString("ko-KR", {
    maximumFractionDigits: 3
  });
}

function ensureQuickAreaConfirmV636() {
  var modal = document.getElementById("quickAreaConfirmV636");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "quickAreaConfirmV636";
  modal.className = "quick-area-confirm-v636";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML =
    '<div class="quick-area-confirm-backdrop-v636"></div>' +
    '<div class="quick-area-confirm-dialog-v636" role="dialog" aria-modal="true" aria-labelledby="quickAreaConfirmTitleV636">' +
      '<div class="quick-area-confirm-icon-v636">!</div>' +
      '<div id="quickAreaConfirmTitleV636" class="quick-area-confirm-title-v636">평수가 다른 기존 매물이 있습니다</div>' +
      '<div class="quick-area-confirm-desc-v636">주소·호실·보증금·월세는 같지만 평수가 다릅니다.</div>' +
      '<div class="quick-area-confirm-compare-v636">' +
        '<div><span>기존 매물</span><strong id="quickAreaExistingV636">-</strong></div>' +
        '<div><span>등록 매물</span><strong id="quickAreaNewV636">-</strong></div>' +
      '</div>' +
      '<div class="quick-area-confirm-note-v636">다른 호실·분할상가·평수 변경 매물인지 확인한 뒤 진행하세요.</div>' +
      '<div class="quick-area-confirm-actions-v636">' +
        '<button type="button" class="quick-area-cancel-v636">취소</button>' +
        '<button type="button" class="quick-area-continue-v636">평수 다름 · 그래도 등록</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  return modal;
}

function confirmQuickAreaDifferenceV636(existingItem, values) {
  return new Promise(function(resolve) {
    var modal = ensureQuickAreaConfirmV636();
    var existing = modal.querySelector("#quickAreaExistingV636");
    var incoming = modal.querySelector("#quickAreaNewV636");
    var cancelBtn = modal.querySelector(".quick-area-cancel-v636");
    var continueBtn = modal.querySelector(".quick-area-continue-v636");
    var backdrop = modal.querySelector(".quick-area-confirm-backdrop-v636");
    var settled = false;

    if (existing) existing.textContent = formatQuickAreaV636(existingItem && existingItem.area) + "평";
    if (incoming) incoming.textContent = formatQuickAreaV636(values && values[8]) + "평";

    function finish(result) {
      if (settled) return;
      settled = true;
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }

    function onKeydown(event) {
      if (event.key === "Escape") finish(false);
    }

    cancelBtn.onclick = function() { finish(false); };
    continueBtn.onclick = function() { finish(true); };
    backdrop.onclick = function() { finish(false); };

    document.addEventListener("keydown", onKeydown);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    setTimeout(function() {
      if (continueBtn) continueBtn.focus();
    }, 30);
  });
}

function showQuickAddToastV636(message, type) {
  var toast = document.getElementById("quickAddToastV636");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "quickAddToastV636";
    toast.className = "quick-add-toast-v636";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  clearTimeout(toast.__hideTimerV636);
  toast.className = "quick-add-toast-v636 " + (type || "success");
  toast.textContent = message;

  requestAnimationFrame(function() {
    toast.classList.add("show");
  });

  toast.__hideTimerV636 = setTimeout(function() {
    toast.classList.remove("show");
  }, type === "error" ? 3800 : 2400);
}

function focusQuickAddRawV636() {
  var modal = document.getElementById("quickAddModal");
  var raw = document.getElementById("qaRaw");

  if (modal) modal.style.display = "block";

  setTimeout(function() {
    if (raw) raw.focus();
  }, 60);
}

function submitQuickAddRequestV636(values, forceDuplicate, fingerprint, btn, oldText) {
  /*
   * 사용자에게는 요청을 시작한 즉시 알려줍니다.
   * Apps Script의 실제 처리는 백그라운드에서 계속됩니다.
   */
  showQuickAddToastV636(
    "매물 등록 요청을 보냈습니다. 다음 매물을 계속 등록할 수 있습니다.",
    "success"
  );

  clearQuickAddForm();
  focusQuickAddRawV636();

  if (btn) {
    setTimeout(function() {
      btn.innerText = oldText;
      btn.disabled = false;
    }, 180);
  }

  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action: "quickAdd",
      values: values,
      forceDuplicate: !!forceDuplicate
    })
  }).then(function() {
    /* 서버 처리가 끝난 뒤 지도만 조용히 갱신 */
    setTimeout(function() {
      loadSheet(true);
    }, 500);
  }).catch(function(error) {
    console.error(error);
    delete quickAddPendingFingerprintsV616[fingerprint];
    showQuickAddToastV636(
      "자동등록 요청 중 오류가 발생했습니다. 연결 URL을 확인해주세요.",
      "error"
    );
  }).finally(function() {
    setTimeout(function() {
      delete quickAddPendingFingerprintsV616[fingerprint];
    }, 8000);
  });
}

function continueQuickAddSubmissionV636(values, forceDuplicate) {
  var fingerprint = quickAddFingerprintV616(values);

  if (quickAddPendingFingerprintsV616[fingerprint]) {
    alert("이미 등록 요청 중인 매물입니다.\n잠시 후 다시 확인해주세요.");
    return;
  }

  quickAddPendingFingerprintsV616[fingerprint] = true;

  var btn = document.querySelector(".auto-save-btn");
  var oldText = btn ? btn.innerText : "";

  if (btn) {
    btn.innerText = "요청중...";
    btn.disabled = true;
  }

  submitQuickAddRequestV636(
    values,
    forceDuplicate,
    fingerprint,
    btn,
    oldText
  );
}

/* 마지막 선언으로 기존 저장 함수를 대체 */
function saveQuickAddToSheet() {
  ensureQuickAddFieldVisitMemoV626();
  normalizeQuickAddAddressFieldV616();

  if (!validateQuickAdd()) return;

  if (!saveApiURL) {
    alert("자동등록 URL이 아직 연결되지 않았습니다.");
    return;
  }

  var values = getQuickAddRowValues();
  values[1] = sanitizeQuickAddressV616(values[1]);

  var localDuplicate = findQuickDuplicateV61(values);

  if (localDuplicate && localDuplicate.type === "exact") {
    var exactSummary = quickDuplicateSummaryV61(localDuplicate.item || {});
    alert(
      "이미 등록된 매물입니다.\n\n" +
      "주소·호실·보증금·월세·평수가 모두 동일합니다." +
      (exactSummary ? "\n\n기존 매물\n" + exactSummary : "")
    );
    return;
  }

  if (localDuplicate && localDuplicate.type === "areaMismatch") {
    confirmQuickAreaDifferenceV636(localDuplicate.item || {}, values)
      .then(function(approved) {
        if (!approved) return;
        continueQuickAddSubmissionV636(values, true);
      });
    return;
  }

  continueQuickAddSubmissionV636(values, false);
}

/* 중복매물 비교표: 평수를 임대조건 끝에 합치고 높이를 압축 */
function updateQuickAddWarning() {
  var box = document.getElementById("quickAddWarning");
  if (!box) return;

  var addressEl = document.getElementById("qaAddress");
  var address = addressEl ? String(addressEl.value || "").trim() : "";

  if (!address) {
    box.style.display = "none";
    box.innerHTML = "";
    updateQuickAddPreview();
    return;
  }

  var normalizedAddress =
    typeof normalizeQuickDuplicateAddressV616 === "function"
      ? normalizeQuickDuplicateAddressV616(address)
      : address.replace(/\s+/g, "").toLowerCase();

  var same = (allItems || []).filter(function(item) {
    var itemAddress =
      typeof normalizeQuickDuplicateAddressV616 === "function"
        ? normalizeQuickDuplicateAddressV616(item && item.address)
        : String((item && item.address) || "").replace(/\s+/g, "").toLowerCase();

    return Boolean(
      normalizedAddress &&
      itemAddress &&
      normalizedAddress === itemAddress
    );
  });

  if (!same.length) {
    box.style.display = "none";
    box.innerHTML = "";
    updateQuickAddPreview();
    return;
  }

  /*
   * v6.3.6.2: 같은 주소의 중복 후보를 개수 제한 없이 전부 표시합니다.
   * 목록 자체가 빠른등록 창 안에서 스크롤되므로 매물이 많아도 확인할 수 있습니다.
   */
  var visibleItems = same.slice();

  var rows = visibleItems.map(function(item, index) {
    var type = escapeHtml((item && item.type) || (item && item.name) || "구분 없음");
    var room = escapeHtml((item && item.room) || "호실 없음");
    var area = escapeHtml(formatQuickAreaV636(item && item.area));

    var condition = [
      "보 " + formatQuickDuplicateNumberV6351(item && item.deposit),
      "월 " + formatQuickDuplicateNumberV6351(item && item.rent),
      "관 " + formatQuickDuplicateNumberV6351(item && item.fee),
      "권 " + formatQuickDuplicateNumberV6351(item && item.premium),
      "평 " + area
    ].join(" / ");

    var toneClass = index % 2 === 0
      ? " quick-duplicate-row-blue-v6351"
      : " quick-duplicate-row-green-v6351";

    return (
      '<div class="quick-duplicate-row-v6351' + toneClass + '">' +
        '<div class="quick-duplicate-no-v6351">' + (index + 1) + '</div>' +
        '<div class="quick-duplicate-type-v6351">' +
          '<strong>' + type + ' <span>· ' + room + '</span></strong>' +
        '</div>' +
        '<div class="quick-duplicate-condition-v6351">' + condition + '</div>' +
      '</div>'
    );
  });

  box.style.display = "block";
  box.innerHTML =
    '<div class="quick-duplicate-head-v6351">' +
      '<strong>⚠ 비슷한 주소 ' + same.length + '건 발견</strong>' +
      '<span>구분·호실·임대조건·평수를 비교하세요.</span>' +
    '</div>' +
    '<div class="quick-duplicate-list-v6351">' + rows.join("") + '</div>' +
    '<div class="quick-duplicate-foot-v6351">완전 중복은 차단되며, 평수만 다르면 확인 후 등록할 수 있습니다.</div>';

  updateQuickAddPreview();
}

