"use strict";

let state = { config: { targets: [] }, logs: [] };

const SOURCE_ORDER = ["naver", "daangn", "gongsil"];
const SOURCE_LABELS = { naver: "네이버", daangn: "당근", gongsil: "공실박스" };

function message(value) {
  document.getElementById("status").textContent = value;
}

function runtime(payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage(payload, (response) => resolve(response || { ok: false })));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function registeredTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function targetSummary(target) {
  const registered = registeredTime(target.registeredAt);
  if (target.source === "gongsil") {
    let zoom = "";
    try { zoom = new URL(target.url).searchParams.get("zoom") || ""; } catch (_) {}
    const count = Number(target.selectedCount || 0);
    return ["현재 화면 전체클러스터", zoom ? `확대 ${zoom}` : "", count ? `등록 ${count.toLocaleString("ko-KR")}개` : "", registered ? `${registered} 등록` : ""].filter(Boolean).join(" · ");
  }
  const district = typeof target.district === "string" ? target.district : target.district && target.district.name;
  return [district ? `${district} 구 단위` : "구 단위", "매일 자동수집", registered ? `${registered} 등록` : ""].filter(Boolean).join(" · ");
}

function renderTarget(target, index) {
  return `<div class="item target-item">
    <div class="item-info" title="${escapeHtml(target.url)}"><b>${escapeHtml(target.label || target.source)}</b><small>${escapeHtml(targetSummary(target))}</small></div>
    <div class="item-actions"><label><input type="checkbox" data-toggle="${index}" ${target.enabled !== false ? "checked" : ""}>사용</label><button data-remove="${index}">삭제</button></div>
  </div>`;
}

function renderTargets(targets) {
  if (!targets.length) return '<div class="empty">등록된 대상이 없습니다.</div>';
  const indexed = targets.map((target, index) => ({ target, index }));
  const sources = SOURCE_ORDER.concat([...new Set(indexed.map(({ target }) => target.source).filter((source) => !SOURCE_ORDER.includes(source)))]);
  return `<div class="target-groups">${sources.map((source) => {
    const items = indexed.filter(({ target }) => target.source === source);
    if (!items.length) return "";
    return `<div class="target-group"><div class="target-group-title"><h3>${escapeHtml(SOURCE_LABELS[source] || source)}</h3><span>${items.length}개 사용</span></div><div class="target-group-list">${items.map(({ target, index }) => renderTarget(target, index)).join("")}</div></div>`;
  }).join("")}</div>`;
}

function render() {
  const config = state.config || {};
  document.getElementById("enabled").checked = Boolean(config.enabled);
  document.getElementById("schedule").value = config.schedule || "06:00";
  document.getElementById("closeTabs").checked = config.closeTabs !== false;
  const targets = Array.isArray(config.targets) ? config.targets : [];
  document.getElementById("targets").innerHTML = renderTargets(targets);
  const logs = Array.isArray(state.logs) ? state.logs.slice(0, 30) : [];
  document.getElementById("logs").classList.add("log-list");
  document.getElementById("logs").innerHTML = logs.length ? logs.map((log) => `
    <div class="item"><div class="item-info"><b class="${escapeHtml(log.level)}">${escapeHtml(log.message)}</b><small>${escapeHtml(new Date(log.at).toLocaleString("ko-KR"))}</small></div></div>`).join("") : '<div class="empty">실행 기록이 없습니다.</div>';
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
