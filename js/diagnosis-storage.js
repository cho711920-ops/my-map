(function (global) {
  "use strict";

  var SCOPE = "permitDiagnosis";
  var LOCAL_PREFIX = "js_permit_diagnosis_v1_";

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

  function localKey(recordKey) {
    return LOCAL_PREFIX + recordKey;
  }

  function saveLocal(record) {
    try {
      global.localStorage.setItem(localKey(record.recordKey), JSON.stringify(record));
      return true;
    } catch (_) {
      return false;
    }
  }

  function loadLocal(recordKey) {
    try {
      var value = JSON.parse(global.localStorage.getItem(localKey(recordKey)) || "null");
      return value && value.recordKey === recordKey ? value : null;
    } catch (_) {
      return null;
    }
  }

  function request(url, options) {
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 5000);
    var requestOptions = Object.assign({}, options || {}, { signal: controller.signal });
    return fetch(url, requestOptions).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok || !result || result.ok === false) {
          throw new Error(result && result.message || "진단 저장 서버가 응답하지 않았습니다.");
        }
        return result;
      });
    }).finally(function () {
      global.clearTimeout(timer);
    });
  }

  function load(recordKey) {
    var url = (global.saveApiURL || "/api/data") +
      "?action=loadCloudState&scope=" + encodeURIComponent(SCOPE) +
      "&recordKey=" + encodeURIComponent(recordKey) + "&_=" + Date.now();
    return request(url, { credentials: "same-origin", cache: "no-store" })
      .then(function (result) {
        if (result.found && result.data) {
          try {
            global.localStorage.setItem(localKey(recordKey), JSON.stringify(result.data));
          } catch (_) {}
          return result.data;
        }
        return loadLocal(recordKey);
      })
      .catch(function () {
        return loadLocal(recordKey);
      });
  }

  function save(record) {
    var localSaved = saveLocal(record);
    return request(global.saveApiURL || "/api/data", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "saveCloudState",
        scope: SCOPE,
        recordKey: record.recordKey,
        data: record,
        version: Date.now()
      })
    }).then(function () {
      return { record: record, cloudSaved: true, localSaved: localSaved };
    }).catch(function (error) {
      return {
        record: record,
        cloudSaved: false,
        localSaved: localSaved,
        warning: localSaved
          ? error.message
          : "브라우저 저장공간과 계정 클라우드 저장을 모두 사용할 수 없습니다."
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
    saveLocal: saveLocal
  };
})(window);
