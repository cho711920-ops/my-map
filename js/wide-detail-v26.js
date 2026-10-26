/* Shared property dossier presentation. Reuse selected-original nodes and actions. */
(function(global){
  'use strict';
  var icons={
    navigation:'<path d="M20 4 4 10l7 3 3 7 6-16Z"/><path d="m11 13 4-4"/>',
    roadview:'<circle cx="12" cy="4" r="2"/><path d="m9 10 3-3 3 3m-3-3v7m0 0-4 6m4-6 4 6M4 22h16"/>',
    register:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
    edit:'<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14l-1 7Z"/>'
  };
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function known(item,key,unit){
    var value=item[key],n=Number(value),presence=item.displayValuePresence;
    if(value==null||String(value).trim()===''||typeof value==='boolean'||presence&&presence[key]===false||!Number.isFinite(n)||n<0)return '미제공';
    return n.toLocaleString('ko-KR',{maximumFractionDigits:2})+(unit||'');
  }
  function leaseSummary(item){
    var box=document.createElement('section');box.className='wide-detail-lease-v26';box.setAttribute('aria-label','선택한 원본 임대조건');
    box.innerHTML='<section class="wide-detail-condition-v35"><h3>임대조건</h3><div class="wide-detail-prices-v26"><div><span>보증금</span><strong>'+esc(known(item,'deposit','만원'))+'</strong></div><div><span>월세</span><strong>'+esc(known(item,'rent','만원'))+'</strong></div></div></section><section class="wide-detail-fact-group-v35"><h3>기본정보</h3><dl class="wide-detail-facts-v26">'+
      [['광고 면적',known(item,'area','평')],['층·호실',item.room||'미제공'],['관리비',known(item,'fee','만원')],['권리금',known(item,'premium','만원')]].map(function(row){return '<div><dt>'+row[0]+'</dt><dd>'+esc(row[1])+'</dd></div>';}).join('')+'</dl></section>';
    return box;
  }
  function decorateHeader(drawer,item,address,primary){
    var header=drawer.querySelector(':scope > header'),title=header.querySelector('#unifiedDetailTitleV8'),subtitle=header.querySelector('#unifiedDetailSubtitleV8');
    header.querySelectorAll('.wide-detail-address-v35,.wide-detail-market-v35').forEach(function(el){el.remove();});
    if(!item)return;
    title.title=title.textContent;
    var location=document.createElement('span');location.className='wide-detail-address-v35';
    location.textContent=address&&address.querySelector('strong')?address.querySelector('strong').textContent:item.address||'';
    location.title=location.textContent;title.after(location);
    var badge=document.createElement('span');badge.className='wide-detail-market-v35';
    badge.textContent=drawer.dataset.salePresentationV2==='land'?'토지매매':drawer.dataset.salePresentationV2==='building'?'건물매매':'상가임대';
    header.insertBefore(badge,header.lastElementChild);
    if(address&&subtitle){var count=document.createElement('span');count.className='wide-detail-original-count-v35';count.textContent=subtitle.textContent;address.querySelector('.unified-detail-source-row-v827').append(count);}
    // Keep the existing unit controls usable without spending another header row.
    var units=header.querySelector('.sale-fixed-summary-v9');if(units&&primary)primary.append(units);
  }
  function decorateActions(actions){
    if(!actions)return;
    actions.querySelectorAll('button').forEach(function(button){
      var match=String(button.getAttribute('onclick')||'').match(/runDetailAction\('([^']+)'/),key=match&&match[1];
      if(!icons[key])return;var label=button.textContent;
      button.dataset.wideActionV26=key;
      button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+icons[key]+'</svg><span>'+esc(label)+'</span>';
    });
  }
  function officialAreaReview(item,references,confirmation){
    var ui=global.JSListingTradeV1,land=ui.normalizedSaleCategory(item)==='land',ref=references&&references[land?'land':'building'];
    var out={reason:'공적자료를 조회하면 확인된 면적으로 단가를 보완합니다.'};
    if(!ref||!ref.data)return out;
    var data=ref.data,parser=global.JSParcelExternalLinksV1&&global.JSParcelExternalLinksV1.parseAddress;
    var advertised=parser&&parser(item.address),official=parser&&parser(land?data.address:data.lotAddress);
    if(ref.item&&ref.item.referenceAddressChangedV8||!advertised||!official||advertised.query!==official.query){out.reason='광고와 동일한 지번의 공적자료가 확인돼야 계산할 수 있습니다.';return out;}
    var d=ui.saleSummary(item),scopeText=[item.name,item.buildingName,item.memo,d.description,d.saleNote].filter(Boolean).join(' ');
    if(/지분|일부\s*(?:매매|매각)|외\s*\d+\s*필지|복수\s*필지|일괄\s*매매/.test(scopeText)){
      out.reason='지분·일부·복수 필지 매매는 실제 매매 면적을 확인해야 합니다.';return out;
    }
    if(data.calculationIncompleteV38){out.reason='조회가 불완전해 매매 대상 면적을 확정하지 못했습니다. 다시 조회해 주세요.';return out;}
    out.token=JSON.stringify([ref.kind,item.address,data.managementKey,data.pnu,data.siteArea,data.totalArea,data.areaM2,data.fetchedAt,data.calculationBuildingCountV38]);
    out.address=land?data.address:data.lotAddress;
    out.source=data.source||(land?'토지이음':'건축물대장');out.date=data.queriedAt||data.fetchedAt||'';
    if(out.date&&Number.isFinite(Date.parse(out.date)))out.date=new Date(out.date).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
    if(!land){
      var extent=ui.buildingSaleExtent(item),count=Number(data.calculationBuildingCountV38)||0;
      var targetText=[d.saleTargetFloor,d.saleTargetRoom,item.room].filter(Boolean).join(' ');
      if(extent==='unit'||extent!=='whole_building'&&/\d+\s*(?:호|층)/.test(targetText)||/집합|전유|총괄/.test(data.registerType||'')){out.reason='층·호실·집합건물은 전유면적과 대지권을 확인해야 합니다. 전체 대장 면적은 사용하지 않습니다.';return out;}
      if(!count){out.reason='조회 건물의 전체 범위를 확인하지 못했습니다.';return out;}
      if(extent!=='whole_building'||count>1||!data.registerType){
        out.needsConfirmation=true;
        if(confirmation!==out.token){out.reason='조회한 건물 전체가 매매 대상인지 확인해 주세요.';return out;}
        out.confirmed=true;
      }
      out.landAreaM2=count===1?data.siteArea:null;out.grossAreaM2=data.totalArea;
      if(count>1)out.reason='여러 건물의 공통 대지일 수 있어 대지 단가는 보류하고, 선택한 건물 연면적으로만 계산합니다.';
      else out.reason='';
    }else{out.landAreaM2=data.areaM2;out.reason='';}
    out.label=land?'공부면적':'대장 면적';
    return out;
  }
  function saleCalculationHtml(item,references,confirmation){
    var ui=global.JSListingTradeV1,d=ui.saleSummary(item),land=ui.normalizedSaleCategory(item)==='land';
    function numeric(v){if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;var n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;}
    var p=numeric(item.salePrice??item.sale_price);
    function number(v){return Number(String(v).replace(/,/g,'')).toLocaleString('ko-KR',{maximumFractionDigits:2});}
    function money(v){return number(v)+'만원';}
    var official=officialAreaReview(item,references,confirmation),cards=[];
    function card(label,result,basis,extra){cards.push('<div><dt>'+esc(label)+'</dt><dd>'+esc(result)+'</dd><small>'+esc(basis)+'</small>'+(extra||'')+'</div>');}
    (land?[['토지 평당가','landAreaM2','토지']]:[['대지 기준 단가','landAreaM2','대지'],['연면적 기준 단가','grossAreaM2','연면적']]).forEach(function(row){
      var area=numeric(d[row[1]]),unit=p>0&&area>0?p/(area/3.305785):null,valid=unit!=null&&Number.isFinite(unit);
      var areaLabel=row[2]+(/면적$/.test(row[2])?'':'면적');
      var officialArea=numeric(official[row[1]]),officialUnit=p>0&&officialArea>0?p/(officialArea/3.305785):null,officialValid=officialUnit!=null&&Number.isFinite(officialUnit);
      var officialBasis='광고 매매가 '+money(p)+' ÷ '+official.label+' '+areaLabel+' '+number(officialArea/3.305785)+'평 ('+number(officialArea)+'㎡)';
      var paired=valid&&officialValid?'<div class="sale-official-unit-v38"><span>'+esc(official.label+' 기준')+'</span><strong>'+esc(number(officialUnit)+'만원/평')+'</strong><small>'+esc(officialBasis)+'</small></div>':'';
      card(row[0]+(!valid&&officialValid?' · '+official.label+' 기준':''),valid?number(unit)+'만원/평':officialValid?number(officialUnit)+'만원/평':'산정 불가',valid?'광고 매매가 '+money(p)+' ÷ 광고 '+areaLabel+' '+number(area/3.305785)+'평':officialValid?officialBasis:'광고 매매가·'+areaLabel+' 확인 필요 · '+official.reason,paired);
    });
    if(!land){var rate=ui.saleYield(item);card('단순 연 수익률',rate==null?'산정 불가':number(rate)+'%',rate==null?'매매가·임대보증금·월 임대수입 확인 필요':'월 임대수입 '+money(d.monthlyIncome)+' × 12 ÷ (매매가 '+money(p)+' − 보증금 '+money(d.totalDeposit)+') × 100');}
    var provenance=official.label?'<p class="sale-evidence-note-v36" data-official-area-source-v38>'+esc(official.source+' · '+official.address+' · 조회 '+(official.date||'일시 미제공'))+'</p>':'';
    var confirm=official.needsConfirmation?'<label class="sale-area-confirm-v38"><input type="checkbox" data-confirm-official-area-v38'+(official.confirmed?' checked':'')+'> 조회한 건물'+(references.building.data.buildingName||references.building.data.dongName?' ('+esc([references.building.data.buildingName,references.building.data.dongName].filter(Boolean).join(' · '))+')':'')+' 전체가 이번 매매 대상입니다</label>':'';
    return '<dl class="sale-evidence-metrics-v36">'+cards.join('')+'</dl>'+provenance+confirm+(official.reason?'<p class="sale-evidence-note-v36">'+esc(official.reason)+'</p>':'')+'<p class="sale-evidence-note-v36">'+(land?'광고 면적과 공부면적의 단가를 구분합니다. 공시지가를 매매가로 사용하지 않으며 광고·목록의 값은 변경하지 않습니다.':'단가는 건물 총매매가를 각 기준 면적으로 나눈 참고값입니다. 토지 단독 가격이 아닙니다. 단순 수익률에는 대출이자·취득비용·세금·공실·운영비를 반영하지 않습니다.')+'</p>';
  }
  function refreshSaleCalculations(body){
    var slot=body&&body.querySelector('[data-sale-calculations-v38]'),item=body&&body._saleCalculationItemV38;if(!slot||!item)return;
    var refs=body._saleCalculationReferencesV38||{};
    slot.innerHTML=saleCalculationHtml(item,refs,body._saleAreaConfirmationV38);
    var check=slot.querySelector('[data-confirm-official-area-v38]');if(check)check.onchange=function(){body._saleAreaConfirmationV38=this.checked?officialAreaReview(item,refs).token:null;refreshSaleCalculations(body);slot.querySelector('[data-confirm-official-area-v38]').focus({preventScroll:true});};
  }
  function buildingBasicsHtml(item,reference){
    var ui=global.JSListingTradeV1,d=ui.saleSummary(item),unit=ui.buildingSaleExtent(item)==='unit';
    var fields=[['대지면적','landAreaM2','siteArea'],['건축면적','buildingAreaM2','buildingArea'],['연면적','grossAreaM2','totalArea'],['건폐율','buildingCoverageRatio','buildingCoverageRatio'],['용적률','floorAreaRatio','floorAreaRatio']];
    function value(raw,ratio,key){
      if(!['number','string'].includes(typeof raw)||!String(raw).trim())return '원본 미제공';
      var n=Number(String(raw).replace(/,/g,''));if(!Number.isFinite(n)||!(n>0)||key==='buildingCoverageRatio'&&n>100)return '원본 미제공';
      return ratio?esc(n.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%'):global.JSSaleDossierV9.areaHtml(n);
    }
    function facts(official){return '<dl class="sale-building-facts-v84">'+fields.map(function(f,index){var key=official?f[2]:f[1];return '<div data-building-fact-v84="'+f[1]+'"><dt>'+f[0]+'</dt><dd>'+value((official||d)[key],index>2,f[1]).replace('원본 미제공',official?'대장 미제공':'원본 미제공')+'</dd></div>';}).join('')+'</dl>';}
    var html='<header><h3>건물 면적·비율</h3><span>광고 기재</span></header>'+
      (unit&&Number(d.exclusiveAreaM2)>0?'<p class="sale-building-exclusive-v84">매매 대상 전용면적 <b>'+value(d.exclusiveAreaM2,false)+'</b></p>':'')+facts(null)+
      '<p class="sale-building-note-v84">'+(unit?'대지·건축·연면적과 비율은 건물 전체 기재값이며, 매매 호실의 전용면적·대지권과 구분합니다.':'현재 선택한 원본 기준입니다. 건축면적은 건물의 바닥 점유 면적, 연면적은 각 층 바닥면적의 합계입니다.')+'</p>';
    var data=reference&&reference.data,parser=global.JSParcelExternalLinksV1&&global.JSParcelExternalLinksV1.parseAddress;
    var a=parser&&parser(item.address),b=data&&parser&&parser(data.lotAddress);
    if(data&&a&&b&&a.query===b.query&&!(reference.item&&reference.item.referenceAddressChangedV8)){
      html+='<section class="sale-building-official-v84"><h4>건축물대장 · '+esc([data.buildingName,data.dongName].filter(Boolean).join(' · ')||'조회한 건물')+'</h4>'+facts(data)+
        '<p class="sale-building-note-v84">'+esc(data.source||'국토교통부 건축물대장')+' · 조회 '+esc(data.queriedAt||data.fetchedAt||'일시 미제공')+(data.partial?' · 일부 자료 확인 필요':'')+'<br>선택한 건물 전체 제원입니다. 광고 면적·호실 면적·계산 기준은 변경하지 않습니다.</p></section>';
    }
    return html+'<button type="button" data-building-area-lookup-v84>대장 제원 확인</button>';
  }
  function refreshBuildingBasics(body){
    var box=body&&body.querySelector('[data-building-basics-v84]'),item=body&&body._saleCalculationItemV38;if(!box||!item)return;
    box.innerHTML=buildingBasicsHtml(item,(body._saleCalculationReferencesV38||{}).building);
    box.querySelector('button').onclick=function(){var button=body.querySelector('[data-sale-section="register"] [data-public-load]');if(button){button.scrollIntoView({block:'center',behavior:'instant'});if(!button.disabled)button.click();}};
  }
  function referenceArea(body,item,kind,data){
    if(!body)return;var refs=body._saleCalculationReferencesV38||(body._saleCalculationReferencesV38={});
    if(!kind)body._saleCalculationReferencesV38={};
    else if(data)refs[kind]={item:item,kind:kind,data:data};else delete refs[kind];
    var target=body._saleCalculationItemV38&&global.JSListingTradeV1.normalizedSaleCategory(body._saleCalculationItemV38)==='land'?'land':'building';
    if(!kind||kind===target)body._saleAreaConfirmationV38=null;refreshSaleCalculations(body);refreshBuildingBasics(body);
  }
  function evidenceHeading(title,note){var heading=document.createElement('header');heading.className='sale-evidence-heading-v36';heading.innerHTML='<h3>'+esc(title)+'</h3><p>'+esc(note)+'</p>';return heading;}
  function mountSaleEvidence(body,item,summary,primary){
    if(!global.JSListingTradeV1||!global.JSListingTradeV1.isSale(item))return;
    summary.dataset.saleEvidenceV36='advertisement';
    var overview=primary.querySelector('.sale-overview-v2');
    if(overview){
      overview.prepend(evidenceHeading('광고 조건','현재 선택한 원본 광고의 금액·면적'));
      var indicators=overview.querySelector('.sale-overview-indicators-v2');
      if(indicators){var badge=indicators.querySelector('.pyeong-mini-badge');if(badge&&!/^광고/.test(badge.textContent.trim()))badge.remove();if(!indicators.textContent.trim())indicators.remove();}
      var label=overview.querySelector('.sale-overview-label-v2');if(label)label.textContent=global.JSListingTradeV1.displayType(item)+' · 광고 기재';
    }
    primary.querySelectorAll('.building-unit-prices-v5').forEach(function(el){el.remove();});
    summary.prepend(evidenceHeading('광고 상세','광고에서 제공한 내용과 설명 추출값 · 공적자료와 구분'));
    var details=summary.querySelector('.listing-sale-details-v1');
    if(details)details.querySelectorAll('.sale-fact-group-v2 > dd > dl > div').forEach(function(row){var dt=row.querySelector('dt');if(dt&&['단순 연 수익률','토지 평당가'].includes(dt.textContent.trim()))row.remove();});
    if(details)details.querySelectorAll('.sale-fact-group-v2').forEach(function(group){if(!group.querySelector('dd dl > div'))group.remove();});
    var note=summary.querySelector('.listing-sale-yield-note-v1');
    if(note){if(item.saleDetails&&item.saleDetails.descriptionVersion)note.textContent='설명에서 추출한 조건은 광고 기재값입니다. 이자 차감 월수익은 월 임대수입으로 사용하지 않습니다.';else note.remove();}
    var origin=summary.querySelector('.sale-detail-origin-v10');if(origin)origin.remove();
    var publicData=summary.querySelector('.sale-public-review-v6');
    if(publicData){publicData.classList.add('sale-evidence-public-v36');publicData.prepend(evidenceHeading('공적자료','조회한 주소·건물과 자료 기준일을 확인하세요. 광고 조건은 유지됩니다.'));summary.after(publicData);}
    var calc=document.createElement('section');calc.className='sale-evidence-calculation-v36';calc.dataset.saleSection='workbench';
    calc.append(evidenceHeading('계산 결과','단가의 면적 근거와 내 가정 계산을 나누어 확인'));
    calc.insertAdjacentHTML('beforeend','<h4>광고·공적 면적 기준 계산</h4><div data-sale-calculations-v38 aria-live="polite"></div><button type="button" class="sale-area-lookup-v38">공적자료로 면적 보완</button><h4>내 가정 계산·검토</h4><p class="sale-evidence-note-v36">대출·금리·공실·비용을 직접 입력한 결과는 계산창에서 확인합니다. 입력값은 광고 조건을 바꾸지 않습니다.</p>');
    var tools=summary.querySelector('.sale-tools-v1[data-sale-item]');if(tools){tools.removeAttribute('data-sale-section');calc.append(tools);}
    (publicData||summary).after(calc);
    body._saleCalculationItemV38=item;refreshSaleCalculations(body);
    if(global.JSListingTradeV1.normalizedSaleCategory(item)!=='land'){
      var areas=primary.querySelector('.building-sale-area-info-v1');if(areas)areas.remove();
      var basics=document.createElement('section');basics.className='sale-building-basics-v84';basics.dataset.buildingBasicsV84='';basics.setAttribute('aria-label','건물 면적과 비율');primary.append(basics);refreshBuildingBasics(body);
    }
    calc.querySelector('.sale-area-lookup-v38').onclick=function(){var panel=body.querySelector('[data-sale-section="'+(global.JSListingTradeV1.normalizedSaleCategory(item)==='land'?'publicland':'register')+'"]'),button=panel&&panel.querySelector('[data-public-load]');if(button){button.scrollIntoView({block:'center',behavior:'instant'});if(!button.disabled)button.click();}};
    var secondary=summary.querySelector('.sale-secondary-tools-v10');if(secondary)secondary.querySelector('summary').textContent='광고 출처·호가 이력·외부 조회';
  }
  function position(drawer){
    if(!drawer)return false;
    var phone=global.JSPhoneDeviceV1&&global.JSPhoneDeviceV1.isMobileLayout?global.JSPhoneDeviceV1.isMobileLayout():document.documentElement.classList.contains('js-phone-app-v2');
    drawer.setAttribute('data-wide-detail-v26','');
    var host=drawer.closest('.unified-favorite-detail-host-v7');
    if(host&&!phone){drawer.dataset.wideLayoutV26=host.clientWidth>=760?'wide':'stack';return true;}
    if(phone){drawer.dataset.wideLayoutV26='stack';drawer.style.removeProperty('--wide-detail-width-v26');return false;}
    var sidebar=document.getElementById('sidebar'),rect=sidebar&&sidebar.getBoundingClientRect(),toolbar=document.querySelector('.filters'),bar=toolbar&&toolbar.getBoundingClientRect();
    var viewport=document.documentElement.clientWidth||global.innerWidth;
    var edge=rect&&rect.width>0&&rect.left>0?Math.min(viewport,rect.left):viewport;
    var available=Math.max(0,edge-24),width=Math.min(1060,available);
    // A narrow map beside a large list needs a stacked card, never a tiny photo.
    if(width<360)width=Math.min(540,Math.max(0,viewport-24));
    var right=Math.max(12,viewport-edge+12);
    if(width+right>viewport-12)right=12;
    drawer.style.right=Math.round(right)+'px';
    var top=Math.max(12,Math.round(bar?bar.bottom:68)+12);
    drawer.style.top=top+'px';
    drawer.style.bottom='12px';
    drawer.style.setProperty('--wide-detail-max-height-v26',Math.max(120,global.innerHeight-top-12)+'px');
    drawer.style.setProperty('--wide-detail-width-v26',Math.floor(width)+'px');
    drawer.dataset.wideLayoutV26=width>=760?'wide':'stack';
    return true;
  }
  function mount(body,item){
    var drawer=body&&body.closest('#unifiedDetailDrawerV8');if(!drawer)return;
    var oldActions=drawer.querySelector(':scope > .unified-detail-utility-actions-v8');if(oldActions)oldActions.remove();
    var oldNav=drawer.querySelector(':scope > .sale-dossier-nav-v3');if(oldNav)oldNav.remove();
    position(drawer);if(!item){decorateHeader(drawer,null);return;}
    var summary=body.querySelector('.unified-detail-summary-v8'),gallery=body.querySelector('.unified-detail-gallery-v8');if(!summary||!gallery)return;
    var layout=document.createElement('div');layout.className='wide-detail-layout-v26';
    var media=gallery.closest('.sale-photo-slot-v3');
    if(!media){media=document.createElement('section');media.append(gallery);}
    media.classList.add('wide-detail-media-v26');media.hidden=false;
    media.dataset.wideEmptyV26=String(!gallery.querySelector('img'));
    var primary=document.createElement('section');primary.className='wide-detail-primary-v26';primary.setAttribute('aria-label','매물 핵심 조건');
    var address=summary.querySelector('.unified-detail-source-address-v827');if(address)primary.append(address);
    decorateHeader(drawer,item,address,primary);
    var overview=summary.querySelector('.sale-overview-v2');
    if(overview){primary.append(overview);var areas=summary.querySelector('.building-sale-area-info-v1');if(areas)primary.append(areas);}
    else {
      primary.append(leaseSummary(item));
      summary.querySelectorAll(':scope > p:not([class]),.phone-detail-price-v2,.phone-detail-facts-v2').forEach(function(el){el.remove();});
    }
    // Preserve availability warnings at the top, independent of the price style.
    var warning=summary.querySelector('.source-unavailable');if(warning)primary.prepend(warning);
    var memo=summary.querySelector('.unified-detail-memo-v8');
    if(memo){
      var description=document.createElement('section'),heading=document.createElement('h3'),headingRow=document.createElement('div');
      description.className='wide-detail-description-v35';headingRow.className='wide-detail-description-heading-v35';heading.textContent='상세설명';
      memo.before(description);headingRow.append(heading);var metadata=summary.querySelector('.unified-detail-meta-v8');if(metadata)headingRow.append(metadata);
      description.append(headingRow,memo);
    }
    layout.append(media,primary);summary.before(layout);
    // Keep navigation outside the scrolling photos/facts. A sticky strip inside
    // the padded body exposed content above it and covered the photo on scroll.
    var nav=body.querySelector('.sale-dossier-nav-v3');
    if(nav){body.before(nav);if(body._saleDossierSyncV3)body._saleDossierSyncV3();}
    var actions=summary.querySelector('.unified-detail-utility-actions-v8');
    if(actions){decorateActions(actions);if(drawer.__detailPresentationV2&&drawer.__detailPresentationV2.phone)layout.after(actions);else drawer.append(actions);}
    var management=summary.querySelector('.unified-detail-actions-v8');
    if(management){var disclosure=document.createElement('details'),title=document.createElement('summary');disclosure.className='wide-detail-management-v26';title.textContent='광고 관리';disclosure.append(title,management);summary.append(disclosure);}
    mountSaleEvidence(body,item,summary,primary);
    if(body._saleDossierSyncV3)body._saleDossierSyncV3();
  }
  global.JSWideDetailV26={mount:mount,position:position,known:known,saleCalculationHtml:saleCalculationHtml,officialAreaReview:officialAreaReview,referenceArea:referenceArea};
})(window);
