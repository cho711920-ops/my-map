(function(global) {
  "use strict";

  var DATA_API = "/api/data";
  var LISTINGS_API = "/api/sheet";

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

  function read(action, params, options) {
    var queryValues = Object.assign({}, params || {});
    queryValues.action = action;
    if (!Object.prototype.hasOwnProperty.call(queryValues, "_")) queryValues._ = String(Date.now());
    var query = new URLSearchParams(queryValues);
    var settings = options || {};
    return request(DATA_API + "?" + query.toString(), {
      cache: settings.cache || "no-store",
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

  function listingsCsv(forceRefresh) {
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

  global.JSDataAccessV6 = Object.freeze({
    endpoints: Object.freeze({ data: DATA_API, listings: LISTINGS_API }),
    read: read,
    mutate: mutate,
    listingsCsv: listingsCsv
  });
})(window);
