import assert from 'node:assert/strict';
import test from 'node:test';
import {publicReleaseObservationV241 as observe} from '../cloudflare/src/public-release-observation-v241.js';

const origin='https://js-map.com',build='b'.repeat(24);
function request(fields={},method='HEAD',path='/public-release-v240.json') {
  return new Request(origin+path+'?'+new URLSearchParams({release_status_v241:'prepared',build,code:'ok',repairs:'0',...fields}),{method});
}
test('release observation contains only fixed installation fields, never extra request data',()=>{
  const value=observe(request({email:'private',memo:'private',phone:'private',url:'private'}));
  assert.deepEqual(value,{stage:'prepared',build,code:'ok',repairs:0});
  assert.equal(JSON.stringify(value).includes('private'),false);
});
for(const stage of ['started','prepared','blocked'])test('release observation accepts bounded stage '+stage,()=>{
  assert.equal(observe(request({release_status_v241:stage,code:stage==='blocked'?'asset_invalid':'ok',repairs:'512'})).stage,stage);
});
test('invalid diagnostics cannot introduce arbitrary messages or log request details',()=>{
  for(const fields of [{build:'private'},{code:'private'},{release_status_v241:'private'},{repairs:'513'},{repairs:'-1'},{repairs:'1.5'},{repairs:''}]) {
    assert.equal(observe(request(fields)),null);
  }
  assert.equal(observe(request({},'GET')),null);
  assert.equal(observe(request({},'HEAD','/api/data')),null);
});
