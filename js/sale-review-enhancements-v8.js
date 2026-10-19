/* Sale-only presentation and review tools. No original listing writes. */
(function(global){
  'use strict';
  var PY=3.305785;
  function ui(){return global.JSListingTradeV1;}
  function text(v){return String(v==null?'':v).trim();}
  function esc(v){return text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){if(v==null||typeof v==='boolean'||!text(v))return null;var n=Number(text(v).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;}
  function fmt(v){return v==null?'미제공':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});}
  function area(v){return num(v)>0?fmt(v/PY)+'평 ('+fmt(v)+'㎡)':'미제공';}
  function date(v){if(global.JSSaleReviewV10)return global.JSSaleReviewV10.dateText(v);var s=text(v).replace(/[^0-9]/g,'');return s.length===8?s.slice(0,4)+'.'+s.slice(4,6)+'.'+s.slice(6):text(v);}
  function facts(rows){return '<dl class="sale-review-facts-v8">'+rows.map(function(r){return '<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1]||'미제공')+'</dd></div>';}).join('')+'</dl>';}
  function syncLayout(){
    var mode=ui().getMode(),bar=document.getElementById('saleListLayoutV8');if(bar)bar.hidden=mode==='lease';
    if(global.JSSaleReviewV10)global.JSSaleReviewV10.syncTable();
  }
  function bodyOf(root){return root.closest('.unified-detail-body-v8');}
  function normalized(v){return text(v).replace(/\s/g,'');}
  function differences(item,kind,data){
    if(!data||item.referenceAddressChangedV8)return [];
    var d=ui().saleSummary(item),rows=[];
    function compare(label,a,b,numeric){
      if(numeric){if(!(num(a)>0&&num(b)>0)||Math.abs(Number(a)-Number(b))<=1)return;rows.push([label,area(a),area(b)]);}
      else if(text(a)&&text(b)&&normalized(a)!==normalized(b))rows.push([label,text(a),text(b)]);
    }
    if(kind==='land'){
      compare('토지면적',d.landAreaM2,data.areaM2,true);compare('지목',d.landUse,data.landUse);
    }else{
      compare('대지면적',d.landAreaM2,data.siteArea,true);compare('연면적',d.grossAreaM2,data.totalArea,true);
      compare('주용도',d.buildingUse,data.mainUse);compare('사용승인일',date(d.approvalDate),date(data.approvalDate));
    }
    return rows;
  }
  function reference(root,item,kind,data){
    var body=bodyOf(root);if(!body)return;
    var previous=body.querySelector('.sale-reference-summary-v8');if(previous)previous.remove();
    body._saleReferenceV8=data?{item:item,kind:kind,data:data}:null;
    if(!data)return;
    var rows=differences(item,kind,data),el=document.createElement('section');el.className='sale-reference-summary-v8';el.setAttribute('aria-label','광고와 공적자료 확인사항');
    if(item.referenceAddressChangedV8)el.innerHTML='<strong>다른 지번의 조회자료</strong><p>광고 주소와 다른 조회용 주소입니다. 이 자료를 현재 광고 조건과 자동 대조하지 않습니다.</p>';
    else if(rows.length)el.innerHTML='<strong>광고·공적자료 표기 확인 '+rows.length+'개</strong><p>전체 건물·일부 지분·복수 필지 등 매매범위를 확인하세요. 표기 차이가 광고 오류를 뜻하지 않습니다.</p><div class="sale-reference-table-v8"><table><thead><tr><th>항목</th><th>광고 기재</th><th>공적자료</th></tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(v,i){return '<'+(i?'td':'th')+'>'+esc(v)+'</'+(i?'td':'th')+'>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';
    else el.innerHTML='<strong>공적자료 조회됨</strong><p>값이 함께 제공된 항목에서 별도 표기 차이를 찾지 못했습니다. 매매범위·누락 항목은 별도로 확인하세요.</p>';
    var overview=body.querySelector('[data-sale-section="summary"]');if(overview)overview.after(el);
    if(global.JSSaleDossierV9)global.JSSaleDossierV9.refreshUnits(el);
  }
  function roadHtml(item,data){
    var d=ui().saleSummary(item),roads=[];
    (data&&data.regulations||[]).forEach(function(g){(g.items||[]).forEach(function(r){if(/도로|로류|로\s*\d+류/.test(text(r.label)))roads.push(text(r.label));});});
    return '<section class="sale-road-evidence-v8"><h4>도로정보 · 근거별 확인</h4>'+facts([['광고의 도로접면',text(d.roadAccess)||'광고 미제공'],['공적자료의 도로 표기',roads.length?roads.join(' · '):data?'조회한 지정사항에서 도로 표기를 찾지 못했습니다.':'공적자료 조회 전']])+'<p>도시계획도로 지정·저촉·접합은 현황도로 접면이나 실제 진입 가능을 보증하지 않습니다. 도면·현장·공식 원문을 함께 확인하세요.</p></section>';
  }
  function scenarios(values,interestRise,vacancyRise){
    var w=global.JSSaleWorkbenchV1,ir=num(interestRise),vr=num(vacancyRise),base=w.calculate(values);
    if(base.error)return {error:base.error};
    if(ir==null||vr==null||Number(values.interest)+ir>100||Number(values.vacancy)+vr>100)return {error:'상승폭을 0 이상으로 입력하고, 합산 이자율·공실률은 100% 이하로 설정하세요.'};
    return {rows:[{label:'현재 가정',values:Object.assign({},values),result:base},{label:'금리 상승',values:Object.assign({},values,{interest:Number(values.interest)+ir}),result:w.calculate(Object.assign({},values,{interest:Number(values.interest)+ir}))},{label:'공실 증가',values:Object.assign({},values,{vacancy:Number(values.vacancy)+vr}),result:w.calculate(Object.assign({},values,{vacancy:Number(values.vacancy)+vr}))}]};
  }
  function renderScenarios(dialog){
    var out=dialog.querySelector('[data-scenario-result]');if(!out)return;
    var values={};dialog.querySelectorAll('[data-calc]').forEach(function(e){values[e.dataset.calc]=e.value;});
    var result=scenarios(values,dialog.querySelector('[data-scenario-interest]').value,dialog.querySelector('[data-scenario-vacancy]').value);
    if(result.error){out.textContent=result.error;return;}
    out.innerHTML='<div class="sale-scenario-table-v8"><table><thead><tr><th>가정</th><th>이자율·공실률</th><th>월 현금흐름</th><th>연 수익률</th></tr></thead><tbody>'+result.rows.map(function(r){return '<tr><th>'+esc(r.label)+'</th><td>'+fmt(r.values.interest)+'% · '+fmt(r.values.vacancy)+'%</td><td class="'+(r.result.monthly<0?'negative':'')+'">'+fmt(r.result.monthly)+'만원</td><td>'+fmt(r.result.yield)+'%</td></tr>';}).join('')+'</tbody></table></div><p>현재 입력값에서 각 조건만 따로 바꾼 가정입니다. 상승폭은 이번 검토창에서만 사용하며 원본·저장 가정을 변경하지 않습니다.</p>';
  }
  function mountScenarios(dialog){
    if(dialog.dataset.saleReview!=='building')return;
    var el=document.createElement('section');el.className='sale-scenarios-v8';
    el.innerHTML='<h3>수익 시나리오 비교</h3><div class="sale-scenario-controls-v8"><label>금리 상승폭 (%p)<input type="number" min="0" max="100" step="0.1" value="1" data-scenario-interest></label><label>공실 증가폭 (%p)<input type="number" min="0" max="100" step="1" value="10" data-scenario-vacancy></label></div><div data-scenario-result aria-live="polite"></div>';
    dialog.querySelector('[data-calc-result]').after(el);el.addEventListener('input',function(){renderScenarios(dialog);});renderScenarios(dialog);
  }
  function reportHtml(item,referenceData,photo){
    var d=ui().saleSummary(item),land=ui().normalizedSaleCategory(item)==='land',w=global.JSSaleWorkbenchV1;
    var rows=land?[['광고 토지면적',area(d.landAreaM2)],['광고 토지 평당가',w.unitPrice(item)==null?'산정 불가':fmt(w.unitPrice(item))+'만원/평'],['지목',d.landUse],['용도지역',d.zoning],['도로접면 (광고)',d.roadAccess],['형상',d.parcelShape]]:
      [['광고 대지면적',area(d.landAreaM2)],['광고 연면적',area(d.grossAreaM2)],['광고 건축면적',area(d.buildingAreaM2)],['주용도 (광고)',d.buildingUse],['사용승인일 (광고)',date(d.approvalDate)],['보증금 합계',num(d.totalDeposit)==null?'미제공':fmt(d.totalDeposit)+'만원'],['월 임대수입',num(d.monthlyIncome)==null?'미제공':fmt(d.monthlyIncome)+'만원']];
    function buildingRows(r){return [['조회 건물',r.lotAddress]].concat(global.JSSalePublicReviewV6?global.JSSalePublicReviewV6.buildingRows(r).filter(function(v){return text(v[1]);}):[['주용도',r.mainUse],['대지면적',area(r.siteArea)],['연면적',area(r.totalArea)]]);}
    var publicHtml='<p>이 상세창에서 조회한 공적자료가 없습니다.</p>';
    if(referenceData){var r=referenceData.data;
      publicHtml=(referenceData.item.referenceAddressChangedV8?'<p>다른 조회용 지번의 자료입니다. 광고와 자동 대조하지 않습니다.</p>':'')+facts(referenceData.kind==='land'?[['조회 필지',r.address],['공식 지목',r.landUse],['공부면적',area(r.areaM2)],['개별공시지가',r.price&&r.price.available?fmt(r.price.wonPerM2)+'원/㎡ · '+r.price.baseYear+'.'+String(r.price.baseMonth).padStart(2,'0')+' 기준':'미제공']]:buildingRows(r))+
      (referenceData.kind==='land'?(r.regulations||[]).map(function(g){return '<p><b>'+esc(g.label)+'</b> · '+esc((g.items||[]).map(function(i){return i.label;}).join(' · ')||(g.available&&g.complete?'공개 원문 기재 항목 없음':'미조회'))+(!g.complete?' · 일부 자료 확인 필요':'')+'</p>';}).join(''):'')+
      '<p>출처 '+esc(r.source||'건축물대장')+' · 조회 '+esc(date(r.queriedAt||r.fetchedAt)||'일시 미제공')+((!r.complete&&referenceData.kind==='land')||r.partial?' · 일부 자료 미확인':'')+(referenceData.kind==='building'?' · 선택 건물 기준 '+esc([r.buildingName,r.dongName].filter(Boolean).join(' · ')):'')+'</p>';
      var diff=differences(referenceData.item,referenceData.kind,r);if(diff.length)publicHtml+='<h4>표기 확인사항</h4>'+facts(diff.map(function(v){return [v[0],'광고 '+v[1]+' / 공적자료 '+v[2]];}));
    }
    return '<article class="sale-single-report-v8"><header><span>JS부동산 · '+(land?'토지':'건물')+' 매입 검토서</span><h3>'+esc(item.buildingName||item.name||item.address)+'</h3><p>'+esc(item.address)+'</p><strong>'+esc(w.price(item.salePrice??item.sale_price))+'</strong></header>'+
      (photo?'<img class="sale-report-photo-v8" alt="상세창에서 확인한 매물 사진" src="'+esc(photo)+'">':'')+'<h4>원본 광고 조건</h4>'+facts(rows)+'<p>출처 '+esc(item.source||'직접등록')+' · 제공처 확인일 '+esc(date(d.providerCheckedAt)||'미제공')+' · 광고 등록일 '+esc(date(item.regDate)||'미제공')+'</p><h4>조회한 공적자료</h4>'+publicHtml+
      (land?roadHtml(item,referenceData&&referenceData.kind==='land'?referenceData.data:null):'')+'<section data-report-note-section hidden><h4>내 검토 메모</h4><p data-report-note></p></section><footer>작성 '+esc(date(new Date().toISOString()))+' · 광고 호가와 공적자료는 기준·범위가 다를 수 있습니다. 거래 가능 여부·권리관계·현장 조건은 별도 확인하세요.</footer></article>';
  }
  function report(item,root){
    if(!ui().isSale(item))return;
    var body=bodyOf(root),referenceData=body&&body._saleReferenceV8,hero=body&&body.querySelector('.unified-detail-hero-v8 img'),photo='';
    if(hero&&hero.complete&&hero.naturalWidth>0){try{var u=new URL(hero.currentSrc||hero.src,global.location.href);if(u.protocol==='https:'||u.origin===global.location.origin)photo=u.href;}catch(e){}}
    var dialog=global.JSSaleWorkbenchV1.modal('개별 매물 검토서','<div class="sale-report-controls-v8"><label><input type="checkbox" data-report-include-note> 저장된 내 검토 메모 포함</label><button type="button" data-report-print>검토서 인쇄</button><p data-report-status role="status">현재 선택한 원본과 이 상세창에서 조회한 자료만 사용합니다.</p></div>'+reportHtml(item,referenceData,photo),'sale-single-report-dialog-v8');
    var check=dialog.querySelector('[data-report-include-note]'),status=dialog.querySelector('[data-report-status]'),revision=0;
    var note=dialog.querySelector('[data-report-note]'),section=dialog.querySelector('[data-report-note-section]'),print=dialog.querySelector('[data-report-print]'),memoAccount='';
    print.onclick=function(){if(memoAccount&&memoAccount!==text(global.JSAuthenticatedAccountEmail).toLowerCase()){section.hidden=true;note.textContent='';check.checked=false;memoAccount='';status.textContent='계정이 변경되어 검토 메모를 제외했습니다.';}global.print();};
    check.onchange=async function(){var request=++revision;section.hidden=true;note.textContent='';print.disabled=false;status.textContent='내 검토 메모를 제외했습니다.';if(!check.checked)return;
      var key=text(item.originalId||item.propertyId),account=text(global.JSAuthenticatedAccountEmail).toLowerCase();
      print.disabled=true;status.textContent='저장된 내 검토 메모를 확인하고 있습니다…';
      try{if(!key||!account||!global.JSDataAccessV6)throw Error('계정 연결이 준비되지 않았습니다.');
        var r=await global.JSDataAccessV6.read('loadCloudState',{scope:'saleWorksheetV1',recordKey:key,expectedAccountEmail:account});
        if(!dialog.isConnected||request!==revision||!check.checked)return;
        if(account!==text(global.JSAuthenticatedAccountEmail).toLowerCase())throw Error('로그인 계정이 변경됐습니다. 다시 열어 주세요.');
        memoAccount=account;note.textContent=text(r.data&&r.data.note);section.hidden=!note.textContent;status.textContent=note.textContent?'저장된 내 검토 메모를 포함합니다.':'저장된 내 검토 메모가 없습니다.';
      }catch(e){if(dialog.isConnected&&request===revision){status.textContent='메모 조회 실패: '+e.message;check.checked=false;}}
      finally{if(dialog.isConnected&&request===revision)print.disabled=false;}
    };
  }
  var bar=document.getElementById('saleListLayoutV8');if(bar)bar.addEventListener('click',function(event){var b=event.target.closest('[data-sale-layout]');if(!b||ui().getMode()==='lease')return;if(global.JSSaleReviewV10)global.JSSaleReviewV10.chooseLayout(b.dataset.saleLayout);});
  global.addEventListener('js-listing-trade-mode-change',syncLayout);
  global.addEventListener('js-phone-device-change',syncLayout);
  if(global.matchMedia)global.matchMedia('(min-width:769px)').addEventListener('change',syncLayout);
  global.JSSaleReviewEnhancementsV8={syncLayout:syncLayout,differences:differences,reference:reference,roadHtml:roadHtml,scenarios:scenarios,mountScenarios:mountScenarios,renderScenarios:renderScenarios,reportHtml:reportHtml,report:report};
  syncLayout();
})(window);
