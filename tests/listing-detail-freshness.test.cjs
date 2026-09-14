const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/unified-listings-v8.js", "utf8");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  let now = 1_000_000;
  const events = {}, calls = [], renders = [];
  const window = {
    innerWidth: 1200,
    addEventListener(name, callback) { events[name] = callback; },
    JSDataAccessV6: { read(action, params) {
      const call = { action, params, ...deferred() };
      calls.push(call);
      return call.promise;
    } },
    __render(...args) { renders.push(args); }
  };
  const body = { scrollTop: 125, querySelector() { return null; }, contains() { return false; } };
  const document = { activeElement: null, addEventListener() {}, getElementById(id) {
    return id === "unifiedDetailBodyV8" ? body : null;
  } };
  const instrumented = source.replace("global.JSUnifiedListingsV8 = {", `
    global.__test = { state: state, loadDetail: loadDetail, invalidateDetails: invalidateDetails,
      detailIsFresh: detailIsFresh, refreshOpenDetail: refreshOpenDetail };
    renderDetail = global.__render;
    global.JSUnifiedListingsV8 = {`);
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(instrumented, { window, document, console: { warn() {}, error() {} }, Date: Clock });
  return { api: window.JSUnifiedListingsV8, ...window.__test, calls, renders, events, document, body,
    advance(ms) { now += ms; } };
}
function result(id, memo = "new") { return { ok: true, originals: [{ originalId: id, source: "네이버", memo }] }; }

test("detail cache reuses fresh results, expires in five minutes and deduplicates refresh", async () => {
  const h = harness();
  const first = h.loadDetail("p1");
  assert.equal(h.loadDetail("p1"), first);
  h.calls[0].resolve(result("o1"));
  const originals = await first;
  assert.equal(await h.loadDetail("p1"), originals);
  assert.equal(h.calls.length, 1);
  h.advance(300_001);
  assert.equal(h.detailIsFresh("p1"), false);
  const refresh = h.loadDetail("p1");
  assert.equal(h.state.detailCache.p1, originals, "stale content stays available during refresh");
  assert.equal(h.loadDetail("p1"), refresh);
  h.calls[1].resolve(result("o1", "updated"));
  assert.equal((await refresh)[0].memo, "updated");
});

test("failed and malformed refreshes preserve the last good detail and back off", async () => {
  const h = harness();
  let request = h.loadDetail("p1");
  h.calls[0].resolve(result("o1", "saved"));
  await request;
  h.advance(300_001);
  request = h.loadDetail("p1");
  h.calls[1].resolve({ ok: false, message: "unavailable" });
  await assert.rejects(request, /unavailable/);
  assert.equal((await h.loadDetail("p1"))[0].memo, "saved");
  assert.equal(h.calls.length, 2);
  h.advance(30_001);
  request = h.loadDetail("p1");
  h.calls[2].reject(new Error("offline"));
  await assert.rejects(request, /offline/);
  assert.equal(h.state.detailCache.p1[0].memo, "saved");
  assert.equal(h.state.detailPending.p1, undefined);
});

test("an invalidated old request cannot repopulate cache or delete a newer pending request", async () => {
  const h = harness();
  const old = h.loadDetail("p1");
  h.invalidateDetails();
  const latest = h.loadDetail("p1");
  h.calls[0].resolve(result("old"));
  await old;
  assert.equal(h.state.detailCache.p1, undefined);
  assert.equal(h.state.detailPending.p1, latest);
  h.calls[1].resolve(result("latest"));
  await latest;
  assert.equal(h.state.detailCache.p1[0].originalId, "latest");
});

test("opening a stale card shows it immediately and updates only the same open card", async () => {
  const h = harness();
  let request = h.loadDetail("p1");
  h.calls[0].resolve(result("o1", "saved"));
  await request;
  h.advance(300_001);
  request = h.api.open("p1", "o1");
  assert.equal(h.renders[0][1][0].memo, "saved");
  h.calls[1].resolve(result("o1", "refreshed"));
  await request;
  assert.equal(h.renders[1][1][0].memo, "refreshed");
  assert.equal(h.body.scrollTop, 125);
  h.advance(300_001);
  request = h.api.open("p1", "o1");
  const renderCount = h.renders.length;
  h.state.openPropertyId = "different";
  h.calls[2].resolve(result("o1", "must not show"));
  await request;
  assert.equal(h.renders.length, renderCount);
});

test("complete initial images do not suppress freshness checks and edits are not overwritten", async () => {
  const h = harness();
  h.state.groups.p1 = [{ originalId: "o1", images: ["photo"], photoCount: 1 }];
  const request = h.api.open("p1", "o1");
  assert.equal(h.calls.length, 1);
  h.document.activeElement = { tagName: "INPUT" };
  h.body.contains = () => true;
  h.calls[0].resolve(result("o1"));
  await request;
  assert.equal(h.renders.length, 1);
  assert.equal(h.state.detailCache.p1[0].memo, "new");
});

test("successful listing mutations invalidate cached detail; unrelated actions do not", async () => {
  const h = harness();
  const request = h.loadDetail("p1");
  h.calls[0].resolve(result("o1"));
  await request;
  h.events["js-async-mutation-finished"]({ detail: { ok: true, action: "saveFavorites" } });
  assert.equal(h.detailIsFresh("p1"), true);
  h.events["js-async-mutation-finished"]({ detail: { ok: true, action: "updateProperty" } });
  assert.equal(h.detailIsFresh("p1"), false);
});
