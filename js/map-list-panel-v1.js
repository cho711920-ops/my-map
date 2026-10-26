/* Desktop browsing starts with the list open. Phone navigation owns
 * the portrait list. No listing, favorite or collector data is written here. */
(function(global) {
  "use strict";
  var root = document.documentElement;
  var opened = true;
  root.classList.add("js-map-design-v1");

  global.JSMapClusterVisualV1 = {
    style: function(cluster) {
      if (!cluster || cluster.regionMode) return "";
      var count = (cluster.items || []).length;
      var level = global.map && typeof global.map.getLevel === "function" ? Number(global.map.getLevel()) : 6;
      var factor = level <= 3 ? .72 : level === 4 ? .88 : 1;
      var maximum = level <= 3 ? 66 : level === 4 ? 92 : 110;
      if (!cluster.worldGrid && typeof global.getClusterDistance === "function") maximum = Math.min(maximum, global.getClusterDistance() - 8);
      var size = Math.max(40, Math.min(maximum, Math.round((38 + 2.6 * Math.sqrt(count)) * factor)));
      var font = count >= 1000 ? 18 : count >= 100 ? 16 : 14;
      return ' style="--density-size-v1:' + size + 'px;--density-font-v1:' + font + 'px"';
    }
  };

  function phoneLayout() {
    return !!(global.JSPhoneDeviceV1 && typeof global.JSPhoneDeviceV1.isMobileLayout === "function" && global.JSPhoneDeviceV1.isMobileLayout());
  }

  function sync() {
    root.classList.toggle("js-map-list-closed-v1", !opened && !phoneLayout());
    root.dataset.mapListPanel = (phoneLayout() ? root.getAttribute("data-jsm-mobile-view") === "list" : opened) ? "open" : "closed";
    if (typeof global.syncMapQuickToolGeometryV659 === "function") global.syncMapQuickToolGeometryV659();
  }

  function syncTitle(items) {
    var title = document.getElementById("mapListTitleV1");
    if (!title) return;
    var region = global.jsAdministrativeListSelectionV6570;
    var selected = region || global.selectedGroupKey || (global.selectedGroupKeys || []).length;
    title.textContent = (region && region.regionLabel ? region.regionLabel + " 매물 " : selected ? "선택한 매물 " : "현재 지도 매물 ") +
      (items || global.visibleListItems || []).length.toLocaleString("ko-KR") + "개";
  }

  function layout(anchor) {
    if (typeof global.keepPinnedClusterSelectionAcrossTransientUiV6525 === "function") {
      global.keepPinnedClusterSelectionAcrossTransientUiV6525(1000);
    }
    var map = global.map;
    if (map && typeof map.relayout === "function") {
      var center = map.getCenter();
      map.relayout();
      map.setCenter(center);
      // Keep the selected location visible after the right panel takes space,
      // without zooming or recentering selections that are already in view.
      var viewport = document.getElementById("map");
      var projection = typeof global.getMapDisplayProjectionV1 === "function" ? global.getMapDisplayProjectionV1() : null;
      if (anchor && viewport && projection) {
        var point = projection.containerPointFromCoords(anchor);
        var x = Math.max(64, Math.min(viewport.clientWidth - 80, point.x));
        var y = Math.max(64, Math.min(viewport.clientHeight - 64, point.y));
        if (x !== point.x || y !== point.y) {
          var shifted = projection.coordsFromContainerPoint(new global.kakao.maps.Point(
            viewport.clientWidth / 2 + point.x - x, viewport.clientHeight / 2 + point.y - y));
          map.setCenter(shifted);
        }
      }
    }
    if (typeof global.keepPinnedClusterSelectionAcrossTransientUiV6525 === "function") {
      global.keepPinnedClusterSelectionAcrossTransientUiV6525(1000);
    }
    if (typeof global.syncMapQuickToolGeometryV659 === "function") global.syncMapQuickToolGeometryV659();
  }

  function open(cluster) {
    var changed = !opened;
    if (!phoneLayout()) opened = true;
    sync();
    syncTitle();
    if (phoneLayout()) {
      if (global.JSMobileAppV1) global.JSMobileAppV1.setView("list");
    } else if (changed) {
      layout(cluster && (cluster.displayLatlng || cluster.latlng));
    }
  }

  function close() {
    if (!phoneLayout()) opened = false;
    sync();
    if (phoneLayout()) {
      if (global.JSMobileAppV1) global.JSMobileAppV1.setView("map");
    } else {
      layout();
      var button = document.getElementById("mapQuickViewBtn");
      if (button) button.focus({preventScroll: true});
    }
  }

  global.JSMapListPanelV1 = {open: open, close: close, syncTitle: syncTitle, isOpen: function() {
    return phoneLayout() ? root.getAttribute("data-jsm-mobile-view") === "list" : opened;
  }};
  global.addEventListener("js-phone-device-change", sync);
  global.addEventListener("resize", sync);
  // Portrait navigation must not silently close the desktop/fitted list.
  new MutationObserver(function() {
    if (!phoneLayout()) return;
    sync();
  }).observe(root, {attributes: true, attributeFilter: ["data-jsm-mobile-view"]});
  sync();
})(window);
