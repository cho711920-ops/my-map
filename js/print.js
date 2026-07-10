/* JS부동산 인쇄/PDF 리포트 전용 스크립트 */
function printSelectedList() {
  var printItems = getSelectedPrintItems();

  if (!printItems || printItems.length === 0) {
    alert("인쇄할 매물을 체크해주세요.");
    return;
  }

  function shortText(text, maxLen) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
  }

  var html = `
  <!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8">
  <title>JS부동산 선택 매물 리스트</title>

  <style>
  * { box-sizing:border-box; }

  body {
    font-family:Arial, sans-serif;
    margin:0;
    padding:10px;
    color:#222;
    background:white;
  }

  h1 {
    font-size:18px;
    margin:0 0 3px 0;
  }

  .summary {
    font-size:11px;
    color:#555;
    margin-bottom:7px;
    padding-bottom:6px;
    border-bottom:2px solid #222;
  }

  .print-grid {
    display:grid;
    grid-template-columns:repeat(2, minmax(0, 1fr));
    gap:5px 6px;
    width:100%;
  }

  .print-item {
    border:1px solid #d7dce3;
    border-radius:6px;
    padding:5px 7px;
    margin:0;
    page-break-inside:avoid;
    break-inside:avoid;
    line-height:1.22;
    min-width:0;
  }

  .print-item.done {
    background:#f2f2f2;
    color:#777;
  }

  .line1 {
    font-size:14px;
    font-weight:800;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }

  .line {
    font-size:12.5px;
    margin-top:2px;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }

  .memo-print {
    font-size:12px;
    margin-top:2px;
    white-space:normal;
    overflow:hidden;
    line-height:1.35;
    display:-webkit-box;
    -webkit-line-clamp:2;
    -webkit-box-orient:vertical;
    word-break:break-all;
  }

  .type {
    display:inline-block;
    font-weight:800;
    color:#005bea;
  }

  .done-label {
    display:inline-block;
    color:#777;
    font-weight:800;
    margin-left:4px;
  }

  @media print {
    @page {
      size:A4 portrait;
      margin:7mm;
    }

    body {
      margin:0;
      padding:0;
      width:100%;
    }

    h1 {
      font-size:16px;
    }

    .summary {
      font-size:10px;
      margin-bottom:6px;
      padding-bottom:5px;
    }

    .print-grid {
      display:grid !important;
      grid-template-columns:repeat(2, minmax(0, 1fr)) !important;
      gap:4px 5px;
      width:100%;
    }

    .print-item {
      padding:4px 6px;
      margin:0;
      border-radius:5px;
      break-inside:avoid;
      page-break-inside:avoid;
    }

    .line1 {
      font-size:12.2px;
    }

    .line {
      font-size:11.7px;
      margin-top:1px;
    }

    .memo-print {
      font-size:11.5px;
      margin-top:1px;
      line-height:1.28;
      white-space:normal;
      overflow:hidden;
      display:-webkit-box;
      -webkit-line-clamp:2;
      -webkit-box-orient:vertical;
      word-break:break-all;
    }
  }
  </style>
  </head>

  <body>
  <h1>JS부동산 선택 매물 리스트</h1>
  <div class="summary">총 ${printItems.length}개 / 출력일 ${new Date().toLocaleString("ko-KR")}</div>
  <div class="print-grid">
  `;

  printItems.forEach(function(item) {
    var done = isDone(item);
    var stateLabel = done ? '<span class="done-label">계약완료</span>' : '';
    var typeText = item.type ? '[' + escapeHtml(item.type) + ']' : '[구분없음]';
    var nameText = item.name ? escapeHtml(item.name) + ' / ' : '';
    var memoText = shortText(item.memo || "", 160);

    html += `
    <div class="print-item ${done ? 'done' : ''}">
      <div class="line1"><span class="type">${typeText}</span> ${nameText}${escapeHtml(item.address || "")} / ${escapeHtml(item.room || "")}${stateLabel}</div>
      <div class="line">보${item.deposit} / 월${item.rent} / 관${item.fee} / 권${item.premium} / ${item.area}평</div>
      <div class="line">임대인 ${escapeHtml(item.landlordPhone || "")} / 세입자 ${escapeHtml(item.tenantPhone || "")}</div>
      <div class="memo-print">메모 : ${escapeHtml(memoText)}</div>
    </div>
    `;
  });

  html += `
  </div>
  </body>
  </html>
  `;

  var win = window.open("", "", "width=1000,height=900");

  if (!win) {
    alert("팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 눌러주세요.");
    return;
  }

  win.document.write(html);
  win.document.close();
  win.focus();

  setTimeout(function() {
    win.print();
  }, 300);
}


function getSelectedAIReportItem() {
  var key = window.selectedItemKey || selectedItemKey || "";
  if (key && window.allItems) {
    var found = allItems.find(function(item) {
      return item.key === key;
    });
    if (found) return found;
  }

  var selected = document.querySelector(".item.selected");
  if (!selected || !window.allItems) return null;

  var text = selected.innerText || "";
  return allItems.find(function(item) {
    return text.includes(item.name || "") || text.includes(item.address || "");
  }) || null;
}


