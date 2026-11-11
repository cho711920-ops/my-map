import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extract} from './fixtures/daangn-report-fixture.mjs';
const source=await readFile('js/gongsil-collector.js','utf8');
function setup(fetch){let fire,cleared=0,fetches=0;const state={detailCache:{},detailAuth:{mid:'fixture-user',guest:false}};
 const context={AbortController,Promise,state,window:{setTimeout(run,ms){assert.equal(ms,12000);fire=run;return 1;},clearTimeout(){cleared++;}},originalFetch:(...args)=>{fetches++;return fetch(...args);},
 detailKey:i=>String(i.Bidx),pick:(i,names)=>names.map(k=>i[k]).find(x=>x!=null),isMissingIdentifier:v=>v==null,text:v=>String(v??''),delay:async()=>{}};
 const api=extract(source,['fetchDetailResponseV177','fetchDetailData'],context,'  ');
 return {api,state,fire:()=>fire(),cleared:()=>cleared,fetches:()=>fetches};}
const item={Bidx:1,Bfidx:2,Admidx:3};
test('a hung transport settles once, aborts, does not cache a late response, and lets the next listing proceed',async()=>{
 let resolve,signal;const f=setup((_url,init)=>{signal=init.signal;return new Promise(r=>{resolve=r;});});
 const pending=f.api.fetchDetailData(item);f.fire();await assert.rejects(pending,error=>error.code==='GONGSIL_DETAIL_TIMEOUT');
 assert.equal(signal.aborted,true);assert.equal(f.fetches(),1);assert.equal(f.cleared(),1);
 resolve({ok:true,json:async()=>({res:'success',data:{late:true}})});await new Promise(setImmediate);assert.deepEqual(f.state.detailCache,{});
 const next=setup(async()=>({ok:true,json:async()=>({res:'success',data:{valid:true}})}));
 assert.equal((await next.api.fetchDetailData(item)).valid,true);assert.equal(next.fetches(),1);assert.equal(next.cleared(),1);
});
test('a hanging body is bounded too, while transient failures retain existing retries',async()=>{
 const f=setup(async()=>({ok:true,json:()=>new Promise(()=>{})}));const pending=f.api.fetchDetailData(item);await Promise.resolve();f.fire();await assert.rejects(pending,error=>error.code==='GONGSIL_DETAIL_TIMEOUT');
 let n=0;const retry=setup(async()=>++n<3?{ok:false,status:503}:{ok:true,json:async()=>({res:'success',data:{valid:true}})});
 assert.equal((await retry.api.fetchDetailData(item)).valid,true);assert.equal(retry.fetches(),3);assert.equal(retry.cleared(),3);
 assert.match(source,/if \(warnings\.length\) \{\s*record\.preserveContacts = true;\s*record\.contactCaptureStatus = "deferred"/);
});
