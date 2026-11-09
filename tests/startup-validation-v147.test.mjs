import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../js/data-access-v6.js',import.meta.url),'utf8');
function boot({delay=0,revisions=[200],changeVersion=false,delta=false}={}) {
  const calls=[];let version='v1',at=0;
  const cache={snapshotRevision:'r1',unified:{ok:true,groups:{A:[{originalId:'ad-A',photoPathsV119:'all-photo-addresses'}]}}};
  const context={AbortController,Headers,Response,URLSearchParams,setTimeout,clearTimeout,
    JSListingTradeV1:{getMode:()=> 'lease'},JSInitialListingsCacheV1:{version:()=>version,usable:()=>true,
      warm:()=>new Promise(resolve=>setTimeout(()=>resolve(cache),delay))},
    fetch:async url=> {
      calls.push(url);
      if(url.includes('action=dataRevision')) {
        const status=revisions[Math.min(at++,revisions.length-1)];
        if(changeVersion)version='v2';
        if(status===0)throw new TypeError('temporary connection loss');
        return Response.json(status===200?{ok:true,revision:delta?'r2':'r1',changeIds:delta?['A']:[],fullReload:false}:{ok:false},{status});
      }
      return url==='/api/sheet'?new Response('id,address\nA,same-address'):Response.json({ok:true,groups:{}});
    }};
  context.window=context;vm.runInNewContext(source,context);
  return {calls,cache,context,async run(){const api=context.JSDataAccessV6;api.warmInitialData();return Promise.all([api.listingsSnapshot(false),api.read('unifiedListings')]);}};
}
test('a healthy 1.4s local read does not start a full download before revision validation',async()=>{
  const b=boot({delay:1400}),[sheet,originals]=await b.run();
  assert.equal(sheet.validatedCacheV125,b.cache);
  assert.equal(originals.groups.A[0].photoPathsV119,'all-photo-addresses');
  assert.equal(b.calls.length,1);assert.match(b.calls[0],/action=dataRevision/);
});
for(const status of [503,0]) test('one transient tiny check '+status+' recovers without downloading either full file',async()=>{
  const b=boot({revisions:[status,200]}),[sheet]=await b.run();
  assert.equal(sheet.validatedCacheV125,b.cache);assert.equal(b.calls.length,2);
  assert.ok(b.calls.every(url=>url.includes('action=dataRevision')));
});
test('an exact-ID delta survives the transient validation retry',async()=>{
  const b=boot({revisions:[503,200],delta:true}),[sheet]=await b.run();
  assert.equal(sheet.deltaV125.revision,'r2');assert.deepEqual(Array.from(sheet.deltaV125.changeIds),['A']);
  assert.equal(sheet.validatedCacheV125.snapshotRevision,'r1');
});
for(const status of [401,403,200]) test('auth failure or a changed edit fence cannot retry/reuse an old cache: '+status,async()=>{
  const b=boot({revisions:[status,200],changeVersion:status===200}),[sheet]=await b.run();
  assert.equal(sheet.validatedCacheV125,undefined);
  assert.equal(b.calls.filter(url=>url.includes('action=dataRevision')).length,1);
  assert.ok(b.calls.includes('/api/sheet'));
});
test('persistent failures remain bounded and never certify the cached revision',async()=>{
  const b=boot({revisions:[503,503]}),[sheet]=await b.run();
  assert.equal(sheet.validatedCacheV125,undefined);
  assert.equal(b.calls.filter(url=>url.includes('action=dataRevision')).length,2);
  assert.equal(b.calls.filter(url=>url==='/api/sheet').length,1);
});

test('a queued IndexedDB GET has a deadline and ignores a late success after abort',async()=>{
  const cacheSource=await readFile(new URL('../js/initial-listings-cache-v1.js',import.meta.url),'utf8');
  const timers=new Map();let sequence=0,aborted=0,closed=0,request;
  const tx={objectStore:()=>({get:()=>{request={};return request;}}),abort:()=>{aborted++;tx.onabort?.();}};
  const db={objectStoreNames:{contains:()=>true},transaction:()=>tx,close:()=>{closed++;}};
  const context={localStorage:{getItem:()=>null},setTimeout:(f,ms)=>{const key=++sequence;timers.set(key,{f,ms});return key;},
    clearTimeout:key=>timers.delete(key),indexedDB:{open:()=>{const open={};queueMicrotask(()=>{open.result=db;open.onsuccess();});return open;}}};
  context.window=context;vm.runInNewContext(cacheSource,context);
  let settled=false;const reading=context.JSInitialListingsCacheV1.read().then(value=>{settled=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);
  assert.equal(timers.size,1);const deadline=[...timers.values()][0];assert.equal(deadline.ms,2500);deadline.f();
  assert.equal(await reading,null);assert.equal(aborted,1);assert.ok(closed>=1);
  request.result={items:[{propertyId:'A'}]};request.onsuccess();
  assert.equal(await reading,null);assert.equal(timers.size,0);
});
