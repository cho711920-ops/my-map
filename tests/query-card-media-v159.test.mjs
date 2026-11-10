import test from 'node:test';
import assert from 'node:assert/strict';
import {cardMediaIdsV159,queryCardMediaV159} from '../cloudflare/src/query-card-media-v159.js';
const fields=['propertyId','sourceSnapshotKey','thumbnailV8','querySelectedOriginalIdV152','querySelectedPhotoCountV157'];
const proof='sha256-v1:'+'a'.repeat(64);
const rows=[['A',proof,'https://photos.invalid/A.jpg','ad-A',3],['B',proof,null,'ad-B',null]];
function fixture(){
  const objects=new Map(),reads=[],writes=[];let loads=0;
  const env={MEDIA:{async get(key){reads.push(key);const value=objects.get(key);return value?{customMetadata:value.metadata,body:new Blob([value.body]).stream()}:null;},
    async put(key,body,options){writes.push(key);objects.set(key,{body,metadata:options.customMetadata});}}};
  const args={env,state:{revision:'r'},spec:{mode:'lease'},ids:['A'],common:true,loadPacket:async()=>{loads++;return {ok:true,version:152,completeQuery:true,revision:'r',fields:[...fields,'memo'],rows:rows.map(row=>[...row,'private memo']),total:2};}};
  return {args,objects,reads,writes,loads:()=>loads};
}
test('photo metadata projects only bounded exact-ID scalars and reuses its prepared companion without full listing reads',async()=>{
  const f=fixture(),first=await queryCardMediaV159(f.args);
  assert.deepEqual(first.fields,fields);assert.deepEqual(first.rows,[rows[0]]);assert.deepEqual(first.missingIds,[]);
  assert.ok(!JSON.stringify(first).includes('private memo'));assert.equal(f.loads(),1);
  const next=await queryCardMediaV159({...f.args,ids:['B','MISSING'],loadPacket:()=>{throw Error('No full packet');}});
  assert.deepEqual(next.rows,[rows[1]]);assert.deepEqual(next.missingIds,['MISSING']);assert.equal(next.rows[0][4],null);
  assert.equal(f.writes.length,1);assert.ok(f.reads.every(key=>key.startsWith('api-cache/query-card-media-v159-')));
});
test('concurrent media reads share one companion build while returning their own requested IDs',async()=>{
  const f=fixture();let release;const gate=new Promise(resolve=>release=resolve),original=f.args.loadPacket;
  f.args.loadPacket=async()=>{await gate;return original();};
  const one=queryCardMediaV159(f.args),two=queryCardMediaV159({...f.args,ids:['B']});release();
  assert.equal((await one).rows[0][0],'A');assert.equal((await two).rows[0][0],'B');assert.equal(f.loads(),1);
});
test('stale revisions rebuild and malformed current companion identity never reaches a card',async()=>{
  const f=fixture();await queryCardMediaV159(f.args);
  const key=f.writes[0],cached=f.objects.get(key);cached.metadata.revision='old';await queryCardMediaV159(f.args);assert.equal(f.loads(),2);
  const current=f.objects.get(key),body=JSON.parse(current.body);body.rows[0][1]='unverified';current.body=JSON.stringify(body);
  await assert.rejects(queryCardMediaV159(f.args),/원장/);
});
test('custom filter companion is bound to exact query hash and cannot reuse another filter slot',async()=>{
  const f=fixture();await queryCardMediaV159({...f.args,common:false,spec:{mode:'lease',filters:{keyword:'A'}}});
  for(const value of f.objects.values())value.metadata.queryHash='wrong';
  await queryCardMediaV159({...f.args,common:false,spec:{mode:'lease',filters:{keyword:'A'}}});assert.equal(f.loads(),2);
});
test('media bounds reject duplicate, injected and excessive IDs; unknown photo count remains unknown',()=>{
  for(const ids of [[],['A','A'],['A,B'],[' A'],['A\n'],Array.from({length:49},(_,i)=>String(i))])assert.throws(()=>cardMediaIdsV159(ids));
  assert.deepEqual(cardMediaIdsV159([],true),[]);assert.deepEqual(cardMediaIdsV159(['A']),['A']);
});
