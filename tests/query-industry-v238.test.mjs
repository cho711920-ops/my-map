import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
import {hashSourceSnapshotProof} from '../cloudflare/src/source-snapshot-proof.js';
await buildQueryRuntimeV151();
const {runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {numericCatalogPacketV177,queryWireV151,querySpecV151,filterPreparedQueryV220,privateListingQueryV151,repairIndustryQueryV238}=await import('../cloudflare/src/query-worker-v151.js');
const {industryMatchesV238}=await import('../cloudflare/src/query-industry-v238.js');
const rawProof=[['fixture',1,'stamp','active'],[]],proof=await hashSourceSnapshotProof(rawProof);
function database(items,rawById={}){
 const calls=[];return {calls,prepare(sql){assert.match(sql,/^SELECT property_id,/);assert.match(sql,/property_id IN \(SELECT value FROM json_each\(\?1\)\)/);assert.match(sql,/listing_data_quality_holds/);assert.match(sql,/instr\(lower\(COALESCE\(operating_memo/);
  return {bind(ids,terms){calls.push({ids:JSON.parse(ids),terms:JSON.parse(terms)});return {async all(){return {results:items.filter(item=>JSON.parse(ids).includes(item.propertyId)&&JSON.parse(terms).some(term=>item.memo.toLowerCase().includes(term))).map(item=>({property_id:item.propertyId,source_snapshot_proof:rawById[item.propertyId]||rawProof}))};}};}};
 }};
}
function fixture(mode){
 const items=[0,1].map(n=>({propertyId:'IND-'+n,key:'검수 매물|서구 검수동 '+(n+1)+'|1층|상가점포',name:'검수 매물',memo:'식당 가능 · 창고 사무실 추천 · 전화010-1111-2222',address:'서구 검수동 '+(n+1),room:'1층',state:'active',type:'상가점포',
  tradeType:mode==='lease'?'lease':'sale',saleCategory:mode==='land_sale'?'land':'building',deposit:1000,rent:60,area:30,salePrice:60000,source:'네이버',sourceSnapshotKey:proof,sheetRow:n+2}));
 const groups=Object.fromEntries(items.map(item=>[item.propertyId,[0,1].map((n)=>({...item,originalId:item.propertyId+'-AD-'+n,source:'네이버',active:1,availabilityKind:'active',
   description:n?'창고, 사무실 추천':'식당 가능 · 전화010-1111-2222',memo:n?'창고, 사무실 추천':'식당 가능 · 전화010-1111-2222',rent:n?90:60,salePrice:n?90000:60000,
   photoCount:2,thumbnail:'https://photos.invalid/'+item.propertyId+'-'+n+'.jpg'}))]));
 const metadata={ok:true,format:'expanded-v2',groups,sourceSnapshotKeys:Object.fromEntries(items.map(i=>[i.propertyId,proof])),sourceSnapshotPropertyIds:Object.fromEntries(items.map(i=>[i.propertyId,i.propertyId])),sourceSearchIds:{}};
 return {items,metadata,stream:()=>new Response(JSON.stringify(metadata)).body};
}

for(const mode of ['lease','building_sale','land_sale'])test('v238 bounded ID-only industry search equals full original evaluation and exact photos '+mode,async()=>{
 const f=fixture(mode),groups=new Map();
 const rows=await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream(),captureNumericV177:row=>{const list=groups.get(row.propertyId)||[];list.push(row);groups.set(row.propertyId,list);}},{mode,hideDone:true,individualQueryV152:true},1);
 const packet=numericCatalogPacketV177(rows,groups,'R238',mode);assert.equal(packet.total,2);assert.equal(packet.numericCatalogV177.groups.length,2);
 const DB=database(f.items),reads=[];
 const env={DB,MEDIA:{async get(key){reads.push(key);if(key.endsWith('/listings.json'))return{body:new Response(JSON.stringify({revision:'R238'})).body};if(key==='api-cache/query-view-'+(mode==='building_sale'?'v184-':'v215-')+mode+'.json')return{body:new Response(JSON.stringify(packet)).body,customMetadata:{revision:'R238'}};if(key.includes('query-custom-'))return null;throw Error('Full source reconstruction forbidden');}}};
 const response=await privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'R238',spec:{mode,filters:{industryFilter:'식당'}}})}),env,{});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-js-query-industry-v238'),'1');
 const served=await response.json();assert.equal(served.total,2);assert.equal(DB.calls.length,1);assert.doesNotMatch(JSON.stringify(served),/010-1111-2222|식당 가능/);
 for(const filters of [{industryFilter:'식당'},{industryFilter:'사무실'},{industryFilter:'  식당 , 창고  '},{industryFilter:'없음'},
  {industryFilter:'사무실',...(mode==='lease'?{maxRent:'80'}:{maxDeposit:'80000'})},{industryFilter:'식당',...(mode==='lease'?{minRent:'80'}:{minDeposit:'80000'})}]){
  const spec=querySpecV151({mode,filters}),accept=await industryMatchesV238(env,packet,spec);
  const result=filterPreparedQueryV220(packet,{...spec,filters:{...spec.filters,industryFilter:''}},accept);
  const expected=queryWireV151(await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream()},{...spec,individualQueryV152:true},1),'R238');
  assert.deepEqual(result,expected,JSON.stringify(filters));assert.doesNotMatch(JSON.stringify(result),/식당 가능|010-1111-2222|사무실 추천|memo|landlordPhone/);
 }
 assert.deepEqual([...DB.calls[0].ids].sort(),['IND-0','IND-1']);
 const changed=structuredClone(packet);changed.rows[0][changed.fields.indexOf('sourceSnapshotKey')]='sha256-v1:'+'e'.repeat(64);
 const changedAccept=await industryMatchesV238(env,changed,querySpecV151({mode,filters:{industryFilter:'식당'}}));assert.deepEqual(changedAccept.repairIdsV238,[changed.rows[0][changed.fields.indexOf('propertyId')]]);assert.equal(changedAccept({propertyId:changedAccept.repairIdsV238[0]}),false);
 await assert.rejects(industryMatchesV238(env,{...packet,revision:'different'},querySpecV151({mode,filters:{industryFilter:'식당'}})),/기준/);
 await assert.rejects(industryMatchesV238(env,packet,querySpecV151({mode:mode==='lease'?'land_sale':'lease',filters:{industryFilter:'식당'}})),/기준/);
});

