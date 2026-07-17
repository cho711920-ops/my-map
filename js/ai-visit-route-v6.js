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
    var CACHE_KEY = "js_ai_visit_location_v6";
    if (!navigator.geolocation) {
      callback(null, { code: "UNSUPPORTED", message: "이 기기는 위치 기능을 지원하지 않습니다." });
      return;
    }

    var finished = false;
    var watchIds = [];
    var timers = [];
    var errors = [];
    var bestLocation = null;

    function clearAll() {
      watchIds.forEach(function (id) {
        try { navigator.geolocation.clearWatch(id); } catch (error) {}
      });
      watchIds = [];
      timers.forEach(function (id) { window.clearTimeout(id); });
      timers = [];
    }

    function saveLocation(location) {
      lastLocation = location;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(location)); } catch (error) {}
    }

    function finish(value, errorInfo) {
      if (finished) return;
      finished = true;
      clearAll();
      callback(value, errorInfo || null);
    }

    function normalize(position, source) {
      if (!position || !position.coords) return null;
      var lat = Number(position.coords.latitude);
      var lng = Number(position.coords.longitude);
      if (!isFinite(lat) || !isFinite(lng)) return null;
      return {
        lat: lat,
        lng: lng,
        accuracy: Number(position.coords.accuracy) || 0,
        timestamp: Number(position.timestamp) || Date.now(),
        source: source || "device"
      };
    }

    function accept(position, source) {
      var location = normalize(position, source);
      if (!location) return false;
      var age = Math.max(0, Date.now() - Number(location.timestamp || 0));
      if (age > 5 * 60 * 1000) return false;
      if (!bestLocation || (!location.accuracy && bestLocation.accuracy) ||
          (location.accuracy && location.accuracy < bestLocation.accuracy)) {
        bestLocation = location;
      }
      if (location.accuracy > 0 && location.accuracy <= 60) {
        saveLocation(location);
        finish(location, null);
      }
      return true;
    }

    function recordError(stage, error) {
      errors.push({
        stage: stage,
        code: error && typeof error.code !== "undefined" ? error.code : 0,
        message: error && error.message ? String(error.message) : "위치 정보를 가져오지 못했습니다."
      });
    }

    /* 태블릿 Edge는 getCurrentPosition보다 watchPosition에서 먼저 위치가 들어오는 경우가 있어
       저정밀 watch를 즉시 시작하고, 저정밀/고정밀 단발 요청도 병렬로 실행합니다. */
    try {
      var lowWatch = navigator.geolocation.watchPosition(
        function (position) { accept(position, "watch-low"); },
        function (error) { recordError("watch-low", error); },
        { enableHighAccuracy: false, maximumAge: 300000, timeout: 15000 }
      );
      watchIds.push(lowWatch);
    } catch (error) { recordError("watch-low", error); }

    try {
      navigator.geolocation.getCurrentPosition(
        function (position) { accept(position, "current-low"); },
        function (error) { recordError("current-low", error); },
        { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
      );
    } catch (error) { recordError("current-low", error); }

    timers.push(window.setTimeout(function () {
      if (finished) return;
      try {
        navigator.geolocation.getCurrentPosition(
          function (position) { accept(position, "current-high"); },
          function (error) { recordError("current-high", error); },
          { enableHighAccuracy: true, timeout: 16000, maximumAge: 0 }
        );
      } catch (error) { recordError("current-high", error); }

      try {
        var highWatch = navigator.geolocation.watchPosition(
          function (position) { accept(position, "watch-high"); },
          function (error) { recordError("watch-high", error); },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 18000 }
        );
        watchIds.push(highWatch);
      } catch (error) { recordError("watch-high", error); }
    }, 1200));

    /* 빠른 저정밀 응답을 곧바로 확정하지 않고 잠시 더 정확한 GPS를 기다립니다. */
    timers.push(window.setTimeout(function () {
      if (finished || !bestLocation) return;
      saveLocation(bestLocation);
      finish(bestLocation, bestLocation.accuracy > 150
        ? { code: "LOW_ACCURACY", message: "위치 정확도가 낮아 근사 위치를 사용했습니다." }
        : null);
    }, 4200));

    /* 기기 위치가 늦게 도착할 때를 고려해 최대 25초 기다립니다.
       그래도 실패하면 30분 이내 저장 위치를 마지막 안전장치로 사용합니다. */
    timers.push(window.setTimeout(function () {
      if (finished) return;
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (error) {}
      if (cached && isFinite(Number(cached.lat)) && isFinite(Number(cached.lng)) &&
          Date.now() - Number(cached.timestamp || 0) <= 30 * 60 * 1000) {
        cached = {
          lat: Number(cached.lat),
          lng: Number(cached.lng),
          accuracy: Number(cached.accuracy) || 0,
          timestamp: Number(cached.timestamp) || Date.now(),
          source: "cache"
        };
        saveLocation(cached);
        finish(cached, { code: "CACHE", message: "최근 위치를 사용했습니다." });
        return;
      }
      var lastError = errors.length ? errors[errors.length - 1] : null;
      finish(null, lastError || { code: "TIMEOUT", message: "위치 응답 시간이 초과되었습니다." });
    }, 25000));
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
    /* 최근접 순서에 2-opt를 적용해 불필요하게 교차하는 동선을 줄입니다. */
    var improved = true;
    var passes = 0;
    while (improved && passes < 8 && result.length > 3) {
      improved = false;
      passes += 1;
      for (var i = 0; i < result.length - 2; i += 1) {
        for (var j = i + 1; j < result.length - 1; j += 1) {
          var beforeKey = i === 0 ? null : result[i - 1];
          var a = beforeKey ? getCoords(getItem(beforeKey)) : startLocation;
          var b = getCoords(getItem(result[i]));
          var c = getCoords(getItem(result[j]));
          var d = getCoords(getItem(result[j + 1]));
          if (distanceMeters(a, b) + distanceMeters(c, d) >
              distanceMeters(a, c) + distanceMeters(b, d) + 1) {
            result.splice.apply(result, [i, j - i + 1].concat(result.slice(i, j + 1).reverse()));
            improved = true;
          }
        }
      }
    }
    return result.concat(invalid);
  }

  function prepare(keys, callback) {
    requestLocation(function (location, locationError) {
      callback({
        keys: optimizeKeys(keys, location),
        location: location,
        optimized: !!location,
        locationError: locationError || null
      });
    });
  }

  function recalculate(session, callback) {
    requestLocation(function (location, locationError) {
      if (!location) return callback({ ok: false, reason: "location", locationError: locationError || null });
      var statuses = session.statuses || {};
      var done = [];
      var pending = [];
      var held = [];
      (session.itemKeys || []).forEach(function (key) {
        if (statuses[key] === "hold") held.push(key);
        else if (statuses[key] === "done") done.push(key);
        else pending.push(key);
      });
      var optimizedPending = optimizeKeys(pending, location);
      session.itemKeys = done.concat(optimizedPending, held);
      session.currentIndex = done.length < done.length + optimizedPending.length
        ? done.length
        : Math.max(0, session.itemKeys.length - 1);
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
