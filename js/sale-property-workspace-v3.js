/* Optional sale-only map views and a navigable property dossier. No data writes. */
(function(global){
  'use strict';
  var controls=document.getElementById('saleMapViewsV3'), ownedMap=null, previousType=null, baseChanged=false, district=false;
  function isSale(){return global.JSListingTradeV1 && global.JSListingTradeV1.getMode()!=='lease';}
  function restore(){
    if(ownedMap){
      if(district)ownedMap.removeOverlayMapTypeId(global.kakao.maps.MapTypeId.USE_DISTRICT);
      if(baseChanged && previousType!=null)ownedMap.setMapTypeId(previousType);
    }
    ownedMap=null;previousType=null;baseChanged=false;district=false;
  }
  function update(){
    if(!controls)return;
    controls.hidden=!isSale();
    var map=global.map,types=global.kakao&&global.kakao.maps&&global.kakao.maps.MapTypeId;
    var current=map&&typeof map.getMapTypeId==='function'?map.getMapTypeId():null;
    controls.querySelectorAll('[data-sale-map-view]').forEach(function(button){
      var key=button.dataset.saleMapView;
      button.setAttribute('aria-pressed',String(key==='district'?district:key==='satellite'?!!(types&&current===types.HYBRID):!!(types&&current===types.ROADMAP)));
    });
    controls.querySelector('[data-sale-map-note]').hidden=!district;
  }
  function choose(view){
    if(!isSale()||!['normal','satellite','district'].includes(view))return;
    var map=global.map,types=global.kakao&&global.kakao.maps&&global.kakao.maps.MapTypeId;
    if(!map||!types||typeof map.setMapTypeId!=='function'||typeof map.addOverlayMapTypeId!=='function'){
      if(controls)controls.querySelector('[data-sale-map-status]').textContent='지도가 준비되면 다시 눌러 주세요.';
      return;
    }
    if(ownedMap!==map){restore();ownedMap=map;previousType=map.getMapTypeId();}
    if(view==='district'){
      if(district)map.removeOverlayMapTypeId(types.USE_DISTRICT);else map.addOverlayMapTypeId(types.USE_DISTRICT);
      district=!district;
    }else{map.setMapTypeId(view==='satellite'?types.HYBRID:types.ROADMAP);baseChanged=true;}
    if(controls)controls.querySelector('[data-sale-map-status]').textContent='';
    update();
  }
  function mountDetail(root,item){
    if(!root)return;
    if(!global.JSListingTradeV1||!global.JSListingTradeV1.isSale(item)){
      if(global.JSSaleDossierV9)global.JSSaleDossierV9.mountDetail(root,item);
      if(root._saleDossierBoundV3)root.removeEventListener('scroll',root._saleDossierBoundV3);
      if(root._saleDossierFrameV3)global.cancelAnimationFrame(root._saleDossierFrameV3);
      root._saleDossierBoundV3=null;root._saleDossierSyncV3=null;root._saleDossierFrameV3=0;return;
    }
    if(global.JSSalePublicReviewV6)global.JSSalePublicReviewV6.mount(root,item);
    var gallery=root.querySelector('.unified-detail-gallery-v8'),slot=root.querySelector('.sale-photo-slot-v3');
    if(gallery&&slot){slot.append(gallery);slot.hidden=!gallery.querySelector('.unified-detail-hero-v8')&&!(Number(item.photoCount)>0);}
    var description=root.querySelector('.listing-sale-description-v1');if(description)description.dataset.saleSection='description';
    var tools=root.querySelector('.sale-tools-v1');if(tools)tools.dataset.saleSection='workbench';
    var labels=[['요약',['summary']],['토지·건물',['land','building','areas','review']],['공적자료',['register','publicland','transactions']],['매입검토',['workbench','income']],['사진·원문',['photos','description']]];
    var nav=document.createElement('nav');nav.className='sale-dossier-nav-v3';nav.setAttribute('aria-label','매매 상세 항목 이동');
    labels.forEach(function(entry){
      var keys=entry[1].filter(function(key){var el=root.querySelector('[data-sale-section="'+key+'"]');return el&&!el.hidden;});if(!keys.length)return;
      var key=keys[0],target=root.querySelector('[data-sale-section="'+key+'"]');
      var button=document.createElement('button');button.type='button';button.dataset.saleSectionTarget=key;button.dataset.saleGroupSections=keys.join(',');button.textContent=entry[0];
      button.onclick=function(){
        target=root.querySelector('[data-sale-section="'+key+'"]');if(!target)return;
        if(keys.includes('description')){var description=root.querySelector('[data-sale-section="description"]');if(description)description.open=true;}
        if(target.tagName==='DETAILS')target.open=true;
        root.scrollTo({top:Math.max(0,root.scrollTop+target.getBoundingClientRect().top-root.getBoundingClientRect().top-nav.offsetHeight-10),behavior:global.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      };
      nav.append(button);
    });
    root.prepend(nav);
    function syncNav(){
      var top=root.getBoundingClientRect().top+nav.offsetHeight+16, best=null, bestTop=-Infinity;
      nav.querySelectorAll('button').forEach(function(button){button.dataset.saleGroupSections.split(',').forEach(function(key){var target=root.querySelector('[data-sale-section="'+key+'"]');if(!target||target.hidden)return;var y=target.getBoundingClientRect().top;if(y<=top&&y>bestTop){best=button;bestTop=y;}});});
      best=best||nav.querySelector('button');
      nav.querySelectorAll('button').forEach(function(button){if(button===best)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');});
    }
    root._saleDossierSyncV3=syncNav;
    if(!root._saleDossierBoundV3){root._saleDossierBoundV3=function(){
      if(root._saleDossierFrameV3)return;root._saleDossierFrameV3=global.requestAnimationFrame(function(){root._saleDossierFrameV3=0;if(root.querySelector('.sale-dossier-nav-v3'))root._saleDossierSyncV3();});
    };root.addEventListener('scroll',root._saleDossierBoundV3,{passive:true});}
    syncNav();
    if(global.JSSaleDossierV9)global.JSSaleDossierV9.mountDetail(root,item);
  }
  if(controls)controls.addEventListener('click',function(event){var button=event.target.closest('[data-sale-map-view]');if(button)choose(button.dataset.saleMapView);});
  global.addEventListener('js-listing-trade-mode-change',function(){if(!isSale())restore();update();});
  global.JSSalePropertyWorkspaceV3={choose:choose,mountDetail:mountDetail,sync:update};update();
})(window);
