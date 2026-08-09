"use strict";

const STORAGE_KEY = "jsAutoCollectorConfigV1";
const LOG_KEY = "jsAutoCollectorLogsV1";
const RUN_LOCK_KEY = "jsAutoCollectorRunLockV1";
const RUN_STATE_KEY = "jsAutoCollectorRunStateV2";
const LAST_SCHEDULE_KEY = "jsAutoCollectorLastScheduleV1";
const LAST_VERSION_RUN_KEY = "jsAutoCollectorLastVersionRunV1";
const ALARM_NAME = "js-auto-collector-daily";
const RECOVERY_ALARM_NAME = "js-auto-collector-recovery";
const WATCHDOG_ALARM_NAME = "js-auto-collector-watchdog";
const SOURCE_ORDER = { naver: 1, daangn: 2, gongsil: 3 };
const MAX_IMMEDIATE_ATTEMPTS = 4;
const MAX_DEFERRED_RETRY_CYCLES = 8;
const MAX_RUN_AGE_MS = 20 * 60 * 60 * 1000;
const LOAD_STALL_TIMEOUT_MS = 3 * 60 * 1000;
const COLLECTION_STALL_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONFIG = {
  enabled: false,
  schedule: "06:00",
  closeTabs: true,
  targets: []
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableTargetFailure(message) {
  return !/(?:로그인|보안키|승인되지 않은|자동수집할 .* 정보가 없습니다|최신 수집기를 불러오지 못했습니다)/
    .test(String(message || ""));
}

async function getConfig() {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  const value = saved[STORAGE_KEY] || {};
  return {
    ...DEFAULT_CONFIG,
    ...value,
    targets: Array.isArray(value.targets) ? value.targets : []
  };
}

async function saveConfig(next) {
  const config = { ...DEFAULT_CONFIG, ...next };
  config.targets = Array.isArray(config.targets) ? config.targets.slice(0, 40) : [];
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  await resetAlarm(config);
  return config;
}

function nextAlarmAt(schedule) {
  const match = String(schedule || "06:00").match(/^(\d{1,2}):(\d{2})$/);
  const hour = match ? Math.min(23, Number(match[1])) : 6;
  const minute = match ? Math.min(59, Number(match[2])) : 0;
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now() + 30000) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function resetAlarm(config) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.clear(WATCHDOG_ALARM_NAME);
  chrome.alarms.create(WATCHDOG_ALARM_NAME, { periodInMinutes: 5 });
  if (!config.enabled) return;
  chrome.alarms.create(ALARM_NAME, {
    when: nextAlarmAt(config.schedule),
    periodInMinutes: 24 * 60
  });
}

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function scheduleIsDue(config, now = new Date()) {
  const match = String(config.schedule || "06:00").match(/^(\d{1,2}):(\d{2})$/);
  const targetMinutes = (match ? Number(match[1]) : 6) * 60 + (match ? Number(match[2]) : 0);
  return now.getHours() * 60 + now.getMinutes() >= targetMinutes;
}

async function appendLog(entry) {
  const saved = await chrome.storage.local.get(LOG_KEY);
  const logs = Array.isArray(saved[LOG_KEY]) ? saved[LOG_KEY] : [];
  logs.unshift({ at: new Date().toISOString(), ...entry });
  await chrome.storage.local.set({ [LOG_KEY]: logs.slice(0, 100) });
}

function targetKey(target) {
  return String(target && (target.key || [target.source, target.district, target.url].join("|")) || "");
}

function validateTarget(target) {
  const source = String(target && target.source || "");
  const patterns = {
    naver: /^(?:new|fin)\.land\.naver\.com$/i,
    daangn: /^realty\.daangn\.com$/i,
    gongsil: /(?:^|\.)gongsilbox\.com$/i
  };
  let url;
  try {
    url = new URL(String(target && target.url || ""));
  } catch {
    throw new Error("자동수집 대상 주소가 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" || !patterns[source] || !patterns[source].test(url.hostname)) {
    throw new Error("허용되지 않은 자동수집 대상입니다.");
  }
  return { source, url: url.toString() };
}

function normalizePortableConfig(value) {
  const input = value && value.config && typeof value.config === "object" ? value.config : value;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("자동수집 설정 파일의 형식이 올바르지 않습니다.");
  }
  const schedule = String(input.schedule || DEFAULT_CONFIG.schedule);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule)) {
    throw new Error("실행 시간 형식이 올바르지 않습니다.");
  }
  const targets = (Array.isArray(input.targets) ? input.targets : []).slice(0, 40).map((target) => {
    const validated = validateTarget(target);
    const district = typeof target.district === "string"
      ? target.district.slice(0, 80)
      : target.district && typeof target.district === "object"
        ? { name: String(target.district.name || "").slice(0, 80), cortarNo: String(target.district.cortarNo || "").slice(0, 20) }
        : "";
    return {
      source: validated.source,
      url: validated.url,
      key: targetKey(target) || [validated.source, target && target.district, validated.url].join("|"),
      label: String(target && target.label || validated.source).slice(0, 120),
      district,
      selectionMode: String(target && target.selectionMode || "").slice(0, 40),
      selectedCount: Math.max(0, Number(target && target.selectedCount || 0)),
      mode: String(target && target.mode || "").slice(0, 40),
      enabled: target && target.enabled !== false,
      registeredAt: target && target.registeredAt || new Date().toISOString()
    };
  });
  return {
    enabled: Boolean(input.enabled),
    schedule,
    closeTabs: input.closeTabs !== false,
    targets
  };
}

