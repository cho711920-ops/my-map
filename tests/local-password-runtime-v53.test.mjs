import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {createLocalPassword,verifyLocalPassword} from '../cloudflare/src/security.js';

test('Workers 100k WebCrypto ceiling cannot break issuance or existing 310k hashes',async t=>{
  const original=crypto.subtle.deriveBits.bind(crypto.subtle),calls=[];
  t.mock.method(crypto.subtle,'deriveBits',(algorithm,...rest)=>{
    calls.push(algorithm.iterations);
    if(algorithm.name==='PBKDF2'&&algorithm.iterations>100000)throw Error('Pbkdf2 failed: iteration counts above 100000 are not supported');
    return original(algorithm,...rest);
  });
  for(const iterations of [100000,310000,600000]){
    const record=await createLocalPassword('fixture-only-password',iterations);
    const salt=Buffer.from(record.salt,'base64url');
    const expected=pbkdf2Sync('fixture-only-password',salt,iterations,32,'sha256').toString('base64url');
    assert.equal(record.hash,expected,'same standard PBKDF2 output; no downgrade or custom hash scheme');
    assert.equal(record.iterations,iterations);
    const account={password_salt:record.salt,password_hash:record.hash,password_iterations:record.iterations};
    assert.equal(await verifyLocalPassword('fixture-only-password',account),true);
    assert.equal(await verifyLocalPassword('incorrect',account),false);
  }
  assert.ok(calls.length>0);assert.ok(calls.every(count=>count<=100000));
});
