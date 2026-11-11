/* Reconcile a different collection's receipt without replacing its live data. */
(function(global){
  'use strict';
  if(global.JSGongsilSaveRecoveryV178)return;
  var KEY='js_gongsil_pending_request_v63',PROGRESS='js_gongsil_save_progress_v1';
  function error(message){return new Error(message+' · 현재 수집한 매물은 그대로 보존합니다.');}
  async function reconcile(options){
    var storage=options.storage,raw=storage.getItem(KEY),pending;
    try{pending=JSON.parse(raw||'null');}catch{throw error('이전 저장 표식 형식을 확인하지 못했습니다');}
    if(!pending||pending.sessionId===options.sessionId)return {changed:false};
    if(typeof pending.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(pending.sessionId)||
      !Number.isInteger(pending.batchIndex)||pending.batchIndex<1||!Number.isInteger(pending.size)||pending.size<1||pending.size>8||
      pending.requestId!=='gongsil-'+pending.sessionId+'-batch-'+pending.batchIndex||!/^[a-f0-9]{64}$/.test(pending.hash||''))throw error('이전 저장 요청의 연결값을 확인하지 못했습니다');
    var status=await options.readStatus(pending.requestId);
    if(status?.ok===true&&status.ready===false&&status.requestId===pending.requestId&&status.requestState==='missing'&&options.recoverMissing)
      status=await options.recoverMissing(pending,options.sessionId);
    var result=status?.result;
    var terminal=status?.ok===true&&status.ready===true&&status.requestId===pending.requestId&&status.mutationAction==='gongsilImportBatch'&&result&&
      (result.requestHashV63===pending.hash||result.code==='gongsil_closed_session_rescan'&&result.requiresFreshManifest===true);
    if(!terminal)throw error('이전 저장 결과 미확인 ('+pending.requestId+')');
    if(options.isCurrent?.()!==true||storage.getItem(KEY)!==raw)throw error('저장 확인 도중 수집 상태가 변경되었습니다');
    // This is acknowledgement of a terminal receipt, never a retry/delete of
    // its server write. Keep the current records and current-session cursor.
    storage.removeItem(KEY);
    try{var progress=JSON.parse(storage.getItem(PROGRESS)||'null');if(progress?.sessionId===pending.sessionId)storage.removeItem(PROGRESS);}catch{}
    return {changed:true,requestId:pending.requestId};
  }
  async function request(body, suppliedKey){
    var key=String(suppliedKey||global.localStorage.getItem('js_gongsil_collector_access_key_v3')||'').trim();
    if(!key)throw error('공실박스 수집 보안키를 확인해 주세요');
    var controller=typeof global.AbortController==='function'?new global.AbortController():null,timer;
    var deadline=new Promise(function(_,reject){timer=global.setTimeout(function(){reject(error('이전 저장 결과 응답 지연'));controller?.abort();},8000);});
    var original=global.fetch.__jsGongsilOriginal||global.fetch;
    try{return await Promise.race([deadline,(async function(){var response=await original.call(global,'https://js-map.com/api/collector',{
      method:'POST',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',
      headers:{'content-type':'text/plain;charset=utf-8'},signal:controller?.signal,
      body:JSON.stringify(Object.assign({},body,{collectorKey:key}))});
      if(!response.ok)throw error('이전 저장 결과 조회 HTTP '+response.status);return response.json();})()]);}
    finally{global.clearTimeout(timer);}
  }
  function readStatus(id){return request({action:'mutationStatus',targetAction:'gongsilImportBatch',requestId:id});}
  function recoverMissing(pending,session,key){return request({action:'recoverGongsilPendingV178',oldRequestId:pending.requestId,oldSessionId:pending.sessionId,newSessionId:session,requestHashV63:pending.hash},key);}
  function attach(collector){
    if(collector!==global.__JS_GONGSIL_COLLECTOR__||collector.isBusy?.())return false;
    var pending=collector.getPendingSave?.(),panel=global.document.getElementById('js-gongsil-collector-panel'),button=panel?.querySelector('[data-action="save"]');
    if(!pending?.metadata?.sessionId||!Array.isArray(pending.records)||!button)return false;
    if(button.dataset.receiptRecoveryV178==='ready')return true;
    button.dataset.receiptRecoveryV178='ready';var running=false,pass=false;
    function current(){return collector===global.__JS_GONGSIL_COLLECTOR__&&!collector.isBusy?.()&&collector.getPendingSave?.()===pending;}
    function status(title,message){var head=panel.querySelector('[data-role="status"]'),detail=panel.querySelector('[data-role="detail"]');if(head)head.textContent=title;if(detail)detail.textContent=message;}
    button.addEventListener('click',async function(event){
      if(pass||!current())return;
      var descriptor;try{descriptor=JSON.parse(global.localStorage.getItem(KEY)||'null');}catch{}
      if(!descriptor||descriptor.sessionId===pending.metadata.sessionId)return;
      event.preventDefault();event.stopImmediatePropagation();if(running)return;running=true;button.disabled=true;
      status('이전 저장 결과 확인 중','현재 창의 매물을 유지한 채 서버의 확정 결과만 확인합니다.');
      try{await reconcile({storage:global.localStorage,sessionId:pending.metadata.sessionId,readStatus:readStatus,recoverMissing:recoverMissing,isCurrent:current});
        if(!current())throw error('수집 상태가 변경되었습니다');
        button.disabled=false;pass=true;try{button.click();}finally{pass=false;}
      }catch(e){if(current())status('저장 연결 확인 필요',e.message);}
      finally{running=false;if(!collector.isBusy?.())button.disabled=false;}
    },true);
    status('저장 연결 복구 준비 완료','아래 저장 이어가기 버튼을 누르면 이전 결과를 확인하고 현재 매물부터 계속합니다. 새로고침하지 마세요.');
    return true;
  }
  global.JSGongsilSaveRecoveryV178={reconcile:reconcile,attach:attach,recoverMissing:recoverMissing};
})(typeof window==='object'?window:globalThis);
