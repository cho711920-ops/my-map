import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('js/script.js','utf8');
function fixture(settings={}){
  const items=[{propertyId:'A',state:'',memo:'내 메모',rent:80},{propertyId:'B',state:'',memo:'이웃 메모',rent:150}],sent=[],alerts=[];
  const context={items,selectedPrintKeys:['A','B'],doneTogglePendingKeys:{},window:{JSInitialListingsCacheV1:{commitItem:async()=>{if(settings.cacheFail)throw Error('Cache unavailable');}}},
    getSelectedPrintItems:()=>items,isDone:item=>item.state==='계약완료',actionSelectionKeyV660:item=>item.propertyId,refreshDoneStatusUI(){},console:{warn(){}},alert:message=>alerts.push(message),
    postSafeMutationV654:async(action,payload)=>{sent.push({action,payload});if(payload.key.propertyId===settings.fail)throw Error('Conflict');return {persisted:true,queued:false,propertyId:payload.key.propertyId,updated:{state:payload.updated.state}};}};
  context.verificationSaveQueueV210=Promise.resolve();vm.createContext(context);
  for(const name of ['isFieldVisitItem','isConfirmedVisitItem','isHeldListingV160','queueVerificationSaveV210','markSelectedVerificationV160']){
    const fn=source.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'))?.[0];assert.ok(fn,name);vm.runInContext(fn,context);
  }
  return {context,items,sent,alerts};
}
test('hold uses an exact-ID state-only CAS patch and preserves all memo and price values even when the local cache fails',async()=>{
  const f=fixture({cacheFail:true});assert.equal(await f.context.markSelectedVerificationV160('보류'),true);
  assert.deepEqual(f.items.map(item=>[item.state,item.memo,item.rent]),[['보류','내 메모',80],['보류','이웃 메모',150]]);
  assert.deepEqual(f.sent.map(({payload})=>Object.keys(payload.updated)),[['state'],['state']]);assert.deepEqual(f.sent.map(({payload})=>payload.originalValues[12]),['','']);
  assert.equal(f.context.selectedPrintKeys.length,0);assert.equal(f.alerts.length,0);
});
test('partial bulk failure retains the failed selection and never rolls back a different persisted master',async()=>{
  const f=fixture({fail:'B'});assert.equal(await f.context.markSelectedVerificationV160('보류'),false);
  assert.equal(f.items[0].state,'보류');assert.equal(f.items[1].state,'');assert.deepEqual([...f.context.selectedPrintKeys],['B']);assert.equal(f.alerts.length,1);
});
test('a late state receipt cannot update the cache or selected list of a different account',async()=>{
  const f=fixture();let release,caches=0;const gate=new Promise(resolve=>release=resolve);
  f.context.window.JSAuthenticatedAccountEmail='old@example.invalid';
  f.context.window.JSInitialListingsCacheV1.commitItem=async()=>{caches++;};
  f.context.postSafeMutationV654=async(action,payload)=>{await gate;return {persisted:true,queued:false,propertyId:payload.key.propertyId,updated:payload.updated};};
  const pending=f.context.markSelectedVerificationV160('보류');f.context.window.JSAuthenticatedAccountEmail='new@example.invalid';release();await pending;
  assert.equal(caches,0);assert.deepEqual([...f.context.selectedPrintKeys],['A','B']);
});
test('explicit hold and unconfirmed override old confirmation/source markers and confirmation overrides old pending markers',()=>{
  const f=fixture();for(const state of ['보류','미확인'])assert.equal(f.context.isConfirmedVisitItem({state,memo:'(확인매물)',queryRowV152:true,queryConfirmedVisitV152:true}),false);
  assert.equal(f.context.isFieldVisitItem({state:'확인',memo:'(임장가자)',queryRowV152:true,queryPendingVisitV152:true}),false);
  assert.equal(f.context.isFieldVisitItem({state:'미확인',memo:'(확인매물)'}),true);
  assert.equal(f.context.isConfirmedVisitItem({state:'확인',memo:'(임장가자)'}),true);
});


test('v210 twelve hold saves serialize revision writes while every card changes immediately and refresh waits for the batch',async()=>{
 const f=fixture();f.items.splice(0,2,...Array.from({length:12},(_,i)=>({propertyId:'P'+i,state:'',memo:'keep'+i,rent:80})));
 f.context.selectedPrintKeys=f.items.map(i=>i.propertyId);let pending=0,max=0,entered=0,ended=0;
 f.context.window.JSQueryListingsV152={beginVerificationBatchV210(){entered++;return()=>ended++;}};
 f.context.postSafeMutationV654=async(action,payload)=>{pending++;max=Math.max(max,pending);await new Promise(r=>setTimeout(r,2));pending--;return{persisted:true,propertyId:payload.key.propertyId,updated:payload.updated};};
 const saving=f.context.markSelectedVerificationV160('보류');assert.ok(f.items.every(i=>i.state==='보류'));await saving;
 assert.equal(max,1);assert.equal(entered,1);assert.equal(ended,1);assert.ok(f.items.every((i,n)=>i.memo==='keep'+n));
});
