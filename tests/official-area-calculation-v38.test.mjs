import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={addEventListener(){}};
const context={window,document:{getElementById(){},querySelector(){},querySelectorAll(){return [];},documentElement:{setAttribute(){},removeAttribute(){}}},CustomEvent:class{}};
for(const name of ['listing-trade-ui-v1','parcel-external-links-v1','wide-detail-v26'])vm.runInNewContext(fs.readFileSync('js/'+name+'.js','utf8'),context);
const ui=window.JSWideDetailV26;
const item={tradeType:'sale',saleCategory:'building',salePrice:50000,address:'서구 괴정동 3-3',saleDetails:{saleExtent:'whole_building',monthlyIncome:200,totalDeposit:5000}};
const data={lotAddress:'대전광역시 서구 괴정동 3-3',registerType:'일반 · 일반건축물대장',siteArea:330.5785,totalArea:661.157,calculationBuildingCountV38:1,source:'국토교통부 건축물대장',fetchedAt:'2026-10-20T04:00:00Z'};
const references=(override={},view=item)=>({building:{item:view,kind:'building',data:{...data,...override}}});

test('matching whole-building official areas fill missing ad denominators without original writes',()=>{
  const refs=references(),before=JSON.stringify({item,refs});
  const html=ui.saleCalculationHtml(item,refs);
  assert.match(html,/대지 기준 단가 · 대장 면적 기준/);assert.match(html,/500만원\/평/);assert.match(html,/250만원\/평/);
  assert.match(html,/대장 면적 대지면적 100평/);assert.match(html,/조회/);assert.match(html,/국토교통부 건축물대장/);
  assert.equal(JSON.stringify({item,refs}),before);
});
test('both price denominators are shown separately, never replacing the ad area or income',()=>{
  const withAd={...item,saleDetails:{...item.saleDetails,landAreaM2:661.157,grossAreaM2:1322.314}};
  const before=JSON.stringify(withAd),html=ui.saleCalculationHtml(withAd,references());
  assert.match(html,/<dd>250만원\/평/);assert.match(html,/<strong>500만원\/평/);
  assert.match(html,/광고 연면적 400평/);assert.match(html,/대장 면적 연면적 200평/);assert.match(html,/5\.33%/);
  assert.equal(JSON.stringify(withAd),before);
});
test('wrong parcel, changed query address and incomplete result never supply a denominator',()=>{
  for(const refs of [references({lotAddress:'대전 서구 괴정동 3-4'}),references({}, {...item,referenceAddressChangedV8:true}),references({calculationIncompleteV38:true}),references({lotAddress:''})]){
    assert.match(ui.saleCalculationHtml(item,refs),/산정 불가/);assert.doesNotMatch(ui.saleCalculationHtml(item,refs),/500만원\/평/);
  }
});
test('units, collective registers and share or bundled land never use a whole property denominator',()=>{
  const unit={...item,saleDetails:{...item.saleDetails,saleExtent:'unit'}};
  assert.match(ui.officialAreaReview(unit,references()).reason,/전유면적/);
  assert.match(ui.officialAreaReview({...unit,room:'101호',saleDetails:{saleExtent:'unknown'}},references()).reason,/전유면적/);
  for(const registerType of ['집합 · 표제부','총괄표제부'])assert.match(ui.officialAreaReview(item,references({registerType})).reason,/전체 대장 면적/);
  for(const memo of ['지분매매','일부 매각','외 2필지','복수 필지 일괄매매'])assert.match(ui.officialAreaReview({...item,memo},references()).reason,/실제 매매 면적/);
});
test('unknown extent requires an explicit scoped confirmation; a different result invalidates it',()=>{
  const unknown={...item,saleDetails:{...item.saleDetails,saleExtent:'unknown'}},refs=references();
  const check=ui.officialAreaReview(unknown,refs);assert.equal(check.landAreaM2,undefined);assert.equal(check.needsConfirmation,true);
  assert.equal(ui.officialAreaReview(unknown,refs,check.token).landAreaM2,data.siteArea);
  assert.equal(ui.officialAreaReview(unknown,references({siteArea:500}),check.token).landAreaM2,undefined);
});
test('a selected building among multiple buildings can only use its own gross area after confirmation',()=>{
  const refs=references({calculationBuildingCountV38:2}),check=ui.officialAreaReview(item,refs);
  assert.equal(check.needsConfirmation,true);const confirmed=ui.officialAreaReview(item,refs,check.token);
  assert.equal(confirmed.landAreaM2,null);assert.equal(confirmed.grossAreaM2,data.totalArea);
});
test('land uses the matched parcel area and ignores another type of reference; invalid numbers stay unknown',()=>{
  const land={...item,saleCategory:'land'},refs={land:{item:land,kind:'land',data:{pnu:'3017010800100030003',address:'대전 서구 괴정동 3-3',areaM2:330.5785}}};
  assert.match(ui.saleCalculationHtml(land,refs),/500만원\/평/);assert.match(ui.saleCalculationHtml(land,refs),/공부면적 기준/);
  assert.doesNotMatch(ui.saleCalculationHtml(land,references()),/500만원\/평/);
  for(const v of [null,0,'',true,-1,'invalid']){
    refs.land.data.areaM2=v;assert.doesNotMatch(ui.saleCalculationHtml(land,refs),/Infinity|NaN|<dd>0만원/);
    assert.match(ui.saleCalculationHtml(land,refs),/산정 불가/);
  }
});
