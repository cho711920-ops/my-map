import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const background = fs.readFileSync(new URL("../edge-automation/extension/background.js", import.meta.url), "utf8");
const CONFIG = "jsAutoCollectorConfigV1";
const RUN = "jsAutoCollectorRunStateV2";
const REPORT = "jsAutoCollectorRunReportV1";
const REPORTS = "jsAutoCollectorRunReportsByMarketV1";
const LAST = "jsAutoCollectorLastScheduleV1";
const VERSION = "jsAutoCollectorLastVersionRunV1";
const PENDING = "jsAutoCollectorPendingLeaseScheduleV1";
const clone = value => structuredClone(value);

function target(key, tradeType, source = "naver", enabled = true) {
  return { key, source, label: `${source} ${tradeType} 유성구`, tradeType, enabled,
    url: source === "daangn"
      ? `https://realty.daangn.com/?af=${encodeURIComponent(JSON.stringify({ tradeTypes: [tradeType === "sale" ? "BUY" : "MONTH"] }))}`
      : `https://fin.land.naver.com/map?tradeTypes=${tradeType === "sale" ? "A1" : "B2"}` };
}

function harness(targets = [target("lease-on", "lease"), target("lease-off", "lease", "naver", false),
  target("sale-nav", "sale"), target("sale-daangn", "sale", "daangn")]) {
  const data = { [CONFIG]: { enabled: true, schedule: "11:00", closeTabs: true, targets: clone(targets) } };
  const events = {};
  const alarms = new Map();
  const launches = [];
  const event = name => ({ addListener(listener) { events[name] = listener; } });
  const context = vm.createContext({ URL, console, setTimeout, clearTimeout,
    chrome: {
      storage: { local: {
        async get(keys) { return clone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))); },
        async set(values) { Object.assign(data, clone(values)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
      } },
      alarms: { async get(key) { return alarms.get(key); }, async clear(key) { alarms.delete(key); },
        create(key, value) { alarms.set(key, value); }, onAlarm: event("alarm") },
      tabs: { onRemoved: event("removed"), async get(id) { return { id, status: "complete" }; },
        async query() { return []; }, async remove() {},
        async create(values) { launches.push(values); return { id: 10, status: "complete", ...values }; },
        async sendMessage() { return { started: true }; } },
      runtime: { getManifest: () => ({ version: "1.1.11" }), getURL: path => `chrome-extension://test/${path}`,
        onMessage: event("message"), onStartup: event("startup"), onInstalled: event("installed") },
      notifications: { async create() {} }
    }
  });
  vm.runInContext(background, context);
  // Keep every test local: neither report publication nor status reads can
  // contact a provider or trigger watchdog recovery while asserting snapshots.
  vm.runInContext("publishPendingAutomationReport = async () => false; requestHealthCheck = () => {};", context);
  const dispatch = message => new Promise(resolve => events.message(message, { url: "chrome-extension://test/options.html" }, resolve));
  const alarm = async name => { events.alarm({ name }); await vm.runInContext("mutationQueue", context); };
  return { context, data, dispatch, alarms, launches, alarm };
}

test("legacy and imported sale targets are retained but can never participate in the daily lease schedule", async () => {
  const h = harness();
  const config = await h.context.getConfig();
  assert.equal(config.schedule, "11:00");
  assert.deepEqual(Array.from(config.targets, row => row.enabled), [true, false, false, false]);
  const portable = h.context.normalizePortableConfig({ config });
  await h.context.saveConfig(portable);
  assert.equal(h.data[CONFIG].targets.length, 4);
  assert.deepEqual(h.data[CONFIG].targets.map(row => row.enabled), [true, false, false, false]);
  assert.equal(h.alarms.get("js-auto-collector-daily").periodInMinutes, 1440);
});

test("sale registration defaults to manual-only and re-registering lease preserves its daily opt-out", async () => {
  const h = harness([]);
  await h.context.registerTarget(target("new-sale", "sale"));
  assert.equal(h.data[CONFIG].targets[0].enabled, false);
  await h.context.registerTarget(target("saved-lease", "lease", "naver", false));
  const registration = target("saved-lease", "lease");
  delete registration.enabled;
  await h.context.registerTarget(registration);
  assert.equal(h.data[CONFIG].targets[1].enabled, false);
});

test("scheduled runs include only enabled leases, even when legacy sales were enabled", async () => {
  const h = harness();
  const before = clone(h.data[CONFIG]);
  const result = await h.context.runAll("schedule");
  assert.equal(result.market, "lease");
  assert.deepEqual(h.data[RUN].targets.map(row => row.key), ["lease-on"]);
  assert.deepEqual(h.data[CONFIG], before);
  assert.equal(h.launches.length, 1);
});

