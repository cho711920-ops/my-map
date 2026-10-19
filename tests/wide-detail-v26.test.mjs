import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{}};vm.runInNewContext(fs.readFileSync('js/wide-detail-v26.js','utf8'),context);
test('lease detail distinguishes missing information and explicit zero without mutating the selected ad',()=>{
  const known=context.window.JSWideDetailV26.known,item={fee:0,premium:null,deposit:2000,rent:160,area:20,displayValuePresence:{rent:false}},before=JSON.stringify(item);
  assert.equal(known(item,'fee','만원'),'0만원');assert.equal(known(item,'premium','만원'),'미제공');assert.equal(known(item,'rent','만원'),'미제공');assert.equal(known(item,'deposit','만원'),'2,000만원');assert.equal(known(item,'area','평'),'20평');assert.equal(JSON.stringify(item),before);
});
test('wide detail respects list bounds and stacks rather than covering list actions',()=>{
  let width=1794;
  const style={},drawer={dataset:{},setAttribute(){},closest(){return null;},style:{setProperty(k,v){style[k]=v;},removeProperty(k){delete style[k];}}};
  const document={documentElement:{classList:{contains(){return false;}},get clientWidth(){return width;}},getElementById(){return {getBoundingClientRect(){return {left:width-600,width:600};}};},querySelector(){return {getBoundingClientRect(){return {bottom:60};}};}};
  const window={innerHeight:900};vm.runInNewContext(fs.readFileSync('js/wide-detail-v26.js','utf8'),{window,document});
  window.JSWideDetailV26.position(drawer);assert.equal(drawer.dataset.wideLayoutV26,'wide');assert.equal(style['--wide-detail-width-v26'],'1060px');
  width=1280;window.JSWideDetailV26.position(drawer);assert.equal(drawer.dataset.wideLayoutV26,'stack');assert.equal(style['--wide-detail-width-v26'],'656px');assert.equal(drawer.style.right,'612px');
});
