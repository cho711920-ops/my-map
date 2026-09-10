/* JS부동산 v6.0 STEP1 - 찜목록 / 임장목록 관리 */
(function () {
  "use strict";

  var FAVORITE_KEY = "js_favorite_lists_v6";
  var VISIT_KEY = "js_visit_lists_v6";
  var LEGACY_MIGRATION_KEY = "js_favorite_lists_v6_migrated";
  var ACCOUNT_MARKER_KEY = "js_list_account_email_v6";
  var DIRTY_ENVELOPE_PREFIX = "js_list_sync_dirty_envelope_v1_";
  var ACTIVE_FAVORITE_FILTER_KEY = "js_active_favorite_folder_filter_v1";
  var ACTIVE_FAVORITE_HISTORY_KEY = "jsActiveFavoriteFolderFilterV1";
  var accountEmail = String(window.JSAuthenticatedAccountEmail || "").trim().toLowerCase();
  var currentManagerType = "favorite";
  var currentItemKey = "";
  var cloudSaveTimers = {};
  var cloudSaveRetries = {};
  var cloudRevisions = { favorite: 0, visit: 0 };
  var cloudVersions = { favorite: 0, visit: 0 };
  var cloudBaseLists = { favorite: [], visit: [] };
  var cloudBaseKnown = { favorite: false, visit: false };
  var pendingCloudSave = { favorite: false, visit: false };
  var memoryLists = { favorite: null, visit: null };
  var deletedListIds = { favorite: null, visit: null };
  var cloudSyncReady = false;
  var cloudSyncRunning = false;
  var cloudSyncAccountChanged = false;
  var cloudSyncAccountChangedWarningShown = false;
  var lastCloudSyncAt = 0;
  var dirtyEnvelopeWarnings = {};

  function getSelectedItemKeys() {
    var keys = Array.isArray(window.selectedPrintKeys) ? window.selectedPrintKeys : [];
    return keys.filter(function (key, index) {
      return key && keys.indexOf(key) === index;
    });
  }

  function showListToast(message, tone) {
    var toast = document.getElementById("v6ListToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "v6ListToast";
      toast.className = "v6-list-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.className = "v6-list-toast " + (tone || "success");
    toast.textContent = message;
    window.clearTimeout(showListToast._timer);
    requestAnimationFrame(function () { toast.classList.add("show"); });
    showListToast._timer = window.setTimeout(function () {
      toast.classList.remove("show");
    }, 2800);
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function storageKey(type) {
    return scopedKey(type === "visit" ? VISIT_KEY : FAVORITE_KEY);
  }

  function scopedKey(base) {
    return accountEmail ? base + "::" + encodeURIComponent(accountEmail) : base;
  }

  function activeFavoriteFilterState() {
    var state = null;
    try {
      var historyState = window.history && window.history.state;
      state = historyState && historyState[ACTIVE_FAVORITE_HISTORY_KEY];
    } catch (_) {}
    if (!state) {
      try { state = JSON.parse(window.sessionStorage.getItem(ACTIVE_FAVORITE_FILTER_KEY) || "null"); } catch (_) {}
    }
    if (!state || typeof state !== "object" || !String(state.folderId || "").trim()) return null;
    var stateEmail = String(state.accountEmail || "").trim().toLowerCase();
    if (accountEmail && stateEmail && stateEmail !== accountEmail) return null;
    return {
      accountEmail: stateEmail,
      folderId: String(state.folderId).trim()
    };
  }

  function writeActiveFavoriteFilterState(list) {
    var value = list ? {
      accountEmail: accountEmail || String(window.JSListAccountEmail || "").trim().toLowerCase(),
      folderId: String(list.id || "").trim()
    } : null;
    try {
      if (value) window.sessionStorage.setItem(ACTIVE_FAVORITE_FILTER_KEY, JSON.stringify(value));
      else window.sessionStorage.removeItem(ACTIVE_FAVORITE_FILTER_KEY);
    } catch (_) {}
    try {
      if (!window.history || typeof window.history.replaceState !== "function") return;
      var nextHistoryState = Object.assign({}, window.history.state || {});
      if (value) nextHistoryState[ACTIVE_FAVORITE_HISTORY_KEY] = value;
      else delete nextHistoryState[ACTIVE_FAVORITE_HISTORY_KEY];
      window.history.replaceState(nextHistoryState, document.title);
    } catch (_) {}
  }

  function clearActiveFavoriteFolderFilter(options) {
    options = options || {};
    window.activeFavoriteFolderId = "";
    window.activeFavoriteFolderName = "";
    window.favoriteFilterKeys = [];
    if (options.disableFilter !== false) window.favoriteOnly = false;
    writeActiveFavoriteFilterState(null);
    var button = document.getElementById("favoriteBtn");
    if (button && options.disableFilter !== false) button.classList.remove("on");
    if (!options.silent && typeof window.applyFilter === "function") window.applyFilter();
  }

  function activateFavoriteFolderFilter(list, options) {
    options = options || {};
    if (!list || !String(list.id || "").trim()) {
      clearActiveFavoriteFolderFilter(options);
      return false;
    }
    window.activeFavoriteFolderId = String(list.id).trim();
    window.activeFavoriteFolderName = String(list.name || "찜폴더").trim() || "찜폴더";
    window.favoriteFilterKeys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
    window.favoriteOnly = true;
    writeActiveFavoriteFilterState(list);
    var button = document.getElementById("favoriteBtn");
    if (button) button.classList.add("on");
    if (!options.silent && typeof window.applyFilter === "function") window.applyFilter();
    return true;
  }

  function restoreActiveFavoriteFolderFilter(lists, options) {
    options = options || {};
    lists = Array.isArray(lists) ? lists : loadLists("favorite");
    var folderId = String(window.activeFavoriteFolderId || "").trim();
    var savedState = activeFavoriteFilterState();
    if (!folderId && savedState) folderId = savedState.folderId;
    if (!folderId) return false;
    var list = lists.find(function(entry) { return String(entry && entry.id || "") === folderId; });
    if (!list) {
      clearActiveFavoriteFolderFilter({ silent: options.silent, disableFilter: true });
      return false;
    }
    return activateFavoriteFolderFilter(list, { silent: options.silent });
  }

  function migrationKey() {
    return scopedKey(LEGACY_MIGRATION_KEY);
  }

  function typeLabel(type) {
    return type === "visit" ? "임장" : "찜";
  }

  function loadLists(type) {
    type = type === "visit" ? "visit" : "favorite";
    if (Array.isArray(memoryLists[type])) return memoryLists[type];
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey(type)) || "[]");
      memoryLists[type] = Array.isArray(parsed) ? parsed : [];
      return memoryLists[type];
    } catch (error) {
      console.error("목록 불러오기 실패", error);
      memoryLists[type] = [];
      return memoryLists[type];
    }
  }

  function dirtyKey(type) {
    return scopedKey("js_list_sync_dirty_v6_" + type);
  }

  function dirtyEnvelopeKey(type) {
    type = type === "visit" ? "visit" : "favorite";
    return accountEmail ? scopedKey(DIRTY_ENVELOPE_PREFIX + type) : "";
  }

  function sanitizeListsForDirtyEnvelope(lists) {
    return copyLists(lists).map(function(list) {
      if (!list || typeof list !== "object" || !String(list.id || "").trim()) return null;
      var sanitized = { id: String(list.id).slice(0, 160) };
      ["name", "createdAt", "updatedAt"].forEach(function(field) {
        if (Object.prototype.hasOwnProperty.call(list, field)) sanitized[field] = String(list[field] == null ? "" : list[field]).slice(0, 500);
      });
      if (Object.prototype.hasOwnProperty.call(list, "itemKeys")) {
        sanitized.itemKeys = (Array.isArray(list.itemKeys) ? list.itemKeys : []).map(function(key) {
          return String(key || "").slice(0, 240);
        }).filter(function(key, index, keys) { return key && keys.indexOf(key) === index; }).slice(0, 10000);
      }
      if (Object.prototype.hasOwnProperty.call(list, "migratedFromVisit")) {
        sanitized.migratedFromVisit = !!list.migratedFromVisit;
      }
      return sanitized;
    }).filter(Boolean).slice(0, 1000);
  }

  function readListDirtyEnvelope(type) {
    type = type === "visit" ? "visit" : "favorite";
    var key = dirtyEnvelopeKey(type);
    if (!key) return null;
    try {
      var envelope = JSON.parse(localStorage.getItem(key) || "null");
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
      if (String(envelope.accountEmail || "").trim().toLowerCase() !== accountEmail || envelope.type !== type) return null;
      if (!Array.isArray(envelope.snapshot) || !Array.isArray(envelope.base)) return null;
      return {
        snapshot: sanitizeListsForDirtyEnvelope(envelope.snapshot),
        base: sanitizeListsForDirtyEnvelope(envelope.base),
        baseKnown: envelope.baseKnown === true,
        version: Math.max(0, Number(envelope.version) || 0)
      };
    } catch (_) {
      return null;
    }
  }

  function writeListDirtyEnvelope(type, lists) {
    type = type === "visit" ? "visit" : "favorite";
    var key = dirtyEnvelopeKey(type);
    if (!key) return false;
    var existing = readListDirtyEnvelope(type);
    var baseKnown = !!cloudBaseKnown[type];
    var base = cloudBaseLists[type];
    var version = Math.max(0, Number(cloudVersions[type]) || 0);
    // Before the first cloud read on a reloaded page, retain the durable merge
    // ancestor instead of replacing it with the empty in-memory defaults.
    if (!baseKnown && existing && existing.baseKnown) {
      baseKnown = true;
      base = existing.base;
      version = existing.version;
    }
    try {
      localStorage.setItem(key, JSON.stringify({
        accountEmail: accountEmail,
        type: type,
        snapshot: sanitizeListsForDirtyEnvelope(lists),
        base: sanitizeListsForDirtyEnvelope(base),
        baseKnown: baseKnown,
        version: version,
        savedAt: nowIso()
      }));
      return true;
    } catch (error) {
      if (!dirtyEnvelopeWarnings[type]) {
        dirtyEnvelopeWarnings[type] = true;
        console.warn(typeLabel(type) + "목록의 미동기화 복구본을 기기에 저장하지 못했습니다.", error);
      }
      return false;
    }
  }

  function clearListDirtyEnvelope(type) {
    var key = dirtyEnvelopeKey(type);
    if (!key) return;
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function hasListDirtyEnvelope(type) {
    var key = dirtyEnvelopeKey(type);
    if (!key) return false;
    try { return localStorage.getItem(key) != null; } catch (_) { return false; }
  }

  function deletedKey(type) {
    return scopedKey("js_list_deleted_ids_v6_" + type);
  }

  function copyLegacyAccountStorage(email) {
    var previousEmail = "";
    try { previousEmail = String(localStorage.getItem(ACCOUNT_MARKER_KEY) || "").trim().toLowerCase(); } catch (_) {}
    accountEmail = email;
    window.JSListAccountEmail = email;

    if (!previousEmail) {
      [
        FAVORITE_KEY,
        VISIT_KEY,
        LEGACY_MIGRATION_KEY,
        "js_list_sync_dirty_v6_favorite",
        "js_list_sync_dirty_v6_visit",
        "js_list_deleted_ids_v6_favorite",
        "js_list_deleted_ids_v6_visit"
      ].forEach(function(base) {
        try {
          if (localStorage.getItem(scopedKey(base)) == null && localStorage.getItem(base) != null) {
            localStorage.setItem(scopedKey(base), localStorage.getItem(base));
          }
        } catch (_) {}
      });

      // The unscoped cache may contain favorites created on this browser before
      // account-aware storage was introduced. Mark copied lists dirty so they
      // are merged with (instead of replaced by) an existing cloud snapshot.
      ["favorite", "visit"].forEach(function(type) {
        try {
          var base = type === "visit" ? VISIT_KEY : FAVORITE_KEY;
          var copied = JSON.parse(localStorage.getItem(scopedKey(base)) || "[]");
          if (Array.isArray(copied) && copied.length) {
            localStorage.setItem(dirtyKey(type), "1");
          }
        } catch (_) {}
      });
    }

    if (previousEmail && previousEmail !== email) {
      memoryLists = { favorite: null, visit: null };
      deletedListIds = { favorite: null, visit: null };
      cloudRevisions = { favorite: 0, visit: 0 };
      cloudVersions = { favorite: 0, visit: 0 };
      cloudBaseLists = { favorite: [], visit: [] };
      cloudBaseKnown = { favorite: false, visit: false };
      pendingCloudSave = { favorite: false, visit: false };
      try { localStorage.setItem("favoriteKeys", "[]"); } catch (_) {}
      window.favoriteKeys = [];
      clearActiveFavoriteFolderFilter({ silent: true, disableFilter: true });
    }
    try { localStorage.setItem(ACCOUNT_MARKER_KEY, email); } catch (_) {}
  }

  async function prepareAccountStorage() {
    try {
      var response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      var result = await response.json();
      var email = String(result && result.email || "").trim().toLowerCase();
      if (email) copyLegacyAccountStorage(email);
    } catch (error) {
      console.warn("계정별 찜 저장소 확인을 건너뜁니다.", error);
    }
  }

  function loadDeletedIds(type) {
    type = type === "visit" ? "visit" : "favorite";
    if (deletedListIds[type] && typeof deletedListIds[type] === "object") return deletedListIds[type];
    try {
      var parsed = JSON.parse(localStorage.getItem(deletedKey(type)) || "{}");
      deletedListIds[type] = parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      deletedListIds[type] = {};
    }
    return deletedListIds[type];
  }

  function persistDeletedIds(type) {
    try { localStorage.setItem(deletedKey(type), JSON.stringify(loadDeletedIds(type))); } catch (_) {}
  }

  function markDeletedListId(type, id) {
    id = String(id || "").trim();
    if (!id) return;
    loadDeletedIds(type)[id] = Date.now();
    persistDeletedIds(type);
  }

  function hasDeletedListIds(type) {
    return Object.keys(loadDeletedIds(type)).length > 0;
  }

  function excludeDeletedLists(type, lists, remoteDeletedIds) {
    var deleted = Object.assign({}, remoteDeletedIds || {}, loadDeletedIds(type));
    return (Array.isArray(lists) ? lists : []).filter(function(list) {
      return !list || !list.id || !deleted[String(list.id)];
    });
  }

  function clearAcknowledgedDeletedIds(type, sentDeletedIds, acknowledgedDeletedIds) {
    sentDeletedIds = sentDeletedIds && typeof sentDeletedIds === "object" ? sentDeletedIds : {};
    acknowledgedDeletedIds = acknowledgedDeletedIds && typeof acknowledgedDeletedIds === "object" ? acknowledgedDeletedIds : {};
    var deleted = loadDeletedIds(type);
    Object.keys(sentDeletedIds).forEach(function(id) {
      var sentAt = Number(sentDeletedIds[id]) || 0;
      var currentAt = Number(deleted[id]) || 0;
      var acknowledgedAt = Number(acknowledgedDeletedIds[id]) || 0;
      // Only clear the exact tombstone included in this acknowledged request.
      // A newer deletion created while the save was in flight must remain dirty.
      if (sentAt > 0 && currentAt === sentAt && acknowledgedAt >= sentAt) delete deleted[id];
    });
    persistDeletedIds(type);
  }

  function isCloudDirty(type) {
    try {
      return pendingCloudSave[type] || localStorage.getItem(dirtyKey(type)) === "1" || hasListDirtyEnvelope(type);
    } catch (_) {
      return !!pendingCloudSave[type];
    }
  }

  function saveLists(type, lists, options) {
    options = options || {};
    type = type === "visit" ? "visit" : "favorite";
    lists = Array.isArray(lists) ? lists : [];
    memoryLists[type] = lists;
    try {
      localStorage.setItem(storageKey(type), JSON.stringify(lists));
      if (type === "favorite") syncLegacyFavoriteKeys(lists);
    } catch (error) {
      console.warn(typeLabel(type) + "목록 기기 저장을 건너뛰고 계정 동기화를 계속합니다.", error);
    }
    try {
      window.dispatchEvent(new CustomEvent("js-v6-list-store-change", {
        detail: { type: type, remote: !!options.remote }
      }));
    } catch (_) {}
    if (options.remote) return true;
    cloudRevisions[type] = Number(cloudRevisions[type] || 0) + 1;
    try { localStorage.setItem(dirtyKey(type), "1"); } catch (_) {}
    scheduleCloudSave(type, lists);
    return true;
  }

  function cloudScope(type) {
    return type === "visit" ? "visitLists" : "favorites";
  }

  function readCloudData(action, params) {
    if (!window.JSDataAccessV6 || typeof window.JSDataAccessV6.read !== "function") {
      return Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    }
    var scopedParams = Object.assign({}, params || {}, { expectedAccountEmail: accountEmail });
    return window.JSDataAccessV6.read(action, scopedParams, {
      errorMessage: "목록 동기화에 실패했습니다."
    });
  }

  function mutateCloudData(action, payload) {
    if (!window.JSDataAccessV6 || typeof window.JSDataAccessV6.mutate !== "function") {
      return Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    }
    var scopedPayload = Object.assign({}, payload || {}, { expectedAccountEmail: accountEmail });
    return window.JSDataAccessV6.mutate(action, scopedPayload, {
      errorMessage: "목록 저장에 실패했습니다."
    });
  }

  function mergeCloudAndLocalLists(remoteLists, localLists) {
    var mergedById = {};
    var order = [];
    function put(list, preferOnTie) {
      if (!list || !list.id) return;
      var id = String(list.id);
      var current = mergedById[id];
      if (!current) order.push(id);
      var currentTime = current ? Date.parse(current.updatedAt || current.createdAt || 0) || 0 : -1;
      var incomingTime = Date.parse(list.updatedAt || list.createdAt || 0) || 0;
      if (!current || incomingTime > currentTime || (preferOnTie && incomingTime === currentTime)) {
        mergedById[id] = list;
      }
    }
    (remoteLists || []).forEach(function(list) { put(list, false); });
    (localLists || []).forEach(function(list) { put(list, true); });
    return order.map(function(id) { return mergedById[id]; }).filter(Boolean);
  }

  function copyLists(lists) {
    try { return JSON.parse(JSON.stringify(Array.isArray(lists) ? lists : [])); }
    catch (_) { return []; }
  }

  function listMap(lists) {
    var map = {};
    (Array.isArray(lists) ? lists : []).forEach(function(list) {
      if (list && list.id) map[String(list.id)] = list;
    });
    return map;
  }

  function listSame(left, right) {
    return JSON.stringify(left || null) === JSON.stringify(right || null);
  }

  function mergeItemKeysThreeWay(base, local, remote) {
    var baseKeys = Array.isArray(base && base.itemKeys) ? base.itemKeys : [];
    var localKeys = Array.isArray(local && local.itemKeys) ? local.itemKeys : [];
    var remoteKeys = Array.isArray(remote && remote.itemKeys) ? remote.itemKeys : [];
    var order = [];
    var seen = {};
    [remoteKeys, localKeys, baseKeys].forEach(function(keys) {
      keys.forEach(function(key) {
        key = String(key || "");
        if (key && !seen[key]) { seen[key] = true; order.push(key); }
      });
    });
    return order.filter(function(key) {
      var baseHas = baseKeys.indexOf(key) !== -1;
      var localHas = localKeys.indexOf(key) !== -1;
      var remoteHas = remoteKeys.indexOf(key) !== -1;
      if (localHas === baseHas) return remoteHas;
      if (remoteHas === baseHas) return localHas;
      return localHas;
    });
  }

  function listFieldSame(leftHas, leftValue, rightHas, rightValue) {
    if (leftHas !== rightHas) return false;
    return !leftHas || JSON.stringify(leftValue) === JSON.stringify(rightValue);
  }

  function mergeListFieldThreeWay(field, base, local, remote, preferRemote) {
    var baseHas = !!base && Object.prototype.hasOwnProperty.call(base, field);
    var localHas = Object.prototype.hasOwnProperty.call(local, field);
    var remoteHas = Object.prototype.hasOwnProperty.call(remote, field);
    var baseValue = baseHas ? base[field] : undefined;
    var localValue = localHas ? local[field] : undefined;
    var remoteValue = remoteHas ? remote[field] : undefined;
    var localChanged = !listFieldSame(localHas, localValue, baseHas, baseValue);
    var remoteChanged = !listFieldSame(remoteHas, remoteValue, baseHas, baseValue);
    if (!localChanged && remoteChanged) return { present: remoteHas, value: remoteValue };
    if (localChanged && !remoteChanged) return { present: localHas, value: localValue };
    if (!localChanged && !remoteChanged) return { present: baseHas, value: baseValue };
    if (listFieldSame(localHas, localValue, remoteHas, remoteValue)) {
      return { present: localHas, value: localValue };
    }
    return preferRemote
      ? { present: remoteHas, value: remoteValue }
      : { present: localHas, value: localValue };
  }

  function mergeCloudListRecord(base, local, remote) {
    var localTime = Date.parse(local.updatedAt || local.createdAt || 0) || 0;
    var remoteTime = Date.parse(remote.updatedAt || remote.createdAt || 0) || 0;
    var preferRemote = remoteTime > localTime;
    var merged = {};
    var fields = Object.keys(Object.assign({}, base || {}, remote, local));
    fields.forEach(function(field) {
      if (field === "id" || field === "itemKeys" || field === "updatedAt") return;
      var fieldResult = mergeListFieldThreeWay(field, base, local, remote, preferRemote);
      if (fieldResult.present) merged[field] = fieldResult.value;
    });
    merged.id = String(local.id || remote.id || (base && base.id) || "");
    merged.itemKeys = mergeItemKeysThreeWay(base, local, remote);
    merged.updatedAt = preferRemote ? remote.updatedAt : local.updatedAt;
    return merged;
  }

  function mergeCloudListsThreeWay(remoteLists, localLists, baseLists) {
    var remoteById = listMap(remoteLists);
    var localById = listMap(localLists);
    var baseById = listMap(baseLists);
    var ids = [];
    [remoteLists, localLists, baseLists].forEach(function(lists) {
      (lists || []).forEach(function(list) {
        var id = list && String(list.id || "");
        if (id && ids.indexOf(id) === -1) ids.push(id);
      });
    });
    return ids.map(function(id) {
      var remote = remoteById[id];
      var local = localById[id];
      var base = baseById[id];
      if (!local) return remote || null;
      if (!remote) return local || null;
      if (!base) return mergeCloudListRecord(null, local, remote);
      if (listSame(local, base)) return remote;
      if (listSame(remote, base)) return local;
      return mergeCloudListRecord(base, local, remote);
    }).filter(Boolean);
  }

  function isCloudAccountChangedError(error) {
    return Number(error && error.status) === 409 &&
      String(error && error.payload && error.payload.code || "").toLowerCase() === "account_changed";
  }

  function stopCloudSyncForAccountChange(error) {
    if (!isCloudAccountChangedError(error)) return false;
    cloudSyncAccountChanged = true;
    cloudSyncReady = false;
    ["favorite", "visit"].forEach(function(type) {
      window.clearTimeout(cloudSaveTimers[type]);
      cloudSaveTimers[type] = 0;
      if (isCloudDirty(type)) pendingCloudSave[type] = true;
    });
    if (!cloudSyncAccountChangedWarningShown) {
      cloudSyncAccountChangedWarningShown = true;
      showListToast((error.payload && error.payload.message) || "로그인 계정이 변경되었습니다. 새로고침 후 다시 로그인해 주세요.", "warning");
    }
    return true;
  }

  function scheduleCloudSave(type, lists) {
    pendingCloudSave[type] = true;
    writeListDirtyEnvelope(type, Array.isArray(lists) ? lists : loadLists(type));
    if (!cloudSyncReady || cloudSyncAccountChanged) return;
    window.clearTimeout(cloudSaveTimers[type]);
    cloudSaveTimers[type] = window.setTimeout(function () {
      flushCloudSave(type, Array.isArray(lists) ? lists : loadLists(type), 0);
    }, 250);
  }

  function scheduleCloudSaveRetry(type, attempt) {
    var nextAttempt = Math.min(Number(attempt || 0) + 1, 4);
    cloudSaveRetries[type] = nextAttempt;
    pendingCloudSave[type] = true;
    writeListDirtyEnvelope(type, loadLists(type));
    if (cloudSyncAccountChanged) return;
    var exhausted = nextAttempt >= 4;
    if (exhausted) {
      showListToast(typeLabel(type) + "목록은 이 기기에 안전하게 저장됐습니다. 계정 동기화는 자동 재시도합니다.", "warning");
    }
    window.clearTimeout(cloudSaveTimers[type]);
    cloudSaveTimers[type] = window.setTimeout(function() {
      flushCloudSave(type, loadLists(type), exhausted ? 0 : nextAttempt);
    }, exhausted ? 30000 : [0, 900, 2500, 6000][nextAttempt]);
  }

  function flushCloudSave(type, lists, attempt) {
    if (cloudSyncAccountChanged) return Promise.resolve();
    var snapshot = JSON.stringify(lists || []);
    var revision = Number(cloudRevisions[type] || 0);
    var expectedVersion = Number(cloudVersions[type] || 0);
    var sentDeletedIds = Object.assign({}, loadDeletedIds(type));
    mutateCloudData("saveCloudState", {
        scope: cloudScope(type),
        recordKey: "default",
        data: lists,
        deletedIds: sentDeletedIds,
        expectedVersion: expectedVersion
      }).then(function(result) {
        if (!result || result.ok === false) throw new Error(result && result.message || "저장 응답 오류");
        cloudVersions[type] = Math.max(0, Number(result.version) || 0);
        cloudBaseLists[type] = copyLists(Array.isArray(result.data) ? result.data : lists);
        cloudBaseKnown[type] = true;
        cloudSaveRetries[type] = 0;
        pendingCloudSave[type] = false;
        clearAcknowledgedDeletedIds(type, sentDeletedIds, result.deletedIds);
        if (revision === Number(cloudRevisions[type] || 0) && snapshot === JSON.stringify(loadLists(type))) {
          cloudRevisions[type] = 0;
          if (Array.isArray(result.data)) saveLists(type, result.data, { remote: true });
          try { localStorage.removeItem(dirtyKey(type)); } catch (_) {}
          clearListDirtyEnvelope(type);
          return;
        }
        writeListDirtyEnvelope(type, loadLists(type));
        scheduleCloudSave(type, loadLists(type));
      }).catch(function(error) {
        if (stopCloudSyncForAccountChange(error)) return;
        if (Number(error && error.status) === 409) {
          pendingCloudSave[type] = true;
          if (Number(attempt || 0) >= 4) {
            showListToast(typeLabel(type) + "목록이 다른 기기에서도 계속 변경되고 있습니다. 잠시 후 다시 합칩니다.", "warning");
            window.clearTimeout(cloudSaveTimers[type]);
            cloudSaveTimers[type] = window.setTimeout(syncListsFromCloud, 30000);
            return;
          }
          return readCloudData("loadCloudState", {
            scope: cloudScope(type),
            recordKey: "default"
          }).then(function(latest) {
            var remote = excludeDeletedLists(type, latest.found && Array.isArray(latest.data) ? latest.data : [], latest.deletedIds);
            var local = excludeDeletedLists(type, loadLists(type), latest.deletedIds);
            var base = excludeDeletedLists(type, cloudBaseLists[type], latest.deletedIds);
            var merged = mergeCloudListsThreeWay(remote, local, base);
            cloudVersions[type] = Math.max(0, Number(latest.version) || 0);
            cloudBaseLists[type] = copyLists(remote);
            cloudBaseKnown[type] = true;
            saveLists(type, merged, { remote: true });
            writeListDirtyEnvelope(type, merged);
            flushCloudSave(type, merged, Math.min(Number(attempt || 0) + 1, 4));
          }).catch(function(conflictError) {
            if (stopCloudSyncForAccountChange(conflictError)) return;
            console.warn(typeLabel(type) + "목록 충돌 병합 실패", conflictError);
            scheduleCloudSaveRetry(type, attempt);
          });
        }
        console.warn(typeLabel(type) + "목록 동기화 실패", error);
        writeListDirtyEnvelope(type, loadLists(type));
        scheduleCloudSaveRetry(type, attempt);
      });
  }

  async function loadCloudLists(type) {
    var revisionAtStart = Number(cloudRevisions[type] || 0);
    var durableAtStart = readListDirtyEnvelope(type);
    var dirtyAtStart = !!durableAtStart || isCloudDirty(type) || pendingCloudSave[type] || revisionAtStart > 0 || hasDeletedListIds(type);
    var baseAtStart = durableAtStart ? copyLists(durableAtStart.base) : copyLists(cloudBaseLists[type]);
    var baseKnownAtStart = durableAtStart ? !!durableAtStart.baseKnown : !!cloudBaseKnown[type];
    var result = await readCloudData("loadCloudState", {
      scope: cloudScope(type),
      recordKey: "default"
    });
    cloudVersions[type] = Math.max(0, Number(result.version) || 0);
    var revisionChanged = revisionAtStart !== Number(cloudRevisions[type] || 0);
    var localSnapshot = durableAtStart && !revisionChanged
      ? durableAtStart.snapshot
      : loadLists(type);
    var local = excludeDeletedLists(type, localSnapshot, result.deletedIds);
    if (result.found && Array.isArray(result.data)) {
      var remoteLists = excludeDeletedLists(type, result.data, result.deletedIds);
      cloudBaseLists[type] = copyLists(remoteLists);
      cloudBaseKnown[type] = true;
      if (dirtyAtStart || revisionChanged) {
        var merged = baseKnownAtStart
          ? mergeCloudListsThreeWay(remoteLists, local, excludeDeletedLists(type, baseAtStart, result.deletedIds))
          : mergeCloudListsThreeWay(remoteLists, local, []);
        saveLists(type, merged, { remote: true });
        try { localStorage.setItem(dirtyKey(type), "1"); } catch (_) {}
        writeListDirtyEnvelope(type, merged);
        return { found: true, needsPush: true };
      }
      saveLists(type, remoteLists, { remote: true });
      return { found: true, needsPush: false };
    }
    cloudBaseLists[type] = [];
    cloudBaseKnown[type] = true;
    if (dirtyAtStart || revisionChanged || local.length > 0 || hasDeletedListIds(type)) {
      writeListDirtyEnvelope(type, local);
      return { found: false, needsPush: true };
    }
    return { found: false, needsPush: false };
  }

  async function syncListsFromCloud() {
    if (cloudSyncRunning || cloudSyncAccountChanged) return;
    cloudSyncRunning = true;
    lastCloudSyncAt = Date.now();
    try {
      var found = await Promise.all([loadCloudLists("favorite"), loadCloudLists("visit")]);
      cloudSyncReady = true;
      if (found[0].needsPush || pendingCloudSave.favorite || isCloudDirty("favorite")) scheduleCloudSave("favorite", loadLists("favorite"));
      if (found[1].needsPush || pendingCloudSave.visit || isCloudDirty("visit")) scheduleCloudSave("visit", loadLists("visit"));
      if (typeof window.applyFilter === "function") window.applyFilter();
    } catch (error) {
      if (stopCloudSyncForAccountChange(error)) return;
      cloudSyncReady = true;
      console.warn("로그인 계정 목록 동기화 실패", error);
      if (pendingCloudSave.favorite || isCloudDirty("favorite")) scheduleCloudSave("favorite", loadLists("favorite"));
      if (pendingCloudSave.visit || isCloudDirty("visit")) scheduleCloudSave("visit", loadLists("visit"));
    } finally {
      cloudSyncRunning = false;
    }
  }

  function syncListsWhenDeviceResumes() {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    restoreActiveFavoriteFolderFilter(loadLists("favorite"), { silent: true });
    if (Date.now() - lastCloudSyncAt < 15000) return;
    syncListsFromCloud();
  }

  function syncLegacyFavoriteKeys(lists) {
    var union = [];
    lists.forEach(function (list) {
      (list.itemKeys || []).forEach(function (key) {
        if (union.indexOf(key) === -1) union.push(key);
      });
    });
    window.favoriteKeys = union;
    try {
      localStorage.setItem("favoriteKeys", JSON.stringify(union));
    } catch (error) {
      console.warn("기존 찜 표시용 기기 저장을 건너뜁니다.", error);
    }
    restoreActiveFavoriteFolderFilter(lists, { silent: true });
  }

  function migrateLegacyFavorites() {
    var migrationComplete = false;
    try { migrationComplete = localStorage.getItem(migrationKey()) === "1"; } catch (_) {}
    if (migrationComplete) {
      syncLegacyFavoriteKeys(loadLists("favorite"));
      return;
    }

    var lists = loadLists("favorite");
    var legacy = [];
    try {
      legacy = JSON.parse(localStorage.getItem("favoriteKeys") || "[]");
      if (!Array.isArray(legacy)) legacy = [];
    } catch (error) {
      legacy = [];
    }

    if (legacy.length) {
      var defaultList = lists.find(function (list) { return list.name === "관심매물"; });
      if (!defaultList) {
        defaultList = {
          id: uid("fav"),
          name: "관심매물",
          itemKeys: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        lists.unshift(defaultList);
      }
      legacy.forEach(function (key) {
        if (defaultList.itemKeys.indexOf(key) === -1) defaultList.itemKeys.push(key);
      });
      defaultList.updatedAt = nowIso();
    }

    if (legacy.length) saveLists("favorite", lists);
    else syncLegacyFavoriteKeys(lists);
    try { localStorage.setItem(migrationKey(), "1"); } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getItem(key) {
    if (!Array.isArray(window.allItems)) return null;
    var propertyPrefix = "property:";
    var propertyId = String(key || "").indexOf(propertyPrefix) === 0
      ? String(key).slice(propertyPrefix.length)
      : "";
    if (propertyId) {
      return window.allItems.find(function (item) {
        return String(item && item.propertyId || "") === propertyId;
      }) || null;
    }
    return window.allItems.find(function (item) { return item.key === key; }) || null;
  }

  function itemSummary(item) {
    if (!item) return "삭제되었거나 불러오지 못한 매물";
    var title = item.name || item.address || "매물";
    var sub = [item.address, item.room].filter(Boolean).join(" · ");
    var price = "보증금 " + (item.deposit || "-") + " / 월세 " + (item.rent || "-");
    return '<div class="lm-item-title">' + escapeHtml(title) + '</div>' +
      '<div class="lm-item-sub">' + escapeHtml(sub) + '</div>' +
      '<div class="lm-item-price">' + escapeHtml(price) + '</div>';
  }

  function ensureModal() {
    if (document.getElementById("listManagerModal")) return;
    var wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<div id="listManagerModal" class="lm-modal" aria-hidden="true">' +
        '<div class="lm-backdrop" aria-hidden="true" onclick="closeListManager()"></div>' +
        '<div class="lm-dialog" role="dialog" aria-modal="true" aria-labelledby="lmTitle">' +
          '<div class="lm-header">' +
            '<div><div id="lmTitle" class="lm-title"></div><div id="lmSubtitle" class="lm-subtitle"></div></div>' +
            '<button class="lm-close" type="button" aria-label="목록 닫기" onclick="closeListManager()">×</button>' +
          '</div>' +
          '<div id="lmBody" class="lm-body"></div>' +
        '</div>' +
      '</div>' +
      '<div id="itemListPickerModal" class="lm-modal" aria-hidden="true">' +
        '<div class="lm-backdrop" aria-hidden="true" onclick="closeItemListPicker()"></div>' +
        '<div class="lm-dialog lm-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="lmPickerTitle">' +
          '<div class="lm-header">' +
            '<div><div id="lmPickerTitle" class="lm-title"></div><div id="lmPickerSubtitle" class="lm-subtitle"></div></div>' +
            '<button class="lm-close" type="button" aria-label="목록 선택 닫기" onclick="closeItemListPicker()">×</button>' +
          '</div>' +
          '<div id="lmPickerBody" class="lm-body"></div>' +
          '<div id="lmPickerFooter" class="lm-footer"><button class="lm-primary" type="button" onclick="closeItemListPicker()">완료</button></div>' +
        '</div>' +
      '</div>';
    while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);
    ["listManagerModal", "itemListPickerModal"].forEach(function (id) {
      var modal = document.getElementById(id);
      if (!modal) return;
      modal.addEventListener("keydown", function (event) {
        if (!modal.classList.contains("open") || !window.JSDialogFocusV1) return;
        window.JSDialogFocusV1.handleKeydown(modal, event, function () {
          if (id === "listManagerModal") window.closeListManager();
          else window.closeItemListPicker();
        });
      });
    });
  }

  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("lm-modal-open");
    if (window.JSDialogFocusV1) {
      window.JSDialogFocusV1.activate(modal,
        modal.querySelector("input:not([disabled]), .lm-destination, .lm-close"));
    }
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    var wasOpen = modal.classList.contains("open");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".lm-modal.open")) document.body.classList.remove("lm-modal-open");
    if (wasOpen && window.JSDialogFocusV1) window.JSDialogFocusV1.deactivate(modal);
  }

  function promptListName(type, currentName) {
    var label = typeLabel(type);
    var name = window.prompt(label + "목록 이름을 입력해주세요.", currentName || "");
    if (name == null) return null;
    name = name.trim();
    if (!name) {
      alert("목록 이름을 입력해주세요.");
      return null;
    }
    return name;
  }

  function createList(type, initialItemKey, providedName) {
    var name = providedName == null ? promptListName(type, "") : String(providedName || "").trim();
    if (providedName != null && !name) {
      showListToast("목록 이름을 입력해주세요.", "warning");
      return null;
    }
    if (!name) return null;
    var lists = loadLists(type);
    if (lists.some(function (list) { return list.name === name; })) {
      alert("같은 이름의 목록이 이미 있습니다.");
      return null;
    }
    var list = {
      id: uid(type === "visit" ? "visit" : "fav"),
      name: name,
      itemKeys: initialItemKey ? [initialItemKey] : [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    lists.push(list);
    saveLists(type, lists);
    return list;
  }

  function renderManager() {
    var lists = loadLists(currentManagerType);
    var label = typeLabel(currentManagerType);
    document.getElementById("lmTitle").textContent = label + "목록";
    document.getElementById("lmSubtitle").textContent = "목록 " + lists.length + "개 · 등록 매물 " +
      lists.reduce(function (sum, list) { return sum + (list.itemKeys || []).length; }, 0) + "개";

    var selectedCount = getSelectedItemKeys().length;
    var html = '<div class="lm-toolbar">' +
      '<div class="lm-selection-summary ' + (selectedCount ? 'active' : '') + '">' +
        (selectedCount ? '<strong>' + selectedCount + '개 선택됨</strong><span>아래 목록의 “선택 매물 추가”를 누르세요.</span>' : '<span>매물카드에서 여러 매물을 체크하면 한 번에 추가할 수 있습니다.</span>') +
      '</div>' +
      '<div class="lm-manager-create-form">' +
        '<input id="lmNewManagedListName" type="text" maxlength="30" placeholder="새 ' + label + '목록 이름" ' +
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();createManagedList();}">' +
        '<button class="lm-primary" type="button" onclick="createManagedList()">새 목록 만들기</button>' +
      '</div>' +
    '</div>';
    if (!lists.length) {
      html += '<div class="lm-empty">아직 만든 ' + label + '목록이 없습니다.</div>';
    } else {
      html += '<div class="lm-list-grid">';
      lists.forEach(function (list) {
        html += '<section class="lm-list-card">' +
          '<div class="lm-list-card-head">' +
            '<button class="lm-list-open" type="button" onclick="toggleManagedList(\'' + list.id + '\')">' +
              '<span>' + escapeHtml(list.name) + '</span><strong>' + (list.itemKeys || []).length + '개</strong>' +
            '</button>' +
            '<div class="lm-list-actions">' +
              (selectedCount ? '<button class="bulk-add" type="button" onclick="addSelectedItemsToManagedList(\'' + list.id + '\')">선택 매물 ' + selectedCount + '개 추가</button>' : '') +
              (currentManagerType === "favorite" ? '<button type="button" onclick="showFavoriteListOnMap(\'' + list.id + '\')">지도에서 보기</button>' : '') +
              (currentManagerType === "visit" ? '<button class="ai-visit-start" type="button" onclick="startAiVisitFromManagedList(\'' + list.id + '\')">AI임장 시작</button>' : '') +
              '<button type="button" onclick="renameManagedList(\'' + list.id + '\')">이름변경</button>' +
              '<button class="danger" type="button" onclick="deleteManagedList(\'' + list.id + '\')">삭제</button>' +
            '</div>' +
          '</div>' +
          '<div id="lmListItems_' + list.id + '" class="lm-list-items"></div>' +
        '</section>';
      });
      html += '</div>';
    }
    document.getElementById("lmBody").innerHTML = html;
  }

  window.openListManager = function (type) {
    ensureModal();
    currentManagerType = type === "visit" ? "visit" : "favorite";
    renderManager();
    openModal("listManagerModal");
  };

  window.closeListManager = function () { closeModal("listManagerModal"); };

  window.createManagedList = function () {
    var nameInput = document.getElementById("lmNewManagedListName");
    var list = createList(currentManagerType, "", nameInput && nameInput.value);
    if (!list) return;
    renderManager();
    showListToast('"' + list.name + '" 목록을 만들었습니다.', "success");
    var nextInput = document.getElementById("lmNewManagedListName");
    if (nextInput) nextInput.focus();
  };

  window.renameManagedList = function (id) {
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === id; });
    if (!list) return;
    var name = promptListName(currentManagerType, list.name);
    if (!name || name === list.name) return;
    if (lists.some(function (entry) { return entry.id !== id && entry.name === name; })) {
      alert("같은 이름의 목록이 이미 있습니다.");
      return;
    }
    list.name = name;
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    renderManager();
  };

  window.deleteManagedList = function (id) {
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === id; });
    if (!list) return;
    if (!confirm('"' + list.name + '" 목록을 삭제할까요?\n목록만 삭제되며 매물 원본은 삭제되지 않습니다.')) return;
    lists = lists.filter(function (entry) { return entry.id !== id; });
    markDeletedListId(currentManagerType, id);
    saveLists(currentManagerType, lists);
    renderManager();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.toggleManagedList = function (id) {
    var box = document.getElementById("lmListItems_" + id);
    if (!box) return;
    if (box.dataset.open === "1") {
      box.dataset.open = "0";
      box.innerHTML = "";
      return;
    }
    var list = loadLists(currentManagerType).find(function (entry) { return entry.id === id; });
    if (!list) return;
    box.dataset.open = "1";
    if (!(list.itemKeys || []).length) {
      box.innerHTML = '<div class="lm-empty small">등록된 매물이 없습니다.</div>';
      return;
    }
    box.innerHTML = (list.itemKeys || []).map(function (key) {
      return '<div class="lm-managed-item">' +
        '<div class="lm-managed-info">' + itemSummary(getItem(key)) + '</div>' +
        '<button type="button" onclick="removeItemFromManagedList(\'' + id + '\',\'' + encodeURIComponent(key) + '\')">제거</button>' +
      '</div>';
    }).join("");
  };

  window.removeItemFromManagedList = function (listId, encodedKey) {
    var key = decodeURIComponent(encodedKey);
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === listId; });
    if (!list) return;
    list.itemKeys = (list.itemKeys || []).filter(function (entry) { return entry !== key; });
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    renderManager();
    setTimeout(function () { window.toggleManagedList(listId); }, 0);
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.addSelectedItemsToManagedList = function (listId) {
    var selectedKeys = getSelectedItemKeys();
    if (!selectedKeys.length) {
      showListToast("먼저 매물카드에서 추가할 매물을 체크해주세요.", "warning");
      return;
    }

    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === listId; });
    if (!list) return;

    var keys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
    var added = 0;
    var duplicated = 0;
    selectedKeys.forEach(function (key) {
      if (keys.indexOf(key) === -1) {
        keys.push(key);
        added += 1;
      } else {
        duplicated += 1;
      }
    });

    list.itemKeys = keys;
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    renderManager();
    if (typeof window.applyFilter === "function") window.applyFilter();

    var message = '"' + list.name + '"에 ' + added + '개를 추가했습니다.';
    if (duplicated) message += ' · 중복 ' + duplicated + '개 제외';
    showListToast(message, added ? "success" : "info");
  };

  window.showFavoriteListOnMap = function (listId) {
    var list = loadLists("favorite").find(function (entry) { return entry.id === listId; });
    if (!list) return;
    activateFavoriteFolderFilter(list, { silent: true });
    closeListManager();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.openItemListPicker = function (type, encodedKey) {
    ensureModal();
    currentManagerType = type === "visit" ? "visit" : "favorite";
    currentItemKey = decodeURIComponent(encodedKey);
    renderPicker();
    openModal("itemListPickerModal");
  };

  window.openItemListDestinationPicker = function (encodedKey) {
    ensureModal();
    currentItemKey = decodeURIComponent(encodedKey);
    var item = getItem(currentItemKey);
    document.getElementById("lmPickerTitle").textContent = "찜·임장 추가";
    document.getElementById("lmPickerSubtitle").textContent = item
      ? (item.address || item.name || "선택 매물")
      : "선택 매물";
    document.getElementById("lmPickerBody").innerHTML =
      '<div class="lm-destination-grid">' +
        '<button class="lm-destination favorite" type="button" onclick="selectItemListDestination(\'favorite\')">' +
          '<strong>찜목록</strong><span>관심 매물로 분류</span>' +
        '</button>' +
        '<button class="lm-destination visit" type="button" onclick="selectItemListDestination(\'visit\')">' +
          '<strong>임장목록</strong><span>현장 확인 매물로 분류</span>' +
        '</button>' +
      '</div>';
    document.getElementById("lmPickerFooter").style.display = "none";
    openModal("itemListPickerModal");
  };

  window.selectItemListDestination = function (type) {
    currentManagerType = type === "visit" ? "visit" : "favorite";
    renderPicker();
  };

  function renderPicker() {
    var item = getItem(currentItemKey);
    var lists = loadLists(currentManagerType);
    var label = typeLabel(currentManagerType);
    document.getElementById("lmPickerFooter").style.display = "flex";
    document.getElementById("lmPickerTitle").textContent = label + "추가";
    document.getElementById("lmPickerSubtitle").textContent = item ? (item.address || item.name || "선택 매물") : "선택 매물";
    var html = '<div class="lm-new-inline-form">' +
      '<input id="lmNewPickerListName" type="text" maxlength="30" placeholder="새 ' + label + '목록 이름" ' +
        'onkeydown="if(event.key===\'Enter\'){event.preventDefault();createPickerList();}">' +
      '<button class="lm-new-inline" type="button" onclick="createPickerList()">목록 만들고 매물 추가</button>' +
    '</div>';
    if (!lists.length) {
      html += '<div class="lm-empty">목록을 먼저 만들어주세요.</div>';
    } else {
      html += '<div class="lm-check-list">';
      lists.forEach(function (list) {
        var checked = (list.itemKeys || []).indexOf(currentItemKey) !== -1;
        html += '<label class="lm-check-row"><input type="checkbox" data-list-id="' + list.id + '" ' +
          (checked ? 'checked' : '') + ' onchange="togglePickerListItem(this)"><span>' +
          escapeHtml(list.name) + '</span><strong>' + (list.itemKeys || []).length + '개</strong></label>';
      });
      html += '</div>';
    }
    document.getElementById("lmPickerBody").innerHTML = html;
  }

  window.createPickerList = function () {
    var itemKey = currentItemKey;
    var nameInput = document.getElementById("lmNewPickerListName");
    var list = createList(currentManagerType, itemKey, nameInput && nameInput.value);
    if (!list) return;
    showListToast('"' + list.name + '" 목록을 만들고 매물을 추가했습니다.', "success");
    window.closeItemListPicker();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.togglePickerListItem = function (input) {
    if (!input) return;
    var listId = input.getAttribute("data-list-id");
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === listId; });
    if (!list || !currentItemKey) return;
    var keys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
    var has = keys.indexOf(currentItemKey) !== -1;
    if (input.checked && !has) keys.push(currentItemKey);
    if (!input.checked && has) keys = keys.filter(function (key) { return key !== currentItemKey; });
    if (input.checked === has) return;
    list.itemKeys = keys;
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    showListToast('"' + list.name + '" 목록에 ' +
      (input.checked ? "매물을 추가했습니다." : "매물을 제외했습니다."), "success");
    renderPicker();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.applyItemListSelection = function () {
    var lists = loadLists(currentManagerType);
    var checkedById = {};
    document.querySelectorAll("#lmPickerBody input[data-list-id]").forEach(function (input) {
      checkedById[input.getAttribute("data-list-id")] = input.checked;
    });
    var changed = 0;
    lists.forEach(function (list) {
      var keys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
      var has = keys.indexOf(currentItemKey) !== -1;
      var shouldHave = !!checkedById[list.id];
      if (shouldHave && !has) keys.push(currentItemKey);
      if (!shouldHave && has) keys = keys.filter(function (key) { return key !== currentItemKey; });
      if (shouldHave === has) return;
      list.itemKeys = keys;
      list.updatedAt = nowIso();
      changed += 1;
    });
    if (changed) saveLists(currentManagerType, lists);
    showListToast(changed ? "목록 저장을 완료했습니다." : "변경된 목록이 없습니다.", changed ? "success" : "info");
    closeItemListPicker();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.closeItemListPicker = function () {
    currentItemKey = "";
    var footer = document.getElementById("lmPickerFooter");
    if (footer) footer.style.display = "flex";
    closeModal("itemListPickerModal");
  };

  window.startAiVisitPreview = function () {
    if (window.JSAiVisitV6 && typeof window.JSAiVisitV6.openLauncher === "function") {
      window.JSAiVisitV6.openLauncher();
      return;
    }
    alert("AI임장 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
  };

  window.startAiVisitFromManagedList = function (listId) {
    if (window.JSAiVisitV6 && typeof window.JSAiVisitV6.openConfirmForList === "function") {
      window.JSAiVisitV6.openConfirmForList(listId);
      return;
    }
    alert("AI임장 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
  };

  window.JSV6ListStore = {
    load: function (type) { return loadLists(type === "visit" ? "visit" : "favorite"); },
    save: function (type, lists) { return saveLists(type === "visit" ? "visit" : "favorite", lists); },
    remove: function (type, id, lists) {
      type = type === "visit" ? "visit" : "favorite";
      markDeletedListId(type, id);
      return saveLists(type, lists);
    },
    getItem: getItem,
    activateFavoriteFilter: function (id, options) {
      var list = loadLists("favorite").find(function(entry) { return String(entry && entry.id || "") === String(id || ""); });
      return activateFavoriteFolderFilter(list, options);
    },
    restoreFavoriteFilter: function () {
      return restoreActiveFavoriteFolderFilter(loadLists("favorite"));
    },
    clearFavoriteFilter: function (options) {
      clearActiveFavoriteFolderFilter(options);
    }
  };
  window.activateFavoriteFolderFilterV1 = function(id, options) {
    var list = loadLists("favorite").find(function(entry) { return String(entry && entry.id || "") === String(id || ""); });
    return activateFavoriteFolderFilter(list, options);
  };
  window.restoreActiveFavoriteFolderFilterV1 = function(options) {
    return restoreActiveFavoriteFolderFilter(loadLists("favorite"), options);
  };
  window.clearActiveFavoriteFolderFilterV1 = clearActiveFavoriteFolderFilter;


  function isMobileLayout() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
  }

  function closeDesktopMenus() {
    document.querySelectorAll(".v6-command-menu.open").forEach(function (menu) {
      menu.classList.remove("open");
      var trigger = menu.querySelector(".v6-command-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function closeDesktopSort() {
    var dropdown = document.getElementById("sortDropdown");
    var button = document.getElementById("sortDropdownBtn");
    if (dropdown) dropdown.classList.remove("open");
    if (button) button.setAttribute("aria-expanded", "false");
  }

  function ensureMobileSheet() {
    var root = document.getElementById("v6MobileMenuPortal");
    if (root) return root;
    root = document.createElement("div");
    root.id = "v6MobileMenuPortal";
    root.className = "v6-mobile-menu-portal";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="v6-mobile-menu-dim" data-v6-close aria-hidden="true"></div>' +
      '<section class="v6-mobile-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="v6MobileMenuTitle">' +
        '<div class="v6-mobile-menu-handle" aria-hidden="true"></div>' +
        '<div class="v6-mobile-menu-head"><strong id="v6MobileMenuTitle"></strong><button type="button" class="v6-mobile-menu-close" data-v6-close aria-label="메뉴 닫기">×</button></div>' +
        '<div id="v6MobileMenuBody" class="v6-mobile-menu-body"></div>' +
      '</section>';
    root.addEventListener("click", function (event) {
      if (event.target.closest("[data-v6-close]")) closeMobileSheet();
    });
    root.addEventListener("keydown", function (event) {
      if (!root.classList.contains("open") || !window.JSDialogFocusV1) return;
      window.JSDialogFocusV1.handleKeydown(root, event, closeMobileSheet);
    });
    document.body.appendChild(root);
    return root;
  }

  function closeMobileSheet() {
    var root = document.getElementById("v6MobileMenuPortal");
    var wasOpen = !!(root && root.classList.contains("open"));
    if (root) {
      root.classList.remove("open");
      root.removeAttribute("data-menu-type");
      root.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("v6-mobile-sheet-open");
    if (wasOpen && window.JSDialogFocusV1) window.JSDialogFocusV1.deactivate(root);
  }

  function openMobileSheet(title, source, type) {
    var root = ensureMobileSheet();
    if (root.classList.contains("open") && root.getAttribute("data-menu-type") === type) {
      closeMobileSheet();
      return;
    }
    closeDetailPopup();
    closeDesktopMenus();
    closeDesktopSort();
    var body = root.querySelector("#v6MobileMenuBody");
    root.querySelector("#v6MobileMenuTitle").textContent = title;
    body.innerHTML = "";
    Array.prototype.forEach.call(source ? source.children : [], function (child) {
      if (child.classList && child.classList.contains("v6-command-divider")) {
        var divider = document.createElement("div");
        divider.className = "v6-mobile-menu-divider";
        body.appendChild(divider);
        return;
      }
      if (type === "sort" && child.classList && child.classList.contains("sort-menu-row")) {
        var sortRow = child.cloneNode(true);
        sortRow.classList.add("v6-mobile-sort-row");
        Array.prototype.forEach.call(sortRow.querySelectorAll("button"), function (sortButton) {
          sortButton.classList.add("v6-mobile-sort-choice");
          sortButton.addEventListener("click", function () { window.setTimeout(closeMobileSheet, 0); });
        });
        body.appendChild(sortRow);
        return;
      }
      if (child.tagName !== "BUTTON") return;
      var clone = child.cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.add("v6-mobile-menu-item");
      clone.style.display = "block";
      clone.addEventListener("click", function () { window.setTimeout(closeMobileSheet, 0); });
      body.appendChild(clone);
    });
    root.setAttribute("data-menu-type", type);
    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("v6-mobile-sheet-open");
    if (window.JSDialogFocusV1) {
      window.JSDialogFocusV1.activate(root, root.querySelector(".v6-mobile-menu-item, .v6-mobile-sort-choice, .v6-mobile-menu-close"));
    }
  }

  function ensureDetailDim() {
    var dim = document.getElementById("v6DetailDim");
    if (dim) return dim;
    dim = document.createElement("div");
    dim.id = "v6DetailDim";
    dim.className = "v6-detail-dim";
    dim.addEventListener("click", closeDetailPopup);
    document.body.appendChild(dim);
    return dim;
  }

  function closeDetailPopup() {
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    var dim = document.getElementById("v6DetailDim");
    if (panel) panel.classList.remove("open");
    if (button) button.classList.remove("on");
    if (dim) dim.classList.remove("open");
  }

  var originalToggleDetail = window.toggleDetailFilter;
  window.toggleDetailFilter = function () {
    if (!isMobileLayout()) {
      closeMobileSheet();
      closeDesktopMenus();
      closeDesktopSort();
      return originalToggleDetail ? originalToggleDetail() : undefined;
    }
    closeMobileSheet();
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    if (!panel || !button) return;
    var willOpen = !panel.classList.contains("open");
    closeDetailPopup();
    if (willOpen) {
      panel.removeAttribute("style");
      panel.classList.add("open");
      button.classList.add("on");
      ensureDetailDim().classList.add("open");
    }
  };

  window.closeV6ActionMenus = function () {
    closeDesktopMenus();
    closeMobileSheet();
  };

  window.toggleV6ActionMenu = function (name, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var target = document.querySelector('.v6-command-menu[data-command-menu="' + name + '"]');
    if (!target) return;
    if (isMobileLayout()) {
      openMobileSheet(name === "view" ? "보기" : "작업", document.getElementById("v6ActionMenu_" + name), name);
      return;
    }
    closeDetailPopup();
    closeDesktopSort();
    var willOpen = !target.classList.contains("open");
    closeDesktopMenus();
    if (willOpen) {
      target.classList.add("open");
      var trigger = target.querySelector(".v6-command-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
    }
  };

  var originalToggleSort = window.toggleSortDropdown;
  window.toggleSortDropdown = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (isMobileLayout()) {
      openMobileSheet("정렬", document.getElementById("sortDropdownMenu"), "sort");
      return;
    }
    closeDetailPopup();
    closeDesktopMenus();
    if (originalToggleSort) originalToggleSort(event);
    syncSortButtonMarkup();
  };

  var originalCloseSort = window.closeSortDropdown;
  window.closeSortDropdown = function () {
    closeMobileSheet();
    if (originalCloseSort) originalCloseSort();
    else closeDesktopSort();
    syncSortButtonMarkup();
  };

  function syncSortButtonMarkup() {
    var button = document.getElementById("sortDropdownBtn");
    if (!button) return;
    var label = button.querySelector(".v6-sort-label");
    var text = label ? label.textContent : (button.textContent || "정렬").trim();
    button.innerHTML = '<span class="v6-sort-label"></span><span class="v6-filter-caret" aria-hidden="true"></span>';
    button.querySelector(".v6-sort-label").textContent = text || "정렬";
  }

  var originalSelectSort = window.selectSortOption;
  window.selectSortOption = function (value) {
    if (originalSelectSort) originalSelectSort(value);
    syncSortButtonMarkup();
    closeMobileSheet();
  };

  function updateMultiButtonVisibility() {
    var button = document.getElementById("multiClusterBtn");
    if (!button) return;
    button.classList.toggle("has-selection", getSelectedItemKeys().length > 0);
  }

  document.addEventListener("change", function (event) {
    if (event.target && event.target.matches('input[type="checkbox"]')) window.setTimeout(updateMultiButtonVisibility, 0);
  });

  document.addEventListener("click", function (event) {
    if (!isMobileLayout() && !event.target.closest(".v6-command-menu") && !event.target.closest("#sortDropdown")) {
      closeDesktopMenus();
      closeDesktopSort();
      syncSortButtonMarkup();
    }
    window.setTimeout(updateMultiButtonVisibility, 0);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    closeListManager();
    closeItemListPicker();
    closeDesktopMenus();
    closeDesktopSort();
    closeMobileSheet();
    closeDetailPopup();
  });

  window.addEventListener("resize", function () {
    closeDesktopMenus();
    closeDesktopSort();
    closeMobileSheet();
    closeDetailPopup();
  });

  window.addEventListener("online", function() {
    if (isCloudDirty("favorite")) scheduleCloudSave("favorite", loadLists("favorite"));
    if (isCloudDirty("visit")) scheduleCloudSave("visit", loadLists("visit"));
  });

  function bindMobileDetailButtonFix() {
    var button = document.getElementById("detailBtn");
    if (!button || button.dataset.v6DetailBound === "1") return;
    button.dataset.v6DetailBound = "1";
    button.addEventListener("click", function (event) {
      if (!isMobileLayout()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.toggleDetailFilter();
    }, true);

    var applyButton = document.querySelector("#detailFilter .apply-btn");
    if (applyButton && applyButton.dataset.v6DetailApplyBound !== "1") {
      applyButton.dataset.v6DetailApplyBound = "1";
      applyButton.addEventListener("click", function () {
        window.setTimeout(closeDetailPopup, 0);
      });
    }
  }

  window.setTimeout(function () {
    syncSortButtonMarkup();
    updateMultiButtonVisibility();
    bindMobileDetailButtonFix();
  }, 100);

  prepareAccountStorage().then(function () {
    migrateLegacyFavorites();
    restoreActiveFavoriteFolderFilter(loadLists("favorite"), { silent: true });
    syncListsFromCloud();
    ensureModal();
    window.addEventListener("focus", syncListsWhenDeviceResumes);
    window.addEventListener("pageshow", syncListsWhenDeviceResumes);
    window.addEventListener("popstate", syncListsWhenDeviceResumes);
    document.addEventListener("visibilitychange", syncListsWhenDeviceResumes);
  });
})();
