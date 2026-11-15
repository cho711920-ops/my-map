import test from 'node:test';
import assert from 'node:assert/strict';
import {patchPreparedQueryV152,querySpecV151,numericCatalogPacketV177,preparedFilterPacketV238} from '../cloudflare/src/query-worker-v151.js';
import {runSnapshotQueryV151} from '../cloudflare/src/query-engine-v151.js';
import {createListingQueryRuntimeV151} from '../cloudflare/generated/query-runtime-v151.js';
const before='sha256-v1:'+'a'.repeat(64),after='sha256-v1:'+'b'.repeat(64);
const details={landAreaM2:200,grossAreaM2:400,totalDeposit:1000,monthlyIncome:200};
function raw(id,mode,proof=after){return {property_id:id,title:id,address:'서구 검수동 1',room:'1층',listing_type:'상가점포',status:'active',main_source:'네이버',
 trade_type:mode==='lease'?'lease':'sale',sale_category:mode==='land_sale'?'land':'building',sale_price:50000,sale_details_json:JSON.stringify(details),
 deposit:1000,monthly_rent:80,area_m2:66,source_snapshot_key:proof,registration_at:'2026-11-13'};}
function ad(row){return {propertyId:row.property_id,originalId:'ad-'+row.property_id,source:'네이버',active:1,availabilityKind:'active',
 tradeType:row.trade_type,saleCategory:row.sale_category,salePrice:row.sale_price,saleSummary:details,deposit:1000,rent:80,area:20,
 photoCount:1,thumbnail:'https://photos.invalid/'+row.property_id+'.jpg'};}
function metadata(items){return {ok:true,groups:Object.fromEntries(items.map(r=>[r.property_id,[ad(r)]])),
 sourceSnapshotKeys:Object.fromEntries(items.map(r=>[r.property_id,r.source_snapshot_key])),sourceSnapshotPropertyIds:Object.fromEntries(items.map(r=>[r.property_id,r.property_id]))};}
