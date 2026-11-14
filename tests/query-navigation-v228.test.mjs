import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync,gzipSync} from 'node:zlib';
import {preparedNavigationV228} from '../cloudflare/src/query-navigation-v228.js';
import {queryBridgeV152} from '../cloudflare/src/query-bridge-v152.js';

function fixture(){
  const packet={ok:true,version:152,grouping:'client-v152',completeQuery:true,revision:'r1',total:200,
    fields:['propertyId','sourceSnapshotKey','thumbnailV8'],rows:Array.from({length:200},(_,i)=>['ID-'+i,'sha256-v1:'+String(i).padStart(64,'0'),'https://fixture.invalid/'+i+'.jpg']),numericCatalogV177:{secret:'not part of navigation'}};
  let etag='source-1',reads=0;const values=new Map();
  const bucket={async head(){return{etag,customMetadata:{revision:'r1'}};},async get(key){reads++;
    if(values.has(key)){const value=values.get(key);return{etag:'derived',customMetadata:value.metadata,body:new Response(value.body).body};}
    if(key==='query')return{etag,customMetadata:{revision:'r1'},body:new Response(JSON.stringify(packet)).body};
    return null;},async put(key,body,options){values.set(key,{body,metadata:options.customMetadata});}};
  return{packet,bucket,values,reads:()=>reads,setEtag:value=>{etag=value;},invoke:()=>preparedNavigationV228({env:{MEDIA:bucket},key:'query',revision:'r1',headers:{'content-type':'application/json'},loadFull:()=>{throw Error('No master rebuild');}})};
}
test('v228 stored gzip retains every row, order, proof and thumbnail; warm completed bytes bypass body I/O only under the current source ETag',async()=>{
  const h=fixture(),first=await h.invoke();assert.equal(first.headers.get('content-encoding'),'gzip');
  const unpack=async response=>JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
  const value=await unpack(first);assert.equal(value.numericCatalogV177,undefined);assert.equal(value.numericCatalogDeferredV217,true);
  assert.deepEqual(value.rows,h.packet.rows);assert.deepEqual(value.fields,h.packet.fields);assert.equal(value.total,200);assert.equal(value.completeQuery,true);
  const before=h.reads();assert.deepEqual(await unpack(await h.invoke()),value);assert.equal(h.reads(),before);
  h.setEtag('source-2');assert.deepEqual(await unpack(await h.invoke()),value);assert.ok(h.reads()>before);
  assert.equal(h.values.get('query.navigation-v228.gz').metadata.sourceEtag,'source-2');
});
test('v228 a prepared compressed object from a different revision or source cannot be published or borrowed from another bucket',async()=>{
  const a=fixture(),b=fixture();await(await a.invoke()).body.cancel();
  b.values.set('query.navigation-v228.gz',{body:gzipSync('{"ok":true,"wrong":true}'),metadata:{revision:'old',sourceEtag:'source-1'}});
  const response=await b.invoke(),packet=JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
  assert.deepEqual(packet.rows,b.packet.rows);assert.ok(b.reads()>0);assert.equal(packet.wrong,undefined);
});
test('v228 compressed navigation and its public bridge preserve encoded bytes exactly, retain both revision checks and never publicly cache private data',async()=>{
  const bytes=gzipSync('{"ok":true,"completeQuery":true,"rows":[["한글"]]}'),seen=[];let reads=0;
  const env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){seen.push(await request.json());return new Response(bytes,{headers:{'content-type':'application/json','content-encoding':'gzip','x-js-query-revision-v152':'r1','x-js-query-schema':'readonly-v152'}});}}};
  const response=await queryBridgeV152(env,{spec:'{"mode":"building_sale"}',navigation:'228'},async()=>{reads++;return{revision:'r1'};},new Request('https://fixture.invalid/',{headers:{'accept-encoding':'gzip'}}));
  assert.equal(seen[0].navigationOnlyV217,true);assert.equal(seen[0].compressedNavigationV228,true);assert.equal(reads,2);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('v228 source replacement during compression fails closed instead of publishing a mixed derivative',async()=>{
  const h=fixture(),head=h.bucket.head;let count=0;
  h.bucket.head=async()=>{count++;if(count>=4)h.setEtag('replaced');return head();};
  await assert.rejects(h.invoke(),/변경/);assert.equal(h.values.has('query.navigation-v228.gz'),false);
});
