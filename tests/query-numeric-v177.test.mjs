import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {queryWireV151,numericCatalogPacketV177,patchPreparedQueryV152,querySpecV151}=await import('../cloudflare/src/query-worker-v151.js');
const {createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
const {queryDeltaV160}=await import('../cloudflare/src/query-delta-v160.js');
const proof='sha256-v1:'+'a'.repeat(64);
function fixture(){
  const items=[],groups={},keys={},ids={};
  for(let n=0;n<8;n++){
    const id='S-'+n,detail={landAreaM2:200+n*40,grossAreaM2:400+n*60,totalDeposit:5000,monthlyIncome:200+n*20};
    items.push({propertyId:id,key:id,name:'건물'+n,address:'서구 괴정동 '+(n+1)+'-1',room:'1층',floor:1,
      tradeType:'sale',saleCategory:'building',salePrice:30000+n*15000,saleDetails:detail,source:'네이버',state:'active',
      memo:n===3?'(확인매물) 수동 메모':'(임장가자)',sheetRow:n+2,registrationAt:'2026-11-10',sourceSnapshotKey:proof});
    groups[id]=Array.from({length:n%3===0?2:1},(_,a)=>({propertyId:id,originalId:id+'-ad-'+a,active:1,
      source:a?'당근':'네이버',tradeType:'sale',saleCategory:n===2?'office':'building',salePrice:30000+n*15000+a*20000,
      saleSummary:detail,manualDisplayFields:n===4?'sale_price':'',photoCount:3,thumbnail:'https://photos.invalid/'+id+'-'+a+'.jpg'}));
    keys[id]=proof;ids[id]=id;
  }
  return {items,metadata:{ok:true,groups,sourceSnapshotKeys:keys,sourceSnapshotPropertyIds:ids}};
}

async function run(data,filters={},captureNumericV177=null){return runSnapshotQueryV151({items:structuredClone(data.items),metadata:data.metadata,stream:new Blob([JSON.stringify(data.metadata)]).stream(),captureNumericV177},{mode:'building_sale',filters,individualQueryV152:true},2);}
async function setup(){const context=vm.createContext({console});for(const path of ['js/query-collection-v152.js','js/listing-trade-ui-v1.js','js/sale-workbench-v1.js','js/query-numeric-v177.js']){
  if(path.includes('trade-ui')||path.includes('sale-workbench'))continue;
  vm.runInContext(await readFile(path,'utf8'),context);
}
const script=await readFile('js/script.js','utf8');
vm.runInContext(script.slice(script.indexOf('function normalizeSearchComparableText'),script.indexOf('function getSearchComparableFields'))+
 script.slice(script.indexOf('function parseExactJibunKeyword'),script.indexOf('function buildSearchText')),context);
const runtime=make([],null);context.JSListingTradeV1={displayPrice:r=>Number(r.salePrice||0),matchesItem:r=>r.tradeType==='sale'&&r.saleCategory!=='land'};
context.JSSaleWorkbenchV1={matches:(r,f)=>runtime.preparedMatchesV176(r,{mode:'building_sale',filters:f})};context.createQueryFilterPredicateV215=spec=>runtime.projectionPredicateV215(spec);return context;}
test('browser catalog equals complete original evaluation for every numeric field and alternate representative/photo',async()=>{
 const data=fixture(),groups=new Map(),base=await run(data,{},row=>{const rows=groups.get(row.propertyId)||[];rows.push(row);groups.set(row.propertyId,rows);});
 const packet=numericCatalogPacketV177(base,groups,'v177'),context=await setup(),prepared=context.JSQueryNumericV177.prepare(packet);
 for(const filters of [{minDeposit:'50000',maxDeposit:'120000'},{minDeposit:'50,000',maxDeposit:'120,000'},{minDeposit:'46000',maxDeposit:'51000'},{saleLandMin:'80',saleLandMax:'130'},{saleGrossMin:'160'},{saleGrossMax:'160'},{saleYieldMin:'4'},{saleYieldMax:'5'},{saleCategoryFilter:'office'},{saleCategoryFilter:'building'},{}]){
  const actual=context.JSQueryNumericV177.filter(prepared,{mode:'building_sale',filters}),expected=queryWireV151(await run(data,filters),'v177');
  delete actual.numericLocalV177;delete actual.numericCatalogV177;
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,JSON.stringify(filters));
 }
 assert.equal(context.JSQueryNumericV177.filter(prepared,{mode:'building_sale',filters:{keyword:'x'}}),null);
 for(const bad of [{...packet,numericCatalogV177:{...packet.numericCatalogV177,revision:'old'}},{...packet,perPropertyOverridesV152:true}])assert.equal(context.JSQueryNumericV177.prepare(bad),null);
 const missing=structuredClone(packet);missing.numericCatalogV177.groups=[];assert.throws(()=>context.JSQueryNumericV177.prepare(missing),/Missing/);
 const wrong=structuredClone(packet);wrong.numericCatalogV177.groups[0][1][0].push([packet.fields.indexOf('sourceSnapshotKey'),'sha256-v1:'+'b'.repeat(64)]);assert.throws(()=>context.JSQueryNumericV177.prepare(wrong),/identity/);
 const same=context.JSQueryCollectionV152.applyDeltaV160(packet,{ok:true,version:160,queryDeltaV160:true,baseRevision:'v177',revision:'v177',unchanged:true});assert.ok(same.numericCatalogV177);
 const updated=context.JSQueryCollectionV152.applyDeltaV160(packet,{ok:true,version:160,queryDeltaV160:true,baseRevision:'v177',revision:'v178',unchanged:false,fields:packet.fields,rows:[],missingIds:[],changedIds:[],order:packet.rows.map(row=>[row[0],row[packet.fields.indexOf('sheetRow')]]),total:packet.total,cardProjectionV157:true,grouping:packet.grouping});
 assert.equal(updated.numericCatalogV177,undefined);assert.equal(context.JSQueryNumericV177.prepare(updated),null);
 assert.equal(JSON.stringify(packet).includes('수동 메모'),false,'No manual memo or contacts are added');
});


