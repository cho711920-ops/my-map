(function (global) {
  "use strict";

  var SCOPE = "permitDiagnosis";
  var LOCAL_PREFIX = "js_permit_diagnosis_v1_";
  var DIRTY_PREFIX = "js_permit_diagnosis_dirty_v1_";
  var CONFLICT_PREFIX = "js_permit_diagnosis_conflict_v1_";
  var OPERATION_PREFIX = "js_permit_diagnosis_operation_v1_";
  var DEVICE_ACCOUNT_EMAIL = text(global.JSAuthenticatedAccountEmail).toLowerCase();
  var LEGACY_STORAGE_OWNER_EMAIL = text(global.JSLegacyStorageOwnerEmailV1).toLowerCase();
  var cloudVersions = Object.create(null);
  var saveOperationCounter = 0;
  var saveInstanceId = hash(DEVICE_ACCOUNT_EMAIL + "|" + Date.now() + "|" + Math.random());

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function hash(value) {
    var result = 2166136261;
    var source = String(value || "");
    for (var index = 0; index < source.length; index += 1) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function makeRecordKey(input, industryId) {
    var identity = text(input && input.listingId) || [
      text(input && input.address).replace(/\s+/g, " "),
      text(input && input.floor),
      text(input && input.unit)
    ].join("|");
    if (!identity.replace(/\|/g, "")) throw new Error("매물번호 또는 주소·층·호실이 필요합니다.");
    if (!text(industryId)) throw new Error("저장할 업종을 선택해 주세요.");
    return text(industryId) + "_" + hash(identity);
  }

  function compactPublicData(diagnosis) {
    var source = diagnosis || {};
    var building = source.building || {};
    var record = source.record || {};
    return {
      queriedAt: text(source.queriedAt),
      cached: Boolean(source.cached),
      source: text(source.source),
      sourcePage: text(source.sourcePage),
      lotAddress: text(source.lotAddress),
      roadAddress: text(source.roadAddress),
      buildingType: text(source.buildingType),
      buildingName: text(building.name || source.buildingName),
      currentUse: text(record.use),
      currentUseScope: text(record.level),
      recordFloor: text(record.floor),
      recordUnit: text(record.unit),
      approvalDate: text(source.approvalDate),
      mainUse: text(source.mainUse),
      parking: source.parking == null ? null : Number(source.parking),
      elevators: source.elevators == null ? null : Number(source.elevators),
      zones: text(source.zones),
      violationStatus: text(source.violationStatus) || "UNKNOWN",
      recordCounts: clone(source.recordCounts || {}),
      limitations: clone(source.limitations || [])
    };
  }

  function valueAt(record, path) {
    return path.split(".").reduce(function (value, key) {
      return value && value[key] != null ? value[key] : "";
    }, record || {});
  }

  function compare(previous, next) {
    if (!previous) return [];
    var fields = [
      ["currentBuildingUse", "현재 건축물 용도"],
      ["requiredBuildingUse", "목표 건축물 용도"],
      ["expectedProcedure.code", "예상 행정절차"],
      ["diagnosisStatus", "최종 상태"],
      ["publicDataSnapshot.parking", "주차대수"],
      ["publicDataSnapshot.elevators", "승강기"],
      ["publicDataSnapshot.violationStatus", "위반건축물 상태"]
    ];
    return fields.reduce(function (changes, field) {
      var before = valueAt(previous, field[0]);
      var after = valueAt(next, field[0]);
      if (String(before) !== String(after)) {
        changes.push({ field: field[0], label: field[1], before: before, after: after });
      }
      return changes;
    }, []);
  }

  function buildRecord(options) {
    var industry = options.industry || {};
    var diagnosis = options.diagnosis || {};
    var procedureResult = options.procedureResult || {};
    var procedure = procedureResult.procedure || {};
    var input = clone(diagnosis.input || options.input || {});
    var previous = options.previous || null;
    var now = new Date().toISOString();
    var next = {
      schemaVersion: "1.0.0",
      recordKey: makeRecordKey(input, industry.id),
      listingId: text(input.listingId),
      address: text(input.address),
      floor: text(input.floor),
      unit: text(input.unit),
      area: text(input.area),
      industryId: text(industry.id),
      industryName: text(industry.officialName),
      currentBuildingUse: text(procedureResult.currentUse),
      requiredBuildingUse: text(
        procedureResult.targetType && procedureResult.targetType.label ||
        procedureResult.target && procedureResult.target.target && procedureResult.target.target.label
      ),
      expectedProcedure: {
        code: text(procedure.code) || "UNDETERMINED",
        label: text(procedure.label) || "자동판정 불가",
        description: text(procedure.description)
      },
      facilityChecks: clone(options.facilityChecks || {}),
      publicDataSnapshot: compactPublicData(diagnosis),
      agencyContacts: clone(options.agencyContacts || []),
      callResults: clone(options.callResults || {}),
      diagnosisStatus: text(options.diagnosisStatus) || "UNKNOWN",
      legalRuleVersion: text(procedureResult.ruleVersion),
      createdAt: previous && previous.createdAt || now,
      updatedAt: now,
      history: clone(previous && previous.history || [])
    };
    var changes = compare(previous, next);
    if (previous) {
      next.history.unshift({
        savedAt: text(previous.updatedAt),
        diagnosisStatus: text(previous.diagnosisStatus),
        currentBuildingUse: text(previous.currentBuildingUse),
        expectedProcedure: clone(previous.expectedProcedure || {}),
        publicDataQueriedAt: text(previous.publicDataSnapshot && previous.publicDataSnapshot.queriedAt),
        changesToNext: changes
      });
      next.history = next.history.slice(0, 10);
    }
    next.lastChanges = changes;
    return next;
  }

  function accountStorageKey(prefix, recordKey) {
    if (!DEVICE_ACCOUNT_EMAIL) return "";
    return prefix + encodeURIComponent(DEVICE_ACCOUNT_EMAIL) + "_" + recordKey;
  }

  function localKey(recordKey) {
    return accountStorageKey(LOCAL_PREFIX, recordKey);
  }

  function dirtyKey(recordKey) {
    return accountStorageKey(DIRTY_PREFIX, recordKey);
  }

  function conflictKey(recordKey) {
    return accountStorageKey(CONFLICT_PREFIX, recordKey);
  }

  function operationKey(recordKey) {
    return accountStorageKey(OPERATION_PREFIX, recordKey);
  }

  function readStorageJson(key) {
    if (!key) return null;
    try {
      return JSON.parse(global.localStorage.getItem(key) || "null");
    } catch (_) {
      return null;
    }
  }

  function writeStorageJson(key, value) {
    if (!key) return false;
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeStorageKey(key) {
    if (!key) return;
    try {
      if (typeof global.localStorage.removeItem === "function") {
        global.localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  function readAccountStorageJson(prefix, recordKey) {
    var scopedKey = accountStorageKey(prefix, recordKey);
    var scoped = readStorageJson(scopedKey);
    if (scoped) return scoped;

    // Accountless keys from older releases are ambiguous and must never be
    // adopted by whichever user happens to sign in next. Only a legacy value
    // carrying an exact owner tag, or an exact pre-asset owner marker captured
    // by the auth gate, can be migrated automatically.
    var legacyKey = prefix + recordKey;
    var legacy = readStorageJson(legacyKey);
    if (!legacy) return null;
    var taggedOwner = text(legacy.deviceOwnerEmail).toLowerCase();
    var ownerProven = taggedOwner
      ? taggedOwner === DEVICE_ACCOUNT_EMAIL
      : Boolean(LEGACY_STORAGE_OWNER_EMAIL && LEGACY_STORAGE_OWNER_EMAIL === DEVICE_ACCOUNT_EMAIL);
    if (!ownerProven) return null;
    if (!writeStorageJson(scopedKey, legacy)) return null;
    removeStorageKey(legacyKey);
    return legacy;
  }

  function nextSaveOperationId(record) {
    saveOperationCounter += 1;
    return saveInstanceId + "-" + saveOperationCounter.toString(36) + "-" +
      hash(JSON.stringify(record || {}));
  }

  function markLatestOperation(recordKey, operationId) {
    return writeStorageJson(operationKey(recordKey), {
      deviceOwnerEmail: DEVICE_ACCOUNT_EMAIL,
      recordKey: recordKey,
      operationId: operationId,
      startedAt: new Date().toISOString()
    });
  }

  function latestOperationId(recordKey) {
    var marker = readAccountStorageJson(OPERATION_PREFIX, recordKey);
    return marker && marker.recordKey === recordKey ? text(marker.operationId) : "";
  }

  function saveLocal(record) {
    return writeStorageJson(localKey(record.recordKey), record);
  }

  function loadLocal(recordKey) {
    var value = readAccountStorageJson(LOCAL_PREFIX, recordKey);
    return value && value.recordKey === recordKey ? value : null;
  }

  function loadDirtyDraft(recordKey) {
    var value = readAccountStorageJson(DIRTY_PREFIX, recordKey);
    return value && value.recordKey === recordKey && value.record && value.record.recordKey === recordKey
      ? value : null;
  }

  function saveDirtyDraft(record, details) {
    var now = new Date().toISOString();
    var previous = loadDirtyDraft(record.recordKey) || {};
    var options = details || {};
    var requestedOperationId = text(options.operationId);
    if (requestedOperationId && latestOperationId(record.recordKey) !== requestedOperationId) {
      return false;
    }
    var hasRemote = Object.prototype.hasOwnProperty.call(options, "remoteRecord");
    var hasRemoteVersion = Object.prototype.hasOwnProperty.call(options, "remoteVersion");
    var envelope = {
      schemaVersion: "1.0.0",
      deviceOwnerEmail: DEVICE_ACCOUNT_EMAIL,
      recordKey: record.recordKey,
      record: clone(record),
      operationId: requestedOperationId || text(previous.operationId),
      parentOperationId: text(options.parentOperationId) || text(previous.parentOperationId),
      reason: text(options.reason) || text(previous.reason) || "pending",
      message: text(options.message) || text(previous.message),
      savedAt: text(previous.savedAt) || now,
      updatedAt: now,
      remoteVersion: hasRemoteVersion
        ? Math.max(0, Number(options.remoteVersion) || 0)
        : Math.max(0, Number(previous.remoteVersion) || 0),
      remoteRecord: hasRemote
        ? clone(options.remoteRecord)
        : clone(previous.remoteRecord || null)
    };
    return writeStorageJson(dirtyKey(record.recordKey), envelope);
  }

  function clearDirtyDraft(recordKey, operationId) {
    var current = loadDirtyDraft(recordKey);
    if (!current || text(current.operationId) !== text(operationId) ||
        latestOperationId(recordKey) !== text(operationId)) {
      return false;
    }
    removeStorageKey(dirtyKey(recordKey));
    return !loadDirtyDraft(recordKey);
  }

  function loadConflict(recordKey) {
    var value = readAccountStorageJson(CONFLICT_PREFIX, recordKey);
    return value && value.recordKey === recordKey && Array.isArray(value.entries) ? value : null;
  }

  function archiveConflict(record, remoteRecord, remoteVersion, message, operationId) {
    var archive = loadConflict(record.recordKey) || {
      schemaVersion: "1.0.0",
      deviceOwnerEmail: DEVICE_ACCOUNT_EMAIL,
      recordKey: record.recordKey,
      entries: []
    };
    var entry = {
      detectedAt: new Date().toISOString(),
      remoteVersion: Math.max(0, Number(remoteVersion) || 0),
      localRecord: clone(record),
      remoteRecord: clone(remoteRecord || null),
      message: text(message),
      operationId: text(operationId),
      resolvedAt: "",
      resolvedVersion: 0
    };
    var latest = archive.entries[0];
    var isDuplicate = latest && !text(latest.resolvedAt) &&
      text(latest.operationId) === entry.operationId &&
      Number(latest.remoteVersion) === entry.remoteVersion &&
      JSON.stringify(latest.localRecord) === JSON.stringify(entry.localRecord) &&
      JSON.stringify(latest.remoteRecord) === JSON.stringify(entry.remoteRecord);
    if (!isDuplicate) archive.entries.unshift(entry);
    archive.entries = archive.entries.slice(0, 3);
    return writeStorageJson(conflictKey(record.recordKey), archive);
  }

  function resolveLatestConflict(recordKey, version, operationIds) {
    var archive = loadConflict(recordKey);
    if (!archive) return;
    var acknowledged = (operationIds || []).map(text).filter(Boolean);
    var entry = archive.entries.find(function (item) {
      return item && !text(item.resolvedAt) && acknowledged.indexOf(text(item.operationId)) !== -1;
    });
    if (!entry) return;
    entry.resolvedAt = new Date().toISOString();
    entry.resolvedVersion = Math.max(0, Number(version) || 0);
    writeStorageJson(conflictKey(recordKey), archive);
  }

  function warn(message) {
    if (global.console && typeof global.console.warn === "function") {
      global.console.warn(message);
    }
  }

  function isAccountChangedError(error) {
    return Number(error && error.status) === 409 &&
      text(error && error.payload && error.payload.code || error && error.code) === "account_changed";
  }

  function accountChangedWarning() {
    return "로그인 계정이 변경되었습니다. 이 계정의 진단 초안은 분리해 보존했습니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요.";
  }

  function withTimeout(work) {
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 5000);
    return Promise.resolve().then(function () {
      return work(controller.signal);
    }).finally(function () {
      global.clearTimeout(timer);
    });
  }

  function request(url, options) {
    return withTimeout(function (signal) {
      var requestOptions = Object.assign({}, options || {}, { signal: signal });
      return fetch(url, requestOptions).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok || !result || result.ok === false) {
            var error = new Error(result && result.message || "진단 저장 서버가 응답하지 않았습니다.");
            error.status = Number(response && response.status || 0);
            error.payload = result || null;
            throw error;
          }
          return result;
        });
      });
    });
  }

  function sharedAccess(method) {
    var access = global.JSDataAccessV6;
    return access && typeof access[method] === "function" ? access : null;
  }

  function readCloudState(recordKey) {
    var access = sharedAccess("read");
    if (access) {
      return withTimeout(function (signal) {
        return access.read("loadCloudState", {
          scope: SCOPE,
          recordKey: recordKey,
          expectedAccountEmail: DEVICE_ACCOUNT_EMAIL
        }, {
          cache: "no-store",
          signal: signal,
          errorMessage: "진단 저장 서버가 응답하지 않았습니다."
        });
      });
    }
    var url = (global.saveApiURL || "/api/data") +
      "?action=loadCloudState&scope=" + encodeURIComponent(SCOPE) +
      "&recordKey=" + encodeURIComponent(recordKey) +
      "&expectedAccountEmail=" + encodeURIComponent(DEVICE_ACCOUNT_EMAIL) + "&_=" + Date.now();
    return request(url, { credentials: "same-origin", cache: "no-store" });
  }

  function load(recordKey) {
    var draftAtStart = loadDirtyDraft(recordKey);
    return readCloudState(recordKey)
      .then(function (result) {
        cloudVersions[recordKey] = Math.max(
          Math.max(0, Number(cloudVersions[recordKey]) || 0),
          Math.max(0, Number(result && result.version) || 0)
        );
        var draft = loadDirtyDraft(recordKey);
        if (draft) {
          saveDirtyDraft(draft.record, {
            reason: draft.reason,
            message: draft.message,
            remoteVersion: cloudVersions[recordKey],
            remoteRecord: result && result.found ? result.data : null
          });
          warn("저장되지 않은 진단 초안을 유지하고 최신 클라우드 버전만 확인했습니다.");
          return draft.record;
        }
        // A save may have completed while this read was in flight.  The draft
        // seen at the start is still safer than allowing an older response to
        // replace the just-saved local record, but it must not be re-marked dirty.
        if (draftAtStart) return draftAtStart.record;
        if (result.found && result.data) {
          writeStorageJson(localKey(recordKey), result.data);
          return result.data;
        }
        return loadLocal(recordKey);
      })
      .catch(function (error) {
        if (isAccountChangedError(error)) {
          var warning = accountChangedWarning();
          warn(warning);
          error.message = warning;
          error.code = "account_changed";
          throw error;
        }
        var draft = loadDirtyDraft(recordKey);
        if (draft) return draft.record;
        return loadLocal(recordKey);
      });
  }

  function save(record) {
    var previousDraft = loadDirtyDraft(record.recordKey);
    var parentOperationId = text(previousDraft && previousDraft.operationId);
    var operationId = nextSaveOperationId(record);
    markLatestOperation(record.recordKey, operationId);
    var localSaved = saveLocal(record);
    var draftSaved = saveDirtyDraft(record, {
      reason: "pending",
      message: "",
      operationId: operationId,
      parentOperationId: parentOperationId
    });
    var payload = {
      scope: SCOPE,
      recordKey: record.recordKey,
      data: record,
      expectedAccountEmail: DEVICE_ACCOUNT_EMAIL,
      expectedVersion: Math.max(0, Number(cloudVersions[record.recordKey]) || 0)
    };
    function saveThroughFallback() {
      return request(global.saveApiURL || "/api/data", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ action: "saveCloudState" }, payload))
      });
    }
    var access = sharedAccess("mutate");
    var cloudSave = access
      ? withTimeout(function (signal) {
        return access.mutate("saveCloudState", payload, {
          signal: signal,
          errorMessage: "진단 저장 서버가 응답하지 않았습니다."
        });
      })
      : saveThroughFallback();
    return cloudSave.then(function (result) {
      cloudVersions[record.recordKey] = Math.max(
        Math.max(0, Number(cloudVersions[record.recordKey]) || 0),
        Math.max(0, Number(result && result.version) || 0)
      );
      var clearedOwnDraft = clearDirtyDraft(record.recordKey, operationId);
      resolveLatestConflict(record.recordKey, cloudVersions[record.recordKey], [
        operationId,
        parentOperationId
      ]);
      return {
        record: record,
        cloudSaved: true,
        localSaved: localSaved,
        pendingDraft: !clearedOwnDraft && Boolean(loadDirtyDraft(record.recordKey)),
        conflict: false,
        operationId: operationId
      };
    }).catch(function (error) {
      if (isAccountChangedError(error)) {
        var accountWarning = accountChangedWarning();
        draftSaved = saveDirtyDraft(record, {
          reason: "account-changed",
          message: accountWarning,
          operationId: operationId,
          parentOperationId: parentOperationId
        }) || draftSaved;
        warn(accountWarning);
        return {
          record: record,
          cloudSaved: false,
          localSaved: localSaved,
          pendingDraft: Boolean(loadDirtyDraft(record.recordKey)),
          conflict: false,
          accountChanged: true,
          terminal: true,
          warning: accountWarning,
          operationId: operationId
        };
      }
      if (Number(error && error.status) === 409) {
        return readCloudState(record.recordKey).then(function (latest) {
          var version = Math.max(0, Number(latest && latest.version) || 0);
          var remoteRecord = latest && latest.found ? latest.data : null;
          var warning = "다른 창 또는 기기에서 같은 진단이 변경되었습니다. 이 기기의 진단 초안과 클라우드 변경본을 각각 보존했습니다. 다시 저장하면 이 기기의 현재 진단으로 계정 저장을 재시도합니다.";
          cloudVersions[record.recordKey] = Math.max(
            Math.max(0, Number(cloudVersions[record.recordKey]) || 0),
            version
          );
          draftSaved = saveDirtyDraft(record, {
            reason: "conflict",
            message: warning,
            remoteVersion: version,
            remoteRecord: remoteRecord,
            operationId: operationId,
            parentOperationId: parentOperationId
          }) || draftSaved;
          archiveConflict(record, remoteRecord, version, warning, operationId);
          warn(warning);
          return {
            record: record,
            cloudSaved: false,
            localSaved: localSaved,
            pendingDraft: Boolean(loadDirtyDraft(record.recordKey)),
            conflict: true,
            cloudVersion: version,
            latestRecord: clone(remoteRecord),
            warning: warning,
            operationId: operationId
          };
        }).catch(function (refreshError) {
          if (isAccountChangedError(refreshError)) {
            var accountWarning = accountChangedWarning();
            draftSaved = saveDirtyDraft(record, {
              reason: "account-changed",
              message: accountWarning,
              operationId: operationId,
              parentOperationId: parentOperationId
            }) || draftSaved;
            warn(accountWarning);
            return {
              record: record,
              cloudSaved: false,
              localSaved: localSaved,
              pendingDraft: Boolean(loadDirtyDraft(record.recordKey)),
              conflict: false,
              accountChanged: true,
              terminal: true,
              warning: accountWarning,
              operationId: operationId
            };
          }
          var warning = "다른 창 또는 기기에서 같은 진단이 변경되었습니다. 이 기기의 진단 초안은 보존했지만 최신 클라우드본을 확인하지 못했습니다. 다시 불러온 뒤 저장해 주세요.";
          draftSaved = saveDirtyDraft(record, {
            reason: "conflict",
            message: warning,
            operationId: operationId,
            parentOperationId: parentOperationId
          }) || draftSaved;
          archiveConflict(record, null, cloudVersions[record.recordKey], warning, operationId);
          warn(warning + " " + text(refreshError && refreshError.message));
          return {
            record: record,
            cloudSaved: false,
            localSaved: localSaved,
            pendingDraft: Boolean(loadDirtyDraft(record.recordKey)),
            conflict: true,
            warning: warning,
            operationId: operationId
          };
        });
      }
      var warning = localSaved || draftSaved
        ? text(error && error.message) || "계정 클라우드 저장을 완료하지 못했습니다. 이 기기의 진단 초안은 보존했습니다."
        : "브라우저 저장공간과 계정 클라우드 저장을 모두 사용할 수 없습니다.";
      draftSaved = saveDirtyDraft(record, {
        reason: "sync-failed",
        message: warning,
        operationId: operationId,
        parentOperationId: parentOperationId
      }) || draftSaved;
      return {
        record: record,
        cloudSaved: false,
        localSaved: localSaved,
        pendingDraft: Boolean(loadDirtyDraft(record.recordKey)),
        conflict: false,
        warning: warning,
        operationId: operationId
      };
    });
  }

  global.PermitDiagnosisStorageV1 = {
    makeRecordKey: makeRecordKey,
    compactPublicData: compactPublicData,
    compare: compare,
    buildRecord: buildRecord,
    load: load,
    save: save,
    loadLocal: loadLocal,
    saveLocal: saveLocal,
    loadDirtyDraft: loadDirtyDraft,
    loadConflict: loadConflict
  };
})(window);
