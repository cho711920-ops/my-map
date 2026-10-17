import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';
const window={addEventListener(){},dispatchEvent(){}};
const context={window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}},addEventListener(){}},CustomEvent:class{}};
for(const file of ['listing-trade-ui-v1.js','sale-workbench-v1.js'])vm.runInNewContext(fs.readFileSync('js/'+file,'utf8'),context);
const ui=window.JSListingTradeV1,w=window.JSSaleWorkbenchV1;
const building={tradeType:'sale',saleCategory:'building',salePrice:50000,saleDetails:{landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:5000,monthlyIncome:200,buildingUse:'근린생활시설',approvalDate:'2008-01-01'}};
const land={tradeType:'sale',saleCategory:'land',salePrice:30000,saleDetails:{landAreaM2:330.5785,landUse:'대',zoning:'일반주거지역',roadAccess:'중로한면',parcelShape:'장방형'}};
test('sale presentation uses collected facts and leaves lease markup empty',()=>{
  for(const fn of ['saleCardFactsHtml','saleOverviewHtml','saleDetailsHtml'])assert.equal(ui[fn]({...building,tradeType:'lease'}),'');
  assert.match(ui.saleCardFactsHtml(building),/월 임대수입.*200만원/);
  assert.match(ui.saleCardFactsHtml(land),/도로.*중로한면/);
  assert.doesNotMatch(ui.saleCardFactsHtml({...building,saleDetails:{}}),/0|미확인/);
  const markup=ui.saleDetailsHtml({...building,saleDetails:{...building.saleDetails,descriptionWarnings:['<script>'],descriptionText:'<원문>'}});
  assert.match(markup,/광고 면적/);assert.match(markup,/임대·수익 현황/);assert.match(markup,/건물 기본정보/);
  assert.match(markup,/&lt;script&gt;/);assert.match(markup,/&lt;원문&gt;/);assert.doesNotMatch(markup,/<script>/);
  assert.match(ui.saleDetailsHtml({...building,saleDetails:{descriptionText:'원문만 제공'}}),/원문만 제공/);
});
test('card facts refuse conflicting same-price original data',()=>{
  const a={...building,source:'네이버',saleDetails:undefined,unifiedOriginalsV8:[{...building,source:'네이버'}, {...building,source:'네이버',saleDetails:{...building.saleDetails,buildingUse:'공장'}}]};
  assert.equal(ui.saleCardFactsHtml(a),'');
});
test('existing compact sale response carries bounded conditions without contacts or extra requests',()=>{
  const detail={...land.saleDetails,roadAccess:'중로한면',parcelShape:'장방형',descriptionText:'비공개 원문',phone:'01000000000'};
  const compact=compactSaleSummary({...land,saleDetails:detail});
  assert.equal(compact.roadAccess,'중로한면');assert.equal(compact.parcelShape,'장방형');
  assert.ok(!('descriptionText' in compact));assert.ok(!('phone' in compact));
  const master={...land,saleDetails:undefined,source:'네이버',unifiedOriginalsV8:[{...land,source:'네이버',saleDetails:undefined,saleSummary:compact}]};
  assert.match(ui.saleCardFactsHtml(master),/도로.*중로한면/);
  assert.equal(compactSaleSummary({...land,tradeType:'lease',saleDetails:detail}),'');
  assert.equal(compactSaleSummary({...building,saleDetails:{buildingUse:'가'.repeat(500)}}).buildingUse.length,160);
  for(const value of [true,{},[],0])assert.equal(compactSaleSummary({...land,saleDetails:{roadAccess:value}}).roadAccess,undefined);
});
test('land acquisition math separates cost, equity, asking unit price and interest',()=>{
  const r=w.calculateLand({price:30000,acquisition:1500,loan:10000,interest:4.8},330.5785);
  assert.equal(r.total,31500);assert.equal(r.equity,21500);assert.equal(r.interest,40);
  assert.ok(Math.abs(r.pricePerPy-300)<.001);assert.ok(Math.abs(r.costPerPy-315)<.001);
  for(const value of [null,'',true,-1,Infinity])assert.ok(w.calculateLand({price:30000,acquisition:value,loan:0,interest:0},100).error);
  assert.ok(w.calculateLand({price:100,acquisition:0,loan:100,interest:0},100).error);
  assert.equal(w.calculateLand({price:100,acquisition:0,loan:0,interest:0},null).costPerPy,null);
});
test('comparisons use land conditions or building income without all-empty sections',()=>{
  const l=w.comparisonHtml([land,{...land,salePrice:40000}]);
  assert.match(l,/토지 평당가/);assert.match(l,/도로접면/);assert.doesNotMatch(l,/연면적|임대수입|수익률/);
  const b=w.comparisonHtml([building,{...building,salePrice:60000}]);
  assert.match(b,/월 임대수입/);assert.match(b,/사용승인일/);assert.match(b,/단순 연 수익률/);
  assert.doesNotMatch(w.comparisonHtml([{...land,saleDetails:{}}]),/도로접면|토지 형상/);
  const ambiguous={...land,source:'네이버',saleDetails:undefined,unifiedOriginalsV8:[{...land,source:'네이버'},{...land,source:'네이버',saleDetails:{...land.saleDetails,roadAccess:'광대한면'}}]};
  assert.doesNotMatch(w.comparisonHtml([ambiguous]),/도로접면|중로한면|광대한면/);
});
test('dossier highlights missing facts without treating zero rent as missing or changing lease',()=>{
  assert.equal(ui.saleReviewGapsHtml({...land,tradeType:'lease'}),'');
  assert.equal(ui.saleReviewGapsHtml(building),'');
  assert.equal(ui.saleReviewGapsHtml({...building,saleDetails:{totalDeposit:0,monthlyIncome:0}}),'');
  const before=JSON.stringify(land), gaps=ui.saleReviewGapsHtml({...land,saleDetails:{}});
  assert.match(gaps,/광고 토지면적/);assert.match(gaps,/용도지역/);assert.match(gaps,/도로접면/);assert.doesNotMatch(gaps,/<details[^>]*\sopen/);
  assert.equal(JSON.stringify(land),before);
  const compare=w.comparisonHtml([{...building,saleDetails:{...building.saleDetails,exclusiveAreaM2:99.17,buildingAreaM2:100}}]);
  assert.match(compare,/전용면적/);assert.match(compare,/건축면적/);assert.match(compare,/㎡/);
});