test('v193 local building parcel results equal server results including numeric ranges, source choice and exact boundaries',async()=>{
 const data=fixture();
 const addresses=['서구 괴정동 56-29','서구 괴정동 156-29','서구 괴정동 56-290','서구 괴정동 4-1','중구 선화동 56-29','서구 괴정동 99-7','동구 용전동 7-1','동구 용전동 8-1'];
 data.items.forEach((item,n)=>{item.address=addresses[n];if(n===3)item.memo='옆 건물 56-29 참고';if(n===6)item.name='56-29 광고 안내';data.metadata.groups[item.propertyId].forEach(ad=>{ad.address=item.address;});});
 const groups=new Map(),base=await run(data,{},row=>{const rows=groups.get(row.propertyId)||[];rows.push(row);groups.set(row.propertyId,rows);});
 const packet=numericCatalogPacketV177(base,groups,'parcel-v193'),context=await setup(),prepared=context.JSQueryNumericV177.prepare(packet);
 for(const filters of [{keyword:'56-29'},{keyword:'괴정동56-29'},{keyword:'56-29,99-7'},{keyword:'56-29',minDeposit:'40000',maxDeposit:'120000'},
   {keyword:'56-29',saleLandMin:'70'},{keyword:'56-29',saleYieldMin:'2'},{keyword:'56-29',saleCategoryFilter:'building'},{keyword:'987-654'}]){
  const actual=context.JSQueryNumericV177.filter(prepared,{mode:'building_sale',filters}),expected=queryWireV151(await run(data,filters),'parcel-v193');
  delete actual.numericLocalV177;delete actual.numericCatalogV177;
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,JSON.stringify(filters));
 }
 const bare=context.JSQueryNumericV177.filter(prepared,{mode:'building_sale',filters:{keyword:'56-29'}});
 assert.deepEqual(Array.from(bare.rows,r=>r[0]).sort(),['S-0','S-4']);
 for(const keyword of ['56-29 사무실','네이버 1234567890','http://example.invalid','56-29,다른검색'])
  assert.equal(context.JSQueryNumericV177.filter(prepared,{mode:'building_sale',filters:{keyword}}),null);
});


