/* Sale-only public reference panels. No advertisement, worksheet or listing writes. */
(function(global){
  'use strict';
  var PY=3.305785, parcels=new Map(), transactions=new Map(), landFacts=new Map();
  var account=String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();
  function text(v){return String(v==null?'':v).trim();}
  function esc(v){return text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){if(v==null||typeof v==='boolean'||!text(v))return null;var n=Number(text(v).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;}
  function fmt(v){return num(v)==null?'미제공':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});}
  function area(v){return num(v)>0?fmt(v)+'㎡ · '+fmt(v/PY)+'평':'';}
  function date(v){var s=text(v);return /^\d{8}$/.test(s)?s.slice(0,4)+'.'+s.slice(4,6)+'.'+s.slice(6):s;}
  function sumKnown(values){return values.every(function(v){return num(v)!=null;})?values.reduce(function(s,v){return s+Number(v);},0):null;}
  function money(v){return global.JSSaleWorkbenchV1.price(v);}
  function rowsHtml(rows){return '<dl class="sale-public-facts-v6">'+rows.filter(function(r){return r[1]!==''&&r[1]!=null;}).map(function(r){return '<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>';}).join('')+'</dl>';}
  function parcelObject(result){var p=result.pnu;return {sigunguCd:p.slice(0,5),bjdongCd:p.slice(5,10),platGbCd:p[10]==='2'?'1':'0',bun:p.slice(11,15),ji:p.slice(15),lotAddress:result.address};}
  function cache(map,key,value){if(map.size>=80)map.delete(map.keys().next().value);map.set(key,value);}
  function active(el){var drawer=el.closest('#unifiedDetailDrawerV8');return el.isConnected&&(!drawer||drawer.getAttribute('aria-hidden')!=='true')&&global.JSListingTradeV1.getMode()!=='lease';}
  function revealResult(button,target){
    // A disabled loading button loses focus to body in Chromium. Preserve the
    // user's lookup intent, but don't move a reader who focused another control.
    var body=button.closest('.unified-detail-body-v8');if(!body||(document.activeElement!==button&&document.activeElement!==document.body)||!active(target))return;
    var bounds=body.getBoundingClientRect(),b=button.getBoundingClientRect();
    if(b.bottom<=bounds.top||b.top>=bounds.bottom)return;
    var nav=body.querySelector('.sale-dossier-nav-v3');
    body.scrollTo({top:Math.max(0,body.scrollTop+target.getBoundingClientRect().top-bounds.top-(nav?nav.offsetHeight:0)-12),behavior:'instant'});
  }
  async function resolve(item){
    var key=text(item.address),saved=parcels.get(key);
    if(saved&&Date.now()-saved.at<600000)return saved.result;
    if(!global.JSParcelExternalLinksV1)throw Error('지번 조회를 준비하지 못했습니다. 새로고침 후 다시 눌러 주세요.');
    var result=await global.JSParcelExternalLinksV1.resolve(key);cache(parcels,key,{at:Date.now(),result:result});return result;
  }
  async function read(query){
    var url=new URL('/api/data',global.location.origin);Object.keys(query).forEach(function(k){url.searchParams.set(k,query[k]);});
    if(account)url.searchParams.set('expectedAccountEmail',account);
    var response=await global.fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000)}),data=await response.json();
    if(!response.ok||!data.ok)throw Object.assign(Error(data.message||'공식 자료를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.'),{code:data.code||''});
    return data;
  }
  function buildingRows(b){
    var self=sumKnown([b.indoorSelfParking,b.outdoorSelfParking]),mechanical=sumKnown([b.indoorMechanicalParking,b.outdoorMechanicalParking]);
    var total=sumKnown([self,mechanical]),elevators=sumKnown([b.passengerElevators,b.emergencyElevators]);
    return [['주용도',b.mainUse],['기타용도',b.otherUse],['주구조',[b.structure,b.otherStructure].filter(Boolean).join(' · ')],
      ['사용승인일',date(b.approvalDate)],['대장 대지면적',area(b.siteArea)],['대장 건축면적',area(b.buildingArea)],
      ['대장 연면적',area(b.totalArea)],['용적률 산정용 연면적',area(b.floorArea)],
      ['건폐율',num(b.buildingCoverageRatio)!=null?fmt(b.buildingCoverageRatio)+'%':''],['용적률',num(b.floorAreaRatio)!=null?fmt(b.floorAreaRatio)+'%':''],
      ['주차 총대수',total==null?'':fmt(total)+'대'],['자주식 주차',self==null?'':fmt(self)+'대'],['기계식 주차',mechanical==null?'':fmt(mechanical)+'대'],
      ['승강기',elevators==null?'':fmt(elevators)+'대']];
  }
  function buildingHtml(data,index,item){
    var buildings=data.buildings||[],b=buildings[index];
    if(!b)return '<p>이 지번에서 건축물 표제부를 확인하지 못했습니다. 대장 조회에서 주소·건물 구성을 확인해 주세요.</p>';
    var missing=buildingRows(b).filter(function(r){return r[1]===''||r[1]==null;}).map(function(r){return r[0];});
    var d=item.saleDetails||{},pair=[['주용도',d.buildingUse,b.mainUse],['사용승인일',date(d.approvalDate),date(b.approvalDate)]].filter(function(r){return r[1]&&r[2];});
    return '<p class="sale-public-address-v6">'+esc(b.lotAddress||data.parcel&&data.parcel.lotAddress)+' · '+esc([b.buildingName,b.dongName,b.registerType].filter(Boolean).join(' · '))+'</p>'+rowsHtml(buildingRows(b))+
      (pair.length?'<details class="sale-public-crosscheck-v6"><summary>광고와 대장 나란히 보기</summary><table><thead><tr><th>항목</th><th>광고 기재</th><th>건축물대장</th></tr></thead><tbody>'+pair.map(function(r){return '<tr><th>'+esc(r[0])+'</th><td>'+esc(r[1])+'</td><td>'+esc(r[2])+'</td></tr>';}).join('')+'</tbody></table></details>':'')+
      (missing.length?'<details class="sale-public-missing-v6"><summary>자료 미제공 항목 '+missing.length+'개</summary><p>'+esc(missing.join(' · '))+'</p></details>':'')+
      '<p class="sale-public-footnote-v6">대장 면적은 선택한 건물 기준입니다. 광고의 일부 지분·전유면적·일괄매매 면적과 다를 수 있습니다. 주차대수는 빈 주차면 수가 아닙니다.</p>'+
      '<p class="sale-public-source-v6">'+esc(data.source||'국토교통부 건축물대장')+' · 조회 '+esc(data.queriedAt||date(data.fetchedAt)||'일시 미제공')+(data.cached?' · 저장된 조회자료':'')+(data.incomplete||data.partial||data.refreshDeferred?' · 일부 자료 또는 갱신 확인 필요':'')+'</p>';
  }
  function section(key,title,description,button){
    var el=document.createElement('section');el.className='sale-public-panel-v6';el.dataset.saleSection=key;
    el.innerHTML='<header><div><span>매입 검토 자료</span><h3>'+title+'</h3></div><button type="button" data-public-load>'+button+'</button></header><p class="sale-public-intro-v6">'+description+'</p><p data-public-status role="status" aria-live="polite"></p><div data-public-content></div>';
    return el;
  }
  function mountBuilding(root,item){
    var el=section('register','건물 제원','주차·구조·건폐율·용적률을 건축물대장 기준으로 확인합니다.','건물 제원 조회'),button=el.querySelector('button'),out=el.querySelector('[data-public-content]'),status=el.querySelector('[data-public-status]');
    function show(data){
      var buildings=data.buildings||[];
      out.innerHTML=(buildings.length>1?'<label class="sale-public-building-choice-v6">이 지번의 건물·동 선택<select aria-label="건물 제원 건물 선택"><option value="">'+buildings.length+'개 건물 중 선택</option>'+buildings.map(function(b,i){return '<option value="'+i+'">'+esc([b.buildingName,b.dongName,b.mainUse].filter(Boolean).join(' · ')||'건물 '+(i+1))+'</option>';}).join('')+'</select></label>':'')+'<div data-public-building></div>';
      var body=out.querySelector('[data-public-building]'),select=out.querySelector('select');
      function reference(index){if(global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.reference(root,item,'building',index==null?null:Object.assign({},buildings[index],{source:data.source,queriedAt:data.queriedAt,fetchedAt:data.fetchedAt,partial:!!(data.incomplete||data.partial||data.refreshDeferred)}));}
      if(select){body.innerHTML='<p>한 필지에 여러 건물이 있습니다. 확인할 건물·동을 선택해 주세요.</p>';reference(null);select.onchange=function(){body.innerHTML=this.value===''?'':buildingHtml(data,Number(this.value),item);reference(this.value===''?null:Number(this.value));if(global.JSSaleDossierV9)global.JSSaleDossierV9.refreshUnits(out);};}
      else {body.innerHTML=buildingHtml(data,0,item);reference(buildings.length?0:null);}
      if(global.JSSaleDossierV9)global.JSSaleDossierV9.refreshUnits(out);
    }
    var cached=parcels.get(text(item.address)),reader=global.JSBuildingRegisterReadOnlyV6;
    if(cached&&Date.now()-cached.at<600000&&reader){var data=reader.cached(parcelObject(cached.result));if(data&&data.ok)show(data);}
    button.onclick=async function(){
      button.disabled=true;status.textContent='지번과 대장 자료를 확인하고 있습니다…';
      if(global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.reference(root,item,'building',null);
      try{var result=await resolve(item);if(!active(el))return;if(!global.JSBuildingRegisterReadOnlyV6)throw Error('건축물대장 기능을 준비하지 못했습니다. 새로고침 후 다시 눌러 주세요.');var data=await global.JSBuildingRegisterReadOnlyV6.load(parcelObject(result));if(!active(el))return;show(data);status.textContent='확인한 지번: '+result.address;button.textContent='다시 확인';revealResult(button,out);}
      catch(e){if(active(el))status.textContent=e.message;}
      finally{button.disabled=false;}
    };
    root.append(el);
    if(global.JSSaleDossierV9)global.JSSaleDossierV9.mountFloors(root,item);
  }
  function landPublicHtml(data,item){
    var p=data.price||{},d=item.saleDetails||{},amount=num(p.wonPerM2),regulations=Array.isArray(data.regulations)?data.regulations:[];
    var price=p.available&&amount>0?'<div class="sale-public-land-price-v7"><span>개별공시지가 · '+esc(p.baseYear)+'.'+esc(String(p.baseMonth).padStart(2,'0'))+' 기준</span><strong>'+esc(fmt(amount))+'<small> 원/㎡</small></strong><span>평당 환산 '+esc(fmt(amount*PY))+'원 · 매도호가와 구분</span></div>':'<p class="sale-public-partial-v7">'+esc(p.message||'공시지가가 제공되지 않았습니다. 공식 원문에서 확인해 주세요.')+'</p>';
    var difference=!item.referenceAddressChangedV8&&num(d.landAreaM2)>0&&Math.abs(Number(d.landAreaM2)-Number(data.areaM2))>1;
    return '<span class="sale-public-label-v6">공적자료 · 토지이음 공개 열람</span><p class="sale-public-address-v6">'+esc(data.address)+'</p>'+rowsHtml([['공식 지목',data.landUse],['공부면적',area(data.areaM2)]])+price+
      (difference?'<p class="sale-public-partial-v7">광고면적 '+esc(area(d.landAreaM2))+'과 공부면적이 다릅니다. 일부 지분·복수 필지 여부를 확인하세요. 목록의 평당가는 광고면적을 유지합니다.</p>':'')+
      (global.JSSaleReviewEnhancementsV8?global.JSSaleReviewEnhancementsV8.roadHtml(item,data):'')+
      regulations.map(function(group){var items=Array.isArray(group.items)?group.items:[];
        return '<details class="sale-public-regulations-v7"'+(group.key==='planning'?' open':'')+'><summary>'+esc(group.label)+'<span>'+(group.available?items.length+'개':'미조회')+'</span></summary>'+
          (items.length?'<ul>'+items.map(function(row){return '<li>'+esc(row.label)+'</li>';}).join('')+'</ul>':'<p>'+(group.available&&group.complete?'공개 열람 원문에 기재된 항목이 없습니다.':'이 항목의 자료를 확인하지 못했습니다. 원문을 확인해 주세요.')+'</p>')+
          (!group.complete?'<p>일부 표기를 확인하지 못했습니다. 전체 내용은 공식 원문에서 확인하세요.</p>':'')+'</details>';
      }).join('')+'<p class="sale-public-footnote-v6">도시계획도로 표기는 실제 도로 접면·진입 가능 여부와 다를 수 있습니다. 이용규제는 원문 참고자료이며 건축 가능 판정이 아닙니다.</p>'+
      '<p class="sale-public-source-v6">'+esc(data.source)+' · 조회 '+esc(new Date(data.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+(data.cached?' · 저장된 조회자료':'')+(!data.complete?' · 일부 자료 미확인':'')+'</p>';
  }
  function mountLand(root,item){
    var el=section('publicland','필지·공적자료','토지이음의 필지 기본정보·지역지구·개별공시지가를 광고와 구분해 확인합니다.','공적자료 조회'),out=el.querySelector('[data-public-content]'),status=el.querySelector('[data-public-status]'),button=el.querySelector('button'),d=item.saleDetails||{};
    out.innerHTML='<span class="sale-public-label-v6">수집 광고 기재</span>'+rowsHtml([['지목',d.landUse],['용도지역',d.zoning],['추가 지정·지역',d.secondaryZoning],['도로접면',d.roadAccess],['형상',d.parcelShape],['광고면적',area(d.landAreaM2)],['지적공부 면적 (광고 제공)',area(d.cadastralAreaM2)]])+
      '<div class="sale-public-land-data-v7" data-official-land-data></div><div class="sale-public-official-v6" data-official-land hidden></div><details class="sale-public-missing-v6" data-public-guidance><summary>조회자료 이용 안내</summary><p>필지별 공개 열람자료를 불러옵니다. 공시지가 기준시점과 조회시각은 별개이며, 광고 금액·면적·주소는 변경하지 않습니다.</p><p>행위제한·건축선·도로조건의 상세 내용과 확인도면은 토지이음 원문에서 확인하세요.</p></details>';
    button.onclick=async function(){button.disabled=true;status.textContent='정확한 지번을 확인하고 있습니다…';out.querySelector('[data-official-land-data]').innerHTML='';if(global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.reference(root,item,'land',null);try{
      var result=await resolve(item);if(!active(el))return;var official=out.querySelector('[data-official-land]');official.hidden=false;
      official.innerHTML='<b>확인된 필지 · '+esc(result.address)+'</b><a href="'+esc(result.links.eum)+'" target="_blank" rel="noopener noreferrer">토지이음 이용계획·공시지가·확인도면 ↗</a><a href="'+esc(result.links.valuemap)+'" target="_blank" rel="noopener noreferrer">밸류맵 해당 필지 ↗</a>';
      status.textContent='토지이음 공개 열람자료를 불러오고 있습니다…';
      var saved=landFacts.get(result.pnu),age=saved?Date.now()-Date.parse(saved.fetchedAt):Infinity;
      var data=saved&&age>=0&&age<6*3600000?Object.assign({},saved,{cached:true}):await read({action:'saleParcelFacts',pnu:result.pnu});
      if(!active(el))return;if(data.pnu!==result.pnu)throw Error('요청한 필지와 응답이 다릅니다. 공식 원문에서 확인해 주세요.');
      if(data.complete)cache(landFacts,result.pnu,data);
      if(global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.reference(root,item,'land',data);
      var target=out.querySelector('[data-official-land-data]');target.innerHTML=landPublicHtml(data,item);status.textContent=data.complete?'공적자료를 불러왔습니다. 광고 기재값과 구분해 확인하세요.':'필지 자료를 불러왔으나 일부 항목은 확인하지 못했습니다.';button.textContent='다시 조회';revealResult(button,target);
      if(global.JSSaleDossierV9)global.JSSaleDossierV9.refreshUnits(target);
    }catch(e){if(active(el))status.textContent=e.message;}finally{button.disabled=false;}};
    root.append(el);
  }
  function comparable(records,item,parcel,filters){
    var d=item.saleDetails||{},land=global.JSListingTradeV1.normalizedSaleCategory(item)==='land';
    var parsed=global.JSParcelExternalLinksV1.parseAddress(parcel.address),town=parsed&&parsed.town,base=num(d.landAreaM2);
    return records.filter(function(r){
      if(!town||r.town!==town)return false;
      if(filters.landUse&&text(r.landUse)!==text(d.landUse))return false;
      if(filters.zoning&&text(r.zoning)!==text(d.zoning))return false;
      if(filters.size&&(!(base>0)||!(r.landAreaM2>0)||r.landAreaM2<base*.5||r.landAreaM2>base*2))return false;
      if(!land&&filters.whole&&r.buildingType!=='일반')return false;
      return true;
    }).sort(function(a,b){return b.date.localeCompare(a.date);});
  }
  function transactionHtml(records,land){
    return '<div class="sale-public-trades-v6">'+records.map(function(r){var unit=r.landAreaM2>0?r.amount/(r.landAreaM2/PY):null;
      return '<article><header><b>'+esc(r.date)+'</b><strong>'+esc(money(r.amount))+'</strong></header><p>'+esc([r.district,r.town,r.lot].filter(Boolean).join(' '))+'</p>'+rowsHtml([['용도',land?r.landUse:[r.buildingType,r.buildingUse].filter(Boolean).join(' · ')],['용도지역',r.zoning],['대지·거래면적',area(r.landAreaM2)],['건물면적',area(r.buildingAreaM2)],['대지 기준 단가',unit==null?'':fmt(unit)+'만원/평'],['거래유형',r.method]])+'</article>';
    }).join('')+'</div>';
  }
  function mountTransactions(root,item){
    var land=global.JSListingTradeV1.normalizedSaleCategory(item)==='land',d=item.saleDetails||{};
    var el=section('transactions','주변 유사 실거래','같은 법정동의 '+(land?'토지':'상업·업무용')+' 거래를 조건별로 확인합니다.','실거래 조회'),out=el.querySelector('[data-public-content]'),status=el.querySelector('[data-public-status]'),button=el.querySelector('button');
    var current=new Date(Date.now()+9*3600000).toISOString().slice(0,7),result=null,resolved=null,shown=10;
    var controls=document.createElement('div');controls.className='sale-public-trade-controls-v6';
    controls.innerHTML='<label>계약월<input type="month" min="2006-01" max="'+current+'" value="'+current+'" aria-label="실거래 계약월"></label><label><input type="checkbox" data-trade-filter="size"'+(num(d.landAreaM2)>0?'':' disabled')+'> 대지·거래면적 0.5~2배</label>'+
      (land&&d.landUse?'<label><input type="checkbox" data-trade-filter="landUse"> 같은 지목</label>':'')+(d.zoning?'<label><input type="checkbox" data-trade-filter="zoning"> 같은 용도지역</label>':'')+
      (!land?'<label><input type="checkbox" data-trade-filter="whole" checked> 일반건축물만</label>':'');el.insertBefore(controls,status);
    var footer=document.createElement('p');footer.className='sale-public-footnote-v6';footer.innerHTML='현재 광고 호가 <b>'+esc(money(item.salePrice))+'</b> · 아래 자료는 신고된 실거래입니다. 해제·지분 표기 거래 제외. 주소 일부가 가려져 동일 매물 이력이나 거리순 자료로 볼 수 없습니다.'+(!land?' 상업·업무용 공개자료이며 주택·공장·창고 거래는 포함하지 않습니다.':'')+' <a href="https://rt.molit.go.kr/" target="_blank" rel="noopener noreferrer">국토부 공식 실거래가 ↗</a>';el.append(footer);
    function render(){
      var filters={};controls.querySelectorAll('[data-trade-filter]').forEach(function(e){filters[e.dataset.tradeFilter]=e.checked;});var records=comparable(result.records,item,resolved,filters);
      status.textContent=resolved.address+' · '+result.month.slice(0,4)+'.'+result.month.slice(4)+' · 조건 일치 '+records.length+'건'+(!result.complete?' · 일부 페이지만 확인됨':'');
      out.innerHTML=(records.length?transactionHtml(records.slice(0,shown),land):'<p>'+(result.complete?'선택한 계약월·법정동·조건에 맞는 공개 거래가 없습니다. 다른 계약월이나 조건으로 확인해 주세요.':'확인한 일부 자료에서는 조건에 맞는 거래가 없습니다. 전체 자료의 결과는 공식 사이트에서 확인해 주세요.')+'</p>')+
        (records.length>shown?'<button type="button" data-trades-more>10건 더 보기</button>':'')+'<p class="sale-public-source-v6">'+esc(result.source)+' · 조회 '+esc(new Date(result.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+(result.cached?' · 저장된 조회자료':'')+'</p>';
      var more=out.querySelector('[data-trades-more]');if(more)more.onclick=function(){shown+=10;render();};
    }
    controls.addEventListener('change',function(e){shown=10;if(e.target.type==='month'){result=null;out.innerHTML='';status.textContent='계약월을 변경했습니다. 실거래 조회를 눌러 주세요.';}else if(result)render();});
    button.onclick=async function(){
      var month=controls.querySelector('[type="month"]').value.replace('-','');if(!/^\d{6}$/.test(month)){status.textContent='조회할 계약월을 선택해 주세요.';return;}
      button.disabled=true;controls.querySelectorAll('input').forEach(function(e){e.dataset.wasDisabled=String(e.disabled);e.disabled=true;});status.textContent='법정동과 공식 실거래 자료를 확인하고 있습니다…';out.innerHTML='';result=null;
      try{resolved=await resolve(item);if(!active(el))return;var query={action:'saleTransactions',kind:land?'land':'commercial',district:resolved.pnu.slice(0,5),month:month},key=[query.kind,query.district,month].join(':');
        var saved=transactions.get(key),age=saved?Date.now()-Date.parse(saved.fetchedAt):Infinity;result=saved&&age>=0&&age<6*3600000?Object.assign({},saved,{cached:true}):await read(query);
        if(!active(el))return;if(!Array.isArray(result.records))throw Error('실거래 자료 형식을 확인하지 못했습니다. 다시 조회해 주세요.');if(result.complete)cache(transactions,key,result);shown=10;render();
      }catch(e){if(active(el)){status.textContent=e.message;if(e.code==='approval_required')out.innerHTML='<div class="sale-public-approval-v7"><p>실거래 자료의 활용신청·인증 연결을 확인해야 합니다. 조회 실패를 거래 0건으로 표시하지 않습니다.</p><a href="https://www.data.go.kr/data/'+(land?'15126466':'15126463')+'/openapi.do" target="_blank" rel="noopener noreferrer">'+(land?'토지':'상업·업무용')+' 실거래 API 안내 ↗</a></div>';}}
      finally{button.disabled=false;controls.querySelectorAll('input').forEach(function(e){e.disabled=e.dataset.wasDisabled==='true';});}
    };root.append(el);
  }
  function mount(root,item){
    if(!root||!global.JSListingTradeV1||!global.JSListingTradeV1.isSale(item))return;
    var slot=root.querySelector('.unified-detail-summary-v8');if(!slot||slot.querySelector('.sale-public-review-v6'))return;
    var container=document.createElement('div');container.className='sale-public-review-v6';
    container.innerHTML='<form class="sale-public-query-v6"><label>공적자료 조회용 지번<input aria-label="공적자료 조회용 지번" maxlength="160" value="'+esc(item.address)+'"></label><button type="submit">주소 적용</button><small>도로명·복수 필지·비공개 주소는 확인할 지번을 입력해 주세요. 조회용 주소만 바뀌며 저장된 매물은 변경하지 않습니다.</small><p role="status" data-public-address-status></p></form><div data-public-panels></div>';
    var panels=container.querySelector('[data-public-panels]'),form=container.querySelector('form'),view=Object.assign({},item);
    function fill(){panels.replaceChildren();if(global.JSSaleReviewEnhancementsV8)global.JSSaleReviewEnhancementsV8.reference(panels,view,'',null);if(global.JSListingTradeV1.normalizedSaleCategory(item)==='land')mountLand(panels,view);else mountBuilding(panels,view);mountTransactions(panels,view);}
    form.onsubmit=function(event){event.preventDefault();var address=text(form.querySelector('input').value),service=global.JSParcelExternalLinksV1,status=form.querySelector('[data-public-address-status]');
      if(!service||!service.parseAddress(address)){status.textContent='정확한 동(리)과 지번 한 필지를 입력해 주세요.';return;}
      view=Object.assign({},item,{address:address,referenceAddressChangedV8:address.replace(/\s/g,'')!==text(item.address).replace(/\s/g,'')});fill();status.textContent='조회용 주소를 적용했습니다. 필요한 자료의 조회 버튼을 눌러 주세요.';
    };
    slot.insertBefore(container,slot.querySelector('.unified-detail-utility-actions-v8'));fill();
  }
  global.JSSalePublicReviewV6={mount:mount,buildingRows:buildingRows,buildingHtml:buildingHtml,landPublicHtml:landPublicHtml,comparable:comparable,transactionHtml:transactionHtml};
})(window);
