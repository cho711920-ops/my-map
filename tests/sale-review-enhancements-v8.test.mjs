import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={JSAuthenticatedAccountEmail:'fixture@example.invalid',addEventListener(){}};
const context={window,document:{getElementById:()=>null,querySelector:()=>null,addEventListener(){},documentElement:{classList:{contains:()=>false},hasAttribute:()=>false,removeAttribute(){},setAttribute(){}}}};
for(const name of ['listing-trade-ui-v1','sale-workbench-v1','sale-review-enhancements-v8'])vm.runInNewContext(fs.readFileSync('js/'+name+'.js','utf8'),context);
const e=window.JSSaleReviewEnhancementsV8;
const land={tradeType:'sale',saleCategory:'land',salePrice:30000,address:'대전 유성구 장대동 4-4',saleDetails:{landAreaM2:330.5785,landUse:'대',roadAccess:'광고: 8m 도로'}};
test('three financial scenarios change only one assumption and do not mutate inputs',()=>{
  const values={price:50000,deposit:5000,income:250,loan:12000,interest:4,vacancy:5,expense:10,acquisition:1000},before=JSON.stringify(values);
  const r=e.scenarios(values,1,10);
  assert.deepEqual(Array.from(r.rows,x=>x.result.monthly),[187.5,177.5,162.5]);
  assert.equal(r.rows[1].values.vacancy,5);assert.equal(r.rows[2].values.interest,4);
  assert.equal(JSON.stringify(values),before);
  assert.match(e.scenarios({...values,income:''},1,10).error,/입력/);
  assert.match(e.scenarios(values,97,10).error,/100%/);
  assert.match(e.scenarios(values,1,-1).error,/0 이상/);
  assert.equal(e.scenarios({...values,income:0},0,0).rows[0].result.monthly,-50);
});
test('differences require paired values, respect a square-metre tolerance and skip another address',()=>{
  const before=JSON.stringify(land);
  assert.equal(e.differences(land,'land',{areaM2:331,landUse:'대'}).length,0);
  assert.equal(e.differences(land,'land',{areaM2:1200,landUse:'전'}).length,2);
  assert.equal(e.differences({...land,referenceAddressChangedV8:true},'land',{areaM2:1200,landUse:'전'}).length,0);
  assert.equal(e.differences(land,'land',{areaM2:null,landUse:''}).length,0);
  assert.equal(e.differences({saleDetails:{approvalDate:'20020304',buildingUse:'제2종 근린생활시설'}},'building',{approvalDate:'2002.03.04',mainUse:'제2종근린생활시설'}).length,0);
  assert.equal(JSON.stringify(land),before);
});
test('road evidence separates advertised access and planning designations without inferring access',()=>{
  const html=e.roadHtml(land,{regulations:[{items:[{label:'중로1류(폭20m~25m)(저촉)'},{label:'교육환경보호구역'}]}]});
  assert.match(html,/광고: 8m 도로/);assert.match(html,/공적자료의 도로 표기/);assert.match(html,/중로1류/);assert.doesNotMatch(html,/교육환경보호구역/);
  assert.match(html,/보증하지 않습니다/);assert.match(e.roadHtml(land,null),/조회 전/);
});
test('compact metrics escape originals, keep known zero income and use advertised land area',()=>{
  assert.match(e.compactHtml({...land,saleDetails:{...land.saleDetails,zoning:'<img src=x>'}}),/&lt;img/);
  assert.match(e.compactHtml({...land,saleCategory:'building',saleDetails:{monthlyIncome:0}}),/0만원/);
  assert.match(e.compactHtml(land),/300만원\/평/);
  assert.equal(e.compactHtml({tradeType:'lease'}),'');
});
test('single report preserves provenance and official units and excludes private data by default',()=>{
  const html=e.reportHtml({...land,buildingName:'<script>name</script>',memo:'PRIVATE LIST NOTE',phone:'010-PRIVATE'},
    {item:land,kind:'land',data:{address:land.address,areaM2:1243,landUse:'대',complete:false,price:{available:true,wonPerM2:986600,baseYear:2026,baseMonth:1},regulations:[],source:'토지이음',fetchedAt:'2026-10-18T00:00:00Z'}},'');
  assert.doesNotMatch(html,/<script>|PRIVATE/);assert.match(html,/&lt;script&gt;/);assert.match(html,/986,600원\/㎡/);assert.match(html,/2026.01/);assert.match(html,/일부 자료 미확인/);assert.match(html,/data-report-note-section hidden/);
});
