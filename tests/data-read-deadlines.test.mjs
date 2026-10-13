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
function harness(fetch) {
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    fetch, AbortController,
    setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, {callback, ms}); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, {window, URLSearchParams});
  return {
    client: window.JSDataAccessV6, timers,
    timeout() { const pending = [...timers.values()]; pending.forEach(timer => timer.callback()); }
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
