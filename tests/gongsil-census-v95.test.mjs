import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {handleCollectorApi} from '../cloudflare/src/collector-api.js';

function fixture(t) {
  let clock=Date.now(); t.mock.timers.enable({apis:['Date'],now:clock});
  const db=new DatabaseSync(':memory:');
  for(const name of fs.readdirSync('cloudflare/migrations').filter(x=>x.endsWith('.sql')).sort()) db.exec(fs.readFileSync('cloudflare/migrations/'+name,'utf8'));
  t.after(()=>db.close());
  const prepare=(sql,args=[])=>{
    const numbers=[];const translated=sql.replace(/\?(\d+)/g,(_,n)=>{numbers.push(+n-1);return '?';});
    const params=()=>numbers.length?numbers.map(n=>args[n]):args;
    return {bind:(...a)=>prepare(sql,a),async first(){return db.prepare(translated).get(...params())||null;},
      async all(){return {results:db.prepare(translated).all(...params())};},async run(){return {meta:{changes:Number(db.prepare(translated).run(...params()).changes)}};}};
  };
  const env={COLLECTOR_ACCESS_KEY:'fixture',DB:{prepare,async batch(rows){db.exec('BEGIN');try{const result=[];for(const row of rows)result.push(await row.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}};
  function seed(id,market='lease') {
    db.prepare("INSERT INTO listings(id,property_id,address,title,room,trade_type,status,operating_memo) VALUES (?,?,?,?,?,?,'active','사용자 보존 메모')")
      .run(id+'-'+market,id+'-'+market,'대전 테스트동 1','검수 매물','101호',market);
    db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,trade_type,active,missing_count,last_collected_at,updated_at) VALUES (?,?,'공실박스',?,?,1,0,?,?)")
      .run('s-'+id+'-'+market,id+'-'+market,id+'::'+market,market,new Date(clock-10000).toISOString(),new Date(clock-10000).toISOString());
  }
  const scope=extra=>({version:1,selectionKind:'full-map-result',bounds:[36.2,127.2,36.5,127.5],level:13,btype:'Xone',filtersHash:'a'.repeat(64),...extra});
  const get=(id,market='lease')=>db.prepare('SELECT active,missing_count FROM listing_sources WHERE id=?').get('s-'+id+'-'+market);
  async function finalize(session,ids,extra={}) {
    clock+=1000;t.mock.timers.setTime(clock);
    const body={action:'finalizeCollectionSession',source:'공실박스',collectorKey:'fixture',collectorVersion:'2.3.4',
      sessionId:session,complete:false,validationVersion:3,tradeType:'lease',collectionTradeType:'lease',presenceVersion:1,
      expectedCount:ids.length+1,manifestCount:ids.length,processedCount:ids.length+1,failed:2,addressMissing:1,
      observedSourceIds:ids,observedOffers:ids.map(sourceId=>({sourceId,tradeType:'lease'})),
      providerObservedOffersV95:ids.map(sourceId=>({sourceId,tradeType:'lease'})),
      censusV95:{version:95,scope:scope(),ids,capturedAt:new Date(clock).toISOString(),complete:true,selectionVerified:true,emptyConfirmed:ids.length===0},...extra};
    const response=await handleCollectorApi(new Request('https://js-map.com/api/collector',{method:'POST',headers:{Origin:'https://www.gongsilbox.com','Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    const result=await response.json();assert.equal(result.ok,true,JSON.stringify(result));return result;
  }
  return {db,seed,scope,get,finalize};
}

test('v95 proves the ad census despite detail failures: only missing original becomes candidate, reappearance restores it',async t=>{
  const f=fixture(t);for(const id of ['a','b','outside'])f.seed(id);f.seed('a','sale');
  const first=await f.finalize('base',['a','b']);assert.equal(first.censusValidatedV95,true);assert.equal(first.presenceScopeEstablished,true);
  assert.equal(first.complete,false); // Detail errors are still reported honestly.
  const next=await f.finalize('missing',['b'],{providerObservedOffersV95:[]});
  assert.equal(next.deactivated,1);assert.deepEqual({...f.get('a')},{active:0,missing_count:1});
  assert.equal(f.get('b').active,1);assert.equal(f.get('outside').active,1);assert.equal(f.get('a','sale').active,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_source_availability WHERE kind='census_missing'").get().n,1);
  assert.deepEqual({...f.db.prepare("SELECT status,operating_memo FROM listings WHERE id='a-lease'").get()},{status:'active',operating_memo:'사용자 보존 메모'});
  const replay=await f.finalize('missing',['b']);assert.equal(replay.replayed,true);assert.equal(replay.deactivated,1);
  const returned=await f.finalize('return',['a','b'],{providerObservedOffersV95:[]});
  assert.equal(returned.adsReappeared,1);assert.equal(f.get('a').active,1);
});

test('v95 separate fixed filter scopes never age another property category',async t=>{
  const f=fixture(t);f.seed('a');f.seed('b');
  await f.finalize('base',['a']);
  const other={version:95,scope:f.scope({filtersHash:'b'.repeat(64),btype:'Land'}),ids:['b'],capturedAt:new Date(Date.now()+1000).toISOString(),complete:true,selectionVerified:true};
  const result=await f.finalize('land',['b'],{censusV95:other});assert.equal(result.presenceScopeEstablished,true);assert.equal(result.deactivated,0);assert.equal(f.get('a').active,1);
});

test('v95 stopped, unverified, stale, duplicate and absent proofs never age ads',async t=>{
  const f=fixture(t);f.seed('a');await f.finalize('base',['a']);
  for(const [index,change] of [{stopped:true},{censusV95:null,censusIssueV95:'확인 보류'},
    {censusV95:{version:95,scope:f.scope(),ids:[],complete:true,selectionVerified:false,capturedAt:new Date().toISOString()}},
    {censusV95:{version:95,scope:f.scope(),ids:['a','a'],complete:true,selectionVerified:true,capturedAt:new Date().toISOString()}},
    {censusV95:{version:95,scope:f.scope(),ids:[],complete:true,selectionVerified:true,emptyConfirmed:true,capturedAt:'2000-01-01T00:00:00Z'}}].entries()) {
    const result=await f.finalize('unsafe-'+index,[],change);assert.equal(result.presenceTracking,false);assert.equal(f.get('a').active,1);
  }
});

test('v95 successful explicit empty map ages only its established market',async t=>{
  const f=fixture(t);f.seed('a');f.seed('a','sale');await f.finalize('base',['a']);
  const result=await f.finalize('empty',[]);assert.equal(result.censusValidatedV95,true);assert.equal(result.deactivated,1);assert.equal(f.get('a','sale').active,1);
});

const client=fs.readFileSync('js/gongsil-census-v95.js','utf8');
function clientFixture() {
  const storage=new Map(),window={};
  const context={window,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:globalThis.crypto,TextEncoder,Uint8Array,AbortController,setTimeout,clearTimeout};
  vm.runInNewContext(client,context);
  function capture(values,extra={}) {
    window.__JS_GONGSIL_SCOPE_CAPTURE_V1__={version:95,capture:{complete:true,capturedAt:Date.now(),body:{btype:'Xone',level:13,search:{type:'상가'},
      removecoord:{minlat:0},areacoord:{minlat:36.2,minlng:127.2,maxlat:36.5,maxlng:127.5},...extra},groups:[{fidxs:values}]}};
    return {body:{bfidxs:values,btype:'Xone',level:13},emptyMapConfirmed:values.length===0};
  }
  return {window,storage,api:window.JSGongsilCensusV95,capture};
}
test('manual first capture is proven without extra requests, and only acknowledged scope is persisted',async()=>{
  const f=clientFixture(),selection=f.capture(['one','two']);let calls=0;
  const result=await f.api.prepare(selection,{fetch:()=>{calls++;throw Error('unexpected');}});
  assert.equal(result.census.ids.length,2);assert.equal(calls,0);assert.equal(f.storage.size,0);
  assert.equal(f.api.commit(result.census,{presenceTracking:false,censusValidatedV95:true}),false);
  assert.equal(f.api.commit(result.census,{presenceTracking:true,censusValidatedV95:true}),true);assert.equal(f.storage.size,1);
  assert.doesNotMatch([...f.storage.values()].join(''),/"(?:one|two)"|search/);
});
test('resized 50% view rechecks only pinned IDs once, without replacing provider selection',async()=>{
  const f=clientFixture(),initial=f.capture(['one','two']);const first=await f.api.prepare(initial,{});
  f.api.commit(first.census,{presenceTracking:true,censusValidatedV95:true});
  const resized=f.capture(['one','new'],{areacoord:{minlat:36.1,minlng:127.1,maxlat:36.6,maxlng:127.6}});
  const original=f.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture;let calls=0;
  const result=await f.api.prepare(resized,{fetch:async(url,options)=>{
    calls++;assert.equal(url,'/api/maps/circle');assert.equal(options.__jsGongsilCensusV95,true);
    assert.equal(JSON.parse(options.body).areacoord.minlat,36.2);
    return {ok:true,json:async()=>({res:'success',datas:{res:[{fidxs:['two']}]}})};
  }});
  assert.equal(calls,1);assert.deepEqual(Array.from(result.census.ids),['two']);assert.equal(f.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture,original);
});
test('partial selection and private filters never query; an incremental map requires one verified whole-map read',async()=>{
  const f=clientFixture();let calls=0;const opts={fetch:()=>{calls++;}};
  assert.equal((await f.api.prepare({body:{}},opts)).census,null);
  let s=f.capture(['one','two']);s.body.bfidxs=['one'];assert.equal((await f.api.prepare(s,opts)).census,null);
  s=f.capture(['one'],{removecoord:{minlat:36}});assert.equal((await f.api.prepare(s,opts)).census,null);
  s=f.capture(['one'],{search:{MyActive:true}});assert.equal((await f.api.prepare(s,opts)).census,null);
  assert.equal(calls,1);
});
test('an incremental circle response is reconstructed once before verifying a full manual selection',async()=>{
  const f=clientFixture();const s=f.capture(['one','two'],{removecoord:{minlat:36.2}});
  f.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.groups=[{fidxs:['two']}];let calls=0;
  const result=await f.api.prepare(s,{fetch:async(url,opts)=>{calls++;assert.equal(JSON.parse(opts.body).removecoord.minlat,0);
    return {ok:true,json:async()=>({res:'success',datas:{res:[{fidxs:['one','two']}]}})};}});
  assert.equal(calls,1);assert.deepEqual(Array.from(result.census.ids),['one','two']);
});
test('failed pinned query, stale response, and unsafe empty replies never produce census proof',async()=>{
  const f=clientFixture(),initial=f.capture(['one']);const first=await f.api.prepare(initial,{});f.api.commit(first.census,{presenceTracking:true,censusValidatedV95:true});
  const shifted=()=>f.capture(['one'],{areacoord:{minlat:36.1,minlng:127.1,maxlat:36.6,maxlng:127.6}});
  for(const fetch of [async()=>({ok:false}),async()=>({ok:true,json:async()=>({res:'success'})}),
    async()=>({ok:true,json:async()=>({res:'success',more:true,datas:{res:[]}})}),
    async()=>{f.capture(['changed']);return {ok:true,json:async()=>({res:'success',datas:{res:[]}})};}]) {
    assert.equal((await f.api.prepare(shifted(),{fetch})).census,null);
  }
});

test('a competing first tab cannot silently replace an acknowledged fixed scope',async()=>{
  const f=clientFixture(),first=await f.api.prepare(f.capture(['one']),{});
  const other=await f.api.prepare(f.capture(['two'],{areacoord:{minlat:36.1,minlng:127.1,maxlat:36.6,maxlng:127.6}}),{});
  assert.equal(f.api.commit(first.census,{presenceTracking:true,censusValidatedV95:true}),true);
  assert.equal(f.api.commit(other.census,{presenceTracking:true,censusValidatedV95:true}),false);
  assert.equal(JSON.parse([...f.storage.values()][0])[0].bounds[0],36.2);
});

test('3982 advertisements need no per-ad network call to prove an unchanged full viewport',async()=>{
  const f=clientFixture(),values=Array.from({length:3982},(_,n)=>String(n+1));let calls=0;
  const result=await f.api.prepare(f.capture(values),{fetch:()=>{calls++;throw Error('unexpected per-ad fetch');}});
  assert.equal(result.census.ids.length,3982);assert.equal(calls,0);
});

test('explicit lease and sale collections never borrow each others fixed viewport',async()=>{
  const f=clientFixture(),lease=await f.api.prepare(f.capture(['one']),{market:'lease'});
  f.api.commit(lease.census,{presenceTracking:true,censusValidatedV95:true});
  const sale=await f.api.prepare(f.capture(['two'],{areacoord:{minlat:36.1,minlng:127.1,maxlat:36.6,maxlng:127.6}}),{market:'sale',fetch:()=>{throw Error('cross-market profile borrowed');}});
  assert.ok(sale.census);assert.equal(sale.census.scope.bounds[0],36.1);assert.notEqual(sale.census.scope.filtersHash,lease.census.scope.filtersHash);
});
