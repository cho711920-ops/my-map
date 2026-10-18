import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transactionQuery,parseTransactions,getSaleTransactions} from '../cloudflare/src/sale-transactions.js';
import worker from '../cloudflare/src/worker.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';

const window={JSAuthenticatedAccountEmail:'test@example.invalid',addEventListener(){}};
vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById(){},querySelector(){},querySelectorAll(){return [];},documentElement:{setAttribute(){},removeAttribute(){}}},CustomEvent:class{}});
vm.runInNewContext(fs.readFileSync('js/parcel-external-links-v1.js','utf8'),{window});
window.JSSaleWorkbenchV1={price:v=>String(v)};
vm.runInNewContext(fs.readFileSync('js/sale-public-review-v6.js','utf8'),{window});
const ui=window.JSSalePublicReviewV6;
const base={sggCd:'30170',sggNm:'서구',umdNm:'괴정동',jibun:'3**',dealYear:'2026',dealMonth:'9',dealDay:'12',dealAmount:'50,000',dealArea:'330',plottageAr:'330',buildingAr:'650',buildingType:'일반',buildingUse:'제2종근린생활시설',landUse:'일반주거지역',jimok:'대'};
function xml(rows,total=rows.length,page=1){return '<response><header><resultCode>000</resultCode></header><body><items>'+rows.map(r=>'<item>'+Object.entries(r).map(([k,v])=>'<'+k+'>'+v+'</'+k+'>').join('')+'</item>').join('')+'</items><totalCount>'+total+'</totalCount><pageNo>'+page+'</pageNo></body></response>';}

