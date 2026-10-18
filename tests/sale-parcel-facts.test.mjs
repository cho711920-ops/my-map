import test from 'node:test';
import assert from 'node:assert/strict';
import {getSaleParcelFacts,parseEumLandHtml,parseEumLandPrice,parseDesignationCell,validateParcelPnu} from '../cloudflare/src/sale-parcel-facts.js';
import {parseTransactions} from '../cloudflare/src/sale-transactions.js';
import worker from '../cloudflare/src/worker.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';
const pnu='3011011700100560001';
function html(p=pnu){return '<!doctype html><input type="hidden" id="pnu" value="'+p+'"><table><tr><th scope="row">소재지</th><td><div id="present_addr" style="display:none"></div>대전광역시 동구 홍도동 56-1</td></tr><tr><td><input id="present_class_val" value="대"></td><td id="present_area">1,243 ㎡</td></tr><tr><td id="present_mark1"><a onclick="openLandLayer(\'live_layer_UQA123_2\');">제3종일반주거지역</a><input name="mark_ucode" value="UQA123"><div class="layer_pop"><h3>제3종일반주거지역</h3><p>설명에 나온 일반상업지역은 이 필지의 지정이 아닙니다.</p><a>닫기</a><a>자세히</a></div><a>중로1류(폭 20m~25m)(저촉)</a></td><td id="present_mark2"><a>교육환경보호구역&lt;교육환경 보호에 관한 법률&gt;</a><div class="layer_pop"><a>관련 법령</a></div></td><td id="present_mark3">  </td></tr></table>';}
const price='<RESPONSE><HEADER><CODE>0000</CODE></HEADER><BODY><DECSN_JIGA><BASE_YEAR>2026</BASE_YEAR><STDMT>01</STDMT><JIGA>986600</JIGA></DECSN_JIGA></BODY></RESPONSE>';
test('parcel validation accepts one exact PNU and rejects prefix, zero main number and URL injection',()=>{
  assert.equal(validateParcelPnu(pnu),pnu);for(const v of ['',pnu.slice(0,10),pnu+'?x=1','3011011700100000001','https://example.test'])assert.throws(()=>validateParcelPnu(v));
});
test('designation extraction excludes hidden explanations and keeps road-plan qualifiers intact',()=>{
  const d=parseEumLandHtml(html(),pnu);assert.equal(d.address,'대전광역시 동구 홍도동 56-1');assert.equal(d.landUse,'대');assert.equal(d.areaM2,1243);assert.equal(d.regulationsComplete,true);
  assert.deepEqual(d.regulations[0].items.map(r=>r.label),['제3종일반주거지역','중로1류(폭 20m~25m)(저촉)']);assert.equal(d.regulations[0].items[0].code,'UQA123');
  assert.equal(d.regulations[1].items[0].label,'교육환경보호구역<교육환경 보호에 관한 법률>');assert.equal(d.regulations[2].items.length,0);
});
test('layout changes, absent fields and wrong parcel identity never produce a clean no-regulation result',()=>{
  assert.throws(()=>parseEumLandHtml(html('3011011700100570001'),pnu));
  for(const s of [html().replace('present_area','other_area'),html().replace('1,243 ㎡',''),html().replace('홍도동','\ufffd')])assert.throws(()=>parseEumLandHtml(s,pnu));
  assert.equal(parseDesignationCell(undefined).available,false);assert.equal(parseDesignationCell('<div>자료 불러오는 중</div>').complete,false);
  assert.equal(parseDesignationCell('<a>지정').complete,false);assert.equal(parseDesignationCell('  ').complete,true);
  const missing=parseEumLandHtml(html().replace('present_mark2','changed'),pnu);assert.equal(missing.regulationsComplete,false);
});
test('public price preserves won-per-square-metre and declared base month without using the ad price',()=>{
  assert.deepEqual(parseEumLandPrice(price,new Date('2026-10-18')),{available:true,wonPerM2:986600,baseYear:2026,baseMonth:1});
  assert.equal(parseEumLandPrice('<CODE>9999</CODE>').available,false);
  for(const s of [price.replace('986600','0'),price.replace('2026','2027'),price.replace('<STDMT>01','<STDMT>13'),price.replace('<JIGA>986600</JIGA>','')])assert.throws(()=>parseEumLandPrice(s,new Date('2026-10-18')));
});
test('on-demand land service uses only fixed public endpoints, caches a verified result and never writes listings',async()=>{
  const old=global.fetch,urls=[],objects=new Map();
  global.fetch=async(input,init)=>{if(!['follow','manual'].includes(init.redirect))throw new TypeError('workerd redirect contract');const u=new URL(input);urls.push(u);return new Response(u.hostname==='www.eum.go.kr'?html():price,{headers:{'content-type':'text/html;charset=utf-8'}});};
  const env={DB:{prepare(){throw Error('no listing writes');}},MEDIA:{get:async k=>objects.has(k)?{json:async()=>objects.get(k)}:null,put:async(k,v)=>objects.set(k,JSON.parse(v))}};
  try{const data=await getSaleParcelFacts(env,{pnu});assert.equal(data.ok,true);assert.equal(data.complete,true);assert.equal(data.price.wonPerM2,986600);assert.equal(urls.length,2);assert.equal(urls[0].hostname,'www.eum.go.kr');assert.equal(urls[1].hostname,'api.eum.go.kr');assert.match(urls[1].searchParams.get('url'),/bobn=0056\|bubn=0001/);
    const second=await getSaleParcelFacts(env,{pnu});assert.equal(second.cached,true);assert.equal(urls.length,2);
  }finally{global.fetch=old;}
});
test('price outage keeps parcel facts available without inventing zero or caching a complete result',async()=>{
  const old=global.fetch;let puts=0;global.fetch=async u=>new URL(u).hostname==='www.eum.go.kr'?new Response(html()):new Response('unavailable',{status:503});
  try{const result=await getSaleParcelFacts({MEDIA:{get:async()=>null,put:async()=>puts++}},{pnu});assert.equal(result.ok,true);assert.equal(result.complete,false);assert.equal(result.price.available,false);assert.equal(result.price.wonPerM2,undefined);assert.equal(result.areaM2,1243);assert.equal(puts,0);}finally{global.fetch=old;}
});
test('a redirected source is not followed, and source HTML is never returned to the browser',async()=>{
  const old=global.fetch;global.fetch=async()=>new Response('<secret>original source HTML</secret>',{status:302,headers:{location:'https://example.test'}});
  try{const result=await getSaleParcelFacts({},{pnu});assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/secret|example\.test|original source HTML/);}finally{global.fetch=old;}
});
test('an absent totalCount cannot be accepted as zero transactions',()=>{
  assert.throws(()=>parseTransactions('<response><resultCode>000</resultCode><items></items></response>','land','30170','202609'));
});
test('Worker land reference route stays behind the authenticated account boundary',async()=>{
  const env={ALLOWED_EMAILS:'owner@example.com',SESSION_SECRET:'land-reference-test-only-secret-longer-than-32-characters'};
  const url='https://js-map.com/api/data?action=saleParcelFacts&pnu='+pnu;
  assert.equal((await worker.fetch(new Request(url),env)).status,401);
  const token=await createSessionToken({sub:'owner',email:'owner@example.com'},env),headers={cookie:SESSION_COOKIE+'='+encodeURIComponent(token)};
  assert.equal((await worker.fetch(new Request(url+'&expectedAccountEmail=other@example.com',{headers}),env)).status,409);
  const old=global.fetch;global.fetch=async u=>new Response(new URL(u).hostname==='www.eum.go.kr'?html():price);
  try{const response=await worker.fetch(new Request(url+'&expectedAccountEmail=owner@example.com',{headers}),env);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).pnu,pnu);}finally{global.fetch=old;}
});