test('v238 industry ID lookup rejects foreign/duplicate/unproved rows and binds text safely',async()=>{
 const packet={fields:['propertyId','sourceSnapshotKey'],rows:[['P',proof]],numericCatalogV177:{marketV215:'lease',complete:true,revision:'R238'},revision:'R238'};
 const spec=querySpecV151({mode:'lease',filters:{industryFilter:'식당'}});
 for(const rows of [[{property_id:'OTHER',source_snapshot_proof:rawProof}],[{property_id:'P',source_snapshot_proof:rawProof},{property_id:'P',source_snapshot_proof:rawProof}],[{property_id:'P'}]])await assert.rejects(industryMatchesV238({DB:{prepare(){return{bind(){return{async all(){return{results:rows};}};}};}}},packet,spec));
 const DB=database([{propertyId:'P',memo:'식당'}]);
 assert.equal(await industryMatchesV238({DB},packet,querySpecV151({mode:'lease',filters:{industryFilter:'Übersicht'}})),null);assert.equal(DB.calls.length,0);
 const attack="식당' OR 1=1 --";const accept=await industryMatchesV238({DB},packet,querySpecV151({mode:'lease',filters:{industryFilter:attack}}));assert.equal(accept({propertyId:'P'}),false);assert.deepEqual(DB.calls[0].terms,[attack.toLowerCase()]);
});
for(const mode of ['lease','building_sale','land_sale'])test('v238 a newer memo proof rereads only its exact originals and emits current conditions/photos '+mode,async()=>{
 const f=fixture(mode),groups=new Map();
 const rows=await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream(),captureNumericV177:row=>{const list=groups.get(row.propertyId)||[];list.push(row);groups.set(row.propertyId,list);}},{mode,hideDone:true,individualQueryV152:true},1);
 const packet=numericCatalogPacketV177(rows,groups,'R238',mode),nextRaw=[['fixture',2,'new','active'],[]],nextProof=await hashSourceSnapshotProof(nextRaw);
 f.items[0].sourceSnapshotKey=nextProof;f.items[0].memo='새로운 식당 가능';f.metadata.sourceSnapshotKeys['IND-0']=nextProof;
 for(const ad of f.metadata.groups['IND-0']){ad.rent=40;ad.salePrice=40000;ad.thumbnail='https://photos.invalid/current.jpg';}
 const spec=querySpecV151({mode,filters:{industryFilter:'식당',...(mode==='lease'?{maxRent:'80'}:{maxDeposit:'80000'})}}),accept=await industryMatchesV238({DB:database(f.items,{'IND-0':nextRaw})},packet,spec),calls=[];
 assert.deepEqual(accept.repairIdsV238,['IND-0']);
 const current=f.items[0],response={ok:true,requestedIds:['IND-0'],missingIds:[],items:[{title:current.name,address:current.address,room:current.room,listing_type:current.type,deposit:current.deposit,monthly_rent:current.rent,area_m2:current.area,status:current.state,operating_memo:current.memo,property_id:current.propertyId,source_snapshot_key:nextProof,main_source:current.source,trade_type:current.tradeType,sale_category:current.saleCategory,sale_price:current.salePrice}],unified:{...f.metadata,groups:{'IND-0':f.metadata.groups['IND-0']},sourceSnapshotKeys:{'IND-0':nextProof},sourceSnapshotPropertyIds:{'IND-0':'IND-0'}}};
 const result=await repairIndustryQueryV238({}, {revision:'R238'},spec,packet,accept,async ids=>{calls.push(ids);return structuredClone(response);});
 const expected=queryWireV151(await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream()},{...spec,individualQueryV152:true},1),'R238');
 assert.deepEqual(calls,[['IND-0']]);assert.deepEqual(result,expected);
 const row=result.rows.find(row=>row[result.fields.indexOf('propertyId')]==='IND-0');assert.equal(row[result.fields.indexOf('sourceSnapshotKey')],nextProof);assert.equal(row[result.fields.indexOf('thumbnailV8')],'https://photos.invalid/current.jpg');
 await assert.rejects(repairIndustryQueryV238({}, {revision:'R238'},spec,packet,accept,async()=>({...response,requestedIds:['OTHER']})),/완전/);
 await assert.rejects(repairIndustryQueryV238({}, {revision:'R238'},spec,packet,accept,async()=>({...response,items:[{...response.items[0],source_snapshot_key:proof}]})),/연결/);
});

