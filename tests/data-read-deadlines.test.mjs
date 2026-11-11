import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync("js/data-access-v6.js", "utf8");
function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return {promise, resolve};
}
async function flush() { for (let index = 0; index < 6; index++) await Promise.resolve(); }
function harness(fetch, extra={}) {
  const timers = new Map();
  let nextTimer = 0, now = 0;
  const window = {
    fetch, AbortController,
    setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, {callback, ms, at: now + ms}); return id; },
    clearTimeout(id) { timers.delete(id); }, ...extra
  };
  vm.runInNewContext(source, {window, URLSearchParams, Date: {now: () => now}});
  return {
    client: window.JSDataAccessV6, timers,
    advance(ms) {now+=ms;const ready=[...timers.entries()].filter(([,t])=>t.at<=now);ready.forEach(([id,t])=>{timers.delete(id);t.callback();});},
    timeout() {
      const pending = [...timers.entries()];
      if (pending.length) now = Math.max(...pending.map(([,timer]) => timer.at));
      pending.forEach(([id,timer]) => { timers.delete(id); timer.callback(); });
    }
  };
}

test("a stalled read reaches its deadline and a later explicit retry starts only one fresh request", async () => {
  const calls = [];
  const h = harness((url, options) => { calls.push({url, options}); return new Promise(() => {}); });
  const first = h.client.read("newListingPeriod", {days: 1, market: "lease"});
  const failure = assert.rejects(first, error => error.name === "TimeoutError" && error.retryable === true);
  await flush();
  assert.equal([...h.timers.values()][0].ms, 15000);
  h.timeout();
  await failure;
  assert.equal(calls.length, 1, "a timeout never creates an automatic retry loop");
  assert.equal(calls[0].options.signal.aborted, true);
  const second = h.client.read("newListingPeriod", {days: 1, market: "lease"});
  const retryFailure = assert.rejects(second, {name: "TimeoutError"});
  await flush();
  assert.equal(calls.length, 2);
  h.timeout();
  await retryFailure;
});

test("read deadlines include stalled JSON bodies after successful HTTP headers", async () => {
  const body = deferred();
  let signal;
  const h = harness((_url, options) => {
    signal = options.signal;
    return Promise.resolve({ok: true, headers: new Headers(), json: () => body.promise});
  });
  const read = h.client.read("unifiedListings", {});
  const failure = assert.rejects(read, {name: "TimeoutError"});
  await flush();
  assert.equal([...h.timers.values()][0].ms, 45000);
  h.timeout();
  await failure;
  assert.equal(signal.aborted, true);
  body.resolve({ok: true, groups: {late: []}});
  await flush();
  assert.equal(h.timers.size, 0);
});

test("identical concurrent reads deduplicate while different scopes remain independent", async () => {
  const requests = [];
  const h = harness((url) => {
    const response = deferred();
    requests.push({url, response});
    return response.promise;
  });
  const first = h.client.read("newListingPeriod", {days: 1, market: "lease"});
  const same = h.client.read("newListingPeriod", {market: "lease", days: 1});
  const other = h.client.read("newListingPeriod", {days: 1, market: "building"});
  assert.equal(first, same);
  await flush();
  assert.equal(requests.length, 2);
  requests.forEach(request => request.response.resolve(new Response('{"ok":true,"items":[]}')));
  await Promise.all([first, same, other]);
  assert.equal(h.timers.size, 0);
});

test("invalidated initial reads are aborted and cannot be reused as a new-generation warmup", async () => {
  const calls = [];
  const h = harness((url, options) => {
    const response = deferred();
    calls.push({url, options, response});
    return response.promise;
  });
  h.client.warmInitialData();
  const original = h.client.read("unifiedListings", {});
  await flush();
  h.client.invalidateRead("unifiedListings");
  await assert.rejects(original, {name: "AbortError"});
  const old = calls.find(call => /unifiedListings/.test(call.url));
  assert.equal(old.options.signal.aborted, true);
  const fresh = h.client.read("unifiedListings", {});
  await flush();
  const next = calls.filter(call => /unifiedListings/.test(call.url))[1];
  next.response.resolve(new Response('{"ok":true,"groups":{"fresh":[]}}'));
  const result = await fresh;
  assert.deepEqual(Object.keys(result.groups), ["fresh"]);
  old.response.resolve(new Response('{"ok":true,"groups":{"old":[]}}'));
  h.client.invalidateRead("listingsCsv");
  await flush();
  assert.equal(h.timers.size, 0);
});

