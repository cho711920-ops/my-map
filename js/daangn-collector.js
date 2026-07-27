(function () {
  "use strict";

  var VERSION = "1.0.4";
  var PANEL_ID = "js-daangn-collector-panel";
  var STYLE_ID = "js-daangn-collector-style";
  var APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbzPedWbaT4yaLNxqrvKI9F3L4JVZ0Q8wVnsSyLEELmaW2h9QuyfGYsESW_7rDxbdqNw/exec";
  var COLLECTOR_KEY_STORAGE = "js_daangn_collector_access_key_v1";

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
    lastLocationClusterId: clusterIdFromUrl(location.href),
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
        "width:min(720px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;box-sizing:border-box;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;background:#fff;" +
        "border:1px solid #ffd9c2;border-radius:16px;box-shadow:0 24px 80px rgba(35,25,18,.32);color:#172033}" +
        "#" + PANEL_ID + " *{box-sizing:border-box}" +
        "#" + PANEL_ID + " .jsd-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;" +
        "background:linear-gradient(135deg,#ff8a3d,#ff6f0f);color:#fff}" +
        "#" + PANEL_ID + " .jsd-brand{display:flex;align-items:center;gap:11px}" +
        "#" + PANEL_ID + " .jsd-logo{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;" +
        "background:#fff;color:#ff6f0f;font-size:19px;font-weight:950}" +
        "#" + PANEL_ID + " .jsd-title{font-size:18px;font-weight:900}.jsd-sub{font-size:11px;opacity:.9;margin-top:2px}" +
        "#" + PANEL_ID + " .jsd-close{width:32px;height:32px;border:0;border-radius:9px;background:rgba(255,255,255,.18);" +
        "color:#fff;font-size:22px;cursor:pointer}" +
        "#" + PANEL_ID + " .jsd-body{padding:16px;background:#fff7f2}" +
        "#" + PANEL_ID + " .jsd-card{padding:14px;background:#fff;border:1px solid #ffe1ce;border-radius:13px;" +
        "box-shadow:0 4px 14px rgba(80,40,15,.05);margin-bottom:11px}" +
        "#" + PANEL_ID + " .jsd-status-line{display:flex;align-items:center;justify-content:space-between;gap:12px}" +
        "#" + PANEL_ID + " .jsd-status{font-size:17px;font-weight:900;line-height:1.45}" +
        "#" + PANEL_ID + " .jsd-percent{font-size:20px;font-weight:950;color:#ff6f0f;white-space:nowrap}" +
        "#" + PANEL_ID + " .jsd-detail{margin-top:7px;color:#667085;font-size:12px;line-height:1.55;white-space:pre-line}" +
        "#" + PANEL_ID + " .jsd-progress{height:11px;margin-top:12px;border-radius:99px;background:#f5e5da;overflow:hidden}" +
        "#" + PANEL_ID + " .jsd-progress>i{display:block;width:0;height:100%;background:linear-gradient(90deg,#ffad76,#ff6f0f);transition:width .2s}" +
        "#" + PANEL_ID + " .jsd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}" +
        "#" + PANEL_ID + " .jsd-metric{padding:11px;background:#fff7f2;border-radius:11px}.jsd-metric span{display:block;" +
        "font-size:11px;color:#806f65;margin-bottom:5px}.jsd-metric b{font-size:18px;font-weight:900}" +
        "#" + PANEL_ID + " .jsd-rule{padding:10px 11px;background:#fff2e9;border-radius:10px;color:#694836;font-size:11px;line-height:1.55}" +
        "#" + PANEL_ID + " .jsd-actions{display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:11px}" +
        "#" + PANEL_ID + " .jsd-btn{height:46px;border-radius:11px;font-size:14px;font-weight:850;cursor:pointer}" +
        "#" + PANEL_ID + " .jsd-start{border:0;background:#ff6f0f;color:#fff}.jsd-stop{border:1px solid #ef4444;background:#fff1f2;color:#be123c}" +
        "#" + PANEL_ID + " .jsd-btn:disabled{cursor:not-allowed;background:#ddd;color:#fff;border-color:#ddd}" +
        "@media(max-width:640px){#" + PANEL_ID + "{width:calc(100vw - 16px);max-height:calc(100vh - 16px)}" +
        "#" + PANEL_ID + " .jsd-grid{grid-template-columns:repeat(2,1fr)}}" ;
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
      metric("found","찾은 매물") + metric("processed","처리 완료") + metric("remaining","남은 매물") +
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
    if (state.busy || !event || !event.target || panel.contains(event.target)) return;
    var clickable = event.target.closest
      ? event.target.closest('button,[role="button"],[aria-label="Map marker"]')
      : null;
    if (!clickable) return;
    var marker = clickable.matches && clickable.matches('[aria-label="Map marker"]')
      ? clickable
      : (clickable.closest ? clickable.closest('[aria-label="Map marker"]') : null);
    var text = String(clickable.textContent || clickable.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim();
    var district = districtFromMarkerText(text);
    var individualCluster = Boolean(marker && isClusterMarkerText(text));
    if (!district && !individualCluster) return;

    state.pendingDistrict = district;
    state.pendingSelectionType = district ? "district" : "cluster";
    state.pendingSelectionAt = Date.now();
    state.pendingOriginalClusterId = clusterIdFromUrl(location.href);
    setStatus(
      district ? "대전 " + district + " 구클러스터 확인 중" : "개별 클러스터 확인 중",
      "당근 지도가 선택 정보를 주소에 반영하는 중입니다. 잠시만 기다려 주세요."
    );
    scheduleSelectionChecks();
  }

  function scheduleSelectionChecks() {
    [0, 80, 220, 500, 900, 1500, 2500].forEach(function (delay) {
      window.setTimeout(function () { syncSelectionFromLocation(true); }, delay);
    });
  }

  function syncSelectionFromLocation(force) {
    if (state.busy) return;
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
    if (!url || state.busy) return;
    state.selectedUrl = url;
    state.selectedDistrict = district || districtFromUrl(url);
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
    var rule = panel.querySelector("[data-role=rule]");
    if (!state.selectedUrl) {
      setStatus(
        "지도에서 구 또는 숫자 클러스터를 클릭하세요.",
        "클릭한 클러스터 번호를 자동으로 인식합니다. URL을 복사하거나 붙여넣을 필요가 없습니다."
      );
      startButton.disabled = true;
      rule.textContent = "대전 5개 구 가운데 원하는 구 지도로 들어간 뒤 숫자 클러스터를 한 번 클릭하세요.";
      return;
    }
    startButton.disabled = false;
    setStatus(
      district ? "대전 " + district + " 클러스터 선택 완료" : "개별 클러스터 선택 완료",
      district
        ? "선택번호 " + clusterLabel + " · 이 구 전체 범위로 수집하고, 오류 없이 끝난 경우만 완전수집으로 인정합니다."
        : "선택번호 " + clusterLabel + " · 작은 클러스터는 안전을 위해 완전수집으로 인정하지 않습니다."
    );
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
      var action = state.job && state.job.status === "paused" &&
        (!state.selectedUrl || state.job.url === state.selectedUrl)
        ? "danggeunResumeJob"
        : "danggeunStartJob";
      var result = await callServer(action, {url: state.selectedUrl});
      state.job = result.job || null;
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
      renderJob();
      state.busy = false;
      if (state.stopRequested) {
        await pauseNow();
      } else {
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
      renderJob();
      setStatus(
        "당근 안전중단 완료",
        "현재 저장 지점까지 보존했습니다. 같은 버튼을 다시 누르면 이어서 수집합니다."
      );
    } catch (error) {
      showError(error);
    }
  }

  async function refreshJobStatus() {
    try {
      var result = await callServer("danggeunJobStatus", {});
      state.job = result.job || null;
      if (state.job) renderJob();
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
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus("당근 수집 오류", String(error && error.message ? error.message : error));
  }

  async function callServer(action, values) {
    var collectorKey = getCollectorKey();
    var requestId = "daangn-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    var body = Object.assign({}, values || {}, {
      action: action,
      requestId: requestId,
      collectorKey: collectorKey
    });
    await nativeFetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: {"content-type": "text/plain;charset=utf-8"},
      body: JSON.stringify(body)
    });
    return pollMutationStatus(requestId, collectorKey);
  }

  function pollMutationStatus(requestId, collectorKey) {
    return new Promise(function (resolve, reject) {
      var attempts = 0;
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
          } else if (attempts < 90) {
            setTimeout(check, 900);
          } else {
            reject(new Error("당근 수집 결과 확인 시간 초과"));
          }
        };
        timer = setTimeout(function () {
          delete window[callbackName];
          script.remove();
          if (attempts < 90) setTimeout(check, 900);
          else reject(new Error("당근 수집 결과 확인 시간 초과"));
        }, 3500);
        script.onerror = function () {
          clearTimeout(timer);
          delete window[callbackName];
          script.remove();
          reject(new Error("당근 수집 결과 확인이 차단되었습니다."));
        };
        script.src = APPS_SCRIPT_URL +
          "?action=mutationStatus&requestId=" + encodeURIComponent(requestId) +
          "&collectorKey=" + encodeURIComponent(collectorKey) +
          "&callback=" + encodeURIComponent(callbackName) +
          "&_=" + Date.now();
        document.head.appendChild(script);
      }
      setTimeout(check, 900);
    });
  }
})();
