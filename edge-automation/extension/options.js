"use strict";

let state = { config: { targets: [] }, logs: [] };

function message(value) {
  document.getElementById("status").textContent = value;
}

function runtime(payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage(payload, (response) => resolve(response || { ok: false })));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function render() {
  const config = state.config || {};
  document.getElementById("enabled").checked = Boolean(config.enabled);
  document.getElementById("schedule").value = config.schedule || "06:00";
  document.getElementById("closeTabs").checked = config.closeTabs !== false;
  const targets = Array.isArray(config.targets) ? config.targets : [];
  document.getElementById("targets").innerHTML = targets.length ? targets.map((target, index) => `
    <div class="item"><div><b>${escapeHtml(target.label || target.source)}</b><small>${escapeHtml(target.url)}</small></div>
    <div><label><input type="checkbox" data-toggle="${index}" ${target.enabled !== false ? "checked" : ""}>사용</label> <button data-remove="${index}">삭제</button></div></div>`).join("") : '<div class="empty">등록된 대상이 없습니다.</div>';
  const logs = Array.isArray(state.logs) ? state.logs.slice(0, 30) : [];
  document.getElementById("logs").innerHTML = logs.length ? logs.map((log) => `
    <div class="item"><div><b class="${escapeHtml(log.level)}">${escapeHtml(log.message)}</b><small>${escapeHtml(new Date(log.at).toLocaleString("ko-KR"))}</small></div></div>`).join("") : '<div class="empty">실행 기록이 없습니다.</div>';
}

async function load() {
  const response = await runtime({ type: "JS_AUTO_GET_STATE" });
  if (response.ok) state = response;
  render();
  message(response.ok ? "준비됨" : "연결 오류");
}

document.getElementById("save").addEventListener("click", async () => {
  state.config.enabled = document.getElementById("enabled").checked;
  state.config.schedule = document.getElementById("schedule").value || "06:00";
  state.config.closeTabs = document.getElementById("closeTabs").checked;
  const response = await runtime({ type: "JS_AUTO_SAVE_CONFIG", config: state.config });
  if (response.ok) state.config = response.config;
  message(response.ok ? "저장 완료" : "저장 실패");
  render();
});

document.getElementById("run").addEventListener("click", async () => {
  message("자동수집 실행 중");
  const response = await runtime({ type: "JS_AUTO_RUN_NOW" });
  message(response.ok ? "실행 완료" : response.message || "일부 실패");
  await load();
});

document.getElementById("targets").addEventListener("change", async (event) => {
  const index = Number(event.target.dataset.toggle);
  if (!Number.isInteger(index) || !state.config.targets[index]) return;
  state.config.targets[index].enabled = event.target.checked;
  await runtime({ type: "JS_AUTO_SAVE_CONFIG", config: state.config });
});

document.getElementById("targets").addEventListener("click", async (event) => {
  const index = Number(event.target.dataset.remove);
  if (!Number.isInteger(index) || !state.config.targets[index]) return;
  state.config.targets.splice(index, 1);
  const response = await runtime({ type: "JS_AUTO_SAVE_CONFIG", config: state.config });
  if (response.ok) state.config = response.config;
  render();
});

document.getElementById("clear").addEventListener("click", async () => {
  await runtime({ type: "JS_AUTO_CLEAR_LOGS" });
  await load();
});

load();