test('v210 twelve state changes patch a complete building catalog and all alternate-ad filters without any full snapshot read',async()=>{
 const data=fixture();for(let n=8;n<20;n++){const id='S-'+n,base=structuredClone(data.items[n%8]);base.propertyId=id;base.key=id;base.sheetRow=n+2;data.items.push(base);data.metadata.groups[id]=data.metadata.groups['S-'+(n%8)].map((ad,k)=>({...ad,propertyId:id,originalId:id+'-ad-'+k}));data.metadata.sourceSnapshotKeys[id]=proof;data.metadata.sourceSnapshotPropertyIds[id]=id;}
 const groups=new Map(),rows=await run(data,{},r=>{const g=groups.get(r.propertyId)||[];g.push(r);groups.set(r.propertyId,g);}),packet=numericCatalogPacketV177(rows,groups,'before');
 const ids=data.items.slice(0,12).map(i=>i.propertyId),changedProof='sha256-v1:'+'b'.repeat(64),helper=make([],null),raw=[];
 data.items=data.items.map((item,index)=>{if(!ids.includes(item.propertyId))return item;const row={property_id:item.propertyId,title:item.name,address:item.address,room:item.room,listing_type:item.type||'',status:'보류',trade_type:'sale',sale_category:item.saleCategory,sale_price:item.salePrice,sale_details_json:JSON.stringify(item.saleDetails),main_source:item.source,operating_memo:item.memo,registration_at:item.registrationAt,source_snapshot_key:changedProof};raw.push(row);data.metadata.sourceSnapshotKeys[item.propertyId]=changedProof;return helper.rawMaster(row,index);});
 let reads=0;const state={revision:'after',history:[{revision:'before'},...ids.map((id,i)=>({revision:i===11?'after':'r'+i,changeIds:[id],fullReload:false}))]},spec=querySpecV151({mode:'building_sale'}),env={DB:{prepare(){throw Error('No scan');}},MEDIA:{get(){throw Error('No full snapshot');}}};
 const patched=await patchPreparedQueryV152(env,state,spec,packet,async requested=>{reads++;assert.deepEqual(requested,ids);return{ok:true,items:raw,requestedIds:ids,missingIds:[],unified:{...data.metadata,groups:Object.fromEntries(ids.map(id=>[id,data.metadata.groups[id]]))}};});
 assert.equal(reads,1);const context=await setup(),prepared=context.JSQueryNumericV177.prepare(patched);assert.ok(prepared);assert.equal(patched.rows.filter(r=>r[patched.fields.indexOf('state')]==='보류').length,12);
 const unchanged=rows.find(r=>r.propertyId==='S-12'),actual=patched.rows.find(r=>r[0]==='S-12');assert.deepEqual(actual,queryWireV151([unchanged],'after').rows[0]);
 for(const filters of [{},{minDeposit:'50000',maxDeposit:'120000'},{saleLandMin:'80'},{saleYieldMin:'4'},{saleCategoryFilter:'office'}]){const result=context.JSQueryNumericV177.filter(prepared,{mode:'building_sale',filters});delete result.numericLocalV177;delete result.numericCatalogV177;assert.deepEqual(JSON.parse(JSON.stringify(result)),queryWireV151(await run(data,filters),'after'));}
 const incomplete=structuredClone(packet);incomplete.numericCatalogV177.groups=[];assert.equal(await patchPreparedQueryV152(env,state,spec,incomplete,()=>{throw Error('Incomplete catalog cannot patch');}),null);
 const crossed=structuredClone(packet);crossed.numericCatalogV177.groups[0][1][0].push([packet.fields.indexOf('sourceSnapshotKey'),'other']);assert.equal(await patchPreparedQueryV152(env,state,spec,crossed,()=>{throw Error('Crossed proof cannot patch');}),null);
});


