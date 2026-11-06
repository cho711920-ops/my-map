import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile}from'node:fs/promises';
const code=await readFile(new URL('../js/initial-listings-cache-v1.js',import.meta.url),'utf8');
for(const reason of ['blocked','deadline'])test('a '+reason+' cache open settles and closes a late database without restoring unverified data',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let request,closed=0,transactions=0,openArgs;
 const context={Promise,Date,Math,setTimeout,clearTimeout,indexedDB:{open(...args){openArgs=args;return request={};}},localStorage:{getItem(){return '';}}};context.window=context;
 vm.runInNewContext(code,context);
 const work=context.JSInitialListingsCacheV1.read();
 if(reason==='blocked')request.onblocked();else t.mock.timers.tick(2500);
 assert.equal(await work,null);assert.equal(openArgs.length,1,'data schema cannot force a browser database upgrade');
 request.result={close(){closed++;},transaction(){transactions++;throw Error('Late open must not start a transaction');}};
 request.onsuccess();assert.equal(closed,1);assert.equal(transactions,0);
});
