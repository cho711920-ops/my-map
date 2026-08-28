(function (global) {
  "use strict";
  var PY = 3.305785;
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
  function esc(v) { return clean(v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function num(v) { if(v == null || typeof v === "boolean" || clean(v)==="") return null; var n=Number(clean(v).replace(/,/g,"")); return Number.isFinite(n) && n>=0 ? n : null; }
  function fmt(v,d) { return v == null || !Number.isFinite(Number(v)) ? "미확인" : Number(v).toLocaleString("ko-KR",{maximumFractionDigits:d==null?1:d}); }
  function price(v) {
    var n=num(v); if(n==null || n<=0) return "매매가 미확인";
    var e=Math.floor(n/10000), m=Math.round((n-e*10000)*100)/100;
    return (e?fmt(e,0)+"억":"")+(m?fmt(m,2)+"만":"")+"원";
  }
  function unitPrice(item) { var d=ui().saleSummary(item),p=num(item.salePrice ?? item.sale_price),a=num(d.landAreaM2); return p>0 && a>0 ? p/(a/PY) : null; }
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
    return '<details class="sale-provenance sale-source-details-v1"><summary>출처·확인일 보기 · '+esc(item.source||'직접등록')+'</summary><div><p>제공처 확인일: '+esc(d.providerCheckedAt||'미제공')+'</p><p>'+esc(rows.join(' / ')||'기본정보와 상세설명 기재값. 설명 추출값은 상세에 별도 표시합니다.')+'</p><p>확인일은 실제 계약 가능 여부를 보증하지 않습니다.</p></div></details>';
  }
  function detailTools(item,propertyId) {
    if(!ui().isSale(item))return "";
    // DOM-only data for the selected original; no stale global selected listing.
    var data={propertyId:propertyId||item.propertyId,originalId:item.originalId,tradeType:item.tradeType||item.trade_type,
      saleCategory:item.saleCategory||item.sale_category,salePrice:item.salePrice??item.sale_price,source:item.source,
      address:item.address,buildingName:item.buildingName||item.name,saleDetails:ui().saleSummary(item)};
    return '<div class="sale-tools-v1" data-sale-item="'+esc(JSON.stringify(data))+'"><button type="button" data-sale-action="lookup">토지이음 · 밸류맵 ↗</button><button type="button" data-sale-action="worksheet">'+(ui().normalizedSaleCategory(item)==="land"?'필지·매매 검토':'수익 계산·매매 검토')+'</button></div>'+sourceHtml(item);
  }
  function modal(title,html) {
    var previous=document.getElementById('saleWorkbenchDialogV1');if(previous)previous.remove();
    var dialog=document.createElement('dialog');dialog.id='saleWorkbenchDialogV1';dialog.className='sale-workbench-dialog';
    dialog.innerHTML='<header><h2>'+esc(title)+'</h2><button type="button" data-sale-close aria-label="닫기">닫기 ×</button></header><div class="sale-workbench-body">'+html+'</div>';
    document.body.append(dialog);dialog.querySelector('[data-sale-close]').onclick=function(){dialog.close();};
    dialog.addEventListener('close',function(){if(active&&active.dialog===dialog)active=null;dialog.remove();});
    dialog.showModal();return dialog;
  }
  function lookup(item) {
    var service=global.JSParcelExternalLinksV1,parsed=service&&service.parseAddress(item.address),address=parsed?parsed.query:clean(item.address);
    var d=modal('외부 부동산 조회','<p>지번을 확인한 뒤 해당 필지를 새 탭에서 바로 엽니다.</p><label>조회할 지번<input aria-label="조회 주소" value="'+esc(address)+'"></label><p class="sale-provenance">시 이름이 생략된 동구·중구·서구·유성구·대덕구는 대전 기준입니다. 조회용 주소를 바꿔도 저장된 매물정보는 변경하지 않습니다.</p><div class="sale-tools-v1"><button type="button" data-check-parcel>지번 확인</button><button type="button" data-copy-address>주소 복사</button></div><p data-lookup-status role="status" aria-live="polite">지번 확인 중…</p><div class="sale-tools-v1"><a data-parcel-link="eum" role="link" aria-disabled="true" tabindex="-1" target="_blank" rel="noopener noreferrer">토지이음 해당 필지 ↗</a><a data-parcel-link="valuemap" role="link" aria-disabled="true" tabindex="-1" target="_blank" rel="noopener noreferrer">밸류맵 해당 필지 ↗</a></div><p data-copy-status role="status"></p><details><summary>직접 검색이 필요한 경우</summary><p>조회 실패·주소 미공개·외부 서비스 제한 시 주소를 복사해 직접 검색하세요.</p><div class="sale-tools-v1"><a href="https://www.eum.go.kr/web/am/amMain.jsp" target="_blank" rel="noopener noreferrer">토지이음 홈</a><a href="https://www.valueupmap.com/" target="_blank" rel="noopener noreferrer">밸류맵 홈</a></div></details><p class="sale-provenance">외부 서비스의 로그인·열람제한·유료 기능은 해당 사이트 기준입니다. 외부 자료를 자동으로 가져오지는 않습니다.</p>');
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
    check();return d;
  }
  function calcInputs(item) {
    var d=ui().saleSummary(item),values={price:item.salePrice ?? item.sale_price,deposit:d.totalDeposit,income:d.monthlyIncome,loan:d.loanAmount??0,interest:0,vacancy:0,expense:0,acquisition:0};
    var labels={price:'매매가 (만원)',deposit:'임대보증금 합계 (만원)',income:'월 임대수입 (만원)',loan:'대출금 (만원)',interest:'연 대출이자율 (%)',vacancy:'공실률 (%)',expense:'월 운영비 (만원)',acquisition:'취득 부대비용 (만원)'};
    return '<div class="sale-calculator-grid">'+Object.keys(labels).map(function(k){return '<label>'+labels[k]+'<input type="number" min="0" step="any" data-calc="'+k+'" aria-label="'+labels[k]+'" value="'+esc(values[k])+'"></label>';}).join('')+'</div>';
  }
  function readCalc(dialog) {var values={};dialog.querySelectorAll('[data-calc]').forEach(function(e){values[e.dataset.calc]=e.value;});return values;}
  function renderCalc(dialog) {
    var r=calculate(readCalc(dialog)),out=dialog.querySelector('[data-calc-result]');
    out.textContent=r.error||'가정 실투입 '+fmt(r.equity)+'만원 · 월 현금흐름 '+fmt(r.monthly)+'만원 · 연 '+fmt(r.yield,2)+'%';
    return r;
  }
  async function worksheet(item) {
    var key=clean(item.originalId||item.propertyId);
    if(!key){global.alert('매물 식별자를 확인할 수 없습니다.');return;}
    var dialog=modal('매매 검토 · '+(item.buildingName||item.name||item.address||''),'<p>'+esc(item.address)+' · 수집 매매가 '+esc(price(item.salePrice??item.sale_price))+'</p>'+calcInputs(item)+'<output data-calc-result aria-live="polite"></output><p class="sale-provenance">가정 계산: 월수입 × (1−공실률) − 월이자 − 운영비. 연 현금흐름 ÷ (매매가−보증금−대출+취득비용). 원금상환·소득세·양도세는 미반영입니다. 입력값은 수집된 원본이나 메인 카드 수익률을 바꾸지 않습니다.</p><details><summary>복수 필지 일괄 매매 관리</summary><p>전체 매매에 포함된 필지를 직접 확인해 입력하세요. 필지별 매물 자동 합치기·지도 좌표 변경은 하지 않습니다.</p><label>지번 | 면적(㎡) — 한 줄에 한 필지<textarea data-parcels rows="4" placeholder="서구 도마동 49-38 | 167\n서구 도마동 49-39 | 100"></textarea></label><button type="button" data-parcel-total>면적 합계 확인</button><output data-parcel-result aria-live="polite"></output></details><label>내 검토 메모<textarea data-work-note rows="3" maxlength="2000"></textarea></label><div class="sale-tools-v1"><button type="button" data-work-save disabled>내 계정에 검토 저장</button></div><p data-work-status role="status">저장된 검토 불러오는 중…</p>');
    var context={key:key,dialog:dialog,version:0,ready:false};active=context;
    dialog.querySelectorAll('[data-calc]').forEach(function(e){e.addEventListener('input',function(){renderCalc(dialog);});});renderCalc(dialog);
    dialog.querySelector('[data-parcel-total]').onclick=function(){var out=dialog.querySelector('[data-parcel-result]');try{var p=parseParcels(dialog.querySelector('[data-parcels]').value),t=parcelTotals(p,readCalc(dialog).price);out.textContent=(p.length?p[0].address+(p.length>1?' 외 '+(p.length-1)+'필지':''):'필지 없음')+' · 총 '+fmt(t.areaM2)+'㎡ / '+fmt(t.areaPy)+'평 · 일괄 매매가 '+price(readCalc(dialog).price)+' · 평당 '+fmt(t.pricePerPy)+'만원';}catch(e){out.textContent=e.message;}};
    dialog.querySelector('[data-work-save]').onclick=async function(){
      if(active!==context||!context.ready)return;
      var status=dialog.querySelector('[data-work-status]'),button=this;button.disabled=true;
      try{
        var parcels=parseParcels(dialog.querySelector('[data-parcels]').value),data={assumptions:readCalc(dialog),parcels:parcels,note:dialog.querySelector('[data-work-note]').value,source:item.source||'',address:clean(item.address),savedAt:new Date().toISOString()};
        var result=await global.JSDataAccessV6.mutate('saveCloudState',{scope:'saleWorksheetV1',recordKey:key,expectedVersion:context.version,data:data});
        context.version=result.version;status.textContent='내 계정에 저장했습니다. 다른 PC에서도 이 원본의 매매 검토에서 열 수 있습니다.';
      }catch(e){status.textContent='저장하지 못했습니다: '+e.message;}finally{if(active===context)button.disabled=false;}
    };
    try {
      if(!global.JSDataAccessV6)throw Error('계정 연결이 준비되지 않았습니다.');
      var r=await global.JSDataAccessV6.read('loadCloudState',{scope:'saleWorksheetV1',recordKey:key});
      if(active!==context)return;
      context.version=r.version||0;var saved=r.data||{};
      if(saved.assumptions)dialog.querySelectorAll('[data-calc]').forEach(function(e){if(Object.hasOwn(saved.assumptions,e.dataset.calc))e.value=saved.assumptions[e.dataset.calc];});
      dialog.querySelector('[data-parcels]').value=(saved.parcels||[]).map(function(p){return p.address+' | '+p.areaM2;}).join('\n');
      dialog.querySelector('[data-work-note]').value=saved.note||'';renderCalc(dialog);
      context.ready=true;dialog.querySelector('[data-work-save]').disabled=false;
      dialog.querySelector('[data-work-status]').textContent=r.found?'저장된 내 검토: '+(saved.savedAt||r.updatedAt)+' (현재 수집값과 다를 수 있습니다.)':'아직 저장된 검토가 없습니다. 초기 0은 계산 가정이며 미제공 수입은 직접 확인하세요.';
    } catch(e) {if(active===context)dialog.querySelector('[data-work-status]').textContent='검토 조회 실패: '+e.message+' · 계산은 가능하지만 기존 자료 보호를 위해 저장은 잠겼습니다.';}
  }
  function comparisonHtml(items) {
    var rows=[['매물',function(i){return i.name||i.buildingName||'-';}],['주소',function(i){return i.address||'미확인';}],['구분',function(i){return categoryLabels[ui().normalizedSaleCategory(i)]||'토지';}],['매매가',function(i){return price(i.salePrice??i.sale_price);}],['대지/토지',function(i){var a=num(ui().saleSummary(i).landAreaM2);return a>0?fmt(a/PY)+'평':'미확인';}],['연면적',function(i){var a=num(ui().saleSummary(i).grossAreaM2);return a>0?fmt(a/PY)+'평':'미확인';}],['단순 연 수익률',function(i){var y=ui().saleYield(i);return y==null?'미확인':fmt(y,2)+'%';}],['지목 / 용도지역',function(i){var d=ui().saleSummary(i);return (d.landUse||'미확인')+' / '+(d.zoning||'미확인');}],['출처',function(i){return i.source||'직접등록';}]];
    return '<p>선택된 대표 매물 '+items.length+'개 · 수익률은 보증금 차감·대출 미반영 단순 연 수익률입니다.</p><div class="sale-compare-scroll"><table><tbody>'+rows.map(function(r){return '<tr><th scope="row">'+r[0]+'</th>'+items.map(function(i){return '<td>'+esc(r[1](i))+'</td>';}).join('')+'</tr>';}).join('')+'<tr><th scope="row">연락처/원본</th>'+items.map(function(i,n){return '<td><button type="button" data-compare-open="'+n+'">매물 열기</button><small>기존 전화·원본 버튼 이용</small></td>';}).join('')+'</tr></tbody></table></div>';
  }
  function compare() {
    var items=typeof global.getSelectedPrintItems==='function'?global.getSelectedPrintItems():[];
    if(items.length<2||items.length>4||items.some(function(i){return !ui().isSale(i);}))return global.alert('같은 매매 화면에서 매물 2~4개를 체크해 주세요.');
    var dialog=modal('매매 매물 비교',comparisonHtml(items));
    dialog.querySelectorAll('[data-compare-open]').forEach(function(b){b.onclick=function(){var item=items[Number(b.dataset.compareOpen)];dialog.close();if(global.JSUnifiedListingsV8)global.JSUnifiedListingsV8.open(item.propertyId);};});
  }
  global.JSSaleWorkbenchV1={price:price,unitPrice:unitPrice,matches:matches,filterValues:filterValues,filterIds:filterIds,reset:reset,clearChip:clearChip,chips:chips,syncMode:syncMode,calculate:calculate,parseParcels:parseParcels,parcelTotals:parcelTotals,detailTools:detailTools,lookup:lookup,worksheet:worksheet,compare:compare,comparisonHtml:comparisonHtml};
  mountFilters();
  global.addEventListener('js-listing-trade-mode-change',syncMode);
  document.addEventListener('click',function(event){var b=event.target.closest('[data-sale-action]');if(!b)return;var parent=b.closest('[data-sale-item]');if(!parent)return;event.stopPropagation();try{var item=JSON.parse(parent.dataset.saleItem);if(b.dataset.saleAction==='lookup')lookup(item);else worksheet(item);}catch(e){global.alert(e.message);}});
})(window);
