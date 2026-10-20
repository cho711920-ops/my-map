import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { result as daangnResult } from "./fixtures/daangn-report-fixture.mjs";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const background = read("edge-automation/extension/background.js");
const naver = read("js/naver-collector.js");
const RUN = "jsAutoCollectorRunStateV2";
const REPORT = "jsAutoCollectorRunReportV1";
const CONFIG = "jsAutoCollectorConfigV1";
const LOG = "jsAutoCollectorLogsV1";
const CIRCUIT = "jsAutoCollectorSourceCircuitsV1";
const minute = 60000;
const clock = Date.parse("2026-08-27T07:00:00Z");

function harness(overrides = {}) {
  const targets = ["유성구", "대덕구", "중구", "서구", "동구"].map((label, index) => ({
    key: "naver-" + index, source: "naver", label,
    url: "https://fin.land.naver.com/map?tradeTypes=B2&test=" + index, enabled: true
  }));
  const state = { active: true, runId: "cycle", targets, index: 3, currentTabId: 42,
    targetRunId: "seo", targetStartedAt: clock - 190 * minute,
    runtimeStartedAt: clock - 190 * minute, phase: "collecting", targetAttempt: 1,
    startedAt: clock - 230 * minute, retryQueue: [],
    summary: { completed: 3, failed: 0, errors: [] }, ...overrides };
  const data = {
    [RUN]: state, [CONFIG]: { enabled: true, targets, schedule: "11:00" },
    [REPORT]: { runId: "cycle", active: true, items: targets.map((target, i) => ({
      key: target.key, status: i < 3 ? "completed" : i === 3 ? "running" : "pending",
      startedAt: i === 3 ? clock - 190 * minute : null
    })) }
  };
  const events = {};
  const alarmMap = new Map();
  const navigation = [];
  const notifications = [];
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
      tabs: { async get(id) { return { id, status: "complete", discarded: false }; },
        async query() { return []; },
        async update(id, options) { navigation.push(options.url); return { id, status: "complete" }; },
        async create(options) { navigation.push(options.url); return { id: 43, status: "complete" }; },
        async remove() {}, async sendMessage(_id, message) {
          if (message && message.type === "JS_AUTO_PING_TARGET") {
            return { ok: true, active: true, progressFingerprint: "probe-alive", progressMessage: "상세 저장 진행 확인" };
          }
          return { started: true };
        }, onRemoved: event("removed") },
      runtime: { getManifest: () => ({ version: "1.1.16" }), getURL: value => 'chrome-extension://test/' + value, onMessage: event("message"),
        onStartup: event("startup"), onInstalled: event("installed") },
      notifications: { create: async message => { notifications.push(message); } }
    }
  });
  vm.runInContext(background, context);
  const dispatch = (message, tabId = 42, extraSender = {}) => new Promise(resolve => events.message(message, { tab: { id: tabId }, ...extraSender }, resolve));
  const flush = async () => { await vm.runInContext("mutationQueue", context); await new Promise(resolve => setImmediate(resolve)); };
  return { context, data, navigation, notifications, alarmMap, dispatch, flush, events };
}

test("upgrade settles proven address holds and excludes removed Gongsil without restarting completed regions", async () => {
  const h = harness({phase: "retry-wait"});
  const base = h.data[RUN].targets;
  const daangn = [0,1,2,3,4].map(i => ({key:"daangn-"+i,source:"daangn",label:"당근"+i,
    url:"https://realty.daangn.com/?test="+i,enabled:true}));
  const gongsil = [0,1].map(i => ({key:"gongsil-"+i,source:"gongsil",label:"공실"+i,
    url:"https://gongsilbox.com/?test="+i,enabled:true}));
  h.data[RUN].targets = [...base,...daangn,...gongsil];
  h.data[RUN].allTargets = [...h.data[RUN].targets];
  h.data[RUN].index = 11;
  h.data[RUN].retryQueue = [base[3],...daangn,gongsil[0]];
  h.data[CONFIG].targets = [...base,...daangn];
  h.data[REPORT].items = base.map((target,i) => ({...target,status:i===3?"retry_wait":"completed",counts:{}}))
    .concat(daangn.map(target => ({...target,status:"retry_wait",counts:h.context.resultCounts(daangnResult())})),
      gongsil.map(target => ({...target,status:"retry_wait",counts:{}})));
  const configBefore = structuredClone(h.data[CONFIG]);
  await h.context.reconcileRunAfterUpdate(h.data[RUN],h.data[CONFIG]);
  assert.deepEqual(h.data[RUN].targets.map(target=>target.key),["naver-3"]);
  assert.equal(h.data[RUN].retryQueue.length,0);
  assert.ok(h.data[REPORT].items.filter(item=>item.source==="daangn").every(item=>item.status==="deferred"));
  assert.ok(h.data[REPORT].items.filter(item=>item.source==="gongsil").every(item=>item.status==="skipped"));
  assert.equal(h.data[RUN].summary.deferred,5);
  assert.equal(h.data[RUN].summary.skipped,2);
  assert.deepEqual(h.data[CONFIG],configBefore);
});

