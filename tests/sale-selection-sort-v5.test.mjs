import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={addEventListener(){},dispatchEvent(){}};
const context={window,document:{getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){},removeAttribute(){}},addEventListener(){}},CustomEvent:class{}};
for(const file of ['listing-trade-ui-v1.js','sale-workbench-v1.js'])vm.runInNewContext(fs.readFileSync('js/'+file,'utf8'),context);
const ui=window.JSListingTradeV1,w=window.JSSaleWorkbenchV1;
const building={tradeType:'sale',saleCategory:'building',salePrice:50000,saleDetails:{landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:5000,monthlyIncome:200}};

test('sale sorting keeps unknown values last in either direction while zero income remains valid',()=>{
  for(const key of ['salePriceLow','salePriceHigh','saleLandLow','saleLandHigh','saleUnitLow','saleUnitHigh','saleYieldHigh','saleIncomeHigh','saleGrossHigh']){
    assert.ok(w.sortLabel(key));assert.equal(w.compareSortValues(null,1,key),1);assert.equal(w.compareSortValues(1,null,key),-1);
    assert.equal(w.compareSortValues(null,null,key),0);
  }
  assert.equal(w.sortLabel('rentLow'),'');
  assert.equal(w.sortValue({...building,saleDetails:{monthlyIncome:0}},'saleIncomeHigh'),0);
  assert.equal(w.sortValue({...building,saleDetails:{}},'saleIncomeHigh'),null);
  assert.equal(w.sortValue({...building,salePrice:null},'salePriceLow'),null);
  assert.equal(w.sortValue({...building,tradeType:'lease'},'salePriceHigh'),null);
  assert.equal(w.sortValue(building,'saleUnitLow'),500);assert.equal(w.sortValue(building,'saleGrossHigh'),661.157);
});
test('building unit prices keep the denominator explicit and never substitute cadastral area',()=>{
  const before=JSON.stringify(building),html=ui.buildingUnitPricesHtml(building);
  assert.match(html,/대지 기준.*500만원\/평/);assert.match(html,/연면적 기준.*250만원\/평/);
  assert.match(html,/건물 총매매가/);assert.equal(JSON.stringify(building),before);
  assert.equal(ui.buildingUnitPricesHtml({...building,saleCategory:'land'}),'');
  assert.equal(ui.buildingUnitPricesHtml({...building,tradeType:'lease'}),'');
  assert.equal(ui.buildingUnitPricesHtml({...building,saleDetails:{cadastralAreaM2:1000}}),'');
});
test('comparison highlights differences without ranking a winner or exposing missing facts as zero',()=>{
  const second={...building,salePrice:60000,saleDetails:{...building.saleDetails,monthlyIncome:null}};
  const html=w.comparisonHtml([building,second]);
  assert.match(html,/data-compare-differences/);assert.match(html,/sale-compare-different-v5/);
  assert.match(html,/data-compare-same="true"/);assert.match(html,/미확인/);
  assert.doesNotMatch(html,/최고 매물|추천 매물|>0만원</);
  const safe=w.comparisonHtml([{...building,name:'<script>'},second]);assert.match(safe,/&lt;script&gt;/);
});
