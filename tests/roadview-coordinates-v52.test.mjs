import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('js/script.js','utf8');
const ast=ts.createSourceFile('script.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['getItemCoordinates','roadviewRoadAddressV52','resolveRoadviewCoordinatesV52','recheckAddressV41','addressParcelForReviewV41']);
const runtime=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
function setup(){
  const state={calls:0};
  const context=vm.createContext({console,setTimeout,clearTimeout,Map,Promise});context.window=context;
  vm.runInContext(fs.readFileSync('js/parcel-external-links-v1.js','utf8'),context);
  context.kakao={maps:{services:{Status:{OK:'OK'},Geocoder:function(){this.addressSearch=(query,callback,options)=>{state.calls++;state.query=query;state.callback=callback;state.options=options;};}}}};
  vm.runInContext('var roadviewCoordinateRequestsV52=new Map();\n'+runtime,context);
  return {context,state};
}
test('roadview coordinates accept numeric storage and SDK/plain points, and reject missing/invalid pairs',()=>{
  const {context:c}=setup();
  for(const item of [{latitude:36.35,longitude:127.4},{lat:'36.35',lng:'127.4'},
    {latlng:{lat:36.35,lng:127.4}},{latlng:{getLat:()=>36.35,getLng:()=>127.4}},
    {latlng:{getLat:()=>{throw Error('stale object');}},latitude:36.35,longitude:127.4}]){
    assert.deepEqual(JSON.parse(JSON.stringify(c.getItemCoordinates(item))),{lat:36.35,lng:127.4});
  }
  for(const item of [null,{}, {latitude:null,longitude:127.4},{latitude:'',longitude:127.4},
    {latitude:0,longitude:0},{latitude:91,longitude:127.4},{latitude:36.35,longitude:181},
    {latlng:{lat:NaN,lng:127.4}}]) assert.equal(c.getItemCoordinates(item),null);
});
test('stored coordinates bypass all lookup; exact road lookup shares pending work and can retry after rejection',async()=>{
  const {context:c,state:s}=setup();
  await c.resolveRoadviewCoordinatesV52({latitude:36.35,longitude:127.4});assert.equal(s.calls,0);
  const item={address:'대덕구 한밭대로 123'};
  const first=c.resolveRoadviewCoordinatesV52(item),second=c.resolveRoadviewCoordinatesV52(item);
  assert.equal(first,second);assert.equal(s.calls,1);assert.equal(s.options.analyze_type,'exact');
  s.callback([{x:'127.4',y:'36.35',road_address:{address_name:'대전광역시 대덕구 한밭대로 124'}}],'OK');
  await assert.rejects(first,/정확히 일치/);
  const retry=c.resolveRoadviewCoordinatesV52(item);assert.equal(s.calls,2);
  s.callback([{x:'127.4',y:'36.35',road_address:{address_name:s.query}}],'OK');
  assert.equal((await retry).lat,36.35);assert.equal(item.latlng,undefined);
});
test('exact parcel check rejects a neighboring lot and ambiguous or invalid road results',async()=>{
  const {context:c,state:s}=setup();
  const pending=c.resolveRoadviewCoordinatesV52({address:'대덕구 중리동 254-6'});
  s.callback([{x:'127.4',y:'36.35',address:{address_name:'대전광역시 대덕구 중리동 254-7',b_code:'3023010900',main_address_no:'254',sub_address_no:'7',mountain_yn:'N'}}],'OK');
  await assert.rejects(pending,/일치하는 필지/);
  const success=c.resolveRoadviewCoordinatesV52({address:'대덕구 중리동 254-6'});
  s.callback([{x:'127.4',y:'36.35',address:{address_name:'대전광역시 대덕구 중리동 254-6',b_code:'3023010900',main_address_no:'254',sub_address_no:'6',mountain_yn:'N'}}],'OK');
  assert.equal((await success).lng,127.4);
  for(const rows of [[],[{x:'0',y:'0'}],
    [{x:'127.4',y:'36.35'},{x:'127.41',y:'36.35'}].map(row=>({...row,road_address:{address_name:'대전광역시 서구 계룡로 123'}}))]){
    const lookup=c.resolveRoadviewCoordinatesV52({address:'서구 계룡로 123'});s.callback(rows,'OK');await assert.rejects(lookup,/확인하지 못했습니다/);
  }
  const calls=s.calls;
  for(const address of ['중리동','중리동 1층','서구 계룡로','서구 계룡로 123 2층'])await assert.rejects(c.resolveRoadviewCoordinatesV52({address}),/정확한 지번/);
  assert.equal(s.calls,calls);
});
