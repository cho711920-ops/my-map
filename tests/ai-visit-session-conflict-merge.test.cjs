const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync("js/ai-visit-session-v6.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`could not extract ${name}`);
}

function loadMergeFunctions() {
  const context = { Date, JSON, Object };
  vm.createContext(context);
  vm.runInContext([
    extractFunction("sameSession"),
    extractFunction("sameSessionGeneration"),
    extractFunction("sessionTime"),
    extractFunction("selectNewerSessionGeneration"),
    extractFunction("mergeSessionStatuses"),
    extractFunction("mergeSessionMaps")
  ].join("\n"), context);
  return context;
}

function memoryStorage(initial = {}) {
  const values = initial instanceof Map ? initial : new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    key(index) { return Array.from(values.keys())[index] || null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
    has(key) { return values.has(key); }
  };
}

function createCloudSaveHarness(outcomes, options = {}) {
  let nextTimerId = 1;
  let latestSessions = {};
  const timers = new Map();
  const snapshots = [];
  const alerts = [];
  const localStorage = options.localStorage || memoryStorage();
  const accountEmail = options.accountEmail || "agent@example.com";
  const context = {
    Date,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    alert(message) { alerts.push(String(message)); },
    console: { warn() {} },
    localStorage,
    window: {
      JSAuthenticatedAccountEmail: accountEmail,
      clearTimeout(timerId) {
        timers.delete(timerId);
      },
      setTimeout(callback, delay) {
        const timerId = nextTimerId++;
        timers.set(timerId, { callback, delay });
        return timerId;
      }
    },
    loadSessionMap() {
      return latestSessions;
    },
    writeDeviceSessionCache(sessions) {
      latestSessions = JSON.parse(JSON.stringify(sessions || {}));
    },
    clearDeviceSessionCache() {
      latestSessions = {};
    },
    readAiVisitData() {
      assert.ok(options.remoteResult, "a deterministic cloud load must be configured");
      return Promise.resolve(options.remoteResult);
    },
    persistCloudSessionSnapshot(snapshot) {
      snapshots.push(JSON.parse(JSON.stringify(snapshot)));
      const outcome = outcomes.shift();
      assert.equal(typeof outcome, "function", "a deterministic save outcome must be queued");
      return outcome();
    }
  };
  vm.createContext(context);
  vm.runInContext([
    'var DIRTY_SESSION_KEY_PREFIX = "js_ai_visit_cloud_dirty_v1::";',
    "var cloudSessionAccountEmail = String(window.JSAuthenticatedAccountEmail || '').trim().toLowerCase();",
    `var cloudSessionReady = ${options.ready === false ? "false" : "true"};`,
    "var cloudSessionLoading = null;",
    "var cloudSessionSaveTimer = 0;",
    "var cloudSessionRetryTimer = 0;",
    "var cloudSessionSaveInFlight = false;",
    "var cloudSessionDirty = false;",
    "var cloudSessionRetryAttempt = 0;",
    "var cloudSessionAccountChanged = false;",
    "var cloudSessionAccountChangedWarningShown = false;",
    `var cloudSessionVersion = ${Math.max(0, Number(options.version) || 0)};`,
    `var cloudSessionBase = ${JSON.stringify(options.base || {})};`,
    "var dirtySessionWarningShown = false;",
    extractFunction("copySessionMap"),
    extractFunction("cloudSessionDirtyStorageKey"),
    extractFunction("sanitizeSessionMapForDurableStorage"),
    extractFunction("readCloudSessionDirtyEnvelope"),
    extractFunction("writeCloudSessionDirtyEnvelope"),
    extractFunction("clearCloudSessionDirtyEnvelope"),
    extractFunction("isCloudAccountChangedError"),
    extractFunction("stopCloudSessionSyncForAccountChange"),
    extractFunction("sameSession"),
    extractFunction("sameSessionGeneration"),
    extractFunction("sessionTime"),
    extractFunction("selectNewerSessionGeneration"),
    extractFunction("mergeSessionStatuses"),
    extractFunction("mergeSessionMaps"),
    extractFunction("clearCloudSessionRetry"),
    extractFunction("scheduleCloudSessionRetry"),
    extractFunction("flushCloudSessionSave"),
    extractFunction("scheduleCloudSessionSave"),
    extractFunction("syncSessionMapFromCloud")
  ].join("\n"), context);

  return {
    context,
    localStorage,
    alerts,
    snapshots,
    setLatest(sessions) {
      latestSessions = sessions;
    },
    schedule() {
      context.scheduleCloudSessionSave(latestSessions);
    },
    async boot() {
      await context.syncSessionMapFromCloud();
      return latestSessions;
    },
    latest() {
      return latestSessions;
    },
    pendingDelays() {
      return Array.from(timers.values(), (timer) => timer.delay);
    },
    async runOnlyTimer() {
      assert.equal(timers.size, 1, "exactly one save/retry timer should be pending");
      const [timerId, timer] = timers.entries().next().value;
      timers.delete(timerId);
      await timer.callback();
    }
  };
}

