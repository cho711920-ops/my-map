(function(global){
  'use strict';
  if(global.JSListingAttachmentsV181)return;
  var dialog,active=null,sequence=0;
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
        if(/^(?:image\/|application\/pdf)/.test(item.mediaType)){var view=node('a','보기');view.href=item.url;view.target='_blank';view.rel='noopener noreferrer';actions.append(view);}
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
    dialog.addEventListener('close',function(){active=null;sequence++;});
    function changed(){if(active&&active.account!==account()){dialog.close();dialog.querySelector('[data-files]').replaceChildren();}}
    global.addEventListener('js-auth-required',changed);global.addEventListener('js-auth-restored',changed);global.addEventListener('pagehide',function(){if(dialog.open)dialog.close();});document.addEventListener('visibilitychange',changed);
  }
  function open(options){
    if(options.account!==account())return;ensure();
    var label=options.sourceButton.getAttribute('data-attachment-label-v181')||'';
    active={propertyId:options.propertyId,account:options.account,items:[],queue:[],ready:false,busy:false,sequence:++sequence};
    dialog.querySelector('[data-identity]').textContent=label||'선택한 매물의 첨부자료';dialog.querySelector('[data-files]').replaceChildren();dialog.querySelector('[data-add]').disabled=true;dialog.querySelector('[data-retry]').hidden=true;
    if(!dialog.open)dialog.showModal();load(active);
  }
  global.JSListingAttachmentsV181={open:open};
})(window);
