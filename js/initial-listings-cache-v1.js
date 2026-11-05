(function(global) {
  "use strict";

  var DATABASE_NAME = "js-realestate-initial-listings-v1";
  var STORE_NAME = "snapshots";
  var SNAPSHOT_KEY = "latest";
  var SCHEMA_VERSION = 5;
  var MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
  var EPOCH_KEY_V94 = "js-initial-listings-epoch-v94";
  var localEpochV94 = "", writtenEpochV94 = "", generationV94 = 0, localEpochOnlyV94 = false;
  function epochV94() {
    if (localEpochOnlyV94) return localEpochV94;
    try { return String(global.localStorage.getItem(EPOCH_KEY_V94) || ""); }
    catch (_) { return localEpochV94; }
  }
  var PATCH_KEY_V118 = "js-initial-listings-patch-v118";
  function patchVersionV118() {
    try { return String(global.localStorage.getItem(PATCH_KEY_V118) || ""); } catch (_) { return ""; }
  }
  function versionV94() { return generationV94 + ":" + epochV94() + ":" + patchVersionV118(); }
  var BASE_ITEM_FIELDS = [
    "name", "address", "room", "type", "deposit", "rent", "fee", "premium", "area",
    "landlordPhone", "tenantPhone", "memo", "state", "regDate", "source", "propertyId",
    "sourceLink", "contactListRaw", "buildingYear", "buildingElevators",
    "buildingElevatorCapacity", "buildingApprovalDate", "buildingInfoCheckedAt",
    "buildingInfoStatus", "registrationAt", "lastCollectedAt", "latitude", "longitude",
    "sheetRow", "key", "tradeType", "saleCategory", "salePrice", "saleDetails", "sourceSnapshotKey", "manualFinancialFieldsV106"
  ];

  var UNIFIED_SIGNATURE_FIELDS = [
    "originalId", "source", "link", "room", "deposit", "rent", "fee", "premium",
    "area", "latitude", "longitude", "thumbnail", "photoCount", "contactCount",
    "revision", "masterFallback", "sourceUnavailable", "missingCount", "tradeType",
    "saleCategory", "salePrice", "saleSummary", "active", "candidateEligible", "availabilityKind",
    "floor", "literalRoom", "sourceFloor", "sourceRoom", "manualDisplayFields", "hasManualRoomOverride", "type", "absenceConfirmedAt"
  ];

  function copyBaseItem(item) {
    var output = {};
    BASE_ITEM_FIELDS.forEach(function(field) {
      output[field] = item && item[field] != null ? item[field] : "";
    });
    output.displayValuePresence = Object.assign({}, item && item.displayValuePresence || {});
    return output;
  }

  function hashText(hash, value) {
    var source = typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value == null ? "" : value);
    for (var index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31;
    return Math.imul(hash, 16777619);
  }

  function unifiedSignature(unifiedResult, allowedPropertyIds) {
    var groups = unifiedResult && unifiedResult.groups && typeof unifiedResult.groups === "object"
      ? unifiedResult.groups
      : {};
    var hash = 2166136261;
    var originalCount = 0;
    var propertyIds = Object.keys(groups).filter(function(propertyId) {
      return !allowedPropertyIds || !!allowedPropertyIds[propertyId];
    }).sort();
    propertyIds.forEach(function(propertyId) {
      hash = hashText(hash, propertyId);
      (Array.isArray(groups[propertyId]) ? groups[propertyId] : []).forEach(function(original) {
        originalCount += 1;
        UNIFIED_SIGNATURE_FIELDS.forEach(function(field) {
          hash = hashText(hash, original && original[field]);
        });
      });
    });
    return propertyIds.length + ":" + originalCount + ":" + (hash >>> 0).toString(16);
  }

  function unifiedSignatureForItems(items, unifiedResult) {
    var allowedPropertyIds = Object.create(null);
    (items || []).forEach(function(item) {
      var propertyId = String(item && item.propertyId || "").trim();
      if (propertyId) allowedPropertyIds[propertyId] = true;
    });
    return unifiedSignature(unifiedResult, allowedPropertyIds);
  }

  function snapshot(items, unifiedResult) {
    if (!Array.isArray(items) || !items.length || !unifiedResult || unifiedResult.ok === false ||
        !unifiedResult.groups || typeof unifiedResult.groups !== "object") return null;
    var completeItems = items.slice();
    var completeIds = Object.create(null);
    completeItems.forEach(function(item) {
      var propertyId = String(item && item.propertyId || "").trim();
      if (propertyId) completeIds[propertyId] = true;
    });
    var completeGroups = {};
    var completeSearchIds = {};
    Object.keys(completeIds).forEach(function(propertyId) {
      if (unifiedResult.groups[propertyId]) completeGroups[propertyId] = unifiedResult.groups[propertyId];
      if (unifiedResult.sourceSearchIds && unifiedResult.sourceSearchIds[propertyId]) {
        completeSearchIds[propertyId] = unifiedResult.sourceSearchIds[propertyId];
      }
    });
    var completeUnified = {
      ok: true,
      format: "expanded-cache-v2",
      groups: completeGroups,
      sourceSearchIds: completeSearchIds
    };
    return {
      schema: SCHEMA_VERSION,
      cacheEpochV94: epochV94(),
      savedAt: Date.now(),
      itemCount: completeItems.length,
      totalItemCount: completeItems.length,
      items: completeItems.map(copyBaseItem),
      unifiedSignature: unifiedSignature(unifiedResult, completeIds),
      unified: completeUnified
    };
  }

  function usable(value) {
    return !!(
      value && value.schema === SCHEMA_VERSION &&
      String(value.cacheEpochV94 || "") === epochV94() &&
      Number(value.savedAt) > Date.now() - MAX_AGE_MS &&
      Array.isArray(value.items) && value.items.length > 0 &&
      Number(value.itemCount) === value.items.length &&
      Number(value.totalItemCount) === value.items.length &&
      typeof value.unifiedSignature === "string" && value.unifiedSignature &&
      value.unified && value.unified.groups && typeof value.unified.groups === "object"
    );
  }

  function openDatabase() {
    if (!global.indexedDB || typeof global.indexedDB.open !== "function") {
      return Promise.reject(new Error("IndexedDB unavailable"));
    }
    return new Promise(function(resolve, reject) {
      var request = global.indexedDB.open(DATABASE_NAME, SCHEMA_VERSION);
      request.onupgradeneeded = function() {
        var database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || new Error("Initial listing cache open failed")); };
    });
  }

  function read() {
    return openDatabase().then(function(database) {
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readonly");
        var request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
        request.onsuccess = function() {
          var valid = usable(request.result);
          if (valid) writtenEpochV94 = epochV94();
          resolve(valid ? request.result : null);
        };
        request.onerror = function() { resolve(null); };
        transaction.oncomplete = function() { database.close(); };
        transaction.onerror = function() { database.close(); };
        transaction.onabort = function() { database.close(); };
      });
    }).catch(function() { return null; });
  }

  function storeSnapshot(value, version) {
    if (!value) return Promise.resolve(false);
    return openDatabase().then(function(database) {
      if (version !== versionV94()) { database.close(); return false; }
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(value, SNAPSHOT_KEY);
        transaction.oncomplete = function() {
          database.close();
          var current = version === versionV94();
          if (current) writtenEpochV94 = epochV94();
          resolve(current);
        };
        transaction.onerror = function() { database.close(); resolve(false); };
        transaction.onabort = function() { database.close(); resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function write(items, unifiedResult) {
    var version = versionV94();
    return new Promise(function(resolve) {
      var schedule = typeof global.requestIdleCallback === "function"
        ? function(callback) { global.requestIdleCallback(callback, { timeout: 900 }); }
        : function(callback) { global.setTimeout(callback, 40); };
      schedule(function() {
        if (version !== versionV94()) { resolve(false); return; }
        storeSnapshot(snapshot(items, unifiedResult), version).then(resolve);
      });
    });
  }

  // Patch only a server-confirmed master inside the existing complete cache.
  // The transaction keeps other listings and their photos intact. A patch
  // token fences older full-cache writers, including writers in another tab.
  function commitItem(item, receipt) {
    var id = String(item && item.propertyId || "").trim();
    if (!id || !receipt || receipt.persisted !== true || receipt.queued ||
        String(receipt.propertyId || "").trim() !== id) return Promise.resolve(false);
    if (receipt.fullReload || receipt.sourceLinksChanged) return clear();
    var patch = {}, updated = receipt.updated || {};
    BASE_ITEM_FIELDS.forEach(function(field) {
      if (Object.prototype.hasOwnProperty.call(updated, field)) patch[field] = updated[field];
    });
    if (typeof receipt.memo === "string") patch.memo = receipt.memo;
    var contacts = receipt.contacts || updated.contacts;
    if (Array.isArray(contacts)) patch.contactListRaw = JSON.stringify(contacts);
    if (receipt.updated) {
      patch.displayValuePresence = Object.assign({}, item.displayValuePresence || {});
      patch.manualFinancialFieldsV106 = (item.manualFinancialFieldsV106 || []).slice();
    }
    var changed = (Array.isArray(receipt.changedFields) ? receipt.changedFields : []).slice();
    var epoch = epochV94(), token = Date.now() + "-" + Math.random().toString(36).slice(2);
    generationV94 += 1;
    try { global.localStorage.setItem(PATCH_KEY_V118, token); } catch (_) {}
    return openDatabase().then(function(database) {
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readwrite"), applied = false;
        var store = transaction.objectStore(STORE_NAME), request = store.get(SNAPSHOT_KEY);
        request.onsuccess = function() {
          var value = request.result;
          if (epoch !== epochV94() || !usable(value)) return;
          var row = value.items.find(function(entry) { return String(entry.propertyId) === id; });
          if (!row) return;
          Object.assign(row, patch);
          (value.unified.groups[id] || []).forEach(function(original) {
            var fields = String(original.manualDisplayFields || "").split(",").filter(Boolean);
            original.manualDisplayFields = Array.from(new Set(fields.concat(changed))).join(",");
            if (changed.indexOf("room") >= 0) {
              original.room = row.room;
              original.hasManualRoomOverride = true;
              original.roomManuallyEditedV1 = true;
            }
          });
          value.unifiedSignature = "confirmed-edit:" + token;
          // Do not extend the age of the rest of this complete snapshot.
          store.put(value, SNAPSHOT_KEY);
          applied = true;
        };
        transaction.oncomplete = function() { database.close(); resolve(applied && epoch === epochV94()); };
        transaction.onerror = transaction.onabort = function() { database.close(); resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function clear() {
    generationV94 += 1;
    localEpochV94 = Date.now() + "-" + Math.random().toString(36).slice(2);
    try { global.localStorage.setItem(EPOCH_KEY_V94, localEpochV94); localEpochOnlyV94 = false; }
    catch (_) { localEpochOnlyV94 = true; }
    return openDatabase().then(function(database) {
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
        transaction.oncomplete = function() { database.close(); resolve(true); };
        transaction.onerror = function() { database.close(); resolve(false); };
        transaction.onabort = function() { database.close(); resolve(false); };
      });
    }).catch(function() { return false; });
  }

  global.JSInitialListingsCacheV1 = Object.freeze({
    read: read,
    write: write,
    commitItem: commitItem,
    clear: clear,
    version: versionV94,
    needsRefresh: function() { return writtenEpochV94 !== epochV94(); },
    snapshot: snapshot,
    unifiedSignature: unifiedSignature,
    unifiedSignatureForItems: unifiedSignatureForItems,
    usable: usable,
    schemaVersion: SCHEMA_VERSION
  });
})(typeof window !== "undefined" ? window : globalThis);