test("upgrade keeps real Daangn failures and incomplete proofs in the remaining queue", async () => {
  for (const override of [{failed:1},{listComplete:false},{version:undefined}]) {
    const h = harness();
    const target = {...h.data[RUN].targets[3],source:"daangn"};
    h.data[RUN].targets[3] = target;
    h.data[REPORT].items[3] = {...target,status:"retry_wait",counts:{...h.context.resultCounts(daangnResult()),...override}};
    await h.context.reconcileRunAfterUpdate(h.data[RUN],h.data[CONFIG]);
    assert.equal(h.data[REPORT].items[3].status,"retry_wait");
    assert.equal(h.data[RUN].targets[3].key,"naver-3");
  }
});

test("install and startup events do not start the upgraded target twice", async () => {
  const h = harness({targetStartedAt:clock-minute,runtimeStartedAt:clock-minute});
  await h.events.installed();
  await h.flush();
  assert.equal(h.navigation.length,1);
  await h.events.startup();
  await h.flush();
  assert.equal(h.navigation.length,1);
});

test("one-off selection runs only chosen enabled targets without modifying tomorrow's configuration", async () => {
  const h = harness();
  delete h.data[RUN];
  const before = structuredClone(h.data[CONFIG]);
  const response = await h.dispatch({type: "JS_AUTO_RUN_SELECTED", keys: ["naver-4"]}, 42, {url: "chrome-extension://test/options.html"});
  await h.flush();
  assert.equal(response.ok, true);
  assert.deepEqual(h.data[RUN].targets.map(target => target.key), ["naver-4"]);
  assert.deepEqual(h.data[CONFIG], before);
});
test("failed-only selection excludes completed targets and rejects provider-page requests", async () => {
  const h = harness();
  delete h.data[RUN];
  h.data[REPORT].items[3].status = "failed";
  h.data[REPORT].items[4].status = "partial";
  const denied = await h.dispatch({type: "JS_AUTO_RUN_SELECTED", keys: ["naver-3"]}, 42, {url: "https://realty.daangn.com/"});
  assert.equal(denied.ok, false);
  const response = await h.dispatch({type: "JS_AUTO_RUN_SELECTED", keys: ["naver-0", "naver-3", "naver-4"], failedOnly: true}, 42, {url: "chrome-extension://test/options.html"});
  await h.flush();
  assert.equal(response.ok, true);
  assert.deepEqual(h.data[RUN].targets.map(target => target.key), ["naver-3", "naver-4"]);
});
test("Windows schedule is unknown without a trusted snapshot, not inferred from extension config", async () => {
  const h = harness();
  const ready = await h.context.automationReadiness();
  assert.equal(ready.schedule, "11:00");
  assert.equal(ready.windowsSchedule, "");
  assert.equal(ready.windowsTaskState, "Unknown");
  assert.equal(ready.windowsCheckedAt, null);
});
test("minimal report drops target URLs, raw payload and diagnostic contacts", async () => {
  const h = harness();
  const report = {runId: "run-1234567890123-test", startedAt: clock, updatedAt: clock + 1, active: true,
    items: [{key: "naver-0", source: "naver", label: "유성구", status: "running", message: "010-1234-5678 secret",
      raw: {token: "secret"}, counts: {created: 3, url: "https://private.example/"}}]};
  const clean = JSON.stringify(await h.context.minimalAutomationReport(report));
  assert.doesNotMatch(clean, /https|secret|010-1234|raw|naver-0/);
  assert.match(clean, /"created":3/);
});

test("Gongsil scope deferral persists partial status and counts without reopening a retry target", async () => {
  const h = harness({targetStartedAt: clock - minute});
  h.data[RUN].targets[3].source = "gongsil";
  const counts = {presenceReported: true, missingMarked: 9, deactivated: 4, adsReappeared: 2,
    presenceTracking: false, presenceScopeEstablished: false, presenceTrackingIssue: "unverified-map-scope",
    found: 20, processed: 20, failed: 0};
  await h.context.finishCurrentTarget({ok: true, runId: "cycle", targetRunId: "seo", result: {
    source: "gongsil", partial: false, totals: counts}}, 42);
  const item = h.data[REPORT].items[3];
  assert.equal(item.status, "partial");
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].retryQueue.length, 0);
  assert.equal(item.counts.missingMarked, 9);
  assert.equal(item.counts.deactivated, 4);
  assert.equal(item.counts.adsReappeared, 2);
  assert.match(item.message, /종료판정보류.*원본광고 재등장 2건/);
  assert.doesNotMatch(item.message, /계약완료|거래완료/);
});

test("numeric run reports keep Naver district names stored as objects", async () => {
  const h = harness();
  h.data[CONFIG].targets[0].district = {name: "유성구", cortarNo: "3020000000"};
  const clean = await h.context.minimalAutomationReport({runId: "run-1234567890123-test", startedAt: clock,
    updatedAt: clock, active: true, items: [{key: "naver-0", source: "naver", label: "네이버 유성구",
      status: "running", counts: {}}]});
  assert.equal(clean.items[0].district, "유성구");
});

test("watchdog upgrades an existing five-minute alarm without changing the daily schedule", async () => {
  const h = harness();
  h.alarmMap.set("js-auto-collector-watchdog", {periodInMinutes: 5});
  h.alarmMap.set("js-auto-collector-daily", {periodInMinutes: 1440, scheduledTime: clock + 1000});
  await h.context.ensureWatchdogAlarm();
  assert.equal(h.alarmMap.get("js-auto-collector-watchdog").periodInMinutes, 1);
  assert.equal(h.alarmMap.get("js-auto-collector-daily").scheduledTime, clock + 1000);
});

