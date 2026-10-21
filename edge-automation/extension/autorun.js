"use strict";

// This file is read from disk even when Edge retains the old manifest/worker.
const EXPECTED_COLLECTOR_BUILD = "1.1.23";

const statusElement = document.getElementById("status");
document.title = `JS 자동수집 v${chrome.runtime.getManifest().version} 실행`;
const query = new URLSearchParams(location.search);
const forceRun = query.get("force") === "1";

function send(message, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, message: "자동수집 실행기 응답을 기다리는 중입니다." }), timeoutMs);
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      finish(response || { ok: false, message: error && error.message });
    });
  });
}

async function start() {
  const manifestVersion = chrome.runtime.getManifest().version;
  let workerState = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    workerState = await send({ type: "JS_AUTO_GET_STATE" }, 4000);
    if (workerState && workerState.ok === true && workerState.backgroundBuild) {
      if (workerState.backgroundBuild !== EXPECTED_COLLECTOR_BUILD || manifestVersion !== EXPECTED_COLLECTOR_BUILD) {
        if (workerState.runState && workerState.runState.active) {
          statusElement.textContent = "진행 중 수집을 유지합니다. 수집 종료 후 설정 화면에서 업데이트를 적용합니다.";
          return;
        }
        const key = "js-auto-reload-" + EXPECTED_COLLECTOR_BUILD;
        try {
          if (sessionStorage.getItem(key)) {
            statusElement.textContent = "실행기 업데이트를 확인하지 못했습니다. 전용 수집 브라우저를 다시 열어 주세요.";
            return;
          }
          sessionStorage.setItem(key, "1");
        } catch (_) {}
        statusElement.textContent = "업데이트된 자동수집 실행기를 적용하고 다시 연결합니다.";
        chrome.runtime.reload();
        return;
      }
      break;
    }
    statusElement.textContent = "자동수집 실행기 연결을 다시 확인하고 있습니다.";
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!workerState || workerState.ok !== true || !workerState.backgroundBuild) {
    statusElement.textContent = workerState && workerState.message || "자동수집 실행기 연결을 확인하지 못했습니다. 현황 화면에서 다시 확인해 주세요.";
    return;
  }
  let response = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await send({ type: "JS_AUTO_RUN_REQUEST", forceRun });
    if (response && response.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  statusElement.textContent = response && response.ok
    ? (response.resumed ? "중단 지점부터 상가임대 수집을 이어서 실행합니다." : response.message || "상가임대 자동수집을 시작했습니다.")
    : (response && response.message || "자동수집 실행 신호를 전달하지 못했습니다.");
  if (response && response.ok) {
    setTimeout(() => chrome.tabs.getCurrent((tab) => tab && chrome.tabs.remove(tab.id)), 1200);
  }
}

start();
