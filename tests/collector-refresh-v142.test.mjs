import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import {DatabaseSync} from "node:sqlite";
import liveWorker from "../cloudflare/src/worker.js";
import {buildSheetSnapshot,buildUnifiedSnapshot} from "../cloudflare/src/bounded-snapshot-build.js";
import {sheetCacheStream} from "../cloudflare/src/sheet-cache-stream.js";
import {collectorRefreshIdsV142,validCollectorRefreshV142} from "../cloudflare/src/collector-refresh-v142.js";
import {speedDatabase} from "./fixtures/collector-speed-v64.mjs";
import {snapshotTransfer} from "../cloudflare/src/snapshot-transfer.js";

const worker = readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
const map = readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
const access = readFileSync(new URL("../js/data-access-v6.js", import.meta.url), "utf8");
function fn(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function harness() {
  const store = new Map(), counts = { reads: 0, writes: 0, d1: 0 };
  let sequence = 0;
  const env = { DB: {}, MEDIA: {
    async get(key) {
      counts.reads++;
      const row = store.get(key);
      return row ? { ...row, text: async () => row.body } : null;
    },
    async put(key, body, options = {}) {
      counts.writes++;
      const current = store.get(key);
      if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
      if (options.onlyIf?.etagDoesNotMatch === "*" && current) return null;
      const row = { body, ...options, etag: String(++sequence) };
      store.set(key, row);
      return row;
    }
  } };
  const context = vm.createContext({ Response, Date, crypto, console, sheetCacheStream, snapshotTransfer,
    D1_SHEET_CACHE_KEY: "sheet", LISTINGS_REVISION_KEY: "listings", OPERATIONS_REVISION_KEY: "operations",
    sheetCache: { body: "", fetchedAt: 0 }, requireSession: async () => ({}),
    sha256Etag: async (body) => body,
    buildD1SheetCsv: async () => { counts.d1++; return "NEW"; }
  });
  for (const name of ["cacheAgeMs", "readR2TextCache", "writeR2TextCache", "revisionKey",
    "readDataRevision", "appendDataRevision", "touchDataRevision", "handleSheet"]) {
    vm.runInContext(fn(worker, name), context);
  }
  const write = (info) => context.touchDataRevision(env, null, ["listings"], null, info);
  const read = (since) => context.readDataRevision(env, "listings", since);
  return { context, env, store, counts, write, read };
}
function browser(h) {
  const counts = { full: 0, delta: 0 };
  const context = vm.createContext({ console, Promise, URLSearchParams,
    jsListingsRevisionV682: "", jsListingsRevisionInfoV683: null, jsListingsRevisionPendingV682: false,
    isLoadingSheet: false, jsListingsLoadGenerationV1: 0,
    jsListingsCompleteBaseV1:true,jsListingsLoadStateV65:{phase:'ready'},
    window: { JSDataAccessV6: { read: (_action, args) => h.read(args.since) } },
    loadSheet: async () => {
      counts.full++;
      context.jsListingsRevisionV682 = (await h.read()).revision;
      return true;
    },
    applyListingChangesV683: async (info) => { if (info.fullReload) return false; counts.delta++; return true; }
  });
  for (const name of ["fetchDataRevisionV682", "rememberListingsRevisionV682", "recoverOriginalMetadataV1", "refreshListingsWhenChangedV682"]) {
    vm.runInContext(fn(map, name), context);
  }
  return { context, counts };
}


test('large collector journal is negotiated, complete, concurrent-safe and legacy clients fall back',async()=>{
 const h=harness();await h.write({changeIds:['BASE']});const base=(await h.read()).revision;
 const ids=Array.from({length:120},(_,i)=>'M-'+i);await h.write({changeIds:ids,collectorRefreshV142:true});
 const latest=await h.context.readDataRevision(h.env,'listings',base,142);assert.equal(latest.fullReload,false);assert.deepEqual(Array.from(latest.changeIds),ids);assert.ok(latest.collectorRevisionV142);
 assert.equal((await h.read(base)).fullReload,true,'old clients must never accept a truncated delta');
 await h.write({changeIds:['SAVED'],changeAction:'updatePropertyMemo'});
 const after=await h.context.readDataRevision(h.env,'listings',base,142);assert.equal(after.fullReload,false);assert.equal(after.changeIds.length,121);assert.equal(after.collectorRevisionV142,latest.collectorRevisionV142,'memo-only revision does not rebuild original photos');
 await h.write({changeIds:Array.from({length:1025},(_,i)=>'OVER-'+i),collectorRefreshV142:true});
 assert.equal((await h.context.readDataRevision(h.env,'listings',after.revision,142)).fullReload,true);
});
test('exact collector IDs include new/changed sources and ended masters without guessing a neighbor at the same address',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());
 for(const [id,pub] of [['a','PUBLIC-A'],['b','PUBLIC-B'],['c','PUBLIC-C']])f.db.prepare("INSERT INTO listings(id,property_id,address,operating_memo) VALUES(?,?,'같은 지번 1','직접 메모')").run(id,pub);
 f.db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,session_id) VALUES('s-a','a','네이버','1','run'),('s-b','b','당근','2','other')").run();
 const actual=await collectorRefreshIdsV142(f.env,'네이버','run',['c']);assert.deepEqual(actual,{version:142,propertyIds:['PUBLIC-A','PUBLIC-C'],fullReload:false});assert.equal(validCollectorRefreshV142(actual),true);
 assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE id='b'").get().operating_memo,'직접 메모');
 for(let i=0;i<1025;i++){f.db.prepare("INSERT INTO listings(id,property_id) VALUES(?,?)").run('bulk-'+i,'BULK-'+i);f.db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,session_id) VALUES(?,?,'네이버',?,'large')").run('s-'+i,'bulk-'+i,'bulk-'+i);}
 assert.deepEqual(await collectorRefreshIdsV142(f.env,'네이버','large'),{version:142,propertyIds:[],fullReload:true});
});
test('retained original snapshots cannot issue a current manifest at an older collector epoch',async()=>{
 const key='snapshot',env={MEDIA:{async head(){return {size:5,httpEtag:'"old"',httpMetadata:{},customMetadata:{savedAt:String(Date.now()),revision:'r1',collectorRevisionV142:'old'}};}}};
 assert.equal(await snapshotTransfer(env,key,60000,new Request('https://fixture.invalid',{headers:{'x-js-snapshot-mode':'manifest-v128'}}),null,'new'),null);
 assert.equal((await snapshotTransfer(env,key,60000,new Request('https://fixture.invalid',{headers:{'x-js-snapshot-mode':'manifest-v128'}}),null,'old')).response.status,200);
});
test('invalid collector delta metadata cannot silently discard a master',()=>{
 for(const value of [null,{version:142,propertyIds:['A','A'],fullReload:false},{version:142,propertyIds:[''],fullReload:false},{version:142,propertyIds:['A'],fullReload:true},{version:142,propertyIds:['한글'],fullReload:false}])assert.equal(validCollectorRefreshV142(value),false);
});

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
    const response=await liveWorker.fetch(new Request('https://js-map.com/api/collector',{method:'POST',headers:{Origin:'https://www.gongsilbox.com','Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    const result=await response.json();assert.equal(result.ok,true,JSON.stringify(result));return result;
  }
  return {db,seed,scope,get,finalize,env};
}

test('real collection completion retains prepared catalogs and publishes only the exact missing master',async t=>{
 const f=fixture(t);for(const id of ['a','b','other'])f.seed(id);
 const objects=new Map(),deleted=[];let seq=0;
 const catalogs=['api-cache/d1-sheet-v133-critical.csv','api-cache/d1-sheet-lease-v133-critical.csv','api-cache/unified-listings-v28-photo-paths-v119.json','api-cache/unified-listings-lease-v123.json'];
 f.env.MEDIA={async get(key){const r=objects.get(key);return r?{...r,text:async()=>r.value}:null;},async put(key,value,options={}){const current=objects.get(key);if(options.onlyIf?.etagMatches&&current?.etag!==options.onlyIf.etagMatches||options.onlyIf?.etagDoesNotMatch==='*'&&current)return null;const row={value,...options,etag:String(++seq)};objects.set(key,row);return row;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){deleted.push(key);objects.delete(key);}}};
 for(const key of catalogs)await f.env.MEDIA.put(key,'COMPLETE-BEFORE');
 await f.env.MEDIA.put('api-cache/revision/listings.json',JSON.stringify({revision:'base',history:[{revision:'base',changeIds:['base'],fullReload:false}]}));
 await f.finalize('base-scope',['a','b']);
 const result=await f.finalize('missing-scope',['b']);
 assert.deepEqual(result.refreshV142,{version:142,propertyIds:['a-lease'],fullReload:false});
 for(const key of catalogs)assert.equal(objects.get(key).value,'COMPLETE-BEFORE',key);
 const revision=JSON.parse(objects.get('api-cache/revision/listings.json').value);assert.equal(revision.fullReload,false);assert.deepEqual(revision.changeIds,['a-lease']);assert.ok(revision.collectorRevisionV142);
 assert.ok(deleted.some(key=>key.includes('a-lease.json')));assert.ok(!deleted.some(key=>key.includes('b-lease.json')));
 assert.equal(f.get('b').active,1);assert.equal(f.get('other').active,1);
 assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE id='a-lease'").get().operating_memo,'사용자 보존 메모');
});
for(const superseded of [false,true])test('prepared CSV remains atomic while a replacement is blocked; superseded='+superseded,async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());f.db.prepare("INSERT INTO listings(id,property_id,title,address,status) VALUES('one','one','검수매물','검수동 1','active')").run();
 let release,entered;const blocked=new Promise(r=>release=r),atPart=new Promise(r=>entered=r);const key='prepared.csv',old={customMetadata:{revision:'old'},value:'COMPLETE-OLD'};let current=old,revision='r1',aborted=0,completed=0;
 f.env.MEDIA={async head(k){return k===key?current:null;},async get(k){return k==='api-cache/revision/listings.json'?{text:async()=>JSON.stringify({revision})}:null;},async createMultipartUpload(k,metadata){const buffers=[];return{async uploadPart(n,b){buffers.push(Buffer.from(b));entered();await blocked;return{partNumber:n,etag:String(n)};},async complete(){current={...metadata,value:Buffer.concat(buffers).toString('utf8')};completed++;},async abort(){aborted++;}};}};
 const build=buildSheetSnapshot(f.env,key,'r1');await atPart;assert.equal(current,old);
 if(superseded)revision='r2';release();
 if(superseded){await assert.rejects(build,e=>e.code==='listing_snapshot_superseded');assert.equal(current,old);assert.equal(aborted,1);assert.equal(completed,0);}
 else{await build;assert.equal(completed,1);assert.equal(current.customMetadata.revision,'r1');assert.match(current.value,/검수매물/);assert.equal(aborted,0);}
});

