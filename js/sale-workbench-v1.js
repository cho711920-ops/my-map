(function (global) {
  "use strict";
  var PY = 3.305785;
  var ACCOUNT_EMAIL = clean(global.JSAuthenticatedAccountEmail).toLowerCase();
  var active = null;
  var categoryLabels = {commercial:"상가",office:"사무실",multifamily:"다가구",house:"단독/전원주택",mixed_house:"상가주택",building:"건물전체",factory_warehouse:"공장/창고",apartment:"아파트",villa:"빌라/다세대",officetel:"오피스텔",one_room:"원룸",reconstruction:"재건축",redevelopment:"재개발",apartment_presale:"아파트분양권",officetel_presale:"오피스텔분양권",knowledge_center:"지식산업센터",other:"기타"};
  var ranges = [
    ["saleLand", "대지/토지", "평", "landAreaM2"],
    ["saleGross", "연면적", "평", "grossAreaM2"],
    ["saleYield", "단순 연 수익률", "%", "yield"],
    ["saleUnitPrice", "토지 평당가", "만원", "unitPrice"]
  ];
  var filterIds = ranges.flatMap(function(r){return [r[0]+"Min", r[0]+"Max"];}).concat(["saleCategoryFilter", "saleLandUseFilter", "saleZoningFilter"]);
  function ui() { return global.JSListingTradeV1; }
  function clean(v) { return String(v == null ? "" : v).trim(); }
  function accountChanged(e) { return Number(e&&e.status)===409 && clean(e&&e.payload&&e.payload.code||e&&e.code)==="account_changed"; }
  function accountChangedMessage() { return "로그인 계정이 변경되었습니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요."; }
  function esc(v) { return clean(v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function num(v) { if(v == null || typeof v === "boolean" || clean(v)==="") return null; var n=Number(clean(v).replace(/,/g,"")); return Number.isFinite(n) && n>=0 ? n : null; }
  function fmt(v,d) { return v == null || !Number.isFinite(Number(v)) ? "미확인" : Number(v).toLocaleString("ko-KR",{maximumFractionDigits:d==null?1:d}); }
  function date(v) {return global.JSSaleReviewV10?global.JSSaleReviewV10.dateText(v):clean(v);}
  function price(v) {
    var n=num(v); if(n==null || n<=0) return "매매가 미확인";
    var e=Math.floor(n/10000), m=Math.round((n-e*10000)*100)/100;
    return (e?fmt(e,0)+"억":"")+(m?fmt(m,2)+"만":"")+"원";
  }
  function unitPrice(item) { var d=ui().saleSummary(item),p=num(item.salePrice ?? item.sale_price),a=num(d.landAreaM2); return p>0 && a>0 ? p/(a/PY) : null; }
  var saleSortsV5 = {
    salePriceLow:['매매가 낮은순','price',false], salePriceHigh:['매매가 높은순','price',true],
    saleLandHigh:['대지·토지 넓은순','landAreaM2',true], saleLandLow:['대지·토지 작은순','landAreaM2',false],
    saleGrossHigh:['연면적 넓은순','grossAreaM2',true], saleYieldHigh:['단순 수익률 높은순','yield',true],
    saleIncomeHigh:['월 임대수입 높은순','monthlyIncome',true], saleUnitLow:['토지 평당가 낮은순','unit',false],
    saleUnitHigh:['토지 평당가 높은순','unit',true]
  };
  var leaseSortMenuV5 = null, sortModeV5 = '';
  function sortLabel(key) { return saleSortsV5[key] ? saleSortsV5[key][0] : ''; }
  function sortValue(item,key) {
    var spec=saleSortsV5[key];if(!spec || !ui().isSale(item))return null;
    var field=spec[1], d=ui().saleSummary(item), v;
    if(field==='price')v=num(item.salePrice??item.sale_price);
    else if(field==='unit')v=unitPrice(item);
    else if(field==='yield')v=ui().saleYield(item);
    else v=num(d[field]);
    return v==null || !Number.isFinite(v) || (field!=='monthlyIncome' && field!=='yield' && v<=0) ? null : v;
  }
  function compareSortValues(a,b,key) {
    if(a==null)return b==null?0:1;if(b==null)return -1;
    return saleSortsV5[key] && saleSortsV5[key][2] ? b-a : a-b;
  }
  function syncSortMenu() {
    var menu=document.getElementById('sortDropdownMenu'),mode=ui().getMode();if(!menu || sortModeV5===mode)return;
    if(leaseSortMenuV5==null)leaseSortMenuV5=menu.innerHTML;
    sortModeV5=mode;
    if(mode==='lease'){menu.innerHTML=leaseSortMenuV5;return;}
    var keys=['latest','salePriceLow','salePriceHigh','saleLandHigh','saleLandLow'].concat(mode==='land_sale'?['saleUnitLow','saleUnitHigh']:['saleGrossHigh','saleYieldHigh','saleIncomeHigh']);
    menu.innerHTML=keys.map(function(key){return '<button class="sort-menu-single sort-menu-check" type="button" role="option" aria-selected="false" data-sort-value="'+key+'" onclick="selectSortOption(\''+key+'\')"><span class="sort-choice-check" aria-hidden="true"></span><span>'+esc(key==='latest'?'최근등록순':sortLabel(key))+'</span></button>';}).join('');
  }
  function input(id) { return clean((document.getElementById(id)||{}).value); }
  // Keep provider values intact; accept their short labels only when filtering.
  function landUseKey(value) {
    var v=clean(value),aliases={과:'과수원',목:'목장용지',임:'임야',광:'광천지',염:'염전',장:'공장용지',학:'학교용지',차:'주차장',주:'주유소용지',창:'창고용지',도:'도로',철:'철도용지',제:'제방',천:'하천',구:'구거',유:'유지',양:'양어장',수:'수도용지',공:'공원',체:'체육용지',원:'유원지',종:'종교용지',사:'사적지',묘:'묘지',잡:'잡종지'};
    return aliases[v]||v;
  }
  function filterValues() { var values={}; filterIds.forEach(function(id){values[id]=input(id);}); return values; }
  function rangeMatch(value,min,max) {
    if(clean(min)==="" && clean(max)==="") return true;
    var low=num(min), high=num(max);
    if((clean(min)!=="" && low==null)||(clean(max)!=="" && high==null)) return false;
    if(low!=null&&high!=null&&low>high){var swap=low;low=high;high=swap;}
    return value!=null && Number.isFinite(value) && (low==null||value>=low) && (high==null||value<=high);
  }
  function matches(item, values) {
    if(!ui().isSale(item)) return true;
    var f=values||filterValues(),d=ui().saleSummary(item),land=ui().normalizedSaleCategory(item)==="land";
    if(!land && f.saleCategoryFilter && ui().normalizedSaleCategory(item)!==f.saleCategoryFilter) return false;
    if(!rangeMatch(num(d.landAreaM2)>0 ? Number(d.landAreaM2)/PY : null,f.saleLandMin,f.saleLandMax)) return false;
    if(land) return rangeMatch(unitPrice(item),f.saleUnitPriceMin,f.saleUnitPriceMax) &&
      (!f.saleLandUseFilter || landUseKey(d.landUse)===landUseKey(f.saleLandUseFilter)) &&
      (!f.saleZoningFilter || clean(d.zoning).replace(/\s/g,"").includes(clean(f.saleZoningFilter).replace(/\s/g,"")));
    return rangeMatch(num(d.grossAreaM2)>0 ? Number(d.grossAreaM2)/PY : null,f.saleGrossMin,f.saleGrossMax) && rangeMatch(ui().saleYield(item),f.saleYieldMin,f.saleYieldMax);
  }
  function reset() { filterIds.forEach(function(id){var e=document.getElementById(id);if(e)e.value="";}); }
  function clearChip(key) { filterIds.filter(function(id){return id===key || id===key+"Min" || id===key+"Max";}).forEach(function(id){var e=document.getElementById(id);if(e)e.value="";}); }
  function chips() {
    if(ui().getMode()==="lease") return [];
    var f=filterValues(),land=ui().getMode()==="land_sale",result=[];
    ranges.forEach(function(r){
      if((land && /saleGross|saleYield/.test(r[0]))||(!land&&r[0]==="saleUnitPrice"))return;
      var min=f[r[0]+"Min"],max=f[r[0]+"Max"];
      if(min||max)result.push({key:r[0],label:r[1]+" "+(min&&max?min+"~"+max+r[2]:min?min+r[2]+" 이상":max+r[2]+" 이하")});
    });
    if(!land&&f.saleCategoryFilter)result.push({key:"saleCategoryFilter",label:categoryLabels[f.saleCategoryFilter]||f.saleCategoryFilter});
    if(land&&f.saleLandUseFilter)result.push({key:"saleLandUseFilter",label:"지목 "+f.saleLandUseFilter});
    if(land&&f.saleZoningFilter)result.push({key:"saleZoningFilter",label:"용도지역 "+f.saleZoningFilter});
    return result;
  }
  function mountFilters() {
    var root=document.getElementById("saleFiltersV1"); if(!root)return;
    var html='<p class="sale-filter-help">금액: 만원 · 면적: 평 · 미확인 값은 해당 조건 선택 시 제외</p>';
    ranges.forEach(function(r){html+='<div class="sale-filter-range" data-sale-range="'+r[0]+'"><label>'+r[1]+'</label><div class="row"><input type="number" min="0" step="any" id="'+r[0]+'Min" aria-label="'+r[1]+' 최소" placeholder="최소 ('+r[2]+')"><input type="number" min="0" step="any" id="'+r[0]+'Max" aria-label="'+r[1]+' 최대" placeholder="최대 ('+r[2]+')"></div></div>';});
    html+='<label data-sale-building>건물 구분<select id="saleCategoryFilter" aria-label="건물 구분"><option value="">전체</option>'+Object.keys(categoryLabels).map(function(k){return '<option value="'+k+'">'+categoryLabels[k]+'</option>';}).join("")+'</select></label>';
    html+='<label data-sale-land>지목<select id="saleLandUseFilter" aria-label="지목"><option value="">전체</option>'+['전','답','과수원','목장용지','임야','광천지','염전','대','공장용지','학교용지','주차장','주유소용지','창고용지','도','철도용지','제방','하천','구거','유지','양어장','수도용지','공원','체육용지','유원지','종교용지','사적지','묘지','잡종지','창','잡'].map(function(v){return '<option>'+v+'</option>';}).join("")+'</select></label><label data-sale-land>용도지역<input id="saleZoningFilter" aria-label="용도지역" placeholder="예: 일반주거, 자연녹지, 관리지역"></label>';
    root.innerHTML=html;syncMode();
  }
  function syncMode() {
    var mode=ui().getMode(),sale=mode!=="lease",land=mode==="land_sale",root=document.getElementById("saleFiltersV1");
    if(root){root.hidden=!sale;root.querySelectorAll('[data-sale-building],[data-sale-range="saleGross"],[data-sale-range="saleYield"]').forEach(function(e){e.hidden=land;});root.querySelectorAll('[data-sale-land],[data-sale-range="saleUnitPrice"]').forEach(function(e){e.hidden=!land;});}
    ["listingLeaseAreaRowV1","listingLeaseFloorRowV1"].forEach(function(id){var e=document.getElementById(id);if(e)e.hidden=sale;});
    var compare=document.getElementById("saleCompareButtonV1");if(compare)compare.hidden=!sale;
    syncSortMenu();
    syncComparisonTray();
  }
  function selectedSaleItems() {
    var items=typeof global.getSelectedPrintItems==='function'?global.getSelectedPrintItems():[];
    if(!items.length)return items;
    var masters=new Set(global.allItems||[]), visibleByKey=new Map();
    (global.visibleListItems||[]).forEach(function(item){visibleByKey.set(global.actionSelectionKeyV660(item),item);});
    return items.map(function(item){
      if(!masters.has(item))return item;
      var key=global.actionSelectionKeyV660(item);
      return visibleByKey.get(key)||item;
    });
  }
  function syncComparisonTray() {
    var tray=document.getElementById('saleComparisonTrayV5'), sale=ui().getMode()!=='lease';
    var items=sale?selectedSaleItems():[];
    if(!sale||!items.length){if(tray)tray.hidden=true;document.documentElement.removeAttribute('data-sale-comparison-open-v5');return;}
    if(!tray){tray=document.createElement('aside');tray.id='saleComparisonTrayV5';tray.className='sale-comparison-tray-v5';tray.setAttribute('aria-label','선택한 매매 비교 후보');document.body.append(tray);}
    tray.hidden=false;document.documentElement.setAttribute('data-sale-comparison-open-v5','true');
    var valid=items.length>=2&&items.length<=4&&items.every(function(item){return ui().isSale(item)&&(ui().normalizedSaleCategory(item)==='land')===(ui().getMode()==='land_sale');});
    tray.innerHTML='<div class="sale-tray-heading-v5"><strong>비교 후보 '+items.length+'개</strong><span>같은 시장에서 2~4개 선택</span></div><div class="sale-tray-items-v5">'+items.slice(0,4).map(function(item){
      return '<button type="button" data-sale-remove="'+esc(encodeURIComponent(global.actionSelectionKeyV660(item)))+'" aria-label="'+esc((item.name||item.address||'매물')+' 비교 선택 해제')+'"><span>'+esc(item.name||item.address||'매물')+'</span><b>'+esc(price(item.salePrice??item.sale_price))+'</b><span aria-hidden="true">×</span></button>';
    }).join('')+'</div><div class="sale-tray-actions-v5"><button type="button" data-sale-clear>선택 해제</button><button type="button" data-sale-compare'+(valid?'':' disabled')+'>비교표 열기</button></div>';
    tray.querySelector('[data-sale-clear]').onclick=function(){global.clearSelectedPrintItems();};
    tray.querySelector('[data-sale-compare]').onclick=compare;
    tray.querySelectorAll('[data-sale-remove]').forEach(function(button){button.onclick=function(){global.togglePrintSelection(button.dataset.saleRemove);};});
  }
  // Assumptions are separate from collected facts. No default unknown rent=0.
  function calculate(values) {
    var p=num(values.price),d=num(values.deposit),r=num(values.income),l=num(values.loan),i=num(values.interest),v=num(values.vacancy),o=num(values.expense),c=num(values.acquisition);
    if([p,d,r,l,i,v,o,c].some(function(x){return x==null;})||p<=0||i>100||v>100)return {error:"모든 항목을 숫자로 입력하세요. 이자율·공실률은 0~100%입니다."};
    var equity=p-d-l+c;
    if(equity<=0)return {error:"매매가 − 보증금 − 대출 + 취득비용이 0보다 커야 합니다."};
    var monthly=r*(1-v/100)-l*i/100/12-o;
    return {equity:equity,monthly:monthly,annual:monthly*12,yield:monthly*12/equity*100,interest:l*i/100/12};
  }
  function calculateLand(values, areaM2) {
    var p=num(values.price), l=num(values.loan), i=num(values.interest), c=num(values.acquisition), a=num(areaM2);
    if([p,l,i,c].some(function(n){return n==null;})||p<=0||i>100)return {error:'매매가·대출·이자율·부대비용을 입력하세요. 이자율은 0~100%입니다.'};
    if(p-l+c<=0)return {error:'매매가 − 대출 + 취득비용이 0보다 커야 합니다.'};
    return {total:p+c,equity:p-l+c,interest:l*i/100/12,pricePerPy:a>0?p/(a/PY):null,costPerPy:a>0?(p+c)/(a/PY):null};
  }
  function parseParcels(text) {
    var rows=clean(text)?clean(text).split(/\r?\n/):[];
    if(rows.length>30)throw Error("필지는 최대 30개까지 입력할 수 있습니다.");
    var seen=new Set();
    return rows.map(function(line){var cells=line.split('|').map(clean),address=cells[0],area=num(cells[1]);
      if(cells.length!==2 || !/(?:동|리|읍|면)\s*(?:산\s*)?\d+(?:-\d+)?$/.test(address)||address.length>160||!(area>0))throw Error("각 줄을 '서구 도마동 49-38 | 167'처럼 정확한 지번 | 면적(㎡)으로 입력하세요.");
      var key=address.replace(/\s/g,"");if(seen.has(key))throw Error("같은 지번이 중복되었습니다.");seen.add(key);return {address:address,areaM2:area};});
  }
  function parcelTotals(parcels, askingPrice) {var area=parcels.reduce(function(sum,p){return sum+p.areaM2;},0),p=num(askingPrice);return {count:parcels.length,areaM2:area,areaPy:area/PY,pricePerPy:area>0&&p>0?p/(area/PY):null};}
  function sourceHtml(item) {
    var d=ui().saleSummary(item),paths=d.fieldSources||{},rows=[];
    Object.keys(paths).forEach(function(k){if(k==="landUse"||k==="zoning")rows.push((k==="landUse"?"지목":"용도지역")+": 공실박스 "+paths[k]);});
    return '<details class="sale-provenance sale-source-details-v1"><summary>출처·확인일 보기 · '+esc(item.source||'직접등록')+'</summary><div><p>제공처 확인일: '+esc(date(d.providerCheckedAt)||'미제공')+'</p><p>'+esc(rows.join(' / ')||'기본정보와 상세설명 기재값. 설명 추출값은 상세에 별도 표시합니다.')+'</p><p>확인일은 실제 계약 가능 여부를 보증하지 않습니다.</p></div></details>';
  }
  function detailTools(item,propertyId) {
    if(!ui().isSale(item))return "";
    // DOM-only data for the selected original; no stale global selected listing.
    var data={propertyId:propertyId||item.propertyId,originalId:item.originalId,tradeType:item.tradeType||item.trade_type,
      saleCategory:item.saleCategory||item.sale_category,salePrice:item.salePrice??item.sale_price,source:item.source,
      address:item.address,buildingName:item.buildingName||item.name,regDate:item.regDate,saleDetails:ui().saleSummary(item)};
    return '<div class="sale-tools-v1" data-sale-item="'+esc(JSON.stringify(data))+'"><button type="button" data-sale-action="lookup">토지이음 · 밸류맵 ↗</button><button type="button" data-sale-action="worksheet">'+(ui().normalizedSaleCategory(item)==="land"?'필지·매매 검토':'수익 계산·매매 검토')+'</button><button type="button" data-sale-action="report">개별 검토서</button></div>'+sourceHtml(item);
  }
  function modal(title,html,extraClass) {
    var previous=document.getElementById('saleWorkbenchDialogV1');if(previous)previous.remove();
    var dialog=document.createElement('dialog');dialog.id='saleWorkbenchDialogV1';dialog.className='sale-workbench-dialog'+(extraClass?' '+extraClass:'');
    dialog.innerHTML='<header><h2>'+esc(title)+'</h2><button type="button" data-sale-close aria-label="닫기">닫기 ×</button></header><div class="sale-workbench-body">'+html+'</div>';
    document.body.append(dialog);dialog.querySelector('[data-sale-close]').onclick=function(){dialog.close();};
    dialog.addEventListener('close',function(){if(active&&active.dialog===dialog)active=null;dialog.remove();});
    dialog.showModal();if(global.JSSaleDossierV9)global.JSSaleDossierV9.modalUnits(dialog);if(global.JSSaleReviewV10)global.JSSaleReviewV10.enhanceComparison(dialog);return dialog;
  }
  function lookup(item,options) {
    item=item||{};options=options||{};
    var service=global.JSParcelExternalLinksV1,parsed=service&&service.parseAddress(item.address),address=parsed?parsed.query:clean(item.address);
    var initialStatus=address?'지번 확인 중…':'지번 주소를 입력한 뒤 확인해 주세요.';
    var d=modal(options.title||'외부 부동산 조회','<p>지번을 확인한 뒤 해당 필지를 새 탭에서 바로 엽니다.</p><label>조회할 지번<input aria-label="조회 주소" value="'+esc(address)+'" placeholder="예: 도마동34-42 또는 대전 서구 도마동 34-42"></label><p class="sale-provenance">도마동34-42처럼 동과 지번만 입력해도 대전 기준으로 확인합니다. 정확히 한 필지일 때만 링크가 열리며 조회용 주소를 바꿔도 저장된 매물정보는 변경하지 않습니다.</p><div class="sale-tools-v1"><button type="button" data-check-parcel>지번 확인</button><button type="button" data-copy-address>주소 복사</button></div><p data-lookup-status role="status" aria-live="polite">'+initialStatus+'</p><div class="sale-tools-v1"><a data-parcel-link="eum" role="link" aria-disabled="true" tabindex="-1" target="_blank" rel="noopener noreferrer">토지이음 해당 필지 ↗</a><a data-parcel-link="valuemap" role="link" aria-disabled="true" tabindex="-1" target="_blank" rel="noopener noreferrer">밸류맵 해당 필지 ↗</a></div><p data-copy-status role="status"></p><details><summary>직접 검색이 필요한 경우</summary><p>조회 실패·주소 미공개·외부 서비스 제한 시 주소를 복사해 직접 검색하세요.</p><div class="sale-tools-v1"><a href="https://www.eum.go.kr/web/am/amMain.jsp" target="_blank" rel="noopener noreferrer">토지이음 홈</a><a href="https://www.valueupmap.com/" target="_blank" rel="noopener noreferrer">밸류맵 홈</a></div></details><p class="sale-provenance">외부 서비스의 로그인·열람제한·유료 기능은 해당 사이트 기준입니다. 외부 자료를 자동으로 가져오지는 않습니다.</p>',options.compact?'parcel-quick-dialog-v1':'');
    var sequence=0,field=d.querySelector('input'),status=d.querySelector('[data-lookup-status]'),button=d.querySelector('[data-check-parcel]');
    function clearLinks(){d.querySelectorAll('[data-parcel-link]').forEach(function(a){a.removeAttribute('href');a.setAttribute('aria-disabled','true');a.setAttribute('tabindex','-1');});}
    async function check(){
      var request=++sequence,query=field.value;clearLinks();button.disabled=true;status.textContent='정확한 지번을 확인하고 있습니다…';
      try{
        if(!service)throw Error('조회 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        var result=await service.resolve(query);
        if(!d.isConnected||!d.open||request!==sequence)return;
        field.value=result.address;status.textContent='확인된 지번: '+result.address;
        d.querySelectorAll('[data-parcel-link]').forEach(function(a){a.href=result.links[a.dataset.parcelLink];a.removeAttribute('aria-disabled');a.removeAttribute('tabindex');});
      }catch(e){if(d.isConnected&&d.open&&request===sequence)status.textContent=e.message;}
      finally{if(d.isConnected&&d.open&&request===sequence)button.disabled=false;}
    }
    field.addEventListener('input',function(){sequence++;clearLinks();button.disabled=false;status.textContent='주소를 변경했습니다. 지번 확인을 눌러 주세요.';});
    field.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();check();}});
    button.onclick=check;
    d.querySelector('[data-copy-address]').onclick=async function(){var copyStatus=d.querySelector('[data-copy-status]');try{await navigator.clipboard.writeText(field.value);copyStatus.textContent='주소를 복사했습니다.';}catch(_){field.select();copyStatus.textContent='자동 복사가 제한됩니다. 선택된 주소를 직접 복사하세요.';}};
    if(address)check();else if(field.focus)field.focus();
    return d;
  }
  function selectedListingAddress() {
    var selectedKey=clean(global.selectedItemKey);
    if(!selectedKey)return '';
    var selected=(global.allItems||[]).find(function(item){return clean(item&&item.key)===selectedKey;});
    return clean(selected&&selected.address);
  }
  function openTopLookup() {
    return lookup({address:selectedListingAddress()},{title:'토지·시세 바로조회',compact:true});
  }
  function calcDefaults(item) {
    var d=ui().saleSummary(item);
    return {price:item.salePrice ?? item.sale_price,deposit:d.totalDeposit,income:d.monthlyIncome,loan:d.loanAmount??0,interest:0,vacancy:0,expense:0,acquisition:0};
  }
  function calcInputs(item) {
    var values=calcDefaults(item);
    var labels={price:'매매가 (만원)',deposit:'임대보증금 합계 (만원)',income:'월 임대수입 (만원)',loan:'대출금 (만원)',interest:'연 대출이자율 (%)',vacancy:'공실률 (%)',expense:'월 운영비 (만원)',acquisition:'취득 부대비용 (만원)'};
    var keys=ui().normalizedSaleCategory(item)==='land'?['price','acquisition','loan','interest']:Object.keys(labels);
    return '<div class="sale-calculator-grid">'+keys.map(function(k){return '<label>'+labels[k]+'<input type="number" min="0" step="any" data-calc="'+k+'" aria-label="'+labels[k]+'" value="'+esc(values[k])+'"></label>';}).join('')+'</div>';
  }
  function readCalc(dialog) {var values={};dialog.querySelectorAll('[data-calc]').forEach(function(e){values[e.dataset.calc]=e.value;});return values;}
  function renderCalc(dialog) {
    var land=dialog.dataset.saleReview==='land',r=land?calculateLand(readCalc(dialog),dialog.dataset.landArea):calculate(readCalc(dialog)),out=dialog.querySelector('[data-calc-result]');
    if(global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.renderScenarios(dialog);
    if(global.JSSaleReviewV10)global.JSSaleReviewV10.renderFlow(dialog,readCalc(dialog),r);
    if(r.error){out.textContent=r.error;return r;}
    var rows=land?[['총 매입비용',price(r.total)],['가정 실투입',price(r.equity)],['월 대출이자',fmt(r.interest)+'만원'],['부대비용 포함 평당',r.costPerPy==null?'광고면적 필요':fmt(r.costPerPy)+'만원']]:[['가정 실투입',price(r.equity)],['월 현금흐름',fmt(r.monthly)+'만원'],['연 현금흐름',fmt(r.annual)+'만원'],['가정 연 수익률',fmt(r.yield,2)+'%']];
    var inputs=readCalc(dialog),basis=land?[['매매가',inputs.price],['취득 부대비용',inputs.acquisition],['대출금',inputs.loan]]:[['매매가',inputs.price],['보증금',inputs.deposit],['월 임대수입',inputs.income],['대출금',inputs.loan],['월 운영비',inputs.expense],['취득 부대비용',inputs.acquisition]];
    out.innerHTML='<h3 class="sale-own-result-title-v36">내 가정 계산 결과</h3><span class="sale-result-grid-v2">'+rows.map(function(f){return '<span><small>'+esc(f[0])+'</small><strong>'+esc(f[1])+'</strong></span>';}).join('')+'</span><p class="sale-evidence-note-v36">현재 입력: '+basis.map(function(pair){return esc(pair[0]+' '+fmt(num(pair[1]),2)+'만원');}).join(' · ')+' · 연 금리 '+esc(fmt(num(inputs.interest),2))+'%'+(land?' · 광고 토지면적 '+esc(fmt(num(dialog.dataset.landArea),2))+'㎡':' · 공실률 '+esc(fmt(num(inputs.vacancy),2))+'%')+'</p>';
    return r;
  }
  async function worksheet(item) {
    var key=clean(item.originalId||item.propertyId);
    if(!key){global.alert('매물 식별자를 확인할 수 없습니다.');return;}
    var dialog=modal('매매 검토 · '+(item.buildingName||item.name||item.address||''),'<p>'+esc(item.address)+' · 수집 매매가 '+esc(price(item.salePrice??item.sale_price))+'</p>'+calcInputs(item)+'<output data-calc-result aria-live="polite"></output><p class="sale-provenance">가정 계산: 월수입 × (1−공실률) − 월이자 − 운영비. 연 현금흐름 ÷ (매매가−보증금−대출+취득비용). 원금상환·소득세·양도세는 미반영입니다. 입력값은 수집된 원본이나 메인 카드 수익률을 바꾸지 않습니다.</p><details><summary>복수 필지 일괄 매매 관리</summary><p>전체 매매에 포함된 필지를 직접 확인해 입력하세요. 필지별 매물 자동 합치기·지도 좌표 변경은 하지 않습니다.</p><label>지번 | 면적(㎡) — 한 줄에 한 필지<textarea data-parcels rows="4" placeholder="서구 도마동 49-38 | 167\n서구 도마동 49-39 | 100"></textarea></label><button type="button" data-parcel-total>면적 합계 확인</button><output data-parcel-result aria-live="polite"></output></details><label>내 검토 메모<textarea data-work-note rows="3" maxlength="2000"></textarea></label><div class="sale-tools-v1"><button type="button" data-work-save disabled>내 계정에 검토 저장</button></div><p data-work-status role="status">저장된 검토 불러오는 중…</p>');
    var land=ui().normalizedSaleCategory(item)==='land';
    dialog.dataset.saleReview=land?'land':'building';dialog.dataset.landArea=clean(ui().saleSummary(item).landAreaM2);
    if(global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.mountScenarios(dialog);
    dialog.querySelector('h2').textContent=(land?'토지 매입비용·필지 검토':'건물 수익·매입 검토')+' · '+(item.buildingName||item.name||item.address||'');
    if(land)dialog.querySelector('[data-calc-result] + .sale-provenance').textContent='총 매입비용 = 매매가 + 직접 입력한 취득 부대비용. 평당비용은 광고 토지면적 기준입니다. 월 대출이자는 이자만 계산하며 세금 자동 산정·원금상환·보유비용은 포함하지 않습니다. 복수 필지 입력은 아래에서 별도로 검토합니다.';
    dialog.querySelector('.sale-calculator-grid').insertAdjacentHTML('beforebegin','<div class="sale-review-toolbar-v2"><button type="button" data-apply-collected>광고 금액 다시 적용</button><span>'+(land?'매매가만 적용 · 대출·부대비용 가정 유지':'매매가·보증금·월수입만 적용 · 대출·비용 가정 유지')+'</span></div>'+ui().saleCardFactsHtml(item));
    var context={key:key,dialog:dialog,version:0,ready:false,savedAssumptions:{},dirty:{},editRevision:0};active=context;
    var reviewFlow=global.JSSaleReviewFlowV12&&global.JSSaleReviewFlowV12.mountWorksheet(dialog,item);
    function edited(field){
      context.dirty[field]=true;context.editRevision++;
      dialog.querySelector('[data-work-status]').textContent='변경사항이 아직 저장되지 않았습니다.'+(context.ready?' 아래 저장 버튼을 눌러 주세요.':' 기존 검토를 불러온 뒤 저장할 수 있습니다.');
    }
    dialog.querySelectorAll('[data-calc]').forEach(function(e){e.addEventListener('input',function(){edited(e.dataset.calc);renderCalc(dialog);});});renderCalc(dialog);
    dialog.querySelector('[data-work-note]').addEventListener('input',function(){edited('note');});
    dialog.querySelector('[data-parcels]').addEventListener('input',function(){edited('parcels');});
    if(global.JSSaleDossierV9)global.JSSaleDossierV9.mountParcelTable(dialog,item);
    dialog.querySelector('[data-apply-collected]').onclick=function(){
      var defaults=calcDefaults(item);
      ['price','deposit','income'].forEach(function(k){var input=dialog.querySelector('[data-calc="'+k+'"]');if(input){input.value=defaults[k]==null?'':defaults[k];edited(k);}});
      renderCalc(dialog);
    };
    dialog.querySelector('[data-parcel-total]').onclick=function(){var out=dialog.querySelector('[data-parcel-result]');try{var p=parseParcels(dialog.querySelector('[data-parcels]').value),t=parcelTotals(p,readCalc(dialog).price);out.textContent=(p.length?p[0].address+(p.length>1?' 외 '+(p.length-1)+'필지':''):'필지 없음')+' · 총 '+fmt(t.areaM2)+'㎡ / '+fmt(t.areaPy)+'평 · 일괄 매매가 '+price(readCalc(dialog).price)+' · 평당 '+fmt(t.pricePerPy)+'만원';}catch(e){out.textContent=e.message;}};
    dialog.querySelector('[data-work-save]').onclick=async function(){
      if(active!==context||!context.ready)return;
      var status=dialog.querySelector('[data-work-status]'),button=this;button.disabled=true;
      try{
        var savingRevision=context.editRevision,parcels=parseParcels(dialog.querySelector('[data-parcels]').value),data={assumptions:Object.assign({},context.savedAssumptions,readCalc(dialog)),parcels:parcels,note:dialog.querySelector('[data-work-note]').value,source:item.source||'',address:clean(item.address),savedAt:new Date().toISOString()};
        var result=await global.JSDataAccessV6.mutate('saveCloudState',{scope:'saleWorksheetV1',recordKey:key,expectedAccountEmail:ACCOUNT_EMAIL,expectedVersion:context.version,data:data});
        context.version=result.version;context.savedAssumptions=Object.assign({},data.assumptions);
        if(reviewFlow)reviewFlow.loaded(data,true);
        status.textContent=context.editRevision===savingRevision?'내 계정에 저장했습니다. 다른 PC에서도 이 원본의 매매 검토에서 열 수 있습니다.':'저장 요청한 내용은 저장했습니다. 그 뒤 입력한 변경사항은 아직 저장되지 않았습니다.';
      }catch(e){if(accountChanged(e)){context.ready=false;status.textContent=accountChangedMessage();}else status.textContent='저장하지 못했습니다: '+e.message;}finally{if(active===context)button.disabled=!context.ready;}
    };
    try {
      if(!global.JSDataAccessV6)throw Error('계정 연결이 준비되지 않았습니다.');
      var r=await global.JSDataAccessV6.read('loadCloudState',{scope:'saleWorksheetV1',recordKey:key,expectedAccountEmail:ACCOUNT_EMAIL});
      if(active!==context)return;
      context.version=r.version||0;var saved=r.data||{};
      context.savedAssumptions=Object.assign({},saved.assumptions||{});
      if(saved.assumptions)dialog.querySelectorAll('[data-calc]').forEach(function(e){if(!context.dirty[e.dataset.calc]&&Object.hasOwn(saved.assumptions,e.dataset.calc))e.value=saved.assumptions[e.dataset.calc];});
      if(!context.dirty.parcels){dialog.querySelector('[data-parcels]').value=(saved.parcels||[]).map(function(p){return p.address+' | '+p.areaM2;}).join('\n');if(dialog._saleParcelTableV9)dialog._saleParcelTableV9.load();}
      if(!context.dirty.note)dialog.querySelector('[data-work-note]').value=saved.note||'';renderCalc(dialog);
      if(reviewFlow)reviewFlow.loaded(saved,r.found);
      context.ready=true;dialog.querySelector('[data-work-save]').disabled=false;
      dialog.querySelector('[data-work-status]').textContent=r.found?'저장된 내 검토: '+date(saved.savedAt||r.updatedAt)+' (현재 수집값과 다를 수 있습니다.)':land?'아직 저장된 검토가 없습니다. 부대비용·대출·이자율의 초기 0은 계산 가정입니다.':'아직 저장된 검토가 없습니다. 초기 0은 계산 가정이며 미제공 수입은 직접 확인하세요.';
      if(context.editRevision)dialog.querySelector('[data-work-status]').textContent='기존 검토를 불러왔습니다. 먼저 입력한 변경사항은 유지했으며 아직 저장되지 않았습니다.';
    } catch(e) {if(active===context){if(reviewFlow)reviewFlow.failed();dialog.querySelector('[data-work-status]').textContent=accountChanged(e)?accountChangedMessage():'검토 조회 실패: '+e.message+' · 계산은 가능하지만 기존 자료 보호를 위해 저장은 잠겼습니다.';}}
  }
  function landComparisonHtml(items,references){
    var service=global.JSSalePublicReviewV6;
    var refs=items.map(function(item,index){return references&&references[index]||{data:service&&service.cachedLandForComparison?service.cachedLandForComparison(item):null};});
    function value(i,key){var v=ui().saleSummary(i,[key])[key];return v==null||clean(v)===''?'미확인':clean(v);}
    function area(v){return num(v)>0?fmt(v/PY,2)+'평 ('+fmt(v,2)+'㎡)':'미확인';}
    function official(index){return refs[index].data||{};}
    function officialArea(i,index){var data=official(index),review=global.JSWideDetailV26;
      return review&&review.officialAreaReview?review.officialAreaReview(i,{land:{item:i,kind:'land',data:data}}).landAreaM2:null;
    }
    var rows=[['매물',function(i){return i.name||i.buildingName||'토지';}],['주소',function(i){return i.address||'미확인';}],['매매가',function(i){return price(i.salePrice??i.sale_price);}],
      ['토지면적 · 광고',function(i){return area(ui().saleSummary(i).landAreaM2);}],['토지 평당가 · 광고',function(i){var v=unitPrice(i);return v==null?'산정 불가':fmt(v,1)+'만원/평';}],
      ['지목 · 광고',function(i){return value(i,'landUse');}],['용도지역 · 광고',function(i){return value(i,'zoning');}],['도로접면 · 광고',function(i){return value(i,'roadAccess');}],['토지 형상 · 광고',function(i){return value(i,'parcelShape');}],
      ['지목 · 공부',function(i,n){return official(n).landUse||'미조회';}],['공부면적',function(i,n){return area(official(n).areaM2);}],
      ['평당가 · 공부 기준',function(i,n){var a=num(officialArea(i,n)),p=num(i.salePrice??i.sale_price);return a>0&&p>0?fmt(p/(a/PY),1)+'만원/평':'산정 보류';}],
      ['개별공시지가',function(i,n){var p=official(n).price||{},v=num(p.wonPerM2);return p.available&&v>0?fmt(v,0)+'원/㎡ · '+fmt(v*PY,0)+'원/평':'미조회';}],
      ['공시지가 기준',function(i,n){var p=official(n).price||{};return p.available&&p.baseYear?clean(p.baseYear)+'.'+String(p.baseMonth||1).padStart(2,'0'):'미조회';}],
      ['주요 지역·지구',function(i,n){var groups=official(n).regulations||[],labels=groups.flatMap(function(g){return (g.items||[]).map(function(r){return clean(r.label);});}).filter(Boolean);return labels.slice(0,3).join(' · ')+(labels.length>3?' 외 '+(labels.length-3)+'개':'')||'미조회';}],
      ['자료 확인',function(i,n){var ref=refs[n],data=official(n);return (i.printReviewWarningV22?'광고 상세 재확인 · ':'')+(ref.status|| (data.fetchedAt?'조회 '+date(data.fetchedAt).slice(0,10)+(data.complete?'':' · 일부 확인'):'공적자료 미조회'));}]];
    return '<p class="sale-land-compare-intro-v46">선택 매물 '+items.length+'개 · 광고와 공부를 구분해 비교 · A4 가로 1장 인쇄</p><label class="sale-compare-differences-control-v5"><input type="checkbox" data-compare-differences> 서로 다른 항목만 보기</label><div class="sale-compare-scroll"><table><tbody>'+rows.map(function(row){
      var values=items.map(row[1]),same=new Set(values).size===1;
      return '<tr data-land-compare-label="'+esc(row[0])+'"'+(same?' data-compare-same="true"':' class="sale-compare-different-v5"')+'><th scope="row">'+esc(row[0])+'</th>'+values.map(function(v){return '<td>'+esc(v)+'</td>';}).join('')+'</tr>';
    }).join('')+'<tr class="sale-land-compare-actions-v46"><th>상세 보기</th>'+items.map(function(i,n){return '<td><button type="button" data-compare-open="'+n+'">매물 열기</button></td>';}).join('')+'</tr></tbody></table></div><p class="sale-land-compare-note-v46">광고 평당가 = 매매가 ÷ 광고면적. 공부 기준은 동일 지번·매매범위를 확인한 경우에만 계산합니다. 공시지가는 호가와 별개입니다. 도로 표기만으로 진입·건축 가능 여부를 판단하지 마세요.</p>';
  }
  function comparisonHtml(items,references) {
    if(items.length&&items.every(function(i){return ui().normalizedSaleCategory(i)==='land';}))return landComparisonHtml(items,references);
    function value(i,key){return ui().saleSummary(i,[key])[key];}
    function field(label,key,suffix){return [label,function(i){var v=value(i,key);return v==null||clean(v)===''?'미확인':suffix==='만원'?(num(v)==null?'미확인':fmt(num(v),2)+'만원'):key==='approvalDate'?date(v):clean(v)+(suffix||'');}];}
    function area(i,key){var a=num(value(i,key));return a>0?fmt(a/PY,2)+'평 ('+fmt(a,2)+'㎡)':'미확인';}
    function unit(i,key){var a=num(value(i,key)),p=num(i.salePrice??i.sale_price);if(ui().buildingSaleExtent(i)==='unit')return '대상 면적 확인 필요';return p>0&&a>0?fmt(p/(a/PY),1)+'만원/평':'산정 불가';}
    var rows=[['매물',function(i){return i.name||i.buildingName||'건물';}],['주소',function(i){return i.address||'미확인';}],
      ['구분 · 매매 범위',function(i){return (categoryLabels[ui().normalizedSaleCategory(i)]||'기타')+' · '+ui().buildingSaleScopeLabel(i);}],
      ['매매가',function(i){return price(i.salePrice??i.sale_price);}],field('임대보증금 합계','totalDeposit','만원'),field('월 임대수입','monthlyIncome','만원'),
      ['단순 연 수익률',function(i){var y=ui().saleYield(i);return y==null?'산정 불가':fmt(y,2)+'%';}],
      ['매매가 − 보증금',function(i){var p=num(i.salePrice??i.sale_price),d=num(value(i,'totalDeposit'));return p>0&&d!=null&&p>d?price(p-d):'산정 불가';}],
      field('광고 융자금','loanAmount','만원'),field('광고 실투자금','investmentAmount','만원'),
      ['대지/토지 · 광고',function(i){return area(i,'landAreaM2');}],['연면적 · 광고',function(i){return area(i,'grossAreaM2');}],['전용면적 · 광고',function(i){return area(i,'exclusiveAreaM2');}],['건축면적 · 광고',function(i){return area(i,'buildingAreaM2');}],
      ['대지 기준 단가',function(i){return unit(i,'landAreaM2');}],['연면적 기준 단가',function(i){return unit(i,'grossAreaM2');}],
      ['매매 대상 · 층수',function(i){return ui().buildingFloorLabel(i)||'미확인';}],field('건축물 용도','buildingUse'),field('용도지역','zoning'),field('사용승인일','approvalDate'),
      ['세대 · 가구 · 방 수',function(i){return [['householdCount','세대'],['familyCount','가구'],['roomCount','실']].map(function(f){var n=num(value(i,f[0]));return n==null?'':fmt(n,0)+f[1];}).filter(Boolean).join(' · ')||'미확인';}],
      ['조건 확인',function(i){return i.printReviewWarningV22?'상세 재확인 필요 · 목록 기준':i.comparisonDetailCheckedV47?'선택 원본 상세 확인':'목록에 표시된 광고 기준';}]];
    if(items.some(function(i){return num(value(i,'monthlyNetIncome'))!=null||num(value(i,'statedMonthlyIncome'))!=null;}))rows.splice(10,0,['광고 월수익 · 별도',function(i){var net=num(value(i,'monthlyNetIncome')),stated=num(value(i,'statedMonthlyIncome'));return net!=null?fmt(net,2)+'만원 (이자 차감 표기)':stated!=null?fmt(stated,2)+'만원 (기준 미확인)':'미확인';}]);
    return '<p class="sale-land-compare-intro-v46">선택 매물 '+items.length+'개 · 선택한 원본의 광고 조건 비교 · A4 가로 인쇄</p><label class="sale-compare-differences-control-v5"><input type="checkbox" data-compare-differences> 서로 다른 항목만 보기</label><div class="sale-compare-scroll"><table><tbody>'+rows.map(function(row){
      var values=items.map(row[1]),same=new Set(values).size===1;
      return '<tr data-building-compare-label="'+esc(row[0])+'"'+(same?' data-compare-same="true"':' class="sale-compare-different-v5"')+'><th scope="row">'+esc(row[0])+'</th>'+values.map(function(v){return '<td>'+esc(v)+'</td>';}).join('')+'</tr>';
    }).join('')+'<tr class="sale-land-compare-actions-v46"><th>상세 보기</th>'+items.map(function(i,n){return '<td><button type="button" data-compare-open="'+n+'">매물 열기</button></td>';}).join('')+'</tr></tbody></table></div><p class="sale-land-compare-note-v46">단순 수익률 = 월 임대수입 × 12 ÷ (매매가 − 보증금). 대출이자·취득비용·세금·공실은 미반영입니다. 광고 월수익·실투자금은 별도 기재값이며, 면적은 광고 기준입니다.</p>';
  }
  function compare() {
    var items=selectedSaleItems();
    if(items.length<2||items.length>4||items.some(function(i){return !ui().isSale(i)||(ui().normalizedSaleCategory(i)==='land')!==(ui().getMode()==='land_sale');}))return global.alert('같은 매매 화면에서 매물 2~4개를 체크해 주세요.');
    var land=ui().getMode()==='land_sale',references=items.map(function(item){var s=global.JSSalePublicReviewV6;return {data:s&&s.cachedLandForComparison?s.cachedLandForComparison(item):null};});
    var dialog=modal((land?'토지':'건물·공간')+' 매물 비교','<div class="sale-compare-controls-v2">'+(land?'<button type="button" data-land-compare-load>토지정보 채우기</button><span data-land-compare-status role="status">공적자료는 버튼을 누르면 최대 4개 필지만 조회합니다.</span>':'<button type="button" data-building-compare-load>상세조건 다시 확인</button><span data-land-compare-status role="status"></span>')+'<button type="button" data-sale-print>비교표 인쇄</button></div><div data-compare-content>'+comparisonHtml(items,references)+'</div>','sale-comparison-dialog-v2 sale-a4-comparison-v47'+(land?' sale-land-comparison-v46':' sale-building-comparison-v47'));
    dialog.querySelector('[data-sale-print]').onclick=function(){global.print();};
    function bind(){
      dialog.querySelector('[data-compare-differences]').onchange=function(event){dialog.querySelectorAll('[data-compare-same]').forEach(function(row){row.hidden=event.target.checked;});};
      dialog.querySelectorAll('[data-compare-open]').forEach(function(b){b.onclick=function(){var item=items[Number(b.dataset.compareOpen)];dialog.close();if(global.JSUnifiedListingsV8)global.JSUnifiedListingsV8.open(item.propertyId);};});
    }
    bind();
    function refreshComparison(){
      var different=dialog.querySelector('[data-compare-differences]').checked,previous=dialog.querySelector('.sale-compare-scroll'),scrollTop=previous.scrollTop,scrollLeft=previous.scrollLeft;
      dialog.querySelector('[data-compare-content]').innerHTML=comparisonHtml(items,references);
      if(global.JSSaleDossierV9)global.JSSaleDossierV9.refreshUnits(dialog);
      if(global.JSSaleReviewV10)global.JSSaleReviewV10.enhanceComparison(dialog);bind();
      var control=dialog.querySelector('[data-compare-differences]');control.checked=different;if(different)control.dispatchEvent(new Event('change'));
      var current=dialog.querySelector('.sale-compare-scroll');current.scrollTop=scrollTop;current.scrollLeft=scrollLeft;
    }
    if(!land){
      var load=dialog.querySelector('[data-building-compare-load]');
      load.onclick=async function(){
        var reader=global.JSUnifiedListingsV8,status=dialog.querySelector('[data-land-compare-status]'),next=0,failed=0;
        if(!reader||!reader.printItem){status.textContent='광고 상세를 준비하지 못했습니다. 현재 목록 기준으로 비교합니다.';return;}
        load.disabled=true;dialog.querySelector('[data-sale-print]').disabled=true;status.textContent='선택한 원본 광고의 상세조건을 확인하고 있습니다…';
        await Promise.all([0,1].map(async function(){while(next<items.length&&dialog.isConnected){var n=next++;try{var item=await reader.printItem(items[n]);if(item.printReviewWarningV22)failed++;items[n]=Object.assign({},item,{comparisonDetailCheckedV47:!item.printReviewWarningV22});}catch(e){failed++;items[n]=Object.assign({},items[n],{printReviewWarningV22:true});}}}));
        if(!dialog.isConnected)return;refreshComparison();load.disabled=false;dialog.querySelector('[data-sale-print]').disabled=false;
        status.textContent=failed?failed+'개 상세 확인 실패 · 해당 열은 목록 기준입니다.':'선택한 원본의 최신 상세조건을 반영했습니다.';
      };
      load.click();
    }
    if(land)dialog.querySelector('[data-land-compare-load]').onclick=async function(){
      var button=this,status=dialog.querySelector('[data-land-compare-status]'),service=global.JSSalePublicReviewV6,next=0,failed=0;
      if(!service||!service.landForComparison){status.textContent='토지정보 조회를 준비하지 못했습니다. 새로고침 후 다시 눌러 주세요.';return;}
      button.disabled=true;dialog.querySelector('[data-sale-print]').disabled=true;status.textContent='정확한 지번과 토지정보를 확인하고 있습니다…';
      await Promise.all([0,1].map(async function(){while(next<items.length&&dialog.isConnected){var n=next++;try{if(global.JSUnifiedListingsV8&&global.JSUnifiedListingsV8.printItem)items[n]=await global.JSUnifiedListingsV8.printItem(items[n]);if(!dialog.isConnected)return;references[n]={data:await service.landForComparison(items[n])};}catch(e){failed++;references[n]={status:'조회 실패 · 지번 확인 필요'};}}}));
      if(!dialog.isConnected)return;
      refreshComparison();
      status.textContent=failed?items.length+'개 중 '+failed+'개 조회 실패 · 나머지 자료를 반영했습니다.':'토지정보 반영 완료 · 선택한 원본의 최신 광고값으로 비교합니다.';button.disabled=false;dialog.querySelector('[data-sale-print]').disabled=false;
    };
  }
  global.JSSaleWorkbenchV1={price:price,unitPrice:unitPrice,matches:matches,filterValues:filterValues,filterIds:filterIds,reset:reset,clearChip:clearChip,chips:chips,syncMode:syncMode,sortLabel:sortLabel,sortValue:sortValue,compareSortValues:compareSortValues,syncComparisonTray:syncComparisonTray,calculate:calculate,calculateLand:calculateLand,parseParcels:parseParcels,parcelTotals:parcelTotals,detailTools:detailTools,lookup:lookup,openTopLookup:openTopLookup,worksheet:worksheet,compare:compare,comparisonHtml:comparisonHtml,modal:modal};
  mountFilters();
  global.addEventListener('js-listing-trade-mode-change',syncMode);
  document.addEventListener('click',function(event){var b=event.target.closest('[data-sale-action]');if(!b)return;var parent=b.closest('[data-sale-item]');if(!parent)return;event.stopPropagation();try{var item=JSON.parse(parent.dataset.saleItem);if(b.dataset.saleAction==='lookup')lookup(item);else if(b.dataset.saleAction==='report'&&global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.report(item,parent);else if(b.dataset.saleAction==='worksheet')worksheet(item);}catch(e){global.alert(e.message);}});
})(window);
