(function mobileAppV1(global) {
  "use strict";

  var MOBILE_QUERY = "(max-width: 768px)";
  var root = document.documentElement;
  var chrome = null;
  var active = false;
  var view = "map";
  var sidebarObserver = null;

  function icon(name) {
    var paths = {
      search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
      plus: '<path d="M12 5v14M5 12h14"></path>',
      map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"></path><path d="M9 3v15M15 6v15"></path>',
      list: '<path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path>',
      route: '<circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="5" r="2"></circle><path d="M8 19h3a3 3 0 0 0 3-3v-2a3 3 0 0 1 3-3h1"></path>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
      more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
      filter: '<path d="M4 6h16M7 12h10M10 18h4"></path>',
      heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path>',
      chart: '<path d="M3 3v18h18"></path><path d="m7 16 4-5 4 3 5-7"></path>',
      close: '<path d="M18 6 6 18M6 6l12 12"></path>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || "") + '</svg>';
  }

  function buildChrome() {
    if (chrome) return chrome;
    chrome = document.createElement("div");
    chrome.id = "jsMobileAppV1";
    chrome.className = "jsm-app-v1";
    chrome.hidden = true;
    chrome.innerHTML =
      '<header class="jsm-app-header-v1">' +
        '<div class="jsm-title-row-v1">' +
          '<button type="button" class="jsm-brand-v1" data-mobile-view="map" aria-label="지도 홈"><b>JS</b><span><strong>JS부동산</strong><small>대전 상가 매물지도</small></span></button>' +
          '<button type="button" class="jsm-quick-add-v1" data-mobile-action="quick-add">' + icon("plus") + '<span>빠른등록</span></button>' +
        '</div>' +
        '<form class="jsm-search-v1" id="jsMobileSearchFormV1">' +
          icon("search") +
          '<input id="jsMobileKeywordV1" type="search" autocomplete="off" placeholder="지역 · 건물 · 호실 검색">' +
          '<button type="button" data-mobile-action="filter" aria-label="상세 필터">' + icon("filter") + '</button>' +
        '</form>' +
      '</header>' +
      '<nav class="jsm-bottom-nav-v1" aria-label="모바일 주 메뉴">' +
        navButton("map", "지도", "map") +
        navButton("list", "매물", "list") +
        navButton("visit", "임장", "route") +
        navButton("customers", "고객", "users") +
        navButton("more", "더보기", "more") +
      '</nav>' +
      '<div class="jsm-sheet-layer-v1" id="jsMobileMoreLayerV1" hidden>' +
        '<button type="button" class="jsm-sheet-dim-v1" data-mobile-action="close-more" aria-label="더보기 닫기"></button>' +
        '<section class="jsm-more-sheet-v1" aria-label="더보기 메뉴">' +
          '<div class="jsm-sheet-handle-v1"></div>' +
          '<header><div><strong>더보기</strong><small>자주 쓰는 관리 기능</small></div><button type="button" data-mobile-action="close-more" aria-label="닫기">' + icon("close") + '</button></header>' +
          '<div class="jsm-more-grid-v1">' +
            moreButton("favorites", "찜목록", "저장한 매물", "heart") +
            moreButton("dashboard", "운영현황", "수집·검증 현황", "chart") +
            moreButton("filter", "상세필터", "금액·평수·층", "filter") +
            moreButton("reset", "검색 초기화", "전체 매물 보기", "map") +
          '</div>' +
        '</section>' +
      '</div>';
    document.body.appendChild(chrome);
    bindChrome();
    return chrome;
  }

  function navButton(target, label, iconName) {
    return '<button type="button" data-mobile-view="' + target + '" aria-label="' + label + '">' +
      icon(iconName) + '<span>' + label + '</span></button>';
  }

  function moreButton(action, title, description, iconName) {
    return '<button type="button" data-mobile-action="' + action + '">' + icon(iconName) +
      '<span><strong>' + title + '</strong><small>' + description + '</small></span></button>';
  }

  function bindChrome() {
    chrome.addEventListener("click", function(event) {
      var viewButton = event.target.closest("[data-mobile-view]");
      if (viewButton) {
        event.preventDefault();
        setView(viewButton.getAttribute("data-mobile-view"));
        return;
      }
      var actionButton = event.target.closest("[data-mobile-action]");
      if (!actionButton) return;
      event.preventDefault();
      runAction(actionButton.getAttribute("data-mobile-action"));
    });

    var form = chrome.querySelector("#jsMobileSearchFormV1");
    form.addEventListener("submit", function(event) {
      event.preventDefault();
      var source = document.getElementById("keyword");
      var input = chrome.querySelector("#jsMobileKeywordV1");
      if (source) source.value = input.value;
      if (typeof global.applyFilter === "function") global.applyFilter();
      setView("list");
    });
  }

  function syncSearchValue() {
    if (!chrome) return;
    var source = document.getElementById("keyword");
    var input = chrome.querySelector("#jsMobileKeywordV1");
    if (source && input && input !== document.activeElement) input.value = source.value || "";
  }

  function setView(nextView) {
    if (!active) return;
    if (nextView === "visit") {
      if (typeof global.startAiVisitPreview === "function") global.startAiVisitPreview();
      return;
    }
    if (nextView === "customers") {
      if (typeof global.openOperationsCenter === "function") global.openOperationsCenter("customers");
      return;
    }
    if (nextView === "more") {
      openMore();
      return;
    }
    view = nextView === "list" ? "list" : "map";
    root.setAttribute("data-jsm-mobile-view", view);
    var sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.toggle("open", view === "list");
    chrome.querySelectorAll(".jsm-bottom-nav-v1 [data-mobile-view]").forEach(function(button) {
      var selected = button.getAttribute("data-mobile-view") === view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    closeMore();
    syncSearchValue();
    global.setTimeout(resizeMap, 80);
  }

  function resizeMap() {
    try {
      if (global.map && global.kakao && global.kakao.maps && global.kakao.maps.event) {
        global.kakao.maps.event.trigger(global.map, "resize");
      }
    } catch (ignore) {}
  }

  function runAction(action) {
    if (action === "quick-add" && typeof global.openQuickAddModal === "function") global.openQuickAddModal();
    if (action === "filter") {
      closeMore();
      var detailButton = document.getElementById("detailBtn");
      if (detailButton) detailButton.click();
    }
    if (action === "favorites" && typeof global.openListManager === "function") {
      closeMore();
      global.openListManager("favorite");
    }
    if (action === "dashboard" && typeof global.openOperationsCenter === "function") {
      closeMore();
      global.openOperationsCenter("dashboard");
    }
    if (action === "reset") {
      closeMore();
      if (typeof global.resetFilter === "function") global.resetFilter();
      var mobileInput = chrome.querySelector("#jsMobileKeywordV1");
      if (mobileInput) mobileInput.value = "";
      setView("map");
    }
    if (action === "close-more") closeMore();
  }

  function openMore() {
    var layer = chrome && chrome.querySelector("#jsMobileMoreLayerV1");
    if (!layer) return;
    layer.hidden = false;
    document.body.classList.add("jsm-more-open-v1");
    global.requestAnimationFrame(function() { layer.classList.add("open"); });
  }

  function closeMore() {
    var layer = chrome && chrome.querySelector("#jsMobileMoreLayerV1");
    if (!layer || layer.hidden) return;
    layer.classList.remove("open");
    document.body.classList.remove("jsm-more-open-v1");
    global.setTimeout(function() { if (!layer.classList.contains("open")) layer.hidden = true; }, 220);
  }

  function watchSidebar() {
    var sidebar = document.getElementById("sidebar");
    if (!sidebar || sidebarObserver) return;
    sidebarObserver = new MutationObserver(function() {
      if (!active || !sidebar.classList.contains("open") || view === "list") return;
      setView("list");
    });
    sidebarObserver.observe(sidebar, {attributes: true, attributeFilter: ["class"]});
  }

  function activate() {
    if (active) return;
    active = true;
    buildChrome().hidden = false;
    root.classList.add("js-mobile-app-v1");
    watchSidebar();
    setView("map");
  }

  function deactivate() {
    if (!active) return;
    active = false;
    root.classList.remove("js-mobile-app-v1");
    root.removeAttribute("data-jsm-mobile-view");
    document.body.classList.remove("jsm-more-open-v1");
    if (chrome) chrome.hidden = true;
    var sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("open");
    closeMore();
    resizeMap();
  }

  function syncMode() {
    if (global.matchMedia(MOBILE_QUERY).matches) activate();
    else deactivate();
  }

  function boot() {
    buildChrome();
    syncMode();
    var media = global.matchMedia(MOBILE_QUERY);
    if (typeof media.addEventListener === "function") media.addEventListener("change", syncMode);
    else if (typeof media.addListener === "function") media.addListener(syncMode);
    document.addEventListener("input", function(event) {
      if (active && event.target && event.target.id === "keyword") syncSearchValue();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once: true});
  else boot();

  global.JSMobileAppV1 = {setView: setView, syncMode: syncMode};
})(window);