function rejectedSave(status) {
  return () => Promise.reject(Object.assign(new Error(`save failed: ${status}`), { status }));
}

function rejectedAccountChange() {
  return () => Promise.reject(Object.assign(new Error("account changed"), {
    status: 409,
    payload: { code: "account_changed", message: "reload required" }
  }));
}

function successfulSave(version = 1) {
  return () => Promise.resolve({ ok: true, version });
}

function session(updatedAt, statuses, extra = {}) {
  return {
    active: true,
    listId: "visit-list-1",
    listName: "오늘 임장",
    itemKeys: ["local", "remote", "local-unhold", "remote-unhold", "conflict", "stable"],
    currentIndex: 0,
    statuses,
    updatedAt,
    ...extra
  };
}

test("AI visit status conflicts merge per listing and preserve unhold deletions", () => {
  const { mergeSessionMaps } = loadMergeFunctions();
  const base = session("2026-09-10T00:00:00Z", {
    "local-unhold": "hold",
    "remote-unhold": "hold",
    conflict: "hold",
    stable: "done"
  }, { currentIndex: 0, routeOptimized: false });
  const local = session("2026-09-10T00:02:00Z", {
    local: "done",
    "remote-unhold": "hold",
    conflict: "done",
    stable: "done"
  }, { currentIndex: 2, routeOptimized: false });
  const remote = session("2026-09-10T00:03:00Z", {
    remote: "hold",
    "local-unhold": "hold",
    stable: "done"
  }, { currentIndex: 4, routeOptimized: true });

  const result = mergeSessionMaps(
    { "visit-list-1": remote },
    { "visit-list-1": local },
    { "visit-list-1": base }
  )["visit-list-1"];

  // Non-status fields keep the existing session-level last-write-wins rule.
  assert.equal(result.currentIndex, 4);
  assert.equal(result.routeOptimized, true);
  assert.equal(result.updatedAt, remote.updatedAt);
  // Independent changes from both devices survive.
  assert.equal(result.statuses.local, "done");
  assert.equal(result.statuses.remote, "hold");
  assert.equal(result.statuses.stable, "done");
  // Removing hold on either device is a real key deletion and is not resurrected.
  assert.equal(Object.hasOwn(result.statuses, "local-unhold"), false);
  assert.equal(Object.hasOwn(result.statuses, "remote-unhold"), false);
  // Both devices changed this key differently; the newer remote session wins its deletion.
  assert.equal(Object.hasOwn(result.statuses, "conflict"), false);
});

test("same-listing status conflicts choose the newer local session when local is newer", () => {
  const { mergeSessionMaps } = loadMergeFunctions();
  const base = session("2026-09-10T00:00:00Z", { conflict: "hold" });
  const local = session("2026-09-10T00:04:00Z", { conflict: "done" }, { currentIndex: 2 });
  const remote = session("2026-09-10T00:03:00Z", {}, { currentIndex: 4 });

  const result = mergeSessionMaps(
    { "visit-list-1": remote },
    { "visit-list-1": local },
    { "visit-list-1": base }
  )["visit-list-1"];
  assert.equal(result.currentIndex, 2);
  assert.equal(result.statuses.conflict, "done");
});

