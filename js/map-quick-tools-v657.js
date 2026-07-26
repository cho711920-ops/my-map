(function () {
  "use strict";

  var toolMode = "";
  var radiusMeters = 0;
  var distanceStart = null;
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
  }

  function finishToolMode(keepStatus) {
    toolMode = "";
    radiusMeters = 0;
    distanceStart = null;
    clearPreview();
    setPressed("mapDistanceBtn", false);
    setPressed("mapRadiusBtn", false);
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
      ["mapQuickHideDoneBtn", !!window.hideDone]
    ].forEach(function (entry) {
      var button = byId(entry[0]);
      if (!button) return;
      button.classList.toggle("on", entry[1]);
      button.setAttribute("aria-checked", entry[1] ? "true" : "false");
      var check = button.querySelector(".map-quick-check");
      if (check) check.textContent = entry[1] ? "✓" : "";
    });

    setPressed("mapDistanceBtn", toolMode === "distance");
    setPressed("mapRadiusBtn", toolMode === "radius");
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
      window.clearMapMeasurementsV657();
      return;
    }
    removeMeasurementOverlays();
    finishToolMode();
    toolMode = "distance";
    setPressed("mapDistanceBtn", true);
    setStatus("지도에서 시작점과 끝점을 차례로 누르세요.");
  };

  window.startRadiusMeasureV657 = function (meters) {
    if (!isDesktopToolLayout() || !window.map || !window.kakao) return;
    if (typeof window.setMapRoadviewSelection === "function") {
      window.setMapRoadviewSelection(false);
    }
    removeMeasurementOverlays();
    finishToolMode();
    toolMode = "radius";
    radiusMeters = Number(meters) || 0;
    closePopovers("");
    setPressed("mapRadiusBtn", true);
    setStatus("지도에서 " + formatDistance(radiusMeters) + " 반경의 중심을 누르세요.");
  };

  window.clearMapMeasurementsV657 = function () {
    removeMeasurementOverlays();
    finishToolMode(false);
  };

  function addDistanceResult(start, end) {
    var line = new kakao.maps.Polyline({
      path: [start, end],
      strokeWeight: 4,
      strokeColor: "#e53935",
      strokeOpacity: 0.9,
      strokeStyle: "solid"
    });
    line.setMap(map);
    measurementOverlays.push(line);

    var meters = line.getLength();
    var label = new kakao.maps.CustomOverlay({
      position: end,
      xAnchor: 0.5,
      yAnchor: 1.35,
      content: '<div class="map-measure-label-v657">' + formatDistance(meters) + "</div>"
    });
    label.setMap(map);
    measurementOverlays.push(label);
    setStatus("측정 거리 " + formatDistance(meters) + " · ×를 누르면 지워집니다.");
    finishToolMode(true);
  }

  function addRadiusResult(center) {
    var circle = new kakao.maps.Circle({
      center: center,
      radius: radiusMeters,
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
      content: '<div class="map-measure-label-v657 radius">' + formatDistance(radiusMeters) + "</div>"
    });
    label.setMap(map);
    measurementOverlays.push(label);
    setStatus(formatDistance(radiusMeters) + " 반경 표시 · ×를 누르면 지워집니다.");
    finishToolMode(true);
  }

  function handleMapClick(event) {
    if (!toolMode || !event || !event.latLng) return;
    if (toolMode === "radius") {
      addRadiusResult(event.latLng);
      return;
    }
    if (!distanceStart) {
      distanceStart = event.latLng;
      setStatus("끝점을 누르세요.");
      return;
    }
    addDistanceResult(distanceStart, event.latLng);
  }

  function handleMapMouseMove(event) {
    if (toolMode !== "distance" || !distanceStart || !event || !event.latLng) return;
    if (!distancePreview) {
      distancePreview = new kakao.maps.Polyline({
        path: [distanceStart, event.latLng],
        strokeWeight: 3,
        strokeColor: "#e53935",
        strokeOpacity: 0.65,
        strokeStyle: "shortdash"
      });
      distancePreview.setMap(map);
    } else {
      distancePreview.setPath([distanceStart, event.latLng]);
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

  document.addEventListener("click", function (event) {
    if (!event.target.closest("#mapQuickTools")) closePopovers("");
  });

  window.addEventListener("resize", function () {
    if (!isDesktopToolLayout()) {
      closePopovers("");
      window.clearMapMeasurementsV657();
    }
  });

  window.setTimeout(function () {
    bindMapEvents();
    window.syncMapQuickToolStateV657();
    window.syncSelectionActionBarV657((window.selectedPrintKeys || []).length);
  }, 0);
})();
