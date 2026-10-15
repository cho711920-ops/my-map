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
    var displayType = window.JSListingTradeV1 ? window.JSListingTradeV1.displayType(item) : item.type;
    var typeText = displayType ? '[' + escapeHtml(displayType) + ']' : '[구분없음]';
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