function printAIInvestmentReport() {
  var item = getSelectedAIReportItem();

  if (!item) {
    alert("먼저 매물 1개를 클릭해주세요.");
    return;
  }

  var area = Number(item.area) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;
  var premium = Number(item.premium) || 0;
  var deposit = Number(item.deposit) || 0;
  var perRent = area ? Math.round(((rent + fee) / area) * 10) / 10 : "-";
  var initCost = deposit + premium;
  var now = new Date().toLocaleString("ko-KR");

  var opinion = "조건은 보통 수준이며 현장 유동인구와 주변 경쟁업종 확인이 필요합니다.";
  if (perRent !== "-" && perRent <= 5 && premium <= 1000) {
    opinion = "평당월비와 권리금 부담이 낮아 초기 창업자에게 검토 가치가 높은 매물입니다.";
  } else if (perRent !== "-" && (perRent >= 8 || premium >= 3000)) {
    opinion = "고정비 또는 권리금 부담이 있어 월세·권리금 협상 후 재검토가 필요합니다.";
  }

  var html =
'<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI 투자리포트</title>' +
'<style>' +
'@page{size:A4 portrait;margin:10mm;}' +
'body{font-family:Arial,"Malgun Gothic",sans-serif;margin:0;color:#222;background:white;text-align:center;}' +
'.report{max-width:760px;margin:0 auto;}' +
'.top{border-bottom:3px solid #1e88ff;padding-bottom:10px;margin-bottom:12px;}' +
'.title{font-size:24px;font-weight:900;color:#005bea;}' +
'.sub{font-size:12px;color:#666;margin-top:5px;}' +
'.section{border:1px solid #d9e6f7;border-radius:12px;padding:12px;margin-bottom:10px;page-break-inside:avoid;text-align:center;}' +
'.section h2{font-size:16px;margin:0 0 8px;color:#005bea;}' +
'.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;}' +
'.box{background:#f6f9ff;border:1px solid #d9e6f7;border-radius:10px;padding:9px;text-align:center;}' +
'.box b{display:block;font-size:11px;color:#666;}' +
'.box strong{display:block;font-size:18px;color:#111;margin-top:4px;}' +
'.line{font-size:13px;line-height:1.6;margin:3px 0;}' +
'.opinion{font-size:15px;font-weight:800;line-height:1.6;background:#fffdf2;border:1px solid #f3df91;border-radius:10px;padding:12px;}' +
'.memo{font-size:12px;line-height:1.5;}' +
'.footer{font-size:10px;color:#777;margin-top:8px;}' +
'</style></head><body>' +
'<div class="report">' +
'<div class="top"><div class="title">JS부동산 AI 투자리포트</div><div class="sub">출력일: ' + now + '</div></div>' +

'<div class="section"><h2>1. 매물 기본정보</h2>' +
'<div class="line"><b>매물:</b> ' + escapeHtml(item.name || "") + '</div>' +
'<div class="line"><b>주소:</b> ' + escapeHtml(item.address || "") + ' / ' + escapeHtml(item.room || "") + '</div>' +
'<div class="line"><b>구분:</b> ' + escapeHtml(item.type || "") + ' / <b>상태:</b> ' + escapeHtml(item.state || "계약가능") + '</div></div>' +

'<div class="section"><h2>2. 핵심지표</h2><div class="grid">' +
'<div class="box"><b>보증금</b><strong>' + deposit + '</strong></div>' +
'<div class="box"><b>월세+관리비</b><strong>' + (rent + fee) + '</strong></div>' +
'<div class="box"><b>권리금</b><strong>' + premium + '</strong></div>' +
'<div class="box"><b>평당월비</b><strong>' + perRent + '만</strong></div>' +
'</div></div>' +

'<div class="section"><h2>3. AI 시장분석</h2>' +
'<div class="line">초기비용: 보증금 ' + deposit + ' + 권리금 ' + premium + ' = <b>' + initCost + '</b></div>' +
'<div class="line">평당월비: <b>' + perRent + '만</b></div>' +
'<div class="line">관리비: <b>' + fee + '</b></div></div>' +

'<div class="section"><h2>4. 현장 체크포인트</h2>' +
'<div class="line">□ 유동인구 확인</div><div class="line">□ 전면 노출/간판 위치 확인</div>' +
'<div class="line">□ 주차 가능 여부 확인</div><div class="line">□ 주변 경쟁업종 확인</div>' +
'<div class="line">□ 권리금 세부내역 확인</div></div>' +

'<div class="section"><h2>5. 협상 포인트</h2>' +
'<div class="line">• 월세·관리비 포함 고정비 확인</div>' +
'<div class="line">• 권리금 시설/집기 내역 확인 후 조정</div>' +
'<div class="line">• 주변 유사 매물 대비 조건 비교 후 협상</div></div>' +

'<div class="section"><h2>6. AI 종합의견</h2><div class="opinion">' + escapeHtml(opinion) + '</div></div>' +
'<div class="section"><h2>7. 메모</h2><div class="memo">' + escapeHtml(item.memo || "") + '</div></div>' +
'<div class="footer">JS부동산 AI 리포트</div></div></body></html>';

  var win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    alert("팝업이 차단되었습니다. 브라우저에서 팝업 허용 후 다시 눌러주세요.");
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  setTimeout(function() {
    win.focus();
    win.print();
  }, 500);
}


function addAIReportPrintButton() {
  var selected = document.querySelector(".item.selected");
  if (!selected) return;
  if (selected.querySelector(".ai-report-print-btn")) return;

  var btn = document.createElement("button");
  btn.className = "ai-report-print-btn";
  btn.innerText = "AI 리포트 인쇄";
  btn.onclick = function(e) {
    e.stopPropagation();
    printAIInvestmentReport();
  };

  btn.style.marginTop = "8px";
  btn.style.width = "100%";
  btn.style.background = "#005bea";
  btn.style.color = "white";
  btn.style.borderRadius = "8px";
  btn.style.fontWeight = "800";

  selected.appendChild(btn);
}


setInterval(addAIReportPrintButton, 700);
  /* === v3.2.3 상권분석 UI 정리 === */
