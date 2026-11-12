/* =========================================================
   JS부동산 선택인쇄 v2
   표 구성:
   전화번호 | 건물이름·주소 | 임대조건 | 메모
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

  function primaryContacts(item) {
    if(typeof window.extractListContactsV650==='function')return window.extractListContactsV650(item);
    return [['임',item.landlordPhone],['세',item.tenantPhone]].filter(function(row){return row[1];}).map(function(row){return {role:row[0],phone:{display:row[1]}};});
  }
  function cachedContacts(item) {
    var cached=window.JSUnifiedListingsV8?.getCachedContacts?.(item.propertyId);
    if(cached&&cached.ok!==false&&String(cached.propertyId)===String(item.propertyId)&&Array.isArray(cached.contacts))return cached;
    return item.gongsilContactsLoadedV8&&Array.isArray(item.gongsilContactsV8)?{propertyId:item.propertyId,contacts:item.gongsilContactsV8}:null;
  }
  function attachContacts(item,linked,warning) {
    var contacts=primaryContacts(item);
    if(linked&&window.normalizeLinkedGongsilContactsV8&&window.mergePopupContactsV8)contacts=window.mergePopupContactsV8(contacts,window.normalizeLinkedGongsilContactsV8(linked.contacts));
    return Object.assign({},item,{printContactsV170:contacts,printContactWarningV170:warning||''});
  }
  function phoneHtml(item,isLand) {
    var names={'주':'주인','임':sale(item)?'소유자':'임대인','남':'사장','여':'사모','관':'관리','부':'부동산','세':sale(item)?'임차인':'세입자','가':'가족','기':'기타'};
    var rows=(item.printContactsV170||primaryContacts(item)).filter(function(c){return !isLand||c.role!=='세';}).map(function(contact){
      return '<div class="print-contact"><span class="print-contact-role">'+esc(contact.roleLabel||names[contact.role]||'연락처')+'</span><strong class="print-contact-number">'+esc(contact.phone.display)+'</strong></div>';
    }).join('');
    return (rows||'<span class="empty-cell">-</span>')+(item.printContactWarningV170?'<small class="print-contact-warning">'+esc(item.printContactWarningV170)+'</small>':'');
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

    var price = [['보증금',item.deposit],['월세',item.rent],['관리비',item.fee],['권리금',item.premium]].map(function(row){
      return '<div><dt>'+row[0]+'</dt><dd>'+esc(number(row[1])==null?'미입력':money(row[1]))+'</dd></div>';
    }).join('');

    return (
      (top ? '<div class="print-detail-top">' + esc(top) + '</div>' : "") +
      '<dl class="print-price">' + price + '</dl>'
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
    if(isLand){
      area('토지면적',d.landAreaM2);
      if(price>0&&number(d.landAreaM2)>0)add('광고 토지 평당가',format(price/(number(d.landAreaM2)/3.305785),1)+'만원/평');
      add('지목',d.landUse);add('용도지역',d.zoning);add('도로접면',d.roadAccess);add('형상',d.parcelShape);
    }else{
      amount('임대보증금 합계',d.totalDeposit);amount('월 임대수입',d.monthlyIncome);
      if(number(d.monthlyIncome)!=null)amount('연 임대수입 · 월세 × 12',number(d.monthlyIncome)*12);
      var rate=window.JSListingTradeV1&&window.JSListingTradeV1.saleYield(item);
      if(rate!=null&&Number.isFinite(rate))add('보증금 차감 단순 연 수익률',format(rate,2)+'%');
      amount('광고 융자금',d.loanAmount);amount('광고 실투자금',d.investmentAmount);
      amount('광고 월수익 · 이자 차감',d.monthlyNetIncome);amount('광고 월수익 · 기준 미확인',d.statedMonthlyIncome);
      if(number(d.advertisedYield)!=null)add('광고 연 수익률 · 기준 확인',format(d.advertisedYield,2)+'%');
      area('대지면적',d.landAreaM2);area('연면적',d.grossAreaM2);area('전용면적',d.exclusiveAreaM2);area('건축면적',d.buildingAreaM2);
      [['대지 기준 매매단가',d.landAreaM2],['연면적 기준 매매단가',d.grossAreaM2]].forEach(function(field){
        if(price>0&&number(field[1])>0)add(field[0],format(price/(number(field[1])/3.305785),1)+'만원/평');
      });
      add('건물 용도',d.buildingUse);
      add('사용승인일',d.approvalDate);
      if(number(d.householdCount)>0)add('세대 수 · 광고 기재',format(d.householdCount,0)+'세대');
      if(number(d.familyCount)>0)add('가구 수 · 광고 기재',format(d.familyCount,0)+'가구');
      if(number(d.roomCount)>0)add('방 수 · 광고 기재',format(d.roomCount,0)+'개');
      if(number(d.bathroomCount)>0)add('욕실 수 · 광고 기재',format(d.bathroomCount,0)+'개');
      var floor=window.JSListingTradeV1&&window.JSListingTradeV1.buildingFloorLabel(item);
      if(floor&&!/미확인/.test(floor))add('층·호실 (광고)',floor);
    }
    var warnings=(d.descriptionWarnings||[]).slice();
    if(item.printReviewWarningV22)warnings.push(item.printReviewWarningV22);
    if(!isLand){var missing=[];if(number(d.totalDeposit)==null)missing.push('임대보증금');if(number(d.monthlyIncome)==null)missing.push('월 임대수입');if(missing.length)warnings.push(missing.join('·')+' 미제공 · 계약조건 확인 필요');}
    return (facts.length?'<dl class="sale-print-facts">'+facts.join('')+'</dl>':'<p class="sale-print-missing">'+(isLand?'토지면적·토지 조건':'면적·임대수입 등 매매 조건')+' 미제공</p>')+
      (warnings.length?'<p class="sale-print-warning"><b>확인사항</b> '+warnings.map(esc).join(' / ')+'</p>':'');
  }
  function referenceTime(value){
    var time=Date.parse(value);return Number.isFinite(time)?new Date(time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'조회시각 미확인';
  }
  function officialPrintHtml(item){
    var reference=item.printReferencesV188||{},isLand=land(item);
    function section(title,content){return '<section class="sale-print-official"><h3>'+esc(title)+'</h3>'+content+'</section>';}
    function status(entry){return '<p class="sale-print-reference-status">'+esc(entry?.error||reference.error||'미조회 · 광고값으로 대체하지 않음')+'</p>';}
    function facts(rows){return '<dl class="sale-print-facts sale-print-official-facts">'+rows.filter(function(row){return row[1]!==null&&row[1]!==undefined&&String(row[1]).trim()!=='';}).map(function(row){return '<div><dt>'+esc(row[0])+'</dt><dd>'+esc(row[1])+'</dd></div>';}).join('')+'</dl>';}
    function area(value){return number(value)>0?format(value,2)+'㎡ · '+format(value/3.305785,2)+'평':'';}
    function source(data,fallback){return '<p class="sale-print-source">출처: '+esc(data.source||fallback)+' · 조회 '+esc(referenceTime(data.fetchedAt))+(data.cached?' · 저장된 조회자료':'')+'</p>';}
    var building=reference.building?.data,buildingHtml='';
    if(!isLand){
      if(!building)buildingHtml=status(reference.building);
      else{
        var buildings=building.buildings||[];
        buildingHtml='<p class="sale-print-reference-status">표제부 요약 · 층별·전유부 제외'+(buildings.length>1?' · '+buildings.length+'개 건물 각각 표시, 합산하지 않음':'')+'</p>';
        if(!buildings.length)buildingHtml+='<p>해당 지번의 건물 표제부 미확인</p>';
        buildings.forEach(function(b,index){
          buildingHtml+='<h4>'+esc([buildings.length>1?'건물 '+(index+1):'',b.buildingName,b.dongName,b.registerType].filter(Boolean).join(' · ')||'대장 건물')+'</h4>';
          var rows=[['소재지',b.lotAddress],['대지면적',area(b.siteArea)],['건축면적',area(b.buildingArea)],['연면적',area(b.totalArea)],['주용도',b.mainUse],['기타용도',b.otherUse],['구조',b.structure],['사용승인일',String(b.approvalDate||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')]];
          [['건폐율',b.buildingCoverageRatio],['용적률',b.floorAreaRatio]].forEach(function(row){if(number(row[1])!=null)rows.push([row[0],format(row[1],2)+'%']);});
          if(number(b.groundFloors)!=null||number(b.undergroundFloors)!=null)rows.push(['층수',[number(b.undergroundFloors)!=null?'지하 '+b.undergroundFloors+'층':'',number(b.groundFloors)!=null?'지상 '+b.groundFloors+'층':''].filter(Boolean).join(' · ')]);
          buildingHtml+=facts(rows);
          if(buildings.length===1){var d=saleDetails(item),diff=[];
            [['대지면적',d.landAreaM2,b.siteArea],['건축면적',d.buildingAreaM2,b.buildingArea],['연면적',d.grossAreaM2,b.totalArea]].forEach(function(row){if(number(row[1])>0&&number(row[2])>0&&Math.abs(Number(row[1])-Number(row[2]))>1)diff.push(row[0]+' 광고·관리 '+area(row[1])+' / 대장 '+area(row[2]));});
            if(diff.length)buildingHtml+='<p class="sale-print-warning">표기 차이: '+diff.map(esc).join(' · ')+' · 지분·일괄매매 범위를 원문과 대조하세요.</p>';
          }
        });
        if(building.incomplete||building.truncated||building.refreshDeferred||Number(building.recordCounts?.buildings)>buildings.length)buildingHtml+='<p class="sale-print-warning">일부 대장 자료 또는 갱신 확인 필요</p>';
        buildingHtml+=source(building,'국토교통부 건축물대장');
      }
    }
    var data=reference.land?.data,landHtml='';
    if(!data)landHtml=status(reference.land);
    else{
      var rows=[['소재지',data.address],['지목',data.landUse],['필지 전체면적',area(data.areaM2)]];
      if(data.price?.available&&number(data.price.wonPerM2)>0)rows.push(['개별공시지가',format(data.price.wonPerM2,0)+'원/㎡ ('+data.price.baseYear+'.'+String(data.price.baseMonth).padStart(2,'0')+' 기준)']);
      else rows.push(['개별공시지가','미확인']);
      landHtml=facts(rows)+(data.regulations||[]).map(function(row){var value=row.available&&row.complete?(row.items||[]).map(function(v){return v.label;}).join(' · ')||'해당 표시 없음':'일부 또는 미확인';return '<p class="sale-print-zone"><b>'+esc(row.label)+'</b><span>'+esc(value)+'</span></p>';}).join('');
      if(!data.complete)landHtml+='<p class="sale-print-warning">일부 토지정보 미확인 · 토지이음 원문 확인 필요</p>';
      if(reference.pnu&&/^[1-9]\d{9}[12]\d{8}$/.test(reference.pnu))landHtml+='<p class="sale-print-source">필지번호 '+esc(reference.pnu)+' · <a href="https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?selGbn=umd&amp;isNoScr=script&amp;mode=search&amp;pnu='+reference.pnu+'" target="_blank" rel="noopener noreferrer">토지이음 원문</a></p>';
      landHtml+=source(data,'토지이음');
    }
    return (!isLand?section('건축물대장 · 공적 조회자료',buildingHtml):'')+section('토지이음 · 공적 조회자료',landHtml);
  }
  function selectedDisplayItems(items) {
    // Match the existing list/comparison display, retaining explicit selection
    // identity and order. Do not take another source's price or income.
    if(typeof window.actionSelectionKeyV660!=="function")return items;
    var masters=new Set(window.allItems||[]),displayed=new Map();
    (window.visibleListItems||[]).forEach(function(i){displayed.set(window.actionSelectionKeyV660(i),i);});
    return items.map(function(i){return masters.has(i)?displayed.get(window.actionSelectionKeyV660(i))||i:i;});
  }
  // Print-only document. Fit the complete DOM, never a substring or a clipped box.
  function fitBuildingPrintPagesV200() {
    function fit() {
      document.querySelectorAll('.sale-print-page-v200').forEach(function(page) {
        var area=page.querySelector('.sale-print-area-v200'),content=area.firstElementChild;
        var width=area.getBoundingClientRect().width,height=area.getBoundingClientRect().height-2;
        if(!(width>0&&height>0))return;
        function apply(scale){content.style.width=(width/scale)+'px';content.style.zoom=String(scale);}
        function fits(){var box=content.getBoundingClientRect();return box.height<=height&&box.width<=width+.5;}
        page.style.setProperty('--print-memo-columns-v200','1');
        var memo=content.querySelector('.sale-print-memo>div');
        if(memo)memo.style.removeProperty('font-size');
        apply(1);
        if(!fits()&&memo){
          page.style.setProperty('--print-memo-columns-v200','2');apply(1);
          if(!fits()&&memo.getBoundingClientRect().height>height*.6){page.style.setProperty('--print-memo-columns-v200','3');apply(1);}
        }
        // Keep prices, contacts and public evidence readable when the memo is
        // the excess. Only unusually large evidence tables need whole-card fit.
        if(!fits()&&memo){
          var memoHigh=1,memoLow=.5;
          function memoSize(scale){memo.style.fontSize=(8.5*scale)+'pt';}
          memoSize(memoLow);
          while(!fits()&&memoLow>1e-8){memoHigh=memoLow;memoLow/=2;memoSize(memoLow);}
          if(fits()){
            for(var m=0;m<16;m++){var candidate=(memoLow+memoHigh)/2;memoSize(candidate);if(fits())memoLow=candidate;else memoHigh=candidate;}
            memoSize(memoLow);
          }else memo.style.removeProperty('font-size');
        }
        var scale=1;
        if(!fits()){
          var high=1,low=.5;
          apply(low);
          while(!fits()&&low>1e-8){high=low;low/=2;apply(low);}
          for(var step=0;step<16;step++){var middle=(low+high)/2;apply(middle);if(fits())low=middle;else high=middle;}
          scale=low;apply(scale);
        }
        page.dataset.printScaleV200=String(scale);
        page.dataset.printFitsV200=String(fits());
      });
    }
    window.addEventListener('beforeprint',fit);
    window.addEventListener('afterprint',fit);
    window.addEventListener('resize',fit);
    window.addEventListener('load',function(){
      Promise.resolve(document.fonts&&document.fonts.ready).then(function(){fit();window.requestAnimationFrame(function(){fit();window.print();});});
    });
  }
  function saleReport(items) {
    var allSales=items.every(sale),allLand=allSales&&items.every(land),allBuildings=allSales&&items.every(function(i){return !land(i);});
    var title='JS부동산 '+(allLand?'토지매매':allBuildings?'건물매매':'선택매물')+' 검토목록';
    var cards=items.map(function(item,index){
      var isSale=sale(item),isLand=isSale&&land(item),ui=window.JSListingTradeV1;
      var kind=isLand?'토지매매':isSale?'건물매매':'상가임대',type=ui?ui.displayType(item):item.type||'';
      var room=!isLand&&item.room?'<span>'+esc(item.room)+'</span>':'';
      var price=number(item.salePrice??item.sale_price),memo=cleanMemo(window.JSUnifiedListingsV8?.editableMemoText?window.JSUnifiedListingsV8.editableMemoText(Object.assign({},item,{memo:item.memo||saleDetails(item).descriptionText||''})):item.memo||saleDetails(item).descriptionText);
      return '<article class="sale-print-card '+(isSale&&!isLand?'':rowClass(item))+'" data-print-trade="'+(isLand?'land':isSale?'building':'lease')+'">'+
        '<header class="sale-print-card-head"><div><div class="sale-print-kind">'+(index+1)+'. '+esc(kind)+(type?' · '+esc(type):'')+'</div><h2>'+esc(item.name||'이름 미제공')+'</h2><div class="sale-print-address">'+esc(item.address||'주소 미제공')+room+'</div></div>'+
        '<div class="sale-print-price">'+(isSale?'<small>매매가</small><strong>'+esc(price>0?money(price):'미제공')+'</strong>':detailHtml(item))+'</div></header>'+
        (isSale&&!isLand?'<section class="sale-print-advertised"><h3>광고·직접 수정 조건</h3><p class="sale-print-source">매매가·보증금·임대수입은 광고·관리값이며 대장 확인값이 아닙니다. 면적·용도는 아래 공적자료와 구분해 확인하세요.</p>'+saleFacts(item)+'</section>':isSale?saleFacts(item):'')+
        '<section class="sale-print-contact"><h3>전화번호</h3><div class="sale-print-contact-list">'+phoneHtml(item,isLand)+'</div></section>'+
        (isSale&&!isLand?'<div class="sale-print-public-v200">'+officialPrintHtml(item)+'</div>':'')+
        (memo?'<section class="sale-print-memo"><h3>광고·관리 메모</h3><div>'+esc(memo)+'</div></section>':'')+'</article>';
    });
    var note=items.some(function(i){return sale(i)&&!land(i);})?'':'금액은 원본 광고 및 직접 수정한 관리값 기준이며, 면적은 광고 기준입니다.';
    if(items.some(function(i){return sale(i)&&land(i);}))note+=' 토지 평당가는 매매가 ÷ 광고 토지면적(평)입니다. 광고 면적과 공부 전체면적은 다를 수 있습니다.';
    var header='<header class="js-print-header"><div class="js-print-title">'+esc(title)+'</div><div class="js-print-meta"><span>출력일: '+esc(todayLabel())+'</span><span>선택 '+items.length+'건</span></div></header>';
    var footer=note?'<footer class="sale-print-note">'+esc(note)+'</footer>':'';
    var content=allBuildings?cards.map(function(card){return '<section class="sale-print-page-v200">'+header+'<div class="sale-print-area-v200"><div class="sale-print-content-v200">'+card+footer+'</div></div></section>';}).join(''):header+cards.join('')+footer;
    var ready=allBuildings?'('+fitBuildingPrintPagesV200.toString()+')();':'window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title>'+printStylesheet()+'</head><body class="js-print-body js-sale-print-body'+(allBuildings?' js-building-one-page-v200':'')+'"><main class="js-print-sheet">'+content+'</main><script>'+ready+'<\/script></body></html>';
  }

  function renderPrint(items, printWindow) {
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
        '</tr>'
      );
    }).join("");

    var html = items.some(sale) ? saleReport(items) :
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
              '<col style="width:18%">' +
              '<col style="width:22%">' +
              '<col style="width:26%">' +
              '<col style="width:34%">' +
            '</colgroup>' +
            '<thead>' +
              '<tr>' +
                '<th>전화번호</th>' +
                '<th>건물이름 · 주소</th>' +
                '<th>임대조건</th>' +
                '<th>메모</th>' +
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

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  var preparingPrint = false;
  window.printSelectedList = function () {
    if(preparingPrint)return;
    if(!(window.selectedPrintKeys||[]).length){alert('인쇄할 매물을 선택해주세요.');return;}
    // Preserve the original user gesture even when a selected read-only row
    // still needs its exact writable master. Never print an incomplete subset.
    var printWindow=window.open('', '_blank', 'width=1100,height=850');
    if(!printWindow){alert('팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 인쇄해주세요.');return;}
    function cancel(){preparingPrint=false;if(!printWindow.closed)printWindow.close();}
    if(window.JSQueryListingsV152?.guardSelected?.(function(){preparingPrint=false;renderSelectedPrintV162(printWindow);},cancel)){
      if(printWindow.closed)return;
      preparingPrint=true;
      printWindow.document.open();printWindow.document.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>선택 매물 확인</title></head><body><p role="status">선택한 매물 정보를 확인하고 있습니다…</p></body></html>');printWindow.document.close();return;
    }
    return renderSelectedPrintV162(printWindow);
  };
  function renderSelectedPrintV162(printWindow) {
    if(printWindow.closed)return;
    var items=typeof getSelectedPrintItems==='function'?getSelectedPrintItems():[];
    if(!items.length){printWindow.close();alert('인쇄할 매물을 선택해주세요.');return;}
    items=items.some(sale)?selectedDisplayItems(items):items;
    var api=window.JSUnifiedListingsV8,registry=window.JSBuildingRegistryV164,research=window.JSSalePublicReviewV6;
    var saleReads=items.some(sale)&&typeof api?.printItem==='function';
    function needsContactRead(item){return Number(item.gongsilContactCountV8)>0&&!cachedContacts(item);}
    if(!saleReads&&!registry?.load&&!items.some(needsContactRead)&&!items.some(function(i){return sale(i)&&!land(i)&&research?.referencesForPrint;})){renderPrint(items.map(function(item){return attachContacts(item,cachedContacts(item));}),printWindow);return;}
    preparingPrint=true;
    var preparingMessage=items.some(function(i){return sale(i)&&!land(i);})?'선택 매물의 연락처와 조건, 건축물대장·토지이음 자료를 확인하고 있습니다…':'선택 매물의 연락처와 조건을 확인하고 있습니다…';
    printWindow.document.open();printWindow.document.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>임장자료 준비</title></head><body><p role="status">'+preparingMessage+'</p></body></html>');printWindow.document.close();
    var button=document.getElementById('printSelectedBtn'),wasDisabled=button&&button.disabled;
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
    var result=items.slice(),next=0,account=String(window.JSAuthenticatedAccountEmail||''),selection=JSON.stringify(window.selectedPrintKeys||[]),commonWarning='';
    function current(){return !printWindow.closed&&account===String(window.JSAuthenticatedAccountEmail||'')&&selection===JSON.stringify(window.selectedPrintKeys||[])&&!document.getElementById('jsAuthGate');}
    async function worker(){while(next<items.length){var index=next++,item=items[index];if(!current())return;
      if(saleReads&&sale(item))result[index]=await api.printItem(item);
      if(!current())return;
      var linked=cachedContacts(item),warning=commonWarning;
      if(needsContactRead(item))try{
        linked=await api.loadContacts(item.propertyId);
        if(linked?.ok===false||String(linked?.propertyId)!==String(item.propertyId)||!Array.isArray(linked?.contacts))throw Error('연락처 불일치');
      }catch{linked=null;warning=[warning,'원본 연락처 조회 실패'].filter(Boolean).join(' · ');}
      if(!current())return;
      result[index]=attachContacts(result[index],linked,warning);
      if(sale(item)&&!land(item)&&research?.referencesForPrint){
        try{result[index]=Object.assign({},result[index],{printReferencesV188:await research.referencesForPrint(result[index])});}
        catch(error){result[index]=Object.assign({},result[index],{printReferencesV188:{error:error.message||'공적자료 조회 실패'}});}
      }
    }}
    return Promise.resolve().then(function(){return registry?.load?.();}).then(function(ok){if(ok===false)commonWarning='건물 공통번호 확인 지연';return Promise.all([worker(),worker()]);}).then(function(){if(current())renderPrint(result,printWindow);else if(!printWindow.closed)printWindow.close();}).catch(function(){
      if(current())renderPrint(items.map(function(item){return attachContacts(sale(item)?Object.assign({},item,{printReviewWarningV22:'최신 상세조건 조회 실패 · 현재 목록정보 기준'}):item,cachedContacts(item),'연락처 확인 지연');}),printWindow);
      else if(!printWindow.closed)printWindow.close();
    }).finally(function(){preparingPrint=false;if(button){button.disabled=wasDisabled;button.removeAttribute('aria-busy');}});
  }
})();
