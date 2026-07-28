(function (global) {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderCandidates(entries, selectedId) {
    if (!entries || !entries.length) {
      return '<div class="permit-candidate-empty-v1">' +
        '<div><strong>업종 후보를 찾지 못했습니다.</strong><br>' +
        '실제 영업 내용, 이용 대상, 설치 장비, 음식·주류 판매 여부를 조금 더 적어주세요.</div></div>';
    }

    return '<div class="permit-candidate-list-v1">' + entries.map(function (entry, index) {
      var industry = entry.industry;
      var selected = industry.id === selectedId ? " selected" : "";
      var verified = industry.ruleStatus !== "AGENCY_CONFIRM";
      var statusText = verified ? "상세규칙 연결" : "관할확인 필요";
      var administration = global.PermitIndustryAdministrationTypeV1.resolve(
        industry.permitType,
        industry.id
      );
      return '<article class="permit-candidate-card-v1' + selected + '">' +
        '<div><h4>' + (index + 1) + '. ' + escapeHtml(industry.officialName) + '</h4>' +
        '<p>' + escapeHtml(industry.description) + '</p>' +
        '<div class="permit-candidate-meta-v1">' +
          '<span class="permit-admin-badge-v1" data-admin-type="' + administration.code + '">' +
            escapeHtml(administration.label) + '</span>' +
          '<span>' + escapeHtml(industry.permitType) + '</span>' +
          '<span>' + escapeHtml(industry.expectedBuildingUse) + '</span>' +
          '<span>' + escapeHtml(industry.legalArea) + '</span>' +
          '<span class="' + (verified ? "is-verified" : "needs-confirm") + '">' + statusText + '</span>' +
        '</div></div>' +
        '<button class="permit-candidate-select-v1" type="button" data-permit-industry-id="' +
          escapeHtml(industry.id) + '">' + (selected ? "선택됨" : "선택") + '</button>' +
      '</article>';
    }).join("") + '</div>';
  }

  function renderList(items) {
    return '<ul>' + (items || []).map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join("") + '</ul>';
  }

  function renderIndustryDetail(industry, catalogNotice) {
    if (!industry) return "";
    var administration = global.PermitIndustryAdministrationTypeV1.resolve(
      industry.permitType,
      industry.id
    );
    return '<section class="permit-industry-detail-v1">' +
      '<h4>' + escapeHtml(industry.officialName) + ' 중개 준비 요약</h4>' +
      '<div class="permit-detail-columns-v1">' +
        '<div class="permit-detail-box-v1"><strong>영업 구분·예상 용도</strong>' +
          renderList([
            administration.label + " — " + administration.description,
            "세부 표시: " + industry.permitType,
            industry.expectedBuildingUse,
            industry.legalArea
          ]) + '</div>' +
        '<div class="permit-detail-box-v1"><strong>일반적인 진행 순서</strong>' +
          renderList(industry.process) + '</div>' +
        '<div class="permit-detail-box-v1"><strong>매물에서 먼저 볼 시설</strong>' +
          renderList(industry.facilities) + '</div>' +
      '</div>' +
      '<div class="permit-precheck-v1"><strong>고객에게 추가로 확인:</strong> ' +
        escapeHtml((industry.extraChecks || []).join(" · ")) + '<br>' +
        escapeHtml(catalogNotice || "") + '</div>' +
    '</section>';
  }

  global.PermitIndustryCandidateSelectorV1 = {
    escapeHtml: escapeHtml,
    renderCandidates: renderCandidates,
    renderIndustryDetail: renderIndustryDetail
  };
})(window);
