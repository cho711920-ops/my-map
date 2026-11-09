(function(global) {
  "use strict";

  var DATA_API = "/api/data";
  var LISTINGS_API = "/api/sheet";
  var REVALIDATED_READ_ACTIONS = Object.freeze({
    unifiedListings: true,
    geocodeCache: true
  });
  var initialWarmups = Object.create(null);
  function listingsScopeV123() {
    return global.JSListingTradeV1 ? (global.JSListingTradeV1.getMode() === "lease" ? "lease" : "all")
      : global.document ? "lease" : "all";
  }
  function scopedHeadersV123(headers) {
    return Object.assign({}, headers || {}, listingsScopeV123() === "lease" ? {"X-JS-Listings-Scope":"lease"} : {});
  }
  var pendingReads = Object.create(null);
  var NORMAL_READ_TIMEOUT = 15000;
  var LARGE_READ_TIMEOUT = 45000;
  var LARGE_READ_HEADERS_TIMEOUT = 90000;
  var LARGE_READ_MAX_DURATION = 120000;

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
    return global.fetch(url, init).then(function(response) {
      if (response.status === 401 && typeof global.dispatchEvent === "function" && typeof global.Event === "function") {
        global.dispatchEvent(new global.Event("js-auth-required"));
      }
      // Keep the original failure; never replay a write after logging in.
      return response;
    });
  }

  // Keep large snapshot downloads off one long, fragile HTTP response. The
  // server pins every small range to one ETag; mixed/partial files are rejected.
  var rangeActiveV125 = 0, rangeWaitersV125 = [];
  async function rangeSlotV125(run, priority) {
    if (rangeActiveV125 >= 4) await new Promise(function(resolve) { rangeWaitersV125.push({resolve:resolve,priority:priority}); });
    else rangeActiveV125 += 1;
    try { return await run(); }
    finally {
      var nextIndex = rangeWaitersV125.findIndex(function(entry) {return entry.priority;});
      var next = rangeWaitersV125.splice(nextIndex < 0 ? 0 : nextIndex,1)[0];
      if (next) next.resolve(); else rangeActiveV125 -= 1;
    }
  }
  function snapshotErrorV125(message, status, name) {
    var error = new Error(message); error.status = status || 0;
    error.name = name || "SnapshotReadError"; return error;
  }
  async function rangeBytesV125(url, init, manifest, offset, length, signal, progress) {
    return rangeSlotV125(async function() {
      for (var attempt = 0; attempt < 2; attempt += 1) {
        if (signal.aborted) throw snapshotErrorV125("자료 조회가 취소되었습니다.", 0, "AbortError");
        var controller = new global.AbortController();
        var abort = function() { controller.abort(); };
        signal.addEventListener("abort", abort, {once:true});
        var timer = global.setTimeout(abort, 20000);
        try {
          var headers = Object.assign({}, init.headers || {}, {"X-JS-Snapshot-Mode":"chunk-v128",
            "X-JS-Snapshot-Etag":manifest.etag,"X-JS-Snapshot-Offset":String(offset),"X-JS-Snapshot-Length":String(length)});
          delete headers["X-JS-Force-Refresh"];
          var response = await request(url, {headers:headers,cache:"no-store",signal:controller.signal});
          if (response.status === 409) throw snapshotErrorV125("조회 중 매물 자료가 갱신되었습니다.",409,"SnapshotChangedError");
          if (!response.ok) throw snapshotErrorV125("매물 파일 조회 실패",response.status);
          if (response.headers.get("x-js-snapshot-etag") !== manifest.etag ||
              Number(response.headers.get("x-js-snapshot-offset")) !== offset ||
              Number(response.headers.get("x-js-snapshot-length")) !== length) throw snapshotErrorV125("매물 파일의 범위를 확인하지 못했습니다.",409,"SnapshotChangedError");
          var reader = response.body.getReader(), parts = [], size = 0;
          try {
            for (;;) {
              var chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > length) throw snapshotErrorV125("매물 파일의 크기가 일치하지 않습니다.",502);
              parts.push(chunk.value); progress(chunk.value.byteLength);
            }
          } finally { await reader.cancel().catch(function() {}); reader.releaseLock(); }
          if (size !== length) throw snapshotErrorV125("매물 파일이 끝까지 수신되지 않았습니다.",502);
          var bytes = new Uint8Array(size), position = 0;
          parts.forEach(function(part) { bytes.set(part,position); position += part.byteLength; });
          return bytes;
        } catch (error) {
          if (signal.aborted || attempt || error.status === 409 || error.status === 401 || error.status === 403 ||
              error.status && error.status < 500) throw error;
        } finally { global.clearTimeout(timer); signal.removeEventListener("abort",abort); controller.abort(); }
      }
    }, url === LISTINGS_API);
  }
  async function snapshotRequestV125(url, init, progress, manifestReady) {
    if (typeof global.DecompressionStream !== "function" || typeof global.AbortController !== "function" ||
        typeof global.ReadableStream !== "function" || typeof global.Response !== "function") return request(url,init);
    for (var cycle = 0; cycle < 2; cycle += 1) {
      let response = await request(url,Object.assign({},init,{cache:"no-store",
        headers:Object.assign({},init.headers || {},{"X-JS-Snapshot-Mode":"manifest-v128"})}));
      if (response.status >= 500) {
        await response.body?.cancel?.();
        response = await request(url,Object.assign({},init,{cache:"no-store",
          headers:Object.assign({},init.headers || {},{"X-JS-Snapshot-Mode":"manifest-v128"})}));
      }
      // Older deployments still return their ordinary complete representation.
      if (!response.ok || response.headers.get("x-js-snapshot-protocol") !== "ranges-v125") return response;
      let manifest = await response.json();
      if (manifest.protocol !== "ranges-v125" || !/^"[a-zA-Z0-9_-]+(?:-[0-9]+)?"$/.test(manifest.etag || "") ||
          !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > 64*1024*1024 ||
          [256*1024,1024*1024].indexOf(manifest.chunkBytes) < 0 || !manifest.revision ||
          ["gzip","identity"].indexOf(manifest.encoding) < 0) throw snapshotErrorV125("매물 파일 정보를 확인하지 못했습니다.",502);
      manifestReady(response);
      let controller = new global.AbortController(), signal = controller.signal;
      let abort = function() { controller.abort(); };
      init.signal.addEventListener("abort",abort,{once:true});
      if (init.signal.aborted) controller.abort();
      let parts = [], count = Math.ceil(manifest.size / manifest.chunkBytes), next = 0;
      try {
        await Promise.all(Array.from({length:Math.min(url === LISTINGS_API ? 4 : 3,count)},async function() {
          while (next < count) {
            var index = next++, offset = index * manifest.chunkBytes;
            parts[index] = await rangeBytesV125(url,init,manifest,offset,Math.min(manifest.chunkBytes,manifest.size-offset),signal,progress);
          }
        }));
        let at = 0;
        var stream = new global.ReadableStream({pull:function(output) {
          if (at === parts.length) {output.close(); return;}
          output.enqueue(parts[at]); parts[at++] = null;
        },cancel:function() {parts.length=0;}});
        if (manifest.encoding === "gzip") stream = stream.pipeThrough(new global.DecompressionStream("gzip"));
        var resultHeaders = new global.Headers(response.headers);
        resultHeaders.delete("content-length"); resultHeaders.delete("content-encoding");
        resultHeaders.set("content-type",manifest.contentType);
        resultHeaders.set("x-js-listings-revision",manifest.revision);
        resultHeaders.set("x-js-data-transport","bounded-ranges-v125");
        resultHeaders.set("x-js-data-encoding","stored-"+manifest.encoding+"-ranges-v125");
        return new global.Response(stream,{headers:resultHeaders});
      } catch (error) {
        controller.abort(); parts.length=0;
        if (cycle || error.status !== 409 || init.signal.aborted) throw error;
        // One whole-representation restart only; never combine old/new ranges.
      } finally { init.signal.removeEventListener("abort",abort); }
    }
  }

  // Bound the complete read, including its response body, not just the headers.
  // Mutations deliberately keep their existing reconciliation/retry semantics.
  function boundedRead(url, options, consume, timeoutMs, key, progressive) {
    if (key && pendingReads[key]) return pendingReads[key].promise;
    var controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
    var externalSignal = options && options.signal;
    var timer = null;
    var startedAt = Date.now();
    var lastProgressAt = startedAt;
    var awaitingHeaders = true;
    var diagnosticRoot = global.document && global.document.documentElement;
    var diagnosticPrefix = url === LISTINGS_API ? "data-listings-read-" : /^\/api\/data\?action=unifiedListings(?:&|$)/.test(url) ? "data-originals-stream-" : "";
    var receivedBytes = 0, diagnosticAt = 0;
    function diagnostic(phase, force) {
      if (!diagnosticRoot || !diagnosticPrefix || !force && Date.now() - diagnosticAt < 1000) return;
      diagnosticAt = Date.now();
      diagnosticRoot.setAttribute(diagnosticPrefix + "phase", phase);
      diagnosticRoot.setAttribute(diagnosticPrefix + "bytes", String(receivedBytes));
      diagnosticRoot.setAttribute(diagnosticPrefix + "ms", String(Date.now() - startedAt));
    }
    diagnostic("headers", true);
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
      diagnostic(timeout ? awaitingHeaders ? "headers-timeout" : "body-timeout" : "cancelled", true);
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
      function checkDeadline() {
        var now = Date.now();
        var remaining = progressive
          ? Math.min((awaitingHeaders ? LARGE_READ_HEADERS_TIMEOUT : timeoutMs) -
            (now - (awaitingHeaders ? startedAt : lastProgressAt)), LARGE_READ_MAX_DURATION - (now - startedAt))
          : timeoutMs - (now - startedAt);
        if (remaining <= 0) cancel("최신 자료 조회가 지연되고 있습니다. 잠시 후 다시 확인해 주세요.", true);
        else if (typeof global.setTimeout === "function") timer = global.setTimeout(checkDeadline, remaining);
      }
      if (typeof global.setTimeout === "function") {
        timer = global.setTimeout(checkDeadline, progressive ? LARGE_READ_HEADERS_TIMEOUT : timeoutMs);
      }
      var init = Object.assign({}, options || {});
      if (controller) init.signal = controller.signal;
      Promise.resolve().then(function() {
        return progressive ? snapshotRequestV125(url,init,function() { lastProgressAt = Date.now(); },function() {
          awaitingHeaders = false; lastProgressAt = Date.now();
          diagnostic("ranges",true);
          if (timer !== null && typeof global.clearTimeout === "function") global.clearTimeout(timer);
          checkDeadline();
        }) : request(url, init);
      }).then(function(response) {
        if (settled) return;
        awaitingHeaders = false;
        lastProgressAt = Date.now();
        diagnostic("body", true);
        if (diagnosticRoot && diagnosticPrefix) {
          diagnosticRoot.setAttribute(diagnosticPrefix + "scope", response.headers.get("x-js-listings-scope") || "all");
          diagnosticRoot.setAttribute(diagnosticPrefix + "encoding", response.headers.get("x-js-data-encoding") || "dynamic");
        }
        if (progressive) {
          if (timer !== null && typeof global.clearTimeout === "function") global.clearTimeout(timer);
          checkDeadline();
        }
        return consume(response, init.signal, function(bytes) { lastProgressAt = Date.now(); receivedBytes += Number(bytes) || 0; diagnostic("body", false); });
      }).then(function(value) {
        if (settled) return;
        settled = true;
        cleanup();
        diagnostic("complete", true);
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

  function jsonWithProgress(response, progress) {
    if (!response.body || typeof response.body.getReader !== "function" ||
        typeof global.TransformStream !== "function" || typeof global.Response !== "function") return response.json();
    // Let the native JSON consumer retain its own bounded stream buffers;
    // observing bytes must not create another full text/byte copy of originals.
    var stream = response.body.pipeThrough(new global.TransformStream({
      transform: function(chunk, controller) {
        if (chunk.byteLength) progress(chunk.byteLength);
        controller.enqueue(chunk);
      }
    }));
    return new global.Response(stream).json();
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
    var settings = Object.assign({}, options || {});
    if (action === "unifiedListings") settings.headers = scopedHeadersV123(settings.headers);
    var timeoutMs = Number(settings.timeoutMs) > 0 ? Math.min(Number(settings.timeoutMs), 120000) :
      (revalidated ? LARGE_READ_TIMEOUT : NORMAL_READ_TIMEOUT);
    var startedAt = Date.now();
    var progressive = action === "unifiedListings" && !(Number(settings.timeoutMs) > 0);
    return boundedRead(DATA_API + "?" + query.toString(), {
      cache: settings.cache || (revalidated ? "default" : "no-store"),
      headers: settings.headers || undefined,
      signal: settings.signal || undefined
    }, function(response, signal, progress) {
      return (progressive ? jsonWithProgress(response, progress) : response.json()).catch(function() { return null; }).then(function(payload) {
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
          payload.datasetScope = response.headers.get("x-js-listings-scope") || "all";
          // Local DOM diagnostics for validating startup without retaining any
          // listing details or emitting account data to a telemetry service.
          if (typeof document !== "undefined" && document.documentElement) {
            document.documentElement.setAttribute("data-originals-read-ms", String(Date.now() - startedAt));
            document.documentElement.setAttribute("data-originals-read-transport", String(response.headers.get("x-js-data-transport") || "buffered"));
          }
        }
        return payload;
      });
    }, timeoutMs, readKey(action, params, settings), progressive);
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

  // Decode bounded chunks while downloading instead of retaining a second
  // full CSV string beside every parsed cell. Quoting/UTF-8 may cross chunks.
  async function streamedCsvRows(response, signal, progress) {
    var reader = response.body.getReader(), decoder = new global.TextDecoder('utf-8', {fatal: true});
    var rows = [], row = [], parts = [], carry = '', quoted = false, first = true;
    var sliceStarted = Date.now();
    function scan(chunk, final) {
      var input = carry + chunk, start = 0, end = input.length, tokens = /[",\r\n]/g, match;
      if (first && input.length) { input = input.replace(/^\uFEFF/, ''); end = input.length; first = false; }
      if (!final && /["\r]/.test(input.charAt(end - 1))) end--;
      function cell(stop) { var tail = input.slice(start, stop); row.push(parts.length ? parts.join('') + tail : tail); parts = []; }
      while ((match = tokens.exec(input)) && match.index < end) {
        var i = match.index, ch = match[0];
        if (ch === '"') {
          if (quoted && input[i + 1] === '"') { parts.push(input.slice(start, i), '"'); tokens.lastIndex = i + 2; }
          else { parts.push(input.slice(start, i)); quoted = !quoted; }
          start = tokens.lastIndex;
        } else if (ch === ',' && !quoted) { cell(i); start = tokens.lastIndex; }
        else if ((ch === '\r' || ch === '\n') && !quoted) {
          if (ch === '\r' && input[i + 1] === '\n') tokens.lastIndex = i + 2;
          cell(i); rows.push(row); row = []; start = tokens.lastIndex;
        } else if (ch === '\r' && quoted && input[i + 1] === '\n') {
          parts.push(input.slice(start, i), '\n'); tokens.lastIndex = i + 2; start = tokens.lastIndex;
        }
      }
      end = Math.max(end, start);
      if (end > start) parts.push(input.slice(start, end));
      carry = input.slice(end);
      if (final) {
        if (quoted) throw new Error('매물 목록이 끝까지 수신되지 않았습니다.');
        if (parts.length || row.length) { row.push(parts.join('')); rows.push(row); }
      }
    }
    try {
      while (true) {
        if (signal && signal.aborted) throw Object.assign(new Error('자료 조회가 취소되었습니다.'), {name: 'AbortError'});
        var chunk = await reader.read();
        if (chunk.done) { scan(decoder.decode(), true); return rows; }
        if (chunk.value.byteLength && progress) progress(chunk.value.byteLength);
        // A cached response may supply a very large single chunk. Keep both
        // decode and separator scanning bounded even in that case.
        for (var offset = 0; offset < chunk.value.length; offset += 65536) {
          scan(decoder.decode(chunk.value.subarray(offset, offset + 65536), {stream: true}), false);
          if (Date.now() - sliceStarted >= 12) {
            await new Promise(function(resolve) { global.setTimeout(resolve, 0); });
            sliceStarted = Date.now();
            if (signal && signal.aborted) throw Object.assign(new Error('자료 조회가 취소되었습니다.'), {name: 'AbortError'});
          }
        }
      }
    } catch (error) { await reader.cancel().catch(function() {}); throw error; }
    finally { reader.releaseLock(); }
  }

  function listingsCsvNetwork(forceRefresh) {
    var headers = scopedHeadersV123(forceRefresh ? { "X-JS-Force-Refresh": "1" } : undefined);
    return boundedRead(LISTINGS_API, {
      cache: forceRefresh ? "reload" : "default",
      headers: headers
    }, function(response, signal, progress) {
      if (response.ok && response.body && typeof response.body.getReader === 'function' &&
          typeof global.TextDecoder === 'function' && typeof global.setTimeout === 'function') {
        return streamedCsvRows(response, signal, progress).then(function(rows) {
          return {rows: rows, revision: String(response.headers.get('x-js-listings-revision') || ''), scope: response.headers.get('x-js-listings-scope') || 'all'};
        });
      }
      return response.text().then(function(body) {
        if (response.ok) return { body: body, scope: response.headers.get("x-js-listings-scope") || "all",
          revision: String(response.headers.get("x-js-listings-revision") || "") };
        var payload = null;
        try { payload = JSON.parse(body); } catch (_) {}
        var fallback = "D1 매물 데이터를 불러오지 못했습니다. (HTTP " + response.status + ")";
        throw httpError(messageFromPayload(payload, fallback), response, payload);
      });
    }, LARGE_READ_TIMEOUT, readKey("listingsCsv", {}, {cache: forceRefresh ? "reload" : "default",headers:headers}), true);
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
    return listingsSnapshot(forceRefresh).then(function(snapshot) {
      if (!snapshot.rows) return snapshot.body;
      return snapshot.rows.map(function(row) { return row.map(function(value) {
        return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
      }).join(','); }).join('\r\n');
    });
  }

  function warmInitialData() {
    if (initialWarmups.listingsCsv && initialWarmups.unifiedListings) return true;
    var cache = global.JSInitialListingsCacheV1;
    var version = cache && typeof cache.version === "function" ? cache.version() : "";
    var scope = listingsScopeV123();
    var candidate = cache && typeof cache.warm === "function" ? cache.warm() : Promise.resolve(null);
    var timeout;
    var verified = Promise.race([candidate, new Promise(function(resolve) { timeout = global.setTimeout(function() {resolve(null);},1200); })])
      .then(function(value) {
        global.clearTimeout(timeout);
        var revision = value && (value.baselineRevisionV125 || value.snapshotRevision);
        if (!value || !revision || revision === "0" ||
            !cache.usable(value) || cache.version() !== version) return null;
        return readNetwork("dataRevision",{scope:"listings",since:revision,deltaVersion:"142"},{timeoutMs:5000}).then(function(result) {
          if (cache.version() !== version || listingsScopeV123() !== scope || !cache.usable(value)) return null;
          var ids = Array.from(new Set((Array.isArray(value.confirmedIdsV125) ? value.confirmedIdsV125 : [])
            .concat(Array.isArray(result.changeIds) ? result.changeIds : [])));
          if (result.revision === revision && !ids.length) return value;
          if (!result.revision || result.revision === "0" || ids.length < 1 || ids.length > 1024 ||
              result.revision !== revision && result.fullReload !== false) return null;
          return Object.assign({},value,{deltaV125:{revision:result.revision,changeIds:ids}});
        });
      }).catch(function() { return null; });
    if (!initialWarmups.listingsCsv) {
      initialWarmups.listingsCsv = settledWarmup(verified.then(function(value) {
        return value && cache.version() === version ? {validatedCacheV125:value,cacheVersionV125:version,
          deltaV125:value.deltaV125,revision:value.baselineRevisionV125 || value.snapshotRevision,scope:scope} : listingsCsvNetwork(false);
      }));
    }
    if (!initialWarmups.unifiedListings) {
      initialWarmups.unifiedListings = settledWarmup(verified.then(function(value) {
        return value && cache.version() === version ? Object.assign({},value.unified,
          {datasetScope:scope}) : readNetwork("unifiedListings", {}, {cache:"default"});
      }));
    }
    return true;
  }

  async function readImageBlob(url, options) {
    var target = new URL(String(url || ""), global.location.href);
    if (target.origin !== global.location.origin || !/^https?:$/.test(target.protocol) || target.username || target.password) {
      throw new Error("사진 다운로드 주소를 확인하지 못했습니다.");
    }
    var response = await global.fetch(target.href, {credentials: "same-origin", signal: options && options.signal, redirect: "error"});
    if (response.status === 401 || response.status === 403) throw new Error("사진 다운로드 권한을 확인하지 못했습니다. 로그인 상태를 확인해 주세요.");
    var contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!response.ok || !/^image\//.test(contentType)) throw new Error("사진을 내려받지 못했습니다. 잠시 후 다시 눌러 주세요.");
    var limit = 12 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit) throw new Error("사진이 다운로드 크기 제한(12MB)을 초과했습니다.");
    var reader = response.body.getReader(), chunks = [], size = 0;
    try {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error("사진이 다운로드 크기 제한(12MB)을 초과했습니다.");
        }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new Error("사진 파일이 비어 있어 다운로드하지 못했습니다.");
    return {blob: new Blob(chunks, {type: contentType}), contentType: contentType};
  }

  if (typeof global.addEventListener === "function") global.addEventListener("js-listing-trade-mode-change", function() {
    delete initialWarmups.listingsCsv; delete initialWarmups.unifiedListings;
  });
  global.JSDataAccessV6 = Object.freeze({
    listingsScope: listingsScopeV123,
    endpoints: Object.freeze({ data: DATA_API, listings: LISTINGS_API }),
    read: read,
    mutate: mutate,
    readImageBlob: readImageBlob,
    listingsCsv: listingsCsv,
    listingsSnapshot: listingsSnapshot,
    warmInitialData: warmInitialData,
    invalidateRead: invalidateRead
  });
})(window);
