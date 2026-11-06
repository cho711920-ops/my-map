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
