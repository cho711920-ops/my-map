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
  function scopeV123() { return global.JSDataAccessV6 && typeof global.JSDataAccessV6.listingsScope === "function"
    ? global.JSDataAccessV6.listingsScope() : "all"; }
  function snapshotKeyV123() { return scopeV123() === "lease" ? SNAPSHOT_KEY + ":lease-v123" : SNAPSHOT_KEY; }
  function versionV94() { return generationV94 + ":" + epochV94() + ":" + patchVersionV118() + ":" + scopeV123(); }
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
    "floor", "literalRoom", "sourceFloor", "sourceRoom", "manualDisplayFields", "hasManualRoomOverride", "type", "absenceConfirmedAt", "photoPathsV119"
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

  function snapshot(items, unifiedResult, readReceipt) {
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
      sourceSearchIds: completeSearchIds,
      datasetScope: scopeV123(),
      snapshotRevision: String(unifiedResult.snapshotRevision || "")
    };
    return {
      schema: SCHEMA_VERSION,
      cacheEpochV94: epochV94(),
      datasetScope: scopeV123(),
      snapshotRevision: String(unifiedResult.snapshotRevision || ""),
      baselineRevisionV125: String(readReceipt && readReceipt.revision || unifiedResult.snapshotRevision || ""),
      savedAt: Date.now(),
      itemCount: completeItems.length,
      totalItemCount: completeItems.length,
      items: completeItems.map(copyBaseItem),
      unifiedSignature: unifiedSignature(unifiedResult, completeIds),
      unified: completeUnified
    };
  }

  function usable(value, anyScope) {
    return !!(
      value && value.schema === SCHEMA_VERSION &&
      (anyScope || (value.datasetScope || "all") === scopeV123()) &&
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

  var warmReadV124 = null;
  function readSnapshotV124() {
    var key = snapshotKeyV123(), version = versionV94();
    return openDatabase().then(function(database) {
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readonly");
        var request = transaction.objectStore(STORE_NAME).get(key);
        request.onsuccess = function() {
          var valid = version === versionV94() && usable(request.result);
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

  // Start the one complete IndexedDB read while the map SDK is loading. Do
  // not clone the large snapshot again, or reuse it after an edit/scope change.
  function warm() {
    var version = versionV94();
    if (!warmReadV124 || warmReadV124.version !== version) {
      var started = Date.now();
      warmReadV124 = {version: version, promise: readSnapshotV124().then(function(value) {
        if (version === versionV94() && global.document && global.document.documentElement) {
          global.document.documentElement.setAttribute("data-initial-cache-read-ms", String(Date.now() - started));
        }
        return value;
      })};
    }
    return warmReadV124.promise;
  }
  function read() {
    var warmed = warmReadV124;
    warmReadV124 = null;
    if (!warmed || warmed.version !== versionV94()) return readSnapshotV124();
    return warmed.promise.then(function(value) {
      return warmed.version === versionV94() && usable(value) ? value : null;
    });
  }

  function storeSnapshot(value, version) {
    if (!value) return Promise.resolve(false);
    return openDatabase().then(function(database) {
      if (version !== versionV94()) { database.close(); return false; }
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(value, snapshotKeyV123());
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

  function write(items, unifiedResult, readReceipt) {
    warmReadV124 = null;
    var version = versionV94();
    return new Promise(function(resolve) {
      var schedule = typeof global.requestIdleCallback === "function"
        ? function(callback) { global.requestIdleCallback(callback, { timeout: 900 }); }
        : function(callback) { global.setTimeout(callback, 40); };
      schedule(function() {
        if (version !== versionV94()) { resolve(false); return; }
        storeSnapshot(snapshot(items, unifiedResult, readReceipt), version).then(resolve);
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
    warmReadV124 = null;
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
        var store = transaction.objectStore(STORE_NAME);
        [SNAPSHOT_KEY, SNAPSHOT_KEY + ":lease-v123"].forEach(function(key) {
        var request = store.get(key);
        request.onsuccess = function() {
          var value = request.result;
          if (epoch !== epochV94() || !usable(value, true)) return;
          var row = value.items.find(function(entry) { return String(entry.propertyId) === id; });
          if (!row) return;
          Object.assign(row, patch);
          // A receipt confirms this master, not a new global snapshot revision.
          value.snapshotRevision = "";
          value.baselineRevisionV125 = "";
          value.unified.snapshotRevision = "";
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
          store.put(value, key);
          applied = true;
        };
        });
        transaction.oncomplete = function() { database.close(); resolve(applied && epoch === epochV94()); };
        transaction.onerror = transaction.onabort = function() { database.close(); resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function clear() {
    warmReadV124 = null;
    generationV94 += 1;
    localEpochV94 = Date.now() + "-" + Math.random().toString(36).slice(2);
    try { global.localStorage.setItem(EPOCH_KEY_V94, localEpochV94); localEpochOnlyV94 = false; }
    catch (_) { localEpochOnlyV94 = true; }
    return openDatabase().then(function(database) {
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
        transaction.objectStore(STORE_NAME).delete(SNAPSHOT_KEY + ":lease-v123");
        transaction.oncomplete = function() { database.close(); resolve(true); };
        transaction.onerror = function() { database.close(); resolve(false); };
        transaction.onabort = function() { database.close(); resolve(false); };
      });
    }).catch(function() { return false; });
  }

  global.JSInitialListingsCacheV1 = Object.freeze({
    warm: warm,
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