test("deletion only removes the base session generation and preserves a restarted session", () => {
  const { mergeSessionMaps } = loadMergeFunctions();
  const base = session("2026-09-10T00:01:00Z", {}, {
    startedAt: "2026-09-10T00:00:00Z"
  });
  const restartedLocal = session("2026-09-10T00:03:00Z", { local: "done" }, {
    startedAt: "2026-09-10T00:02:00Z"
  });
  const restartedRemote = session("2026-09-10T00:04:00Z", { remote: "hold" }, {
    startedAt: "2026-09-10T00:03:00Z"
  });

  const remoteDeleted = mergeSessionMaps(
    {},
    { "visit-list-1": restartedLocal },
    { "visit-list-1": base }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(remoteDeleted["visit-list-1"])), restartedLocal);

  const localDeleted = mergeSessionMaps(
    { "visit-list-1": restartedRemote },
    {},
    { "visit-list-1": base }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(localDeleted["visit-list-1"])), restartedRemote);

  const staleSameGeneration = session("2026-09-10T00:05:00Z", { stale: "done" }, {
    startedAt: base.startedAt
  });
  const sameGenerationDeleted = mergeSessionMaps(
    {},
    { "visit-list-1": staleSameGeneration },
    { "visit-list-1": base }
  );
  assert.equal(Object.hasOwn(sameGenerationDeleted, "visit-list-1"), false);
});

test("concurrent restarts select the newer generation without mixing listings or statuses", () => {
  const { mergeSessionMaps } = loadMergeFunctions();
  const base = session("2026-09-10T00:01:00Z", { old: "hold" }, {
    startedAt: "2026-09-10T00:00:00Z",
    itemKeys: ["old"]
  });
  const localRestart = session("2026-09-10T00:10:00Z", { local: "done" }, {
    startedAt: "2026-09-10T00:02:00Z",
    itemKeys: ["local-only"],
    originalItemKeys: ["local-only"],
    currentIndex: 0,
    routeOptimized: false
  });
  const remoteRestart = session("2026-09-10T00:04:00Z", { remote: "hold" }, {
    startedAt: "2026-09-10T00:03:00Z",
    itemKeys: ["remote-only"],
    originalItemKeys: ["remote-only"],
    currentIndex: 0,
    routeOptimized: true
  });

  const result = mergeSessionMaps(
    { "visit-list-1": remoteRestart },
    { "visit-list-1": localRestart },
    { "visit-list-1": base }
  )["visit-list-1"];

  // The newer restart wins even though the older local generation has a later edit.
  assert.deepEqual(JSON.parse(JSON.stringify(result)), remoteRestart);
  assert.deepEqual(result.itemKeys, ["remote-only"]);
  assert.deepEqual(result.statuses, { remote: "hold" });
  assert.equal(Object.hasOwn(result.statuses, "local"), false);
});

test("a failed save survives a new page, merges with cloud, and clears only after acknowledgement", async () => {
  const accountEmail = "agent@example.com";
  const dirtyKey = `js_ai_visit_cloud_dirty_v1::${encodeURIComponent(accountEmail)}`;
  const localStorage = memoryStorage();
  const baseVisit = session("2026-09-10T00:01:00Z", { stable: "done" }, {
    startedAt: "2026-09-10T00:00:00Z",
    itemKeys: ["stable", "local", "remote"],
    routeStartLocation: { lat: 36.35, lng: 127.38 }
  });
  const localVisit = session("2026-09-10T00:02:00Z", {
    stable: "done",
    local: "hold"
  }, {
    startedAt: baseVisit.startedAt,
    itemKeys: baseVisit.itemKeys,
    routeStartLocation: { lat: 36.36, lng: 127.39 }
  });

  const firstPage = createCloudSaveHarness([rejectedSave(503)], {
    accountEmail,
    base: { visit: baseVisit },
    localStorage,
    version: 7
  });
  firstPage.setLatest({ visit: localVisit });
  firstPage.schedule();
  await firstPage.runOnlyTimer();

  assert.equal(localStorage.has(dirtyKey), true);
  const failedEnvelope = JSON.parse(localStorage.getItem(dirtyKey));
  assert.equal(failedEnvelope.accountEmail, accountEmail);
  assert.equal(failedEnvelope.version, 7);
  assert.equal(Object.hasOwn(failedEnvelope.snapshot.visit, "routeStartLocation"), false);
  assert.equal(Object.hasOwn(failedEnvelope.base.visit, "routeStartLocation"), false);

  const remoteVisit = session("2026-09-10T00:03:00Z", {
    stable: "done",
    remote: "done"
  }, {
    startedAt: baseVisit.startedAt,
    itemKeys: baseVisit.itemKeys
  });
  const reloadedPage = createCloudSaveHarness([successfulSave(8)], {
    accountEmail,
    localStorage,
    ready: false,
    remoteResult: { found: true, data: { visit: remoteVisit }, version: 7 }
  });
  const restored = await reloadedPage.boot();

  assert.equal(restored.visit.statuses.local, "hold");
  assert.equal(restored.visit.statuses.remote, "done");
  assert.deepEqual(reloadedPage.pendingDelays(), [350]);
  const rewrittenEnvelope = JSON.parse(localStorage.getItem(dirtyKey));
  assert.equal(rewrittenEnvelope.version, 7);
  assert.equal(Object.hasOwn(rewrittenEnvelope.snapshot.visit, "routeStartLocation"), false);

  await reloadedPage.runOnlyTimer();
  assert.equal(reloadedPage.snapshots[0].visit.statuses.local, "hold");
  assert.equal(reloadedPage.snapshots[0].visit.statuses.remote, "done");
  assert.equal(localStorage.has(dirtyKey), false, "cloud acknowledgement clears durable dirty state");
});

