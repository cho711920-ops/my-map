import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {snapshotTransfer,SNAPSHOT_CHUNK_BYTES} from '../cloudflare/src/snapshot-transfer.js';

const source=await readFile(new URL('../js/data-access-v6.js',import.meta.url),'utf8');
function binding(bytes,etag='"fixed-2"') {
  const meta={size:bytes.length,httpEtag:etag,httpMetadata:{contentType:'text/csv',contentEncoding:'gzip'},
    customMetadata:{revision:'exact-revision',savedAt:String(Date.now())}};
  return {async head(){return meta;},async get(_key,{onlyIf,range}={}) {
    if(onlyIf.etagMatches!==etag.replaceAll('"',''))return {...meta,body:null};
    return {...meta,range,body:new Response(bytes.subarray(range.offset,range.offset+range.length)).body};
  }};
}
function runtime(fetch,cache) {
  const context={fetch,AbortController,Headers,Response,ReadableStream,TransformStream,DecompressionStream,
    TextDecoder,TextEncoder,URLSearchParams,setTimeout,clearTimeout,JSInitialListingsCacheV1:cache};
  context.window=context;
  vm.runInNewContext(source,context);return context.JSDataAccessV6;
}

test('manifest and conditional raw ranges round-trip bytes; wrong versions and oversized ranges cannot escape their snapshot',async()=>{
  const bytes=gzipSync('검수 CSV\r\n"같은 주소","다른 ID"'),env={MEDIA:binding(bytes)};
  const request=(mode,extra={})=>new Request('https://app.invalid/api/sheet',{headers:{'x-js-snapshot-mode':mode,...extra}});
  const manifest=await snapshotTransfer(env,'lease',10000,request('manifest-v125'));
  assert.equal((await manifest.response.json()).size,bytes.length);
  const read=extra=>snapshotTransfer(env,'lease',10000,request('chunk-v125',{'x-js-snapshot-etag':'"fixed-2"',
    'x-js-snapshot-offset':'0','x-js-snapshot-length':String(bytes.length),...extra}));
  const result=await read({});assert.equal(result.response.headers.get('content-encoding'),null);
  assert.deepEqual(Buffer.from(await result.response.arrayBuffer()),bytes);
  assert.equal((await read({'x-js-snapshot-etag':'"other"'})).response.status,409);
  assert.equal((await read({'x-js-snapshot-length':String(SNAPSHOT_CHUNK_BYTES+1)})).response.status,400);
  assert.equal((await snapshotTransfer(env,'lease',10000,request('manifest-v125'),'new-revision')),null);
});

test('initial CSV completes through bounded parallel ranges even when the former whole response would stall',async()=>{
  // Deterministic incompressible-ish rows cover multiple real 256KiB ranges.
  let state=19;const rows=['name,address,id'];
  for(let i=0;i<18000;i++){let text='';for(let j=0;j<70;j++){state=(Math.imul(state,1664525)+1013904223)>>>0;text+=String.fromCharCode(33+state%90);}rows.push(['검수'+i,'같은 주소',text].map(x=>'"'+x.replaceAll('"','""')+'"').join(','));}
  const raw=rows.join('\r\n'),bytes=gzipSync(raw),env={MEDIA:binding(bytes)};let whole=0,active=0,max=0,retried=0;
  const api=runtime(async(url,init)=>{
    const mode=init.headers['X-JS-Snapshot-Mode'];if(!mode){whole++;throw Error('whole stream stalled');}
    if(mode==='chunk-v125'){
      active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;
      if(init.headers['X-JS-Snapshot-Offset']==='0'&&!retried++){return new Response('{}',{status:503});}
    }
    return (await snapshotTransfer(env,'csv',10000,new Request('https://app.invalid'+url,init))).response;
  });
  const result=await api.listingsSnapshot(false);
  assert.equal(result.rows.length,rows.length);assert.equal(result.rows[1][2].length,70);
  assert.equal(result.revision,'exact-revision');assert.equal(whole,0);assert.ok(max<=3&&max>1);assert.equal(retried,2);
});