async function fixture(mode){
 const helper=createListingQueryRuntimeV151([],null),spec=querySpecV151({mode}),r=raw('A',mode,before),meta=metadata([r]),groups=new Map();
 const rows=await runSnapshotQueryV151({items:[helper.rawMaster(r,0)],metadata:meta,sourcePacketV176:meta,
 captureNumericV177:row=>{const values=groups.get(row.propertyId)||[];values.push(row);groups.set(row.propertyId,values);}}, {...spec,individualQueryV152:true});
 const packet=numericCatalogPacketV177(rows,groups,'before',mode);assert.equal(packet.total,1,'Fixture starts with a real matching advertisement');
 let exactReads=0;
 const env={MEDIA:{get(){throw Error('Full source download forbidden');}},DB:{prepare(){throw Error('SQL scan forbidden');}}};
 async function patch(ids,items,missingIds=[],alter=x=>x){return patchPreparedQueryV152(env,{revision:'after',history:[{revision:'before'},{revision:'after',changeIds:ids}]},spec,packet,
  async requestedIds=>{exactReads++;return alter({ok:true,requestedIds,missingIds,items,unified:metadata(items)});});}
 return {packet,patch,reads:()=>exactReads,foreign:mode==='lease'?'building_sale':mode==='building_sale'?'lease':'building_sale'};
}
for(const mode of ['lease','building_sale','land_sale']){
 test('v238 '+mode+' filter preparation includes a proven new matching master without a full rebuild',async()=>{
  const f=await fixture(mode),key='derived-filter',writes=[],state={revision:'after',history:[{revision:'before'},{revision:'after',changeIds:['B']}]};
  const env={DB:{prepare(){throw Error('No full source scan');}},MEDIA:{async get(name){return{body:new Response(JSON.stringify(name===key?f.packet:{revision:'after'})).body};},async put(name,text,options){writes.push({name,packet:JSON.parse(text),options});}}};
  let reads=0;const result=await preparedFilterPacketV238(env,state,querySpecV151({mode,filters:{minDeposit:'1'}}),key,async requestedIds=>{reads++;assert.deepEqual(requestedIds,['B']);return{ok:true,requestedIds,missingIds:[],items:[raw('B',mode)],unified:metadata([raw('B',mode)])};});
  assert.equal(reads,1);assert.equal(result.total,2);assert.equal(result.revision,'after');assert.equal(result.numericCatalogV177.revision,'after');
  const id=result.fields.indexOf('propertyId'),photo=result.fields.indexOf('thumbnailV8');assert.deepEqual(result.rows.map(row=>row[id]).sort(),['A','B']);assert.equal(result.rows.find(row=>row[id]==='B')[photo],'https://photos.invalid/B.jpg');
  assert.equal(writes.length,1);assert.equal(writes[0].name,key);assert.deepEqual(writes[0].packet,result);assert.equal(writes[0].options.customMetadata.revision,'after');
 });
 test('v238 '+mode+' filter preparation cannot publish a changed revision or unproved addition',async()=>{
  const f=await fixture(mode),key='derived-filter',state={revision:'after',history:[{revision:'before'},{revision:'after',changeIds:['B']}]},writes=[];
  const env={MEDIA:{async get(name){return{body:new Response(JSON.stringify(name===key?f.packet:{revision:'newer'})).body};},async put(){writes.push(1);}}};
  const point=async requestedIds=>({ok:true,requestedIds,missingIds:[],items:[raw('B',mode)],unified:metadata([raw('B',mode)])});
  await assert.rejects(preparedFilterPacketV238(env,state,querySpecV151({mode}),key,point),/기준/);assert.equal(writes.length,0);
  await assert.rejects(preparedFilterPacketV238(env,state,querySpecV151({mode}),key,async ids=>{const value=await point(ids);value.unified.sourceSnapshotKeys.B=before;return value;}),/연결/);assert.equal(writes.length,0);
 });
 test('v232 '+mode+' verifies an unknown other-market change without rebuilding its complete view',async()=>{
  const f=await fixture(mode),result=await f.patch(['B'],[raw('B',f.foreign)]);assert.equal(result.revision,'after');assert.deepEqual(result.rows,f.packet.rows);
  assert.deepEqual(result.numericCatalogV177.groups,f.packet.numericCatalogV177.groups);assert.equal(result.numericCatalogV177.revision,'after');assert.equal(f.reads(),1);
 });
 test('v232 '+mode+' missing foreign IDs keep all known rows without creating a ghost',async()=>{
  const f=await fixture(mode),result=await f.patch(['B'],[],['B']);assert.deepEqual(result.rows,f.packet.rows);assert.equal(result.total,1);assert.equal(f.reads(),1);
 });
 test('v232 '+mode+' new matching masters still require the complete canonical build',async()=>{
  const f=await fixture(mode);assert.equal(await f.patch(['B'],[raw('B',mode)]),null);assert.equal(f.reads(),1);
 });
 test('v232 '+mode+' mixed own and foreign changes patch only the existing exact master',async()=>{
  const f=await fixture(mode),result=await f.patch(['A','B'],[raw('A',mode),raw('B',f.foreign)]),id=result.fields.indexOf('propertyId'),proof=result.fields.indexOf('sourceSnapshotKey');
  assert.equal(result.total,1);assert.equal(result.rows[0][id],'A');assert.equal(result.rows[0][proof],after);assert.equal(result.revision,'after');
 });
 test('v232 '+mode+' rejects wrong original proofs before declaring an unknown change irrelevant',async()=>{
  const f=await fixture(mode);await assert.rejects(f.patch(['B'],[raw('B',f.foreign)],[],r=>({...r,unified:{...r.unified,sourceSnapshotKeys:{B:before}}})),/연결/);
 });
 test('v232 '+mode+' rejects incomplete requested ID evidence instead of keeping stale rows',async()=>{
  const f=await fixture(mode);await assert.rejects(f.patch(['B'],[raw('B',f.foreign)],[],r=>({...r,requestedIds:[]})),/범위/);
 });
 test('v232 '+mode+' keeps the existing bounded delta limit and missing-history fallback',async()=>{
  const f=await fixture(mode);assert.equal(await f.patch(Array.from({length:51},(_,n)=>'B-'+n),[]),null);assert.equal(f.reads(),0);
 });
}
