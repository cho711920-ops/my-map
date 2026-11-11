import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
const proof='sha256-v1:'+'a'.repeat(64);
function master(id,extra={}) {return {propertyId:id,key:'key-'+id,name:'일반상가',address:'서구 용문동 1-1',room:'1층',
  type:'상가점포',tradeType:'lease',state:'active',source:'네이버',deposit:1000,rent:70,fee:0,premium:0,area:20,
  latitude:36.35,longitude:127.38,sourceSnapshotKey:proof,sheetRow:1,...extra};}
function ad(id,extra={}) {return {propertyId:id,originalId:'ad-'+id,source:'네이버',active:1,availabilityKind:'active',
  tradeType:'lease',room:'1층',floor:1,deposit:1000,rent:100,fee:0,premium:0,area:20,thumbnail:'https://example.invalid/a.jpg',...extra};}
function unified(items,groups={}) {return {ok:true,groups:Object.fromEntries(items.map(i=>[i.propertyId,groups[i.propertyId]||[ad(i.propertyId)]])),
  sourceSnapshotKeys:Object.fromEntries(items.map(i=>[i.propertyId,proof])),
  sourceSnapshotPropertyIds:Object.fromEntries(items.map(i=>[i.propertyId,i.propertyId]))};}
const ids=rows=>rows.map(i=>i.propertyId);
test('query projection retains active manual corrections on the exact ID and candidate original conditions',()=>{
  const items=[master('A',{rent:80,room:'지하1층'}),master('B')];
  const u=unified(items,{A:[ad('A',{manualDisplayFields:'monthly_rent,room',hasManualRoomOverride:true,room:'지하1층',floor:-1}),
    ad('A',{originalId:'old-A',active:0,availabilityKind:'census_missing',candidateEligible:true,rent:120,room:'3층',floor:3})]});
  const runtime=make(items,u);
  assert.equal(runtime.compatibility.complete,true);
  const active=runtime.query();assert.equal(active.find(i=>i.propertyId==='A').rent,80);assert.equal(active.find(i=>i.propertyId==='B').rent,100);
  assert.deepEqual(ids(runtime.query({filters:{floorQuickFilter:'basement'}})),['A']);
  assert.deepEqual(ids(runtime.query({filters:{maxRent:'90'}})),['A']);
  const candidate=runtime.query({doneOnly:true,hideDone:false});assert.deepEqual(ids(candidate),['A']);assert.equal(candidate[0].rent,120);
});
test('unknown financial values, true zero, favorites, exact parcel and bounds keep their existing meaning',()=>{
  const items=[master('A'),master('B',{address:'서구 용문동 1-11',latitude:36.4})];
  const u=unified(items,{A:[ad('A',{premium:''})],B:[ad('B',{premium:0})]});const runtime=make(items,u);
  assert.deepEqual(ids(runtime.query({filters:{minPremium:'0',maxPremium:'0'}})),['B']);
  assert.deepEqual(ids(runtime.query({filters:{keyword:'용문동 1-1'}})),['A']);
  assert.deepEqual(ids(runtime.query({favoriteOnly:true,favoriteKeys:['property:B']})),['B']);
  assert.deepEqual(ids(runtime.query({bounds:{south:36.3,north:36.36,west:127,east:128}})),['A']);
  assert.deepEqual(ids(runtime.query({filters:{keyword:'없는주소'}})),[]);
  assert.throws(()=>runtime.query({newListingDays:1}),/confirmed period/);
});
test('completed and unverified sources never masquerade as active cards',()=>{
  const items=[master('manual',{state:'계약완료'}),master('ended'),master('live')];
  const runtime=make(items,unified(items,{ended:[ad('ended',{active:0,sourceUnavailable:true,availabilityKind:'census_missing',candidateEligible:true})]}));
  assert.deepEqual(ids(runtime.query()),['live']);
  assert.deepEqual(new Set(ids(runtime.query({doneOnly:true,hideDone:false}))),new Set(['manual','ended']));
  const broken=unified([master('A')]);broken.sourceSnapshotKeys.A='sha256-v1:'+'b'.repeat(64);
  assert.throws(()=>make([master('A')],broken).query(),/unverified/);
});
test('building and land queries preserve selected financial amounts and collapse whole-building siblings before sorting',()=>{
  const building={tradeType:'sale',saleCategory:'building',salePrice:82000,saleDetails:{saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true}};
  const items=[master('B',building),master('A',building),master('L',{tradeType:'sale',saleCategory:'land',salePrice:20000})];
  const groups=Object.fromEntries(items.map(i=>[i.propertyId,[ad(i.propertyId,{tradeType:'sale',saleCategory:i.saleCategory,salePrice:i.salePrice,
    saleSummary:{saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,monthlyIncome:220,totalDeposit:24000,landAreaM2:180,grossAreaM2:335}})]]));
  const runtime=make(items,unified(items,groups));
  const buildings=runtime.query({mode:'building_sale'});assert.deepEqual(ids(buildings),['A']);
  assert.deepEqual(buildings[0].wholeBuildingMembersV55,['A','B']);
  assert.equal(buildings[0].saleDetails.monthlyIncome,220);assert.equal(buildings[0].salePrice,82000);
  assert.deepEqual(ids(runtime.query({mode:'land_sale'})),['L']);
  const raw=runtime.query({mode:'building_sale',deferFinalize:true});assert.equal(raw.length,2);
  assert.deepEqual(ids(make([],null).finalize(raw,{mode:'building_sale'})),['A']);
});
test('date-only registrations sort in KST beside explicit UTC timestamps',()=>{
  const items=[master('date-only',{registrationAt:'2026-11-10'}),master('earlier',{registrationAt:'Mon, 09 Nov 2026 14:30:00 GMT'}),
    master('later',{registrationAt:'Mon, 09 Nov 2026 15:30:00 GMT'})];
  assert.deepEqual(ids(make(items,unified(items)).query()),['later','date-only','earlier']);
});


