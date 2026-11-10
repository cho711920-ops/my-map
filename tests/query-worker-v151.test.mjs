import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueryRuntimeV151} from '../tools/build-query-runtime-v151.mjs';
await buildQueryRuntimeV151();
const {querySpecV151,queryChangesV151,queryWireV151,defaultQueryV151,privateListingQueryV151}=await import('../cloudflare/src/query-worker-v151.js');
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
test('wire map inventory carries exact identities but no writable condition, memo, phone or photo models',()=>{
  const wire=queryWireV151([{propertyId:'A',key:'legacy-A',memo:'private',landlordPhone:'private',rent:70,thumbnailV8:'photo',queryOriginalIdsV151:[{propertyId:'A',originalId:'ad-A'}]}],'rev');
  assert.equal(wire.completeQuery,true);assert.equal(wire.total,1);
  for(const name of ['memo','landlordPhone','rent','thumbnailV8','photoPathsV119'])assert.ok(!wire.fields.includes(name));
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
