(function(global) {
  "use strict";
  var state = { token: 0, pending: null, controller: null, market: "", day: "", ids: null,
    revision: "", phase: "idle", message: "", count: 0, serverNow: 0, checkedAt: 0, rolloverQueued: false };
  function mode() { return global.JSListingTradeV1 ? global.JSListingTradeV1.getMode() : "lease"; }
  function active() { return Number(global.newListingDays || 0) === 1; }
  function current(token, market) { return token === state.token && active() && market === mode(); }
  function expectedDay() {
    return state.serverNow ? new Date(state.serverNow + Date.now() - state.checkedAt + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : state.day;
  }
  function expiredDay() { return Boolean(state.ids && state.day && expectedDay() !== state.day); }
  function refreshView() { if (typeof global.applyFilter === "function") global.applyFilter(); }
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
  function render() {
    var node = banner();
    if (!node) return;
    node.hidden = !active();
    if (node.hidden) return;
    if (expiredDay() && !state.rolloverQueued) {
      state.rolloverQueued = true;
      cancel();
      state.ids = null;
      state.phase = "loading";
      setTimeout(function() { state.rolloverQueued = false; if (active()) refresh(true); }, 0);
    }
    node.replaceChildren();
    var label = document.createElement("span");
    var shown = typeof global.getFilteredItems === "function" ? global.getFilteredItems().length : 0;
    label.textContent = state.phase === "loading" ? "오늘 신규매물 최신 확인 중 · 기존 결과 유지"
      : state.phase === "error" ? state.message + (state.ids ? " · 마지막 확인 결과 유지" : " · 최신 결과 미확인")
        : state.ids ? "오늘 신규 " + state.count + "건 · 현재 조건 " + shown + "건" : "오늘 신규매물 최신 확인 필요";
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
  }
  async function readAll(market, signal) {
    var items = [], groups = {}, search = {}, first = null, cursor = "", seenCursors = Object.create(null);
    for (;;) {
      var params = { days: 1, market: market };
      if (cursor) params.cursor = cursor;
      if (first) params.revision = first.snapshotRevision;
      var result = await global.JSDataAccessV6.read("newListingPeriod", params,
        { signal: signal, cache: "no-store", errorMessage: "오늘 신규매물 조회 실패" });
      if (!result || result.ok === false || !Array.isArray(result.items) || !result.unified ||
          !result.snapshotRevision || result.unified.snapshotRevision !== result.snapshotRevision ||
          result.market !== market || result.days !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(result.day || "")) {
        throw new Error("오늘 신규매물 응답을 확인하지 못했습니다.");
      }
      if (result.serverNow && global.listingRegistrationDayV1(result.serverNow) !== result.day) {
        var midnight = new Error("한국 날짜가 바뀌어 오늘 신규매물을 다시 확인합니다.");
        midnight.snapshotChanged = true;
        throw midnight;
      }
      if (first && (result.snapshotRevision !== first.snapshotRevision || result.day !== first.day ||
          result.rangeStart !== first.rangeStart || result.rangeEnd !== first.rangeEnd)) {
        var changed = new Error("수집 결과가 바뀌어 다시 확인합니다.");
        changed.snapshotChanged = true;
        throw changed;
      }
      if (!first) first = result;
      items = items.concat(result.items);
      Object.assign(groups, result.unified.groups || {});
      Object.assign(search, result.unified.sourceSearchIds || {});
      if (!result.hasMore) break;
      if (!result.nextCursor || seenCursors[result.nextCursor]) throw new Error("신규매물 다음 목록을 확인하지 못했습니다.");
      seenCursors[result.nextCursor] = true;
      cursor = result.nextCursor;
    }
    return Object.assign({}, first, { items: items, hasMore: false, nextCursor: "",
      unified: Object.assign({}, first.unified, { groups: groups, sourceSearchIds: search }) });
  }
  function refresh(force) {
    if (!active()) return Promise.resolve(false);
    var market = mode();
    if (state.pending && state.market === market) return state.pending;
    if (!force && state.ids && state.market === market) { render(); return Promise.resolve(true); }
    cancel();
    var token = state.token;
    if (state.market !== market) { state.ids = null; state.day = ""; state.count = 0; state.revision = ""; }
    state.market = market;
    state.phase = "loading";
    state.controller = new AbortController();
    var signal = state.controller.signal;
    var expired = false;
    var deadline = setTimeout(function() { expired = true; if (token === state.token && state.controller) state.controller.abort(); }, 45000);
    render();
    var pending = (async function() {
      try {
        var result;
        for (var attempt = 0; attempt < 2; attempt += 1) {
          try { result = await readAll(market, signal); break; }
          catch (error) {
            if (!current(token, market) || signal.aborted || attempt ||
                !(error.snapshotChanged || error.payload && error.payload.snapshotChanged)) throw error;
          }
        }
        if (!current(token, market) || signal.aborted) return false;
        if (!global.JSListingRefreshV1 || !global.JSListingRefreshV1.applyScoped(result)) {
          throw new Error("최신 매물 반영 기능이 준비되지 않았습니다.");
        }
        state.ids = new Set(result.items.map(function(item) { return String(item.property_id || item.id || ""); }));
        state.day = result.day;
        state.serverNow = Date.parse(result.serverNow || "") || 0;
        state.checkedAt = Date.now();
        state.revision = result.snapshotRevision;
        state.count = state.ids.size;
        state.phase = "ready";
        state.message = "";
        refreshView();
        render();
        return true;
      } catch (error) {
        if (!current(token, market) || signal.aborted && !expired) return false;
        state.phase = "error";
        state.message = "오늘 신규매물 최신 확인 실패 · 다시 확인해 주세요";
        render();
        return false;
      } finally {
        clearTimeout(deadline);
        if (token === state.token) { state.pending = null; state.controller = null; }
      }
    })();
    state.pending = pending;
    return pending;
  }
  function onPeriodChanged(days) {
    if (Number(days) !== 1) { cancel(); state.ids = null; state.phase = "idle"; render(); return; }
    // A previously selected yesterday cluster must not override the Today list.
    // This clears only map/list focus, not favorite folders or action checkboxes.
    if (typeof global.clearMapListSelectionForNavigationV6571 === "function") global.clearMapListSelectionForNavigationV6571();
    refresh(true);
  }
  function onSnapshot(event) {
    if (!active()) return;
    var revisionChanged = !event.detail || event.detail.revision !== state.revision;
    // A later complete snapshot must not be overwritten by a request started
    // before it. Recheck the small period rather than ordering opaque revisions.
    if (state.pending && revisionChanged) cancel();
    // A complete master snapshot/delta is authoritative too. Never keep a
    // previous Today ID gate after the next collection adds a new master.
    if (state.ids && state.market === mode()) {
      state.ids = new Set((global.allItems || []).filter(function(item) {
        return (!global.JSListingTradeV1 || global.JSListingTradeV1.matchesItem(item)) &&
          global.listingRegistrationDayV1(item.regDate) === state.day;
      }).map(function(item) { return String(item.propertyId || ""); }));
      state.count = state.ids.size;
      refreshView();
    }
    if (!state.pending && revisionChanged) refresh(true);
    render();
  }
  global.JSTodayListingsV1 = {
    onPeriodChanged: onPeriodChanged, refresh: refresh, render: render,
    matches: function(item) {
      if (expiredDay()) return global.listingRegistrationDayV1(item.regDate) === expectedDay();
      return state.ids && state.market === mode() ? state.ids.has(String(item.propertyId || ""))
        : global.isRegistrationWithinDays(item.regDate, 1);
    },
    globalScope: function() { return active() && Boolean(state.ids) && !expiredDay() && state.market === mode(); },
    state: function() { return { phase: state.phase, day: state.day, market: state.market, count: state.count, revision: state.revision }; }
  };
  global.addEventListener("js-listing-trade-mode-change", function() {
    if (active()) refresh(true); else { cancel(); state.ids = null; render(); }
  });
  global.addEventListener("js-listings-full-snapshot", onSnapshot);
})(window);
