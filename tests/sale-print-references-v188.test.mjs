import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const now=new Date().toISOString(),pnu='3017010800100520020',address='대전광역시 서구 괴정동 52-20';
const parcel={sigunguCd:'30170',bjdongCd:'10800',platGbCd:'0',bun:'0052',ji:'0020'};
const item={propertyId:'EXACT-ID',address,name:'검수 건물',tradeType:'sale',saleCategory:'building',salePrice:80000,memo:'직접 작성 보존',saleDetails:{landAreaM2:165.2,grossAreaM2:191.8,totalDeposit:2000,monthlyIncome:100}};
const building={ok:true,action:'buildingRegister',parcel,source:'국토교통부 건축HUB 건축물대장정보 서비스',fetchedAt:now,partial:true,detailsPending:true,buildings:[{lotAddress:address,buildingName:'검수 건물',siteArea:170,buildingArea:100,totalArea:200,mainUse:'제2종근린생활시설',approvalDate:'20040304',groundFloors:3,undergroundFloors:1}],recordCounts:{buildings:1}};
const land={ok:true,action:'saleParcelFacts',pnu,address,fetchedAt:now,complete:true,areaM2:170,landUse:'대',source:'토지이음 공개 열람',price:{available:true,wonPerM2:2000000,baseYear:2026,baseMonth:1},regulations:[{label:'국토계획법에 따른 지역·지구',available:true,complete:true,items:[{label:'제2종일반주거지역'}]}]};
function research(overrides={}){
  const calls=[];const w={JSAuthenticatedAccountEmail:'test@example.invalid',location:{origin:'https://example.invalid'},JSListingTradeV1:{normalizedSaleCategory:i=>i.saleCategory}};
  vm.runInNewContext(fs.readFileSync('js/parcel-external-links-v1.js','utf8'),{window:w});
  w.JSParcelExternalLinksV1.resolve=async()=>({pnu,address});
  w.fetch=async input=>{const url=new URL(input);calls.push(url);assert.equal(url.searchParams.get('expectedAccountEmail'),w.JSAuthenticatedAccountEmail);assert.equal(url.searchParams.has('propertyId'),false);return {ok:true,json:async()=>structuredClone(url.searchParams.get('action')==='buildingRegister'?{...building,...overrides.building}:{...land,...overrides.land})};};
  vm.runInNewContext(fs.readFileSync('js/sale-public-review-v6.js','utf8'),{window:w,URL,AbortSignal});
  return {w,calls,api:w.JSSalePublicReviewV6};
}
test('printing explicitly reads exact parcel public data, shares duplicate reads and never persists a badge',async()=>{
  const {api,calls}=research();assert.equal(calls.length,0);
  const before=JSON.stringify(item);const refs=await Promise.all([api.referencesForPrint(item),api.referencesForPrint(item)]);
  assert.equal(calls.length,2);assert.equal(refs[0].building.data.buildings[0].totalArea,200);assert.equal(refs[0].land.data.areaM2,170);
  assert.equal(calls.find(u=>u.searchParams.get('action')==='buildingRegister').searchParams.get('mode'),'summary');
  await api.referencesForPrint(item);assert.equal(calls.length,2);assert.equal(JSON.stringify(item),before);
});
test('crossed parcels and missing lookup times cannot be printed as official facts',async()=>{
  for(const value of [{parcel:{...parcel,bun:'9999'}},{buildings:[{...building.buildings[0],lotAddress:'서구 괴정동 99-1'}]},{fetchedAt:''}]){
    const {api}=research({building:value});const ref=await api.referencesForPrint(item);assert.equal(ref.building.data,undefined);assert.ok(ref.building.error);assert.equal(ref.land.data.pnu,pnu);
  }
  const {api}=research({land:{pnu:'3017010800100990001'}});const ref=await api.referencesForPrint(item);assert.ok(ref.land.error);assert.ok(ref.building.data);
});
test('partial and multiple buildings remain separate, and account/address changes reject the operation',async()=>{
  const {api}=research({building:{incomplete:true,truncated:true,buildings:[building.buildings[0],{...building.buildings[0],dongName:'별동'}]}});
  const ref=await api.referencesForPrint(item);assert.equal(ref.building.data.buildings.length,2);assert.equal(ref.building.data.incomplete,true);
  await assert.rejects(()=>api.referencesForPrint({...item,referenceAddressChangedV8:true}));
  const changed=research();changed.w.JSParcelExternalLinksV1.resolve=async()=>{changed.w.JSAuthenticatedAccountEmail='other@example.invalid';return {pnu,address};};
  await assert.rejects(()=>changed.api.referencesForPrint(item));assert.equal(changed.calls.length,0);
});
async function render(references){
  let html='';const w={addEventListener(){},dispatchEvent(){},JSAuthenticatedAccountEmail:'test@example.invalid',selectedPrintKeys:['EXACT-ID'],open:()=>({closed:false,document:{open(){},write(v){html=v;},close(){}}}),JSSalePublicReviewV6:{referencesForPrint:async()=>references}};
  const context={window:w,CustomEvent:class{},document:{documentElement:{setAttribute(){}},addEventListener(){},getElementById:()=>null,querySelector:()=>null},getSelectedPrintItems:()=>[item],isDone:()=>false,alert:assert.fail};
  for(const file of ['listing-trade-ui-v1.js','print-v2.js'])vm.runInNewContext(fs.readFileSync('js/'+file,'utf8'),context);
  await w.printSelectedList();return html;
}
test('advertisement conditions and public facts are printed separately with conflicts, source and date',async()=>{
  const html=await render({pnu,address,building:{data:building},land:{data:land}});
  for(const v of ['광고·직접 수정 조건','건축물대장 · 공적 조회자료','토지이음 · 공적 조회자료','표기 차이','191.8㎡','200㎡','제2종근린생활시설','2026.01 기준','2,000,000원/㎡','제2종일반주거지역','2004-03-04','지하 1층 · 지상 3층','전화번호','직접 작성 보존'])assert.ok(html.includes(v),v);
  assert.match(html,/공적자료는 별도 구역의 출처·조회시각 기준/);assert.equal(item.saleDetails.grossAreaM2,191.8);
});
test('public lookup failures are visible and never filled from advertisement area or zero',async()=>{
  const html=await render({building:{error:'대장 조회 실패'},land:{error:'토지이음 조회 실패'}});
  assert.match(html,/대장 조회 실패/);assert.match(html,/토지이음 조회 실패/);assert.match(html,/대장 확인값이 아닙니다/);
  const official=html.slice(html.indexOf('<section class="sale-print-official">'));
  assert.doesNotMatch(official,/165\.2㎡|191\.8㎡|0㎡/);
});
