import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {handleD1GetAction,handleD1PostAction,isD1GetAction,isD1PostAction} from '../cloudflare/src/d1-api.js';

test('retired customer actions cannot read or mutate preserved records, even through a queued request',async()=>{
  const env={DB:{prepare(){throw Error('Retired feature must not touch any stored records');}}},user={email:'test@example.invalid',role:'owner'};
  for(const action of ['customerWorkspace','customerMatches']){
    assert.equal(isD1GetAction(action),false);assert.equal(await handleD1GetAction(env,user,{action}),null);
  }
  for(const action of ['saveCustomer','deleteCustomer','updateCustomerMatch','rebuildCustomerMatches','addCustomerActivity']){
    assert.equal(isD1PostAction(action),false);assert.equal(await handleD1PostAction(env,user,{action}),null);
    assert.equal(await handleD1PostAction(env,user,{action:'enqueueMutation',taskAction:action,payload:{}}),null);
  }
});
test('collection and live UI no longer run matching, while historical tables remain in place',()=>{
  for(const path of ['js/operations-center-v7.js','js/script.js','js/mobile-app-v1.js','cloudflare/src/d1-api.js','cloudflare/src/collector-api.js']){
    assert.doesNotMatch(readFileSync(path,'utf8'),/customer_matches|customerWorkspace|refreshCustomerMatches|operationsMatchPropertyIds|고객매칭/);
  }
  assert.equal(existsSync('js/customer-draft-safety-v1.js'),false);
  assert.equal(existsSync('css/mobile-customer-app-v1.css'),false);
  assert.match(readFileSync('cloudflare/migrations/0001_initial.sql','utf8'),/CREATE TABLE IF NOT EXISTS customers/);
});
