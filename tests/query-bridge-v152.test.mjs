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
  const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls++;const body=await request.json();assert.equal(body.resolveCurrentV160,true);assert.equal(body.revision,undefined);
    return new Response('{"fixture":true}',{headers:headers('r')});}}};
  const response=await queryBridgeV152(env,{spec:'{"mode":"lease"}'},async()=>{reads++;return{revision:'r'};});
  assert.equal(response.status,200);assert.equal(await response.text(),'{"fixture":true}');
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(reads,2);assert.equal(calls,1);
});
test('v217 navigation mode is forwarded only for an authenticated unconditional listing query',async()=>{
  const seen=[];const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){const input=await request.json();seen.push(input);return Response.json({ok:true},{headers:headers('r')});}}};
  for(const query of [{navigation:'217'},{navigation:'other'},{navigation:'217',since:'r',fields:'[]'}])
    await queryBridgeV152(env,{spec:'{}',...query},async()=>({revision:'r'}));
  assert.equal(seen[0].navigationOnlyV217,true);assert.equal(seen[1].navigationOnlyV217,undefined);assert.equal(seen[2].navigationOnlyV217,undefined);
});

test('v228 conditional navigation preserves the compact fallback request if a saved revision is too old for a delta',async()=>{
  let seen,reads=0;const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){seen=await request.json();return Response.json({ok:true},{headers:headers('new')});}}};
  await queryBridgeV152(env,{spec:'{}',navigation:'228',since:'expired',fields:'[]'},async()=>{reads++;return{revision:'new'};});
  assert.equal(seen.since,'expired');assert.equal(seen.navigationOnlyV217,true);assert.equal(seen.compressedNavigationV228,true);assert.equal(reads,1);
});

test('v220 the private query starts while the first public revision read is pending without losing either authority check',{timeout:2000},async()=>{
  let release,reads=0,privateStarted=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){const body=await request.json();assert.equal(body.resolveCurrentV160,true);privateStarted=true;release();return Response.json({ok:true},{headers:headers('r')});}}};
  const response=await queryBridgeV152(env,{spec:'{}'},async()=>{reads++;if(reads===1)await gate;assert.equal(privateStarted,true);return{revision:'r'};});
  assert.equal(response.status,200);assert.equal(reads,2);
});

test('v217 public JSON streams negotiate HTTP compression without changing decoded bytes or encoding snapshot ranges twice',async()=>{
  const cases=[
    ['gzip, br',{},'gzip'],['GZip; q=0.5',{},'gzip'],['gzip;q=0, br',{},null],['br',{},null],
    ['gzip',{'x-js-snapshot-protocol':'manifest-v189'},null],
    ['gzip',{'content-type':'application/octet-stream'},null],
    ['gzip',{'content-encoding':'br'},'br'],
    ['gzip',{'x-js-query-schema':'readonly-delta-v160'},'gzip']
  ];
  for(const [accept,extra,expected] of cases){
    const body='{"completeQuery":true,"rows":[["한글·exact-id"]]}';
    const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(){return new Response(body,{headers:{...headers('r'),...extra}});}}};
    const result=await queryBridgeV152(env,{spec:'{}',navigation:'217',...(extra['x-js-query-schema']==='readonly-delta-v160'?{since:'r',fields:'[]'}:{})},async()=>({revision:'r'}),new Request('https://fixture.invalid/',{headers:{'accept-encoding':accept}}));
    assert.equal(result.headers.get('content-encoding'),expected);
    assert.equal(await result.text(),body,'The Worker boundary must stream decoded original bytes; its runtime performs HTTP compression');
    assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(result.headers.get('vary'),'Cookie, Accept-Encoding');
  }
});
test('a moving revision retries one read and cannot publish an old query as current',async()=>{
  const revisions=['old','new','new','new'];let calls=0;
  const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls++;const body=await request.json();assert.equal(body.resolveCurrentV160,true);const revision=calls===1?'old':'new';return new Response(revision,{headers:headers(revision)});}}};
  const response=await queryBridgeV152(env,{spec:'{}'},async()=>({revision:revisions.shift()}));
  assert.equal(await response.text(),'new');assert.equal(calls,2);
  await assert.rejects(queryBridgeV152({...env,LISTING_QUERY:{async fetch(){return new Response('bad',{headers:headers('wrong')});}}},
    {spec:'{}'},async()=>({revision:'new'})),/갱신/);
});
test('preparation requests consume no collection body and never start or stop a collector',async()=>{
  const calls=[];const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls.push({body:await request.json(),warm:request.headers.get('x-js-query-warm-v152')});
    return new Response(null,{status:204});}}};
  await warmQueryViewsV152(env,async()=>({revision:'r'}));
  assert.deepEqual(calls.map(value=>value.body.spec.mode),['lease','lease','lease','lease','building_sale','building_sale','building_sale','building_sale','land_sale','land_sale','land_sale','land_sale']);assert.ok(calls.every(value=>value.warm==='1'));
  assert.deepEqual(calls.filter(value=>value.body.navigationOnlyV217).map(value=>value.body.compressedNavigationV228),[true,true,true]);
  assert.deepEqual(calls.filter(value=>value.body.catalogOnlyV232).map(value=>value.body.spec.mode),['lease','building_sale','land_sale']);
  assert.deepEqual(calls.filter(value=>Object.hasOwn(value.body,'mediaIds')).map(value=>value.body.mediaIds),[[],[],[]]);
});