test("fresh page progress prevents restart even when both recorded heartbeat and progress are old", async () => {
  const h = harness({targetStartedAt: clock - 30 * minute, runtimeStartedAt: clock - 30 * minute,
    lastHeartbeatAt: clock - 21 * minute, lastProgressAt: clock - 21 * minute,
    lastProgressFingerprint: "older-page-count"});
  const result = await h.context.recoverAutomaticRun();
  assert.equal(result.probed, true);
  assert.equal(h.data[RUN].lastProgressAt, clock);
  assert.equal(h.data[RUN].index, 3);
  assert.equal(h.navigation.length, 0);
});

test("a responding page with unchanged counts still recovers after the no-progress deadline", async () => {
  const h = harness({targetStartedAt: clock - 30 * minute, runtimeStartedAt: clock - 30 * minute,
    lastHeartbeatAt: clock, lastProgressAt: clock - 21 * minute,
    lastProgressFingerprint: "probe-alive"});
  await h.context.recoverAutomaticRun();
  assert.equal(h.navigation.length, 1);
  assert.notEqual(h.data[RUN].targetRunId, "seo");
  assert.equal(h.data[REPORT].items[0].status, "completed");
});

test("stall recovery notification preserves the probe heartbeat and numeric snapshot", async () => {
  const h = harness({targetStartedAt: clock - 30 * minute, runtimeStartedAt: clock - 30 * minute,
    lastHeartbeatAt: clock - 9 * minute, lastProgressAt: clock - 21 * minute,
    lastProgressFingerprint: "probe-alive", progressStage: null});
  setCurrentDaangn(h);
  const stage = daangnStage();
  const sendMessage = h.context.chrome.tabs.sendMessage;
  h.context.chrome.tabs.sendMessage = async (tabId, message) => message.type === "JS_AUTO_PING_TARGET"
    ? {ok: true, active: true, progressFingerprint: "probe-alive",
      progressMessage: "상세 저장 진행 확인", progressStage: stage}
    : sendMessage(tabId, message);
  const finishCurrentTarget = h.context.finishCurrentTarget;
  let stateAtRecovery;
  h.context.finishCurrentTarget = async (...args) => {
    stateAtRecovery = structuredClone(h.data[RUN]);
    return finishCurrentTarget(...args);
  };
  await h.context.recoverAutomaticRun();
  assert.equal(h.notifications.length, 1);
  assert.equal(stateAtRecovery.lastRecoveryNotificationAt, clock);
  assert.equal(stateAtRecovery.lastHeartbeatAt, clock);
  assert.equal(stateAtRecovery.lastProgressAt, clock - 21 * minute);
  assert.equal(stateAtRecovery.progressMessage, "상세 저장 진행 확인");
  assert.deepEqual(stateAtRecovery.progressStage, stage);
  assert.equal(h.data[REPORT].items[3].counts.processed, 500);
  assert.equal(h.data[REPORT].items[3].counts.addressDeferred, 4);
  assert.equal(h.data[RUN].targetAttempt, 2);
  assert.equal(h.navigation.length, 1);
});
test("failed report uploads remain queued across a later run and do not fail the collection", async () => {
  const h = harness();
  const first = {runId: "run-1234567890123-first", startedAt: clock, updatedAt: clock, active: true,
    items: [{key: "naver-0", source: "naver", status: "running", counts: {}}]};
  await h.context.saveRunReport(first);
  await h.context.saveRunReport({...first, runId: "run-1234567890124-next", updatedAt: clock + 1});
  await h.flush();
  const queued = h.data.jsAutoCollectorPendingReportV1;
  assert.equal(queued.length, 2);
  assert.equal(h.data[RUN].active, true);
});
test("normal completion notification is opt-in and failure notifications can be muted", async () => {
  for (const [notifyComplete, notifyFailure, failed, expected] of [[false,true,false,0],[true,true,false,1],[false,false,true,0],[false,true,true,1]]) {
    const h = harness();
    h.data[CONFIG].notifyComplete = notifyComplete;
    h.data[CONFIG].notifyFailure = notifyFailure;
    h.data[REPORT].items.forEach((item, index) => { item.status = failed && index === 0 ? "failed" : "completed"; });
    await h.context.finalizeRun(h.data[RUN]);
    assert.equal(h.notifications.length, expected);
  }
});

function setCurrentDaangn(h, overrides = {}) {
  const target = { ...h.data[RUN].targets[3], key: "daangn-seo", source: "daangn",
    label: "당근 서구", url: "https://realty.daangn.com/?test=seo", selectedCount: 1853, ...overrides };
  h.data[RUN].targets[3] = target;
  h.data[REPORT].items[3] = { ...h.data[REPORT].items[3], key: target.key, source: target.source,
    label: target.label, counts: {} };
  return target;
}

function daangnStage(overrides = {}) {
  return { key: "detail", found: 1853, processed: 120, unchanged: 380,
    remaining: 1353, created: 3, updated: 2, review: 7, addressMissing: 4, failed: 1,
    ...overrides };
}

