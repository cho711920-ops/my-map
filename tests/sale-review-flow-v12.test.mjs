import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const window={addEventListener(){},JSSaleDossierV9:{areaHtml:n=>n+'㎡'}};
vm.runInNewContext(fs.readFileSync('js/sale-review-flow-v12.js','utf8'),{window});
const api=window.JSSaleReviewFlowV12;
test('saved personal assumptions compare separately from ads, keeping zeros and unavailable fields distinct',()=>{
  const saved={price:'30,000',deposit:0,income:undefined},latest={price:28000,deposit:null,income:0},before=JSON.stringify({saved,latest});
  const rows=api.comparison(saved,latest,false);
  assert.equal(rows[0].before,30000);assert.equal(rows[0].after,28000);assert.equal(rows[0].different,true);
  assert.equal(rows[1].before,0);assert.equal(rows[1].after,null);assert.equal(rows[2].after,0);
  assert.equal(JSON.stringify({saved,latest}),before);assert.equal(api.comparison(saved,latest,true).length,1);
  for(const missing of ['',null,undefined,true,'NaN',Infinity,-1])assert.equal(api.comparison({price:missing},{price:10},true)[0].before,null);
});
const building={managementKey:'A',floors:[{managementKey:'A',mainUse:'근린생활시설',area:100},{managementKey:'A',mainUse:'주택',area:50},{managementKey:'A',mainUse:'근린생활시설',area:50},{managementKey:'B',mainUse:'다른 동',area:999}]};
test('building use composition totals exact management keys and preserves literal public uses',()=>{
  const before=JSON.stringify(building),r=api.floorComposition(building,false);
  assert.equal(r.total,200);assert.equal(r.groups.length,2);assert.equal(r.groups[0].area,150);assert.equal(r.complete,true);
  const html=api.floorCompositionHtml(building,false);assert.match(html,/75%/);assert.match(html,/25%/);assert.doesNotMatch(html,/다른 동/);assert.equal(JSON.stringify(building),before);
  assert.equal(api.floorComposition({...building,managementKey:''}).groups.length,0);
});
test('partial floor data, missing area, overflow and zero totals never produce whole-building percentages',()=>{
  assert.equal(api.floorComposition(building,true).complete,false);
  const b={...building,floors:[...building.floors,{managementKey:'A',mainUse:'창고',area:null}]};
  assert.equal(api.floorComposition(b,false).complete,false);assert.doesNotMatch(api.floorCompositionHtml(b,false),/\d+%/);
  assert.equal(api.floorComposition({...building,floors:[{managementKey:'A',area:0}]}).complete,false);
  assert.equal(api.floorComposition({...building,floors:[{managementKey:'A',area:1e308},{managementKey:'A',area:1e308}]}).groups.length,0);
  const literal=api.floorComposition({...building,floors:[{managementKey:'A',mainUse:'<img src=x>',otherUse:'기타',area:1}]}).groups[0];assert.equal(literal.label,'<img src=x> · 기타');
  assert.match(api.floorCompositionHtml({...building,floors:[{managementKey:'A',mainUse:'<img>',area:1}]}),/&lt;img&gt;/);
});
test('parcel bars use entered areas, reject missing/duplicate/invalid rows as a complete composition, and escape text',()=>{
  const rows=[{address:'서구 도마동 1-1',areaM2:100},{address:'서구 도마동 1-2',areaM2:300}],before=JSON.stringify(rows);
  assert.match(api.parcelCompositionHtml(rows),/25%/);assert.match(api.parcelCompositionHtml(rows),/75%/);assert.equal(JSON.stringify(rows),before);
  for(const bad of [{address:'서구 도마동 1-3',areaM2:''},{address:'서구 도마동 1-1',areaM2:100},{address:'모르는 주소',areaM2:100}])assert.doesNotMatch(api.parcelCompositionHtml([...rows,bad]),/\d+%/);
  assert.match(api.parcelCompositionHtml([{address:'<img>',areaM2:1}]),/&lt;img&gt;/);
  assert.doesNotMatch(api.parcelCompositionHtml([{address:'도마동 1',areaM2:1e308},{address:'도마동 2',areaM2:1e308}]),/Infinity|NaN/);
  assert.match(api.parcelCompositionHtml([{address:'',areaM2:''}]),/지번과 면적을 입력/);
});