test('photo-only bridge requires its separate schema, bounded IDs and unchanged authenticated revision',async()=>{
  let calls=0;const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls++;const body=await request.json();assert.deepEqual(body.mediaIds,['A','B']);
    return Response.json({ok:true},{headers:{...headers('r'),'x-js-query-schema':'readonly-media-v159'}});}}};
  const query={action:'listingQueryMedia',spec:'{}',ids:'A,B'},read=async()=>({revision:'r'});
  assert.equal((await queryBridgeV152(env,query,read)).status,200);
  for(const ids of ['',',A','A,A',Array.from({length:49},(_,i)=>String(i)).join(',')])await assert.rejects(queryBridgeV152(env,{...query,ids},read));
  assert.equal(calls,1);
  await assert.rejects(queryBridgeV152({...env,LISTING_QUERY:{async fetch(){return new Response('{}',{headers:headers('r')});}}},query,read),/기준/);
});
test('conditional refresh resolves its revision in the private service and still rejects a change before public publication',async()=>{
  let reads=0,calls=0;const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){calls++;const body=await request.json();
    assert.equal(body.resolveCurrentV160,true);assert.equal(body.revision,undefined);assert.equal(body.since,'old');
    return Response.json({ok:true},{headers:{...headers(calls===1?'old':'new'),'x-js-query-schema':'readonly-delta-v160'}});}}};
  const result=await queryBridgeV152(env,{spec:'{}',since:'old',fields:'["propertyId"]'},async()=>{reads++;return {revision:'new'};});
  assert.equal(result.status,200);assert.equal(calls,2);assert.equal(reads,2,'One final authority check per attempt, not duplicate sequential reads');
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
  const mediaUrl=url.replace('action=listingQuery&','action=listingQueryMedia&ids=A&');
  assert.equal((await worker.fetch(new Request(mediaUrl),env,{})).status,401);
  assert.equal((await worker.fetch(new Request(mediaUrl+'&expectedAccountEmail=other%40example.invalid',{headers:{cookie}}),env,{})).status,409);
  const mediaEnv={...env,LISTING_QUERY:{async fetch(request){assert.deepEqual((await request.json()).mediaIds,['A']);return Response.json({ok:true},{headers:{...headers('r'),'x-js-query-schema':'readonly-media-v159'}});}}};
  assert.equal((await worker.fetch(new Request(mediaUrl+'&expectedAccountEmail=owner%40example.invalid',{headers:{cookie}}),mediaEnv,{})).status,200);
});
