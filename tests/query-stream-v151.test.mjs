import test from 'node:test';
import assert from 'node:assert/strict';
import {readQueryOriginalsV151,queryOriginalReducerV151} from '../cloudflare/src/query-stream-v151.js';
function stream(text,size=1){const bytes=typeof text==='string'?new TextEncoder().encode(text):text;let offset=0;
  return new ReadableStream({pull(controller){if(offset===bytes.length)return controller.close();controller.enqueue(bytes.slice(offset,offset=Math.min(bytes.length,offset+size)));}});}
const payload={ok:true,format:'compact-v2',fields:['originalId','thumbnail','photoPathsV119','memo'],groups:{
  'A,한글':['ad-a','photo','v1\npaths','quotes " : , } \\ 한글'].map((v,i,a)=>i===0?a:null).filter(Boolean),B:[]},
  sourceSearchIds:{'A,한글':['naver:a']},sourceSnapshotKeys:{'A,한글':'proof',B:'proof-b'},sourceSnapshotPropertyIds:{'A,한글':'public-A',B:'public-B'}};
test('snapshot stream preserves Unicode, escapes, empty groups and exact identities at every chunk size',async()=>{
  for(const size of [1,2,3,7,64,65536]){
    const actual=await readQueryOriginalsV151(stream(JSON.stringify(payload),size));
    assert.deepEqual(JSON.parse(JSON.stringify(actual)),payload);
  }
});
test('photo-path reduction keeps a validated thumbnail and all identity maps',async()=>{
  const actual=await readQueryOriginalsV151(stream(JSON.stringify(payload),3),{onGroup:queryOriginalReducerV151(original=>original.thumbnail)});
  assert.deepEqual(JSON.parse(JSON.stringify(actual.groups['A,한글'][0])),{originalId:'ad-a',thumbnail:'photo',memo:'quotes " : , } \\ 한글',propertyId:'A,한글'});
  assert.deepEqual({...actual.sourceSnapshotPropertyIds},{'A,한글':'public-A',B:'public-B'});
});
test('stream rejects duplicate, truncated, trailing, malformed and overlarge snapshots',async()=>{
  const valid=JSON.stringify(payload);
  for(const text of [valid.slice(0,-1),valid+',',valid.replace('"ok":true','"ok":true,"ok":true'),
    valid.replace('"B":[]','"B":[],"B":[]'),valid.replace('"B":[]','"B":[],')])
    await assert.rejects(readQueryOriginalsV151(stream(text,7)));
  await assert.rejects(readQueryOriginalsV151(stream(valid),{maxBytes:10}),/bound/);
  await assert.rejects(readQueryOriginalsV151(stream(valid),{maxEntryBytes:10}),/bound/);
  await assert.rejects(readQueryOriginalsV151(stream(Uint8Array.from([123,255,125]))));
});
