import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withSaleFinancialDisplay as display} from '../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../cloudflare/src/d1-api.js';
const description='상가주택 매매가 82,000만, 보증금합계 24,000만/월220만, 실투자금 58,000만';
const ad={originalId:'AD-A',propertyId:'MASTER-A',source:'네이버',tradeType:'sale',saleCategory:'mixed_house',salePrice:82000,
 saleDetails:{scope:'whole_building',descriptionVersion:3,descriptionText:description,totalDeposit:24000,monthlyIncome:2200}};
const provider={naverPriceInfo:{previousDeposit:240000000,previousMonthlyRent:22000000}};
function ui(){const window={};vm.runInNewContext(readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}}}});return window.JSListingTradeV1;}

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
