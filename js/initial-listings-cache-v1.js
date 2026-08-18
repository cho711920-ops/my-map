(function(global) {
  "use strict";

  var DATABASE_NAME = "js-realestate-initial-listings-v1";
  var STORE_NAME = "snapshots";
  var SNAPSHOT_KEY = "latest";
  var SCHEMA_VERSION = 2;
  var MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
  var MAX_FAST_ITEMS = 80;
  var BASE_ITEM_FIELDS = [
    "name", "address", "room", "type", "deposit", "rent", "fee", "premium", "area",
    "landlordPhone", "tenantPhone", "memo", "state", "regDate", "source", "propertyId",
    "sourceLink", "contactListRaw", "buildingYear", "buildingElevators",
    "buildingElevatorCapacity", "buildingApprovalDate", "buildingInfoCheckedAt",
    "buildingInfoStatus", "registrationAt", "lastCollectedAt", "latitude", "longitude",
    "sheetRow", "key"
  ];

  function copyBaseItem(item) {
    var output = {};
    BASE_ITEM_FIELDS.forEach(function(field) {
      output[field] = item && item[field] != null ? item[field] : "";
    });
    output.displayValuePresence = Object.assign({}, item && item.displayValuePresence || {});
    return output;
  }

  function snapshot(items, unifiedResult) {
    if (!Array.isArray(items) || !items.length || !unifiedResult || unifiedResult.ok === false ||
        !unifiedResult.groups || typeof unifiedResult.groups !== "object") return null;
    var fastItems = items.slice(0, MAX_FAST_ITEMS);
    var fastIds = Object.create(null);
    fastItems.forEach(function(item) {
      var propertyId = String(item && item.propertyId || "").trim();
      if (propertyId) fastIds[propertyId] = true;
    });
    var fastGroups = {};
    var fastSearchIds = {};
    Object.keys(fastIds).forEach(function(propertyId) {
      if (unifiedResult.groups[propertyId]) fastGroups[propertyId] = unifiedResult.groups[propertyId];
      if (unifiedResult.sourceSearchIds && unifiedResult.sourceSearchIds[propertyId]) {
        fastSearchIds[propertyId] = unifiedResult.sourceSearchIds[propertyId];
      }
    });
    return {
      schema: SCHEMA_VERSION,
      savedAt: Date.now(),
      itemCount: fastItems.length,
      totalItemCount: items.length,
      items: fastItems.map(copyBaseItem),
      unified: {
        ok: true,
        format: "expanded-cache-v1",
        groups: fastGroups,
        sourceSearchIds: fastSearchIds
      }
    };
  }

  function usable(value) {
    return !!(
      value && value.schema === SCHEMA_VERSION &&
      Number(value.savedAt) > Date.now() - MAX_AGE_MS &&
      Array.isArray(value.items) && value.items.length > 0 &&
      Number(value.itemCount) === value.items.length &&
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
        request.onsuccess = function() { resolve(usable(request.result) ? request.result : null); };
        request.onerror = function() { resolve(null); };
        transaction.oncomplete = function() { database.close(); };
        transaction.onerror = function() { database.close(); };
        transaction.onabort = function() { database.close(); };
      });
    }).catch(function() { return null; });
  }

  function storeSnapshot(value) {
    if (!value) return Promise.resolve(false);
    return openDatabase().then(function(database) {
      return new Promise(function(resolve) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(value, SNAPSHOT_KEY);
        transaction.oncomplete = function() { database.close(); resolve(true); };
        transaction.onerror = function() { database.close(); resolve(false); };
        transaction.onabort = function() { database.close(); resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function write(items, unifiedResult) {
    return new Promise(function(resolve) {
      var schedule = typeof global.requestIdleCallback === "function"
        ? function(callback) { global.requestIdleCallback(callback, { timeout: 900 }); }
        : function(callback) { global.setTimeout(callback, 40); };
      schedule(function() {
        storeSnapshot(snapshot(items, unifiedResult)).then(resolve);
      });
    });
  }

  function clear() {
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
    clear: clear,
    snapshot: snapshot,
    usable: usable,
    schemaVersion: SCHEMA_VERSION
  });
})(typeof window !== "undefined" ? window : globalThis);
