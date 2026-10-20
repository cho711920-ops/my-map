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
    box.innerHTML='<div class="wide-detail-prices-v26"><div><span>보증금</span><strong>'+esc(known(item,'deposit','만원'))+'</strong></div><div><span>월세</span><strong>'+esc(known(item,'rent','만원'))+'</strong></div></div><dl class="wide-detail-facts-v26">'+
      [['광고 면적',known(item,'area','평')],['층·호실',item.room||'미제공'],['관리비',known(item,'fee','만원')],['권리금',known(item,'premium','만원')]].map(function(row){return '<div><dt>'+row[0]+'</dt><dd>'+esc(row[1])+'</dd></div>';}).join('')+'</dl>';
    return box;
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
    position(drawer);if(!item)return;
    var summary=body.querySelector('.unified-detail-summary-v8'),gallery=body.querySelector('.unified-detail-gallery-v8');if(!summary||!gallery)return;
    var layout=document.createElement('div');layout.className='wide-detail-layout-v26';
    var media=gallery.closest('.sale-photo-slot-v3');
    if(!media){media=document.createElement('section');media.append(gallery);}
    media.classList.add('wide-detail-media-v26');media.hidden=false;
    media.dataset.wideEmptyV26=String(!gallery.querySelector('img'));
    var primary=document.createElement('section');primary.className='wide-detail-primary-v26';primary.setAttribute('aria-label','매물 핵심 조건');
    var address=summary.querySelector('.unified-detail-source-address-v827');if(address)primary.append(address);
    var overview=summary.querySelector('.sale-overview-v2');
    if(overview){primary.append(overview);var areas=summary.querySelector('.building-sale-area-info-v1');if(areas)primary.append(areas);}
    else {
      primary.append(leaseSummary(item));
      summary.querySelectorAll(':scope > p:not([class]),.phone-detail-price-v2,.phone-detail-facts-v2').forEach(function(el){el.remove();});
    }
    // Preserve availability warnings at the top, independent of the price style.
    var warning=summary.querySelector('.source-unavailable');if(warning)primary.prepend(warning);
    layout.append(media,primary);summary.before(layout);
    // Keep navigation outside the scrolling photos/facts. A sticky strip inside
    // the padded body exposed content above it and covered the photo on scroll.
    var nav=body.querySelector('.sale-dossier-nav-v3');
    if(nav){body.before(nav);if(body._saleDossierSyncV3)body._saleDossierSyncV3();}
    var actions=summary.querySelector('.unified-detail-utility-actions-v8');
    if(actions){decorateActions(actions);if(drawer.__detailPresentationV2&&drawer.__detailPresentationV2.phone)layout.after(actions);else drawer.append(actions);}
    var management=summary.querySelector('.unified-detail-actions-v8');
    if(management){var disclosure=document.createElement('details'),title=document.createElement('summary');disclosure.className='wide-detail-management-v26';title.textContent='광고 관리';disclosure.append(title,management);summary.append(disclosure);}
  }
  global.JSWideDetailV26={mount:mount,position:position,known:known};
})(window);
