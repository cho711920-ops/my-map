/* JS부동산 v6.0 STEP3 - AI임장 거리 기반 최적 동선 / 순번 지도 */
(function () {
  "use strict";

  var routeMap = null;
  var routeOverlays = [];
  var lastLocation = null;

  function getItem(key) {
    if (window.JSV6ListStore && typeof window.JSV6ListStore.getItem === "function") {
      return window.JSV6ListStore.getItem(key);
    }
    if (!Array.isArray(window.allItems)) return null;
    return window.allItems.find(function (item) { return item && item.key === key; }) || null;
  }

  function getCoords(item) {
    if (!item || typeof window.getItemCoordinates !== "function") return null;
    var coords = window.getItemCoordinates(item);
    if (!coords) return null;
    var lat = Number(coords.lat);
    var lng = Number(coords.lng);
    return isFinite(lat) && isFinite(lng) ? { lat: lat, lng: lng } : null;
  }

  function distanceMeters(a, b) {
    if (!a || !b) return Infinity;
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var lat1 = a.lat * rad;
    var lat2 = b.lat * rad;
    var sinLat = Math.sin(dLat / 2);
    var sinLng = Math.sin(dLng / 2);
    var h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function requestLocation(callback) {
    if (!navigator.geolocation) return callback(null);
    var done = false;
    function finish(value) {
      if (done) return;
      done = true;
      callback(value);
    }
    navigator.geolocation.getCurrentPosition(function (position) {
      var lat = Number(position.coords.latitude);
      var lng = Number(position.coords.longitude);
      if (!isFinite(lat) || !isFinite(lng)) return finish(null);
      lastLocation = { lat: lat, lng: lng, timestamp: Date.now() };
      finish(lastLocation);
    }, function () {
      navigator.geolocation.getCurrentPosition(function (position) {
        var lat = Number(position.coords.latitude);
        var lng = Number(position.coords.longitude);
        if (!isFinite(lat) || !isFinite(lng)) return finish(null);
        lastLocation = { lat: lat, lng: lng, timestamp: Date.now() };
        finish(lastLocation);
      }, function () { finish(null); }, {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 60000
      });
    }, {
      enableHighAccuracy: false,
      timeout: 3500,
      maximumAge: 180000
    });
  }

  function optimizeKeys(keys, startLocation) {
    var remaining = (keys || []).map(function (key) {
      var item = getItem(key);
      return { key: key, coords: getCoords(item) };
    });
    var valid = remaining.filter(function (entry) { return entry.coords; });
    var invalid = remaining.filter(function (entry) { return !entry.coords; }).map(function (entry) { return entry.key; });
    if (!startLocation || valid.length < 2) return valid.map(function (entry) { return entry.key; }).concat(invalid);

    var result = [];
    var cursor = startLocation;
    while (valid.length) {
      var nearestIndex = 0;
      var nearestDistance = Infinity;
      valid.forEach(function (entry, index) {
        var distance = distanceMeters(cursor, entry.coords);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      var next = valid.splice(nearestIndex, 1)[0];
      result.push(next.key);
      cursor = next.coords;
    }
    return result.concat(invalid);
  }

  function prepare(keys, callback) {
    requestLocation(function (location) {
      callback({
        keys: optimizeKeys(keys, location),
        location: location,
        optimized: !!location
      });
    });
  }

  function recalculate(session, callback) {
    requestLocation(function (location) {
      if (!location) return callback({ ok: false, reason: "location" });
      var statuses = session.statuses || {};
      var processed = [];
      var pending = [];
      (session.itemKeys || []).forEach(function (key) {
        if (statuses[key] === "hold" || statuses[key] === "done") processed.push(key);
        else pending.push(key);
      });
      var optimizedPending = optimizeKeys(pending, location);
      session.itemKeys = processed.concat(optimizedPending);
      session.currentIndex = processed.length < session.itemKeys.length ? processed.length : Math.max(0, session.itemKeys.length - 1);
      session.routeStartLocation = location;
      session.routeOptimized = true;
      callback({ ok: true, session: session });
    });
  }

  function clearRouteMap() {
    routeOverlays.forEach(function (overlay) {
      try { overlay.setMap(null); } catch (error) {}
    });
    routeOverlays = [];
  }

  function createMarkerContent(number, state) {
    var node = document.createElement("button");
    node.type = "button";
    node.className = "aiv-number-marker " + state;
    node.textContent = String(number);
    node.setAttribute("aria-label", number + "번 매물");
    return node;
  }

  function renderMap(session, currentIndex, onSelect) {
    var container = document.getElementById("aivRouteMap");
    if (!container || !window.kakao || !kakao.maps) return;
    var entries = (session.itemKeys || []).map(function (key, index) {
      var item = getItem(key);
      return { key: key, index: index, item: item, coords: getCoords(item) };
    }).filter(function (entry) { return entry.coords; });
    if (!entries.length) {
      container.innerHTML = '<div class="aiv-route-map-empty">지도 좌표를 준비 중입니다.</div>';
      return;
    }

    if (!routeMap) {
      routeMap = new kakao.maps.Map(container, {
        center: new kakao.maps.LatLng(entries[0].coords.lat, entries[0].coords.lng),
        level: 5
      });
    } else {
      routeMap.relayout();
    }
    clearRouteMap();
    var bounds = new kakao.maps.LatLngBounds();
    var statuses = session.statuses || {};

    entries.forEach(function (entry) {
      var state = entry.index === currentIndex ? "current" : (statuses[entry.key] === "hold" ? "hold" : (statuses[entry.key] === "done" ? "done" : "pending"));
      var position = new kakao.maps.LatLng(entry.coords.lat, entry.coords.lng);
      var content = createMarkerContent(entry.index + 1, state);
      content.addEventListener("click", function () { if (typeof onSelect === "function") onSelect(entry.index); });
      var overlay = new kakao.maps.CustomOverlay({ position: position, content: content, yAnchor: 1.15, zIndex: state === "current" ? 100 : 20 });
      overlay.setMap(routeMap);
      routeOverlays.push(overlay);
      bounds.extend(position);
    });
    if (entries.length === 1) routeMap.setCenter(new kakao.maps.LatLng(entries[0].coords.lat, entries[0].coords.lng));
    else routeMap.setBounds(bounds, 45, 45, 45, 45);
  }

  function nextPendingIndex(session, fromIndex) {
    var keys = session.itemKeys || [];
    var statuses = session.statuses || {};
    for (var index = Math.max(0, Number(fromIndex) + 1); index < keys.length; index += 1) {
      if (!statuses[keys[index]]) return index;
    }
    for (var rewind = 0; rewind <= Number(fromIndex); rewind += 1) {
      if (!statuses[keys[rewind]]) return rewind;
    }
    return -1;
  }

  window.JSAiVisitRouteV6 = {
    prepare: prepare,
    recalculate: recalculate,
    renderMap: renderMap,
    clear: clearRouteMap,
    nextPendingIndex: nextPendingIndex,
    distanceMeters: distanceMeters,
    getLastLocation: function () { return lastLocation; }
  };
})();
