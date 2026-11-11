import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {queryWireV151,numericCatalogPacketV177}=await import('../cloudflare/src/query-worker-v151.js');
const {createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
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
context.JSSaleWorkbenchV1={matches:(r,f)=>runtime.preparedMatchesV176(r,{mode:'building_sale',filters:f})};return context;}
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
