/* Smartphone-only presentation. Shared data and legacy tablet/PC layouts stay intact. */
(function phoneAppV2(global) {
  "use strict";
  var root = document.documentElement;
  var app;
  var header;
  var chips;
  var listCount;
  var mapList;
  var guard;
  var lastChips = "";
  var queued = false;
  var returnFocus = null;
  var blockedElements = new Map();

  function isPhone() {
    return !!(global.JSPhoneDeviceV1 && global.JSPhoneDeviceV1.isPhone());
  }

  function create() {
    app = document.getElementById("jsMobileAppV1");
    if (!app || chips) return;
    header = app.querySelector(".jsm-app-header-v1");
    chips = document.createElement("div");
    chips.id = "jsPhoneFilterChipsV2";
    chips.className = "js-phone-filter-chips-v2";
    chips.setAttribute("aria-label", "적용 중인 검색 조건");
    chips.hidden = true;
    header.appendChild(chips);

    listCount = document.createElement("strong");
    listCount.id = "jsPhoneListCountV2";
    listCount.setAttribute("role", "status");
    listCount.setAttribute("aria-live", "polite");
    var toolbar = document.getElementById("listToolbar");
    if (toolbar) toolbar.insertBefore(listCount, toolbar.firstChild);

    mapList = document.createElement("button");
    mapList.id = "jsPhoneMapListV2";
    mapList.type = "button";
    mapList.addEventListener("click", function() { global.JSMobileAppV1.setView("list"); });
    app.appendChild(mapList);

    guard = document.createElement("section");
    guard.id = "jsPhonePortraitGuardV2";
    guard.hidden = true;
    guard.setAttribute("role", "dialog");
    guard.setAttribute("aria-modal", "true");
    guard.setAttribute("aria-labelledby", "jsPhonePortraitTitleV2");
    guard.setAttribute("aria-describedby", "jsPhonePortraitDescriptionV2");
    guard.setAttribute("tabindex", "-1");
    guard.innerHTML = '<span class="js-phone-rotate-icon-v2" aria-hidden="true">↻</span>' +
      '<h2 id="jsPhonePortraitTitleV2">휴대폰을 세로로 돌려주세요</h2>' +
      '<p id="jsPhonePortraitDescriptionV2">스마트폰에서는 세로 화면으로 이용합니다.<br>검색 조건과 보던 매물은 그대로 유지됩니다.</p>';
    guard.addEventListener("keydown", function(event) {
      if (event.key === "Tab") { event.preventDefault(); guard.focus({preventScroll: true}); }
    });
    document.body.appendChild(guard);

    // Input submission dismisses the soft keyboard without selecting/clearing the query.
    var form = document.getElementById("jsMobileSearchFormV1");
    form.addEventListener("submit", function() {
      if (!isPhone()) return;
      var input = document.getElementById("jsMobileKeywordV1");
      if (input) input.blur();
      if (global.JSPhoneFavoritesV2 && global.JSPhoneFavoritesV2.isOpen()) global.closeUnifiedFavoritesV7();
    });

    var observer = new MutationObserver(queueSync);
    var list = document.getElementById("list");
    if (list) observer.observe(list, {childList: true, attributes: true, attributeFilter: ["data-total-count"]});
    var originalChips = document.getElementById("activeFilterChipsV844");
    if (originalChips) observer.observe(originalChips, {childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"]});
    var mapCount = document.getElementById("mapListingCountV825");
    if (mapCount) observer.observe(mapCount, {attributes: true, attributeFilter: ["data-listing-count"]});
    // New dialogs must also be inert while the portrait notice covers the app.
    observer.observe(document.body, {childList: true});
    observer.observe(root, {attributes: true, attributeFilter: ["class"]});
    if (global.ResizeObserver) new global.ResizeObserver(syncHeaderHeight).observe(header);
    global.addEventListener("js-phone-favorites-change", queueSync);
    global.addEventListener("resize", queueSync);
    if (global.visualViewport) global.visualViewport.addEventListener("resize", queueSync);
  }

  function syncHeaderHeight() {
    if (!header || !isPhone()) return;
    var height = Math.ceil(header.getBoundingClientRect().height);
    if (height > 0) root.style.setProperty("--js-phone-header-height", height + "px");
  }

  function syncPortraitGuard() {
    if (!guard) return;
    // Auth owns the initial inert state. Wait for unlock before taking any
    // snapshot, or portrait restoration could re-lock an authenticated #wrap.
    if (root.classList.contains("auth-pending")) { guard.hidden = true; return; }
    var landscape = isPhone() && global.JSPhoneDeviceV1.isLandscape();
    if (landscape) {
      if (guard.hidden) returnFocus = document.activeElement;
      guard.hidden = false;
      Array.prototype.forEach.call(document.body.children, function(element) {
        if (element === guard || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(element.tagName)) return;
        if (!blockedElements.has(element)) blockedElements.set(element, element.inert);
        element.inert = true;
      });
      if (document.activeElement !== guard) guard.focus({preventScroll: true});
    } else {
      var wasVisible = !guard.hidden;
      guard.hidden = true;
      blockedElements.forEach(function(previous, element) { element.inert = previous; });
      blockedElements.clear();
      if (wasVisible && returnFocus && returnFocus.isConnected && typeof returnFocus.focus === "function") {
        // Do not reopen the keyboard after rotation; all entered values remain in place.
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(returnFocus.tagName)) returnFocus.focus({preventScroll: true});
      }
      returnFocus = null;
    }
  }

  function sync() {
    queued = false;
    if (!app) create();
    if (!app) return;
    syncPortraitGuard();
    if (!isPhone()) {
      root.style.removeProperty("--js-phone-header-height");
      return;
    }
    var entries = typeof global.getActiveFilterChipsV844 === "function" ? global.getActiveFilterChipsV844() : [];
    var signature = JSON.stringify(entries);
    if (signature !== lastChips) {
      lastChips = signature;
      chips.replaceChildren();
      entries.forEach(function(entry) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = entry.label + " ×";
        button.setAttribute("aria-label", entry.label + " 필터 해제");
        button.addEventListener("click", function() {
          if (typeof global.clearActiveFilterChipV844 === "function") global.clearActiveFilterChipV844(entry.key);
          var input = document.getElementById("jsMobileKeywordV1");
          var source = document.getElementById("keyword");
          if (input && source) input.value = source.value;
          queueSync();
        });
        chips.appendChild(button);
      });
      chips.hidden = entries.length === 0;
    }
    var list = document.getElementById("list");
    var count = Math.max(0, Number(list && list.getAttribute("data-total-count")) || 0);
    var countText = "매물 " + count.toLocaleString("ko-KR") + "개";
    if (listCount.textContent !== countText) listCount.textContent = countText;
    var mapCount = document.getElementById("mapListingCountV825");
    var mapTotal = mapCount && mapCount.hasAttribute("data-listing-count") ? Number(mapCount.dataset.listingCount) : count;
    var mapLabel = "현재 범위 매물 " + Math.max(0, mapTotal || 0).toLocaleString("ko-KR") + "개 보기";
    if (mapList.textContent !== mapLabel) mapList.textContent = mapLabel;
    var favoriteOpen = global.JSPhoneFavoritesV2 && global.JSPhoneFavoritesV2.isOpen();
    var currentView = favoriteOpen ? "favorites" : root.getAttribute("data-jsm-mobile-view");
    root.setAttribute("data-js-phone-favorites", favoriteOpen ? "true" : "false");
    app.querySelectorAll("[data-mobile-view]").forEach(function(button) {
      var selected = button.getAttribute("data-mobile-view") === currentView;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    syncHeaderHeight();
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    global.requestAnimationFrame(sync);
  }
  function boot() { create(); sync(); global.addEventListener("js-phone-device-change", queueSync); }
  global.JSPhoneAppV2 = {sync: sync};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once: true});
  else boot();
})(window);
