import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';
test('startup DOM diagnostics record numeric transfer progress and scope without recording listing content',async()=>{
 const values=new Map(),body='제목,주소\r\n검수상가,검수동 1';const window={document:{documentElement:{setAttribute:(k,v)=>values.set(k,v)}},fetch:async()=>new Response(body,{headers:{'x-js-listings-scope':'lease','x-js-data-encoding':'stored-gzip-v123'}}),TextDecoder,setTimeout,clearTimeout,AbortController};
 vm.runInNewContext(fs.readFileSync('js/data-access-v6.js','utf8'),{window,URLSearchParams});await window.JSDataAccessV6.listingsSnapshot(false);
 assert.equal(values.get('data-listings-read-phase'),'complete');assert.equal(Number(values.get('data-listings-read-bytes')),Buffer.byteLength(body));assert.equal(values.get('data-listings-read-scope'),'lease');assert.equal(values.get('data-listings-read-encoding'),'stored-gzip-v123');assert.ok(Number(values.get('data-listings-read-ms'))>=0);assert.ok(!JSON.stringify([...values]).includes('검수상가'));
});
