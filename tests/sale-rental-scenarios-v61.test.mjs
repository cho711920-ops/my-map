import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {saleDescriptionFields as parse} from '../cloudflare/src/sale-description.js';
import {withSaleFinancialDisplay as display} from '../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';
const make=text=>({source:'당근',tradeType:'sale',saleCategory:'building',salePrice:80000,saleDetails:{scope:'whole_building',descriptionText:text}});
function ui(){const window={};vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}}}});return window.JSListingTradeV1;}
export const projectedText='매매가:8억 *월수익: 보3000/월760만 (만실기준임) *구조:1층 주차장\n2층 원룸8개\n3층 원룸8개\n4층 원룸8개\n5층 원룸8개';
export const floorsText='1층 상가2개 보증금2천/월세80만\n2층 2룸2가구 보증금4500/월세30만\n3층 3룸1개 보증금6500';

test('Jungri advertised full-occupancy amounts stay visible but never become current rent or yield',()=>{
  const original=make(projectedText),before=structuredClone(original),shown=display(original),d=shown.saleDetails;
  assert.equal(d.totalDeposit,undefined);assert.equal(d.monthlyIncome,undefined);
  assert.deepEqual(d.rentalScenarios,[{kind:'full_occupancy',unitAssumptions:['totalDeposit'],totalDeposit:3000,monthlyIncome:760}]);
  const summary=compactSaleSummary(shown),card={...shown,saleDetails:summary},api=ui();
  assert.equal(api.saleYield(card),null);const html=api.saleCardFactsHtml(card,true);
  for(const text of ['만실 기준 보증금','3,000만원','만실 기준 월 임대수입','760만원','현재 임대수입·수익률 계산에 미반영'])assert.ok(html.includes(text));
  assert.doesNotMatch(JSON.stringify(summary),/descriptionText|원룸/);assert.deepEqual(original,before);
});
test('known current rental conditions remain separate from full occupancy assumptions',()=>{
  const original=make('현재 보증금3000만원/월250만원\n만실기준 보5000/월760만원');
  const shown=display(original);assert.equal(shown.saleDetails.totalDeposit,3000);assert.equal(shown.saleDetails.monthlyIncome,250);
  assert.equal(shown.saleDetails.rentalScenarios[0].monthlyIncome,760);assert.equal(ui().saleYield(shown),250*12/(80000-3000)*100);
});
test('Hongdo floor amounts and incomplete rent remain a conditional subtotal, never a canonical total',()=>{
  const shown=display(make(floorsText)),d=shown.saleDetails;
  assert.equal(d.totalDeposit,undefined);assert.equal(d.monthlyIncome,undefined);
  assert.deepEqual(d.rentalBreakdown.map(r=>[r.floor,r.totalDeposit,r.monthlyIncome]),[['1층',2000,80],['2층',4500,30],['3층',6500,undefined]]);
  const summary=compactSaleSummary(shown),api=ui(),html=api.saleCardFactsHtml({...shown,saleDetails:summary},true);
  for(const value of ['13,000만원','110만원','일부 월세 미기재','층 전체 조건이라는 가정','호실 수로 곱하지 않음'])assert.ok(html.includes(value));
  assert.equal(api.saleYield(shown),null);assert.equal(summary.rentalBreakdown[2].monthlyIncome,undefined);
});
test('duplicate floors and conflicting hypothetical figures do not manufacture a total',()=>{
  const scenario=parse('만실기준 보3000/월760만원\n만실기준 보5000/월900만원');assert.deepEqual(scenario.rentalScenarios,[]);
  const shown=display(make('1층 보증금3000만원/월세200만원\n1층 보증금5000만원/월세300만원\n2층 보증금2000만원/월세100만원'));
  const html=ui().saleCardFactsHtml(shown,true);assert.match(html,/층별 임대조건/);assert.doesNotMatch(html,/기재금액 합:/);
  assert.deepEqual(parse('1층 매매가8억 수익분석 보증금3000만원 월세200만원\n1층 매매가8억 수익분석 보증금3000만원 월세200만원').rentalBreakdown,[]);
});
test('expected, raised rent, insurance and net profit do not become current gross income',()=>{
  assert.equal(parse('예상 임대조건 보3000/월760만원').rentalScenarios[0].kind,'expected');
  for(const text of ['월세20만원 인상가능','보증보험3억원/월200만원','예상 월수익(이자제외):100만원']){
    const d=parse(text);assert.equal(d.monthlyIncome,null);assert.deepEqual(d.rentalScenarios,[]);
  }
});
test('explicit per-unit and former vacant-floor terms are labelled and withheld from subtotals',()=>{
  for(const [text,label] of [
    ['1층 각각 보증금3000만원 월세100만원\n2층 보증금2000만원 월세50만원','호실별'],
    ['2층 공실 기존 보증금1억 월세210만원\n5층 공실 기존 보증금3000만원 월세150만원','이전 조건']
  ]){
    const html=ui().saleCardFactsHtml(display(make(text)),true);assert.ok(html.includes(label));assert.doesNotMatch(html,/기재금액 합:/);
  }
  const d=parse('1층 상가보증금2000만원 월세125만원.\n2층 주택보증금3000만원 월세50만원.');
  assert.deepEqual(d.rentalBreakdown.map(r=>r.monthlyIncome),[125,50]);
});
test('manual blanks and zero remain authoritative even with additional original context',()=>{
  const original=make(projectedText);original.saleDetails={...original.saleDetails,totalDeposit:null,monthlyIncome:0,manualSaleFieldsV1:['totalDeposit','monthlyIncome']};
  const shown=display(original);assert.equal(shown.saleDetails.totalDeposit,null);assert.equal(shown.saleDetails.monthlyIncome,0);
  for(const patch of [{tradeType:'lease'},{saleCategory:'land'}]){const other={...original,...patch};assert.equal(display(other),other);}
});
test('compact supplemental context strips text and rejects malformed or unbounded values',()=>{
  const s=compactSaleSummary({...make(''),saleDetails:{rentalScenarios:[{kind:'full_occupancy',monthlyIncome:760,descriptionText:'private'}],rentalBreakdown:[{floor:'1층',totalDeposit:3000,phone:'private'},{floor:'bad',monthlyIncome:Infinity}]}});
  assert.doesNotMatch(JSON.stringify(s),/private|Infinity|bad/);assert.equal(s.rentalBreakdown.length,1);
});
