const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {test} = require("node:test");
const source = fs.readFileSync("js/script.js", "utf8");
function section(first, next) {
  const start = source.indexOf("function " + first + "(");
  const end = source.indexOf("function " + next + "(", start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
const loader = section("isInvalidNaverMapsKeyV662", "loadNaverMapsSdkV653") +
  section("loadNaverMapsSdkV653", "formatNaverPanoramaDateV653");
const warmup = section("warmNaverRoadviewSdkV658", "normalizeAngle");

function harness() {
  const timers = new Map();
  const scripts = [];
  let timerId = 0;
  let configCalls = 0;
  let existing = null;
  const timer = (callback, delay) => {const id = ++timerId; timers.set(id, {callback, delay}); return id;};
  const sandbox = {
    window: {}, console,
    naverRoadviewSdkPromiseV653: null, naverRoadviewSdkReadyV1: false, naverMapsNamespaceV663: null,
    recoverNaverMapsAuthStateV664() {},
    setTimeout: timer, clearTimeout: id => timers.delete(id),
    setInterval: timer, clearInterval: id => timers.delete(id),
    fetch: async () => {configCalls++; return {ok: true, json: async () => ({ncpKeyId: "fixture-valid-key"})};},
    document: {
      getElementById() {return existing;}, querySelectorAll() {return [];},
      createElement() {return {addEventListener() {}, remove() {if (existing === this) existing = null;}};},
      head: {appendChild(node) {existing = node; scripts.push(node);}}
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(loader, sandbox);
  return {sandbox, timers, scripts, get configCalls() {return configCalls;}, get existing() {return existing;}};
}
async function flush() {for (let i = 0; i < 10; i++) await Promise.resolve();}
function succeed(h) {
  h.sandbox.window.naver = {maps: {Panorama() {}}};
  h.scripts.at(-1).onload();
}

test("roadview shared SDK failure removes the dead script; one explicit retry succeeds", async () => {
  const h = harness();
  const first = h.sandbox.loadNaverMapsSdkV653();
  const simultaneous = h.sandbox.loadNaverMapsSdkV653();
  assert.equal(first, simultaneous);
  const outcomes = Promise.allSettled([first, simultaneous]);
  await flush();
  assert.equal(h.configCalls, 1);
  assert.equal(h.scripts.length, 1);
  h.scripts[0].onerror();
  const failures = await outcomes;
  assert.ok(failures.every(result => result.status === "rejected" && result.reason.message === "NAVER_MAPS_SDK_FAILED"));
  assert.equal(h.existing, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.configCalls, 1, "concurrent failure does not auto-retry");
  const retry = h.sandbox.loadNaverMapsSdkV653();
  assert.equal(retry, h.sandbox.loadNaverMapsSdkV653());
  await flush();
  assert.equal(h.configCalls, 2);
  assert.equal(h.scripts.length, 2);
  succeed(h);
  assert.equal(await retry, h.sandbox.window.naver.maps);
  assert.equal(h.timers.size, 0);
  await h.sandbox.loadNaverMapsSdkV653();
  assert.equal(h.configCalls, 2, "ready SDK adds no network request");
});

test("roadview SDK timeout removes script and polling before a fresh successful retry", async () => {
  const h = harness();
  const first = h.sandbox.loadNaverMapsSdkV653();
  const failure = assert.rejects(first, /NAVER_MAPS_SDK_TIMEOUT/);
  await flush();
  h.scripts[0].onload();
  assert.ok([...h.timers.values()].some(timer => timer.delay === 80));
  [...h.timers.values()].find(timer => timer.delay === 12000).callback();
  await failure;
  assert.equal(h.existing, null);
  assert.equal(h.timers.size, 0);
  const retry = h.sandbox.loadNaverMapsSdkV653();
  await flush();
  succeed(h);
  await retry;
  assert.equal(h.scripts.length, 2);
});

test("a previously ready SDK with a lost Panorama namespace is recreated", async () => {
  const h = harness();
  const first = h.sandbox.loadNaverMapsSdkV653();
  await flush(); succeed(h); await first;
  h.sandbox.window.naver = {};
  const retry = h.sandbox.loadNaverMapsSdkV653();
  await flush();
  assert.equal(h.scripts.length, 2);
  succeed(h); await retry;
});

for (const readyState of ["complete", "loading"]) {
  test("roadview warmup schedules one idle attempt with document " + readyState, async () => {
    const idle = [];
    const listeners = [];
    let calls = 0;
    const sandbox = {document: {readyState}, window: {
      addEventListener(event, fn, options) {listeners.push({event, fn, options});},
      requestIdleCallback(fn, options) {idle.push({fn, options});}
    }, loadNaverMapsSdkV653() {calls++; return Promise.resolve({});}};
    vm.createContext(sandbox);
    vm.runInContext(warmup, sandbox);
    vm.runInContext(warmup, sandbox);
    if (readyState === "loading") {
      assert.equal(idle.length, 0);
      assert.equal(listeners.length, 1);
      assert.equal(listeners[0].event, "load");
      assert.equal(listeners[0].options.once, true);
      listeners[0].fn();
    } else assert.equal(listeners.length, 0);
    assert.equal(calls, 0, "warmup never blocks the current task");
    assert.equal(idle.length, 1);
    assert.equal(idle[0].options.timeout, 1200);
    idle[0].fn();
    assert.equal(calls, 1);
  });
}