test("manual sale executes registered disabled targets only and leaves lease configuration unchanged", async () => {
  const h = harness();
  h.data[CONFIG].enabled = false;
  const before = clone(h.data[CONFIG]);
  const result = await h.dispatch({ type: "JS_AUTO_RUN_NOW", market: "sale" });
  assert.equal(result.ok, true);
  assert.equal(h.data[RUN].market, "sale");
  assert.deepEqual(h.data[RUN].targets.map(row => row.key), ["sale-nav", "sale-daangn"]);
  assert.deepEqual(h.data[CONFIG], before);
});

test("old manual clients default to lease and include scheduled opt-outs without enabling them", async () => {
  const h = harness();
  const result = await h.dispatch({ type: "JS_AUTO_RUN_NOW" });
  assert.equal(result.ok, true);
  assert.deepEqual(h.data[RUN].targets.map(row => row.key), ["lease-on", "lease-off"]);
  assert.equal(h.data[CONFIG].targets[1].enabled, false);
});

test("manual selected keys are intersected with their requested market", async () => {
  const h = harness();
  const response = await h.dispatch({ type: "JS_AUTO_RUN_SELECTED", market: "sale", keys: ["lease-on", "sale-daangn"] });
  assert.equal(response.ok, true);
  assert.deepEqual(h.data[RUN].targets.map(row => row.key), ["sale-daangn"]);
});

test("invalid scopes and scheduled sale requests fail closed without opening a provider", async () => {
  for (const market of [null, "", "all", "buildingSale"]) {
    const h = harness();
    const result = await h.dispatch({ type: "JS_AUTO_RUN_NOW", market });
    assert.equal(result.ok, false);
    assert.equal(h.launches.length, 0);
    assert.equal(h.data[RUN], undefined);
  }
  const h = harness();
  await assert.rejects(h.context.runAll("schedule", null, "sale"), /수동/);
  assert.equal(h.launches.length, 0);
});

test("cross-market execution never modifies or recovers the currently running queue", async () => {
  const h = harness();
  await h.context.runAll("manual", null, "sale");
  const before = clone(h.data[RUN]);
  vm.runInContext("recoverAutomaticRun = async () => { throw new Error('must not recover another market'); };", h.context);
  const result = await h.dispatch({ type: "JS_AUTO_RUN_NOW", market: "lease" });
  assert.equal(result.ok, false);
  assert.equal(result.busy, true);
  assert.deepEqual(h.data[RUN], before);
  assert.equal(h.launches.length, 1);
});

test("Windows force and automatic page triggers never recover or extend an active manual sale run", async () => {
  const h = harness();
  await h.context.runAll("manual", null, "sale");
  const before = clone(h.data[RUN]);
  vm.runInContext("recoverAutomaticRun = async () => { throw new Error('wrong market recovery'); };", h.context);
  for (const message of [{ type: "JS_AUTO_RUN_REQUEST", forceRun: true },
    { type: "JS_AUTO_PAGE_READY", autorun: true, forceRun: true }]) {
    const result = await h.dispatch(message);
    assert.equal(result.ok, false);
    assert.equal(result.busy, true);
    assert.deepEqual(h.data[RUN], before);
  }
  assert.equal(h.launches.length, 1);
});

test("same-market requests resume and may extend the queue without importing the opposite market", async () => {
  const h = harness();
  await h.context.runAll("manual-selected", ["sale-nav"], "sale");
  const id = h.data[RUN].runId;
  const result = await h.context.runAll("manual", null, "sale");
  assert.equal(result.resumed, true);
  assert.equal(h.data[RUN].runId, id);
  assert.deepEqual(h.data[RUN].allTargets.map(row => row.key), ["sale-nav", "sale-daangn"]);
  assert.ok(h.data[REPORT].items.every(item => item.tradeType === "sale"));
});

test("lease and sale progress survive separate runs and failed-only retry uses its own market report", async () => {
  const h = harness();
  await h.context.saveRunReport({ runId: "lease-history", updatedAt: 100, active: false,
    items: [{ key: "lease-on", tradeType: "lease", status: "failed", counts: { created: 2 } }] });
  await h.context.saveRunReport({ runId: "sale-history", updatedAt: 200, active: false,
    items: [{ key: "sale-nav", tradeType: "sale", status: "partial", counts: { created: 3 } }] });
  const state = await h.dispatch({ type: "JS_AUTO_GET_STATE" });
  assert.equal(state.runReport.runId, "sale-history");
  assert.equal(state.runReports.lease.runId, "lease-history");
  assert.equal(state.runReports.sale.runId, "sale-history");
  const result = await h.dispatch({ type: "JS_AUTO_RUN_SELECTED", market: "lease", failedOnly: true,
    keys: ["lease-on", "sale-nav"] });
  assert.equal(result.ok, true);
  assert.deepEqual(h.data[RUN].targets.map(row => row.key), ["lease-on"]);
  assert.equal(h.data[REPORTS].sale.runId, "sale-history");
});

