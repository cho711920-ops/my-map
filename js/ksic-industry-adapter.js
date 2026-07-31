(function (global) {
  "use strict";

  function unique(items) {
    var seen = {};
    return (items || []).filter(function (item) {
      var key = String(item == null ? "" : item).trim();
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function searchKeywords(code, name, aliases) {
    var stopWords = {
      "및": true,
      "기타": true,
      "그외": true,
      "달리": true,
      "분류되지": true,
      "않은": true,
      "관련": true,
      "서비스업": true,
      "제조업": true,
      "도매업": true,
      "소매업": true,
      "운영업": true,
      "산업": true
    };
    var simplified = String(name || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s*(서비스업|제조업|도매업|소매업|운영업|사업|산업|업)$/, "")
      .trim();
    var words = String(name || "").split(/[\s,·ㆍ()]+/).filter(function (word) {
      var normalized = word.replace(/[^0-9A-Za-z가-힣]/g, "");
      return normalized.length >= 2 && !stopWords[normalized];
    });
    return unique([code, name, simplified].concat(aliases || []).concat(words));
  }

  function toIndustry(catalog, row) {
    var code = String(row && row[0] || "");
    var name = String(row && row[1] || "");
    var sectionId = String(row && row[2] || "");
    var section = catalog.sections && catalog.sections[sectionId] || {};
    var briefing = catalog.briefings && catalog.briefings[sectionId] || {};
    var aliases = catalog.aliases && catalog.aliases[code] || [];
    return {
      id: "ksic-" + code,
      officialName: name,
      commonName: aliases[0] || name,
      description: "한국표준산업분류 제11차 " + code + " · " +
        (section.name || "산업분류") + ". 실제 영업내용에 따라 인허가와 건축물 용도는 별도 확인합니다.",
      permitType: "품목·운영방식별 확인",
      expectedBuildingUse: briefing.expectedBuildingUse || "실제 영업내용에 따른 건축물 용도 확인",
      legalArea: briefing.legalArea || "한국표준산업분류·건축·개별업법",
      keywords: searchKeywords(code, name, aliases),
      process: briefing.process || [],
      facilities: briefing.facilities || [],
      extraChecks: briefing.extraChecks || [],
      ruleStatus: "AGENCY_CONFIRM",
      searchPriority: 0,
      ksicCode: code,
      ksicSection: sectionId,
      ksicSectionName: section.name || "",
      classificationSource: catalog.source || null,
      classificationNotice: catalog.notice || ""
    };
  }

  function expand(catalog) {
    return (catalog && catalog.industries || []).map(function (row) {
      return toIndustry(catalog, row);
    }).filter(function (industry) {
      return industry.id !== "ksic-" && industry.officialName;
    });
  }

  function expandSections(catalog) {
    return Object.keys(catalog && catalog.sections || {}).map(function (sectionId) {
      var section = catalog.sections[sectionId] || {};
      var briefing = catalog.briefings && catalog.briefings[sectionId] || {};
      var aliases = catalog.sectionAliases && catalog.sectionAliases[sectionId] || [];
      return {
        id: "ksic-section-" + sectionId,
        officialName: section.name || sectionId,
        commonName: aliases[0] || section.name || sectionId,
        description: "한국표준산업분류 제11차 " + sectionId + " 대분류. 세부 영업내용을 입력하면 5자리 공식 분류를 함께 찾을 수 있습니다.",
        permitType: "세부 업종별 확인",
        expectedBuildingUse: briefing.expectedBuildingUse || "실제 영업내용에 따른 건축물 용도 확인",
        legalArea: briefing.legalArea || "한국표준산업분류·건축·개별업법",
        keywords: unique([sectionId, section.name].concat(aliases)),
        process: briefing.process || [],
        facilities: briefing.facilities || [],
        extraChecks: briefing.extraChecks || [],
        ruleStatus: "AGENCY_CONFIRM",
        searchPriority: 5,
        ksicCode: sectionId,
        ksicSection: sectionId,
        ksicSectionName: section.name || "",
        ksicSectionEntry: true,
        classificationSource: catalog.source || null,
        classificationNotice: catalog.notice || ""
      };
    });
  }

  function expandAll(catalog) {
    return expandSections(catalog).concat(expand(catalog));
  }

  global.PermitKsicIndustryAdapterV1 = {
    unique: unique,
    searchKeywords: searchKeywords,
    toIndustry: toIndustry,
    expand: expand,
    expandSections: expandSections,
    expandAll: expandAll
  };
})(window);