test('large collection history has a byte budget and pruned baselines fail closed',async()=>{
 const h=harness();await h.write({changeIds:['BASE']});const base=(await h.read()).revision;
 for(let i=0;i<20;i++)await h.write({changeIds:Array.from({length:1024},(_,j)=>'MASTER-'+String(i).padStart(3,'0')+'-'+String(j).padStart(90,'0')),collectorRefreshV142:true});
 const saved=JSON.parse(h.store.get('listings').body);assert.ok(JSON.stringify(saved.history).length<=262144);assert.equal((await h.context.readDataRevision(h.env,'listings',base,142)).fullReload,true);
});
for(const sourceChange of [false,true])test('original-photo preparation ignores memo-only revisions and rejects newer source conditions: '+sourceChange,async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());f.db.prepare("INSERT INTO listings(id,property_id,title,address,status) VALUES('one','one','검수','검수동 1','active')").run();
 let release,entered;const blocked=new Promise(r=>release=r),atPart=new Promise(r=>entered=r);let state={revision:'r1',collectorRevisionV142:'e1'},current='ORIGINAL-COMPLETE',aborted=0;
 f.env.MEDIA={async head(){return null;},async get(){return {text:async()=>JSON.stringify(state)};},async createMultipartUpload(key,metadata){return{async uploadPart(n){entered();await blocked;return{partNumber:n,etag:String(n)};},async complete(){current=metadata;},async abort(){aborted++;}};}};
 const build=buildUnifiedSnapshot(f.env,'originals','r1',{}, {action:'unifiedListings',collectorRevisionV142:'e1'});await atPart;state={revision:'r2',collectorRevisionV142:sourceChange?'e2':'e1'};release();
 if(sourceChange){await assert.rejects(build,e=>e.code==='listing_snapshot_superseded');assert.equal(current,'ORIGINAL-COMPLETE');assert.equal(aborted,1);}
 else{await build;assert.equal(current.customMetadata.collectorRevisionV142,'e1');assert.equal(aborted,0);}
});

test('delta discovery failure preserves collection success and requests a full refresh',async()=>{
 const actual=await collectorRefreshIdsV142({DB:{prepare(){throw Error('transient metadata read');}}},'네이버','session');
 assert.deepEqual(actual,{version:142,propertyIds:[],fullReload:true});
});
