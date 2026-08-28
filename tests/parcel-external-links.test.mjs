import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script=fs.readFileSync('js/parcel-external-links-v1.js','utf8');
const sample={address:{address_name:'대전 서구 도마동 49-38',b_code:'3017010300',main_address_no:'49',sub_address_no:'38',mountain_yn:'N'}};
function setup() {
  const calls=[],timers=new Map();let id=0;
  const window={setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(i){timers.delete(i);},kakao:{maps:{services:{Status:{OK:'OK'},AnalyzeType:{EXACT:'exact'},Geocoder:function(){this.addressSearch=(...args)=>calls.push(args);}}}}};
  vm.runInNewContext(script,{window});
  return {api:window.JSParcelExternalLinksV1,window,calls,timers};
}
test('full, short Daejeon, compact lot and mountain addresses normalize without guessing a lot',()=>{
  const {api}=setup();
  for(const raw of ['서구 도마동49-38','대전 서구 도마동 49 - 38번지','대전광역시 서구 도마동 0049-0038'])
    assert.equal(api.parseAddress(raw)?.query,'대전광역시 서구 도마동 49-38');
  assert.equal(api.parseAddress('충남 공주시 반포면 학봉리 산 10-2')?.query,'충청남도 공주시 반포면 학봉리 산 10-2');
  assert.equal(api.parseAddress('서울 중구 충무로1가 21')?.query,'서울특별시 중구 충무로1가 21');
  assert.equal(api.parseAddress('세종 조치원읍 신흥리 1')?.query,'세종특별자치시 조치원읍 신흥리 1');
  assert.equal(api.parseAddress('부산 서구 동대신동1가 1')?.query,'부산광역시 서구 동대신동1가 1');
  assert.equal(api.parseAddress('전북 전주시 완산구 교동 1')?.query,'전북특별자치도 전주시 완산구 교동 1');
});
test('unknown, road, floor, multi-lot and malformed addresses cannot be resolved',async()=>{
  const {api,calls}=setup();
  for(const address of ['',null,'서구 도마동','서구 도마동1층','도마동 49-38','서구 도마동 49-38 외 1필지','서구 도마동 49-38, 49-39','대전 서구 계백로 100','대전 서구 도마동 0','대전 서구 도마동 49-38 101호','<img src=x>']) {
    assert.equal(api.parseAddress(address),null,address);
    await assert.rejects(api.resolve(address),/정확한/);
  }
  assert.equal(calls.length,0);
});
test('PNU uses legal code and separately padded general/mountain lot numbers',()=>{
  const {api}=setup();
  assert.equal(api.matchParcel('서구 도마동49-38',[sample]).pnu,'3017010300100490038');
  assert.equal(api.matchParcel('서구 도마동 산 49',[{address:{...sample.address,address_name:'대전 서구 도마동 산49',mountain_yn:'Y',sub_address_no:''}}]).pnu,'3017010300200490000');
  assert.equal(api.matchParcel('서구 도마동49-38',[sample,sample]).pnu,'3017010300100490038');
});
test('nearby parcels, other districts, missingcode, mismatched lot numbers and ambiguous PNU are rejected',()=>{
  const {api}=setup();
  for(const patch of [{address_name:'대전 서구 도마동49-39'},{address_name:'부산 서구 도마동49-38'},{b_code:''},{b_code:'30170'},{main_address_no:'48'},{sub_address_no:'39'},{mountain_yn:'Y'},{mountain_yn:''}])
    assert.throws(()=>api.matchParcel('서구 도마동49-38',[{address:{...sample.address,...patch}}]),/일치/);
  assert.throws(()=>api.matchParcel('서구 도마동49-38',[sample,{address:{...sample.address,b_code:'3017010400'}}]),/여러 개/);
  assert.throws(()=>api.matchParcel('서구 도마동49-38',[{road_address:sample.address}]),/일치/);
});
test('external links are fixed verified hosts and encoded exact 19-digit parcel paths',()=>{
  const {api}=setup(),links=api.links('3017010300100490038');
  assert.equal(links.eum,'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?selGbn=umd&isNoScr=script&s_type=1&mode=search&add=land&pnu=3017010300100490038');
  assert.equal(links.valuemap,'https://www.valueupmap.com/properties/lands/3017010300100490038');
  for(const pnu of ['3017010300300490038','3017010300100000038','30170','3017010300100490038&evil=1','https://evil.test'])assert.throws(()=>api.links(pnu));
});
test('resolver requests EXACT and deduplicates in-flight/cached lookups without database writes',async()=>{
  const {api,calls,timers}=setup();const a=api.resolve('서구 도마동49-38'),b=api.resolve('대전 서구 도마동 49-38');
  assert.equal(calls.length,1);assert.equal(calls[0][0],'대전광역시 서구 도마동 49-38');assert.equal(calls[0][2].analyze_type,'exact');
  calls[0][1]([sample],'OK');assert.equal((await a).pnu,(await b).pnu);assert.equal(timers.size,0);
  await api.resolve('서구 도마동49-38');assert.equal(calls.length,1);
});
test('errors and missing SDK can be retried; no fallback to an approximate location',async()=>{
  const {api,window,calls}=setup();const services=window.kakao;delete window.kakao;
  await assert.rejects(api.resolve('서구 도마동49-38'),/준비되지/);window.kakao=services;
  let a=api.resolve('서구 도마동49-38');calls[0][1]([],'ERROR');await assert.rejects(a,/실패/);
  a=api.resolve('서구 도마동49-38');calls[1][1]([],'OK');await assert.rejects(a,/일치/);
  a=api.resolve('서구 도마동49-38');calls[2][1]([sample],'OK');assert.equal((await a).pnu,'3017010300100490038');
});
test('timeout ignores late callback, clears pending and permits a fresh lookup',async()=>{
  const {api,calls,timers}=setup();const a=api.resolve('서구 도마동49-38');
  [...timers.values()][0]();await assert.rejects(a,/초과/);calls[0][1]([sample],'OK');
  const b=api.resolve('서구 도마동49-38');assert.equal(calls.length,2);calls[1][1]([sample],'OK');await b;
});
test('dependency loads before workbench within authenticated critical scripts',()=>{
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/<script data-auth-critical src="js\/parcel-external-links-v1.js/);
  assert.ok(html.indexOf('js/parcel-external-links-v1.js')<html.indexOf('js/sale-workbench-v1.js'));
  assert.doesNotMatch(script,/coord2|localStorage|JSDataAccess|fetch\(/);
});

function workbench() {
  const dialogs=[],requests=[];
  function element(){return {dataset:{},attributes:{},events:{},value:'',textContent:'',disabled:false,setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];if(k==='href')delete this.href;},addEventListener(k,fn){this.events[k]=fn;}};}
  const window={addEventListener(){},JSParcelExternalLinksV1:{parseAddress:setup().api.parseAddress,resolve(query){return new Promise((resolve,reject)=>requests.push({query,resolve,reject}));}}};
  const document={documentElement:{setAttribute(){}},addEventListener(){},querySelector(){return null;},getElementById(id){return id==='saleWorkbenchDialogV1'?dialogs.find(d=>d.isConnected):null;},body:{append(d){d.isConnected=true;}},createElement(){
    const d=element(),selectors=Object.fromEntries(['input','[data-lookup-status]','[data-check-parcel]','[data-copy-address]','[data-copy-status]','[data-sale-close]'].map(k=>[k,element()]));
    const links=['eum','valuemap'].map(k=>{const e=element();e.dataset.parcelLink=k;return e;});
    Object.defineProperty(d,'innerHTML',{set(html){selectors.input.value=html.match(/aria-label="조회 주소" value="([^"]*)"/)?.[1]||'';}});
    Object.assign(d,{links,selectors,querySelector:s=>selectors[s],querySelectorAll:s=>s==='[data-parcel-link]'?links:[],showModal(){d.open=true;},close(){d.open=false;d.events.close?.();},remove(){d.isConnected=false;}});dialogs.push(d);return d;
  }};
  vm.runInNewContext(fs.readFileSync('js/sale-workbench-v1.js','utf8'),{window,document});
  const result={address:'대전광역시 서구 도마동 49-38',links:setup().api.links('3017010300100490038')};
  return {lookup:window.JSSaleWorkbenchV1.lookup,requests,result};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('editing the lookup address invalidates stale responses and links without changing the listing',async()=>{
  const {lookup,requests,result}=workbench(),item=Object.freeze({address:'서구 도마동 49-38'}),d=lookup(item),field=d.selectors.input;
  assert.equal(requests[0].query,result.address);assert.equal(d.links[0].href,undefined);
  field.value='서구 도마동 49-39';field.events.input();requests[0].resolve(result);await flush();
  assert.equal(field.value,'서구 도마동 49-39');assert.equal(d.links[0].href,undefined);
  field.value=item.address;field.events.input();d.selectors['[data-check-parcel]'].onclick();requests[1].resolve(result);await flush();
  assert.equal(d.links[0].href,result.links.eum);assert.equal(field.value,result.address);
  field.value='서구 도마동';field.events.input();assert.equal(d.links[0].href,undefined);assert.equal(item.address,'서구 도마동 49-38');
});
test('closing or replacing a lookup dialog prevents late successful/error responses from applying',async()=>{
  const {lookup,requests,result}=workbench(),first=lookup({address:'서구 도마동 49-38'}),second=lookup({address:'서구 도마동 49-39'});
  assert.equal(first.isConnected,false);requests[0].resolve(result);await flush();assert.equal(first.links[0].href,undefined);assert.equal(second.links[0].href,undefined);
  second.close();requests[1].reject(Error('late'));await flush();assert.equal(second.links[0].href,undefined);assert.notEqual(second.selectors['[data-lookup-status]'].textContent,'late');
});