test("three-hour stalled Seo defers only Seo, keeps completed regions and starts Dong", async () => {
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

test("Naver heartbeat persists inclusive progress without counting unchanged listings twice", async () => {
  const h = harness({ targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
    lastHeartbeatAt: clock, lastProgressAt: clock, targetAttempt: 4 });
  h.data[RUN].targets[3].retryCycle = 8;
  const stage = { key: "save", found: 8193, processed: 7602, unchanged: 7582,
    created: 3, updated: 10, review: 2, addressMissing: 1, failed: 0 };
  await h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
    progressFingerprint: "naver-save-7602", progressStage: stage });
  await h.flush();
  let counts = h.data[REPORT].items[3].counts;
  assert.equal(counts.expected, 8193);
  assert.equal(counts.processed, 7602);
  assert.equal(counts.unchanged, 7582);
  assert.equal(counts.detailProcessed, 20);
  assert.equal(counts.addressDeferred, 1);
  assert.equal(counts.created, 3);
  assert.equal(counts.updated, 10);
  assert.equal(counts.review, 2);
  assert.equal(counts.listComplete, false);
  await h.context.finishCurrentTarget({ ok: false, runId: "cycle", targetRunId: "seo",
    message: "서버 응답 제한시간 60초 초과", result: {} }, 42);
  const item = h.data[REPORT].items[3];
  assert.equal(item.status, "failed");
  counts = item.counts;
  assert.equal(counts.processed, 7602);
  assert.equal(counts.detailProcessed, 20);
  assert.equal(counts.unchanged, 7582);
  assert.equal(counts.listComplete, false);
});

test("Naver progress stays nonnegative before detail work and never proves completion", () => {
  const h = harness();
  const counts = h.context.progressCounts({ source: "네이버" }, {
    found: 8193, processed: 0, unchanged: 7582
  });
  assert.equal(counts.processed, 0);
  assert.equal(counts.detailProcessed, 0);
  assert.equal(counts.listComplete, false);
  assert.deepEqual({ ...h.context.progressCounts({ source: "naver" }, {
    provisional: true, found: 8193, processed: 8193
  }) }, {});
});

for (const attempt of [1, 2]) {
  test(`a confirmed Naver D1 finalization CPU failure on attempt ${attempt} preserves progress without an auth circuit`, async () => {
    const h = harness({targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
      lastHeartbeatAt: clock, lastProgressAt: clock, targetAttempt: attempt});
    const stage = {key: "save", found: 8193, processed: 8193, unchanged: 7582,
      created: 3, updated: 608, review: 0, addressMissing: 0, failed: 0};
    await h.dispatch({type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
      progressFingerprint: "naver-saved-before-finalize", progressStage: stage});
    await h.flush();
    await h.context.finishCurrentTarget({ok: false, runId: "cycle", targetRunId: "seo",
      message: "D1_ERROR: CPU time limit exceeded during finalization",
      result: {ok: false, complete: false, totals: {accepted: 611, saved: 611, created: 3, updated: 608}}}, 42);
    const item = h.data[REPORT].items[3];
    assert.equal(item.counts.expected, 8193);
    assert.equal(item.counts.processed, 8193);
    assert.equal(item.counts.unchanged, 7582);
    assert.equal(item.counts.detailProcessed, 611);
    assert.equal(item.counts.created, 3);
    assert.equal(item.counts.listComplete, false, "saved rows do not prove successful census finalization");
    assert.equal(h.data[REPORT].items[0].status, "completed");
    assert.equal(Object.keys(h.data[CIRCUIT] || {}).length, 0);
    assert.equal(h.navigation.length, 1);
    if (attempt === 1) {
      assert.equal(item.status, "running");
      assert.equal(h.data[RUN].index, 3);
      assert.equal(h.data[RUN].targetAttempt, 2);
      assert.match(h.navigation[0], /test=3$/);
    } else {
      assert.equal(item.status, "retry_wait");
      assert.equal(h.data[RUN].index, 4);
      assert.equal(h.data[RUN].retryQueue[0].key, "naver-3");
      assert.match(h.navigation[0], /test=4$/);
    }
  });
}

test("Naver comparison-to-detail transition replaces its old counter with the latest snapshot", async () => {
  const h = harness({ targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
    lastHeartbeatAt: clock, lastProgressAt: clock });
  for (const stage of [
    { key: "collect", found: 8193, processed: 8000, unchanged: 7400 },
    { key: "detail", found: 8193, processed: 7582, unchanged: 7582 }
  ]) {
    await h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
      progressFingerprint: "naver-" + stage.key, progressStage: stage });
    await h.flush();
  }
  const item = h.data[REPORT].items[3];
  assert.equal(item.counts.expected, 8193);
  assert.equal(item.counts.processed, 7582);
  assert.equal(item.counts.detailProcessed, 0);
  assert.equal(item.counts.unchanged, 7582);
  assert.equal(item.counts.listComplete, false);
  assert.equal(item.progressStage.key, "detail");
});

test("a throttled background heartbeat is confirmed by direct tab probe without reopening the target", async () => {
  const h = harness({
    targetStartedAt: clock - 10 * minute,
    runtimeStartedAt: clock - 10 * minute,
    lastHeartbeatAt: clock - 9 * minute,
    lastProgressAt: clock - 5 * minute
  });
  const result = await h.context.recoverAutomaticRun();
  assert.equal(result.probed, true);
  assert.equal(h.navigation.length, 0);
  assert.equal(h.data[RUN].lastHeartbeatAt, clock);
  assert.equal(h.data[RUN].lastProgressFingerprint, "probe-alive");
  assert.equal(h.data[RUN].progressMessage, "상세 저장 진행 확인");
});

