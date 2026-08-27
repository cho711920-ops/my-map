"use strict";

// A code build ID, deliberately independent of getManifest(): an unpacked
// extension may show a new manifest while an old worker is still in memory.
const BACKGROUND_BUILD = "1.1.2";
let mutationQueue = Promise.resolve();
let healthCheckPending = false;
let lastHealthCheckAt = 0;

function serializeMutation(operation) {
  const next = mutationQueue.then(operation);
  mutationQueue = next.catch(() => {});
  return next;
}

async function logAutomationError(error) {
  await appendLog({ level: "error", message: "자동수집 제어 오류: " + String(error && error.message || error).slice(0, 300) });
}

// The status page and content heartbeats also wake the recovery guard. Do not
// depend solely on one alarm, and do not queue hundreds of checks while loading.
function requestHealthCheck() {
  if (healthCheckPending || Date.now() - lastHealthCheckAt < 60000) return;
  healthCheckPending = true;
  lastHealthCheckAt = Date.now();
  serializeMutation(async () => {
    await ensureWatchdogAlarm();
    return recoverAutomaticRun();
  }).catch(logAutomationError).catch(() => {}).finally(() => { healthCheckPending = false; });
}

const STORAGE_KEY = "jsAutoCollectorConfigV1";
const LOG_KEY = "jsAutoCollectorLogsV1";
const RUN_LOCK_KEY = "jsAutoCollectorRunLockV1";
const RUN_STATE_KEY = "jsAutoCollectorRunStateV2";
const RUN_REPORT_KEY = "jsAutoCollectorRunReportV1";
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
const COLLECTOR_START_TIMEOUT_MS = 2 * 60 * 1000;
const COLLECTION_STALL_TIMEOUT_MS = 20 * 60 * 1000;
const COLLECTION_HEARTBEAT_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_TARGET_RUNTIME_MS = 90 * 60 * 1000;
const DEFAULT_CONFIG = {
  enabled: false,
  schedule: "11:00",
  closeTabs: true,
  targets: []
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableTargetFailure(message) {
  return !/(?:로그인|보안키|승인되지 않은|주소·층 오류|한 지역 수집이 90분|자동수집할 .* 정보가 없습니다|최신 수집기를 불러오지 못했습니다)/
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
  const match = String(schedule || "11:00").match(/^(\d{1,2}):(\d{2})$/);
  const hour = match ? Math.min(23, Number(match[1])) : 11;
  const minute = match ? Math.min(59, Number(match[2])) : 0;
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now() + 30000) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function resetAlarm(config) {
  await chrome.alarms.clear(ALARM_NAME);
  await ensureWatchdogAlarm();
  if (!config.enabled) return;
  chrome.alarms.create(ALARM_NAME, {
    when: nextAlarmAt(config.schedule),
    periodInMinutes: 24 * 60
  });
}

async function ensureWatchdogAlarm() {
  const existing = await chrome.alarms.get(WATCHDOG_ALARM_NAME).catch(() => null);
  if (!existing) {
    chrome.alarms.create(WATCHDOG_ALARM_NAME, { periodInMinutes: 5 });
  }
}

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function scheduleIsDue(config, now = new Date()) {
  const match = String(config.schedule || "11:00").match(/^(\d{1,2}):(\d{2})$/);
  const targetMinutes = (match ? Number(match[1]) : 11) * 60 + (match ? Number(match[2]) : 0);
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
      tradeType: String(target && target.tradeType || "").slice(0, 20),
      marketMode: String(target && target.marketMode || "").slice(0, 40),
      saleCategory: String(target && target.saleCategory || "").slice(0, 40),
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      let timer;
      let response;
      try {
        response = await Promise.race([
          chrome.tabs.sendMessage(tabId, { type: "JS_AUTO_RUN_TARGET", target, runId, parentRunId }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("수집 탭 시작 응답이 40초 안에 없어 다시 연결합니다.")), 40000);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
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
  const now = Date.now();
  if (state.savedPhase !== state.phase || !state.phaseEnteredAt) state.phaseEnteredAt = now;
  state.savedPhase = state.phase;
  state.updatedAt = now;
  await chrome.storage.local.set({ [RUN_STATE_KEY]: state });
  return state;
}

async function getRunReport() {
  const saved = await chrome.storage.local.get(RUN_REPORT_KEY);
  return saved[RUN_REPORT_KEY] || null;
}

async function saveRunReport(report) {
  if (!report) return null;
  await chrome.storage.local.set({ [RUN_REPORT_KEY]: report });
  return report;
}

function resultCounts(result) {
  const payload = result && result.result || {};
  const session = payload.session || {};
  const totals = payload.totals || session.totals || {};
  const number = (...values) => {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return 0;
  };
  return {
    expected: number(session.expectedCount, session.manifestCount, totals.found, totals.total, payload.expectedCount, payload.selectedCount),
    processed: number(session.processedCount, session.observed, totals.processed, payload.processedCount, payload.processed, payload.selectedCount),
    created: number(payload.created, totals.created, session.created),
    updated: number(payload.updated, totals.updated, session.updated),
    review: number(payload.review, totals.review, session.review),
    unchanged: number(payload.unchanged, totals.unchanged, session.unchanged),
    failed: number(payload.failed, totals.failed, session.failed)
  };
}

async function updateRunReport(state, target, status, details = {}) {
  if (!state || !target) return null;
  const report = await getRunReport();
  if (!report || report.runId !== state.runId) return null;
  const key = targetKey(target);
  const item = report.items.find((entry) => entry.key === key);
  if (!item) return report;
  Object.assign(item, { status, updatedAt: Date.now(), ...details });
  report.active = Boolean(state.active);
  report.summary = { ...(state.summary || {}) };
  report.updatedAt = Date.now();
  return saveRunReport(report);
}

async function finalizeRun(state) {
  const summary = state.summary || { completed: 0, failed: 0, errors: [] };
  summary.ok = summary.failed === 0;
  await appendLog({
    level: summary.ok ? "success" : "warning",
    message: `자동수집 종료: 성공 ${summary.completed}, 실패 ${summary.failed}`,
    result: summary
  });
  const report = await getRunReport();
  if (report && report.runId === state.runId) {
    report.active = false;
    report.finishedAt = Date.now();
    report.updatedAt = Date.now();
    report.summary = { ...summary };
    await saveRunReport(report);
  }
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
  state.runtimeStartedAt = null;
  state.lastHeartbeatAt = null;
  state.lastProgressAt = null;
  state.lastProgressFingerprint = "";
  state.progressMessage = "";
  state.phase = "resuming";
  await saveRunState(state);
  await chrome.storage.local.set({ [RUN_LOCK_KEY]: { startedAt: Date.now() } });
  if (staleTabId) await chrome.tabs.remove(staleTabId).catch(() => {});
  await appendLog({ level: "info", message: reason || "중단된 자동수집을 저장 지점부터 이어서 실행합니다." });
  return launchCurrentTarget(state);
}

async function reconnectReloadedCollectorPage(senderTabId) {
  const state = await getRunState();
  const reconnectable = new Set(["loading", "starting-collector", "collecting"]);
  if (!state || !state.active || !reconnectable.has(state.phase)) {
    return { ok: true, skipped: true };
  }
  if (!Number.isInteger(senderTabId) || state.currentTabId !== senderTabId) {
    return { ok: true, skipped: true };
  }
  const target = (state.targets || [])[state.index];
  if (!target || !state.targetRunId) return { ok: true, skipped: true };
  try {
    state.phase = "starting-collector";
    state.progressMessage = "새로고침된 수집 화면 재연결 중";
    await saveRunState(state);
    await sendRunMessage(senderTabId, target, state.targetRunId, state.runId);
    const latest = await getRunState();
    if (!latest || latest.runId !== state.runId || latest.targetRunId !== state.targetRunId) {
      return { ok: true, skipped: true };
    }
    const now = Date.now();
    latest.phase = "collecting";
    latest.runtimeStartedAt = now;
    latest.lastHeartbeatAt = now;
    latest.lastProgressAt = now;
    latest.lastProgressFingerprint = "";
    latest.progressMessage = "수집 재연결 완료";
    await saveRunState(latest);
    await appendLog({
      level: "info",
      source: target.source,
      target: target.label,
      message: "수집 탭 새로고침을 감지해 마지막 저장 지점부터 즉시 다시 연결했습니다."
    });
    return { ok: true, reconnected: true };
  } catch (error) {
    await appendLog({
      level: "warning",
      source: target.source,
      target: target.label,
      message: "새로고침된 수집 탭 재연결에 실패해 새 탭으로 복구합니다."
    });
    await restartPersistedRun(state, "새로고침된 수집 탭을 새 탭에서 저장 지점부터 복구합니다.");
    return { ok: true, restarted: true, message: String(error && error.message || error) };
  }
}

async function updateTargetHeartbeat(message, senderTabId) {
  const state = await getRunState();
  const heartbeatPhases = new Set(["starting-collector", "collecting"]);
  if (!state || !state.active || !heartbeatPhases.has(state.phase)) return { ok: true, skipped: true };
  if (message.runId !== state.runId || message.targetRunId !== state.targetRunId) {
    return { ok: true, skipped: true };
  }
  if (!Number.isInteger(senderTabId) || senderTabId !== state.currentTabId) {
    return { ok: true, skipped: true };
  }
  await ensureWatchdogAlarm();
  const now = Date.now();
  const fingerprint = String(message.progressFingerprint || "").slice(0, 1_000);
  const progressMessage = String(message.progressMessage || "").slice(0, 180);
  state.lastHeartbeatAt = now;
  if (!state.lastProgressAt || (fingerprint && fingerprint !== state.lastProgressFingerprint)) {
    state.lastProgressAt = now;
    state.lastProgressFingerprint = fingerprint;
  }
  state.progressMessage = progressMessage;
  await saveRunState(state);
  const target = (state.targets || [])[state.index];
  if (target) await updateRunReport(state, target, "running", {
    message: progressMessage,
    progressUpdatedAt: now
  });
  return { ok: true, heartbeat: true };
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
    await updateRunReport(state, target, "running", {
      startedAt,
      finishedAt: null,
      message: "",
      attempt: Math.max(1, Number(state.targetAttempt || 1))
    });
    validateTarget(target);
    if (Number.isInteger(reuseTabId)) {
      tab = await chrome.tabs.update(reuseTabId, { url: target.url, active: false }).catch(() => null);
    }
    if (!tab) tab = await chrome.tabs.create({ url: target.url, active: false });
    state.currentTabId = tab.id;
    state.targetRunId = targetRunId;
    state.targetStartedAt = startedAt;
    state.runtimeStartedAt = null;
    state.lastHeartbeatAt = startedAt;
    state.lastProgressAt = startedAt;
    state.lastProgressFingerprint = "";
    state.progressMessage = "수집 화면 연결 중";
    state.phase = "loading";
    await saveRunState(state);
    await waitForTabComplete(tab.id);
    state.phase = "starting-collector";
    state.progressMessage = "수집 기능 시작 확인 중";
    await saveRunState(state);
    await sendRunMessage(tab.id, target, targetRunId, state.runId);
    const latest = await getRunState();
    if (latest && latest.runId === state.runId && latest.targetRunId === targetRunId) {
      const runtimeStartedAt = Date.now();
      latest.phase = "collecting";
      latest.runtimeStartedAt = runtimeStartedAt;
      latest.lastHeartbeatAt = runtimeStartedAt;
      latest.lastProgressAt = runtimeStartedAt;
      latest.progressMessage = "수집 기능 시작 확인 완료";
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

function completedTargetWithWarnings(result) {
  const payload = result && result.result || {};
  if (cleanSource(payload.source) === "daangn") {
    const job = payload.totals || {};
    const proof = job.completionProof || {};
    const issues = payload.completionIssues;
    const failed = Number(job.failed || 0);
    const addressMissing = Number(job.addressMissing || 0);
    // A finished small scope is NOT a validated full census. Keep missing-ad
    // protection on the server, but don't refetch an exhausted list all day.
    return result.ok === true && job.status === "complete" && job.phase === "complete" &&
      proof.version === 1 && proof.listExhausted === true && Number(proof.expected) > 0 &&
      Number(proof.expected) === Number(proof.observed) && Number(proof.processed) === Number(proof.observed) &&
      Number(job.found) === Number(proof.observed) && failed >= 0 && failed <= addressMissing &&
      Array.isArray(issues) && issues.every(issue =>
        /^(?:관찰 원본 100건 미만|실패 \d+건|주소·층 오류 \d+건)$/.test(String(issue)));
  }
  if (cleanSource(payload.source) !== "naver") return false;
  const session = payload.session || {};
  const expected = Number(session.expectedCount || session.manifestCount || 0);
  const observed = Number(session.processedCount || session.observed || 0);
  return session.completeRequested === true && expected > 0 && observed >= expected;
}

function cleanSource(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("naver") || text.includes("네이버")) return "naver";
  if (text.includes("daangn") || text.includes("danggeun") || text.includes("당근")) return "daangn";
  if (text.includes("gongsil") || text.includes("공실")) return "gongsil";
  return text;
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
  const warningCompletion = completedTargetWithWarnings(result);
  const payloadPartial = Boolean(result.result && result.result.partial);
  const failureMessage = String(result.message || (result.result && result.result.completionIssues || []).join(", ") ||
    "자동수집이 오류로 종료됐습니다.");
  const invalidTradeConfig = /당근 거래유형 설정/.test(failureMessage);
  const successful = result.ok === true && !payloadPartial;
  if (!successful && !warningCompletion && elapsedMs < MAX_TARGET_RUNTIME_MS &&
      targetAttempt < MAX_IMMEDIATE_ATTEMPTS && !invalidTradeConfig && retryableTargetFailure(failureMessage)) {
    const message = failureMessage;
    await appendLog({
      level: "warning",
      source: target.source,
      target: target.label,
      elapsedMs,
      message: `${message} · 같은 대상을 저장 지점부터 즉시 재시도 ${targetAttempt + 1}/${MAX_IMMEDIATE_ATTEMPTS}`
    });
    await updateRunReport(state, target, "retrying", {
      message,
      attempt: targetAttempt + 1
    });
    state.currentTabId = null;
    state.targetRunId = null;
    state.targetStartedAt = null;
    state.runtimeStartedAt = null;
    state.lastHeartbeatAt = null;
    state.lastProgressAt = null;
    state.lastProgressFingerprint = "";
    state.progressMessage = "";
    state.targetAttempt = targetAttempt + 1;
    state.phase = "retrying";
    await saveRunState(state);
    await delay(Math.min(10000, targetAttempt * 2500));
    return launchCurrentTarget(state, completedTabId);
  }
  if (successful || warningCompletion) {
    state.summary.completed += 1;
    const partial = result.ok !== true || Boolean(result.result && result.result.partial);
    if (partial) state.summary.partial = Number(state.summary.partial || 0) + 1;
    await appendLog({
      level: partial ? "warning" : "success",
      source: target.source,
      target: target.label,
      elapsedMs,
      result: result.result || {},
      message: partial
        ? `${target.label || target.source} 전체 목록 확인 완료 · 제공처 누락 항목은 부분수집으로 기록`
        : `${target.label || target.source} 자동수집 완료`
    });
    await updateRunReport(state, target, partial ? "partial" : "completed", {
      finishedAt: Date.now(),
      elapsedMs,
      message: partial ? "목록 처리 완료 · 확인사항: " + ((result.result.completionIssues || []).join(", ") || "일부 제공처 정보 누락") : "수집 완료",
      counts: resultCounts(result)
    });
  } else {
    const message = failureMessage;
    state.summary.retries = Number(state.summary.retries || 0) + 1;
    const retryTarget = { ...target, retryCycle: Number(target.retryCycle || 0) + 1 };
    state.summary.retryErrors = Array.isArray(state.summary.retryErrors) ? state.summary.retryErrors : [];
    state.summary.retryErrors.push({ target: target.label || target.key, message,
      cycle: retryTarget.retryCycle, at: new Date().toISOString() });
    state.summary.retryErrors = state.summary.retryErrors.slice(-40);
    const canRetry = !invalidTradeConfig && retryTarget.retryCycle <= MAX_DEFERRED_RETRY_CYCLES &&
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
    await updateRunReport(state, target, canRetry ? "retry_wait" : "failed", {
      finishedAt: canRetry ? null : Date.now(),
      elapsedMs,
      message,
      attempt: targetAttempt,
      counts: resultCounts(result)
    });
  }

  state.index += 1;
  state.currentTabId = null;
  state.targetRunId = null;
  state.targetStartedAt = null;
  state.runtimeStartedAt = null;
  state.lastHeartbeatAt = null;
  state.lastProgressAt = null;
  state.lastProgressFingerprint = "";
  state.progressMessage = "";
  state.targetAttempt = 1;
  state.phase = "between-targets";
  await saveRunState(state);
  return continueOrRetryCycle(state, completedTabId);
}

async function resumeOrExtendActiveRun(state, targets, reason) {
  await ensureWatchdogAlarm();
  await recoverAutomaticRun();
  state = await getRunState();
  if (!state || !state.active) return { ok: true, message: "미완료 실행을 정리했습니다. 현황을 확인해주세요." };
  const existingKeys = new Set((state.targets || []).map(targetKey));
  const addedTargets = targets.filter((target) => !existingKeys.has(targetKey(target)));
  if (addedTargets.length) {
    state.targets = (state.targets || []).concat(addedTargets);
    state.summary = state.summary || { completed: 0, failed: 0, errors: [] };
    state.summary.total = state.targets.length;
    await saveRunState(state);
    await appendLog({
      level: "info",
      message: `진행 중인 자동수집에 누락 대상 ${addedTargets.length}개를 추가했습니다. (전체 ${state.targets.length}개)`
    });
  }

  let report = await getRunReport();
  if (!report || report.runId !== state.runId) {
    report = {
      runId: state.runId,
      reason: state.reason || reason,
      active: true,
      startedAt: state.startedAt || Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      total: state.targets.length,
      summary: { ...state.summary },
      items: state.targets.map((target, index) => ({
        key: targetKey(target),
        source: target.source,
        label: target.label || target.source,
        status: index < state.index ? "completed" : index === state.index ? "running" : "pending",
        attempt: index === state.index ? Math.max(1, Number(state.targetAttempt || 1)) : 0,
        startedAt: index === state.index ? Number(state.targetStartedAt || Date.now()) : null,
        finishedAt: null,
        updatedAt: Date.now(),
        message: index < state.index ? "이전 실행에서 완료" : "",
        counts: {}
      }))
    };
  } else if (addedTargets.length) {
    const reportKeys = new Set((report.items || []).map((item) => item.key));
    report.items = (report.items || []).concat(addedTargets
      .filter((target) => !reportKeys.has(targetKey(target)))
      .map((target) => ({
        key: targetKey(target),
        source: target.source,
        label: target.label || target.source,
        status: "pending",
        attempt: 0,
        startedAt: null,
        finishedAt: null,
        updatedAt: Date.now(),
        message: "",
        counts: {}
      })));
  }
  report.active = true;
  report.total = report.items.length;
  report.summary = { ...state.summary };
  report.updatedAt = Date.now();
  await saveRunReport(report);

  let currentTab = null;
  if (Number.isInteger(state.currentTabId)) {
    currentTab = await chrome.tabs.get(state.currentTabId).catch(() => null);
  }
  const waitingForRetry = state.phase === "retry-wait" && Date.now() < Number(state.retryAt || 0);
  if (!currentTab && !waitingForRetry) {
    await restartPersistedRun(state, "멈춘 실행 지점을 복구해 자동수집을 계속합니다.");
  } else {
    await chrome.storage.local.set({ [RUN_LOCK_KEY]: { startedAt: Date.now() } });
  }

  const currentTarget = (state.targets || [])[Math.min(Number(state.index || 0), Math.max(0, state.targets.length - 1))];
  return {
    ok: true,
    started: true,
    resumed: true,
    added: addedTargets.length,
    total: state.targets.length,
    currentTarget: currentTarget && (currentTarget.label || currentTarget.source),
    reason,
    message: addedTargets.length
      ? `진행 중인 수집에 ${addedTargets.length}개를 추가해 전체 ${state.targets.length}개를 계속 실행합니다.`
      : `자동수집 정체 여부를 점검했습니다.${currentTarget ? ` 현재: ${currentTarget.label || currentTarget.source}` : ""}`
  };
}

async function runAll(reason = "manual") {
  await ensureWatchdogAlarm();
  const config = await getConfig();
  const targets = config.targets
    .filter((target) => target.enabled !== false)
    .sort((a, b) => (SOURCE_ORDER[a.source] || 99) - (SOURCE_ORDER[b.source] || 99));
  if (!targets.length) {
    return { ok: false, started: false, message: "사용 설정된 자동수집 대상이 없습니다." };
  }

  const activeState = await getRunState();
  if (activeState && activeState.active) {
    return resumeOrExtendActiveRun(activeState, targets, reason);
  }
  if (!await acquireRunLock()) return { ok: false, message: "자동수집 실행 상태를 확인하지 못했습니다. 다시 눌러주세요." };

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
  await saveRunReport({
    runId: state.runId,
    reason,
    active: true,
    startedAt: state.startedAt,
    updatedAt: state.startedAt,
    finishedAt: null,
    total: targets.length,
    summary: { ...summary },
    items: targets.map((target) => ({
      key: targetKey(target),
      source: target.source,
      label: target.label || target.source,
      status: "pending",
      attempt: 0,
      startedAt: null,
      finishedAt: null,
      updatedAt: state.startedAt,
      message: "",
      counts: {}
    }))
  });
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
  const now = Date.now();
  // Old/reloaded workers can persist a transition without target timestamps.
  // Use the per-target report before the cycle start; never treat "missing" as now.
  const report = await getRunReport();
  const target = (state.targets || [])[state.index];
  const reportItem = report && report.runId === state.runId &&
    (report.items || []).find((item) => item.key === targetKey(target));
  const targetStartedAt = Number(state.targetStartedAt || reportItem && reportItem.startedAt ||
    state.phaseEnteredAt || state.startedAt || 0);
  const elapsed = now - targetStartedAt;
  const transitionAge = now - Number(state.phaseEnteredAt || targetStartedAt);
  const knownRunningPhase = ["loading", "starting-collector", "collecting"].includes(state.phase);
  const stalledTransition = !knownRunningPhase && transitionAge > LOAD_STALL_TIMEOUT_MS;
  const missingTargetIdentity = !state.targetRunId || !Number.isInteger(state.currentTabId);
  if (stalledTransition || (missingTargetIdentity && elapsed > LOAD_STALL_TIMEOUT_MS)) {
    return restartPersistedRun(state, "자동수집 단계 연결이 3분 이상 중단돼 미완료 대상부터 복구합니다.");
  }
  const stalledLoading = state.phase === "loading" && elapsed > LOAD_STALL_TIMEOUT_MS;
  const stalledStart = state.phase === "starting-collector" && elapsed > COLLECTOR_START_TIMEOUT_MS;
  const stalledCollection = state.phase === "collecting" &&
    now - Number(state.lastProgressAt || state.runtimeStartedAt || targetStartedAt) > COLLECTION_STALL_TIMEOUT_MS;
  const disconnectedCollection = state.phase === "collecting" &&
    now - Number(state.lastHeartbeatAt || state.runtimeStartedAt || targetStartedAt) > COLLECTION_HEARTBEAT_TIMEOUT_MS;
  const targetRuntimeExceeded = ["loading", "starting-collector", "collecting"].includes(state.phase) &&
    elapsed > MAX_TARGET_RUNTIME_MS;
  if (stalledLoading || stalledStart || stalledCollection || disconnectedCollection || targetRuntimeExceeded) {
    const target = (state.targets || [])[state.index];
    const recoveryMessage = stalledLoading
      ? "수집 화면 로딩이 3분 동안 끝나지 않아 다시 시작합니다."
      : stalledStart
        ? "실제 수집 시작 확인이 2분 동안 없어 다시 시작합니다."
        : targetRuntimeExceeded
          ? "한 지역 수집이 90분을 넘어 다음 지역을 먼저 처리하고, 미완료 지역은 저장 지점부터 다시 시도합니다."
        : disconnectedCollection
          ? "수집 화면의 상태 신호가 8분 동안 없어 마지막 저장 지점부터 복구합니다."
          : "수집 화면의 숫자가 20분 동안 진행되지 않아 마지막 저장 지점부터 복구합니다.";
    if (now - Number(state.lastRecoveryNotificationAt || 0) > 15 * 60 * 1000) {
      state.lastRecoveryNotificationAt = now;
      await saveRunState(state);
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.svg",
        title: "JS 자동수집 자동복구",
        message: `${target && (target.label || target.source) || "현재 대상"} · ${recoveryMessage}`
      }).catch(() => {});
    }
    return finishCurrentTarget({
      runId: state.runId,
      targetRunId: state.targetRunId,
      ok: false,
      message: recoveryMessage
    }, state.currentTabId);
  }
  return { ok: true, active: true };
}

chrome.runtime.onInstalled.addListener(() => serializeMutation(async () => {
  const config = await getConfig();
  await resetAlarm(config);
  const state = await getRunState();
  if (state && state.active) {
    await restartPersistedRun(state, "자동수집기 업데이트 후 미완료 대상을 저장 지점부터 복구합니다.");
  } else {
    await chrome.storage.local.remove(RUN_LOCK_KEY);
  }
}).catch(logAutomationError));

chrome.runtime.onStartup.addListener(() => serializeMutation(async () => {
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
}).catch(logAutomationError));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) serializeMutation(() => runScheduled("schedule")).catch(logAutomationError);
  if (alarm.name === RECOVERY_ALARM_NAME || alarm.name === WATCHDOG_ALARM_NAME) {
    serializeMutation(() => recoverAutomaticRun()).catch(logAutomationError);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serializeMutation(async () => {
    const state = await getRunState();
    if (!state || !state.active || state.currentTabId !== tabId) return;
    return finishCurrentTarget({
      runId: state.runId,
      targetRunId: state.targetRunId,
      ok: false,
      message: "자동수집 탭이 수집 완료 전에 닫혔습니다."
    }, tabId);
  }).catch(logAutomationError);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    if (!message || !message.type) return { ok: false };
    if (message.type === "JS_AUTO_REGISTER_TARGET") {
      return { ok: true, config: await registerTarget(message.target) };
    }
    if (message.type === "JS_AUTO_TARGET_FINISHED") {
      return finishCurrentTarget(message, sender && sender.tab && sender.tab.id);
    }
    if (message.type === "JS_AUTO_TARGET_HEARTBEAT") {
      const response = await updateTargetHeartbeat(message, sender && sender.tab && sender.tab.id);
      requestHealthCheck();
      return response;
    }
    if (message.type === "JS_AUTO_GET_STATE") {
      const [config, stored, runState, runReport] = await Promise.all([
        getConfig(),
        chrome.storage.local.get(LOG_KEY),
        getRunState(),
        getRunReport()
      ]);
      return { ok: true, config, logs: stored[LOG_KEY] || [], runState, runReport,
        backgroundBuild: BACKGROUND_BUILD };
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
    if (message.type === "JS_AUTO_RUN_REQUEST") {
      const runState = await getRunState();
      if (runState && runState.active) {
        await ensureWatchdogAlarm();
        await recoverAutomaticRun();
        return { ok: true, resumed: true, runState: await getRunState() };
      }
      return message.forceRun ? runAll("windows-force") : runScheduled("windows-schedule");
    }
    if (message.type === "JS_AUTO_COLLECTOR_PAGE_LOADED") {
      return reconnectReloadedCollectorPage(sender && sender.tab && sender.tab.id);
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
      if (message.forceRun) await runAll("manual-verification");
      else await runScheduled("windows-schedule");
      if (sender && sender.tab && sender.tab.id) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1500);
      return { ok: true };
    }
    return { ok: false };
  };
  // Read-only status remains responsive even while a tab is loading. All
  // transitions/heartbeats are serialized so an old heartbeat cannot resurrect
  // a completed target or erase the next target's watchdog timestamps.
  const readOnly = message && message.type === "JS_AUTO_GET_STATE";
  if (readOnly) requestHealthCheck();
  (readOnly ? handle() : serializeMutation(handle)).then(sendResponse).catch((error) => {
    logAutomationError(error).catch(() => {});
    sendResponse({ ok: false, message: String(error && error.message || error) });
  });
  return true;
});
