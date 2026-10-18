import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function runtime(){
  const w={JSListingTradeV1:{getMode:()=> 'lease'},document:{getElementById:()=>null,addEventListener(){}},addEventListener(){},matchMedia:()=>({matches:true,addEventListener(){}})};
  const c=vm.createContext({...w,window:w});
  for(const file of ['sale-workbench-v1.js','sale-review-v10.js'])vm.runInContext(fs.readFileSync(new URL('../js/'+file,import.meta.url),'utf8'),c);
  return w;
}
test('sale dates show explicit timezone timestamps in KST and keep date-only values and unknowns',()=>{
  const f=runtime().JSSaleReviewV10.dateText;
  assert.equal(f('2026-10-18T18:05:00Z'),'2026.10.19 03:05 KST');
  assert.equal(f('2026-10-19T03:05:00+09:00'),'2026.10.19 03:05 KST');
  assert.equal(f('20261019'),'2026.10.19');assert.equal(f('2026-10-19'),'2026.10.19');
  assert.equal(f('2026-10-19T03:05:00'),'2026-10-19T03:05:00');
  assert.equal(f('20260230'),'20260230');assert.equal(f('검수일시'),'검수일시');assert.equal(f(null),'');
});
test('cashflow presentation uses the existing calculated result and retains negative and zero amounts',()=>{
  const w=runtime(),v={price:50000,deposit:5000,income:200,loan:12000,interest:6,vacancy:10,expense:150,acquisition:1000},before=JSON.stringify(v);
  const result=w.JSSaleWorkbenchV1.calculate(v),html=w.JSSaleReviewV10.flowHtml(v,false,result);
  assert.equal(result.monthly,-30);assert.match(html,/-30만원/);assert.match(html,/20만원/);assert.match(html,/34,000만원/);assert.match(html,/negative/);assert.equal(JSON.stringify(v),before);
  const land={price:30000,acquisition:1000,loan:10000,interest:0},r=w.JSSaleWorkbenchV1.calculateLand(land,330.5785),h=w.JSSaleReviewV10.flowHtml(land,true,r);
  assert.match(h,/31,000만원/);assert.match(h,/21,000만원/);assert.match(h,/0만원/);assert.doesNotMatch(h,/임대보증금|월 임대수입/);
  assert.equal(w.JSSaleReviewV10.flowHtml(v,false,{error:'bad'}),'');
});
test('evidence links require a stored exact quote in this description and escape building labels',()=>{
  const w=runtime(),f=w.JSSaleReviewV10.evidenceMatches;
  const d={descriptionText:'월세 200만원\n대지면적: 330㎡',descriptionEvidence:{'월 임대수입':'월세 200만원','다른 원본':'월세 300만원','오류':{value:5}}};
  assert.equal(f(d).length,1);assert.equal(f(d)[0].quote,'월세 200만원');assert.equal(f({...d,descriptionText:''}).length,0);assert.equal(f({descriptionText:'월세 200만원'}).length,0);
  w.JSSalePublicReviewV6={buildingRows:()=>[['주용도','<img onerror=alert(1)>'],['자주식 주차','0대'],['승강기',''],['주차 총대수','12대']]};
  const html=w.JSSaleReviewV10.buildingHighlights({});assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|주차 총대수|승강기/);assert.match(html,/0대/);
});
test('break-even rates zero the existing monthly calculation while fixing the other assumptions',()=>{
  const w=runtime(),v={price:50000,deposit:5000,income:250,loan:12000,interest:4,vacancy:5,expense:10,acquisition:1000},copy=JSON.stringify(v),r=w.JSSaleReviewV10.breakEven(v);
  assert.equal(r.vacancy.status,'point');assert.equal(r.vacancy.value,80);assert.equal(r.interest.value,22.75);
  assert.ok(Math.abs(w.JSSaleWorkbenchV1.calculate({...v,vacancy:r.vacancy.value}).monthly)<1e-8);
  assert.ok(Math.abs(w.JSSaleWorkbenchV1.calculate({...v,interest:r.interest.value}).monthly)<1e-8);
  assert.ok(w.JSSaleWorkbenchV1.calculate({...v,vacancy:81}).monthly<0);
  assert.ok(w.JSSaleWorkbenchV1.calculate({...v,interest:23}).monthly<0);
  assert.equal(JSON.stringify(v),copy);
  const html=w.JSSaleReviewV10.breakEvenHtml(v);assert.match(html,/80%/);assert.match(html,/22.75%/);assert.match(html,/동시에 적용한 결과가 아닙니다/);
});
test('break-even distinguishes zero denominators, already-negative cash flow and 0/100 endpoints',()=>{
  const w=runtime(),f=w.JSSaleReviewV10.breakEven,v={price:50000,deposit:0,income:200,loan:12000,interest:6,vacancy:10,expense:150,acquisition:0};
  const r=f(v);assert.equal(r.vacancy.status,'below_zero');assert.equal(r.interest.value,3);
  assert.match(w.JSSaleReviewV10.breakEvenHtml(v),/공실 0%여도 월적자/);
  assert.equal(f({...v,expense:250}).interest.status,'below_zero');
  assert.equal(f({...v,loan:0}).interest.status,'no_loan');assert.equal(f({...v,income:0}).vacancy.status,'no_income');
  const endpoints=f({...v,income:100,loan:100,interest:0,vacancy:100,expense:0});assert.equal(endpoints.vacancy.value,100);assert.equal(endpoints.interest.value,0);
  assert.equal(f({...v,income:100,loan:100,interest:0,vacancy:0,expense:100}).vacancy.value,0);
  assert.equal(f({...v,loan:100,interest:1,expense:0,vacancy:0}).interest.status,'above_range');
});
test('invalid break-even inputs do not leave stale values or expose infinite rates',()=>{
  const w=runtime(),f=w.JSSaleReviewV10.breakEven,v={price:50000,deposit:0,income:200,loan:12000,interest:6,vacancy:10,expense:10,acquisition:0};
  for(const bad of [{income:''},{interest:101},{vacancy:-1},{loan:null},{price:1,deposit:2}])assert.ok(f({...v,...bad}).error);
  assert.ok(f({...v,price:1e308,loan:1e307,income:1e308,expense:1e308,interest:100}).error);
  const html=w.JSSaleReviewV10.breakEvenHtml({...v,income:1,loan:0,interest:0,expense:.99999});assert.match(html,/0.01% 미만/);assert.doesNotMatch(html,/NaN|Infinity/);
  const land={price:30000,acquisition:0,loan:0,interest:0},r=w.JSSaleWorkbenchV1.calculateLand(land,330);
  assert.doesNotMatch(w.JSSaleReviewV10.flowHtml(land,true,r),/손익분기/);
});
