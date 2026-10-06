/* Field-only heading-up adapter. Kakao has no native Web rotation API.
 * Keep its public container separate from our unchanged visible viewport;
 * never mutate SDK tile panes or monkey-patch SDK projection methods. */
(function () {
  "use strict";
  var viewport = null;
  var surface = null;
  var owner = null;
  var active = false;
  var bearing = 0;
  var width = 0;
  var height = 0;
  var size = 0;
  var resizeObserver = null;
  var copyright = null;
  var copyrightNext = null;
  var animationFrame = null;
  var animationGeneration = 0;
  var targetBearing = null;
  var TURN_DURATION_MS = 700;

  function normalize(value) { return (value % 360 + 360) % 360; }

  function reducedMotion() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function cancelTurn() {
    animationGeneration += 1;
    if (animationFrame !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(animationFrame);
    }
    animationFrame = null;
    targetBearing = null;
  }

  function liftCopyright() {
    // Retain the actual SDK logo, link, attribution and live scale together.
    // If a future SDK changes this structure, fail closed to north-up rather
    // than cropping its attribution or inventing a replacement logo.
    var candidates = Array.from(surface.children).filter(function (child) {
      return child.style.position === "absolute" && child.style.bottom === "0px" &&
        child.querySelector('a[href*="map.kakao.com"] img');
    });
    if (candidates.length !== 1) return false;
    copyright = candidates[0];
    copyrightNext = copyright.nextSibling;
    copyright.classList.add("js-field-map-copyright-v1");
    viewport.appendChild(copyright);
    return true;
  }

  function point(x, y) {
    return window.kakao && window.kakao.maps && window.kakao.maps.Point
      ? new window.kakao.maps.Point(x, y) : { x: x, y: y };
  }

  function forward(p, w, h, s, angle) {
    var rad = angle * Math.PI / 180;
    var x = p.x - s / 2;
    var y = p.y - s / 2;
    return point(w / 2 + x * Math.cos(rad) + y * Math.sin(rad),
      h / 2 - x * Math.sin(rad) + y * Math.cos(rad));
  }

  function inverse(p, w, h, s, angle) {
    var rad = angle * Math.PI / 180;
    var x = p.x - w / 2;
    var y = p.y - h / 2;
    return point(s / 2 + x * Math.cos(rad) - y * Math.sin(rad),
      s / 2 + x * Math.sin(rad) + y * Math.cos(rad));
  }

  function refresh() {
    if (typeof window.preservePinnedClusterSelectionDuringRelayoutV6517 === "function") {
      window.preservePinnedClusterSelectionDuringRelayoutV6517(1800);
    }
    if (typeof window.scheduleMapIdleRefreshV638 === "function") window.scheduleMapIdleRefreshV638();
  }

  function applyBearingTransform() {
    // Projection and overlays read this same displayed bearing, including each
    // animation frame. A CSS-only transition would leave hit testing at the
    // final angle while the visible map was still turning.
    surface.style.transform = "rotate(" + (-bearing) + "deg)";
    viewport.style.setProperty("--js-field-map-counter", bearing + "deg");
  }

  function layout() {
    if (!viewport || !surface) return;
    var w = viewport.clientWidth;
    var h = viewport.clientHeight;
    if (!w || !h) return;
    var nextSize = Math.ceil(Math.hypot(w, h)) + 4;
    var changed = width !== w || height !== h || (active && size !== nextSize);
    width = w; height = h; size = nextSize;
    if (active) {
      surface.style.width = size + "px";
      surface.style.height = size + "px";
      surface.style.left = (width - size) / 2 + "px";
      surface.style.top = (height - size) / 2 + "px";
      applyBearingTransform();
    } else {
      surface.style.width = "100%";
      surface.style.height = "100%";
      surface.style.left = "0px";
      surface.style.top = "0px";
      surface.style.transform = "none";
      viewport.style.removeProperty("--js-field-map-counter");
    }
    if (changed && owner) {
      var center = owner.getCenter();
      owner.relayout();
      owner.setCenter(center);
      refresh();
    }
  }

  function createContainer(element) {
    if (surface) return surface;
    viewport = element;
    surface = viewport.querySelector("#jsFieldMapSurfaceV1") || document.createElement("div");
    surface.id = "jsFieldMapSurfaceV1";
    surface.className = "js-field-map-surface-v1";
    viewport.classList.add("js-field-map-viewport-v1");
    if (surface.parentNode !== viewport) viewport.appendChild(surface);
    layout();
    return surface;
  }

  function attach(map) {
    owner = map;
    if (!resizeObserver && viewport && typeof window.ResizeObserver === "function") {
      resizeObserver = new window.ResizeObserver(layout);
      resizeObserver.observe(viewport);
    }
  }

  function reset() {
    cancelTurn();
    if (!active) return;
    active = false; bearing = 0; width = 0;
    viewport.classList.remove("js-field-map-heading-up-v1");
    if (copyright) {
      copyright.classList.remove("js-field-map-copyright-v1");
      surface.insertBefore(copyright, copyrightNext && copyrightNext.parentNode === surface ? copyrightNext : null);
      copyright = null; copyrightNext = null;
    }
    layout();
    refresh();
  }

  function setBearing(value, options) {
    if (value === null) { reset(); return false; }
    if (!surface || !owner || typeof value !== "number" || !Number.isFinite(value)) return false;
    var first = !active;
    var nextBearing = normalize(value);
    var animate = !first && options && options.animate === true && !reducedMotion() &&
      typeof window.requestAnimationFrame === "function" && typeof window.cancelAnimationFrame === "function";
    // Marker repainting may repeat the latest course many times. It must not
    // restart an in-flight turn or starve it before reaching its destination.
    if (animate && animationFrame !== null && targetBearing === nextBearing) return true;
    if (!first && animationFrame === null && bearing === nextBearing) return true;
    if (first && !liftCopyright()) return false;
    cancelTurn();
    active = true;
    if (first) width = 0;
    viewport.classList.add("js-field-map-heading-up-v1");
    var delta = (nextBearing - bearing + 540) % 360 - 180;
    if (!animate || Math.abs(delta) < 0.001) {
      bearing = nextBearing;
      layout();
      refresh();
    } else {
      var fromBearing = bearing;
      var generation = animationGeneration;
      var startedAt = window.performance && typeof window.performance.now === "function" ? window.performance.now() : null;
      targetBearing = nextBearing;
      // Rebuild visible listings only at the turn boundaries. Frames update
      // two transforms, never SDK geometry or the listing collection.
      refresh();
      var turn = function (stamp) {
        if (generation !== animationGeneration || !active) return;
        if (startedAt === null) startedAt = stamp;
        var progress = reducedMotion() ? 1 : Math.min(1, Math.max(0, (stamp - startedAt) / TURN_DURATION_MS));
        var eased = 1 - Math.pow(1 - progress, 3);
        bearing = progress === 1 ? nextBearing : normalize(fromBearing + delta * eased);
        applyBearingTransform();
        if (progress === 1) {
          animationFrame = null;
          targetBearing = null;
          refresh();
        } else animationFrame = window.requestAnimationFrame(turn);
      };
      animationFrame = window.requestAnimationFrame(turn);
    }
    return true;
  }

  function projection(map) {
    var raw = map.getProjection();
    if (!active || map !== owner || !raw) return raw;
    return {
      containerPointFromCoords: function (coords) {
        var p = raw.containerPointFromCoords(coords);
        return p ? forward(p, width, height, size, bearing) : p;
      },
      coordsFromContainerPoint: function (p) {
        return raw.coordsFromContainerPoint(inverse(p, width, height, size, bearing));
      }
    };
  }

  window.JSFieldMapCameraV1 = {
    createContainer: createContainer, attach: attach, setBearing: setBearing, reset: reset,
    projection: projection,
    contains: function (coords) {
      if (!active || !owner) return null;
      var p = projection(owner).containerPointFromCoords(coords);
      return !!p && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
    },
    state: function () { return { active: active, bearing: bearing, width: width, height: height, size: size,
      animating: animationFrame !== null, targetBearing: targetBearing }; },
    forward: forward, inverse: inverse
  };
  // Authentication intentionally defers optional modules until after map.js.
  // Adopt the already-created SDK host; do not re-create the map or GPS watcher.
  if (window.map && typeof window.map.getCenter === "function" && document.getElementById("jsFieldMapSurfaceV1")) {
    createContainer(document.getElementById("map"));
    attach(window.map);
  }
})();
