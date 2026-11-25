/* Unverified advertisements never enter writable masters or geocode caches. */
(function(global){
  'use strict';
  var state={signature:'',account:'',mode:'',basis:'',items:[],pending:false,error:'',controller:null,overlays:[],overlayKey:'',overlayMap:null};
  var dialog=null,photoGeneration=0,refreshQueued=false;
  function account(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function mode(){return global.JSListingTradeV1?.getMode()||'lease';}
  function basis(){return global.JSQueryListingsV152?.dataEpochV299?.()||account();}
  function element(tag,className,text){var node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function clearMap(){state.overlays.forEach(function(overlay){overlay.setMap(null);});state.overlays=[];state.overlayKey='';state.overlayMap=null;}
  function clear(){state.controller?.abort();state.signature='';state.items=[];state.pending=false;state.error='';clearMap();document.getElementById('heldListingSearchV299')?.remove();document.querySelector('[data-held-summary-v299]')?.remove();if(dialog){photoGeneration++;dialog.close();dialog.remove();dialog=null;}}
  function current(signature){return state.signature===signature&&state.account===account()&&state.mode===mode();}
  function projected(ad){
    var row={name:ad.name,address:ad.publicArea,room:ad.room,floor:ad.room,advertisedRoomV1:ad.room,sourceFloorVerifiedV1:true,
      type:ad.saleCategory==='land'?'토지':ad.saleCategory==='building'?'건물':'상가점포',tradeType:ad.tradeType,saleCategory:ad.saleCategory,
      source:ad.source,sourceTypesV8:[ad.source],sourceListingSearchV6579:[({naver:'n',daangn:'d',gongsil:'g'})[ad.provider]+':'+ad.sourceNumber],
      deposit:ad.deposit,rent:ad.rent,salePrice:ad.salePrice,fee:ad.fee,premium:ad.premium,area:ad.area,memo:'',state:'주소미확인',displayValuePresence:{}};
    ['deposit','rent','salePrice','fee','premium','area'].forEach(function(key){row.displayValuePresence[key]=ad[key]!==null&&ad[key]!==undefined;});return row;
  }
  function visible(){
    if(!current(state.signature)||global.favoriteOnly||global.doneOnly||Number(global.newListingDays||0)>0)return [];
    var predicate=global.createQueryFilterPredicateV215?.({mode:mode(),filters:{keyword:global.jsLastAppliedKeywordV1||''}});
    return state.items.filter(function(ad){return !(global.allItems||[]).some(function(item){return global.matchesOriginalListingNumber?.(item,{provider:ad.provider,number:ad.sourceNumber});})&&
      (!global.gongsilOnly||ad.provider==='gongsil')&&(!predicate||predicate(projected(ad)));});
  }
  function validAd(ad,parsed,market){
    var sources={naver:'네이버',daangn:'당근',gongsil:'공실박스'};
    if(!ad||!Object.hasOwn(sources,ad.provider)||ad.source!==sources[ad.provider]||ad.sourceNumber!==parsed.number||parsed.provider&&ad.provider!==parsed.provider||
      ad.key!=='held:'+ad.provider+':'+ad.sourceNumber+':'+ad.tradeType||ad.status!=='address-unverified')return false;
    if(market==='lease'?ad.tradeType!=='lease':ad.tradeType!=='sale'||!ad.saleCategory||(market==='land_sale'?ad.saleCategory!=='land':ad.saleCategory==='land'))return false;
    if(!['name','publicArea','room','reason'].every(function(key){return typeof ad[key]==='string'&&ad[key].length<=160;}))return false;
    if(!['deposit','rent','salePrice','fee','premium','area'].every(function(key){return ad[key]===null||typeof ad[key]==='number'&&Number.isFinite(ad[key]);}))return false;
    function url(value){try{var parsedUrl=new URL(value);return parsedUrl.protocol==='https:'&&!parsedUrl.username&&!parsedUrl.password;}catch{return false;}}
    if(!Array.isArray(ad.images)||ad.images.length>80||!ad.images.every(url)||ad.photoCount!==ad.images.length||ad.thumbnail!==(ad.images[0]||'')||ad.link&&!url(ad.link))return false;
    return ad.location===null||ad.location?.accuracy==='provider-public'&&Number.isFinite(ad.location.latitude)&&Number.isFinite(ad.location.longitude)&&ad.location.latitude>=30&&ad.location.latitude<=40&&ad.location.longitude>=120&&ad.location.longitude<=135;
  }
  function amount(value){return value===null||value===undefined?'미확인':Number(value).toLocaleString('ko-KR');}
  function jump(ad){
    var map=global.map;if(!ad.location||!map||typeof map.setCenter!=='function'||!global.kakao?.maps?.LatLng)return;
    map.setCenter(new global.kakao.maps.LatLng(ad.location.latitude,ad.location.longitude));
    if(typeof map.getLevel==='function'&&map.getLevel()>6&&typeof map.setLevel==='function')map.setLevel(6);
    if(document.documentElement.classList.contains('js-phone-app-v2')||document.documentElement.classList.contains('jsm-mobile'))global.JSMobileAppV1?.setView('map');
    refreshMap();
  }
  function photos(ad){
    if(!ad.images.length)return;if(dialog){dialog.close();dialog.remove();}
    var signature=state.signature,index=0,box=element('dialog','held-photo-dialog-v299'),heading=element('h2','',ad.source+' '+ad.sourceNumber+' · 원본 사진');
    var image=element('img','held-photo-image-v299'),counter=element('span',''),message=element('p','held-photo-message-v299','주소 확인 전 · 원본 공개 위치는 실제 건물과 다를 수 있습니다.');
    image.alt='원본 광고 사진';image.src=ad.images[0];counter.textContent='1 / '+ad.images.length;
    var close=element('button','','닫기'),previous=element('button','','이전 사진'),next=element('button','','다음 사진');
    async function show(nextIndex){
      var generation=++photoGeneration,download=new Image();download.src=ad.images[nextIndex];
      try{await download.decode();if(generation!==photoGeneration||dialog!==box||!box.open||!current(signature))return;
        image.src=download.src;index=nextIndex;counter.textContent=(index+1)+' / '+ad.images.length;message.textContent='주소 확인 전 · 원본 공개 위치';
      }catch{if(generation===photoGeneration&&dialog===box)message.textContent='원본 사진을 확인하지 못했습니다. 다시 눌러 주세요.';}
    }
    close.onclick=function(){photoGeneration++;box.close();box.remove();if(dialog===box)dialog=null;};
    previous.onclick=function(){show((index+ad.images.length-1)%ad.images.length);};next.onclick=function(){show((index+1)%ad.images.length);};
    box.addEventListener('close',function(){if(dialog===box){photoGeneration++;dialog=null;}box.remove();});
    var controls=element('div','held-photo-controls-v299');controls.append(previous,counter,next,close);box.append(heading,image,message,controls);document.body.append(box);dialog=box;box.showModal();
  }
  function card(ad){
    var box=element('article','held-listing-card-v299');box.dataset.heldKey=ad.key;
    var photo=element('button','held-thumbnail-v299'),body=element('div','held-listing-body-v299');photo.type='button';photo.setAttribute('aria-label',ad.sourceNumber+' 원본 사진 보기');
    if(ad.thumbnail){var img=element('img','');img.src=ad.thumbnail;img.alt=ad.source+' '+ad.sourceNumber+' 원본 사진';photo.append(img);}else photo.textContent='원본 사진 없음';
    photo.disabled=!ad.images.length;photo.onclick=function(){photos(ad);};
    var title=element('strong','held-listing-title-v299',ad.source+' '+ad.sourceNumber),badge=element('span','held-listing-badge-v299','주소 확인 전');
    var area=element('div','held-listing-address-v299',(ad.publicArea||'주소 미확인')+(ad.room?' · '+ad.room:''));
    var price=element('div','held-listing-price-v299',ad.tradeType==='sale'?'매매 '+amount(ad.salePrice):'보 '+amount(ad.deposit)+' / 월 '+amount(ad.rent));
    var info=element('div','held-listing-info-v299',(ad.area===null?'면적 미확인':ad.area+'평')+' · 원본 사진 '+ad.photoCount+'장');
    var note=element('div','held-listing-note-v299',ad.location?'지도는 원본 공개 위치입니다. 정확한 건물 주소는 미확인입니다.':'원본에 지도 표시용 위치가 없습니다.');
    var actions=element('div','held-listing-actions-v299');
    if(ad.link){var link=element('a','','원본 광고');link.href=ad.link;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
    if(ad.location){var mapButton=element('button','','대략위치 보기');mapButton.type='button';mapButton.onclick=function(){jump(ad);};actions.append(mapButton);}
    body.append(title,badge,area,price,info,note,actions);box.append(photo,body);box.__heldItemV299=ad;
    ad.images.slice(0,2).forEach(function(url){var image=new Image();image.src=url;});return box;
  }
  function render(){
    if(!state.signature||!current(state.signature))return;
    var list=document.getElementById('list');if(!list)return;
    var section=document.getElementById('heldListingSearchV299'),items=visible();
    if(!state.pending&&!state.error&&!items.length){section?.remove();refreshMap();return;}
    if(!section){section=element('section','held-listing-search-v299');section.id='heldListingSearchV299';list.before(section);}
    var retained=new Map(Array.from(section.querySelectorAll('[data-held-key]')).map(function(node){return[node.dataset.heldKey,node];}));
    section.replaceChildren();var heading=element('div','held-listing-heading-v299');
    heading.textContent=state.pending?'주소 미확인 원본도 확인 중…':state.error?'주소 미확인 원본 조회 실패':'번호 일치 원본 '+items.length+'건 · 주소 확인 전';section.append(heading);
    if(state.error){section.append(element('p','',state.error));var retry=element('button','','다시 확인');retry.onclick=function(){var keyword=global.jsLastAppliedKeywordV1;clear();search(keyword);};section.append(retry);}
    items.forEach(function(ad){var existing=retained.get(ad.key);section.append(existing?.__heldItemV299===ad?existing:card(ad));});refreshMap();
  }
  function refreshMap(){
    if(state.signature&&!state.pending&&state.basis!==basis()){state.signature='';search(global.jsLastAppliedKeywordV1||'');return;}
    var map=global.map,items=visible().filter(function(ad){return ad.location;});
    if(!map||typeof map.getCenter!=='function'||!global.kakao?.maps?.CustomOverlay){clearMap();return;}
    var key=JSON.stringify(items.map(function(ad){return[ad.key,ad.location.latitude,ad.location.longitude];}));
    if(key!==state.overlayKey||map!==state.overlayMap){
      clearMap();state.overlayKey=key;state.overlayMap=map;
      var groups=new Map();items.forEach(function(ad){var id=ad.location.latitude.toFixed(5)+','+ad.location.longitude.toFixed(5);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(ad);});
      groups.forEach(function(group){var ad=group[0],button=element('button','held-map-cluster-v299','대략위치 '+group.length);button.type='button';button.setAttribute('aria-label','주소 미확인 원본 '+group.length+'건 · 대략위치');
        button.onclick=function(event){event.stopPropagation();if(document.documentElement.classList.contains('js-phone-app-v2')||document.documentElement.classList.contains('jsm-mobile'))global.JSMobileAppV1?.setView('list');document.querySelectorAll('[data-held-key]').forEach(function(node){node.classList.toggle('selected',group.some(function(item){return item.key===node.dataset.heldKey;}));});document.getElementById('heldListingSearchV299')?.scrollIntoView({block:'nearest'});};
        var overlay=new global.kakao.maps.CustomOverlay({position:new global.kakao.maps.LatLng(ad.location.latitude,ad.location.longitude),content:button,yAnchor:1,zIndex:1001});overlay.setMap(map);state.overlays.push(overlay);
      });
    }
    if(!refreshQueued){refreshQueued=true;Promise.resolve().then(function(){refreshQueued=false;
      var status=document.getElementById('status'),summary=document.querySelector('[data-held-summary-v299]'),count=visible().length;
      if(!state.signature||!count){summary?.remove();return;}
      if(status&&!summary){summary=element('span','',' · 주소 미확인 '+count+'건');summary.dataset.heldSummaryV299='1';status.append(summary);}
      else if(summary)summary.textContent=' · 주소 미확인 '+count+'건';
    });}
  }
  function search(keyword){
    var parsed=global.parseOriginalListingNumberKeyword?.(keyword),owner=account(),market=mode();
    if(!owner||!parsed?.number||parsed.provider==='manual'){clear();return;}
    var signature=JSON.stringify([owner,market,parsed.provider,parsed.number]);
    if(state.signature===signature&&state.basis===basis()){render();return;}
    clear();state.signature=signature;state.account=owner;state.mode=market;state.basis=basis();state.pending=true;state.controller=new AbortController();render();
    var controller=state.controller;
    global.JSDataAccessV6.read('heldListingSearchV299',{number:parsed.number,provider:parsed.provider||'',mode:market,expectedAccountEmail:owner},{signal:controller.signal,cache:'no-store'}).then(function(packet){
      if(state.controller!==controller||!current(signature))return;
      if(state.basis!==basis()){state.signature='';search(keyword);return;}
      if(packet.ok!==true||packet.number!==parsed.number||packet.mode!==market||!Array.isArray(packet.items)||packet.items.length>6||new Set(packet.items.map(function(ad){return ad?.key;})).size!==packet.items.length||!packet.items.every(function(ad){return validAd(ad,parsed,market);}))throw Error('원본 조회 범위를 확인하지 못했습니다.');
      state.pending=false;state.items=packet.items;render();
    }).catch(function(error){if(state.controller!==controller||!current(signature)||error.name==='AbortError')return;state.pending=false;state.items=[];state.error=error.message||'원본 조회를 다시 시도해 주세요.';render();});
  }
  global.JSHeldListingSearchV299={search:search,refreshMap:refreshMap,clear:clear};
  global.addEventListener('js-auth-required',clear);global.addEventListener('js-listing-trade-mode-change',clear);
})(window);
