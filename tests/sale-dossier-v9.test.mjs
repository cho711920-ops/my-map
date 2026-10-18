import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {askingHistoryEntry,getSaleAskingHistory} from '../cloudflare/src/sale-asking-history.js';
import {handleD1GetAction} from '../cloudflare/src/d1-api.js';
const source={id:'O-1',source:'네이버',source_listing_id:'AD-1',listing_id:'M-1'};
const ad={originalId:'O-1',source:'네이버',sourceId:'AD-1',tradeType:'sale',saleCategory:'land',address:'대전 서구 도마동 1-1',salePrice:30000,saleDetails:{landAreaM2:330.5785}};
const row=(before,after,action='sourceUpdated')=>({id:2,created_at:'2026-10-18T00:00:00Z',action,before_json:JSON.stringify(before),after_json:JSON.stringify(after)});
test('asking history requires one source and ad ID and labels concurrent scope changes',()=>{
  assert.equal(askingHistoryEntry(row(ad,{...ad,salePrice:28000}),source).kind,'price_changed');
  assert.equal(askingHistoryEntry(row(ad,{...ad,salePrice:28000,saleDetails:{landAreaM2:660}}),source).kind,'conditions_changed');
  assert.equal(askingHistoryEntry(row({},ad,'sourceMerged'),source).kind,'observed');
  for(const bad of [{...ad,sourceId:'OTHER'},{...ad,originalId:'OTHER'},{...ad,source:'당근'},{...ad,tradeType:'lease'},{...ad,salePrice:null}])assert.equal(askingHistoryEntry(row(ad,bad),source),null);
  assert.equal(askingHistoryEntry(row(ad,ad),source),null);assert.equal(askingHistoryEntry({...row(ad,ad),after_json:'invalid'},source),null);
});
function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE listings(id TEXT PRIMARY KEY,property_id TEXT,status TEXT,trade_type TEXT);
    CREATE TABLE listing_sources(id TEXT PRIMARY KEY,listing_id TEXT,source TEXT,source_listing_id TEXT,trade_type TEXT,active INTEGER);
    CREATE TABLE listing_source_availability(source_id TEXT,kind TEXT);
    CREATE TABLE listing_data_quality_holds(listing_id TEXT,state TEXT,blocks_publication INTEGER);
    CREATE TABLE listing_history(id INTEGER PRIMARY KEY,listing_id TEXT,source_id TEXT,action TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
    CREATE INDEX idx_listing_history_listing ON listing_history(listing_id,id DESC);
    INSERT INTO listings VALUES('M-1','PUBLIC-1','active','sale');INSERT INTO listing_sources VALUES('O-1','M-1','네이버','AD-1','sale',1);`);
  const env={DB:{prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args);},async all(){return {results:db.prepare(sql).all(...args)};}};}};}}};
  const insert=(id,before,after)=>db.prepare('INSERT INTO listing_history VALUES(?,?,?,?,?,?,?)').run(id,'M-1','O-1','sourceUpdated',JSON.stringify(before),JSON.stringify(after),'2026-10-18T00:00:00Z');
  return {db,env,insert};
}
test('history API pages bounded source records, returns no private snapshots and never writes',async()=>{
  const {db,env,insert}=fixture();for(let i=1;i<=61;i++)insert(i,{...ad,private:'secret'}, {...ad,salePrice:28000,phone:'private'});
  const before=db.prepare('SELECT total_changes() n').get().n;
  const first=await handleD1GetAction(env,{role:'viewer'},{action:'saleAskingHistory',propertyId:'PUBLIC-1',originalId:'O-1'});
  assert.equal(first.entries.length,50);assert.equal(first.hasMore,true);assert.equal(first.nextCursor,'12');
  const last=await getSaleAskingHistory(env,{propertyId:'PUBLIC-1',originalId:'O-1',beforeId:first.nextCursor});
  assert.equal(last.entries.length,11);assert.equal(last.hasMore,false);assert.doesNotMatch(JSON.stringify(first),/secret|private|phone|before_json/);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before);db.close();
});
test('history rejects unrelated originals, lease sources, blocked and deleted parents',async()=>{
  const {db,env}=fixture(),q={propertyId:'PUBLIC-1',originalId:'O-1'};
  await assert.rejects(getSaleAskingHistory(env,{...q,propertyId:'OTHER'}),e=>e.statusCode===404);
  await assert.rejects(getSaleAskingHistory(env,{...q,beforeId:'bad'}),e=>e.statusCode===400);
  db.exec("UPDATE listing_sources SET trade_type='lease'");await assert.rejects(getSaleAskingHistory(env,q),e=>e.statusCode===404);
  db.exec("UPDATE listing_sources SET trade_type='sale'; INSERT INTO listing_data_quality_holds VALUES('M-1','open',1)");await assert.rejects(getSaleAskingHistory(env,q),e=>e.statusCode===404);
  db.exec("DELETE FROM listing_data_quality_holds;UPDATE listings SET status='deleted'");await assert.rejects(getSaleAskingHistory(env,q),e=>e.statusCode===404);db.close();
});
const window={addEventListener(){},JSListingTradeV1:{getMode:()=> 'lease',isSale:i=>i.tradeType==='sale',normalizedSaleCategory:i=>i.saleCategory,saleSummary:i=>i.saleDetails||{}},JSSaleWorkbenchV1:{price:v=>String(v)}};
vm.runInNewContext(fs.readFileSync('js/sale-dossier-v9.js','utf8'),{window,document:{addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[],documentElement:{setAttribute(){}}}});
const v9=window.JSSaleDossierV9;
test('floor grouping retains distinct uses, unknown area and basement order without inventing occupancy',()=>{
  const building={managementKey:'B1',floors:[{managementKey:'B1',floorNo:1,floorType:'지상',mainUse:'소매점',area:30},{managementKey:'B1',floorNo:1,floorType:'지상',mainUse:'사무소',area:20},{managementKey:'B1',floorNo:2,mainUse:'주택',area:null},{managementKey:'B1',floorNo:1,floorType:'지하',mainUse:'창고',area:10},{managementKey:'OTHER',floorNo:9,area:999}]};
  const before=JSON.stringify(building),rows=v9.floorRows(building);assert.equal(rows.length,3);assert.equal(rows[0].area,null);assert.equal(rows[1].area,50);assert.match(rows[1].uses,/소매점.*사무소/);assert.equal(rows[2].label,'지하 1층');
  assert.equal(JSON.stringify(building),before);assert.match(v9.floorHtml(building),/임대료·공실·실제 점유 현황을 뜻하지 않습니다/);
  assert.equal(v9.floorRows({...building,managementKey:''}).length,0);
});
test('unit markup and original comparison escape provider text and keep zero income',()=>{
  assert.match(v9.areaHtml(330.5785),/100평/);assert.match(v9.areaHtml(330.5785),/330.58㎡/);assert.equal(v9.areaHtml(null),'미제공');
  const a={tradeType:'sale',saleCategory:'building',originalId:'O-1',source:'<script>',salePrice:50000,saleDetails:{monthlyIncome:0}};
  const html=v9.originalsHtml([a,{...a,originalId:'O-2',salePrice:60000}],a);assert.match(html,/0만원/);assert.match(html,/class="different"/);assert.doesNotMatch(html,/<script>/);
});
