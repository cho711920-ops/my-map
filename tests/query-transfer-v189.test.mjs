import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {preparedQueryTransferV189,queryTransferKeyV189} from '../cloudflare/src/query-transfer-v189.js';
import {queryWireV151,privateListingQueryV151} from '../cloudflare/src/query-worker-v151.js';
import {queryBridgeV152} from '../cloudflare/src/query-bridge-v152.js';
const source=await readFile('js/data-access-v6.js','utf8');
function media(){
  const objects=new Map(),puts=[];
  const head=v=>({etag:v.etag,httpEtag:'"'+v.etag+'"',size:v.bytes.length,customMetadata:v.customMetadata,httpMetadata:v.httpMetadata});
  return {objects,puts,async head(k){return objects.has(k)?head(objects.get(k)):null;},async get(k,options={}){
    const v=objects.get(k);if(!v)return null;
    if(options.onlyIf&&options.onlyIf.etagMatches!==v.etag)return head(v);
    const bytes=options.range?v.bytes.subarray(options.range.offset,options.range.offset+options.range.length):v.bytes;
    return {...head(v),...(options.range?{range:options.range}:{}),body:new Blob([bytes]).stream()};
  },async put(k,bytes,options){assert.equal(typeof bytes?.getReader,'undefined','R2 put requires a known byte length');const content=new Uint8Array(await new Response(bytes).arrayBuffer());objects.set(k,{bytes:content,etag:createHash('md5').update(content).digest('hex'),...options});puts.push(k);},
  async createMultipartUpload(k,options){const bucket=this,parts=[];return {async uploadPart(partNumber,bytes){assert.ok(ArrayBuffer.isView(bytes),'R2 multipart parts require known byte lengths');parts.push(bytes.slice());return {partNumber,etag:'part-'+partNumber};},async complete(receipts){assert.equal(receipts.length,parts.length);for(const part of parts.slice(0,-1))assert.equal(part.length,5*1024*1024,'non-final R2 parts meet the minimum size');const bytes=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}await bucket.put(k,bytes,options);},async abort(){parts.length=0;}};}};
}
async function seeded(mode,packet,small=false){if(!small&&!Object.hasOwn(packet,'padding'))packet.padding='x'.repeat(4*1024*1024+1);const m=media(),key=queryTransferKeyV189(mode);await m.put(key,JSON.stringify(packet),{customMetadata:{revision:packet.revision},httpMetadata:{contentType:'application/json'}});m.puts.length=0;return {m,key};}
function client(fetch){const w={fetch,AbortController,Headers,Response,ReadableStream,TransformStream,DecompressionStream,TextDecoder,setTimeout,clearTimeout};vm.runInNewContext(source,{window:w,URLSearchParams,Date});return w.JSDataAccessV6;}
const request=(mode,headers={})=>new Request('https://example.invalid/',{headers:{'x-js-snapshot-mode':mode,...headers}});
for(const mode of ['building_sale','land_sale'])test(mode+' compressed range transfer completes while a whole-response path is unavailable',async()=>{
  const packet=queryWireV151([{propertyId:'ONE',sourceSnapshotKey:'sha256-v1:'+'a'.repeat(64)}],'rev');
  // Random data ensures several actual 1MiB compressed ranges, not gzip zeros.
  let seed=13;const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  packet.padding=Array.from({length:(mode==='building_sale'?8:4)*1024*1024},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return alphabet[seed%alphabet.length];}).join('');
  const {m}=await seeded(mode,packet);let active=0,max=0,whole=0,manifests=0;
  const api=client(async(url,init)=>{
    const req=new Request('https://example.invalid'+url,init),kind=req.headers.get('x-js-snapshot-mode');
    assert.equal(req.headers.get('x-js-query-client'),'ranges-v189');
    if(!kind){whole++;throw Error('old whole response stalled');}
    if(kind==='manifest-v128')manifests++;else{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));}
    try{return await preparedQueryTransferV189({MEDIA:m},{mode},'rev',req,()=>{throw Error('current cache needs no rebuild');});}
    finally{if(kind!=='manifest-v128')active--;}
  });
  const result=await api.read('listingQuery',{spec:JSON.stringify({mode})});
  assert.equal(result.ok,true);assert.equal(result.padding,packet.padding);assert.equal(result.rows[0][0],'ONE');assert.equal(whole,0);assert.equal(manifests,1);assert.ok(max>1&&max<=3);assert.equal(m.puts.length,1);
});
test('only a current completed original can produce a manifest, and unchanged bytes are reused without writes',async()=>{
  const packet=queryWireV151([],'r'),{m,key}=await seeded('building_sale',packet),req=request('manifest-v128');
  const first=await preparedQueryTransferV189({MEDIA:m},{mode:'building_sale'},'r',req,()=>assert.fail('unexpected rebuild'));
  const manifest=await first.json();assert.equal(manifest.revision,'r');assert.equal(manifest.encoding,'gzip');assert.equal(manifest.chunkBytes,1024*1024);
  await preparedQueryTransferV189({MEDIA:m},{mode:'building_sale'},'r',req,()=>assert.fail('unexpected rebuild'));assert.equal(m.puts.length,1);
  m.objects.get(key).customMetadata.revision='old';let built=0;
  await assert.rejects(()=>preparedQueryTransferV189({MEDIA:m},{mode:'building_sale'},'r',req,async()=>{built++;return new Response('{}');}),e=>e.statusCode===503);assert.equal(built,1);
});
test('replaced etags, wrong byte ranges and incomplete representations are rejected',async()=>{
  const {m}=await seeded('land_sale',queryWireV151([],'r'));const env={MEDIA:m},spec={mode:'land_sale'};
  const meta=await (await preparedQueryTransferV189(env,spec,'r',request('manifest-v128'),assert.fail)).json();
  await assert.rejects(()=>preparedQueryTransferV189(env,spec,'r',request('chunk-v128',{'x-js-snapshot-etag':'"other"','x-js-snapshot-offset':'0','x-js-snapshot-length':'1'}),assert.fail),e=>e.statusCode===409);
  const invalid=await preparedQueryTransferV189(env,spec,'r',request('chunk-v128',{'x-js-snapshot-etag':meta.etag,'x-js-snapshot-offset':'0','x-js-snapshot-length':String(1024*1024+1)}),assert.fail);assert.equal(invalid.status,400);
});
test('bridge forwards only range proof headers, never a public warmup header',async()=>{
  let seen;const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{fetch:async r=>{seen=r.headers;return new Response('{}',{headers:{'x-js-query-revision-v152':'r','x-js-query-schema':'readonly-v152'}});}}};
  await queryBridgeV152(env,{spec:'{"mode":"land_sale"}'},async()=>({revision:'r'}),request('manifest-v128',{'x-js-query-warm-v152':'1'}));
  assert.equal(seen.get('x-js-snapshot-mode'),'manifest-v128');assert.equal(seen.get('x-js-query-warm-v152'),null);
});
test('HTTP 200 with an application error is rejected with its body and true response status, never as rows',async()=>{
  const api=client(async()=>Response.json({ok:false,message:'fixture rejected'}));
  await assert.rejects(()=>api.read('listingQuery',{spec:'{"mode":"land_sale"}'}),e=>e.name==='DataResponseError'&&e.responseStatus===200&&e.status===undefined&&e.retryable&&e.message==='fixture rejected');
});
test('the private query route negotiates a current land view without SQL or a full query build',async()=>{
  const {m}=await seeded('land_sale',queryWireV151([],'r'));
  await m.put('api-cache/revision/listings.json',JSON.stringify({revision:'r'}),{});
  const response=await privateListingQueryV151(new Request('https://listing-query.internal/',{method:'POST',headers:{'x-js-snapshot-mode':'manifest-v128'},body:JSON.stringify({revision:'r',spec:{mode:'land_sale'}})}),{MEDIA:m,DB:{prepare(){assert.fail('no SQL for a current prepared view');}}},{});
  assert.equal(response.status,200);assert.equal(response.headers.get('x-js-query-revision-v152'),'r');assert.equal((await response.json()).encoding,'gzip');
});
test('a source replacement during compression cannot publish a manifest as the current revision',async()=>{
  const {m,key}=await seeded('building_sale',queryWireV151([],'r'));const put=m.put;
  m.put=async function(k,bytes,options){await put.call(m,k,bytes,options);m.objects.get(key).customMetadata.revision='changed';};
  await assert.rejects(()=>preparedQueryTransferV189({MEDIA:m},{mode:'building_sale'},'r',request('manifest-v128'),assert.fail),e=>e.statusCode===409);
});
test('truncated range bodies never publish partial JSON even when all response headers look successful',async()=>{
  const {m}=await seeded('land_sale',queryWireV151([],'r'));let delivered=0;
  const api=client(async(url,init)=>{
    const req=new Request('https://example.invalid'+url,init),response=await preparedQueryTransferV189({MEDIA:m},{mode:'land_sale'},'r',req,assert.fail);
    if(req.headers.get('x-js-snapshot-mode')==='chunk-v128'){delivered++;const bytes=new Uint8Array(await response.arrayBuffer());return new Response(bytes.subarray(0,bytes.length-1),{headers:response.headers});}
    return response;
  });
  await assert.rejects(()=>api.read('listingQuery',{spec:'{"mode":"land_sale"}'}),e=>e.status===502);assert.equal(delivered,2);
});

test('small complete sale views keep the ordinary single response without compression or an extra range trip',async()=>{for(const mode of ['building_sale','land_sale']){const packet=queryWireV151([],'r'),{m}=await seeded(mode,packet,true);const response=await preparedQueryTransferV189({MEDIA:m},{mode},'r',request('manifest-v128'),()=>assert.fail('no rebuild'));assert.equal(response,null);assert.deepEqual(m.puts,[]);}});