async function registerTarget(target) {
  if (!target || !target.source || !target.url) throw new Error("자동수집 대상 정보가 부족합니다.");
  const validated = validateTarget(target);
  const config = await getConfig();
  const key = targetKey(target);
  const normalized = {
    ...target,
    source: validated.source,
    url: validated.url,
    key,
    enabled: target.enabled !== false,
    registeredAt: target.registeredAt || new Date().toISOString()
  };
  const index = config.targets.findIndex((item) => targetKey(item) === key);
  if (index >= 0) config.targets[index] = { ...config.targets[index], ...normalized };
  else config.targets.push(normalized);
  await saveConfig(config);
  await appendLog({ level: "info", source: target.source, message: `대상 등록: ${target.label || key}` });
  return config;
}

async function waitForTabComplete(tabId, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("자동수집 탭이 닫혔습니다.");
    if (tab.status === "complete") return tab;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("사이트 화면 로딩 시간을 초과했습니다.");
}

async function sendRunMessage(tabId, target, runId, parentRunId) {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "JS_AUTO_RUN_TARGET",
        target,
        runId,
        parentRunId
      });
      if (response && response.started === true) return response;
      if (response && response.ok === false) throw new Error(response.message || "자동수집 시작에 실패했습니다.");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError || new Error("자동수집 실행기에 연결하지 못했습니다.");
}

async function acquireRunLock() {
  const saved = await chrome.storage.local.get([RUN_LOCK_KEY, RUN_STATE_KEY]);
  const lock = saved[RUN_LOCK_KEY];
  const state = saved[RUN_STATE_KEY];
  if (lock && state && state.active && Date.now() - Number(lock.startedAt || 0) < 6 * 60 * 60 * 1000) return false;
  if (lock && (!state || !state.active)) await chrome.storage.local.remove(RUN_LOCK_KEY);
  await chrome.storage.local.set({ [RUN_LOCK_KEY]: { startedAt: Date.now() } });
  return true;
}

async function getRunState() {
  const saved = await chrome.storage.local.get(RUN_STATE_KEY);
  return saved[RUN_STATE_KEY] || null;
}

async function saveRunState(state) {
  await chrome.storage.local.set({ [RUN_STATE_KEY]: state });
  return state;
}

async function finalizeRun(state) {
  const summary = state.summary || { completed: 0, failed: 0, errors: [] };
  summary.ok = summary.failed === 0;
  await appendLog({
    level: summary.ok ? "success" : "warning",
    message: `자동수집 종료: 성공 ${summary.completed}, 실패 ${summary.failed}`,
    result: summary
  });
  if (summary.ok) {
    await chrome.storage.local.set({
      [LAST_SCHEDULE_KEY]: localDateKey(),
      [LAST_VERSION_RUN_KEY]: chrome.runtime.getManifest().version
    });
  }
  await chrome.alarms.clear(RECOVERY_ALARM_NAME);
  if (summary.failed) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.svg",
      title: "JS 자동수집 확인 필요",
      message: `성공 ${summary.completed}개 · 실패 ${summary.failed}개`
    }).catch(() => {});
  }
  await chrome.storage.local.remove([RUN_STATE_KEY, RUN_LOCK_KEY]);
  return summary;
}

async function restartPersistedRun(state, reason) {
  const staleTabId = state.currentTabId;
  state.currentTabId = null;
  state.targetRunId = null;
  state.targetStartedAt = null;
  state.phase = "resuming";
  await saveRunState(state);
  await chrome.storage.local.set({ [RUN_LOCK_KEY]: { startedAt: Date.now() } });
  if (staleTabId) await chrome.tabs.remove(staleTabId).catch(() => {});
  await appendLog({ level: "info", message: reason || "중단된 자동수집을 저장 지점부터 이어서 실행합니다." });
  return launchCurrentTarget(state);
}

