import test from 'node:test';
import assert from 'node:assert/strict';
import {speedDatabase} from './fixtures/collector-speed-v64.mjs';
import {heldListingSearchV299,heldListingProjectionV299} from '../cloudflare/src/held-listing-search-v299.js';
import {handleD1GetAction,isD1GetAction} from '../cloudflare/src/d1-api.js';
let sequence=0;
function seed(f,source='당근',overrides={}){
 const n=++sequence,trade=overrides.trade||'lease',category=overrides.category||'',id=overrides.number||'5081592';
 const record={source,sourceId:(source==='네이버'?'네이버-':'')+id+'::'+trade,tradeType:trade,saleCategory:category,buildingName:'일반상가',address:'',roadAddress:'',room:'2층',deposit:1500,rent:120,salePrice:trade==='sale'?50000:null,area:30,fee:0,premium:0,
  images:['https://images.example.invalid/first.jpg','https://images.example.invalid/second.jpg'],contacts:[{phone:'010-1234-5678'}],
  link:'https://www.gongsilbox.com/maps/sg',latitude:36.31,longitude:127.41,
  raw:{isHideAddress:true,publicAddress:'대전광역시 서구 괴정동',address:'숨김주소 999-99',status:'ON_GOING',publicCoordinate:{lat:'36.3426566',lon:'127.3912626'}},...overrides.record};
 f.db.prepare('INSERT INTO collector_sessions(id,source) VALUES (?,?)').run('held-session-'+n,source);
 const row={id:'held-'+n,source,source_listing_id:(source==='네이버'?'네이버-':'')+id+'::'+trade,payload_json:JSON.stringify(record),
  processing_state:overrides.state||'error',error_text:overrides.error||'건물번호가 있는 지번·도로명주소 없음',trade_type:trade,sale_category:category,
  created_at:overrides.created||'2026-11-24T08:26:04.962Z',processed_at:overrides.processed||overrides.created||'2026-11-24T08:26:04.962Z'};
 f.db.prepare(`INSERT INTO collector_raw(id,session_id,source,source_listing_id,payload_json,processing_state,error_text,trade_type,sale_category,created_at,processed_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,'held-session-'+n,source,row.source_listing_id,row.payload_json,row.processing_state,row.error_text,trade,category,row.created_at,row.processed_at);
 return row;
}
for(const [provider,source] of Object.entries({daangn:'당근',naver:'네이버',gongsil:'공실박스'}))test('v299 number lookup includes address-held '+provider+' without creating a master or exposing private payloads',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());seed(f,source);f.reset();
 const result=await heldListingSearchV299(f.env,{number:'5081592',provider,mode:'lease'});
 assert.equal(result.items.length,1);const ad=result.items[0];assert.equal(ad.sourceNumber,'5081592');assert.equal(ad.source,source);assert.equal(ad.rent,120);assert.equal(ad.photoCount,2);
 assert.equal(ad.location,null);
 const wire=JSON.stringify(result);for(const secret of ['010-1234-5678','숨김주소','payload_json','session_id','latitude','longitude','publicCoordinate'])assert.equal(wire.includes(secret),false,secret);
 assert.equal(f.calls.length,1);assert.ok(f.calls.every(call=>call.kind==='all'));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM listings').get().n,0);
});
test('v299 current offer market is enforced for lease, commercial sale and land sale',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());seed(f);seed(f,'당근',{trade:'sale',category:'commercial'});seed(f,'공실박스',{number:'5081593',trade:'sale',category:'land'});
 assert.equal((await heldListingSearchV299(f.env,{number:'5081592',mode:'lease'})).items[0].tradeType,'lease');
 assert.equal((await heldListingSearchV299(f.env,{number:'5081592',mode:'building_sale'})).items[0].saleCategory,'commercial');
 assert.deepEqual((await heldListingSearchV299(f.env,{number:'5081592',mode:'land_sale'})).items,[]);
 assert.equal((await heldListingSearchV299(f.env,{number:'5081593',mode:'land_sale'})).items.length,1);
 assert.deepEqual((await heldListingSearchV299(f.env,{number:'5081593',mode:'lease'})).items,[]);
});
for(const active of [0,1])test('v299 existing or archived source prevents a duplicate or deleted-ad resurrection active='+active,async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());seed(f);
 f.db.prepare('INSERT INTO listing_sources(id,source,source_listing_id,active) VALUES (?,?,?,?)').run('already-attached','당근','5081592',active);
 assert.deepEqual((await heldListingSearchV299(f.env,{number:'5081592'})).items,[]);
});
test('v299 newest non-address result suppresses an older rejected snapshot',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());seed(f);seed(f,'당근',{created:'2026-11-25T01:00:00Z',state:'processed',error:'새 결과'});
 assert.deepEqual((await heldListingSearchV299(f.env,{number:'5081592'})).items,[]);
});
test('v299 repeated error uses its latest processed timestamp rather than stale insertion time',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());seed(f,'당근',{created:'2026-11-22T01:00:00Z',processed:'2026-11-25T02:00:00Z'});seed(f,'당근',{created:'2026-11-24T01:00:00Z',state:'processed',error:'예전 결과'});
 assert.equal((await heldListingSearchV299(f.env,{number:'5081592'})).items[0].checkedAt,'2026-11-25T02:00:00Z');
});
for(const point of [null,{lat:36.3426566,lon:127.3912626},{lat:0,lon:0},{lat:'NaN',lon:127.3},{lat:91,lon:127.3}])test('v299 all public positions are withheld while number search remains available '+JSON.stringify(point),async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());const row=seed(f,'당근',{record:{raw:{isHideAddress:true,status:'ON_GOING',publicCoordinate:point,latitude:36.9,longitude:127.9}}});
 const ad=heldListingProjectionV299(row,'lease');assert.ok(ad);assert.equal(ad.location,null);assert.equal(ad.publicArea,'');
});
test('v299 hidden/ended advertisements and unrelated failures are not published as pending active ads',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());
 for(const raw of [{isHide:true},{status:'COMPLETED'}]){const row=seed(f,'당근',{record:{raw}});assert.equal(heldListingProjectionV299(row,'lease'),null);}
 const row=seed(f,'당근',{error:'연락처 오류'});assert.equal(heldListingProjectionV299(row,'lease'),null);
});
test('v299 invalid search input is rejected before touching D1 and malformed payloads fail closed',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());
 for(const query of [{number:'x'},{number:'1 OR 1=1'},{number:'5081592',provider:'__proto__'},{number:'5081592',mode:'all'}])await assert.rejects(heldListingSearchV299(f.env,query),error=>error.statusCode===400);
 assert.equal(f.calls.length,0);const row=seed(f);
 for(const payload of ['bad json','null','[]','42'])assert.equal(heldListingProjectionV299({...row,payload_json:payload},'lease'),null);
});
test('v299 conflicting queue, payload and qualified offer identities never cross a market',t=>{
 const f=speedDatabase();t.after(()=>f.db.close());const row=seed(f);
 for(const change of [{trade_type:'sale'},{source_listing_id:'5081592::sale'},{payload_json:JSON.stringify({...JSON.parse(row.payload_json),sourceId:'5081592::sale'})}])assert.equal(heldListingProjectionV299({...row,...change},'lease'),null);
});
test('v299 lookup is dispatched through the existing authenticated D1 read action only',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());seed(f);assert.equal(isD1GetAction('heldListingSearchV299'),true);
 const result=await handleD1GetAction(f.env,{email:'fixture@example.invalid',role:'viewer'},{action:'heldListingSearchV299',number:'5081592',mode:'lease'});
 assert.equal(result.items.length,1);assert.ok(f.calls.every(call=>call.kind==='all'));
});