test("sale collection protects only its provider tab and persists the previous policy before applying it", async () => {
  const h = harness({market: "sale"});
  h.data[RUN].targets.forEach(target => { target.tradeType = "sale"; });
  const calls = [];
  h.context.chrome.tabs.update = async (id, options) => {
    assert.deepEqual(h.data[RUN].saleTabPolicyV42, {tabId: id, autoDiscardable: true});
    calls.push([id, structuredClone(options)]);
  };
  await h.context.protectSaleCollectorTab(h.data[RUN], {id: 42, url: "https://realty.daangn.com/", autoDiscardable: true});
  await h.context.protectSaleCollectorTab(h.data[RUN], {id: 42, url: "https://realty.daangn.com/", autoDiscardable: false});
  assert.deepEqual(calls, [[42, {autoDiscardable: false}], [42, {autoDiscardable: false}]]);
  assert.equal(h.data[RUN].saleTabPolicyV42.autoDiscardable, true);
  h.data[RUN].market = "lease";
  h.data[RUN].targets.forEach(target => { target.tradeType = "lease"; });
  await h.context.protectSaleCollectorTab(h.data[RUN], {id: 43, url: "https://realty.daangn.com/"});
  h.data[RUN].market = "sale";
  h.data[RUN].targets.forEach(target => { target.tradeType = "sale"; });
  await h.context.protectSaleCollectorTab(h.data[RUN], {id: 43, url: "https://unrelated.example/"});
  assert.equal(calls.length, 2);
});

test("persisted sale tab policy restores after a cold worker and respects an already protected tab", async () => {
  const h = harness({market: "sale", saleTabPolicyV42: {tabId: 42, autoDiscardable: true}});
  const calls = [];
  h.context.chrome.tabs.get = async id => ({id, url: "https://realty.daangn.com/", autoDiscardable: false});
  h.context.chrome.tabs.update = async (id, options) => calls.push([id, structuredClone(options)]);
  await h.context.restoreSaleCollectorTabPolicy(h.data[RUN]);
  assert.deepEqual(calls, [[42, {autoDiscardable: true}]]);
  h.data[RUN].saleTabPolicyV42.autoDiscardable = false;
  await h.context.restoreSaleCollectorTabPolicy(h.data[RUN]);
  assert.deepEqual(calls[1], [42, {autoDiscardable: false}]);
  h.context.chrome.tabs.get = async id => ({id, url: "https://unrelated.example/", autoDiscardable: false});
  await h.context.restoreSaleCollectorTabPolicy(h.data[RUN]);
  assert.equal(calls.length, 2);
});

test("sale disconnect reports distinguish discarded, frozen, missing and disconnected runtime without extending deadlines", async () => {
  for (const [tab, response, issue] of [
    [null, null, "수집 탭 종료"],
    [{discarded: true}, null, "브라우저 메모리 회수"],
    [{frozen: true}, null, "브라우저 탭 동결"],
    [{status: "loading"}, null, "공급처 화면 다시 로딩 중"],
    [{}, {ok: true, active: false}, "수집 연결 없음"],
    [{}, null, "직접 확인에도 응답 없음"]
  ]) {
    const h = harness({market: "sale", targetStartedAt: clock - 10 * minute,
      runtimeStartedAt: clock - 10 * minute, lastHeartbeatAt: clock - 9 * minute, lastProgressAt: clock - 5 * minute});
    h.data[RUN].targets.forEach(target => { target.tradeType = "sale"; });
    h.context.chrome.tabs.get = async () => tab;
    h.context.chrome.tabs.sendMessage = async () => response;
    let failure;
    h.context.finishCurrentTarget = async result => { failure = result; return {ok: true}; };
    await h.context.recoverAutomaticRun();
    assert.ok(failure && failure.ok === false);
    assert.ok(failure.message.includes(issue), failure.message);
    assert.equal(h.data[RUN].lastProgressAt, clock - 5 * minute);
  }
});

test("Daangn heartbeat counts survive a terminal 403 without entering a retry loop", async () => {
  const h = harness({ targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
    lastHeartbeatAt: clock, lastProgressAt: clock, targetAttempt: 4 });
  setCurrentDaangn(h);
  await h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
    progressFingerprint: "daangn-500", progressMessage: "상세조회·저장 중 · 27%",
    progressStage: daangnStage() });
  await h.flush();
  let item = h.data[REPORT].items[3];
  assert.equal(item.counts.expected, 1853);
  assert.equal(item.counts.processed, 500);
  assert.equal(item.counts.unchanged, 380);
  assert.equal(item.counts.created, 3);
  assert.equal(item.counts.remaining, undefined);
  await h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
    progressFingerprint: "daangn-retry-zero", progressMessage: "수집 재연결 중",
    progressStage: daangnStage({ found: 0, processed: 0, unchanged: 0, remaining: 0,
      created: 0, updated: 0, review: 0, addressMissing: 0, failed: 0 }) });
  await h.flush();
  assert.equal(h.data[REPORT].items[3].counts.processed, 500);
  await h.context.finishCurrentTarget({ ok: false, runId: "cycle", targetRunId: "seo",
    message: "당근 API HTTP 오류: 403", result: {} }, 42);
  item = h.data[REPORT].items[3];
  assert.equal(item.status, "failed");
  assert.equal(item.counts.expected, 1853);
  assert.equal(item.counts.processed, 500);
  assert.equal(item.counts.updated, 2);
  assert.equal(item.counts.review, 7);
  assert.equal(item.message, "당근 API HTTP 오류: 403");
  assert.equal(h.data[RUN].retryQueue.length, 0);
  assert.equal(h.data[RUN].sourceCircuits.daangn.code, "provider_auth");
  assert.equal(h.data[CIRCUIT].daangn.code, "provider_auth");
});

