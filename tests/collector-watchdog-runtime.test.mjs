import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const background = read("edge-automation/extension/background.js");
const naver = read("js/naver-collector.js");
const RUN = "jsAutoCollectorRunStateV2";
const REPORT = "jsAutoCollectorRunReportV1";
const CONFIG = "jsAutoCollectorConfigV1";
const LOG = "jsAutoCollectorLogsV1";
const minute = 60000;
const clock = Date.parse("2026-08-27T07:00:00Z");

function harness(overrides = {}) {
  const targets = ["유성구", "대덕구", "중구", "서구", "동구"].map((label, index) => ({
    key: "naver-" + index, source: "naver", label,
    url: "https://fin.land.naver.com/map?test=" + index, enabled: true
  }));
  const state = { active: true, runId: "cycle", targets, index: 3, currentTabId: 42,
    targetRunId: "seo", targetStartedAt: clock - 100 * minute,
    runtimeStartedAt: clock - 100 * minute, phase: "collecting", targetAttempt: 1,
    startedAt: clock - 140 * minute, retryQueue: [],
    summary: { completed: 3, failed: 0, errors: [] }, ...overrides };
  const data = {
    [RUN]: state, [CONFIG]: { enabled: true, targets, schedule: "11:00" },
    [REPORT]: { runId: "cycle", active: true, items: targets.map((target, i) => ({
      key: target.key, status: i < 3 ? "completed" : i === 3 ? "running" : "pending",
      startedAt: i === 3 ? clock - 100 * minute : null
    })) }
  };
  const events = {};
  const alarmMap = new Map();
  const navigation = [];
  const event = (name) => ({ addListener(fn) { events[name] = fn; } });
  class FakeDate extends Date { static now() { return clock; } }
  const context = vm.createContext({ console, Date: FakeDate, URL, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    chrome: {
      storage: { local: {
        async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]))); },
        async set(value) { Object.assign(data, structuredClone(value)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
      } },
      alarms: { async get(k) { return alarmMap.get(k); }, async clear(k) { alarmMap.delete(k); },
        create(k, value) { alarmMap.set(k, value); }, onAlarm: event("alarm") },
      tabs: { async get(id) { return { id, status: "complete" }; },
        async update(id, options) { navigation.push(options.url); return { id, status: "complete" }; },
        async create(options) { navigation.push(options.url); return { id: 43, status: "complete" }; },
        async remove() {}, async sendMessage() { return { started: true }; }, onRemoved: event("removed") },
      runtime: { getManifest: () => ({ version: "1.1.1" }), onMessage: event("message"),
        onStartup: event("startup"), onInstalled: event("installed") },
      notifications: { create: async () => {} }
    }
  });
  vm.runInContext(background, context);
  const dispatch = (message, tabId = 42) => new Promise(resolve => events.message(message, { tab: { id: tabId } }, resolve));
  const flush = async () => { await vm.runInContext("mutationQueue", context); await new Promise(resolve => setImmediate(resolve)); };
  return { context, data, navigation, alarmMap, dispatch, flush };
}

test("90-minute stalled Seo defers only Seo, keeps completed regions and starts Dong", async () => {
  const h = harness();
  await h.context.recoverAutomaticRun();
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].summary.completed, 3);
  assert.equal(h.data[RUN].retryQueue[0].label, "서구");
  assert.equal(h.navigation.length, 1);
  assert.match(h.navigation[0], /test=4$/);
  assert.equal(h.data[REPORT].items[3].status, "retry_wait");
  assert.equal(h.data[REPORT].items[0].status, "completed");
});

test("missing legacy timestamps use report time instead of resetting the deadline to now", async () => {
  const h = harness({ targetStartedAt: null, runtimeStartedAt: null });
  await h.context.recoverAutomaticRun();
  assert.equal(h.data[RUN].index, 4);
});

for (const phase of ["between-targets", "retrying", "resuming", "starting", "unknown-old-phase"]) {
  test(`an orphaned ${phase} transition recovers the unfinished region`, async () => {
    const h = harness({ phase, targetRunId: null, currentTabId: null, targetStartedAt: null });
    await h.context.recoverAutomaticRun();
    assert.equal(h.data[RUN].index, 3);
    assert.equal(h.data[RUN].summary.completed, 3);
    assert.equal(h.data[RUN].phase, "collecting");
    assert.match(h.navigation[0], /test=3$/);
  });
}

test("healthy collection and scheduled retry waits are not restarted", async () => {
  for (const extra of [
    { targetStartedAt: clock - minute, lastHeartbeatAt: clock, lastProgressAt: clock },
    { phase: "retry-wait", retryAt: clock + 10 * minute },
    { phase: "between-targets", phaseEnteredAt: clock }
  ]) {
    const h = harness(extra);
    await h.context.recoverAutomaticRun();
    assert.equal(h.navigation.length, 0);
  }
});

test("concurrent duplicate completion/old heartbeat cannot advance twice or restore Seo", async () => {
  const h = harness({ targetStartedAt: clock, lastHeartbeatAt: clock, lastProgressAt: clock });
  const finished = { type: "JS_AUTO_TARGET_FINISHED", runId: "cycle", targetRunId: "seo", ok: true, result: {} };
  await Promise.all([
    h.dispatch(finished),
    h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo", progressFingerprint: "old" }),
    h.dispatch(finished)
  ]);
  await h.flush();
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].summary.completed, 4);
  assert.notEqual(h.data[RUN].targetRunId, "seo");
  assert.equal(h.navigation.length, 1);
});

