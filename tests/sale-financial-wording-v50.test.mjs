import test from 'node:test';
import assert from 'node:assert/strict';
import {saleDescriptionFields,supplementSaleDescription} from '../cloudflare/src/sale-description.js';
import {withSaleFinancialDisplay} from '../cloudflare/src/sale-financial-display.js';

const sampleA='매매가격: 6억 3,000만 원 총 보증금: 1억 4,500만 원 월세 수익: 월 215만 원 (연 2,580만 원) 실투자금: 4억 8,500만 원 연 수익률: 5.31%';
const sampleB='현재대출금액: 2억2500만원 ●현재보증금총액: 2억6500만원(조정가능) ●월임대료: 313만원 ●인수시 필요자금: 2억원';
for(const [description,price,deposit,income] of [[sampleA,63000,14500,215],[sampleB,69000,26500,313]]){
 test(`user screenshot wording yields exact own-source deposit ${deposit} and rent ${income}`,()=>{
  const parsed=saleDescriptionFields(description);assert.equal(parsed.totalDeposit,deposit);assert.equal(parsed.monthlyIncome,income);
  for(const quote of Object.values(parsed.descriptionEvidence))assert.ok(description.includes(quote));
  const before={source:'당근',tradeType:'sale',saleCategory:'building',salePrice:price,saleDetails:{scope:'whole_building',descriptionVersion:3,descriptionText:description}};
  const saved=structuredClone(before),shown=withSaleFinancialDisplay(before);assert.equal(shown.saleDetails.totalDeposit,deposit);assert.equal(shown.saleDetails.monthlyIncome,income);assert.deepEqual(before,saved);
 });
}
for(const label of ['월세 수익','월 세 수 입','월 임대 수입','현재월세','현 월세','월세총액','총월세소득','월 임대료','기존 월차임'])test(`explicit rent label ${label}`,()=>assert.equal(saleDescriptionFields(`${label}: 215만원`).monthlyIncome,215));
for(const label of ['현재보증금총액','현보증금','현재 임대 보증금 합계','현임차보증금','기존보증금','보증금합'])test(`explicit deposit label ${label}`,()=>assert.equal(saleDescriptionFields(`${label}: 2억6500만원`).totalDeposit,26500));
for(const text of ['보증금액/월세:1억원/100만원','총보증금/월임대료:1억원/100만원','보증금 및 월세:1억원/100만원','보증금/월세(현재):1억원/100만원'])test(`paired current amounts: ${text}`,()=>{
 const p=saleDescriptionFields(text);assert.equal(p.totalDeposit,10000);assert.equal(p.monthlyIncome,100);
});
test('future, ranges, missing units, annual income, net profit and insurer guarantees never become current gross income',()=>{
 for(const text of ['만실시 월세수익: 215만원','예상 임대조건 현재보증금: 2억6500만원 / 월세수입:215만원','월세수익:215~300만원','월세수익:215','연 임대수입:2580만원','월순수익:215만원','월세수입:215만원(이자공제후)','월세소득:215만원(대출이자 차감 후)','보증금/월세(만실시):1억원/100만원'])assert.equal(saleDescriptionFields(text).monthlyIncome,null,text);
 assert.equal(saleDescriptionFields('월세:215만원(이자공제 전)').monthlyIncome,215);
 assert.equal(saleDescriptionFields('손해배상책임보증 2억원').totalDeposit,null);
});
test('conflicts, unit-only amounts and manual/structured values retain their barriers',()=>{
 assert.equal(saleDescriptionFields('월세수익:215만원 / 월세수입:300만원').monthlyIncome,null);
 const partial=supplementSaleDescription({scope:'whole_building'},saleDescriptionFields('1층 상가 현재보증금:1억원 / 월세수익:215만원'),63000,'');assert.equal(partial.totalDeposit,undefined);assert.equal(partial.monthlyIncome,undefined);
 const old={source:'네이버',tradeType:'sale',saleCategory:'building',salePrice:63000,saleDetails:{scope:'whole_building',descriptionText:sampleA,totalDeposit:null,monthlyIncome:0,manualSaleFieldsV1:['totalDeposit','monthlyIncome']}};
 const shown=withSaleFinancialDisplay(old,{naverPriceInfo:{rentPrice:3000000}});assert.equal(shown.saleDetails.totalDeposit,null);assert.equal(shown.saleDetails.monthlyIncome,0);
 const structured=withSaleFinancialDisplay({...old,saleDetails:{scope:'whole_building',descriptionText:sampleA}},{naverPriceInfo:{warrantyPrice:100000000,rentPrice:3000000}});assert.equal(structured.saleDetails.totalDeposit,10000);assert.equal(structured.saleDetails.monthlyIncome,300);
 const conflict=withSaleFinancialDisplay({...old,salePrice:70000,saleDetails:{scope:'whole_building',descriptionText:sampleA}});assert.equal(conflict.saleDetails.monthlyIncome,undefined);
});
