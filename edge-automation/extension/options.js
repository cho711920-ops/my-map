"use strict";

let state = { config: { targets: [] }, logs: [], runState: null, runReport: null, runReports: {} };
const selectedOnce = new Set();
let runPreviewMode = "all";
let runPreviewMarket = "lease";
let runLaunchPending = false;
let settingsDirty = false;
function keyForTarget(target) { return String(target.key || [target.source, target.district, target.url].join("|")); }
document.getElementById("autoVersion").textContent = `v${chrome.runtime.getManifest().version}`;

const SOURCE_ORDER = ["naver", "daangn", "gongsil"];
const SOURCE_LABELS = { naver: "네이버", daangn: "당근", gongsil: "공실박스" };
const MARKET_LABELS = { lease: "상가임대", sale: "매매" };

function compatibleWorker(response = state) {
  return Boolean(response && response.backgroundBuild && response.backgroundBuild === chrome.runtime.getManifest().version);
}

function marketForTarget(target) {
  const explicit = String(target && target.tradeType || "").toLowerCase();
  if (explicit === "sale" || explicit === "lease") return explicit;
  const searchable = [target && target.key, target && target.label, target && target.marketMode,
    target && target.saleCategory].filter(Boolean).join(" ");
  if (/(?:^|[-_\s])(sale|매매)(?:$|[-_\s])|건물매매|토지매매/i.test(searchable)) return "sale";
  try {
    const url = new URL(String(target && target.url || ""));
    if (String(url.searchParams.get("tradeType") || url.searchParams.get("tradeTypes") || "").toUpperCase().split(/[,:]/).includes("A1")) return "sale";
    const filter = JSON.parse(url.searchParams.get("af") || "{}");
    if (Array.isArray(filter.tradeTypes) && filter.tradeTypes.some(value => /BUY|SALE/i.test(String(value)))) return "sale";
  } catch (_) {}
  return "lease";
}

function reportForMarket(market) {
  const saved = state.runReports && state.runReports[market];
  if (saved && Array.isArray(saved.items)) return saved;
  const latest = state.runReport;
  if (!latest || !Array.isArray(latest.items)) return null;
  const targets = Array.isArray(state.config && state.config.targets) ? state.config.targets : [];
  const items = latest.items.filter(item => {
    const target = targets.find(candidate => keyForTarget(candidate) === item.key);
    return (target ? marketForTarget(target) : latest.market || marketForTarget(item)) === market;
  });
  return items.length ? { ...latest, items } : null;
}

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
  const market = MARKET_LABELS[marketForTarget(target)];
  const execution = marketForTarget(target) === "sale" ? "수동 실행 전용" : target.enabled !== false ? "매일 자동실행" : "자동실행 꺼짐 · 수동 수집 가능";
  if (target.source === "gongsil") {
    let zoom = "";
    try { zoom = new URL(target.url).searchParams.get("zoom") || ""; } catch (_) {}
    const count = Number(target.selectedCount || 0);
    return [market, "현재 화면 전체클러스터", execution, zoom ? `확대 ${zoom}` : "", count ? `등록 ${count.toLocaleString("ko-KR")}개` : "", registered ? `${registered} 등록` : ""].filter(Boolean).join(" · ");
  }
  const district = typeof target.district === "string" ? target.district : target.district && target.district.name;
  return [market, district ? `${district} 구 단위` : "구 단위", execution, registered ? `${registered} 등록` : ""].filter(Boolean).join(" · ");
}

const STATUS_TEXT = {
  pending: "대기",
  running: "진행 중",
  retrying: "즉시 재시도",
  retry_wait: "재시도 대기",
  completed: "완료",
  deferred: "수집완료·주소보류",
  partial: "부분완료",
  failed: "실패"
};

function reportItem(target) {
  const report = reportForMarket(marketForTarget(target));
  if (!report || !Array.isArray(report.items)) return null;
  const key = String(target.key || [target.source, target.district, target.url].join("|"));
  return report.items.find((item) => item.key === key) || null;
}

