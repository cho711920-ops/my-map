/* Optional live-location following. Reuses map.js's single GPS watcher. */
(function () {
  "use strict";

  var enabled = false;
  var scale = 50;
  var status = "내 위치 따라가기";
  var controlsOpen = false;
  var controlsTimer = null;
  var lastPosition = window.jsLastCurrentLocationPositionV1 || null;
  var acceptedPosition = null;
  var pendingPosition = null;
  var pendingTimer = null;
  var cameraTimer = null;
  var expiryTimer = null;
  var lastUsableStamp = 0;
  var lastMoveAt = 0;
  var freshAfter = 0;
  var pageHidden = false;
  var movingCamera = false;
  var boundMap = null;
  var previousInteraction = null;
  var markerContent = null;
  var heading = null;
  var headingSource = "";
  var headingRotation = 0;
  var headingHasTurn = false;
  var headingAnchor = null;
  var lastHeadingStamp = 0;
  var headingCandidate = null;
  var directionStopped = false;
  var MOVE_INTERVAL_MS = 1000;
  var MAX_FIX_AGE_MS = 30000;
  var MAX_HEADING_ACCURACY = 35;
  var MIN_HEADING_SPEED = 0.8;
  var MAX_HEADING_SPEED = 60;
  var MAX_HEADING_GAP_MS = 20000;
  var HEADING_DEADBAND_DEGREES = 5;
  var HEADING_TURN_CONFIRM_DEGREES = 60;
  var HEADING_CONFIRM_GAP_MS = 8000;
  // Kakao ROADMAP scale labels: level 1 = 20m, level 3 = 50m.
  // https://devtalk.kakao.com/t/topic/35624
  var levels = { 20: 1, 50: 3 };
  // Retain the existing marker/rotation hooks; only the artwork changes.
  var markerSvg = '<svg class="js-field-mode-car-icon-v1 js-field-mode-navigation-icon-v1" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path data-field-navigation-pointer d="m12 2 7 19-7-4-7 4Z" fill="#dc2626" stroke="white" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<circle data-field-navigation-pending cx="12" cy="12" r="4" fill="#dc2626" stroke="white" stroke-width="1.5"/></svg>' +
    '<span class="js-field-mode-heading-pending-v1" aria-hidden="true">방향 확인 중</span>';

  function isVisible() {
    return !pageHidden && !document.hidden && document.visibilityState !== "hidden";
  }

  function mapReady() {
    return window.map && window.kakao && window.kakao.maps &&
      typeof window.map.setCenter === "function" && typeof window.map.setLevel === "function";
  }

  function validCoordinates(position) {
    if (!position || !position.coords) return false;
    var lat = position.coords.latitude;
    var lng = position.coords.longitude;
    return typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;
  }

  function usableFix(position) {
    if (!validCoordinates(position)) return false;
    var stamp = Number(position.timestamp);
    var accuracy = position.coords.accuracy;
    return Number.isFinite(stamp) && stamp >= freshAfter &&
      stamp <= Date.now() + 1000 && Date.now() - stamp <= MAX_FIX_AGE_MS &&
      typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100;
  }

  function syncControls() {
    document.querySelectorAll("[data-field-mode-toggle]").forEach(function (button) {
      button.classList.toggle("on", enabled);
      button.setAttribute("aria-pressed", String(enabled));
      button.title = "임장모드 " + (enabled ? "ON · " : "OFF · ") + status;
    });
    document.querySelectorAll("[data-field-mode-indicator]").forEach(function (element) {
      element.textContent = enabled ? "ON" : "OFF";
    });
    document.querySelectorAll("[data-field-mode-controls]").forEach(function (element) {
      element.hidden = !enabled || !controlsOpen;
    });
    document.querySelectorAll("[data-field-mode-expand]").forEach(function (button) {
      button.hidden = !enabled;
      button.textContent = scale + "m ▾";
      button.setAttribute("aria-expanded", String(enabled && controlsOpen));
      button.setAttribute("aria-label", "지도 축척 " + scale + "m · 축척 선택 " + (controlsOpen ? "접기" : "열기"));
      button.title = status + " · 축척 선택";
    });
    document.querySelectorAll("[data-field-mode-scale]").forEach(function (button) {
      var active = Number(button.getAttribute("data-field-mode-scale")) === scale;
      button.classList.toggle("on", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-field-mode-status]").forEach(function (element) {
      if (element.textContent !== status) element.textContent = status;
    });
    document.querySelectorAll("[data-field-mode-direction]").forEach(function (element) {
      var cameraActive = window.JSFieldMapCameraV1 && window.JSFieldMapCameraV1.state().active;
      element.textContent = !enabled ? ""
        : heading !== null && !cameraActive ? "북쪽 고정 · 지도 회전 사용 불가"
          : heading !== null ? (directionStopped ? "정차 중 · 마지막 진행 방향 유지" : "이동 방향 기준 · 정차 시 방향 고정")
            : "방향 확인 중 · 조금 이동하면 맞춰집니다";
    });
  }

  function focusedControls() {
    var focused = null;
    document.querySelectorAll("[data-field-mode-controls]").forEach(function (element) {
      if (element.contains(document.activeElement)) focused = element;
    });
    return focused;
  }

  function cancelControlsTimer() {
    if (controlsTimer !== null) window.clearTimeout(controlsTimer);
    controlsTimer = null;
  }

  function closeScaleControls(restoreFocus) {
    cancelControlsTimer();
    if (!controlsOpen) return;
    var focused = restoreFocus ? focusedControls() : null;
    controlsOpen = false;
    syncControls();
    if (focused) {
      document.querySelectorAll("[data-field-mode-expand]").forEach(function (button) {
        if (!button.hidden && button.getAttribute("aria-controls") === focused.id) button.focus({ preventScroll: true });
      });
    }
  }

  function scheduleControlsClose() {
    cancelControlsTimer();
    if (!enabled || !controlsOpen || !isVisible()) return;
    controlsTimer = window.setTimeout(function () {
      controlsTimer = null;
      // Never hide a keyboard user's focused choice. Focusout starts a new
      // bounded timer; GPS/status updates do not reopen or prolong this panel.
      if (focusedControls()) return;
      closeScaleControls(false);
    }, 3000);
  }

  function toggleScaleControls() {
    if (!enabled) return false;
    if (controlsOpen) closeScaleControls(true);
    else {
      controlsOpen = true;
      syncControls();
      scheduleControlsClose();
    }
    return controlsOpen;
  }

  function setStatus(message) {
    if (status === message) return;
    status = message;
    syncControls();
  }

  function notify(message) {
    if (typeof window.showQuickAddToastV636 === "function") window.showQuickAddToastV636(message, "info");
    else if (typeof window.showToast === "function") window.showToast(message);
    else if (typeof window.alert === "function") window.alert(message);
  }

  function cancelPending() {
    if (pendingTimer !== null) window.clearTimeout(pendingTimer);
    if (cameraTimer !== null) window.clearTimeout(cameraTimer);
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    pendingPosition = null;
    pendingTimer = null;
    cameraTimer = null;
    expiryTimer = null;
  }

  function hideMarker() {
    if (window.jsCurrentLocationOverlayV630) window.jsCurrentLocationOverlayV630.setMap(null);
  }

  function decorateMarker(content) {
    if (!content) return;
    markerContent = content;
    var wasCar = content.classList.contains("js-field-mode-car-v1");
    content.classList.toggle("js-field-mode-car-v1", enabled);
    if (wasCar !== enabled) content.innerHTML = enabled ? markerSvg : "";
    syncHeadingMarker();
  }

  function syncHeadingMarker() {
    if (window.JSFieldMapCameraV1) {
      if (enabled && heading !== null) window.JSFieldMapCameraV1.setBearing(heading, { animate: headingHasTurn });
      else window.JSFieldMapCameraV1.reset();
    }
    if (!markerContent) return;
    var known = enabled && heading !== null;
    markerContent.classList.toggle("js-field-mode-heading-known-v1", known);
    markerContent.classList.toggle("js-field-mode-heading-turn-v1", known && headingHasTurn);
    if (enabled) markerContent.style.setProperty("--js-field-mode-heading", headingRotation + "deg");
    else markerContent.style.removeProperty("--js-field-mode-heading");
    var label = enabled ? "내 위치 · 임장모드 · " + (known ? "마지막 확인 이동 방향 " + Math.round(heading) + "도" : "방향 확인 중") : "현재 위치";
    markerContent.setAttribute("title", label);
    markerContent.setAttribute("aria-label", label);
  }

  function resetHeading() {
    heading = null;
    headingSource = "";
    headingRotation = 0;
    headingHasTurn = false;
    headingAnchor = null;
    lastHeadingStamp = 0;
    headingCandidate = null;
    directionStopped = false;
    syncHeadingMarker();
  }

  function headingDelta(value, previous) {
    return (value - previous + 540) % 360 - 180;
  }

  function setHeading(value, source, stamp) {
    if (heading === null) {
      headingRotation = value;
    } else {
      // Unwrap north-crossing turns: 359 -> 1 becomes 359 -> 361, not a full spin.
      var delta = headingDelta(value, heading);
      if (Math.abs(delta) < HEADING_DEADBAND_DEGREES) {
        headingCandidate = null;
        headingSource = source;
        return;
      }
      // A single noisy fix must not spin the map. A genuine sharp turn/U-turn
      // is accepted on the next consistent, separate GPS fix, never a timer.
      if (Math.abs(delta) >= HEADING_TURN_CONFIRM_DEGREES) {
        // Coordinate-derived courses arrive only after clearing both fixes'
        // accuracy radius. Walking can take longer than the native-course
        // window; allow the next complete, independently valid movement leg.
        var confirmationGap = source === "movement" && headingCandidate && headingCandidate.source === "movement"
          ? MAX_HEADING_GAP_MS : HEADING_CONFIRM_GAP_MS;
        if (!headingCandidate || stamp - headingCandidate.stamp > confirmationGap ||
          Math.abs(headingDelta(value, headingCandidate.value)) > 20) {
          headingCandidate = { value: value, stamp: stamp, source: source };
          return;
        }
        if (stamp - headingCandidate.stamp < 250) return;
      }
      headingRotation += delta;
      headingHasTurn = true;
    }
    headingCandidate = null;
    heading = value;
    headingSource = source;
    syncHeadingMarker();
    syncControls();
  }

  function setDirectionStopped(value) {
    if (directionStopped === value) return;
    directionStopped = value;
    syncControls();
  }

  function bearingDegrees(from, to) {
    var radians = Math.PI / 180;
    var lat1 = from.coords.latitude * radians;
    var lat2 = to.coords.latitude * radians;
    var lng = (to.coords.longitude - from.coords.longitude) * radians;
    var y = Math.sin(lng) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng);
    return (Math.atan2(y, x) / radians + 360) % 360;
  }

  function updateHeading(position) {
    var stamp = Number(position.timestamp);
    // A raw fix may be replayed by the throttled marker renderer. Never use it twice.
    if (stamp <= lastHeadingStamp) return;
    lastHeadingStamp = stamp;
    if (position.coords.accuracy > MAX_HEADING_ACCURACY) {
      headingAnchor = null;
      headingCandidate = null;
      return;
    }
    var speed = position.coords.speed;
    var hasSpeed = typeof speed === "number" && Number.isFinite(speed) && speed >= 0;
    if (hasSpeed && speed > MAX_HEADING_SPEED) {
      headingAnchor = null;
      headingCandidate = null;
      return;
    }
    if (hasSpeed && speed < MIN_HEADING_SPEED) {
      // Keep the last course while stopped; do not accumulate stationary GPS drift.
      headingAnchor = position;
      headingCandidate = null;
      setDirectionStopped(true);
      return;
    }
    setDirectionStopped(false);
    var course = position.coords.heading;
    // Heading is travel direction clockwise from true north, not device orientation.
    // https://www.w3.org/TR/geolocation/#heading-attribute
    if (hasSpeed && typeof course === "number" && Number.isFinite(course) && course >= 0 && course < 360) {
      headingAnchor = position;
      setHeading(course, "gps", stamp);
      return;
    }
    var previous = headingAnchor;
    if (!previous || stamp - Number(previous.timestamp) > MAX_HEADING_GAP_MS) {
      headingAnchor = position;
      headingCandidate = null;
      return;
    }
    var elapsed = (stamp - Number(previous.timestamp)) / 1000;
    var distance = distanceMeters(previous, position);
    if (distance / elapsed > MAX_HEADING_SPEED) {
      headingAnchor = position;
      headingCandidate = null;
      return;
    }
    // Both endpoints' uncertainty must be cleared before inferring travel from fixes.
    if (distance >= Math.max(8, previous.coords.accuracy + position.coords.accuracy)) {
      setHeading(bearingDegrees(previous, position), "movement", stamp);
      headingAnchor = position;
    }
  }

  function expireFix() {
    cancelPending();
    resetHeading();
    acceptedPosition = null;
    lastUsableStamp = 0;
    if (enabled) {
      hideMarker();
      setStatus("새 위치 확인 중");
    }
  }

  function refreshFixExpiry(position) {
    lastUsableStamp = Math.max(lastUsableStamp, Number(position.timestamp));
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    expiryTimer = window.setTimeout(expireFix, Math.max(1, MAX_FIX_AGE_MS - (Date.now() - lastUsableStamp)));
  }

  function samePoint(left, right) {
    return left && right && Math.abs(left.getLat() - right.getLat()) < 0.00000001 &&
      Math.abs(left.getLng() - right.getLng()) < 0.00000001;
  }

  function centerOn(position) {
    if (!enabled || !isVisible() || !mapReady() || !position) return;
    if (Date.now() - lastUsableStamp >= MAX_FIX_AGE_MS) {
      expireFix();
      return;
    }
    var map = window.map;
    var point = new window.kakao.maps.LatLng(position.coords.latitude, position.coords.longitude);
    movingCamera = true;
    try {
      // Camera movement is not a manual search/cluster-selection reset.
      if (typeof window.preservePinnedClusterSelectionDuringRelayoutV6517 === "function") {
        window.preservePinnedClusterSelectionDuringRelayoutV6517(1800);
      }
      if (map.getLevel() !== levels[scale]) map.setLevel(levels[scale], { animate: false, anchor: point });
      if (!samePoint(map.getCenter(), point)) map.setCenter(point);
    } finally {
      movingCamera = false;
    }
  }

  function enforceCamera() {
    if (!enabled || movingCamera || !acceptedPosition || !isVisible() || cameraTimer !== null) return;
    cameraTimer = window.setTimeout(function () {
      cameraTimer = null;
      centerOn(acceptedPosition);
    }, 0);
  }

  function bindMap() {
    if (boundMap === window.map) return;
    boundMap = window.map;
    var events = window.kakao.maps.event;
    if (!events || typeof events.addListener !== "function") return;
    events.addListener(boundMap, "center_changed", enforceCamera);
    events.addListener(boundMap, "zoom_changed", enforceCamera);
  }

  function distanceMeters(a, b) {
    var radians = Math.PI / 180;
    var lat = (a.coords.latitude - b.coords.latitude) * radians;
    var lng = (a.coords.longitude - b.coords.longitude) * radians;
    var x = lng * Math.cos((a.coords.latitude + b.coords.latitude) * radians / 2);
    return 6371000 * Math.sqrt(x * x + lat * lat);
  }

  function renderPosition(position) {
    if (typeof window.updateCurrentLocationOverlayV630 === "function") {
      // A trailing/cached display update must not overwrite a newer raw fix
      // already held by navigation (or write the same location cache twice).
      window.updateCurrentLocationOverlayV630(position, true);
    }
  }

  function onPosition(position) {
    if (!validCoordinates(position)) {
      if (!position || Number(position.timestamp) >= lastHeadingStamp) {
        headingAnchor = null;
        headingCandidate = null;
      }
      return null;
    }
    if (!lastPosition || Number(position.timestamp) >= Number(lastPosition.timestamp)) lastPosition = position;
    if (!enabled) return position;
    if (!isVisible()) return null;
    if (!usableFix(position)) {
      if (Number(position.timestamp) >= lastHeadingStamp) {
        headingAnchor = null;
        headingCandidate = null;
      }
      setStatus(position.coords.accuracy > 100 ? "위치 정확도 낮음 · 확인 중" : "새 위치 확인 중");
      return null;
    }
    if (acceptedPosition && Number(position.timestamp) < Number(acceptedPosition.timestamp)) return null;
    refreshFixExpiry(position);
    updateHeading(position);
    if (acceptedPosition && distanceMeters(position, acceptedPosition) < 3) {
      // The newest fix can supersede a queued GPS jump back to the same spot.
      if (pendingPosition && Number(position.timestamp) >= Number(pendingPosition.timestamp)) {
        if (pendingTimer !== null) window.clearTimeout(pendingTimer);
        pendingTimer = null;
        pendingPosition = null;
      }
      setStatus("내 위치 따라가는 중");
      return null;
    }
    var remaining = MOVE_INTERVAL_MS - (Date.now() - lastMoveAt);
    if (acceptedPosition && remaining > 0) {
      if (!pendingPosition || Number(position.timestamp) >= Number(pendingPosition.timestamp)) pendingPosition = position;
      if (pendingTimer === null) {
        pendingTimer = window.setTimeout(function () {
          pendingTimer = null;
          var next = pendingPosition;
          pendingPosition = null;
          if (enabled && isVisible() && next) renderPosition(next);
        }, remaining);
      }
      return null;
    }
    if (pendingTimer !== null) window.clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingPosition = null;
    acceptedPosition = position;
    lastMoveAt = Date.now();
    centerOn(position);
    setStatus("내 위치 따라가는 중");
    return position;
  }

  function setEnabled(value) {
    var next = !!value;
    if (next === enabled) return enabled;
    if (next && (!mapReady() || !navigator.geolocation)) {
      setStatus(!mapReady() ? "지도를 준비 중입니다" : "위치정보를 사용할 수 없습니다");
      notify(status);
      return false;
    }
    cancelPending();
    acceptedPosition = null;
    lastUsableStamp = 0;
    enabled = next;
    resetHeading();
    controlsOpen = next;
    cancelControlsTimer();
    if (enabled) {
      bindMap();
      if (typeof window.closeMapQuickPopoversV657 === "function") window.closeMapQuickPopoversV657();
      if (typeof window.finishMapToolForFieldModeV1 === "function") window.finishMapToolForFieldModeV1();
      if (typeof window.setMapRoadviewSelection === "function") window.setMapRoadviewSelection(false);
      previousInteraction = {
        draggable: typeof window.map.getDraggable === "function" ? window.map.getDraggable() : true,
        zoomable: typeof window.map.getZoomable === "function" ? window.map.getZoomable() : true
      };
      if (typeof window.map.setDraggable === "function") window.map.setDraggable(false);
      if (typeof window.map.setZoomable === "function") window.map.setZoomable(false);
      freshAfter = Date.now() - 8000;
      lastMoveAt = 0;
      status = "위치 확인 중";
      hideMarker();
      if (typeof window.startCurrentLocationTrackingV630 === "function") window.startCurrentLocationTrackingV630();
    } else {
      if (previousInteraction && window.map) {
        if (typeof window.map.setDraggable === "function") window.map.setDraggable(previousInteraction.draggable);
        if (typeof window.map.setZoomable === "function") window.map.setZoomable(previousInteraction.zoomable);
      }
      previousInteraction = null;
      status = "내 위치 따라가기";
    }
    decorateMarker(markerContent);
    syncControls();
    scheduleControlsClose();
    if (lastPosition && isVisible() && Date.now() - Number(lastPosition.timestamp) <= 8000) {
      renderPosition(lastPosition);
    }
    return enabled;
  }

  function setScale(value) {
    if (value !== 20 && value !== 50) return false;
    scale = value;
    closeScaleControls(true);
    syncControls();
    centerOn(acceptedPosition);
    return true;
  }

  function onError(error) {
    if (!enabled) return;
    cancelPending();
    lastUsableStamp = 0;
    resetHeading();
    acceptedPosition = null;
    hideMarker();
    if (error && error.code === 1) {
      setEnabled(false);
      hideMarker();
      setStatus("위치 권한을 허용한 뒤 다시 켜주세요");
      notify(status);
    } else {
      freshAfter = Date.now();
      setStatus("위치 수신 대기 · GPS를 확인해 주세요");
    }
  }

  function suspend() {
    closeScaleControls(false);
    cancelPending();
    lastUsableStamp = 0;
    resetHeading();
    acceptedPosition = null;
    freshAfter = Date.now();
    if (enabled) {
      hideMarker();
      setStatus("새 위치 확인 중");
    }
  }

  document.addEventListener("visibilitychange", suspend);
  document.addEventListener("pointerdown", function (event) {
    if (!controlsOpen || !event.target || typeof event.target.closest !== "function") return;
    if (!event.target.closest(".map-field-mode-wrap-v1, .map-field-mode-compact-v1")) closeScaleControls(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && controlsOpen) {
      closeScaleControls(true);
      event.preventDefault();
    }
  });
  document.addEventListener("focusin", function (event) {
    if (controlsOpen && event.target && typeof event.target.closest === "function" &&
      event.target.closest("[data-field-mode-controls]")) cancelControlsTimer();
  });
  document.addEventListener("focusout", function (event) {
    if (controlsOpen && event.target && typeof event.target.closest === "function" &&
      event.target.closest("[data-field-mode-controls]")) scheduleControlsClose();
  });
  window.addEventListener("pagehide", function () { pageHidden = true; suspend(); });
  window.addEventListener("pageshow", function () { pageHidden = false; suspend(); });
  window.JSFieldModeV1 = {
    toggle: function () { return setEnabled(!enabled); },
    setEnabled: setEnabled,
    setScale: setScale,
    toggleScaleControls: toggleScaleControls,
    state: function () { return { enabled: enabled, scale: scale, status: status, controlsOpen: controlsOpen, heading: heading, headingSource: headingSource }; },
    isFollowing: function () { return enabled; },
    onPosition: onPosition,
    onError: onError,
    decorateMarker: decorateMarker,
    stopForMapTool: function () {
      if (enabled) {
        setEnabled(false);
        notify("지도 도구 사용을 위해 임장모드를 껐습니다.");
      }
    }
  };
  // The optional module loads after the essential map. Adopt its existing dot
  // rather than adding a second watcher or second location overlay.
  if (window.jsCurrentLocationOverlayV630 && typeof window.jsCurrentLocationOverlayV630.getContent === "function") {
    decorateMarker(window.jsCurrentLocationOverlayV630.getContent());
  }
  syncControls();
})();