test('queries reject unsupported types, malformed district and future contract months',()=>{
  assert.deepEqual(transactionQuery({kind:'land',district:'30170',month:'202609'},new Date('2026-10-18')), {kind:'land',district:'30170',month:'202609'});
  for(const values of [{kind:'lease'},{district:'3017x'},{month:'202613'},{month:'202611'},{month:'200512'}])
    assert.throws(()=>transactionQuery({kind:'land',district:'30170',month:'202609',...values},new Date('2026-10-18')));
});
test('public transaction normalization excludes cancelled, shared, foreign district and invalid dates',()=>{
  const result=parseTransactions(xml([base,{...base,cdealType:'O'},{...base,cdealDay:'26.09.13'},{...base,shareDealingType:'지분'},{...base,sggCd:'30200'},{...base,dealMonth:'2',dealDay:'30'},{...base,dealAmount:'0'},{...base,umdNm:''}]),'land','30170','202609');
  assert.equal(result.rawCount,8);assert.equal(result.records.length,1);assert.equal(result.records[0].amount,50000);assert.equal(result.records[0].landAreaM2,330);assert.equal(result.records[0].buildingAreaM2,null);
  assert.equal(parseTransactions(xml([base]),'commercial','30170','202609').records[0].buildingAreaM2,650);
});
test('malformed upstream and entitlement failures never become empty successful results',()=>{
  assert.throws(()=>parseTransactions('<html>error</html>','land','30170','202609'));
  assert.throws(()=>parseTransactions(xml([base]).replace('<totalCount>1</totalCount>',''),'land','30170','202609'));
  assert.throws(()=>parseTransactions('<resultCode>30</resultCode><resultMsg>KEY_NOT_REGISTERED</resultMsg>','land','30170','202609'),e=>e.publicCode==='approval_required');
});
test('known zero counts remain zero; missing parking components never produce a fake total',()=>{
  const b={mainUse:'근린생활시설',indoorSelfParking:5,outdoorSelfParking:0,indoorMechanicalParking:null,outdoorMechanicalParking:0,passengerElevators:0,emergencyElevators:0,buildingCoverageRatio:0};
  const rows=ui.buildingRows(b),get=k=>rows.find(r=>r[0]===k)[1];
  assert.equal(get('자주식 주차'),'5대');assert.equal(get('주차 총대수'),'');assert.equal(get('승강기'),'0대');assert.equal(get('건폐율'),'0%');
  b.indoorMechanicalParking=0;assert.equal(ui.buildingRows(b).find(r=>r[0]==='주차 총대수')[1],'5대');
  b.indoorSelfParking=true;assert.equal(ui.buildingRows(b).find(r=>r[0]==='자주식 주차')[1],'');
});
test('building dossier escapes official and original text and keeps ad values separate',()=>{
  const ad={saleDetails:{buildingUse:'<img src=x>',approvalDate:'20010101'}};
  const data={buildings:[{mainUse:'<script>',structure:'철근콘크리트',approvalDate:'20020202',siteArea:330}],queriedAt:'2026-10-18'};
  const before=JSON.stringify(ad);const html=ui.buildingHtml(data,0,ad);
  assert.doesNotMatch(html,/<script>|<img src/);assert.match(html,/광고 기재/);assert.match(html,/2001.01.01/);assert.match(html,/2002.02.02/);assert.equal(JSON.stringify(ad),before);
  assert.match(ui.buildingHtml({buildings:[]},0,ad),/확인하지 못했습니다/);
});
test('land public data retains source units, encodes law labels and never replaces the asking-price denominator',()=>{
  const item={saleDetails:{landAreaM2:330.5785}},before=JSON.stringify(item);
  const markup=ui.landPublicHtml({address:'<img>',areaM2:1243,landUse:'대',price:{available:true,wonPerM2:986600,baseYear:2026,baseMonth:1},regulations:[{key:'planning',label:'국토계획법',available:true,complete:true,items:[{label:'<script>법률</script>'}]}],source:'토지이음',fetchedAt:'2026-10-18T10:00:00Z',complete:true},item);
  assert.doesNotMatch(markup,/<img>|<script>/);assert.match(markup,/986,600/);assert.match(markup,/원\/㎡/);assert.match(markup,/2026.01/);assert.match(markup,/광고면적을 유지/);assert.equal(JSON.stringify(item),before);
});
test('similar transactions use the exact legal town, optional conditions and separate whole buildings',()=>{
  const item={tradeType:'sale',saleCategory:'land',saleDetails:{landAreaM2:330,landUse:'대',zoning:'일반주거지역'}};
  const records=[{town:'괴정동',landAreaM2:330,landUse:'대',zoning:'일반주거지역',date:'2026-09-12',buildingType:'일반'},
    {town:'괴정동',landAreaM2:10,landUse:'전',date:'2026-09-14',buildingType:'집합'},
    {town:'탄방동',landAreaM2:330,date:'2026-09-15'}];
  const p={address:'대전 서구 괴정동 3-3'};
  assert.equal(ui.comparable(records,item,p,{}).length,2);
  assert.equal(ui.comparable(records,item,p,{size:true,landUse:true,zoning:true}).length,1);
  assert.equal(ui.comparable(records,{...item,saleCategory:'building'},p,{whole:true}).length,1);
  assert.equal(ui.comparable(records,item,{address:'도로명 비공개'},{}).length,0);
});
test('service missing key is explicit and sends no request',async()=>{
  const fetchBefore=global.fetch;global.fetch=()=>{throw Error('must not fetch');};
  try{const result=await getSaleTransactions({}, {kind:'land',district:'30170',month:'202609'});assert.equal(result.ok,false);assert.equal(result.code,'approval_required');}
  finally{global.fetch=fetchBefore;}
});
test('service paginates, uses public cache, and never calls the listing database',async()=>{
  const fetchBefore=global.fetch,urls=[],objects=new Map();
  global.fetch=async (input,init)=>{if(!['follow','manual'].includes(init.redirect))throw new TypeError('workerd does not support redirect:error');const url=new URL(input);urls.push(url);const p=Number(url.searchParams.get('pageNo'));return new Response(xml([base],2,p));};
  const env={DATA_GO_KR_SERVICE_KEY:'private+key',DB:{prepare(){throw Error('listing writes forbidden');}},MEDIA:{get:async k=>objects.has(k)?{json:async()=>objects.get(k)}:null,put:async(k,v)=>objects.set(k,JSON.parse(v))}};
  try{
    const first=await getSaleTransactions(env,{kind:'commercial',district:'30170',month:'202609'});
    assert.equal(first.complete,true);assert.equal(first.records.length,2);assert.equal(urls.length,2);assert.equal(urls[0].searchParams.get('serviceKey'),'private+key');
    const second=await getSaleTransactions(env,{kind:'commercial',district:'30170',month:'202609'});assert.equal(second.cached,true);assert.equal(urls.length,2);
    assert.doesNotMatch(JSON.stringify(second),/private\+key/);
  }finally{global.fetch=fetchBefore;}
});
test('upstream permission error exposes neither key nor failed URL',async()=>{
  const fetchBefore=global.fetch;global.fetch=async()=>new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>',{status:403});
  try{const r=await getSaleTransactions({DATA_GO_KR_SERVICE_KEY:'SECRET'}, {kind:'land',district:'30170',month:'202609'});assert.equal(r.code,'approval_required');assert.doesNotMatch(JSON.stringify(r),/SECRET|serviceKey/);}
  finally{global.fetch=fetchBefore;}
});
test('repeated first page or changing total counts cannot be cached as complete',async()=>{
  const fetchBefore=global.fetch;let puts=0;global.fetch=async()=>new Response(xml([base],2,1));
  try{const r=await getSaleTransactions({DATA_GO_KR_SERVICE_KEY:'key',MEDIA:{get:async()=>null,put:async()=>puts++}}, {kind:'land',district:'30170',month:'202609'});assert.equal(r.ok,false);assert.equal(puts,0);}
  finally{global.fetch=fetchBefore;}
});
test('Worker reference action requires a session and respects the active account precondition',async()=>{
  const env={ALLOWED_EMAILS:'owner@example.com',SESSION_SECRET:'sale-reference-test-only-secret-longer-than-32-characters'};
  const url='https://js-map.com/api/data?action=saleTransactions&kind=land&district=30170&month=202609';
  const denied=await worker.fetch(new Request(url),env);assert.equal(denied.status,401);
  const token=await createSessionToken({sub:'owner',email:'owner@example.com'},env),headers={cookie:SESSION_COOKIE+'='+encodeURIComponent(token)};
  const wrong=await worker.fetch(new Request(url+'&expectedAccountEmail=other@example.com',{headers}),env);assert.equal(wrong.status,409);
  const allowed=await worker.fetch(new Request(url+'&expectedAccountEmail=owner@example.com',{headers}),env);
  assert.equal(allowed.status,200);assert.equal(allowed.headers.get('cache-control'),'private, no-store');assert.equal((await allowed.json()).code,'approval_required');
});
