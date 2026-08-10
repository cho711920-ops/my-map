(function () {
  "use strict";

  var VERSION = "5.9.0";
  var PANEL_ID = "js-naver-collector-panel";
  var STYLE_ID = "js-naver-collector-style";
  var MAX_PAGES = 500;
  // JS부동산 D1 서버의 요청당 안전 상한인 100건까지 한 번에 저장한다.
  // 실패한 묶음은 기존 재시도 로직이 같은 범위를 다시 전송한다.
  var BATCH_SIZE = 100;
  var MIN_BATCH_SIZE = 50;
  var MAX_BATCH_SIZE = 250;
  var CITY_PROGRESS_KEY = "js_naver_daejeon_progress_v1";
  var CITY_FAILED_KEY = "js_naver_daejeon_failed_v1";
  var AUTO_DISTRICT_PROGRESS_KEY = "js_naver_auto_district_progress_v2";
  var CITY_TILE_MAX_PAGES = 80;
  var CITY_DISTRICT_MAX_PAGES = 500;
  var CITY_PAGE_DELAY = 70;
  var CITY_SAVE_DELAY = 90;
  var CITY_MAX_SPLIT_DEPTH = 4;
  var DAEJEON_BOUNDS = {left: 127.20, right: 127.57, bottom: 36.18, top: 36.50};
  var DAEJEON_DISTRICTS = [
    {name: "동구", cortarNo: "3011000000"},
    {name: "중구", cortarNo: "3014000000"},
    {name: "서구", cortarNo: "3017000000"},
    {name: "유성구", cortarNo: "3020000000"},
    {name: "대덕구", cortarNo: "3023000000"}
  ];
  var COLLECTOR_API_URL = "https://js-map.com/api/collector";
  var COLLECTOR_KEY_STORAGE = "js_naver_collector_access_key";
  var FIN_NAVER_HOST = "fin.land.naver.com";
  var FIN_ARTICLE_LIST_PATH = "/front-api/v1/article/legalDivisionArticleList";
  var FIN_ARTICLE_KEY_PATH = "/front-api/v1/article/key";
  var FIN_ARTICLE_BASIC_PATH = "/front-api/v1/article/basicInfo";
  var FIN_DETAIL_CONCURRENCY = 5;
  // 새 네이버 목록 API는 실제 화면과 동일한 30건 단위에서만 다음 페이지
  // lastInfo/seed 조합을 안정적으로 받아들입니다. 100건으로 올리면 2페이지부터 400이 납니다.
  var FIN_PAGE_SIZE = 30;
  var FIN_MAX_PAGES = 500;
  var TRADE_TYPE_LABELS = {
    A1: "매매",
    B1: "전세",
    B2: "월세",
    B3: "단기임대"
  };
  var REAL_ESTATE_TYPE_LABELS = {
    D01: "사무실",
    D02: "상가점포",
    E02: "공장/창고"
  };

  function getCollectorKey() {
    var saved = "";
    try {
      saved = String(localStorage.getItem(COLLECTOR_KEY_STORAGE) || "").trim();
    } catch (_) {}
    if (saved) return saved;

    var entered = String(
      window.prompt(
        "네이버 수집기 보안키를 입력하세요.\n(이 PC에서는 최초 1회만 입력합니다.)",
        ""
      ) || ""
    ).trim();
    if (!entered) throw new Error("보안키가 입력되지 않아 저장을 취소했습니다.");
    try {
      localStorage.setItem(COLLECTOR_KEY_STORAGE, entered);
    } catch (_) {}
    return entered;
  }

  if (!/(^|\.)(?:new|fin)\.land\.naver\.com$/i.test(location.hostname)) {
    alert("네이버페이 부동산 지도에서 실행해 주세요.");
    return;
  }

  if (window.__JS_NAVER_COLLECTOR__) {
    if (window.__JS_NAVER_COLLECTOR__.version === VERSION) {
      window.__JS_NAVER_COLLECTOR__.reopen();
      return;
    }
    try {
      window.__JS_NAVER_COLLECTOR__.getState().active = false;
    } catch (_) {}
    var stalePanel = document.getElementById(PANEL_ID);
    if (stalePanel) stalePanel.remove();
    window.__JS_NAVER_COLLECTOR__ = null;
  }

  var nativeFetch = typeof window.fetch === "function"
    ? window.fetch.bind(window)
    : null;
  var nativeXhrOpen = XMLHttpRequest.prototype.open;
  var nativeXhrSend = XMLHttpRequest.prototype.send;
  var nativeXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  var state = {
    active: true,
    busy: false,
    preparing: false,
    stopRequested: false,
    prepareId: 0,
    capture: null,
    collected: [],
    capturedAt: 0,
    clickedClusterCount: 0,
    selectedDistrict: null,
    selectionMode: "",
    dashboard: createEmptyDashboard()
  };

  var panel = createPanel();
  var statusElement = panel.querySelector("[data-role=status]");
  var detailElement = panel.querySelector("[data-role=detail]");
  var progressElement = panel.querySelector("[data-role=progress]");
  var progressBarElement = panel.querySelector("[data-role=progress-bar]");
  var progressPercentElement = panel.querySelector("[data-role=percent]");
  var saveButton = panel.querySelector("[data-action=save]");
  var autoRegisterButton = panel.querySelector("[data-action=auto-register]") || {addEventListener: function () {}};
  var autoDistrictSelect = panel.querySelector("[data-role=auto-district]") || {value: "", addEventListener: function () {}};
  var retryButton = panel.querySelector("[data-action=retry]") || {
    disabled: false,
    addEventListener: function () {}
  };
  // 이전 5개 구 연속수집 기능은 제거했습니다. 구·동·숫자 클러스터를
  // 하나씩 확인한 뒤 사용자가 수집을 시작하는 흐름만 유지합니다.
  var cityButton = panel.querySelector("[data-action=city]") || document.createElement("button");
  var stopButton = panel.querySelector("[data-action=stop]");
  var closeButton = panel.querySelector("[data-action=close]");

  patchNetwork();
  bindEvents();
  if (isFinNaver()) {
    discoverFinContext();
  } else {
    setStatus(
      "원하는 숫자 클러스터를 눌러주세요.",
      "클러스터를 누르면 매물을 자동 감지합니다. 이미 눌렀다면 ‘현재 목록 다시 감지’를 눌러주세요."
    );
    discoverExistingRequest();
  }

  window.__JS_NAVER_COLLECTOR__ = {
    version: VERSION,
    reopen: reopen,
    getState: function () {
      return state;
    },
    capturePayload: capturePayload,
    collectAll: collectAll,
    normalize: normalize,
    getBoundsSchema: getBoundsSchema,
    getCityStrategy: getCityStrategy,
    buildTileUrl: buildTileUrl,
    buildDistrictUrl: buildDistrictUrl,
    createInitialCityTiles: createInitialCityTiles,
    createInitialDistricts: createInitialDistricts,
    collectCityTile: collectCityTile,
    collectCityDistrict: collectCityDistrict,
    retryFailedCityArticles: retryFailedCityArticles,
    isFinNaver: isFinNaver,
    parseFinFilters: parseFinFilters,
    buildFinDistrictRequest: buildFinDistrictRequest,
    collectFinDistrictRaw: collectFinDistrictRaw,
    discoverFinContext: discoverFinContext,
    createEmptyDashboard: createEmptyDashboard,
    clusterCountFromText: clusterCountFromText,
    parseRequestBody: parseRequestBody,
    finKrwToManwon: finKrwToManwon,
    runAutomatic: runAutomatic
  };

  function createPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "#" + PANEL_ID + "{" +
        "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;" +
        "width:min(460px,calc(100vw - 24px));max-height:min(620px,calc(100vh - 24px));box-sizing:border-box;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;" +
        "background:#fff;border:1px solid #cfe8d9;border-radius:16px;" +
        "box-shadow:0 24px 80px rgba(15,23,42,.32);overflow:auto;color:#172033}" +
        "#" + PANEL_ID + " *{box-sizing:border-box}" +
        "#" + PANEL_ID + " .jsn-head{display:flex;align-items:center;justify-content:space-between;" +
        "padding:10px 12px;background:linear-gradient(135deg,#03c75a,#00a94f);color:#fff}" +
        "#" + PANEL_ID + " .jsn-brand{display:flex;align-items:center;gap:8px}" +
        "#" + PANEL_ID + " .jsn-logo{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;" +
        "background:#fff;color:#03a94f;font-size:16px;font-weight:950}" +
        "#" + PANEL_ID + " .jsn-title{font-size:15px;font-weight:900;letter-spacing:-.3px}" +
        "#" + PANEL_ID + " .jsn-sub{font-size:10px;opacity:.88;margin-top:1px}" +
        "#" + PANEL_ID + " .jsn-version{font-size:10px;opacity:.8;margin-left:6px}" +
        "#" + PANEL_ID + " .jsn-close{width:28px;height:28px;border:0;border-radius:8px;" +
        "background:rgba(255,255,255,.18);color:#fff;font-size:19px;line-height:26px;cursor:pointer}" +
        "#" + PANEL_ID + " .jsn-body{padding:9px;background:#f4f8f6}" +
        "#" + PANEL_ID + " .jsn-card{padding:9px;background:#fff;border:1px solid #e0ebe5;border-radius:10px;" +
        "box-shadow:0 3px 10px rgba(25,55,40,.05);margin-bottom:7px}" +
        "#" + PANEL_ID + " .jsn-status-line{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
        "#" + PANEL_ID + " .jsn-status{font-size:14px;font-weight:900;line-height:1.35;color:#172033}" +
        "#" + PANEL_ID + " .jsn-percent{font-size:16px;font-weight:950;color:#03a94f;white-space:nowrap}" +
        "#" + PANEL_ID + " .jsn-detail{margin-top:5px;color:#667085;font-size:10.5px;line-height:1.4;" +
        "white-space:pre-line;max-height:60px;overflow:auto}" +
        "#" + PANEL_ID + " .jsn-progress{height:8px;margin-top:8px;border-radius:99px;" +
        "background:#e7efe9;overflow:hidden}" +
        "#" + PANEL_ID + " .jsn-progress>i{display:block;width:0;height:100%;background:linear-gradient(90deg,#27d572,#03a94f);transition:width .2s}" +
        "#" + PANEL_ID + " .jsn-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}" +
        "#" + PANEL_ID + " .jsn-metric{padding:7px;background:#f5faf7;border-radius:8px;min-width:0}" +
        "#" + PANEL_ID + " .jsn-metric span{display:block;font-size:9.5px;color:#718078;margin-bottom:3px}" +
        "#" + PANEL_ID + " .jsn-metric b{font-size:15px;font-weight:900;color:#172033}" +
        "#" + PANEL_ID + " .jsn-rule{padding:7px 8px;background:#eef9f3;" +
        "border-radius:8px;color:#3d6250;font-size:9.5px;line-height:1.4}" +
        "#" + PANEL_ID + " .jsn-actions{display:grid;grid-template-columns:1fr;gap:6px;margin-top:8px}" +
        "#" + PANEL_ID + " .jsn-auto-district{height:38px;border:1px solid #b9c8dd;border-radius:9px;padding:0 10px;background:#fff;color:#16324f;font-size:12px;font-weight:850}" +
        "#" + PANEL_ID + " button.jsn-btn{height:38px;border-radius:9px;font-size:12px;font-weight:850;cursor:pointer}" +
        "#" + PANEL_ID + " .jsn-retry{border:1px solid #b9c9c0;background:#fff;color:#315244}" +
        "#" + PANEL_ID + " .jsn-save{border:0;background:#03c75a;color:#fff}" +
        "#" + PANEL_ID + " .jsn-auto{border:1px solid #1687e8;background:#eaf5ff;color:#0963b5}" +
        "#" + PANEL_ID + " .jsn-city{grid-column:1/-1;border:1px solid #1687e8;background:#eaf5ff;color:#0963b5}" +
        "#" + PANEL_ID + " .jsn-stop{grid-column:1/-1;border:1px solid #ef4444;background:#fff1f2;color:#be123c}" +
        "#" + PANEL_ID + " .jsn-save:disabled,#" + PANEL_ID + " .jsn-retry:disabled,#" + PANEL_ID + " .jsn-city:disabled,#" + PANEL_ID + " .jsn-stop:disabled{" +
        "cursor:not-allowed;background:#d2ded7;color:#f8faf9;border-color:#d2ded7}" +
        "@media(max-width:520px){#" + PANEL_ID + "{width:calc(100vw - 12px);max-height:calc(100vh - 12px)}" +
        "#" + PANEL_ID + " .jsn-body{padding:7px}}" ;
      document.head.appendChild(style);
    }

    var element = document.createElement("section");
    element.id = PANEL_ID;
    element.innerHTML =
      '<div class="jsn-head">' +
        '<div class="jsn-brand"><div class="jsn-logo">N</div><div>' +
          '<div class="jsn-title">네이버 매물 수집<span class="jsn-version">v' + VERSION + '</span></div>' +
          '<div class="jsn-sub">새 네이버부동산 · 구·동·숫자 클러스터 선택형 수집</div>' +
        '</div></div>' +
        '<button type="button" class="jsn-close" data-action="close" aria-label="닫기">×</button>' +
      '</div>' +
      '<div class="jsn-body">' +
        '<div class="jsn-card">' +
          '<div class="jsn-status-line"><div class="jsn-status" data-role="status"></div>' +
          '<div class="jsn-percent" data-role="percent">0%</div></div>' +
          '<div class="jsn-progress" data-role="progress"><i data-role="progress-bar"></i></div>' +
          '<div class="jsn-detail" data-role="detail"></div>' +
        '</div>' +
        '<div class="jsn-card jsn-grid">' +
          '<div class="jsn-metric"><span>선택·찾은 매물</span><b data-metric="found">0</b></div>' +
          '<div class="jsn-metric"><span>처리 완료</span><b data-metric="processed">0</b></div>' +
          '<div class="jsn-metric"><span>남은 매물</span><b data-metric="remaining">0</b></div>' +
          '<div class="jsn-metric"><span>신규 등록</span><b data-metric="created">0</b></div>' +
          '<div class="jsn-metric"><span>자동 통합</span><b data-metric="merged">0</b></div>' +
          '<div class="jsn-metric"><span>조건 변경</span><b data-metric="updated">0</b></div>' +
          '<div class="jsn-metric"><span>검증대기</span><b data-metric="review">0</b></div>' +
          '<div class="jsn-metric"><span>상세 중복</span><b data-metric="detailedDuplicates">0</b></div>' +
          '<div class="jsn-metric"><span>기존 동일 생략</span><b data-metric="skippedUnchanged">0</b></div>' +
          '<div class="jsn-metric"><span>주소·변환 제외</span><b data-metric="addressMissing">0</b></div>' +
          '<div class="jsn-metric"><span>조회·저장 실패</span><b data-metric="failed">0</b></div>' +
        '</div>' +
        '<div class="jsn-card">' +
          '<div class="jsn-rule">저장 위치: <b>JS부동산 매물현황</b><br>' +
          '중복검사: 매물ID 우선 · 지번주소 + 층/호실 + 보증금 + 월세 + 평수 1평 미만<br>' +
          '같은 주소라도 임대조건이 다르면 별도 매물로 유지합니다.</div>' +
          '<div class="jsn-actions">' +
            '<button type="button" class="jsn-btn jsn-save" data-action="save" disabled>선택 구 전체 수집</button>' +
            '<select class="jsn-auto-district" data-role="auto-district" aria-label="자동수집 구 직접 선택">' +
              '<option value="">자동수집할 구를 직접 선택</option>' +
              '<option value="3011000000">동구</option>' +
              '<option value="3014000000">중구</option>' +
              '<option value="3017000000">서구</option>' +
              '<option value="3020000000">유성구</option>' +
              '<option value="3023000000">대덕구</option>' +
            '</select>' +
            '<button type="button" class="jsn-btn jsn-auto" data-action="auto-register">자동수집 등록</button>' +
            '<button type="button" class="jsn-btn jsn-stop" data-action="stop" disabled>안전중단</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(element);
    return element;
  }

  function bindEvents() {
    saveButton.addEventListener("click", function () {
      if (isFinNaver() && state.selectionMode === "district") collectFinSelectedAndSave();
      else collectAndSave();
    });
    retryButton.addEventListener("click", function () {
      if (isFinNaver()) discoverFinContext();
      else discoverExistingRequest();
    });
    stopButton.addEventListener("click", requestSafeStop);
    autoRegisterButton.addEventListener("click", registerAutomaticTarget);
    autoDistrictSelect.addEventListener("change", selectAutomaticDistrict);
    document.addEventListener("click", rememberClusterCount, true);
    closeButton.addEventListener("click", function () {
      panel.style.display = "none";
    });
  }

  function selectAutomaticDistrict() {
    var cortarNo = String(autoDistrictSelect.value || "");
    var district = DAEJEON_DISTRICTS.find(function (item) {
      return String(item.cortarNo) === cortarNo;
    });
    if (!district) return;
    state.selectedDistrict = district;
    state.selectionMode = "district";
    state.capture = null;
    autoRegisterButton.textContent = district.name + " 자동수집 등록";
    setStatus(
      district.name + " 자동수집 대상 선택 완료",
      "지도 클러스터 인식과 관계없이 아래 등록 버튼을 누르면 됩니다."
    );
  }

  function registerAutomaticTarget() {
    var selectedCortarNo = String(autoDistrictSelect.value || "");
    var district = DAEJEON_DISTRICTS.find(function (item) {
      return String(item.cortarNo) === selectedCortarNo;
    }) || state.selectedDistrict;
    if (!district || !district.cortarNo) {
      setStatus("자동수집 등록 준비", "먼저 지도에서 자동수집할 구 클러스터를 선택해주세요.");
      return;
    }
    try { getCollectorKey(); } catch (error) {
      setStatus("자동수집 등록 취소", String(error && error.message ? error.message : error));
      return;
    }
    var requestId = "naver-register-" + Date.now();
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
        source: "naver",
        key: "naver-district-" + district.cortarNo,
        label: "네이버 " + district.name,
        url: location.href,
        district: {name: district.name, cortarNo: district.cortarNo},
        selectionMode: "district"
      }
    }, "*");
  }

  async function runAutomatic(target) {
    panel.style.display = "block";
    // A fresh Naver tab can discover the visible cluster before the
    // automation bridge starts. That passive discovery may still be paging
    // through thousands of rows and must not block the dedicated district
    // run. Invalidate only passive preparation; an actual save remains busy.
    if (state.preparing && !state.busy) {
      state.prepareId += 1;
      state.preparing = false;
      state.capture = null;
      state.collected = [];
    }
    if (!isFinNaver()) throw new Error("네이버 자동수집은 fin.land.naver.com 지도에서 등록해주세요.");
    var readyStartedAt = Date.now();
    while (state.busy && Date.now() - readyStartedAt < 90000) {
      await delay(300);
    }
    if (state.busy) {
      throw new Error("네이버 수집기 준비가 90초 안에 끝나지 않았습니다.");
    }
    var requested = target && target.district || {};
    var district = DAEJEON_DISTRICTS.find(function (item) {
      return String(item.cortarNo) === String(requested.cortarNo || "") || item.name === requested.name;
    });
    if (!district) throw new Error("자동수집할 네이버 구 정보가 없습니다.");
    state.selectedDistrict = district;
    state.selectionMode = "district";
    state.clickedClusterCount = 0;
    state.capture = null;
    // 자동수집에서는 등록된 대상을 그대로 사용한다. 현재 지도 화면에 선택된
    // 구를 다시 읽으면 등록 대상이 다른 구로 덮어써질 수 있다.
    autoDistrictSelect.value = district.cortarNo;
    autoRegisterButton.textContent = district.name + " 자동수집 등록";
    var runResult = await collectFinSelectedAndSave({automatic: true});
    if (!runResult || runResult.ok !== true || runResult.complete !== true) {
      throw new Error(runResult && runResult.message || "네이버 자동수집이 부분수집 또는 오류로 종료됐습니다.");
    }
    return {
      source: "naver",
      district: district.name,
      version: VERSION,
      totals: Object.assign({}, state.dashboard),
      session: runResult.finalResult || null
    };
  }

  function requestSafeStop() {
    if (!state.busy && !state.preparing) return;
    state.stopRequested = true;
    stopButton.disabled = true;
    stopButton.textContent = "안전중단 요청됨";
    setStatus(
      "안전중단 요청을 받았습니다.",
      "현재 조회 또는 저장 중인 한 묶음까지만 안전하게 마친 뒤 멈춥니다. 이미 저장된 매물은 유지됩니다."
    );
  }

  function throwIfStopRequested() {
    if (!state.stopRequested) return;
    var error = new Error("사용자 안전중단");
    error.safeStop = true;
    throw error;
  }

  function beginCollectorRun() {
    state.stopRequested = false;
    stopButton.disabled = false;
    stopButton.textContent = "안전중단";
  }

  function finishCollectorRun() {
    stopButton.disabled = true;
    stopButton.textContent = "안전중단";
  }

  function rememberClusterCount(event) {
    var node = event && event.target;
    if (!node || (panel.contains && panel.contains(node))) return;

    for (var depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      var originalText = String(node.textContent || "").replace(/\s+/g, " ").trim();
      var district = findDistrictByText(originalText);
      var districtCount = clusterCountFromText(originalText);
      if (district) {
        state.selectedDistrict = district;
        state.selectionMode = "district";
        autoDistrictSelect.value = district.cortarNo;
        autoRegisterButton.textContent = district.name + " 자동수집 등록";
        state.capture = null;
        state.clickedClusterCount = districtCount;
        updateDashboard({
          found: districtCount,
          processed: 0,
          remaining: districtCount
        });
        setStatus(
          district.name + " 클러스터를 선택했습니다.",
          (districtCount ? "표시 매물 " + formatNumber(districtCount) + "개 · " : "") +
          "선택 구 전체 수집을 누르면 모든 페이지를 자동 확인합니다."
        );
        saveButton.disabled = false;
        saveButton.textContent = district.name + " 전체 수집";
        return;
      }
      var count = clusterCountFromText(originalText);
      if (!Number.isFinite(count) || count < 1) continue;
      state.clickedClusterCount = count;
      state.selectedDistrict = null;
      state.selectionMode = "cluster";
      setStatus(
        "동·숫자 클러스터 " + formatNumber(count) + "개를 선택했습니다.",
        "네이버 첫 페이지 응답을 기다리고 있습니다."
      );
      return;
    }
  }

  function reopen() {
    state.active = true;
    panel.style.display = "block";
    patchNetwork();
    if (isFinNaver()) {
      discoverFinContext();
      updateCityButton();
      return;
    }
    if (state.capture) {
      showCapture(state.capture);
    } else {
      setStatus(
        "원하는 숫자 클러스터를 눌러주세요.",
        "클러스터를 누르면 매물을 자동 감지합니다."
      );
      discoverExistingRequest();
    }
    updateCityButton();
  }

  function setStatus(title, detail) {
    statusElement.textContent = title || "";
    detailElement.textContent = detail || "";
  }

  function createEmptyDashboard() {
    return {
      found: 0,
      processed: 0,
      remaining: 0,
      created: 0,
      merged: 0,
      updated: 0,
      review: 0,
      duplicate: 0,
      detailedDuplicates: 0,
      skippedUnchanged: 0,
      addressMissing: 0,
      failed: 0
    };
  }

  function formatNumber(value) {
    var number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "0";
  }

  function updateDashboard(values) {
    values = values || {};
    Object.keys(state.dashboard).forEach(function (key) {
      if (values[key] !== undefined) state.dashboard[key] = Number(values[key]) || 0;
      var node = panel.querySelector('[data-metric="' + key + '"]');
      if (node) node.textContent = formatNumber(state.dashboard[key]);
    });
  }

  function dashboardFromTotals(found, processed, totals) {
    totals = totals || {};
    updateDashboard({
      found: found,
      processed: processed,
      remaining: Math.max(0, Number(found || 0) - Number(processed || 0)),
      created: totals.created,
      merged: totals.merged,
      updated: totals.updated,
      review: totals.review,
      duplicate: totals.duplicate,
      detailedDuplicates: totals.detailedDuplicates !== undefined
        ? totals.detailedDuplicates
        : totals.duplicate,
      skippedUnchanged: totals.skippedUnchanged || 0,
      failed: totals.failed
    });
  }

  function setProgress(done, total) {
    var percent = total
      ? Math.min(100, Math.max(0, Math.round(done / total * 100)))
      : 0;
    if (progressPercentElement) {
      progressPercentElement.textContent = percent + "%";
    }
    if (!total) {
      progressBarElement.style.width = "0%";
      return;
    }
    progressBarElement.style.width = percent + "%";
  }

  function adjustBatchSize(elapsedMs, failed) {
    if (failed || elapsedMs > 12000) {
      BATCH_SIZE = Math.max(MIN_BATCH_SIZE, Math.floor(BATCH_SIZE * 0.7 / 10) * 10);
    } else if (elapsedMs < 4500) {
      BATCH_SIZE = Math.min(MAX_BATCH_SIZE, BATCH_SIZE + 25);
    }
    return BATCH_SIZE;
  }

  function addResultTotals(target, result) {
    result = result || {};
    var hasClassifiedResult =
      result.created !== undefined ||
      result.merged !== undefined ||
      result.updated !== undefined ||
      result.review !== undefined;
    target.accepted = Number(target.accepted || 0) + Number(
      hasClassifiedResult
        ? Math.max(0, Number(result.received || 0) - Number(result.failed || 0))
        : result.saved || result.inserted || 0
    );
    target.created = Number(target.created || 0) + Number(result.created || 0);
    target.merged = Number(target.merged || 0) + Number(result.merged || 0);
    target.updated = Number(target.updated || 0) + Number(result.updated || 0);
    target.review = Number(target.review || 0) + Number(result.review || 0);
    target.addressMissing = Number(target.addressMissing || 0) +
      Number(result.addressMissing || 0);
    var detailedDuplicateCount =
      Number(result.duplicate || 0) + Number(result.duplicateSnapshots || 0);
    target.detailedDuplicates =
      Number(target.detailedDuplicates || 0) + detailedDuplicateCount;
    target.duplicate = Number(target.duplicate || 0) + detailedDuplicateCount;
    target.failed = Number(target.failed || 0) + Number(result.failed || 0);
    target.saved = target.accepted;
  }

  function patchNetwork() {
    if (nativeFetch && window.fetch.__jsNaverCollectorVersion !== VERSION) {
      var wrappedFetch = async function (input, init) {
        var response = await nativeFetch(input, init);
        inspectFetchResponse(input, response.clone(), init).catch(function () {});
        return response;
      };
      wrappedFetch.__jsNaverCollectorPatched = true;
      wrappedFetch.__jsNaverCollectorVersion = VERSION;
      wrappedFetch.__jsNaverCollectorOriginal = nativeFetch;
      window.fetch = wrappedFetch;
    }

    if (!XMLHttpRequest.prototype.open.__jsNaverCollectorPatched) {
      var wrappedOpen = function (method, url) {
        this.__jsNaverCollectorUrl = absoluteNaverUrl(url);
        this.__jsNaverCollectorMethod = String(method || "GET").toUpperCase();
        this.__jsNaverCollectorHeaders = {};
        return nativeXhrOpen.apply(this, arguments);
      };
      wrappedOpen.__jsNaverCollectorPatched = true;
      XMLHttpRequest.prototype.open = wrappedOpen;

      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (!this.__jsNaverCollectorHeaders) this.__jsNaverCollectorHeaders = {};
        this.__jsNaverCollectorHeaders[String(name || "").toLowerCase()] = String(value || "");
        return nativeXhrSetRequestHeader.apply(this, arguments);
      };

    }

    if (XMLHttpRequest.prototype.send.__jsNaverCollectorVersion !== VERSION) {
      var wrappedSend = function (body) {
        this.__jsNaverCollectorRequestBody = parseRequestBody(body);
        this.addEventListener("load", function () {
          if (!state.active || !isArticleRequest(this.__jsNaverCollectorUrl)) return;
          try {
            var json = this.responseType === "json"
              ? this.response
              : JSON.parse(this.responseText || "{}");
            capturePayload(json, this.__jsNaverCollectorUrl, {
              method: this.__jsNaverCollectorMethod || "GET",
              headers: this.__jsNaverCollectorHeaders || {},
              credentials: "include",
              requestBody: this.__jsNaverCollectorRequestBody || null
            });
          } catch (_) {}
        }, {once: true});
        return nativeXhrSend.apply(this, arguments);
      };
      wrappedSend.__jsNaverCollectorPatched = true;
      wrappedSend.__jsNaverCollectorVersion = VERSION;
      XMLHttpRequest.prototype.send = wrappedSend;
    }
  }

  async function inspectFetchResponse(input, response, init) {
    if (!state.active) return;
    var url = response.url || requestUrl(input);
    if (!isArticleRequest(url)) return;
    var json = await response.json();
    capturePayload(json, url, await requestOptionsFromFetch(input, init));
  }

  async function requestOptionsFromFetch(input, init) {
    var options = init || {};
    var headers = {};
    var requestBody = null;
    try {
      if (typeof Request !== "undefined" && input instanceof Request) {
        input.headers.forEach(function (value, name) {
          headers[String(name).toLowerCase()] = value;
        });
      }
      new Headers(options.headers || {}).forEach(function (value, name) {
        headers[String(name).toLowerCase()] = value;
      });
    } catch (_) {}
    try {
      var rawBody = options.body !== undefined
        ? options.body
        : input && typeof input.clone === "function"
          ? await input.clone().text()
          : "";
      requestBody = parseRequestBody(rawBody);
    } catch (_) {}
    return {
      method: String(options.method || (input && input.method) || "GET").toUpperCase(),
      headers: headers,
      credentials: options.credentials || (input && input.credentials) || "include",
      requestBody: requestBody
    };
  }

  function replayOptions(capture) {
    var source = capture && capture.requestOptions ? capture.requestOptions : {};
    var headers = Object.assign({}, source.headers || {});
    if (!headers.accept) headers.accept = "application/json, text/plain, */*";
    var options = {
      method: source.method || "GET",
      credentials: source.credentials || "include",
      headers: headers,
      cache: "no-store"
    };
    if (source.requestBody) {
      if (!options.headers["content-type"]) options.headers["content-type"] = "application/json";
      options.body = JSON.stringify(source.requestBody);
    }
    return options;
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function absoluteNaverUrl(value) {
    try {
      var url = new URL(String(value || ""), location.origin);
      return url.origin === location.origin ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function isArticleRequest(value) {
    var url = absoluteNaverUrl(value);
    return !!url && (
      /\/api\/(?:articles|articleList)(?:\/|\?|$)/i.test(url) ||
      /\/front-api\/v1\/article\/(?:legalDivisionArticleList|clusteredArticles|boundedArticles)(?:\/|\?|$)/i.test(url)
    );
  }

  function articleList(json) {
    if (!json || typeof json !== "object") return [];
    if (Array.isArray(json.articleList)) return json.articleList;
    if (json.body && Array.isArray(json.body.articleList)) return json.body.articleList;
    if (json.result && Array.isArray(json.result.articleList)) return json.result.articleList;
    if (json.result && Array.isArray(json.result.list)) {
      return json.result.list.map(function (item) {
        return item && item.representativeArticleInfo
          ? item.representativeArticleInfo
          : item;
      }).filter(Boolean);
    }
    return [];
  }

  function expectedCount(json) {
    var candidates = [
      json && json.totalCount,
      json && json.articleCount,
      json && json.total,
      json && json.pageInfo && json.pageInfo.totalCount,
      json && json.result && json.result.totalCount
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = Number(candidates[i]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  function hasMore(json) {
    var candidates = [
      json && json.isMoreData,
      json && json.hasMore,
      json && json.moreData,
      json && json.pageInfo && json.pageInfo.hasNext,
      json && json.result && json.result.hasNextPage
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (typeof candidates[i] === "boolean") return candidates[i];
    }
    return null;
  }

  function pageNumber(url) {
    try {
      var value = Number(new URL(url).searchParams.get("page"));
      return Number.isFinite(value) && value > 0 ? value : 1;
    } catch (_) {
      return 1;
    }
  }

  function isFinNaver() {
    return String(location.hostname || "").toLowerCase() === FIN_NAVER_HOST;
  }

  function articleId(article) {
    return clean(article && (article.articleNo || article.articleNumber));
  }

  function findDistrictByText(value) {
    var compact = String(value || "").replace(/\s+/g, "");
    for (var i = 0; i < DAEJEON_DISTRICTS.length; i += 1) {
      var district = DAEJEON_DISTRICTS[i];
      if (
        compact === district.name ||
        compact.indexOf("대전시" + district.name) === 0 ||
        compact.indexOf(district.name + "매물") === 0
      ) {
        return district;
      }
    }
    return null;
  }

  function clusterCountFromText(value) {
    var compact = String(value || "").replace(/\s+/g, "");
    var match =
      compact.match(/매물([\d,]+)/) ||
      compact.match(/^([\d,]+)개의매물$/) ||
      compact.match(/^([\d,]+)$/);
    return match ? Number(match[1].replace(/,/g, "")) || 0 : 0;
  }

  function parseRequestBody(value) {
    if (!value) return null;
    if (typeof value === "object" && !Array.isArray(value)) {
      if (
        typeof FormData !== "undefined" && value instanceof FormData ||
        typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams
      ) {
        return null;
      }
      return value;
    }
    if (typeof value !== "string") return null;
    try {
      var parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function splitFinQuery(value) {
    return String(value || "")
      .split(/[-,|]/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function parseFinFilters(value) {
    var url;
    try {
      url = new URL(value || location.href);
    } catch (_) {
      url = new URL(location.href);
    }
    return {
      tradeTypes: splitFinQuery(url.searchParams.get("tradeTypes")),
      realEstateTypes: splitFinQuery(url.searchParams.get("realEstateTypes"))
    };
  }

  function buildFinDistrictRequest(district, cursor) {
    cursor = cursor || {};
    var parsed = parseFinFilters(location.href);
    var filter = {
      tradeTypes: parsed.tradeTypes,
      realEstateTypes: parsed.realEstateTypes,
      legalDivisionNumbers: [String(district.cortarNo)],
      legalDivisionType: "GUN"
    };
    var paging = {
      size: FIN_PAGE_SIZE,
      userChannelType: "PC",
      articleSortType: "RANKING_DESC",
      lastInfo: Array.isArray(cursor.lastInfo) ? cursor.lastInfo : []
    };
    if (cursor.seed) paging.seed = String(cursor.seed);
    return {
      filter: filter,
      articlePagingRequest: paging
    };
  }

  function discoverFinContext() {
    if (!isFinNaver() || state.busy) return;
    var buttons = [];
    try {
      buttons = Array.prototype.slice.call(document.querySelectorAll("button"));
    } catch (_) {}
    var selected = state.selectedDistrict;
    var targetCount = Number(state.clickedClusterCount) || 0;

    buttons.some(function (button) {
      var text = String(button.textContent || "").replace(/\s+/g, " ").trim();
      var district = findDistrictByText(text);
      if (!district || text.indexOf("대전시") !== 0) return false;
      selected = district;
      return true;
    });

    if (selected) {
      buttons.some(function (button) {
        var text = String(button.textContent || "").replace(/\s+/g, " ").trim();
        if (findDistrictByText(text) !== selected) return false;
        var count = clusterCountFromText(text);
        if (!count) return false;
        targetCount = count;
        return true;
      });
    }

    if (state.selectionMode !== "cluster") {
      state.selectedDistrict = selected || null;
      state.selectionMode = selected ? "district" : "";
    }
    state.clickedClusterCount = targetCount;
    if (state.selectionMode !== "cluster") state.capture = null;
    updateDashboard(Object.assign(createEmptyDashboard(), {
      found: targetCount,
      remaining: targetCount
    }));
    setProgress(0, targetCount || 1);
    if (selected) {
      setStatus(
        selected.name + " 선택 클러스터 합계 " + formatNumber(targetCount) + "개",
        "표시된 수량을 확인한 뒤 선택 구 전체 수집을 눌러주세요. 마지막 페이지까지 자동 확인하고 저장합니다."
      );
      saveButton.disabled = false;
      saveButton.textContent = (targetCount ? formatNumber(targetCount) + "개 " : "") + selected.name + " 전체 수집";
    } else {
      setStatus(
        "수집할 구·동·숫자 클러스터를 선택하세요.",
        "선택 수량을 확인한 뒤 수집 버튼을 눌러주세요."
      );
      saveButton.disabled = true;
      saveButton.textContent = "선택 구 전체 수집";
    }
    updateCityButton();
  }

  function capturePayload(json, sourceUrl, requestOptions) {
    var articles = articleList(json).filter(function (article) {
      return !!articleId(article);
    });
    var responseUrl = absoluteNaverUrl(sourceUrl);
    if (!articles.length || !isArticleRequest(responseUrl)) return false;

    var responseExpected = expectedCount(json);
    var clickedExpected = Number(state.clickedClusterCount) || 0;
    var expected = Math.max(responseExpected, clickedExpected);
    if (expected > 0) expected = Math.max(expected, articles.length);
    state.capture = {
      articles: articles,
      json: json,
      responseUrl: responseUrl,
      page: pageNumber(responseUrl),
      expected: expected,
      hasMore: hasMore(json),
      requestOptions: requestOptions || null
    };
    if (state.selectionMode !== "district") state.selectionMode = "cluster";
    state.collected = articles.slice();
    state.capturedAt = Date.now();
    state.prepareId += 1;
    updateDashboard({
      found: articles.length,
      processed: 0,
      remaining: Math.max(0, expected - articles.length)
    });
    showCapture(state.capture);
    prepareFullCapture(state.capture, state.prepareId);
    return true;
  }

  function showCapture(capture) {
    var count = capture.articles.length;
    var expected = capture.expected;
    updateDashboard({
      found: count,
      remaining: Math.max(0, Number(expected || count) - count)
    });
    if (!capture.prepared) {
      setStatus(
        "클러스터 전체 개수 확인 중",
        "첫 페이지 " + count + "개 확인 · 나머지 페이지를 자동으로 확인하고 있습니다."
      );
      saveButton.disabled = true;
      saveButton.textContent = "전체 목록 확인 중";
      return;
    }
    setStatus(
      "선택 클러스터 합계 " + count + "개 확인 완료",
      "전체 페이지 확인이 끝났습니다. 수량을 확인한 뒤 저장 버튼을 누르면 기존 매물과 중복검사 후 저장합니다."
    );
    saveButton.disabled = false;
    saveButton.textContent = "클러스터 전체 저장";
  }

  function updateCityButton() {
    if (!cityButton || state.busy) return;
    var progress = loadCityProgress();
    if (progress && Array.isArray(progress.queue) && progress.queue.length) {
      cityButton.textContent = "대전 5개 구 이어서 · 남은 구역 " + progress.queue.length + "개";
    } else {
      cityButton.textContent = "대전 5개 구 전체 이어서 수집";
    }
    if (isFinNaver()) cityButton.disabled = false;
  }

  async function prepareFullCapture(capture, prepareId) {
    if (!capture || state.busy) return;
    state.preparing = true;
    try {
      var articles = await collectAll(capture);
      if (prepareId !== state.prepareId || state.capture !== capture) return;
      capture.articles = articles.slice();
      capture.expected = articles.length;
      capture.hasMore = false;
      capture.prepared = true;
      state.collected = articles.slice();
      setProgress(articles.length, articles.length || 1);
      showCapture(capture);
    } catch (error) {
      if (prepareId !== state.prepareId || state.capture !== capture) return;
      setProgress(0, 0);
      setStatus("클러스터 전체 확인 오류", String(error && error.message ? error.message : error));
      saveButton.disabled = true;
      saveButton.textContent = "클러스터를 다시 클릭해 주세요";
    } finally {
      if (prepareId === state.prepareId) state.preparing = false;
    }
  }

  async function discoverExistingRequest() {
    if (state.busy) return;
    retryButton.disabled = true;
    setStatus("현재 네이버 목록을 확인 중입니다.", "최근에 연 클러스터 요청을 찾고 있습니다.");

    try {
      var entries = window.performance && window.performance.getEntriesByType
        ? window.performance.getEntriesByType("resource")
        : [];
      var urls = entries.map(function (entry) {
        return entry && entry.name ? entry.name : "";
      }).filter(isArticleRequest).slice(-20).reverse();

      for (var i = 0; i < urls.length; i += 1) {
        try {
          var response = await nativeFetch(urls[i], {
            credentials: "include",
            headers: {Accept: "application/json, text/plain, */*"}
          });
          if (!response.ok) continue;
          var json = await response.json();
          if (capturePayload(json, response.url || urls[i], {
            method: "GET",
            headers: {Accept: "application/json, text/plain, */*"},
            credentials: "include"
          })) return;
        } catch (_) {}
      }

      if (state.capture) {
        showCapture(state.capture);
      } else {
        setStatus(
          "아직 매물을 감지하지 못했습니다.",
          "지도에서 원하는 숫자 클러스터를 한 번 눌러주세요. 누르는 즉시 자동 감지됩니다."
        );
      }
    } finally {
      retryButton.disabled = false;
    }
  }

  async function collectAll(capture) {
    if (!nativeFetch) throw new Error("현재 브라우저에서 목록을 불러올 수 없습니다.");
    if (
      /\/front-api\/v1\/article\//i.test(capture.responseUrl || "") &&
      capture.requestOptions &&
      capture.requestOptions.requestBody
    ) {
      return collectFinCapturedRequest(capture);
    }
    var found = new Map();
    var firstArticles = capture.articles || [];
    var currentPage = capture.page || pageNumber(capture.responseUrl);
    var expected = capture.expected || 0;
    var lastJson = capture.json || {};
    var baseUrl = new URL(capture.responseUrl);
    var requestOptions = replayOptions(capture);
    var noNewCount = 0;

    firstArticles.forEach(function (article) {
      found.set(articleId(article), article);
    });
    setProgress(found.size, expected || Math.max(found.size + 1, 1));
    updateDashboard({
      found: found.size,
      remaining: Math.max(0, Number(expected || found.size) - found.size)
    });

    for (var step = 1; step < MAX_PAGES; step += 1) {
      if (hasMore(lastJson) === false) break;
      if (expected && found.size >= expected) break;

      var nextPage = currentPage + 1;
      var target = new URL(baseUrl.href);
      target.searchParams.set("page", String(nextPage));
      setStatus(
        "클러스터 전체 목록 수집 중",
        nextPage + "페이지 · 현재 " + found.size + (expected ? "/" + expected : "") + "개"
      );

      var response = await fetchPageWithRetry(target.href, requestOptions, 3);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("네이버 인증이 만료되었습니다. 수집기를 연 상태에서 클러스터를 다시 클릭한 뒤 저장해 주세요. (HTTP " + response.status + ")");
        }
        throw new Error("네이버 목록 조회 실패(HTTP " + response.status + ")");
      }

      var json = await response.json();
      var items = articleList(json);
      var before = found.size;
      items.forEach(function (article) {
        var id = articleId(article);
        if (id) {
          found.set(id, article);
        }
      });

      currentPage = nextPage;
      lastJson = json;
      expected = expected || expectedCount(json);
      noNewCount = found.size === before ? noNewCount + 1 : 0;
      setProgress(found.size, expected || Math.max(found.size + 1, 1));
      updateDashboard({
        found: found.size,
        remaining: Math.max(0, Number(expected || found.size) - found.size)
      });

      if (!items.length || noNewCount >= 1 || hasMore(json) === false) break;
      await delay(120);
    }

    if (
      step >= MAX_PAGES &&
      hasMore(lastJson) !== false &&
      (!expected || found.size < expected)
    ) {
      throw new Error(
        "클러스터가 최대 조회 범위(" + MAX_PAGES + "페이지)를 넘었습니다. " +
        "일부만 저장하지 않도록 중단했습니다. 지도를 한 단계 확대해 클러스터를 나눠 주세요."
      );
    }

    state.collected = Array.from(found.values());
    return state.collected;
  }

  async function collectFinCapturedRequest(capture) {
    var found = new Map();
    (capture.articles || []).forEach(function (article) {
      var id = articleId(article);
      if (id) found.set(id, article);
    });
    var json = capture.json || {};
    var expected = capture.expected || expectedCount(json);
    var body = JSON.parse(JSON.stringify(capture.requestOptions.requestBody || {}));
    var page = 1;
    var previousSignature = "";

    while (hasMore(json) !== false && page < FIN_MAX_PAGES) {
      var result = json && json.result || {};
      body.articlePagingRequest = Object.assign(
        {},
        body.articlePagingRequest || {},
        {
          size: FIN_PAGE_SIZE,
          userChannelType: "PC",
          articleSortType: (body.articlePagingRequest || {}).articleSortType || "RANKING_DESC",
          lastInfo: Array.isArray(result.lastInfo) ? result.lastInfo : []
        }
      );
      if (result.seed) body.articlePagingRequest.seed = result.seed;
      page += 1;
      setStatus(
        "새 네이버 클러스터 전체 목록 수집 중",
        page + "페이지 · 현재 " + formatNumber(found.size) +
        (expected ? "/" + formatNumber(expected) : "") + "개"
      );
      var response = await fetchPageWithRetry(capture.responseUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }, 3);
      if (!response.ok) throw new Error("새 네이버 목록 조회 실패(HTTP " + response.status + ")");
      json = await response.json();
      var items = articleList(json);
      var signature = items.map(articleId).filter(Boolean).join(",");
      if (!items.length || (signature && signature === previousSignature)) break;
      previousSignature = signature;
      items.forEach(function (article) {
        var id = articleId(article);
        if (id) found.set(id, article);
      });
      expected = expected || expectedCount(json);
      setProgress(found.size, expected || Math.max(found.size + 1, 1));
      updateDashboard({
        found: found.size,
        remaining: Math.max(0, Number(expected || found.size) - found.size)
      });
      await delay(CITY_PAGE_DELAY);
    }
    if (page >= FIN_MAX_PAGES && hasMore(json) !== false) {
      throw new Error("새 네이버 목록이 500페이지를 넘었습니다. 선택 범위를 나눠 주세요.");
    }
    state.collected = Array.from(found.values());
    return state.collected;
  }

  function getBoundsSchema(value) {
    var url;
    try { url = new URL(value); } catch (_) { return null; }
    var schemas = [
      {left: "leftLon", right: "rightLon", bottom: "bottomLat", top: "topLat"},
      {left: "lft", right: "rgt", bottom: "btm", top: "top"},
      {left: "left", right: "right", bottom: "bottom", top: "top"}
    ];
    for (var i = 0; i < schemas.length; i += 1) {
      var schema = schemas[i];
      if ([schema.left, schema.right, schema.bottom, schema.top].every(function(key) {
        return url.searchParams.has(key);
      })) return schema;
    }
    return null;
  }

  function getCityStrategy(value) {
    var schema = getBoundsSchema(value);
    if (schema) return {mode: "bounds", schema: schema};
    try {
      var url = new URL(value);
      if (url.searchParams.has("cortarNo")) return {mode: "district", schema: null};
    } catch (_) {}
    return null;
  }

  function createInitialDistricts() {
    return DAEJEON_DISTRICTS.map(function(district) {
      return {
        name: district.name,
        cortarNo: district.cortarNo,
        depth: 0,
        key: "gu-" + district.cortarNo
      };
    });
  }

  function createInitialCityTiles() {
    var tiles = [];
    var columns = 5;
    var rows = 5;
    var width = (DAEJEON_BOUNDS.right - DAEJEON_BOUNDS.left) / columns;
    var height = (DAEJEON_BOUNDS.top - DAEJEON_BOUNDS.bottom) / rows;
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        tiles.push({
          left: DAEJEON_BOUNDS.left + column * width,
          right: DAEJEON_BOUNDS.left + (column + 1) * width,
          bottom: DAEJEON_BOUNDS.bottom + row * height,
          top: DAEJEON_BOUNDS.bottom + (row + 1) * height,
          depth: 0,
          key: row + "-" + column
        });
      }
    }
    return tiles;
  }

  function splitCityTile(tile) {
    var middleLon = (tile.left + tile.right) / 2;
    var middleLat = (tile.bottom + tile.top) / 2;
    var nextDepth = (tile.depth || 0) + 1;
    return [
      {left: tile.left, right: middleLon, bottom: tile.bottom, top: middleLat},
      {left: middleLon, right: tile.right, bottom: tile.bottom, top: middleLat},
      {left: tile.left, right: middleLon, bottom: middleLat, top: tile.top},
      {left: middleLon, right: tile.right, bottom: middleLat, top: tile.top}
    ].map(function(part, index) {
      part.depth = nextDepth;
      part.key = tile.key + "." + index;
      return part;
    });
  }

  function buildTileUrl(templateUrl, schema, tile, page) {
    var url = new URL(templateUrl);
    ["markerId", "markerid", "cluster", "clusterId", "clusterid"].forEach(function(key) {
      url.searchParams.delete(key);
    });
    url.searchParams.set(schema.left, tile.left.toFixed(6));
    url.searchParams.set(schema.right, tile.right.toFixed(6));
    url.searchParams.set(schema.bottom, tile.bottom.toFixed(6));
    url.searchParams.set(schema.top, tile.top.toFixed(6));
    if (url.searchParams.has("cortarNo")) url.searchParams.set("cortarNo", "3000000000");
    url.searchParams.set("page", String(page || 1));
    return url.href;
  }

  function buildDistrictUrl(templateUrl, district, page) {
    var url = new URL(templateUrl);
    ["markerId", "markerid", "cluster", "clusterId", "clusterid"].forEach(function(key) {
      url.searchParams.delete(key);
    });
    url.searchParams.set("cortarNo", district.cortarNo);
    url.searchParams.set("page", String(page || 1));
    return url.href;
  }

  function loadCityProgress() {
    try {
      var parsed = JSON.parse(localStorage.getItem(CITY_PROGRESS_KEY) || "null");
      return parsed && parsed.version === 1 ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveCityProgress(progress) {
    try { localStorage.setItem(CITY_PROGRESS_KEY, JSON.stringify(progress)); } catch (_) {}
  }

  function loadAutoDistrictProgress(cortarNo) {
    try {
      var all = JSON.parse(localStorage.getItem(AUTO_DISTRICT_PROGRESS_KEY) || "{}");
      var progress = all && all[String(cortarNo || "")];
      return progress && progress.version === 2 ? progress : null;
    } catch (_) {
      return null;
    }
  }

  function saveAutoDistrictProgress(progress) {
    if (!progress || !progress.autoDistrictKey) return;
    try {
      var all = JSON.parse(localStorage.getItem(AUTO_DISTRICT_PROGRESS_KEY) || "{}");
      all = all && typeof all === "object" ? all : {};
      all[String(progress.autoDistrictKey)] = progress;
      localStorage.setItem(AUTO_DISTRICT_PROGRESS_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  function clearAutoDistrictProgress(cortarNo) {
    try {
      var all = JSON.parse(localStorage.getItem(AUTO_DISTRICT_PROGRESS_KEY) || "{}");
      if (!all || typeof all !== "object") return;
      delete all[String(cortarNo || "")];
      localStorage.setItem(AUTO_DISTRICT_PROGRESS_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  function persistNaverProgress(progress) {
    if (progress && progress.autoDistrictKey) saveAutoDistrictProgress(progress);
    else saveCityProgress(progress);
  }

  function createCollectionSessionId() {
    return "S-NAVER-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function clearCityProgress() {
    try { localStorage.removeItem(CITY_PROGRESS_KEY); } catch (_) {}
  }

  function loadCityFailedItems() {
    try {
      var parsed = JSON.parse(localStorage.getItem(CITY_FAILED_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveCityFailedItems(items) {
    try {
      if (items && items.length) localStorage.setItem(CITY_FAILED_KEY, JSON.stringify(items));
      else localStorage.removeItem(CITY_FAILED_KEY);
    } catch (_) {}
  }

  async function collectCityTile(templateUrl, strategy, tile, requestOptions) {
    // v4.0 테스트/기존 호출의 bounds 스키마 인자도 계속 허용합니다.
    if (strategy && !strategy.mode) strategy = {mode: "bounds", schema: strategy};
    var found = new Map();
    var lastJson = {};
    var truncated = false;
    for (var page = 1; page <= CITY_TILE_MAX_PAGES; page += 1) {
      var url = strategy.mode === "district"
        ? buildDistrictUrl(templateUrl, tile, page)
        : buildTileUrl(templateUrl, strategy.schema, tile, page);
      var response = await fetchPageWithRetry(url, requestOptions, 3);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("네이버 로그인이 만료되었습니다. 다시 로그인한 뒤 이어서 수집해 주세요.");
        throw new Error("대전 구역 조회 실패(HTTP " + response.status + ")");
      }
      lastJson = await response.json();
      var items = articleList(lastJson);
      var before = found.size;
      items.forEach(function(article) {
        if (article && article.articleNo) found.set(String(article.articleNo), article);
      });
      if (!items.length || found.size === before || hasMore(lastJson) === false) break;
      var expected = expectedCount(lastJson);
      if (expected && found.size >= expected) break;
      if (page === CITY_TILE_MAX_PAGES) truncated = hasMore(lastJson) !== false;
      await delay(180);
    }
    return {articles: Array.from(found.values()), truncated: truncated};
  }

  async function saveCityArticles(rawArticles, progress, context) {
    var items = rawArticles.map(normalize).filter(function(item) { return item.articleNo; });
    var seen = new Set(progress.seenIds || []);
    progress.failedItems = Array.isArray(progress.failedItems) ? progress.failedItems : loadCityFailedItems();
    items = items.filter(function(item) { return !seen.has(String(item.articleNo)); });
    for (var index = 0; index < items.length;) {
      throwIfStopRequested();
      var batch = items.slice(index, index + BATCH_SIZE);
      var batchStartedAt = Date.now();
      var result = await postBatchWithRetry(batch, 3, {
        sessionId: progress.sessionId,
        scope: progress.scope || "대전 전체(5개 구)",
        startedAt: progress.startedAt,
        requestId: progress.sessionId + "-city-" + clean(context && context.district || "tile") + "-" +
          clean(context && context.page || "0") + "-" + index
      });
      var failed = Number(result.failed) || 0;
      var errors = Array.isArray(result.errors) ? result.errors : [];
      var failedIds = {};
      errors.forEach(function(error) {
        if (error && error.articleNo) failedIds[String(error.articleNo)] = String(error.message || "저장 실패");
      });
      if (failed && !Object.keys(failedIds).length) {
        batch.slice(0, failed).forEach(function(item) { failedIds[String(item.articleNo)] = "저장 실패"; });
      }
      var batchIds = {};
      batch.forEach(function(item) { batchIds[String(item.articleNo)] = true; });
      progress.failedItems = progress.failedItems.filter(function(entry) {
        return !batchIds[String(entry.articleNo)];
      });
      batch.forEach(function(item) {
        var articleNo = String(item.articleNo);
        if (!failedIds[articleNo]) return;
        progress.failedItems.push({
          articleNo: articleNo,
          message: failedIds[articleNo],
          district: context && context.district || "",
          page: context && context.page || "",
          item: item
        });
      });
      addResultTotals(progress, result);
      batch.forEach(function(item) { seen.add(String(item.articleNo)); });
      progress.seenIds = Array.from(seen);
      dashboardFromTotals(
        progress.seenIds.length,
        progress.seenIds.length,
        progress
      );
      persistNaverProgress(progress);
      saveCityFailedItems(progress.failedItems);
      adjustBatchSize(Date.now() - batchStartedAt, failed);
      index += batch.length;
      throwIfStopRequested();
      await delay(CITY_SAVE_DELAY);
    }
    return items.length;
  }

  async function retryFailedCityArticles(progress) {
    var pending = (progress.failedItems || loadCityFailedItems()).slice();
    var remaining = [];
    for (var index = 0; index < pending.length; index += 1) {
      throwIfStopRequested();
      var entry = pending[index];
      try {
        var result = await postBatchWithRetry([entry.item], 2, {
          sessionId: progress.sessionId,
          scope: progress.scope || "대전 전체(5개 구)",
          startedAt: progress.startedAt,
          requestId: progress.sessionId + "-retry-" + clean(entry.articleNo)
        });
        if (Number(result.failed) || !result.ok) {
          var error = Array.isArray(result.errors) && result.errors[0];
          entry.message = error && error.message || entry.message || "저장 실패";
          remaining.push(entry);
        } else {
          addResultTotals(progress, result);
        }
      } catch (error) {
        entry.message = String(error && error.message ? error.message : error);
        remaining.push(entry);
      }
      await delay(180);
    }
    progress.failedItems = remaining;
    saveCityFailedItems(remaining);
    persistNaverProgress(progress);
    return remaining;
  }

  async function collectCityDistrict(templateUrl, district, requestOptions, progress) {
    var startPage = Math.max(1, Number(district.nextPage) || 1);
    var bufferedArticles = [];
    var previousSignature = district.lastPageSignature || "";
    for (var page = startPage; page <= CITY_DISTRICT_MAX_PAGES; page += 1) {
      setStatus(
        "대전 5개 구 자동 수집 중",
        "현재 " + district.name + " " + page + "페이지 · 저장대기 " + bufferedArticles.length + "/100개 · 완료 구역 " + progress.completed + "/5\n최대 100개씩 묶어 빠르게 저장하며, 중단 시 마지막 저장 묶음부터 안전하게 다시 시작합니다."
      );
      var url = buildDistrictUrl(templateUrl, district, page);
      var response = await fetchPageWithRetry(url, requestOptions, 3);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("네이버 로그인이 만료되었습니다. 다시 로그인한 뒤 같은 버튼을 눌러주세요.");
        throw new Error(district.name + " " + page + "페이지 조회 실패(HTTP " + response.status + ")");
      }
      var json = await response.json();
      var items = articleList(json);
      if (!items.length) {
        if (bufferedArticles.length) await saveCityArticles(bufferedArticles, progress, {district: district.name, page: page - 1});
        district.nextPage = page;
        district.lastPageSignature = previousSignature;
        saveCityProgress(progress);
        return {complete: true, pages: page - 1};
      }
      var signature = items.map(function(article) { return article && article.articleNo; }).filter(Boolean).join(",");
      if (signature && signature === previousSignature) {
        if (bufferedArticles.length) await saveCityArticles(bufferedArticles, progress, {district: district.name, page: page - 1});
        district.nextPage = page;
        district.lastPageSignature = previousSignature;
        saveCityProgress(progress);
        return {complete: true, pages: page - 1};
      }

      bufferedArticles = bufferedArticles.concat(items);
      previousSignature = signature;
      var isLastPage = hasMore(json) === false;
      if (bufferedArticles.length >= BATCH_SIZE || isLastPage) {
        await saveCityArticles(bufferedArticles, progress, {district: district.name, page: page});
        bufferedArticles = [];
        district.lastPageSignature = signature;
        district.nextPage = page + 1;
        saveCityProgress(progress);
      }

      if (isLastPage) return {complete: true, pages: page};
      await delay(CITY_PAGE_DELAY);
    }
    throw new Error(district.name + "가 500페이지를 넘었습니다. 저장된 다음 페이지부터 이어지도록 일시정지했습니다.");
  }

  async function collectFinDistrictRaw(district, cursor, onPage, onCursorSaved) {
    cursor = cursor || {};
    var found = new Map();
    var page = Math.max(1, Number(cursor.nextPage) || 1);
    var seed = clean(cursor.seed);
    var lastInfo = Array.isArray(cursor.lastInfo) ? cursor.lastInfo : [];
    var previousSignature = clean(cursor.lastPageSignature);
    var expected = Number(cursor.expected) ||
      (cursor.key ? 0 : Number(state.clickedClusterCount)) || 0;

    for (; page <= FIN_MAX_PAGES; page += 1) {
      throwIfStopRequested();
      var body = buildFinDistrictRequest(district, {
        seed: seed,
        lastInfo: lastInfo
      });
      setStatus(
        district.name + " 전체 목록 수집 중",
        page + "페이지 · 찾은 매물 " + formatNumber(found.size) +
        (expected ? "/" + formatNumber(expected) : "") + "개"
      );
      var response = await fetchPageWithRetry(FIN_ARTICLE_LIST_PATH, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }, 3);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("네이버 로그인이 만료되었습니다. 로그인 후 같은 버튼을 다시 눌러주세요.");
        }
        throw new Error(district.name + " 목록 조회 실패(HTTP " + response.status + ")");
      }

      var json = await response.json();
      throwIfStopRequested();
      var result = json && json.result || {};
      var items = articleList(json).filter(function (article) {
        return !!articleId(article);
      });
      var signature = items.map(articleId).join(",");
      if (signature && signature === previousSignature) break;
      previousSignature = signature;
      items.forEach(function (article) {
        found.set(articleId(article), article);
      });
      expected = Number(result.totalCount || expected) || found.size;
      seed = clean(result.seed || seed);
      lastInfo = Array.isArray(result.lastInfo) ? result.lastInfo : [];

      updateDashboard({
        found: found.size,
        remaining: Math.max(0, expected - found.size)
      });
      setProgress(found.size, expected || Math.max(found.size + 1, 1));
      if (typeof onPage === "function" && items.length) {
        await onPage(items, {
          page: page,
          expected: expected,
          found: found.size,
          seed: seed,
          lastInfo: lastInfo
        });
      }
      cursor.seed = seed;
      cursor.lastInfo = lastInfo;
      cursor.lastPageSignature = signature;
      cursor.nextPage = page + 1;
      cursor.expected = expected;
      if (typeof onCursorSaved === "function") {
        await onCursorSaved(cursor);
      }

      if (!items.length || result.hasNextPage === false) {
        return Array.from(found.values());
      }
      await delay(CITY_PAGE_DELAY);
    }

    if (page > FIN_MAX_PAGES) {
      throw new Error(district.name + " 목록이 500페이지를 넘었습니다. 저장된 다음 페이지부터 이어집니다.");
    }
    return Array.from(found.values());
  }

  async function collectFinSelectedAndSave(options) {
    options = options || {};
    if (state.busy || state.preparing) {
      return {ok: false, complete: false, message: "네이버 수집기가 아직 다른 준비 또는 저장 작업을 진행 중입니다."};
    }
    var district = state.selectedDistrict;
    if (!district) {
      discoverFinContext();
      return;
    }
    if (options.automatic) {
      // Automatic runs used to stream every list page straight into detail
      // storage. Discard that legacy checkpoint and use the same manifest-first
      // path as manual collection: list IDs, compare, then detail only new or
      // materially changed listings.
      clearAutoDistrictProgress(district.cortarNo);
    }
    state.preparing = true;
    beginCollectorRun();
    saveButton.disabled = true;
    retryButton.disabled = true;
    cityButton.disabled = true;
    state.dashboard = createEmptyDashboard();
    updateDashboard(state.dashboard);
    try {
      var articles = await collectFinDistrictRaw(district, {});
      if (!articles.length) throw new Error(district.name + "에서 매물을 찾지 못했습니다.");
      state.preparing = false;
      var saveResult = await collectAndSave(articles, "대전 " + district.name + " 전체", {
        complete: true,
        source: "네이버"
      });
      return saveResult || {ok: false, complete: false, message: "네이버 수집 결과를 확인하지 못했습니다."};
    } catch (error) {
      state.preparing = false;
      if (error && error.safeStop) {
        setStatus(
          "네이버 안전중단 완료",
          "아직 서버 저장을 시작하기 전 단계에서 중단했습니다. 기존 저장자료에는 영향이 없습니다."
        );
      } else {
        setStatus("네이버 수집 오류", String(error && error.message ? error.message : error));
        updateDashboard({failed: Number(state.dashboard.failed || 0) + 1});
      }
      saveButton.disabled = false;
      retryButton.disabled = false;
      cityButton.disabled = false;
      saveButton.textContent = district.name + " 다시 수집";
      finishCollectorRun();
      return {
        ok: false,
        complete: false,
        message: String(error && error.message ? error.message : error)
      };
    }
  }

  async function collectFinAutomaticDistrict(district) {
    clearAutoDistrictProgress(district.cortarNo);
    state.selectedDistrict = district;
    return collectFinSelectedAndSave({automatic: false});
  }

  async function collectFinDaejeonAll() {
    if (state.busy) return;
    beginCollectorRun();
    var progress = loadCityProgress();
    if (
      !progress ||
      progress.mode !== "fin-district" ||
      !Array.isArray(progress.queue) ||
      !progress.queue.length
    ) {
      progress = {
        version: 1,
        mode: "fin-district",
        scope: "대전 전체(5개 구)",
        startedAt: new Date().toISOString(),
        queue: createInitialDistricts(),
        completed: 0,
        seenIds: [],
        saved: 0,
        accepted: 0,
        duplicate: 0,
        detailedDuplicates: 0,
        skippedUnchanged: 0,
        failed: 0,
        created: 0,
        merged: 0,
        updated: 0,
        review: 0,
        failedItems: loadCityFailedItems()
      };
    }
    if (!progress.sessionId) progress.sessionId = createCollectionSessionId();
    saveCityProgress(progress);
    state.busy = true;
    state.prepareId += 1;
    saveButton.disabled = true;
    retryButton.disabled = true;
    cityButton.disabled = true;
    state.dashboard = createEmptyDashboard();
    updateDashboard(state.dashboard);

    try {
      while (progress.queue.length) {
        throwIfStopRequested();
        var district = progress.queue[0];
        setStatus(
          "대전 5개 구 자동 수집 중",
          "현재 " + district.name + " · 완료 " + progress.completed + "/5개 구 · " +
          "저장 반영 " + formatNumber(progress.seenIds.length) + "개\n" +
          "창을 닫거나 중단돼도 현재 구의 마지막 페이지부터 이어집니다."
        );
        await collectFinDistrictRaw(
          district,
          district,
          async function (items, pageInfo) {
            await saveCityArticles(items, progress, {
              district: district.name,
              page: pageInfo.page
            });
            dashboardFromTotals(
              progress.seenIds.length,
              progress.seenIds.length,
              progress
            );
          },
          function () {
            saveCityProgress(progress);
          }
        );
        progress.queue.shift();
        progress.completed += 1;
        saveCityProgress(progress);
        setProgress(progress.completed, 5);
        await delay(260);
      }

      if (!progress.seenIds.length) {
        throw new Error("대전 5개 구에서 감지된 매물이 없습니다. 네이버 필터를 확인해 주세요.");
      }
      setStatus("저장 실패 매물 마지막 재시도 중", "주소 확인이 늦었던 매물을 한 번 더 저장하고 있습니다.");
      var remainingFailures = await retryFailedCityArticles(progress);
      await finalizeNaverSession({
        sessionId: progress.sessionId,
        scope: progress.scope,
        source: "네이버",
        complete: remainingFailures.length === 0,
        observedSourceIds: progress.seenIds,
        expectedCount: progress.seenIds.length,
        manifestCount: progress.seenIds.length,
        processedCount: progress.seenIds.length,
        failed: remainingFailures.length,
        addressMissing: remainingFailures.length,
        truncated: false,
        note: remainingFailures.length
          ? "대전 전체 수집 완료 · 주소미확인 " + remainingFailures.length + "건"
          : "대전 전체 수집 완료"
      });
      var accepted = Number(progress.accepted || progress.saved || 0);
      var sessionResult = await waitForNaverSessionResult(
        progress,
        progress.seenIds.length,
        accepted,
        remainingFailures.length
      );
      var finalResult = sessionResult && sessionResult.finished ? sessionResult : progress;
      updateDashboard({
        found: progress.seenIds.length,
        processed: progress.seenIds.length,
        remaining: 0,
        created: finalResult.created,
        merged: finalResult.merged,
        updated: finalResult.updated,
        review: finalResult.review,
        duplicate: finalResult.duplicate,
        detailedDuplicates: finalResult.detailedDuplicates !== undefined
          ? finalResult.detailedDuplicates
          : finalResult.duplicate,
        skippedUnchanged: finalResult.skippedUnchanged || 0,
        addressMissing: remainingFailures.length,
        failed: finalResult.failed
      });
      setProgress(1, 1);
      setStatus(
        "대전 5개 구 수집 완료",
        "고유매물 " + formatNumber(progress.seenIds.length) +
        "개 · JS신규 " + formatNumber(finalResult.created) +
        "개 · 기존통합 " + formatNumber(finalResult.merged) +
        "개 · 조건변경 " + formatNumber(finalResult.updated) +
        "개 · 검증대기 " + formatNumber(finalResult.review) +
        "개 · 상세중복 " + formatNumber(
          finalResult.detailedDuplicates !== undefined
            ? finalResult.detailedDuplicates
            : finalResult.duplicate
        ) +
        "개 · 기존동일생략 " + formatNumber(finalResult.skippedUnchanged) +
        "개 · 주소미확인 " + formatNumber(remainingFailures.length) + "개"
      );
      clearCityProgress();
    } catch (error) {
      if (error && error.safeStop && progress.sessionId && progress.seenIds.length) {
        try {
          await finalizeNaverSession({
            sessionId: progress.sessionId,
            scope: progress.scope,
            source: "네이버",
            complete: false,
            stopped: true,
            observedSourceIds: progress.seenIds,
            expectedCount: progress.seenIds.length,
            manifestCount: progress.seenIds.length,
            processedCount: progress.seenIds.length,
            note: "사용자 안전중단 · 이어가기 상태 보존"
          });
        } catch (_) {}
      }
      if (!(error && error.safeStop)) {
        progress.failed = Number(progress.failed || 0) + 1;
      }
      saveCityProgress(progress);
      updateDashboard({failed: progress.failed});
      setStatus(
        error && error.safeStop ? "네이버 안전중단 완료" : "대전 5개 구 수집 일시정지",
        (error && error.safeStop
          ? "현재 저장 묶음까지 보존했습니다. 완전수집으로 처리하지 않았습니다."
          : String(error && error.message ? error.message : error)) +
        "\n같은 버튼을 다시 누르면 저장된 다음 페이지부터 이어집니다."
      );
    } finally {
      state.busy = false;
      retryButton.disabled = false;
      saveButton.disabled = !state.selectedDistrict;
      cityButton.disabled = false;
      updateCityButton();
      finishCollectorRun();
    }
  }

  async function collectDaejeonAll() {
    if (isFinNaver()) return collectFinDaejeonAll();
    if (state.busy) return;
    if (!state.capture) {
      return setStatus("대전 전체 수집 준비 필요", "네이버 지도에서 대전 지역을 연 뒤 ‘현재 목록 다시 감지’를 눌러주세요.");
    }
    var strategy = getCityStrategy(state.capture.responseUrl);
    if (!strategy) {
      return setStatus(
        "대전 지역 요청을 찾지 못했습니다.",
        "지도 상단에서 대전의 아무 구나 선택한 뒤 ‘현재 목록 다시 감지’를 눌러주세요. 클러스터나 동은 누르지 않아도 됩니다."
      );
    }

    var progress = loadCityProgress();
    if (!progress || progress.mode !== strategy.mode || !Array.isArray(progress.queue) || !progress.queue.length) {
      progress = {
        version: 1,
        mode: strategy.mode,
        startedAt: new Date().toISOString(),
        queue: strategy.mode === "district" ? createInitialDistricts() : createInitialCityTiles(),
        completed: 0,
        seenIds: [],
        saved: 0,
        accepted: 0,
        duplicate: 0,
        detailedDuplicates: 0,
        skippedUnchanged: 0,
        failed: 0,
        created: 0,
        merged: 0,
        updated: 0,
        review: 0,
        failedItems: loadCityFailedItems()
      };
    }
    if (!progress.sessionId) progress.sessionId = createCollectionSessionId();
    saveCityProgress(progress);

    state.busy = true;
    state.prepareId += 1;
    saveButton.disabled = true;
    retryButton.disabled = true;
    cityButton.disabled = true;
    var templateUrl = state.capture.responseUrl;
    var requestOptions = replayOptions(state.capture);

    try {
      while (progress.queue.length) {
        var tile = progress.queue[0];
        var totalTiles = progress.completed + progress.queue.length;
        setStatus(
          strategy.mode === "district" ? "대전 5개 구 자동 수집 중" : "대전 전체 구역 수집 중",
          (tile.name ? "현재 " + tile.name + " · " : "") + "완료 " + progress.completed + "/" + totalTiles + "구역 · 고유매물 " + progress.seenIds.length + "개\n중단돼도 이 구역부터 이어집니다."
        );
        setProgress(progress.completed, totalTiles);
        if (strategy.mode === "district") {
          await collectCityDistrict(templateUrl, tile, requestOptions, progress);
          progress.queue.shift();
          progress.completed += 1;
          saveCityProgress(progress);
          await delay(260);
          continue;
        }
        var tileResult = await collectCityTile(templateUrl, strategy, tile, requestOptions);
        if (tileResult.truncated) {
          if ((tile.depth || 0) >= CITY_MAX_SPLIT_DEPTH) {
            throw new Error("매물이 매우 많은 구역의 세분화 한도에 도달했습니다. 해당 구역부터 다시 이어집니다.");
          }
          progress.queue.shift();
          progress.queue = splitCityTile(tile).concat(progress.queue);
          saveCityProgress(progress);
          continue;
        }
        await saveCityArticles(tileResult.articles, progress);
        progress.queue.shift();
        progress.completed += 1;
        saveCityProgress(progress);
        await delay(260);
      }

      if (!progress.seenIds.length) throw new Error("대전 전체에서 감지된 매물이 없습니다. 네이버의 매물 종류와 거래방식 필터를 확인해 주세요.");
      setStatus("저장 실패 매물 마지막 재시도 중", "주소 확인이 늦었던 매물을 한 번 더 저장하고 있습니다.");
      var remainingFailures = await retryFailedCityArticles(progress);
      await finalizeNaverSession({
        sessionId: progress.sessionId,
        scope: "대전 전체(5개 구)",
        source: "네이버",
        complete: remainingFailures.length === 0,
        observedSourceIds: progress.seenIds,
        expectedCount: progress.seenIds.length,
        manifestCount: progress.seenIds.length,
        processedCount: progress.seenIds.length,
        failed: remainingFailures.length,
        addressMissing: remainingFailures.length,
        truncated: false,
        note: remainingFailures.length
          ? "대전 전체 수집 완료 · 주소미확인 " + remainingFailures.length + "건은 다음 실행 시 재시도"
          : "대전 전체 수집 완료"
      });
      var cityAccepted = Number(progress.accepted || progress.saved || 0);
      var cityResult = await waitForNaverSessionResult(
        progress,
        progress.seenIds.length,
        cityAccepted,
        remainingFailures.length
      );
      setProgress(1, 1);
      if (cityResult && cityResult.finished) {
        setStatus(
          "대전 전체 수집 완료",
          "고유매물 " + progress.seenIds.length +
            "개 · JS신규 " + Number(cityResult.created || 0) +
            "개 · 기존통합 " + Number(cityResult.merged || 0) +
            "개 · 조건갱신 " + Number(cityResult.updated || 0) +
            "개 · 검증대기 " + Number(cityResult.review || 0) +
            "개 · 상세중복 " + Number(cityResult.duplicate || 0) +
            "개 · 기존동일생략 " + Number(progress.skippedUnchanged || 0) +
            "개 · 주소미확인 " + remainingFailures.length + "개"
        );
      } else {
        setStatus(
          "대전 전체 수집 완료",
          "고유매물 " + progress.seenIds.length +
            "개 · 정상접수 " + cityAccepted +
            "개 · JS신규/통합 판정은 자동 진행 중입니다." +
            (cityResult
              ? " 현재 반영 " + Number(cityResult.processed || 0) +
                "개 · 처리중 " + Number(cityResult.pending || 0) + "개"
              : "") +
            " · 주소미확인 " + remainingFailures.length + "개"
        );
      }
      clearCityProgress();
    } catch (error) {
      progress.failed += 1;
      saveCityProgress(progress);
      setStatus("대전 전체 수집 일시정지", String(error && error.message ? error.message : error) + "\n다시 누르면 남은 구역부터 이어집니다.");
    } finally {
      state.busy = false;
      retryButton.disabled = false;
      saveButton.disabled = !(state.capture && state.capture.prepared);
      cityButton.disabled = !getCityStrategy(state.capture && state.capture.responseUrl);
      updateCityButton();
    }
  }

  async function fetchPageWithRetry(url, options, attempts) {
    var lastResponse = null;
    var lastError = null;
    for (var attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        lastResponse = await nativeFetch(url, options);
        if (lastResponse.ok || (lastResponse.status !== 429 && lastResponse.status < 500)) {
          return lastResponse;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(350 * attempt);
    }
    if (lastResponse) return lastResponse;
    throw lastError || new Error("네이버 목록을 불러오지 못했습니다.");
  }

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function naverListingUrl(articleNo, currentUrl) {
    var id = clean(articleNo);
    if (!id) return "";

    try {
      if (/fin\.land\.naver\.com$/i.test(new URL(clean(currentUrl) || location.href).hostname)) {
        return "https://fin.land.naver.com/articles/" + encodeURIComponent(id);
      }
      var url = new URL(clean(currentUrl) || "https://new.land.naver.com/offices");
      url.searchParams.set("articleNo", id);
      return url.toString();
    } catch (_) {
      return "https://new.land.naver.com/offices?articleNo=" + encodeURIComponent(id);
    }
  }

  function finAddressText(address) {
    if (!address || typeof address !== "object") return clean(address);
    var jibun = clean(
      address.jibun || address.landNumber || address.jibunNumber ||
      address.lotNumber
    );
    var parts = [
      address.city || address.cityName || address.sidoName,
      address.division || address.divisionName || address.sigunguName,
      address.sector || address.sectorName || address.emdName,
      address.li || address.liName,
      jibun
    ].map(clean).filter(Boolean);
    return parts.filter(function(value, index) {
      return parts.indexOf(value) === index;
    }).join(" ");
  }

  function finJibunFromPnu(value) {
    var pnu = clean(value).replace(/\D/g, "");
    if (!/^\d{19}$/.test(pnu)) return "";
    var mountain = pnu.charAt(10) === "2" ? "산 " : "";
    var main = parseInt(pnu.slice(11, 15), 10);
    var sub = parseInt(pnu.slice(15, 19), 10);
    if (!main) return "";
    return mountain + main + (sub ? "-" + sub : "");
  }

  function finExactAddressText(fallbackAddress, keyAddress, basicAddress, pnu) {
    var candidates = [
      finAddressText(basicAddress),
      finAddressText(keyAddress),
      clean(fallbackAddress)
    ];
    for (var index = 0; index < 2; index += 1) {
      if (
        hasExactNaverJibun(candidates[index]) &&
        (candidates[index].split(/\s+/).length >= 3 || !clean(fallbackAddress))
      ) {
        return candidates[index];
      }
    }
    if (hasExactNaverJibun(candidates[2])) return candidates[2];

    var key = keyAddress && typeof keyAddress === "object" ? keyAddress : {};
    var basic = basicAddress && typeof basicAddress === "object" ? basicAddress : {};
    var jibun = clean(
      key.jibun || key.landNumber || key.jibunNumber || key.lotNumber ||
      basic.jibun || basic.landNumber || basic.jibunNumber || basic.lotNumber ||
      finJibunFromPnu(pnu)
    );
    if (!/^(?:산\s*)?\d+(?:-\d+)?$/.test(jibun)) return clean(fallbackAddress);

    var base = clean(fallbackAddress)
      .replace(/\s+(?:산\s*)?\d+(?:-\d+)?(?:\s|$).*$/, "")
      .trim();
    var localName = clean(
      key.li || key.liName || key.sector || key.sectorName || key.emdName ||
      basic.li || basic.liName || basic.sector || basic.sectorName || basic.emdName
    );
    if (localName && base.indexOf(localName) < 0) {
      base = [base, localName].filter(Boolean).join(" ");
    }
    return [base, jibun].filter(Boolean).join(" ");
  }

  function finFloorInfo(article) {
    var detail = article && article.articleDetail || {};
    var space = article && article.spaceInfo || {};
    var floor = article && article.floorInfo || detail.floorInfo || space.floorInfo;
    if (floor && typeof floor === "object") {
      var current = clean(
        floor.currentFloor || floor.floor || floor.targetFloor || floor.floorName
      );
      var total = clean(floor.totalFloor || floor.highFloor || floor.maxFloor);
      if (current && total) return current + "/" + total + "층";
      return current || total;
    }
    return clean(floor);
  }

  function finKrwToManwon(value) {
    if (value === "" || value == null) return "";
    var number = typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(number)) return clean(value);
    return Math.round(number / 1000) / 10;
  }

  function normalize(article) {
    article = article && article.representativeArticleInfo || article || {};
    var isFinPrice = !!(
      article.priceInfo &&
      typeof article.priceInfo === "object"
    );
    var price = article.priceInfo || article.price || {};
    var address = article.address || {};
    var coordinates = address.coordinates || {};
    var space = article.spaceInfo || {};
    var detail = article.articleDetail || {};
    var broker = article.brokerInfo || {};
    var articleNo = articleId(article);
    var listImages = finImageUrls(article);
    var tradeCode = clean(article.tradeType);
    var categoryCode = clean(article.realEstateType);
    var deposit = isFinPrice
      ? finKrwToManwon(
        price.warrantyPrice != null
          ? price.warrantyPrice
          : price.dealPrice != null
            ? price.dealPrice
            : price.deposit
      )
      : article.dealOrWarrantPrc != null
        ? article.dealOrWarrantPrc
        : article.depositPrice != null
          ? article.depositPrice
          : price.deposit;
    var monthly = isFinPrice
      ? finKrwToManwon(
        price.rentPrice != null ? price.rentPrice : price.monthly
      )
      : article.rentPrc != null
        ? article.rentPrc
        : article.monthlyPrice != null
          ? article.monthlyPrice
          : price.monthly;
    var areaSquareMeter =
      space.exclusiveSpace != null ? space.exclusiveSpace :
      space.contractSpace != null ? space.contractSpace :
      space.supplySpace != null ? space.supplySpace :
      space.floorSpace != null ? space.floorSpace :
      space.landSpace != null ? space.landSpace :
      article.area2 != null ? article.area2 : article.area1;
    var normalized = {
      articleNo: articleNo,
      buildingName: clean(
        article.complexName || article.buildingName || article.articleName
      ),
      category: clean(
        article.articleRealEstateTypeName || article.realEstateTypeName ||
        REAL_ESTATE_TYPE_LABELS[categoryCode] || categoryCode
      ),
      realEstateTypeCode: categoryCode,
      tradeType: clean(
        article.tradeTypeName || TRADE_TYPE_LABELS[tradeCode] || tradeCode
      ),
      tradeTypeCode: tradeCode,
      deposit: clean(deposit),
      monthly: clean(monthly),
      areaSquareMeter: areaSquareMeter,
      floorInfo: finFloorInfo(article),
      roomInfo: clean(
        article.roomInfo || article.roomName || article.unitInfo ||
        detail.roomInfo || article.dongName
      ),
      direction: clean(article.direction || detail.direction),
      description: clean(
        article.articleFeatureDesc || article.articleFeatureDescription ||
        detail.articleFeatureDescription || detail.description
      ),
      tags: Array.isArray(article.tagList)
        ? article.tagList
        : Array.isArray(detail.tagList) ? detail.tagList : [],
      latitude: article.latitude || article.lat || article.mapY ||
        coordinates.yCoordinate || "",
      longitude: article.longitude || article.lng || article.lon || article.mapX ||
        coordinates.xCoordinate || "",
      jibunAddress: clean(
        article.jibunAddress || article.jibunAddr || article.articleAddress ||
        (typeof article.address === "string" ? article.address : "") ||
        finAddressText(address) || article.cortarAddress || article.locationAddress
      ),
      realtorName: clean(
        article.realtorName || broker.brokerageName || broker.realtorName
      ),
      providerUrl: clean(
        article.cpPcArticleUrl || article.cpMobileArticleUrl || article.providerUrl
      ),
      currentUrl: location.href,
      sourceLink: naverListingUrl(articleNo, location.href),
      primaryImage: listImages[0] || "",
      imageUrls: listImages
    };
    normalized.listSnapshot = naverListSnapshot(normalized);
    return normalized;
  }

  function finImageUrls(input) {
    var urls = [];
    var seen = Object.create(null);
    var imageKey = /(?:image|images|photo|photos|thumbnail|thumb|picture|pictures|media)/i;
    function variantKey(url) {
      try {
        var parsed = new URL(url, location.href);
        if (/\.pstatic\.net$/i.test(parsed.hostname) ||
            /(?:thumb|image|photo)/i.test(parsed.hostname)) {
          return parsed.origin + parsed.pathname;
        }
      } catch (_) {}
      return url;
    }
    function variantScore(url) {
      var score = 0;
      if (/[?&](?:type|t)=crop(?:&|$)/i.test(url)) score -= 100;
      if (/(?:thumbnail|thumb)/i.test(url)) score -= 30;
      var size = url.match(/[?&]s=(\d+)x(\d+)/i);
      if (size) score += Math.min(Number(size[1]), Number(size[2])) / 100;
      return score;
    }
    function add(value) {
      var url = clean(value);
      if (!/^https?:\/\//i.test(url)) return;
      if (!/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(url) &&
          !/(?:image|photo|thumb|pstatic|naver|cdn)/i.test(url)) return;
      var key = variantKey(url);
      if (seen[key] != null) {
        var index = seen[key];
        if (variantScore(url) > variantScore(urls[index])) urls[index] = url;
        return;
      }
      seen[key] = urls.length;
      urls.push(url);
    }
    function walk(value, key, depth) {
      if (value == null || depth > 5) return;
      if (typeof value === "string") {
        if (imageKey.test(key || "") || /^https?:\/\//i.test(value)) add(value);
        return;
      }
      if (Array.isArray(value)) {
        value.slice(0, 40).forEach(function(entry) { walk(entry, key, depth + 1); });
        return;
      }
      if (typeof value !== "object") return;
      Object.keys(value).slice(0, 100).forEach(function(childKey) {
        if (imageKey.test(childKey) || depth < 3) walk(value[childKey], childKey, depth + 1);
      });
    }
    walk(input, "", 0);
    return urls.slice(0, 30);
  }

  function finDetailFloor(detailResult, fallback) {
    detailResult = detailResult || {};
    var detailInfo = detailResult.detailInfo || {};
    var articleDetail = detailInfo.articleDetailInfo ||
      detailResult.articleDetailInfo || detailResult.articleDetail || {};
    var floorDetail = articleDetail.floorDetailInfo || detailInfo.floorDetailInfo || {};
    var current = clean(
      floorDetail.currentFloor || floorDetail.floor || floorDetail.targetFloor ||
      articleDetail.floorInfo || detailInfo.floorInfo
    );
    var total = clean(
      floorDetail.totalFloor || floorDetail.highFloor || floorDetail.maxFloor ||
      articleDetail.totalFloor || detailInfo.totalFloor
    );
    if (current && total && current.indexOf("/") < 0) return current + "/" + total + "층";
    return current || clean(fallback);
  }

  function finDetailRoom(detailResult, fallback) {
    detailResult = detailResult || {};
    var detailInfo = detailResult.detailInfo || {};
    var articleDetail = detailInfo.articleDetailInfo ||
      detailResult.articleDetailInfo || detailResult.articleDetail || {};
    var registration = detailResult.registration || {};
    return clean(
      articleDetail.hoNumber || articleDetail.roomInfo || detailInfo.hoNumber ||
      detailInfo.roomInfo || registration.hoNumber || fallback
    );
  }

  function finDetailArea(detailResult, fallback) {
    detailResult = detailResult || {};
    var detailInfo = detailResult.detailInfo || {};
    var space = detailInfo.spaceInfo || detailResult.spaceInfo || {};
    var size = detailInfo.sizeInfo || detailResult.sizeInfo || {};
    var value =
      space.exclusiveSpace != null ? space.exclusiveSpace :
      space.contractSpace != null ? space.contractSpace :
      space.supplySpace != null ? space.supplySpace :
      space.floorSpace != null ? space.floorSpace :
      space.landSpace != null ? space.landSpace :
      size.exclusiveSpace != null ? size.exclusiveSpace :
      size.contractSpace != null ? size.contractSpace :
      fallback;
    return value == null ? "" : value;
  }

  function hasExactNaverJibun(value) {
    var text = clean(value).replace(/\s+/g, " ");
    return /(?:동|가|리|읍|면)\s+(?:산\s*)?\d+(?:-\d+)?(?:\s|$)/.test(text);
  }

  function hasExactNaverFloorOrRoom(item) {
    var value = clean(item && (item.roomInfo || item.floorInfo))
      .replace(/\s+/g, "");
    if (!value || /^(?:0층?|0호)$/.test(value)) return false;
    if (/^(?:지하|B)\d+층?(?:\/|$)/i.test(value)) return true;
    if (/^-?[1-9]\d*층?(?:\/|$)/.test(value)) return true;
    return /(?:^|\D)[1-9]\d*호(?:\D|$)/.test(value);
  }

  function isCompleteNaverLocation(item) {
    return hasExactNaverJibun(item && item.jibunAddress) &&
      hasExactNaverFloorOrRoom(item);
  }

  async function fetchFinJson(url, attempts) {
    var lastError = null;
    for (var attempt = 1; attempt <= (attempts || 4); attempt += 1) {
      throwIfStopRequested();
      try {
        var response = await nativeFetch(url, {
          method: "GET",
          credentials: "include",
          headers: {Accept: "application/json, text/plain, */*"}
        });
        if (response.ok) return await response.json();
        if (response.status !== 429 && response.status < 500) {
          throw new Error("HTTP " + response.status);
        }
        lastError = new Error("HTTP " + response.status);
      } catch (error) {
        lastError = error;
      }
      await delay(Math.min(2500, 250 * attempt * attempt));
    }
    throw lastError || new Error("네이버 상세조회 실패");
  }

  async function enrichNaverDetail(item) {
    var articleNumber = clean(item && item.articleNo);
    if (!articleNumber) return {item: item, valid: false, reason: "매물번호 없음"};
    var realEstateType = clean(item.realEstateTypeCode);
    var tradeType = clean(item.tradeTypeCode);

    // 목록 응답에는 동까지만 있고 지번이 생략되는 경우가 있으므로,
    // 유형이 이미 있어도 key API를 항상 조회해 정확한 지번을 확보합니다.
    var keyUrl = new URL(FIN_ARTICLE_KEY_PATH, location.origin);
    keyUrl.searchParams.set("articleNumber", articleNumber);
    var keyJson = await fetchFinJson(keyUrl.href, 4);
    var keyResult = keyJson && keyJson.result || {};
    var type = keyResult.type || {};
    if (!realEstateType || !tradeType) {
      realEstateType = clean(type.realEstateType || keyResult.realEstateType);
      tradeType = clean(type.tradeType || keyResult.tradeType);
    }
    if (!realEstateType || !tradeType) {
      throw new Error("네이버 상세유형 확인 실패(" + articleNumber + ")");
    }

    var basicUrl = new URL(FIN_ARTICLE_BASIC_PATH, location.origin);
    basicUrl.searchParams.set("articleNumber", articleNumber);
    basicUrl.searchParams.set("realEstateType", realEstateType);
    basicUrl.searchParams.set("tradeType", tradeType);
    var basicJson = await fetchFinJson(basicUrl.href, 5);
    var detailResult = basicJson && basicJson.result || {};
    var address = detailResult.address ||
      (detailResult.detailInfo && detailResult.detailInfo.address) || {};
    var exactAddress = finExactAddressText(
      item.jibunAddress,
      keyResult.address,
      address,
      (keyResult.key && keyResult.key.pnu) || keyResult.pnu
    );
    var detailImages = finImageUrls(detailResult);
    var mergedImages = finImageUrls({
      listImages: item.imageUrls || [],
      detailImages: detailImages
    });
    var detailed = Object.assign({}, item, {
      realEstateTypeCode: realEstateType,
      tradeTypeCode: tradeType,
      jibunAddress: exactAddress || item.jibunAddress,
      floorInfo: finDetailFloor(detailResult, item.floorInfo),
      roomInfo: finDetailRoom(detailResult, item.roomInfo),
      areaSquareMeter: finDetailArea(detailResult, item.areaSquareMeter),
      primaryImage: mergedImages[0] || item.primaryImage || "",
      imageUrls: mergedImages
    });
    return {
      item: detailed,
      valid: isCompleteNaverLocation(detailed),
      reason: hasExactNaverJibun(detailed.jibunAddress)
        ? "정확한 층·호실 없음"
        : "정확한 지번주소 없음"
    };
  }

  async function enrichNaverDetailBatch(items, onProgress) {
    var results = new Array(items.length);
    var cursor = 0;
    var completed = 0;
    async function worker() {
      while (cursor < items.length) {
        var index = cursor;
        cursor += 1;
        results[index] = await enrichNaverDetail(items[index]);
        completed += 1;
        if (onProgress) onProgress(completed, items.length);
      }
    }
    var workers = [];
    for (var index = 0; index < Math.min(FIN_DETAIL_CONCURRENCY, items.length); index += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  function naverListSnapshot(item) {
    item = item || {};
    return JSON.stringify([
      clean(item.articleNo),
      clean(item.buildingName),
      clean(item.category),
      clean(item.tradeType),
      clean(item.deposit),
      clean(item.monthly),
      clean(item.areaSquareMeter),
      clean(item.floorInfo),
      clean(item.roomInfo),
      clean(item.jibunAddress),
      clean(item.description),
      Array.isArray(item.imageUrls) ? item.imageUrls.map(clean).sort() : [],
      Array.isArray(item.tags) ? item.tags.map(clean).sort() : []
    ]);
  }

  async function classifyNaverManifest(items, metadata) {
    var need = Object.create(null);
    var unchanged = 0;
    var changed = 0;
    var unknown = 0;
    var chunkSize = 2500;
    for (var offset = 0; offset < items.length; offset += chunkSize) {
      throwIfStopRequested();
      var chunk = items.slice(offset, offset + chunkSize);
      setStatus(
        "기존 매물 빠른 비교 중",
        Math.min(offset + chunk.length, items.length).toLocaleString("ko-KR") +
        " / " + items.length.toLocaleString("ko-KR") +
        "개 · 신규·변경 매물만 상세 저장합니다."
      );
      setProgress(offset, items.length || 1);
      var response = await nativeFetch(COLLECTOR_API_URL, {
        method: "POST",
        headers: {"Content-Type": "text/plain;charset=utf-8"},
        body: JSON.stringify({
          action: "classifySourceManifest",
          requestId: metadata.sessionId + "-manifest-" + offset,
          collectorKey: getCollectorKey(),
          collectorVersion: VERSION,
          source: "네이버",
          sessionId: metadata.sessionId,
          scope: metadata.scope,
          startedAt: metadata.startedAt,
          entries: chunk.map(function(item) {
            var squareMeters = Number(item.areaSquareMeter) || 0;
            return {
              sourceId: "네이버-" + clean(item.articleNo),
              listSnapshot: item.listSnapshot,
              deposit: item.deposit,
              rent: item.monthly,
              area: squareMeters > 0
                ? Math.round((squareMeters / 3.305785) * 10) / 10
                : "",
              address: item.jibunAddress,
              room: item.roomInfo || item.floorInfo,
              latitude: item.latitude,
              longitude: item.longitude
            };
          })
        })
      });
      var text = await response.text();
      var result;
      try { result = JSON.parse(text); } catch (_) {
        throw new Error("기존 매물 비교 응답을 읽지 못했습니다.");
      }
      if (!result.ok) throw new Error(result.message || "기존 매물 비교에 실패했습니다.");
      (Array.isArray(result.needsDetail) ? result.needsDetail : []).forEach(function(id) {
        need[String(id).replace(/^네이버-/, "")] = true;
      });
      unchanged += Number(result.unchanged || 0);
      changed += Number(result.changed || 0);
      unknown += Number(result.unknown || 0);
      updateDashboard({
        found: items.length,
        processed: Math.min(offset + chunk.length, items.length),
        remaining: Math.max(0, items.length - offset - chunk.length),
        duplicate: unchanged,
        detailedDuplicates: 0,
        skippedUnchanged: unchanged
      });
    }
    return {
      items: items.filter(function(item) { return need[clean(item.articleNo)]; }),
      unchanged: unchanged,
      changed: changed,
      unknown: unknown
    };
  }

  async function postBatch(items, metadata) {
    metadata = metadata || {};
    var response = await nativeFetch(COLLECTOR_API_URL, {
      method: "POST",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({
        action: "saveNaverBatch",
        requestId: metadata.requestId || "",
        collectorKey: getCollectorKey(),
        collectorVersion: VERSION,
        data: items,
        sessionId: metadata.sessionId || "",
        scope: metadata.scope || "선택 클러스터",
        startedAt: metadata.startedAt || "",
        manifestRegistered: Boolean(metadata.manifestRegistered)
      })
    });
    var text = await response.text();
    var result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      throw new Error("JS부동산 저장 서버 응답을 읽지 못했습니다.");
    }
    if (!result.ok) throw new Error(result.message || "D1 저장에 실패했습니다.");
    return result;
  }

  async function finalizeNaverSession(metadata) {
    metadata = metadata || {};
    if (!metadata.sessionId) return {ok: true};
    var response = await nativeFetch(COLLECTOR_API_URL, {
      method: "POST",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({
        action: "finalizeNaverSession",
        collectorKey: getCollectorKey(),
        collectorVersion: VERSION,
        validationVersion: 2,
        sessionId: metadata.sessionId,
        scope: metadata.scope || "선택 클러스터",
        complete: Boolean(metadata.complete),
        stopped: Boolean(metadata.stopped),
        source: metadata.source || "네이버",
        observedSourceIds: Array.isArray(metadata.observedSourceIds)
          ? metadata.observedSourceIds : [],
        expectedCount: Number(metadata.expectedCount || 0),
        manifestCount: Number(metadata.manifestCount || 0),
        processedCount: Number(metadata.processedCount || 0),
        failed: Number(metadata.failed || 0),
        addressMissing: Number(metadata.addressMissing || 0),
        truncated: Boolean(metadata.truncated),
        note: metadata.note || ""
      })
    });
    var text = await response.text();
    var result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      throw new Error("수집회차 완료 응답을 읽지 못했습니다.");
    }
    if (!result.ok) throw new Error(result.message || "수집회차 완료 기록에 실패했습니다.");
    return result;
  }

  async function getNaverSessionResult(metadata) {
    metadata = metadata || {};
    if (!metadata.sessionId) return null;
    var response = await nativeFetch(COLLECTOR_API_URL, {
      method: "POST",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({
        action: "getNaverSessionResult",
        collectorKey: getCollectorKey(),
        sessionId: metadata.sessionId
      })
    });
    var text = await response.text();
    var result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      throw new Error("JS매물 반영 결과를 읽지 못했습니다.");
    }
    if (!result.ok) throw new Error(result.message || "JS매물 반영 결과 확인에 실패했습니다.");
    return result;
  }

  function wait(milliseconds) {
    return new Promise(function(resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitForNaverSessionResult(metadata, found, accepted, failed) {
    var latest = null;
    for (var attempt = 0; attempt < 2; attempt += 1) {
      try {
        latest = await getNaverSessionResult(metadata);
      } catch (_) {
        break;
      }
      if (latest && latest.finished) return latest;
      if (latest) {
        updateDashboard({
          found: found,
          processed: Number(latest.processed || 0),
          remaining: Number(latest.pending || 0),
          created: latest.created,
          merged: latest.merged,
          updated: latest.updated,
          review: latest.review,
          duplicate: latest.duplicate,
          detailedDuplicates: latest.duplicate,
          skippedUnchanged: Number(metadata.skippedUnchanged || 0),
          failed: Number(latest.failed || failed || 0)
        });
        setProgress(Number(latest.processed || 0), found || 1);
        setStatus(
          "JS매물 반영 확인 중",
          "전체 " + found + "개 · 정상접수 " + accepted + "개 · 반영완료 " +
            Number(latest.processed || 0) + "개 · 처리중 " +
            Number(latest.pending || 0) + "개 · 실패 " + failed + "개"
        );
      }
      await wait(800);
    }
    return latest;
  }

  async function collectAndSave(rawOverride, scopeOverride, runOptions) {
    runOptions = runOptions || {};
    var hasOverride = Array.isArray(rawOverride);
    if (
      state.busy ||
      state.preparing ||
      (!hasOverride && (!state.capture || !state.capture.prepared))
    ) return {ok: false, complete: false, message: "네이버 수집기가 이미 실행 중입니다."};
    if (!runOptions.complete) beginCollectorRun();
    state.busy = true;
    saveButton.disabled = true;
    retryButton.disabled = true;
    var totals = {
      saved: 0,
      accepted: 0,
      created: 0,
      merged: 0,
      updated: 0,
      review: 0,
      duplicate: 0,
      detailedDuplicates: 0,
      skippedUnchanged: 0,
      addressMissing: 0,
      failed: 0
    };
    var firstFailure = "";
    var session = {
      sessionId: createCollectionSessionId(),
      scope: scopeOverride || "선택 클러스터",
      startedAt: new Date().toISOString()
    };

    try {
      var rawItems = hasOverride ? rawOverride : await collectAll(state.capture);
      var allItems = rawItems.map(normalize).filter(function (item) {
        return item.articleNo;
      });
      session.observedSourceIds = allItems.map(function(item) {
        return "네이버-" + clean(item.articleNo);
      });
      var classification = await classifyNaverManifest(allItems, session);
      var items = classification.items;
      session.manifestRegistered = true;
      session.skippedUnchanged = classification.unchanged;
      totals.skippedUnchanged = classification.unchanged;
      totals.duplicate = classification.unchanged;
      updateDashboard({
        found: allItems.length,
        processed: classification.unchanged,
        remaining: items.length,
        duplicate: classification.unchanged,
        detailedDuplicates: 0,
        skippedUnchanged: classification.unchanged
      });

      for (var index = 0; index < items.length;) {
        if (state.stopRequested) break;
        var candidateBatch = items.slice(index, index + BATCH_SIZE);
        setStatus(
          "네이버 상세주소·층 확인 중",
          (index + 1) + "~" + (index + candidateBatch.length) + "/" + items.length +
          "개 · 정확한 지번과 실제 층을 확인한 매물만 중복검사에 전달합니다."
        );
        var detailResults = await enrichNaverDetailBatch(
          candidateBatch,
          function(completed, total) {
            setProgress(
              classification.unchanged + index + completed,
              allItems.length || 1
            );
            setStatus(
              "네이버 상세주소·층 확인 중",
              (index + completed).toLocaleString("ko-KR") + " / " +
              items.length.toLocaleString("ko-KR") + "개 · 현재 묶음 " +
              completed + "/" + total + "개"
            );
          }
        );
        var batch = detailResults.filter(function(result) {
          return result && result.valid;
        }).map(function(result) {
          return result.item;
        });
        var incompleteCount = candidateBatch.length - batch.length;
        totals.addressMissing += incompleteCount;
        if (!batch.length) {
          index += candidateBatch.length;
          updateDashboard({
            found: allItems.length,
            processed: classification.unchanged + index,
            remaining: Math.max(0, items.length - index),
            duplicate: totals.duplicate,
            detailedDuplicates: totals.detailedDuplicates,
            skippedUnchanged: totals.skippedUnchanged,
            addressMissing: totals.addressMissing,
            failed: totals.failed
          });
          continue;
        }
        var saveWaitStartedAt = Date.now();
        var saveWaitTimer = window.setInterval(function () {
          showNaverSaveWait(index, batch.length, items.length, saveWaitStartedAt);
        }, 1000);
        showNaverSaveWait(index, batch.length, items.length, saveWaitStartedAt);
        setStatus(
          "JS부동산 매물현황 저장 중",
          (index + 1) + "~" + (index + batch.length) + "/" + items.length + "개 · 최대 " + BATCH_SIZE + "개씩 안전하게 저장합니다."
        );
        setProgress(classification.unchanged + index, allItems.length || 1);
        var batchStartedAt = Date.now();
        var result;
        try {
          result = await postBatchWithRetry(batch, 6, Object.assign({}, session, {
            requestId: session.sessionId + "-batch-" + index
          }));
        } finally {
          window.clearInterval(saveWaitTimer);
        }
        addResultTotals(totals, result);
        if (!firstFailure && Array.isArray(result.errors) && result.errors.length) {
          firstFailure = clean(result.errors[0] && result.errors[0].message);
        }
        adjustBatchSize(Date.now() - batchStartedAt, Number(result.failed || 0));
        index += candidateBatch.length;
        updateDashboard({
          found: allItems.length,
          processed: classification.unchanged + index,
          remaining: Math.max(0, items.length - index),
          created: totals.created,
          merged: totals.merged,
          updated: totals.updated,
          review: totals.review,
          duplicate: totals.duplicate,
          detailedDuplicates: totals.detailedDuplicates,
          skippedUnchanged: totals.skippedUnchanged,
          addressMissing: totals.addressMissing,
          failed: totals.failed
        });
        if (state.stopRequested) break;
        await delay(160);
      }

      var safelyStopped = state.stopRequested;
      if (safelyStopped && index === 0) {
        await finalizeNaverSession({
          sessionId: session.sessionId,
          scope: session.scope,
          source: runOptions.source || "네이버",
          complete: false,
          stopped: true,
          observedSourceIds: session.observedSourceIds,
          note: "사용자 안전중단 · 완전수집 미적용"
        });
        setStatus(
          "네이버 안전중단 완료",
          "서버 저장을 시작하기 전에 중단했습니다. 기존 저장자료에는 영향이 없습니다."
        );
        saveButton.textContent = "다시 수집";
        return;
      }
      var finalResult = await finalizeNaverSession({
        sessionId: session.sessionId,
        scope: session.scope,
        source: runOptions.source || "네이버",
          complete: Boolean(runOptions.complete) && !safelyStopped &&
          Number(totals.failed || 0) === 0 && index >= items.length,
        stopped: safelyStopped,
        observedSourceIds: session.observedSourceIds,
        expectedCount: allItems.length,
        manifestCount: allItems.length,
        processedCount: classification.unchanged + index,
        failed: totals.failed,
        addressMissing: totals.addressMissing,
        truncated: false,
        note: safelyStopped
          ? "사용자 안전중단 · 저장 완료 " + index + "/" + items.length
          : (runOptions.complete ? session.scope + " 완전수집 완료" : "선택 클러스터 수집 완료")
      });
      if (safelyStopped) {
        updateDashboard({
          found: allItems.length,
          processed: classification.unchanged + index,
          remaining: Math.max(0, items.length - index),
          duplicate: totals.duplicate,
          detailedDuplicates: totals.detailedDuplicates,
          skippedUnchanged: totals.skippedUnchanged,
          failed: totals.failed
        });
        setStatus(
          "네이버 안전중단 완료",
          "현재 저장 묶음까지 " + index + "/" + items.length +
          "개를 보존했습니다. 완전수집으로 처리하지 않았으므로 미노출 판정은 실행되지 않습니다."
        );
        saveButton.textContent = "중단 지점부터 다시 수집";
        return;
      }
      var accepted = Number(totals.accepted || totals.saved || 0);
      setStatus(
        "네이버 수집 완료",
        "전체 " + allItems.length + "개 · 기존 동일 " + classification.unchanged +
          "개 · 신규·변경 접수 " + accepted +
          "개 · JS매물 반영 결과 확인 중 · 실패 " + totals.failed + "개" +
          (firstFailure ? "\n첫 실패 원인: " + firstFailure : "")
      );
      var sessionResult = finalResult && finalResult.totals
        ? Object.assign({finished: true}, finalResult.totals)
        : null;
      setProgress(allItems.length, allItems.length || 1);
      if (sessionResult && sessionResult.finished) {
        updateDashboard({
          found: allItems.length,
          processed: allItems.length,
          remaining: 0,
          created: sessionResult.created,
          merged: sessionResult.merged,
          updated: sessionResult.updated,
          review: sessionResult.review,
          duplicate: Number(sessionResult.duplicate || 0) + classification.unchanged,
          detailedDuplicates: Number(sessionResult.duplicate || 0),
          skippedUnchanged: classification.unchanged,
          addressMissing: totals.addressMissing,
          failed: Number(sessionResult.failed || totals.failed || 0)
        });
        setStatus(
          "네이버 수집 완료",
          "전체 " + allItems.length + "개 · 기존 동일 " + classification.unchanged +
            "개 · JS신규 " + Number(sessionResult.created || 0) +
            "개 · 기존통합 " + Number(sessionResult.merged || 0) +
            "개 · 조건갱신 " + Number(sessionResult.updated || 0) +
            "개 · 검증대기 " + Number(sessionResult.review || 0) +
            "개 · 상세중복 " + Number(sessionResult.duplicate || 0) +
            "개 · 기존동일생략 " + classification.unchanged +
            "개 · 주소·층 제외 " + Number(totals.addressMissing || 0) +
            "개 · 실패 " + Number(sessionResult.failed || totals.failed || 0) + "개" +
            (firstFailure ? "\n첫 실패 원인: " + firstFailure : "")
        );
      } else {
        dashboardFromTotals(allItems.length, allItems.length, totals);
        setStatus(
          "네이버 수집 완료",
          "전체 " + allItems.length + "개 · 기존 동일 " + classification.unchanged +
            "개 · 신규·변경 접수 " + accepted +
            "개 · JS신규/통합 판정은 자동 진행 중입니다." +
            (sessionResult
              ? " 현재 반영 " + Number(sessionResult.processed || 0) +
                "개 · 처리중 " + Number(sessionResult.pending || 0) + "개"
              : "") +
            " · 실패 " + totals.failed + "개" +
            (firstFailure ? "\n첫 실패 원인: " + firstFailure : "")
        );
      }
      saveButton.textContent = "저장 완료 · 다시 수집 가능";
      var runComplete = !runOptions.complete || Boolean(finalResult && finalResult.complete);
      return {
        ok: runComplete,
        complete: Boolean(finalResult && finalResult.complete),
        message: runComplete ? "네이버 수집 완료" :
          ((finalResult && Array.isArray(finalResult.completionIssues) && finalResult.completionIssues.length)
            ? finalResult.completionIssues.join(", ")
            : "네이버 수집이 부분수집으로 종료됐습니다."),
        totals: Object.assign({}, totals),
        classification: classification,
        finalResult: finalResult || null
      };
    } catch (error) {
      if (session.manifestRegistered || Number(totals.accepted || 0) > 0) {
        try {
          await finalizeNaverSession({
            sessionId: session.sessionId,
            scope: session.scope,
            source: runOptions.source || "네이버",
            complete: false,
            stopped: Boolean(error && error.safeStop),
            note: error && error.safeStop ? "사용자 안전중단" : "수집 중 오류 · 부분저장 보존"
          });
        } catch (_) {}
      }
      setProgress(0, 0);
      if (error && error.safeStop) {
        setStatus("네이버 안전중단 완료", "이미 저장된 매물은 유지되며 완전수집 판정은 실행하지 않았습니다.");
      } else {
        updateDashboard({failed: Number(state.dashboard.failed || 0) + 1});
        setStatus("네이버 수집 오류", String(error && error.message ? error.message : error));
      }
      saveButton.textContent = "다시 저장";
      return {
        ok: false,
        complete: false,
        message: String(error && error.message ? error.message : error),
        totals: Object.assign({}, totals)
      };
    } finally {
      state.busy = false;
      saveButton.disabled = isFinNaver()
        ? (state.selectionMode === "district" ? !state.selectedDistrict : !state.capture)
        : !state.capture;
      retryButton.disabled = false;
      finishCollectorRun();
    }
  }

  function showNaverSaveWait(index, batchLength, total, startedAt) {
    if (!state.busy || state.stopRequested) return;
    var seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    setStatus(
      "상세조회·중복검사·저장 중",
      (index + 1).toLocaleString("ko-KR") + "~" +
      (index + batchLength).toLocaleString("ko-KR") + " / " +
      total.toLocaleString("ko-KR") + "개 · " +
      seconds.toLocaleString("ko-KR") + "초 경과\n" +
      "매물 저장을 먼저 끝내고 고객매칭은 자동으로 별도 갱신합니다."
    );
  }

  async function postBatchWithRetry(batch, attempts, metadata) {
    var lastError = null;
    for (var attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await postBatch(batch, metadata);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          var message = String(error && error.message ? error.message : error);
          var lockBusy = /다른 수집 (?:작업|저장)이 진행 중/.test(message);
          await delay(lockBusy ? Math.min(10000, 2000 * attempt) : 500 * attempt);
        }
      }
    }
    throw lastError || new Error("JS부동산 매물현황 저장에 실패했습니다.");
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
})();
