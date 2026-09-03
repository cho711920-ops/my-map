"use strict";

const RESULT_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const START_ACK_TIMEOUT_MS = 35 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const collectorSessions = new Map();

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false, message: chrome.runtime.lastError && chrome.runtime.lastError.message });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableProgressText(value) {
  return String(value || "")
    .replace(/\b[\d,.]+\s*초\s*경과\b/g, "시간 경과")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "시각")
    .replace(/\s+/g, " ")
    .trim();
}

function collectorProgressSnapshot() {
  const panel = document.querySelector(
    "#js-naver-collector-panel,#js-daangn-collector-panel,#js-gongsil-collector-panel"
  );
  if (!panel) return {
    fingerprint: "panel-waiting",
    message: "공급처 수집 기능 연결 중",
    stage: { key: "loading", label: "화면 연결", percent: 0 }
  };
  const status = String(panel.querySelector("[data-role=status]")?.textContent || "").trim();
  const percent = String(panel.querySelector("[data-role=percent]")?.textContent || "").trim();
  const detail = String(panel.querySelector("[data-role=detail]")?.textContent || "").trim();
  const progress = String(panel.querySelector("[data-role=progress-bar]")?.style?.width || "").trim();
  const metrics = Array.from(panel.querySelectorAll("[data-metric],[data-role^=metric-]")).map((node) =>
    String(node.textContent || "").trim()).filter(Boolean).join("|");
  const metricValues = {};
  panel.querySelectorAll("[data-metric]").forEach((node) => {
    const key = String(node.getAttribute("data-metric") || "");
    if (!key) return;
    metricValues[key] = Math.max(0, Number(String(node.textContent || "0").replace(/[^\d.-]/g, "")) || 0);
  });
  const numericPercent = Math.max(0, Math.min(100, Number(percent.replace(/[^\d.]/g, "")) || 0));
  const stageKey = /완료/.test(status) ? "complete"
    : /저장/.test(status) && !/상세/.test(status) ? "save"
      : /상세|중복/.test(status) ? "detail"
        : /목록|클러스터/.test(status) ? "list" : "collect";
  const stageLabels = { loading: "화면 연결", list: "목록 확인", detail: "상세 조회", save: "저장", complete: "완료", collect: "수집" };
  const stage = {
    key: stageKey,
    label: stageLabels[stageKey] || "수집",
    percent: stageKey === "complete" ? 100 : numericPercent,
    found: metricValues.found || 0,
    processed: metricValues.processed || 0,
    unchanged: metricValues.skippedUnchanged || 0,
    remaining: metricValues.remaining || 0
  };
  // Elapsed seconds and clocks change even when the provider request is stuck.
  // Exclude them so the watchdog measures real page/count changes.
  const fingerprint = [status, percent, stableProgressText(detail), progress, metrics].join("|")
    .replace(/\s+/g, " ").slice(0, 1_000);
  return {
    fingerprint: fingerprint || "panel-ready",
    message: [status, percent].filter(Boolean).join(" · ").slice(0, 180) || "수집 진행 확인 중",
    stage
  };
}

function reportTargetHeartbeat(parentRunId, targetRunId) {
  const progress = collectorProgressSnapshot();
  return sendRuntimeMessage({
    type: "JS_AUTO_TARGET_HEARTBEAT",
    runId: parentRunId,
    targetRunId,
    progressFingerprint: progress.fingerprint,
    progressMessage: progress.message,
    progressStage: progress.stage
  });
}

async function reportTargetFinished(message) {
  let response = null;
  // A long collection can outlive the MV3 service worker. Completion messages
  // wake it again, but retry briefly so a cold restart cannot strand the run.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    response = await sendRuntimeMessage(message);
    if (response && response.ok) return response;
    await delay(1000);
  }
  return response || { ok: false, message: "자동수집 완료 결과를 전달하지 못했습니다." };
}

async function signalScheduledRun(autorun, forceRun) {
  let response = null;
  // On a cold Edge start the page can be ready before the Manifest V3 service
  // worker accepts messages. Retry instead of losing the day's only signal.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    response = await sendRuntimeMessage({ type: "JS_AUTO_PAGE_READY", autorun, forceRun });
    if (response && response.ok) return response;
    await delay(1000);
  }
  return response || { ok: false, message: "자동수집 실행기에 연결하지 못했습니다." };
}

async function signalCollectorPageLoaded() {
  const response = await sendRuntimeMessage({ type: "JS_AUTO_COLLECTOR_PAGE_LOADED" });
  return response || { ok: false };
}

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "JS_COLLECTOR_REGISTER_TARGET") return;
  sendRuntimeMessage({ type: "JS_AUTO_REGISTER_TARGET", target: event.data.target }).then((response) => {
    window.postMessage({
      type: "JS_COLLECTOR_REGISTER_RESULT",
      requestId: event.data.requestId,
      ok: Boolean(response && response.ok),
      message: response && response.ok ? "자동수집 대상에 등록했습니다." : response && response.message
    }, "*");
  });
});