function displayCounts(item, target) {
  let counts = { ...(item && item.counts || {}) };
  const daangn = /daangn|danggeun|당근/.test(String(item && item.source || target && target.source || ""));
  const terminalComplete = item && ["completed", "partial", "deferred"].includes(item.status);
  const provisionalStage = Boolean(daangn && item && item.progressStage && item.progressStage.provisional === true);
  const stage = daangn && !terminalComplete && !provisionalStage && item && item.progressStage && typeof item.progressStage === "object"
    ? item.progressStage
    : null;
  if (stage) {
    const number = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    };
    const detailProcessed = number(stage.processed);
    const unchanged = number(stage.unchanged);
    const progress = {
      version: 2,
      expected: number(stage.found),
      processed: detailProcessed + unchanged,
      detailProcessed,
      unchanged,
      created: number(stage.created),
      updated: number(stage.updated),
      review: number(stage.review),
      addressDeferred: number(stage.addressMissing),
      failed: number(stage.failed),
      listComplete: false
    };
    const numericKeys = new Set([
      "expected", "processed", "detailProcessed", "unchanged",
      "created", "updated", "review", "addressDeferred", "failed"
    ]);
    Object.entries(progress).forEach(([key, value]) => {
      if (numericKeys.has(key)) counts[key] = Math.max(Number(counts[key] || 0), Number(value || 0));
      else if (key === "listComplete") counts[key] = counts[key] === true || value === true;
      else counts[key] = value;
    });
  }
  if (provisionalStage && counts.version !== 2) counts.version = 2;
  if (counts.version !== 2 && daangn) {
    // Old reports did not persist unchanged counts. Never invent a full census.
    counts.legacyDaangn = true;
    const match = String(item && item.message || "").match(/주소·층 오류 (\d+)건/);
    if (match) {
      counts.addressDeferred = Math.min(Number(counts.failed || 0), Number(match[1]));
      counts.failed = Math.max(0, Number(counts.failed || 0) - counts.addressDeferred);
    }
  }
  const registeredExpected = Number(target && target.selectedCount || item && item.selectedCount || 0);
  if (daangn && !Number(counts.expected || 0) && registeredExpected > 0) {
    counts.expected = registeredExpected;
    counts.registeredExpected = true;
    counts.legacyDaangn = false;
  }
  return counts;
}

function countText(item, target) {
  const counts = displayCounts(item, target);
  const parts = [];
  if (counts.legacyDaangn) {
    parts.push(`이전 기록: 대상 ${Number(counts.expected || 0).toLocaleString("ko-KR")} · 상세 처리 ${Number(counts.processed || 0).toLocaleString("ko-KR")}건`);
  } else if (Number(counts.expected || 0)) {
    parts.push(`${Number(counts.processed || 0).toLocaleString("ko-KR")} / ${Number(counts.expected).toLocaleString("ko-KR")}건 확인${counts.registeredExpected ? " (등록 기준)" : ""}`);
  } else if (Number(counts.processed || 0)) {
    parts.push(`${Number(counts.processed).toLocaleString("ko-KR")}건 확인`);
  } else if (counts.version === 2) {
    parts.push("목록 0건 · 확인 0건 (집계 전)");
  }
  if (Number(counts.created || 0)) parts.push(`신규 ${Number(counts.created).toLocaleString("ko-KR")}`);
  if (Number(counts.updated || 0)) parts.push(`변경 ${Number(counts.updated).toLocaleString("ko-KR")}`);
  if (Number(counts.review || 0)) parts.push(`검증 ${Number(counts.review).toLocaleString("ko-KR")}`);
  if (Number(counts.unchanged || 0)) parts.push(`기존 동일 ${Number(counts.unchanged).toLocaleString("ko-KR")}`);
  if (Number(counts.addressDeferred || 0)) parts.push(`주소 보류 ${Number(counts.addressDeferred).toLocaleString("ko-KR")}`);
  if (Number(counts.failed || 0)) parts.push(`오류 ${Number(counts.failed).toLocaleString("ko-KR")}`);
  return parts.join(" · ");
}

