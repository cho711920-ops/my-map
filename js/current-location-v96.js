/* A user-requested one-shot fix; reuse the existing dot and idle list refresh.
 * No new location watcher, provider API, server write or persistent GPS cache. */
(function(global) {
  "use strict";
  var busy = false, sequence = 0, deadline = null, statusTimer = null;
  var buttons = Array.from(document.querySelectorAll("[data-current-location-v96]"));
  var status = document.getElementById("mapCurrentLocationStatusV96");

  function message(text, keep) {
    global.clearTimeout(statusTimer);
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
    if (!keep) statusTimer = global.setTimeout(function() { status.hidden = true; }, 8000);
  }
  function setBusy(value) {
    busy = value;
    buttons.forEach(function(button) {
      button.disabled = value;
      button.setAttribute("aria-busy", value ? "true" : "false");
    });
  }
  function finish(token, text) {
    if (token !== sequence) return false;
    sequence += 1;
    global.clearTimeout(deadline);
    setBusy(false);
    if (text) message(text, false);
    return true;
  }
  function locate() {
    if (busy) return;
    var map = global.map, maps = global.kakao && global.kakao.maps;
    if (!map || !maps || typeof maps.LatLng !== "function" ||
        typeof map.setCenter !== "function" || typeof map.setLevel !== "function") {
      message("지도를 준비하고 있습니다. 잠시 후 다시 눌러 주세요.", false);
      return;
    }
    if (!navigator.geolocation) {
      message("이 기기에서 현재 위치를 사용할 수 없습니다.", false);
      return;
    }
    var token = ++sequence;
    setBusy(true);
    message("현재 위치를 확인하고 있습니다…", true);
    // Also bound a missing browser callback; late results must not move the map.
    deadline = global.setTimeout(function() {
      finish(token, "현재 위치 확인이 지연되고 있습니다. GPS·인터넷 연결을 확인한 뒤 다시 눌러 주세요.");
    }, 12000);
    try {
      navigator.geolocation.getCurrentPosition(function(position) {
        if (token !== sequence) return;
        var coords = position && position.coords;
        if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) ||
            Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) {
          finish(token, "현재 위치를 확인하지 못했습니다. 다시 눌러 주세요.");
          return;
        }
        if (global.map !== map) {
          finish(token, "지도가 변경되었습니다. 현위치 버튼을 다시 눌러 주세요.");
          return;
        }
        try {
          var point = new maps.LatLng(coords.latitude, coords.longitude);
          if (typeof global.closeMapQuickPopoversV657 === "function") global.closeMapQuickPopoversV657();
          if (typeof global.setMapRoadviewSelection === "function") global.setMapRoadviewSelection(false);
          if (typeof global.clearMapListSelectionForNavigationV6571 === "function") global.clearMapListSelectionForNavigationV6571();
          if (typeof global.markMapUserNavigationIntentV6525 === "function") global.markMapUserNavigationIntentV6525();
          // A cleared pinned selection needs one refresh even at the same bounds.
          if (typeof global.jsLastIdleViewportKeyV638 === "string") global.jsLastIdleViewportKeyV638 = "";
          if (typeof map.jump === "function") map.jump(point, 1, {animate: false});
          else { map.setLevel(1, {animate: false}); map.setCenter(point); }
          if (typeof global.updateCurrentLocationOverlayV630 === "function") global.updateCurrentLocationOverlayV630(position);
          if (typeof global.scheduleMapIdleRefreshV638 === "function") global.scheduleMapIdleRefreshV638();
          var accuracy = Number(coords.accuracy);
          finish(token, "현위치로 이동했습니다." +
            (Number.isFinite(accuracy) && accuracy > 100 ? " 위치 오차 약 " + Math.round(accuracy).toLocaleString("ko-KR") + "m" : ""));
        } catch (_) {
          finish(token, "지도 이동에 실패했습니다. 잠시 후 다시 눌러 주세요.");
        }
      }, function(error) {
        var text = error && error.code === 1
          ? "위치 권한이 꺼져 있습니다. 브라우저·기기 설정에서 위치 사용을 허용한 뒤 다시 눌러 주세요."
          : error && error.code === 3 ? "위치 확인 시간이 초과됐습니다. GPS·인터넷 연결을 확인한 뒤 다시 눌러 주세요."
            : "현재 위치를 확인하지 못했습니다. GPS·인터넷 연결을 확인한 뒤 다시 눌러 주세요.";
        finish(token, text);
      }, {enableHighAccuracy: true, maximumAge: 0, timeout: 10000});
    } catch (_) {
      finish(token, "현재 위치를 사용할 수 없습니다. 브라우저의 위치 권한을 확인해 주세요.");
    }
  }
  buttons.forEach(function(button) {button.addEventListener("click", locate);});
  global.addEventListener("pagehide", function() {
    sequence += 1;
    global.clearTimeout(deadline);
    global.clearTimeout(statusTimer);
    setBusy(false);
    if (status) status.hidden = true;
  });
})(window);