test("status polling repairs missing watchdog and detects a stuck run without restarting all", async () => {
  const h = harness();
  const response = await h.dispatch({ type: "JS_AUTO_GET_STATE" });
  await h.flush();
  assert.equal(response.backgroundBuild, "1.1.1");
  assert.equal(h.alarmMap.get("js-auto-collector-watchdog").periodInMinutes, 5);
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].summary.completed, 3);
});

test("manual Run now checks a stale active run instead of just reporting already running", async () => {
  const h = harness();
  const response = await h.dispatch({ type: "JS_AUTO_RUN_NOW" });
  assert.equal(response.resumed, true);
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.navigation.length, 1);
});

test("content timeout at 90 minutes defers Seo instead of spending another 90 minutes on it", async () => {
  const h = harness();
  await h.dispatch({ type: "JS_AUTO_TARGET_FINISHED", runId: "cycle", targetRunId: "seo",
    ok: false, message: "자동수집 제한시간을 초과했습니다." });
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].retryQueue[0].label, "서구");
});

test("an unresponsive start-message channel cannot block all future recovery events", async () => {
  const h = harness();
  let attempts = 0;
  h.context.chrome.tabs.sendMessage = () => { attempts++; return new Promise(() => {}); };
  await assert.rejects(h.context.sendRunMessage(42, {}, "target", "cycle"), /40초/);
  assert.equal(attempts, 3);
});

test("background transition errors are recorded rather than silently swallowed", async () => {
  const h = harness();
  h.context.recoverAutomaticRun = async () => { throw new Error("test recovery failure"); };
  await h.dispatch({ type: "JS_AUTO_GET_STATE" });
  await h.flush();
  assert.match(h.data[LOG][0].message, /test recovery failure/);
});

function naverFunction(name, next) {
  return naver.slice(naver.indexOf("  async function " + name) >= 0 ? naver.indexOf("  async function " + name) :
    naver.indexOf("  function " + name), naver.indexOf("  function " + next));
}

test("Naver body download (not just headers) stays within the abort deadline", { timeout: 2000 }, async () => {
  let attempts = 0;
  const context = vm.createContext({ AbortController, NAVER_LIST_REQUEST_TIMEOUT_MS: 60000,
    setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {}, delay: async () => {},
    nativeFetch: async (_url, options) => {
      attempts++;
      return { ok: true, status: 200, url: "https://fin.land.naver.com/test", text: () => new Promise((resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted body"), { name: "AbortError" }));
        if (options.signal.aborted) fail(); else options.signal.addEventListener("abort", fail, { once: true });
      }) };
    }
  });
  vm.runInContext(naverFunction("fetchPageWithRetry", "clean("), context);
  await assert.rejects(context.fetchPageWithRetry("test", {}, 3), /60초/);
  assert.equal(attempts, 3);
});

test("Naver successful bounded response retains json/status/url expected by callers", async () => {
  const context = vm.createContext({ AbortController, NAVER_LIST_REQUEST_TIMEOUT_MS: 60000,
    setTimeout, clearTimeout, delay: async () => {},
    nativeFetch: async () => ({ ok: true, status: 200, url: "test", text: async () => '{"items":[1]}' }) });
  vm.runInContext(naverFunction("fetchPageWithRetry", "clean("), context);
  const response = await context.fetchPageWithRetry("test", {}, 3);
  assert.equal(response.status, 200);
  assert.equal(response.url, "test");
  assert.equal((await response.json()).items[0], 1);
});

test("late passive Naver responses do not overwrite automatic preparation or saving", () => {
  const context = vm.createContext({ state: { active: true, collectingSelection: true, busy: false },
    articleList() { throw new Error("capture reached"); } });
  vm.runInContext(naverFunction("capturePayload", "showCapture"), context);
  assert.equal(context.capturePayload({}, "test"), false);
  context.state.collectingSelection = false;
  context.state.busy = true;
  assert.equal(context.capturePayload({}, "test"), false);
  context.state.busy = false;
  context.state.preparing = true;
  assert.throws(() => context.capturePayload({}, "test"), /capture reached/, "manual cluster switching still allowed");
});

test("automatic Naver listing discovery proceeds to saving and releases its capture guard", async () => {
  for (const fail of [false, true]) {
    let saved = 0;
    const state = { selectedDistrict: { name: "서구", cortarNo: "3017000000" } };
    const context = vm.createContext({ state, clearAutoDistrictProgress() {}, beginCollectorRun() {},
      finishCollectorRun() {}, saveButton: {}, retryButton: {}, cityButton: {},
      createEmptyDashboard: () => ({}), updateDashboard() {}, setStatus() {},
      collectFinDistrictRaw: async () => {
        assert.equal(state.collectingSelection, true);
        if (fail) throw new Error("test request timeout");
        return [{ articleNo: "sample" }];
      },
      collectAndSave: async items => { saved += items.length; return { ok: true, complete: true }; }
    });
    const start = naver.indexOf("  async function collectFinSelectedAndSave(");
    const end = naver.indexOf("  async function collectFinAutomaticDistrict(", start);
    vm.runInContext(naver.slice(start, end), context);
    const result = await context.collectFinSelectedAndSave({ automatic: true });
    assert.equal(result.ok, !fail);
    assert.equal(saved, fail ? 0 : 1);
    assert.equal(state.collectingSelection, false);
  }
});
