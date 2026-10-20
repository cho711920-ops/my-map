import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={addEventListener(){}};
const context={window,document:{getElementById(){},querySelector(){},querySelectorAll(){return [];},documentElement:{setAttribute(){},removeAttribute(){}}},CustomEvent:class{}};
for(const name of ['listing-trade-ui-v1','wide-detail-v26','sale-public-review-v6'])vm.runInNewContext(fs.readFileSync('js/'+name+'.js','utf8'),context);
const detail={landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:5000,monthlyIncome:200};
const item={tradeType:'sale',saleCategory:'building',salePrice:50000,saleDetails:detail};
test('ad-based calculations expose exact denominators without changing the original',()=>{
  const before=JSON.stringify(item),html=window.JSWideDetailV26.saleCalculationHtml(item);
  assert.match(html,/500만원\/평/);assert.match(html,/250만원\/평/);assert.match(html,/5\.33%/);
  assert.match(html,/광고 대지면적 100평/);assert.match(html,/광고 연면적 200평/);
  assert.match(html,/보증금 5,000만원/);assert.equal(JSON.stringify(item),before);
});
test('missing deposit or income never becomes zero yield; explicit zero is preserved',()=>{
  for(const field of ['totalDeposit','monthlyIncome'])for(const value of [null,undefined,'',true]){
    const html=window.JSWideDetailV26.saleCalculationHtml({...item,saleDetails:{...detail,[field]:value}});
    assert.match(html,/매매가·임대보증금·월 임대수입 확인 필요/);assert.doesNotMatch(html,/<dd>0%/);
  }
  assert.match(window.JSWideDetailV26.saleCalculationHtml({...item,saleDetails:{...detail,monthlyIncome:0}}),/<dd>0%/);
});
test('land calculation uses ad area rather than the supplied cadastral area',()=>{
  const html=window.JSWideDetailV26.saleCalculationHtml({...item,saleCategory:'land',salePrice:30000,saleDetails:{landAreaM2:330.5785,cadastralAreaM2:661.157}});
  assert.match(html,/300만원\/평/);assert.doesNotMatch(html,/150만원\/평|단순 연 수익률|연면적 기준/);
  for(const value of [null,0,'',true])assert.match(window.JSWideDetailV26.saleCalculationHtml({...item,saleCategory:'land',saleDetails:{landAreaM2:value}}),/산정 불가/);
});
test('official comparison highlights actual differences and keeps missing values distinct',()=>{
  const html=window.JSSalePublicReviewV6.crosscheckHtml(item,[['면적','100평','200평',true],['용도','','상가',true]],'건축물대장');
  assert.equal((html.match(/class="different"/g)||[]).length,1);assert.match(html,/<td>미제공<\/td>/);
  assert.match(html,/광고 기재/);assert.match(html,/건축물대장/);
  const other=window.JSSalePublicReviewV6.crosscheckHtml({...item,referenceAddressChangedV8:true},[['면적','100평','200평',true]],'건축물대장');
  assert.match(other,/다른 조회용 지번/);assert.doesNotMatch(other,/<table/);
});