test("caller cancellation is bounded but writes keep their existing mutation semantics", async () => {
  const calls = [];
  const h = harness((url, options) => {
    calls.push({url, options});
    return options.method === "POST" ? Promise.resolve(new Response('{"ok":true}')) : new Promise(() => {});
  });
  const controller = new AbortController();
  const read = h.client.read("dataRevision", {}, {signal: controller.signal});
  const failure = assert.rejects(read, {name: "AbortError"});
  await flush();
  controller.abort();
  await failure;
  assert.equal(calls[0].options.signal.aborted, true);
  await h.client.mutate("toggleDone", {propertyId: "fixture"});
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.signal, undefined);
  assert.equal(h.timers.size, 0, "read deadlines are never added to writes");
});


const pump=()=>new Promise(resolve=>setImmediate(resolve));
test('large query keeps receiving past 15s but never publishes partial JSON',async()=>{
  let body,done=false;
  const h=harness(()=>Promise.resolve(new Response(new ReadableStream({start(c){body=c;}}))),{Response,TransformStream});
  const read=h.client.read('listingQuery',{spec:'{"mode":"building_sale"}'}).then(value=>{done=true;return value;});await pump();
  for(const text of ['{"ok":true,','"items":[','{"id":"A"}]']){
    body.enqueue(new TextEncoder().encode(text));await pump();h.advance(10000);await pump();assert.equal(done,false);
  }
  body.enqueue(new TextEncoder().encode('}'));body.close();const result=await read;
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{ok:true,items:[{id:'A'}]});assert.equal(h.timers.size,0);
});
test('query headers and a silent body still time out at 15s',async()=>{
  for(const headers of [true,false]){
    const h=harness(()=>headers?new Promise(()=>{}):Promise.resolve(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}))),{Response,TransformStream});
    const failure=assert.rejects(h.client.read('listingQuery',{}),{name:'TimeoutError'});await pump();h.advance(15000);await failure;assert.equal(h.timers.size,0);
  }
});
test('continuously receiving query still obeys the existing 45s large-read ceiling',async()=>{
  let body;const h=harness(()=>Promise.resolve(new Response(new ReadableStream({start(c){body=c;}}))),{Response,TransformStream});
  const failure=assert.rejects(h.client.read('listingQuery',{}),{name:'TimeoutError'});await pump();
  for(let i=0;i<4;i++){body.enqueue(new TextEncoder().encode(' '));await pump();h.advance(10000);}
  body.enqueue(new TextEncoder().encode(' '));await pump();h.advance(5000);await failure;assert.equal(h.timers.size,0);
});
test('HTTP 200 invalid or cut JSON is retryable format failure, not HTTP_200',async()=>{
  const h=harness(()=>Promise.resolve(new Response('{"ok":true,"rows":[')),{Response,TransformStream});
  await assert.rejects(h.client.read('listingQuery',{}),e=>e.name==='DataResponseError'&&e.retryable===true&&!e.status);assert.equal(h.timers.size,0);
});
test('explicit query deadlines stay absolute even while receiving',async()=>{
  let body;const h=harness(()=>Promise.resolve(new Response(new ReadableStream({start(c){body=c;}}))),{Response,TransformStream});
  const failure=assert.rejects(h.client.read('listingQuery',{}, {timeoutMs:5000}),{name:'TimeoutError'});await pump();body.enqueue(new TextEncoder().encode('{'));h.advance(5000);await failure;
});
