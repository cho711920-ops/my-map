import test from 'node:test';
import assert from 'node:assert/strict';
import {privateListingQueryV151,queryWireV151,filterPreparedQueryV220,querySpecV151} from '../cloudflare/src/query-worker-v151.js';
const proof='sha256-v1:'+'c'.repeat(64);
function catalog(mode){
 const rows=[1000,2000].map((deposit,index)=>({propertyId:'P-'+index,sourceSnapshotKey:proof,tradeType:mode==='lease'?'lease':'sale',saleCategory:mode==='land_sale'?'land':'building',
  name:'검사 매물',address:'서구 괴정동 '+(index+1),room:'1층',state:'active',deposit,rent:100,area:30,salePrice:deposit*10,
  displayValuePresence:{deposit:true,salePrice:true},registrationAt:'2026-11-13',sheetRow:index+2,source:'네이버',sourceTypesV8:['네이버'],
  queryMatchedOriginalCountV152:1,querySelectedOriginalIdV152:'O-'+index,querySelectedPhotoCountV157:1,thumbnailV8:'https://photos.invalid/'+index+'.jpg'}));
 return {...queryWireV151(rows,'v220'),numericCatalogV177:{version:177,format:'row-deltas-v177',complete:true,marketV215:mode,revision:'v220',groups:[]}};
}
for(const mode of ['lease','building_sale','land_sale'])test('v220 '+mode+' first filter reads only a complete prepared catalog, not writable originals',async()=>{
 const packet=catalog(mode),reads=[];
 const env={DB:{prepare(){throw Error('Writable source scan forbidden');}},MEDIA:{async get(key){reads.push(key);
  if(key.endsWith('/listings.json'))return{body:new Response(JSON.stringify({revision:'v220'})).body};
  if(key==='api-cache/query-view-'+(mode==='building_sale'?'v184-':'v215-')+mode+'.json')return{body:new Response(JSON.stringify(packet)).body,customMetadata:{revision:'v220'}};
  if(key.includes('query-custom-'))return null;throw Error('Unexpected source read: '+key);
 }}};
 const spec={mode,filters:{minDeposit:mode==='lease'?'1500':'15000'}};
 const response=await privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'v220',spec})}),env,{});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-js-query-prepared-v220'),'1');
 const value=await response.json();assert.equal(value.total,1);assert.equal(value.rows[0][value.fields.indexOf('propertyId')],'P-1');
 assert.equal(value.rows[0][value.fields.indexOf('querySelectedOriginalIdV152')],'O-1');assert.ok(reads.filter(key=>key.endsWith('/listings.json')).length>=2);
});

for(const mode of ['lease','building_sale','land_sale'])test('v220 '+mode+' an older compatible custom-cache hit still enables complete basis preparation',async()=>{
 const spec=querySpecV151({mode,filters:{minDeposit:mode==='lease'?'1500':'15000'}});
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(spec))));
 const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
 const packet=filterPreparedQueryV220(catalog(mode),spec);
 assert.equal(packet.numericCatalogDeferredV220,undefined);
 const env={DB:{prepare(){throw Error('No source scan');}},MEDIA:{async get(key){
  if(key.endsWith('/listings.json'))return{body:new Response(JSON.stringify({revision:'v220'})).body};
  if(key.includes('query-custom-'))return{body:new Response(JSON.stringify(packet)).body,customMetadata:{revision:'v220',queryHash:hash}};
  throw Error('A compatible custom response must not reread its full source');
 }}};
 const response=await privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'v220',spec})}),env,{});
 assert.deepEqual(await response.json(),{...packet,numericCatalogDeferredV220:true});
});
test('v220 prepared filter rejects another market, incomplete advertisements, private scopes and unsupported text',()=>{
 const packet=catalog('lease'),spec=querySpecV151({mode:'lease',filters:{minDeposit:'1500'}});
 for(const patch of [{favoriteOnly:true},{doneOnly:true},{hideDone:false},{gongsilOnly:true},{newListingDays:3},{mode:'land_sale'},{filters:{keyword:'식당'}},{filters:{industryFilter:'식당'}}])assert.equal(filterPreparedQueryV220(packet,{...spec,...patch}),null);
 const incomplete=structuredClone(packet);incomplete.rows[0][packet.fields.indexOf('queryMatchedOriginalCountV152')]=2;
 assert.equal(filterPreparedQueryV220(incomplete,spec),null);
 assert.equal(filterPreparedQueryV220({...packet,numericCatalogV177:{...packet.numericCatalogV177,revision:'old'}},spec),null);
});
test('v220 a revision change during prepared filtering cannot return an old result as current',async()=>{
 const packet=catalog('lease');let revisions=0;
 const env={DB:{prepare(){throw Error('No original scan');}},MEDIA:{async get(key){
  if(key.endsWith('/listings.json'))return{body:new Response(JSON.stringify({revision:++revisions===1?'v220':'changed-v220'})).body};
  if(key==='api-cache/query-view-v215-lease.json')return{body:new Response(JSON.stringify(packet)).body,customMetadata:{revision:'v220'}};
  if(key.includes('query-custom-'))return null;throw Error('Unexpected source read');
 }}};
 await assert.rejects(privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'v220',spec:{mode:'lease',filters:{minDeposit:'1700'}}})}),env,{}),/목록 기준이 변경/);
});
