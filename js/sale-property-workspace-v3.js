/* Optional sale-only map views and a navigable property dossier. No data writes. */
(function(global){
  'use strict';
  var controls=document.getElementById('saleMapViewsV3'), ownedMap=null, previousType=null, baseChanged=false, district=false, terrain=false, terrainMessage=false;
  var mapViewButtons=[document.getElementById('saleMapViewsBtnV45'),document.getElementById('saleMapViewsPhoneBtnV45')].filter(Boolean);
  function closeMapViews(){
    if(controls)controls.hidden=true;
    mapViewButtons.forEach(function(button){button.setAttribute('aria-expanded','false');button.classList.remove('on');});
  }
  function positionMapViews(){
    if(!controls||controls.hidden)return;
    controls.style.top='';
    if(document.documentElement.classList.contains('js-phone-app-v2'))return;
    var button=mapViewButtons[0],host=controls.offsetParent;
    if(button&&host){var rect=host.getBoundingClientRect();controls.style.top=Math.max(8,Math.min(button.getBoundingClientRect().top-rect.top,rect.height-controls.offsetHeight-8))+'px';}
  }
  function toggleMapViews(){
    if(!controls||!isSale())return;
    var open=controls.hidden;
    if(global.closeMapQuickPopoversV657)global.closeMapQuickPopoversV657();
    controls.hidden=!open;
    mapViewButtons.forEach(function(button){button.setAttribute('aria-expanded',String(open));button.classList.toggle('on',open);});
    if(open){update();positionMapViews();}
  }
  function isSale(){return global.JSListingTradeV1 && global.JSListingTradeV1.getMode()!=='lease';}
  function isLand(){return global.JSListingTradeV1&&global.JSListingTradeV1.getMode()==='land_sale';}
  function removeTerrain(){if(terrain&&ownedMap)ownedMap.removeOverlayMapTypeId(global.kakao.maps.MapTypeId.TERRAIN);terrain=false;}
  function restore(){
    removeTerrain();
    if(ownedMap){
      if(district)ownedMap.removeOverlayMapTypeId(global.kakao.maps.MapTypeId.USE_DISTRICT);
      if(baseChanged && previousType!=null)ownedMap.setMapTypeId(previousType);
    }
    ownedMap=null;previousType=null;baseChanged=false;district=false;
  }
  function update(){
    if(!controls)return;
    mapViewButtons.forEach(function(button){button.hidden=!isSale();});
    if(!isSale())closeMapViews();
    if(!isLand()&&terrainMessage){controls.querySelector('[data-sale-map-status]').textContent='';terrainMessage=false;}
    var map=global.map,types=global.kakao&&global.kakao.maps&&global.kakao.maps.MapTypeId;
    if(terrain&&(!isLand()||ownedMap!==map))removeTerrain();
    var current=map&&typeof map.getMapTypeId==='function'?map.getMapTypeId():null;
    controls.querySelectorAll('[data-sale-map-view]').forEach(function(button){
      var key=button.dataset.saleMapView;
      if(key==='terrain')button.hidden=!isLand();
      button.setAttribute('aria-pressed',String(key==='terrain'?terrain:key==='district'?district:key==='satellite'?!!(types&&current===types.HYBRID):!!(types&&current===types.ROADMAP)));
    });
    controls.querySelector('[data-sale-map-note]').hidden=!district;
    var terrainNote=controls.querySelector('[data-sale-terrain-note]');if(terrainNote)terrainNote.hidden=!terrain;
  }
  function choose(view){
    if(!isSale()||!['normal','satellite','district','terrain'].includes(view)||view==='terrain'&&!isLand())return;
    var map=global.map,types=global.kakao&&global.kakao.maps&&global.kakao.maps.MapTypeId;
    if(!map||!types||typeof map.setMapTypeId!=='function'||typeof map.addOverlayMapTypeId!=='function'){
      terrainMessage=view==='terrain';
      if(controls)controls.querySelector('[data-sale-map-status]').textContent='지도가 준비되면 다시 눌러 주세요.';
      return;
    }
    if(view==='terrain'&&(types.TERRAIN==null||typeof map.removeOverlayMapTypeId!=='function')){
      terrainMessage=true;
      if(controls)controls.querySelector('[data-sale-map-status]').textContent='현재 지도에서 지형도를 준비하지 못했습니다. 새로고침 후 다시 눌러 주세요.';
      return;
    }
    if(ownedMap!==map){restore();ownedMap=map;previousType=map.getMapTypeId();}
    if(view==='terrain'){
      if(terrain)removeTerrain();else{map.addOverlayMapTypeId(types.TERRAIN);terrain=true;}
    }else if(view==='district'){
      if(district)map.removeOverlayMapTypeId(types.USE_DISTRICT);else map.addOverlayMapTypeId(types.USE_DISTRICT);
      district=!district;
    }else{map.setMapTypeId(view==='satellite'?types.HYBRID:types.ROADMAP);baseChanged=true;}
    if(controls)controls.querySelector('[data-sale-map-status]').textContent='';
    terrainMessage=false;
    update();
  }
  function mountDetail(root,item){
    if(!root)return;
    if(root._saleDossierCleanupV40)root._saleDossierCleanupV40();
    if(!global.JSListingTradeV1||!global.JSListingTradeV1.isSale(item)){
      if(global.JSSaleDossierV9)global.JSSaleDossierV9.mountDetail(root,item);
      if(root._saleDossierBoundV3)root.removeEventListener('scroll',root._saleDossierBoundV3);
      if(root._saleDossierFrameV3)global.cancelAnimationFrame(root._saleDossierFrameV3);
      root._saleDossierBoundV3=null;root._saleDossierSyncV3=null;root._saleDossierNavV3=null;root._saleDossierFrameV3=0;return;
    }
    if(global.JSSalePublicReviewV6)global.JSSalePublicReviewV6.mount(root,item);
    var gallery=root.querySelector('.unified-detail-gallery-v8'),slot=root.querySelector('.sale-photo-slot-v3');
    if(gallery&&slot){slot.append(gallery);slot.hidden=!gallery.querySelector('.unified-detail-hero-v8')&&!(Number(item.photoCount)>0);}
    var description=root.querySelector('.listing-sale-description-v1');if(description)description.dataset.saleSection='description';
    var tools=root.querySelector('.sale-tools-v1');if(tools)tools.dataset.saleSection='workbench';
    var labels=[['요약',['summary']],['토지·건물',['land','building','areas','review','income']],['공적자료',['register','publicland','transactions']],['매입검토',['workbench']],['사진·원문',['photos','description']]];
    var nav=document.createElement('nav');nav.className='sale-dossier-nav-v3';nav.setAttribute('aria-label','매매 상세 항목 이동');
    labels.forEach(function(entry){
      var keys=entry[1].filter(function(key){var el=root.querySelector('[data-sale-section="'+key+'"]');return el&&!el.hidden;});if(!keys.length)return;
      var key=keys[0],target=root.querySelector('[data-sale-section="'+key+'"]');
      var button=document.createElement('button');button.type='button';button.dataset.saleSectionTarget=key;button.dataset.saleGroupSections=keys.join(',');button.textContent=entry[0];
      button.onclick=function(){
        target=root.querySelector('[data-sale-section="'+key+'"]');if(!target)return;
        if(keys.includes('description')){var description=root.querySelector('[data-sale-section="description"]');if(description)description.open=true;}
        if(target.tagName==='DETAILS')target.open=true;
        root.scrollTo({top:Math.max(0,root.scrollTop+target.getBoundingClientRect().top-root.getBoundingClientRect().top-(root.contains(nav)?nav.offsetHeight:0)-10),behavior:global.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      };
      nav.append(button);
    });
    root.prepend(nav);
    root._saleDossierNavV3=nav;
    // Cache content offsets when layout changes. Wheel/touch scrolling only
    // compares numbers; it must not scan/re-measure every section each frame.
    var buttons=Array.from(nav.querySelectorAll('button')),offsets=[],inset=16,current=null,dirty=true,observed=new Set();
    var observer=global.ResizeObserver?new global.ResizeObserver(invalidate):null;
    function measure(){
      dirty=false;offsets=[];
      var origin=root.getBoundingClientRect().top-root.scrollTop,nodes=new Set([root]);
      inset=(root.contains(nav)?nav.offsetHeight:0)+16;
      Array.from(root.children).forEach(function(el){nodes.add(el);});
      buttons.forEach(function(button){button.dataset.saleGroupSections.split(',').forEach(function(key){
        var target=root.querySelector('[data-sale-section="'+key+'"]');if(!target)return;
        for(var el=target;el&&el!==root;el=el.parentElement)nodes.add(el);
        if(target.hidden)return;var rect=target.getBoundingClientRect();
        if(rect.width||rect.height)offsets.push({button:button,top:rect.top-origin});
      });});
      if(observer){
        observed.forEach(function(el){if(!nodes.has(el))observer.unobserve(el);});
        nodes.forEach(function(el){if(!observed.has(el))observer.observe(el);});observed=nodes;
      }
    }
    function update(){
      if(dirty||!observer)measure();
      var top=root.scrollTop+inset,best=buttons[0],bestTop=-Infinity;
      if(root.scrollTop>1)offsets.forEach(function(entry){if(entry.top<=top&&entry.top>bestTop){best=entry.button;bestTop=entry.top;}});
      if(best===current)return;
      if(current)current.removeAttribute('aria-current');
      if(best)best.setAttribute('aria-current','location');current=best;
    }
    function queue(){
      if(root._saleDossierFrameV3)return;
      root._saleDossierFrameV3=global.requestAnimationFrame(function(){
        root._saleDossierFrameV3=0;if(nav.isConnected)update();
      });
    }
    function invalidate(){dirty=true;queue();}
    root._saleDossierSyncV3=function(){dirty=true;update();};
    root._saleDossierBoundV3=queue;
    root.addEventListener('scroll',queue,{passive:true});
    // Disclosure/image changes and late public results invalidate offsets;
    // nothing scrolls the reader or rebuilds the detail as part of this work.
    root.addEventListener('toggle',invalidate,true);root.addEventListener('load',invalidate,true);
    root._saleDossierCleanupV40=function(){
      if(observer)observer.disconnect();
      root.removeEventListener('scroll',queue);root.removeEventListener('toggle',invalidate,true);root.removeEventListener('load',invalidate,true);
      if(root._saleDossierFrameV3)global.cancelAnimationFrame(root._saleDossierFrameV3);
      root._saleDossierFrameV3=0;root._saleDossierBoundV3=null;root._saleDossierSyncV3=null;root._saleDossierCleanupV40=null;
    };
    update();
    if(global.JSSaleDossierV9)global.JSSaleDossierV9.mountDetail(root,item);
    if(global.JSSaleReviewV10)global.JSSaleReviewV10.mountDetail(root,item);
  }
  if(controls)controls.addEventListener('click',function(event){var button=event.target.closest('[data-sale-map-view]');if(button)choose(button.dataset.saleMapView);});
  mapViewButtons.forEach(function(button){button.addEventListener('click',toggleMapViews);});
  document.addEventListener('click',function(event){if(controls&&!controls.contains(event.target)&&!mapViewButtons.some(function(button){return button.contains(event.target);}))closeMapViews();});
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&controls&&!controls.hidden){var inside=controls.contains(document.activeElement);closeMapViews();if(inside){var button=mapViewButtons.find(function(button){return button.getClientRects().length;});if(button)button.focus();}}});
  global.addEventListener('resize',positionMapViews);
  global.addEventListener('js-listing-trade-mode-change',function(){closeMapViews();if(!isSale())restore();update();});
  global.JSSalePropertyWorkspaceV3={choose:choose,mountDetail:mountDetail,sync:update};update();
})(window);
