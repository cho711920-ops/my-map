(function () {
  "use strict";

  var VERSION = "1.5.2";
  var PANEL_ID = "js-daangn-collector-panel";
  var STYLE_ID = "js-daangn-collector-style";
  var COLLECTOR_API_URL = "https://js-map.com/api/collector";
  var COLLECTOR_KEY_STORAGE = "js_daangn_collector_access_key_v1";
  var CLIENT_ID_STORAGE = "js_daangn_collector_client_id_v1";
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
    tradeType: detectTradeType(location.href),
    selectionChanged: false,
    job: null,
    jobRequestGeneration: 0,
    automaticRunning: false,
    fatalError: "",
    manualRecoveryAttempts: 0,
    manualRecoveryTimer: null
  };

  var panel = createPanel();
  var startButton = panel.querySelector("[data-action=start]");
  var autoRegisterButton = panel.querySelector("[data-action=auto-register]") || {addEventListener: function () {}};
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
      if (state.automaticRunning) return;
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
    getState: function () { return state; },
    runAutomatic: runAutomatic
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

  function getClientId() {
    var saved = "";
    try { saved = String(localStorage.getItem(CLIENT_ID_STORAGE) || "").trim(); } catch (_) {}
    if (/^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
    var created = "browser-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(CLIENT_ID_STORAGE, created); } catch (_) {}
    return created;
  }

  function getScopedClientId(url) {
    var clusterId = clusterIdFromUrl(url || state.selectedUrl || location.href)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 28);
    var market = state.tradeType === "sale" ? "sale" : "lease";
    return (getClientId() + "-" + market + (clusterId ? "-" + clusterId : "")).slice(0, 64);
  }

  function detectTradeType(url) {
    try {
      var parsed = new URL(url || location.href, location.href);
      var filter = JSON.parse(parsed.searchParams.get("af") || "{}");
      if (!filter || typeof filter !== "object" || Array.isArray(filter)) return "";
      // Only values of tradeTypes define the transaction. salesTypes is a
      // property-category key, not evidence of a sale.
      if (Object.prototype.hasOwnProperty.call(filter, "tradeTypes")) {
        if (!Array.isArray(filter.tradeTypes) || filter.tradeTypes.length !== 1) return "";
        var value = String(filter.tradeTypes[0]).trim().toUpperCase();
        return value === "BUY" ? "sale" : value === "MONTH" ? "lease" : "";
      }
    } catch (_) { return ""; }
    var selectedText = Array.prototype.slice.call(document.querySelectorAll(
      "button[aria-pressed=true],[role=tab][aria-selected=true],[role=option][aria-selected=true]"
    )).map(function(node) { return String(node.textContent || "").trim(); });
    var sale = selectedText.some(function(value) { return /^(BUY|매매|sale)$/i.test(value); });
    var lease = selectedText.some(function(value) { return /^(MONTH|월세|lease)$/i.test(value); });
    return sale !== lease ? (sale ? "sale" : "lease") : "";
  }

  function automaticTradeType(target, url) {
    var filter = JSON.parse(new URL(url).searchParams.get("af") || "{}");
    var requested = target && target.tradeType;
    var explicit = requested === "sale" || requested === "lease" ? requested : "";
    if (Object.prototype.hasOwnProperty.call(filter, "tradeTypes")) {
      var detected = detectTradeType(url);
      if (!detected || (explicit && explicit !== detected)) {
        throw new Error("당근 거래유형 설정 불일치: 월세 또는 매매 하나로 자동수집 대상을 다시 등록해 주세요.");
      }
      return detected;
    }
    // Legacy targets predate the sale feature and were monthly-rent only.
    return explicit || "lease";
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
        "#" + PANEL_ID + " .jsd-auto{grid-column:1/-1;border:1px solid #e16a1e;background:#fff3ea;color:#b84b08}" +
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
      metric("found","선택·찾은 매물") + metric("processed","상세 처리") + metric("remaining","남은 매물") +
      metric("created","신규 등록") + metric("merged","자동 통합") + metric("updated","조건 변경") +
      metric("review","검증대기") + metric("detailedDuplicates","상세 중복") + metric("skippedUnchanged","기존 동일 생략") +
      metric("addressMissing","주소 보류") + metric("failed","조회·저장 실패") + metric("page","목록 페이지") +
      '</div><details class="jsd-card" data-role="diagnostics" hidden><summary>보류·실패 내역</summary>' +
      '<div class="jsd-detail" data-role="diagnostic-items"></div></details>' +
      '<div class="jsd-card"><div class="jsd-rule" data-role="rule"></div>' +
      '<div class="jsd-actions"><button type="button" class="jsd-btn jsd-start" data-action="start">수집 시작</button>' +
      '<button type="button" class="jsd-btn jsd-stop" data-action="stop" disabled>안전중단</button>' +
      '<button type="button" class="jsd-btn jsd-auto" data-action="auto-register">자동수집 등록</button></div></div></div>';
    document.body.appendChild(element);
    return element;
  }

  function metric(key, label) {
    return '<div class="jsd-metric"><span>' + label + '</span><b data-metric="' + key + '">0</b></div>';
  }

  function bindEvents() {
    startButton.addEventListener("click", function () {
      state.manualRecoveryAttempts = 0;
      startOrResume();
    });
    autoRegisterButton.addEventListener("click", registerAutomaticTarget);
    stopButton.addEventListener("click", requestSafeStop);
    closeButton.addEventListener("click", function () { panel.style.display = "none"; });
    document.addEventListener("click", handleMapMarkerClick, true);
    window.addEventListener("popstate", function () { scheduleSelectionChecks(); });
    window.addEventListener("hashchange", function () { scheduleSelectionChecks(); });
    window.setInterval(function () { syncSelectionFromLocation(false); }, 300);
  }

  function registerAutomaticTarget() {
    if (!state.selectedUrl) {
      setStatus("자동수집 등록 준비", "먼저 지도에서 자동수집할 구 또는 숫자 클러스터를 선택해주세요.");
      return;
    }
    try { getCollectorKey(); } catch (error) {
      setStatus("자동수집 등록 취소", String(error && error.message ? error.message : error));
      return;
    }
    var district = state.selectedDistrict || districtFromUrl(state.selectedUrl);
    var tradeType = detectTradeType(state.selectedUrl);
    if (!tradeType) {
      setStatus("거래유형 확인 필요", "월세 또는 매매 하나만 선택한 뒤 다시 등록해 주세요.");
      return;
    }
    state.tradeType = tradeType;
    var requestId = "daangn-register-" + Date.now();
    var onResult = function (event) {
      if (!event.data || event.data.type !== "JS_COLLECTOR_REGISTER_RESULT" || event.data.requestId !== requestId) return;
      window.removeEventListener("message", onResult);
      setStatus(event.data.ok ? "자동수집 등록 완료" : "자동수집 등록 실패", event.data.message || "Edge 자동수집 확장 프로그램을 확인해주세요.");
    };
    window.addEventListener("message", onResult);
    window.postMessage({
      type: "JS_COLLECTOR_REGISTER_TARGET",
      requestId: requestId,
      target: {
        source: "daangn",
        key: "daangn-" + tradeType + "-" + (district || clusterIdFromUrl(state.selectedUrl)),
        label: (tradeType === "sale" ? "당근 매매 " : "당근 상가임대 ") +
          (district || "선택클러스터"),
        url: state.selectedUrl,
        district: district,
        selectedCount: Number(state.selectedCount || 0),
        tradeType: tradeType,
        marketMode: tradeType === "sale" ? "sale" : "lease"
      }
    }, "*");
  }

  async function runAutomatic(target) {
    state.automaticRunning = true;
    try {
      return await runAutomaticTarget(target);
    } finally {
      state.automaticRunning = false;
    }
  }

  async function runAutomaticTarget(target) {
    panel.style.display = "block";
    var url = selectedClusterUrl(target && target.url, target && target.district);
    if (!url) throw new Error("자동수집할 당근 클러스터 정보가 없습니다.");
    state.selectedUrl = url;
    state.selectedDistrict = String(target.district || districtFromUrl(url) || "");
    state.selectedCount = Number(target.selectedCount || 0);
    state.tradeType = automaticTradeType(target, url);
    state.fatalError = "";
    state.jobRequestGeneration += 1;
    state.selectionChanged = false;
    state.job = null;
    renderSelection();
    await refreshJobStatus();
    await startOrResume();
    var startedAt = Date.now();
    var recoveryAttempts = 0;
    var lastProcessed = -1;
    while (Date.now() - startedAt < 5 * 60 * 60 * 1000) {
      if (state.fatalError) throw new Error(state.fatalError);
      if (state.job && state.job.status === "complete") {
        var hardFailed = Math.max(0, Number(state.job.failed || 0) - Number(state.job.addressMissing || 0));
        var partial = hardFailed > 0 || Number(state.job.addressMissing || 0) > 0 ||
          Boolean(state.selectedDistrict && state.job.completeCollection === false);
        var issues = Array.isArray(state.job.completionIssues) ? state.job.completionIssues.filter(Boolean) : [];
        return {source: "daangn", district: state.selectedDistrict, version: VERSION,
          partial: partial, completionIssues: issues, totals: Object.assign({}, state.job)};
      }
      var processed = Number(state.job && state.job.processed || 0);
      if (processed > lastProcessed) {
        lastProcessed = processed;
        recoveryAttempts = 0;
      }
      if (!state.busy && (!state.job || state.job.status === "paused")) {
        if (recoveryAttempts >= 5) {
          throw new Error(state.job && state.job.message || "당근 자동수집 통신을 5회 복구하지 못했습니다.");
        }
        recoveryAttempts += 1;
        setStatus(
          "당근 자동수집 연결 복구 중",
          "저장 지점부터 자동으로 다시 연결합니다. " + recoveryAttempts + "/5"
        );
        await delay(Math.min(12000, 1500 * recoveryAttempts));
        await startOrResume();
        continue;
      }
      await new Promise(function (resolve) { window.setTimeout(resolve, 1000); });
    }
    throw new Error("당근 자동수집 제한시간을 초과했습니다.");
  }

  function handleMapMarkerClick(event) {
    if (state.automaticRunning) return;
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
    var text = markerSelectionText(marker, clickable);
    var district = districtFromMarkerText(text);
    var individualCluster = isClusterMarkerText(text);
    if (!district && !individualCluster) return;

    var selectedCount = markerCountFromText(text);
    state.pendingDistrict = district;
    state.pendingSelectionType = district ? "district" : "cluster";
    state.pendingSelectionAt = Date.now();
    state.pendingOriginalClusterId = clusterIdFromUrl(location.href);
    state.pendingSelectionCount = selectedCount;
    if (selectedCount) {
      clearMetrics();
      setProgress(0);
      setMetric("found", selectedCount);
      setMetric("remaining", selectedCount);
    }
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

  function markerSelectionText(marker, clickable) {
    var seen = {};
    return [
      clickable && clickable.textContent,
      clickable && clickable.getAttribute && clickable.getAttribute("aria-label"),
      marker && marker.textContent,
      marker && marker.getAttribute && marker.getAttribute("aria-label")
    ].map(function (value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }).filter(function (value) {
      if (!value || /^Map marker$/i.test(value) || seen[value]) return false;
      seen[value] = true;
      return true;
    }).join(" ");
  }

  function scheduleSelectionChecks() {
    [0, 80, 220, 500, 900, 1500, 2500].forEach(function (delay) {
      window.setTimeout(function () { syncSelectionFromLocation(true); }, delay);
    });
  }

  function syncSelectionFromLocation(force) {
    if (state.automaticRunning) return;
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
    if (state.automaticRunning) return;
    if (!url) return;
    var pendingCount = Number(state.pendingSelectionCount) || 0;
    var changed = clusterIdFromUrl(url) !== clusterIdFromUrl(state.selectedUrl) ||
      (district || "") !== (state.selectedDistrict || "") ||
      new URL(url).searchParams.get("af") !== new URL(state.selectedUrl || url).searchParams.get("af");
    if (!changed) {
      if (pendingCount && pendingCount !== state.selectedCount) {
        state.selectedCount = pendingCount;
        renderSelection();
      }
      return;
    }
    state.selectedUrl = url;
    state.selectedDistrict = district || districtFromUrl(url);
    state.tradeType = detectTradeType(url);
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
      district || districtFromUrl(url), url
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

  function buildClusterUrl(clusterId, district, baseUrl) {
    var url = new URL(baseUrl || location.href);
    url.searchParams.set("cluster_id", String(clusterId || ""));
    if (district) url.searchParams.set("js_district", district);
    else url.searchParams.delete("js_district");
    return url.toString();
  }

  function districtFromMarkerText(text) {
    var match = String(text || "").replace(/\s+/g, " ").trim()
      .match(/(?:^|\s)(유성구|대덕구|동구|중구|서구)\s*매물\s*[\d,]+/);
    return match ? match[1] : "";
  }

  function isClusterMarkerText(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    return /^\d[\d,]*(?:개)?$/.test(text) ||
      /매물\s*[\d,]+(?:개)?(?:\s|$)/.test(text);
  }

  function markerCountFromText(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    var match = text.match(/매물\s*([\d,]+)(?:개)?(?:\s|$)/) ||
      text.match(/^([\d,]+)(?:개)?$/);
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
      if (!state.automaticRunning) {
        state.tradeType = detectTradeType(state.selectedUrl);
        if (!state.tradeType) throw new Error("당근 거래유형 설정 오류: 월세 또는 매매 하나만 선택해 주세요.");
      }
      state.fatalError = "";
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
        var pausedResult = await callServer("danggeunPauseJob", {jobUrl: state.job.url});
        state.job = pausedResult.job || state.job;
      }
      if (
        state.job &&
        state.job.status === "running" &&
        (!state.selectedUrl || state.job.url === state.selectedUrl)
      ) {
        state.jobRequestGeneration += 1;
        state.selectionChanged = false;
        renderJob();
        state.busy = false;
        scheduleNextChunk();
        return;
      }
      var action = state.job && state.job.status === "paused" &&
        (!state.selectedUrl || state.job.url === state.selectedUrl)
        ? "danggeunResumeJob"
        : "danggeunStartJob";
      state.jobRequestGeneration += 1;
      var result = await callServer(action, {url: state.selectedUrl, tradeType: state.tradeType});
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
    var previousProcessed = Number(state.job.processed || 0);
    var waitStartedAt = Date.now();
    var waitTimer = null;
    if (state.job.phase === "details") {
      showActiveChunkWait(waitStartedAt);
      waitTimer = window.setInterval(function () {
        showActiveChunkWait(waitStartedAt);
      }, 1000);
    }
    try {
      var result = await callServer("danggeunRunJobChunk", {});
      if (waitTimer) window.clearInterval(waitTimer);
      state.job = result.job || state.job;
      if (Number(state.job.processed || 0) > previousProcessed || state.job.status === "complete") {
        state.manualRecoveryAttempts = 0;
      }
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
      if (waitTimer) window.clearInterval(waitTimer);
      state.busy = false;
      showError(error);
    }
  }

  function showActiveChunkWait(startedAt) {
    if (
      !state.busy ||
      !state.job ||
      state.job.phase !== "details" ||
      state.stopRequested
    ) {
      return;
    }
    var processed = Number(state.job.processed) || 0;
    var total = Number(state.job.total) || Number(state.job.found) || 0;
    var chunkSize = Math.max(1, Number(state.job.chunkSize) || 100);
    var chunkEnd = Math.min(total, processed + chunkSize);
    var seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    setStatus(
      "상세조회·중복검사·저장 중",
      (processed + 1).toLocaleString("ko-KR") + "~" +
      chunkEnd.toLocaleString("ko-KR") + " / " +
      total.toLocaleString("ko-KR") + "개 · " +
      seconds.toLocaleString("ko-KR") + "초 경과\n" +
      "매물 저장을 먼저 끝내고 고객매칭은 자동으로 별도 갱신합니다."
    );
  }

  async function requestSafeStop() {
    state.stopRequested = true;
    if (state.manualRecoveryTimer) window.clearTimeout(state.manualRecoveryTimer);
    state.manualRecoveryTimer = null;
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
    var generation = state.jobRequestGeneration;
    try {
      var result = await callServer("danggeunJobStatus", {});
      if (generation !== state.jobRequestGeneration) return;
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

  function jobDisplay(job) {
    var deferred = Math.min(Number(job.failed || 0), Number(job.addressMissing || 0));
    var failed = Math.max(0, Number(job.failed || 0) - deferred);
    return { deferred: deferred, failed: failed,
      checked: Number(job.skippedUnchanged || 0) + Number(job.processed || 0),
      title: failed ? "당근 부분완료 · 실패 확인 필요" :
        job.district && job.completeCollection !== true ? "당근 부분완료 · 목록 확인 필요" :
        deferred ? "목록 확인 완료 · 주소 보류" : "당근 수집 완료" };
  }

  function renderJob() {
    var job = state.job;
    if (!job) return renderSelection();
    var display = jobDisplay(job);
    ["found","processed","remaining","created","merged","updated","review","detailedDuplicates",
      "skippedUnchanged","addressMissing","failed","page"]
      .forEach(function (key) {
        var node = panel.querySelector('[data-metric="' + key + '"]');
        if (node) node.textContent = Number(key === "failed" ? display.failed : job[key] || 0).toLocaleString("ko-KR");
      });
    var diagnostics = panel.querySelector('[data-role="diagnostics"]');
    var diagnosticItems = panel.querySelector('[data-role="diagnostic-items"]');
    var errors = Array.isArray(job.detailErrors) ? job.detailErrors.slice(-60) : [];
    if (diagnostics && diagnosticItems) {
      diagnostics.hidden = !errors.length;
      diagnosticItems.textContent = "최근 " + errors.length + "건 (재시도 오류 기록 포함) · 번지가 없는 원본은 보존하고 지도 등록을 보류합니다.\n" +
        errors.map(function (error) { return "당근 " + String(error.sourceId || "번호 미확인") + " · " + String(error.message || "확인 필요"); }).join("\n");
    }
    var listing = job.phase === "list";
    var complete = job.status === "complete";
    var paused = job.status === "paused";
    var percent = listing ? 0 : (job.total ? Math.min(100, Math.round(job.processed / job.total * 100)) : 0);
    setProgress(percent);
    var timing = Number(job.lastChunkMs || 0) > 0
      ? "\n최근 " + Number(job.lastChunkSize || 0).toLocaleString("ko-KR") +
        "건 · 상세 " + (Number(job.lastFetchMs || 0) / 1000).toFixed(1) +
        "초 · 저장 " + (Number(job.lastWriteMs || 0) / 1000).toFixed(1) +
        "초 · 합계 " + (Number(job.lastChunkMs || 0) / 1000).toFixed(1) + "초"
      : "";
    setStatus(
      complete ? display.title : (listing ? "클러스터 목록 수집 중" : (paused ? "안전중단됨" : "상세조회·저장 중")),
      (job.message || "") + (job.district
        ? "\n대전 " + job.district + " · 목록 확인 " + display.checked.toLocaleString("ko-KR") + " / " + Number(job.found || 0).toLocaleString("ko-KR") + "건 (기존 동일 포함)"
        : "\n개별클러스터 · 완전수집 제외") +
        (display.deferred ? "\n정확한 지번 미제공 " + display.deferred + "건 · 지도 등록 보류 / 다음 수집에서 재확인" : "") +
        "\n수집기 v" + VERSION + " · 자동 묶음 " + Number(job.chunkSize || 20) + "개" + timing
    );
    startButton.disabled = job.status === "running";
    startButton.textContent = complete ? "새 클러스터 수집" : (paused ? "이어서 수집" : "수집 중");
    stopButton.disabled = complete || paused || job.status !== "running";
  }

  function clearMetrics() {
    var diagnostics = panel.querySelector('[data-role="diagnostics"]');
    if (diagnostics) diagnostics.hidden = true;
    ["found","processed","remaining","created","merged","updated","review","detailedDuplicates",
      "skippedUnchanged","addressMissing","failed","page"]
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
    var message = String(error && error.message ? error.message : error);
    if (/당근 거래유형 설정/.test(message)) {
      state.fatalError = message;
      if (state.job) state.job.status = "paused";
      startButton.disabled = false;
      stopButton.disabled = true;
      setStatus("거래유형 확인 필요", message);
      return;
    }
    if (/SQLITE_TOOBIG|string or blob too big/i.test(message)) {
      state.job = null;
    }
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
      message +
      "\n저장 지점은 유지됩니다. 이어서 수집을 누르면 계속합니다."
    );
    scheduleManualRecovery(message);
  }

  function scheduleManualRecovery(message) {
    if (state.automaticRunning || state.stopRequested || state.selectionChanged) return false;
    if (/SQLITE_TOOBIG|string or blob too big|인증|보안키|권한|한도|용량/i.test(message)) return false;
    if (state.manualRecoveryAttempts >= 5) {
      setStatus("자동 재연결을 멈췄습니다.", message + "\n저장 지점은 보존되어 있습니다. 수집 버튼을 누르면 이어집니다.");
      return false;
    }
    state.manualRecoveryAttempts += 1;
    if (state.manualRecoveryTimer) window.clearTimeout(state.manualRecoveryTimer);
    var seconds = Math.min(12, Math.max(2, state.manualRecoveryAttempts * 2));
    setStatus("연결 복구 대기 중", "저장 지점부터 " + seconds + "초 뒤 자동 재연결합니다. " +
      state.manualRecoveryAttempts + "/5\n" + message);
    state.manualRecoveryTimer = window.setTimeout(function () {
      state.manualRecoveryTimer = null;
      startOrResume();
    }, seconds * 1000);
    return true;
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
    var requestValues = Object.assign({}, values || {});
    var jobUrl = requestValues.jobUrl || state.selectedUrl || location.href;
    delete requestValues.jobUrl;
    var body = Object.assign({}, requestValues, {
      action: action,
      requestId: requestId,
      collectorKey: collectorKey,
      collectorVersion: VERSION,
      tradeType: state.tradeType === "sale" ? "sale" : "lease",
      clientId: getScopedClientId(jobUrl)
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
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var timeoutId = window.setTimeout(function () {
          if (controller) controller.abort();
        }, 15000);
        try {
          await nativeFetch(COLLECTOR_API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {"content-type": "text/plain;charset=utf-8"},
            body: JSON.stringify(body),
            signal: controller ? controller.signal : undefined
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
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
        script.src = COLLECTOR_API_URL +
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
