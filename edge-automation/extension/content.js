"use strict";

const RESULT_TIMEOUT_MS = 5 * 60 * 60 * 1000;

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false, message: chrome.runtime.lastError && chrome.runtime.lastError.message });
    });
  });
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
    document.documentElement.setAttribute("data-js-collector-auto-target", encodeURIComponent(JSON.stringify({ ...target, runId })));
    const old = document.getElementById("js-auto-collector-loader");
    if (old) old.remove();
    const script = document.createElement("script");
    script.id = "js-auto-collector-loader";
    script.src = `https://js-map.com/js/collector-loader.js?v=${Date.now()}`;
    script.onerror = () => finish({ ok: false, message: "최신 수집기를 불러오지 못했습니다." });
    (document.head || document.documentElement).appendChild(script);
    setTimeout(() => finish({ ok: false, message: "자동수집 제한시간을 초과했습니다." }), RESULT_TIMEOUT_MS);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "JS_AUTO_RUN_TARGET") return false;
  runPageCollector(message.target || {}, message.runId).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, message: String(error && error.message || error) });
  });
  return true;
});

if (/^https:\/\/(?:www\.)?js-map\.com\/collector-install/i.test(location.href)) {
  const query = new URLSearchParams(location.search);
  sendRuntimeMessage({ type: "JS_AUTO_PAGE_READY", autorun: query.get("js_auto_run") === "1" });
}
