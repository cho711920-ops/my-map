(function (global, document) {
  "use strict";

  var selectedIndustry = null;
  var lastDiagnosis = null;

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function render(result) {
    var target = result.target || {};
    var targetLabel = target.target ? target.target.label : "UNKNOWN";
    var threshold = target.threshold || "";
    var thresholdText = target.branch === "fixed"
      ? (target.reason || "고정 용도 기준")
      : target.thresholdKnown
        ? (target.branch === "below" ? threshold + "㎡ 미만 확인" : threshold + "㎡ 이상 확인")
        : "동일 건물 합계 미확인";
    var sourceLinks = (result.sources || []).map(function (source) {
      return '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(source.title) + '</a>';
    }).join(" · ");
    var risks = result.risks.length
      ? '<ul>' + result.risks.map(function (risk) { return '<li>' + escapeHtml(risk) + '</li>'; }).join("") + '</ul>'
      : '<p>현재 자동판정 범위에서 추가 위험요소가 확인되지 않았습니다.</p>';
    var branches = "";
    if (!target.thresholdKnown && result.alternativeComparison) {
      branches = '<div class="permit-step4-branches-v1">' +
        '<div><small>동일 건물 합계 ' + escapeHtml(target.threshold) + '㎡ 미만이면</small><strong>' +
          escapeHtml(target.target.label) + '</strong><span>' +
          escapeHtml(result.comparison.procedure.label) + '</span></div>' +
        '<div><small>동일 건물 합계 ' + escapeHtml(target.threshold) + '㎡ 이상이면</small><strong>' +
          escapeHtml(target.alternative.label) + '</strong><span>' +
          escapeHtml(result.alternativeComparison.procedure.label) + '</span></div>' +
      '</div>' +
      '<div class="permit-step4-threshold-help-v1"><strong>왜 자동판정이 안 되나요?</strong>' +
        '호실 하나의 면적만 보는 기준이 아니라, 같은 건물 안에서 해당 업종과 관련된 용도로 쓰는 면적의 합계를 확인해야 하기 때문입니다. ' +
        '건축물대장 전유부·층별 현황과 실제 도면을 대조한 뒤 건축사 또는 관할 구청에 확인하면 확정할 수 있습니다.</div>';
    }

    return '<section id="permitStep4V1" class="permit-step4-v1">' +
      '<header class="permit-step4-head-v1"><div><h4>건축물 용도·예상 행정절차</h4>' +
        '<p>규칙 ' + escapeHtml(result.ruleVersion) + ' · 확인 ' + escapeHtml(result.verifiedAt) + '</p></div>' +
        '<span data-status="' + escapeHtml(result.procedure.status) + '">' +
          escapeHtml(result.procedure.label) + '</span></header>' +
      '<div class="permit-step4-flow-v1">' +
        '<div><small>현재 대장 용도</small><strong>' + escapeHtml(result.currentUse || "UNKNOWN") + '</strong>' +
          '<em>' + escapeHtml(result.currentScope || "확인 범위 미상") + '</em></div>' +
        '<b>→</b>' +
        '<div><small>목표 건축물 용도</small><strong>' + escapeHtml(targetLabel) + '</strong>' +
          '<em>' + escapeHtml(thresholdText) + '</em></div>' +
        '<b>→</b>' +
        '<div class="procedure"><small>예상 절차</small><strong>' +
          escapeHtml(result.procedure.label) + '</strong><em>' +
          escapeHtml(result.procedure.description) + '</em></div>' +
      '</div>' +
      '<div class="permit-step4-reason-v1"><strong>판정 근거</strong>' +
        escapeHtml(result.scopeReliable ? result.comparison.reason : "해당 층·호실 용도가 확인되지 않아 절차를 확정하지 않았습니다.") +
        '<br><strong>면적 기준</strong>' + escapeHtml(target.reason || (target.target && target.target.condition) || "") +
      '</div>' +
      branches +
      '<div class="permit-step4-risks-v1"><strong>추가 확인사항</strong>' + risks + '</div>' +
      '<div class="permit-step4-sources-v1"><strong>공식 근거:</strong> ' + sourceLinks +
        '<br><strong>중요:</strong> ' + escapeHtml(result.disclaimer) + '</div>' +
    '</section>';
  }

  function evaluateAndShow() {
    if (!selectedIndustry || !lastDiagnosis) return;
    global.PermitBuildingUseEngineV1.load().then(function (rules) {
      var result = global.PermitDiagnosisEngineV1.evaluate({
        industryId: selectedIndustry.id,
        diagnosis: lastDiagnosis,
        sameBuildingRelevantUseArea: lastDiagnosis.relatedUseArea &&
          lastDiagnosis.relatedUseArea.status === "EXACT"
          ? lastDiagnosis.relatedUseArea.value
          : null,
        useRules: rules.useRules,
        procedureRules: rules.procedureRules
      });
      var host = document.getElementById("permitPublicDataResultsV1");
      if (!host) return;
      var old = document.getElementById("permitStep4V1");
      if (old) old.remove();
      host.insertAdjacentHTML("beforeend", render(result));
      document.dispatchEvent(new CustomEvent("permit:procedure-diagnosed-v1", {
        detail: { result: result }
      }));
    }).catch(function (error) {
      var host = document.getElementById("permitPublicDataResultsV1");
      if (host) host.insertAdjacentHTML("beforeend",
        '<div class="permit-step2-error-v1">' + escapeHtml(error.message) + '</div>');
    });
  }

  document.addEventListener("permit:industry-selected-v1", function (event) {
    selectedIndustry = event.detail && event.detail.industry;
    evaluateAndShow();
  });

  document.addEventListener("permit:public-data-v1", function (event) {
    lastDiagnosis = event.detail && event.detail.diagnosis;
    evaluateAndShow();
  });

  global.PermitDiagnosisStep4V1 = { render: render };
})(window, document);
