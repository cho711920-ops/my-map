import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {catalogPacketV232,preparedCatalogV232,compressedCatalogV232} from '../cloudflare/src/query-catalog-v232.js';
import {queryBridgeV152} from '../cloudflare/src/query-bridge-v152.js';
import {privateListingQueryV151} from '../cloudflare/src/query-worker-v151.js';

for(const mode of ['lease','building_sale','land_sale'])test('v232 warm current complete view never rebuilds all masters merely to prepare unused filtered inputs '+mode,async()=>{
 const reads=[],heads=[],key='api-cache/query-view-'+(mode==='building_sale'?'v184-':'v215-')+mode+'.json';
 const env={DB:{prepare(){throw Error('No operational SQL');}},MEDIA:{async get(path){reads.push(path);if(path==='api-cache/revision/listings.json')return{body:new Response('{"revision":"current-v232"}').body};throw Error('No master or source read');},async head(path){heads.push(path);return path===key?{customMetadata:{revision:'current-v232'}}:null;}}};
 const response=await privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',headers:{'x-js-query-warm-v152':'1'},body:JSON.stringify({revision:'current-v232',spec:{mode}})}),env,{});
 assert.equal(response.status,204);assert.deepEqual(heads,[key]);assert.deepEqual(reads,['api-cache/revision/listings.json']);
});

test('v232 warm stale complete view is not silently accepted as current',async()=>{
 const env={DB:{},MEDIA:{async get(path){if(path==='api-cache/revision/listings.json')return{body:new Response('{"revision":"new-v232"}').body};throw Error('Needs current rebuild');},async head(){return{customMetadata:{revision:'old-v232'}};}}};
 await assert.rejects(privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',headers:{'x-js-query-warm-v152':'1'},body:JSON.stringify({revision:'new-v232',spec:{mode:'building_sale'}})}),env,{}),/Needs current rebuild/);
});
function fixture(){
 const fields=['propertyId','sourceSnapshotKey','queryMatchedOriginalCountV152','querySelectedOriginalIdV152','address','thumbnailV8','saleDetails'];
 const packet={ok:true,version:152,grouping:'client-v152',completeQuery:true,revision:'r',fields,total:2,rows:[['A','sha256-v1:'+'1'.repeat(64),2,'A1','주소'.repeat(500),'photo-a',{monthlyIncome:100}],['B','sha256-v1:'+'2'.repeat(64),1,'B1','B','photo-b',null]],numericCatalogV177:{version:177,format:'row-deltas-v177',complete:true,revision:'r',marketV215:'building_sale',groups:[['A',[[[3,'A1']],[[3,'A2'],[6,{monthlyIncome:200}]]]]]}};
 let etag='one';const objects=new Map();let fullReads=0;
 const bucket={async head(){return{etag,customMetadata:{revision:'r'}};},async get(key){if(key==='q'){fullReads++;return{etag,customMetadata:{revision:'r'},body:new Response(JSON.stringify(packet)).body};}const v=objects.get(key);return v?{customMetadata:v.options.customMetadata,body:new Response(v.bytes).body}:null;},async put(key,bytes,options){objects.set(key,{bytes,options});}};
 return {packet,bucket,objects,setEtag:value=>{etag=value;},reads:()=>fullReads,invoke:()=>preparedCatalogV232({env:{MEDIA:bucket},key:'q',revision:'r',headers:{'content-type':'application/json'},loadFull:()=>{throw Error('No master rebuild');}})};
}
test('v232 catalog references every navigation identity while retaining every advertisement delta exactly',async()=>{
 const h=fixture(),result=await catalogPacketV232(new Response(JSON.stringify(h.packet)).body,'r');
 assert.equal(result.version,232);assert.deepEqual(result.fields,h.packet.fields);assert.deepEqual(result.basis,h.packet.rows.map(row=>row.slice(0,4)));assert.deepEqual(result.numericCatalogV177,h.packet.numericCatalogV177);assert.equal(result.total,2);assert.ok(JSON.stringify(result).length<JSON.stringify(h.packet).length/2);
});
test('v232 compressed catalog is private derived data and source replacement rebuilds instead of borrowing old bytes',async()=>{
 const h=fixture(),unpack=async response=>JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
 const a=await h.invoke();assert.equal(a.headers.get('content-encoding'),'gzip');const packet=await unpack(a);assert.equal(h.reads(),1);
 assert.deepEqual(await unpack(await h.invoke()),packet);assert.equal(h.reads(),1);h.setEtag('two');assert.deepEqual(await unpack(await h.invoke()),packet);assert.equal(h.reads(),2);assert.equal(h.objects.get('q.catalog-v232.gz').options.customMetadata.sourceEtag,'two');
});
for(const change of ['revision','duplicate','catalog','count'])test('v232 catalog rejects a changed or incomplete '+change,async()=>{
 const h=fixture();if(change==='revision')h.packet.revision='old';if(change==='duplicate')h.packet.rows[1][0]='A';if(change==='catalog')h.packet.numericCatalogV177.complete=false;if(change==='count')h.packet.total=3;
 await assert.rejects(catalogPacketV232(new Response(JSON.stringify(h.packet)).body,'r'));
});
test('v232 source replacement during derivation publishes no mixed catalog',async()=>{
 const h=fixture(),head=h.bucket.head;let n=0;h.bucket.head=async()=>{if(++n===3)h.setEtag('replaced');return head();};await assert.rejects(h.invoke());assert.equal(h.objects.size,0);
});
test('v232 catalog bridge retains authentication revision checks and encoded private bytes',async()=>{
 let body,reads=0;const bytes=new Uint8Array([1,2,3]),env={JS_QUERY_ENABLED:'1',LISTING_QUERY:{async fetch(request){body=await request.json();return new Response(bytes,{headers:{'content-type':'application/json','content-encoding':'gzip','x-js-query-revision-v152':'r','x-js-query-schema':'readonly-v152'}});}}};
 const response=await queryBridgeV152(env,{spec:'{"mode":"building_sale"}',catalog:'232'},async()=>{reads++;return{revision:'r'};},new Request('https://fixture.invalid/'));
 assert.equal(body.catalogOnlyV232,true);assert.equal(reads,2);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
});


for(const width of [1,7,1024])test('v232 streaming compressor preserves the whole catalog across UTF-8 and JSON chunk boundaries '+width,async()=>{
 const h=fixture(),bytes=new TextEncoder().encode(JSON.stringify(h.packet));let at=0;
 const stream=new ReadableStream({pull(controller){if(at===bytes.length)return controller.close();controller.enqueue(bytes.slice(at,at+width));at=Math.min(bytes.length,at+width);}});
 const result=JSON.parse(gunzipSync(await compressedCatalogV232(stream,'r'))),expected=await catalogPacketV232(new Response(JSON.stringify(h.packet)).body,'r');assert.deepEqual(result,expected);
});
test('v232 streaming compressor rejects a partial catalog instead of publishing short output',async()=>{
 const h=fixture();await assert.rejects(compressedCatalogV232(new Response(JSON.stringify(h.packet).slice(0,-9)).body,'r'));
 h.packet.numericCatalogV177.complete=false;await assert.rejects(compressedCatalogV232(new Response(JSON.stringify(h.packet)).body,'r'));
});
