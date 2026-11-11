import{test,expect}from'@playwright/test';import{readFile}from'node:fs/promises';
const root='https://www.gongsilbox.com/__recovery_v178';const loader=await readFile('js/collector-loader.js','utf8'),helper=await readFile('js/gongsil-save-recovery-v178.js','utf8'),collectorSource=await readFile('js/gongsil-collector.js','utf8');
for(const direct of [false,true])for(const mode of ['completed','missing','running'])test('idle legacy pending save '+mode+(direct?' direct bookmark':' shared loader')+' is reconciled without replacing its 816 records or provider scope',async({page,context})=>{
 const requests=[],scripts=[];await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.href===root)return route.fulfill({contentType:'text/html',body:'<section id="js-gongsil-collector-panel"><p data-role="status">저장 연결이 아직 복구되지 않았습니다.</p><p data-role="detail"></p><button data-action="save">저장 중단 지점부터 다시 시도</button></section>'});
  if(url.pathname==='/js/gongsil-save-recovery-v178.js'){scripts.push(url.pathname);return route.fulfill({contentType:'text/javascript',body:helper});}
  if(url.origin==='https://js-map.com'&&url.pathname==='/api/collector'){
   const b=route.request().postDataJSON();requests.push(b);const result={ok:true,ready:true,requestId:'gongsil-old-batch-1',mutationAction:'gongsilImportBatch',result:{ok:true,requestHashV63:'a'.repeat(64)}};
   if(b.action==='mutationStatus'&&mode!=='completed')Object.assign(result,{ready:false,requestState:mode});
   return route.fulfill({headers:{'access-control-allow-origin':'*'},json:result});
  }
  throw Error('Unexpected dependency/provider request '+url.pathname);
 });await page.goto(root);
 await page.evaluate(()=>{window.pending={metadata:{sessionId:'new'},records:Array.from({length:816},(_,i)=>({externalId:'kept-'+i,values:['private in-memory fixture']}))};window.originalRecords=pending.records;window.originalScope={original:'frozen'};window.oldCollector={version:'2.3.5',isBusy:()=>false,getPendingSave:()=>pending,getCapture:()=>originalScope,reopen(){}};window.__JS_GONGSIL_COLLECTOR__=oldCollector;
  localStorage.setItem('js_gongsil_collector_access_key_v3','fixture-key');localStorage.setItem('js_gongsil_pending_request_v63',JSON.stringify({sessionId:'old',requestId:'gongsil-old-batch-1',batchIndex:1,size:8,hash:'a'.repeat(64)}));
  document.querySelector('[data-action="save"]').addEventListener('click',()=>{window.saveCalls=(window.saveCalls||0)+1;window.descriptorAtSave=localStorage.getItem('js_gongsil_pending_request_v63');});
 });await page.addScriptTag({content:direct?collectorSource:loader});const button=page.locator('[data-action="save"]');await expect(button).toHaveAttribute('data-receipt-recovery-v178','ready');await button.click();
 if(mode==='running'){await expect(page.locator('[data-role="status"]')).toHaveText('저장 연결 확인 필요');expect(await page.evaluate(()=>window.saveCalls||0)).toBe(0);expect(await page.evaluate(()=>!!localStorage.getItem('js_gongsil_pending_request_v63'))).toBe(true);}
 else{await expect.poll(()=>page.evaluate(()=>window.saveCalls)).toBe(1);expect(await page.evaluate(()=>window.descriptorAtSave)).toBe(null);}
 expect(await page.evaluate(()=>__JS_GONGSIL_COLLECTOR__===oldCollector&&oldCollector.getCapture()===originalScope&&oldCollector.getPendingSave().records===originalRecords&&originalRecords.length===816)).toBe(true);
 expect(scripts).toEqual(['/js/gongsil-save-recovery-v178.js']);expect(requests.map(b=>b.action)).toEqual(mode==='missing'?['mutationStatus','recoverGongsilPendingV178']:['mutationStatus']);
 expect(requests.some(b=>b.records||b.data)).toBe(false);
});