for(const mode of ['lease','building_sale','land_sale'])test('v238 current industry ID protocol never reads the full prepared or original source '+mode,async()=>{
 const reads=[],state={revision:'ID-REV'},DB={prepare(sql){assert.match(sql,/instr\(lower\(COALESCE\(operating_memo/);assert.doesNotMatch(sql,/property_id IN/);return{bind(terms){assert.deepEqual(JSON.parse(terms),['식당']);return{async all(){return{results:[{property_id:'MATCH',source_snapshot_proof:rawProof}]};}};}};}};
 const env={DB,MEDIA:{async get(key){reads.push(key);assert.equal(key,'api-cache/revision/listings.json');return{body:new Response(JSON.stringify(state)).body};}}};
 const spec={mode,filters:{industryFilter:'식당'}},input={resolveCurrentV160:true,industryIdsOnlyV238:true,basisRevisionV238:'ID-REV',spec};
 const request=value=>new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify(value)});
 const response=await privateListingQueryV151(request(input),env,{});assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,industryIdsV238:true,revision:'ID-REV',mode,total:1,rows:[['MATCH',proof]]});assert.equal(reads.length,2);
 await assert.rejects(privateListingQueryV151(request({...input,basisRevisionV238:'old'}),env,{}),/기준/);
 await assert.rejects(privateListingQueryV151(request({...input,spec:{mode,filters:{industryFilter:''}}}),env,{}),/기준/);
});
