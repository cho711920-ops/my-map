"use strict";

const RESULT_TIMEOUT_MS = 5 * 60 * 60 * 1000;

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

async function signalScheduledRun(autorun) {
  let response = null;
  // On a cold Edge start the page can be ready before the Manifest V3 service
  // worker accepts messages. Retry instead of losing the day's only signal.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    response = await sendRuntimeMessage({ type: "JS_AUTO_PAGE_READY", autorun });
    if (response && response.ok) return response;
    await delay(1000);
  }
  return response || { ok: false, message: "자동수집 실행기에 연결하지 못했습니다." };
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

function runPageCollector(target, runId) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.source !== window || !event.data || event.data.type !== "JS_COLLECTOR_AUTOMATION_RESULT") return;
      if (event.data.runId !== runId) return;
      finish({ ok: Boolean(event.data.ok), message: event.data.message || "", result: event.data.result || {} });
    };
    window.addEventListener("message", onMessage);
    setTimeout(() => finish({ ok: false, message: "자동수집 제한시간을 초과했습니다." }), RESULT_TIMEOUT_MS);
    window.postMessage({ type: "JS_AUTO_START_MAIN", target, runId }, "*");
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "JS_AUTO_RUN_TARGET") return false;
  sendResponse({ ok: true, started: true });
  runPageCollector(message.target || {}, message.runId).then((result) => {
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
  return false;
});

if (/^https:\/\/(?:www\.)?js-map\.com\/collector-install/i.test(location.href)) {
  const query = new URLSearchParams(location.search);
  signalScheduledRun(query.get("js_auto_run") === "1");
}
