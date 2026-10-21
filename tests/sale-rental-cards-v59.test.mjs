import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {saleDescriptionFields as parse} from '../cloudflare/src/sale-description.js';
import {withSaleFinancialDisplay as display} from '../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';
const original=text=>({source:'당근',tradeType:'sale',saleCategory:'factory_warehouse',salePrice:89000,saleDetails:{scope:'whole_building',descriptionText:text}});
function ui(){const window={};vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}}}});return window.JSListingTradeV1;}
for(const [text,deposit,rent] of [
  ['현세입자 보3천/월250만 - 승계가능 /매수자 입주가능',3000,250],
  ['보증금 2억1천5백만/ 월700',21500,700],
  ['보증금 5000 / 월400',5000,400],
  ['보/월:3000/250',3000,250],
  ['보/월세:4000만원/290만원',4000,290],
  ['보1000 세100만원',1000,100],
  ['보증금 / 월세 : 4000 / 290만원',4000,290]
])test('paired advertiser rental shorthand: '+text,()=>{
  const p=parse(text);assert.equal(p.totalDeposit,deposit);assert.equal(p.monthlyIncome,rent);
  const shown=display(original(text)),summary=compactSaleSummary(shown),html=ui().saleCardFactsHtml({...shown,saleDetails:summary},true);
  assert.match(html,new RegExp(deposit.toLocaleString('ko-KR')+'만원'));assert.match(html,new RegExp(rent.toLocaleString('ko-KR')+'만원'));
  assert.ok(text.includes(shown.saleDetails.descriptionEvidence['보증금']));
});

test('price mismatch and partial scope stay visible as references without becoming yield inputs',()=>{
  const api=ui();
  for(const [text,reason] of [['매매가9억\n보3천/월250만','price_conflict'],['1층 상가 보3천/월250만','partial_scope']]){
    const item=original(text),before=structuredClone(item),shown=display(item),summary=compactSaleSummary(shown);
    assert.equal(shown.saleDetails.totalDeposit,undefined);assert.equal(shown.saleDetails.monthlyIncome,undefined);
    assert.equal(summary.rentalReference.totalDeposit.reason,reason);assert.equal(summary.rentalReference.monthlyIncome.value,250);
    const card={...shown,saleDetails:summary};assert.equal(api.saleYield(card),null);
    const html=api.saleCardFactsHtml(card,true);assert.match(html,/원문 보증금 · 확인 필요/);assert.match(html,/원문 월세 · 확인 필요/);assert.match(html,/3,000만원/);assert.match(html,/250만원/);assert.doesNotMatch(html,/단순 연 수익률/);
    assert.deepEqual(item,before);
  }
});

test('one present financial value renders alone; unknown values are never fabricated or borrowed',()=>{
  const api=ui();
  for(const [details,yes,no] of [[{totalDeposit:3000},'보증금 합계','월 임대수입'],[{monthlyIncome:250},'월 임대수입','보증금 합계'],[{monthlyNetIncome:150},'광고 월수익 · 이자 차감','월 임대수입']]){
    const html=api.saleCardFactsHtml({...original(''),saleDetails:details},true);assert.ok(html.includes(yes));assert.ok(!html.includes(no));assert.doesNotMatch(html,/>0만원</);
  }
  const master={...original(''),saleDetails:null,unifiedOriginalsV8:[{...original(''),saleDetails:{rentalReference:{totalDeposit:{value:3000,reason:'partial_scope'}}}},{...original(''),saleDetails:{rentalReference:{totalDeposit:{value:9000,reason:'partial_scope'}}}}]};
  assert.equal(api.saleCardFactsHtml(master,true),'');
});

test('manual blanks, future, net income and insurance language do not become current gross rent',()=>{
  for(const text of ['만실시 보3천/월250만','예상 임대조건 보/월:3000/250','보증금3000만원/월200만원(이자공제 후)','보증보험3억원/월200만원'])assert.equal(parse(text).monthlyIncome,null,text);
  const row=original('보3천/월250만');row.saleDetails.manualSaleFieldsV1=['totalDeposit','monthlyIncome'];row.saleDetails.totalDeposit=null;row.saleDetails.monthlyIncome=0;
  const shown=display(row);assert.equal(shown.saleDetails.totalDeposit,null);assert.equal(shown.saleDetails.monthlyIncome,0);assert.equal(shown.saleDetails.rentalReference,undefined);
});
