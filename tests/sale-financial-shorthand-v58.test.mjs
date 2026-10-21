import test from 'node:test';
import assert from 'node:assert/strict';
import {saleDescriptionFields as parse} from '../cloudflare/src/sale-description.js';
import {withSaleFinancialDisplay as display} from '../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';
const text='매매금액:8억\n보증금:5천\n총월세:253';
const item={source:'네이버',tradeType:'sale',saleCategory:'building',salePrice:80000,saleDetails:{scope:'whole_building',descriptionVersion:4,descriptionText:text,totalDeposit:null,monthlyIncome:null}};

test('Galma 377-37 shorthand reaches exact original financials with source quotes and unit provenance',()=>{
  const source=structuredClone(item),shown=display(item);
  assert.equal(shown.saleDetails.totalDeposit,5000);assert.equal(shown.saleDetails.monthlyIncome,253);
  assert.deepEqual(shown.saleDetails.descriptionUnitAssumptions,['totalDeposit','monthlyIncome']);
  assert.equal(shown.saleDetails.descriptionEvidence['보증금'],'보증금:5천');
  assert.equal(shown.saleDetails.descriptionEvidence['월 임대수입'],'총월세:253');
  assert.deepEqual(compactSaleSummary(shown).descriptionUnitAssumptions,['totalDeposit','monthlyIncome']);
  assert.deepEqual(item,source);
  assert.deepEqual(display(shown).saleDetails.descriptionUnitAssumptions,['totalDeposit','monthlyIncome']);
});

for(const [text,deposit,rent] of [
  ['보증금:1억6,500\n총월세:1,013',16500,1013],
  ['보증금 3000 / 월세 180',3000,180],
  ['보증금 3천3백 / 월세수입:195만',3300,195],
  ['단위:만원\n보증금:5000\n총월세:253',5000,253],
  ['보증금:0 / 월세:253',0,253]
])test('bounded current shorthand: '+text,()=>{
  const p=parse(text);assert.equal(p.totalDeposit,deposit);assert.equal(p.monthlyIncome,rent);
});

test('bare figures cannot truncate thousands, currencies, ranges or larger numbers into a false rent',()=>{
  for(const text of ['보증금 15억 원에 월세 1,720만원이 발생됩니다.','보증금:15억\n월세:1,720만원\n보증금 15억 원에 월세 1,720만원이 발생됩니다.']){
    const p=parse(text);assert.notEqual(p.monthlyIncome,1);assert.ok(p.monthlyIncome==null||p.monthlyIncome===1720);
  }
  for(const text of ['월세수익:215','월세:3000000','보증금:5000만원\n월세:253 USD','보증금:5000만원\n월세:253개월','보증금:5000만원\n월세:253~300','보증금:5000만원\n월세:010-1234-5678','보증금:5000만원\n월세:2026.10.21'])assert.equal(parse(text).monthlyIncome,null,text);
  for(const text of ['보증금:1억5천원','보증금:1억5000','보증금:100000000'])assert.equal(parse(text).totalDeposit,null,text);
});

test('future, unit/floor amounts, contradictory figures and after-interest profits retain calculation guards',()=>{
  for(const text of ['만실시 보증금:5천 총월세:253','예상 임대조건 보증금:5000 월세:253','보증금:5000 월세:253 (대출이자 차감 후)'])assert.equal(parse(text).monthlyIncome,null,text);
  const partial=display({...item,saleDetails:{scope:'whole_building',descriptionText:'1층 상가 보증금:5천 / 월세:253'}});
  assert.equal(partial.saleDetails.totalDeposit,undefined);assert.equal(partial.saleDetails.monthlyIncome,undefined);
  assert.equal(parse(text+'\n총월세:300만원').monthlyIncome,null);
});

test('manual and structured fields remain authoritative; lease, land and another ad cannot supply missing income',()=>{
  const manual=display({...item,saleDetails:{...item.saleDetails,totalDeposit:0,monthlyIncome:null,manualSaleFieldsV1:['totalDeposit','monthlyIncome']}},{naverPriceInfo:{rentPrice:3000000}});
  assert.equal(manual.saleDetails.totalDeposit,0);assert.equal(manual.saleDetails.monthlyIncome,null);
  assert.deepEqual(manual.saleDetails.descriptionUnitAssumptions,[]);
  const structured=display({...item,saleDetails:{...item.saleDetails,totalDeposit:6000}},{naverPriceInfo:{rentPrice:3000000}});
  assert.equal(structured.saleDetails.totalDeposit,6000);assert.equal(structured.saleDetails.monthlyIncome,300);
  for(const patch of [{tradeType:'lease'},{saleCategory:'land'}]){const other={...item,...patch};assert.equal(display(other),other);}
  const other=display({...item,saleDetails:{scope:'whole_building'}},{source:'당근',naverDescription:text});
  assert.equal(other.saleDetails.totalDeposit,undefined);
});
