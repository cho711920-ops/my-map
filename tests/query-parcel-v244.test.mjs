import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {privateListingQueryV151,queryWireV151,querySpecV151,filterParcelNavigationV244}=await import('../cloudflare/src/query-worker-v151.js');
const proof='sha256-v1:'+'d'.repeat(64);
function fixture(mode,revision){
 const rows=['서구 괴정동 290-36','중구 선화동 290-36','서구 괴정동 1290-36','서구 괴정동 290-360','서구 괴정동 1-2'].map((address,index)=>({
  propertyId:'P-'+index,key:'P-'+index,name:index===4?'290-36 참고':'검수',address,room:'1층',state:'active',source:'네이버',sourceTypesV8:['네이버'],
  tradeType:mode==='lease'?'lease':'sale',saleCategory:mode==='land_sale'?'land':'building',salePrice:10000,deposit:1000,rent:50+index,area:30,
  sourceSnapshotKey:proof,registrationAt:'2026-11-16',sheetRow:index+2,queryMatchedOriginalCountV152:1,querySelectedOriginalIdV152:'AD-'+index,
  querySelectedPhotoCountV157:1,thumbnailV8:'https://photos.invalid/exact-'+index+'.jpg'}));
 return {...queryWireV151(rows,revision),numericCatalogDeferredV217:true};
}
for(const mode of ['lease','building_sale','land_sale'])test('v244 complete navigation searches only exact parcels and keeps identity/photos/sort '+mode,()=>{
 const packet=fixture(mode,'parcel-projection-'+mode),at=packet.fields.indexOf('propertyId');
 const spec=querySpecV151({mode,filters:{keyword:'290-36',sortFilter:'rentHigh'}}),result=filterParcelNavigationV244(packet,spec);
 assert.deepEqual(result.rows.map(row=>row[at]),['P-1','P-0']);
 for(const row of result.rows){const source=packet.rows.find(value=>value[at]===row[at]);for(const field of ['sourceSnapshotKey','querySelectedOriginalIdV152','thumbnailV8'])assert.equal(row[packet.fields.indexOf(field)],source[packet.fields.indexOf(field)]);}
 const empty=filterParcelNavigationV244(packet,querySpecV151({mode,filters:{keyword:'999-999'}}));assert.equal(empty.total,0);
 assert.equal(filterParcelNavigationV244(packet,querySpecV151({mode,filters:{keyword:'식당'}})),null);
 assert.equal(filterParcelNavigationV244(packet,querySpecV151({mode,filters:{keyword:'290-36',minRent:'10'}})),null);
 assert.equal(filterParcelNavigationV244(packet,querySpecV151({mode,hideDone:false,filters:{keyword:'290-36'}})),null);
 assert.throws(()=>filterParcelNavigationV244({...packet,perPropertyOverridesV152:true},spec),/최신/);
 assert.throws(()=>filterParcelNavigationV244({...packet,total:packet.total-1},spec),/목록 형식/);
});
for(const mode of ['lease','building_sale','land_sale'])test('v244 first server parcel query uses verified navigation without reading full originals/catalog '+mode,async()=>{
 const revision='parcel-server-'+mode,packet=fixture(mode,revision),key='api-cache/query-view-'+(mode==='building_sale'?'v184-':'v215-')+mode+'.json',reads=[];
 const env={DB:{prepare(){throw Error('No writable source scan');}},MEDIA:{
  async head(path){assert.equal(path,key);return{etag:'basis',customMetadata:{revision}};},
  async get(path){reads.push(path);if(path==='api-cache/revision/listings.json')return{body:new Response(JSON.stringify({revision})).body};
   assert.equal(path,key+'.navigation-v217.json');return{body:new Response(JSON.stringify(packet)).body,customMetadata:{revision,sourceEtag:'basis'}};},
  async put(){throw Error('Verified navigation already exists');}}};
 const response=await privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision,spec:{mode,filters:{keyword:'290-36',sortFilter:'rentHigh'}},preparedFilterOnlyV238:true})}),env,{});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.total,2);assert.equal(result.numericLocalV177,true);
 assert.deepEqual(result.rows.map(row=>row[result.fields.indexOf('propertyId')]),['P-1','P-0']);
 assert.equal(reads.filter(path=>path.endsWith('.navigation-v217.json')).length,1);
 assert.equal(reads.some(path=>path.includes('original')||path.includes('catalog')),false);
});
test('v244 a revision change during parcel navigation fails closed instead of publishing stale matches',async()=>{
 const revision='parcel-stale-244',packet=fixture('lease',revision),key='api-cache/query-view-v215-lease.json';let changed=false;
 const env={DB:{prepare(){throw Error('No source scan');}},MEDIA:{async head(){return{etag:'basis',customMetadata:{revision}};},async get(path){
  if(path==='api-cache/revision/listings.json')return{body:new Response(JSON.stringify({revision:changed?'newer':revision})).body};
  assert.equal(path,key+'.navigation-v217.json');changed=true;return{body:new Response(JSON.stringify(packet)).body,customMetadata:{revision,sourceEtag:'basis'}};
 }}};
 await assert.rejects(privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision,spec:{mode:'lease',filters:{keyword:'290-36'}}})}),env,{}),/갱신|변경/);
});
for(const mode of ['lease','building_sale','land_sale'])test('v244 prepared parcel miss never starts a whole default reconstruction '+mode,async()=>{
 const revision='parcel-miss-'+mode,reads=[];
 const env={DB:{prepare(){throw Error('No default reconstruction');}},MEDIA:{async head(){return null;},async get(path){
  reads.push(path);assert.equal(path,'api-cache/revision/listings.json');return{body:new Response(JSON.stringify({revision})).body};
 }}};
 await assert.rejects(privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision,spec:{mode,filters:{keyword:'290-36'}},preparedFilterOnlyV238:true})}),env,{}),error=>error.statusCode===425);
 assert.deepEqual(reads,['api-cache/revision/listings.json']);
});
