import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const resolver=readFileSync('js/map-address-region-v1.js','utf8');
const mapSource=readFileSync('js/map.js','utf8');
const ast=ts.createSourceFile('map.js',mapSource,ts.ScriptTarget.Latest,true);
const names=new Set(['getAddressAdminRegionV655','createAdministrativeClustersV655','getAdministrativeListItemsV6570',
  'getAdministrativeClusterModeV655','createClustersForCurrentZoomV655']);
const mapRuntime=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const road='대덕구 대덕대로1470번길 27';
const full='대전광역시 '+road;
const parcel='대전 대덕구 목상동 150-4';
function row(roadAddress=full,parcelAddress=parcel){return {road_address:{address_name:roadAddress},address:{address_name:parcelAddress}};}
function harness(saved,blocked=false){
  let now=1000000000,id=0,notified=0;
  const timers=new Map(),stored=new Map(saved?[['JS_MAP_PARCEL_REGIONS_V1',JSON.stringify(saved)]]:[]),reads=[];
  const ctx={Date:{now:()=>now},Set,console,localStorage:{getItem:k=>stored.get(k)||null,setItem(k,v){if(blocked)throw new Error('quota');stored.set(k,v);}},
    setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    kakao:{maps:{services:{Status:{OK:'OK'},AnalyzeType:{EXACT:'exact'}}}}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(resolver,ctx);
  const geocoder={addressSearch(query,done,options){reads.push({query,done,options});}};
  function tick(ms){const until=now+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=next[1].at;next[1].fn();}now=until;}
  return {ctx,reads,stored,tick,geocoder,api:ctx.JSMapAddressRegionV1,notify:()=>notified++,notifications:()=>notified};
}
test('exact road lookup deduplicates room/floor variants, persists a parcel, and leaves inputs untouched',()=>{
  const h=harness(),groups=[{address:road+' 1층'},{address:full+' 2층'}],before=JSON.stringify(groups);
  h.api.request(groups,h.geocoder,h.notify);h.api.request(groups,h.geocoder,h.notify);
  assert.equal(h.reads.length,1);assert.equal(h.reads[0].query,full);assert.equal(h.reads[0].options.analyze_type,'exact');
  h.reads[0].done([row()],'OK');h.tick(600);
  assert.equal(h.api.read(road),parcel);assert.equal(h.notifications(),1);assert.equal(JSON.stringify(groups),before);
  const restored=harness(JSON.parse(h.stored.get('JS_MAP_PARCEL_REGIONS_V1')));
  assert.equal(restored.api.read(full),parcel);restored.api.request(groups,restored.geocoder,restored.notify);assert.equal(restored.reads.length,0);
});
for(const [label,rows] of [
  ['another house number',[row(full.replace('27','28'))]],
  ['another road',[row('대전 대덕구 중리북로 46')]],
  ['another city',[row('부산 대덕구 대덕대로1470번길 27','부산 대덕구 목상동 150-4')]],
  ['another district',[row(full,'대전 서구 목상동 150-4')]],
  ['no parcel',[{road_address:{address_name:full}}]],
  ['ambiguous parcel',[row(),row(full,'대전 대덕구 신일동 20')]]
])test('rejects '+label+' without guessing or hiding ads',()=>{
  const h=harness();h.api.request([{address:road}],h.geocoder,h.notify);h.reads[0].done(rows,'OK');h.tick(1000);
  assert.equal(h.api.read(road),'');assert.equal(h.notifications(),0);h.api.request([{address:road}],h.geocoder,h.notify);assert.equal(h.reads.length,1);
});
test('timeout releases the single-flight queue, ignores late replies and bounds retries',()=>{
  const h=harness(),other='대덕구 중리북로 46';h.api.request([{address:road},{address:other}],h.geocoder,h.notify);
  assert.equal(h.reads.length,1);h.tick(8200);assert.equal(h.reads.length,2);
  h.reads[0].done([row()],'OK');assert.equal(h.api.read(road),'');
  h.reads[1].done([row('대전 '+other,'대전 대덕구 법동 280-2')],'OK');h.tick(600);
  assert.equal(h.api.read(other),'대전 대덕구 법동 280-2');
  h.api.request([{address:road}],h.geocoder,h.notify);assert.equal(h.reads.length,2);
  h.tick(5*60000);h.api.request([{address:road}],h.geocoder,h.notify);assert.equal(h.reads.length,3);
});
test('cache quota failure does not prevent classification; other-city inputs never start a request',()=>{
  const h=harness(null,true);h.api.request([{address:'부산 동구 중앙대로 10'},{address:road}],h.geocoder,h.notify);
  assert.equal(h.reads.length,1);h.reads[0].done([row()],'OK');h.tick(600);assert.equal(h.api.read(road),parcel);assert.equal(h.notifications(),1);
});
test('road-only ads stay as spatial clusters, then join the legal dong and its selected list without changing addresses or keys',()=>{
  const h=harness();vm.runInContext(mapRuntime,h.ctx);
  class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
  Object.assign(h.ctx,{geocoder:h.geocoder,map:{getLevel:()=>7},isRendering:false,jsAdministrativeListSelectionV6570:null,
    shouldUseWorldGridClustersV690:()=>true,filterClustersToMapViewportV690:items=>items,
    resolveAdministrativeClusterPositionsV656:items=>items,createWorldGridClustersV690:groups=>groups.map(g=>({worldGrid:true,items:g.items})),
    drawMapClustersOnlyV639(){},jsLastRenderedItemsV639:[]});
  h.ctx.kakao.maps.LatLng=LatLng;
  const item={propertyId:'road-1',address:road},known={propertyId:'known-1',address:'대전 대덕구 목상동 99'};
  const groups=[{address:road,latlng:new LatLng(36.4,127.4),items:[item]},
    {address:known.address,latlng:new LatLng(36.41,127.41),items:[known]}],before=JSON.stringify(groups);
  const initial=h.ctx.createClustersForCurrentZoomV655(groups);
  assert.deepEqual(Array.from(initial,c=>c.regionLabel||'numeric'),['목상동','numeric']);
  assert.equal(initial.reduce((n,c)=>n+c.items.length,0),2);
  h.reads[0].done([row()],'OK');h.tick(600);
  const resolved=h.ctx.createClustersForCurrentZoomV655(groups);
  assert.equal(resolved.length,1);assert.equal(resolved[0].regionLabel,'목상동');assert.equal(resolved[0].items.length,2);
  h.ctx.jsAdministrativeListSelectionV6570={mode:'neighborhood',regionLabel:'목상동',districtLabel:'대덕구'};
  assert.equal(h.ctx.getAdministrativeListItemsV6570([item,known]).length,2);
  assert.equal(JSON.stringify(groups),before);
});
