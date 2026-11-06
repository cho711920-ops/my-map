import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {snapshotTransfer,SNAPSHOT_CHUNK_BYTES,SNAPSHOT_CHUNK_BYTES_V128} from '../cloudflare/src/snapshot-transfer.js';

const source=await readFile(new URL('../js/data-access-v6.js',import.meta.url),'utf8');
function binding(bytes,type) {
 const meta={size:bytes.length,httpEtag:'"same-version"',httpMetadata:{contentType:type},customMetadata:{revision:'r1',savedAt:String(Date.now())}};
 return {async head(){return meta;},async get(_key,{range}){return {...meta,range,body:new Response(bytes.subarray(range.offset,range.offset+range.length)).body};}};
}
test('v128 negotiates 1 MiB reads while existing v125 clients keep their 256 KiB contract',async()=>{
 const bytes=new Uint8Array(2*1024*1024),env={MEDIA:binding(bytes,'text/csv')};
 for(const [version,size]of[['v125',SNAPSHOT_CHUNK_BYTES],['v128',SNAPSHOT_CHUNK_BYTES_V128]]){
  const r=mode=>new Request('https://fixture.invalid/api/sheet',{headers:{'x-js-snapshot-mode':mode,'x-js-snapshot-etag':'"same-version"','x-js-snapshot-offset':'0','x-js-snapshot-length':String(size)}});
  assert.equal((await (await snapshotTransfer(env,'k',10000,r('manifest-'+version))).response.json()).chunkBytes,size);
  const read=await snapshotTransfer(env,'k',10000,r('chunk-'+version));assert.equal((await read.response.arrayBuffer()).byteLength,size);
  const oversized=new Request(r('chunk-'+version),{headers:{...Object.fromEntries(r('chunk-'+version).headers),'x-js-snapshot-length':String(size+1)}});
  assert.equal((await snapshotTransfer(env,'k',10000,oversized)).response.status,400);
 }
});

test('a cold master list finishes before held originals and both exact files use fewer round trips with at most four active reads',async()=>{
 const text='name,address,id\r\n"'+('x'.repeat(2*1024*1024+200))+'","같은 주소","A"';
 const csv=new TextEncoder().encode(text),json=new TextEncoder().encode(JSON.stringify({ok:true,groups:{A:[]},padding:'y'.repeat(7*1024*1024)}));
 const files={sheet:binding(csv,'text/csv'),originals:binding(json,'application/json')};
 const held=[];let releaseOriginals=false,active=0,max=0,originalDone=false;const calls={sheet:0,originals:0};
 const fetch=async(url,init)=>{
  const kind=url==='/api/sheet'?'sheet':'originals',mode=init.headers['X-JS-Snapshot-Mode'];
  const response=(await snapshotTransfer({MEDIA:files[kind]},kind,10000,new Request('https://fixture.invalid'+url,init))).response;
  if(mode==='chunk-v128'){
   calls[kind]++;active++;max=Math.max(max,active);
   if(kind==='originals'&&!releaseOriginals)await new Promise(resolve=>held.push(resolve));
   active--;
  }
  return response;
 };
 const context={fetch,AbortController,Headers,Response,ReadableStream,TransformStream,DecompressionStream,TextDecoder,TextEncoder,URLSearchParams,setTimeout,clearTimeout};context.window=context;
 vm.runInNewContext(source,context);const api=context.JSDataAccessV6;
 const originals=api.read('unifiedListings').then(v=>{originalDone=true;return v;});
 while(held.length<3)await new Promise(r=>setTimeout(r,1));
 const sheet=await api.listingsSnapshot(false);
 assert.equal(sheet.rows[1][0].length,2*1024*1024+200);assert.equal(sheet.rows[1][2],'A');assert.equal(originalDone,false);
 assert.equal(calls.sheet,3);assert.equal(calls.originals,3);assert.ok(max<=4);
 releaseOriginals=true;held.splice(0).forEach(resolve=>resolve());
 assert.equal((await originals).padding.length,7*1024*1024);assert.equal(calls.originals,8);assert.equal(max,4);
});
