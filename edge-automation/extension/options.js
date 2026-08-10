"use strict";

let state = { config: { targets: [] }, logs: [], runState: null, runReport: null };
document.getElementById("autoVersion").textContent = `v${chrome.runtime.getManifest().version}`;

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

const STATUS_TEXT = {
  pending: "대기",
  running: "진행 중",
  retrying: "즉시 재시도",
  retry_wait: "재시도 대기",
  completed: "완료",
  partial: "부분완료",
  failed: "실패"
};

function reportItem(target) {
  const report = state.runReport;
  if (!report || !Array.isArray(report.items)) return null;
  const key = String(target.key || [target.source, target.district, target.url].join("|"));
  return report.items.find((item) => item.key === key) || null;
}

function countText(item) {
  const counts = item && item.counts || {};
  const parts = [];
  if (Number(counts.expected || 0)) {
    parts.push(`${Number(counts.processed || 0).toLocaleString("ko-KR")} / ${Number(counts.expected).toLocaleString("ko-KR")}건 확인`);
  } else if (Number(counts.processed || 0)) {
    parts.push(`${Number(counts.processed).toLocaleString("ko-KR")}건 확인`);
  }
  if (Number(counts.created || 0)) parts.push(`신규 ${Number(counts.created).toLocaleString("ko-KR")}`);
  if (Number(counts.updated || 0)) parts.push(`변경 ${Number(counts.updated).toLocaleString("ko-KR")}`);
  if (Number(counts.review || 0)) parts.push(`검증 ${Number(counts.review).toLocaleString("ko-KR")}`);
  if (Number(counts.failed || 0)) parts.push(`오류 ${Number(counts.failed).toLocaleString("ko-KR")}`);
  return parts.join(" · ");
}

function statusDetail(item) {
  if (!item) return "아직 실행 기록 없음";
  const counts = countText(item);
  const at = item.finishedAt || item.startedAt || item.updatedAt;
  const time = at ? registeredTime(at) : "";
  return [counts, item.message, time].filter(Boolean).join(" · ");
}

function renderRunSummary() {
  const report = state.runReport;
  if (!report || !Array.isArray(report.items)) {
    return '<div class="run-summary-empty">다음 실행부터 10개 구의 진행 결과가 이곳에 저장됩니다.</div>';
  }
  const counts = report.items.reduce((output, item) => {
    output[item.status] = Number(output[item.status] || 0) + 1;
    return output;
  }, {});
  const finished = Number(counts.completed || 0) + Number(counts.partial || 0);
  const running = Number(counts.running || 0) + Number(counts.retrying || 0);
  const waiting = Number(counts.pending || 0) + Number(counts.retry_wait || 0);
  const failed = Number(counts.failed || 0);
  return `<div class="run-summary-grid">
    <span><b>${report.active ? "수집 실행 중" : "최근 실행 결과"}</b><small>${registeredTime(report.startedAt)}</small></span>
    <span><b>${finished} / ${report.items.length}개 완료</b><small>부분완료 포함</small></span>
    <span><b>${running}개 진행</b><small>${waiting}개 대기</small></span>
    <span class="${failed ? "has-failure" : ""}"><b>${failed}개 실패</b><small>${failed ? "확인 필요" : "정상"}</small></span>
  </div>`;
}

function portableTarget(target) {
  return {
    source: target.source,
    key: target.key,
    label: target.label,
    url: target.url,
    district: target.district,
    selectionMode: target.selectionMode,
    selectedCount: target.selectedCount,
    mode: target.mode,
    enabled: target.enabled !== false,
    registeredAt: target.registeredAt
  };
}

function renderTarget(target, index) {
  const item = reportItem(target);
  const status = item ? item.status : "pending";
  return `<div class="item target-item">
    <div class="target-state state-${escapeHtml(status)}"><span>${escapeHtml(STATUS_TEXT[status] || status)}</span></div>
    <div class="item-info" title="${escapeHtml(target.url)}"><b>${escapeHtml(target.label || target.source)}</b><small>${escapeHtml(statusDetail(item))}</small><small class="target-registration">${escapeHtml(targetSummary(target))}</small></div>
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
  document.getElementById("runSummary").innerHTML = renderRunSummary();
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

document.getElementById("exportConfig").addEventListener("click", () => {
  const config = state.config || {};
  const payload = {
    format: "js-map-auto-collector",
    version: 1,
    exportedAt: new Date().toISOString(),
    config: {
      enabled: Boolean(config.enabled),
      schedule: config.schedule || "06:00",
      closeTabs: config.closeTabs !== false,
      targets: Array.isArray(config.targets) ? config.targets.map(portableTarget) : []
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `js-map-auto-collector-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message("설정 파일 저장 완료");
});

document.getElementById("importConfig").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format && payload.format !== "js-map-auto-collector") throw new Error("다른 종류의 설정 파일입니다.");
    const response = await runtime({ type: "JS_AUTO_IMPORT_CONFIG", config: payload });
    if (!response.ok) throw new Error(response.message || "설정을 가져오지 못했습니다.");
    state.config = response.config;
    render();
    message(`${state.config.targets.length}개 대상 복원 완료`);
  } catch (error) {
    message(error && error.message ? error.message : "설정 파일 오류");
  } finally {
    event.target.value = "";
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.jsAutoCollectorConfigV1 || changes.jsAutoCollectorLogsV1 || changes.jsAutoCollectorRunStateV2 || changes.jsAutoCollectorRunReportV1) load();
});

window.setInterval(load, 5000);

load();