test('a changing ETag restarts once and never concatenates old ranges with the new representation',async()=>{
  let generation=0,manifests=0,oldReads=0;
  const content=['name,address,id\r\nold,old,A','name,address,id\r\nnew,new,B'];
  const bytes=content.map(v=>gzipSync(v));
  const api=runtime(async(url,init)=>{
    if(init.headers['X-JS-Snapshot-Mode']==='manifest-v125'){
      manifests++;return (await snapshotTransfer({MEDIA:binding(bytes[generation],'"version'+generation+'"')},'csv',10000,new Request('https://app.invalid'+url,init))).response;
    }
    if(!oldReads++){generation=1;return new Response('{}',{status:409});}
    return (await snapshotTransfer({MEDIA:binding(bytes[generation],'"version'+generation+'"')},'csv',10000,new Request('https://app.invalid'+url,init))).response;
  });
  const result=await api.listingsSnapshot(false);assert.equal(manifests,2);assert.equal(result.rows[1][2],'B');
});

test('same-revision startup uses the complete validated cache; changed revision and invalidation still require network',async()=>{
  let version='epoch-1',latest='r1',reads=[];
  const value={snapshotRevision:'r1',items:[{propertyId:'A'}],unified:{ok:true,groups:{A:[{originalId:'source-a'}]}}};
  const cache={version:()=>version,usable:()=>true,warm:async()=>value};
  const api=runtime(async(url)=>{reads.push(url);if(url.includes('dataRevision'))return Response.json({ok:true,revision:latest});
    if(url.includes('/api/sheet'))return new Response('name,address,id\r\nnew,new,A');return Response.json({ok:true,groups:{A:[]}});},cache);
  api.warmInitialData();const [sheet,unified]=await Promise.all([api.listingsSnapshot(false),api.read('unifiedListings')]);
  assert.equal(sheet.validatedCacheV125,value);assert.equal(unified.groups,value.unified.groups);assert.equal(reads.length,1);
  latest='r2';api.warmInitialData();const changed=await api.listingsSnapshot(false);await api.read('unifiedListings');
  assert.equal(changed.validatedCacheV125,undefined);assert.ok(reads.some(x=>x==='/api/sheet'));
});

test('an edit during revision validation cannot return the old confirmed snapshot',async()=>{
  let version='1';const value={snapshotRevision:'r1',unified:{ok:true,groups:{A:[]}}};
  const api=runtime(async(url)=>{if(url.includes('dataRevision')){version='2';return Response.json({ok:true,revision:'r1'});}
    if(url==='/api/sheet')return new Response('name,address,id\r\nnew,new,A');return Response.json({ok:true,groups:{A:[]}});},
    {version:()=>version,usable:()=>true,warm:async()=>value});
  api.warmInitialData();const result=await api.listingsSnapshot(false);await api.read('unifiedListings');assert.equal(result.validatedCacheV125,undefined);
});

test('bounded known changes and exact saved IDs validate through a point delta instead of either full file',async()=>{
  const value={baselineRevisionV125:'r1',confirmedIdsV125:['B'],unified:{ok:true,groups:{A:[],B:[]}}};let whole=0;
  const api=runtime(async url=>{if(url.includes('dataRevision'))return Response.json({ok:true,revision:'r2',fullReload:false,changeIds:['A']});whole++;throw Error('unexpected whole file');},
    {version:()=> 'same',usable:()=>true,warm:async()=>value});
  api.warmInitialData();const [sheet,originals]=await Promise.all([api.listingsSnapshot(false),api.read('unifiedListings')]);
  assert.deepEqual(Array.from(sheet.deltaV125.changeIds),['B','A']);assert.equal(sheet.deltaV125.revision,'r2');assert.equal(originals.groups,value.unified.groups);assert.equal(whole,0);
});
