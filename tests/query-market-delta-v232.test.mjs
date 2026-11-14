import test from 'node:test';
import assert from 'node:assert/strict';
import {patchPreparedQueryV152,querySpecV151,numericCatalogPacketV177} from '../cloudflare/src/query-worker-v151.js';
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
