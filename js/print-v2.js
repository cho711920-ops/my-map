/* =========================================================
   JS부동산 선택인쇄 v2
   표 구성:
   전화번호 | 건물이름·주소 | 매물내역 | 메모 | 등록일
   ========================================================= */

(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function shortDate(value) {
    var text = String(value || "").trim();
    var match = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);

    if (match) {
      return match[1].slice(2) + "." +
        String(match[2]).padStart(2, "0") + "." +
        String(match[3]).padStart(2, "0");
    }

    return text;
  }

  function todayLabel() {
    var d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  }

  function cleanMemo(value) {
    return String(value || "")
      .replace(/\(\s*임장가자\s*\)/gi, "")
      .replace(/\(\s*공실박스\s*\)/gi, "")
      .replace(/출처\s*[:：]\s*[^\/|,，\n]+/gi, "")
      .replace(/\s*\/\s*\/\s*/g, " / ")
      .replace(/^\s*\/\s*/, "")
      .replace(/\s*\/\s*$/, "")
      .trim();
  }

  function phoneHtml(item) {
    var rows = [];

    if (item.landlordPhone) {
      rows.push('<div><b>임</b> ' + esc(item.landlordPhone) + '</div>');
    }

    if (item.tenantPhone) {
      rows.push('<div><b>세</b> ' + esc(item.tenantPhone) + '</div>');
    }

    return rows.join("") || '<span class="empty-cell">-</span>';
  }

  function buildingHtml(item) {
    var name = item.name ? '<div class="print-building-name">' + esc(item.name) + '</div>' : "";
    var room = item.room ? ' <span class="print-room">' + esc(item.room) + '</span>' : "";
    var address = '<div class="print-address">' + esc(item.address || "") + room + '</div>';

    return name + address;
  }

  function detailHtml(item) {
    var top = [
      window.JSListingTradeV1 ? window.JSListingTradeV1.displayType(item) : item.type || "",
      item.room || "",
      item.area ? item.area + "평" : ""
    ].filter(Boolean).join(" · ");

    var price = [
      "보" + (item.deposit || 0),
      "월" + (item.rent || 0),
      "관" + (item.fee || 0),
      "권" + (item.premium || 0)
    ].join(" / ");

    return (
      (top ? '<div class="print-detail-top">' + esc(top) + '</div>' : "") +
      '<div class="print-price">' + esc(price) + '</div>'
    );
  }

  function rowClass(item) {
    var classes = [];

    if (typeof isDone === "function" && isDone(item)) {
      classes.push("print-row-done");
    }

    if (
      typeof isFieldVisitItem === "function" &&
      isFieldVisitItem(item)
    ) {
      classes.push("print-row-visit");
    }

    return classes.join(" ");
  }

  function sale(item) { return window.JSListingTradeV1 ? window.JSListingTradeV1.isSale(item) : /^(sale|매매)$/.test(String(item.tradeType || item.trade_type || "")); }
  function land(item) { return window.JSListingTradeV1 ? window.JSListingTradeV1.normalizedSaleCategory(item) === "land" : /^(land|토지)$/.test(String(item.saleCategory || item.sale_category || "")); }
  function number(value) {
    if (value == null || typeof value === "boolean" || String(value).trim() === "") return null;
    var n = Number(String(value).replace(/,/g, "")); return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function format(value, digits) { return Number(value).toLocaleString("ko-KR", {maximumFractionDigits: digits == null ? 1 : digits}); }
  function money(value) {
    var n = number(value); if (n == null) return "미제공";
    var e = Math.floor(n / 10000), rest = Math.round((n - e * 10000) * 100) / 100;
    return (e ? format(e,0) + "억" : "") + (rest || !e ? format(rest,2) + "만" : "") + "원";
  }
  function saleDetails(item) { return window.JSListingTradeV1 ? window.JSListingTradeV1.saleSummary(item) : item.saleDetails || item.saleSummary || {}; }
  function printStylesheet() {
    // Use the already loaded current rules: about:blank previews need no
    // second stylesheet request and cannot retain an older cached layout.
    var link=document.querySelector('link[rel="stylesheet"][href*="css/print-v2.css"]');
    try { if(link&&link.sheet&&link.sheet.cssRules.length)return '<style>'+Array.from(link.sheet.cssRules).map(function(rule){return rule.cssText;}).join('\n')+'</style>'; } catch (_) {}
    return '<link rel="stylesheet" href="'+esc(link?link.href:'css/print-v2.css?v=2.1.0')+'">';
  }
  function saleFacts(item) {
    var d = saleDetails(item), isLand = land(item), price = number(item.salePrice ?? item.sale_price), facts = [];
    function add(label,value) { if (value != null && String(value).trim() !== "") facts.push('<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>'); }
    function area(label,value) { var n=number(value); if(n>0)add(label,format(n,2)+'㎡ · '+format(n/3.305785,2)+'평'); }
    function amount(label,value) { if(number(value)!=null)add(label,money(value)); }
    area(isLand?'토지면적':'대지면적',d.landAreaM2);
    if(isLand){
      if(price>0&&number(d.landAreaM2)>0)add('광고 토지 평당가',format(price/(number(d.landAreaM2)/3.305785),1)+'만원/평');
      add('지목',d.landUse);add('용도지역',d.zoning);add('도로접면',d.roadAccess);add('형상',d.parcelShape);
    }else{
      area('연면적',d.grossAreaM2);area('전용면적',d.exclusiveAreaM2);area('건축면적',d.buildingAreaM2);
      amount('임대보증금 합계',d.totalDeposit);amount('월 임대수입',d.monthlyIncome);
      var rate=window.JSListingTradeV1&&window.JSListingTradeV1.saleYield(item);
      if(rate!=null&&Number.isFinite(rate))add('보증금 차감 단순 연 수익률',format(rate,2)+'%');
      amount('광고 융자금',d.loanAmount);amount('광고 실투자금',d.investmentAmount);
      amount('광고 월수익 · 이자 차감',d.monthlyNetIncome);amount('광고 월수익 · 기준 미확인',d.statedMonthlyIncome);
      if(number(d.advertisedYield)!=null)add('광고 연 수익률 · 기준 확인',format(d.advertisedYield,2)+'%');
      add('건물 용도',d.buildingUse);
      add('사용승인일',d.approvalDate);
      var floor=window.JSListingTradeV1&&window.JSListingTradeV1.buildingFloorLabel(item);
      if(floor&&!/미확인/.test(floor))add('층·호실 (광고)',floor);
    }
    return facts.length?'<dl class="sale-print-facts">'+facts.join('')+'</dl>':'<p class="sale-print-missing">'+(isLand?'토지면적·토지 조건':'면적·임대수입 등 매매 조건')+' 미제공</p>';
  }
  function selectedDisplayItems(items) {
    // Match the existing list/comparison display, retaining explicit selection
    // identity and order. Do not take another source's price or income.
    if(typeof window.actionSelectionKeyV660!=="function")return items;
    var masters=new Set(window.allItems||[]),displayed=new Map();
    (window.visibleListItems||[]).forEach(function(i){displayed.set(window.actionSelectionKeyV660(i),i);});
    return items.map(function(i){return masters.has(i)?displayed.get(window.actionSelectionKeyV660(i))||i:i;});
  }
  function saleReport(items) {
    var allSales=items.every(sale),allLand=allSales&&items.every(land),allBuildings=allSales&&items.every(function(i){return !land(i);});
    var title='JS부동산 '+(allLand?'토지매매':allBuildings?'건물매매':'선택매물')+' 검토목록';
    var cards=items.map(function(item,index){
      var isSale=sale(item),isLand=isSale&&land(item),ui=window.JSListingTradeV1;
      var kind=isLand?'토지매매':isSale?'건물매매':'상가임대',type=ui?ui.displayType(item):item.type||'';
      var room=!isLand&&item.room?'<span>'+esc(item.room)+'</span>':'';
      var price=number(item.salePrice??item.sale_price),memo=cleanMemo(item.memo),phones=[];
      if(item.landlordPhone)phones.push((isSale?'소유자':'임대인')+' '+item.landlordPhone);
      if(item.tenantPhone&&!isLand)phones.push('임차인 '+item.tenantPhone);
      return '<article class="sale-print-card '+rowClass(item)+'" data-print-trade="'+(isLand?'land':isSale?'building':'lease')+'">'+
        '<header class="sale-print-card-head"><div><div class="sale-print-kind">'+(index+1)+'. '+esc(kind)+(type?' · '+esc(type):'')+'</div><h2>'+esc(item.name||'이름 미제공')+'</h2><div class="sale-print-address">'+esc(item.address||'주소 미제공')+room+'</div></div>'+
        '<div class="sale-print-price">'+(isSale?'<small>매매가</small><strong>'+esc(price>0?money(price):'미제공')+'</strong>':detailHtml(item))+'</div></header>'+
        (isSale?saleFacts(item):'')+
        '<div class="sale-print-contact">'+esc(phones.join(' · ')||'저장된 연락처 없음')+(item.source?' · 출처 '+esc(item.source):'')+'</div>'+
        (memo?'<section class="sale-print-memo"><h3>광고·관리 메모</h3><div>'+esc(memo)+'</div></section>':'')+'</article>';
    }).join('');
    var note='금액은 원본 광고 및 직접 수정한 관리값 기준이며, 면적은 광고 기준입니다.';
    if(items.some(function(i){return sale(i)&&!land(i);}))note+=' 단순 연 수익률 = 월 임대수입 × 12 ÷ (매매가 − 임대보증금) × 100. 대출이자·취득비용·세금·공실·운영비 미반영. 기준 미확인 월수익은 임대수입으로 계산하지 않습니다.';
    if(items.some(function(i){return sale(i)&&land(i);}))note+=' 토지 평당가는 매매가 ÷ 광고 토지면적(평)입니다. 광고 면적과 공부 전체면적은 다를 수 있습니다.';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title>'+printStylesheet()+'</head><body class="js-print-body js-sale-print-body"><main class="js-print-sheet"><header class="js-print-header"><div class="js-print-title">'+esc(title)+'</div><div class="js-print-meta"><span>출력일: '+esc(todayLabel())+'</span><span>선택 '+items.length+'건</span></div></header>'+cards+'<footer class="sale-print-note">'+esc(note)+'</footer></main><script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});<\/script></body></html>';
  }

  window.printSelectedList = function () {
    var items =
      typeof getSelectedPrintItems === "function"
        ? getSelectedPrintItems()
        : [];

    if (!items.length) {
      alert("인쇄할 매물을 선택해주세요.");
      return;
    }

    var rows = items.map(function (item) {
      var memo = cleanMemo(item.memo);

      return (
        '<tr class="' + rowClass(item) + '">' +
          '<td class="col-phone">' + phoneHtml(item) + '</td>' +
          '<td class="col-building">' + buildingHtml(item) + '</td>' +
          '<td class="col-detail">' + detailHtml(item) + '</td>' +
          '<td class="col-memo">' +
            (memo
              ? '<div class="print-memo">' + esc(memo) + '</div>'
              : '<span class="empty-cell">-</span>') +
          '</td>' +
          '<td class="col-date">' + esc(shortDate(item.regDate)) + '</td>' +
        '</tr>'
      );
    }).join("");

    var html = items.some(sale) ? saleReport(selectedDisplayItems(items)) :
      '<!doctype html>' +
      '<html lang="ko">' +
      '<head>' +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>JS부동산 임장리스트</title>' +
        printStylesheet() +
      '</head>' +
      '<body class="js-print-body">' +
        '<main class="js-print-sheet">' +
          '<header class="js-print-header">' +
            '<div class="js-print-title">JS부동산 임장리스트</div>' +
            '<div class="js-print-meta">' +
              '<span>출력일: ' + esc(todayLabel()) + '</span>' +
              '<span>총 선택매물: ' + items.length + '건</span>' +
            '</div>' +
          '</header>' +
          '<table class="js-print-table">' +
            '<colgroup>' +
              '<col style="width:14%">' +
              '<col style="width:20%">' +
              '<col style="width:24%">' +
              '<col style="width:34%">' +
              '<col style="width:8%">' +
            '</colgroup>' +
            '<thead>' +
              '<tr>' +
                '<th>전화번호</th>' +
                '<th>건물이름 · 주소</th>' +
                '<th>매물내역</th>' +
                '<th>메모</th>' +
                '<th>등록일</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</main>' +
        '<script>' +
          'window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});' +
        '<\/script>' +
      '</body>' +
      '</html>';

    var printWindow = window.open("", "_blank", "width=1100,height=850");

    if (!printWindow) {
      alert("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 인쇄해주세요.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };
})();
