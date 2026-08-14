import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const queueSource = readFileSync(new URL("../js/async-mutation-queue-v1.js", import.meta.url), "utf8");

function queueHarness() {
  const storage = new Map();
  const timers = [];
  const events = [];
  const mutations = [];
  const reads = [];
  let timerId = 0;
  let rejectMutation = false;
  let statusResult = {ok: true, completed: 0, processing: 0, pending: 0, failed: 0, jobs: []};

  const indicator = {
    className: "async-mutation-status-v1 idle",
    hidden: true,
    innerHTML: "",
    title: "",
    dataset: {statusBoundV1: "1"},
    addEventListener() {},
    setAttribute() {},
    classList: {
      contains(value) { return indicator.className.split(/\s+/).includes(value); }
    }
  };
  const document = {
    readyState: "loading",
    visibilityState: "visible",
    body: {appendChild() {}},
    getElementById(id) { return id === "asyncMutationStatusV1" ? indicator : null; },
    querySelector() { return null; },
    createElement() { return indicator; },
    addEventListener() {}
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  };
  function setTimeoutFake(callback, delay) {
    const entry = {id: ++timerId, callback, delay: Number(delay) || 0, cancelled: false};
    timers.push(entry);
    return entry.id;
  }
  function clearTimeoutFake(id) {
    const timer = timers.find((entry) => entry.id === id);
    if (timer) timer.cancelled = true;
  }
  const window = {
    document,
    localStorage,
    addEventListener() {},
    dispatchEvent(event) { events.push(event); return true; },
    JSDataAccessV6: {
      mutate(action, payload, options) {
        mutations.push({action, payload, options});
        return rejectMutation
          ? Promise.reject(new Error("temporary D1 failure"))
          : Promise.resolve({ok: true, queued: true});
      },
      read(action, params, options) {
        reads.push({action, params, options});
        return Promise.resolve(statusResult);
      }
    }
  };
  class CustomEventFake {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  }
  vm.runInNewContext(queueSource, {
    window, document, localStorage, URLSearchParams, Promise, Date, Math, JSON, Object, Array,
    Number, String, Boolean, Error, CustomEvent: CustomEventFake,
    setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, isFinite
  });

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
  async function runTimer(delay) {
    const timer = timers.find((entry) => !entry.cancelled && entry.delay === delay);
    assert.ok(timer, `expected ${delay}ms timer`);
    timer.cancelled = true;
    timer.callback();
    await flush();
  }
  return {
    queue: window.JSAsyncMutations,
    storage,
    timers,
    events,
    mutations,
    reads,
    setRejectMutation(value) { rejectMutation = value; },
    setStatusResult(value) { statusResult = value; },
    runTimer,
    flush
  };
}

test("queue deduplicates request ids and completes through the shared data boundary", async () => {
  const harness = queueHarness();
  harness.setStatusResult({
    ok: true, completed: 1, processing: 0, pending: 0, failed: 0,
    jobs: [{id: "same-request", status: "완료", attempts: 1, result: "{\"saved\":true}"}]
  });

  await harness.queue.enqueue("updatePropertyMemo", {requestId: "same-request", propertyId: "M-1"});
  await harness.queue.enqueue("updatePropertyMemo", {requestId: "same-request", propertyId: "M-1"});
  assert.equal(JSON.parse(harness.storage.get("js_async_mutation_outbox_v1")).length, 1);

  await harness.runTimer(0);
  assert.equal(harness.mutations.length, 1);
  assert.equal(harness.mutations[0].action, "enqueueMutation");
  assert.equal(harness.mutations[0].payload.taskAction, "updatePropertyMemo");
  assert.equal(harness.mutations[0].payload.requestId, "same-request");
  assert.equal(harness.mutations[0].options.keepalive, true);
  assert.equal(harness.reads[0].action, "workQueueStatus");
  assert.equal(harness.reads[0].params.client, "1.0.8");
  assert.equal(JSON.parse(harness.storage.get("js_async_mutation_outbox_v1")).length, 0);
  assert.equal(JSON.parse(harness.storage.get("js_async_mutation_active_v1")).length, 0);
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].type, "js-async-mutation-finished");
  assert.equal(harness.events[0].detail.requestId, "same-request");
  assert.equal(harness.events[0].detail.ok, true);
});

test("queue retains a failed task and retries it after three seconds", async () => {
  const harness = queueHarness();
  harness.setRejectMutation(true);
  await harness.queue.enqueue("toggleDone", {requestId: "retry-request", propertyId: "M-2"});
  await harness.runTimer(0);

  let outbox = JSON.parse(harness.storage.get("js_async_mutation_outbox_v1"));
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].lastError, /temporary D1 failure/);
  assert.ok(harness.timers.some((entry) => !entry.cancelled && entry.delay === 3000));

  harness.setRejectMutation(false);
  harness.setStatusResult({
    ok: true, completed: 1, processing: 0, pending: 0, failed: 0,
    jobs: [{id: "retry-request", status: "완료", attempts: 2, result: "{}"}]
  });
  await harness.runTimer(3000);
  outbox = JSON.parse(harness.storage.get("js_async_mutation_outbox_v1"));
  assert.equal(outbox.length, 0);
  assert.equal(harness.mutations.length, 2);
  assert.equal(harness.events.at(-1).detail.requestId, "retry-request");
});
