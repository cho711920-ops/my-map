/* JS부동산 v6.0 STEP3 - AI임장 거리 기반 최적 동선 / 순번 지도 */
(function () {
  "use strict";

  var routeMap = null;
  var routeOverlays = [];
  var lastLocation = null;
  var lastEntries = [];
  var lastRouteSignature = "";

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

    var finished = false;
    var watchId = null;
    var hardStopTimer = null;

    function cleanUp() {
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId); } catch (error) {}
        watchId = null;
      }
      if (hardStopTimer) {
        window.clearTimeout(hardStopTimer);
        hardStopTimer = null;
      }
    }

    function finish(value) {
      if (finished) return;
      finished = true;
      cleanUp();
      callback(value);
    }

    function accept(position) {
      if (!position || !position.coords) return false;
      var lat = Number(position.coords.latitude);
      var lng = Number(position.coords.longitude);
      if (!isFinite(lat) || !isFinite(lng)) return false;
      lastLocation = {
        lat: lat,
        lng: lng,
        accuracy: Number(position.coords.accuracy) || 0,
        timestamp: Number(position.timestamp) || Date.now()
      };
      finish(lastLocation);
      return true;
    }

    function stageThreeWatch() {
      if (finished) return;
      try {
        watchId = navigator.geolocation.watchPosition(
          function (position) { accept(position); },
          function () {},
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
      } catch (error) {}
      hardStopTimer = window.setTimeout(function () { finish(null); }, 12500);
    }

    function stageTwoHighAccuracy() {
      if (finished) return;
      navigator.geolocation.getCurrentPosition(
        function (position) { accept(position); },
        stageThreeWatch,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    }

    /* 태블릿은 Wi-Fi 위치가 먼저 잡히는 경우가 많아 저정밀 → 고정밀 → watch 순서로 시도합니다. */
    navigator.geolocation.getCurrentPosition(
      function (position) { accept(position); },
      stageTwoHighAccuracy,
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 }
    );
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

    var routeSignature = (session.itemKeys || []).join("|");
    var shouldFitAll = !routeMap || routeSignature !== lastRouteSignature;
    if (!routeMap) {
      routeMap = new kakao.maps.Map(container, {
        center: new kakao.maps.LatLng(entries[0].coords.lat, entries[0].coords.lng),
        level: 5
      });
    } else {
      routeMap.relayout();
    }
    clearRouteMap();
    lastEntries = entries.slice();
    lastRouteSignature = routeSignature;
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
    if (shouldFitAll) {
      if (entries.length === 1) {
        routeMap.setCenter(new kakao.maps.LatLng(entries[0].coords.lat, entries[0].coords.lng));
        routeMap.setLevel(4);
      } else {
        routeMap.setBounds(bounds, 50, 50, 50, 50);
      }
    }
  }

  function fitAll(session) {
    if (!routeMap || !window.kakao || !kakao.maps) return;
    var entries = (session && session.itemKeys ? session.itemKeys : []).map(function (key, index) {
      var item = getItem(key);
      return { key: key, index: index, coords: getCoords(item) };
    }).filter(function (entry) { return entry.coords; });
    if (!entries.length) entries = lastEntries.slice();
    if (!entries.length) return;
    routeMap.relayout();
    if (entries.length === 1) {
      routeMap.setCenter(new kakao.maps.LatLng(entries[0].coords.lat, entries[0].coords.lng));
      routeMap.setLevel(4);
      return;
    }
    var bounds = new kakao.maps.LatLngBounds();
    entries.forEach(function (entry) { bounds.extend(new kakao.maps.LatLng(entry.coords.lat, entry.coords.lng)); });
    routeMap.setBounds(bounds, 50, 50, 50, 50);
  }

  function focusIndex(session, index) {
    if (!routeMap || !session || !Array.isArray(session.itemKeys)) return;
    var key = session.itemKeys[Number(index) || 0];
    var item = getItem(key);
    var coords = getCoords(item);
    if (!coords) return;
    routeMap.relayout();
    routeMap.panTo(new kakao.maps.LatLng(coords.lat, coords.lng));
    routeMap.setLevel(3);
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
    fitAll: fitAll,
    focusIndex: focusIndex,
    clear: clearRouteMap,
    nextPendingIndex: nextPendingIndex,
    distanceMeters: distanceMeters,
    getLastLocation: function () { return lastLocation; }
  };
})();
