(function () {
  "use strict";

  var VERSION = "1.1.0";
  var PANEL_ID = "js-daangn-collector-panel";
  var STYLE_ID = "js-daangn-collector-style";
  var APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbzPedWbaT4yaLNxqrvKI9F3L4JVZ0Q8wVnsSyLEELmaW2h9QuyfGYsESW_7rDxbdqNw/exec";
  var COLLECTOR_KEY_STORAGE = "js_daangn_collector_access_key_v1";
  var POST_RETRY_DELAYS = [0, 1200, 3000, 6000];

  if (!/(^|\.)realty\.daangn\.com$/i.test(location.hostname)) {
    alert("당근부동산 지도에서 실행해 주세요.");
    return;
  }
  if (window.__JS_DAANGN_COLLECTOR__) {
    if (window.__JS_DAANGN_COLLECTOR__.version === VERSION) {
      window.__JS_DAANGN_COLLECTOR__.reopen();
      return;
    }
    var stalePanel = document.getElementById(PANEL_ID);
    if (stalePanel) stalePanel.remove();
    window.__JS_DAANGN_COLLECTOR__ = null;
  }

  var nativeFetch = window.fetch.bind(window);
  var nativeXhrOpen = XMLHttpRequest.prototype.open;
  var nativeXhrSend = XMLHttpRequest.prototype.send;
  var state = {
    busy: false,
    stopRequested: false,
    selectedUrl: selectedClusterUrl(location.href, districtFromUrl(location.href)),
    selectedDistrict: districtFromUrl(location.href),
    pendingDistrict: "",
    pendingSelectionType: "",
    pendingSelectionAt: 0,
    pendingOriginalClusterId: "",
    pendingSelectionCount: 0,
    lastLocationClusterId: clusterIdFromUrl(location.href),
    selectedCount: 0,
    selectionChanged: false,
    job: null
  };

  var panel = createPanel();
  var startButton = panel.querySelector("[data-action=start]");
  var stopButton = panel.querySelector("[data-action=stop]");
  var closeButton = panel.querySelector("[data-action=close]");
  var statusElement = panel.querySelector("[data-role=status]");
  var detailElement = panel.querySelector("[data-role=detail]");
  var progressBar = panel.querySelector("[data-role=progress-bar]");
  var percentElement = panel.querySelector("[data-role=percent]");

  patchNetwork();
  bindEvents();
  renderSelection();
  refreshJobStatus();

  window.__JS_DAANGN_COLLECTOR__ = {
    version: VERSION,
    reopen: function () {
      panel.style.display = "block";
      var locationDistrict = districtFromUrl(location.href);
      var locationSelection = selectedClusterUrl(location.href, locationDistrict);
      if (locationSelection) {
        var currentClusterId = clusterIdFromUrl(locationSelection);
        var previousClusterId = clusterIdFromUrl(state.selectedUrl);
        if (currentClusterId === previousClusterId && state.selectedDistrict) {
          locationDistrict = state.selectedDistrict;
          locationSelection = buildClusterUrl(currentClusterId, locationDistrict);
        }
        state.selectedUrl = locationSelection;
        state.selectedDistrict = locationDistrict;
      }
      renderSelection();
      refreshJobStatus();
    },
    getState: function () { return state; }
  };

  function getCollectorKey() {
    var saved = "";
    try { saved = String(localStorage.getItem(COLLECTOR_KEY_STORAGE) || "").trim(); } catch (_) {}
    if (saved) return saved;
    var entered = String(window.prompt(
      "당근 수집기 보안키를 입력하세요.\n(이 PC에서는 최초 1회만 입력합니다.)",
      ""
    ) || "").trim();
    if (!entered) throw new Error("당근 수집기 보안키가 필요합니다.");
    try { localStorage.setItem(COLLECTOR_KEY_STORAGE, entered); } catch (_) {}
    return entered;
  }

  function createPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "#" + PANEL_ID + "{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;" +
        "width:min(460px,calc(100vw - 24px));max-height:min(620px,calc(100vh - 24px));overflow:auto;box-sizing:border-box;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;background:#fff;" +
        "border:1px solid #ffd9c2;border-radius:16px;box-shadow:0 24px 80px rgba(35,25,18,.32);color:#172033}" +
        "#" + PANEL_ID + " *{box-sizing:border-box}" +
        "#" + PANEL_ID + " .jsd-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;" +
        "background:linear-gradient(135deg,#ff8a3d,#ff6f0f);color:#fff}" +
        "#" + PANEL_ID + " .jsd-brand{display:flex;align-items:center;gap:8px}" +
        "#" + PANEL_ID + " .jsd-logo{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;" +
        "background:#fff;color:#ff6f0f;font-size:15px;font-weight:950}" +
        "#" + PANEL_ID + " .jsd-title{font-size:15px;font-weight:900}.jsd-sub{font-size:10px;opacity:.9;margin-top:1px}" +
        "#" + PANEL_ID + " .jsd-close{width:28px;height:28px;border:0;border-radius:8px;background:rgba(255,255,255,.18);" +
        "color:#fff;font-size:19px;cursor:pointer}" +
        "#" + PANEL_ID + " .jsd-body{padding:9px;background:#fff7f2}" +
        "#" + PANEL_ID + " .jsd-card{padding:9px;background:#fff;border:1px solid #ffe1ce;border-radius:10px;" +
        "box-shadow:0 3px 10px rgba(80,40,15,.05);margin-bottom:7px}" +
        "#" + PANEL_ID + " .jsd-status-line{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
        "#" + PANEL_ID + " .jsd-status{font-size:14px;font-weight:900;line-height:1.35}" +
        "#" + PANEL_ID + " .jsd-percent{font-size:16px;font-weight:950;color:#ff6f0f;white-space:nowrap}" +
        "#" + PANEL_ID + " .jsd-detail{margin-top:5px;color:#667085;font-size:10.5px;line-height:1.4;white-space:pre-line;max-height:60px;overflow:auto}" +
        "#" + PANEL_ID + " .jsd-progress{height:8px;margin-top:8px;border-radius:99px;background:#f5e5da;overflow:hidden}" +
        "#" + PANEL_ID + " .jsd-progress>i{display:block;width:0;height:100%;background:linear-gradient(90deg,#ffad76,#ff6f0f);transition:width .2s}" +
        "#" + PANEL_ID + " .jsd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}" +
        "#" + PANEL_ID + " .jsd-metric{padding:7px;background:#fff7f2;border-radius:8px}.jsd-metric span{display:block;" +
        "font-size:9.5px;color:#806f65;margin-bottom:3px}.jsd-metric b{font-size:15px;font-weight:900}" +
        "#" + PANEL_ID + " .jsd-rule{padding:7px 8px;background:#fff2e9;border-radius:8px;color:#694836;font-size:9.5px;line-height:1.4}" +
        "#" + PANEL_ID + " .jsd-actions{display:grid;grid-template-columns:2fr 1fr;gap:6px;margin-top:8px}" +
        "#" + PANEL_ID + " .jsd-btn{height:38px;border-radius:9px;font-size:12px;font-weight:850;cursor:pointer}" +
        "#" + PANEL_ID + " .jsd-start{border:0;background:#ff6f0f;color:#fff}.jsd-stop{border:1px solid #ef4444;background:#fff1f2;color:#be123c}" +
        "#" + PANEL_ID + " .jsd-btn:disabled{cursor:not-allowed;background:#ddd;color:#fff;border-color:#ddd}" +
        "@media(max-width:520px){#" + PANEL_ID + "{width:calc(100vw - 12px);max-height:calc(100vh - 12px)}}" ;
      document.head.appendChild(style);
    }
    var element = document.createElement("section");
    element.id = PANEL_ID;
    element.innerHTML =
      '<div class="jsd-head"><div class="jsd-brand"><div class="jsd-logo">당근</div><div>' +
      '<div class="jsd-title">당근 매물 수집 <small>v' + VERSION + '</small></div>' +
      '<div class="jsd-sub">구·클러스터 선택 · 안전중단 · 이어가기</div></div></div>' +
      '<button type="button" class="jsd-close" data-action="close" aria-label="닫기">×</button></div>' +
      '<div class="jsd-body"><div class="jsd-card"><div class="jsd-status-line">' +
      '<div class="jsd-status" data-role="status"></div><div class="jsd-percent" data-role="percent">0%</div></div>' +
      '<div class="jsd-progress"><i data-role="progress-bar"></i></div><div class="jsd-detail" data-role="detail"></div></div>' +
      '<div class="jsd-card jsd-grid">' +
      metric("found","선택·찾은 매물") + metric("processed","처리 완료") + metric("remaining","남은 매물") +
      metric("inserted","신규·통합") + metric("review","검증대기") + metric("duplicates","기존 중복") +
      metric("addressMissing","주소 미확인") + metric("failed","조회 실패") + metric("page","목록 페이지") +
      '</div><div class="jsd-card"><div class="jsd-rule" data-role="rule"></div>' +
      '<div class="jsd-actions"><button type="button" class="jsd-btn jsd-start" data-action="start">수집 시작</button>' +
      '<button type="button" class="jsd-btn jsd-stop" data-action="stop" disabled>안전중단</button></div></div></div>';
    document.body.appendChild(element);
    return element;
  }

  function metric(key, label) {
    return '<div class="jsd-metric"><span>' + label + '</span><b data-metric="' + key + '">0</b></div>';
  }

  function bindEvents() {
    startButton.addEventListener("click", startOrResume);
    stopButton.addEventListener("click", requestSafeStop);
    closeButton.addEventListener("click", function () { panel.style.display = "none"; });
    document.addEventListener("click", handleMapMarkerClick, true);
    window.addEventListener("popstate", function () { scheduleSelectionChecks(); });
    window.addEventListener("hashchange", function () { scheduleSelectionChecks(); });
    window.setInterval(function () { syncSelectionFromLocation(false); }, 300);
  }

  function handleMapMarkerClick(event) {
    if (!event || !event.target || panel.contains(event.target)) return;
    var marker = event.target.closest
      ? event.target.closest('.maplibregl-marker,[aria-label="Map marker"]')
      : null;
    if (!marker) return;
    var clickable = event.target.closest
      ? event.target.closest('button,[role="button"]')
      : null;
    if (!clickable || !marker.contains(clickable)) {
      clickable = marker.querySelector
        ? marker.querySelector('button,[role="button"]')
        : null;
    }
    var textSource = clickable || marker;
    var text = String(textSource.textContent || textSource.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim();
    var district = districtFromMarkerText(text);
    var individualCluster = isClusterMarkerText(text);
    if (!district && !individualCluster) return;

    state.pendingDistrict = district;
    state.pendingSelectionType = district ? "district" : "cluster";
    state.pendingSelectionAt = Date.now();
    state.pendingOriginalClusterId = clusterIdFromUrl(location.href);
    state.pendingSelectionCount = markerCountFromText(text);
    if (state.busy && state.job && state.job.status === "running") {
      state.stopRequested = true;
    }
    setStatus(
      district ? "대전 " + district + " 구클러스터 확인 중" : "개별 클러스터 확인 중",
      state.busy
        ? "현재 저장 묶음까지만 마친 뒤 새 선택으로 전환합니다."
        : "당근 지도가 선택 정보를 주소에 반영하는 중입니다. 잠시만 기다려 주세요."
    );
    scheduleSelectionChecks();
  }

  function scheduleSelectionChecks() {
    [0, 80, 220, 500, 900, 1500, 2500].forEach(function (delay) {
      window.setTimeout(function () { syncSelectionFromLocation(true); }, delay);
    });
  }

  function syncSelectionFromLocation(force) {
    var clusterId = clusterIdFromUrl(location.href);
    if (!clusterId) return;
    var hintAge = Date.now() - Number(state.pendingSelectionAt || 0);
    var freshHint = hintAge < 4000;
    var changed = clusterId !== state.lastLocationClusterId;
    if (!changed && !force && !freshHint) return;
    if (
      freshHint &&
      !changed &&
      clusterId === state.pendingOriginalClusterId &&
      hintAge < 1200
    ) return;

    var district = districtFromUrl(location.href);
    if (freshHint) {
      district = state.pendingSelectionType === "district" ? state.pendingDistrict : "";
    } else if (clusterId === clusterIdFromUrl(state.selectedUrl) && state.selectedDistrict) {
      district = state.selectedDistrict;
    }
    captureSelectedCluster(buildClusterUrl(clusterId, district), district);
    state.lastLocationClusterId = clusterId;
    if (freshHint) {
      state.pendingDistrict = "";
      state.pendingSelectionType = "";
      state.pendingSelectionAt = 0;
      state.pendingOriginalClusterId = "";
      state.pendingSelectionCount = 0;
    }
  }

  function patchNetwork() {
    if (window.fetch.__jsDaangnCollectorVersion !== VERSION) {
      var wrappedFetch = async function (input, init) {
        inspectGraphqlBody(init && init.body);
        return nativeFetch(input, init);
      };
      wrappedFetch.__jsDaangnCollectorPatched = true;
      wrappedFetch.__jsDaangnCollectorVersion = VERSION;
      window.fetch = wrappedFetch;
    }
    if (!XMLHttpRequest.prototype.open.__jsDaangnCollectorPatched) {
      XMLHttpRequest.prototype.open = function () {
        return nativeXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.open.__jsDaangnCollectorPatched = true;
    }
    if (XMLHttpRequest.prototype.send.__jsDaangnCollectorVersion !== VERSION) {
      XMLHttpRequest.prototype.send = function (body) {
        inspectGraphqlBody(body);
        return nativeXhrSend.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send.__jsDaangnCollectorVersion = VERSION;
    }
  }

  function inspectGraphqlBody(body) {
    if (typeof body !== "string" || body.indexOf("clusterId") < 0) return;
    try {
      var json = JSON.parse(body);
      var clusterId = findClusterIdDeep(json, 0);
      if (!clusterId) return;
      var freshHint = Date.now() - Number(state.pendingSelectionAt || 0) < 4000;
      var district = freshHint && state.pendingSelectionType === "district"
        ? state.pendingDistrict
        : "";
      captureSelectedCluster(buildClusterUrl(clusterId, district), district);
    } catch (_) {}
  }

  function findClusterIdDeep(value, depth) {
    if (!value || depth > 7) return "";
    if (Array.isArray(value)) {
      for (var index = 0; index < value.length; index += 1) {
        var arrayResult = findClusterIdDeep(value[index], depth + 1);
        if (arrayResult) return arrayResult;
      }
      return "";
    }
    if (typeof value !== "object") return "";
    if (value.clusterId != null && String(value.clusterId).trim()) {
      return String(value.clusterId).trim();
    }
    var keys = Object.keys(value);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var objectResult = findClusterIdDeep(value[keys[keyIndex]], depth + 1);
      if (objectResult) return objectResult;
    }
    return "";
  }

  function captureSelectedCluster(url, district) {
    if (!url) return;
    var pendingCount = Number(state.pendingSelectionCount) || 0;
    var changed = clusterIdFromUrl(url) !== clusterIdFromUrl(state.selectedUrl) ||
      (district || "") !== (state.selectedDistrict || "");
    if (!changed) {
      if (pendingCount && pendingCount !== state.selectedCount) {
        state.selectedCount = pendingCount;
        renderSelection();
      }
      return;
    }
    state.selectedUrl = url;
    state.selectedDistrict = district || districtFromUrl(url);
    state.selectedCount = pendingCount;
    state.selectionChanged = changed && Boolean(
      state.job && state.job.url && state.job.url !== state.selectedUrl
    );
    if (state.selectionChanged && state.busy && state.job && state.job.status === "running") {
      state.stopRequested = true;
    }
    renderSelection();
  }

  function selectedClusterUrl(url, district) {
    var match = String(url || "").match(/[?&]cluster_id=([^&#]+)/i);
    if (!match) return "";
    return buildClusterUrl(
      decodeURIComponent(match[1]).replace(/^['"]|['"]$/g, ""),
      district || districtFromUrl(url)
    );
  }

  function clusterIdFromUrl(url) {
    var match = String(url || "").match(/[?&]cluster_id=([^&#]+)/i);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1] || "").replace(/^['"]|['"]$/g, "").trim();
    } catch (_) {
      return String(match[1] || "").replace(/^['"]|['"]$/g, "").trim();
    }
  }

  function buildClusterUrl(clusterId, district) {
    var url = new URL(location.href);
    url.searchParams.set("cluster_id", String(clusterId || ""));
    if (district) url.searchParams.set("js_district", district);
    else url.searchParams.delete("js_district");
    return url.toString();
  }

  function districtFromMarkerText(text) {
    var match = String(text || "").replace(/\s+/g, " ").trim()
      .match(/^(유성구|대덕구|동구|중구|서구)\s*매물\s*[\d,]+/);
    return match ? match[1] : "";
  }

  function isClusterMarkerText(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    return /^\d[\d,]*$/.test(text) ||
      /(?:^|\s)매물\s*[\d,]+(?:개)?$/.test(text);
  }

  function markerCountFromText(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    var match = text.match(/(?:^|\s)매물\s*([\d,]+)(?:개)?$/) ||
      text.match(/^([\d,]+)$/);
    return match ? Number(match[1].replace(/,/g, "")) || 0 : 0;
  }

  function districtFromUrl(url) {
    var text = "";
    try { text = decodeURIComponent(String(url || "")); } catch (_) { text = String(url || ""); }
    var districts = ["유성구","대덕구","동구","중구","서구"];
    for (var index = 0; index < districts.length; index += 1) {
      if (text.indexOf(districts[index]) >= 0) return districts[index];
    }
    return "";
  }

  function renderSelection() {
    var district = state.selectedDistrict || districtFromUrl(state.selectedUrl || location.href);
    var clusterId = clusterIdFromUrl(state.selectedUrl);
    var clusterLabel = clusterId.length > 30
      ? clusterId.slice(0, 27) + "..."
      : clusterId;
    var selectedCount = Number(state.selectedCount) || 0;
    var rule = panel.querySelector("[data-role=rule]");
    clearMetrics();
    setProgress(0);
    if (selectedCount) {
      setMetric("found", selectedCount);
      setMetric("remaining", selectedCount);
    }
    if (!state.selectedUrl) {
      setStatus(
        "지도에서 구 또는 숫자 클러스터를 클릭하세요.",
        "클릭한 클러스터 번호를 자동으로 인식합니다. URL을 복사하거나 붙여넣을 필요가 없습니다."
      );
      startButton.disabled = true;
      rule.textContent = "대전 5개 구 가운데 원하는 구 지도로 들어간 뒤 숫자 클러스터를 한 번 클릭하세요.";
      return;
    }
    startButton.disabled = state.busy;
    setStatus(
      district ? "대전 " + district + " 클러스터 선택 완료" : "개별 클러스터 선택 완료",
      district
        ? (selectedCount ? "선택 매물 " + selectedCount.toLocaleString("ko-KR") + "개 · " : "") +
          "선택번호 " + clusterLabel + " · 수량을 확인한 뒤 수집 시작을 눌러주세요."
        : (selectedCount ? "선택 매물 " + selectedCount.toLocaleString("ko-KR") + "개 · " : "") +
          "선택번호 " + clusterLabel + " · 수량을 확인한 뒤 수집 시작을 눌러주세요."
    );
    startButton.textContent = selectedCount
      ? selectedCount.toLocaleString("ko-KR") + "개 수집 시작"
      : "수집 시작";
    rule.textContent =
      "저장: 기존 통합 중복검사 사용 · 101호와 102호는 별도 · 당근 링크 최우선 유지 · " +
      (district ? district + " 완전수집 가능" : "개별클러스터 완전수집 제외");
  }

  async function startOrResume() {
    if (state.busy) return;
    try {
      state.busy = true;
      state.stopRequested = false;
      startButton.disabled = true;
      stopButton.disabled = false;
      stopButton.textContent = "안전중단";
      if (
        state.job &&
        state.job.status !== "complete" &&
        state.job.url &&
        state.selectedUrl &&
        state.job.url !== state.selectedUrl
      ) {
        setStatus(
          "이전 수집을 안전중단하는 중입니다.",
          "저장된 자료는 유지하고 새 클러스터로 전환합니다."
        );
        var pausedResult = await callServer("danggeunPauseJob", {});
        state.job = pausedResult.job || state.job;
      }
      var action = state.job && state.job.status === "paused" &&
        (!state.selectedUrl || state.job.url === state.selectedUrl)
        ? "danggeunResumeJob"
        : "danggeunStartJob";
      var result = await callServer(action, {url: state.selectedUrl});
      state.job = result.job || null;
      state.selectionChanged = false;
      renderJob();
      state.busy = false;
      scheduleNextChunk();
    } catch (error) {
      showError(error);
    }
  }

  function scheduleNextChunk() {
    if (!state.job || state.job.status !== "running" || state.job.phase === "complete") {
      state.busy = false;
      return;
    }
    window.setTimeout(runChunk, 180);
  }

  async function runChunk() {
    if (state.busy || !state.job || state.job.status !== "running") return;
    state.busy = true;
    try {
      var result = await callServer("danggeunRunJobChunk", {});
      state.job = result.job || state.job;
      state.busy = false;
      if (
        state.stopRequested ||
        (state.selectedUrl && state.job.url && state.selectedUrl !== state.job.url)
      ) {
        await pauseNow();
      } else {
        renderJob();
        scheduleNextChunk();
      }
    } catch (error) {
      state.busy = false;
      showError(error);
    }
  }

  async function requestSafeStop() {
    state.stopRequested = true;
    stopButton.disabled = true;
    stopButton.textContent = "중단 요청됨";
    setStatus(
      "안전중단 요청을 받았습니다.",
      "현재 서버 묶음까지만 저장한 뒤 멈춥니다. 저장자료와 이어가기 지점은 유지됩니다."
    );
    if (!state.busy) await pauseNow();
  }

  async function pauseNow() {
    try {
      var result = await callServer("danggeunPauseJob", {});
      state.job = result.job || state.job;
      state.stopRequested = false;
      if (state.selectedUrl && state.job && state.job.url !== state.selectedUrl) {
        state.selectionChanged = true;
        renderSelection();
        setStatus(
          "새 클러스터 선택 완료",
          "이전 작업은 안전하게 중단했습니다. 수집 시작을 누르면 새 선택을 수집합니다."
        );
      } else {
        renderJob();
        setStatus(
          "당근 안전중단 완료",
          "현재 저장 지점까지 보존했습니다. 같은 버튼을 다시 누르면 이어서 수집합니다."
        );
      }
    } catch (error) {
      showError(error);
    }
  }

  async function refreshJobStatus() {
    try {
      var result = await callServer("danggeunJobStatus", {});
      state.job = result.job || null;
      if (
        state.job &&
        state.selectedUrl &&
        state.job.url &&
        state.job.url !== state.selectedUrl
      ) {
        state.selectionChanged = true;
        renderSelection();
      } else if (state.job) {
        renderJob();
      }
    } catch (_) {}
  }

  function renderJob() {
    var job = state.job;
    if (!job) return renderSelection();
    ["found","processed","remaining","inserted","review","duplicates","addressMissing","failed","page"]
      .forEach(function (key) {
        var node = panel.querySelector('[data-metric="' + key + '"]');
        if (node) node.textContent = Number(job[key] || 0).toLocaleString("ko-KR");
      });
    var listing = job.phase === "list";
    var complete = job.status === "complete";
    var paused = job.status === "paused";
    var percent = listing ? 0 : (job.total ? Math.min(100, Math.round(job.processed / job.total * 100)) : 0);
    setProgress(percent);
    setStatus(
      complete ? "당근 수집 완료" : (listing ? "클러스터 목록 수집 중" : (paused ? "안전중단됨" : "상세조회·저장 중")),
      (job.message || "") + (job.district
        ? "\n대전 " + job.district + " · 오류 없이 완료 시 구 완전수집"
        : "\n개별클러스터 · 완전수집 제외")
    );
    startButton.disabled = job.status === "running";
    startButton.textContent = complete ? "새 클러스터 수집" : (paused ? "이어서 수집" : "수집 중");
    stopButton.disabled = complete || paused || job.status !== "running";
  }

  function clearMetrics() {
    ["found","processed","remaining","inserted","review","duplicates","addressMissing","failed","page"]
      .forEach(function (key) {
        var node = panel.querySelector('[data-metric="' + key + '"]');
        if (node) node.textContent = "0";
      });
  }

  function setMetric(key, value) {
    var node = panel.querySelector('[data-metric="' + key + '"]');
    if (node) node.textContent = Number(value || 0).toLocaleString("ko-KR");
  }

  function setStatus(title, detail) {
    statusElement.textContent = title || "";
    detailElement.textContent = detail || "";
  }

  function setProgress(percent) {
    percent = Math.max(0, Math.min(100, Number(percent) || 0));
    percentElement.textContent = percent + "%";
    progressBar.style.width = percent + "%";
  }

  function showError(error) {
    state.busy = false;
    if (state.job && state.job.status === "running") {
      state.job.status = "paused";
      state.job.message = "통신이 끊겨 화면에서 일시중단했습니다. 저장 지점은 서버에 보존됩니다.";
    }
    if (state.selectionChanged) {
      renderSelection();
      setStatus(
        "새 클러스터 선택 완료",
        "이전 연결 오류와 관계없이 새 선택을 시작할 수 있습니다."
      );
      return;
    }
    startButton.disabled = false;
    stopButton.disabled = true;
    startButton.textContent = state.job ? "이어서 수집" : "수집 시작";
    setStatus(
      "연결이 일시중단되었습니다.",
      String(error && error.message ? error.message : error) +
      "\n저장 지점은 유지됩니다. 이어서 수집을 누르면 계속합니다."
    );
  }

  function isUnauthorizedError(error) {
    return String(error && error.message ? error.message : error)
      .indexOf("승인되지 않은 요청") !== -1;
  }

  function clearCollectorKey() {
    try { localStorage.removeItem(COLLECTOR_KEY_STORAGE); } catch (_) {}
  }

  async function callServer(action, values, authRetried) {
    var collectorKey = getCollectorKey();
    var requestId = "daangn-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    var body = Object.assign({}, values || {}, {
      action: action,
      requestId: requestId,
      collectorKey: collectorKey
    });
    try {
      var earlyResult = await postServerWithRetry(body, collectorKey);
      if (earlyResult) return earlyResult;
      return await pollMutationStatus(requestId, collectorKey);
    } catch (error) {
      if (!authRetried && isUnauthorizedError(error)) {
        clearCollectorKey();
        setStatus(
          "당근 수집기 인증을 다시 확인합니다.",
          "저장된 인증값이 만료되어 한 번만 다시 입력한 뒤 자동으로 이어갑니다."
        );
        return callServer(action, values, true);
      }
      throw error;
    }
  }

  async function postServerWithRetry(body, collectorKey) {
    var lastError = null;
    for (var attempt = 0; attempt < POST_RETRY_DELAYS.length; attempt += 1) {
      if (POST_RETRY_DELAYS[attempt]) {
        await delay(POST_RETRY_DELAYS[attempt]);
      }
      try {
        await nativeFetch(APPS_SCRIPT_URL, {
          method: "POST",
          mode: "no-cors",
          headers: {"content-type": "text/plain;charset=utf-8"},
          body: JSON.stringify(body)
        });
        return null;
      } catch (error) {
        lastError = error;
        var existing = null;
        try {
          existing = await pollMutationStatus(
            body.requestId,
            collectorKey,
            {maxAttempts: 3, initialDelay: 300, quiet: true}
          );
        } catch (probeError) {
          var probeMessage = String(
            probeError && probeError.message ? probeError.message : probeError
          );
          if (probeMessage !== "not-ready" && probeMessage !== "status-blocked") {
            throw probeError;
          }
        }
        if (existing) return existing;
        if (attempt + 1 < POST_RETRY_DELAYS.length) {
          setStatus(
            "네트워크 연결을 자동 복구 중입니다.",
            "저장 지점은 유지됩니다. 재연결 " +
            (attempt + 1) + "/" + (POST_RETRY_DELAYS.length - 1)
          );
        }
      }
    }
    throw new Error(
      "서버 연결을 여러 번 시도했지만 복구하지 못했습니다. " +
      (lastError && lastError.message ? lastError.message : "Failed to fetch")
    );
  }

  function pollMutationStatus(requestId, collectorKey, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      var maxAttempts = Number(options.maxAttempts) || 90;
      function check() {
        attempts += 1;
        var callbackName = "__jsDaangnStatus_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        var script = document.createElement("script");
        var timer;
        window[callbackName] = function (payload) {
          clearTimeout(timer);
          delete window[callbackName];
          script.remove();
          if (payload && payload.ready) {
            var result = payload.result || payload;
            if (result && result.ok === false) reject(new Error(result.message || "당근 수집 서버 오류"));
            else resolve(result);
          } else if (attempts < maxAttempts) {
            setTimeout(check, 900);
          } else {
            reject(new Error(options.quiet ? "not-ready" : "당근 수집 결과 확인 시간 초과"));
          }
        };
        timer = setTimeout(function () {
          delete window[callbackName];
          script.remove();
          if (attempts < maxAttempts) setTimeout(check, 900);
          else reject(new Error(options.quiet ? "not-ready" : "당근 수집 결과 확인 시간 초과"));
        }, 3500);
        script.onerror = function () {
          clearTimeout(timer);
          delete window[callbackName];
          script.remove();
          if (attempts < maxAttempts) setTimeout(check, 900);
          else reject(new Error(
            options.quiet ? "status-blocked" : "당근 수집 결과 확인이 일시적으로 차단되었습니다."
          ));
        };
        script.src = APPS_SCRIPT_URL +
          "?action=mutationStatus&requestId=" + encodeURIComponent(requestId) +
          "&collectorKey=" + encodeURIComponent(collectorKey) +
          "&callback=" + encodeURIComponent(callbackName) +
          "&_=" + Date.now();
        document.head.appendChild(script);
      }
      setTimeout(check, Number(options.initialDelay) || 900);
    });
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }
})();
