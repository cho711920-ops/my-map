"use strict";

const statusElement = document.getElementById("status");
document.title = `JS 자동수집 v${chrome.runtime.getManifest().version} 실행`;
const query = new URLSearchParams(location.search);
const forceRun = query.get("force") === "1";

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false, message: chrome.runtime.lastError && chrome.runtime.lastError.message });
    });
  });
}

async function start() {
  const manifestVersion = chrome.runtime.getManifest().version;
  const workerState = await send({ type: "JS_AUTO_GET_STATE" });
  if (!workerState || workerState.ok !== true || workerState.backgroundBuild !== manifestVersion) {
    statusElement.textContent = "업데이트된 자동수집 실행기를 적용하고 다시 연결합니다.";
    chrome.runtime.reload();
    return;
  }
  let response = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await send({ type: "JS_AUTO_RUN_REQUEST", forceRun });
    if (response && response.ok) break;
    // An unpacked MV3 extension can retain the previous background worker
    // after its files are upgraded. A response without a message means that
    // worker does not know this request yet. Reload once; the Windows launcher
    // opens a second internal trigger after the reload completes.
    if (response && response.ok === false && !response.message) {
      chrome.runtime.reload();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  statusElement.textContent = response && response.ok
    ? (response.resumed ? "중단 지점부터 자동수집을 이어서 실행합니다." : "네이버·당근 자동수집을 시작했습니다.")
    : (response && response.message || "자동수집 실행 신호를 전달하지 못했습니다.");
  if (response && response.ok) {
    setTimeout(() => chrome.tabs.getCurrent((tab) => tab && chrome.tabs.remove(tab.id)), 1200);
  }
}

start();