test("durable AI visit recovery is isolated by authenticated account", async () => {
  const localStorage = memoryStorage();
  const accountA = "a@example.com";
  const accountAKey = `js_ai_visit_cloud_dirty_v1::${encodeURIComponent(accountA)}`;
  const pageA = createCloudSaveHarness([], { accountEmail: accountA, localStorage, version: 2 });
  pageA.setLatest({ privateA: { active: true, startedAt: "2026-09-10T00:00:00Z" } });
  pageA.schedule();
  assert.equal(localStorage.has(accountAKey), true);

  const pageB = createCloudSaveHarness([], {
    accountEmail: "b@example.com",
    localStorage,
    ready: false,
    remoteResult: {
      found: true,
      data: { privateB: { active: true, startedAt: "2026-09-10T01:00:00Z" } },
      version: 4
    }
  });
  const restoredForB = await pageB.boot();

  assert.equal(Object.hasOwn(restoredForB, "privateA"), false);
  assert.equal(Object.hasOwn(restoredForB, "privateB"), true);
  assert.deepEqual(pageB.pendingDelays(), []);
  assert.equal(pageB.context.readCloudSessionDirtyEnvelope(), null);

  const pageARelogin = createCloudSaveHarness([successfulSave(3)], {
    accountEmail: accountA,
    localStorage,
    ready: false,
    remoteResult: {
      found: true,
      data: { remoteA: { active: true, startedAt: "2026-09-10T02:00:00Z" } },
      version: 2
    }
  });
  const restoredForA = await pageARelogin.boot();
  assert.equal(Object.hasOwn(restoredForA, "privateA"), true, "A's offline recovery survives a B session");
  assert.equal(Object.hasOwn(restoredForA, "remoteA"), true);
  await pageARelogin.runOnlyTimer();
  assert.equal(localStorage.has(accountAKey), false, "A acknowledgement clears only A's envelope");
});

test("AI cloud boundaries carry the captured account in shared and fallback transports", async () => {
  const sharedCalls = [];
  const shared = {
    Date, Error, Number, Object, Promise, URLSearchParams,
    cloudSessionAccountEmail: "captured@example.test",
    window: {
      JSAuthenticatedAccountEmail: "different@example.test",
      JSDataAccessV6: {
        read(action, params) { sharedCalls.push({ kind: "read", action, params }); return Promise.resolve({ ok: true }); },
        mutate(action, payload) { sharedCalls.push({ kind: "mutate", action, payload }); return Promise.resolve({ ok: true }); }
      }
    }
  };
  vm.createContext(shared);
  vm.runInContext([
    extractFunction("aiVisitHttpError"),
    extractFunction("readAiVisitData"),
    extractFunction("mutateAiVisitData")
  ].join("\n"), shared);
  await shared.readAiVisitData("loadCloudState", { scope: "visitSession" });
  await shared.mutateAiVisitData("saveCloudState", { scope: "visitSession" });
  assert.equal(sharedCalls[0].params.expectedAccountEmail, "captured@example.test");
  assert.equal(sharedCalls[1].payload.expectedAccountEmail, "captured@example.test");

  const fallbackCalls = [];
  const fallback = {
    Date, Error, JSON, Number, Object, Promise, URLSearchParams,
    cloudSessionAccountEmail: "fallback@example.test",
    window: { saveApiURL: "/api/data" },
    fetch(url, options) {
      fallbackCalls.push({ url: String(url), options });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }
  };
  vm.createContext(fallback);
  vm.runInContext([
    extractFunction("aiVisitHttpError"),
    extractFunction("readAiVisitData"),
    extractFunction("mutateAiVisitData")
  ].join("\n"), fallback);
  await fallback.readAiVisitData("loadCloudState", { scope: "visitSession" });
  await fallback.mutateAiVisitData("saveCloudState", { scope: "visitSession" });
  assert.match(fallbackCalls[0].url, /expectedAccountEmail=fallback%40example\.test/);
  assert.equal(JSON.parse(fallbackCalls[1].options.body).expectedAccountEmail, "fallback@example.test");
});

