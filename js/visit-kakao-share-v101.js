/* Visit notes use the selected listing's displayed fields only. No location,
   lookup, photograph, contact, background send or Kakao login token is needed. */
(function(global) {
  'use strict';
  var dialog, preview, status, shareButton, sdkPending, openSequence=0, owner='';
  function clean(value) { return String(value == null ? '' : value).replace(/\s+/g,' ').trim(); }
  function account() { return clean(global.JSAuthenticatedAccountEmail || global.JSListAccountEmail).toLowerCase(); }
  function number(item,key) {
    var value=item && item[key];
    if (item && item.displayValuePresence && item.displayValuePresence[key]===false || value==null || value==='') return '';
    var n=Number(value);return Number.isFinite(n) && n>=0 ? n.toLocaleString('ko-KR',{useGrouping:false,maximumFractionDigits:2}) : '';
  }
  function format(item) {
    var address=clean(item.address).replace(/^(?:대전광역시|대전)\s+/,'').replace(/^(?:서구|동구|중구|유성구|대덕구)\s+/,'');
    var room=item.sourceFloorVerifiedV1 ? item.advertisedRoomV1 : item.room;
    room=typeof global.formatListingRoomForCardV653==='function' ? global.formatListingRoomForCardV653(room,item.floor) : clean(room);
    var type=clean(item.type).replace(/^(?:상가점포|일반상가)$/,'상가');
    var area=number(item,'area'),deposit=number(item,'deposit'),rent=number(item,'rent');
    var price=item.tradeType==='sale' ? (number(item,'salePrice') ? '매매'+number(item,'salePrice')+'만원' : '매매가 미확인')
      : deposit!=='' && rent!=='' ? '월'+deposit+'에'+rent : '보증금·월세 미확인';
    return [address||'주소 미확인',clean(item.name),clean(room)||'층·호실 미확인',type,area!=='' && Number(area)>0 ? area+'평' : '면적 미확인',price,'출입기준'].filter(Boolean).join(' ');
  }
  function capture(items) {
    var visible=Array.isArray(global.visibleListItems) ? global.visibleListItems : [];
    return {owner:account(),lines:(items||[]).map(function(item) {
      var shown=visible.find(function(row) {
        return typeof global.actionSelectionKeyV660==='function' ? global.actionSelectionKeyV660(row)===global.actionSelectionKeyV660(item) : row.propertyId===item.propertyId;
      });
      return format(shown || item);
    })};
  }
  function appKey() {
    var script=document.querySelector('script[src*="dapi.kakao.com/v2/maps/sdk.js"]');
    try {
      var url=new URL(script && script.src);
      var key=url.searchParams.get('appkey');
      return url.origin==='https://dapi.kakao.com' && /^[a-f0-9]{32}$/i.test(key||'') ? key : '';
    } catch (_) { return ''; }
  }
  function initialize() {
    var sdk=global.Kakao,key=appKey();
    if (!sdk || !sdk.Share || typeof sdk.Share.sendDefault!=='function' || !key) throw new Error('카카오톡 공유 연결을 확인하지 못했습니다. 문구 복사를 이용해 주세요.');
    if (!sdk.isInitialized()) sdk.init(key);
    return sdk;
  }
  function loadSdk() {
    if (global.Kakao && global.Kakao.Share) { try { return Promise.resolve(initialize()); } catch(error) { return Promise.reject(error); } }
    if (sdkPending) return sdkPending;
    sdkPending=new Promise(function(resolve,reject) {
      var script=document.createElement('script'),timer;
      script.src='https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js';
      script.integrity='sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w';
      script.crossOrigin='anonymous';script.async=true;
      function done(error) {
        global.clearTimeout(timer);script.onload=script.onerror=null;
        if(error){script.remove();reject(error);return;}
        try { resolve(initialize()); } catch(failure) { reject(failure); }
      }
      script.onload=function(){done();};script.onerror=function(){done(new Error('카카오톡 연결이 지연됩니다. 문구 복사로 보내실 수 있습니다.'));};
      timer=global.setTimeout(function(){done(new Error('카카오톡 연결이 지연됩니다. 문구 복사로 보내실 수 있습니다.'));},8000);
      document.head.appendChild(script);
    }).catch(function(error){sdkPending=null;throw error;});
    return sdkPending;
  }
  function close() { openSequence++;if(dialog){dialog.close();preview.value='';}owner=''; }
  function ensure() {
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='visitKakaoShareDialogV101';dialog.setAttribute('aria-labelledby','visitKakaoShareTitleV101');
    dialog.innerHTML='<h2 id="visitKakaoShareTitleV101">임장완료 · 카톡 메모</h2><p>매물 정보로 작성했습니다. 카카오톡에서 보낼 채팅방을 선택해 주세요.</p><textarea aria-label="보낼 임장 메모" readonly></textarea><p role="status" aria-live="polite"></p><footer><button type="button" data-close>닫기</button><button type="button" data-copy>문구 복사</button><button type="button" data-share disabled>카카오톡 공유</button></footer>';
    preview=dialog.querySelector('textarea');status=dialog.querySelector('[role="status"]');shareButton=dialog.querySelector('[data-share]');
    dialog.querySelector('[data-close]').onclick=close;dialog.addEventListener('cancel',function(event){event.preventDefault();close();});
    dialog.querySelector('[data-copy]').onclick=function(){
      if(account()!==owner){close();return;}
      if(!navigator.clipboard || typeof navigator.clipboard.writeText!=='function'){preview.focus();preview.select();status.textContent='선택된 문구를 복사해서 카카오톡에 붙여넣어 주세요.';return;}
      navigator.clipboard.writeText(preview.value).then(function(){if(dialog.open)status.textContent='문구를 복사했습니다. 카카오톡에 붙여넣어 주세요.';},function(){preview.focus();preview.select();status.textContent='자동 복사가 제한됐습니다. 선택된 문구를 직접 복사해 주세요.';});
    };
    shareButton.onclick=function(){
      if(account()!==owner){close();return;}
      if(preview.value.length>200){status.textContent='긴 메모는 문구 복사로 전체를 보내주세요.';return;}
      try {
        initialize().Share.sendDefault({objectType:'text',text:preview.value,link:{webUrl:'https://js-map.com/',mobileWebUrl:'https://js-map.com/'},buttonTitle:'JS부동산 열기'});
        status.textContent='카카오톡에서 보낼 채팅방을 선택해 주세요.';
      } catch(error){status.textContent=error.message || '카카오톡 공유를 열지 못했습니다. 문구 복사를 이용해 주세요.';}
    };
    document.body.appendChild(dialog);
  }
  function open(snapshot) {
    if(!snapshot || snapshot.owner!==account() || !snapshot.lines.length)return;
    ensure();var token=++openSequence;owner=snapshot.owner;preview.value=snapshot.lines.join('\n');shareButton.disabled=true;
    status.textContent='카카오톡 공유 준비 중… 문구 복사는 바로 사용할 수 있습니다.';dialog.showModal();
    if(preview.value.length>200){status.textContent='메모가 길어 문구 복사로 전체를 보내주세요.';return;}
    loadSdk().then(function(){if(token!==openSequence || !dialog.open || owner!==account())return;shareButton.disabled=false;status.textContent='';},function(error){if(token===openSequence && dialog.open)status.textContent=error.message;});
  }
  global.JSVisitKakaoShareV101={capture:capture,open:open,format:format};
  global.addEventListener('js-auth-required',close);global.addEventListener('pagehide',close);
})(window);
