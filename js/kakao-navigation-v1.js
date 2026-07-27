/* JS부동산 - 카카오맵 길찾기 공통 실행기 */
(function () {
  "use strict";

  var LOCATION_CACHE_KEY = "js_kakao_navigation_location_v1";
  var LEGACY_LOCATION_CACHE_KEY = "js_ai_visit_location_v6";
  var currentLocation = null;

  function finiteNumber(value) {
    if (value == null || value === "") return null;
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function normalizeLocation(value) {
    if (!value) return null;

    var source = value.coords || value;
    var lat = finiteNumber(
      source.latitude != null ? source.latitude : source.lat
    );
    var lng = finiteNumber(
      source.longitude != null ? source.longitude : source.lng
    );

    if (lat == null || lng == null) return null;

    return {
      lat: lat,
      lng: lng,
      accuracy: finiteNumber(source.accuracy) || 0,
      timestamp: Number(value.timestamp || source.timestamp) || Date.now()
    };
  }

  function saveLocation(location) {
    if (!location) return null;
    currentLocation = location;
    try {
      localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(location));
    } catch (error) {}
    return location;
  }

  function rememberPosition(position) {
    return saveLocation(normalizeLocation(position));
  }

  function readStoredLocation(key) {
    try {
      return normalizeLocation(JSON.parse(localStorage.getItem(key) || "null"));
    } catch (error) {
      return null;
    }
  }

  function getFreshLocation(maxAgeMs) {
    var candidates = [
      currentLocation,
      readStoredLocation(LOCATION_CACHE_KEY),
      readStoredLocation(LEGACY_LOCATION_CACHE_KEY)
    ].filter(Boolean);

    candidates.sort(function (left, right) {
      return Number(right.timestamp || 0) - Number(left.timestamp || 0);
    });

    var location = candidates[0] || null;
    if (!location) return null;
    if (Date.now() - Number(location.timestamp || 0) > maxAgeMs) return null;
    currentLocation = location;
    return location;
  }

  function requestCurrentLocation(callback) {
    var cached = getFreshLocation(2 * 60 * 1000);
    if (cached) {
      callback(cached, null);
      return;
    }

    if (!navigator.geolocation) {
      callback(null, { code: "UNSUPPORTED" });
      return;
    }

    var finished = false;
    function finish(location, error) {
      if (finished) return;
      finished = true;
      callback(location ? saveLocation(location) : null, error || null);
    }

    function requestHighAccuracy(previousError) {
      try {
        navigator.geolocation.getCurrentPosition(
          function (position) {
            finish(normalizeLocation(position), null);
          },
          function (error) {
            finish(null, error || previousError || { code: "UNAVAILABLE" });
          },
          {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0
          }
        );
      } catch (error) {
        finish(null, error || previousError);
      }
    }

    try {
      navigator.geolocation.getCurrentPosition(
        function (position) {
          var location = normalizeLocation(position);
          if (location) finish(location, null);
          else requestHighAccuracy({ code: "INVALID_POSITION" });
        },
        requestHighAccuracy,
        {
          enableHighAccuracy: false,
          timeout: 3000,
          maximumAge: 120000
        }
      );
    } catch (error) {
      requestHighAccuracy(error);
    }
  }

  function normalizedDestination(destination) {
    var lat = finiteNumber(destination && destination.lat);
    var lng = finiteNumber(destination && destination.lng);
    if (lat == null || lng == null) return null;

    return {
      lat: lat,
      lng: lng,
      name: String((destination && destination.name) || "매물 위치").trim() || "매물 위치"
    };
  }

  function coordinatePair(location) {
    return Number(location.lat).toFixed(7) + "," + Number(location.lng).toFixed(7);
  }

  function buildRouteTargets(location, destination) {
    var start = normalizeLocation(location);
    var end = normalizedDestination(destination);
    if (!end) return null;

    var endPair = coordinatePair(end);
    var encodedEndName = encodeURIComponent(end.name);
    var webUrl;
    var routeQuery;

    if (start) {
      var startPair = coordinatePair(start);
      webUrl =
        "https://map.kakao.com/link/by/car/" +
        encodeURIComponent("현재 위치") + "," + startPair + "/" +
        encodedEndName + "," + endPair;
      routeQuery = "sp=" + startPair + "&ep=" + endPair + "&by=car";
    } else {
      webUrl =
        "https://map.kakao.com/link/to/" +
        encodedEndName + "," + endPair;
      routeQuery = "ep=" + endPair + "&by=car";
    }

    return {
      hasStart: !!start,
      webUrl: webUrl,
      appUrl: "kakaomap://route?" + routeQuery,
      androidIntent:
        "intent://route?" + routeQuery +
        "#Intent;scheme=kakaomap;package=net.daum.android.map;" +
        "S.browser_fallback_url=" + encodeURIComponent(webUrl) + ";end"
    };
  }

  function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function launchRoute(location, destination) {
    var targets = buildRouteTargets(location, destination);
    if (!targets) {
      alert("목적지 좌표를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
      return false;
    }

    if (isAndroidDevice()) {
      var fallbackTimer = window.setTimeout(function () {
        window.location.href = targets.webUrl;
      }, 2200);

      var cancelFallback = function () {
        if (!document.hidden) return;
        window.clearTimeout(fallbackTimer);
        document.removeEventListener("visibilitychange", cancelFallback);
      };

      document.addEventListener("visibilitychange", cancelFallback);
      window.location.href = targets.androidIntent;
      return true;
    }

    window.open(targets.webUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  function open(destination) {
    var end = normalizedDestination(destination);
    if (!end) {
      alert("목적지 좌표를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    requestCurrentLocation(function (location) {
      if (!location) {
        alert("현재 위치를 가져오지 못했습니다. 카카오맵에서 출발지를 현재 위치로 선택해주세요.");
      }
      launchRoute(location, end);
    });
  }

  window.JSKakaoNavigation = {
    open: open,
    rememberPosition: rememberPosition,
    getFreshLocation: getFreshLocation,
    buildRouteTargets: buildRouteTargets,
    launchRoute: launchRoute
  };
})();
