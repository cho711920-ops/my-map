import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {querySpecV151,queryChangesV151,queryWireV151,defaultQueryV151,privateListingQueryV151,patchPreparedQueryV152}=await import('../cloudflare/src/query-worker-v151.js');
test('query input is bounded to existing filters and never accepts Today as an approximate date filter',()=>{
  assert.equal(defaultQueryV151(querySpecV151({})),true);
  assert.equal(defaultQueryV151(querySpecV151({filters:{keyword:'용문동'}})),false);
  for(const spec of [{mode:'other'},{filters:{admin:'yes'}},{filters:{keyword:'x'.repeat(301)}},{newListingDays:1},
    {favoriteKeys:[{}]},{favoriteKeys:Array(20001).fill('property:A')}])assert.throws(()=>querySpecV151(spec));
  assert.equal(querySpecV151({doneOnly:true}).doneOnly,true);
});
test('query delta cannot infer removals when complete history is absent or over bound',()=>{
  const state={revision:'b',history:[{revision:'a',changeIds:[]},{revision:'b',changeIds:['one','two']}]};
  assert.deepEqual(queryChangesV151(state,'a'),['one','two']);assert.deepEqual(queryChangesV151(state,'b'),[]);
  assert.throws(()=>queryChangesV151(state,'unknown'));
  assert.throws(()=>queryChangesV151({...state,history:[state.history[0],{...state.history[1],fullReload:true}]},'a'));
  assert.throws(()=>queryChangesV151({...state,history:[state.history[0],{revision:'b',changeIds:Array.from({length:1025},(_,i)=>String(i))}]},'a'));
});
test('wire map projections carry exact identities and display prices without memo, phone or writable raw models',()=>{
  const wire=queryWireV151([{propertyId:'A',key:'legacy-A',memo:'private',landlordPhone:'private',rent:70,thumbnailV8:'photo',queryOriginalIdsV151:[{propertyId:'A',originalId:'ad-A'}]}],'rev');
  assert.equal(wire.completeQuery,true);assert.equal(wire.total,1);
  for(const name of ['memo','landlordPhone','operating_memo','monthly_rent','images','photoPathsV119'])assert.ok(!wire.fields.includes(name));
  assert.equal(wire.cardProjectionV157,true);assert.equal(wire.rows[0][wire.fields.indexOf('thumbnailV8')],'photo');
  assert.equal(wire.grouping,'client-v152');assert.ok(wire.fields.includes('rent'),'Display sorting uses the exact projected price');
  assert.equal(wire.rows[0][wire.fields.indexOf('propertyId')],'A');
  assert.ok(wire.fields.includes('sourceSnapshotKey'),'Only the exact master/source proof can hydrate an editable card');
});
test('an authoritative current prepared view needs no SQL/full snapshot download; stale views never pass',async()=>{
  const reads=[],wire=queryWireV151([{propertyId:'A'}],'r');
  const object=data=>({body:new Blob([JSON.stringify(data)]).stream(),httpMetadata:{},customMetadata:{revision:'r'}});
  const env={DB:{prepare(){throw new Error('SQL must not run');}},MEDIA:{async get(key){reads.push(key);
    return key.endsWith('listings.json')?object({revision:'r'}):object(wire);}}};
  const request=()=>new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'r',spec:{}})});
  const response=await privateListingQueryV151(request(),env,{});assert.equal(response.status,200);assert.deepEqual(await response.json(),wire);
  assert.equal(reads.length,2);assert.ok(reads.every(key=>!key.endsWith('.csv')&&!key.includes('unified-listings')));
  await assert.rejects(privateListingQueryV151(new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'old',spec:{}})}),env,{}),/변경/);
});
test('confirmed condition changes patch only their existing ID without full snapshot reads or a sibling overwrite',async()=>{
  const hash='sha256-v1:'+'a'.repeat(64),changed='sha256-v1:'+'b'.repeat(64),spec=querySpecV151({});
  const packet=queryWireV151(['A','B'].map((id,index)=>({propertyId:id,key:id,address:'서구 용문동 1',sourceSnapshotKey:hash,
    tradeType:'lease',state:'active',rent:100,deposit:1000,premium:0,area:20,sheetRow:index+2,registrationAt:'2026-11-09'})),'before');
  const state={revision:'after',history:[{revision:'before'},{revision:'after',changeIds:['A']}]};
  const env={MEDIA:{get(){throw new Error('Full R2 data must not be read');}},DB:{prepare(){throw new Error('Use exact point read');}}};
  const patched=await patchPreparedQueryV152(env,state,spec,packet,async ids=>({ok:true,requestedIds:ids,missingIds:[],
    items:[{id:'internal-A',property_id:'A',title:'A',address:'서구 용문동 1',room:'지하1층',listing_type:'상가점포',status:'active',
      trade_type:'lease',deposit:1000,monthly_rent:80,premium:0,area_m2:20,source_snapshot_key:changed,registration_at:'2026-11-09'}],
    unified:{ok:true,groups:{A:[{propertyId:'A',originalId:'ad-A',source:'네이버',active:1,deposit:1000,rent:100,premium:0,area:20,
      manualDisplayFields:'monthly_rent,room',room:'지하1층',floor:-1,hasManualRoomOverride:true}]},sourceSnapshotKeys:{A:changed},sourceSnapshotPropertyIds:{A:'A'}}}));
  const rows=patched.rows.map(values=>Object.fromEntries(patched.fields.map((field,index)=>[field,values[index]])));
  assert.equal(patched.revision,'after');assert.equal(rows.find(row=>row.propertyId==='A').rent,80);
  assert.equal(rows.find(row=>row.propertyId==='A').floor,-1);assert.equal(rows.find(row=>row.propertyId==='B').rent,100);
  assert.equal(await patchPreparedQueryV152(env,{revision:'x',history:[{revision:'before'},{revision:'x',changeIds:['NEW']}]},spec,packet),null);
});