test("account_changed stops AI retries, keeps the dirty envelope, and warns once", async () => {
  const accountEmail = "stale-ai@example.test";
  const dirtyKey = `js_ai_visit_cloud_dirty_v1::${encodeURIComponent(accountEmail)}`;
  const harness = createCloudSaveHarness([rejectedAccountChange()], { accountEmail });
  harness.setLatest({ visit: { active: true, startedAt: "2026-09-10T00:00:00Z" } });
  harness.schedule();
  await harness.runOnlyTimer();

  assert.equal(harness.context.cloudSessionAccountChanged, true);
  assert.deepEqual(harness.pendingDelays(), []);
  assert.equal(harness.localStorage.has(dirtyKey), true);
  assert.deepEqual(harness.alerts, ["reload required"]);
  harness.schedule();
  assert.deepEqual(harness.pendingDelays(), []);
  assert.deepEqual(harness.alerts, ["reload required"]);
});

test("the owned pre-upgrade device cache migrates once and strips precise location", () => {
  const accountEmail = "legacy-owner@example.test";
  const encoded = encodeURIComponent(accountEmail);
  const localStorage = memoryStorage({
    js_ai_visit_sessions_v6: JSON.stringify({
      visit: { active: true, startedAt: "2026-09-10T00:00:00Z", routeStartLocation: { lat: 36.3, lng: 127.3 } }
    })
  });
  const context = {
    Date, JSON, Math, Number, Object, encodeURIComponent, localStorage,
    console: { warn() {} },
    window: { JSLegacyStorageOwnerEmailV1: accountEmail },
    cloudSessionAccountEmail: accountEmail,
    cloudSessionBase: {}, cloudSessionVersion: 0, dirtySessionWarningShown: false,
    memorySessionMap: null,
    DIRTY_SESSION_KEY_PREFIX: "js_ai_visit_cloud_dirty_v1::",
    QUARANTINED_SESSION_KEY_PREFIX: "js_ai_visit_sessions_quarantine_v1::",
    LEGACY_SESSION_MIGRATION_KEY_PREFIX: "js_ai_visit_legacy_session_migrated_v1::",
    SESSION_KEY: "js_ai_visit_sessions_v6", LEGACY_SESSION_KEY: "js_ai_visit_session_v6"
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction("copySessionMap"),
    extractFunction("cloudSessionDirtyStorageKey"),
    extractFunction("sanitizeSessionMapForDurableStorage"),
    extractFunction("readCloudSessionDirtyEnvelope"),
    extractFunction("writeCloudSessionDirtyEnvelope"),
    extractFunction("preservePreUpgradeDeviceSessionCache"),
    extractFunction("clearDeviceSessionCache")
  ].join("\n"), context);

  assert.equal(context.preservePreUpgradeDeviceSessionCache(), true);
  context.clearDeviceSessionCache();
  const envelope = JSON.parse(localStorage.getItem(`js_ai_visit_cloud_dirty_v1::${encoded}`));
  assert.equal(Object.hasOwn(envelope.snapshot.visit, "routeStartLocation"), false);
  assert.equal(localStorage.getItem(`js_ai_visit_legacy_session_migrated_v1::${encoded}`), "1");
  assert.equal(localStorage.has("js_ai_visit_sessions_v6"), false);
});

