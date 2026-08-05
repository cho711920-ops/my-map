(function () {
  "use strict";

  var toolMode = "";
  var radiusMeters = 0;
  var distancePoints = [];
  var distanceLine = null;
  var distanceLabel = null;
  var distancePreview = null;
  var measurementOverlays = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function isDesktopToolLayout() {
    return window.innerWidth >= 769;
  }

  function setPressed(id, active) {
    var button = byId(id);
    if (!button) return;
    button.classList.toggle("on", !!active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }

  function setStatus(message) {
    var box = byId("mapMeasureStatusV657");
    var text = byId("mapMeasureStatusTextV657");
    if (!box || !text) return;
    text.textContent = message || "";
    box.hidden = !message;
  }

  function formatDistance(meters) {
    var value = Number(meters) || 0;
    if (value >= 1000) {
      return (value / 1000).toLocaleString("ko-KR", {
        minimumFractionDigits: value < 10000 ? 2 : 1,
        maximumFractionDigits: 2
      }) + "km";
    }
    return Math.round(value).toLocaleString("ko-KR") + "m";
  }

  function clearPreview() {
    if (!distancePreview) return;
    distancePreview.setMap(null);
    distancePreview = null;
  }

  function removeMeasurementOverlays() {
    clearPreview();
    measurementOverlays.forEach(function (overlay) {
      if (overlay && typeof overlay.setMap === "function") overlay.setMap(null);
    });
    measurementOverlays = [];
    distancePoints = [];
    distanceLine = null;
    distanceLabel = null;
  }

  function finishToolMode(keepStatus) {
    toolMode = "";
    radiusMeters = 0;
    clearPreview();
    setPressed("mapDistanceBtn", false);
    setPressed("mapRadiusBtn", !!window.mapRadiusFilterV658);
    if (!keepStatus) setStatus("");
  }

  function closePopovers(exceptName) {
    [
      { name: "view", popover: "mapQuickPopoverView", button: "mapQuickViewBtn" },
      { name: "lists", popover: "mapQuickPopoverLists", button: "mapQuickListBtn" },
      { name: "radius", popover: "mapQuickPopoverRadius", button: "mapRadiusBtn" }
    ].forEach(function (entry) {
      if (entry.name === exceptName) return;
      var popover = byId(entry.popover);
      var button = byId(entry.button);
      if (popover) popover.hidden = true;
      if (button) button.setAttribute("aria-expanded", "false");
    });
  }

  window.closeMapQuickPopoversV657 = function () {
    closePopovers("");
  };

  window.toggleMapQuickPopoverV657 = function (name, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!isDesktopToolLayout()) return;

    var ids = {
      view: ["mapQuickPopoverView", "mapQuickViewBtn"],
      lists: ["mapQuickPopoverLists", "mapQuickListBtn"],
      radius: ["mapQuickPopoverRadius", "mapRadiusBtn"]
    };
    var target = ids[name];
    if (!target) return;
    var popover = byId(target[0]);
    var button = byId(target[1]);
    var willOpen = !!popover && popover.hidden;
    closePopovers(name);
    if (popover) popover.hidden = !willOpen;
    if (button) button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    window.syncMapQuickToolStateV657();
  };

  window.syncMapQuickToolStateV657 = function () {
    [
      ["mapQuickTodayBtn", !!window.todayNewOnly],
      ["mapQuickVisitOnlyBtn", !!window.gongsilOnly],
      ["mapQuickHideDoneBtn", !!window.hideDone],
      ["mapQuickDoneOnlyBtn", !!window.doneOnly]
    ].forEach(function (entry) {
      var button = byId(entry[0]);
      if (!button) return;
      button.classList.toggle("on", entry[1]);
      button.setAttribute("aria-checked", entry[1] ? "true" : "false");
      var check = button.querySelector(".map-quick-check");
      if (check) check.textContent = entry[1] ? "✓" : "";
    });

    setPressed("mapDistanceBtn", toolMode === "distance");
    setPressed("mapRadiusBtn", toolMode === "radius" || !!window.mapRadiusFilterV658);
  };

  window.syncSelectionActionBarV657 = function (count) {
    var bar = byId("selectionActionBar");
    var counter = byId("selectionActionCount");
    var numericCount = Number(count) || 0;
    if (!bar || !counter) return;
    bar.hidden = numericCount < 1;
    counter.textContent = numericCount.toLocaleString("ko-KR") + "건 선택";
  };

  window.toggleDistanceMeasureV657 = function () {
    if (!isDesktopToolLayout() || !window.map || !window.kakao) return;
    closePopovers("");
    if (typeof window.setMapRoadviewSelection === "function") {
      window.setMapRoadviewSelection(false);
    }
    if (toolMode === "distance") {
      finishToolMode(true);
      if (distanceLine) {
        setStatus("거리 측정 일시정지 · 누적 " + formatDistance(distanceLine.getLength()) +
          " · ×를 누르면 지워집니다.");
      } else {
        setStatus("거리 측정을 취소했습니다.");
      }
      return;
    }
    var hadRadiusFilter = !!window.mapRadiusFilterV658;
    window.mapRadiusFilterV658 = null;
    removeMeasurementOverlays();
    finishToolMode();
    if (hadRadiusFilter && typeof window.applyFilter === "function") window.applyFilter();
    toolMode = "distance";
    setPressed("mapDistanceBtn", true);
    setStatus("지도에서 이동 경로를 차례로 누르세요. 계속 누르면 누적됩니다.");
  };

  window.startRadiusMeasureV657 = function (meters) {
    if (!isDesktopToolLayout() || !window.map || !window.kakao) return;
    if (typeof window.setMapRoadviewSelection === "function") {
      window.setMapRoadviewSelection(false);
    }
    var hadRadiusFilter = !!window.mapRadiusFilterV658;
    window.mapRadiusFilterV658 = null;
    removeMeasurementOverlays();
    finishToolMode();
    if (hadRadiusFilter && typeof window.applyFilter === "function") window.applyFilter();
    toolMode = "radius";
    radiusMeters = Number(meters) || 0;
    closePopovers("");
    setPressed("mapRadiusBtn", true);
    setStatus("지도에서 " + formatDistance(radiusMeters) + " 반경의 중심을 누르세요.");
  };

  window.clearMapMeasurementsV657 = function (skipFilterRefresh) {
    var hadRadiusFilter = !!window.mapRadiusFilterV658;
    window.mapRadiusFilterV658 = null;
    removeMeasurementOverlays();
    finishToolMode(false);
    window.syncMapQuickToolStateV657();
    if (hadRadiusFilter && !skipFilterRefresh && typeof window.applyFilter === "function") {
      window.applyFilter();
    }
  };

  function updateDistanceResult() {
    if (distancePoints.length < 2) return;
    if (!distanceLine) {
      distanceLine = new kakao.maps.Polyline({
        path: distancePoints,
        strokeWeight: 4,
        strokeColor: "#e53935",
        strokeOpacity: 0.9,
        strokeStyle: "solid"
      });
      distanceLine.setMap(map);
      measurementOverlays.push(distanceLine);
    } else {
      distanceLine.setPath(distancePoints);
    }

    var meters = distanceLine.getLength();
    var end = distancePoints[distancePoints.length - 1];
    var content = '<div class="map-measure-label-v657">' + formatDistance(meters) + "</div>";
    if (!distanceLabel) {
      distanceLabel = new kakao.maps.CustomOverlay({
        position: end,
        xAnchor: 0.5,
        yAnchor: 1.35,
        content: content
      });
      distanceLabel.setMap(map);
      measurementOverlays.push(distanceLabel);
    } else {
      distanceLabel.setPosition(end);
      distanceLabel.setContent(content);
    }
    setStatus("경유점 " + distancePoints.length + "개 · 누적 " + formatDistance(meters) +
      " · 다음 지점을 계속 누르세요.");
  }

  function addRadiusResult(center) {
    var selectedRadius = radiusMeters;
    var circle = new kakao.maps.Circle({
      center: center,
      radius: selectedRadius,
      strokeWeight: 3,
      strokeColor: "#1769e8",
      strokeOpacity: 0.9,
      strokeStyle: "solid",
      fillColor: "#4c9aff",
      fillOpacity: 0.16
    });
    circle.setMap(map);
    measurementOverlays.push(circle);

    var label = new kakao.maps.CustomOverlay({
      position: center,
      xAnchor: 0.5,
      yAnchor: 0.5,
      content: '<div class="map-measure-label-v657 radius">' + formatDistance(selectedRadius) + "</div>"
    });
    label.setMap(map);
    measurementOverlays.push(label);
    window.mapRadiusFilterV658 = {
      lat: center.getLat(),
      lng: center.getLng(),
      meters: selectedRadius
    };
    finishToolMode(true);
    if (typeof window.applyFilter === "function") window.applyFilter();
    var itemCount = Array.isArray(window.currentItems) ? window.currentItems.length : 0;
    setStatus(formatDistance(selectedRadius) + " 반경 안 매물 " +
      itemCount.toLocaleString("ko-KR") + "개만 표시 중 · ×를 누르면 해제됩니다.");
    window.syncMapQuickToolStateV657();
  }

  function handleMapClick(event) {
    if (!toolMode || !event || !event.latLng) return;
    if (toolMode === "radius") {
      addRadiusResult(event.latLng);
      return;
    }
    distancePoints.push(event.latLng);
    if (distancePoints.length === 1) {
      setStatus("시작점 지정 · 이동 경로의 다음 지점을 누르세요.");
      return;
    }
    updateDistanceResult();
  }

  function handleMapMouseMove(event) {
    if (toolMode !== "distance" || !distancePoints.length || !event || !event.latLng) return;
    var lastPoint = distancePoints[distancePoints.length - 1];
    if (!distancePreview) {
      distancePreview = new kakao.maps.Polyline({
        path: [lastPoint, event.latLng],
        strokeWeight: 3,
        strokeColor: "#e53935",
        strokeOpacity: 0.65,
        strokeStyle: "shortdash"
      });
      distancePreview.setMap(map);
    } else {
      distancePreview.setPath([lastPoint, event.latLng]);
    }
  }

  function bindMapEvents() {
    if (!window.map || !window.kakao || !kakao.maps || !kakao.maps.event) {
      window.setTimeout(bindMapEvents, 100);
      return;
    }
    if (map.__quickToolsBoundV657) return;
    map.__quickToolsBoundV657 = true;
    kakao.maps.event.addListener(map, "click", handleMapClick);
    kakao.maps.event.addListener(map, "mousemove", handleMapMouseMove);
  }

  function syncMapQuickToolGeometryV659() {
    var root = document.documentElement;
    var sidebar = document.getElementById("sidebar");
    if (!root || !sidebar || !isDesktopToolLayout()) {
      if (root) root.style.removeProperty("--map-sidebar-width-v659");
      return;
    }
    var sidebarLeft = sidebar.getBoundingClientRect().left;
    var sidebarWidth = Math.max(0, window.innerWidth - sidebarLeft);
    root.style.setProperty("--map-sidebar-width-v659", Math.round(sidebarWidth) + "px");
  }
  window.syncMapQuickToolGeometryV659 = syncMapQuickToolGeometryV659;

  document.addEventListener("click", function (event) {
    if (!event.target.closest("#mapQuickTools")) closePopovers("");
  });

  window.addEventListener("resize", function () {
    syncMapQuickToolGeometryV659();
    if (!isDesktopToolLayout()) {
      closePopovers("");
      window.clearMapMeasurementsV657();
    }
  });
  window.addEventListener("load", syncMapQuickToolGeometryV659);

  window.setTimeout(function () {
    bindMapEvents();
    syncMapQuickToolGeometryV659();
    window.syncMapQuickToolStateV657();
    window.syncSelectionActionBarV657((window.selectedPrintKeys || []).length);
  }, 0);
  window.setTimeout(syncMapQuickToolGeometryV659, 500);
})();
