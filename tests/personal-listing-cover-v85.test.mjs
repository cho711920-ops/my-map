import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handlePersonalListingCover} from '../cloudflare/src/personal-listing-cover.js';
import worker from '../cloudflare/src/worker.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';

const user={email:'owner@example.invalid'},id='PROPERTY-1';
function jpeg(w=120,h=80){return 'data:image/jpeg;base64,'+Buffer.from([255,216,255,192,0,11,8,h>>8,h&255,w>>8,w&255,1,1,17,0,255,217]).toString('base64');}
function setup(){
  const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE cloud_state(owner_email TEXT,scope TEXT,record_key TEXT,value_json TEXT,version INTEGER,updated_at TEXT,PRIMARY KEY(owner_email,scope,record_key));CREATE TABLE listings(id TEXT,property_id TEXT,status TEXT);INSERT INTO listings VALUES('ROW-1','PROPERTY-1','active');");
  const objects=new Map(),env={DB:{prepare(sql){return {bind(...args){const statement=db.prepare(sql);return {first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>({meta:{changes:statement.run(...args).changes}})};}};}},MEDIA:{async put(key,bytes){objects.set(key,new Uint8Array(bytes));},async get(key){return objects.has(key)?{body:objects.get(key)}:null;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}}};
  const call=(body=null,query='',who=user)=>handlePersonalListingCover(new Request('https://js-map.com/api/personal-cover'+query,{method:body?'POST':'GET'}),env,who,body);
  const save=(extra={})=>({action:'save',propertyId:id,expectedVersion:0,requestId:crypto.randomUUID(),image:jpeg(),thumbnail:jpeg(60,40),source:'naver',...extra});
  return {db,env,objects,call,save};
}
test('private cover persists without changing source records, thumbnail is separate, reset retains version',async()=>{
  const s=setup(),before=s.db.prepare('SELECT * FROM listings').all(),body=s.save();
  const saved=await(await s.call(body)).json();assert.equal(saved.cover.version,1);assert.equal(s.objects.size,2);
  assert.equal(saved.cover.source,'naver');assert(!JSON.stringify(saved).includes('base64'));assert(!JSON.stringify(saved).includes(user.email));
  const thumb=await s.call(null,new URL(saved.cover.thumbnailUrl,'https://js-map.com').search);assert.equal(thumb.headers.get('content-type'),'image/jpeg');assert.equal(thumb.headers.get('cache-control'),'private, max-age=86400, immutable');assert.equal((await thumb.arrayBuffer()).byteLength,17);
  const reset={action:'reset',propertyId:id,expectedVersion:1,requestId:crypto.randomUUID()};const restored=await(await s.call(reset)).json();assert.equal(restored.cover.imageId,'');assert.equal(restored.cover.version,2);assert.equal(restored.cover.requestId,reset.requestId);assert.equal(s.objects.size,0);
  assert.deepEqual(s.db.prepare('SELECT * FROM listings').all(),before);
  assert.equal((await(await s.call(null,'?propertyId='+id)).json()).cover.version,2);
  await assert.rejects(s.call(null,new URL(saved.cover.url,'https://js-map.com').search),e=>e.statusCode===404);
});
test('another account cannot read or reset a cover and index is owner scoped',async()=>{
  const s=setup(),saved=await(await s.call(s.save())).json(),other={email:'friend@example.invalid'};
  assert.deepEqual((await(await s.call(null,'',other)).json()).covers,[]);
  await assert.rejects(s.call(null,new URL(saved.cover.url,'https://js-map.com').search,other),e=>e.statusCode===403);
  await s.call({action:'reset',propertyId:id,expectedVersion:0,requestId:crypto.randomUUID()},'',other);
  assert.equal(s.objects.size,2);assert.equal((await(await s.call(null,'?propertyId='+id)).json()).cover.version,1);
});
test('idempotent retries and concurrent identical requests keep only the winning two objects',async()=>{
  const s=setup(),body=s.save(),results=await Promise.all([s.call(body),s.call(body)]),covers=await Promise.all(results.map(r=>r.json()));
  assert.equal(covers[0].cover.imageId,covers[1].cover.imageId);assert.equal(s.objects.size,2);
  assert.equal((await(await s.call(body)).json()).cover.version,1);
  await assert.rejects(s.call({...body,image:jpeg(121,80)}),e=>e.statusCode===409);
});
test('conflicting devices and failed R2 writes cannot overwrite the saved image',async()=>{
  const s=setup(),saved=await(await s.call(s.save())).json();
  await assert.rejects(s.call(s.save()),e=>e.statusCode===409);assert.equal(s.objects.size,2);
  const put=s.env.MEDIA.put;s.env.MEDIA.put=async function(key,bytes){if(key.endsWith('-thumb.jpg'))throw Error('storage unavailable');return put(key,bytes);};
  await assert.rejects(s.call(s.save({expectedVersion:1})),e=>e.statusCode===503);assert.equal(s.objects.size,2);
  assert.equal((await(await s.call(null,'?propertyId='+id)).json()).cover.imageId,saved.cover.imageId);
});
test('two different racing saves have one CAS winner and no orphan objects',async()=>{
  const s=setup(),results=await Promise.allSettled([s.call(s.save()),s.call(s.save())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);assert.equal(s.objects.size,2);
});
test('invalid image, path, deleted property, version and mismatched crop never write',async()=>{
  const s=setup();for(const extra of [{image:'data:image/svg+xml;base64,PHN2Zz4='},{image:jpeg(1281,800)},{thumbnail:jpeg(321,200)},{thumbnail:jpeg(20,100)},{image:'data:image/jpeg;base64,Zm9v'},{propertyId:'../other'},{propertyId:'MISSING'},{expectedVersion:-1},{requestId:'unsafe'}])await assert.rejects(s.call(s.save(extra)));
  assert.equal(s.objects.size,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM cloud_state').get().n,0);
  s.db.exec("UPDATE listings SET status='deleted'");await assert.rejects(s.call(s.save()),e=>e.statusCode===404);
});
test('index pagination includes reset tombstones without images or neighboring account entries',async()=>{
  const s=setup(),stmt=s.db.prepare('INSERT INTO cloud_state VALUES(?,?,?,?,?,?)');
  for(let i=0;i<252;i++)stmt.run(user.email,'personalListingCoverV85','P-'+String(i).padStart(3,'0'),JSON.stringify({imageId:'',requestId:crypto.randomUUID()}),3,'today');
  const first=await(await s.call()).json();assert.equal(first.covers.length,250);assert.equal(first.nextCursor,'P-249');
  const last=await(await s.call(null,'?cursor='+first.nextCursor)).json();assert.equal(last.covers.length,2);assert.equal(last.nextCursor,'');
});
test('worker requires login, same origin and expected account before accessing personal storage',async()=>{
  const env={GOOGLE_CLIENT_ID:'fixture-client',ALLOWED_EMAILS:user.email,SESSION_SECRET:'local-test-secret-which-is-longer-than-32-characters',ASSETS:{fetch:async()=>new Response('asset')}};
  const token=await createSessionToken({sub:'test-owner',email:user.email},env),cookie=SESSION_COOKIE+'='+encodeURIComponent(token);
  async function request(path,body,origin='https://js-map.com',auth=true){return worker.fetch(new Request('https://js-map.com'+path,{method:body?'POST':'GET',headers:{...(auth?{cookie}:{}),origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env);}
  assert.equal((await request('/api/personal-cover',null,undefined,false)).status,401);
  assert.equal((await request('/api/personal-cover')).status,428);
  assert.equal((await request('/api/personal-cover?expectedAccountEmail=friend%40example.invalid')).status,409);
  assert.equal((await request('/api/personal-cover',{expectedAccountEmail:user.email},'https://other.invalid')).status,403);
  assert.equal((await request('/api/personal-cover',{expectedAccountEmail:'friend@example.invalid'})).status,409);
});
