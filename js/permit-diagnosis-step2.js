(function (global, document) {
  "use strict";

  var activeRule = null;
  var checkState = null;

  function emitCheckState() {
    if (!activeRule || !checkState) return;
    document.dispatchEvent(new CustomEvent("permit:facility-checks-updated-v1", {
      detail: {
        industryId: activeRule.industryId,
        ruleVersion: activeRule.ruleVersion,
        checks: Object.assign({}, checkState),
        summary: global.PermitFacilityCheckEngineV1.summarize(activeRule, checkState)
      }
    }));
  }

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function sourceMap(rule) {
    return (rule.sources || []).reduce(function (map, source) {
      map[source.id] = source;
      return map;
    }, {});
  }

  function renderControls(check) {
    return '<div class="permit-check-controls-v1" role="group" aria-label="' +
      escapeHtml(check.label) + ' 확인 상태">' +
      ["YES", "NO", "UNKNOWN"].map(function (status) {
        var label = status === "YES" ? "충족" : status === "NO" ? "불충족" : "미확인";
        var on = checkState[check.id] === status ? " on" : "";
        return '<button type="button" class="' + on + '" data-check-id="' +
          escapeHtml(check.id) + '" data-status="' + status + '">' + label + '</button>';
      }).join("") + '</div>';
  }

  function renderSummary(rule) {
    var result = global.PermitFacilityCheckEngineV1.summarize(rule, checkState);
    return '<div class="permit-step2-head-v1"><div><h4>' + escapeHtml(rule.commonName || rule.officialName) +
      ' 업종 규칙·시설 체크</h4>' +
      '<p>규칙 버전 ' + escapeHtml(rule.ruleVersion) + ' · 법령 확인 ' +
      escapeHtml(rule.verifiedAt) + '</p></div>' +
      '<span class="permit-step2-status-v1" data-result="' + result.status + '">' +
      result.status + ' · ' + escapeHtml(result.label) + '</span></div>' +
      '<div class="permit-rule-summary-v1">' +
        '<div>영업 구분<strong>' + escapeHtml(rule.registrationType) + '</strong></div>' +
        '<div>현재 자료상 판정<strong>' + result.status + '</strong></div>' +
        '<div>충족 / 불충족<strong>' + result.YES + ' / ' + result.NO + '</strong></div>' +
        '<div>미확인<strong>' + result.UNKNOWN + '개</strong></div>' +
      '</div>';
  }

  function renderRule(rule) {
    var sources = sourceMap(rule);
    var groups = (rule.checkGroups || []).map(function (group) {
      return '<section class="permit-check-group-v1"><h5>' + escapeHtml(group.title) + '</h5>' +
        (group.checks || []).map(function (check) {
          var sourceTitles = (check.sourceIds || []).map(function (id) {
            return sources[id] ? sources[id].title : "";
          }).filter(Boolean).join(" · ");
          return '<div class="permit-check-row-v1">' +
            '<div class="permit-check-label-v1"><strong>' + escapeHtml(check.label) + '</strong>' +
              '<span>' + escapeHtml(check.severity === "critical" ? "핵심 확인" : "추가 확인") + '</span></div>' +
            '<div class="permit-check-note-v1">' + escapeHtml(check.note) +
              (sourceTitles ? '<br>근거: ' + escapeHtml(sourceTitles) : '') + '</div>' +
            renderControls(check) +
          '</div>';
        }).join("") +
      '</section>';
    }).join("");

    var sourceLinks = (rule.sources || []).map(function (source) {
      return '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(source.title) + '</a>';
    }).join(" · ");

    return '<section id="permitStep2V1" class="permit-step2-v1">' +
      renderSummary(rule) +
      '<div class="permit-check-groups-v1">' + groups + '</div>' +
      '<div class="permit-rule-sources-v1"><strong>공식 근거:</strong> ' + sourceLinks +
        '<br><strong>중요:</strong> ' + escapeHtml(rule.requiredBuildingUse.important) +
        '<br>' + escapeHtml(rule.disclaimer) +
        '<br>체크 상태는 STEP 2 화면에서만 유지되며 영구 저장은 STEP 6에서 연결합니다.</div>' +
    '</section>';
  }

  function refresh() {
    var container = document.getElementById("permitStep2V1");
    if (!container || !activeRule) return;
    container.outerHTML = renderRule(activeRule);
    emitCheckState();
  }

  function showForIndustry(industry) {
    var host = document.getElementById("permitIndustryDetailV1");
    if (!host) return;

    if (!global.PermitIndustryRuleLoaderV1.supports(industry.id)) {
      host.insertAdjacentHTML("beforeend",
        '<div class="permit-step2-pending-v1">이 업종의 상세 법령 규칙은 순차적으로 추가됩니다. ' +
        '현재 상세 체크는 PC방·일반음식점·휴게음식점을 제공합니다.</div>');
      return;
    }

    host.insertAdjacentHTML("beforeend",
      '<div id="permitStep2LoadingV1" class="permit-step2-pending-v1">공식 기준 규칙을 불러오는 중입니다.</div>');
    global.PermitIndustryRuleLoaderV1.load(industry.id)
      .then(function (rule) {
        var loading = document.getElementById("permitStep2LoadingV1");
        if (!loading || !rule) return;
        activeRule = rule;
        checkState = global.PermitFacilityCheckEngineV1.createState(rule);
        loading.outerHTML = renderRule(rule);
        emitCheckState();
      })
      .catch(function (error) {
        var loading = document.getElementById("permitStep2LoadingV1");
        if (loading) loading.outerHTML =
          '<div class="permit-step2-error-v1">' + escapeHtml(error.message) + '</div>';
      });
  }

  document.addEventListener("permit:industry-selected-v1", function (event) {
    showForIndustry(event.detail.industry);
  });

  document.addEventListener("permit:public-data-v1", function (event) {
    var diagnosis = event.detail && event.detail.diagnosis;
    if (!activeRule || !checkState || !diagnosis || !diagnosis.autoChecks) return;
    Object.keys(diagnosis.autoChecks).forEach(function (checkId) {
      var status = diagnosis.autoChecks[checkId];
      if (status === "YES" || status === "NO") {
        global.PermitFacilityCheckEngineV1.setStatus(checkState, checkId, status);
      }
    });
    refresh();
  });

  document.addEventListener("permit:diagnosis-loaded-v1", function (event) {
    var record = event.detail && event.detail.record;
    if (!record || !activeRule || record.industryId !== activeRule.industryId) return;
    Object.keys(record.facilityChecks || {}).forEach(function (checkId) {
      var status = record.facilityChecks[checkId];
      if (status === "YES" || status === "NO" || status === "UNKNOWN") {
        global.PermitFacilityCheckEngineV1.setStatus(checkState, checkId, status);
      }
    });
    refresh();
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("#permitStep2V1 [data-check-id][data-status]");
    if (!button || !activeRule || !checkState) return;
    global.PermitFacilityCheckEngineV1.setStatus(
      checkState,
      button.getAttribute("data-check-id"),
      button.getAttribute("data-status")
    );
    refresh();
  });

  global.PermitDiagnosisStep2V1 = {
    renderRule: renderRule
  };
})(window, document);
