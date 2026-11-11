(function(global){
  'use strict';
  if(global.JSListingAttachmentsV181)return;
  var dialog,active=null,sequence=0,preview,previewActive=null,pdfModule;
  var pdfRoot='/assets/vendor/pdfjs-6.5.438/';
  function account(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function current(ctx){return active===ctx&&ctx.account===account()&&dialog.open;}
  function node(tag,text,className){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
  function message(ctx,text){if(current(ctx))dialog.querySelector('[role=status]').textContent=text;}
  function date(value){var d=new Date(value);return Number.isNaN(d.getTime())?'날짜 확인 필요':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);}
  function size(value){return value>=1048576?(value/1048576).toFixed(1)+'MB':Math.max(1,Math.round(value/1024))+'KB';}
  async function api(ctx,body){
    if(ctx.account!==account())throw Error('로그인 계정이 변경됐습니다. 다시 열어 주세요.');
    var result=await global.JSDataAccessV6.listingAttachments({propertyId:ctx.propertyId},{method:body?'POST':'GET',signal:AbortSignal.timeout(15000),headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(Object.assign({},body,{propertyId:ctx.propertyId,expectedAccountEmail:ctx.account})):undefined},ctx.account);
    if(result.propertyId&&result.propertyId!==ctx.propertyId)throw Error('첨부자료 연결이 다릅니다. 다시 열어 주세요.');return result;
  }
  function safeItem(item,ctx){
    if(!item||item.propertyId!==ctx.propertyId||!/^[a-f0-9-]{36}$/i.test(item.id||'')||typeof item.filename!=='string'||!Number.isInteger(item.version))throw Error('첨부자료 연결을 확인하지 못했습니다.');
    for(var key of ['url','downloadUrl']){var url=new URL(item[key],location.origin);if(url.origin!==location.origin||url.pathname!=='/api/listing-attachments'||url.searchParams.get('propertyId')!==ctx.propertyId||url.searchParams.get('file')!==item.id||!/^[a-f0-9]{64}$/.test(url.searchParams.get('owner')||''))throw Error('첨부자료 주소를 확인하지 못했습니다.');}
    return item;
  }
  function setBusy(ctx,busy){if(!current(ctx))return;ctx.busy=busy;dialog.querySelectorAll('button,input').forEach(function(e){if(!e.hasAttribute('data-close'))e.disabled=busy;});if(!ctx.ready){dialog.querySelector('[data-add]').disabled=true;dialog.querySelector('[data-retry]').disabled=true;}}
  function paint(ctx){
    if(!current(ctx))return;
    var container=dialog.querySelector('[data-files]');container.replaceChildren();
    var live=ctx.items.filter(function(i){return !i.deletedAt;}),trash=ctx.items.filter(function(i){return i.deletedAt;});
    global.JSUnifiedListingsV8?.attachmentCountChanged(ctx.propertyId,live.length);
    if(!live.length)container.append(node('p','첨부된 자료가 없습니다. 받은 표나 사진을 추가해 주세요.','attachment-empty-v181'));
    function row(item,removed){
      var card=node('article',undefined,'attachment-file-v181'),info=node('div'),name=node('strong',item.filename),meta=node('p','올린 날짜 '+date(item.uploadedAt)+' · '+size(item.byteSize));
      info.append(name,meta);card.append(info);var actions=node('div',undefined,'attachment-file-actions-v181');
      if(!removed){
        if(/^(?:image\/|application\/pdf)/.test(item.mediaType)){var view=node('button','보기','attachment-preview-open-v194');view.type='button';view.onclick=function(){openPreview(ctx,item);};actions.append(view);}
        var download=node('a','다운로드');download.href=item.downloadUrl;download.download=item.filename;actions.append(download);
      }
      var toggle=node('button',removed?'복원':'삭제');toggle.type='button';toggle.onclick=function(){change(ctx,item,removed?'restore':'trash');};actions.append(toggle);card.append(actions);return card;
    }
    live.forEach(function(item){container.append(row(item,false));});
    if(trash.length){var details=node('details'),summary=node('summary','휴지통 '+trash.length+'개');details.append(summary);trash.forEach(function(item){details.append(row(item,true));});container.append(details);}
  }
  async function load(ctx){
    message(ctx,'첨부자료를 확인하고 있습니다.');ctx.ready=false;
    if(current(ctx)){dialog.querySelector('[data-add]').disabled=true;dialog.querySelector('[data-retry]').disabled=true;}
    try{var result=await api(ctx);var items=result.items.map(function(item){return safeItem(item,ctx);});
      if(current(ctx)){ctx.items=items;ctx.ready=true;paint(ctx);message(ctx,'올린 계정에서만 보이는 자료입니다.');dialog.querySelector('[data-add]').disabled=false;dialog.querySelector('[data-retry]').disabled=false;}
    }catch(error){message(ctx,error.message);}
  }
  async function change(ctx,item,action){
    if(!current(ctx)||ctx.busy)return;setBusy(ctx,true);message(ctx,action==='trash'?'휴지통으로 옮기는 중…':'첨부자료를 복원하는 중…');
    var requestId=crypto.randomUUID();
    try{
      var result=await api(ctx,{action:action,id:item.id,expectedVersion:item.version,requestId:requestId});var saved=safeItem(result.item,ctx);
      if(current(ctx)){ctx.items=ctx.items.map(function(i){return i.id===saved.id?saved:i;});paint(ctx);message(ctx,action==='trash'?'휴지통으로 옮겼습니다. 다시 복원할 수 있습니다.':'복원했습니다.');}
    }catch(error){message(ctx,error.message);if(current(ctx))await load(ctx);}
    finally{setBusy(ctx,false);}
  }
  async function upload(ctx){
    if(!current(ctx)||ctx.busy||!ctx.ready||!ctx.queue.length)return;setBusy(ctx,true);
    try{
      while(ctx.queue.length&&ctx.account===account()){
        var pending=ctx.queue[0],file=pending.file;
        message(ctx,file.name+' 첨부 중…');
        var saved;
        try{
          var result=await global.JSDataAccessV6.listingAttachments({propertyId:ctx.propertyId},{method:'POST',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/octet-stream','x-attachment-filename':encodeURIComponent(file.name),'x-attachment-request':pending.id},body:file},ctx.account);
          if(result.persisted!==true)throw Error('첨부 결과를 확인하지 못했습니다.');saved=safeItem(result.item,ctx);
        }catch(error){
          // Check the exact immutable upload ID before offering a retry.
          var latest=await api(ctx).catch(function(){return null;});var found=latest?.items?.find(function(i){return i.id===pending.id;});
          if(!found)throw error;saved=safeItem(found,ctx);
        }
        if(saved.id!==pending.id||saved.deletedAt)throw Error('첨부 결과가 현재 파일과 다릅니다. 다시 확인해 주세요.');
        ctx.items=ctx.items.filter(function(i){return i.id!==saved.id;}).concat(saved);ctx.queue.shift();
        if(ctx.account===account())global.JSUnifiedListingsV8?.attachmentCountChanged(ctx.propertyId,ctx.items.filter(function(i){return !i.deletedAt;}).length);
        if(current(ctx))paint(ctx);
      }
      message(ctx,'첨부했습니다. 다른 기기에서도 같은 계정으로 열 수 있습니다.');
    }catch(error){message(ctx,(error.name==='TimeoutError'?'첨부 응답이 지연됩니다.':error.message)+' 선택한 파일은 유지됩니다. ‘선택 파일 다시 첨부’를 눌러 확인해 주세요.');}
    finally{setBusy(ctx,false);if(current(ctx))dialog.querySelector('[data-retry]').hidden=!ctx.queue.length;}
  }
  function previewCurrent(p){return previewActive===p&&current(p.ctx)&&preview.open;}
  function stopPreview(){
    var p=previewActive;previewActive=null;if(!p)return;
    clearTimeout(p.resizeTimer);p.observer?.disconnect();p.abort.abort();p.renderTask?.cancel();
    p.image?.removeAttribute('src');p.loadingTask?.destroy().catch(function(){});
    preview.querySelector('[data-preview-stage]').replaceChildren();
    preview.querySelector('h2').textContent='';preview.querySelector('[data-preview-meta]').textContent='';preview.querySelector('[role=status]').textContent='';
    preview.querySelector('[data-preview-download]').removeAttribute('href');preview.querySelector('[data-preview-download]').removeAttribute('download');
  }
  function closePreview(){if(preview?.open)preview.close();stopPreview();}
  function previewStatus(p,text){if(previewCurrent(p))preview.querySelector('[role=status]').textContent=text;}
  function previewControls(p){
    if(!previewCurrent(p))return;
    preview.querySelectorAll('[data-zoom]').forEach(function(b){b.disabled=!p.ready;});
    preview.querySelector('[data-previous]').disabled=!p.ready||p.page<=1;
    preview.querySelector('[data-next]').disabled=!p.ready||p.page>=p.pdf?.numPages;
    preview.querySelector('[data-page]').textContent=p.pdf?p.page+' / '+p.pdf.numPages:'';
  }
  function previewError(p,error){
    if(!previewCurrent(p)||error.name==='AbortError'||error.name==='RenderingCancelledException')return;
    previewStatus(p,'자료를 표시하지 못했습니다. 다시 보기를 누르거나 파일을 다운로드해 주세요.');
    preview.querySelector('[data-preview-retry]').hidden=false;
  }
  function fitImage(p){
    if(!previewCurrent(p)||!p.ready)return;
    var stage=preview.querySelector('[data-preview-stage]'),image=p.image;
    var fit=Math.min(1,Math.max(1,stage.clientWidth-24)/image.naturalWidth,Math.max(1,stage.clientHeight-24)/image.naturalHeight);
    image.style.width=Math.max(1,Math.round(image.naturalWidth*fit*p.zoom))+'px';
    image.style.height=Math.max(1,Math.round(image.naturalHeight*fit*p.zoom))+'px';
  }
  async function renderPdf(p){
    if(!previewCurrent(p)||!p.pdf)return;
    var renderId=++p.renderId,pageNumber=p.page;p.renderTask?.cancel();previewControls(p);
    var stage=preview.querySelector('[data-preview-stage]');stage.replaceChildren();previewStatus(p,pageNumber+'페이지를 준비하고 있습니다.');
    try{
      var page=await p.pdf.getPage(pageNumber);if(!previewCurrent(p)||renderId!==p.renderId)return;
      var base=page.getViewport({scale:1}),fit=Math.min(Math.max(1,stage.clientWidth-24)/base.width,Math.max(1,stage.clientHeight-24)/base.height);
      var viewport=page.getViewport({scale:fit*p.zoom}),ratio=Math.min(global.devicePixelRatio||1,2,Math.sqrt(8000000/(viewport.width*viewport.height)));
      var canvas=node('canvas');canvas.setAttribute('aria-label',p.item.filename+' '+pageNumber+'페이지');canvas.setAttribute('role','img');
      canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));
      canvas.style.width=Math.round(viewport.width)+'px';canvas.style.height=Math.round(viewport.height)+'px';
      p.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:viewport,transform:[ratio,0,0,ratio,0,0]});
      await p.renderTask.promise;if(!previewCurrent(p)||renderId!==p.renderId)return;
      stage.replaceChildren(canvas);stage.scrollTop=stage.scrollLeft=0;previewStatus(p,'');previewControls(p);
    }catch(error){if(renderId===p.renderId)previewError(p,error);}
  }
  function ensurePreview(){
    if(preview)return;
    preview=node('dialog',undefined,'attachment-preview-v194');preview.id='attachmentPreviewDialogV194';preview.setAttribute('aria-labelledby','attachmentPreviewTitleV194');
    var header=node('header'),heading=node('div'),title=node('h2');title.id='attachmentPreviewTitleV194';var meta=node('p');meta.setAttribute('data-preview-meta','');heading.append(title,meta);
    var close=node('button','×');close.type='button';close.setAttribute('aria-label','자료 보기 닫기');close.onclick=closePreview;header.append(heading,close);
    var tools=node('div',undefined,'attachment-preview-tools-v194');tools.setAttribute('aria-label','자료 보기 도구');
    [['out','축소'],['fit','화면 맞춤'],['in','확대']].forEach(function(pair){var b=node('button',pair[1]);b.type='button';b.setAttribute('data-zoom',pair[0]);b.onclick=function(){var p=previewActive;if(!p||!p.ready)return;p.zoom=pair[0]==='fit'?1:Math.max(.25,Math.min(4,p.zoom*(pair[0]==='in'?1.25:.8)));if(p.image)fitImage(p);else void renderPdf(p);};tools.append(b);});
    var pages=node('div',undefined,'attachment-preview-pages-v194');pages.setAttribute('data-pdf-pages','');
    var previous=node('button','이전'),counter=node('span'),next=node('button','다음');previous.type=next.type='button';previous.setAttribute('data-previous','');next.setAttribute('data-next','');counter.setAttribute('data-page','');counter.setAttribute('aria-live','polite');
    previous.onclick=function(){var p=previewActive;if(p?.ready&&p.page>1){p.page--;void renderPdf(p);}};next.onclick=function(){var p=previewActive;if(p?.ready&&p.page<p.pdf.numPages){p.page++;void renderPdf(p);}};pages.append(previous,counter,next);tools.append(pages);
    var download=node('a','다운로드');download.setAttribute('data-preview-download','');tools.append(download);
    var status=node('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    var retry=node('button','다시 보기');retry.type='button';retry.setAttribute('data-preview-retry','');retry.hidden=true;retry.onclick=function(){var p=previewActive;if(p)openPreview(p.ctx,p.item);};
    var stage=node('section');stage.setAttribute('data-preview-stage','');stage.setAttribute('aria-label','첨부자료 내용');preview.append(header,tools,status,retry,stage);document.body.append(preview);
    preview.addEventListener('close',function(){if(!preview.open)stopPreview();});
  }
  async function openPreview(ctx,item){
    if(!current(ctx))return;safeItem(item,ctx);ensurePreview();closePreview();
    var p={ctx:ctx,item:item,abort:new AbortController(),zoom:1,page:1,renderId:0,ready:false};previewActive=p;
    preview.querySelector('h2').textContent=item.filename;preview.querySelector('[data-preview-meta]').textContent='올린 날짜 '+date(item.uploadedAt)+' · '+size(item.byteSize);
    var download=preview.querySelector('[data-preview-download]');download.href=item.downloadUrl;download.download=item.filename;
    preview.querySelector('[data-pdf-pages]').hidden=item.mediaType!=='application/pdf';preview.querySelector('[data-preview-retry]').hidden=true;
    preview.showModal();previewControls(p);previewStatus(p,'자료를 불러오고 있습니다.');
    if(typeof ResizeObserver==='function'){p.observer=new ResizeObserver(function(){clearTimeout(p.resizeTimer);p.resizeTimer=setTimeout(function(){if(!previewCurrent(p)||!p.ready)return;if(p.image)fitImage(p);else void renderPdf(p);},100);});p.observer.observe(preview.querySelector('[data-preview-stage]'));}
    try{
      if(item.mediaType!=='application/pdf'){
        var image=node('img');p.image=image;image.alt=item.filename;image.draggable=false;
        image.onload=async function(){try{await image.decode();if(!previewCurrent(p))return;p.ready=true;fitImage(p);previewControls(p);previewStatus(p,'');}catch(error){previewError(p,error);}};image.onerror=function(){previewError(p,Error('Image failed'));};
        preview.querySelector('[data-preview-stage]').append(image);image.src=item.url;return;
      }
      var response=await fetch(item.url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([p.abort.signal,AbortSignal.timeout(30000)])});
      if(!response.ok||!/^application\/pdf(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('PDF response failed');
      var bytes=await response.arrayBuffer();if(!previewCurrent(p))return;if(bytes.byteLength>20*1024*1024)throw Error('PDF too large');
      if(!pdfModule)pdfModule=import(pdfRoot+'pdf.min.mjs').catch(function(error){pdfModule=null;throw error;});
      var lib=await pdfModule;if(!previewCurrent(p))return;lib.GlobalWorkerOptions.workerSrc=pdfRoot+'pdf.worker.min.mjs';
      p.loadingTask=lib.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useWasm:false,enableXfa:false,cMapUrl:pdfRoot+'cmaps/',cMapPacked:true,standardFontDataUrl:pdfRoot+'standard_fonts/'});
      p.pdf=await p.loadingTask.promise;if(!previewCurrent(p))return;p.ready=true;await renderPdf(p);
    }catch(error){previewError(p,error);}
  }
  function ensure(){
    if(dialog)return;dialog=node('dialog',undefined,'listing-attachments-v181');dialog.id='listingAttachmentsDialogV181';dialog.setAttribute('aria-labelledby','listingAttachmentsTitleV181');
    var head=node('header'),title=node('h2','첨부자료');title.id='listingAttachmentsTitleV181';var close=node('button','×');close.type='button';close.setAttribute('aria-label','첨부창 닫기');close.setAttribute('data-close','');close.onclick=function(){dialog.close();};head.append(title,close);
    var identity=node('p',undefined,'attachment-identity-v181');identity.setAttribute('data-identity','');
    var toolbar=node('div',undefined,'attachment-toolbar-v181'),add=node('button','파일 첨부'),retry=node('button','선택 파일 다시 첨부'),refresh=node('button','다시 불러오기'),input=node('input');
    add.type=retry.type=refresh.type='button';add.setAttribute('data-add','');retry.setAttribute('data-retry','');retry.hidden=true;
    input.type='file';input.multiple=true;input.hidden=true;input.accept='.jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx';
    add.onclick=function(){
      var ctx=active;if(!ctx||!current(ctx)||!ctx.ready||ctx.busy)return;
      // Each native chooser owns its original master/account, even if another
      // property is opened before the operating-system chooser returns.
      var picker=input.cloneNode();dialog.append(picker);
      picker.onchange=function(){var files=Array.from(picker.files||[]);picker.remove();if(!current(ctx))return;
        if(files.some(function(f){return !f.size||f.size>20*1024*1024||! /\.(?:jpe?g|png|webp|pdf|xlsx?)$/i.test(f.name);})){message(ctx,'사진(JPG·PNG·WebP), PDF, 엑셀을 파일당 20MB까지 첨부할 수 있습니다.');return;}
        ctx.queue=files.map(function(file){return {file:file,id:crypto.randomUUID()};});upload(ctx);
      };
      picker.addEventListener('cancel',function(){picker.remove();},{once:true});picker.click();
    };
    retry.onclick=function(){if(active)upload(active);};refresh.onclick=function(){if(active&&!active.busy)load(active);};
    toolbar.append(add,retry,refresh);var help=node('p','사진·PDF·엑셀 · 파일당 20MB까지','attachment-help-v181'),status=node('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    var files=node('section');files.setAttribute('data-files','');files.setAttribute('aria-label','첨부된 파일');dialog.append(head,identity,toolbar,help,status,files);document.body.append(dialog);
    dialog.addEventListener('close',function(){closePreview();active=null;sequence++;});
    function changed(){if(active&&active.account!==account()){closePreview();dialog.close();dialog.querySelector('[data-files]').replaceChildren();}}
    global.addEventListener('js-auth-required',changed);global.addEventListener('js-auth-restored',changed);global.addEventListener('pagehide',function(){if(dialog.open)dialog.close();});document.addEventListener('visibilitychange',changed);
  }
  function open(options){
    if(options.account!==account())return;ensure();closePreview();
    var label=options.sourceButton.getAttribute('data-attachment-label-v181')||'';
    active={propertyId:options.propertyId,account:options.account,items:[],queue:[],ready:false,busy:false,sequence:++sequence};
    dialog.querySelector('[data-identity]').textContent=label||'선택한 매물의 첨부자료';dialog.querySelector('[data-files]').replaceChildren();dialog.querySelector('[data-add]').disabled=true;dialog.querySelector('[data-retry]').hidden=true;
    if(!dialog.open)dialog.showModal();load(active);
  }
  global.JSListingAttachmentsV181={open:open};
})(window);
