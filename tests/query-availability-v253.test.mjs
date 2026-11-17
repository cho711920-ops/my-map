import test from 'node:test';import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
import {hashSourceSnapshotProof} from '../cloudflare/src/source-snapshot-proof.js';
import {availabilityQueryV253,availabilityKeyV253} from '../cloudflare/src/query-availability-v253.js';
await buildQueryRuntimeV151();
const {runSnapshotQueryV151}=await import('../cloudflare/src/query-engine-v151.js');
const {querySpecV151,queryWireV151,numericCatalogPacketV177,filterPreparedQueryV220,privateListingQueryV151}=await import('../cloudflare/src/query-worker-v151.js');
const proof=await hashSourceSnapshotProof([['fixture',1,'stamp','active'],[]]);
function fixture(mode){
 const items=[0,1,2,3].map(n=>({propertyId:'IND-'+n,key:'검수 매물|서구 검수동 '+(n+1)+'|1층|상가점포',name:'검수 매물',memo:'식당 가능 · 창고 사무실 추천 · 전화010-1111-2222',address:'서구 검수동 '+(n+1),room:'1층',state:'active',type:'상가점포',
  tradeType:mode==='lease'?'lease':'sale',saleCategory:mode==='land_sale'?'land':'building',deposit:1000,rent:60,area:30,salePrice:60000,source:'네이버',sourceSnapshotKey:proof,sheetRow:n+2}));
 const groups=Object.fromEntries(items.map(item=>[item.propertyId,[0,1].map((n)=>({...item,originalId:item.propertyId+'-AD-'+n,source:'네이버',active:1,availabilityKind:'active',
   description:n?'창고, 사무실 추천':'식당 가능 · 전화010-1111-2222',memo:n?'창고, 사무실 추천':'식당 가능 · 전화010-1111-2222',rent:n?90:60,salePrice:n?90000:60000,
   photoCount:2,thumbnail:'https://photos.invalid/'+item.propertyId+'-'+n+'.jpg'}))]));
 const metadata={ok:true,format:'expanded-v2',groups,sourceSnapshotKeys:Object.fromEntries(items.map(i=>[i.propertyId,proof])),sourceSnapshotPropertyIds:Object.fromEntries(items.map(i=>[i.propertyId,i.propertyId])),sourceSearchIds:{}};
 return {items,metadata,stream:()=>new Response(JSON.stringify(metadata)).body};
}
for(const mode of ['lease','building_sale','land_sale'])for(const doneOnly of [false,true])test('v253 prepared availability equals full per-original evaluation '+mode+' completed='+doneOnly,async()=>{
 const f=fixture(mode),kind='census_missing';
 f.items[1].state='계약완료';f.items[3].state='계약완료';f.metadata.groups['IND-3']=[];
 for(const [id,ads] of Object.entries(f.metadata.groups))for(let n=0;n<ads.length;n++)if(n||id==='IND-2')Object.assign(ads[n],{active:0,sourceUnavailable:true,candidateEligible:true,availabilityKind:kind,absenceConfirmedAt:'2026-11-'+(n?'17':'16')+'T02:00:00.000Z'});
 f.metadata.groups['IND-0'].push({...f.metadata.groups['IND-0'][1],originalId:'UNVERIFIED',candidateEligible:false,availabilityKind:'legacy_unverified'});
 const base=querySpecV151({mode,hideDone:false,doneOnly}),groups=new Map();
 const rows=await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream(),captureNumericV177:r=>{const a=groups.get(r.propertyId)||[];a.push(r);groups.set(r.propertyId,a);}},base,2);
 const packet=numericCatalogPacketV177(rows,groups,'R253',mode);packet.numericCatalogV177.availabilityViewV253=doneOnly?'completed':'all';
 const contents=new Map([[availabilityKeyV253(mode,doneOnly?'completed':'all'),JSON.stringify(packet)]]),reads=[];
 const env={DB:{prepare(){return {bind(){return {async all(){return {results:f.items.map(i=>({property_id:i.propertyId,operating_memo:i.memo,source_snapshot_proof:[['fixture',1,'stamp','active'],[]]}))};}};}};}},MEDIA:{async get(key){reads.push(key);if(key.endsWith('/listings.json'))return {body:new Response(JSON.stringify({revision:'R253'})).body};if(contents.has(key))return {body:new Response(contents.get(key)).body};throw Error('Unexpected full source read '+key);}}};
 for(const filters of [{},{sortFilter:'floorHigh'},{keyword:'검수동1'},{keyword:'창고'},{industryFilter:'창고'},{sortFilter:'addressDesc'},mode==='lease'?{maxRent:'80'}:{maxDeposit:'80000'},{minArea:'25',floorQuickFilter:'1'},{maxArea:'1'}]){
  const spec=querySpecV151({...base,filters}),response=await privateListingQueryV151(new Request('https://private.invalid/',{method:'POST',body:JSON.stringify({revision:'R253',spec})}),env,{});
  assert.equal(response.headers.get('x-js-query-availability-v253'),'1');const actual=await response.json();
  const expected=queryWireV151(await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream()},spec,2),'R253');
  assert.deepEqual(actual,expected,JSON.stringify(filters));assert.doesNotMatch(JSON.stringify(actual),/operating_memo|010-1111-2222/);
 }
 assert.ok(reads.every(k=>k.endsWith('/listings.json')||k.includes('query-availability-v253')));
 assert.equal(filterPreparedQueryV220({...packet,numericCatalogV177:{...packet.numericCatalogV177,availabilityViewV253:'active'}},base),null);
});
test('v253 cache builds once, patches by revision, rejects incomplete/wrong-view or changed-revision results',async()=>{
 let revision='A',builds=0,patches=0;const store=new Map(),spec={mode:'lease',hideDone:false,doneOnly:true,filters:{}},create=r=>({ok:true,revision:r,numericCatalogV177:{availabilityViewV253:'completed',marketV215:'lease'}});
 const args={env:{MEDIA:{async get(k){return store.has(k)?{body:new Response(store.get(k)).body}:null;},async put(k,v){store.set(k,v);}}},state:{revision:'A'},spec,scope:()=>true,validate:()=>true,patch:async()=>{patches++;return create(revision);},build:async()=>{builds++;return create(revision);},filter:p=>({ok:true,revision:p.revision}),revision:async()=>revision};
 await availabilityQueryV253(args);await availabilityQueryV253(args);assert.equal(builds,1);
 revision='B';args.state.revision='B';await availabilityQueryV253(args);assert.equal(patches,1);assert.equal(builds,1);
 const key=availabilityKeyV253('lease','completed');store.set(key,JSON.stringify({...create('B'),numericCatalogV177:{availabilityViewV253:'active',marketV215:'lease'}}));await assert.rejects(availabilityQueryV253(args),/기준/);
 store.clear();args.build=async()=>{const p=create('B');revision='C';return p;};await assert.rejects(availabilityQueryV253(args),/기준/);assert.equal(store.size,0);
});

