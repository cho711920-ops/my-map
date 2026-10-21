import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL('../cloudflare/src/worker.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf('async function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2);}

test('badge-only maintenance retains complete large caches and publishes exact delta IDs; review changes still invalidate',async()=>{
  for(const merged of [0,1]){
    const deleted=[],revisions=[];
    const c=vm.createContext({Promise,sheetCache:{body:''},D1_SHEET_CACHE_KEY:'csv',UNIFIED_LISTINGS_CACHE_KEY:'originals',
      OPERATIONS_DASHBOARD_CACHE_KEY:'operations',GEOCODE_CACHE_KEY:'geocode',
      runCollectorMaintenance:async()=>({}),runScheduledReviewRepair:async()=>({merged,affectedListingIds:['A']}),
      runScheduledElevatorEnrichment:async()=>({changed:1,changedIds:['B']}),adjustOperationsDashboard:async()=>{},
      unifiedDetailCacheKey:id=>'detail/'+id,deleteR2Cache:async(_e,_c,keys)=>{deleted.push(...keys);},
      touchDataRevision:async(...args)=>{revisions.push(args.at(-1));}});
    vm.runInContext(fn('runScheduledMaintenance'),c);await c.runScheduledMaintenance({},{});
    if(merged)assert.ok(deleted.includes('csv')&&deleted.includes('originals'));
    else {assert.deepEqual(deleted,[]);assert.deepEqual(Array.from(revisions[0].changeIds),['B']);assert.equal(Boolean(revisions[0].fullReload),false);}
  }
});

test('scheduled warming builds missing full caches sequentially, and never repeats a fresh complete cache',async()=>{
  for(const present of [[true,true],[false,true],[false,false]]){
    const calls=[],c=vm.createContext({Promise,D1_SHEET_CACHE_KEY:'csv',UNIFIED_LISTINGS_CACHE_KEY:'originals',
      readDataRevision:async()=>({revision:'r'}),buildSheetSnapshot:async()=>{calls.push('csv');},
      buildUnifiedSnapshot:async()=>{calls.push('originals');},cacheAgeMs:object=>Date.now()-Number(object.customMetadata.savedAt)});
    vm.runInContext(fn('warmMissingListingSnapshots'),c);
    await c.warmMissingListingSnapshots({DB:{},MEDIA:{head:async key=>present[key==='csv'?0:1]?{customMetadata:{savedAt:String(Date.now())}}:null,createMultipartUpload(){}}});
    assert.deepEqual(calls,present[0]?[]:present[1]?['csv']:['csv','originals']);
  }
});

test('existing snapshots are rebuilt shortly before their serving TTL, not left to expire for the next device',async()=>{
  for(const ages of [[10_000,10_000],[3_490_000,10_000],[10_000,3_490_000],[3_700_000,3_700_000]]){
    const calls=[],c=vm.createContext({Promise,D1_SHEET_CACHE_KEY:'csv',UNIFIED_LISTINGS_CACHE_KEY:'originals',
      cacheAgeMs:object=>object.age,readDataRevision:async()=>({revision:'r'}),
      buildSheetSnapshot:async()=>{calls.push('csv');},buildUnifiedSnapshot:async()=>{calls.push('originals');}});
    vm.runInContext(fn('warmMissingListingSnapshots'),c);
    await c.warmMissingListingSnapshots({DB:{},MEDIA:{head:async key=>({age:ages[key==='csv'?0:1]}),createMultipartUpload(){}}});
    assert.deepEqual(calls,['csv','originals'].filter((_key,i)=>ages[i]>=3_480_000));
  }
});
