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
        '<div><strong>일치하는 업종 후보를 찾지 못했습니다.</strong><br>' +
        '영업 내용, 이용 대상, 설치 시설, 음식 판매 여부를 조금 더 자세히 적어주세요.</div></div>';
    }

    return '<div class="permit-candidate-list-v1">' + entries.map(function (entry, index) {
      var industry = entry.industry;
      var selected = industry.id === selectedId ? " selected" : "";
      return '<article class="permit-candidate-card-v1' + selected + '">' +
        '<div><h4>' + (index + 1) + '. ' + escapeHtml(industry.officialName) + '</h4>' +
        '<p>' + escapeHtml(industry.description) + '</p>' +
        '<div class="permit-candidate-meta-v1">' +
          '<span>' + escapeHtml(industry.permitType) + '</span>' +
          '<span>' + escapeHtml(industry.expectedBuildingUse) + '</span>' +
          '<span>' + escapeHtml(industry.legalArea) + '</span>' +
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
    return '<section class="permit-industry-detail-v1">' +
      '<h4>' + escapeHtml(industry.officialName) + ' 기본정보</h4>' +
      '<div class="permit-detail-columns-v1">' +
        '<div class="permit-detail-box-v1"><strong>영업 구분·예상 용도</strong>' +
          renderList([industry.permitType, industry.expectedBuildingUse, industry.legalArea]) + '</div>' +
        '<div class="permit-detail-box-v1"><strong>일반적인 진행 순서</strong>' +
          renderList(industry.process) + '</div>' +
        '<div class="permit-detail-box-v1"><strong>1차 시설 체크</strong>' +
          renderList(industry.facilities) + '</div>' +
      '</div>' +
      '<div class="permit-precheck-v1"><strong>추가 확인:</strong> ' +
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