test('v253 complete compressed response reuses equivalent empty filters without rereading the large catalog',async()=>{
 const store=new Map(),reads=[];let builds=0;
 const spec={mode:'lease',hideDone:false,doneOnly:true,filters:{}},packet={ok:true,revision:'R',numericCatalogV177:{availabilityViewV253:'completed',marketV215:'lease'}},expected={ok:true,revision:'R',rows:[['EXACT-ID','own-photo']]};
 const args={env:{MEDIA:{async get(key){reads.push(key);const v=store.get(key);return v?{body:new Response(v.data).body,customMetadata:v.customMetadata}:null;},async put(key,data,options){store.set(key,{data,customMetadata:options.customMetadata});}}},state:{revision:'R'},spec,scope:()=>true,validate:()=>true,patch:()=>{throw Error('Unexpected patch');},build:async()=>{builds++;return structuredClone(packet);},filter:()=>expected,revision:async()=> 'R',compress:true,headers:{'content-type':'application/json'}};
 const first=await availabilityQueryV253(args);assert.equal(first.headers.get('content-encoding'),'gzip');assert.deepEqual(await new Response(first.body.pipeThrough(new DecompressionStream('gzip'))).json(),expected);
 const before=reads.length;args.spec={...spec,filters:{keyword:'',industryFilter:'',sortFilter:'latest'}};const second=await availabilityQueryV253(args);assert.deepEqual(await new Response(second.body.pipeThrough(new DecompressionStream('gzip'))).json(),expected);assert.equal(builds,1);assert.equal(reads.length-before,0);assert.ok([...store.keys()].some(k=>/result-latest\.gz$/.test(k))); 
});

for(const companion of ['media','delta'])test('v253 '+companion+' companion consumes the verified compressed view without rebuilding the large catalog',async()=>{
 const f=fixture('lease');f.items[1].state='계약완료';
 const spec=querySpecV151({mode:'lease',hideDone:false,doneOnly:true,filters:{}}),state={revision:'R253',history:[{revision:'R252'},{revision:'R253',changeIds:['IND-1']}]};
 const packet=queryWireV151(await runSnapshotQueryV151({items:structuredClone(f.items),metadata:f.metadata,stream:f.stream()},spec,2),state.revision);
 const entries=new Map(),reads=[],env={DB:{prepare(){throw Error('Companion must not rebuild from D1');}},MEDIA:{async get(key){reads.push(key);if(key.endsWith('/listings.json'))return {body:new Response(JSON.stringify(state)).body};const v=entries.get(key);if(v)return {body:new Response(v.bytes).body,customMetadata:v.metadata};if(key.includes('query-card-media-v159'))return null;throw Error('Companion must not read full source/catalog '+key);},async put(key,bytes,options){entries.set(key,{bytes,metadata:options.customMetadata});}}};
 // Store the same authenticated result key through the real compressor, but do
 // not leave a numeric catalog available for the companion to fall back to.
 const seed={...packet,numericCatalogV177:{availabilityViewV253:'completed',marketV215:'lease'}};
 await availabilityQueryV253({env:{MEDIA:{async get(){return null;},async put(key,bytes,options){if(key.includes('.result-'))entries.set(key,{bytes,metadata:options.customMetadata});}}},state,spec,scope:()=>true,validate:()=>true,patch:()=>null,build:async()=>seed,filter:()=>packet,revision:async()=>state.revision,compress:true});
 const response=await privateListingQueryV151(new Request('https://private.invalid/',{method:'POST',body:JSON.stringify({revision:state.revision,spec,...(companion==='media'?{mediaIds:['IND-1']}:{since:'R252',fields:packet.fields})})}),env,{});
 assert.equal(response.status,200);const actual=await response.json();assert.equal(actual.ok,true);assert.equal(actual.revision,state.revision);
 assert.equal(actual.rows.length,1);assert.equal(actual.rows[0][actual.fields.indexOf('propertyId')],'IND-1');
 if(companion==='media'){assert.equal(actual.version,159);assert.equal(actual.rows[0][actual.fields.indexOf('querySelectedOriginalIdV152')],'IND-1-AD-0');}
 else{assert.equal(actual.queryDeltaV160,true);assert.deepEqual(actual.changedIds,['IND-1']);assert.equal(actual.total,1);}
 assert.ok(reads.every(key=>key.endsWith('/listings.json')||key.includes('.result-')||key.includes('query-card-media-v159')));
});
