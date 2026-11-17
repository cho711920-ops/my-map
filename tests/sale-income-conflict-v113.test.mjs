import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withSaleFinancialDisplay as display} from '../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';
import {naverSaleFields} from '../cloudflare/src/sale-fields.js';
const description='상가주택 매매가 82,000만, 보증금합계 24,000만/월220만, 실투자금 58,000만';
const ad={originalId:'AD-A',propertyId:'MASTER-A',source:'네이버',tradeType:'sale',saleCategory:'mixed_house',salePrice:82000,
 saleDetails:{scope:'whole_building',descriptionVersion:3,descriptionText:description,totalDeposit:24000,monthlyIncome:2200}};
const provider={naverPriceInfo:{previousDeposit:240000000,previousMonthlyRent:22000000}};
function ui(){const window={};vm.runInNewContext(readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}}}});return window.JSListingTradeV1;}

const unitDescription='다가구 매매가 11억 보증금 6억8100만원 월세 604만원 실투자금 4억1900만원';
const unitPrice={price:1100000000,previousDeposit:0,previousMonthlyRent:60400000000};
const unitAd={...ad,saleCategory:'multifamily',salePrice:110000,saleDetails:{scope:'whole_building',descriptionText:unitDescription,totalDeposit:68100,monthlyIncome:6040000}};
test('v256 exact won/manwon mismatch normalizes this ad on ingestion and read without mutating raw or another ad',()=>{
 const raw={salePrice:110000,saleCategory:'multifamily',description:unitDescription,saleRaw:{priceInfo:unitPrice}},before=structuredClone(raw);
 const collected=naverSaleFields(raw);assert.equal(collected.monthlyIncome,604);assert.equal(collected.monthlyIncomeUnitCorrectionV256.sourceWon,60400000000);assert.deepEqual(raw,before);
 const old=structuredClone(unitAd),shown=display(unitAd,{naverPriceInfo:unitPrice});assert.equal(shown.saleDetails.monthlyIncome,604);assert.equal(shown.saleDetails.monthlyIncomeConflict,undefined);assert.deepEqual(unitAd,old);
 assert.deepEqual(display(shown,{naverPriceInfo:unitPrice}),shown);assert.equal(ui().saleYield(shown).toFixed(2),'17.30');
 assert.equal(display({...unitAd,saleDetails:{...unitAd.saleDetails,monthlyIncome:605}},{naverPriceInfo:unitPrice}).saleDetails.monthlyIncome,605);
 assert.equal(naverSaleFields({...raw,saleRaw:{priceInfo:{...unitPrice,previousMonthlyRent:6040000}}}).monthlyIncome,604);
});
test('v256 established cached unit mismatch renders normal rent without a giant second price; genuine conflicts remain visible',()=>{
 const detail={scope:'whole_building',monthlyIncome:604,totalDeposit:68100,monthlyIncomeConflict:{structured:6040000,description:604,basis:'description'}};
 const item={...unitAd,saleDetails:detail},before=structuredClone(item),html=ui().saleCardFactsHtml(item,true);
 assert.match(html,/604만원/);assert.match(html,/17\.30%/);assert.doesNotMatch(html,/6,040,000|숫자·설명 불일치/);assert.deepEqual(item,before);
 const genuine=ui().saleCardFactsHtml({...ad,saleDetails:{monthlyIncome:220,totalDeposit:24000,monthlyIncomeConflict:{structured:2200,description:220,basis:'description'}}},true);assert.match(genuine,/숫자·설명 불일치/);
});
test('v256 manual values, uncertain scope/units, future rent, net profit, price or deposit conflicts never receive unit repair',()=>{
 for(const patch of [{monthlyIncome:0,manualSaleFieldsV1:['monthlyIncome']},{monthlyIncome:6040000,manualSaleFieldsV1:['monthlyIncome']},
  {descriptionText:'1층 보증금 6억8100만원 / 월세604만원'},{descriptionText:'만실시 월세604만원'},
  {descriptionText:'월수익(이자제외)604만원'},{descriptionText:'월세604'},
  {descriptionText:'매매가 12억원 보증금 6억8100만원 월세604만원'},
  {descriptionText:'보증금 7억원 월세604만원'}, {descriptionText:'월세604만원\n월세605만원'}, {scope:'land'}]){
  const input={...unitAd,saleDetails:{...unitAd.saleDetails,...patch}},shown=display(input,{naverPriceInfo:unitPrice});assert.equal(shown.saleDetails.monthlyIncomeUnitCorrectionV256,undefined,JSON.stringify(patch));
 }
});

test('the same ad uses explicit current description rent with both conflicting values retained and no writes',()=>{
 const before=structuredClone(ad),shown=display(ad,provider),summary=compactSaleSummary(shown);
 assert.equal(shown.saleDetails.monthlyIncome,220);assert.equal(summary.monthlyIncome,220);
 assert.deepEqual(summary.monthlyIncomeConflict,{structured:2200,description:220,basis:'description'});
 assert.deepEqual(ad,before);assert.equal(provider.naverPriceInfo.previousMonthlyRent,22000000);
 assert.equal(shown.originalId,ad.originalId);assert.equal(shown.propertyId,ad.propertyId);
 assert.deepEqual(display(shown,provider).saleDetails.monthlyIncomeConflict,summary.monthlyIncomeConflict);
 assert.equal(ui().saleYield(shown).toFixed(2),'4.55');
 const card=ui().saleCardFactsHtml({...shown,saleDetails:summary},true);
 assert.match(card,/220만원/);assert.match(card,/설명 기준/);assert.match(card,/숫자·설명 불일치/);
 assert.match(card,/2,200만원/);assert.match(card,/4\.55%/);assert.doesNotMatch(card,/45\.52%/);
 for(const income of [188,198]){
   const other=display({...ad,originalId:'AD-'+income,saleDetails:{scope:'whole_building',monthlyIncome:income,descriptionText:'보증금 3억원 / 월세 '+income+'만원'}});
   assert.equal(other.saleDetails.monthlyIncome,income);assert.equal(other.saleDetails.monthlyIncomeConflict,undefined);
 }
});

test('manual rent, incomplete scope, net profit, future scenarios and a conflicting sale price are not overwritten',()=>{
 for(const patch of [
   {monthlyIncome:0,manualSaleFieldsV1:['monthlyIncome']},
   {descriptionText:'1층 보증금 24,000만원 / 월세220만원'},
   {descriptionText:'보증금 24,000만원 / 월수익(이자제외)220만원'},
   {descriptionText:'만실시 보증금 24,000만원 / 월세220만원'},
   {descriptionText:'매매가 9억원 보증금 24,000만원 / 월세220만원'},
   {descriptionText:'보증금 24,000만원 / 월세220만원\n월세250만원'}
 ]){
   const input={...ad,saleDetails:{...ad.saleDetails,...patch}},shown=display(input,provider);
   assert.equal(shown.saleDetails.monthlyIncome,patch.monthlyIncome??2200,JSON.stringify(patch));
   assert.equal(shown.saleDetails.monthlyIncomeConflict,undefined);
 }
});
