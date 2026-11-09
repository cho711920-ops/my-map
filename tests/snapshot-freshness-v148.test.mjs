import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotFreshV148} from '../cloudflare/src/snapshot-freshness-v148.js';
import {snapshotTransfer} from '../cloudflare/src/snapshot-transfer.js';
import {warmMissingListingSnapshots} from '../cloudflare/src/worker.js';

const now=Date.now();
const old={customMetadata:{savedAt:String(now-7*86400000),revision:'r1',collectorRevisionV142:'c1'}};
test('unchanged authoritative revisions remain valid without hourly snapshot rebuilds',()=>{
  assert.equal(snapshotFreshV148(old,3600000,'r1',null,now),true);
  assert.equal(snapshotFreshV148(old,3600000,null,'c1',now),true);
  assert.equal(snapshotFreshV148(old,3600000,'r1','c1',now),true);
  assert.equal(snapshotFreshV148(old,3600000,null,null,now),false);
});
test('changed, missing and unknown tokens still reject old bytes; legacy files retain TTL',()=>{
  for(const [revision,epoch] of [['r2',null],[null,'c2'],['r1','c2'],['0',null],['',null]])
    assert.equal(snapshotFreshV148(old,3600000,revision,epoch,now),false);
  const legacy={customMetadata:{revision:'r1',savedAt:String(now-1000)}};
  assert.equal(snapshotFreshV148(legacy,5000,null,null,now),true);
  assert.equal(snapshotFreshV148(legacy,5000,null,'c1',now),false);
  assert.equal(snapshotFreshV148({customMetadata:{revision:'r1'}},5000,null,null,now),false);
});
test('manifest expiry cannot force a full rebuild when the exact live revision is still current',async()=>{
  const object={...old,size:10,httpEtag:'"immutable"',httpMetadata:{contentEncoding:'gzip'}};
  const env={MEDIA:{head:async()=>object}};
  const request=new Request('https://fixture.invalid/api/sheet',{headers:{'x-js-snapshot-mode':'manifest-v128'}});
  const current=await snapshotTransfer(env,'snapshot',3600000,request,'r1');
  assert.equal((await current.response.json()).etag,'"immutable"');
  assert.equal(await snapshotTransfer(env,'snapshot',3600000,request,'r2'),null);
  assert.equal(await snapshotTransfer(env,'snapshot',3600000,request),null);
});
test('minute maintenance performs no D1 scans or multipart writes for four unchanged old snapshots',async()=>{
  let heads=0;
  const env={DB:{prepare(){throw Error('No D1 snapshot scans needed');}},MEDIA:{
    head:async()=>{heads++;return old;},
    get:async key=>{assert.equal(key,'api-cache/revision/listings.json');return{customMetadata:{savedAt:String(now)},text:async()=>JSON.stringify({revision:'r1',collectorRevisionV142:'c1'})};},
    createMultipartUpload(){throw Error('No snapshot rebuild needed');}
  }};
  await warmMissingListingSnapshots(env);assert.equal(heads,4);
});
