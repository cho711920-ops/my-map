import test from 'node:test';import assert from 'node:assert/strict';
import {listingReadEnv} from '../cloudflare/src/listing-read-retry.js';

test('only transient SELECT failures retry, preserving bindings and the exact successful row',async()=>{
  let calls=0;const waits=[];let values;
  const target={bind(...v){values=v;return this;},async all(){if(++calls<3)throw Error('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window');return{results:[{id:values[0]}]};}};
  const env={DB:{prepare(){return target;}}};const read=listingReadEnv(env,async ms=>waits.push(ms));
  assert.equal(listingReadEnv(env),read);
  assert.deepEqual(await read.DB.prepare('SELECT id FROM listings WHERE id=?1').bind('exact-master').all(),{results:[{id:'exact-master'}]});
  assert.deepEqual(waits,[1000,3000]);assert.equal(calls,3);
});
test('SQL/schema failures, writes and RETURNING are never retried and native batches get original statements',async()=>{
  let calls=0,pauses=0,received;
  const target={bind(){return this;},async first(){calls++;throw Error('D1_ERROR: Network connection lost.');},async all(){calls++;throw Error('D1_ERROR: no such column: bad');},async run(){calls++;throw Error('D1_ERROR: Network connection lost.');}};
  const read=listingReadEnv({DB:{prepare(){return target;},async batch(values){received=values;return[];}}},async()=>pauses++);
  await assert.rejects(read.DB.prepare('INSERT INTO listings VALUES(1) RETURNING id').first());
  await assert.rejects(read.DB.prepare('SELECT id FROM listings').all());
  await assert.rejects(read.DB.prepare('UPDATE listings SET status=?1').bind('active').run());
  await read.DB.batch([read.DB.prepare('UPDATE listings SET status=?1').bind('active')]);
  assert.equal(calls,3);assert.equal(pauses,0);assert.equal(received[0],target);
});
test('permanent transient failures have a finite retry budget and keep the original error',async()=>{
  let calls=0;const failure=Error('D1_ERROR: Network connection lost.');
  const read=listingReadEnv({DB:{prepare(){return{async first(){calls++;throw failure;}};}}},async()=>{});
  await assert.rejects(read.DB.prepare('SELECT 1').first(),error=>error===failure);assert.equal(calls,3);
});
