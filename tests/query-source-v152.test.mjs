import test from 'node:test';
import assert from 'node:assert/strict';
import {querySourceV152} from '../cloudflare/src/query-source-v152.js';
function bucketFixture(){
  const objects=new Map();let sequence=0,aborts=0,uploads=0;
  function object(key){const value=objects.get(key);return value?{...value,body:new Blob([value.text]).stream()}:null;}
  const bucket={get:async key=>object(key),head:async key=>objects.get(key)||null,
    put:async(key,text,options={})=>{const entry={text,etag:'etag-'+(++sequence),...options};objects.set(key,entry);return entry;},
    createMultipartUpload:async(key,options)=>{uploads++;const chunks=[];return {
      async uploadPart(number,bytes){chunks[number-1]=bytes;return {partNumber:number,etag:String(number)};},
      async complete(){return bucket.put(key,await new Blob(chunks).text(),options);},async abort(){aborts++;}};}};
  return {bucket,objects,stats:()=>({uploads,aborts})};
}
const proof='sha256-v1:'+'a'.repeat(64);
const input={ok:true,format:'expanded-v2',groups:{A:[{propertyId:'A',originalId:'ad',description:'실제 매물 설명',
  images:['first.jpg','second.jpg'],photoPathsV119:'very-long-photo-list',rent:80}]},sourceSnapshotKeys:{A:proof},sourceSnapshotPropertyIds:{A:'A'}};
test('a photo-free atomic search index preserves descriptions, exact parents and proofs and reuses the matching ETag',async()=>{
  const f=bucketFixture();await f.bucket.put('source',JSON.stringify(input));
  const first=await querySourceV152(f.bucket,'lease','source',await f.bucket.get('source'),row=>row.images?.[0]||row.thumbnail);
  const rows=await new Response(first.stream).json();assert.equal(rows.groups.A[0].thumbnail,'first.jpg');
  assert.equal(rows.groups.A[0].images,undefined);assert.equal(rows.groups.A[0].photoPathsV119,undefined);
  assert.equal(rows.groups.A[0].description,'실제 매물 설명');assert.equal(rows.sourceSnapshotKeys.A,proof);
  const second=await querySourceV152(f.bucket,'lease','source',await f.bucket.get('source'),()=>{throw new Error('Must reuse prepared index');});
  assert.deepEqual(await new Response(second.stream).json(),rows);assert.equal(f.stats().uploads,1);
});
test('source replacement aborts the new multipart index and cannot certify the old generation',async()=>{
  const f=bucketFixture();await f.bucket.put('source',JSON.stringify(input));
  await assert.rejects(querySourceV152(f.bucket,'lease','source',await f.bucket.get('source'),()=>{
    f.objects.set('source',{etag:'replaced'});return 'first.jpg';}),/갱신/);
  assert.equal(f.stats().aborts,1);assert.equal(f.objects.has('api-cache/query-original-index-v152-lease.json.meta'),false);
});

test('numeric source subset is complete for exact public parents and is bound to both source ETag and requested IDs',async()=>{
  const f=bucketFixture(),raw=structuredClone(input);
  raw.groups.B=[{propertyId:'B',originalId:'ad-B',salePrice:70000,images:['B.jpg']}];
  raw.sourceSnapshotKeys.B=proof;raw.sourceSnapshotPropertyIds={A:'PUBLIC-A',B:'PUBLIC-B'};
  await f.bucket.put('source',JSON.stringify(raw));
  const first=await querySourceV152(f.bucket,'all','source',await f.bucket.get('source'),row=>row.images?.[0]||row.thumbnail,new Set(['PUBLIC-B']));
  const subset=await new Response(first.stream).json();
  assert.deepEqual(Object.keys(subset.groups),['B']);assert.deepEqual(first.metadata.sourceSnapshotPropertyIds,{B:'PUBLIC-B'});
  assert.deepEqual(subset.sourceSnapshotKeys,{B:proof});assert.equal(subset.groups.B[0].originalId,'ad-B');
  const cached=await querySourceV152(f.bucket,'all','source',await f.bucket.get('source'),()=>{throw Error('Do not rescan full originals');},new Set(['PUBLIC-B']));
  assert.deepEqual(await new Response(cached.stream).json(),subset);assert.equal(f.stats().uploads,2);
  const changed=await querySourceV152(f.bucket,'all','source',await f.bucket.get('source'),row=>row.thumbnail,new Set(['PUBLIC-A']));
  assert.deepEqual(Object.keys((await new Response(changed.stream).json()).groups),['A']);assert.equal(f.stats().uploads,3);
});