test("a completed legacy migration never resurrects a remotely deleted clean session", async () => {
  const accountEmail = "already-migrated@example.test";
  const encoded = encodeURIComponent(accountEmail);
  const localStorage = memoryStorage({
    [`js_ai_visit_legacy_session_migrated_v1::${encoded}`]: "1",
    js_ai_visit_sessions_v6: JSON.stringify({
      deletedRemote: { active: true, startedAt: "2026-09-10T00:00:00Z" }
    })
  });
  const context = {
    Date, JSON, Math, Number, Object, encodeURIComponent, localStorage,
    console: { warn() {} },
    window: { JSLegacyStorageOwnerEmailV1: accountEmail },
    cloudSessionAccountEmail: accountEmail,
    cloudSessionBase: {}, cloudSessionVersion: 0, dirtySessionWarningShown: false,
    memorySessionMap: null,
    DIRTY_SESSION_KEY_PREFIX: "js_ai_visit_cloud_dirty_v1::",
    QUARANTINED_SESSION_KEY_PREFIX: "js_ai_visit_sessions_quarantine_v1::",
    LEGACY_SESSION_MIGRATION_KEY_PREFIX: "js_ai_visit_legacy_session_migrated_v1::",
    SESSION_KEY: "js_ai_visit_sessions_v6", LEGACY_SESSION_KEY: "js_ai_visit_session_v6"
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction("copySessionMap"),
    extractFunction("cloudSessionDirtyStorageKey"),
    extractFunction("sanitizeSessionMapForDurableStorage"),
    extractFunction("readCloudSessionDirtyEnvelope"),
    extractFunction("writeCloudSessionDirtyEnvelope"),
    extractFunction("preservePreUpgradeDeviceSessionCache"),
    extractFunction("clearDeviceSessionCache")
  ].join("\n"), context);
  assert.equal(context.preservePreUpgradeDeviceSessionCache(), true);
  context.clearDeviceSessionCache();
  assert.equal(localStorage.has(`js_ai_visit_cloud_dirty_v1::${encoded}`), false);

  const reload = createCloudSaveHarness([], {
    accountEmail, localStorage, ready: false,
    remoteResult: { found: true, data: {}, version: 4 }
  });
  const restored = await reload.boot();
  assert.deepEqual(restored, {});
  assert.deepEqual(reload.pendingDelays(), []);
});

test("failed cloud saves keep one dirty retry and persist the latest local snapshot", async () => {
  const harness = createCloudSaveHarness([
    rejectedSave(409),
    rejectedSave(503),
    successfulSave(3),
    rejectedSave(503),
    successfulSave(5)
  ]);

  harness.setLatest({ visit: { revision: 1 } });
  harness.schedule();
  harness.setLatest({ visit: { revision: 2 } });
  harness.schedule();
  assert.deepEqual(harness.pendingDelays(), [350]);

  await harness.runOnlyTimer();
  assert.deepEqual(harness.pendingDelays(), [1000]);
  assert.equal(harness.context.cloudSessionDirty, true);

  harness.setLatest({ visit: { revision: 3 } });
  harness.schedule();
  harness.schedule();
  assert.deepEqual(harness.pendingDelays(), [1000], "new edits must reuse the delayed retry");

  await harness.runOnlyTimer();
  assert.deepEqual(harness.pendingDelays(), [2000]);
  harness.setLatest({ visit: { revision: 4 } });
  await harness.runOnlyTimer();

  assert.deepEqual(harness.snapshots.map((entry) => entry.visit.revision), [2, 3, 4]);
  assert.deepEqual(harness.pendingDelays(), []);
  assert.equal(harness.context.cloudSessionDirty, false);
  assert.equal(harness.context.cloudSessionRetryAttempt, 0);
  assert.equal(harness.context.cloudSessionSaveInFlight, false);

  harness.setLatest({ visit: { revision: 5 } });
  harness.schedule();
  await harness.runOnlyTimer();
  assert.deepEqual(harness.pendingDelays(), [1000], "success must reset retry backoff");
  await harness.runOnlyTimer();
  assert.deepEqual(harness.pendingDelays(), []);
});

test("cloud save retry backoff is capped and never creates duplicate timers", async () => {
  const harness = createCloudSaveHarness(Array.from({ length: 7 }, () => rejectedSave(503)));
  harness.setLatest({ visit: { revision: 1 } });
  harness.schedule();
  await harness.runOnlyTimer();

  for (const expectedDelay of [1000, 2000, 4000, 8000, 16000, 30000]) {
    assert.deepEqual(harness.pendingDelays(), [expectedDelay]);
    harness.schedule();
    assert.deepEqual(harness.pendingDelays(), [expectedDelay]);
    await harness.runOnlyTimer();
  }
  assert.deepEqual(harness.pendingDelays(), [30000]);
});

test("unholding a listing advances the session conflict timestamp before saving", () => {
  const unhold = extractFunction("requestUnhold");
  assert.match(unhold, /delete activeSession\.statuses\[key\]/);
  assert.match(unhold, /activeSession\.updatedAt = new Date\(\)\.toISOString\(\);\s*saveSession\(\)/);
});
