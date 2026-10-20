import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseLandPriceHistory,getLandPriceHistory} from '../cloudflare/src/land-price-history.js';
import worker from '../cloudflare/src/worker.js';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';
const pnu='3011011700100560001';
const row=(year,month,amount)=>'<tr> <td>'+year+'/'+month+'</td><td>'+amount+'원</td></tr>';
const rows=row(2026,'01','986,600')+row(2025,'07','980,000')+row(2025,'01','969,900')+row(2023,'01','957,300');
const html=(p=pnu)=>'<input id="pnu" value="'+p+'"><table><tr><th>소재지</th><td>대전광역시 동구 홍도동 56-1</td></tr><td><input id="present_class_val" value="대"></td><td id="present_area">1243 ㎡</td><td id="present_mark1"></td><td id="present_mark2"></td><td id="present_mark3"></td></table>';

test('history preserves actual base months, sorts dates and deduplicates only identical observations',()=>{
  const data=parseLandPriceHistory(rows+row(2026,'01','986,600'));
  assert.deepEqual(data.map(r=>[r.baseYear,r.baseMonth]),[[2023,1],[2025,1],[2025,7],[2026,1]]);
  assert.equal(data.at(-1).wonPerM2,986600);
});
test('blank, failed, truncated, conflicting or implausible history is never a valid zero series',()=>{
  for(const value of ['',rows+'<tr><td>2022/01',rows+'<div>오류</div>',rows+row(2026,'01','1'),row(1989,'01','1'),row(2027,'01','1'),row(2026,'13','1'),row(2026,'01','0'),row(2026,'01','1,00'),row(2026,'01','1000000001'),rows+'<script>alert(1)</script>'])assert.throws(()=>parseLandPriceHistory(value,new Date('2026-10-20')));
});
test('anonymous source cookies stay in one fixed-origin request, and successful public history is cached by parcel',async()=>{
  const previous=global.fetch,calls=[],objects=new Map();
  global.fetch=async(input,init)=>{const u=new URL(input);calls.push({url:u,headers:init.headers});assert.equal(init.redirect,'manual');
    if(u.pathname.endsWith('luLandDet.jsp')){const headers=new Headers({'content-type':'text/html;charset=utf-8'});for(const value of ['JSESSIONID=public-test-session!route; HttpOnly; Path=/','elevisor_for_j2ee_uid=anonymous-public-id; Path=/','unrelated=not-forwarded; Path=/'])headers.append('set-cookie',value);return new Response(html(),{headers});}
    assert.equal(u.hostname,'www.eum.go.kr');assert.equal(u.searchParams.get('pnu'),pnu);assert.match(init.headers.cookie,/JSESSIONID=public-test-session!route/);assert.match(init.headers.cookie,/elevisor_for_j2ee_uid=anonymous-public-id/);assert.doesNotMatch(init.headers.cookie,/user-login|unrelated|not-forwarded/);
    return new Response(rows);
  };
  const env={DB:{prepare(){throw Error('No listing writes');}},MEDIA:{get:async k=>objects.has(k)?{json:async()=>objects.get(k)}:null,put:async(k,v)=>objects.set(k,JSON.parse(v))}};
  try{const data=await getLandPriceHistory(env,{pnu});assert.equal(data.ok,true);assert.equal(data.records.length,4);assert.equal(data.regionalAverages.available,false);assert.equal(calls.length,2);
    assert.doesNotMatch(JSON.stringify(data),/public-test-session|anonymous-public-id|set-cookie/);
    assert.equal((await getLandPriceHistory(env,{pnu})).cached,true);assert.equal(calls.length,2);
  }finally{global.fetch=previous;}
});
test('wrong parcel, missing anonymous session, redirected or blank response never leaks or caches upstream content',async()=>{
  const previous=global.fetch;let puts=0;
  for(const phase of ['wrong','no-cookie','redirect','blank']){
    global.fetch=async input=>{const u=new URL(input);if(phase==='redirect')return new Response('private-upstream-response',{status:302,headers:{location:'https://other.invalid'}});
      if(u.pathname.endsWith('luLandDet.jsp'))return new Response(html(phase==='wrong'?'3011011700100570001':pnu),{headers:phase==='no-cookie'?{}:{'set-cookie':'JSESSIONID=anonymous-source-only; Path=/'}});
      return new Response('   ');
    };
    try{const data=await getLandPriceHistory({MEDIA:{get:async()=>null,put:async()=>puts++}},{pnu});assert.equal(data.ok,false);assert.equal(data.code,'history_unavailable');assert.doesNotMatch(JSON.stringify(data),/private-upstream|anonymous-source|other.invalid/);}finally{global.fetch=previous;}
  }
  assert.equal(puts,0);
});
test('the history endpoint preserves authenticated-account checks before public network access',async()=>{
  const env={ALLOWED_EMAILS:'owner@example.com',SESSION_SECRET:'history-test-secret-longer-than-32-characters'};
  const url='https://js-map.com/api/data?action=saleLandPriceHistory&pnu='+pnu;
  assert.equal((await worker.fetch(new Request(url),env)).status,401);
  const token=await createSessionToken({sub:'owner',email:'owner@example.com'},env),headers={cookie:SESSION_COOKIE+'='+encodeURIComponent(token)};
  assert.equal((await worker.fetch(new Request(url+'&expectedAccountEmail=other@example.com',{headers}),env)).status,409);
  const previous=global.fetch;global.fetch=async input=>new URL(input).pathname.endsWith('luLandDet.jsp')?new Response(html(),{headers:{'set-cookie':'JSESSIONID=public-test-worker-session; Path=/'}}):new Response(rows);
  try{const response=await worker.fetch(new Request(url+'&expectedAccountEmail=owner@example.com',{headers}),env);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).records.length,4);}finally{global.fetch=previous;}
});
const window={};vm.runInNewContext(fs.readFileSync('js/land-price-history-v39.js','utf8'),{window,document:{},Map});
const chart=window.JSLandPriceHistoryV39;
test('chart range filtering never fills missing years and line segments break across gaps',()=>{
  const data=parseLandPriceHistory(row(1990,'01','100')+rows),g=chart.geometry(data);
  assert.equal(chart.visibleRecords(data,'5').length,4);assert.equal(chart.visibleRecords(data,'all').length,5);
  assert.equal((g.path.match(/M/g)||[]).length,3);assert.equal(g.points.length,5);
  for(const p of g.points){assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(p.x>=70&&p.x<=696);}
  assert.equal(chart.geometry([data[0]]).points[0].x,383);
});
test('year-on-year changes require exactly the previous year and matching base month',()=>{
  const data=parseLandPriceHistory(rows);assert.equal(chart.annualChange(data,data[1]),null);
  assert.equal(chart.annualChange(data,data[2]),null);
  assert.ok(Math.abs(chart.annualChange(data,data[3])-(986600/969900-1)*100)<1e-9);
  assert.throws(()=>chart.validate({ok:true,pnu:'different',records:data},pnu));
});
test('mobile time labels keep close January/July observations from overlapping',()=>{
  const data=parseLandPriceHistory(row(2022,'01','500')+rows),g=chart.geometry(data,420),ticks=chart.axisTicks(g.points,true);
  assert.equal(ticks[0].row.baseYear,2022);assert.equal(ticks.at(-1).row.baseYear,2026);assert.equal(ticks.length,2);
});
test('in-flight lookups merge by exact parcel and cap simultaneous source sessions',async()=>{
  const previous=global.fetch;let release,calls=0;const gate=new Promise(r=>release=r),env={};
  global.fetch=async input=>{calls++;const u=new URL(input);if(u.pathname.endsWith('luLandDet.jsp')){await gate;return new Response(html(u.searchParams.get('pnu')),{headers:{'set-cookie':'JSESSIONID=isolated-anonymous-session; Path=/'}});}return new Response(rows);};
  try{const first=getLandPriceHistory(env,{pnu}),same=getLandPriceHistory(env,{pnu});
    const others=[2,3,4].map(n=>getLandPriceHistory(env,{pnu:pnu.slice(0,-1)+n}));
    assert.equal(calls,4);assert.equal((await getLandPriceHistory(env,{pnu:pnu.slice(0,-1)+'5'})).code,'busy');release();
    const results=await Promise.all([first,same,...others]);assert.ok(results.every(r=>r.ok));assert.equal(calls,8);
  }finally{release();global.fetch=previous;}
});
