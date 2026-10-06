/* Optional compass input for field mode. No location watcher, storage or network. */
(function () {
  "use strict";

  var running = false;
  var listening = false;
  var permissionGranted = false;
  var permissionDenied = false;
  var pageHidden = false;
  var generation = 0;
  var status = "off";
  var onHeading = null;
  var onStatus = null;
  var reading = null;
  var pendingReading = null;
  var lastEmitted = null;
  var lastEmitAt = 0;
  var jumpCandidate = null;
  var lastEventStamp = 0;
  var freshAfter = 0;
  var expiryTimer = null;
  var emitTimer = null;
  var screenTarget = null;
  var MAX_AGE_MS = 5000;
  var EMIT_INTERVAL_MS = 250;
  var DEG = Math.PI / 180;

  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function normalize(value) { return (value % 360 + 360) % 360; }
  function delta(a, b) { return (a - b + 540) % 360 - 180; }

  // W3C's intrinsic Z-X'-Y'' rotation maps device axes into east/north/up.
  // Project the CURRENT SCREEN'S top edge, not alpha alone. ScreenOrientation
  // angles are counter-clockwise from natural orientation, so screen-up in
  // device coordinates is (sin(angle), cos(angle), 0).
  // https://www.w3.org/TR/orientation-event/#worked-example
  // https://www.w3.org/TR/screen-orientation/#dfn-current-orientation-angle
  function headingFromAngles(alpha, beta, gamma, screenAngle) {
    if (!finite(alpha) || alpha < 0 || alpha >= 360 || !finite(beta) || beta < -180 || beta > 180 ||
        !finite(gamma) || gamma < -90 || gamma > 90 || !finite(screenAngle)) return null;
    var a = alpha * DEG;
    var b = beta * DEG;
    var g = gamma * DEG;
    var s = normalize(screenAngle) * DEG;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    var cg = Math.cos(g), sg = Math.sin(g), sx = Math.sin(s), sy = Math.cos(s);
    // A screen held almost vertically has no stable horizontal top direction;
    // a face-down screen must not silently reverse the displayed bearing.
    if (cb * cg < 0.15) return null;
    var east = (ca * cg - sa * sb * sg) * sx - sa * cb * sy;
    var north = (sa * cg + ca * sb * sg) * sx + ca * cb * sy;
    if (Math.hypot(east, north) < 0.25) return null;
    return normalize(Math.atan2(east, north) / DEG);
  }

  function currentScreenAngle() {
    var angle = window.screen && window.screen.orientation && window.screen.orientation.angle;
    if (!finite(angle)) angle = window.orientation;
    return finite(angle) ? normalize(angle) : 0;
  }

  function visible() {
    return !pageHidden && !document.hidden && document.visibilityState !== "hidden";
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    if (typeof onStatus === "function") {
      try { onStatus(next); } catch (_) { /* Optional UI must not break sensor cleanup. */ }
    }
  }

  function clearTimers() {
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    if (emitTimer !== null) window.clearTimeout(emitTimer);
    expiryTimer = emitTimer = null;
    pendingReading = null;
  }

  function resetReading() {
    clearTimers();
    reading = lastEmitted = jumpCandidate = null;
    lastEmitAt = 0;
    lastEventStamp = 0;
  }

  function scheduleExpiry() {
    if (expiryTimer !== null || !running || !listening) return;
    expiryTimer = window.setTimeout(function checkExpiry() {
      expiryTimer = null;
      if (!running || !listening || !visible()) return;
      var age = reading ? Date.now() - reading.timestamp : MAX_AGE_MS;
      if (age >= MAX_AGE_MS) {
        reading = pendingReading = jumpCandidate = null;
        if (emitTimer !== null) window.clearTimeout(emitTimer);
        emitTimer = null;
        setStatus(lastEmitted ? "stale" : "unavailable");
        lastEmitted = null;
      } else {
        expiryTimer = window.setTimeout(checkExpiry, MAX_AGE_MS - age);
      }
    }, MAX_AGE_MS);
  }

  function emitPending() {
    emitTimer = null;
    if (!running || !listening || !visible() || !pendingReading) return;
    var next = pendingReading;
    pendingReading = null;
    if (Date.now() - next.timestamp >= MAX_AGE_MS) return;
    lastEmitted = next;
    lastEmitAt = Date.now();
    if (typeof onHeading === "function") {
      try {
        onHeading({ heading: next.heading, timestamp: next.timestamp, source: "compass", accuracy: next.accuracy });
      } catch (_) { /* Compass input is optional; isolate caller errors. */ }
    }
  }

  function queueReading(next) {
    reading = next;
    scheduleExpiry();
    setStatus("ready");
    // A small dead band avoids visible magnetic jitter. Refresh identical
    // readings once a second so the controller can arbitrate against GPS age.
    if (lastEmitted && Math.abs(delta(next.heading, lastEmitted.heading)) < 1.5 &&
        next.timestamp - lastEmitted.timestamp < 1000) {
      // If the user returns before a trailing update is delivered, do not
      // emit the older turn after the device has already returned to rest.
      pendingReading = null;
      if (emitTimer !== null) window.clearTimeout(emitTimer);
      emitTimer = null;
      return;
    }
    pendingReading = next;
    if (!lastEmitted || Date.now() - lastEmitAt >= EMIT_INTERVAL_MS) {
      if (emitTimer !== null) window.clearTimeout(emitTimer);
      emitPending();
    } else if (emitTimer === null) {
      emitTimer = window.setTimeout(emitPending, EMIT_INTERVAL_MS - (Date.now() - lastEmitAt));
    }
  }

  function eventEpochStamp(event) {
    var stamp = event.timeStamp;
    if (!finite(stamp) || stamp <= 0) return Date.now();
    if (stamp > 1e12) return stamp;
    var origin = window.performance && window.performance.timeOrigin;
    return finite(origin) ? origin + stamp : Date.now();
  }

  function rejectReading(reason) {
    reading = pendingReading = jumpCandidate = lastEmitted = null;
    lastEmitAt = 0;
    if (emitTimer !== null) window.clearTimeout(emitTimer);
    emitTimer = null;
    setStatus(reason);
  }

  function receive(event) {
    if (!running || !listening || !visible() || !event) return;
    var hasWebkitHeading = finite(event.webkitCompassHeading);
    // Relative alpha is arbitrary. Merely receiving an event with the word
    // "absolute" in its type is not proof that its reference is geographic.
    if (event.absolute !== true && !hasWebkitHeading) return;
    var now = Date.now();
    var stamp = eventEpochStamp(event);
    if (stamp < freshAfter || stamp < lastEventStamp || stamp > now + 1000 || now - stamp > 1000) return;
    lastEventStamp = stamp;
    var angle = currentScreenAngle();
    var heading = null;
    var accuracy = null;
    if (hasWebkitHeading) {
      // Apple's alpha can be relative even when compassHeading is magnetic.
      // Use its explicit magnetic bearing, then apply the tilt-aware offset
      // between natural-device top and current-screen top. Never use iOS alpha
      // as north. -1 accuracy explicitly means uncalibrated.
      // https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804769-webkitcompassaccuracy
      accuracy = event.webkitCompassAccuracy;
      if (event.webkitCompassHeading < 0 || event.webkitCompassHeading >= 360 ||
          !finite(accuracy) || accuracy < 0 || accuracy > 25) {
        rejectReading("uncalibrated");
        return;
      }
      var natural = headingFromAngles(0, event.beta, event.gamma, 0);
      var rotated = headingFromAngles(0, event.beta, event.gamma, angle);
      if (natural !== null && rotated !== null) heading = normalize(event.webkitCompassHeading + delta(rotated, natural));
    } else {
      heading = headingFromAngles(event.alpha, event.beta, event.gamma, angle);
    }
    if (heading === null) {
      rejectReading("tilted");
      return;
    }
    // Hold a single large magnetic outlier. A genuine quick turn is accepted
    // once a second nearby sample confirms it for at least 120 ms.
    if (reading && Math.abs(delta(heading, reading.heading)) > 60) {
      if (!jumpCandidate || now - jumpCandidate.timestamp > 600 || Math.abs(delta(heading, jumpCandidate.heading)) > 15) {
        jumpCandidate = { heading: heading, timestamp: now };
        return;
      }
      if (now - jumpCandidate.timestamp < 120) return;
    }
    jumpCandidate = null;
    queueReading({ heading: heading, timestamp: now, accuracy: accuracy });
  }

  function removeSensors() {
    if (!listening) return;
    window.removeEventListener("deviceorientationabsolute", receive);
    window.removeEventListener("deviceorientation", receive);
    listening = false;
  }

  function addSensors() {
    if (!running || listening || !permissionGranted || !visible()) return;
    freshAfter = Date.now();
    window.addEventListener("deviceorientationabsolute", receive, { passive: true });
    window.addEventListener("deviceorientation", receive, { passive: true });
    listening = true;
    setStatus("waiting");
    scheduleExpiry();
  }

  function visibilityChanged() {
    if (!running) return;
    removeSensors();
    resetReading();
    if (visible()) {
      if (permissionGranted) addSensors();
      else setStatus(permissionDenied ? "denied" : "waiting");
    }
    else setStatus("hidden");
  }

  function screenChanged() {
    if (!running) return;
    resetReading();
    freshAfter = Date.now();
    if (listening && visible()) { setStatus("waiting"); scheduleExpiry(); }
  }

  function pageHide() { pageHidden = true; visibilityChanged(); }
  function pageShow() { pageHidden = false; visibilityChanged(); }

  function stop() {
    generation += 1;
    running = permissionGranted = permissionDenied = false;
    removeSensors();
    resetReading();
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("pagehide", pageHide);
    window.removeEventListener("pageshow", pageShow);
    window.removeEventListener("orientationchange", screenChanged);
    if (screenTarget && typeof screenTarget.removeEventListener === "function") screenTarget.removeEventListener("change", screenChanged);
    screenTarget = null;
    setStatus("off");
    onHeading = onStatus = null;
  }

  // Call synchronously inside the field-mode ON click/tap: Safari permission
  // requests require transient user activation. start/stop generations prevent
  // a late permission answer from reviving sensors after field mode is OFF.
  function start(headingCallback, statusCallback) {
    stop();
    running = true;
    pageHidden = false;
    onHeading = typeof headingCallback === "function" ? headingCallback : null;
    onStatus = typeof statusCallback === "function" ? statusCallback : null;
    var token = generation;
    var api = window.DeviceOrientationEvent;
    if (window.isSecureContext === false || (!api && !("ondeviceorientation" in window))) {
      setStatus("unavailable");
      return Promise.resolve(false);
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("orientationchange", screenChanged);
    screenTarget = window.screen && window.screen.orientation;
    if (screenTarget && typeof screenTarget.addEventListener === "function") screenTarget.addEventListener("change", screenChanged);
    setStatus(visible() ? "waiting" : "hidden");
    function granted(value) {
      if (!running || generation !== token) return false;
      if (value !== "granted") { permissionDenied = true; setStatus("denied"); return false; }
      permissionGranted = true;
      addSensors();
      return true;
    }
    if (api && typeof api.requestPermission === "function") {
      try {
        return Promise.resolve(api.requestPermission(true)).then(granted, function () { return granted("denied"); });
      } catch (_) {
        granted("denied");
        return Promise.resolve(false);
      }
    }
    granted("granted");
    return Promise.resolve(true);
  }

  window.JSFieldOrientationV1 = {
    start: start,
    stop: stop,
    headingFromAngles: headingFromAngles,
    state: function () {
      return { running: running, listening: listening, status: status, heading: reading ? reading.heading : null,
        timestamp: reading ? reading.timestamp : null, source: reading ? "compass" : "" };
    }
  };
})();