async function scheduleRecovery(state, delayMinutes, message) {
  state.phase = "retry-wait";
  state.retryAt = Date.now() + Math.max(1, Number(delayMinutes) || 1) * 60 * 1000;
  await saveRunState(state);
  chrome.alarms.create(RECOVERY_ALARM_NAME, { when: state.retryAt });
  await appendLog({ level: "warning", message });
  return { ok: true, retryScheduled: true, retryAt: state.retryAt };
}

async function continueOrRetryCycle(state, completedTabId) {
  if (state.index < state.targets.length) return launchCurrentTarget(state, completedTabId);
  const retryQueue = Array.isArray(state.retryQueue) ? state.retryQueue : [];
  if (!retryQueue.length) {
    if (state.closeTabs && completedTabId) await chrome.tabs.remove(completedTabId).catch(() => {});
    return finalizeRun(state);
  }
  state.targets = retryQueue;
  state.retryQueue = [];
  state.index = 0;
  state.currentTabId = null;
  state.targetRunId = null;
  state.targetStartedAt = null;
  state.targetAttempt = 1;
  if (completedTabId) await chrome.tabs.remove(completedTabId).catch(() => {});
  const cycle = Math.max(...state.targets.map((target) => Number(target.retryCycle || 1)), 1);
  const delayMinutes = Math.min(30, 5 * cycle);
  return scheduleRecovery(state, delayMinutes,
    `미완료 대상 ${state.targets.length}개를 ${delayMinutes}분 뒤 마지막 저장 지점부터 다시 실행합니다.`);
}

async function launchCurrentTarget(state, reuseTabId = null) {
  if (!state || !state.active) return { ok: false, message: "실행 중인 자동수집이 없습니다." };
  if (state.index >= state.targets.length) return finalizeRun(state);

  const target = state.targets[state.index];
  const startedAt = Date.now();
  const targetRunId = `${state.runId}-${state.index}-${Math.random().toString(36).slice(2, 8)}`;
  let tab = null;
  try {
    validateTarget(target);
    if (Number.isInteger(reuseTabId)) {
      tab = await chrome.tabs.update(reuseTabId, { url: target.url, active: false }).catch(() => null);
    }
    if (!tab) tab = await chrome.tabs.create({ url: target.url, active: false });
    // 자동 대상 전환 때 전용 Edge 창이 앞으로 튀어나오지 않도록 항상
    // 백그라운드 최소화 상태를 유지한다.
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { state: "minimized" }).catch(() => {});
    }
    state.currentTabId = tab.id;
    state.targetRunId = targetRunId;
    state.targetStartedAt = startedAt;
    state.phase = "loading";
    await saveRunState(state);
    await waitForTabComplete(tab.id);
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { state: "minimized" }).catch(() => {});
    }
    await sendRunMessage(tab.id, target, targetRunId, state.runId);
    const latest = await getRunState();
    if (latest && latest.runId === state.runId && latest.targetRunId === targetRunId) {
      latest.phase = "collecting";
      await saveRunState(latest);
    }
    await appendLog({ level: "info", source: target.source, target: target.label, message: `${target.label || target.source} 자동수집 실행 중` });
    return { ok: true, started: true, target: target.label || target.source };
  } catch (error) {
    return finishCurrentTarget({
      runId: state.runId,
      targetRunId,
      ok: false,
      message: String(error && error.message || error)
    }, tab && tab.id);
  }
}