test("Daangn immediate retry relaunch keeps the last numeric progress", async () => {
  const h = harness({ targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
    lastHeartbeatAt: clock, lastProgressAt: clock, targetAttempt: 1 });
  setCurrentDaangn(h);
  await h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
    progressFingerprint: "daangn-immediate", progressStage: daangnStage() });
  await h.flush();
  await h.context.finishCurrentTarget({ ok: false, runId: "cycle", targetRunId: "seo",
    message: "당근 API 일시적 네트워크 연결 오류", result: {}, progressStage: daangnStage({ found: 0,
      processed: 0, unchanged: 0, created: 0, updated: 0, review: 0 }) }, 42);
  const item = h.data[REPORT].items[3];
  assert.equal(item.status, "running");
  assert.equal(item.counts.expected, 1853);
  assert.equal(item.counts.processed, 500);
  assert.equal(h.data[RUN].targetAttempt, 2);
  assert.equal(h.navigation.length, 1);
});

test("Daangn terminal failure keeps numeric progress and the provider error", async () => {
  const h = harness({ targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
    lastHeartbeatAt: clock, lastProgressAt: clock, targetAttempt: 4 });
  setCurrentDaangn(h, { retryCycle: 8 });
  await h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
    progressFingerprint: "daangn-terminal", progressStage: daangnStage() });
  await h.flush();
  await h.context.finishCurrentTarget({ ok: false, runId: "cycle", targetRunId: "seo",
    message: "당근 API HTTP 오류: 403", result: {} }, 42);
  const item = h.data[REPORT].items[3];
  assert.equal(item.status, "failed");
  assert.equal(item.counts.expected, 1853);
  assert.equal(item.counts.processed, 500);
  assert.equal(item.message, "당근 API HTTP 오류: 403");
  assert.equal(h.data[RUN].summary.failed, 1);
});

test("provider auth, persisted-query and schema errors are terminal source failures", () => {
  for (const [message, code] of [
    ["당근 API HTTP 오류: 401", "provider_auth"],
    ["Forbidden", "provider_auth"],
    ["PersistedQueryNotFound", "provider_persisted_query"],
    ["Cannot query field articleByClusterId", "provider_schema"]
  ]) {
    const classification = hClassify(message);
    assert.equal(classification.retryable, false, message);
    assert.equal(classification.sourceCircuit, true, message);
    assert.equal(classification.code, code, message);
  }
  function hClassify(message) {
    const h = harness();
    return h.context.classifyTargetFailure(message, {});
  }
});

test("one provider 403 opens a circuit, fails its pending districts once, and keeps other sources untouched", async () => {
  const h = harness({ targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
    lastHeartbeatAt: clock, lastProgressAt: clock, targetAttempt: 1 });
  setCurrentDaangn(h);
  h.data[RUN].targets[4] = { ...h.data[RUN].targets[4], key: "daangn-dong", source: "daangn",
    label: "당근 동구", url: "https://realty.daangn.com/?test=dong" };
  h.data[REPORT].items[4] = { ...h.data[REPORT].items[4], key: "daangn-dong", source: "daangn", label: "당근 동구" };
  await h.context.finishCurrentTarget({ ok: false, runId: "cycle", targetRunId: "seo",
    message: "당근 API HTTP 오류: 403", result: {} }, 42);
  assert.equal(h.navigation.length, 0);
  assert.equal(h.data[REPORT].active, false);
  assert.equal(h.data[REPORT].items[3].status, "failed");
  assert.equal(h.data[REPORT].items[4].status, "failed");
  assert.equal(h.data[REPORT].items[4].circuitBlocked, true);
  assert.equal(h.data[REPORT].summary.completed, 3);
  assert.equal(h.data[REPORT].summary.failed, 2);
  assert.equal(h.data[CIRCUIT].daangn.code, "provider_auth");
});