test("legacy mixed-market report migrates into two independent summaries", async () => {
  const h = harness();
  h.data[REPORT] = { runId: "legacy", updatedAt: 1, active: false, summary: { failed: 99 }, items: [
    { key: "lease-on", status: "completed" }, { key: "sale-nav", status: "failed" }
  ] };
  const reports = await h.context.getRunReports();
  assert.equal(reports.lease.items.length, 1);
  assert.equal(reports.lease.summary.completed, 1);
  assert.equal(reports.lease.summary.failed, 0);
  assert.equal(reports.sale.items.length, 1);
  assert.equal(reports.sale.summary.failed, 1);
});

test("only a settled scheduled lease run marks today's schedule complete", async () => {
  for (const [reason, market, marksDaily] of [["schedule", "lease", true], ["manual", "sale", false],
    ["manual-selected", "lease", false], ["windows-force", "lease", false]]) {
    const h = harness();
    await h.context.runAll(reason, null, market);
    const report = h.data[REPORT];
    report.items.forEach(item => { item.status = "completed"; });
    const state = clone(h.data[RUN]);
    await h.context.finalizeRun(state);
    assert.equal(Boolean(h.data[LAST]), marksDaily, `${reason}/${market}`);
    assert.equal(h.data[VERSION], marksDaily ? "1.1.11" : undefined);
  }
});

test("plural Naver sale filters are inferred but mixed and explicit mismatched filters are rejected", async () => {
  const h = harness();
  const sale = { source: "naver", key: "legacy", url: "https://fin.land.naver.com/map?tradeTypes=A1" };
  assert.equal(h.context.normalizeStoredTarget(sale).tradeType, "sale");
  assert.equal(h.context.normalizeStoredTarget(sale).enabled, false);
  for (const separator of [":", ",", "-", "|"]) {
    const mixed = { ...sale, url: `https://fin.land.naver.com/map?tradeTypes=A1${encodeURIComponent(separator)}B2` };
    assert.throws(() => h.context.validateTarget(mixed), /함께 선택/);
    await assert.rejects(h.context.registerTarget(mixed), /함께 선택/);
    await assert.rejects(h.context.saveConfig({ targets: [mixed] }), /함께 선택/);
    assert.throws(() => h.context.normalizePortableConfig({ targets: [mixed] }), /함께 선택/);
  }
  assert.throws(() => h.context.validateTarget({ ...sale, tradeType: "lease" }), /거래유형이 다릅니다/);
  assert.throws(() => h.context.validateTarget({ ...target("mismatch", "lease"), tradeType: "sale" }), /거래유형이 다릅니다/);
});

test("Daangn BUY mixed with MONTH cannot be registered or executed", async () => {
  const mixed = { ...target("mixed", "sale", "daangn"),
    url: `https://realty.daangn.com/?af=${encodeURIComponent(JSON.stringify({ tradeTypes: ["BUY", "MONTH"] }))}` };
  const h = harness([mixed]);
  await assert.rejects(h.context.registerTarget(mixed), /함께 선택/);
  const result = await h.dispatch({ type: "JS_AUTO_RUN_NOW", market: "sale" });
  assert.equal(result.ok, false);
  assert.match(result.message, /함께 선택/);
  assert.equal(h.launches.length, 0);
});

test("Fin registration and runs reject missing, singular-only, or unknown trade filters", async () => {
  for (const query of ["", "tradeType=A1", "t=A1", "tradeTypes=ALL", "tradeTypes=A1,UNKNOWN"]) {
    const invalid = { ...target("ambiguous", "sale"), url: `https://fin.land.naver.com/map?${query}` };
    const h = harness([invalid]);
    await assert.rejects(h.context.registerTarget(invalid), /불명확/);
    const result = await h.dispatch({ type: "JS_AUTO_RUN_NOW", market: "sale" });
    assert.equal(result.ok, false);
    assert.match(result.message, /불명확/);
    assert.equal(h.launches.length, 0);
  }
});

test("recovery skips an out-of-market queued target instead of launching it", async () => {
  const h = harness();
  const sale = target("injected-sale", "sale");
  const state = { active: true, runId: "legacy-schedule", reason: "schedule", market: "lease",
    targets: [sale], allTargets: [sale], index: 0, retryQueue: [], completedKeys: [], summary: {}, closeTabs: false };
  h.data[RUN] = clone(state);
  h.data[REPORT] = { active: true, runId: state.runId, items: [{ key: sale.key, tradeType: "sale", status: "pending" }] };
  await h.context.launchCurrentTarget(state);
  assert.equal(h.launches.length, 0);
  assert.equal(h.data[REPORT].items[0].status, "failed");
  assert.match(h.data[REPORT].items[0].message, /다른 대상/);
  assert.equal(h.data[LAST], undefined);
});

