import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "edge-automation/extension/background.js"), "utf8");

function tabRuntime() {
  const cleanSourceStart = source.indexOf("function cleanSource");
  const cleanSourceEnd = source.indexOf("async function finishCurrentTarget", cleanSourceStart);
  const providerStart = source.indexOf("function providerSourceFromUrl");
  const providerEnd = source.indexOf("async function launchCurrentTarget", providerStart);
  assert.ok(cleanSourceStart >= 0 && cleanSourceEnd > cleanSourceStart);
  assert.ok(providerStart >= 0 && providerEnd > providerStart);
  return source.slice(cleanSourceStart, cleanSourceEnd) + "\n" + source.slice(providerStart, providerEnd);
}

function createRuntime(initialTabs, failUpdateId = null) {
  let tabs = initialTabs.map((tab) => ({ ...tab }));
  const removed = [];
  const updated = [];
  const created = [];
  const chrome = {
    tabs: {
      async query() { return tabs.map((tab) => ({ ...tab })); },
      async get(id) {
        const tab = tabs.find((candidate) => candidate.id === id);
        if (!tab) throw new Error("missing tab");
        return { ...tab };
      },
      async remove(id) {
        removed.push(id);
        tabs = tabs.filter((tab) => tab.id !== id);
      },
      async update(id, values) {
        updated.push({ id, ...values });
        if (id === failUpdateId) throw new Error("tab closed");
        const tab = tabs.find((candidate) => candidate.id === id);
        if (!tab) throw new Error("missing tab");
        Object.assign(tab, values);
        return { ...tab };
      },
      async create(values) {
        const tab = { id: 100 + created.length, ...values };
        created.push({ ...tab });
        tabs.push(tab);
        return { ...tab };
      }
    }
  };
  const context = { chrome, URL, console, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(tabRuntime(), context);
  return { context, removed, updated, created, tabs: () => tabs.map((tab) => ({ ...tab })) };
}

test("a new Naver run reuses one Naver tab and closes every stale provider duplicate", async () => {
  const runtime = createRuntime([
    { id: 1, url: "https://fin.land.naver.com/map?old=1" },
    { id: 2, url: "https://fin.land.naver.com/map?old=2" },
    { id: 3, url: "chrome-extension://collector/options.html" },
    { id: 4, url: "https://realty.daangn.com/" }
  ]);
  const target = { source: "naver", url: "https://fin.land.naver.com/map?district=west" };

  const tab = await runtime.context.acquireSingleProviderTab(target);

  assert.equal(tab.id, 1);
  assert.deepEqual(runtime.removed.sort((a, b) => a - b), [2, 4]);
  assert.deepEqual(runtime.updated, [{ id: 1, url: target.url, active: false }]);
  assert.equal(runtime.created.length, 0);
  assert.deepEqual(runtime.tabs().map((entry) => entry.id).sort((a, b) => a - b), [1, 3]);
});

test("district transitions keep the active collector tab even when the provider changes", async () => {
  const runtime = createRuntime([
    { id: 7, url: "https://fin.land.naver.com/map?stale=1" },
    { id: 8, url: "https://fin.land.naver.com/map?stale=2" },
    { id: 9, url: "edge://newtab/" }
  ]);
  const target = { source: "naver", url: "https://fin.land.naver.com/map?district=east" };

  const tab = await runtime.context.acquireSingleProviderTab(target, 9);

  assert.equal(tab.id, 9);
  assert.deepEqual(runtime.removed.sort((a, b) => a - b), [7, 8]);
  assert.deepEqual(runtime.updated, [{ id: 9, url: target.url, active: false }]);
  assert.equal(runtime.created.length, 0);
});

test("a provider pending URL is reused even while its visible URL is still about:blank", async () => {
  const runtime = createRuntime([
    { id: 31, url: "about:blank", pendingUrl: "https://fin.land.naver.com/map?loading=1" },
    { id: 32, url: "https://fin.land.naver.com/map?stale=1" }
  ]);
  const target = { source: "naver", url: "https://fin.land.naver.com/map?district=yuseong" };

  const tab = await runtime.context.acquireSingleProviderTab(target);

  assert.equal(tab.id, 31);
  assert.deepEqual(runtime.removed, [32]);
  assert.deepEqual(runtime.updated, [{ id: 31, url: target.url, active: false }]);
  assert.equal(runtime.created.length, 0);
});

test("a vanished reusable tab falls back to one fresh provider tab", async () => {
  const runtime = createRuntime([
    { id: 21, url: "https://fin.land.naver.com/map?stale=1" },
    { id: 22, pendingUrl: "https://new.land.naver.com/offices" }
  ], 21);
  const target = { source: "naver", url: "https://fin.land.naver.com/map?district=center" };

  const tab = await runtime.context.acquireSingleProviderTab(target);

  assert.equal(tab.id, 100);
  assert.deepEqual(runtime.removed.sort((a, b) => a - b), [21, 22]);
  assert.equal(runtime.created.length, 1);
  assert.equal(runtime.created[0].url, target.url);
});
