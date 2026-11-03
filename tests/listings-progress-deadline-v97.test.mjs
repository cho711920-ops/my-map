import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=fs.readFileSync('js/data-access-v6.js','utf8');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function fixture(action='sheet') {
  let now=0,id=0,calls=0,controller,aborted=false;
  const timers=new Map();
  const window={TextDecoder,TransformStream,Response,AbortController,
    setTimeout(fn,ms){if(!ms){queueMicrotask(fn);return ++id;}timers.set(++id,{at:now+ms,fn});return id;},
    clearTimeout(key){timers.delete(key);},
    fetch:async(_url,options)=>{
      calls++;options.signal.addEventListener('abort',()=>{aborted=true;});
      return new Response(new ReadableStream({start(c){controller=c;}}));
    }};
  vm.runInNewContext(source,{window,URLSearchParams,Date:{now:()=>now}});
  const pending=(action==='sheet'?window.JSDataAccessV6.listingsSnapshot(false):window.JSDataAccessV6.read(action,{}))
    .then(value=>({value}),error=>({error}));
  return {
    pending,window,
    async write(text){await flush();controller.enqueue(new TextEncoder().encode(text));await flush();},
    async close(){controller.close();await flush();},
    async advance(ms){const end=now+ms;await flush();for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();},
    get calls(){return calls;},get aborted(){return aborted;},get timers(){return timers.size;}
  };
}

for(const action of ['sheet','unifiedListings']) test(action+' accepts a complete progressing response after the old 45-second cutoff',async()=>{
  const f=fixture(action);
  await f.write(action==='sheet'?'제목,주소\r\n':'{"ok":true,"groups":{');
  await f.advance(30000);
  await f.write(action==='sheet'?'"검수상가",':'"P":');
  await f.advance(30000);
  assert.equal(f.aborted,false);
  await f.write(action==='sheet'?'"가상주소"':'[]}}');await f.close();
  const result=await f.pending;
  assert.equal(result.error,undefined);
  if(action==='sheet')assert.deepEqual(JSON.parse(JSON.stringify(result.value.rows)),[['제목','주소'],['검수상가','가상주소']]);
  else assert.deepEqual(JSON.parse(JSON.stringify(result.value.groups)),{P:[]});
  assert.equal(f.calls,1);assert.equal(f.timers,0);
});

for(const action of ['sheet','unifiedListings']) test(action+' stops 45 seconds after its last received bytes without publishing a partial response',async()=>{
  const f=fixture(action);await f.write(action==='sheet'?'a,b\r\n':'{"ok":');
  await f.advance(20000);await f.write(action==='sheet'?'"partial':'true');
  await f.advance(44999);assert.equal(f.aborted,false);
  await f.advance(1);const result=await f.pending;
  assert.equal(result.error.name,'TimeoutError');assert.equal(f.aborted,true);
  assert.equal(result.value,undefined);assert.equal(f.calls,1);assert.equal(f.timers,0);
});

test('continuous tiny progress cannot keep the full-list request alive past two minutes',async()=>{
  const f=fixture();await f.write('a,b\r\n');
  for(let i=0;i<3;i++){await f.advance(30000);await f.write('x');}
  await f.advance(30000);
  assert.equal((await f.pending).error.name,'TimeoutError');assert.equal(f.calls,1);assert.equal(f.timers,0);
});

test('small operational reads retain their 15-second absolute deadline',async()=>{
  const f=fixture('dataRevision');await f.write('{"ok":');
  await f.advance(10000);await f.write('true');await f.advance(5000);
  assert.equal((await f.pending).error.name,'TimeoutError');assert.equal(f.calls,1);
});

test('cold snapshot preparation may finish after 45 seconds before the first byte',async()=>{
  let deliver;
  // Hold the fetch itself to reproduce the server's atomic R2 build wait.
  let now=0,id=0;const timers=new Map();
  const window={TextDecoder,AbortController,
    setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);},
    fetch:()=>new Promise(resolve=>{deliver=resolve;})};
  vm.runInNewContext(source,{window,URLSearchParams,Date:{now:()=>now}});
  const pending=window.JSDataAccessV6.listingsSnapshot(false);await flush();
  now=60000;
  assert.equal([...timers.values()][0].at,90000);
  deliver(new Response('a,b\n1,2'));await flush();
  assert.deepEqual(JSON.parse(JSON.stringify((await pending).rows)),[['a','b'],['1','2']]);
  assert.equal(timers.size,0);
});