async function finishCurrentTarget(result, senderTabId) {
  const state = await getRunState();
  if (!state || !state.active || result.runId !== state.runId || result.targetRunId !== state.targetRunId) {
    return { ok: true, ignored: true };
  }
  if (state.currentTabId && senderTabId && state.currentTabId !== senderTabId) {
    return { ok: true, ignored: true };
  }

  const target = state.targets[state.index];
  const completedTabId = state.currentTabId;
  const elapsedMs = Date.now() - Number(state.targetStartedAt || Date.now());
  const targetAttempt = Math.max(1, Number(state.targetAttempt || 1));
  if (result.ok !== true && targetAttempt < MAX_IMMEDIATE_ATTEMPTS && retryableTargetFailure(result.message)) {
    const message = String(result.message || "자동수집이 오류로 종료됐습니다.");
    await appendLog({
      level: "warning",
      source: target.source,
      target: target.label,
      elapsedMs,
      message: `${message} · 같은 대상을 저장 지점부터 즉시 재시도 ${targetAttempt + 1}/${MAX_IMMEDIATE_ATTEMPTS}`
    });
    state.currentTabId = null;
    state.targetRunId = null;
    state.targetStartedAt = null;
    state.targetAttempt = targetAttempt + 1;
    state.phase = "retrying";
    await saveRunState(state);
    await delay(Math.min(10000, targetAttempt * 2500));
    return launchCurrentTarget(state, completedTabId);
  }
  if (result.ok === true) {
    state.summary.completed += 1;
    await appendLog({
      level: "success",
      source: target.source,
      target: target.label,
      elapsedMs,
      result: result.result || {},
      message: `${target.label || target.source} 자동수집 완료`
    });
  } else {
    const message = String(result.message || "자동수집이 오류로 종료됐습니다.");
    state.summary.retries = Number(state.summary.retries || 0) + 1;
    const retryTarget = { ...target, retryCycle: Number(target.retryCycle || 0) + 1 };
    state.summary.retryErrors = Array.isArray(state.summary.retryErrors) ? state.summary.retryErrors : [];
    state.summary.retryErrors.push({ target: target.label || target.key, message,
      cycle: retryTarget.retryCycle, at: new Date().toISOString() });
    state.summary.retryErrors = state.summary.retryErrors.slice(-40);
    const canRetry = retryTarget.retryCycle <= MAX_DEFERRED_RETRY_CYCLES &&
      Date.now() - Number(state.startedAt || Date.now()) < MAX_RUN_AGE_MS;
    state.retryQueue = Array.isArray(state.retryQueue) ? state.retryQueue : [];
    if (canRetry && !state.retryQueue.some((item) => targetKey(item) === targetKey(retryTarget))) {
      state.retryQueue.push(retryTarget);
    }
    if (!canRetry) {
      state.summary.failed = Number(state.summary.failed || 0) + 1;
      state.summary.errors.push({ target: target.label || target.key, message,
        attempts: targetAttempt, cycles: retryTarget.retryCycle, at: new Date().toISOString() });
    }
    await appendLog({ level: canRetry ? "warning" : "error", source: target.source, target: target.label, elapsedMs,
      message: canRetry
        ? `${message} · 다른 지역을 계속한 뒤 미완료 목록에서 다시 이어서 수집합니다.`
        : `${message} · 자동 재시도 한도를 모두 사용해 최종 실패로 기록했습니다.` });
  }

  state.index += 1;
  state.currentTabId = null;
  state.targetRunId = null;
  state.targetStartedAt = null;
  state.targetAttempt = 1;
  state.phase = "between-targets";
  await saveRunState(state);
  return continueOrRetryCycle(state, completedTabId);
}

async function runAll(reason = "manual") {
  if (!await acquireRunLock()) return { ok: false, message: "이미 자동수집이 실행 중입니다." };
  const config = await getConfig();
  const targets = config.targets
    .filter((target) => target.enabled !== false)
    .sort((a, b) => (SOURCE_ORDER[a.source] || 99) - (SOURCE_ORDER[b.source] || 99));
  if (!targets.length) {
    await chrome.storage.local.remove(RUN_LOCK_KEY);
    return { ok: false, started: false, message: "사용 설정된 자동수집 대상이 없습니다." };
  }

  const summary = { ok: true, started: true, reason, total: targets.length,
    completed: 0, failed: 0, retries: 0, errors: [], retryErrors: [] };
  const state = {
    active: true,
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reason,
    startedAt: Date.now(),
    index: 0,
    targets,
    retryQueue: [],
    closeTabs: config.closeTabs !== false,
    currentTabId: null,
    targetRunId: null,
    targetAttempt: 1,
    phase: "starting",
    summary
  };
  await appendLog({ level: "info", message: `자동수집 시작 (${reason}, ${targets.length}개 대상)` });
  await saveRunState(state);
  await launchCurrentTarget(state);
  return summary;
}

async function runScheduled(reason) {
  const config = await getConfig();
  if (!config.enabled || !scheduleIsDue(config)) return { ok: true, skipped: true, message: "예약 시간이 아직 되지 않았습니다." };
  const saved = await chrome.storage.local.get([LAST_SCHEDULE_KEY, LAST_VERSION_RUN_KEY]);
  const today = localDateKey();
  const currentVersion = chrome.runtime.getManifest().version;
  if (saved[LAST_SCHEDULE_KEY] === today && saved[LAST_VERSION_RUN_KEY] === currentVersion) {
    return { ok: true, skipped: true, message: "오늘 자동수집은 이미 실행했습니다." };
  }
  const result = await runAll(reason);
  return result;
}

