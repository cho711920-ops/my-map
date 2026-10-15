(function(global) {
  "use strict";

  var DATA_API = "/api/data";
  var LISTINGS_API = "/api/sheet";
  var REVALIDATED_READ_ACTIONS = Object.freeze({
    unifiedListings: true,
    geocodeCache: true
  });
  var initialWarmups = Object.create(null);
  var pendingReads = Object.create(null);
  var NORMAL_READ_TIMEOUT = 15000;
  var LARGE_READ_TIMEOUT = 45000;

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

  // Bound the complete read, including its response body, not just the headers.
  // Mutations deliberately keep their existing reconciliation/retry semantics.
  function boundedRead(url, options, consume, timeoutMs, key) {
    if (key && pendingReads[key]) return pendingReads[key].promise;
    var controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
    var externalSignal = options && options.signal;
    var timer = null;
    var settled = false;
    var rejectRead;
    var entry = { promise: null, cancel: null };
    var cleanup = function() {
      if (timer !== null && typeof global.clearTimeout === "function") global.clearTimeout(timer);
      if (externalSignal && typeof externalSignal.removeEventListener === "function") {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
      if (key && pendingReads[key] === entry) delete pendingReads[key];
    };
    var cancel = function(message, timeout) {
      if (settled) return;
      settled = true;
      cleanup();
      var error = new Error(message);
      error.name = timeout ? "TimeoutError" : "AbortError";
      error.retryable = !!timeout;
      if (controller) controller.abort();
      rejectRead(error);
    };
    function onExternalAbort() { cancel("자료 조회가 취소되었습니다.", false); }
    entry.promise = new Promise(function(resolve, reject) {
      rejectRead = reject;
      if (externalSignal && externalSignal.aborted) {
        onExternalAbort();
        return;
      }
      if (externalSignal && typeof externalSignal.addEventListener === "function") {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
      if (typeof global.setTimeout === "function") {
        timer = global.setTimeout(function() {
          cancel("최신 자료 조회가 지연되고 있습니다. 잠시 후 다시 확인해 주세요.", true);
        }, timeoutMs);
      }
      var init = Object.assign({}, options || {});
      if (controller) init.signal = controller.signal;
      Promise.resolve().then(function() { return request(url, init); }).then(consume).then(function(value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }, function(error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
    });
    entry.cancel = function() { cancel("더 최신 자료가 도착하여 이전 조회를 취소했습니다.", false); };
    if (key && !settled) pendingReads[key] = entry;
    return entry.promise;
  }

  function readKey(action, params, options) {
    if (options && options.signal) return "";
    var values = params || {};
    var entries = Object.keys(values).filter(function(name) { return name !== "_"; }).sort().map(function(name) {
      return [name, String(values[name])];
    });
    return action + ":" + JSON.stringify(entries) + ":" + JSON.stringify({
      cache: options && options.cache || "",
      headers: options && options.headers || null,
      timeoutMs: options && options.timeoutMs || 0
    });
  }

  function invalidateRead(action) {
    delete initialWarmups[action === "listingsCsv" ? "listingsCsv" : action];
    Object.keys(pendingReads).forEach(function(key) {
      if (key.indexOf(action + ":") === 0) pendingReads[key].cancel();
    });
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
    var timeoutMs = Number(settings.timeoutMs) > 0 ? Math.min(Number(settings.timeoutMs), 120000) :
      (revalidated ? LARGE_READ_TIMEOUT : NORMAL_READ_TIMEOUT);
    var startedAt = Date.now();
    return boundedRead(DATA_API + "?" + query.toString(), {
      cache: settings.cache || (revalidated ? "default" : "no-store"),
      headers: settings.headers || undefined,
      signal: settings.signal || undefined
    }, function(response) {
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
        if (action === "unifiedListings") {
          payload.snapshotRevision = String(response.headers.get("x-js-listings-revision") || "");
          // Local DOM diagnostics for validating startup without retaining any
          // listing details or emitting account data to a telemetry service.
          if (typeof document !== "undefined" && document.documentElement) {
            document.documentElement.setAttribute("data-originals-read-ms", String(Date.now() - startedAt));
            document.documentElement.setAttribute("data-originals-read-transport", String(response.headers.get("x-js-data-transport") || "buffered"));
          }
        }
        return payload;
      });
    }, timeoutMs, readKey(action, params, settings));
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
      // The warmup is already the consumer's first request. A deadline or an
      // invalidation must not silently trigger another full-sized download.
      if (result && result.ok) return result.value;
      return Promise.reject(result && result.error || new Error("초기 자료 조회를 확인하지 못했습니다."));
    });
  }

  function read(action, params, options) {
    var values = params || {};
    var settings = options || {};
    if (action === "unifiedListings" && settings.headers && settings.headers["X-JS-Force-Refresh"] === "1") {
      delete initialWarmups.unifiedListings;
      return readNetwork(action, values, settings);
    }
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
    return boundedRead(LISTINGS_API, {
      cache: forceRefresh ? "reload" : "default",
      headers: headers
    }, function(response) {
      return response.text().then(function(body) {
        if (response.ok) return { body: body,
          revision: String(response.headers.get("x-js-listings-revision") || "") };
        var payload = null;
        try { payload = JSON.parse(body); } catch (_) {}
        var fallback = "D1 매물 데이터를 불러오지 못했습니다. (HTTP " + response.status + ")";
        throw httpError(messageFromPayload(payload, fallback), response, payload);
      });
    }, LARGE_READ_TIMEOUT, readKey("listingsCsv", {}, {cache: forceRefresh ? "reload" : "default"}));
  }

  function listingsSnapshot(forceRefresh) {
    if (forceRefresh) {
      delete initialWarmups.listingsCsv;
      return listingsCsvNetwork(true);
    }
    return consumeWarmup("listingsCsv", function() {
      return listingsCsvNetwork(false);
    });
  }

  function listingsCsv(forceRefresh) {
    return listingsSnapshot(forceRefresh).then(function(snapshot) { return snapshot.body; });
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
    listingsSnapshot: listingsSnapshot,
    warmInitialData: warmInitialData,
    invalidateRead: invalidateRead
  });
})(window);
