import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync('js/data-access-v6.js','utf8');
function clientFor(bytes,split,extra={}) {
  const stream=new ReadableStream({start(controller){
    for(let i=0;i<bytes.length;i+=split)controller.enqueue(bytes.subarray(i,i+split));
    controller.close();
  }});
  const window={TextDecoder,setTimeout,clearTimeout,AbortController,
    fetch:async()=>new Response(stream,{headers:{'x-js-listings-revision':'R68'}}),...extra};
  vm.runInNewContext(source,{window,URLSearchParams});
  return window.JSDataAccessV6;
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('streamed CSV preserves Korean, escaped quotes, CRLF, embedded lines and empty cells across every byte boundary',async()=>{
  const text='\uFEFF제목,주소,메모,비고\r\n"한글 😀","서구","첫줄\r\n둘째, \"\"인용\"\"",\r\n"","따옴표\"\"",끝,마지막';
  const expected=[['제목','주소','메모','비고'],['한글 😀','서구','첫줄\n둘째, "인용"',''],['','따옴표"','끝','마지막']];
  const bytes=new TextEncoder().encode(text);
  for(let split=1;split<=bytes.length;split++) {
    const result=await clientFor(bytes,split).listingsSnapshot(false);
    assert.deepEqual(plain(result.rows),expected,'byte split '+split);
    assert.equal(result.revision,'R68');assert.equal(result.body,undefined);
  }
});
test('a single large response chunk is scanned without losing records or a final empty column',async()=>{
  const rows=Array.from({length:5000},(_,n)=>['상가'+n,'설명,"인용"\n다음줄','']);
  const csv=rows.map(r=>r.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const bytes=new TextEncoder().encode(csv);
  assert.deepEqual(plain((await clientFor(bytes,bytes.length).listingsSnapshot(false)).rows),rows);
});
test('incomplete quoted records and invalid UTF-8 reject the entire read instead of publishing partial data',async()=>{
  await assert.rejects(clientFor(new TextEncoder().encode('a,b\r\n1,"불완전'),1).listingsSnapshot(false),/끝까지/);
  await assert.rejects(clientFor(Uint8Array.from([97,44,0xED,0xA0,0x80]),1).listingsSnapshot(false));
});
test('legacy text readers keep CSV values when the streamed snapshot path is available',async()=>{
  const bytes=new TextEncoder().encode('제목,주소\r\n"인용,""값""",서구');
  assert.equal(await clientFor(bytes,3).listingsCsv(false),'제목,주소\r\n"인용,""값""",서구');
});

test('a scoped update during cooperative original expansion supersedes the old full load atomically',async()=>{
  const timers=[];let clock=0;
  const result={ok:true,format:'compact-v2',fields:['originalId','source'],
    groups:{P:Array.from({length:256},(_,i)=>['old-'+i,'네이버'])}};
  const window={allItems:[],addEventListener(){},setTimeout:callback=>{timers.push(callback);},
    JSDataAccessV6:{read:async()=>result,invalidateRead(){}}};
  const context={window,Date:{now:()=>clock+=20},console:{error(){},warn(){}},
    document:{getElementById:()=>null,addEventListener(){}}};
  vm.runInNewContext(fs.readFileSync('js/unified-listings-v8.js','utf8'),context);
  const api=window.JSUnifiedListingsV8,pending=api.load(true);
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(timers.length,1,'large expansion yielded before publishing');
  assert.equal(api.allOriginals('P').length,0);
  api.mergeScoped({ok:true,groups:{P:[{propertyId:'P',originalId:'new',source:'네이버'}]}});
  while(timers.length){timers.shift()();for(let i=0;i<20;i++)await Promise.resolve();}
  assert.equal((await pending).superseded,true);
  assert.deepEqual(Array.from(api.allOriginals('P'),o=>o.originalId),['new']);
});
