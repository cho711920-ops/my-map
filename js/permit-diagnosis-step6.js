(function (global, document) {
  "use strict";

  var state = {
    industry: null,
    diagnosis: null,
    procedure: null,
    facilityChecks: null,
    diagnosisStatus: "UNKNOWN",
    agencyContacts: [],
    callResults: {},
    loadedRecord: null
  };
  var saveInFlight = null;

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function currentKey() {
    if (!state.industry || !state.diagnosis) return "";
    try {
      return global.PermitDiagnosisStorageV1.makeRecordKey(
        state.diagnosis.input || {},
        state.industry.id
      );
    } catch (_) {
      return "";
    }
  }

  function panelHtml() {
    return '<section id="permitStep6V1" class="permit-step6-v1">' +
      '<header class="permit-step6-head-v1"><div><h4>진단 저장·재진단</h4>' +
        '<p>같은 매물도 업종별로 별도 저장합니다.</p></div></header>' +
      '<div class="permit-step6-actions-v1">' +
        '<button type="button" data-permit-diagnosis-save>현재 진단 저장</button>' +
        '<button type="button" data-permit-diagnosis-load>기존 진단 불러오기</button>' +
        '<button type="button" data-permit-diagnosis-refresh>최신 공공데이터 재조회</button>' +
      '</div>' +
      '<div id="permitStep6StatusV1" class="permit-step6-status-v1">저장할 진단 결과를 확인해 주세요.</div>' +
      '<div id="permitStep6ReportV1">' +
        (state.loadedRecord ? global.PermitDiagnosisReportV1.render(state.loadedRecord) : "") +
      '</div></section>';
  }

  function renderPanel() {
    if (!state.industry || !state.diagnosis || !state.procedure) return;
    var host = document.getElementById("permitPublicDataResultsV1");
    if (!host) return;
    var old = document.getElementById("permitStep6V1");
    if (old) old.remove();
    host.insertAdjacentHTML("beforeend", panelHtml());
  }

  function setStatus(message, error) {
    var element = document.getElementById("permitStep6StatusV1");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", Boolean(error));
  }

  function setSaveBusy(busy) {
    if (typeof document.querySelector !== "function") return;
    var button = document.querySelector("[data-permit-diagnosis-save]");
    if (!button) return;
    button.disabled = Boolean(busy);
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }

  function buildRecord(previous) {
    return global.PermitDiagnosisStorageV1.buildRecord({
      industry: state.industry,
      diagnosis: state.diagnosis,
      procedureResult: state.procedure,
      facilityChecks: state.facilityChecks && state.facilityChecks.checks || {},
      diagnosisStatus: state.diagnosisStatus,
      agencyContacts: state.agencyContacts,
      callResults: state.callResults,
      previous: previous
    });
  }

  function previousRecordForSave(recordKey) {
    var storage = global.PermitDiagnosisStorageV1;
    var draft = typeof storage.loadDirtyDraft === "function"
      ? storage.loadDirtyDraft(recordKey) : null;
    if (draft && draft.record && draft.record.recordKey === recordKey) return draft.record;
    if (state.loadedRecord && state.loadedRecord.recordKey === recordKey) return state.loadedRecord;
    return storage.loadLocal(recordKey);
  }

  function loadCurrent() {
    var key = currentKey();
    if (!key) {
      setStatus("매물번호 또는 주소·층·호실을 확인해 주세요.", true);
      return Promise.resolve(null);
    }
    setStatus("기존 진단을 불러오고 있습니다.");
    var timeout = new Promise(function (resolve) {
      global.setTimeout(function () {
        resolve(global.PermitDiagnosisStorageV1.loadLocal(key));
      }, 5000);
    });
    return Promise.race([
      global.PermitDiagnosisStorageV1.load(key),
      timeout
    ]).then(function (record) {
      state.loadedRecord = record;
      var report = document.getElementById("permitStep6ReportV1");
      if (report) report.innerHTML = record
        ? global.PermitDiagnosisReportV1.render(record)
        : '<div class="permit-step6-empty-v1">이 매물·업종으로 저장된 진단이 없습니다.</div>';
      if (record) {
        state.callResults = record.callResults || {};
        document.dispatchEvent(new CustomEvent("permit:diagnosis-loaded-v1", {
          detail: { record: record }
        }));
        setStatus("저장된 진단을 불러왔습니다.");
      } else {
        setStatus("저장된 진단이 없습니다.");
      }
      return record;
    }).catch(function (error) {
      var accountChanged = error && error.code === "account_changed";
      if (accountChanged) {
        state.loadedRecord = null;
        var report = document.getElementById("permitStep6ReportV1");
        if (report) report.innerHTML = "";
      }
      setStatus(accountChanged
        ? error.message
        : "저장된 진단을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
      return null;
    });
  }

  function saveCurrent() {
    if (saveInFlight) return saveInFlight;
    if (!state.industry || !state.diagnosis || !state.procedure) {
      setStatus("업종 선택과 공공데이터 조회를 먼저 완료해 주세요.", true);
      return Promise.resolve(null);
    }
    var recordKey = currentKey();
    if (!recordKey) {
      setStatus("매물번호 또는 주소·층·호실을 확인해 주세요.", true);
      return Promise.resolve(null);
    }
    setStatus("현재 진단을 저장하고 있습니다.");
    setSaveBusy(true);
    var work = Promise.resolve().then(function () {
      // Do not preflight the cloud here. The version captured by an explicit
      // load must remain the CAS baseline so a stale tab receives a 409 instead
      // of silently replacing a newer diagnosis.
      var record = buildRecord(previousRecordForSave(recordKey));
      return global.PermitDiagnosisStorageV1.save(record);
    }).then(function (result) {
      if (result.accountChanged) {
        state.loadedRecord = null;
        var staleReport = document.getElementById("permitStep6ReportV1");
        if (staleReport) staleReport.innerHTML = "";
        setStatus(result.warning, true);
        return result;
      }
      state.loadedRecord = result.record;
      var report = document.getElementById("permitStep6ReportV1");
      if (report) report.innerHTML = global.PermitDiagnosisReportV1.render(result.record);
      setStatus(result.cloudSaved
        ? (result.localSaved
          ? "계정 클라우드와 이 기기에 진단을 저장했습니다."
          : "계정 클라우드에 진단을 저장했습니다. 브라우저 저장공간은 가득 찼지만 진단 불러오기는 가능합니다.")
        : (result.conflict
          ? result.warning
          : (result.localSaved
            ? "이 기기에 저장했습니다. 계정 클라우드 저장은 로그인 상태를 확인해 주세요."
            : result.warning)), !result.cloudSaved && (!result.localSaved || result.conflict));
      return result;
    }).catch(function (error) {
      setStatus(error.message, true);
      return null;
    });
    saveInFlight = work.finally(function () {
      saveInFlight = null;
      setSaveBusy(false);
    });
    return saveInFlight;
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-permit-diagnosis-save]")) saveCurrent();
    if (event.target.closest("[data-permit-diagnosis-load]")) loadCurrent();
    if (event.target.closest("[data-permit-diagnosis-refresh]")) {
      var button = document.getElementById("permitPublicDataBtnV1");
      if (button) button.click();
    }
  });

  document.addEventListener("permit:industry-selected-v1", function (event) {
    state.industry = event.detail && event.detail.industry;
    state.loadedRecord = null;
  });

  document.addEventListener("permit:public-data-v1", function (event) {
    state.diagnosis = event.detail && event.detail.diagnosis;
    state.procedure = null;
  });

  document.addEventListener("permit:procedure-diagnosed-v1", function (event) {
    state.procedure = event.detail && event.detail.result;
  });

  document.addEventListener("permit:facility-checks-updated-v1", function (event) {
    state.facilityChecks = event.detail || null;
    state.diagnosisStatus = event.detail && event.detail.summary && event.detail.summary.status || "UNKNOWN";
  });

  document.addEventListener("permit:agency-rendered-v1", function (event) {
    state.agencyContacts = event.detail && event.detail.contacts || [];
    renderPanel();
  });

  document.addEventListener("permit:call-result-updated-v1", function (event) {
    var detail = event.detail || {};
    if (!detail.contactId) return;
    state.callResults[detail.contactId] = {
      confirmed: Boolean(detail.confirmed),
      note: String(detail.note || ""),
      updatedAt: detail.updatedAt || new Date().toISOString()
    };
  });

  document.addEventListener("permit:reset-v1", function () {
    state.industry = null;
    state.diagnosis = null;
    state.procedure = null;
    state.facilityChecks = null;
    state.diagnosisStatus = "UNKNOWN";
    state.agencyContacts = [];
    state.callResults = {};
    state.loadedRecord = null;
  });

  global.PermitDiagnosisStep6V1 = {
    renderPanel: renderPanel,
    buildRecord: buildRecord,
    loadCurrent: loadCurrent,
    saveCurrent: saveCurrent
  };
})(window, document);
