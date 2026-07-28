(function (global) {
  "use strict";

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function statusLabel(status) {
    return {
      GREEN: "현재 자료상 가능성 높음",
      YELLOW: "시설 보완 후 가능성 있음",
      ORANGE: "행정절차·시설 검토 필요",
      RED: "현재 자료상 입점 곤란",
      UNKNOWN: "미확인 항목 확인 필요"
    }[status] || "미확인 항목 확인 필요";
  }

  function renderChanges(changes) {
    if (!changes || !changes.length) return '<p>이전 저장 결과와 달라진 핵심 판정이 없습니다.</p>';
    return '<ul>' + changes.map(function (change) {
      return '<li><strong>' + escapeHtml(change.label) + '</strong> ' +
        escapeHtml(change.before || "미확인") + ' → ' + escapeHtml(change.after || "미확인") + '</li>';
    }).join("") + '</ul>';
  }

  function render(record) {
    if (!record) return "";
    var historyCount = Array.isArray(record.history) ? record.history.length : 0;
    return '<div class="permit-saved-report-v1">' +
      '<div class="permit-saved-summary-v1">' +
        '<div><small>저장 업종</small><strong>' + escapeHtml(record.industryName) + '</strong></div>' +
        '<div><small>최종 상태</small><strong data-status="' + escapeHtml(record.diagnosisStatus) + '">' +
          escapeHtml(record.diagnosisStatus + " · " + statusLabel(record.diagnosisStatus)) + '</strong></div>' +
        '<div><small>예상 절차</small><strong>' + escapeHtml(record.expectedProcedure.label) + '</strong></div>' +
        '<div><small>이전 기록</small><strong>' + historyCount + '회</strong></div>' +
      '</div>' +
      '<div class="permit-saved-changes-v1"><strong>이전 결과와 변경사항</strong>' +
        renderChanges(record.lastChanges) + '</div>' +
      '<p class="permit-saved-time-v1">최근 저장 ' + escapeHtml(record.updatedAt) +
        ' · 규칙 ' + escapeHtml(record.legalRuleVersion || "미확인") + '</p>' +
    '</div>';
  }

  global.PermitDiagnosisReportV1 = {
    statusLabel: statusLabel,
    renderChanges: renderChanges,
    render: render
  };
})(window);
