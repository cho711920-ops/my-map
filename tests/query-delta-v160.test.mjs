import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {queryDeltaV160} from '../cloudflare/src/query-delta-v160.js';
const window={};vm.runInNewContext(readFileSync('js/query-collection-v152.js','utf8'),{window,console});
const apply=window.JSQueryCollectionV152.applyDeltaV160,proof='sha256-v1:'+'a'.repeat(64),next='sha256-v1:'+'b'.repeat(64);
const fields=['propertyId','sourceSnapshotKey','sheetRow','rent'];
const base={ok:true,version:152,grouping:'client-v152',completeQuery:true,revision:'before',fields,rows:[['A',proof,2,100],['B',proof,3,55]],total:2};
const packet={...base,revision:'after',rows:[['C',next,2,30],['A',next,3,80]]};
test('unchanged revision transfers no rows and never loads the full canonical packet',async()=>{
  const delta=await queryDeltaV160({state:{revision:'before'},since:'before',changes:()=>[],loadPacket:()=>{throw Error('No listing download');}});
  assert.equal(apply(base,delta),base);assert.equal(JSON.stringify(delta).length<200,true);
});
test('delta carries exact canonical ordering, additions, removals and changed prices without writable fields',async()=>{
  const delta=await queryDeltaV160({state:{revision:'after'},since:'before',changes:()=>['A','B','C'],loadPacket:async()=>packet});
  const result=apply(base,delta);assert.deepEqual(JSON.parse(JSON.stringify(result.rows)),packet.rows);assert.equal(result.revision,'after');
  assert.deepEqual(delta.missingIds,['B']);assert.equal(base.rows[0][3],100,'Never mutate the old cached packet');
});
test('incomplete history, invalid revision or missing canonical fields uses the existing full query path',async()=>{
  assert.equal(await queryDeltaV160({state:{revision:'after'},since:'before',changes:()=>{throw Error('History missing');}}),null);
  assert.equal(await queryDeltaV160({state:{revision:'after'},since:'',changes:()=>[]}),null);
  assert.equal(await queryDeltaV160({state:{revision:'after'},since:'before',changes:()=>['A'],loadPacket:async()=>({...packet,revision:'wrong'})}),null);
});
test('client rejects missing, repeated, unknown, foreign-proof and wrong-base delta responses before publishing any row',async()=>{
  const good=await queryDeltaV160({state:{revision:'after'},since:'before',changes:()=>['A','B','C'],loadPacket:async()=>packet});
  const broken=[{baseRevision:'wrong'},{order:[['C',2],['C',3]]},{missingIds:[]},{changedIds:['A','B']},{total:1},
    {rows:[['C','wrong',2,30],['A',next,3,80]]},{order:[['FOREIGN',2],['A',3]]},{fields:[...fields,'memo']}];
  for(const patch of broken)assert.throws(()=>apply(base,{...good,...patch}));assert.equal(base.revision,'before');
});
