import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const window={},document={getElementById:()=>null,querySelector:()=>null,documentElement:{setAttribute(){}}};
vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),{window,document});
const ui=window.JSListingTradeV1,ast=ts.createSourceFile('map.js',fs.readFileSync('js/map.js','utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['getSaleYieldClusterAppearanceV185','getPremiumClusterSizeClassV635','buildClusterOverlayContentV655']);
const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
let mode='building_sale';
const ctx={window:{JSListingTradeV1:{...ui,getMode:()=>mode}},isDone:i=>i.state==='계약완료',isAdministrativeClusterSelectedV1:()=>false};
vm.createContext(ctx);vm.runInContext(code,ctx);
const row=rate=>({tradeType:'sale',saleCategory:'building',salePrice:12000,saleDetails:{scope:'whole_building',totalDeposit:0,monthlyIncome:rate*10}});
const appearance=items=>ctx.getSaleYieldClusterAppearanceV185({items});

for(const [rate,band] of [[0,'low'],[2.99,'low'],[2.9999,'middle'],[3,'middle'],[4.99,'middle'],[5,'upper'],[6.99,'upper'],[7,'high'],[10,'high']])test('v185 same card rounding and yield boundary '+rate,()=>{
 mode='building_sale';const item=row(rate),saved=structuredClone(item),result=appearance([item]);
 assert.equal(result.band,band);assert.equal(result.known,1);assert.equal(result.total,1);assert.deepEqual(item,saved);
});
test('v185 uncalculated is distinct from an explicit zero and excludes net-only/advertised headline returns',()=>{
 const missing=row(0);missing.saleDetails={advertisedYield:15,monthlyNetIncome:300};
 assert.equal(appearance([missing]).band,'unknown');assert.equal(appearance([missing]).median,null);
 assert.equal(appearance([row(0)]).median,0);
 const invalid=row(10);invalid.saleDetails.totalDeposit=12000;assert.equal(appearance([invalid]).band,'unknown');
});
test('v185 aggregate uses a median of current calculable listings, preserving unknown coverage and excluding completed rows',()=>{
 const missing=row(0);delete missing.saleDetails.monthlyIncome;
 const done={...row(50),state:'계약완료'},held={...row(4),state:'보류'};
 const result=appearance([row(2),held,row(100),missing,done]);
 assert.equal(result.median,4);assert.equal(result.band,'middle');assert.equal(result.known,3);assert.equal(result.total,4);
 assert.match(result.title,/중앙값 4%.*산정 3\/4개/);
 assert.equal(appearance([row(2),row(8)]).median,5);assert.equal(appearance([done]),null);
});
test('v185 lease and land keep their original palette and yield handling never mutates status or selects an ad',()=>{
 for(const selected of ['lease','land_sale']){mode=selected;assert.equal(appearance([row(10)]),null);assert.doesNotMatch(ctx.buildClusterOverlayContentV655({key:'test',items:[row(10)]},' selected'),/sale-yield/);}
 mode='building_sale';assert.equal(appearance([{...row(10),saleCategory:'land'}]),null);
});
test('v191 address and grid retain yield colors while district and dong stay neutral with count/selection',()=>{
 mode='building_sale';const item=row(2);
 for(const patch of [{},{worldGrid:true}]){
  const cluster={key:'x',items:[item],...patch};
  assert.match(ctx.buildClusterOverlayContentV655(cluster,' selected'),/sale-yield-low-v185/);
  item.saleDetails.monthlyIncome=70;
  assert.match(ctx.buildClusterOverlayContentV655(cluster,' selected'),/sale-yield-high-v185/);
  assert.match(ctx.buildClusterOverlayContentV655(cluster,' selected'),/selected/);item.saleDetails.monthlyIncome=20;
 }
 for(const regionMode of ['district','dong']){const cluster={key:'x',items:[item],regionMode,regionLabel:'검수지역'};assert.equal(ctx.getSaleYieldClusterAppearanceV185(cluster),null);const html=ctx.buildClusterOverlayContentV655(cluster,' selected');assert.doesNotMatch(html,/sale-yield/);assert.match(html,/매물 <b>1<\/b>/);assert.match(html,/selected/);}
});