function runPageCollector(target, runId, parentRunId) {
  const existing = collectorSessions.get(runId);
  if (existing) return existing;

  let startedResolve;
  let startedReject;
  const started = new Promise((resolve, reject) => {
    startedResolve = resolve;
    startedReject = reject;
  });
  const result = new Promise((resolve) => {
    let finished = false;
    let runtimeStarted = false;
    let heartbeatTimer = null;
    let startTimer = null;
    let resultTimer = null;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (startTimer) clearTimeout(startTimer);
      if (resultTimer) clearTimeout(resultTimer);
      window.removeEventListener("message", onMessage);
      if (!runtimeStarted) startedReject(new Error(value.message || "실제 수집 시작 신호를 받지 못했습니다."));
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.runId !== runId) return;
      if (event.data.type === "JS_COLLECTOR_AUTOMATION_STARTED") {
        if (!runtimeStarted) {
          runtimeStarted = true;
          if (startTimer) clearTimeout(startTimer);
          startedResolve({ ok: true, started: true });
        }
        return;
      }
      if (event.data.type !== "JS_COLLECTOR_AUTOMATION_RESULT") return;
      finish({ ok: Boolean(event.data.ok), message: event.data.message || "", result: event.data.result || {} });
    };
    window.addEventListener("message", onMessage);
    heartbeatTimer = setInterval(() => {
      reportTargetHeartbeat(parentRunId, runId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    setTimeout(() => reportTargetHeartbeat(parentRunId, runId).catch(() => {}), 5000);
    startTimer = setTimeout(() => {
      const progress = collectorProgressSnapshot();
      finish({
        ok: false,
        message: progress.fingerprint === "panel-waiting"
          ? "수집 기능 화면을 찾지 못했습니다. 공급처 화면 구조 변경 또는 수집기 로딩 오류를 확인해주세요."
          : "실제 수집 시작 신호를 35초 안에 받지 못했습니다. 공급처 응답과 수집기 버전을 확인해주세요."
      });
    }, START_ACK_TIMEOUT_MS);
    resultTimer = setTimeout(() => finish({ ok: false, message: "자동수집 제한시간을 초과했습니다." }), RESULT_TIMEOUT_MS);
    window.postMessage({ type: "JS_AUTO_START_MAIN", target, runId }, "*");
  });
  const session = { started, result, reportAttached: false };
  collectorSessions.set(runId, session);
  result.finally(() => collectorSessions.delete(runId));
  return session;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "JS_AUTO_PING_TARGET") {
    const progress = collectorProgressSnapshot();
    sendResponse({
      ok: true,
      active: collectorSessions.has(message.targetRunId),
      progressFingerprint: progress.fingerprint,
      progressMessage: progress.message,
      progressStage: progress.stage
    });
    return false;
  }
  if (!message || message.type !== "JS_AUTO_RUN_TARGET") return false;
  const session = runPageCollector(message.target || {}, message.runId, message.parentRunId);
  session.started.then(() => sendResponse({ ok: true, started: true })).catch((error) => {
    sendResponse({ ok: false, started: false, message: String(error && error.message || error) });
  });
  if (!session.reportAttached) {
    session.reportAttached = true;
    session.result.then((result) => {
      return reportTargetFinished({
        type: "JS_AUTO_TARGET_FINISHED",
        runId: message.parentRunId,
        targetRunId: message.runId,
        ok: Boolean(result && result.ok),
        message: result && result.message || "",
        result: result && result.result || {}
      });
    }).catch((error) => {
      return reportTargetFinished({
        type: "JS_AUTO_TARGET_FINISHED",
        runId: message.parentRunId,
        targetRunId: message.runId,
        ok: false,
        message: String(error && error.message || error)
      });
    });
  }
  return true;
});

if (/^https:\/\/(?:www\.)?js-map\.com\/collector-install/i.test(location.href)) {
  const query = new URLSearchParams(location.search);
  const forceRun = query.get("js_auto_force") === "1";
  signalScheduledRun(query.get("js_auto_run") === "1" || forceRun, forceRun);
}

if (/^(?:www\.)?js-map\.com$/i.test(location.hostname)) {
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "JS_AUTO_COLLECTOR_STATE_REQUEST") return;
    const requestId = String(event.data.requestId || "");
    sendRuntimeMessage({ type: "JS_AUTO_GET_STATE" }).then((response) => {
      const config = response && response.config || {};
      const runState = response && response.runState || null;
      const report = response && response.runReport || null;
      const logs = Array.isArray(response && response.logs) ? response.logs : [];
      window.postMessage({
        type: "JS_AUTO_COLLECTOR_STATE_RESULT",
        requestId,
        ok: Boolean(response && response.ok),
        state: {
          version: chrome.runtime.getManifest().version,
          enabled: Boolean(config.enabled),
          schedule: String(config.schedule || ""),
          targetCount: Array.isArray(config.targets) ? config.targets.filter((target) => target.enabled !== false).length : 0,
          runState,
          runReport: report,
          recentProblems: logs.filter((row) => /warning|error/.test(String(row.level || ""))).slice(0, 5)
        }
      }, "*");
    });
  });
}

if (/^(?:new|fin)\.land\.naver\.com$|^realty\.daangn\.com$|(?:^|\.)gongsilbox\.com$/i.test(location.hostname)) {
  // A provider SPA can reload the document while the extension still owns the
  // tab. Reconnect immediately instead of leaving a visually alive but idle tab.
  setTimeout(() => signalCollectorPageLoaded().catch(() => {}), 600);
}
