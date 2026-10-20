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
  function saleCalculationHtml(item){
    var ui=global.JSListingTradeV1,d=ui.saleSummary(item),land=ui.normalizedSaleCategory(item)==='land';
    function numeric(v){if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;var n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;}
    var p=numeric(item.salePrice??item.sale_price);
    function number(v){return Number(String(v).replace(/,/g,'')).toLocaleString('ko-KR',{maximumFractionDigits:2});}
    function money(v){return number(v)+'만원';}
    var cards=[];
    function card(label,result,basis){cards.push('<div><dt>'+esc(label)+'</dt><dd>'+esc(result)+'</dd><small>'+esc(basis)+'</small></div>');}
    (land?[['토지 평당가','landAreaM2','토지']]:[['대지 기준 단가','landAreaM2','대지'],['연면적 기준 단가','grossAreaM2','연면적']]).forEach(function(row){
      var area=numeric(d[row[1]]),unit=p>0&&area>0?p/(area/3.305785):null,valid=unit!=null&&Number.isFinite(unit);
      var areaLabel=row[2]+(/면적$/.test(row[2])?'':'면적');
      card(row[0],valid?number(unit)+'만원/평':'산정 불가',valid?'광고 매매가 '+money(p)+' ÷ 광고 '+areaLabel+' '+number(area/3.305785)+'평':'광고 매매가·'+areaLabel+' 확인 필요');
    });
    if(!land){var rate=ui.saleYield(item);card('단순 연 수익률',rate==null?'산정 불가':number(rate)+'%',rate==null?'매매가·임대보증금·월 임대수입 확인 필요':'월 임대수입 '+money(d.monthlyIncome)+' × 12 ÷ (매매가 '+money(p)+' − 보증금 '+money(d.totalDeposit)+') × 100');}
    return '<dl class="sale-evidence-metrics-v36">'+cards.join('')+'</dl><p class="sale-evidence-note-v36">'+(land?'평당가는 광고 토지면적 기준입니다. 공부면적이나 공시지가로 자동 대체하지 않습니다.':'단가는 건물 총매매가를 광고 면적으로 나눈 값입니다. 단순 수익률에는 대출이자·취득비용·세금·공실·운영비를 반영하지 않습니다.')+'</p>';
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
    calc.append(evidenceHeading('계산 결과','광고 기준 계산과 내 가정 계산을 나누어 확인'));
    calc.insertAdjacentHTML('beforeend','<h4>광고 기준 계산</h4>'+saleCalculationHtml(item)+'<h4>내 가정 계산·검토</h4><p class="sale-evidence-note-v36">대출·금리·공실·비용을 직접 입력한 결과는 계산창에서 확인합니다. 입력값은 광고 조건을 바꾸지 않습니다.</p>');
    var tools=summary.querySelector('.sale-tools-v1[data-sale-item]');if(tools){tools.removeAttribute('data-sale-section');calc.append(tools);}
    (publicData||summary).after(calc);
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
  global.JSWideDetailV26={mount:mount,position:position,known:known,saleCalculationHtml:saleCalculationHtml};
})(window);
