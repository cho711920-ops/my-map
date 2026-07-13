/* JS부동산 v6.0 STEP3.1 - 현장형 AI임장 UI 보조 */
(function () {
  "use strict";

  function coordsOf(item) {
    if (!item || typeof window.getItemCoordinates !== "function") return null;
    var coords = window.getItemCoordinates(item);
    if (!coords) return null;
    var lat = Number(coords.lat);
    var lng = Number(coords.lng);
    return isFinite(lat) && isFinite(lng) ? { lat: lat, lng: lng } : null;
  }

  function distanceMeters(a, b) {
    if (!a || !b) return null;
    if (window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.distanceMeters === "function") {
      return window.JSAiVisitRouteV6.distanceMeters(a, b);
    }
    return null;
  }

  function formatDistance(meters) {
    if (!isFinite(meters)) return "거리 계산 중";
    if (meters < 1000) return Math.max(1, Math.round(meters)) + "m";
    return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + "km";
  }

  function estimate(item) {
    var current = window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.getLastLocation === "function"
      ? window.JSAiVisitRouteV6.getLastLocation()
      : null;
    var destination = coordsOf(item);
    var meters = distanceMeters(current, destination);
    if (!isFinite(meters)) return null;

    return {
      meters: meters,
      distanceText: formatDistance(meters),
      walkMinutes: Math.max(1, Math.ceil(meters / 75)),
      carMinutes: Math.max(1, Math.ceil(meters / 350))
    };
  }

  function progress(index, total) {
    var safeTotal = Math.max(1, Number(total) || 1);
    var safeIndex = Math.min(safeTotal, Math.max(1, Number(index) + 1));
    return Math.round((safeIndex / safeTotal) * 100);
  }

  function getItem(key) {
    if (window.JSV6ListStore && typeof window.JSV6ListStore.getItem === "function") return window.JSV6ListStore.getItem(key);
    if (!Array.isArray(window.allItems)) return null;
    return window.allItems.find(function (item) { return item && item.key === key; }) || null;
  }

  function nextItem(session) {
    if (!session || !Array.isArray(session.itemKeys)) return null;
    var statuses = session.statuses || {};
    for (var i = Number(session.currentIndex || 0) + 1; i < session.itemKeys.length; i += 1) {
      if (!statuses[session.itemKeys[i]]) return getItem(session.itemKeys[i]);
    }
    return null;
  }

  window.JSAiVisitUiV6 = {
    estimate: estimate,
    progress: progress,
    nextItem: nextItem,
    formatDistance: formatDistance
  };
})();
