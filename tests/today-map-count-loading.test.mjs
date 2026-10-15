import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const map=fs.readFileSync('js/map.js','utf8');
const start=map.indexOf('function updateMapListingCountV825(');
const source=map.slice(start,map.indexOf('\n}',start)+2);
function render(phase,items=[],days=1){
  const badge={dataset:{},setAttribute(key,value){this[key]=value;}},value={};
  const context={window:{newListingDays:days,JSTodayListingsV1:{state:()=>({phase})}},
    document:{getElementById:id=>id==='mapListingCountV825'?badge:id==='mapListingCountValueV825'?value:null},overlays:[]};
  vm.createContext(context);vm.runInContext(source,context);
  return {count:context.updateMapListingCountV825(items),badge,value};
}
test('Today loading and failed zero views do not claim an authoritative zero map count',()=>{
  const loading=render('loading');assert.equal(loading.value.textContent,'확인 중');
  assert.equal(loading.badge.dataset.pending,'true');assert.match(loading.badge['aria-label'],/확정하지/);
  assert.equal(render('error').value.textContent,'미확인');
});
test('confirmed empty, non-Today and verified partial counts retain accurate numeric counts',()=>{
  assert.equal(render('ready').value.textContent,'0개');
  assert.equal(render('loading',[],0).value.textContent,'0개');
  assert.equal(render('loading',[{},{}]).value.textContent,'2개');
});