test('v193 bare parcel matching is exact in building sale and leaves lease substring search unchanged',()=>{
 const items=[master('A',{address:'서구 괴정동 56-29'}),master('B',{address:'서구 괴정동 156-29'}),master('C',{address:'서구 괴정동 56-290'}),master('D',{memo:'56-29 참고'})];
 const groups=Object.fromEntries(items.map(i=>[i.propertyId,[ad(i.propertyId)]]));
 const lease=make(items,unified(items,groups)).query({mode:'lease',filters:{keyword:'56-29'}});
 assert.deepEqual(ids(lease).sort(),['A','B','C','D']);
 items.forEach(i=>{i.tradeType='sale';i.saleCategory='building';i.salePrice=50000;groups[i.propertyId].forEach(a=>{a.tradeType='sale';a.saleCategory='building';a.salePrice=50000;});});
 const runtime=make(items,unified(items,groups));
 assert.deepEqual(ids(runtime.query({mode:'building_sale',filters:{keyword:'56-29'}})),['A']);
 assert.deepEqual(ids(runtime.query({mode:'building_sale',filters:{keyword:'괴정동 56-29'}})),['A']);
 assert.deepEqual(ids(runtime.query({mode:'building_sale',filters:{keyword:'56-29,1-1'}})).sort(),['A','D']);
});


test('v193 cold prepared-query rejection recognizes a bare building parcel without scanning unrelated ads',()=>{
 const runtime=make([],null),spec={mode:'building_sale',filters:{keyword:'56-29'}};
 assert.equal(runtime.mayMatchV175(master('A',{address:'서구 괴정동 56-29'}),[],spec),true);
 assert.equal(runtime.mayMatchV175(master('B',{address:'서구 괴정동 156-29'}),[],spec),false);
 assert.equal(runtime.mayMatchV175(master('C',{address:'서구 괴정동 56-290'}),[],spec),false);
 assert.equal(runtime.mayMatchV175(master('D',{address:'서구 괴정동 2-3',memo:'56-29 참고'}),[],spec),false);
 assert.equal(runtime.mayMatchV175(master('D',{address:'서구 괴정동 2-3',memo:'56-29 참고'}),[],{...spec,mode:'lease'}),true);
});
