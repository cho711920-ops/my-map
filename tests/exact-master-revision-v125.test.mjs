import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../cloudflare/src/worker.js';
import {speedDatabase} from './fixtures/collector-speed-v64.mjs';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';

test('an actual committed visit emits one exact-master delta, while completed-source restoration still requires a full reload',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());
 f.db.prepare("INSERT INTO listings(id,property_id,title,address,status,operating_memo) VALUES('A','A','검수 A','검수동 1','active','A 이전'),('B','B','검수 B','검수동 1','active','B 보존')").run();
 const objects=new Map();let sequence=0;
 const env={...f.env,SESSION_SECRET:'synthetic-v125-session-secret-only-for-tests',ALLOWED_EMAILS:'fixture@example.invalid',D1_PRIMARY_READS:'1',D1_PRIMARY_WRITES:'1',MEDIA:{
  async get(key){const o=objects.get(key);return o?{...o,text:async()=>o.value,body:new Response(o.value).body}:null;},
  async put(key,value,options={}){const current=objects.get(key);if(options.onlyIf?.etagMatches&&current?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&current)return null;const o={...options,value,etag:String(++sequence)};objects.set(key,o);return o;},
  async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}
 }};
 const token=await createSessionToken({email:env.ALLOWED_EMAILS,sub:'fixture'},env);let pending=[];const context={waitUntil(p){pending.push(p);}};
 const post=async memo=>{const response=await worker.fetch(new Request('https://fixture.invalid/api/data',{method:'POST',headers:{cookie:SESSION_COOKIE+'='+token,'content-type':'application/json',origin:'https://fixture.invalid'},body:JSON.stringify({action:'toggleDone',key:{propertyId:'A'},state:'active',memo})}),env,context);assert.equal(response.status,200);assert.equal((await response.json()).persisted,true);while(pending.length){const batch=pending;pending=[];await Promise.all(batch);}};
 await post('확인 · A 임장완료');
 const revision=JSON.parse(objects.get('api-cache/revision/listings.json').value);
 assert.equal(revision.fullReload,false);assert.deepEqual(revision.changeIds,['A']);
 assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE id='B'").get().operating_memo,'B 보존');
 f.db.prepare("UPDATE listings SET status='계약완료' WHERE id='A'").run();
 await post('복구 확인');
 assert.equal(JSON.parse(objects.get('api-cache/revision/listings.json').value).fullReload,true);
});


test('v211 selected merge publishes exact source-link changes before ACK and never changes an unselected same-address master',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());
 for(const id of ['A','B','C','OTHER']){
  f.db.prepare("INSERT INTO listings(id,property_id,title,address,status,trade_type,sale_category,operating_memo) VALUES(?,?,?,'서구 가장동 56-29','active','sale','building',?)").run(id,id,id,'메모 '+id);
  f.db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,list_snapshot_json) VALUES(?,?,'네이버',?,?)").run('AD-'+id,id,id,JSON.stringify({propertyId:id,tradeType:'sale',salePrice:114000}));
 }
 const objects=new Map();let sequence=0,releaseRevision,revisionBlocked=true;
 const gate=new Promise(resolve=>{releaseRevision=resolve;});
 const env={...f.env,SESSION_SECRET:'synthetic-v211-session-secret-only-for-tests',ALLOWED_EMAILS:'fixture@example.invalid',D1_PRIMARY_READS:'1',D1_PRIMARY_WRITES:'1',MEDIA:{
  async get(key){const o=objects.get(key);return o?{...o,text:async()=>o.value,body:new Response(o.value).body}:null;},
  async put(key,value,options={}){if(key==='api-cache/revision/listings.json'&&revisionBlocked)await gate;const current=objects.get(key);if(options.onlyIf?.etagMatches&&current?.etag!==options.onlyIf.etagMatches||options.onlyIf?.etagDoesNotMatch==='*'&&current)return null;const o={...options,value,etag:String(++sequence)};objects.set(key,o);return o;},
  async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}
 }};
 const token=await createSessionToken({email:env.ALLOWED_EMAILS,sub:'fixture',role:'owner'},env),pending=[],context={waitUntil(p){pending.push(p);}};
 let acknowledged=false;
 const saving=worker.fetch(new Request('https://fixture.invalid/api/data',{method:'POST',headers:{cookie:SESSION_COOKIE+'='+token,'content-type':'application/json',origin:'https://fixture.invalid'},body:JSON.stringify({action:'consolidateExistingMasters',selectedMerge:true,expectedAccountEmail:env.ALLOWED_EMAILS,requestId:'selected-merge-v211-fixture',primaryMasterId:'C',duplicateMasterIds:['A','B']})}),env,context).then(r=>{acknowledged=true;return r;});
 try{
  for(let n=0;n<100&&!f.db.prepare("SELECT 1 FROM mutation_results").get();n++)await new Promise(r=>setTimeout(r,2));
  assert.equal(f.db.prepare("SELECT count(*) n FROM listing_sources WHERE listing_id='C'").get().n,3);assert.equal(acknowledged,false,'Do not ACK while the revision publication is pending');
 }finally{revisionBlocked=false;releaseRevision();}
 const result=await saving;assert.equal(result.status,200,await result.clone().text());const receipt=await result.json();assert.equal(receipt.persisted,true);assert.equal(receipt.pointResultV211.items.length,1);assert.deepEqual(receipt.pointResultV211.missingIds.slice().sort(),['A','B']);assert.equal(receipt.pointResultV211.requestedIds.length,3);assert.equal(receipt.pointResultV211.unified.groups.C.length,3);
 const revision=JSON.parse(objects.get('api-cache/revision/listings.json').value);assert.equal(revision.fullReload,false);assert.deepEqual(revision.changeIds.slice().sort(),['A','B','C']);
 assert.equal(f.db.prepare("SELECT status FROM listings WHERE id='OTHER'").get().status,'active');assert.equal(f.db.prepare("SELECT count(*) n FROM listing_sources WHERE listing_id='OTHER'").get().n,1);
 await Promise.all(pending);
});
