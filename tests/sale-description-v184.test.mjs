import test from 'node:test';
import assert from 'node:assert/strict';
import {saleDescriptionFields} from '../cloudflare/src/sale-description.js';
import {withSaleFinancialDisplay} from '../cloudflare/src/sale-financial-display.js';
import {queryWireV151} from '../cloudflare/src/query-worker-v151.js';
import {daangnSaleFields,naverSaleFields} from '../cloudflare/src/sale-fields.js';

const first='○ 건물 현황 대지 - 약 79평 (262.9m2) 준공년도 - 2014년 ○ 투자분석 매매가 - 9억 융자 - 약 2억 6000만 임대 보증금 - 약 4억 4800만 월세 - 약 130만 실투자금 - 약 1억 9000만';
const second='○ 건물내역 대지 - 약 110평 연면적 - 167평 준공년도 - 2008년 ○ 건물구성 원룸 - 8개 // 투룸 - 6개 // 주인세대 - 1개 총 - 15세대 ○ 투자정보 매매가 - 11억 융자 - 3억 총 보증금 - 약 5억 총 월세 - 약 370만 실투자금 - 약 3억';
const third='실투자 – 6억 8천만원 매매가 – 7억 보증금 – 2천만원 / 월 656만원 대출금 – 없음 수익률 – 11.6% 🏠부동산 정보🏠 대지 – 50평\n세대현황 총20호실';
for(const [name,text,price,deposit,income,loan,investment] of [['first',first,90000,44800,130,26000,19000],['second',second,110000,50000,370,30000,30000],['third',third,70000,2000,656,0,68000]])test('v184 exact labelled financial ledger '+name,()=>{
 const fields=saleDescriptionFields(text);
 for(const [key,value] of Object.entries({salePrice:price,totalDeposit:deposit,monthlyIncome:income,loanAmount:loan,investmentAmount:investment})) assert.equal(fields[key],value,key);
 const original={source:'당근',tradeType:'sale',saleCategory:'building',salePrice:price,saleDetails:{scope:'whole_building',descriptionText:text}},saved=structuredClone(original);
 const shown=withSaleFinancialDisplay(original).saleDetails;
 assert.equal(shown.totalDeposit,deposit);assert.equal(shown.monthlyIncome,income);assert.deepEqual(original,saved);
 assert.equal(daangnSaleFields({content:text}).monthlyIncome,income);
 assert.equal(naverSaleFields({description:text}).monthlyIncome,income);
});
test('v184 explicit approximate values carry evidence, units, areas and household counts',()=>{
 assert.equal(saleDescriptionFields('임대보증금액 약 5억원').totalDeposit,50000);
 assert.equal(saleDescriptionFields(first).landAreaM2,262.9);
 const p=saleDescriptionFields(second);assert.equal(p.landAreaM2,363.64);assert.equal(p.grossAreaM2,552.07);assert.equal(p.householdCount,15);
 assert.equal(saleDescriptionFields(third).landAreaM2,165.29);assert.equal(saleDescriptionFields(third).householdCount,20);assert.equal(saleDescriptionFields(third).advertisedYield,11.6);
 assert.match(saleDescriptionFields(first).descriptionEvidence['보증금'],/약 4억 4800만/);
});
test('v184 ambiguous, conflicting, partial, projected and net amounts are never upgraded to current whole-building rent',()=>{
 for(const text of ['보증금 -5000만원','보증금 약 3~5억원','월 656만원','실투자 3억 정도','대출금 없음 / 대출금 2억원']) {
  const p=saleDescriptionFields(text);
  if(text==='대출금 없음 / 대출금 2억원')assert.equal(p.loanAmount,null);
  else if(text.startsWith('보증금'))assert.equal(p.totalDeposit,null);
  else if(text.startsWith('월 '))assert.equal(p.monthlyIncome,null);
 }
 for(const text of ['만실시 보증금 - 약 1억원 / 월세 - 약 300만원','1층 보증금 - 약 1억원 / 월세 - 약 300만원','보증금 - 약 1억원 / 월세 - 약 300만원(이자공제후)']) {
  const shown=withSaleFinancialDisplay({source:'당근',tradeType:'sale',saleCategory:'building',salePrice:90000,saleDetails:{scope:'whole_building',descriptionText:text}});
  assert.ok(shown.saleDetails.monthlyIncome==null,text);
 }
});
test('v184 source price mismatch and manually saved values remain authoritative',()=>{
 const original={source:'당근',tradeType:'sale',saleCategory:'building',salePrice:100000,saleDetails:{scope:'whole_building',descriptionText:second}};
 assert.ok(withSaleFinancialDisplay(original).saleDetails.monthlyIncome==null);
 original.salePrice=110000;Object.assign(original.saleDetails,{totalDeposit:0,monthlyIncome:80,manualSaleFieldsV1:['totalDeposit','monthlyIncome']});
 const shown=withSaleFinancialDisplay(original).saleDetails;assert.equal(shown.totalDeposit,0);assert.equal(shown.monthlyIncome,80);
});

test('v184 explicitly cleared manual land and gross areas are not repopulated from the source',()=>{
 const shown=withSaleFinancialDisplay({source:'당근',tradeType:'sale',saleCategory:'building',salePrice:110000,saleDetails:{scope:'whole_building',descriptionText:second,landAreaM2:null,grossAreaM2:null,manualSaleFieldsV1:['landAreaM2','grossAreaM2']}});
 assert.equal(shown.saleDetails.landAreaM2,null);assert.equal(shown.saleDetails.grossAreaM2,null);
});

test('v184 initial query cards preserve source financial amounts without sending source prose or contacts',()=>{
 const detail=saleDescriptionFields(third);const source={propertyId:'V184',tradeType:'sale',saleCategory:'building',salePrice:70000,saleDetails:{...detail,scope:'whole_building',descriptionText:third,privateContact:'DO_NOT_SEND'}};
 const packet=queryWireV151([source],'revision');const shown=packet.rows[0][packet.fields.indexOf('saleDetails')];
 for(const key of ['totalDeposit','monthlyIncome','monthlyNetIncome','statedMonthlyIncome','loanAmount','investmentAmount','advertisedYield','landAreaM2'])assert.equal(shown[key],detail[key]);
 assert.doesNotMatch(JSON.stringify(packet),/descriptionText|privateContact|DO_NOT_SEND|세대현황/);
});
