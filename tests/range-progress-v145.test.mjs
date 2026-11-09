import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('js/data-access-v6.js','utf8');
function runtime(stepMs,parts){
  let now=0,seq=0,rangeReads=0;const timers=new Map();
  const setTimeout=(fn,ms)=>{const id=++seq;timers.set(id,{at:now+ms,fn});return id;};
  const clearTimeout=id=>timers.delete(id);
  function advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}
  const bytes=new TextEncoder().encode('name,address,id\r\nA,known,A'+' '.repeat(256*1024));
  const context={AbortController,Headers,Response,ReadableStream,TransformStream,DecompressionStream,TextDecoder,TextEncoder,URLSearchParams,
    Date:{now:()=>now},setTimeout,clearTimeout,fetch:async(_url,init)=>{
      if(init.headers['X-JS-Snapshot-Mode']==='manifest-v128')return Response.json({protocol:'ranges-v125',etag:'"one"',size:bytes.length,
        chunkBytes:1048576,revision:'r1',encoding:'identity',contentType:'text/csv'},{headers:{'x-js-snapshot-protocol':'ranges-v125'}});
      rangeReads++;let at=0;const size=Math.ceil(bytes.length/parts);
      return new Response(new ReadableStream({pull(output){
        if(at===bytes.length){output.close();return;}advance(stepMs);
        if(init.signal.aborted){output.error(init.signal.reason);return;}
        const end=Math.min(bytes.length,at+size);output.enqueue(bytes.subarray(at,end));at=end;
      }},{highWaterMark:0}),{headers:{'x-js-snapshot-etag':'"one"','x-js-snapshot-offset':'0','x-js-snapshot-length':String(bytes.length)}});
    }};context.window=context;vm.runInNewContext(source,context);
  return {api:context.JSDataAccessV6,reads:()=>rangeReads,now:()=>now};
}
test('continuous byte progress beyond 20s completes once instead of discarding and redownloading the range',async()=>{
  const f=runtime(15000,4),result=await f.api.listingsSnapshot(false);
  assert.equal(result.rows[1][2].trim(),'A');assert.equal(f.reads(),1);assert.equal(f.now(),60000);
});
test('20s of silence still aborts a stalled range and retries at most once',async()=>{
  const f=runtime(21000,1);await assert.rejects(f.api.listingsSnapshot(false),e=>e.name==='AbortError');assert.equal(f.reads(),2);
});
test('continuous progress cannot bypass the unchanged whole-snapshot 120s cap',async()=>{
  const f=runtime(10000,13);await assert.rejects(f.api.listingsSnapshot(false),e=>e.name==='TimeoutError');assert.equal(f.reads(),1);assert.ok(f.now()<=120000);
});
