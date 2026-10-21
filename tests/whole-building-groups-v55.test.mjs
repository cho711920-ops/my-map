import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {withSaleExtentDisplay} from '../cloudflare/src/sale-extent-display.js';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';
import {loadManualRepresentativeFields,withSourceOriginalMetadata} from '../cloudflare/src/source-original-display.js';

function original(id,patch={}) {
  const displayed=withSaleExtentDisplay({originalId:'source-'+id,propertyId:id,tradeType:'sale',saleCategory:'house',source:'네이버',
    address:'서구 갈마동 1197',buildingName:'다가구',salePrice:63000,active:1,photoCount:0,
    saleDetails:{descriptionText:'건물 전체 매매',totalDeposit:9500,monthlyIncome:394}},
  {source:'네이버',propertyType:'C03',floorInfo:{residenceType:'2',targetFloor:'-'}});
  return {...displayed,saleSummary:compactSaleSummary(displayed),...patch};
}
function master(id,patch={}) {return {propertyId:id,key:'saved-'+id,address:'서구 갈마동 1197',tradeType:'sale',saleCategory:'house',state:'미확인',memo:'메모-'+id,...patch};}
function harness(items,groups) {
  const reads=[];
  const document={addEventListener(){},getElementById(){return null;}};
  const w={innerWidth:390,allItems:items,currentItems:[],hideDone:true,addEventListener(){},JSDataAccessV6:{read(action,params){reads.push({action,params});return Promise.resolve({ok:true,originals:groups[params.propertyId]||[]});}}};
  const context=vm.createContext({window:w,document,console});
  vm.runInContext(fs.readFileSync('js/parcel-external-links-v1.js','utf8'),context);
  vm.runInContext(fs.readFileSync('js/unified-listings-v8.js','utf8').replace('global.JSUnifiedListingsV8 = {',
    'global.__v55={loadDetail:loadDetail,prepare:prepareDetailOriginals,state:state,originalRow:originalRow};global.JSUnifiedListingsV8 = {'),context);
  const api=w.JSUnifiedListingsV8;api.attach(items,{ok:true,groups});
  const collapse=(values=items)=>api.collapseWholeBuildingSalesV55(values.map(item=>api.filterItemForView(item,()=>true,'active')).filter(Boolean));
  return {w,api,reads,collapse};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('same exact parcel and proven whole-building ads group across categories without changing stored IDs or values',()=>{
  const a=master('A'),b=master('B',{saleCategory:'multifamily'}),groups={A:[original('A')],B:[original('B',{saleCategory:'multifamily',salePrice:65000,saleSummary:{saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,totalDeposit:9800,monthlyIncome:410}})]};
  const before=plain([a,b]),h=harness([a,b],groups),view=h.collapse();
  assert.equal(view.length,1);assert.equal(view[0].unifiedOriginalCountV8,2);
  assert.equal(view[0].salePrice,63000);assert.equal(view[0].saleDetails.totalDeposit,9500);assert.equal(view[0].saleDetails.monthlyIncome,394);
  assert.deepEqual(plain(view[0].wholeBuildingMembersV55),['A','B']);
  assert.equal(view[0].unifiedDisplayOriginalsV2[1].saleSummary.totalDeposit,9800);
  for(let i=0;i<2;i++)for(const key of ['propertyId','key','memo','state'])assert.equal([a,b][i][key],before[i][key]);
  assert.equal(h.api.allOriginals('A').length,1);assert.equal(h.api.allOriginals('B').length,1);
  assert.equal(h.reads.length,0);
});

test('a filtered favorite keeps its exact saved ID, and filtered-out ads are not borrowed',()=>{
  const items=[master('A'),master('B')],h=harness(items,{A:[original('A')],B:[original('B')]});
  assert.deepEqual(plain(h.collapse([items[1]]).map(x=>x.propertyId)),['B']);
  const filtered=items.map(item=>h.api.filterItemForView(item,probe=>probe.propertyId==='B','active')).filter(Boolean);
  assert.equal(h.api.collapseWholeBuildingSalesV55(filtered)[0].unifiedOriginalCountV8,1);
});

test('unit, unknown, land, manually separated, manually changed scope and completed listings remain separate',()=>{
  for(const change of [o=>{o.saleSummary.saleExtent='unit';},o=>{o.saleSummary.saleExtent='unknown';},
    o=>{o.saleCategory='land';},o=>{o.saleGroupingSeparatedV55=true;},o=>{o.hasManualRoomOverride=true;},
    o=>{o.manualDisplayFields='sale_details_json';},o=>{o.saleSummary.wholeBuildingGroupEligibleV55=false;}]){
    const b=original('B');change(b);
    const h=harness([master('A'),master('B')],{A:[original('A')],B:[b]});assert.equal(h.collapse().length,2);
  }
  const h=harness([master('A'),master('B',{state:'계약완료'})],{A:[original('A')],B:[original('B')]});
  assert.equal(h.api.collapseWholeBuildingSalesV55(h.w.allItems).length,2);
});

test('district, sublot, mountain, roads, partial/hidden addresses and missing district are not guessed',()=>{
  for(const address of ['중구 갈마동 1197','서구 갈마동 1197-1','서구 갈마동 산 1197','서구 갈마로 1197','서구 갈마동 1197 외 1필지','갈마동 1197','대전 갈마동 1197']){
    const h=harness([master('A'),master('B',{address})],{A:[original('A')],B:[original('B',{address})]});assert.equal(h.collapse().length,2,address);
  }
  const h=harness([master('A'),master('B',{address:'대전광역시 서구 갈마동 1197'})],{A:[original('A')],B:[original('B',{address:'대전 서구 갈마동 1197'})]});
  assert.equal(h.collapse().length,1);
});

test('source extent selection cannot override fractional, individual or multiple-building evidence for grouping',()=>{
  for(const descriptionText of ['지분 50% 매매','301호만 매매','2층만 매매','건물 일부만 매매','건물 총2동 일괄매매','A동 건물전체 매매','복합상가 전체 매매','단지내상가 전체 매매']){
    const o=withSaleExtentDisplay({tradeType:'sale',saleCategory:'house',saleDetails:{descriptionText}},
      {source:'네이버',propertyType:'C03',floorInfo:{residenceType:'2',targetFloor:'-'}});
    assert.equal(o.saleDetails.wholeBuildingGroupEligibleV55,false,descriptionText);
  }
  assert.equal(original('A').saleSummary.wholeBuildingGroupEligibleV55,true);
});

test('manual source separation survives metadata reload',async()=>{
  const db={prepare(){return {bind(){return this;},async all(){return {results:[{listing_id:'B',action:'separateOriginalListing',before_fields:'{}',after_fields:'{}'}]};}};}};
  const manual=await loadManualRepresentativeFields({DB:db});
  const o=withSourceOriginalMetadata(original('B'),{id:'source-B',listing_id:'B',active:1},new Map(),manual);
  assert.equal(o.saleGroupingSeparatedV55,true);
});

test('group detail reads each real parent and keeps each cache/source identity separate',async()=>{
  const groups={A:[original('A')],B:[original('B')]},h=harness([master('A'),master('B')],groups);
  h.w.currentItems=h.collapse();
  const detail=await h.w.__v55.loadDetail('A');
  assert.deepEqual(h.reads.map(x=>x.params.propertyId),['A','B']);
  assert.deepEqual(plain(detail.map(x=>x.propertyId)),['A','B']);
  assert.equal(h.w.__v55.state.detailCache.A.length,1);assert.equal(h.w.__v55.state.detailCache.B.length,1);
  const prepared=h.w.__v55.prepare('A',detail,'source-B',{forceFresh:true});
  assert.equal(prepared.retry,false);assert.equal(prepared.selected.originalId,'source-B');
  assert.equal(h.api.allOriginals('A').length,1);assert.equal(h.api.allOriginals('B').length,1);
  await h.w.__v55.loadDetail('A');assert.equal(h.reads.length,2);
});

test('a failed member never caches a partial aggregate as a successful whole-building response',async()=>{
  const h=harness([master('A'),master('B')],{A:[original('A')],B:[original('B')]});h.w.currentItems=h.collapse();
  h.w.JSDataAccessV6.read=(action,p)=>p.propertyId==='B'?Promise.reject(Error('offline')):Promise.resolve({ok:true,originals:[original('A')]});
  await assert.rejects(h.w.__v55.loadDetail('A'),/offline/);
  assert.equal(h.w.__v55.state.detailCache.A.length,1);assert.equal(h.w.__v55.state.detailCache.B,undefined);
});

test('printing an alternate representative requests that original own parent',async()=>{
  const h=harness([master('A'),master('B')],{A:[original('A')],B:[original('B')]});
  const item={...h.w.allItems[0],unifiedFilterOriginalV2:original('B'),unifiedOriginalsV8:[original('B')]};
  await h.api.printItem(item);assert.equal(h.reads[0].params.propertyId,'B');
});

test('fresh scope correction splits the view again and cannot show a different ad under the requested ID',async()=>{
  const h=harness([master('A'),master('B')],{A:[original('A')],B:[original('B')]});
  h.w.currentItems=h.collapse();h.w.applyFilter=()=>{h.w.currentItems=h.collapse();};
  const b=original('B',{saleSummary:{saleExtent:'unit',wholeBuildingGroupEligibleV55:false}});
  const prepared=h.w.__v55.prepare('A',[original('A'),b],'source-B',{forceFresh:true});
  assert.equal(h.w.currentItems.length,2);assert.equal(prepared.originals.length,0);assert.equal(prepared.retry,false);
  assert.equal(h.w.__v55.state.detailStatus.A,'filtered');
  assert.equal(h.api.allOriginals('B')[0].saleSummary.saleExtent,'unit');
});

test('group detail fan-out is bounded to three in flight',async()=>{
  const ids=Array.from({length:8},(_,i)=>String(i)),items=ids.map(id=>master(id)),groups=Object.fromEntries(ids.map(id=>[id,[original(id)]]));
  const h=harness(items,groups);h.w.currentItems=h.collapse();let running=0,peak=0;
  h.w.JSDataAccessV6.read=async(action,p)=>{running++;peak=Math.max(peak,running);await new Promise(resolve=>setTimeout(resolve,2));running--;return {ok:true,originals:groups[p.propertyId]};};
  assert.equal((await h.w.__v55.loadDetail('0')).length,8);assert.equal(peak,3);
});

test('an ended candidate unit sibling is not folded into the whole building when completed ads are visible',()=>{
  const candidate=original('B',{originalId:'unit-B',active:0,sourceUnavailable:true,candidateEligible:true,availabilityKind:'census_missing',
    saleSummary:{saleExtent:'unit'}});
  const h=harness([master('A'),master('B')],{A:[original('A')],B:[original('B'),candidate]});
  h.w.hideDone=false;
  const view=h.api.collapseWholeBuildingSalesV55(h.w.allItems.map(x=>h.api.filterItemForView(x,()=>true,'all')));
  assert.equal(view.length,2);assert.equal(view[1].unifiedOriginalCountV8,2);
});
