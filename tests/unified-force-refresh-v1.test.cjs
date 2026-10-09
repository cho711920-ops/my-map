const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {test} = require("node:test");

test("unified list adds reload headers only for an explicitly forced refresh", async () => {
  const calls = [];
  const window = {innerWidth: 1280, addEventListener() {}, JSDataAccessV6: {
    read(action, params, options) {
      calls.push({action, params, options});
      return Promise.resolve({ok: true, groups: {}, snapshotRevision: "fixture-revision-" + calls.length});
    }
  }};
  const context = {window, console: {error() {}, warn() {}}, URLSearchParams, document: {getElementById() {return null;}}};
  vm.runInNewContext(fs.readFileSync("js/unified-listings-v8.js", "utf8"), context);
  const first = await window.JSUnifiedListingsV8.load();
  assert.equal(first.snapshotRevision, "fixture-revision-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "unifiedListings");
  assert.equal(Object.hasOwn(calls[0].options, "cache"), false);
  assert.equal(Object.hasOwn(calls[0].options, "headers"), false);
  const cached = await window.JSUnifiedListingsV8.load();
  assert.equal(cached.snapshotRevision, "fixture-revision-1");
  assert.equal(calls.length, 1, "loaded normal state does not add a request");
  await window.JSUnifiedListingsV8.load(true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.cache, "reload");
  assert.equal(calls[1].options.headers["X-JS-Force-Refresh"], "1");
  const updated = await window.JSUnifiedListingsV8.load();
  assert.equal(updated.snapshotRevision, "fixture-revision-2");
  window.JSDataAccessV6.read = () => Promise.reject(new Error("fixture temporary failure"));
  const stale = await window.JSUnifiedListingsV8.load(true);
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.snapshotRevision, "fixture-revision-2");
});