function statusDetail(item, target) {
  if (!item) return "아직 실행 기록 없음";
  const counts = countText(item, target);
  const at = item.finishedAt || item.startedAt || item.updatedAt;
  const time = at ? registeredTime(at) : "";
  const display = displayCounts(item, target);
  const detail = display.legacyDaangn && display.addressDeferred
    ? "정확한 지번 미제공 · 지도 등록 보류" + (display.failed ? " · 조회·저장 실패도 확인 필요" : "")
    : item.message;
  const help = item && item.status === "failed" ? failureGuidance(item) : "";
  return [counts, detail, help, time].filter(Boolean).join(" · ");
}

function failureGuidance(item) {
  const message = String(item.terminalCode || "") + " " + String(item.message || "");
  if (/provider_auth|401|403|로그인|보안키|승인되지/.test(message)) return "조치: 공급처 로그인과 수집 승인을 먼저 확인하세요.";
  if (/provider_schema|provider_persisted_query|GraphQL|스키마|최신 수집기/.test(message)) return "조치: 공급처 API·수집기 업데이트 확인 후 다시 실행하세요.";
  if (/주소|지번/.test(message)) return "조치: 원본에서 정확한 주소 확인이 필요합니다.";
  return "조치: 연결 상태를 확인한 뒤 실패한 지역만 다시 실행할 수 있습니다.";
}

function reportStatus(item) {
  const counts = displayCounts(item);
  if (item && item.status === "deferred") return "수집완료·주소보류";
  return item && item.status === "partial" && counts.version === 2 && counts.listComplete &&
    counts.addressDeferred > 0 && !counts.failed ? "완료·주소보류" : STATUS_TEXT[item && item.status] || "대기";
}

function renderDiagnostics(item) {
  const rows = item && Array.isArray(item.diagnostics) ? item.diagnostics : [];
  if (!rows.length) return "";
  return `<details class="target-diagnostics"><summary>보류·실패 내역 (최근 ${rows.length}건)</summary>
    <p>정확한 번지 없는 원본은 보존하며 지도 등록은 보류합니다. 다음 수집에서 다시 확인합니다. 아래는 재시도 중 발생한 오류도 포함한 최근 기록입니다.</p>
    <ul>${rows.map(row => {
      const id = String(row.sourceId || "");
      const label = /^\d+$/.test(id)
        ? `<a href="https://realty.daangn.com/?article_id=%22${id}%22&amp;panel_stack=article" target="_blank" rel="noopener noreferrer">당근 ${id} ↗</a>`
        : escapeHtml(id || "번호 미확인");
      return `<li>${label} · ${escapeHtml(row.message || "확인 필요")}</li>`;
    }).join("")}</ul></details>`;
}

