(function(global) {
  "use strict";
  var state = { token: 0, pending: null, controller: null, market: "", day: "", ids: null,
    revision: "", phase: "idle", message: "", count: 0, adCount: 0, manualCount: 0, originalIds: null,
    serverNow: 0, checkedAt: 0, rolloverQueued: false, dirty: false,
    partial: false, progressCount: 0, progressAdCount: 0, confirmedPages: 0, account: "" };
  function mode() { return global.JSListingTradeV1 ? global.JSListingTradeV1.getMode() : "lease"; }
  function active() { return Number(global.newListingDays || 0) === 1; }
  function account() { return String(global.JSAuthenticatedAccountEmail || "").trim().toLowerCase(); }
  function current(token, market) {
    if (token !== state.token || !active() || market !== mode()) return false;
    if (state.account !== account()) {
      cancel();
      state.ids = null;
      state.originalIds = null;
      state.phase = "error";
      state.message = "로그인 계정이 바뀌었습니다 · 새로고침 후 다시 확인해 주세요";
      state.partial = false;
      refreshView();
      return false;
    }
    return true;
  }
  function expectedDay() {
    return state.serverNow ? new Date(state.serverNow + Date.now() - state.checkedAt + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : state.day;
  }
  function expiredDay() { return Boolean(state.ids && state.day && expectedDay() !== state.day); }
  function refreshView() {
    // applyFilter renders the banner with the array it already computed.
    // Keep the fallback for older callers that do not return that array.
    if (typeof global.applyFilter === "function" && Array.isArray(global.applyFilter())) return;
    render();
  }
  function ensureCompleteBase() {
    var bridge = global.JSListingRefreshV1;
    if (bridge && typeof bridge.ensureCompleteBase === "function") bridge.ensureCompleteBase();
  }
  function banner() {
    var host = document.getElementById("activeFilterChipsV844");
    if (!host || !host.parentNode) return null;
    var node = document.getElementById("todayListingStatusV1");
    if (!node) {
      node = document.createElement("div");
      node.id = "todayListingStatusV1";
      node.className = "today-listing-status-v1";
      node.setAttribute("role", "status");
      host.parentNode.insertBefore(node, host.nextSibling);
    }
    return node;
  }
  function render(shownItems) {
    var node = banner();
    if (!node) return;
    node.hidden = !active();
    if (node.hidden) return;
    if (expiredDay() && !state.rolloverQueued) {
      state.rolloverQueued = true;
      cancel();
      state.ids = null;
      state.originalIds = null;
      state.phase = "loading";
      setTimeout(function() { state.rolloverQueued = false; if (active()) refresh(true); }, 0);
    }
    node.replaceChildren();
    var label = document.createElement("span");
    shownItems = Array.isArray(shownItems) ? shownItems
      : typeof global.getFilteredItems === "function" ? global.getFilteredItems() : [];
    var shown = shownItems.length;
    if (typeof global.updateMapListingCountV825 === "function") global.updateMapListingCountV825(shownItems);
    label.textContent = state.phase === "loading" ? "오늘 신규매물 최신 확인 중 · " +
      (state.confirmedPages ? "광고 " + state.progressAdCount + "개 · 매물 " + state.progressCount + "건 확인 · 목록 계속 확인 중" : "기존 결과 유지")
      : state.phase === "error" ? state.message + (state.ids ? " · 마지막 확인 결과 유지" : " · 최신 결과 미확인")
        : state.ids ? "오늘 신규 광고 " + state.adCount + "개 · 매물 " + state.count + "건" +
          (state.manualCount ? " · 직접등록 " + state.manualCount + "건" : "") + " · 현재 조건 " + shown + "건" : "오늘 신규매물 최신 확인 필요";
    node.appendChild(label);
    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = state.phase === "loading" ? "확인 중" : "최신 확인";
    retry.disabled = state.phase === "loading";
    retry.addEventListener("click", function() { refresh(true); });
    node.appendChild(retry);
  }
  function cancel() {
    state.token += 1;
    if (state.controller) state.controller.abort();
    state.pending = null;
    state.controller = null;
    state.dirty = false;
  }
  function validatePage(result, market, first, seenIds) {
    var perProperty = result && result.snapshotConsistency === "per-property-v1" && result.unified &&
      result.unified.snapshotConsistency === "per-property-v1";
    if (!result || result.ok === false || !Array.isArray(result.items) || !result.unified ||
        (!perProperty && (!result.snapshotRevision || result.unified.snapshotRevision !== result.snapshotRevision)) ||
        (!!result.snapshotConsistency !== !!result.unified.snapshotConsistency) ||
        (result.snapshotConsistency && !perProperty) || typeof result.hasMore !== "boolean" ||
        (perProperty && (!result.unified.sourceSnapshotKeys || !result.unified.sourceSnapshotPropertyIds)) ||
        !result.todayOriginalIds || typeof result.todayOriginalIds !== "object" || Array.isArray(result.todayOriginalIds) ||
        result.market !== market || result.days !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(result.day || "")) {
      throw new Error("오늘 신규매물 응답을 확인하지 못했습니다.");
    }
    if (result.serverNow && global.listingRegistrationDayV1(result.serverNow) !== result.day) {
      var midnight = new Error("한국 날짜가 바뀌어 오늘 신규매물을 다시 확인합니다.");
      midnight.snapshotChanged = true;
      if (perProperty) midnight.retryScope = "page";
      throw midnight;
    }
    if (first && ((!perProperty && result.snapshotRevision !== first.snapshotRevision) || result.day !== first.day ||
        result.snapshotConsistency !== first.snapshotConsistency || result.rangeStart !== first.rangeStart || result.rangeEnd !== first.rangeEnd ||
        result.unified.format !== first.unified.format || JSON.stringify(result.unified.fields) !== JSON.stringify(first.unified.fields))) {
      var changed = new Error("수집 결과가 바뀌어 다시 확인합니다.");
      changed.snapshotChanged = true;
      if (perProperty) changed.retryScope = "page";
      throw changed;
    }
    var pageIds = Object.create(null);
    result.items.forEach(function(item) {
      var id = String(item.property_id || item.id || ""), allowed = result.todayOriginalIds[id];
      if (!id || seenIds[id] || pageIds[id] || !Object.prototype.hasOwnProperty.call(result.todayOriginalIds, id) ||
          !Array.isArray(allowed) || allowed.some(function(value) { return typeof value !== "string" || !value; }) ||
          new Set(allowed).size !== allowed.length) throw new Error("오늘 신규광고의 연결을 확인하지 못했습니다.");
      pageIds[id] = true;
    });
    return perProperty;
  }
  async function readAll(market, signal, onPage) {
    var items = [], groups = {}, search = {}, proofKeys = {}, propertyIds = {}, todayOriginalIds = {},
      adCount = 0, manualCount = 0, first = null, last = null, legacyContext = null, cursor = "",
      seenCursors = Object.create(null), seenIds = Object.create(null), pageCount = 0;
    for (;;) {
      var params = { days: 1, market: market };
      if (cursor) params.cursor = cursor;
      if (first && first.snapshotConsistency !== "per-property-v1") params.revision = first.snapshotRevision;
      var result, readContext, perProperty;
      for (var pageAttempt = 0; pageAttempt < 2; pageAttempt += 1) {
        try {
          var bridge = global.JSListingRefreshV1;
          readContext = bridge && typeof bridge.captureScopedRead === "function" ? bridge.captureScopedRead() : null;
          if (!first && pageAttempt === 0) legacyContext = readContext;
          result = await global.JSDataAccessV6.read("newListingPeriod", params,
            { signal: signal, cache: "no-store", errorMessage: "오늘 신규매물 조회 실패" });
          perProperty = validatePage(result, market, first, seenIds);
          if (perProperty && onPage && !onPage(result, readContext, {count: items.length + result.items.length,
            adCount: adCount + Number(result.todayAdCount || 0), pages: pageCount + 1})) {
            var stale = new Error("변경된 매물의 최신 연결을 다시 확인합니다.");
            stale.snapshotChanged = true;
            stale.retryScope = "page";
            throw stale;
          }
          break;
        } catch (error) {
          var scope = error.retryScope || error.payload && error.payload.retryScope;
          if (signal.aborted || pageAttempt || scope !== "page") {
            if (scope === "page") error.retryScope = "page";
            throw error;
          }
        }
      }
      if (!first) first = result;
      result.items.forEach(function(item) {
        var id = String(item.property_id || item.id || "");
        var allowed = result.todayOriginalIds[id];
        seenIds[id] = true;
        todayOriginalIds[id] = allowed.slice();
        adCount += allowed.length;
        if (!allowed.length) manualCount += 1;
      });
      items = items.concat(result.items);
      Object.assign(groups, result.unified.groups || {});
      Object.assign(search, result.unified.sourceSearchIds || {});
      Object.assign(proofKeys, result.unified.sourceSnapshotKeys || {});
      Object.assign(propertyIds, result.unified.sourceSnapshotPropertyIds || {});
      last = result;
      pageCount += 1;
      if (!result.hasMore) break;
      if (!result.nextCursor || seenCursors[result.nextCursor]) throw new Error("신규매물 다음 목록을 확인하지 못했습니다.");
      seenCursors[result.nextCursor] = true;
      cursor = result.nextCursor;
    }
    return Object.assign({}, first, { items: items, hasMore: false, nextCursor: "",
      snapshotRevision: first.snapshotConsistency === "per-property-v1" ? "" : first.snapshotRevision,
      dataRevision: last && (last.dataRevision || last.snapshotRevision) || "", _readContextV1: legacyContext,
      todayOriginalIds: todayOriginalIds, todayAdCount: adCount, todayManualCount: manualCount,
      unified: Object.assign({}, first.unified, { groups: groups, sourceSearchIds: search,
        sourceSnapshotKeys: proofKeys, sourceSnapshotPropertyIds: propertyIds,
        snapshotRevision: first.snapshotConsistency === "per-property-v1" ? "" : first.unified.snapshotRevision }) });
  }
  function refresh(force, coalesced) {
    if (!active()) return Promise.resolve(false);
    var market = mode();
    if (state.pending && state.market === market) return state.pending;
    if (!force && state.ids && state.market === market) { render(); return Promise.resolve(true); }
    cancel();
    var token = state.token;
    if (state.market !== market) { state.ids = null; state.originalIds = null; state.day = ""; state.count = 0; state.adCount = 0; state.manualCount = 0; state.revision = ""; }
    state.market = market;
    state.account = account();
    state.phase = "loading";
    state.partial = false;
    state.progressCount = 0;
    state.progressAdCount = 0;
    state.confirmedPages = 0;
    state.controller = new AbortController();
    var signal = state.controller.signal;
    var expired = false;
    var deadline = setTimeout(function() { expired = true; if (token === state.token && state.controller) state.controller.abort(); }, 45000);
    refreshView();
    function applyPage(result, context, progress) {
      if (!current(token, market) || signal.aborted || !result || !Array.isArray(result.items) ||
          !result.todayOriginalIds || !global.JSListingRefreshV1 || !global.JSListingRefreshV1.applyScoped(result, context)) return false;
      if (!state.ids) state.ids = new Set();
      if (!state.originalIds) state.originalIds = Object.create(null);
      result.items.forEach(function(item) {
        var id = String(item.property_id || item.id || "");
        state.ids.add(id);
        state.originalIds[id] = new Set(result.todayOriginalIds[id] || []);
      });
      state.day = result.day;
      state.serverNow = Date.parse(result.serverNow || "") || 0;
      state.checkedAt = Date.now();
      state.revision = result.dataRevision || result.snapshotRevision || "";
      state.partial = true;
      state.progressCount = progress.count;
      state.progressAdCount = progress.adCount;
      state.confirmedPages = progress.pages;
      refreshView();
      return true;
    }
    var pending = (async function() {
      try {
        var result;
        for (var attempt = 0; attempt < 2; attempt += 1) {
          try { result = await readAll(market, signal, applyPage); break; }
          catch (error) {
            if (!current(token, market) || signal.aborted || attempt ||
                error.retryScope === "page" ||
                !(error.snapshotChanged || error.payload && error.payload.snapshotChanged)) throw error;
          }
        }
        if (!current(token, market) || signal.aborted) return false;
        if (result.snapshotConsistency !== "per-property-v1" &&
            (!global.JSListingRefreshV1 || !global.JSListingRefreshV1.applyScoped(result, result._readContextV1))) {
          throw new Error("최신 매물 반영 기능이 준비되지 않았습니다.");
        }
        state.ids = new Set(result.items.map(function(item) { return String(item.property_id || item.id || ""); }));
        state.originalIds = Object.create(null);
        Object.keys(result.todayOriginalIds).forEach(function(id) { state.originalIds[id] = new Set(result.todayOriginalIds[id]); });
        state.day = result.day;
        state.serverNow = Date.parse(result.serverNow || "") || 0;
        state.checkedAt = Date.now();
        state.revision = result.dataRevision || result.snapshotRevision || "";
        state.count = state.ids.size;
        state.adCount = result.todayAdCount;
        state.manualCount = result.todayManualCount;
        state.phase = "ready";
        state.partial = false;
        state.message = "";
        refreshView();
        return true;
      } catch (error) {
        if (!current(token, market) || signal.aborted && !expired) return false;
        state.phase = "error";
        state.message = state.confirmedPages ? "오늘 신규광고 일부만 확인했습니다 · 나머지 최신 확인 실패" : "오늘 신규매물 최신 확인 실패 · 다시 확인해 주세요";
        refreshView();
        return false;
      } finally {
        clearTimeout(deadline);
        if (token === state.token) {
          state.pending = null;
          state.controller = null;
          ensureCompleteBase();
          var followup = state.dirty && state.phase === "ready" && !coalesced;
          state.dirty = false;
          if (followup) setTimeout(function() { if (current(token, market) && !state.pending) refresh(true, true); }, 0);
        }
      }
    })();
    state.pending = pending;
    return pending;
  }
  function onPeriodChanged(days) {
    if (Number(days) !== 1) {
      cancel(); state.ids = null; state.originalIds = null; state.phase = "idle";
      ensureCompleteBase(); render(); return;
    }
    // A previously selected yesterday cluster must not override the Today list.
    // This clears only map/list focus, not favorite folders or action checkboxes.
    if (typeof global.clearMapListSelectionForNavigationV6571 === "function") global.clearMapListSelectionForNavigationV6571();
    refresh(true);
  }
  function onSnapshot(event) {
    if (!active()) return;
    var revisionChanged = !event.detail || event.detail.revision !== state.revision;
    // Global updates do not invalidate verified per-property pages. Finish the
    // bounded request, then coalesce this burst into at most one follow-up.
    if (state.pending && revisionChanged) state.dirty = true;
    // Master creation/last-seen dates cannot establish a new advertisement.
    // Retain the last verified source-ID gate until the small Today read wins.
    if (!state.pending && revisionChanged) { refresh(true); return; }
    render();
  }
  global.JSTodayListingsV1 = {
    onPeriodChanged: onPeriodChanged, refresh: refresh, render: render,
    matches: function(item) {
      if (expiredDay() || state.account !== account()) return false;
      return state.ids && state.market === mode() ? state.ids.has(String(item.propertyId || ""))
        : !item.unifiedOriginalMetadataPendingV1 && !(item.unifiedAllOriginalsV1 || []).length &&
          /직접/.test(String(item.source || "")) && global.isRegistrationWithinDays(item.regDate, 1);
    },
    matchesOriginal: function(item, original) {
      if (!active()) return true;
      var id = typeof item === "string" ? item : String(item && item.propertyId || "");
      var allowed = state.originalIds && state.originalIds[id];
      return state.account === account() && !expiredDay() && state.market === mode() && !!allowed && allowed.has(String(original && original.originalId || "")) &&
        (original.active === 1 || original.active === "1");
    },
    globalScope: function() { return active() && state.account === account() && Boolean(state.ids) && !expiredDay() && state.market === mode(); },
    state: function() { return { phase: state.phase, day: state.day, market: state.market, count: state.count,
      adCount: state.adCount, manualCount: state.manualCount, revision: state.revision, partial: state.partial,
      progressCount: state.progressCount, progressAdCount: state.progressAdCount, confirmedPages: state.confirmedPages }; },
    emptyMessage: function() {
      if (!active()) return null;
      if (state.phase === "loading") return {title: "오늘 신규광고를 확인하고 있습니다.",
        description: "광고를 순서대로 확인 중입니다. 조회가 끝나기 전에는 0건으로 확정하지 않습니다."};
      if (state.phase === "error") return {title: "오늘 신규광고 확인이 끝나지 않았습니다.",
        description: "위의 최신 확인 버튼을 눌러 나머지 광고를 다시 확인해 주세요."};
      return null;
    }
  };
  global.addEventListener("js-listing-trade-mode-change", function() {
    if (active()) refresh(true); else { cancel(); state.ids = null; state.originalIds = null; ensureCompleteBase(); render(); }
  });
  global.addEventListener("js-listings-full-snapshot", onSnapshot);
})(window);
