"use strict";

const STORAGE_KEY = "jsAutoCollectorConfigV1";
const LOG_KEY = "jsAutoCollectorLogsV1";
const RUN_LOCK_KEY = "jsAutoCollectorRunLockV1";
const LAST_SCHEDULE_KEY = "jsAutoCollectorLastScheduleV1";
const ALARM_NAME = "js-auto-collector-daily";
const SOURCE_ORDER = { naver: 1, daangn: 2, gongsil: 3 };
const DEFAULT_CONFIG = {
  enabled: false,
  schedule: "06:00",
  closeTabs: true,
  targets: []
};

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

async function runScheduled(reason) {
  const config = await getConfig();
  if (!config.enabled || !scheduleIsDue(config)) return { ok: true, skipped: true, message: "예약 시간이 아직 되지 않았습니다." };
  const saved = await chrome.storage.local.get(LAST_SCHEDULE_KEY);
  const today = localDateKey();
  if (saved[LAST_SCHEDULE_KEY] === today) return { ok: true, skipped: true, message: "오늘 자동수집은 이미 실행했습니다." };
  await chrome.storage.local.set({ [LAST_SCHEDULE_KEY]: today });
  return runAll(reason);
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
  throw new Error("사이트 화면 로딩 시간이 초과됐습니다.");
}

async function sendRunMessage(tabId, target) {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "JS_AUTO_RUN_TARGET",
        target,
        runId: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      if (response) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError || new Error("자동수집 실행기에 연결하지 못했습니다.");
}

async function runTarget(target, config) {
  const tab = await chrome.tabs.create({ url: target.url, active: true });
  const startedAt = Date.now();
  try {
    await waitForTabComplete(tab.id);
    const result = await sendRunMessage(tab.id, target);
    if (!result || result.ok !== true) throw new Error(result && result.message || "수집기가 완료 결과를 보내지 않았습니다.");
    await appendLog({
      level: "success",
      source: target.source,
      target: target.label,
      elapsedMs: Date.now() - startedAt,
      result: result.result || {},
      message: `${target.label || target.source} 자동수집 완료`
    });
    return result;
  } catch (error) {
    await appendLog({
      level: "error",
      source: target.source,
      target: target.label,
      elapsedMs: Date.now() - startedAt,
      message: String(error && error.message || error)
    });
    throw error;
  } finally {
    if (config.closeTabs && tab && tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function acquireRunLock() {
  const saved = await chrome.storage.local.get(RUN_LOCK_KEY);
  const lock = saved[RUN_LOCK_KEY];
  if (lock && Date.now() - Number(lock.startedAt || 0) < 6 * 60 * 60 * 1000) return false;
  await chrome.storage.local.set({ [RUN_LOCK_KEY]: { startedAt: Date.now() } });
  return true;
}

async function runAll(reason = "manual") {
  if (!await acquireRunLock()) return { ok: false, message: "이미 자동수집이 실행 중입니다." };
  const config = await getConfig();
  const targets = config.targets
    .filter((target) => target.enabled !== false)
    .sort((a, b) => (SOURCE_ORDER[a.source] || 99) - (SOURCE_ORDER[b.source] || 99));
  const summary = { ok: true, reason, total: targets.length, completed: 0, failed: 0, errors: [] };
  await appendLog({ level: "info", message: `자동수집 시작 (${reason}, ${targets.length}개 대상)` });
  try {
    for (const target of targets) {
      try {
        await runTarget(target, config);
        summary.completed += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({ target: target.label || target.key, message: String(error && error.message || error) });
      }
    }
    summary.ok = summary.failed === 0;
    await appendLog({
      level: summary.ok ? "success" : "warning",
      message: `자동수집 종료: 성공 ${summary.completed}, 실패 ${summary.failed}`,
      result: summary
    });
    if (summary.failed) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.svg",
        title: "JS 자동수집 확인 필요",
        message: `성공 ${summary.completed}개, 실패 ${summary.failed}개`
      }).catch(() => {});
    }
    return summary;
  } finally {
    await chrome.storage.local.remove(RUN_LOCK_KEY);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await saveConfig(await getConfig());
  await chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  await resetAlarm(await getConfig());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runScheduled("schedule").catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) return { ok: false };
    if (message.type === "JS_AUTO_REGISTER_TARGET") {
      return { ok: true, config: await registerTarget(message.target) };
    }
    if (message.type === "JS_AUTO_GET_STATE") {
      const [config, stored] = await Promise.all([getConfig(), chrome.storage.local.get(LOG_KEY)]);
      return { ok: true, config, logs: stored[LOG_KEY] || [] };
    }
    if (message.type === "JS_AUTO_SAVE_CONFIG") {
      return { ok: true, config: await saveConfig(message.config || {}) };
    }
    if (message.type === "JS_AUTO_RUN_NOW") {
      return await runAll("manual");
    }
    if (message.type === "JS_AUTO_CLEAR_LOGS") {
      await chrome.storage.local.set({ [LOG_KEY]: [] });
      return { ok: true };
    }
    if (message.type === "JS_AUTO_PAGE_READY" && message.autorun) {
      runScheduled("windows-schedule").catch(() => {});
      if (_sender && _sender.tab && _sender.tab.id) {
        setTimeout(() => chrome.tabs.remove(_sender.tab.id).catch(() => {}), 1500);
      }
      return { ok: true };
    }
    return { ok: false };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, message: String(error && error.message || error) }));
  return true;
});
