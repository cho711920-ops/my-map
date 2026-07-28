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

  function loadCurrent() {
    var key = currentKey();
    if (!key) {
      setStatus("매물번호 또는 주소·층·호실을 확인해 주세요.", true);
      return Promise.resolve(null);
    }
    setStatus("기존 진단을 불러오고 있습니다.");
    return global.PermitDiagnosisStorageV1.load(key).then(function (record) {
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
    });
  }

  function saveCurrent() {
    if (!state.industry || !state.diagnosis || !state.procedure) {
      setStatus("업종 선택과 공공데이터 조회를 먼저 완료해 주세요.", true);
      return;
    }
    setStatus("현재 진단을 저장하고 있습니다.");
    global.PermitDiagnosisStorageV1.load(currentKey()).then(function (previous) {
      var record = buildRecord(previous);
      return global.PermitDiagnosisStorageV1.save(record);
    }).then(function (result) {
      state.loadedRecord = result.record;
      var report = document.getElementById("permitStep6ReportV1");
      if (report) report.innerHTML = global.PermitDiagnosisReportV1.render(result.record);
      setStatus(result.cloudSaved
        ? "계정 클라우드에 진단을 저장했습니다."
        : "이 기기에 저장했습니다. 계정 클라우드 저장은 로그인 상태를 확인해 주세요.");
    }).catch(function (error) {
      setStatus(error.message, true);
    });
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

  global.PermitDiagnosisStep6V1 = {
    renderPanel: renderPanel,
    buildRecord: buildRecord
  };
})(window, document);
