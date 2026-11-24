import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
import {hashSourceSnapshotProof} from '../cloudflare/src/source-snapshot-proof.js';
import {keywordMatchesV252,keywordIdsV289} from '../cloudflare/src/query-keyword-v252.js';
await buildQueryRuntimeV151();
const {runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {numericCatalogPacketV177,queryWireV151,querySpecV151,privateListingQueryV151,repairPreparedTextQueryV289,currentTextRowsV289}=await import('../cloudflare/src/query-worker-v151.js');
const {createListingQueryRuntimeV151:make}=await import('../cloudflare/generated/query-runtime-v151.js');
const rawProof=[['fixture',1,'stamp','active'],[]],proof=await hashSourceSnapshotProof(rawProof);
function database(items,proofs={}){
 const calls=[];return {calls,prepare(sql){assert.match(sql,/^WITH memo_hits AS MATERIALIZED/);assert.match(sql,/listing_data_quality_holds/);assert.match(sql,/json_each\(\?1\)/);
 return {bind(raw){const terms=JSON.parse(raw);calls.push({terms,sql});return {async all(){return {results:items.filter(i=>terms.some(t=>i.memo.toLowerCase().replace(/\s/g,'').includes(t))).map(i=>({property_id:i.propertyId,operating_memo:i.memo,source_snapshot_proof:proofs[i.propertyId]||rawProof}))};}};}};}};
}
function fixture(mode){
 const items=[0,1].map(n=>({propertyId:'IND-'+n,key:'검수 매물|서구 검수동 '+(n+1)+'|1층|상가점포',name:'검수 매물',memo:'식당 가능 · 창고 사무실 추천 · 전화010-1111-2222',address:'서구 검수동 '+(n+1),room:'1층',state:'active',type:'상가점포',
  tradeType:mode==='lease'?'lease':'sale',saleCategory:mode==='land_sale'?'land':'building',deposit:1000,rent:60,area:30,salePrice:60000,source:'네이버',sourceSnapshotKey:proof,sheetRow:n+2}));
 const groups=Object.fromEntries(items.map(item=>[item.propertyId,[0,1].map((n)=>({...item,originalId:item.propertyId+'-AD-'+n,source:'네이버',active:1,availabilityKind:'active',
   description:n?'창고, 사무실 추천':'식당 가능 · 전화010-1111-2222',memo:n?'창고, 사무실 추천':'식당 가능 · 전화010-1111-2222',rent:n?90:60,salePrice:n?90000:60000,
   photoCount:2,thumbnail:'https://photos.invalid/'+item.propertyId+'-'+n+'.jpg'}))]));
 const metadata={ok:true,format:'expanded-v2',groups,sourceSnapshotKeys:Object.fromEntries(items.map(i=>[i.propertyId,proof])),sourceSnapshotPropertyIds:Object.fromEntries(items.map(i=>[i.propertyId,i.propertyId])),sourceSearchIds:{}};
 return {items,metadata,stream:()=>new Response(JSON.stringify(metadata)).body};
}


for(const mode of ['lease','building_sale','land_sale'])test('v252 keyword prepared query equals complete original evaluation without full reconstruction '+mode,async()=>{
 const f=fixture(mode);f.items[0].name='노블레스';f.items[1].memo='대형 사무실\n노\u2003블 창고';
 f.metadata.groups['IND-0'][1].name='골드타워';f.metadata.groups['IND-1'][1].name='노블마크';
 const groups=new Map(),rows=await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream(),captureNumericV177:r=>{const list=groups.get(r.propertyId)||[];list.push(r);groups.set(r.propertyId,list);}},{mode,hideDone:true,individualQueryV152:true},1);
 const packet=numericCatalogPacketV177(rows,groups,'R252',mode),DB=database(f.items),reads=[];
 const env={DB,MEDIA:{async get(key){reads.push(key);if(key.endsWith('/listings.json'))return {body:new Response(JSON.stringify({revision:'R252'})).body};if(key==='api-cache/query-view-'+(mode==='building_sale'?'v184-':'v215-')+mode+'.json')return {body:new Response(JSON.stringify(packet)).body,customMetadata:{revision:'R252'}};throw Error('Full source reconstruction forbidden '+key);}}};
 for(const filters of [{keyword:'노블'},{keyword:'골드'},{keyword:'검수동1,노블'},{keyword:'대형 창고'},{keyword:'노블 골드,검수'},{keyword:'사무실',...(mode==='lease'?{maxRent:'80'}:{maxDeposit:'80000'})},{keyword:'절대없는검색어'},{keyword:"노블' OR 1=1 --"}]){
  const spec=querySpecV151({mode,filters}),response=await privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'R252',spec})}),env,{});
  assert.equal(response.headers.get('x-js-query-keyword-v252'),'1');const actual=await response.json();delete actual.numericCatalogDeferredV220;
  const expected=queryWireV151(await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream()},{...spec,individualQueryV152:true},1),'R252');
  assert.deepEqual(actual,expected,JSON.stringify(filters));assert.doesNotMatch(JSON.stringify(actual),/operating_memo|010-1111-2222|source_snapshot_proof/);
 }
 assert.ok(DB.calls.length);assert.equal(reads.some(k=>k.includes('unified')),false);
});

