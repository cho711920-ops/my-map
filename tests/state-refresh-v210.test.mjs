import test from 'node:test';
import assert from 'node:assert/strict';
import {speedDatabase} from './fixtures/collector-speed-v64.mjs';
import {createSessionToken,SESSION_COOKIE} from '../cloudflare/src/security.js';
import worker from '../cloudflare/src/worker.js';
import {handleD1GetAction} from '../cloudflare/src/d1-api.js';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
const {runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {privateListingQueryV151,numericCatalogPacketV177,queryPacketRowsV152}=await import('../cloudflare/src/query-worker-v151.js');

test('real state writes and the private building query refresh twelve exact masters without rebuilding published catalogs',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());const ids=Array.from({length:16},(_,i)=>'STATE-'+i),detail={scope:'whole_building',landAreaM2:200,grossAreaM2:400,totalDeposit:5000,monthlyIncome:250};
 for(const [i,id] of ids.entries()){
  f.db.prepare("INSERT INTO listings(id,property_id,title,address,room,listing_type,status,operating_memo,trade_type,sale_category,sale_price,sale_details_json,main_source) VALUES(?,?,?,?,?,'건물전체','active','직접 보존 메모','sale','building',70000,?,'네이버')").run(id,id,'검수건물'+i,'서구 검수동 '+(i+1),'전체',JSON.stringify(detail));
  for(let n=0;n<2;n++)f.db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,trade_type,sale_category,sale_price,list_snapshot_json,active) VALUES(?,?,'네이버',?,'sale','building',?,?,1)").run(id+'-ad'+n,id,id+'-ad'+n,70000+n*10000,JSON.stringify({tradeType:'sale',saleCategory:'building',salePrice:70000+n*10000,saleDetails:detail}));
 }
 const initial=await handleD1GetAction(f.env,{},{action:'listingOriginals',ids:ids.join(',')}),helper=make([],null),items=initial.items.map((r,i)=>helper.rawMaster(r,i)),groups=new Map();
 const rows=await runSnapshotQueryV151({items,metadata:initial.unified,sourcePacketV176:initial.unified,captureNumericV177:r=>{const a=groups.get(r.propertyId)||[];a.push(r);groups.set(r.propertyId,a);}},{mode:'building_sale',individualQueryV152:true});
 assert.equal(rows.length,16);const packet=numericCatalogPacketV177(rows,groups,'base'),objects=new Map(),reads=[],deletes=[];let seq=0;
 const viewKey='api-cache/query-view-v184-building_sale.json';f.env.MEDIA={async get(key){reads.push(key);const o=objects.get(key);return o?{...o,body:new Blob([o.value]).stream(),text:async()=>o.value}:null;},async put(key,value,options={}){const old=objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches||options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const o={value,...options,etag:String(++seq)};objects.set(key,o);return o;},async delete(keys){for(const k of Array.isArray(keys)?keys:[keys]){deletes.push(k);objects.delete(k);}}};
 await f.env.MEDIA.put(viewKey,JSON.stringify(packet),{customMetadata:{revision:'base'}});await f.env.MEDIA.put('api-cache/revision/listings.json',JSON.stringify({revision:'base',collectorRevisionV142:'epoch',history:[{revision:'base',changeIds:[],fullReload:false}]}));
 Object.assign(f.env,{SESSION_SECRET:'synthetic-state-refresh-secret-at-least32',ALLOWED_EMAILS:'test@example.invalid'});const token=await createSessionToken({email:'test@example.invalid',sub:'test',role:'owner'},f.env);
 for(const id of ids.slice(0,12)){const response=await worker.fetch(new Request('https://js-map.com/api/data',{method:'POST',headers:{Origin:'https://js-map.com',Cookie:SESSION_COOKIE+'='+token,'Content-Type':'application/json'},body:JSON.stringify({action:'updateProperty',key:{propertyId:id},originalValues:Array(12).fill(null).concat('active'),editedFields:['state'],updated:{state:'보류'}})}),f.env);assert.equal(response.status,200,await response.text());}
 reads.length=0;f.calls.length=0;const revision=JSON.parse(objects.get('api-cache/revision/listings.json').value).revision;
 const response=await privateListingQueryV151(new Request('https://private.invalid/',{method:'POST',body:JSON.stringify({revision,spec:{mode:'building_sale'}})}),f.env,{});
 const result=await response.json();assert.equal(response.status,200);assert.equal(result.numericCatalogV177.revision,revision);assert.equal(result.numericCatalogV177.groups.length,16);
 const current=queryPacketRowsV152(result);assert.equal(current.filter(r=>r.state==='보류').length,12);assert.equal(current.filter(r=>r.state==='active').length,4);
 assert.ok(reads.every(k=>k===viewKey||k==='api-cache/revision/listings.json'),JSON.stringify(reads));assert.ok(!deletes.some(k=>/d1-sheet|unified-listings/.test(k)));
 const pointQueries=f.calls.filter(c=>c.kind==='all'&&/FROM listings WHERE property_id IN/.test(c.sql));assert.equal(pointQueries.length,1);
 assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE property_id='STATE-0'").get().operating_memo,'직접 보존 메모');assert.equal(f.db.prepare("SELECT status FROM listings WHERE property_id='STATE-15'").get().status,'active');
});