test("legacy retry-only state rebuilds allTargets without re-adding completed Naver districts", async () => {
  const h = harness();
  const configured = structuredClone(h.data[CONFIG].targets);
  h.data[RUN].targets = [{ ...configured[3], retryCycle: 1 }];
  h.data[RUN].retryQueue = [];
  h.data[RUN].index = 0;
  h.data[RUN].currentTabId = null;
  h.data[RUN].targetRunId = null;
  h.data[RUN].phase = "retry-wait";
  h.data[RUN].retryAt = clock + 10 * minute;
  delete h.data[RUN].allTargets;
  delete h.data[RUN].completedKeys;
  h.data[REPORT].items.forEach((item, index) => {
    item.status = index === 3 ? "retry_wait" : "completed";
    item.source = "naver";
    item.label = configured[index].label;
  });
  await h.context.resumeOrExtendActiveRun(h.data[RUN], configured, "manual");
  assert.equal(h.data[RUN].targets.length, 1, "only the actual retry target stays in the execution queue");
  assert.equal(h.data[RUN].allTargets.length, 5, "the immutable run inventory is rebuilt");
  assert.deepEqual(h.data[RUN].completedKeys.sort(), ["naver-0", "naver-1", "naver-2", "naver-4"]);
  assert.equal(h.data[REPORT].items.length, 5);
  assert.equal(h.data[REPORT].summary.completed, 4);
});

test("finalization is idempotent and derives its totals from report rows", async () => {
  const h = harness({ summary: { completed: 99, failed: 88, errors: [{ message: "stale" }] } });
  h.data[REPORT].items.forEach((item) => { item.status = "completed"; });
  const state = h.data[RUN];
  const first = await h.context.finalizeRun(state);
  const second = await h.context.finalizeRun(state);
  assert.equal(first.completed, 5);
  assert.equal(first.failed, 0);
  assert.equal(first.ok, true);
  assert.equal(second.completed, 5);
  assert.equal((h.data[LOG] || []).filter((item) => /자동수집 종료/.test(item.message)).length, 1);
  assert.equal(h.data[REPORT].summary.completed, 5);
});

test("Daangn selection heartbeat is not promoted to collected counts", async () => {
  const h = harness({ targetStartedAt: clock - minute, runtimeStartedAt: clock - minute,
    lastHeartbeatAt: clock, lastProgressAt: clock });
  setCurrentDaangn(h);
  await h.dispatch({ type: "JS_AUTO_TARGET_HEARTBEAT", runId: "cycle", targetRunId: "seo",
    progressFingerprint: "daangn-selection", progressStage: {
      key: "selection", provisional: true, found: 1853, processed: 0, unchanged: 0
    } });
  await h.flush();
  assert.deepEqual(h.data[REPORT].items[3].counts, {});
  assert.equal(h.data[REPORT].items[3].progressStage.provisional, true);
});

test("the normal first provider load is not mistaken for a collector-page reload", async () => {
  const h = harness({
    phase: "loading",
    initialPageSignalPending: true,
    targetStartedAt: clock,
    runtimeStartedAt: null,
    lastHeartbeatAt: null,
    lastProgressAt: null
  });
  const initial = await h.dispatch({ type: "JS_AUTO_COLLECTOR_PAGE_LOADED" });
  assert.equal(initial.initialLoad, true);
  assert.equal(h.navigation.length, 0);
  assert.equal(h.data[RUN].initialPageSignalPending, false);

  const reload = await h.dispatch({ type: "JS_AUTO_COLLECTOR_PAGE_LOADED" });
  assert.equal(reload.reconnected, true);
  assert.equal(h.data[RUN].phase, "collecting");
  assert.equal(h.navigation.length, 0);
});

