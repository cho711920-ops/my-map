import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/local-metrics-v1.js", import.meta.url), "utf8");
function harness(saved) {
  let clock = 10;
  let persisted = saved || "";
  const listeners = {};
  const window = {performance: {now: () => clock}, sessionStorage: {
    getItem: () => persisted || null, setItem: (key, value) => {assert.equal(key, "js_local_metrics_v1"); persisted = value;}
  }, addEventListener: (name, handler) => {listeners[name] = handler;}};
  vm.runInNewContext(source, {window, Date, Math, Number, Object, JSON});
  return {api: window.JSLocalMetricsV1, advance: (milliseconds) => {clock += milliseconds;}, listeners, saved: () => persisted};
}
test("local metrics store only bounded allowlisted numeric aggregates", () => {
  const h = harness();
  assert.equal(h.api.start("고객명 010-1234-5678"), null);
  const token = h.api.start("search"); h.advance(42); h.api.finish(token); h.api.finish(token);
  h.api.markFirstData(); h.api.markFirstData();
  h.api.error("https://private.example/listing/123?token=secret");
  h.api.error("storage");
  const result = h.api.snapshot();
  assert.equal(result.durations.search.count, 1);
  assert.equal(result.durations.search.last, 42);
  assert.equal(result.durations.firstData.count, 1);
  assert.equal(result.errors.storage, 1);
  assert.doesNotMatch(h.saved(), /고객|010|https|secret|token|account|propertyId/);
  assert.doesNotMatch(source, /fetch\(|sendBeacon|XMLHttpRequest/);
});
test("restoring metrics strips unknown keys and event messages", () => {
  const h = harness(JSON.stringify({version: 1, account: "private@example.com", durations: {
    search: {count: 2, total: 20, last: 10, max: 10, query: "private query"}, privateField: {count: 2}
  }, errors: {runtime: 2, secret: 100}}));
  h.listeners.error({message: "private message", target: {src: "https://secret.example"}});
  h.listeners.unhandledrejection({reason: new Error("private memo")});
  assert.equal(h.api.snapshot().errors.runtime, 3);
  assert.equal(h.api.snapshot().errors.resource, 1);
  assert.doesNotMatch(h.saved(), /private|secret|example|query|account/);
  h.api.reset();
  assert.deepEqual(JSON.parse(h.saved()), {version: 1, durations: {}, errors: {}});
});