test('private media endpoint reuses the canonical prepared selection without querying SQL or loading writable masters',async()=>{
  const hash='sha256-v1:'+'c'.repeat(64),wire=queryWireV151([{propertyId:'A',sourceSnapshotKey:hash,thumbnailV8:'https://photos.invalid/A.jpg',
    querySelectedOriginalIdV152:'original-A',querySelectedPhotoCountV157:4},{propertyId:'B',sourceSnapshotKey:hash}],'r');
  const objects=new Map(),reads=[];
  const object=(value,metadata)=>({body:new Blob([JSON.stringify(value)]).stream(),customMetadata:metadata});
  const env={DB:{prepare(){throw new Error('No SQL or full master read');}},MEDIA:{async get(key){reads.push(key);
    if(objects.has(key)){const saved=objects.get(key);return object(JSON.parse(saved.body),saved.metadata);}
    if(key.endsWith('listings.json'))return object({revision:'r'},{});
    if(key.includes('query-view-v157'))return object(wire,{revision:'r'});return null;
  },async put(key,body,options){objects.set(key,{body,metadata:options.customMetadata});}}};
  const request=()=>new Request('https://internal.invalid/',{method:'POST',body:JSON.stringify({revision:'r',spec:{},mediaIds:['A']})});
  const first=await privateListingQueryV151(request(),env,{});assert.equal(first.headers.get('x-js-query-schema'),'readonly-media-v159');
  const packet=await first.json();assert.equal(packet.rows.length,1);assert.equal(packet.rows[0][0],'A');assert.equal(packet.rows[0][3],'original-A');
  reads.length=0;assert.equal((await privateListingQueryV151(request(),env,{})).status,200);
  assert.ok(!reads.some(key=>key.includes('query-view-v157')),'Subsequent thumbnail requests use only the small sidecar and revision');
});
