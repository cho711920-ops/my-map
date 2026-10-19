import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../js/sale-property-edit-v1.js',import.meta.url),'utf8'),context);
const preview=context.window.JSSalePropertyEditV1.moneyPreview;
test('sale edit money preview converts 만원 without changing numeric persistence',()=>{
  for(const [value,label] of [[80000,'8억원'],['8e4','8억원'],[99500,'9억 9,500만원'],[8550,'8,550만원'],[0,'0원'],[0.5,'5,000원'],[1.25,'1만 2,500원'],[100000000,'1조원'],[0.000001,'1원 미만']])assert.equal(preview(value),label);
});
test('sale edit money preview distinguishes missing and invalid amounts from explicit zero',()=>{
  for(const value of ['',null,undefined,' '])assert.equal(preview(value),'금액 미입력');
  for(const value of [-1,NaN,Infinity,'금액',1e20])assert.equal(preview(value),'입력 금액을 확인해 주세요');
});