function renderRunSummary(report = state.runReport) {
  if (!report || !Array.isArray(report.items)) {
    return '<div class="run-summary-empty">아직 실행 기록이 없습니다. 이 거래유형의 수집 결과만 여기에 표시됩니다.</div>';
  }
  const counts = report.items.reduce((output, item) => {
    const normalizedStatus = reportStatus(item) === "완료·주소보류" ? "deferred" : item.status;
    output[normalizedStatus] = Number(output[normalizedStatus] || 0) + 1;
    return output;
  }, {});
  const finished = Number(counts.completed || 0) + Number(counts.partial || 0);
  const deferred = Number(counts.deferred || 0);
  const processed = finished + deferred;
  const running = Number(counts.running || 0) + Number(counts.retrying || 0);
  const waiting = Number(counts.pending || 0) + Number(counts.retry_wait || 0);
  const failed = Number(counts.failed || 0);
  return `<div class="run-summary-grid">
    <span><b>${report.active ? "수집 실행 중" : "최근 실행 결과"}</b><small>${registeredTime(report.startedAt)}</small></span>
    <span><b>${processed} / ${report.items.length}개 처리 종료</b><small>정상 ${Number(counts.completed || 0)} · 주소보류 ${deferred} · 부분 ${Number(counts.partial || 0)}</small></span>
    <span><b>${running}개 진행</b><small>${waiting}개 대기</small></span>
    <span class="${failed ? "has-failure" : ""}"><b>${failed}개 실패</b><small>${failed ? "실패 내역 확인" : counts.partial ? "부분완료 내역 확인" : deferred ? "주소보류 검토 가능" : report.active ? "진행 중" : "정상"}</small></span>
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
    tradeType: target.tradeType,
    marketMode: target.marketMode,
    saleCategory: target.saleCategory,
    enabled: marketForTarget(target) === "lease" && target.enabled !== false,
    registeredAt: target.registeredAt
  };
}

function renderTarget(target, index) {
  const item = reportItem(target);
  const status = item ? item.status : "pending";
  const schedule = marketForTarget(target) === "lease"
    ? `<label><input type="checkbox" data-toggle="${index}" ${target.enabled !== false ? "checked" : ""}>매일 자동실행</label>`
    : '<span class="manual-only">자동수집 안 함</span>';
  return `<div class="item target-item" data-report-key="${escapeHtml(String(target.key || index))}">
    <div class="target-state state-${escapeHtml(status)}"><span>${escapeHtml(reportStatus(item))}</span></div>
    <div class="item-info" title="${escapeHtml(target.url)}"><b>${escapeHtml(target.label || target.source)}</b><small class="target-result">${escapeHtml(statusDetail(item, target))}</small><small class="target-registration">${escapeHtml(targetSummary(target))}</small>${renderDiagnostics(item)}</div>
    <div class="item-actions"><label><input type="checkbox" data-once="${index}" ${selectedOnce.has(keyForTarget(target)) ? "checked" : ""}>이번에 수집</label>${schedule}<button data-remove="${index}">삭제</button></div>
  </div>`;
}

function renderSourceGroups(indexed, market) {
  if (!indexed.length) return `<div class="empty">등록된 ${MARKET_LABELS[market]} 대상이 없습니다. 공급처에서 거래유형을 선택한 뒤 수집 대상으로 등록해 주세요.</div>`;
  const sources = SOURCE_ORDER.concat([...new Set(indexed.map(({ target }) => target.source).filter((source) => !SOURCE_ORDER.includes(source)))]);
  return `<div class="target-groups">${sources.map((source) => {
    const items = indexed.filter(({ target }) => target.source === source);
    if (!items.length) return "";
    const scheduled = market === "lease" ? ` · ${items.filter(({ target }) => target.enabled !== false).length}개 자동실행 선택` : " · 수동 전용";
    return `<div class="target-group"><div class="target-group-title"><h3>${escapeHtml(SOURCE_LABELS[source] || source)}</h3><span>${items.length}개 등록${scheduled}</span></div><div class="target-group-list">${items.map(({ target, index }) => renderTarget(target, index)).join("")}</div></div>`;
  }).join("")}</div>`;
}

function renderTargets(targets) {
  const indexed = targets.map((target, index) => ({ target, index }));
  const busy = runLaunchPending || !compatibleWorker() || Boolean(state.runState && state.runState.active);
  return ["lease", "sale"].map(market => {
    const items = indexed.filter(({ target }) => marketForTarget(target) === market);
    const label = MARKET_LABELS[market];
    const selected = items.filter(({ target }) => selectedOnce.has(keyForTarget(target))).length;
    const schedule = market === "lease"
      ? state.config.enabled ? `매일 ${escapeHtml(state.config.schedule || "11:00")} 자동실행` : "매일 자동실행 꺼짐"
      : "수동 실행 전용 · 자동수집 안 함";
    const hint = market === "lease"
      ? "매일 자동실행에 체크한 대상만 예약 수집합니다. 아래 버튼으로는 자동실행 설정과 관계없이 상가임대만 수동 수집합니다."
      : "등록한 매매 대상은 보관만 합니다. 아래 버튼을 눌렀을 때만 실행하며 상가임대는 함께 실행하지 않습니다. 건물·토지는 수집한 매물의 유형에 따라 분류됩니다.";
    return `<section class="market-panel market-${market}" data-market="${market}" aria-labelledby="marketTitle-${market}">
      <div class="section-title market-heading"><div><h2 id="marketTitle-${market}">${label} 수집 <span class="market-count">${items.length}개 등록</span></h2><p>${hint}</p></div><span class="market-schedule">${schedule}</span></div>
      <div class="market-actions">
        <button class="primary" data-run-market="${market}" data-run-mode="all" ${busy ? "disabled" : ""}>${label} 전체 수집</button>
        <button data-run-market="${market}" data-run-mode="selected" ${busy ? "disabled" : ""}>${label} 선택만 수집</button>
        <button data-run-market="${market}" data-run-mode="failed" ${busy ? "disabled" : ""}>${label} 실패·부분완료 재수집</button>
        <span class="selection-count" data-selection-market="${market}" aria-live="polite">이번에 수집 ${selected}개 선택</span>
      </div>
      <div class="market-panel-summary run-summary">${renderRunSummary(reportForMarket(market))}</div>
      <div class="market-targets">${renderSourceGroups(items, market)}</div>
    </section>`;
  }).join("");
}

function render() {
  const config = state.config || {};
  if (!settingsDirty) {
    document.getElementById("enabled").checked = Boolean(config.enabled);
    document.getElementById("schedule").value = config.schedule || "11:00";
    document.getElementById("closeTabs").checked = config.closeTabs !== false;
    document.getElementById("notifyComplete").checked = config.notifyComplete === true;
    document.getElementById("notifyPartial").checked = config.notifyPartial !== false;
    document.getElementById("notifyFailure").checked = config.notifyFailure !== false;
  }
  const ready = state.readiness || {};
  const windows = ready.windowsCheckedAt ? `Windows ${ready.windowsSchedule || "시각 미확인"} · ${ready.windowsTaskState} · ${registeredTime(ready.windowsCheckedAt)} 확인` : "Windows 실제 예약 미확인";
  const mismatch = ready.schedule && ready.windowsSchedule && ready.schedule !== ready.windowsSchedule;
  document.getElementById("scheduleReadiness").textContent =
    `상가임대 다음 자동실행: ${ready.nextAlarmAt ? registeredTime(ready.nextAlarmAt) : "미확인/꺼짐"} · ${windows}` +
    (mismatch ? " · ⚠ 예약 시각 불일치: Windows 설치 도구에서 같은 시각으로 갱신 필요" : "") +
    (ready.windowsCheckedAt && Date.now() - ready.windowsCheckedAt > 86400000 ? " · Windows 확인이 하루 이상 지남" : "") +
    (state.reportPending ? " · 서버 보고 전송 대기(다음 공급처 연결에서 재시도)" : "");
  const targets = Array.isArray(config.targets) ? config.targets : [];
  document.getElementById("runConfirmed").disabled = runLaunchPending || !compatibleWorker() || Boolean(state.runState && state.runState.active);
  const targetList = document.getElementById("targets");
  const openDetails = new Set([...targetList.querySelectorAll(".target-item")]
    .filter(node => node.querySelector("details[open]"))
    .map(node => node.dataset.reportKey));
  targetList.innerHTML = renderTargets(targets);
  targetList.querySelectorAll(".target-item").forEach(node => {
    const details = node.querySelector("details");
    if (details && openDetails.has(node.dataset.reportKey)) details.open = true;
  });
  const logs = Array.isArray(state.logs) ? state.logs.slice(0, 30) : [];
  document.getElementById("logs").classList.add("log-list");
  document.getElementById("logs").innerHTML = logs.length ? logs.map((log) => `
    <div class="item"><div class="item-info"><b class="${escapeHtml(log.level)}">${escapeHtml(log.message)}</b><small>${escapeHtml(new Date(log.at).toLocaleString("ko-KR"))}</small></div></div>`).join("") : '<div class="empty">실행 기록이 없습니다.</div>';
  renderDeferredReview();
}

function renderDeferredReview() {
  const host = document.getElementById("deferredReview");
  if (!host) return;
  const rows = [];
  let deferredTotal = 0;
  const reports = ["lease", "sale"].map(market => ({ market, report: reportForMarket(market) }));
  reports.forEach(({ market, report }) => (report && Array.isArray(report.items) ? report.items : []).forEach((item) => {
    const counts = displayCounts(item);
    if (!Number(counts.addressDeferred || 0)) return;
    deferredTotal += Number(counts.addressDeferred || 0);
    (Array.isArray(item.diagnostics) ? item.diagnostics : []).forEach((row) => {
      if (!/지번주소 없음|주소/.test(String(row.message || ""))) return;
      rows.push({ target: `${MARKET_LABELS[market]} · ${item.label || item.source}`, sourceId: row.sourceId, message: row.message });
    });
  }));
  if (!deferredTotal) {
    host.innerHTML = '<div class="empty">현재 지번 보류 매물이 없습니다.</div>';
    return;
  }
  if (!rows.length) {
    host.innerHTML = `<div class="deferred-summary"><b>전체 ${deferredTotal.toLocaleString("ko-KR")}건</b><span>이전 기록에는 개별 매물번호가 없어 다음 수집 때 사유 목록이 채워집니다.</span></div>`;
    return;
  }
  host.innerHTML = `<div class="deferred-summary"><b>전체 ${deferredTotal.toLocaleString("ko-KR")}건</b><span>최근 사유 ${rows.length.toLocaleString("ko-KR")}건 표시 · 원본은 보존되어 다음 수집에서 다시 확인됩니다.</span></div><div class="deferred-list">${rows.map((row) => {
    const id = String(row.sourceId || "");
    const link = /^\d+$/.test(id)
      ? `<a href="https://realty.daangn.com/?article_id=%22${escapeHtml(id)}%22&amp;panel_stack=article" target="_blank" rel="noopener noreferrer">당근 ${escapeHtml(id)} ↗</a>`
      : escapeHtml(id || "번호 미확인");
    return `<div><b>${escapeHtml(row.target)}</b><span>${link} · ${escapeHtml(row.message || "확인 필요")}</span></div>`;
  }).join("")}</div>`;
}

function currentRunStatus(response) {
  const runState = response && response.runState;
  if (!runState || !runState.active) return "준비됨";
  const targets = Array.isArray(runState.targets) ? runState.targets : [];
  const index = Math.max(0, Math.min(Number(runState.index || 0), Math.max(0, targets.length - 1)));
  const target = targets[index];
  const label = target && (target.label || SOURCE_LABELS[target.source] || target.source);
  const position = targets.length ? `${index + 1}/${targets.length}` : "";
  const phaseLabels = {
    loading: "수집 화면 여는 중",
    "starting-collector": "실제 수집 시작 확인 중",
    collecting: "수집 실행 중",
    starting: "실행 준비 중",
    resuming: "중단 지점 복구 중",
    "between-targets": "다음 지역 연결 중",
    "retry-wait": "재시도 대기",
    retrying: "즉시 재시도 중"
  };
  const phase = phaseLabels[runState.phase] || "실행 상태 확인 필요";
  const progressAt = Number(runState.lastProgressAt || runState.runtimeStartedAt || runState.targetStartedAt || runState.phaseEnteredAt || runState.startedAt || 0);
  const progressAge = progressAt ? Math.max(0, Math.floor((Date.now() - progressAt) / 60000)) : null;
  const progress = String(runState.progressMessage || "").trim();
  const stage = runState.progressStage && typeof runState.progressStage === "object" ? runState.progressStage : null;
  const stageText = stage ? `${stage.label || "수집"} ${Number(stage.percent || 0)}%` : "";
  const market = MARKET_LABELS[runState.market || marketForTarget(target)];
  return [market, phase, position, label, progress,
    stageText,
    progressAge === null ? "" : progressAge ? `마지막 진행 ${progressAge}분 전` : "방금 진행 확인"
  ].filter(Boolean).join(" · ");
}

async function load() {
  const response = await runtime({ type: "JS_AUTO_GET_STATE" });
  if (response.ok) state = response;
  render();
  const workerMismatch = response.ok && response.backgroundBuild !== chrome.runtime.getManifest().version;
  message(response.ok ? (workerMismatch ? "이전 실행기 사용 중 · 전용 수집 브라우저 재시작 필요 · " : "") + currentRunStatus(response) : "연결 오류");
}

document.getElementById("save").addEventListener("click", async () => {
  state.config.enabled = document.getElementById("enabled").checked;
  state.config.schedule = document.getElementById("schedule").value || "11:00";
  state.config.closeTabs = document.getElementById("closeTabs").checked;
  state.config.notifyComplete = document.getElementById("notifyComplete").checked;
  state.config.notifyPartial = document.getElementById("notifyPartial").checked;
  state.config.notifyFailure = document.getElementById("notifyFailure").checked;
  const response = await runtime({ type: "JS_AUTO_SAVE_CONFIG", config: state.config });
  if (response.ok) { state.config = response.config; settingsDirty = false; }
  message(response.ok ? "저장 완료" : "저장 실패");
  render();
});

function previewRows() {
  const targets = Array.isArray(state.config.targets) ? state.config.targets.filter(target => marketForTarget(target) === runPreviewMarket).filter(target => {
    if (runPreviewMode === "selected") return selectedOnce.has(keyForTarget(target));
    const previous = reportItem(target);
    return runPreviewMode !== "failed" || previous && ["failed", "partial"].includes(previous.status);
  }) : [];
  const body = document.getElementById("runPreviewBody");
  if (!body) return targets;
  const label = MARKET_LABELS[runPreviewMarket];
  document.getElementById("runPreviewTitle").textContent = `${label} 수집 실행 전 확인`;
  document.getElementById("runPreviewHint").textContent = runPreviewMarket === "sale"
    ? "매매만 이번에 수동 실행합니다. 상가임대 수집과 매일 예약 설정은 변경하지 않습니다."
    : "상가임대만 이번에 수동 실행합니다. 매매는 실행하지 않으며 매일 예약 설정은 변경하지 않습니다.";
  document.getElementById("runConfirmed").textContent = `${label} ${targets.length}개 실행`;
  const rows = targets.map((target) => {
    const previous = reportItem(target);
    const expected = Number(displayCounts(previous, target).expected || target.selectedCount || 0);
    return `<div><b>${escapeHtml(target.label || target.source)}</b><span>${escapeHtml(targetSummary(target))}${expected ? ` · 이전 기준 ${expected.toLocaleString("ko-KR")}건` : " · 예상 개수는 목록 확인 후 확정"}</span></div>`;
  });
  body.innerHTML = targets.length
    ? `<div class="preview-total"><b>${label} 실행 대상 ${targets.length}개</b><span>등록 지역 수 기준이며, 매물 개수는 직전 수집 또는 등록 당시 기준입니다. 수집 사이트 창 하나에서 순서대로 실행합니다.</span></div>${rows.join("")}`
    : `<div class="empty">실행할 ${label} 대상이 없습니다.</div>`;
  return targets;
}

document.getElementById("targets").addEventListener("click", event => {
  const button = event.target.closest("button[data-run-market]");
  if (!button || button.disabled) return;
  if (!compatibleWorker()) return message("실행기 버전 확인 필요 · 전용 수집 브라우저를 재시작한 뒤 실행해 주세요.");
  runPreviewMarket = button.dataset.runMarket;
  runPreviewMode = button.dataset.runMode;
  if (!previewRows().length) return message(`${MARKET_LABELS[runPreviewMarket]}: ` +
    (runPreviewMode === "failed" ? "실패·부분완료 대상이 없습니다." : runPreviewMode === "selected" ? "이번에 수집할 대상을 체크해 주세요." : "등록된 수집 대상이 없습니다."));
  document.getElementById("runPreview").showModal();
});
for (const id of ["enabled", "schedule", "closeTabs", "notifyComplete", "notifyPartial", "notifyFailure"]) {
  document.getElementById(id).addEventListener("input", () => { settingsDirty = true; });
}
document.getElementById("targets").addEventListener("change", event => {
  const index = Number(event.target.dataset.once);
  if (!Number.isInteger(index) || !state.config.targets[index]) return;
  const key = keyForTarget(state.config.targets[index]);
  if (event.target.checked) selectedOnce.add(key); else selectedOnce.delete(key);
  for (const market of ["lease", "sale"]) {
    const count = state.config.targets.filter(target => marketForTarget(target) === market && selectedOnce.has(keyForTarget(target))).length;
    document.querySelector(`[data-selection-market="${market}"]`).textContent = `이번에 수집 ${count}개 선택`;
  }
});

document.getElementById("runConfirmed").addEventListener("click", async (event) => {
  event.preventDefault();
  if (runLaunchPending) return;
  runLaunchPending = true;
  render();
  const label = MARKET_LABELS[runPreviewMarket];
  message(`${label} 실행 상태 확인 중`);
  try {
    const fresh = await runtime({ type: "JS_AUTO_GET_STATE" });
    if (fresh.ok) state = fresh;
    else state = { ...state, backgroundBuild: null };
    if (!fresh.ok || !compatibleWorker(fresh)) {
      document.getElementById("runPreview").close();
      message("실행을 중단했습니다. 최신 실행기 연결 확인 후 전용 수집 브라우저를 재시작해 주세요.");
      return;
    }
    document.getElementById("runPreview").close();
    if (fresh.runState && fresh.runState.active) {
      message("이미 진행 중인 수집이 있습니다. 현재 수집이 끝난 뒤 실행해 주세요.");
      return;
    }
    const response = await runtime(runPreviewMode === "all" ? { type: "JS_AUTO_RUN_NOW", market: runPreviewMarket } :
      {type: "JS_AUTO_RUN_SELECTED", market: runPreviewMarket, keys: previewRows().map(keyForTarget), failedOnly: runPreviewMode === "failed"});
    await load();
    message(response.message || (response.ok ? `${label} ${Number(response.total || 0)}개 실행 시작` : `${label} 실행 실패`));
  } finally {
    runLaunchPending = false;
    render();
  }
});

document.getElementById("targets").addEventListener("change", async (event) => {
  const index = Number(event.target.dataset.toggle);
  if (!Number.isInteger(index) || !state.config.targets[index]) return;
  if (marketForTarget(state.config.targets[index]) !== "lease") return;
  state.config.targets[index].enabled = event.target.checked;
  const response = await runtime({ type: "JS_AUTO_SAVE_CONFIG", config: state.config });
  if (response.ok) state.config = response.config;
  else message("자동실행 설정 저장 실패 · 다시 확인해 주세요.");
  render();
});

document.getElementById("targets").addEventListener("click", async (event) => {
  const index = Number(event.target.dataset.remove);
  if (!Number.isInteger(index) || !state.config.targets[index]) return;
  selectedOnce.delete(keyForTarget(state.config.targets[index]));
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
      schedule: config.schedule || "11:00",
      closeTabs: config.closeTabs !== false,
      notifyComplete: config.notifyComplete === true,
      notifyPartial: config.notifyPartial !== false,
      notifyFailure: config.notifyFailure !== false,
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
  if (changes.jsAutoCollectorConfigV1 || changes.jsAutoCollectorLogsV1 || changes.jsAutoCollectorRunStateV2 || changes.jsAutoCollectorRunReportV1 || changes.jsAutoCollectorRunReportsByMarketV1) load();
});

window.setInterval(load, 5000);

load();