test("concurrent duplicate completion/old heartbeat cannot advance twice or restore Seo", async () => {
  const h = harness({ targetStartedAt: clock, lastHeartbeatAt: clock, lastProgressAt: clock,
    summary: { completed: 99, failed: 0, errors: [] } });
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
  assert.equal(response.backgroundBuild, "1.1.19");
  assert.equal(h.alarmMap.get("js-auto-collector-watchdog").periodInMinutes, 1);
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

test("a newly launched run keeps an ok start response while report rows are still active", async () => {
  const h = harness();
  delete h.data[RUN];
  delete h.data[REPORT];
  const response = await h.dispatch({ type: "JS_AUTO_RUN_NOW" });
  assert.equal(response.ok, true);
  assert.equal(response.started, true);
  assert.equal(response.total, 5);
  assert.equal(h.data[RUN].allTargets.length, 5);
  assert.equal(h.data[REPORT].items[0].status, "running");
});

test("content timeout at three hours defers Seo without restarting the whole run", async () => {
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

test("Naver completed legacy payload with one failure is settled as partial, without rerunning the district", async () => {
  const h=harness({targetStartedAt:clock-minute});
  await h.context.finishCurrentTarget({ok:true,runId:'cycle',targetRunId:'seo',result:{source:'naver',
    session:{ok:true,state:'completed',complete:true,completeRequested:true,expectedCount:8316,
      processedCount:8316,failed:1,addressMissing:81},totals:{failed:1}}},42);
  assert.equal(h.data[REPORT].items[3].status,'partial');
  assert.equal(h.data[REPORT].items[3].counts.failed,1);
  assert.equal(h.data[RUN].index,4);
  assert.equal(h.data[RUN].retryQueue.length,0);
});

test("stored legacy reports render partial locally without altering collection checkpoints or stored reports", async () => {
  const h=harness();
  h.data[REPORT].items.forEach(item=>{item.status='completed';item.counts={failed:0};});
  h.data[REPORT].items[3].counts.failed=1;
  const before=structuredClone(h.data);
  const report=await h.context.getRunReport();
  assert.equal(report.items[3].status,'partial');
  assert.equal(report.summary.partial,1);
  assert.deepEqual(h.data,before);
  const byMarket=await h.context.getRunReports();
  assert.equal(byMarket.lease.items[3].status,'partial');
  assert.deepEqual(h.data,before);
});

test("Gongsil server partial cannot become completed even with a legacy partial:false payload", async () => {
  const h=harness({targetStartedAt:clock-minute});
  await h.context.finishCurrentTarget({ok:true,runId:'cycle',targetRunId:'seo',result:{source:'gongsil',partial:false,
    selectedCount:2783,session:{ok:true,state:'partial',complete:false,completionValidated:false},
    completionIssues:['부분수집 요청'],totals:{found:2783,processed:2783,failed:0,
      presenceReported:true,presenceTrackingIssue:'부분수집: 없어진 광고 판정 보류'}}},42);
  assert.equal(h.data[REPORT].items[3].status,'partial');
  assert.equal(h.data[RUN].index,4);
  assert.equal(h.data[RUN].retryQueue.length,0);
  assert.match(h.data[REPORT].items[3].message,/종료판정보류/);
});

test("Daangn exhausted small scope proceeds once, with warning report and no retry queue", async () => {
  const h = harness({ targetStartedAt: clock - minute });
  const response = { ok: true, runId: "cycle", targetRunId: "seo", result: {
    source: "daangn", partial: true, completionIssues: ["관찰 원본 100건 미만"],
    totals: { status: "complete", phase: "complete", found: 45, failed: 0, addressMissing: 0,
      completionProof: { version: 1, listExhausted: true, expected: 45, observed: 45, processed: 45 } }
  } };
  await h.context.finishCurrentTarget(response, 42);
  assert.equal(h.data[RUN].index, 4); assert.equal(h.data[RUN].summary.completed, 4);
  assert.equal(h.data[RUN].retryQueue.length, 0);
  assert.equal(h.data[REPORT].items[3].status, "partial");
  assert.match(h.data[REPORT].items[3].message, /관찰 원본 100건 미만/);
});

test("current address-held wording advances the district once without a retry queue", async () => {
  const h = harness({ targetStartedAt: clock - minute });
  const response = { ...daangnResult(), runId: "cycle", targetRunId: "seo" };
  response.result.completionIssues = response.result.completionIssues.map(message => message.replace("주소·층 오류", "주소 미확인"));
  await h.context.finishCurrentTarget(response, 42);
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].retryQueue.length, 0);
  assert.equal(h.data[REPORT].items[3].status, "deferred");
  assert.equal(h.data[REPORT].items[3].counts.failed, 0);
  assert.equal(h.data[REPORT].items[3].counts.addressDeferred, 19);
  assert.equal(h.navigation.length, 1);
  assert.match(h.navigation[0], /test=4$/);
});

test("address-only Daangn holds persist accurate counts/reasons and finish without restarting the district", async () => {
  const h = harness({ targetStartedAt: clock - minute });
  h.data[REPORT].items[3].counts = { version: 2, expected: 9999, processed: 9000,
    unchanged: 8000, created: 99, updated: 99, review: 99 };
  h.data[REPORT].items[3].progressStage = { found: 9999, processed: 1000, unchanged: 8000 };
  const response = { ...daangnResult(), runId: "cycle", targetRunId: "seo" };
  await h.context.finishCurrentTarget(response, 42);
  const item = h.data[REPORT].items[3];
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].retryQueue.length, 0);
  assert.equal(item.status, "deferred");
  assert.equal(item.counts.expected, 2078);
  assert.equal(item.counts.processed, 2078);
  assert.equal(item.progressStage, null);
  assert.equal(item.counts.addressDeferred, 19);
  assert.equal(item.counts.failed, 0);
  assert.equal(item.diagnostics[0].sourceId, "2068835");
  assert.equal(item.diagnostics[0].raw, undefined);
  assert.match(item.message, /지도 등록 보류/);
  await h.context.finalizeRun(h.data[RUN]);
  assert.match(h.data[LOG][0].message, /정상 3, 주소보류 1, 부분완료 0, 실패 0/);
  assert.equal(h.data[LOG][0].level, "warning", "report rows keep an unfinished district from being reported as a successful run");
});

test("actual Daangn failure still enters the normal retry path", async () => {
  const h = harness({ targetStartedAt: clock - minute });
  const response = { ...daangnResult(), runId: "cycle", targetRunId: "seo" };
  response.result.totals.failed++;
  await h.context.finishCurrentTarget(response, 42);
  assert.equal(h.data[RUN].index, 4);
  assert.equal(h.data[RUN].retryQueue.length, 1);
  assert.equal(h.data[RUN].summary.completed, 3);
  assert.equal(h.data[REPORT].items[3].status, "retry_wait");
  assert.equal(h.data[REPORT].items[3].counts.failed, 1);
});

test("invalid transaction settings fail once and advance, without immediate or deferred retry", async () => {
  const h = harness({ targetStartedAt: clock - minute });
  await h.context.finishCurrentTarget({ ok: false, runId: "cycle", targetRunId: "seo",
    message: "당근 거래유형 설정 불일치: 수집 대상을 다시 등록해 주세요." }, 42);
  assert.equal(h.data[RUN].index, 4); assert.equal(h.data[RUN].retryQueue.length, 0);
  assert.equal(h.data[RUN].summary.failed, 1); assert.equal(h.data[REPORT].items[3].status, "failed");
});

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
