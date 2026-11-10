import test from 'node:test';
import assert from 'node:assert/strict';
import {queryBridgeV152,queryEnabledV152,warmQueryViewsV152} from '../cloudflare/src/query-bridge-v152.js';
import worker from '../cloudflare/src/worker.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';
const headers=revision=>({'content-type':'application/json','x-js-query-revision-v152':revision,'x-js-query-schema':'readonly-v152'});
test('the new collection is disabled until an explicit flag and a private service binding both exist',async()=>{
  assert.equal(queryEnabledV152({}),false);assert.equal(queryEnabledV152({JS_QUERY_ENABLED:'1'}),false);
  const response=await queryBridgeV152({}, {},()=>{throw Error('Do not read revisions while disabled');});assert.equal(response.status,501);
});
test('the authenticated bridge streams the exact verified revision without expanding the catalog',async()=>{
  let reads=0,calls=0;
  const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls++;const body=await request.json();assert.equal(body.revision,'r');
    return new Response('{"fixture":true}',{headers:headers('r')});}}};
  const response=await queryBridgeV152(env,{spec:'{"mode":"lease"}'},async()=>{reads++;return{revision:'r'};});
  assert.equal(response.status,200);assert.equal(await response.text(),'{"fixture":true}');
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(reads,2);assert.equal(calls,1);
});
test('a moving revision retries one read and cannot publish an old query as current',async()=>{
  const revisions=['old','new','new','new'];let calls=0;
  const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls++;const body=await request.json();return new Response(body.revision,{headers:headers(body.revision)});}}};
  const response=await queryBridgeV152(env,{spec:'{}'},async()=>({revision:revisions.shift()}));
  assert.equal(await response.text(),'new');assert.equal(calls,2);
  await assert.rejects(queryBridgeV152({...env,LISTING_QUERY:{async fetch(){return new Response('bad',{headers:headers('wrong')});}}},
    {spec:'{}'},async()=>({revision:'new'})),/기준/);
});
test('preparation requests consume no collection body and never start or stop a collector',async()=>{
  const calls=[];const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls.push({body:await request.json(),warm:request.headers.get('x-js-query-warm-v152')});
    return new Response(null,{status:204});}}};
  await warmQueryViewsV152(env,async()=>({revision:'r'}));
  assert.deepEqual(calls.map(value=>value.body.spec.mode),['lease','building_sale','land_sale']);assert.ok(calls.every(value=>value.warm==='1'));
});

test('the actual public route requires a valid session and exact account before accessing its private service',async()=>{
  let calls=0;const secret='test-query-v152-at-least-32-characters-long',email='owner@example.invalid';
  const env={SESSION_SECRET:secret,ALLOWED_EMAILS:email,JS_QUERY_ENABLED:'1',JS_QUERY_UI_ENABLED:'1',
    MEDIA:{async get(){return{customMetadata:{savedAt:String(Date.now())},text:async()=>JSON.stringify({revision:'r'})};}},
    LISTING_QUERY:{async fetch(){calls++;return new Response('{"fixture":true}',{headers:headers('r')});}}};
  const url='https://fixture.invalid/api/data?action=listingQuery&spec=%7B%7D';
  assert.equal((await worker.fetch(new Request(url),env,{})).status,401);assert.equal(calls,0);
  const token=await createSessionToken({email,sub:'fixture'},env),cookie=SESSION_COOKIE+'='+token;
  const bad=await worker.fetch(new Request(url+'&expectedAccountEmail=other%40example.invalid',{headers:{cookie}}),env,{});
  assert.equal(bad.status,409);assert.equal(calls,0);
  const good=await worker.fetch(new Request(url+'&expectedAccountEmail=owner%40example.invalid',{headers:{cookie}}),env,{});
  assert.equal(good.status,200);assert.equal(await good.text(),'{"fixture":true}');assert.equal(calls,1);
  const session=await worker.fetch(new Request('https://fixture.invalid/api/session',{headers:{cookie}}),env,{});
  assert.equal((await session.json()).queryListingsV152,true);
  const staged=await worker.fetch(new Request('https://fixture.invalid/api/session',{headers:{cookie}}),{...env,JS_QUERY_UI_ENABLED:'0'},{});
  assert.equal((await staged.json()).queryListingsV152,undefined);
});
