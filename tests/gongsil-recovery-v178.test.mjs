import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const source=await readFile('js/gongsil-save-recovery-v178.js','utf8');
function fixture(){const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},context=vm.createContext({});vm.runInContext(source,context);const pending={requestId:'gongsil-old-batch-1',sessionId:'old',batchIndex:1,size:8,hash:'a'.repeat(64)};storage.setItem('js_gongsil_pending_request_v63',JSON.stringify(pending));return{api:context.JSGongsilSaveRecoveryV178,storage,pending};}
const terminal=f=>({ok:true,ready:true,requestId:f.pending.requestId,mutationAction:'gongsilImportBatch',result:{ok:true,requestHashV63:f.pending.hash}});
test('only the exact terminal receipt releases an older local pointer and preserves the current checkpoint',async()=>{
 const f=fixture();f.storage.setItem('js_gongsil_save_progress_v1',JSON.stringify({sessionId:'new',offset:8}));
 await f.api.reconcile({storage:f.storage,sessionId:'new',readStatus:async()=>terminal(f),isCurrent:()=>true});
 assert.equal(f.storage.getItem('js_gongsil_pending_request_v63'),null);assert.equal(JSON.parse(f.storage.getItem('js_gongsil_save_progress_v1')).offset,8);
});
test('missing, running, wrong hash/action/ID and changed state never discard pending records or release a pointer',async()=>{
 for(const change of [{ready:false,requestState:'missing'},{ready:false,requestState:'running'},{mutationAction:'saveNaverBatch'},{requestId:'wrong'},{result:{ok:true,requestHashV63:'b'.repeat(64)}}]){
 const f=fixture();await assert.rejects(f.api.reconcile({storage:f.storage,sessionId:'new',readStatus:async()=>({...terminal(f),...change}),isCurrent:()=>true}));assert.ok(f.storage.getItem('js_gongsil_pending_request_v63'));}
 const f=fixture();await assert.rejects(f.api.reconcile({storage:f.storage,sessionId:'new',readStatus:async()=>terminal(f),isCurrent:()=>false}));assert.ok(f.storage.getItem('js_gongsil_pending_request_v63'));
});
test('missing receipt requires a server-confirmed atomic fence and never authorizes a resend of that older payload',async()=>{
 const f=fixture();let fences=0;
 await f.api.reconcile({storage:f.storage,sessionId:'new',readStatus:async()=>({ok:true,ready:false,requestId:f.pending.requestId,requestState:'missing'}),recoverMissing:async()=>{fences++;return terminal(f);},isCurrent:()=>true});
 assert.equal(fences,1);assert.equal(f.storage.getItem('js_gongsil_pending_request_v63'),null);
});


test('recovery POST keeps the existing key out of the URL and bounds a stalled body without releasing storage',async()=>{
 let fire,request;const values=new Map([['js_gongsil_collector_access_key_v3','fixture-private-key']]);
 const context=vm.createContext({AbortController,setTimeout:run=>{fire=run;return 1;},clearTimeout(){},localStorage:{getItem:k=>values.get(k)},fetch:async(url,options)=>{request={url,options};return {ok:true,json:()=>new Promise(()=>{})};}});
 vm.runInContext(source,context);const task=context.JSGongsilSaveRecoveryV178.recoverMissing({requestId:'gongsil-old-batch-1',sessionId:'old',hash:'a'.repeat(64)},'new');
 await Promise.resolve();fire();await assert.rejects(task,/응답 지연/);assert.equal(request.url,'https://js-map.com/api/collector');
 assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'error');assert.equal(request.options.referrerPolicy,'no-referrer');
 assert.equal(JSON.parse(request.options.body).collectorKey,'fixture-private-key');assert.equal(request.options.signal.aborted,true);
});
