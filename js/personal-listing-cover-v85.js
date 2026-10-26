(function(global){
  'use strict';
  var account=String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase(),covers=new Map(),broken=new Set(),editor=null,active=null,sequence=0,choiceSequence=0,stream=null,previewUrl='',handle='';
  function currentAccount(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function sameAccount(){return !!account&&account===currentAccount();}
  function idOf(item){return String(item&&item.propertyId||'');}
  function urlFor(item,thumb){var c=sameAccount()&&covers.get(idOf(item)),url=c&&c.imageId?(thumb?c.thumbnailUrl:c.url):'';return broken.has(url)?'':url;}
  async function api(query,body){
    if(!sameAccount())throw Error('로그인 계정이 변경됐습니다. 새로고침해 주세요.');
    var params=new URLSearchParams(query||{});params.set('expectedAccountEmail',account);
    var response=await fetch('/api/personal-cover?'+params,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),
      headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(Object.assign({},body,{expectedAccountEmail:account})):undefined});
    var result=await response.json();
    if(!sameAccount())throw Error('로그인 계정이 변경됐습니다. 새로고침해 주세요.');
    if(!response.ok||!result.ok)throw Error(result.message||'대표사진을 불러오지 못했습니다. 다시 시도해 주세요.');return result;
  }
  function fallback(img){
    var failed=img.getAttribute('data-cover-image-v85');if(failed)broken.add(failed);
    var original=img.dataset.coverFallbackV85||'';img.removeAttribute('data-cover-image-v85');
    if(original){img.src=original;img.onerror=function(){this.replaceWith(document.createTextNode('사진 없음'));};}
    else{var label=document.createElement('span');label.textContent='사진 없음';img.closest('button')?.classList.replace('has-photo','no-photo');img.replaceWith(label);}
  }
  function updateCard(button){
    var id=button.dataset.coverPropertyV85,cover=urlFor({propertyId:id},true),img=button.querySelector('img'),original=button.dataset.coverOriginalV85||'';
    if(!cover){if(img&&img.hasAttribute('data-cover-image-v85'))fallback(img);return;}
    if(img&&img.getAttribute('data-cover-image-v85')===cover)return;
    if(!img){img=document.createElement('img');button.querySelector('span')?.remove();button.prepend(img);}
    img.removeAttribute('data-thumbnail-pending-v69');img.removeAttribute('data-thumbnail-source-v8144');
    img.dataset.coverFallbackV85=original;img.setAttribute('data-cover-image-v85',cover);img.alt='내 대표사진';img.loading='lazy';img.decoding='async';
    img.onload=function(){button.classList.add('has-photo');button.classList.remove('no-photo');};img.onerror=function(){fallback(this);};img.src=cover;
  }
  function refresh(){
    document.querySelectorAll('[data-cover-property-v85]').forEach(updateCard);
    var body=document.getElementById('unifiedDetailBodyV8'),saved=body?.closest('#unifiedDetailDrawerV8')?.__detailPresentationV2;
    if(saved)decorateDetail(body,{propertyId:saved.propertyId});
  }
  async function loadIndex(){
    if(!sameAccount())return;
    try{var next='',loaded=new Map();do{var result=await api(next?{cursor:next}:{});result.covers.forEach(function(c){loaded.set(c.propertyId,c);});next=result.nextCursor;}while(next&&sameAccount());
      if(sameAccount()){covers.forEach(function(cover,key){if(cover.version>(loaded.get(key)?.version||0))loaded.set(key,cover);});covers=loaded;refresh();}
    }catch(_error){/* Listing startup and originals remain independent of the personal image index. */}
  }
  function decorateDetail(body,item){
    if(!body)return;var gallery=body.querySelector('.unified-detail-gallery-v8');if(!gallery)return;
    var old=body.querySelector('.cover-detail-v85'),url=urlFor(item,false);
    if(old&&old.dataset.imageUrl===url)return;if(old)old.remove();gallery.hidden=false;if(!url)return;
    var box=document.createElement('section'),tabs=document.createElement('div'),own=document.createElement('button'),original=document.createElement('button'),photo=document.createElement('img');
    box.className='cover-detail-v85';box.dataset.imageUrl=url;tabs.className='cover-detail-tabs-v85';own.type=original.type='button';own.textContent='내 대표사진';original.textContent='광고사진';
    own.setAttribute('aria-pressed','true');original.setAttribute('aria-pressed','false');photo.src=url;photo.alt='내가 지정한 대표사진';photo.decoding='async';
    function showOwn(value){photo.hidden=!value;gallery.hidden=value;own.setAttribute('aria-pressed',String(value));original.setAttribute('aria-pressed',String(!value));}
    own.onclick=function(){showOwn(true);};original.onclick=function(){showOwn(false);};photo.onerror=function(){box.remove();gallery.hidden=false;};
    tabs.append(own,original);box.append(tabs,photo);gallery.before(box);showOwn(true);
  }
  function roadviewContext(){
    if(!sameAccount()||!document.querySelector('#roadviewModal.open'))return null;
    var key=typeof currentRoadviewItemKey!=='undefined'?currentRoadviewItemKey:null,items=typeof allItems!=='undefined'?allItems:[],item=items.find(function(x){return x.key===key;});
    if(!item||!idOf(item))return null;
    return {propertyId:idOf(item),key:key,mode:typeof currentRoadviewMode==='undefined'?'map':currentRoadviewMode,
      sequence:typeof roadviewOpenSequenceV653==='undefined'?0:roadviewOpenSequenceV653,address:item.address||item.name||''};
  }
  function valid(ctx){var now=roadviewContext();return !!now&&ctx&&now.propertyId===ctx.propertyId&&now.key===ctx.key&&now.mode===ctx.mode&&now.sequence===ctx.sequence;}
  function stop(){if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;}}
  function release(){if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}}
  function status(message){if(editor)editor.querySelector('[role=status]').textContent=message;}
  function close(){sequence++;active=null;stop();release();if(editor?.open)editor.close();}
  function contextChanged(){close();var button=document.getElementById('roadviewCoverButtonV85');if(button)button.disabled=!roadviewContext();}
  function busy(value){editor.querySelectorAll('button:not([data-cover-close-v85]),input').forEach(function(el){el.disabled=value;});}
  function target(ctx){return document.querySelector(ctx.mode==='naver'?'#naverRoadviewPane .naver-roadview-panorama-panel-v654':ctx.mode==='kakao'?'#roadviewPane':'#no-roadview-capture');}
  function ensureEditor(){
    if(editor)return;
    editor=document.createElement('dialog');editor.className='cover-editor-v85';editor.setAttribute('aria-labelledby','coverEditorTitleV85');
    editor.innerHTML='<header><h2 id="coverEditorTitleV85">내 대표사진</h2><button type="button" data-cover-close-v85 aria-label="닫기">×</button></header><p class="cover-target-v85"></p><p>건물 거리뷰 영역만 촬영합니다. 옆 지도와 상단 버튼은 저장하지 않습니다.</p><div class="cover-editor-actions-v85"><button type="button" data-cover-capture-v85>현재 화면 촬영</button><label>사진 올리기<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label><button type="button" data-cover-paste-v85>사진 붙여넣기</button></div><p class="cover-capture-help-v85">PC에서 ‘현재 JS부동산 탭’을 선택해 공유해 주세요. 촬영이 지원되지 않는 기기는 사진 올리기·붙여넣기를 이용하세요.</p><div class="cover-preview-v85"><span>촬영하거나 올린 사진을 여기서 확인하세요.</span><img alt="저장 전 대표사진 미리보기" hidden></div><p role="status" aria-live="polite"></p><footer><button type="button" data-cover-reset-v85>원래 사진으로 복원</button><button type="button" data-cover-save-v85 disabled>대표사진 저장</button></footer>';
    document.body.append(editor);editor.querySelector('[data-cover-close-v85]').onclick=close;editor.addEventListener('cancel',function(e){e.preventDefault();close();});
    editor.querySelector('[data-cover-capture-v85]').onclick=capture;
    var uploadLabel=editor.querySelector('label');uploadLabel.tabIndex=0;uploadLabel.setAttribute('role','button');uploadLabel.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();this.querySelector('input').click();}};
    editor.querySelector('input').onchange=function(){var file=this.files[0];this.value='';if(file)choose(file,'upload');};
    editor.querySelector('[data-cover-paste-v85]').onclick=async function(){var token=sequence,state=active;try{var entries=await navigator.clipboard.read();var entry=entries.find(function(e){return e.types.some(function(t){return /^image\/(png|jpeg|webp)$/.test(t);});});if(!entry)throw Error('복사한 사진이 없습니다.');var blob=await entry.getType(entry.types.find(function(t){return t.startsWith('image/');}));if(token===sequence&&active===state)choose(blob,'paste');}catch(_e){if(token===sequence)status('사진을 복사한 뒤 이 창에서 Ctrl+V 또는 사진 올리기를 이용해 주세요.');}};
    editor.addEventListener('paste',function(e){var file=Array.from(e.clipboardData?.files||[]).find(function(f){return f.type.startsWith('image/');});if(file){e.preventDefault();choose(file,'paste');}});
    editor.querySelector('[data-cover-save-v85]').onclick=function(){save(false);};editor.querySelector('[data-cover-reset-v85]').onclick=function(){save(true);};
  }
  async function open(){
    var ctx=roadviewContext();if(!ctx)return;close();ensureEditor();var token=sequence;active={ctx:ctx,ready:false,candidate:null};
    editor.querySelector('.cover-target-v85').textContent=ctx.address;editor.querySelector('.cover-preview-v85 img').hidden=true;editor.querySelector('.cover-preview-v85 span').hidden=false;
    editor.showModal();busy(true);status('현재 대표사진을 확인하고 있습니다.');
    try{var result=await api({propertyId:ctx.propertyId});if(token!==sequence||!valid(ctx))return;covers.set(ctx.propertyId,result.cover);active.ready=true;busy(false);setControls();status('저장 전에 아래 미리보기에서 범위를 확인해 주세요.');}
    catch(e){if(token===sequence){status(e.message);busy(false);setControls();}}
  }
  function setControls(){
    var state=active;editor.querySelector('[data-cover-save-v85]').disabled=!state?.ready||!state.candidate;
    editor.querySelector('[data-cover-reset-v85]').disabled=!state?.ready||!covers.get(state.ctx.propertyId)?.imageId;
    editor.querySelector('[data-cover-capture-v85]').disabled=!state?.ready||state.ctx.mode==='map'||!navigator.mediaDevices?.getDisplayMedia;
  }
  function canvasFor(source,maxSide,width,height){var scale=Math.min(1,maxSide/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(16,Math.round(width*scale));canvas.height=Math.max(16,Math.round(height*scale));var draw=canvas.getContext('2d');draw.fillStyle='#fff';draw.fillRect(0,0,canvas.width,canvas.height);draw.drawImage(source,0,0,canvas.width,canvas.height);return canvas;}
  function encode(canvas,limit){for(var q=.88;q>=.40;q-=.08){var value=canvas.toDataURL('image/jpeg',q);if(value.length*3/4<limit)return value;}throw Error('사진 용량이 큽니다. 더 작은 사진을 선택해 주세요.');}
  async function choose(blob,source){
    var state=active,token=sequence,choice=++choiceSequence;if(!state?.ready||!valid(state.ctx))return;busy(true);status('사진 미리보기를 준비하고 있습니다.');
    var bitmap;try{
      if(!/^image\/(jpeg|png|webp)$/.test(blob.type)||blob.size>20000000)throw Error('20MB 이하 JPG·PNG·WebP 사진을 선택해 주세요.');
      bitmap=await createImageBitmap(blob);if(token!==sequence||choice!==choiceSequence||!valid(state.ctx))return;
      if(Math.min(bitmap.width,bitmap.height)<16)throw Error('사진 크기가 너무 작습니다.');
      var main=canvasFor(bitmap,1280,bitmap.width,bitmap.height),thumb=canvasFor(main,320,main.width,main.height);
      state.candidate={image:encode(main,750000),thumbnail:encode(thumb,80000),source:source,requestId:crypto.randomUUID()};
      release();var imageBlob=await new Promise(function(resolve){main.toBlob(resolve,'image/jpeg',.88);});if(token!==sequence||choice!==choiceSequence||!valid(state.ctx))return;
      previewUrl=URL.createObjectURL(imageBlob);var img=editor.querySelector('.cover-preview-v85 img');img.src=previewUrl;img.hidden=false;editor.querySelector('.cover-preview-v85 span').hidden=true;
      status(source==='naver'||source==='kakao'?'건물 거리뷰만 촬영했습니다. 범위를 확인한 뒤 저장해 주세요.':'사진을 확인한 뒤 저장해 주세요.');
    }catch(e){if(token===sequence&&choice===choiceSequence)status(e.message);}finally{bitmap?.close();if(token===sequence&&choice===choiceSequence){busy(false);setControls();}}
  }
  async function capture(){
    var state=active,token=sequence;if(!state?.ready||!valid(state.ctx))return;
    if(!handle){status('이 브라우저는 현재 탭을 안전하게 확인할 수 없습니다. 사진 올리기를 이용해 주세요.');return;}
    editor.close();busy(true);var video=document.createElement('video'),localStream;
    try{
      // Invoke synchronously from the click. No permission request occurs on startup.
      localStream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude',monitorTypeSurfaces:'exclude'});
      if(token!==sequence||!valid(state.ctx)){localStream.getTracks().forEach(function(t){t.stop();});return;}stream=localStream;
      var track=stream.getVideoTracks()[0],identity=track.getCaptureHandle?.();
      if(track.getSettings().displaySurface!=='browser'||identity?.handle!==handle||identity?.origin!==location.origin)throw Error('현재 JS부동산 탭을 선택해야 건물 영역만 정확히 촬영할 수 있습니다.');
      video.muted=true;video.playsInline=true;video.srcObject=stream;
      await Promise.race([video.play(),new Promise(function(_r,reject){setTimeout(function(){reject(Error('촬영 화면을 받지 못했습니다. 다시 시도해 주세요.'));},8000);})]);
      await new Promise(function(resolve){setTimeout(resolve,350);});
      if(token!==sequence||!valid(state.ctx))return;
      var rect=target(state.ctx)?.getBoundingClientRect(),w=global.innerWidth,h=global.innerHeight;
      if(!rect||rect.width<32||rect.height<32||rect.left<0||rect.top<0||rect.right>w+1||rect.bottom>h+1||!video.videoWidth||!video.videoHeight||Math.abs(video.videoWidth/video.videoHeight-w/h)>.025)throw Error('촬영 영역이 화면에 모두 보이도록 창을 넓힌 뒤 다시 촬영해 주세요.');
      // Exact panel rectangle: excludes the Naver sibling map and header by construction.
      var scaleX=video.videoWidth/w,scaleY=video.videoHeight/h,canvas=document.createElement('canvas');
      var left=Math.ceil(rect.left*scaleX)+1,top=Math.ceil(rect.top*scaleY)+1,right=Math.floor(rect.right*scaleX)-1,bottom=Math.floor(rect.bottom*scaleY)-1;
      canvas.width=right-left;canvas.height=bottom-top;
      canvas.getContext('2d').drawImage(video,left,top,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
      var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/jpeg',.94);});
      stop();video.srcObject=null;
      if(token!==sequence||!valid(state.ctx))return;editor.showModal();await choose(blob,state.ctx.mode);
    }catch(e){if(token===sequence&&valid(state.ctx)){editor.showModal();status(e.name==='NotAllowedError'?'촬영을 취소했습니다. 현재 탭을 선택해 다시 촬영하거나 사진을 올려 주세요.':e.message);}}
    finally{localStream?.getTracks().forEach(function(t){t.stop();});if(stream===localStream)stream=null;video.srcObject=null;if(token===sequence){busy(false);setControls();}}
  }
  async function save(reset){
    var state=active,token=sequence;if(!state?.ready||!valid(state.ctx)||(!reset&&!state.candidate))return;busy(true);status('대표사진을 저장하고 있습니다.');
    var body=Object.assign({},reset?{requestId:state.resetRequestId||(state.resetRequestId=crypto.randomUUID())}:state.candidate,{action:reset?'reset':'save',propertyId:state.ctx.propertyId,expectedVersion:covers.get(state.ctx.propertyId)?.version||0});
    try{var result;
      try{result=await api(null,body);}catch(error){var latest=await api({propertyId:state.ctx.propertyId}).catch(function(){return null;});if(latest?.cover.requestId===body.requestId)result=latest;else{if(latest)covers.set(state.ctx.propertyId,latest.cover);throw error;}}
      covers.set(state.ctx.propertyId,result.cover);refresh();if(token!==sequence||!valid(state.ctx))return;state.candidate=null;release();editor.querySelector('.cover-preview-v85 img').hidden=true;editor.querySelector('.cover-preview-v85 span').hidden=false;
      status(reset?'원래 광고 사진으로 복원했습니다.':'내 계정의 대표사진으로 저장했습니다.');
    }catch(e){if(token===sequence)status(e.message+' 미리보기는 유지됩니다.');}finally{if(token===sequence){busy(false);setControls();}}
  }
  try{if(navigator.mediaDevices?.setCaptureHandleConfig){handle=crypto.randomUUID();navigator.mediaDevices.setCaptureHandleConfig({handle:handle,exposeOrigin:true,permittedOrigins:[location.origin]});}}catch(_e){handle='';}
  global.JSListingCoverV85={urlFor:urlFor,decorateDetail:decorateDetail,imageError:fallback,contextChanged:contextChanged,open:open};
  var button=document.getElementById('roadviewCoverButtonV85');if(button)button.onclick=open;
  // Observer is limited to modal lifecycle attributes; map tiles and listing mutations are ignored.
  var modal=document.getElementById('roadviewModal');if(modal)new MutationObserver(function(){if(!modal.classList.contains('open'))close();if(button)button.disabled=!roadviewContext();}).observe(modal,{attributes:true,attributeFilter:['class']});
  global.addEventListener('pagehide',close);global.addEventListener('pageshow',function(e){if(e.persisted)loadIndex();});
  document.addEventListener('visibilitychange',function(){if(!sameAccount()){close();covers.clear();refresh();}});
  setTimeout(loadIndex,0);
})(window);
