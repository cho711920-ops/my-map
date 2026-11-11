import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleListingAttachmentsV181,attachmentFileTypeV181,MAX_ATTACHMENT_BYTES_V181,ATTACHMENT_SCOPE_V181} from '../cloudflare/src/listing-attachments-v181.js';
import worker from '../cloudflare/src/worker.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';
import {handleD1GetAction} from '../cloudflare/src/d1-api.js';

const owner={email:'owner@example.invalid'},other={email:'other@example.invalid'},scope=ATTACHMENT_SCOPE_V181;
const pdf=new TextEncoder().encode('%PDF-1.4\nsynthetic attachment\n%%EOF');
function setup(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec("CREATE TABLE cloud_state(owner_email TEXT,scope TEXT,record_key TEXT,value_json TEXT,version INTEGER,updated_at TEXT,PRIMARY KEY(owner_email,scope,record_key));CREATE TABLE listings(id TEXT,property_id TEXT,status TEXT);INSERT INTO listings VALUES('ROW-A','PROPERTY-A','active'),('ROW-B','PROPERTY-B','active');");
 const prepare=(sql,values=[])=>{const indices=[],compiled=sql.replace(/\?(\d+)/g,(_,n)=>{indices.push(Number(n)-1);return '?';}),args=()=>indices.length?indices.map(i=>values[i]):values;
 return {bind:(...args)=>prepare(sql,args),first:async()=>db.prepare(compiled).get(...args())||null,all:async()=>({results:db.prepare(compiled).all(...args())}),run:async()=>({meta:{changes:Number(db.prepare(compiled).run(...args()).changes)}})};};
 const objects=new Map(),env={DB:{prepare},MEDIA:{async put(key,bytes){objects.set(key,new Uint8Array(bytes));},async get(key){return objects.has(key)?{body:objects.get(key)}:null;},async delete(key){objects.delete(key);}}};
 function upload({propertyId='PROPERTY-A',id=crypto.randomUUID(),name='임대현황.pdf',bytes=pdf,who=owner}={}){return {id,call:()=>handleListingAttachmentsV181(new Request('https://js-map.com/api/listing-attachments?propertyId='+propertyId,{method:'POST',headers:{'content-type':'application/octet-stream','x-attachment-filename':encodeURIComponent(name),'x-attachment-request':id},body:bytes}),env,who)};}
 const get=(query='propertyId=PROPERTY-A',who=owner)=>handleListingAttachmentsV181(new Request('https://js-map.com/api/listing-attachments?'+query),env,who);
 const change=(item,action,extra={})=>handleListingAttachmentsV181(new Request('https://js-map.com/api/listing-attachments',{method:'POST'}),env,owner,{propertyId:'PROPERTY-A',action,id:item.id,expectedVersion:item.version,requestId:crypto.randomUUID(),...extra});
 return {db,env,objects,upload,get,change};
}
test('attachment stores exact bytes privately on the stable master and returns the server upload date',async t=>{
 const s=setup(t),before=s.db.prepare('SELECT * FROM listings').all(),saved=await(await s.upload().call()).json();
 assert.equal(saved.persisted,true);assert.equal(saved.item.filename,'임대현황.pdf');assert(!Number.isNaN(Date.parse(saved.item.uploadedAt)));
 const list=await(await s.get()).json();assert.equal(list.items.length,1);assert.equal(list.items[0].id,saved.item.id);
 assert(!JSON.stringify(list).includes(owner.email));assert(!JSON.stringify(list).includes('objectKey'));
 const response=await s.get(new URL(saved.item.url,'https://js-map.com').search.slice(1));assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('content-disposition'),/^inline;/);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),pdf);assert.deepEqual(s.db.prepare('SELECT * FROM listings').all(),before);
 const counts=await(await s.get('ids=PROPERTY-A,PROPERTY-B')).json();assert.deepEqual(counts.counts,{'PROPERTY-A':1,'PROPERTY-B':0});
 assert.deepEqual((await(await s.get('propertyId=PROPERTY-A',other)).json()).items,[]);
 await assert.rejects(s.get(new URL(saved.item.url,'https://js-map.com').search.slice(1),other),e=>e.statusCode===403);
 await assert.rejects(s.get(new URL(saved.item.url.replace('PROPERTY-A','PROPERTY-B'),'https://js-map.com').search.slice(1)),e=>e.statusCode===404);
 await assert.rejects(s.change(saved.item,'trash',{propertyId:'PROPERTY-B'}),e=>e.statusCode===404);
});
test('concurrent retries are idempotent and changed file or target cannot reuse an upload ID',async t=>{
 const s=setup(t),upload=s.upload(),results=await Promise.all([upload.call(),upload.call()]);
 const saved=await results[0].json();assert.equal((await results[1].json()).item.id,saved.item.id);assert.equal(s.objects.size,1);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM cloud_state').get().n,1);
 await assert.rejects(s.upload({id:upload.id,name:'다른파일.pdf'}).call(),e=>e.statusCode===409);
 await assert.rejects(s.upload({id:upload.id,propertyId:'PROPERTY-B'}).call(),e=>e.statusCode===409);
 assert.equal(s.objects.size,1);
});
test('trash and restore retain the original bytes/date and reject stale updates or resurrection by upload replay',async t=>{
 const s=setup(t),upload=s.upload(),saved=(await(await upload.call()).json()).item;
 const removed=(await(await s.change(saved,'trash')).json()).item;assert(removed.deletedAt);assert.equal(s.objects.size,1);
 assert.deepEqual((await(await s.get('ids=PROPERTY-A')).json()).counts,{'PROPERTY-A':0});
 await assert.rejects(s.get(new URL(saved.url,'https://js-map.com').search.slice(1)),e=>e.statusCode===404);
 await assert.rejects(upload.call(),e=>e.statusCode===409);
 await assert.rejects(s.change(saved,'restore'),e=>e.statusCode===409);
 const restored=(await(await s.change(removed,'restore')).json()).item;assert.equal(restored.deletedAt,'');assert.equal(restored.uploadedAt,saved.uploadedAt);assert.equal(restored.id,saved.id);
});
test('malformed, oversize, executable and nonexistent-master uploads never publish metadata',async t=>{
 const s=setup(t);
 for(const options of [{propertyId:'../other'},{propertyId:'missing'},{name:'x.svg',bytes:new TextEncoder().encode('<svg/>')},{name:'x.pdf',bytes:new TextEncoder().encode('<script>x</script>')},{bytes:new Uint8Array()},{id:'bad'}])await assert.rejects(s.upload(options).call());
 const request=new Request('https://js-map.com/api/listing-attachments?propertyId=PROPERTY-A',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':String(MAX_ATTACHMENT_BYTES_V181+1),'x-attachment-filename':'x.pdf','x-attachment-request':crypto.randomUUID()},body:pdf});
 await assert.rejects(handleListingAttachmentsV181(request,s.env,owner),e=>e.statusCode===413);
 assert.equal(s.objects.size,0);assert.equal(s.db.prepare('SELECT count(*) n FROM cloud_state').get().n,0);
});
test('quota races and storage failures leave saved files intact and roll back only their own objects',async t=>{
 const s=setup(t),saved=(await(await s.upload().call()).json()).item;
 const row=s.db.prepare('SELECT value_json FROM cloud_state').get(),large={...JSON.parse(row.value_json),byteSize:262144000};s.db.prepare('UPDATE cloud_state SET value_json=?').run(JSON.stringify(large));
 await assert.rejects(s.upload().call(),e=>e.statusCode===409);assert.equal(s.objects.size,1);
 const put=s.env.MEDIA.put;s.env.MEDIA.put=async()=>{throw Error('R2 unavailable');};await assert.rejects(s.upload().call());s.env.MEDIA.put=put;
 assert.equal((await(await s.get()).json()).items[0].id,saved.id);
});
test('invalid or renamed active files are never executed as HTML and legacy spreadsheet is download-only',()=>{
 assert.throws(()=>attachmentFileTypeV181('x.html',pdf));assert.throws(()=>attachmentFileTypeV181('x.xlsx',new Uint8Array([80,75,3,4])));
 assert.equal(attachmentFileTypeV181('x.xls',new Uint8Array([208,207,17,224,161,177,26,225])),'application/vnd.ms-excel');
});
test('worker gates metadata and binary uploads on session, origin and exact account',async()=>{
 const env={GOOGLE_CLIENT_ID:'fixture-client',ALLOWED_EMAILS:owner.email,SESSION_SECRET:'local-test-secret-which-is-longer-than-32-characters',ASSETS:{fetch:async()=>new Response('asset')}};
 const token=await createSessionToken({sub:'test-owner',email:owner.email},env),cookie=SESSION_COOKIE+'='+encodeURIComponent(token);
 async function call(auth,expected,origin='https://js-map.com',method='POST'){
  return worker.fetch(new Request('https://js-map.com/api/listing-attachments?propertyId=PROPERTY-A',{method,headers:{...(auth?{cookie}:{}),origin,'content-type':'application/octet-stream',...(expected?{'x-expected-account':expected}:{})},body:method==='POST'?pdf:undefined}),env);
 }
 assert.equal((await call(false)).status,401);assert.equal((await call(true)).status,428);
 assert.equal((await call(true,other.email)).status,409);assert.equal((await call(true,owner.email,'https://other.invalid')).status,403);
 assert.equal((await call(true,undefined,undefined,'GET')).status,428);
});
test('real authenticated Worker route round-trips private bytes with no-cache download headers',async t=>{
 const s=setup(t),env={...s.env,GOOGLE_CLIENT_ID:'fixture-client',ALLOWED_EMAILS:owner.email,SESSION_SECRET:'local-test-secret-which-is-longer-than-32-characters'};
 const token=await createSessionToken({sub:'test-owner',email:owner.email},env),cookie=SESSION_COOKIE+'='+encodeURIComponent(token),id=crypto.randomUUID();
 const response=await worker.fetch(new Request('https://js-map.com/api/listing-attachments?propertyId=PROPERTY-A',{method:'POST',headers:{cookie,origin:'https://js-map.com','content-type':'application/octet-stream','x-expected-account':owner.email,'x-attachment-filename':encodeURIComponent("임대현황(최종)'표.pdf"),'x-attachment-request':id},body:pdf}),env);
 assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.persisted,true);
 const file=await worker.fetch(new Request('https://js-map.com'+saved.item.url,{headers:{cookie}}),env);
 assert.equal(file.status,200);assert.equal(file.headers.get('x-content-type-options'),'nosniff');assert.match(file.headers.get('content-security-policy'),/sandbox/);assert.match(file.headers.get('content-disposition'),/%28.*%29%27/);
 assert.deepEqual(new Uint8Array(await file.arrayBuffer()),pdf);assert.equal(s.objects.size,1);
 await assert.rejects(handleD1GetAction(env,owner,{action:'loadCloudState',scope}),e=>e.statusCode===400);
});
