(function () {
  "use strict";

  var VERSION = "4.1.3";
  var PANEL_ID = "js-naver-collector-panel";
  var STYLE_ID = "js-naver-collector-style";
  var MAX_PAGES = 500;
  // Apps Script 서버의 요청당 안전 상한인 100건까지 한 번에 저장한다.
  // 실패한 묶음은 기존 재시도 로직이 같은 범위를 다시 전송한다.
  var BATCH_SIZE = 100;
  var CITY_PROGRESS_KEY = "js_naver_daejeon_progress_v1";
  var CITY_FAILED_KEY = "js_naver_daejeon_failed_v1";
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
  var APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbyDfWBkgb5J6belfk0aFUkjvuBXlyqZ1g8JLf3Ge0cg7JOeevRfMs3ZZF3QC-Hc-qkw/exec";
  var NAVER_ACCESS_KEY = "JS_NAVER_EXTRACT_2026";
  var COLLECTOR_KEY_STORAGE = "js_naver_collector_access_key";

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

  if (!/(^|\.)new\.land\.naver\.com$/i.test(location.hostname)) {
    alert("네이버페이 부동산(new.land.naver.com) 지도에서 실행해 주세요.");
    return;
  }

  if (window.__JS_NAVER_COLLECTOR__) {
    window.__JS_NAVER_COLLECTOR__.reopen();
    return;
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
    prepareId: 0,
    capture: null,
    collected: [],
    capturedAt: 0,
    clickedClusterCount: 0
  };

  var panel = createPanel();
  var statusElement = panel.querySelector("[data-role=status]");
  var detailElement = panel.querySelector("[data-role=detail]");
  var progressElement = panel.querySelector("[data-role=progress]");
  var progressBarElement = panel.querySelector("[data-role=progress-bar]");
  var saveButton = panel.querySelector("[data-action=save]");
  var retryButton = panel.querySelector("[data-action=retry]");
  var cityButton = panel.querySelector("[data-action=city]");
  var closeButton = panel.querySelector("[data-action=close]");

  patchNetwork();
  bindEvents();
  setStatus(
    "원하는 숫자 클러스터를 눌러주세요.",
    "클러스터를 누르면 매물을 자동 감지합니다. 이미 눌렀다면 ‘현재 목록 다시 감지’를 눌러주세요."
  );
  discoverExistingRequest();

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
    retryFailedCityArticles: retryFailedCityArticles
  };

  function createPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "#" + PANEL_ID + "{" +
        "position:fixed;right:16px;bottom:18px;z-index:2147483647;" +
        "width:min(380px,calc(100vw - 24px));box-sizing:border-box;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;" +
        "background:#fff;border:1px solid #cfe8d9;border-radius:16px;" +
        "box-shadow:0 16px 45px rgba(15,23,42,.24);overflow:hidden;color:#172033}" +
        "#" + PANEL_ID + " *{box-sizing:border-box}" +
        "#" + PANEL_ID + " .jsn-head{display:flex;align-items:center;justify-content:space-between;" +
        "padding:13px 15px;background:linear-gradient(135deg,#03c75a,#00a94f);color:#fff}" +
        "#" + PANEL_ID + " .jsn-title{font-size:16px;font-weight:850;letter-spacing:-.3px}" +
        "#" + PANEL_ID + " .jsn-version{font-size:10px;opacity:.8;margin-left:6px}" +
        "#" + PANEL_ID + " .jsn-close{width:32px;height:32px;border:0;border-radius:9px;" +
        "background:rgba(255,255,255,.18);color:#fff;font-size:22px;line-height:30px;cursor:pointer}" +
        "#" + PANEL_ID + " .jsn-body{padding:15px}" +
        "#" + PANEL_ID + " .jsn-status{font-size:15px;font-weight:850;line-height:1.45;color:#172033}" +
        "#" + PANEL_ID + " .jsn-detail{margin-top:7px;color:#667085;font-size:12px;line-height:1.55;" +
        "white-space:pre-line;max-height:116px;overflow:auto}" +
        "#" + PANEL_ID + " .jsn-progress{height:7px;margin-top:12px;border-radius:99px;" +
        "background:#e7efe9;overflow:hidden;display:none}" +
        "#" + PANEL_ID + " .jsn-progress>i{display:block;width:0;height:100%;background:#03c75a;transition:width .18s}" +
        "#" + PANEL_ID + " .jsn-rule{margin-top:12px;padding:10px 11px;background:#f0fbf5;" +
        "border-radius:10px;color:#3d6250;font-size:11px;line-height:1.55}" +
        "#" + PANEL_ID + " .jsn-actions{display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-top:12px}" +
        "#" + PANEL_ID + " button.jsn-btn{height:46px;border-radius:11px;font-size:14px;font-weight:850;cursor:pointer}" +
        "#" + PANEL_ID + " .jsn-retry{border:1px solid #b9c9c0;background:#fff;color:#315244}" +
        "#" + PANEL_ID + " .jsn-save{border:0;background:#03c75a;color:#fff}" +
        "#" + PANEL_ID + " .jsn-city{grid-column:1/-1;border:1px solid #1687e8;background:#eaf5ff;color:#0963b5}" +
        "#" + PANEL_ID + " .jsn-save:disabled,#" + PANEL_ID + " .jsn-retry:disabled,#" + PANEL_ID + " .jsn-city:disabled{" +
        "cursor:not-allowed;background:#d2ded7;color:#f8faf9;border-color:#d2ded7}" +
        "@media(max-width:640px){#" + PANEL_ID + "{right:8px;bottom:8px;width:calc(100vw - 16px)}}";
      document.head.appendChild(style);
    }

    var element = document.createElement("section");
    element.id = PANEL_ID;
    element.innerHTML =
      '<div class="jsn-head">' +
        '<div class="jsn-title">JS 네이버 수집기<span class="jsn-version">v' + VERSION + '</span></div>' +
        '<button type="button" class="jsn-close" data-action="close" aria-label="닫기">×</button>' +
      '</div>' +
      '<div class="jsn-body">' +
        '<div class="jsn-status" data-role="status"></div>' +
        '<div class="jsn-detail" data-role="detail"></div>' +
        '<div class="jsn-progress" data-role="progress"><i data-role="progress-bar"></i></div>' +
        '<div class="jsn-rule">저장 위치: <b>JS부동산 매물현황</b><br>' +
        '중복검사: 매물ID 우선 · 지번주소 + 층/호실 + 보증금 + 월세 + 평수<br>' +
        '확장 프로그램 없이 이 북마크 버튼 하나로 사용합니다.</div>' +
        '<div class="jsn-actions">' +
          '<button type="button" class="jsn-btn jsn-retry" data-action="retry">현재 목록 다시 감지</button>' +
          '<button type="button" class="jsn-btn jsn-save" data-action="save" disabled>클러스터 전체 저장</button>' +
          '<button type="button" class="jsn-btn jsn-city" data-action="city" disabled>대전 전체 이어서 수집</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(element);
    return element;
  }

  function bindEvents() {
    saveButton.addEventListener("click", collectAndSave);
    retryButton.addEventListener("click", discoverExistingRequest);
    cityButton.addEventListener("click", collectDaejeonAll);
    document.addEventListener("click", rememberClusterCount, true);
    closeButton.addEventListener("click", function () {
      panel.style.display = "none";
    });
  }

  function rememberClusterCount(event) {
    var node = event && event.target;
    if (!node || (panel.contains && panel.contains(node))) return;

    for (var depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      var text = String(node.textContent || "").replace(/,/g, "").trim();
      if (!/^\d{1,4}$/.test(text)) continue;
      var count = Number(text);
      if (!Number.isFinite(count) || count < 1) continue;
      state.clickedClusterCount = count;
      setStatus(
        "클러스터 " + count + "개를 선택했습니다.",
        "네이버 첫 페이지 응답을 기다리고 있습니다."
      );
      return;
    }
  }

  function reopen() {
    state.active = true;
    panel.style.display = "block";
    patchNetwork();
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

  function setProgress(done, total) {
    if (!total) {
      progressElement.style.display = "none";
      progressBarElement.style.width = "0%";
      return;
    }
    progressElement.style.display = "block";
    progressBarElement.style.width = Math.min(100, Math.round(done / total * 100)) + "%";
  }

  function patchNetwork() {
    if (nativeFetch && !window.fetch.__jsNaverCollectorPatched) {
      var wrappedFetch = async function (input, init) {
        var response = await nativeFetch(input, init);
        inspectFetchResponse(input, response.clone(), init).catch(function () {});
        return response;
      };
      wrappedFetch.__jsNaverCollectorPatched = true;
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

      XMLHttpRequest.prototype.send = function () {
        this.addEventListener("load", function () {
          if (!state.active || !isArticleRequest(this.__jsNaverCollectorUrl)) return;
          try {
            var json = this.responseType === "json"
              ? this.response
              : JSON.parse(this.responseText || "{}");
            capturePayload(json, this.__jsNaverCollectorUrl, {
              method: this.__jsNaverCollectorMethod || "GET",
              headers: this.__jsNaverCollectorHeaders || {},
              credentials: "include"
            });
          } catch (_) {}
        }, {once: true});
        return nativeXhrSend.apply(this, arguments);
      };
    }
  }

  async function inspectFetchResponse(input, response, init) {
    if (!state.active) return;
    var url = response.url || requestUrl(input);
    if (!isArticleRequest(url)) return;
    var json = await response.json();
    capturePayload(json, url, requestOptionsFromFetch(input, init));
  }

  function requestOptionsFromFetch(input, init) {
    var options = init || {};
    var headers = {};
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
    return {
      method: String(options.method || (input && input.method) || "GET").toUpperCase(),
      headers: headers,
      credentials: options.credentials || (input && input.credentials) || "include"
    };
  }

  function replayOptions(capture) {
    var source = capture && capture.requestOptions ? capture.requestOptions : {};
    var headers = Object.assign({}, source.headers || {});
    if (!headers.accept) headers.accept = "application/json, text/plain, */*";
    return {
      method: "GET",
      credentials: source.credentials || "include",
      headers: headers,
      cache: "no-store"
    };
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
    return !!url && /\/api\/(?:articles|articleList)(?:\/|\?|$)/i.test(url);
  }

  function articleList(json) {
    if (!json || typeof json !== "object") return [];
    if (Array.isArray(json.articleList)) return json.articleList;
    if (json.body && Array.isArray(json.body.articleList)) return json.body.articleList;
    if (json.result && Array.isArray(json.result.articleList)) return json.result.articleList;
    return [];
  }

  function expectedCount(json) {
    var candidates = [
      json && json.totalCount,
      json && json.articleCount,
      json && json.total,
      json && json.pageInfo && json.pageInfo.totalCount
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
      json && json.pageInfo && json.pageInfo.hasNext
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

  function capturePayload(json, sourceUrl, requestOptions) {
    var articles = articleList(json).filter(function (article) {
      return article && article.articleNo;
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
    state.collected = articles.slice();
    state.capturedAt = Date.now();
    state.prepareId += 1;
    showCapture(state.capture);
    prepareFullCapture(state.capture, state.prepareId);
    return true;
  }

  function showCapture(capture) {
    var count = capture.articles.length;
    var expected = capture.expected;
    cityButton.disabled = !getCityStrategy(capture.responseUrl);
    updateCityButton();
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
      "클러스터 전체 " + count + "개 확인 완료",
      "전체 페이지 확인이 끝났습니다. 저장 버튼을 누르면 시트1 기존 매물과 중복검사 후 저장합니다."
    );
    saveButton.disabled = false;
    saveButton.textContent = "클러스터 전체 저장";
  }

  function updateCityButton() {
    if (!cityButton || state.busy) return;
    var progress = loadCityProgress();
    if (progress && Array.isArray(progress.queue) && progress.queue.length) {
      cityButton.textContent = "대전 전체 이어서 · 남은 구역 " + progress.queue.length + "개";
    } else {
      cityButton.textContent = "대전 전체 이어서 수집";
    }
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
    var found = new Map();
    var firstArticles = capture.articles || [];
    var currentPage = capture.page || pageNumber(capture.responseUrl);
    var expected = capture.expected || 0;
    var lastJson = capture.json || {};
    var baseUrl = new URL(capture.responseUrl);
    var requestOptions = replayOptions(capture);
    var noNewCount = 0;

    firstArticles.forEach(function (article) {
      found.set(String(article.articleNo), article);
    });
    setProgress(found.size, expected || Math.max(found.size + 1, 1));

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
        if (article && article.articleNo) {
          found.set(String(article.articleNo), article);
        }
      });

      currentPage = nextPage;
      lastJson = json;
      expected = expected || expectedCount(json);
      noNewCount = found.size === before ? noNewCount + 1 : 0;
      setProgress(found.size, expected || Math.max(found.size + 1, 1));

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
    for (var index = 0; index < items.length; index += BATCH_SIZE) {
      var batch = items.slice(index, index + BATCH_SIZE);
      var result = await postBatchWithRetry(batch, 3);
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
      progress.saved += Number(result.saved) || 0;
      progress.duplicate += Number(result.duplicate) || 0;
      batch.forEach(function(item) { seen.add(String(item.articleNo)); });
      progress.seenIds = Array.from(seen);
      saveCityProgress(progress);
      saveCityFailedItems(progress.failedItems);
      await delay(CITY_SAVE_DELAY);
    }
    return items.length;
  }

  async function retryFailedCityArticles(progress) {
    var pending = (progress.failedItems || loadCityFailedItems()).slice();
    var remaining = [];
    for (var index = 0; index < pending.length; index += 1) {
      var entry = pending[index];
      try {
        var result = await postBatchWithRetry([entry.item], 2);
        if (Number(result.failed) || !result.ok) {
          var error = Array.isArray(result.errors) && result.errors[0];
          entry.message = error && error.message || entry.message || "저장 실패";
          remaining.push(entry);
        } else {
          progress.saved += Number(result.saved) || 0;
          progress.duplicate += Number(result.duplicate) || 0;
        }
      } catch (error) {
        entry.message = String(error && error.message ? error.message : error);
        remaining.push(entry);
      }
      await delay(180);
    }
    progress.failedItems = remaining;
    saveCityFailedItems(remaining);
    saveCityProgress(progress);
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

  async function collectDaejeonAll() {
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
        duplicate: 0,
        failed: 0,
        failedItems: loadCityFailedItems()
      };
      saveCityProgress(progress);
    }

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
      setProgress(1, 1);
      setStatus(
        "대전 전체 수집 완료",
        "고유매물 " + progress.seenIds.length + "개 · 신규 " + progress.saved + "개 · 중복 " + progress.duplicate + "개 · 주소미확인 " + remainingFailures.length + "개\n" +
          (remainingFailures.length ? "주소미확인 매물은 보관했으며 다음 전체 수집 때 다시 시도합니다." : "모든 대전 구역의 조회와 저장이 완료됐습니다.")
      );
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
      var url = new URL(clean(currentUrl) || "https://new.land.naver.com/offices");
      url.searchParams.set("articleNo", id);
      return url.toString();
    } catch (_) {
      return "https://new.land.naver.com/offices?articleNo=" + encodeURIComponent(id);
    }
  }

  function normalize(article) {
    var price = article && article.price ? article.price : {};
    var articleNo = clean(article && article.articleNo);
    return {
      articleNo: articleNo,
      buildingName: clean(article && (article.buildingName || article.articleName)),
      category: clean(article && (article.articleRealEstateTypeName || article.realEstateTypeName)),
      tradeType: clean(article && article.tradeTypeName),
      deposit: clean(article && (
        article.dealOrWarrantPrc != null ? article.dealOrWarrantPrc :
        article.depositPrice != null ? article.depositPrice : price.deposit
      )),
      monthly: clean(article && (
        article.rentPrc != null ? article.rentPrc :
        article.monthlyPrice != null ? article.monthlyPrice : price.monthly
      )),
      areaSquareMeter: article && (article.area2 != null ? article.area2 : article.area1),
      floorInfo: clean(article && article.floorInfo),
      roomInfo: clean(article && (article.roomInfo || article.roomName || article.unitInfo)),
      direction: clean(article && article.direction),
      description: clean(article && article.articleFeatureDesc),
      tags: Array.isArray(article && article.tagList) ? article.tagList : [],
      latitude: article && (article.latitude || article.lat || article.mapY) || "",
      longitude: article && (article.longitude || article.lng || article.lon || article.mapX) || "",
      jibunAddress: clean(article && (
        article.jibunAddress || article.jibunAddr || article.articleAddress ||
        article.address || article.cortarAddress || article.locationAddress
      )),
      realtorName: clean(article && article.realtorName),
      providerUrl: clean(article && (article.cpPcArticleUrl || article.cpMobileArticleUrl)),
      currentUrl: location.href,
      sourceLink: naverListingUrl(articleNo, location.href)
    };
  }

  async function postBatch(items) {
    var response = await nativeFetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({
        action: "saveNaverBatch",
        accessKey: NAVER_ACCESS_KEY,
        data: items
      })
    });
    var text = await response.text();
    var result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      throw new Error("시트 저장 서버 응답을 읽지 못했습니다.");
    }
    if (!result.ok) throw new Error(result.message || "시트 저장에 실패했습니다.");
    return result;
  }

  async function collectAndSave() {
    if (state.busy || state.preparing || !state.capture || !state.capture.prepared) return;
    state.busy = true;
    saveButton.disabled = true;
    retryButton.disabled = true;
    var totals = {saved: 0, duplicate: 0, failed: 0};
    var firstFailure = "";

    try {
      var rawItems = await collectAll(state.capture);
      var items = rawItems.map(normalize).filter(function (item) {
        return item.articleNo;
      });

      for (var index = 0; index < items.length; index += BATCH_SIZE) {
        var batch = items.slice(index, index + BATCH_SIZE);
        setStatus(
          "JS부동산 매물현황 저장 중",
          (index + 1) + "~" + (index + batch.length) + "/" + items.length + "개 · 최대 " + BATCH_SIZE + "개씩 안전하게 저장합니다."
        );
        setProgress(index, items.length);
        var result = await postBatchWithRetry(batch, 3);
        totals.saved += Number(result.saved) || 0;
        totals.duplicate += Number(result.duplicate) || 0;
        totals.failed += Number(result.failed) || 0;
        if (!firstFailure && Array.isArray(result.errors) && result.errors.length) {
          firstFailure = clean(result.errors[0] && result.errors[0].message);
        }
        await delay(160);
      }

      setProgress(items.length, items.length || 1);
      setStatus(
        "네이버 수집 완료",
        "전체 " + items.length + "개 · 신규 " + totals.saved + "개 · 중복 " + totals.duplicate + "개 · 실패 " + totals.failed + "개" +
          (firstFailure ? "\n첫 실패 원인: " + firstFailure : "")
      );
      saveButton.textContent = "저장 완료 · 다시 수집 가능";
    } catch (error) {
      setProgress(0, 0);
      setStatus("네이버 수집 오류", String(error && error.message ? error.message : error));
      saveButton.textContent = "다시 저장";
    } finally {
      state.busy = false;
      saveButton.disabled = !state.capture;
      retryButton.disabled = false;
    }
  }

  async function postBatchWithRetry(batch, attempts) {
    var lastError = null;
    for (var attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await postBatch(batch);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await delay(500 * attempt);
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