for(const mode of ['lease','building_sale','land_sale'])test('v289 first unseen keyword reads only current memo masks, never the full catalog '+mode,async()=>{
 const DB=database([{propertyId:'P',memo:'식당 가능 · 노\u2003블 창고 · 101호 010-1111-2222'}]),reads=[];
 const env={DB,MEDIA:{async get(key){reads.push(key);assert.equal(key,'api-cache/revision/listings.json');return {body:new Response(JSON.stringify({revision:'MASK-289'})).body};}}};
 for(const keyword of ['노블','101','식당 창고,없음']){
  const spec=querySpecV151({mode,filters:{keyword}}),response=await privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({resolveCurrentV160:true,keywordIdsOnlyV289:true,basisRevisionV289:'MASK-289',spec})}),env,{});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.keywordIdsV289,true);
  assert.deepEqual(result.rows,[['P',proof,keyword==='식당 창고,없음'?3:1]]);assert.doesNotMatch(JSON.stringify(result),/memo|010-1111-2222|식당 가능|노\u2003블/);
 }
 assert.equal(reads.length,6);
 await assert.rejects(keywordIdsV289({DB},querySpecV151({mode,filters:{keyword:'Übersicht'}})),/전체/);
});

for(const mode of ['lease','building_sale','land_sale'])test('v289 keyword proof drift evaluates only exact current originals including photos '+mode,async()=>{
 const f=fixture(mode),groups=new Map(),baseSpec={mode,hideDone:true,individualQueryV152:true};
 const rows=await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream(),captureNumericV177:r=>{const list=groups.get(r.propertyId)||[];list.push(r);groups.set(r.propertyId,list);}},baseSpec,1);
 const packet=numericCatalogPacketV177(rows,groups,'REPAIR-289',mode),nextRaw=[['fixture',2,'new','active'],[]],nextProof=await hashSourceSnapshotProof(nextRaw);
 const current=f.items[0];current.sourceSnapshotKey=nextProof;current.memo='노블 101호';f.metadata.sourceSnapshotKeys[current.propertyId]=nextProof;
 for(const ad of f.metadata.groups[current.propertyId]){ad.rent=40;ad.salePrice=40000;ad.thumbnail='https://photos.invalid/current-keyword.jpg';}
 const spec=querySpecV151({mode,filters:{keyword:'노블 101',...(mode==='lease'?{maxRent:'80'}:{maxDeposit:'80000'})}});
 const accept=await keywordMatchesV252({DB:database(f.items,{[current.propertyId]:nextRaw})},packet,spec,make([],null).keywordPredicateV252(spec)),calls=[];
 const response={ok:true,requestedIds:[current.propertyId],missingIds:[],items:[{title:current.name,address:current.address,room:current.room,listing_type:current.type,deposit:current.deposit,monthly_rent:current.rent,area_m2:current.area,status:current.state,operating_memo:current.memo,property_id:current.propertyId,source_snapshot_key:nextProof,main_source:current.source,trade_type:current.tradeType,sale_category:current.saleCategory,sale_price:current.salePrice}],unified:{...f.metadata,groups:{[current.propertyId]:f.metadata.groups[current.propertyId]},sourceSnapshotKeys:{[current.propertyId]:nextProof},sourceSnapshotPropertyIds:{[current.propertyId]:current.propertyId}}};
 const repaired=await repairPreparedTextQueryV289({}, {revision:packet.revision},spec,packet,accept,async ids=>{calls.push(ids);return structuredClone(response);});
 const expected=queryWireV151(await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream()},{...spec,individualQueryV152:true},1),packet.revision);
 assert.deepEqual(repaired,expected);assert.deepEqual(calls,[[current.propertyId]]);assert.equal(repaired.total,1);assert.equal(repaired.rows[0][repaired.fields.indexOf('thumbnailV8')],'https://photos.invalid/current-keyword.jpg');
 await assert.rejects(repairPreparedTextQueryV289({}, {revision:packet.revision},spec,packet,accept,async()=>({...response,items:[{...response.items[0],source_snapshot_key:proof}]})),/연결/);
 const direct=await currentTextRowsV289({},spec,[current.propertyId],async()=>structuredClone(response));assert.equal(direct[0].sourceSnapshotKey,nextProof);assert.equal(direct[0].thumbnailV8,'https://photos.invalid/current-keyword.jpg');
 await assert.rejects(currentTextRowsV289({},spec,[current.propertyId],async()=>({...response,requestedIds:['FOREIGN']})),/완전/);
 await assert.rejects(currentTextRowsV289({},spec,[current.propertyId,current.propertyId],async()=>response),/범위/);
 const missing=await repairPreparedTextQueryV289({}, {revision:packet.revision},spec,packet,accept,async()=>({...response,items:[],missingIds:[current.propertyId]}));assert.equal(missing.total,0);
});
test('v252 keyword memos isolate changed proof and reject duplicates, cased Unicode and special ad-number scope',async()=>{
 const packet={fields:['propertyId','sourceSnapshotKey'],rows:[['P',proof]],numericCatalogV177:{marketV215:'lease',complete:true,revision:'R252'},revision:'R252'};
 const spec=querySpecV151({mode:'lease',filters:{keyword:'노블'}}),matcher=make([],null).keywordPredicateV252(spec);
 const changed=[['fixture',2,'stamp','active'],[]],accept=await keywordMatchesV252({DB:database([{propertyId:'P',memo:'노블'}],{P:changed})},packet,spec,matcher);
 assert.deepEqual(accept.repairIdsV238,['P']);assert.equal(accept({propertyId:'P',name:'노블'}),false);
 await assert.rejects(keywordMatchesV252({DB:database([{propertyId:'P',memo:'노블'},{propertyId:'P',memo:'노블'}])},packet,spec,matcher),/연결/);
 const DB=database([]);assert.equal(await keywordMatchesV252({DB},packet,querySpecV151({mode:'lease',filters:{keyword:'Übersicht'}}),matcher),null);assert.equal(DB.calls.length,0);
 for(const keyword of ['270-29','괴정동270-29','네이버 1234567890','https://new.land.naver.com/articles/1234567890'])assert.equal(make([],null).keywordPredicateV252({filters:{keyword}}),null);
});