test('v211 selected merge patches surviving originals and removes deleted IDs from the prepared catalog without a full snapshot',async()=>{
 const data=fixture(),groups=new Map(),rows=await run(data,{},r=>{const g=groups.get(r.propertyId)||[];g.push(r);groups.set(r.propertyId,g);});
 const packet=numericCatalogPacketV177(rows,groups,'before-merge'),primary=data.items[0],deleted=data.items[1],changedProof='sha256-v1:'+'c'.repeat(64);
 const ids=[primary.propertyId,deleted.propertyId],ads=[...data.metadata.groups[primary.propertyId],...data.metadata.groups[deleted.propertyId]].map(ad=>({...ad,propertyId:primary.propertyId}));
 const raw={property_id:primary.propertyId,title:primary.name,address:primary.address,room:primary.room,listing_type:primary.type||'',status:'active',trade_type:'sale',sale_category:primary.saleCategory,sale_price:primary.salePrice,sale_details_json:JSON.stringify(primary.saleDetails),main_source:primary.source,operating_memo:primary.memo,registration_at:primary.registrationAt,source_snapshot_key:changedProof};
 data.items=data.items.filter(i=>i.propertyId!==deleted.propertyId).map((i,n)=>i.propertyId===primary.propertyId?make([],null).rawMaster(raw,n):i);
 delete data.metadata.groups[deleted.propertyId];delete data.metadata.sourceSnapshotKeys[deleted.propertyId];delete data.metadata.sourceSnapshotPropertyIds[deleted.propertyId];
 data.metadata.groups[primary.propertyId]=ads;data.metadata.sourceSnapshotKeys[primary.propertyId]=changedProof;
 const env={DB:{prepare(){throw Error('No full scan');}},MEDIA:{get(){throw Error('No full snapshot');}}},spec=querySpecV151({mode:'building_sale'}),state={revision:'after-merge',history:[{revision:'before-merge'},{revision:'after-merge',changeIds:ids,fullReload:false}]};
 let reads=0;const patched=await patchPreparedQueryV152(env,state,spec,packet,async requested=>{reads++;assert.deepEqual(requested,ids);return{ok:true,items:[raw],requestedIds:ids,missingIds:[deleted.propertyId],unified:{ok:true,groups:{[primary.propertyId]:ads},sourceSnapshotKeys:{[primary.propertyId]:changedProof},sourceSnapshotPropertyIds:{[primary.propertyId]:primary.propertyId}}};});
 assert.equal(reads,1);assert.ok(patched);assert.equal(patched.rows.some(r=>r[0]===deleted.propertyId),false);
 const context=await setup(),prepared=context.JSQueryNumericV177.prepare(patched);assert.ok(prepared);
 for(const filters of [{},{minDeposit:'40000',maxDeposit:'100000'},{saleYieldMin:'2'}]){const actual=context.JSQueryNumericV177.filter(prepared,{mode:'building_sale',filters});delete actual.numericLocalV177;delete actual.numericCatalogV177;assert.deepEqual(JSON.parse(JSON.stringify(actual)),queryWireV151(await run(data,filters),'after-merge'));}
});