async function finishSaleWithPendingSchedule(h) {
  vm.runInContext("scheduleIsDue = () => true;", h.context);
  await h.context.runAll("manual", null, "sale");
  const before = clone(h.data[RUN]);
  const queued = await h.context.runScheduled("schedule");
  assert.equal(queued.queued, true);
  assert.equal(queued.ok, true);
  assert.deepEqual(h.data[RUN], before, "the sale queue is never extended or restarted");
  assert.ok(h.data[PENDING]);
  h.data[REPORT].items.forEach(item => { item.status = "completed"; });
  await h.context.finalizeRun(clone(h.data[RUN]));
  assert.equal(h.data[RUN], undefined, "finalization must not immediately reuse a sale tab its caller will close");
  assert.equal(h.data[LAST], undefined, "sale still cannot mark the lease schedule complete");
  assert.ok(h.alarms.has("js-auto-collector-recovery"));
}

test("a due lease schedule waits for manual sale then starts a separate lease run exactly once", async () => {
  const h = harness();
  await finishSaleWithPendingSchedule(h);
  await h.alarm("js-auto-collector-recovery");
  assert.equal(h.data[RUN].market, "lease");
  assert.equal(h.data[RUN].reason, "schedule");
  assert.deepEqual(h.data[RUN].targets.map(row => row.key), ["lease-on"]);
  assert.equal(h.data[PENDING], undefined);
  assert.equal(h.launches.length, 2);
  await h.alarm("js-auto-collector-watchdog");
  assert.equal(h.launches.length, 2);
  h.data[REPORT].items.forEach(item => { item.status = "completed"; });
  await h.context.finalizeRun(clone(h.data[RUN]));
  assert.ok(h.data[LAST]);
  await h.alarm("js-auto-collector-watchdog");
  assert.equal(h.launches.length, 2);
});

test("deferred lease schedules survive worker restart and use current target choices", async () => {
  const original = harness();
  await finishSaleWithPendingSchedule(original);
  const restored = harness();
  Object.assign(restored.data, clone(original.data));
  restored.data[CONFIG].targets[0].enabled = false;
  restored.data[CONFIG].targets[1].enabled = true;
  vm.runInContext("scheduleIsDue = () => true;", restored.context);
  await restored.alarm("js-auto-collector-watchdog");
  assert.equal(restored.data[RUN].market, "lease");
  assert.deepEqual(restored.data[RUN].targets.map(row => row.key), ["lease-off"]);
  assert.equal(restored.data[PENDING], undefined);
});

test("disabling the schedule or every lease target cancels a deferred run without collection", async () => {
  for (const disableAll of [false, true]) {
    const h = harness();
    await finishSaleWithPendingSchedule(h);
    if (disableAll) h.data[CONFIG].targets.forEach(row => { row.enabled = false; });
    else h.data[CONFIG].enabled = false;
    await h.alarm("js-auto-collector-recovery");
    assert.equal(h.data[RUN], undefined);
    assert.equal(h.data[PENDING], undefined);
    assert.equal(h.launches.length, 1);
  }
});

test("status reads cannot launch pending schedules and idle watchdog never performs unrequested catch-up", async () => {
  const h = harness();
  vm.runInContext("scheduleIsDue = () => true;", h.context);
  await h.alarm("js-auto-collector-watchdog");
  assert.equal(h.launches.length, 0);
  h.data[PENDING] = { date: h.context.localDateKey(), reason: "schedule", requestedAt: Date.now() };
  await h.context.recoverAutomaticRun();
  await h.dispatch({ type: "JS_AUTO_GET_STATE" });
  assert.equal(h.data[RUN], undefined);
  assert.equal(h.launches.length, 0);
  assert.ok(h.data[PENDING]);
});

test("non-force Windows triggers queue an overdue lease without touching the active sale", async () => {
  for (const message of [{ type: "JS_AUTO_RUN_REQUEST" }, { type: "JS_AUTO_PAGE_READY", autorun: true }]) {
    const h = harness();
    vm.runInContext("scheduleIsDue = () => true;", h.context);
    await h.context.runAll("manual", null, "sale");
    const before = clone(h.data[RUN]);
    const result = await h.dispatch(message);
    assert.equal(result.queued, true);
    assert.deepEqual(h.data[RUN], before);
    assert.ok(h.data[PENDING]);
  }
});
