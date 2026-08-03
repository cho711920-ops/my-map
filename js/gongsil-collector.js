(function () {
  "use strict";

  var VERSION = "1.9.7";
  var MAX_ITEMS = 5000;
  /*
   * 공실박스 목록 API는 선택 ID가 많아도 한 응답을 약 400개에서
   * 잘라 반환합니다. 서버 상한보다 여유 있게 나눠 조회해야
   * 2천~5천 개짜리 클러스터도 누락 없이 합칠 수 있습니다.
   */
  var LIST_REQUEST_CHUNK_SIZE = 300;
  var SAVE_BATCH_SIZE = 250;
  var MIN_SAVE_BATCH_SIZE = 100;
  var MAX_SAVE_BATCH_SIZE = 400;
  var SAVE_PROGRESS_KEY = "js_gongsil_save_progress_v1";
  var POST_RETRY_DELAYS = [0, 1200, 3000];
  var BUSY_RETRY_DELAYS = [3000, 6000, 10000, 15000, 20000, 30000];
  var PANEL_ID = "js-gongsil-collector-panel";
  var STYLE_ID = "js-gongsil-collector-style";
  var APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbzPedWbaT4yaLNxqrvKI9F3L4JVZ0Q8wVnsSyLEELmaW2h9QuyfGYsESW_7rDxbdqNw/exec";
  // Invalidate keys saved during the initial security rollout. Some browsers
  // saved the instruction line instead of the actual collector key.
  var COLLECTOR_KEY_STORAGE = "js_gongsil_collector_access_key_v3";
  var DETAIL_AUTH_STORAGE = "js_gongsil_detail_auth_v1";

  if (!/gongsilbox\.com$/i.test(location.hostname)) {
    alert("공실박스 지도에서 실행해 주세요.");
    return;
  }

  var migratedCapture = null;
  var migratedTransformItem = null;
  if (window.__JS_GONGSIL_COLLECTOR__) {
    if (window.__JS_GONGSIL_COLLECTOR__.version === VERSION) {
      window.__JS_GONGSIL_COLLECTOR__.reopen();
      return;
    }

    try {
      migratedCapture = window.__JS_GONGSIL_COLLECTOR__.getCapture();
    } catch (_) {}
    if (window.fetch && window.fetch.__jsGongsilOriginal) {
      window.fetch = window.fetch.__jsGongsilOriginal;
    }
    try {
      delete window.__JS_GONGSIL_COLLECTOR__;
    } catch (_) {
      window.__JS_GONGSIL_COLLECTOR__ = null;
    }
  }

  var originalFetch = window.fetch.bind(window);
  var state = {
    active: true,
    busy: false,
    stopRequested: false,
    capture: migratedCapture,
    capturedAt: 0,
    detailAuth: loadDetailAuth(),
    detailCache: {},
    migratedTransformItem: migratedTransformItem,
    pendingSave: null,
    dashboard: createEmptyDashboard()
  };

  var panel = createPanel();
  var statusElement = panel.querySelector("[data-role=status]");
  var detailElement = panel.querySelector("[data-role=detail]");
  var progressBarElement = panel.querySelector("[data-role=progress-bar]");
  var progressPercentElement = panel.querySelector("[data-role=percent]");
  var saveButton = panel.querySelector("[data-action=save]");
  var stopButton = panel.querySelector("[data-action=stop]");
  var closeButton = panel.querySelector("[data-action=close]");

  patchFetch();
  if (state.capture) {
    showCapture(state.capture);
    setStatus(
      "이전 오류 화면을 새 수집기로 복구했습니다.",
      "선택했던 클러스터를 이어받았습니다. 최신 변환 규칙으로 다시 확인합니다.\n" +
      "수량을 확인한 뒤 아래 버튼을 누르면 계속합니다."
    );
  } else {
    setStatus(
      "수집할 숫자 클러스터를 클릭하세요.",
      "공실박스 지도에서 원하는 숫자 원을 한 번 누르면 저장 버튼이 활성화됩니다."
    );
  }

  saveButton.addEventListener("click", collectAndSave);
  stopButton.addEventListener("click", requestSafeStop);
  closeButton.addEventListener("click", closePanel);

  window.__JS_GONGSIL_COLLECTOR__ = {
    version: VERSION,
    maxItems: MAX_ITEMS,
    reopen: function () {
      state.active = true;
      panel.style.display = "block";
      patchFetch();
      if (state.capture) {
        showCapture(state.capture);
      } else {
        setStatus(
          "수집할 숫자 클러스터를 클릭하세요.",
          "원하는 숫자 원을 한 번 누르면 저장 버튼이 활성화됩니다."
        );
      }
    },
    getCapture: function () {
      return state.capture;
    },
    setDetailAuth: function (auth) {
      state.detailAuth = auth || null;
      saveDetailAuth(state.detailAuth);
    },
    transformItem: transformItem,
    decryptText: decryptText,
    loadAllCapturedItems: loadAllCapturedItems,
    addImportResult: addImportResult,
    collectionSignature: collectionSignature,
    observedSourceIds: observedSourceIds,
    getPendingSave: function () {
      return state.pendingSave;
    }
  };

  function getCollectorKey() {
    var saved = "";
    try {
      saved = String(localStorage.getItem(COLLECTOR_KEY_STORAGE) || "").trim();
    } catch (_) {}
    if (saved) return saved;

    var entered = String(window.prompt(
      "공실박스 수집기 보안키를 입력하세요.\n(이 PC에서는 최초 1회만 입력합니다.)",
      ""
    ) || "").trim();
    if (!entered) throw new Error("공실박스 수집기 보안키가 필요합니다.");
    try {
      localStorage.setItem(COLLECTOR_KEY_STORAGE, entered);
    } catch (_) {}
    return entered;
  }

  function loadDetailAuth() {
    try {
      var value = JSON.parse(sessionStorage.getItem(DETAIL_AUTH_STORAGE) || "null");
      return value && value.mid && value.guest !== true ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveDetailAuth(value) {
    try {
      if (value && value.mid) {
        sessionStorage.setItem(DETAIL_AUTH_STORAGE, JSON.stringify(value));
      } else {
        sessionStorage.removeItem(DETAIL_AUTH_STORAGE);
      }
    } catch (_) {}
  }

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
        "background:#fff;border:1px solid #d7e3f4;border-radius:16px;" +
        "box-shadow:0 24px 80px rgba(15,23,42,.32);overflow:auto;color:#172033}" +
        "#" + PANEL_ID + " *{box-sizing:border-box}" +
        "#" + PANEL_ID + " .jsg-head{display:flex;align-items:center;justify-content:space-between;" +
        "padding:10px 12px;background:linear-gradient(135deg,#1677ff,#075fe4);color:#fff}" +
        "#" + PANEL_ID + " .jsg-brand{display:flex;align-items:center;gap:8px}" +
        "#" + PANEL_ID + " .jsg-logo{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;" +
        "background:#fff;color:#1268e8;font-size:16px;font-weight:950}" +
        "#" + PANEL_ID + " .jsg-title{font-size:15px;font-weight:900;letter-spacing:-.3px}" +
        "#" + PANEL_ID + " .jsg-sub{font-size:10px;opacity:.88;margin-top:1px}" +
        "#" + PANEL_ID + " .jsg-version{font-size:10px;opacity:.8;margin-left:6px}" +
        "#" + PANEL_ID + " .jsg-close{width:28px;height:28px;border:0;border-radius:8px;" +
        "background:rgba(255,255,255,.16);color:#fff;font-size:19px;line-height:26px;cursor:pointer}" +
        "#" + PANEL_ID + " .jsg-body{padding:9px;background:#f4f7fc}" +
        "#" + PANEL_ID + " .jsg-card{padding:9px;background:#fff;border:1px solid #dee7f4;border-radius:10px;" +
        "box-shadow:0 3px 10px rgba(25,55,90,.05);margin-bottom:7px}" +
        "#" + PANEL_ID + " .jsg-status-line{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
        "#" + PANEL_ID + " .jsg-status{font-size:14px;font-weight:900;line-height:1.35;color:#172033}" +
        "#" + PANEL_ID + " .jsg-percent{font-size:16px;font-weight:950;color:#1268e8;white-space:nowrap}" +
        "#" + PANEL_ID + " .jsg-detail{margin-top:5px;color:#667085;font-size:10.5px;line-height:1.4;" +
        "white-space:pre-line;max-height:60px;overflow:auto}" +
        "#" + PANEL_ID + " .jsg-progress{height:8px;margin-top:8px;border-radius:99px;" +
        "background:#e4ebf6;overflow:hidden}" +
        "#" + PANEL_ID + " .jsg-progress>i{display:block;width:0;height:100%;" +
        "background:linear-gradient(90deg,#4d98ff,#1268e8);transition:width .2s}" +
        "#" + PANEL_ID + " .jsg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}" +
        "#" + PANEL_ID + " .jsg-metric{padding:7px;background:#f3f7fd;border-radius:8px;min-width:0}" +
        "#" + PANEL_ID + " .jsg-metric span{display:block;font-size:9.5px;color:#728198;margin-bottom:3px}" +
        "#" + PANEL_ID + " .jsg-metric b{font-size:15px;font-weight:900;color:#172033}" +
        "#" + PANEL_ID + " .jsg-rule{padding:7px 8px;background:#eef4fd;" +
        "border-radius:8px;color:#3e536f;font-size:9.5px;line-height:1.4}" +
        "#" + PANEL_ID + " .jsg-actions{display:grid;grid-template-columns:2fr 1fr;gap:6px;margin-top:8px}" +
        "#" + PANEL_ID + " .jsg-save{width:100%;height:38px;border:0;border-radius:9px;" +
        "font-size:12px;font-weight:800;color:#fff;background:#1677ff;cursor:pointer}" +
        "#" + PANEL_ID + " .jsg-stop{height:38px;border:1px solid #ef4444;border-radius:9px;" +
        "font-size:12px;font-weight:850;color:#be123c;background:#fff1f2;cursor:pointer}" +
        "#" + PANEL_ID + " .jsg-save:disabled{cursor:not-allowed;background:#c7d2e3;color:#f7f9fc}" +
        "#" + PANEL_ID + " .jsg-stop:disabled{cursor:not-allowed;border-color:#d8dee8;color:#9aa4b2;background:#f2f4f7}" +
        "@media(max-width:520px){#" + PANEL_ID + "{width:calc(100vw - 12px);max-height:calc(100vh - 12px)}" +
        "#" + PANEL_ID + " .jsg-body{padding:7px}}" ;
      document.head.appendChild(style);
    }

    var element = document.createElement("section");
    element.id = PANEL_ID;
    element.innerHTML =
      '<div class="jsg-head">' +
        '<div class="jsg-brand"><div class="jsg-logo">공</div><div>' +
          '<div class="jsg-title">공실박스 매물 수집<span class="jsg-version">v' + VERSION + '</span></div>' +
          '<div class="jsg-sub">선택 클러스터 전체 목록 · 상세정보 · 저장 현황</div>' +
        '</div></div>' +
        '<button type="button" class="jsg-close" data-action="close" aria-label="닫기">×</button>' +
      '</div>' +
      '<div class="jsg-body">' +
        '<div class="jsg-card">' +
          '<div class="jsg-status-line"><div class="jsg-status" data-role="status"></div>' +
          '<div class="jsg-percent" data-role="percent">0%</div></div>' +
          '<div class="jsg-progress"><i data-role="progress-bar"></i></div>' +
          '<div class="jsg-detail" data-role="detail"></div>' +
        '</div>' +
        '<div class="jsg-card jsg-grid">' +
          '<div class="jsg-metric"><span>선택·찾은 매물</span><b data-metric="found">0</b></div>' +
          '<div class="jsg-metric"><span>처리 완료</span><b data-metric="processed">0</b></div>' +
          '<div class="jsg-metric"><span>남은 매물</span><b data-metric="remaining">0</b></div>' +
          '<div class="jsg-metric"><span>신규 등록</span><b data-metric="created">0</b></div>' +
          '<div class="jsg-metric"><span>자동 통합</span><b data-metric="merged">0</b></div>' +
          '<div class="jsg-metric"><span>조건 변경</span><b data-metric="updated">0</b></div>' +
          '<div class="jsg-metric"><span>검증대기</span><b data-metric="review">0</b></div>' +
          '<div class="jsg-metric"><span>상세 중복</span><b data-metric="detailedDuplicates">0</b></div>' +
          '<div class="jsg-metric"><span>기존 동일 생략</span><b data-metric="skippedUnchanged">0</b></div>' +
          '<div class="jsg-metric"><span>변환 제외</span><b data-metric="addressMissing">0</b></div>' +
          '<div class="jsg-metric"><span>조회·저장 실패</span><b data-metric="failed">0</b></div>' +
        '</div>' +
        '<div class="jsg-card">' +
          '<div class="jsg-rule">저장 위치: <b>JS부동산 매물현황</b><br>' +
          '중복검사: 매물ID 우선 · 지번주소 + 층·호실 + 보증금·월세 + 평수 1평 미만<br>' +
          '전화번호 역할과 메모는 기존 공실박스 규칙대로 유지합니다.</div>' +
          '<div class="jsg-actions">' +
            '<button type="button" class="jsg-save" data-action="save" disabled>선택 클러스터 전체 저장</button>' +
            '<button type="button" class="jsg-stop" data-action="stop" disabled>안전중단</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(element);
    return element;
  }

  function requestSafeStop() {
    if (!state.busy) return;
    state.stopRequested = true;
    stopButton.disabled = true;
    stopButton.textContent = "중단 요청됨";
    setStatus(
      "안전중단 요청을 받았습니다.",
      "현재 조회 또는 저장 중인 한 건/한 묶음까지만 마친 뒤 멈춥니다. 이미 저장한 매물은 유지됩니다."
    );
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

  function patchFetch() {
    if (window.fetch && window.fetch.__jsGongsilPatched) return;

    var wrappedFetch = async function (input, init) {
      var response = await originalFetch(input, init);
      if (state.active && isListRequest(input)) {
        captureListRequest(input, init, response.clone()).catch(function (error) {
          console.warn("[JS 공실박스] 목록 포착 실패", error);
        });
      }
      if (state.active && isDetailRequest(input)) {
        captureDetailRequest(input, init, response.clone()).catch(function (error) {
          console.warn("[JS 공실박스] 상세정보 포착 실패", error);
        });
      }
      return response;
    };
    wrappedFetch.__jsGongsilPatched = true;
    wrappedFetch.__jsGongsilOriginal = originalFetch;
    window.fetch = wrappedFetch;
  }

  function isListRequest(input) {
    var url = typeof input === "string"
      ? input
      : input && input.url
        ? input.url
        : "";
    return /\/api\/maps\/lists(?:\?|$)/i.test(url);
  }

  function isDetailRequest(input) {
    var url = typeof input === "string"
      ? input
      : input && input.url
        ? input.url
        : "";
    return /\/maps\/mmview(?:\?|$)/i.test(url);
  }

  async function captureDetailRequest(input, init, response) {
    var source = "";
    if (init && typeof init.body === "string") {
      source = init.body;
    } else if (input && typeof input.clone === "function") {
      try {
        source = await input.clone().text();
      } catch (_) {}
    }
    if (!source) return;

    var body;
    var result;
    try {
      body = JSON.parse(source);
      result = await response.json();
    } catch (_) {
      return;
    }

    if (body && body.mid) {
      state.detailAuth = body.guest === true ? null : {
        mid: body.mid,
        guest: false,
        endpoint: requestUrl(input) || "/maps/mmview",
        template: Object.assign({}, body, {guest: false})
      };
      saveDetailAuth(state.detailAuth);
    }

    if (result && result.res === "success" && result.data) {
      state.detailCache[detailKey(body)] = result.data;
    }
  }

  async function captureListRequest(input, init, response) {
    var text = "";

    if (init && typeof init.body === "string") {
      text = init.body;
    } else if (input && typeof input.clone === "function") {
      try {
        text = await input.clone().text();
      } catch (_) {}
    }

    if (!text) return;

    var body;
    var data;
    try {
      body = JSON.parse(text);
      data = await response.json();
    } catch (_) {
      return;
    }

    if (
      !body ||
      (!Array.isArray(body.bfidxs) && !Array.isArray(body.bidxs)) ||
      !data ||
      data.res !== "success"
    ) {
      return;
    }

    state.capture = {
      body: body,
      response: data
    };
    state.capturedAt = Date.now();
    showCapture(state.capture);
  }

  function showCapture(capture) {
    var items = getListItems(capture.response);
    var selectedCount = getSelectedItemCount(capture);
    var foundCount = selectedCount || items.length;
    var countText = selectedCount
      ? "선택된 매물번호 " + selectedCount + "개"
      : "목록 " + items.length + "개";
    var limitText = selectedCount > MAX_ITEMS
      ? " · 1회 최대 " + MAX_ITEMS.toLocaleString("ko-KR") + "개"
      : "";
    var remainingCount = Math.max(0, selectedCount - items.length);
    var accumulationText = remainingCount
      ? "\n화면 밖 " + remainingCount.toLocaleString("ko-KR") +
        "개도 300개씩 나눠 누적 수집합니다."
      : "";

    setStatus(
      "선택 클러스터 합계 " + foundCount.toLocaleString("ko-KR") + "개",
      countText + " · 현재 화면 " + items.length + "개" + limitText +
      accumulationText +
      "\n수량을 확인한 뒤 아래 수집 버튼을 눌러주세요."
    );
    updateDashboard({
      found: foundCount,
      processed: 0,
      remaining: foundCount
    });
    setProgress(0, foundCount);
    saveButton.disabled = false;
    saveButton.textContent = selectedCount
      ? "전체 " + selectedCount.toLocaleString("ko-KR") + "개 분할 수집·저장"
      : "선택 클러스터 전체 저장";
  }

  async function collectAndSave() {
    if (state.busy) return;
    if (
      state.pendingSave &&
      Array.isArray(state.pendingSave.records) &&
      state.pendingSave.records.length
    ) {
      await resumePendingSave();
      return;
    }
    if (!state.capture) {
      alert("먼저 공실박스 지도에서 수집할 숫자 클러스터를 클릭해 주세요.");
      return;
    }

    state.busy = true;
    beginCollectorRun();
    saveButton.disabled = true;
    state.dashboard = createEmptyDashboard();
    updateDashboard(state.dashboard);

    try {
      var selectedCount = getSelectedItemCount(state.capture);
      if (selectedCount > MAX_ITEMS) {
        throw new Error(
          "선택한 클러스터가 " + selectedCount.toLocaleString("ko-KR") +
          "개입니다. 공실박스 수집은 한 번에 최대 " +
          MAX_ITEMS.toLocaleString("ko-KR") +
          "개까지 가능합니다. 지도를 한 단계 확대해 나누어 수집해 주세요."
        );
      }

      setStatus("클러스터 전체 목록을 읽는 중입니다.", "잠시만 기다려 주세요.");
      var items = await loadAllCapturedItems(state.capture);

      if (state.stopRequested) {
        setStatus(
          "공실박스 안전중단 완료",
          "목록 확인 단계에서 중단했습니다. 기존 저장자료에는 영향이 없습니다."
        );
        return;
      }
      if (!items.length) {
        throw new Error("선택한 클러스터에서 매물을 찾지 못했습니다.");
      }
      updateDashboard({
        found: items.length,
        processed: 0,
        remaining: items.length
      });
      setProgress(0, items.length);

      var collectorKey = getCollectorKey();
      var saveMetadata = {
        sessionId: createCollectionSessionId(),
        scope: selectedCount >= 2000
          ? "공실박스 2000개 이상 전체클러스터"
          : "공실박스 선택클러스터",
        complete: isCompleteGongsilCapture(selectedCount, items.length),
        found: items.length,
        rejectedCount: 0,
        observedSourceIds: observedSourceIds(items),
        manifestRegistered: true
      };
      var classification = await classifyGongsilManifest(
        items,
        saveMetadata,
        collectorKey
      );
      /*
       * 완전수집은 매물 조건이 같아도 공실박스의 최신 역할 연락처로
       * 재정리해야 합니다. 따라서 전체 매물의 상세 연락처를 다시 읽습니다.
       * 선택수집은 기존처럼 신규·변경 매물만 상세조회합니다.
       */
      var detailItems = saveMetadata.complete
        ? items.slice()
        : items.filter(function(item) {
            return classification.needs[recordSourceId(item)];
          });
      var detailBaseProcessed = saveMetadata.complete
        ? 0
        : classification.unchanged;
      updateDashboard({
        found: items.length,
        processed: detailBaseProcessed,
        remaining: detailItems.length,
        duplicate: detailBaseProcessed,
        detailedDuplicates: 0,
        skippedUnchanged: detailBaseProcessed
      });
      setProgress(detailBaseProcessed, items.length);

      if (detailItems.length && !state.migratedTransformItem) {
        await ensureDetailAuth();
      }

      setStatus(
        detailItems.length ? "매물별 상세정보·역할 연락처 확인 중" : "기존 매물 빠른 확인 완료",
        saveMetadata.complete
          ? "완전수집 " + items.length + "개 · 기존 여부와 관계없이 전체 연락처를 다시 확인합니다."
          : "전체 " + items.length + "개 · 기존 동일 " + classification.unchanged +
            "개 · 신규·변경·연락처 누락 상세조회 " + detailItems.length + "개"
      );

      var transformed = [];
      var rejected = [];
      var completed = 0;
      var detailWaitStartedAt = Date.now();
      var detailWaitTimer = window.setInterval(function () {
        showGongsilDetailWait(completed, detailItems.length, detailWaitStartedAt);
      }, 1000);
      var transformWorker = state.migratedTransformItem || transformItem;
      // 공실박스 상세조회는 화면에서 한 건씩 여는 흐름을 기준으로 동작합니다.
      // 동시에 여러 건을 요청하면 정상 세션에서도 일부 상세 응답이 누락될 수 있습니다.
      var queueResult;
      try {
        queueResult = await mapWithConcurrency(detailItems, 1, async function (item) {
          if (state.stopRequested) return {stopped: true};
          var result;
          try {
            result = await transformWorker(item, state.capture.body);
          } catch (error) {
            result = {
              ok: false,
              reason: error && error.message ? error.message : String(error)
            };
          }

          completed += 1;
          updateDashboard({
            found: items.length,
            processed: detailBaseProcessed + completed,
            remaining: Math.max(0, detailItems.length - completed)
          });
          setProgress(detailBaseProcessed + completed, items.length);
          if (completed === detailItems.length || completed % 5 === 0) {
            setStatus(
              "매물별 상세정보·역할 연락처 확인 중",
              completed + " / " + detailItems.length + "개 상세확인" +
              (saveMetadata.complete
                ? " · 완전수집 전체 연락처 갱신"
                : " · 기존 동일 " + classification.unchanged + "개는 생략")
            );
          }
          return result;
        });
      } finally {
        window.clearInterval(detailWaitTimer);
      }

      queueResult.forEach(function (result) {
        if (result && result.ok) transformed.push(result.record);
        else if (result && result.stopped) return;
        else rejected.push(result && result.reason ? result.reason : "변환 실패");
      });
      if (!state.stopRequested && completed >= detailItems.length) {
        state.migratedTransformItem = null;
      }
      updateDashboard({addressMissing: rejected.length});

      if (state.stopRequested) {
        setStatus(
          "공실박스 안전중단 완료",
          completed + "/" + detailItems.length +
          "개 상세확인 뒤 멈췄습니다. 상세조회 캐시는 유지되어 같은 화면에서 다시 실행하면 더 빠르게 이어집니다."
        );
        return;
      }
      if (!transformed.length && detailItems.length) {
        throw new Error(
          "저장 가능한 매물이 없습니다.\n" + rejectedSummary(rejected)
        );
      }

      setStatus(
        "JS부동산 매물현황으로 전송 중입니다.",
        transformed.length + "개 저장 · 변환 제외 " + rejected.length + "개"
      );

      saveMetadata.rejectedCount = rejected.length;
      saveMetadata.unchanged = saveMetadata.complete ? 0 : classification.unchanged;
      state.pendingSave = {
        records: transformed,
        metadata: saveMetadata,
        itemsLength: items.length,
        rejectedReasons: rejected.slice(),
        selectedCount: selectedCount
      };

      updateDashboard({
        found: items.length,
        processed: detailBaseProcessed + rejected.length,
        remaining: transformed.length
      });
      setProgress(
        detailBaseProcessed + rejected.length,
        items.length
      );
      var result = await sendToAppsScript(transformed, saveMetadata, collectorKey);
      if (!result || result.ok !== true) {
        if (
          result &&
          String(result.message || "").indexOf("승인되지 않은 요청") !== -1
        ) {
          try {
            localStorage.removeItem(COLLECTOR_KEY_STORAGE);
          } catch (_) {}
        }
        throw new Error(
          result && result.message
            ? result.message
            : "Apps Script에서 저장 성공 응답을 받지 못했습니다."
        );
      }
      var message = result && result.message
        ? result.message
        : "공실박스 매물 전송을 완료했습니다.";
      message += saveMetadata.complete
        ? "\n완전수집 " + items.length + "개의 역할 연락처를 모두 다시 확인했습니다."
        : "\n전체 " + items.length + "개 중 기존 동일 " +
          classification.unchanged + "개는 상세조회를 생략했습니다.";
      updateDashboard({
        found: items.length,
        processed: items.length,
        remaining: 0,
        created: result.created,
        merged: result.merged,
        updated: result.updated,
        review: result.review,
        duplicate: Number(result.duplicate || 0) + detailBaseProcessed,
        detailedDuplicates: result.detailedDuplicates !== undefined
          ? result.detailedDuplicates
          : result.duplicate,
        skippedUnchanged: detailBaseProcessed,
        addressMissing: rejected.length,
        failed: result.failed
      });
      setProgress(items.length, items.length);

      setStatus(
        result.stopped ? "공실박스 안전중단 완료" : "저장 완료",
        message + (result.stopped
          ? "\n이미 저장된 묶음은 유지되며 완전수집 판정은 실행하지 않았습니다."
          : "") + (rejected.length
            ? "\n변환 제외 " + rejected.length + "개\n" + rejectedSummary(rejected)
            : "")
      );
      if (result.stopped) {
        saveButton.textContent = "저장 중단 지점부터 이어가기";
      } else {
        state.pendingSave = null;
        saveButton.textContent = "저장 완료 · 다시 수집 가능";
      }
    } catch (error) {
      console.error("[JS 공실박스] 수집 오류", error);
      if (state.stopRequested) {
        setStatus(
          "공실박스 안전중단 완료",
          "현재 처리 단위까지 마치고 중단했습니다. 기존 저장자료에는 영향이 없습니다."
        );
        saveButton.textContent = "다시 이어서 수집";
      } else {
        updateDashboard({failed: Number(state.dashboard.failed || 0) + 1});
        setStatus(
          "수집 중 오류가 발생했습니다.",
          error && error.message ? error.message : String(error)
        );
        saveButton.textContent = "다시 시도";
      }
    } finally {
      state.busy = false;
      saveButton.disabled = false;
      finishCollectorRun();
    }
  }

  async function resumePendingSave() {
    var pending = state.pendingSave;
    if (
      state.busy ||
      !pending ||
      !Array.isArray(pending.records) ||
      !pending.records.length
    ) {
      return;
    }

    state.busy = true;
    beginCollectorRun();
    saveButton.disabled = true;

    var savedProgress = getSavedProgressForRecords(pending.records);
    var savedOffset = savedProgress
      ? Math.max(
        0,
        Math.min(Number(savedProgress.offset) || 0, pending.records.length)
      )
      : 0;
    var rejected = Array.isArray(pending.rejectedReasons)
      ? pending.rejectedReasons
      : [];
    var itemsLength = Number(pending.itemsLength) ||
      pending.records.length + rejected.length;

    state.dashboard = createEmptyDashboard();
    updateDashboard({
      found: itemsLength,
      processed: savedOffset,
      remaining: Math.max(0, pending.records.length - savedOffset),
      created: savedProgress && savedProgress.totals
        ? savedProgress.totals.created
        : 0,
      merged: savedProgress && savedProgress.totals
        ? savedProgress.totals.merged
        : 0,
      updated: savedProgress && savedProgress.totals
        ? savedProgress.totals.updated
        : 0,
      review: savedProgress && savedProgress.totals
        ? savedProgress.totals.review
        : 0,
      duplicate: savedProgress && savedProgress.totals
        ? Number(savedProgress.totals.duplicate || 0) +
          Number(pending.metadata && pending.metadata.unchanged || 0)
        : Number(pending.metadata && pending.metadata.unchanged || 0),
      detailedDuplicates: savedProgress && savedProgress.totals
        ? savedProgress.totals.duplicate
        : 0,
      skippedUnchanged: Number(
        pending.metadata && pending.metadata.unchanged || 0
      ),
      addressMissing: rejected.length,
      failed: savedProgress && savedProgress.totals
        ? savedProgress.totals.failed
        : 0
    });
    setProgress(savedOffset, pending.records.length);
    setStatus(
      "저장 중단 지점부터 이어갑니다.",
      savedOffset.toLocaleString("ko-KR") + "개 저장 완료 · 남은 " +
      Math.max(0, pending.records.length - savedOffset).toLocaleString("ko-KR") +
      "개만 계속 저장합니다.\n목록과 상세정보는 다시 조회하지 않습니다."
    );

    try {
      var result = await sendToAppsScript(
        pending.records,
        pending.metadata || {}
      );
      if (!result || result.ok !== true) {
        throw new Error(
          result && result.message
            ? result.message
            : "Apps Script에서 저장 성공 응답을 받지 못했습니다."
        );
      }

      var message = result.message || "공실박스 매물 전송을 완료했습니다.";
      updateDashboard({
        found: itemsLength,
        processed: itemsLength,
        remaining: 0,
        created: result.created,
        merged: result.merged,
        updated: result.updated,
        review: result.review,
        duplicate: Number(result.duplicate || 0) +
          Number(pending.metadata && pending.metadata.unchanged || 0),
        detailedDuplicates: result.detailedDuplicates !== undefined
          ? result.detailedDuplicates
          : result.duplicate,
        skippedUnchanged: result.skippedUnchanged !== undefined
          ? result.skippedUnchanged
          : Number(pending.metadata && pending.metadata.unchanged || 0),
        addressMissing: rejected.length,
        failed: result.failed
      });
      setProgress(itemsLength, itemsLength);
      setStatus(
        result.stopped ? "공실박스 안전중단 완료" : "저장 완료",
        message + (result.stopped
          ? "\n이미 저장된 묶음은 유지되며 완전수집 판정은 실행하지 않았습니다."
          : "") + (rejected.length
            ? "\n변환 제외 " + rejected.length + "개\n" +
              rejectedSummary(rejected)
            : "")
      );

      if (result.stopped) {
        saveButton.textContent = "저장 중단 지점부터 이어가기";
      } else {
        state.pendingSave = null;
        saveButton.textContent = "저장 완료 · 다시 수집 가능";
      }
    } catch (error) {
      console.error("[JS 공실박스] 저장 이어가기 오류", error);
      updateDashboard({failed: Number(state.dashboard.failed || 0) + 1});
      setStatus(
        "저장 연결이 아직 복구되지 않았습니다.",
        (error && error.message ? error.message : String(error)) +
        "\n다시 누르면 현재 저장 지점부터 계속합니다."
      );
      saveButton.textContent = "저장 중단 지점부터 다시 시도";
    } finally {
      state.busy = false;
      saveButton.disabled = false;
      finishCollectorRun();
    }
  }

  async function loadAllCapturedItems(capture) {
    var byId = {};
    addItems(byId, getListItems(capture.response));
    var selectedCount = getSelectedItemCount(capture);

    if (selectedCount > MAX_ITEMS) {
      throw new Error(
        "선택한 매물이 1회 최대 수집 한도 " +
        MAX_ITEMS.toLocaleString("ko-KR") + "개를 초과했습니다."
      );
    }

    if (Object.keys(byId).length > MAX_ITEMS) {
      throw new Error(
        "공실박스 목록 응답이 1회 최대 수집 한도 " +
        MAX_ITEMS.toLocaleString("ko-KR") + "개를 초과했습니다."
      );
    }

    /*
     * 큰 클러스터는 mxline을 키워도 공실박스가 약 400개까지만
     * 반환합니다. 선택된 bfidx/bidx 자체를 300개씩 분할해서
     * 각각 조회한 다음 매물번호 기준으로 합칩니다.
     */
    if (selectedCount && Object.keys(byId).length < selectedCount) {
      await loadSelectedItemsInChunks(capture, byId, selectedCount);
      if (state.stopRequested) {
        return Object.keys(byId).map(function(key) { return byId[key]; });
      }
      return validateCapturedItems(byId, selectedCount);
    }

    if (!capture.response.more) {
      return validateCapturedItems(byId, selectedCount);
    }

    var targetLimit = selectedCount > 0
      ? Math.min(selectedCount, MAX_ITEMS)
      : MAX_ITEMS;
    var sizes = unique([500, 1000, 2000, targetLimit, MAX_ITEMS])
      .map(Number)
      .filter(function (size) {
        return size > Object.keys(byId).length && size <= targetLimit;
      })
      .sort(function (a, b) { return a - b; });

    var hasMore = Boolean(capture.response.more);
    for (var index = 0; index < sizes.length; index += 1) {
      if (state.stopRequested) break;
      var body = Object.assign({}, capture.body, {
        mxline: sizes[index],
        key: Number(capture.body.key || 0) + index + 101
      });
      var response = await originalFetch("/api/maps/lists", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      var data = await response.json();
      if (state.stopRequested) break;

      if (!data || data.res !== "success") {
        throw new Error(data && data.message ? data.message : "공실박스 목록 조회에 실패했습니다.");
      }

      hasMore = Boolean(data.more);
      addItems(byId, getListItems(data));
      if (Object.keys(byId).length > MAX_ITEMS) {
        throw new Error(
          "공실박스 목록이 1회 최대 수집 한도 " +
          MAX_ITEMS.toLocaleString("ko-KR") + "개를 초과했습니다."
        );
      }
      setStatus(
        "클러스터 전체 목록을 읽는 중입니다.",
        Object.keys(byId).length.toLocaleString("ko-KR") +
        " / " + (selectedCount || targetLimit).toLocaleString("ko-KR") + "개 확인"
      );

      if (!data.more || (selectedCount && Object.keys(byId).length >= selectedCount)) break;
    }

    if (!selectedCount && hasMore) {
      throw new Error(
        "선택한 클러스터가 1회 최대 수집 한도 " +
        MAX_ITEMS.toLocaleString("ko-KR") +
        "개를 초과했습니다. 지도를 확대해 나누어 수집해 주세요."
      );
    }
    if (state.stopRequested) {
      return Object.keys(byId).map(function(key) { return byId[key]; });
    }
    return validateCapturedItems(byId, selectedCount);
  }

  async function loadSelectedItemsInChunks(capture, byId, selectedCount) {
    var sourceBody = (capture && capture.body) || {};
    var bfidxs = Array.isArray(sourceBody.bfidxs) ? sourceBody.bfidxs : [];
    var bidxs = Array.isArray(sourceBody.bidxs) ? sourceBody.bidxs : [];
    var primaryName = bfidxs.length ? "bfidxs" : "bidxs";
    var primaryValues = primaryName === "bfidxs" ? bfidxs : bidxs;
    var secondaryName = primaryName === "bfidxs" ? "bidxs" : "bfidxs";
    var secondaryValues = secondaryName === "bfidxs" ? bfidxs : bidxs;
    var entries = [];
    var secondaryRequestValues = [];
    var seen = Object.create(null);
    var secondarySeen = Object.create(null);

    primaryValues.forEach(function (value, index) {
      var id = String(value == null ? "" : value).trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      entries.push({
        value: value
      });
    });

    /*
     * Gongsilbox does not treat bfidxs and bidxs as parallel arrays. A floor
     * cluster can contain a different number of building IDs, and the list
     * endpoint needs the complete building-ID context even while bfidxs are
     * requested in chunks. Clearing or slicing bidxs made large clusters stop
     * at the 20 rows already rendered on screen.
     */
    secondaryValues.forEach(function (value) {
      var id = String(value == null ? "" : value).trim();
      if (!id || secondarySeen[id]) return;
      secondarySeen[id] = true;
      secondaryRequestValues.push(value);
    });

    if (!entries.length) return;

    for (var offset = 0; offset < entries.length; offset += LIST_REQUEST_CHUNK_SIZE) {
      if (state.stopRequested) break;
      var chunk = entries.slice(offset, offset + LIST_REQUEST_CHUNK_SIZE);
      var requestBody = Object.assign({}, sourceBody, {
        // The endpoint caps one response at 400. Leave headroom because the
        // complete secondary context can add a few related rows.
        mxline: 400,
        key: Number(sourceBody.key || 0) + Math.floor(offset / LIST_REQUEST_CHUNK_SIZE) + 1001
      });

      requestBody[primaryName] = chunk.map(function (entry) {
        return entry.value;
      });

      requestBody[secondaryName] = secondaryRequestValues.slice();

      var response = await originalFetch("/api/maps/lists", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      var data = await response.json();
      if (state.stopRequested) break;

      if (!data || data.res !== "success") {
        throw new Error(
          data && data.message
            ? data.message
            : "공실박스 분할 목록 조회에 실패했습니다."
        );
      }

      var chunkIds = Object.create(null);
      chunk.forEach(function (entry) {
        chunkIds[String(entry.value)] = true;
      });
      var filteredItems = getListItems(data).filter(function (item) {
        return itemMatchesPrimaryId(item, primaryName, chunkIds);
      });
      addItems(byId, filteredItems);

      if (Object.keys(byId).length > MAX_ITEMS) {
        throw new Error(
          "공실박스 목록이 1회 최대 수집 한도 " +
          MAX_ITEMS.toLocaleString("ko-KR") + "개를 초과했습니다."
        );
      }

      setStatus(
        "클러스터 전체 목록을 나눠 읽는 중입니다.",
        Math.min(offset + chunk.length, entries.length).toLocaleString("ko-KR") +
        " / " + selectedCount.toLocaleString("ko-KR") + "개 요청 · " +
        Object.keys(byId).length.toLocaleString("ko-KR") + "개 확인"
      );
    }
  }

  function itemMatchesPrimaryId(item, primaryName, idSet) {
    var aliases = primaryName === "bfidxs"
      ? ["Bfidx", "bfidx", "BfIdx"]
      : ["Bidx", "bidx", "BIdx"];
    var id = text(pick(item, aliases));
    return Boolean(id && idSet[id]);
  }

  function getSelectedItemCount(capture) {
    var body = ((capture || {}).body || {});
    var selectedIds = Array.isArray(body.bfidxs) && body.bfidxs.length
      ? body.bfidxs
      : (Array.isArray(body.bidxs) ? body.bidxs : []);

    return unique(selectedIds.map(String)).length;
  }

  function isCompleteGongsilCapture(selectedCount, capturedCount) {
    selectedCount = Number(selectedCount) || 0;
    capturedCount = Number(capturedCount) || 0;
    /*
     * 공실박스 목록 응답에는 선택한 ID 외의 같은 클러스터 매물이 함께
     * 포함될 수 있습니다. 누락은 중단하되, 최종 확인 건수가 선택 건수보다
     * 많은 정상 전체수집은 완전수집으로 인정해야 기존 매물 연락처도
     * 빠짐없이 다시 상세조회합니다.
     */
    return selectedCount >= 2000 && capturedCount >= selectedCount;
  }

  function validateCapturedItems(byId, selectedCount) {
    var keys = Object.keys(byId);
    if (keys.length > MAX_ITEMS) {
      throw new Error(
        "공실박스 목록이 1회 최대 수집 한도 " +
        MAX_ITEMS.toLocaleString("ko-KR") + "개를 초과했습니다."
      );
    }
    if (selectedCount && keys.length < selectedCount) {
      throw new Error(
        "선택 매물 " + selectedCount.toLocaleString("ko-KR") +
        "개 중 " + keys.length.toLocaleString("ko-KR") +
        "개만 확인되어 저장을 중단했습니다. 클러스터를 다시 누른 뒤 재시도해 주세요."
      );
    }
    return keys.map(function (key) { return byId[key]; });
  }

  async function ensureDetailAuth() {
    if (state.detailAuth && state.detailAuth.mid && state.detailAuth.guest !== true) {
      return state.detailAuth;
    }
    state.detailAuth = null;
    saveDetailAuth(null);

    setStatus(
      "상세 연락처 연결이 한 번 필요합니다.",
      "매물 목록에서 아무 매물의 호실 또는 매물번호를 한 번 눌러 상세창을 열어 주세요.\n연결되는 즉시 전체 수집을 자동으로 계속합니다."
    );
    saveButton.textContent = "상세창 연결 대기 중";

    for (var attempt = 0; attempt < 60; attempt += 1) {
      if (state.stopRequested) {
        throw new Error("사용자 안전중단");
      }
      if (state.detailAuth && state.detailAuth.mid && state.detailAuth.guest !== true) {
        return state.detailAuth;
      }
      await delay(250);
    }
    throw new Error(
      "상세 연락처 연결 시간이 초과되었습니다. 매물 상세창을 한 번 연 뒤 다시 저장해 주세요."
    );
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function addItems(target, items) {
    items.forEach(function (item, index) {
      var id = text(pick(item, ["Bfidx", "bfidx", "BfIdx", "id"]));
      if (!id) id = "row-" + index + "-" + JSON.stringify(item).slice(0, 100);
      target[id] = item;
    });
  }

  function getListItems(data) {
    if (!data) return [];
    if (Array.isArray(data.datas)) return data.datas;
    if (data.datas && Array.isArray(data.datas.res)) return data.datas.res;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  async function transformItem(item, requestBody) {
    var requestId = text(requestBody.reqsID);
    var addressData = await decryptAddressData(item, requestId);
    var address = buildLotAddress(item, addressData);

    if (!address || !/\d/.test(address)) {
      return { ok: false, reason: "지번주소 없음" };
    }

    var rental = getRentalTerms(item);
    if (!rental) {
      return { ok: false, reason: "임대조건 없음" };
    }

    var detail = await fetchDetailData(item);
    /*
     * 공실박스 원본매물의 연락처는 해당 출처매물ID에 반드시 함께 저장합니다.
     * 상세조회·역할 확인이 실패하면 빈 연락처로 덮지 않고 이 원본만 실패 처리해
     * 기존 번호를 보존합니다.
     */
    var phones = await collectPhones(item, requestBody, addressData, detail);
    var imageUrls = collectMediaUrls(item, detail);
    var memo = buildMemo(item);
    var pyeong = getPyeong(item);
    var values = [
      getBuildingName(item),
      address,
      getRoom(item),
      getPropertyType(item),
      rental.deposit,
      rental.rent,
      getManagementFee(item),
      getPremium(item),
      pyeong,
      phones.landlordPrimary,
      phones.tenantPrimary,
      memo,
      "",
      "",
      "공실박스"
    ];

    return {
      ok: true,
      record: {
        externalId: text(pick(item, ["Bfidx", "bfidx", "BfIdx"])),
        listSnapshot: gongsilListSnapshot(item),
        contactList: phones.contacts,
        primaryImage: imageUrls[0] || "",
        imageUrls: imageUrls,
        raw: { list: item, detail: detail },
        values: values
      }
    };
  }

  function collectMediaUrls() {
    var urls = [];
    var seen = Object.create(null);
    var imageKey = /(?:image|images|photo|photos|thumbnail|thumb|picture|pictures|media)/i;
    function add(value) {
      var url = text(value);
      if (!/^https?:\/\//i.test(url) || seen[url]) return;
      if (!/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(url) &&
          !/(?:image|photo|thumb|cdn|gongsil)/i.test(url)) return;
      seen[url] = true;
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
    Array.prototype.slice.call(arguments).forEach(function(value) { walk(value, "", 0); });
    return urls.slice(0, 30);
  }

  async function decryptAddressData(item, requestId) {
    return {
      addr: await decryptText(pick(item, ["Addr", "addr"]), requestId),
      road: await decryptText(pick(item, ["AddrRoad", "addrRoad"]), requestId),
      bun1: await decryptText(pick(item, ["AddrBun1", "addrBun1"]), requestId),
      bun2: await decryptText(pick(item, ["AddrBun2", "addrBun2"]), requestId)
    };
  }

  async function decryptText(value, requestId) {
    var source = text(value);
    if (!source || !requestId) return source;
    if (/[\u3131-\uD79D]/.test(source) && !/^[0-9a-f]+$/i.test(source)) return source;

    try {
      var payload = decodeCipher(source);
      if (payload.length < 29) return source;

      var keyBytes = new Uint8Array(32);
      var encodedKey = new TextEncoder().encode(requestId);
      keyBytes.set(encodedKey.slice(0, 32));
      var cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );
      var plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: payload.slice(0, 12)
        },
        cryptoKey,
        payload.slice(12)
      );
      return new TextDecoder().decode(plain);
    } catch (_) {
      return source;
    }
  }

  function decodeCipher(source) {
    if (/^[0-9a-f]+$/i.test(source) && source.length % 2 === 0) {
      var hex = new Uint8Array(source.length / 2);
      for (var index = 0; index < hex.length; index += 1) {
        hex[index] = parseInt(source.slice(index * 2, index * 2 + 2), 16);
      }
      return hex;
    }

    var binary = atob(source.replace(/-/g, "+").replace(/_/g, "/"));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function buildLotAddress(item, decrypted) {
    var full = cleanAddress(decrypted.addr);
    var province = text(pick(item, ["AddrDo", "Do", "addrdo"]));
    var city = text(pick(item, ["AddrSi", "AddrCity", "City", "addrcity"]));
    var dong = text(pick(item, ["AddrDong", "Dong", "addrdong"]));
    var lee = text(pick(item, ["AddrLee", "Lee", "addrlee"]));
    var district = getDistrict(item, city);

    if (full && /\d/.test(full) && !/로|길\s*\d/.test(full)) {
      if (district && !/(?:^|\s)[가-힣]+구(?:\s|$)/.test(full)) {
        full = district + " " + full;
      }
      return cleanAddress(full);
    }

    var mountain = truthy(pick(item, ["AddrSan", "San", "addrsan"])) ? "산 " : "";
    var bun1 = text(decrypted.bun1).replace(/[^0-9]/g, "");
    var bun2 = text(decrypted.bun2).replace(/[^0-9]/g, "");
    var number = bun1 ? mountain + bun1 + (bun2 && bun2 !== "0" ? "-" + bun2 : "") : "";
    var composed = [province, city, dong, lee, number].filter(Boolean).join(" ");
    composed = cleanAddress(composed);

    if (composed && /\d/.test(composed)) return composed;
    if (full && /\d/.test(full)) return full;
    return "";
  }

  function getDistrict(item, city) {
    var candidates = [
      city,
      pick(item, ["AddrCity", "City", "addrcity"]),
      pick(item, ["AddrSi", "Si", "addrsi"]),
      pick(item, ["Sigungu", "Gu", "District"])
    ].map(text);

    for (var index = 0; index < candidates.length; index += 1) {
      var match = candidates[index].match(/(?:^|\s)([가-힣]+구)(?:\s|$)/);
      if (match) return match[1];
    }
    return "";
  }

  function cleanAddress(value) {
    return text(value)
      .replace(/대전광역시|대전시/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getRentalTerms(item) {
    var deposit = numberValue(pick(item, ["Bo", "Deposit", "MmDeposit"]));
    var rent = numberValue(pick(item, ["Mm", "Monthly", "MmMonthly", "Rent"]));

    if (!deposit && !rent) {
      deposit = numberValue(pick(item, ["Jun", "JeonseDeposit"]));
      rent = numberValue(pick(item, ["Jmm", "JeonseMonthly"]));
    }

    var moneys = pick(item, ["Moneys", "moneys"]);
    if ((!deposit && !rent) && Array.isArray(moneys)) {
      var rentalMoney = moneys.find(function (money) {
        var type = text(money && money.Ty);
        return type === "월세" || type === "반전세" || type === "전세";
      });
      if (rentalMoney) {
        deposit = numberValue(rentalMoney.Bo);
        rent = numberValue(rentalMoney.Mm);
      }
    }

    if (!deposit && !rent) return null;
    return {
      deposit: deposit || 0,
      rent: rent || 0
    };
  }

  function getBuildingName(item) {
    return text(pick(item, ["Bilname", "BilName", "Bname", "BuildingName"])) ||
      text(pick(item, ["TypeView", "ViewType"])) ||
      "상가";
  }

  function getRoom(item) {
    var room = text(pick(item, ["Ho", "BfHo", "Room", "Honame"]));
    if (room && room !== "전체" && room !== "0") {
      return /호$/.test(room) ? room : room + "호";
    }

    var floor = Number(pick(item, ["Ff", "BfFloor", "Floor", "floor"]));
    if (!Number.isFinite(floor)) return "";
    if (floor < 0) return "지하" + Math.abs(floor) + "층";
    if (floor === 0) return "";
    return floor + "층";
  }

  function getPropertyType(item) {
    var type = text(pick(item, ["TypeView", "ViewType", "LndType", "Type"]));
    if (/사무/.test(type)) return "사무실";
    if (/공장|창고/.test(type)) return "공장/창고";
    if (/상가|점포|근린/.test(type)) {
      return truthy(pick(item, ["Ckhus", "Collective", "IsCollective"]))
        ? "집합상가"
        : "일반상가";
    }
    return type || "상가";
  }

  function getPyeong(item) {
    var pyeong = numberValue(pick(item, ["Area", "Pyeong", "Py", "AreaPy"]));
    if (pyeong) return trimNumber(pyeong);

    var squareMeters = numberValue(pick(item, ["BfArea", "AreaM2", "Areatxt"]));
    return squareMeters ? trimNumber(squareMeters * 0.3025) : "";
  }

  function getPremium(item) {
    var direct = numberValue(
      pick(item, ["Premium", "Gwon", "Gwonri", "BfPremium", "RightMoney"])
    );
    if (direct) return direct;

    var gongsilPremium = text(pick(item, ["Gul", "gul"]));
    if (/^\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|만원|원)?$/.test(gongsilPremium)) {
      return numberValue(gongsilPremium);
    }

    var note = [
      pick(item, ["Memo", "BfMemo"]),
      pick(item, ["Note", "BfAdnote2"]),
      pick(item, ["Hoetc", "Gul"])
    ].map(text).join(" ");
    var pMatch = note.match(/(?:^|[\s,·|/])p\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)(?=$|[\s,·|/])/i);
    if (pMatch) return numberValue(pMatch[1]);

    var match = note.match(/(?:권리금?|권)\s*[:：]?\s*(?:(\d+(?:\.\d+)?)\s*억)?\s*(\d[\d,]*(?:\.\d+)?)?\s*(?:만\s*원|만원|원)?/);
    if (!match) return "";

    var eok = Number(match[1] || 0) * 10000;
    var man = Number(String(match[2] || "0").replace(/,/g, ""));
    var total = eok + man;
    return total || "";
  }

  function getManagementFee(item) {
    var direct = numberValue(
      pick(item, ["Gal", "BfGalMoney", "ManagementFee", "ManageFee"])
    );
    if (direct) return direct;

    var note = [
      pick(item, ["Memo", "BfMemo"]),
      pick(item, ["Note", "BfAdnote2"]),
      pick(item, ["Hoetc", "Gul"])
    ].map(text).join(" ");
    var match = note.match(/(?:관리비|관)\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)/);
    return match ? numberValue(match[1]) : "";
  }

  function buildMemo(item) {
    var parts = [];
    var moveDate = text(pick(item, ["MoveDate", "BfMoveDate", "MoveInDate"]));
    if (moveDate) parts.push("입주 " + moveDate);

    var currentBusiness = text(
      pick(item, ["CurrentBusiness", "CurrentIndustry", "NowBusiness", "Uptype", "BusinessType"])
    );
    if (currentBusiness) parts.push("현재업종 " + currentBusiness);

    [
      pick(item, ["Memo", "BfMemo"]),
      pick(item, ["Note", "BfAdnote2"]),
      pick(item, ["Hoetc"]),
      gongsilMemoValue(pick(item, ["Gul", "gul"]))
    ].forEach(function (value) {
      addMemoPart(parts, value);
    });

    var detail = unique(
      parts.map(function (part) {
        return text(part).replace(/\s+/g, " ");
      }).filter(Boolean)
    ).join(" · ").slice(0, 880);
    return "(임장가자)" + (detail ? " " + detail : "");
  }

  function addMemoPart(parts, value) {
    if (Array.isArray(value)) {
      value.forEach(function (entry) { addMemoPart(parts, entry); });
      return;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        addMemoPart(parts, value[key]);
      });
      return;
    }
    var part = cleanMemoFinancialTokens(text(value));
    if (!part || part === "0" || part === "false") return;
    if (/^(공실박스|출처\s*공실박스)$/i.test(part)) return;
    parts.push(part);
  }

  function gongsilMemoValue(value) {
    var source = text(value);
    if (/^\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|만원|원)?$/.test(source)) {
      return "";
    }
    return source;
  }

  function cleanMemoFinancialTokens(value) {
    return text(value)
      .replace(
        /(?:권리금?|권)\s*[:：]?\s*(?:(?:\d+(?:\.\d+)?)\s*억(?:\s*\d[\d,]*(?:\.\d+)?)?|\d[\d,]*(?:\.\d+)?)\s*(?:만\s*원|만원|원)?/g,
        " "
      )
      .replace(
        /(?:관리비|관)\s*[:：]?\s*\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|만원|원)?/g,
        " "
      )
      .replace(
        /(?:^|[\s,·|/])p\s*[:：]?\s*\d[\d,]*(?:\.\d+)?(?=$|[\s,·|/])/gi,
        " "
      )
      .replace(/\s*([,·|/])\s*(?=$|[,·|/])/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  var CONTACT_PHONE_KEYS = [
    "Tel", "tel", "TelNo", "telNo", "Phone", "phone",
    "PhoneNumber", "phoneNumber", "Number", "number",
    "Mobile", "mobile", "MobileNo", "mobileNo", "Hp", "hp", "HpNo", "hpNo"
  ];

  var CONTACT_ROLE_KEYS = [
    "Type2", "type2", "Role", "role", "Label", "label",
    "Type1", "type1", "Ty2", "ty2", "Ty1", "ty1",
    "TelType", "telType", "Ty", "Type", "type", "Name", "name"
  ];

  function appendContactValue(target, value, inheritedRole) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(function (entry) {
        appendContactValue(target, entry, inheritedRole);
      });
      return;
    }
    if (typeof value === "object") {
      var role = text(pick(value, CONTACT_ROLE_KEYS)) || inheritedRole;
      var directPhone = pick(value, CONTACT_PHONE_KEYS);
      if (directPhone) {
        if (role && !pick(value, CONTACT_ROLE_KEYS)) {
          target.push(Object.assign({}, value, {Role: role}));
        } else {
          target.push(value);
        }
        return;
      }
      Object.keys(value).forEach(function (key) {
        appendContactValue(target, value[key], role);
      });
      return;
    }
    if (normalizePhone(value)) target.push({Tel: value, Role: inheritedRole || ""});
  }

  function appendNestedContactFields(target, source, inheritedRole, depth) {
    if (!source || depth > 10) return;
    if (Array.isArray(source)) {
      source.forEach(function(entry) {
        appendNestedContactFields(target, entry, inheritedRole, depth + 1);
      });
      return;
    }
    if (typeof source !== "object") return;

    var role = text(pick(source, CONTACT_ROLE_KEYS)) || inheritedRole;
    var directPhone = pick(source, CONTACT_PHONE_KEYS);
    if (directPhone) appendContactValue(target, source, role);

    Object.keys(source).forEach(function(key) {
      var child = source[key];
      if (child && typeof child === "object") {
        appendNestedContactFields(target, child, role, depth + 1);
      } else if (/(?:tel|phone|mobile|hp|contact|number)/i.test(key)) {
        appendContactValue(target, child, role);
      }
    });
  }

  function appendContactFields(target, source, keys) {
    if (!source || typeof source !== "object") return;
    keys.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        appendContactValue(target, source[key]);
      }
    });
  }

  async function collectPhones(item, requestBody, addressData, providedDetail) {
    var contacts = [];
    var listingCandidates = [];
    var buildingCandidates = [];

    var detail = providedDetail || await fetchDetailData(item);
    appendNestedContactFields(listingCandidates, detail && detail.floorinfo, "", 0);
    appendContactFields(listingCandidates, detail && detail.floorinfo, [
      "Tels", "tels", "FTels", "ftels", "Ftel", "ftel",
      "TelList", "telList", "Phones", "phones", "Contacts", "contacts"
    ]);
    appendNestedContactFields(buildingCandidates, detail && detail.bilinfo, "", 0);
    appendContactFields(buildingCandidates, detail && detail.bilinfo, [
      "Tels", "tels", "BTels", "btels", "Btel", "btel",
      "TelList", "telList", "Phones", "phones", "Contacts", "contacts"
    ]);
    appendContactFields(listingCandidates, item, [
      "Ftel", "ftel", "FTels", "ftels", "Tels", "tels",
      "TelList", "telList", "Phones", "phones", "Contacts", "contacts"
    ]);
    appendContactFields(buildingCandidates, item, [
      "Btel", "btel", "BTels", "btels"
    ]);

    /*
     * floorinfo/Ftel은 해당 층·호실 매물 연락처입니다.
     * bilinfo/Btel은 일반·다가구 건물의 건물 연락처로 사용하되,
     * 호실별 소유자가 다른 집합건물에는 섞지 않습니다.
     */
    var candidates = isCollectiveItem(item, detail)
      ? listingCandidates
      : listingCandidates.concat(buildingCandidates);

    if (!candidates.length) {
      var direct = pick(item, ["Tel", "Phone", "OwnerTel"]);
      if (direct) candidates.push({ Tel: direct, Ty: "J" });
    }

    var seenTidx = {};
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index] || {};
      var tidx = text(pick(candidate, ["Tidx", "tidx", "Tid", "id"]));
      if (tidx && seenTidx[tidx]) continue;
      if (tidx) seenTidx[tidx] = true;

      var phone = normalizePhone(pick(candidate, CONTACT_PHONE_KEYS));
      var label = text(pick(candidate, CONTACT_ROLE_KEYS));
      var tenantHint = isTenantLabel(label);
      var resolvedLabel = contactLabel(tenantHint ? "S" : label);

      if (!phone) continue;
      if (!resolvedLabel) {
        throw new Error(
          "공실박스 연락처 역할 확인 실패: " +
          (label || "빈 역할") + " / " + phone
        );
      }
      contacts.push({
        phone: phone,
        label: resolvedLabel,
        tenant: tenantHint || isTenantLabel(label)
      });
    }

    var byPhone = {};
    contacts.forEach(function (contact) {
      var existing = byPhone[contact.phone];
      if (!existing || (!existing.tenant && contact.tenant)) {
        byPhone[contact.phone] = contact;
      } else if (existing && existing.label !== contact.label) {
        throw new Error(
          "공실박스 동일 전화번호 역할 충돌: " +
          contact.phone + " (" + existing.label + " / " + contact.label + ")"
        );
      }
    });

    var uniqueContacts = Object.keys(byPhone).map(function (phone) {
      return byPhone[phone];
    });
    if (!uniqueContacts.length) {
      throw new Error(
        "공실박스 상세 연락처 없음: 매물번호 " +
        text(pick(item, ["Bfidx", "bfidx", "BfIdx", "id"]))
      );
    }
    var tenantContacts = uniqueContacts.filter(function (contact) {
      return contact.tenant;
    });
    var landlordContacts = uniqueContacts.filter(function (contact) {
      return !contact.tenant;
    });
    landlordContacts.sort(function (left, right) {
      return landlordPriority(right.label) - landlordPriority(left.label);
    });

    var primary = landlordContacts.length ? landlordContacts[0] : null;

    /*
     * 시트의 임대인/세입자 열에는 대표번호만 들어가므로 역할 정보가 사라질 수
     * 있습니다. 매물카드가 주·남·여·관·부·세·가를 정확히 구분할 수 있도록
     * 공실박스가 제공한 모든 번호의 역할을 메모에도 함께 보존합니다.
     */
    var extras = landlordContacts.map(function (contact) {
      return contact.label + ": " + contact.phone;
    });
    tenantContacts.forEach(function (contact) {
      extras.push("세입자: " + contact.phone);
    });

    return {
      landlordPrimary: primary ? primary.phone : "",
      tenantPrimary: tenantContacts.length ? tenantContacts[0].phone : "",
      extraMemo: extras,
      contacts: uniqueContacts.map(function(contact) {
        return {
          role: contactRoleCode(contact.label),
          phone: contact.phone
        };
      })
    };
  }

  function isCollectiveItem(item, detail) {
    var building = detail && detail.bilinfo ? detail.bilinfo : {};
    return truthy(pick(item || {}, ["Ckhus", "Collective", "IsCollective"])) ||
      truthy(pick(building, ["Ckhus", "Collective", "IsCollective"])) ||
      /집합/.test([
        text(pick(item || {}, ["TypeView", "ViewType", "LndType", "Type"])),
        text(pick(building, ["TypeView", "ViewType", "LndType", "Type", "Btype"]))
      ].join(" "));
  }

  function detailKey(source) {
    return [
      text(pick(source, ["Bidx", "bidx"])),
      text(pick(source, ["Bfidx", "bfidx"])),
      text(pick(source, ["Admidx", "adidx", "admidx"]))
    ].join(":");
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    return input && input.url ? input.url : "";
  }

  async function fetchDetailData(item) {
    var key = detailKey(item);
    if (state.detailCache[key]) return state.detailCache[key];
    if (!state.detailAuth || !state.detailAuth.mid || state.detailAuth.guest === true) {
      throw new Error("로그인된 공실박스 상세 연락처 연결이 없습니다.");
    }

    var payload = Object.assign({}, state.detailAuth.template || {}, {
      mid: state.detailAuth.mid,
      guest: false,
      bidx: pick(item, ["Bidx", "bidx"]),
      bfidx: pick(item, ["Bfidx", "bfidx"]),
      adidx: pick(item, ["Admidx", "adidx", "admidx"]),
      pidx: ""
    });

    if (
      isMissingIdentifier(payload.bidx) ||
      isMissingIdentifier(payload.bfidx) ||
      isMissingIdentifier(payload.adidx)
    ) {
      throw new Error(
        "상세조회 식별값 누락 (bidx=" + text(payload.bidx) +
        ", bfidx=" + text(payload.bfidx) +
        ", adidx=" + text(payload.adidx) + ")"
      );
    }

    var endpoint = state.detailAuth.endpoint || "/maps/mmview";
    var retryDelays = [0, 600, 1600];
    var lastError;
    for (var attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt]) await delay(retryDelays[attempt]);
      try {
        var response = await originalFetch(endpoint, {
          method: "POST",
          mode: "cors",
          credentials: "include",
          redirect: "follow",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error("상세정보 조회 실패 (HTTP " + response.status + ")");
        }

        var result;
        try {
          result = await response.json();
        } catch (_) {
          throw new Error("상세정보 응답 형식을 확인하지 못했습니다.");
        }
        if (!result || result.res !== "success" || !result.data) {
          throw new Error(
            result && (result.message || result.msg)
              ? result.message || result.msg
              : "상세정보 조회 거절 (res=" + text(result && result.res) + ")"
          );
        }
        state.detailCache[key] = result.data;
        return result.data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("공실박스 상세정보 조회 실패");
  }

  function isTenantLabel(value) {
    var label = text(value).toUpperCase();
    return label === "S" || /세입자|임차(?:인)?/.test(label);
  }

  function contactLabel(value) {
    var raw = text(value);
    var code = raw.toUpperCase();
    var labels = {
      "1": "남성",
      "2": "여성",
      "5": "가족",
      "G": "관리업체",
      "B": "부동산",
      "J": "주인",
      "S": "세입자"
    };
    if (labels[code]) return labels[code];
    if (/세입자|임차(?:인)?/.test(raw)) return "세입자";
    if (/임대인|건물주|소유자|주인/.test(raw)) return "주인";
    if (/관리/.test(raw)) return "관리업체";
    if (/부동산|중개/.test(raw)) return "부동산";
    /*
     * 공실박스 보안 연락처는 화면/응답 버전에 따라
     * "남성·여성"뿐 아니라 한 글자 "남·여"로도 내려옵니다.
     * 한 글자 값을 그대로 메모에 넘기지 않고 역할을 확정해 두어
     * 후속 연락처 JSON 저장에서도 기타로 떨어지지 않게 합니다.
     */
    if (/^(?:남|남성|남자|사장)$/.test(raw)) return "남성";
    if (/^(?:여|여성|여자|사모)$/.test(raw)) return "여성";
    if (/가족/.test(raw)) return "가족";
    return "";
  }

  function contactRoleCode(label) {
    var roles = {
      "주인": "임",
      "남성": "남",
      "여성": "여",
      "관리업체": "관",
      "부동산": "부",
      "세입자": "세",
      "가족": "가"
    };
    return roles[label] || "";
  }

  function landlordPriority(label) {
    if (label === "주인") return 100;
    if (label === "가족") return 60;
    if (label === "남성" || label === "여성") return 50;
    if (label === "관리업체") return 30;
    if (label === "부동산") return 20;
    return 10;
  }

  function appendPhoneMemo(memo, extraMemo) {
    var parts = Array.isArray(extraMemo) ? extraMemo.filter(Boolean) : [];
    if (!parts.length) return memo;
    return text(memo) + " · " + parts.join(" · ");
  }

  function importItemTotal(records, metadata) {
    records = Array.isArray(records) ? records : [];
    metadata = metadata || {};
    return Math.max(
      records.length,
      Number(metadata.found || 0),
      Number(metadata.unchanged || 0) +
        Number(metadata.rejectedCount || 0) +
        records.length
    );
  }

  async function sendToAppsScript(records, metadata, suppliedCollectorKey) {
    metadata = metadata || {};
    var itemsLength = importItemTotal(records, metadata);
    var collectorKey = suppliedCollectorKey || getCollectorKey();
    var emptyTotals = {
      received: 0,
      created: 0,
      merged: 0,
      updated: 0,
      review: 0,
      duplicate: 0,
      failed: 0
    };
    var signature = collectionSignature(records);
    var savedProgress = getSavedProgressForRecords(records);
    if (savedProgress && savedProgress.sessionId) {
      metadata.sessionId = savedProgress.sessionId;
      metadata.scope = savedProgress.scope || metadata.scope;
    }
    if (!metadata.sessionId) metadata.sessionId = createCollectionSessionId();
    var totals = savedProgress
      ? Object.assign(emptyTotals, savedProgress.totals || {})
      : emptyTotals;
    var offset = savedProgress
      ? Math.max(0, Math.min(Number(savedProgress.offset) || 0, records.length))
      : 0;
    var batchIndex = savedProgress
      ? Number(savedProgress.batchIndex) || 0
      : 0;

    while (offset < records.length) {
      if (state.stopRequested) break;
      batchIndex += 1;
      var batch = records.slice(offset, offset + SAVE_BATCH_SIZE);
      var batchStartedAt = Date.now();
      var saveWaitTimer = window.setInterval(function () {
        showGongsilSaveWait(offset, batch.length, records.length, batchStartedAt);
      }, 1000);
      showGongsilSaveWait(offset, batch.length, records.length, batchStartedAt);
      setStatus(
        "JS부동산 매물현황으로 전송 중입니다.",
        Math.min(offset + batch.length, records.length).toLocaleString("ko-KR") +
        " / " + records.length.toLocaleString("ko-KR") + "개 · 자동 묶음 " +
        batch.length.toLocaleString("ko-KR") + "개"
      );

      var result;
      try {
        result = await sendAppsScriptBatch(
          batch,
          collectorKey,
          batchIndex,
          metadata
        );
      } catch (error) {
        window.clearInterval(saveWaitTimer);
        if (isBusyMutationError(error)) {
          setStatus(
            "이전 저장 작업이 끝나기를 기다리는 중",
            "현재 매물 묶음은 그대로 보존됩니다.\n" +
            "창을 닫지 않아도 저장 순서가 오면 자동으로 계속됩니다."
          );
          await delay(5000);
          continue;
        }
        if (batch.length > MIN_SAVE_BATCH_SIZE) {
          SAVE_BATCH_SIZE = Math.max(
            MIN_SAVE_BATCH_SIZE,
            Math.floor(batch.length * 0.5 / 25) * 25
          );
          setStatus(
            "전송 묶음을 줄여 자동 복구 중입니다.",
            batch.length.toLocaleString("ko-KR") + "개 묶음 연결 실패 · " +
            SAVE_BATCH_SIZE.toLocaleString("ko-KR") +
            "개씩 다시 전송합니다.\n이미 저장된 매물은 다시 만들지 않습니다."
          );
          await delay(1000);
          continue;
        }
        throw error;
      }
      window.clearInterval(saveWaitTimer);
      if (!result || result.ok !== true) return result;

      addImportResult(totals, result);
      offset += batch.length;
      try {
        localStorage.setItem(SAVE_PROGRESS_KEY, JSON.stringify({
          signature: signature,
          sessionId: metadata.sessionId,
          scope: metadata.scope,
          offset: offset,
          batchIndex: batchIndex,
          totals: totals,
          updatedAt: new Date().toISOString()
        }));
      } catch (_) {}
      updateDashboard({
        found: itemsLength,
        processed: Math.min(
          itemsLength,
          Number(metadata.unchanged || 0) +
          Number(metadata.rejectedCount || 0) +
          offset
        ),
        remaining: Math.max(0, records.length - offset),
        created: totals.created,
        merged: totals.merged,
        updated: totals.updated,
        review: totals.review,
        duplicate: totals.duplicate,
        detailedDuplicates: totals.duplicate,
        skippedUnchanged: Number(metadata.unchanged || 0),
        failed: totals.failed
      });
      setProgress(
        Math.min(
          itemsLength,
          Number(metadata.unchanged || 0) +
            Number(metadata.rejectedCount || 0) +
            offset
        ),
        itemsLength
      );
      var elapsed = Date.now() - batchStartedAt;
      if (Number(result.failed || 0) || elapsed > 14000) {
        SAVE_BATCH_SIZE = Math.max(MIN_SAVE_BATCH_SIZE, Math.floor(SAVE_BATCH_SIZE * 0.7 / 25) * 25);
      } else if (elapsed < 5000) {
        SAVE_BATCH_SIZE = Math.min(MAX_SAVE_BATCH_SIZE, SAVE_BATCH_SIZE + 50);
      }
      if (state.stopRequested) break;
    }
    var stopped = state.stopRequested || offset < records.length;
    if (offset > 0 || metadata.manifestRegistered) {
      await finalizeGongsilSession(
        metadata,
        collectorKey,
        Boolean(metadata.complete) &&
          !stopped &&
          Number(totals.failed || 0) === 0 &&
          Number(metadata.rejectedCount || 0) === 0,
        stopped
      );
    }
    if (!stopped) {
      try { localStorage.removeItem(SAVE_PROGRESS_KEY); } catch (_) {}
    }

    return {
      ok: true,
      stopped: stopped,
      action: "gongsilImportBatch",
      received: totals.received,
      created: totals.created,
      merged: totals.merged,
      updated: totals.updated,
      review: totals.review,
      duplicate: totals.duplicate,
      detailedDuplicates: totals.duplicate,
      skippedUnchanged: Number(metadata.unchanged || 0),
      failed: totals.failed,
      message:
        "공실박스 상세저장 판정: 상세확인 " + totals.received +
        "개 중 신규 등록 " + totals.created +
        "개, 자동 통합 " + totals.merged +
        "개, 조건 변경 " + totals.updated +
        "개, 검증대기 " + totals.review +
        "개, 상세중복 " + totals.duplicate +
        "개, 기존 동일 생략 " + Number(metadata.unchanged || 0) +
        "개, 실패 " + totals.failed + "개"
    };
  }

  function showGongsilDetailWait(completed, total, startedAt) {
    if (!state.busy || state.stopRequested) return;
    var seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    setStatus(
      "상세조회·연락처 확인 중",
      completed.toLocaleString("ko-KR") + " / " +
      total.toLocaleString("ko-KR") + "개 · " +
      seconds.toLocaleString("ko-KR") + "초 경과\n" +
      "공실박스 상세정보는 누락 방지를 위해 한 건씩 안전하게 확인합니다."
    );
  }

  function showGongsilSaveWait(offset, batchLength, total, startedAt) {
    if (!state.busy || state.stopRequested) return;
    var seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    setStatus(
      "중복검사·저장 중",
      (offset + 1).toLocaleString("ko-KR") + "~" +
      Math.min(offset + batchLength, total).toLocaleString("ko-KR") +
      " / " + total.toLocaleString("ko-KR") + "개 · " +
      seconds.toLocaleString("ko-KR") + "초 경과\n" +
      "매물 저장을 먼저 끝내고 고객매칭은 자동으로 별도 갱신합니다."
    );
  }

  function recordSignatureId(record) {
    record = record || {};
    var values = Array.isArray(record.values) ? record.values : [];
    return text(
      record.externalId ||
      record.sourceId ||
      record.propertyId ||
      record.id ||
      record.address ||
      values[1] ||
      ""
    );
  }

  function recordSourceId(item) {
    return text(pick(item || {}, ["Bfidx", "bfidx", "BfIdx", "id"]));
  }

  function gongsilListSnapshot(item) {
    item = item || {};
    var projection = {};
    [
      "Bo", "Deposit", "MmDeposit", "Mm", "Monthly", "MmMonthly", "Rent",
      "Jun", "JeonseDeposit", "Jmm", "JeonseMonthly", "Moneys", "moneys",
      "Bilname", "BilName", "Bname", "BuildingName",
      "TypeView", "ViewType", "LndType", "Type", "Ckhus", "Collective", "IsCollective",
      "Ho", "BfHo", "Room", "Honame", "Ff", "BfFloor", "Floor", "floor",
      "Area", "Pyeong", "Py", "AreaPy", "BfArea", "AreaM2", "Areatxt",
      "Premium", "Gwon", "Gwonri", "BfPremium", "RightMoney", "Gul", "gul",
      "Gal", "BfGalMoney", "ManagementFee", "ManageFee",
      "MoveDate", "BfMoveDate", "MoveInDate", "CurrentBusiness",
      "CurrentIndustry", "NowBusiness", "Uptype", "BusinessType",
      "Memo", "BfMemo", "Note", "BfAdnote2", "Hoetc", "Status", "State"
    ].forEach(function(key) {
      var value = item[key];
      if (value == null || typeof value === "function") return;
      projection[key] = value;
    });
    return stableSnapshotJson(projection);
  }

  function stableSnapshotJson(value) {
    if (Array.isArray(value)) {
      return "[" + value.map(stableSnapshotJson).join(",") + "]";
    }
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(function(key) {
        return JSON.stringify(key) + ":" + stableSnapshotJson(value[key]);
      }).join(",") + "}";
    }
    return JSON.stringify(value == null ? null : value);
  }

  async function classifyGongsilManifest(items, metadata, collectorKey) {
    var needs = Object.create(null);
    var unchanged = 0;
    var changed = 0;
    var unknown = 0;
    var chunkSize = 2500;
    for (var offset = 0; offset < items.length; offset += chunkSize) {
      if (state.stopRequested) throw new Error("사용자 안전중단");
      var chunk = items.slice(offset, offset + chunkSize);
      setStatus(
        "기존 매물 빠른 비교 중",
        Math.min(offset + chunk.length, items.length).toLocaleString("ko-KR") +
        " / " + items.length.toLocaleString("ko-KR") +
        "개 · 신규·변경·연락처 누락만 상세조회합니다."
      );
      var requestId =
        "gongsil-manifest-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      await postAppsScriptWithRetry({
        action: "classifySourceManifest",
        requestId: requestId,
        collectorKey: collectorKey,
        source: "공실박스",
        sessionId: metadata.sessionId,
        scope: metadata.scope,
        entries: chunk.map(function(item) {
          var rental = getRentalTerms(item) || {};
          return {
            sourceId: recordSourceId(item),
            listSnapshot: gongsilListSnapshot(item),
            deposit: rental.deposit,
            rent: rental.rent,
            area: getPyeong(item),
            room: getRoom(item)
          };
        })
      }, {label: "기존 매물 빠른 비교"});
      var result = await pollMutationStatus(requestId, collectorKey);
      if (isBusyMutationResult(result)) {
        setStatus(
          "이전 저장 작업이 끝나기를 기다리는 중",
          "기존 매물 비교를 자동으로 다시 시도합니다.\n" +
          "선택한 2,490개 매물은 그대로 보존됩니다."
        );
        await delay(5000);
        offset -= chunkSize;
        continue;
      }
      if (!result || result.ok !== true) {
        throw new Error(result && result.message ? result.message : "기존 매물 비교에 실패했습니다.");
      }
      (Array.isArray(result.needsDetail) ? result.needsDetail : []).forEach(function(id) {
        needs[text(id)] = true;
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
      setProgress(Math.min(offset + chunk.length, items.length), items.length);
    }
    return {needs: needs, unchanged: unchanged, changed: changed, unknown: unknown};
  }

  function observedSourceIds(items) {
    var seen = Object.create(null);
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var id = text(pick(item || {}, ["Bfidx", "bfidx", "BfIdx", "id"]));
      if (id) seen[id] = true;
    });
    return Object.keys(seen);
  }

  function collectionSignature(records) {
    records = Array.isArray(records) ? records : [];
    return [
      records.length,
      recordSignatureId(records[0]),
      recordSignatureId(records[records.length - 1])
    ].join("|");
  }

  function getSavedProgressForRecords(records) {
    var savedProgress = null;
    try {
      savedProgress = JSON.parse(
        localStorage.getItem(SAVE_PROGRESS_KEY) || "null"
      );
    } catch (_) {}
    if (!savedProgress) return null;

    var strongSignature = collectionSignature(records);
    var legacySignature = [records.length, "", ""].join("|");
    var isFreshLegacy =
      savedProgress.signature === legacySignature &&
      Date.now() - Date.parse(savedProgress.updatedAt || 0) <=
        12 * 60 * 60 * 1000;

    return savedProgress.signature === strongSignature || isFreshLegacy
      ? savedProgress
      : null;
  }

  function addImportResult(totals, result) {
    result = result || {};
    totals.received += Number(result.received || 0);
    totals.created += Number(
      result.created !== undefined ? result.created : result.inserted || 0
    );
    totals.merged += Number(result.merged || 0);
    totals.updated += Number(result.updated || 0);
    totals.review += Number(result.review || 0);
    totals.duplicate += Number(
      result.duplicate !== undefined
        ? Number(result.duplicate || 0) + Number(result.duplicateSnapshots || 0)
        : Number(result.duplicates || 0) + Number(result.unchanged || 0)
    );
    totals.failed += Number(
      result.failed !== undefined ? result.failed : result.rejected || 0
    );
    return totals;
  }

  async function sendAppsScriptBatch(records, collectorKey, batchIndex, metadata) {
    var requestId =
      "gongsil-" + Date.now() + "-" + batchIndex + "-" +
      Math.random().toString(36).slice(2, 10);
    await postAppsScriptWithRetry({
      action: "gongsilImportBatch",
      requestId: requestId,
      collectorKey: collectorKey,
      sessionId: metadata && metadata.sessionId || "",
      scope: metadata && metadata.scope || "공실박스 선택클러스터",
      complete: false,
      manifestRegistered: Boolean(metadata && metadata.manifestRegistered),
      records: records
    }, {
      label: "매물 " + records.length.toLocaleString("ko-KR") + "개 저장"
    });

    try {
      var saveResult = await pollMutationStatus(requestId, collectorKey);
      if (isBusyMutationResult(saveResult)) {
        var busyError = new Error(saveResult.message || "다른 수집 저장이 진행 중입니다.");
        busyError.isCollectorBusy = true;
        throw busyError;
      }
      return saveResult;
    } catch (error) {
      if (error && error.isCollectorBusy) throw error;
      throw new Error(
        "시트 저장 결과 확인이 오래 걸리고 있습니다. " +
        "저장 지점은 보존되며 다시 시도하면 같은 매물을 만들지 않고 이어갑니다. " +
        "요청번호: " + requestId
      );
    }
  }

  async function finalizeGongsilSession(metadata, collectorKey, complete, stopped) {
    var requestId =
      "gongsil-finalize-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    await postAppsScriptWithRetry({
      action: "finalizeCollectionSession",
      requestId: requestId,
      collectorKey: collectorKey,
      sessionId: metadata.sessionId,
      scope: metadata.scope || "공실박스 선택클러스터",
      source: "공실박스",
      complete: Boolean(complete),
      stopped: Boolean(stopped),
      observedSourceIds: Array.isArray(metadata.observedSourceIds)
        ? metadata.observedSourceIds
        : [],
      note: stopped
        ? "사용자 안전중단 · 저장된 묶음 보존"
        : (complete
          ? "2000개 이상 전체클러스터 완전수집 완료" +
            (Number(metadata.rejectedCount || 0)
              ? " · 변환 제외 " + Number(metadata.rejectedCount) + "개 노출ID 보호"
              : "")
          : "선택클러스터 수집 완료")
    }, {
      label: "수집 완료 상태 저장"
    });
    var finalizeResult = await pollMutationStatus(requestId, collectorKey);
    if (isBusyMutationResult(finalizeResult)) {
      setStatus(
        "마지막 저장 작업 순서를 기다리는 중",
        "수집 결과는 보존되어 있으며 완료 처리를 자동으로 다시 시도합니다."
      );
      await delay(5000);
      return finalizeGongsilSession(metadata, collectorKey, complete, stopped);
    }
    if (!finalizeResult || finalizeResult.ok !== true) {
      throw new Error(
        finalizeResult && finalizeResult.message
          ? finalizeResult.message
          : "수집 완료 상태 저장에 실패했습니다."
      );
    }
    return finalizeResult;
  }

  function isBusyMutationResult(result) {
    var message = text(result && result.message);
    return Boolean(
      result &&
      result.ok !== true &&
      /다른\s*(?:수집\s*)?(?:저장|작업)|진행\s*중|잠시\s*후|busy|lock/i.test(message)
    );
  }

  function isBusyMutationError(error) {
    return Boolean(
      error &&
      (error.isCollectorBusy ||
        /다른\s*(?:수집\s*)?(?:저장|작업)|진행\s*중|잠시\s*후|busy|lock/i.test(
          text(error.message)
        ))
    );
  }

  async function postAppsScriptWithRetry(payload, options) {
    options = options || {};
    var lastError = null;

    for (
      var attempt = 0;
      attempt < POST_RETRY_DELAYS.length;
      attempt += 1
    ) {
      if (state.stopRequested) {
        throw new Error("사용자 안전중단");
      }
      if (POST_RETRY_DELAYS[attempt]) {
        await delay(POST_RETRY_DELAYS[attempt]);
      }

      try {
        await originalFetch(APPS_SCRIPT_URL, {
          method: "POST",
          mode: "no-cors",
          headers: {"content-type": "text/plain;charset=utf-8"},
          body: JSON.stringify(payload)
        });
        return true;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < POST_RETRY_DELAYS.length) {
          setStatus(
            "네트워크 연결을 자동으로 복구 중입니다.",
            (options.label || "시트 저장") + " · 재연결 " +
            (attempt + 1) + "/" + (POST_RETRY_DELAYS.length - 1) +
            "\n창을 닫지 않아도 자동으로 다시 시도합니다."
          );
        }
      }
    }

    throw new Error(
      "네트워크 연결이 여러 번 끊겼습니다. " +
      (lastError && lastError.message ? lastError.message : "Failed to fetch")
    );
  }

  function createCollectionSessionId() {
    return "GONGSIL-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function pollMutationStatus(requestId, collectorKey) {
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      /*
       * 공실박스 연락처 원상복구는 기존 매물 100~250건을 한 번에 대조하므로
       * Apps Script 처리 시간이 1분을 넘을 수 있습니다. POST 요청은 이미
       * 서버에서 계속 실행 중이므로 짧은 확인 제한으로 새 요청을 만들지 않고,
       * 동일 requestId의 결과를 최대 약 7분 동안 기다립니다.
       */
      var pollStartedAt = Date.now();
      var maxWaitMs = 7 * 60 * 1000;

      function canRetry() {
        return Date.now() - pollStartedAt < maxWaitMs;
      }

      function check() {
        attempts += 1;
        var callbackName =
          "__jsGongsilStatus_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        var script = document.createElement("script");
        var timer;

        window[callbackName] = function (payload) {
          clearTimeout(timer);
          delete window[callbackName];
          script.remove();

          if (payload && payload.ready) {
            resolve(payload.result || payload);
          } else if (canRetry()) {
            setTimeout(check, 650);
          } else {
            reject(new Error("저장 결과 확인 시간 초과"));
          }
        };

        timer = setTimeout(function () {
          delete window[callbackName];
          script.remove();
          if (canRetry()) setTimeout(check, 650);
          else reject(new Error("저장 결과 확인 시간 초과"));
        }, 2500);

        script.onerror = function () {
          clearTimeout(timer);
          delete window[callbackName];
          script.remove();
          if (canRetry()) setTimeout(check, 650);
          else reject(new Error("저장 결과 확인 차단"));
        };
        script.src =
          APPS_SCRIPT_URL +
          "?action=mutationStatus&requestId=" + encodeURIComponent(requestId) +
          "&collectorKey=" + encodeURIComponent(collectorKey) +
          "&callback=" + encodeURIComponent(callbackName) +
          "&_=" + Date.now();
        document.head.appendChild(script);
      }

      setTimeout(check, 500);
    });
  }

  function closePanel() {
    state.active = false;
    panel.style.display = "none";
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

  function setProgress(done, total) {
    var percent = total
      ? Math.min(100, Math.max(0, Math.round(Number(done || 0) / Number(total) * 100)))
      : 0;
    if (progressPercentElement) progressPercentElement.textContent = percent + "%";
    if (progressBarElement) progressBarElement.style.width = percent + "%";
  }

  function rejectedSummary(reasons) {
    var counts = {};
    (reasons || []).forEach(function (reason) {
      var label = text(reason) || "변환 실패";
      counts[label] = (counts[label] || 0) + 1;
    });
    var entries = Object.keys(counts)
      .sort(function (left, right) { return counts[right] - counts[left]; })
      .slice(0, 3)
      .map(function (reason) { return "- " + reason + " " + counts[reason] + "개"; });
    return entries.length ? entries.join("\n") : "- 원인을 확인하지 못했습니다.";
  }

  function isMissingIdentifier(value) {
    return value === undefined || value === null || value === "";
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    var results = new Array(items.length);
    var cursor = 0;

    async function run() {
      while (cursor < items.length) {
        var index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }

    var runners = [];
    for (var index = 0; index < Math.min(concurrency, items.length); index += 1) {
      runners.push(run());
    }
    await Promise.all(runners);
    return results;
  }

  function pick(source, keys) {
    if (!source) return "";
    for (var index = 0; index < keys.length; index += 1) {
      var value = source[keys[index]];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  }

  function text(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return "";
    return String(value).trim();
  }

  function numberValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    var source = text(value).replace(/,/g, "");
    var match = source.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function normalizeMoney(value) {
    var number = numberValue(value);
    return number || "";
  }

  function normalizePhone(value) {
    var digits = text(value).replace(/[^0-9]/g, "");
    if (digits.length < 9) return "";
    if (/^02\d{7,8}$/.test(digits)) {
      return digits.replace(/^(02)(\d{3,4})(\d{4})$/, "$1-$2-$3");
    }
    return digits.replace(/^(0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");
  }

  function trimNumber(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "";
    return Math.round(number * 10) / 10;
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      var key = String(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function truthy(value) {
    if (value === true || value === 1) return true;
    var normalized = text(value).toLowerCase();
    return normalized === "1" || normalized === "y" || normalized === "yes" ||
      normalized === "true" || normalized === "산";
  }
})();
