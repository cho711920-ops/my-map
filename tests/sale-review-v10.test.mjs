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
