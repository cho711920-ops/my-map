/* JS부동산 v6.0 STEP2 - AI임장 시작 / 진행 세션 */
(function () {
  "use strict";

  var SESSION_KEY = "js_ai_visit_sessions_v6";
  var LEGACY_SESSION_KEY = "js_ai_visit_session_v6";
  var LOCATION_CACHE_KEY = "js_ai_visit_location_v6";
  var activeSession = null;
  var focusMarker = null;
  var lastKnownLocation = null;
  var locationWarmupStarted = false;
  var roadviewCloseObserver = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getVisitLists() {
    if (window.JSV6ListStore && typeof window.JSV6ListStore.load === "function") {
      return window.JSV6ListStore.load("visit");
    }
    try {
      var parsed = JSON.parse(localStorage.getItem("js_visit_lists_v6") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function getItem(key) {
    if (window.JSV6ListStore && typeof window.JSV6ListStore.getItem === "function") {
      return window.JSV6ListStore.getItem(key);
    }
    if (!Array.isArray(window.allItems)) return null;
    return window.allItems.find(function (item) { return item.key === key; }) || null;
  }

  function getValidItems(list) {
    return (list.itemKeys || []).map(getItem).filter(Boolean);
  }

  function ensureUi() {
    if (document.getElementById("aiVisitLauncherModal")) return;

    var host = document.createElement("div");
    host.innerHTML =
      '<div id="aiVisitLauncherModal" class="aiv-modal" aria-hidden="true">' +
        '<div class="aiv-backdrop" onclick="JSAiVisitV6.closeLauncher()"></div>' +
        '<section class="aiv-launcher" role="dialog" aria-modal="true" aria-labelledby="aivLauncherTitle">' +
          '<header class="aiv-modal-header">' +
            '<div><div id="aivLauncherTitle" class="aiv-modal-title">AI임장 시작</div><div class="aiv-modal-subtitle">방문할 임장목록을 선택하세요.</div></div>' +
            '<button type="button" class="aiv-icon-close" onclick="JSAiVisitV6.closeLauncher()" aria-label="닫기">×</button>' +
          '</header>' +
          '<div id="aivLauncherBody" class="aiv-launcher-body"></div>' +
        '</section>' +
      '</div>' +

      '<div id="aiVisitConfirmModal" class="aiv-modal" aria-hidden="true">' +
        '<div class="aiv-backdrop" onclick="JSAiVisitV6.closeConfirm()"></div>' +
        '<section class="aiv-confirm" role="dialog" aria-modal="true" aria-labelledby="aivConfirmTitle">' +
          '<header class="aiv-modal-header">' +
            '<div><div id="aivConfirmTitle" class="aiv-modal-title">AI임장 시작 확인</div></div>' +
            '<button type="button" class="aiv-icon-close" onclick="JSAiVisitV6.closeConfirm()" aria-label="닫기">×</button>' +
          '</header>' +
          '<div id="aivConfirmBody" class="aiv-confirm-body"></div>' +
          '<footer class="aiv-confirm-footer">' +
            '<button type="button" class="aiv-btn secondary" onclick="JSAiVisitV6.closeConfirm()">취소</button>' +
            '<button id="aivConfirmStartBtn" type="button" class="aiv-btn primary">시작하기</button>' +
          '</footer>' +
        '</section>' +
      '</div>' +

      '<section id="aiVisitWorkspace" class="aiv-workspace" aria-hidden="true">' +
        '<header class="aiv-workspace-header">' +
          '<div class="aiv-heading-wrap">' +
            '<div class="aiv-brand-mark">AI</div>' +
            '<div><div id="aivWorkspaceTitle" class="aiv-workspace-title">AI임장</div><div id="aivWorkspaceProgress" class="aiv-workspace-progress"></div></div>' +
          '</div>' +
          '<div class="aiv-header-actions"><button type="button" class="aiv-recalc-btn" onclick="JSAiVisitV6.recalculateRoute()">현위치 재계산</button><button type="button" class="aiv-exit-btn" onclick="JSAiVisitV6.requestExit()">종료</button></div>' +
        '</header>' +
        '<div class="aiv-workspace-main">' +
          '<main class="aiv-current-panel">' +
            '<div class="aiv-section-kicker">현재 방문 매물</div>' +
            '<div class="aiv-map-stage">' +
              '<div id="aivRouteMap" class="aiv-route-map"></div>' +
            '</div>' +
            '<div id="aivCurrentCard" class="aiv-current-card"></div>' +
          '</main>' +
          '<aside class="aiv-route-panel">' +
            '<div class="aiv-route-head"><strong>방문 예정 목록</strong><span id="aivRouteCount"></span></div>' +
            '<div id="aivRouteList" class="aiv-route-list"></div>' +
          '</aside>' +
        '</div>' +
      '</section>';

    while (host.firstChild) document.body.appendChild(host.firstChild);
  }

  function openModal(id) {
    ensureUi();
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("aiv-modal-open");
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".aiv-modal.open")) document.body.classList.remove("aiv-modal-open");
  }

  function renderLauncher() {
    var body = document.getElementById("aivLauncherBody");
    if (!body) return;
    var lists = getVisitLists();

    if (!lists.length) {
      body.innerHTML = '<div class="aiv-empty"><strong>임장목록이 없습니다.</strong><span>먼저 보기 → 임장목록에서 목록을 만들어주세요.</span></div>';
      return;
    }

    body.innerHTML = '<div class="aiv-list-select">' + lists.map(function (list) {
      var count = getValidItems(list).length;
      return '<button type="button" class="aiv-list-option ' + (count ? '' : 'empty') + '" onclick="JSAiVisitV6.openConfirmForList(\'' + list.id + '\')">' +
        '<span class="aiv-list-option-main"><strong>' + escapeHtml(list.name) + '</strong><small>' + (count ? '등록된 매물로 AI임장을 시작합니다.' : '등록된 매물이 없습니다.') + '</small></span>' +
        '<span class="aiv-list-count">' + count + '개</span>' +
      '</button>';
    }).join("") + '</div>';
  }

  function openLauncher() {
    ensureUi();
    renderLauncher();
    openModal("aiVisitLauncherModal");
  }

  function showStartConfirmation(list, items) {
    closeModal("aiVisitLauncherModal");
    document.getElementById("aivConfirmBody").innerHTML =
      '<div class="aiv-confirm-name">' + escapeHtml(list.name) + '</div>' +
      '<div class="aiv-confirm-count">총 <strong>' + items.length + '개</strong> 매물</div>' +
      '<p>현재 위치를 기준으로 가까운 매물부터 방문 순서를 계산합니다.<br>위치를 가져오지 못하면 기존 목록 순서로 시작합니다.</p>';

    var startButton = document.getElementById("aivConfirmStartBtn");
    startButton.textContent = "시작하기";
    startButton.onclick = function () { startSession(list); };
    openModal("aiVisitConfirmModal");
  }

  function openConfirmForList(listId) {
    ensureUi();
    var list = getVisitLists().find(function (entry) { return entry.id === listId; });
    if (!list) return alert("임장목록을 찾지 못했습니다.");

    var items = getValidItems(list);
    if (!items.length) return alert("이 임장목록에는 등록된 매물이 없습니다.");

    var stored = loadStoredSession(listId);
    if (stored && Array.isArray(stored.itemKeys) && stored.itemKeys.length) {
      closeModal("aiVisitLauncherModal");
      document.getElementById("aivConfirmBody").innerHTML =
        '<div class="aiv-confirm-name">' + escapeHtml(list.name) + '</div>' +
        '<div class="aiv-confirm-count">완료하지 않은 AI임장이 있습니다.</div>' +
        '<p><strong>' + (Number(stored.currentIndex || 0) + 1) + ' / ' + stored.itemKeys.length + '</strong> 위치에서 저장되었습니다.<br>이어서 진행하시겠습니까?</p>' +
        '<div class="aiv-resume-actions">' +
          '<button type="button" class="aiv-btn secondary" id="aivStartFreshBtn">아니오 · 새로 시작</button>' +
          '<button type="button" class="aiv-btn primary" id="aivResumeBtn">예 · 이어가기</button>' +
        '</div>';
      document.getElementById("aivConfirmStartBtn").style.display = "none";
      openModal("aiVisitConfirmModal");
      document.getElementById("aivResumeBtn").onclick = function () {
        closeModal("aiVisitConfirmModal");
        waitForItemsReady(function () { restoreStoredSession(stored); });
      };
      document.getElementById("aivStartFreshBtn").onclick = function () {
        removeStoredSession(listId);
        document.getElementById("aivConfirmStartBtn").style.display = "";
        closeModal("aiVisitConfirmModal");
        showStartConfirmation(list, items);
      };
      return;
    }
    document.getElementById("aivConfirmStartBtn").style.display = "";
    showStartConfirmation(list, items);
  }

  function loadSessionMap() {
    var sessions = {};
    try {
      var parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) sessions = parsed;
    } catch (error) {}

    /* STEP2 이전 단일 세션은 한 번만 목록별 저장소로 이전합니다. */
    try {
      var legacy = JSON.parse(localStorage.getItem(LEGACY_SESSION_KEY) || "null");
      if (legacy && legacy.active && legacy.listId && !sessions[legacy.listId]) {
        sessions[legacy.listId] = legacy;
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
      }
      localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch (error) {}
    return sessions;
  }

  function saveSession() {
    if (!activeSession || !activeSession.listId) return;
    try {
      var sessions = loadSessionMap();
      sessions[activeSession.listId] = activeSession;
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
    } catch (error) {
      console.error("AI임장 세션 저장 실패", error);
    }
  }

  function loadStoredSession(listId) {
    var stored = loadSessionMap()[listId];
    return stored && stored.active ? stored : null;
  }

  function removeStoredSession(listId) {
    if (!listId) return;
    try {
      var sessions = loadSessionMap();
      delete sessions[listId];
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
    } catch (error) {}
  }

  function startSession(list) {
    var keys = getValidItems(list).map(function (item) { return item.key; });
    var startButton = document.getElementById("aivConfirmStartBtn");
    if (startButton) {
      startButton.disabled = true;
      startButton.textContent = "현재 위치 확인 중...";
    }

    function finishStart(result) {
      var orderedKeys = result && Array.isArray(result.keys) ? result.keys : keys;
      activeSession = {
        active: true,
        listId: list.id,
        listName: list.name,
        itemKeys: orderedKeys,
        currentIndex: 0,
        statuses: {},
        routeOptimized: !!(result && result.optimized),
        routeStartLocation: result && result.location ? result.location : null,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (startButton) {
        startButton.disabled = false;
        startButton.textContent = "시작하기";
      }
      saveSession();
      closeModal("aiVisitConfirmModal");
      openWorkspace();
      if (!(result && result.optimized)) {
        window.setTimeout(function () {
          var detail = result && result.locationError && result.locationError.message
            ? "\n원인: " + result.locationError.message
            : "";
          alert("현재 위치를 가져오지 못해 임장목록 순서로 시작합니다." + detail + "\n\n태블릿의 위치 기능이 켜져 있는지 확인한 뒤, AI임장 화면의 현위치 재계산을 눌러 다시 시도할 수 있습니다.");
        }, 120);
      }
    }

    if (window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.prepare === "function") {
      window.JSAiVisitRouteV6.prepare(keys, finishStart);
    } else {
      finishStart({ keys: keys, optimized: false, location: null });
    }
  }

  function openWorkspace() {
    ensureUi();
    if (!activeSession || !activeSession.itemKeys.length) return;
    var workspace = document.getElementById("aiVisitWorkspace");
    workspace.classList.add("open");
    workspace.setAttribute("aria-hidden", "false");
    document.body.classList.add("aiv-workspace-open");
    warmCurrentLocation();
    renderWorkspace();
  }

  function validSessionItems() {
    if (!activeSession) return [];
    return activeSession.itemKeys.map(getItem).filter(Boolean);
  }

  function moneyLabel(label, value) {
    if (value == null || value === "" || value === "0" || value === 0) return "";
    return '<span><em>' + escapeHtml(label) + '</em><strong>' + escapeHtml(value) + '</strong></span>';
  }

  function fieldLine(label, value) {
    if (value == null || value === "") return "";
    return '<div class="aiv-detail-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function getDealLabel(item) {
    if (!item) return "";
    var explicit = String(item.tradeType || item.dealType || item.transactionType || item.contractType || "").trim();
    if (explicit) {
      if (/매매/.test(explicit)) return "매매";
      if (/전세/.test(explicit)) return "전세";
      if (/임대|월세/.test(explicit)) return "임대";
      return explicit;
    }
    var searchable = [item.type, item.name, item.memo].filter(Boolean).join(" ");
    if (/매매/.test(searchable)) return "매매";
    if (/전세/.test(searchable)) return "전세";
    return "임대";
  }

  function buildAddressWithRoom(item) {
    var address = String((item && item.address) || "").trim();
    var room = String((item && item.room) || "").trim();
    if (!address) address = "주소 없음";
    return room ? address + " · " + room : address;
  }

  function renderCurrentCard(item, index, total) {
    var priceBits = [
      moneyLabel("보증금", item.deposit),
      moneyLabel("월세", item.rent),
      moneyLabel("관리비", item.fee),
      moneyLabel("권리금", item.premium),
      moneyLabel("평수", item.area || item.pyeong)
    ].filter(Boolean).join("");

    var dealLabel = getDealLabel(item);
    var meta = [item.type].filter(function (value) {
      if (!value) return false;
      var normalized = String(value).replace(/\s+/g, "").trim();
      return !/^(임대|월세|전세|매매)$/.test(normalized) && normalized !== String(dealLabel).replace(/\s+/g, "");
    }).map(function (value) {
      return '<span>' + escapeHtml(value) + '</span>';
    }).join("");

    var travel = window.JSAiVisitUiV6 && typeof window.JSAiVisitUiV6.estimate === "function"
      ? window.JSAiVisitUiV6.estimate(item)
      : null;
    var travelHtml = travel
      ? '<div class="aiv-travel-strip"><span>도보 <strong>' + travel.walkMinutes + '분</strong> <small>(' + escapeHtml(travel.distanceText) + ')</small></span><span>차량 <strong>' + travel.carMinutes + '분</strong> <small>(' + escapeHtml(travel.distanceText) + ')</small></span></div>'
      : '<div class="aiv-travel-strip pending"><span>도보·차량 예상시간 계산 중</span></div>';

    var next = window.JSAiVisitUiV6 && typeof window.JSAiVisitUiV6.nextItem === "function"
      ? window.JSAiVisitUiV6.nextItem(activeSession)
      : null;
    var nextHtml = next
      ? '<div class="aiv-next-preview"><span>다음</span><strong>' + escapeHtml(next.name || next.address || "다음 매물") + '</strong><small>' + escapeHtml(buildAddressWithRoom(next)) + '</small></div>'
      : '<div class="aiv-next-preview last"><span>마지막 매물</span></div>';

    return '<div class="aiv-current-index">' + (index + 1) + '<small>/ ' + total + '</small></div>' +
      '<div class="aiv-current-top">' +
        '<div>' +
          '<div class="aiv-current-title-line">' +
            (dealLabel ? '<span class="aiv-deal-badge ' + (dealLabel === "매매" ? "sale" : dealLabel === "전세" ? "jeonse" : "lease") + '">' + escapeHtml(dealLabel) + '</span>' : '') +
            '<h2>' + escapeHtml(item.name || item.address || "매물") + '</h2>' +
          '</div>' +
          '<div class="aiv-current-meta">' + meta + '</div>' +
          '<div class="aiv-current-address">' + escapeHtml(buildAddressWithRoom(item)) + '</div>' +
        '</div>' +
      '</div>' +
      travelHtml +
      (priceBits ? '<div class="aiv-price-grid">' + priceBits + '</div>' : '') +
      '<div class="aiv-compact-contact">' +
        fieldLine("임대인", item.landlordPhone) +
        fieldLine("세입자", item.tenantPhone) +
      '</div>' +
      '<div id="aivMemoBox" class="aiv-memo-box"><div class="aiv-memo-title">메모</div><div class="aiv-memo-text">' + escapeHtml(item.memo || "메모가 없습니다.") + '</div></div>' +
      '<div class="aiv-primary-actions">' +
        '<button type="button" onclick="JSAiVisitV6.openNavigation()">내비</button>' +
        '<button type="button" onclick="JSAiVisitV6.openRoadview()">로드뷰</button>' +
        '<button type="button" onclick="JSAiVisitV6.toggleMemo()">메모</button>' +
      '</div>' +
      '<div class="aiv-route-actions">' +
        '<button type="button" class="recalc" onclick="JSAiVisitV6.recalculateRoute()">현위치 재계산</button>' +
        '<button type="button" class="hold" onclick="JSAiVisitV6.holdCurrent()">보류</button>' +
      '</div>' +
      nextHtml +
      '<div class="aiv-step-actions">' +
        '<button type="button" ' + (index === 0 ? 'disabled' : '') + ' onclick="JSAiVisitV6.goPrevious()">이전</button>' +
        '<button type="button" ' + (index >= total - 1 ? 'disabled' : '') + ' onclick="JSAiVisitV6.goNext()">다음</button>' +
      '</div>';
  }

  function renderWorkspace() {
    var items = validSessionItems();
    if (!items.length) {
      closeWorkspace(false);
      alert("AI임장에 표시할 매물을 찾지 못했습니다.");
      return;
    }

    if (activeSession.currentIndex >= items.length) activeSession.currentIndex = items.length - 1;
    if (activeSession.currentIndex < 0) activeSession.currentIndex = 0;
    activeSession.itemKeys = items.map(function (item) { return item.key; });
    activeSession.updatedAt = new Date().toISOString();
    saveSession();

    var current = items[activeSession.currentIndex];
    document.getElementById("aivWorkspaceTitle").textContent = "AI임장 · " + activeSession.listName;
    var statuses = activeSession.statuses || {};
    var holdCount = Object.keys(statuses).filter(function (key) { return statuses[key] === "hold"; }).length;
    var percent = window.JSAiVisitUiV6 && typeof window.JSAiVisitUiV6.progress === "function"
      ? window.JSAiVisitUiV6.progress(activeSession.currentIndex, items.length)
      : Math.round(((activeSession.currentIndex + 1) / Math.max(1, items.length)) * 100);
    document.getElementById("aivWorkspaceProgress").innerHTML =
      '<span class="aiv-progress-text">' + (activeSession.currentIndex + 1) + ' / ' + items.length + ' 진행 중' + (holdCount ? ' · 보류 ' + holdCount : '') + '</span>' +
      '<span class="aiv-progress-track"><i style="width:' + percent + '%"></i></span>';
    document.getElementById("aivRouteCount").textContent = items.length + "개";
    document.getElementById("aivCurrentCard").innerHTML = renderCurrentCard(current, activeSession.currentIndex, items.length);
    document.getElementById("aivRouteList").innerHTML = items.map(function (item, index) {
      var state = statuses[item.key] || "";
      return '<button type="button" class="aiv-route-item ' + (index === activeSession.currentIndex ? 'active ' : '') + (state ? state : '') + '" onclick="JSAiVisitV6.goTo(' + index + ')">' +
        '<span class="aiv-route-number">' + (index + 1) + '</span>' +
        '<span class="aiv-route-copy"><strong>' + escapeHtml(item.name || item.address || "매물") + '</strong><small>' + escapeHtml(item.address || "") + (state === "hold" ? ' · 보류' : '') + '</small></span>' +
      '</button>';
    }).join("");

    focusCurrentOnMap(current);
    if (window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.renderMap === "function") {
      window.setTimeout(function () {
        window.JSAiVisitRouteV6.renderMap(activeSession, activeSession.currentIndex, goTo);
      }, 0);
    }
  }

  function focusCurrentOnMap(item) {
    if (!item || !window.map || !window.kakao || !kakao.maps) return;
    var coords = typeof window.getItemCoordinates === "function" ? window.getItemCoordinates(item) : null;
    if (!coords || !isFinite(coords.lat) || !isFinite(coords.lng)) return;

    var position = new kakao.maps.LatLng(coords.lat, coords.lng);
    try {
      window.map.panTo(position);
      if (focusMarker) focusMarker.setMap(null);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path fill="#2563eb" stroke="#fff" stroke-width="3" d="M17 1.5C8.4 1.5 1.5 8.4 1.5 17c0 12 15.5 23.5 15.5 23.5S32.5 29 32.5 17C32.5 8.4 25.6 1.5 17 1.5z"/><circle cx="17" cy="17" r="6" fill="#fff"/></svg>';
      var image = new kakao.maps.MarkerImage(
        'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        new kakao.maps.Size(34, 42),
        { offset: new kakao.maps.Point(17, 42) }
      );
      focusMarker = new kakao.maps.Marker({ position: position, image: image, zIndex: 9999 });
      focusMarker.setMap(window.map);
    } catch (error) {
      console.error("현재 매물 지도 강조 실패", error);
    }
  }

  function currentItem() {
    var items = validSessionItems();
    return items[activeSession ? activeSession.currentIndex : 0] || null;
  }

  function encodedCurrentKey() {
    var item = currentItem();
    return item ? encodeURIComponent(item.key) : "";
  }

  function buildDestinationName(item) {
    var destinationName = String((item && item.address) || "").trim();
    if (!destinationName) return "매물 위치";
    if (!/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(destinationName)) {
      destinationName = "대전 " + destinationName;
    }
    return destinationName;
  }

  function rememberLocation(position) {
    if (!position || !position.coords) return null;
    var lat = Number(position.coords.latitude);
    var lng = Number(position.coords.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    lastKnownLocation = {
      lat: lat,
      lng: lng,
      accuracy: Number(position.coords.accuracy) || 0,
      timestamp: Number(position.timestamp) || Date.now()
    };
    try { localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(lastKnownLocation)); } catch (error) {}
    return lastKnownLocation;
  }

  function getFreshCachedLocation(maxAgeMs) {
    if (!lastKnownLocation) {
      try {
        var cached = JSON.parse(localStorage.getItem(LOCATION_CACHE_KEY) || "null");
        if (cached && isFinite(Number(cached.lat)) && isFinite(Number(cached.lng))) {
          lastKnownLocation = { lat: Number(cached.lat), lng: Number(cached.lng), accuracy: Number(cached.accuracy) || 0, timestamp: Number(cached.timestamp) || 0 };
        }
      } catch (error) {}
    }
    if (!lastKnownLocation) return null;
    return Date.now() - lastKnownLocation.timestamp <= maxAgeMs ? lastKnownLocation : null;
  }

  function warmCurrentLocation() {
    if (locationWarmupStarted || !navigator.geolocation) return;
    locationWarmupStarted = true;
    navigator.geolocation.getCurrentPosition(
      function (position) { rememberLocation(position); },
      function () {
        navigator.geolocation.getCurrentPosition(
          function (position) { rememberLocation(position); },
          function () {},
          { enableHighAccuracy: true, timeout: 7000, maximumAge: 120000 }
        );
      },
      { enableHighAccuracy: false, timeout: 2500, maximumAge: 300000 }
    );
  }

  function requestCurrentLocation(onSuccess, onFailure) {
    var cached = getFreshCachedLocation(300000);
    if (cached) {
      onSuccess(cached);
      return;
    }
    if (!navigator.geolocation) {
      onFailure();
      return;
    }

    var finished = false;
    function success(position) {
      if (finished) return;
      var location = rememberLocation(position);
      if (!location) return;
      finished = true;
      onSuccess(location);
    }
    function fallback() {
      if (finished) return;
      navigator.geolocation.getCurrentPosition(
        success,
        function () {
          if (finished) return;
          finished = true;
          onFailure();
        },
        { enableHighAccuracy: true, timeout: 6500, maximumAge: 120000 }
      );
    }

    navigator.geolocation.getCurrentPosition(
      success,
      fallback,
      { enableHighAccuracy: false, timeout: 2200, maximumAge: 300000 }
    );
  }

  function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function launchKakaoRoute(location, destination) {
    var endLat = Number(destination && destination.lat);
    var endLng = Number(destination && destination.lng);
    if (![endLat, endLng].every(isFinite)) {
      alert("목적지 좌표를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    var ep = endLat.toFixed(7) + "," + endLng.toFixed(7);
    var destinationName = encodeURIComponent((destination && destination.name) || "임장 매물");

    if (isAndroidDevice()) {
      /* Android 휴대폰·태블릿은 카카오맵 앱이 기기 GPS를 출발지로 직접 사용하게 합니다.
         브라우저에서 출발지를 억지로 전달하지 않아 태블릿의 빈 출발지 문제를 피하고,
         웹 새창 fallback도 넣지 않아 앱 실행을 방해하지 않습니다. */
      var intentUrl = "intent://route?ep=" + encodeURIComponent(ep) +
        "&by=CAR&ename=" + destinationName +
        "#Intent;scheme=kakaomap;package=net.daum.android.map;end";
      window.location.href = intentUrl;
      return;
    }

    var webUrl = "https://map.kakao.com/link/to/" + destinationName + "," + endLat.toFixed(7) + "," + endLng.toFixed(7);
    window.open(webUrl, "_blank", "noopener,noreferrer");
  }

  function openNavigation() {
    var item = currentItem();
    if (!item) return alert("매물 정보를 찾지 못했습니다.");
    var coords = typeof window.getItemCoordinates === "function" ? window.getItemCoordinates(item) : null;
    if (!coords || !isFinite(Number(coords.lat)) || !isFinite(Number(coords.lng))) {
      return alert("이 매물의 지도 좌표가 아직 준비되지 않았습니다.");
    }

    /* Android에서는 앱 자체의 현 위치를 출발지로 사용하므로 GPS 대기 없이 즉시 실행합니다. */
    launchKakaoRoute(null, {
      lat: Number(coords.lat),
      lng: Number(coords.lng),
      name: item.building || item.name || item.address || "임장 매물"
    });
  }

  function roadviewViewportMetrics() {
    var viewport = window.visualViewport;
    var width = viewport ? Number(viewport.width) : Number(window.innerWidth || document.documentElement.clientWidth || 0);
    var height = viewport ? Number(viewport.height) : Number(window.innerHeight || document.documentElement.clientHeight || 0);
    var top = viewport ? Number(viewport.offsetTop || 0) : 0;
    var left = viewport ? Number(viewport.offsetLeft || 0) : 0;
    return {
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
      top: Math.max(0, Math.round(top)),
      left: Math.max(0, Math.round(left))
    };
  }

  function syncRoadviewViewport() {
    var modal = document.getElementById("roadviewModal");
    if (!modal || !modal.classList.contains("open")) return;
    var dialog = modal.querySelector(".roadview-modal-dialog");
    var header = modal.querySelector(".roadview-modal-header");
    var content = modal.querySelector(".roadview-tab-content");
    if (!dialog || !header || !content) return;

    var metrics = roadviewViewportMetrics();
    var isTouch = (navigator.maxTouchPoints || 0) > 0;
    var isLandscape = metrics.width > metrics.height;
    var isTabletLandscape = isTouch && isLandscape && metrics.width >= 700;

    /* STEP3.6: 태블릿 가로모드는 브라우저가 PC형 viewport 값을 주는 경우가 있어
       flex 높이 계산 대신, 실제 웹 표시영역 안에 헤더와 본문을 절대 배치합니다.
       position:fixed의 기준은 이미 웹 콘텐츠 viewport이므로 offsetTop을 다시 더하지 않습니다. */
    var gap = isTabletLandscape ? 8 : 6;
    var headerHeight = isTabletLandscape ? 48 : 52;
    var visibleWidth = Math.max(320, Math.min(
      Number(window.innerWidth || metrics.width || 0),
      Number(metrics.width || window.innerWidth || 0)
    ));
    var visibleHeight = Math.max(260, Math.min(
      Number(window.innerHeight || metrics.height || 0),
      Number(metrics.height || window.innerHeight || 0)
    ));
    var dialogWidth = Math.max(320, visibleWidth - gap * 2);
    var dialogHeight = Math.max(260, visibleHeight - gap * 2);

    modal.classList.toggle("aiv-tablet-landscape", isTabletLandscape);
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.padding = "0";
    modal.style.overflow = "hidden";

    dialog.style.position = "fixed";
    dialog.style.top = gap + "px";
    dialog.style.left = gap + "px";
    dialog.style.right = "auto";
    dialog.style.bottom = "auto";
    dialog.style.width = dialogWidth + "px";
    dialog.style.height = dialogHeight + "px";
    dialog.style.maxWidth = "none";
    dialog.style.maxHeight = "none";
    dialog.style.margin = "0";
    dialog.style.transform = "none";
    dialog.style.display = "block";
    dialog.style.overflow = "hidden";
    dialog.style.boxSizing = "border-box";

    if (isTabletLandscape) {
      /* 헤더가 카카오 로드뷰 캔버스 뒤로 들어가지 않도록 최상단에 고정합니다. */
      header.style.display = "grid";
      header.style.gridTemplateColumns = "auto minmax(0,1fr) 40px";
      header.style.position = "absolute";
      header.style.top = "0";
      header.style.left = "0";
      header.style.right = "0";
      header.style.bottom = "auto";
      header.style.width = "100%";
      header.style.height = headerHeight + "px";
      header.style.minHeight = headerHeight + "px";
      header.style.maxHeight = headerHeight + "px";
      header.style.boxSizing = "border-box";
      header.style.zIndex = "2147483000";
      header.style.background = "#fff";
      header.style.visibility = "visible";
      header.style.opacity = "1";
      header.style.pointerEvents = "auto";

      content.style.position = "absolute";
      content.style.top = headerHeight + "px";
      content.style.left = "0";
      content.style.right = "0";
      content.style.bottom = "0";
      content.style.width = "100%";
      content.style.height = "auto";
      content.style.minHeight = "0";
      content.style.overflow = "hidden";
      content.style.zIndex = "1";
    } else {
      dialog.style.display = "flex";
      dialog.style.flexDirection = "column";

      header.style.display = "grid";
      header.style.gridTemplateColumns = "auto minmax(0,1fr) 40px";
      header.style.position = "relative";
      header.style.flex = "0 0 " + headerHeight + "px";
      header.style.height = headerHeight + "px";
      header.style.minHeight = headerHeight + "px";
      header.style.maxHeight = headerHeight + "px";
      header.style.boxSizing = "border-box";
      header.style.zIndex = "100";
      header.style.background = "#fff";

      content.style.position = "relative";
      content.style.flex = "1 1 auto";
      content.style.height = Math.max(0, dialogHeight - headerHeight) + "px";
      content.style.minHeight = "0";
      content.style.overflow = "hidden";
    }

    var emergencyClose = document.getElementById("aivRoadviewEmergencyClose");
    if (emergencyClose) emergencyClose.remove();

    /* 크기 변경 뒤 카카오 지도/로드뷰가 새 영역을 다시 계산하게 합니다. */
    window.setTimeout(function () {
      try {
        if (window.roadviewInstance && window.kakao && kakao.maps && kakao.maps.event) {
          kakao.maps.event.trigger(window.roadviewInstance, "resize");
        }
      } catch (error) {}
      try {
        if (window.roadviewFullMap && window.kakao && kakao.maps && kakao.maps.event) {
          kakao.maps.event.trigger(window.roadviewFullMap, "resize");
        }
      } catch (error) {}
    }, 80);
  }

  function watchRoadviewViewport() {
    var modal = document.getElementById("roadviewModal");
    if (!modal) return;
    if (roadviewCloseObserver) roadviewCloseObserver.disconnect();
    roadviewCloseObserver = new MutationObserver(function () {
      if (modal.classList.contains("open")) window.setTimeout(syncRoadviewViewport, 0);
    });
    roadviewCloseObserver.observe(modal, { attributes: true, attributeFilter: ["class", "aria-hidden"] });

    if (window.visualViewport && !window.__aivRoadviewViewportBound) {
      window.visualViewport.addEventListener("resize", syncRoadviewViewport);
      window.visualViewport.addEventListener("scroll", syncRoadviewViewport);
      window.__aivRoadviewViewportBound = true;
    }
    if (!window.__aivRoadviewOrientationBound) {
      window.addEventListener("orientationchange", function () {
        window.setTimeout(syncRoadviewViewport, 120);
        window.setTimeout(syncRoadviewViewport, 420);
      });
      window.addEventListener("resize", function () {
        window.setTimeout(syncRoadviewViewport, 80);
      });
      window.__aivRoadviewOrientationBound = true;
    }
  }

  function openRoadview() {
    var encoded = encodedCurrentKey();
    if (!encoded || typeof window.openKakaoRoadview !== "function") return alert("로드뷰 기능을 불러오지 못했습니다.");
    watchRoadviewViewport();
    window.openKakaoRoadview(encoded);
    window.setTimeout(syncRoadviewViewport, 60);
    window.setTimeout(syncRoadviewViewport, 300);
  }

  function toggleMemo() {
    var box = document.getElementById("aivMemoBox");
    if (box) box.classList.toggle("open");
  }

  function goTo(index) {
    if (!activeSession) return;
    var items = validSessionItems();
    if (index < 0 || index >= items.length) return;
    activeSession.currentIndex = index;
    renderWorkspace();
  }

  function showAllOnMap() {
    if (!activeSession || !window.JSAiVisitRouteV6 || typeof window.JSAiVisitRouteV6.fitAll !== "function") return;
    window.JSAiVisitRouteV6.fitAll(activeSession);
  }

  function focusCurrentOnRouteMap() {
    if (!activeSession || !window.JSAiVisitRouteV6 || typeof window.JSAiVisitRouteV6.focusIndex !== "function") return;
    window.JSAiVisitRouteV6.focusIndex(activeSession, activeSession.currentIndex);
  }

  function recalculateRoute() {
    if (!activeSession) return;
    if (!window.JSAiVisitRouteV6 || typeof window.JSAiVisitRouteV6.recalculate !== "function") {
      return alert("동선 계산 기능을 불러오지 못했습니다.");
    }
    var buttons = document.querySelectorAll(".aiv-recalc-btn, .aiv-route-actions .recalc");
    buttons.forEach(function (button) { button.disabled = true; button.textContent = "재계산 중..."; });
    window.JSAiVisitRouteV6.recalculate(activeSession, function (result) {
      buttons.forEach(function (button) { button.disabled = false; button.textContent = "현위치 재계산"; });
      if (!result || !result.ok) return alert("현재 위치를 가져오지 못했습니다. 위치 권한과 GPS를 확인해주세요.");
      activeSession = result.session;
      activeSession.updatedAt = new Date().toISOString();
      saveSession();
      renderWorkspace();
    });
  }

  function holdCurrent() {
    if (!activeSession) return;
    var item = currentItem();
    if (!item) return;
    activeSession.statuses = activeSession.statuses || {};
    activeSession.statuses[item.key] = "hold";
    activeSession.updatedAt = new Date().toISOString();
    var nextIndex = window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.nextPendingIndex === "function"
      ? window.JSAiVisitRouteV6.nextPendingIndex(activeSession, activeSession.currentIndex)
      : activeSession.currentIndex + 1;
    if (nextIndex >= 0 && nextIndex < activeSession.itemKeys.length) activeSession.currentIndex = nextIndex;
    saveSession();
    renderWorkspace();
    if (nextIndex < 0) alert("모든 매물을 확인했습니다. 보류 매물은 임장목록에 그대로 유지됩니다.");
  }

  function requestExit() {
    if (!activeSession) return closeWorkspace(false);
    var ok = confirm("AI임장을 종료하시겠습니까?\n현재 진행상태는 자동 저장됩니다.");
    if (!ok) return;
    activeSession.updatedAt = new Date().toISOString();
    saveSession();
    closeWorkspace(true);
  }

  function closeWorkspace(keepSession) {
    var workspace = document.getElementById("aiVisitWorkspace");
    if (workspace) {
      workspace.classList.remove("open");
      workspace.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("aiv-workspace-open");
    if (focusMarker) {
      focusMarker.setMap(null);
      focusMarker = null;
    }
    if (window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.clear === "function") {
      window.JSAiVisitRouteV6.clear();
    }
    if (!keepSession) {
      var closingListId = activeSession && activeSession.listId;
      activeSession = null;
      removeStoredSession(closingListId);
    }
  }

  function waitForItemsReady(callback, attempt) {
    var currentAttempt = attempt || 0;
    if (Array.isArray(window.allItems) && window.allItems.length > 0) {
      callback();
      return;
    }
    if (currentAttempt >= 40) {
      alert("매물 데이터를 불러오지 못해 AI임장을 이어가지 못했습니다.\n잠시 후 AI임장하기 버튼을 다시 눌러주세요.");
      return;
    }
    window.setTimeout(function () {
      waitForItemsReady(callback, currentAttempt + 1);
    }, 250);
  }

  function restoreStoredSession(stored) {
    activeSession = {
      active: true,
      listId: stored.listId,
      listName: stored.listName,
      itemKeys: Array.isArray(stored.itemKeys) ? stored.itemKeys.slice() : [],
      currentIndex: Number(stored.currentIndex) || 0,
      statuses: stored.statuses && typeof stored.statuses === "object" ? stored.statuses : {},
      routeOptimized: !!stored.routeOptimized,
      routeStartLocation: stored.routeStartLocation || null,
      startedAt: stored.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    var validItems = validSessionItems();
    if (!validItems.length) {
      var invalidListId = activeSession && activeSession.listId;
      activeSession = null;
      removeStoredSession(invalidListId);
      alert("저장된 AI임장 매물을 찾지 못했습니다.");
      return;
    }

    activeSession.itemKeys = validItems.map(function (item) { return item.key; });
    if (activeSession.currentIndex >= activeSession.itemKeys.length) activeSession.currentIndex = activeSession.itemKeys.length - 1;
    if (activeSession.currentIndex < 0) activeSession.currentIndex = 0;

    saveSession();
    openWorkspace();
  }


  window.JSAiVisitV6 = {
    openLauncher: openLauncher,
    closeLauncher: function () { closeModal("aiVisitLauncherModal"); },
    openConfirmForList: openConfirmForList,
    closeConfirm: function () { closeModal("aiVisitConfirmModal"); },
    openNavigation: openNavigation,
    openRoadview: openRoadview,
    toggleMemo: toggleMemo,
    goPrevious: function () { if (activeSession) goTo(activeSession.currentIndex - 1); },
    goNext: function () {
      if (!activeSession) return;
      var nextIndex = window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.nextPendingIndex === "function"
        ? window.JSAiVisitRouteV6.nextPendingIndex(activeSession, activeSession.currentIndex)
        : activeSession.currentIndex + 1;
      if (nextIndex >= 0) goTo(nextIndex);
    },
    recalculateRoute: recalculateRoute,
    showAllOnMap: showAllOnMap,
    focusCurrentOnRouteMap: focusCurrentOnRouteMap,
    holdCurrent: holdCurrent,
    goTo: goTo,
    requestExit: requestExit,
    getSavedProgress: function (listId) {
      var stored = loadStoredSession(listId);
      if (!stored) return null;
      return { current: Number(stored.currentIndex || 0) + 1, total: (stored.itemKeys || []).length, updatedAt: stored.updatedAt || "" };
    }
  };

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (document.getElementById("aiVisitWorkspace") && document.getElementById("aiVisitWorkspace").classList.contains("open")) {
        requestExit();
      } else {
        closeModal("aiVisitLauncherModal");
        closeModal("aiVisitConfirmModal");
      }
    }
  });

  ensureUi();
  watchRoadviewCloseButton();
  warmCurrentLocation();
})();
