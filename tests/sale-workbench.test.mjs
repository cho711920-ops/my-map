import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {gongsilSaleFields} from '../cloudflare/src/sale-fields.js';
import {saveSaleWorksheet} from '../cloudflare/src/sale-worksheet.js';
import {handleD1PostAction} from '../cloudflare/src/d1-api.js';
const elements = new Map();
const window={addEventListener(){},dispatchEvent(){}};
const context={window,document:{getElementById:id=>elements.get(id)||null,querySelector:()=>null,documentElement:{setAttribute(){}},addEventListener(){}},CustomEvent:class{}};
vm.runInNewContext(fs.readFileSync('js/listing-trade-ui-v1.js','utf8'),context);
vm.runInNewContext(fs.readFileSync('js/sale-workbench-v1.js','utf8'),context);
const ui=window.JSListingTradeV1,w=window.JSSaleWorkbenchV1;
const land={tradeType:'sale',saleCategory:'land',salePrice:10000,saleDetails:{scope:'land',landAreaM2:330.5785,landUse:'전',zoning:'제3종일반주거지역'}};
test('Gongsil real listing and bilinfo fields supplement empty cadastral results',()=>{
  const raw={list:{TypeView:'토지',Me:10000,Area:100,JiMok:'전',YongdoAddr:'3종일반주거지역'},detail:{bilinfo:{jimok:'전',yongdoaddr:'3종일반주거지역'},getlands:{LndCgrCodeNm:'',PrposArea1Nm:'',LndpclAr:0}}};
  const d=gongsilSaleFields(raw).saleDetails;
  assert.equal(d.landUse,'전');assert.equal(d.zoning,'3종일반주거지역');assert.equal(d.metadataVersion,2);
  assert.equal(d.fieldSources.landUse,'detail.bilinfo.jimok');assert.equal(d.landAreaM2,330.58);
  raw.detail={};assert.equal(gongsilSaleFields(raw).saleDetails.fieldSources.landUse,'list.JiMok');
  raw.detail={getlands:{LndCgrCodeNm:'대',PrposArea1Nm:'자연녹지지역',LndpclAr:4760}};
  const cad=gongsilSaleFields(raw).saleDetails;assert.equal(cad.landUse,'대');assert.equal(cad.cadastralAreaM2,4760);assert.equal(cad.landAreaM2,330.58);
  assert.equal(gongsilSaleFields({list:{TypeView:'토지'},detail:{bilinfo:{jimok:{},yongdoaddr:true}}}).saleDetails.landUse,'');
  assert.equal(gongsilSaleFields({list:{TypeView:'토지',RDateTime:'2026-08-27'}}).saleDetails.providerCheckedAt,'');
  assert.equal(gongsilSaleFields({list:{TypeView:'토지',Bfokdate:'2026-08-27'}}).saleDetails.providerCheckedAt,'2026-08-27');
});
test('sale price and land unit price are formatted without invented values',()=>{
  assert.equal(w.price(197000),'19억7,000만원');assert.equal(w.price(10000),'1억원');assert.equal(w.price(7800),'7,800만원');
  for(const n of [null,undefined,0,-1,true,''])assert.equal(w.price(n),'매매가 미확인');
  assert.ok(Math.abs(w.unitPrice(land)-100)<.001);assert.match(ui.saleYieldBadge(land),/평당 100만/);
  assert.equal(w.unitPrice({...land,saleDetails:{cadastralAreaM2:330}}),null);
});
test('sale filters include endpoints, unknown exclusion and market-specific fields',()=>{
  assert.equal(w.matches(land,{saleLandMin:100,saleLandMax:100}),true);
  assert.equal(w.matches(land,{saleLandMin:101}),false);
  assert.equal(w.matches(land,{saleLandUseFilter:'전',saleZoningFilter:'일반 주거'}),true);
  assert.equal(w.matches(land,{saleLandUseFilter:'대'}),false);
  for (const [abbreviation,full] of [['임','임야'],['과','과수원'],['종','종교용지'],['창','창고용지'],['도로','도']])
    assert.equal(w.matches({...land,saleDetails:{...land.saleDetails,landUse:abbreviation}},{saleLandUseFilter:full}),true);
  assert.equal(w.matches(land,{saleUnitPriceMin:101}),false);
  assert.equal(w.matches({...land,saleDetails:{}},{saleLandMax:100}),false);
  assert.equal(w.matches({...land,saleDetails:{}},{}),true);
  assert.equal(w.matches({...land,tradeType:'lease'},{saleLandMin:99999}),true);
  const building={...land,saleCategory:'building',saleDetails:{grossAreaM2:330.5785,totalDeposit:0,monthlyIncome:100}};
  assert.equal(w.matches(building,{saleYieldMin:12,saleGrossMax:100}),true);
  assert.equal(w.matches(building,{saleYieldMin:12.01}),false);
  assert.equal(w.matches(building,{saleCategoryFilter:'house'}),false);
  assert.equal(w.matches(building,{saleLandUseFilter:'대',saleUnitPriceMin:99999}),true);
});
test('mode switches reset hidden filters before applying and chips can be independently cleared',()=>{
  for(const id of [...w.filterIds,'minArea','maxArea','minFloor','maxFloor','brokerageFeeFilter'])elements.set(id,{value:'50'});
  let observed;
  window.applyFilter=()=>{observed=w.filterValues();};ui.setMode('land_sale');
  assert.ok(Object.values(observed).every(v=>v===''));assert.equal(elements.get('minArea').value,'');
  elements.get('saleLandMin').value='30';elements.get('saleZoningFilter').value='녹지';
  assert.equal(w.chips().length,2);w.clearChip('saleLand');assert.equal(w.chips().length,1);
  ui.setMode('lease');assert.equal(w.chips().length,0);
});
test('cash flow distinguishes unknown, gross rent, debt and negative returns',()=>{
  const v={price:10000,deposit:1000,income:100,loan:4000,interest:6,vacancy:10,expense:10,acquisition:500};
  const r=w.calculate(v);assert.equal(r.equity,5500);assert.equal(r.monthly,60);assert.equal(r.annual,720);assert.ok(Math.abs(r.yield-13.0909)<.001);
  assert.ok(w.calculate({...v,income:''}).error);assert.ok(w.calculate({...v,deposit:true}).error);
  assert.ok(w.calculate({...v,loan:10000}).error);assert.ok(w.calculate({...v,vacancy:101}).error);
  assert.equal(w.calculate({...v,income:0}).monthly,-30);
});
test('manual parcel worksheet validates exact addresses, area and duplicates; does not merge listings',()=>{
  const p=w.parseParcels('서구 도마동 49-38 | 167\n서구 도마동 49-39 | 100');
  const t=w.parcelTotals(p,41000);assert.equal(t.count,2);assert.equal(t.areaM2,267);
  for(const text of ['도마동 | 1','도마동 1 | 0','도마동 1 | -2','도마동 1 | 3\n도마동1 | 4'])assert.throws(()=>w.parseParcels(text));
});
test('detail and compare markup escape input, keep selected original identity and do not duplicate full images',()=>{
  const markup=w.detailTools({...land,address:'<img>',originalId:'O-1',photos:['secret-image']},'M-1');
  assert.doesNotMatch(markup,/<img>|secret-image/);assert.match(markup,/O-1/);assert.match(markup,/토지이음/);
  assert.doesNotMatch(w.comparisonHtml([{...land,address:'<script>'}]),/<script>/);
});
function db(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE cloud_state(owner_email TEXT,scope TEXT,record_key TEXT,value_json TEXT,version INTEGER,updated_at TEXT,PRIMARY KEY(owner_email,scope,record_key));');return {db,env:{DB:{prepare(sql){return {bind(...args){return {async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}};}}}};}
const data={assumptions:{price:10000,deposit:1000,income:100,loan:0,interest:0,vacancy:0,expense:0,acquisition:0},parcels:[],note:'검토'};
test('worksheet saves are account-isolated and stale writes cannot overwrite another PC',async()=>{
  const {db:sqlite,env}=db();
  assert.equal((await saveSaleWorksheet(env,'a@example.test','O-1',{expectedVersion:0,data})).version,1);
  await assert.rejects(saveSaleWorksheet(env,'a@example.test','O-1',{expectedVersion:0,data}),e=>e.statusCode===409);
  assert.equal((await saveSaleWorksheet(env,'b@example.test','O-1',{expectedVersion:0,data})).version,1);
  await saveSaleWorksheet(env,'a@example.test','O-1',{expectedVersion:1,data:{...data,note:'다음'}});
  assert.equal(sqlite.prepare('SELECT count(*) n FROM cloud_state').get().n,2);
  await assert.rejects(saveSaleWorksheet(env,'a@example.test','missing',{expectedVersion:1,data}),e=>e.statusCode===409);
  assert.equal(sqlite.prepare('SELECT version FROM cloud_state WHERE owner_email=?').get('a@example.test').version,2);sqlite.close();
});
test('worksheet server rejects unbounded or malformed state before writing',async()=>{
  const {db:sqlite,env}=db();
  for(const bad of [{...data,assumptions:{interest:200}},{...data,parcels:[{address:'동만',areaM2:1}]},{...data,parcels:Array(31).fill({address:'서구 도마동 1',areaM2:1})}])await assert.rejects(saveSaleWorksheet(env,'a','O-1',{expectedVersion:0,data:bad}),e=>e.statusCode===400);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM cloud_state').get().n,0);sqlite.close();
});
test('new scope is routed through existing authenticated D1 action',async()=>{
  const {db:sqlite,env}=db();
  sqlite.exec('CREATE TABLE mutation_results(request_id TEXT PRIMARY KEY,owner_email,action,state,result_json,created_at,expires_at);');
  const r=await handleD1PostAction(env,{email:'owner@example.test',role:'owner'},{action:'saveCloudState',scope:'saleWorksheetV1',recordKey:'O-2',expectedVersion:0,data});
  assert.equal(r.version,1);assert.equal(sqlite.prepare('SELECT scope FROM cloud_state').get().scope,'saleWorksheetV1');sqlite.close();
});
