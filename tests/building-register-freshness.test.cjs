const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/building-register-v6.js", "utf8");
function harness() {
  let now = 20 * 86_400_000;
  const storage = new Map(), calls = [], rendered = [];
  const window = { __request(...args) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ args, resolve, reject });
    return promise;
  }, __render(data) { rendered.push(data); } };
  const instrumented = source.replace("window.JSBuildingRegisterDiagnosticsV652 = {", `
    requestRegister = window.__request;
    render = function() { window.__render(state.data); };
    applyRegisterData = function(data, token, save) {
      if (token !== state.requestToken) return null;
      state.data = data;
      if (save) writeCache(state.parcel, data);
      render();
      return data;
    };
    window.__test = { state: state, readCache: readCache, writeCache: writeCache,
      fetchRegister: fetchRegister, refreshCachedRegister: refreshCachedRegister,
      shouldRevalidateRegister: shouldRevalidateRegister, requestUrl: requestUrl };
    window.JSBuildingRegisterDiagnosticsV652 = {`);
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(instrumented, { window, setTimeout() {}, clearTimeout() {},
    saveApiURL: "/api/apps-script", Date: Clock, console: { warn() {} },
    document: { getElementById() { return null; } },
    localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } }
  });
  const api = window.__test;
  api.state.parcel = { sigunguCd: "30140", bjdongCd: "10200", platGbCd: "0", bun: "0012", ji: "0003" };
  api.state.item = { propertyId: "p1" };
  api.state.requestToken = 1;
  return { ...api, calls, rendered, storage, advance(ms) { now += ms; } };
}
function result(label) { return { ok: true, version: 11, label, buildings: [], units: [] }; }

test("register cache is immediate and only revalidates after one day", async () => {
  const h = harness();
  h.writeCache(h.state.parcel, result("saved"));
  await h.fetchRegister(false);
  assert.equal(h.rendered[0].label, "saved");
  assert.equal(h.calls.length, 0);
  h.advance(86_400_001);
  const request = h.fetchRegister(false);
  assert.equal(h.rendered.at(-1).label, "saved");
  assert.deepEqual(h.calls[0].args, [false, "full", true]);
  h.calls[0].resolve(result("new"));
  await request;
  assert.equal(h.state.data.label, "new");
  assert.equal(h.readCache(h.state.parcel).label, "new");
  await h.fetchRegister(false);
  assert.equal(h.calls.length, 1);
});

test("failed or incomplete background refresh keeps cached register and has a retry cooldown", async () => {
  const h = harness();
  h.writeCache(h.state.parcel, result("saved"));
  h.advance(86_400_001);
  let request = h.fetchRegister(false);
  h.calls[0].reject(new Error("offline"));
  await request;
  assert.equal(h.state.data.label, "saved");
  await h.fetchRegister(false);
  assert.equal(h.calls.length, 1);
  h.advance(900_001);
  request = h.fetchRegister(false);
  h.calls[1].resolve({ ...result("incomplete"), incomplete: true });
  await request;
  assert.equal(h.readCache(h.state.parcel).label, "saved");
  assert.equal(h.state.data.label, "saved");
});

test("reopening the same parcel shares a request and results never replace a different parcel", async () => {
  const h = harness();
  h.writeCache(h.state.parcel, result("saved"));
  h.advance(86_400_001);
  const first = h.fetchRegister(false);
  h.state.requestToken += 1;
  const second = h.fetchRegister(false);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve(result("shared"));
  await Promise.all([first, second]);
  assert.equal(h.state.data.label, "shared");
  h.advance(86_400_001);
  const pending = h.fetchRegister(false);
  h.state.parcel = { ...h.state.parcel, ji: "0009" };
  h.state.data = result("other parcel");
  h.calls[1].resolve(result("do not show"));
  await pending;
  assert.equal(h.state.data.label, "other parcel");
});

test("background refresh uses conditional server revalidation, not an unrestricted force call", () => {
  const h = harness();
  const conditional = h.requestUrl(false, "full", true);
  assert.match(conditional, /revalidate=1/);
  assert.doesNotMatch(conditional, /force=1/);
  assert.match(h.requestUrl(true, "full", true), /force=1/);
});

test("a late background response cannot overwrite a newer forced refresh in local storage", async () => {
  const h = harness();
  h.writeCache(h.state.parcel, result("saved"));
  h.advance(86_400_001);
  const background = h.fetchRegister(false);
  const forced = h.fetchRegister(true);
  assert.deepEqual(h.calls[1].args, [true, "full"]);
  h.calls[1].resolve(result("forced latest"));
  await forced;
  h.calls[0].resolve(result("older background"));
  await background;
  assert.equal(h.state.data.label, "forced latest");
  assert.equal(h.readCache(h.state.parcel).label, "forced latest");
});
