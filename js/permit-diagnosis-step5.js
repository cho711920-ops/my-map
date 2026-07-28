(function (global, document) {
  "use strict";

  var selectedIndustry = null;
  var lastDiagnosis = null;
  var lastProcedure = null;
  var scriptsById = {};

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function cleanPhone(phone) {
    return String(phone || "").replace(/[^0-9+]/g, "");
  }

  function renderContact(contact, script) {
    var phone = contact.directPhone || contact.representativePhone;
    var phoneLabel = contact.directPhone ? "직통번호" : "대표번호";
    scriptsById[contact.id] = script;
    return '<article class="permit-agency-card-v1">' +
      '<div class="permit-agency-title-v1"><div><small>' + escapeHtml(contact.roleLabel) + '</small>' +
        '<strong>' + escapeHtml(contact.agencyName) + '</strong></div>' +
        '<a href="' + escapeHtml(contact.officialUrl) + '" target="_blank" rel="noopener noreferrer">공식 출처</a></div>' +
      '<dl><div><dt>담당 연결 요청</dt><dd>' + escapeHtml(contact.departmentRequest) + '</dd></div>' +
        '<div><dt>' + phoneLabel + '</dt><dd>' + escapeHtml(phone || "UNKNOWN") + '</dd></div>' +
        '<div><dt>확인일</dt><dd>' + escapeHtml(contact.verifiedAt) + '</dd></div></dl>' +
      '<pre>' + escapeHtml(script) + '</pre>' +
      '<textarea class="permit-call-note-v1" data-permit-call-note="' + escapeHtml(contact.id) +
        '" placeholder="통화 담당자·답변·확인사항 메모"></textarea>' +
      '<div class="permit-agency-actions-v1">' +
        '<button type="button" data-permit-copy-call="' + escapeHtml(contact.id) + '">질문 복사</button>' +
        (phone ? '<a href="tel:' + cleanPhone(phone) + '">전화 걸기</a>' : '') +
        '<button type="button" data-permit-call-done="' + escapeHtml(contact.id) + '">확인완료 기록</button>' +
      '</div></article>';
  }

  function publicInput() {
    return lastDiagnosis && lastDiagnosis.input ? lastDiagnosis.input : {};
  }

  function evaluateAndShow() {
    if (!selectedIndustry || !lastDiagnosis || !lastProcedure) return;
    global.PermitAgencyContactResolverV1.load().then(function (data) {
      var input = publicInput();
      var resolved = global.PermitAgencyContactResolverV1.resolve(input.address, data);
      var host = document.getElementById("permitPublicDataResultsV1");
      if (!host) return;
      var old = document.getElementById("permitStep5V1");
      if (old) old.remove();
      scriptsById = {};
      var cards = resolved.contacts.map(function (contact) {
        var script = global.PermitCallScriptGeneratorV1.generate(contact, {
          input: input,
          industry: selectedIndustry,
          currentUse: lastProcedure.currentUse,
          procedure: lastProcedure.procedure
        });
        return renderContact(contact, script);
      }).join("");
      host.insertAdjacentHTML("beforeend",
        '<section id="permitStep5V1" class="permit-step5-v1">' +
          '<header class="permit-step5-head-v1"><div><h4>관할기관·전화 질문</h4>' +
            '<p>' + escapeHtml(resolved.jurisdictionKey || "관할 미확인") +
            ' · 공식 대표번호 기준</p></div></header>' +
          '<div class="permit-step5-notice-v1">' + escapeHtml(resolved.notice) + '</div>' +
          (cards ? '<div class="permit-agency-grid-v1">' + cards + '</div>' :
            '<div class="permit-step2-error-v1">주소의 관할 구를 확인한 뒤 다시 조회해 주세요.</div>') +
          '<div id="permitStep5StatusV1" class="permit-step5-status-v1" aria-live="polite">' +
            '통화 결과의 영구 저장과 재진단 이력은 STEP 6에서 연결됩니다.</div>' +
        '</section>');
      document.dispatchEvent(new CustomEvent("permit:agency-rendered-v1", {
        detail: { contacts: resolved.contacts }
      }));
    }).catch(function (error) {
      var host = document.getElementById("permitPublicDataResultsV1");
      if (host) host.insertAdjacentHTML("beforeend",
        '<div class="permit-step2-error-v1">' + escapeHtml(error.message) + '</div>');
    });
  }

  function copyText(value) {
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(value);
    }
    return Promise.reject(new Error("이 브라우저에서는 자동 복사가 지원되지 않습니다."));
  }

  document.addEventListener("click", function (event) {
    var copyButton = event.target.closest("[data-permit-copy-call]");
    var doneButton = event.target.closest("[data-permit-call-done]");
    var status = document.getElementById("permitStep5StatusV1");
    if (copyButton) {
      copyText(scriptsById[copyButton.getAttribute("data-permit-copy-call")] || "")
        .then(function () {
          if (status) status.textContent = "전화 질문을 복사했습니다.";
        })
        .catch(function (error) {
          if (status) status.textContent = error.message;
        });
    }
    if (doneButton) {
      doneButton.classList.toggle("done");
      doneButton.textContent = doneButton.classList.contains("done") ? "확인완료 ✓" : "확인완료 기록";
      if (status) status.textContent = "이 화면에서 확인 상태를 표시했습니다. 영구 저장은 STEP 6에서 연결됩니다.";
      var contactId = doneButton.getAttribute("data-permit-call-done");
      var note = document.querySelector('[data-permit-call-note="' + contactId + '"]');
      document.dispatchEvent(new CustomEvent("permit:call-result-updated-v1", {
        detail: {
          contactId: contactId,
          confirmed: doneButton.classList.contains("done"),
          note: note ? note.value : "",
          updatedAt: new Date().toISOString()
        }
      }));
    }
  });

  document.addEventListener("input", function (event) {
    var note = event.target.closest("[data-permit-call-note]");
    if (!note) return;
    var contactId = note.getAttribute("data-permit-call-note");
    var done = document.querySelector('[data-permit-call-done="' + contactId + '"]');
    document.dispatchEvent(new CustomEvent("permit:call-result-updated-v1", {
      detail: {
        contactId: contactId,
        confirmed: Boolean(done && done.classList.contains("done")),
        note: note.value,
        updatedAt: new Date().toISOString()
      }
    }));
  });

  document.addEventListener("permit:industry-selected-v1", function (event) {
    selectedIndustry = event.detail && event.detail.industry;
    lastProcedure = null;
  });

  document.addEventListener("permit:public-data-v1", function (event) {
    lastDiagnosis = event.detail && event.detail.diagnosis;
    lastProcedure = null;
  });

  document.addEventListener("permit:procedure-diagnosed-v1", function (event) {
    lastProcedure = event.detail && event.detail.result;
    evaluateAndShow();
  });

  global.PermitDiagnosisStep5V1 = { renderContact: renderContact };
})(window, document);
