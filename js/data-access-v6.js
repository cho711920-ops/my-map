(function(global) {
  "use strict";

  var DATA_API = "/api/data";
  var LISTINGS_API = "/api/sheet";
  var REVALIDATED_READ_ACTIONS = Object.freeze({
    unifiedListings: true,
    geocodeCache: true
  });
  var initialWarmups = Object.create(null);

  function messageFromPayload(payload, fallback) {
    return String(payload && payload.message || fallback || "요청을 처리하지 못했습니다.");
  }

  function httpError(message, response, payload) {
    var error = new Error(message);
    error.status = Number(response && response.status || 0);
    error.payload = payload || null;
    error.retryable = error.status >= 500;
    return error;
  }

  function request(url, options) {
    var init = Object.assign({ credentials: "same-origin" }, options || {});
    return global.fetch(url, init);
  }

  function readNetwork(action, params, options) {
    var queryValues = Object.assign({}, params || {});
    queryValues.action = action;
    var revalidated = !!REVALIDATED_READ_ACTIONS[action];
    if (!revalidated && !Object.prototype.hasOwnProperty.call(queryValues, "_")) {
      queryValues._ = String(Date.now());
    }
    var query = new URLSearchParams(queryValues);
    var settings = options || {};
    return request(DATA_API + "?" + query.toString(), {
      cache: settings.cache || (revalidated ? "default" : "no-store"),
      headers: settings.headers || undefined,
      signal: settings.signal || undefined
    }).then(function(response) {
      return response.json().catch(function() { return null; }).then(function(payload) {
        if (!response.ok) {
          throw httpError(
            messageFromPayload(payload, (settings.errorMessage || "운영자료 조회 실패") + " (HTTP " + response.status + ")"),
            response,
            payload
          );
        }
        if (!payload || payload.ok === false) {
          throw httpError(messageFromPayload(payload, settings.errorMessage || "운영자료 조회 실패"), response, payload);
        }
        return payload;
      });
    });
  }

  function settledWarmup(promise) {
    return Promise.resolve(promise).then(function(value) {
      return { ok: true, value: value };
    }, function(error) {
      return { ok: false, error: error };
    });
  }

  function consumeWarmup(key, fallback) {
    var pending = initialWarmups[key];
    if (!pending) return fallback();
    delete initialWarmups[key];
    return pending.then(function(result) {
      return result && result.ok ? result.value : fallback();
    });
  }

  function read(action, params, options) {
    var values = params || {};
    var settings = options || {};
    if (
      action === "unifiedListings" &&
      !settings.signal &&
      !Object.keys(values).length
    ) {
      return consumeWarmup("unifiedListings", function() {
        return readNetwork(action, values, settings);
      });
    }
    return readNetwork(action, values, settings);
  }

  function mutate(action, payload, options) {
    var body = Object.assign({}, payload || {}, { action: action });
    var settings = options || {};
    return request(DATA_API, {
      method: "POST",
      cache: "no-store",
      keepalive: settings.keepalive === true,
      signal: settings.signal || undefined,
      headers: Object.assign({ "Content-Type": "application/json" }, settings.headers || {}),
      body: JSON.stringify(body)
    }).then(function(response) {
      return response.json().catch(function() { return null; }).then(function(result) {
        if (!response.ok) {
          throw httpError(
            messageFromPayload(result, (settings.errorMessage || "저장 요청 실패") + " (HTTP " + response.status + ")"),
            response,
            result
          );
        }
        if (!result || result.ok === false) {
          throw httpError(messageFromPayload(result, settings.errorMessage || "저장 요청 실패"), response, result);
        }
        return result;
      });
    });
  }

  function listingsCsvNetwork(forceRefresh) {
    var headers = forceRefresh ? { "X-JS-Force-Refresh": "1" } : undefined;
    return request(LISTINGS_API, {
      cache: forceRefresh ? "reload" : "default",
      headers: headers
    }).then(function(response) {
      return response.text().then(function(body) {
        if (response.ok) return body;
        var payload = null;
        try { payload = JSON.parse(body); } catch (_) {}
        var fallback = "D1 매물 데이터를 불러오지 못했습니다. (HTTP " + response.status + ")";
        throw httpError(messageFromPayload(payload, fallback), response, payload);
      });
    });
  }

  function listingsCsv(forceRefresh) {
    if (forceRefresh) {
      delete initialWarmups.listingsCsv;
      return listingsCsvNetwork(true);
    }
    return consumeWarmup("listingsCsv", function() {
      return listingsCsvNetwork(false);
    });
  }

  function warmInitialData() {
    if (!initialWarmups.listingsCsv) {
      initialWarmups.listingsCsv = settledWarmup(listingsCsvNetwork(false));
    }
    if (!initialWarmups.unifiedListings) {
      initialWarmups.unifiedListings = settledWarmup(readNetwork("unifiedListings", {}, {
        cache: "default"
      }));
    }
    return true;
  }

  global.JSDataAccessV6 = Object.freeze({
    endpoints: Object.freeze({ data: DATA_API, listings: LISTINGS_API }),
    read: read,
    mutate: mutate,
    listingsCsv: listingsCsv,
    warmInitialData: warmInitialData
  });
})(window);
