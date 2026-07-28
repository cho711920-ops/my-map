(function (global, document) {
  "use strict";

  var activeRule = null;
  var checkState = null;

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function group(rule, id) {
    return (rule.checkGroups || []).find(function (entry) { return entry.id === id; }) || {
      id: id,
      title: "",
      checks: []
    };
  }

  function list(items, emptyText) {
    var values = (items || []).filter(Boolean);
    if (!values.length) return '<p class="permit-broker-empty-v2">' + escapeHtml(emptyText || "확인 자료 준비 중") + '</p>';
    return '<ul class="permit-broker-list-v2">' + values.map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join("") + '</ul>';
  }

  function checkDescriptions(checks) {
    return (checks || []).map(function (check) {
      return '<li><strong>' + escapeHtml(check.label) + '</strong><span>' +
        escapeHtml(check.note) + '</span></li>';
    }).join("");
  }

  function wastewaterSupported(rule) {
    return rule && (rule.industryId === "general-restaurant" || rule.industryId === "rest-restaurant");
  }

  function wastewaterAreaValue() {
    var input = document.getElementById("permitAreaV1");
    return input ? String(input.value || "").trim() : "";
  }

  function formatNumber(value, digits) {
    if (value == null || !Number.isFinite(Number(value))) return "-";
    return Number(value).toLocaleString("ko-KR", {
      maximumFractionDigits: digits == null ? 2 : digits
    });
  }

  function renderWastewaterResult(result) {
    if (!result || !result.supported || result.area == null) {
      return '<div class="permit-wastewater-empty-v1">' +
        escapeHtml(result && result.message || "연면적을 입력하면 자동 계산됩니다.") + '</div>';
    }
    var statusLabel = result.status === "ENOUGH" ? "입력값상 여유 있음" :
      result.status === "SHORT" ? "입력값상 용량 부족" : "건물 용량 확인 필요";
    var remaining = result.remaining == null ? "총용량·현재 사용량 입력 필요" :
      (result.remaining >= 0
        ? formatNumber(result.remaining, 2) + "인분 여유"
        : formatNumber(Math.abs(result.remaining), 2) + "인분 부족");

    return '<div class="permit-wastewater-result-v1" data-status="' + result.status + '">' +
      '<div><span>필요 처리인원 N</span><strong>' + formatNumber(result.targetPersons, 2) + '인</strong>' +
        '<small>' + escapeHtml(result.rule.formulaN) + '</small></div>' +
      '<div><span>하루 오수량 Q</span><strong>' + formatNumber(result.dailyLiters, 0) + 'L</strong>' +
        '<small>' + formatNumber(result.dailyTons, 2) + '톤/일 · ' + escapeHtml(result.rule.formulaQ) + '</small></div>' +
      '<div><span>건물 정화조 여유</span><strong>' + escapeHtml(remaining) + '</strong>' +
        '<small>' + escapeHtml(statusLabel) + '</small></div>' +
      '<p>' + escapeHtml(result.message) + '</p></div>';
  }

  function renderWastewaterCalculator(rule) {
    if (!wastewaterSupported(rule) || !global.PermitWastewaterCapacityEngineV1) return "";
    var area = wastewaterAreaValue();
    var result = global.PermitWastewaterCapacityEngineV1.calculate(rule.industryId, { area: area });
    var source = global.PermitWastewaterCapacityEngineV1.source;

    return '<section id="permitWastewaterCalculatorV1" class="permit-wastewater-card-v1" ' +
      'data-industry-id="' + escapeHtml(rule.industryId) + '">' +
      '<header><div><small>공식 계산식으로 미리 확인</small><h4>정화조·오수 처리용량 계산</h4></div>' +
        '<span>' + escapeHtml(rule.commonName || rule.officialName) + '</span></header>' +
      '<div class="permit-wastewater-guide-v1">' +
        '<strong>A = 공용면적을 포함한 해당 용도 연면적(㎡)</strong>' +
        '<span>선택 매물의 전용면적이 참고로 자동 입력됩니다. 계산 전 건축물대장이나 관리주체를 통해 공용면적을 포함한 실제 A로 고쳐주세요.</span>' +
      '</div>' +
      '<div class="permit-wastewater-inputs-v1">' +
        '<label><span>계산할 연면적 A(㎡)</span><input id="permitWastewaterAreaV1" type="number" min="0" step="0.01" ' +
          'inputmode="decimal" value="' + escapeHtml(area) + '" placeholder="예: 100"></label>' +
        '<label><span>건물 정화조 총용량(인)</span><input id="permitWastewaterTotalV1" type="number" min="0" step="0.01" ' +
          'inputmode="decimal" placeholder="대장·관리실 확인"></label>' +
        '<label><span>다른 점포 현재 사용량(인)</span><input id="permitWastewaterExistingV1" type="number" min="0" step="0.01" ' +
          'inputmode="decimal" placeholder="관리실·구청 확인"></label>' +
      '</div>' +
      '<div id="permitWastewaterResultV1">' + renderWastewaterResult(result) + '</div>' +
      '<footer><div><b>N</b> 필요한 정화조 처리대상인원 <b>Q</b> 하루에 발생하는 예상 오수량</div>' +
        '<p>정화조를 함께 쓰는 다른 점포의 사용량과 공공하수도 연결 상태까지 확인해야 최종 판단할 수 있습니다.</p>' +
        '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(source.authority + " · " + source.title) + '</a></footer>' +
      '</section>';
  }

  function refreshWastewaterCalculator() {
    var card = document.getElementById("permitWastewaterCalculatorV1");
    var resultHost = document.getElementById("permitWastewaterResultV1");
    if (!card || !resultHost || !global.PermitWastewaterCapacityEngineV1) return;
    var area = document.getElementById("permitWastewaterAreaV1");
    var total = document.getElementById("permitWastewaterTotalV1");
    var existing = document.getElementById("permitWastewaterExistingV1");
    var result = global.PermitWastewaterCapacityEngineV1.calculate(
      card.getAttribute("data-industry-id"),
      {
        area: area && area.value,
        totalCapacity: total && total.value,
        existingLoad: existing && existing.value
      }
    );
    resultHost.innerHTML = renderWastewaterResult(result);
  }

  function departmentGuide(industryId) {
    if (industryId === "general-restaurant" || industryId === "rest-restaurant") {
      return [
        ["구청 위생 담당", "메뉴와 운영방식을 설명하고 일반·휴게음식점 구분, 시설기준, 신고서류를 확인"],
        ["구청 건축 담당", "해당 층·호실 용도, 용도변경 절차, 주차·정화조·위반건축물 영향을 확인"],
        ["관할 소방서 예방 담당", "화기·층·면적·구조에 따른 소방시설과 다중이용업소 해당 여부를 확인"],
        ["건물 관리주체·임대인", "덕트·외벽 타공·옥상 배기·가스·전기 증설·간판 설치와 원상복구 조건을 확인"]
      ];
    }
    if (industryId.indexOf("beauty-") === 0) {
      return [
        ["구청 공중위생 담당", "미용 세부업종, 면허, 시설기준, 영업신고 서류를 확인"],
        ["구청 건축 담당", "해당 호실의 미용원 사용 가능 용도와 용도변경 필요 여부를 확인"],
        ["건물 관리주체·임대인", "급배수·온수·환기·전기 증설·간판과 내부공사 허용 범위를 확인"]
      ];
    }
    if (industryId === "internet-computer-game") {
      return [
        ["구청 게임산업 담당", "정확한 게임제공업 분류, 등록서류, 시설기준과 운영 제한을 확인"],
        ["구청 건축 담당", "해당 호실 용도와 같은 건축물 관련 용도 면적 합계, 용도변경 절차를 확인"],
        ["관할 소방서 예방 담당", "다중이용업소 여부와 안전시설등 완비증명 절차를 확인"],
        ["교육지원청", "교육환경보호구역과 금지행위 적용 여부를 확인"],
        ["한국전기안전공사·전기공사업체", "PC·냉방 부하, 계약전력, 분전반과 증설 가능 여부를 확인"]
      ];
    }
    return [
      ["구청 영업 인허가 담당", "공식 업종명, 등록·허가·신고 구분과 준비서류를 확인"],
      ["구청 건축 담당", "해당 호실 건축물 용도와 용도변경 필요 여부를 확인"],
      ["관할 소방서", "층·면적·수용인원·화기 사용에 따른 소방기준을 확인"]
    ];
  }

  function contractGuide(rule) {
    var clauses = [
      "계약 전 관할 구청에서 선택 업종의 영업 가능 여부와 건축물 용도를 확인하고, 불가 시 계약 해제·계약금 반환 조건을 당사자와 협의",
      "불법 증축·무단 용도변경·도면 불일치가 발견될 경우 시정 책임과 비용 부담 주체를 명시",
      "인허가와 시설공사에 필요한 임대인의 서류 제공·사용승낙 협조 범위를 명시",
      "덕트·외벽 타공·옥상 배기·가스·전기·급배수·간판 공사의 허용 범위와 원상복구 기준을 명시",
      "기존 시설의 소유권·하자·수리비·철거비와 영업신고 지연 시 잔금·인도 일정을 협의"
    ];
    if (rule.industryId === "general-restaurant" || rule.industryId === "rest-restaurant") {
      clauses.push("냄새·연기·소음 민원 및 음식물쓰레기 배출 장소, 정화조·하수 용량 부족 시 공사비 부담 주체를 명시");
    }
    return clauses;
  }

  function fallbackRule(industry) {
    function checks(prefix, items, severity) {
      return (items || []).map(function (item, index) {
        return {
          id: prefix + "-" + (index + 1),
          label: item,
          note: "계약 전에 현장과 관할기관에 확인합니다.",
          severity: severity || "important"
        };
      });
    }
    return {
      industryId: industry.id,
      officialName: industry.officialName,
      commonName: industry.commonName,
      registrationType: industry.permitType,
      verifiedAt: "관할확인 필요",
      ruleVersion: "broker-master-agency-confirm-v1",
      requiredBuildingUse: {
        underThreshold: industry.expectedBuildingUse,
        atOrOverThreshold: "면적·층·건물 전체 사용현황에 따라 달라질 수 있습니다.",
        important: "상세 법적 기준 미연결 업종이므로 계약 전에 관할 건축·영업등록 부서의 확인이 필요합니다."
      },
      generalProcess: industry.process || [],
      checkGroups: [
        { id: "industry", title: "고객 영업내용", checks: checks("industry", industry.extraChecks || []) },
        { id: "building", title: "건축·입지", checks: checks("building", [
          "해당 층·호실 건축물대장 용도",
          "용도지역·지구와 건물 관리규약",
          "불법 증축·무단 용도변경 여부",
          "피난통로·출입구·주차 조건"
        ], "critical") },
        { id: "facility", title: "영업 시설", checks: checks("facility", industry.facilities || []) },
        { id: "equipment", title: "설비·안전", checks: checks("equipment", [
          "전기 계약용량과 증설 가능 여부",
          "급·배수와 환기·배기 가능 여부",
          "소방시설과 비상구 적합 여부",
          "소음·냄새·진동 민원 가능성"
        ]) },
        { id: "filing", title: "계약 후 등록 준비", checks: checks("filing", industry.process || []) }
      ],
      sources: [],
      disclaimer: "이 업종은 상세 규칙 연결 전입니다. 안내된 항목을 기준으로 관할기관에 확인한 뒤 계약해야 합니다."
    };
  }

  function renderDepartments(rule) {
    return '<div class="permit-broker-departments-v2">' + departmentGuide(rule.industryId).map(function (entry) {
      return '<div><strong>' + escapeHtml(entry[0]) + '</strong><span>' + escapeHtml(entry[1]) + '</span></div>';
    }).join("") + '</div>';
  }

  function renderBrokerGuide(rule) {
    var industry = group(rule, "industry");
    var building = group(rule, "building");
    var facility = group(rule, "facility");
    var equipment = group(rule, "equipment");
    var filing = group(rule, "filing");
    var useLines = [
      rule.requiredBuildingUse && rule.requiredBuildingUse.underThreshold,
      rule.requiredBuildingUse && rule.requiredBuildingUse.atOrOverThreshold,
      rule.requiredBuildingUse && rule.requiredBuildingUse.important
    ];

    return '<section id="permitBrokerGuideV2" class="permit-broker-guide-v2">' +
      '<header class="permit-broker-hero-v2"><div><small>중개사용 업종 실무 안내서</small>' +
        '<h3>' + escapeHtml(rule.commonName || rule.officialName) + '</h3>' +
        '<p>공식 업종: ' + escapeHtml(rule.officialName) + ' · 영업절차: ' +
        escapeHtml(rule.registrationType) + ' · 기준 확인 ' + escapeHtml(rule.verifiedAt) + '</p></div>' +
        '<span>계약 전 관할기관 최종 확인</span></header>' +

      '<div class="permit-broker-alert-v2"><strong>중개사가 먼저 할 일</strong>' +
        ' 고객의 실제 영업방식을 확정한 뒤, 그 업종에 맞는 용도의 매물만 찾고 시설공사 가능 여부를 계약 전에 확인합니다.</div>' +

      '<div class="permit-broker-grid-v2">' +
        '<article><b>1</b><h4>고객에게 먼저 물어볼 것</h4>' +
          '<ul class="permit-broker-detail-list-v2">' + checkDescriptions(industry.checks) + '</ul></article>' +
        '<article><b>2</b><h4>찾아야 할 매물 용도</h4>' + list(useLines) +
          '<div class="permit-broker-warning-v2">건물 전체 주용도가 아니라 실제 계약할 층·호실의 대장 용도를 확인합니다.</div></article>' +
      '</div>' +

      '<section class="permit-broker-section-v2"><h4>매물 현장과 임대인에게 확인할 시설</h4>' +
        '<div class="permit-broker-check-columns-v2">' +
          '<div><h5>건축·입지</h5><ul class="permit-broker-detail-list-v2">' + checkDescriptions(building.checks) + '</ul></div>' +
          '<div><h5>영업장 시설</h5><ul class="permit-broker-detail-list-v2">' + checkDescriptions(facility.checks) + '</ul></div>' +
          '<div><h5>설비·안전</h5><ul class="permit-broker-detail-list-v2">' + checkDescriptions(equipment.checks) + '</ul></div>' +
        '</div></section>' +
      renderWastewaterCalculator(rule) +

      '<section class="permit-broker-section-v2"><h4>구청·기관에 전화해서 확인할 곳</h4>' +
        renderDepartments(rule) +
        '<p class="permit-broker-help-v2">주소를 매물에 대입하면 관할 구청 대표번호와 주소·면적이 들어간 실제 전화 질문문을 만들어 줍니다.</p></section>' +

      '<div class="permit-broker-grid-v2">' +
        '<article><b>3</b><h4>고객에게 설명할 진행 순서</h4>' +
          '<ol class="permit-broker-timeline-v2">' + (rule.generalProcess || []).map(function (step) {
            return '<li>' + escapeHtml(step) + '</li>';
          }).join("") + '</ol></article>' +
        '<article><b>4</b><h4>계약 후 신고·개업 준비</h4>' +
          '<ul class="permit-broker-detail-list-v2">' + checkDescriptions(filing.checks) + '</ul></article>' +
      '</div>' +

      '<section class="permit-broker-section-v2 permit-broker-contract-v2"><h4>계약 전 권장 확인·특약 주제</h4>' +
        list(contractGuide(rule)) +
        '<p>위 문구는 중개 검토용 주제입니다. 실제 특약은 확인된 사실과 당사자 합의에 맞게 작성해야 합니다.</p></section>' +

      '<footer class="permit-broker-footer-v2">' +
        '<strong>공식 근거</strong><div>' + (rule.sources || []).map(function (source) {
          return '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(source.title) + '</a>';
        }).join("") + '</div><p>' + escapeHtml(rule.disclaimer) + '</p></footer>' +
    '</section>';
  }

  function renderControls(check) {
    return '<div class="permit-check-controls-v1" role="group" aria-label="' +
      escapeHtml(check.label) + ' 확인 상태">' +
      [["YES", "확인"], ["NO", "문제"], ["UNKNOWN", "미확인"]].map(function (entry) {
        var on = checkState[check.id] === entry[0] ? " on" : "";
        return '<button type="button" class="' + on + '" data-check-id="' +
          escapeHtml(check.id) + '" data-status="' + entry[0] + '">' + entry[1] + '</button>';
      }).join("") + '</div>';
  }

  function renderChecklist(rule) {
    var summary = global.PermitFacilityCheckEngineV1.summarize(rule, checkState);
    return '<section id="permitStep2V1" class="permit-step2-v1 permit-apply-checklist-v2">' +
      '<div class="permit-step2-head-v1"><div><h4>현장·계약 확인 기록</h4>' +
        '<p>선택 매물을 직접 확인한 결과만 기록합니다. 모르면 미확인으로 둡니다.</p></div>' +
        '<span class="permit-step2-status-v1" data-result="' + summary.status + '">' +
        summary.YES + ' 확인 · ' + summary.NO + ' 문제 · ' + summary.UNKNOWN + ' 미확인</span></div>' +
      '<div class="permit-check-groups-v1">' + (rule.checkGroups || []).map(function (entry) {
        return '<section class="permit-check-group-v1"><h5>' + escapeHtml(entry.title) + '</h5>' +
          (entry.checks || []).map(function (check) {
            return '<div class="permit-check-row-v1"><div class="permit-check-label-v1"><strong>' +
              escapeHtml(check.label) + '</strong><span>' +
              escapeHtml(check.severity === "critical" ? "계약 전 필수" : "추가 확인") + '</span></div>' +
              '<div class="permit-check-note-v1">' + escapeHtml(check.note) + '</div>' +
              renderControls(check) + '</div>';
          }).join("") + '</section>';
      }).join("") + '</div></section>';
  }

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

  function refreshChecklist() {
    var host = document.getElementById("permitApplyChecklistV1");
    if (!host || !activeRule) return;
    host.innerHTML = renderChecklist(activeRule);
    emitCheckState();
  }

  function showForIndustry(industry) {
    var guideHost = document.getElementById("permitIndustryDetailV1");
    var checklistHost = document.getElementById("permitApplyChecklistV1");
    if (!guideHost || !checklistHost) return;

    if (!global.PermitIndustryRuleLoaderV1.supports(industry.id)) {
      activeRule = fallbackRule(industry);
      checkState = global.PermitFacilityCheckEngineV1.createState(activeRule);
      guideHost.insertAdjacentHTML("beforeend",
        '<div class="permit-step2-pending-v1"><strong>관할확인형 안내</strong> · ' +
        '상세 법령 규칙 연결 전이므로 중개사가 놓치면 안 되는 공통 확인항목을 제공합니다. ' +
        '용도·등록·시설기준은 계약 전에 관할기관에 확인합니다.</div>' +
        renderBrokerGuide(activeRule));
      checklistHost.innerHTML = renderChecklist(activeRule);
      emitCheckState();
      return;
    }

    guideHost.insertAdjacentHTML("beforeend",
      '<div id="permitStep2LoadingV1" class="permit-step2-pending-v1">공식 기준으로 중개 실무 안내서를 만드는 중입니다.</div>');
    global.PermitIndustryRuleLoaderV1.load(industry.id).then(function (rule) {
      var loading = document.getElementById("permitStep2LoadingV1");
      if (!loading || !rule) return;
      activeRule = rule;
      checkState = global.PermitFacilityCheckEngineV1.createState(rule);
      loading.outerHTML = renderBrokerGuide(rule);
      checklistHost.innerHTML = renderChecklist(rule);
      emitCheckState();
    }).catch(function (error) {
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
    refreshChecklist();
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
    refreshChecklist();
  });

  document.addEventListener("permit:reset-v1", function () {
    activeRule = null;
    checkState = null;
    var host = document.getElementById("permitApplyChecklistV1");
    if (host) host.innerHTML = "";
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("#permitStep2V1 [data-check-id][data-status]");
    if (!button || !activeRule || !checkState) return;
    global.PermitFacilityCheckEngineV1.setStatus(
      checkState,
      button.getAttribute("data-check-id"),
      button.getAttribute("data-status")
    );
    refreshChecklist();
  });

  document.addEventListener("input", function (event) {
    if (!event.target.closest("#permitWastewaterCalculatorV1")) return;
    refreshWastewaterCalculator();
  });

  global.PermitDiagnosisStep2V1 = {
    renderBrokerGuide: renderBrokerGuide,
    renderChecklist: renderChecklist,
    departmentGuide: departmentGuide,
    contractGuide: contractGuide,
    fallbackRule: fallbackRule
  };
})(window, document);
