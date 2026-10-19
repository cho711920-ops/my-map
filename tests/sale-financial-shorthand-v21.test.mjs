import test from 'node:test';
import assert from 'node:assert/strict';
import {koreanMoneyManwon,saleDescriptionFields,supplementSaleDescription} from '../cloudflare/src/sale-description.js';
import {withSaleFinancialDisplay} from '../cloudflare/src/sale-financial-display.js';
import {naverSaleFields} from '../cloudflare/src/sale-fields.js';

test('만원 numeric fields, decimal 억 and lower named units keep the same scale',()=>{
  for(const [text,value] of [['8.0억',80000],['8.0억원',80000],['8억8천',88000],['8억 8천',88000],['8억8천4백5십',88450],['2억2천',22000],['0.8억',8000]])assert.equal(koreanMoneyManwon(text),value,text);
  for(const text of ['80000','8억8000','8억8천원','3천','8억8천9천'])assert.equal(koreanMoneyManwon(text),null,text);
  assert.equal(naverSaleFields({tradeType:'sale',salePrice:200000,saleRaw:{detailInfo:{priceInfo:{warrantyPrice:800000000}}}}).totalDeposit,80000);
});
test('current Naver won fields and decorated description labels retain source-local amounts and zero',()=>{
  const provider={naverPriceInfo:{previousDeposit:85000000,previousMonthlyRent:2280000}};
  const old={source:'네이버',tradeType:'sale',saleCategory:'building',salePrice:50000,saleDetails:{descriptionVersion:2,descriptionText:'-매매금액:5억원\n-보증금액:8천5백만원/월:228만원'}};
  assert.equal(naverSaleFields({salePrice:50000,saleRaw:{priceInfo:provider.naverPriceInfo}}).totalDeposit,8500);
  const result=withSaleFinancialDisplay(old,provider);assert.equal(result.saleDetails.totalDeposit,8500);assert.equal(result.saleDetails.monthlyIncome,228);
  assert.equal(withSaleFinancialDisplay({...old,saleDetails:{}},provider).saleDetails.monthlyIncome,228);
  assert.equal(withSaleFinancialDisplay({...old,saleDetails:{}},{naverPriceInfo:null}).saleDetails.monthlyIncome,undefined);
  assert.equal(saleDescriptionFields('-보증금액:8천5백만원').totalDeposit,8500);
  assert.equal(saleDescriptionFields('🔔보증금액:4천만원/월:405만원').totalDeposit,4000);
  assert.equal(withSaleFinancialDisplay({...old,saleDetails:{...old.saleDetails,totalDeposit:0}},provider).saleDetails.totalDeposit,0);
  assert.equal(withSaleFinancialDisplay({...old,saleDetails:{...old.saleDetails,totalDeposit:null,manualSaleFieldsV1:['totalDeposit']}},provider).saleDetails.totalDeposit,null);
  assert.equal(naverSaleFields({saleRaw:{priceInfo:{previousDeposit:0,previousMonthlyRent:0}}}).monthlyIncome,null);
  assert.equal(naverSaleFields({saleRaw:{priceInfo:{rentPrice:0,previousMonthlyRent:2280000}}}).monthlyIncome,0);
  for(const text of ['보증금 3천만원~5천만원','보증금 -5000만원','임대보증금액 약 5억원'])assert.equal(saleDescriptionFields(text).totalDeposit,null,text);
});
test('괴정동 4-10 wording reads the entire deposit and investment instead of the 억 prefix',()=>{
  const text='매매가 20억 (절충가능) 대출 9억 / 보증금 8억8천 / 총월세 638만 → 실투자금 2억2천 / 월순수익 226만 / 연수익 12.3%';
  const r=saleDescriptionFields(text);assert.equal(r.salePrice,200000);assert.equal(r.totalDeposit,88000);assert.equal(r.monthlyIncome,638);assert.equal(r.investmentAmount,22000);assert.equal(r.loanAmount,90000);assert.equal(r.statedMonthlyIncome,226);assert.equal(r.advertisedYield,12.3);
  assert.ok(text.includes(r.descriptionEvidence['보증금']));assert.match(r.descriptionEvidence['보증금'],/8억8천$/);
  const original={source:'네이버',tradeType:'sale',saleCategory:'mixed_house',salePrice:200000,saleDetails:{scope:'whole_building',descriptionVersion:2,descriptionText:text,monthlyIncome:638}};
  const before=JSON.stringify(original),shown=withSaleFinancialDisplay(original,{naverPriceInfo:{}});assert.equal(shown.saleDetails.totalDeposit,88000);assert.equal(shown.saleDetails.investmentAmount,22000);assert.equal(JSON.stringify(original),before);
});
test('explicit grouped amounts and label variants repair marked prior extraction while retaining structured and manual values',()=>{
  for(const [text,value] of [['보증금액: 87,700만원',87700],['보증금 - 8억 7,700만원',87700],['총 임대보증금액 = 8.0억',80000]])assert.equal(saleDescriptionFields(text).totalDeposit,value,text);
  assert.equal(koreanMoneyManwon('90.000만원'),90000);assert.equal(koreanMoneyManwon('8.000억'),80000);assert.equal(koreanMoneyManwon('300.000.000원'),30000);assert.equal(koreanMoneyManwon('8억 7,.700만원'),null);
  const old={source:'네이버',tradeType:'sale',saleCategory:'building',salePrice:200000,saleDetails:{descriptionVersion:2,descriptionText:'융자금액: 90.000만원',loanAmount:90,descriptionFinancials:{loanAmount:90},descriptionEvidence:{융자:'융자금액: 90.000만원'}}};
  assert.equal(withSaleFinancialDisplay(old,{naverPriceInfo:{}}).saleDetails.loanAmount,90000);
  assert.equal(withSaleFinancialDisplay({...old,saleDetails:{...old.saleDetails,loanAmount:80000}},{naverPriceInfo:{}}).saleDetails.loanAmount,80000);
  assert.equal(withSaleFinancialDisplay({...old,saleDetails:{...old.saleDetails,loanAmount:null,manualSaleFieldsV1:['loanAmount']}},{naverPriceInfo:{}}).saleDetails.loanAmount,null);
  assert.equal(saleDescriptionFields('보증금 -5000만원').totalDeposit,null);
  const typo=saleDescriptionFields('보증금 - 8억 7,.700만원');assert.equal(typo.totalDeposit,null);assert.match(typo.descriptionWarnings.join(' '),/표기 확인/);
});
test('line wraps and spaced deposit labels preserve exact evidence without merging floors or the next item',()=>{
  for(const text of ['보 증 금: 8억8천','총 임대보증금 합계 8억8천','보증금 8억\n8천 / 월세 638만원','보증금 8억\r\n8000만원']){
    const r=saleDescriptionFields(text);assert.equal(r.totalDeposit,88000,text);assert.ok(text.includes(r.descriptionEvidence['보증금']));
  }
  assert.equal(saleDescriptionFields('보증금 8.0억\n1층 상가 2개').totalDeposit,80000);
  assert.equal(saleDescriptionFields('보증금 8억\n2) 월세 638만원').totalDeposit,80000);
  for(const text of ['보증금 8억 5','보증금 8억 5천원','보증금 8억8천1층','보증금 8억8천9천'])assert.equal(saleDescriptionFields(text).totalDeposit,null,text);
});
test('shorthand never overrides structured/manual values, resolves conflicts, or promotes future/partial totals',()=>{
  const text='보증금 8억8천 / 총 월세 638만원';
  const result=supplementSaleDescription({scope:'whole_building',totalDeposit:80000},saleDescriptionFields(text),200000,text);assert.equal(result.totalDeposit,80000);assert.equal(result.descriptionFinancials.totalDeposit,88000);assert.match(result.descriptionWarnings.join(' '),/불일치/);
  assert.equal(saleDescriptionFields('보증금 8.0억\n보증금 8억8천').totalDeposit,null);
  assert.equal(saleDescriptionFields('만실시 보증금 8억8천 / 총월세 638만원').totalDeposit,null);
  assert.equal(supplementSaleDescription({scope:'whole_building'},saleDescriptionFields('1층 보증금 8억8천 / 월세 638만원'),200000,'').totalDeposit,undefined);
  assert.equal(withSaleFinancialDisplay({source:'네이버',tradeType:'lease',saleDetails:{descriptionText:text}}).saleDetails.totalDeposit,undefined);
});