for(const mode of ['lease','land_sale'])test('v215 '+mode+' prepared filters equal every original including floors, missing values, money and alternate photos',async()=>{
 const data=fixture();
 data.items.forEach((item,n)=>{
  Object.assign(item,{tradeType:mode==='lease'?'lease':'sale',saleCategory:mode==='lease'?'':'land',type:mode==='lease'?'상가점포':'토지',deposit:1000+n*1000,rent:50+n*10,premium:n*100,fee:5,area:20+n*5,room:n===0?'지하1층':n===1?'미확인':n+'층',floor:n===0?-1:n===1?null:n});
  item.saleDetails.landUse=n%2?'대':'전';item.saleDetails.zoning=n%2?'제2종일반주거지역':'자연녹지지역';
  data.metadata.groups[item.propertyId].forEach((ad,a)=>Object.assign(ad,{tradeType:item.tradeType,saleCategory:item.saleCategory,type:item.type,deposit:item.deposit+a*1000,rent:item.rent+a*20,premium:item.premium+a*100,area:item.area+a*3,room:item.room,floor:a?1:item.floor,saleSummary:item.saleDetails}));
 });
 const runMode=(filters={},captureNumericV177=null)=>runSnapshotQueryV151({items:structuredClone(data.items),metadata:data.metadata,stream:new Blob([JSON.stringify(data.metadata)]).stream(),captureNumericV177},{mode,filters,individualQueryV152:true},2);
 const groups=new Map(),rows=await runMode({},r=>{const g=groups.get(r.propertyId)||[];g.push(r);groups.set(r.propertyId,g);});
 const packet=numericCatalogPacketV177(rows,groups,'all-market-v215',mode),context=await setup(),prepared=context.JSQueryNumericV177.prepare(packet);assert.ok(prepared);
 const filters=mode==='lease'?[{minFloor:'1',maxFloor:'1'},{minFloor:'2',maxFloor:'-1'},{minFloor:'지하1층',maxFloor:'1층'},{floorQuickFilter:'unknown'},{floorQuickFilter:'first'},{floorQuickFilter:'basement'},{floorQuickFilter:'upper'},{minDeposit:'2,000',maxDeposit:'7,000'},{minRent:'70',maxRent:'90'},{minPremium:'100',maxPremium:'400'},{minArea:'25',maxArea:'40'},{brokerageFeeFilter:'100-over'},{typeFilter:'상가점포'},{minFloor:'1',maxFloor:'1',minRent:'60'},{}]:[{minDeposit:'50000',maxDeposit:'120000'},{saleLandMin:'80',saleLandMax:'130'},{saleUnitPriceMin:'500'},{saleUnitPriceMax:'700'},{saleLandUseFilter:'대'},{saleZoningFilter:'주거'},{saleLandMin:'50',saleLandUseFilter:'전'},{}];
 for(const f of filters){const actual=context.JSQueryNumericV177.filter(prepared,{mode,filters:f}),expected=queryWireV151(await runMode(f),'all-market-v215');assert.ok(actual,JSON.stringify(f));delete actual.numericLocalV177;delete actual.numericCatalogV177;assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,JSON.stringify(f));}
 assert.equal(context.JSQueryNumericV177.filter(prepared,{mode:mode==='lease'?'land_sale':'lease',filters:{}}),null,'Never use another market catalog');
 assert.equal(context.JSQueryNumericV177.filter(prepared,{mode,filters:{keyword:'1-1'}}),null,'Bare parcels in lease/land require the unchanged full text matcher');
 const exact=context.JSQueryNumericV177.filter(prepared,{mode,filters:{keyword:'괴정동1-1'}});delete exact.numericLocalV177;delete exact.numericCatalogV177;assert.deepEqual(JSON.parse(JSON.stringify(exact)),queryWireV151(await runMode({keyword:'괴정동1-1'}),'all-market-v215'));

 assert.equal(JSON.stringify(packet).includes('수동 메모'),false);
 const changed=data.items[0].propertyId,removed=data.items.at(-1).propertyId;
 data.items[0].sourceSnapshotKey='sha256-v1:'+'d'.repeat(64);data.metadata.sourceSnapshotKeys[changed]=data.items[0].sourceSnapshotKey;
 data.metadata.groups[changed][0].rent+=10;data.metadata.groups[changed][0].salePrice+=2000;
 data.items=data.items.filter(item=>item.propertyId!==removed);for(const key of ['groups','sourceSnapshotKeys','sourceSnapshotPropertyIds'])delete data.metadata[key][removed];
 const nextGroups=new Map(),nextRows=await runMode({},r=>{const g=nextGroups.get(r.propertyId)||[];g.push(r);nextGroups.set(r.propertyId,g);});
 const next=numericCatalogPacketV177(nextRows,nextGroups,'after-v215',mode),delta=await queryDeltaV160({state:{revision:'after-v215'},since:packet.revision,changes:()=>[changed,removed],loadPacket:async()=>next});
 assert.equal(delta.numericCatalogDeltaV215.groups.length,1,'Only the changed multi-ad group is sent');
 const patched=context.JSQueryCollectionV152.applyDeltaV160(packet,delta),after=context.JSQueryNumericV177.prepare(patched);assert.ok(after);
 for(const f of filters){const actual=context.JSQueryNumericV177.filter(after,{mode,filters:f});delete actual.numericLocalV177;delete actual.numericCatalogV177;assert.deepEqual(JSON.parse(JSON.stringify(actual)),queryWireV151(await runMode(f),'after-v215'));}
 for(const patch of [{...delta.numericCatalogDeltaV215,marketV215:mode==='lease'?'land_sale':'lease'}, {...delta.numericCatalogDeltaV215,groups:[[data.items[1].propertyId,[]]]}])assert.throws(()=>context.JSQueryCollectionV152.applyDeltaV160(packet,{...delta,numericCatalogDeltaV215:patch}));
});