async function recoverAutomaticRun() {
  const state = await getRunState();
  if (!state || !state.active) return { ok: true, skipped: true };
  if (state.phase === "retry-wait") {
    if (Date.now() + 1000 < Number(state.retryAt || 0)) return { ok: true, waiting: true };
    state.retryAt = null;
    state.phase = "resuming";
    await saveRunState(state);
    return launchCurrentTarget(state);
  }
  const elapsed = Date.now() - Number(state.targetStartedAt || Date.now());
  const stalledLoading = state.phase === "loading" && elapsed > LOAD_STALL_TIMEOUT_MS;
  const stalledCollection = state.phase === "collecting" && elapsed > COLLECTION_STALL_TIMEOUT_MS;
  if (stalledLoading || stalledCollection) {
    return finishCurrentTarget({
      runId: state.runId,
      targetRunId: state.targetRunId,
      ok: false,
      message: stalledLoading
        ? "수집기 시작 신호가 3분 동안 없어 다시 시작합니다."
        : "한 대상이 6시간 안에 끝나지 않아 마지막 저장 지점부터 복구합니다."
    }, state.currentTabId);
  }
  return { ok: true, active: true };
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await resetAlarm(config);
  const state = await getRunState();
  if (state && state.active) {
    await restartPersistedRun(state, "자동수집기 업데이트 후 미완료 대상을 저장 지점부터 복구합니다.");
  } else {
    await chrome.storage.local.remove(RUN_LOCK_KEY);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const config = await getConfig();
  await resetAlarm(config);
  const state = await getRunState();
  if (state && state.active) {
    if (state.phase === "retry-wait" && Date.now() < Number(state.retryAt || 0)) {
      await chrome.storage.local.set({ [RUN_LOCK_KEY]: { startedAt: Date.now() } });
      chrome.alarms.create(RECOVERY_ALARM_NAME, { when: Number(state.retryAt) });
      return;
    }
    await restartPersistedRun(state, "Edge 재시작 후 미완료 대상을 저장 지점부터 이어서 실행합니다.");
    return;
  }
  await chrome.storage.local.remove(RUN_LOCK_KEY);
  await runScheduled("browser-startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runScheduled("schedule").catch(() => {});
  if (alarm.name === RECOVERY_ALARM_NAME || alarm.name === WATCHDOG_ALARM_NAME) recoverAutomaticRun().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getRunState().then((state) => {
    if (!state || !state.active || state.currentTabId !== tabId) return;
    return finishCurrentTarget({
      runId: state.runId,
      targetRunId: state.targetRunId,
      ok: false,
      message: "자동수집 탭이 수집 완료 전에 닫혔습니다."
    }, tabId);
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) return { ok: false };
    if (message.type === "JS_AUTO_REGISTER_TARGET") {
      return { ok: true, config: await registerTarget(message.target) };
    }
    if (message.type === "JS_AUTO_TARGET_FINISHED") {
      return finishCurrentTarget(message, sender && sender.tab && sender.tab.id);
    }
    if (message.type === "JS_AUTO_GET_STATE") {
      const [config, stored, runState] = await Promise.all([
        getConfig(),
        chrome.storage.local.get(LOG_KEY),
        getRunState()
      ]);
      return { ok: true, config, logs: stored[LOG_KEY] || [], runState };
    }
    if (message.type === "JS_AUTO_SAVE_CONFIG") {
      return { ok: true, config: await saveConfig(message.config || {}) };
    }
    if (message.type === "JS_AUTO_IMPORT_CONFIG") {
      return { ok: true, config: await saveConfig(normalizePortableConfig(message.config)) };
    }
    if (message.type === "JS_AUTO_RUN_NOW") {
      return runAll("manual");
    }
    if (message.type === "JS_AUTO_CLEAR_LOGS") {
      await chrome.storage.local.set({ [LOG_KEY]: [] });
      return { ok: true };
    }
    if (message.type === "JS_AUTO_PAGE_READY" && message.autorun) {
      const runState = await getRunState();
      if (runState && runState.active) {
        if (sender && sender.tab && sender.tab.id) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1500);
        return { ok: true, resumed: true };
      }
      if (message.forceRun) runAll("manual-verification").catch(() => {});
      else runScheduled("windows-schedule").catch(() => {});
      if (sender && sender.tab && sender.tab.id) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1500);
      return { ok: true };
    }
    return { ok: false };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, message: String(error && error.message || error) }));
  return true;
});
