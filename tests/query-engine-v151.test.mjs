import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {runSnapshotQueryV151,querySnapshotInventoryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
const proof='sha256-v1:'+'a'.repeat(64);
function fixture(count=400){
  const items=Array.from({length:count},(_,index)=>({propertyId:'id-'+index,key:'key-'+index,name:'검수',address:'서구 용문동 '+(index+1),
    room:'1층',type:'상가점포',state:index%7?'active':'계약완료',tradeType:'lease',deposit:1000,rent:80,premium:0,fee:0,area:20,
    latitude:36.35,longitude:127.38,sourceSnapshotKey:proof,sheetRow:index,registrationAt:'2026-11-09'}));
  const fields=['originalId','source','active','availabilityKind','candidateEligible','deposit','rent','fee','premium','area','room','floor','thumbnail','photoPathsV119'];
  const groups=Object.fromEntries(items.map((item,index)=>[item.propertyId,[[item.propertyId+'-a','네이버',1,'active',false,1000,index%100,0,0,20,'1층',1,'https://example.invalid/'+index+'.jpg','v1\n0 next.jpg'],
    [item.propertyId+'-b','당근',0,'census_missing',true,500,50,0,0,10,'지하1층',-1,'','']]]));
  const metadata={ok:true,format:'compact-v2',fields,groups,sourceSnapshotKeys:Object.fromEntries(items.map(i=>[i.propertyId,proof])),
    sourceSnapshotPropertyIds:Object.fromEntries(items.map(i=>[i.propertyId,i.propertyId]))};
  return {items,metadata,stream:()=>new Blob([JSON.stringify(metadata)]).stream()};
}
const facts=rows=>rows.map(i=>[i.propertyId,i.rent,i.floor]);
test('bounded queries match complete projection membership, ordering and exact selected originals across batches',async()=>{
  for(const spec of [{},{filters:{maxRent:'35',sortFilter:'rentHigh'}},{doneOnly:true,hideDone:false,filters:{floorQuickFilter:'basement'}}]){
    const f=fixture(),runtime=make(structuredClone(f.items),runtimeExpanded(f.metadata));
    const expected=runtime.query({...spec,ignoreMapBounds:true,includeUnlocated:true});
    const actual=await runSnapshotQueryV151({...f,stream:f.stream()},spec,17);
    assert.deepEqual(facts(actual),facts(expected));
    assert.deepEqual(actual.map(i=>i.queryOriginalIdsV151),expected.map(i=>i.unifiedDisplayOriginalsV2.map(o=>({propertyId:o.propertyId,originalId:o.originalId}))));
    assert.ok(actual.every(i=>!Object.hasOwn(i,'memo')&&!Object.hasOwn(i,'landlordPhone')&&!Object.hasOwn(i,'unifiedAllOriginalsV1')));
  }
});
function runtimeExpanded(meta){return make([],null).expand(meta);}
test('query rejects unverified, duplicate and changing inventories rather than presenting a partial complete list',async()=>{
  const f=fixture(2);f.items[0].sourceSnapshotKey='sha256-v1:'+'b'.repeat(64);
  assert.deepEqual(querySnapshotInventoryV151(f.items,f.metadata).pending,['id-0']);
  await assert.rejects(runSnapshotQueryV151({...f,stream:f.stream()}),/unverified/);
  const g=fixture(2);g.metadata.sourceSnapshotPropertyIds['id-1']='id-0';
  assert.throws(()=>querySnapshotInventoryV151(g.items,g.metadata),/Ambiguous/);
  const h=fixture(2),changed=structuredClone(h.metadata);changed.sourceSnapshotKeys['id-1']='changed';
  await assert.rejects(runSnapshotQueryV151({...h,stream:new Blob([JSON.stringify(changed)]).stream()}),/changed/);
});
test('an exact scoped repair updates only its master; confirmed removed masters are excluded',async()=>{
  const f=fixture(3),newProof='sha256-v1:'+'b'.repeat(64);
  f.items[1].sourceSnapshotKey=newProof;
  const replacement={...f.items[1],rent:33};
  const original={propertyId:'id-1',originalId:'new-ad',source:'네이버',active:1,deposit:1000,rent:33,premium:0,area:20};
  const repairs=new Map([['id-1',{item:replacement,originals:[original],proof:newProof}],['id-2',null]]);
  const result=await runSnapshotQueryV151({...f,stream:f.stream(),repairs});
  assert.deepEqual(result.map(i=>[i.propertyId,i.rent]),[['id-1',33]]);
  assert.equal(f.items[2].rent,80);
});
test('whole-building members in separate batches retain one stable representative, all proofs and 220만원 income',async()=>{
  const f=fixture(2);
  f.items.forEach(item=>Object.assign(item,{state:'active',tradeType:'sale',saleCategory:'building',salePrice:82000,address:'서구 탄방동 56-24'}));
  f.metadata.format='expanded-v2';
  f.metadata.groups=Object.fromEntries(f.items.map(item=>[item.propertyId,[{propertyId:item.propertyId,originalId:'ad-'+item.propertyId,
    source:'네이버',active:1,tradeType:'sale',saleCategory:'building',salePrice:82000,
    saleSummary:{saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,totalDeposit:24000,monthlyIncome:220}}]]));
  const result=await runSnapshotQueryV151({...f,stream:f.stream()},{mode:'building_sale'},1);
  assert.equal(result.length,1);assert.equal(result[0].propertyId,'id-0');
  assert.deepEqual(result[0].wholeBuildingMembersV55,['id-0','id-1']);
  assert.deepEqual(result[0].queryMemberProofsV151,{'id-0':proof,'id-1':proof});
  assert.equal(result[0].saleDetails.monthlyIncome,220);
});
