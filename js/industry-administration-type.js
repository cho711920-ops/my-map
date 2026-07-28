(function (global) {
  "use strict";

  var TYPES = {
    PERMIT: {
      code: "PERMIT",
      label: "허가·인가업",
      shortLabel: "허가",
      description: "관할기관의 사전 심사와 허가·인가를 받은 뒤 영업할 수 있습니다.",
      timing: "입지와 시설공사 가능 여부를 먼저 협의하고, 허가·인가 완료 전에는 영업을 시작하지 않습니다."
    },
    REGISTRATION: {
      code: "REGISTRATION",
      label: "등록업",
      shortLabel: "등록",
      description: "법정 요건과 시설을 갖추어 관할기관에 등록하고 등록증을 받은 뒤 영업합니다.",
      timing: "계약 전 등록요건을 확인하고 시설 완비 후 등록 신청·심사를 진행합니다."
    },
    REPORT: {
      code: "REPORT",
      label: "신고업",
      shortLabel: "신고",
      description: "법정 시설을 먼저 갖춘 뒤 관할기관에 영업신고하고 신고증을 받아 영업합니다.",
      timing: "공사 전에 담당부서와 시설기준을 확인하고, 시설 완비 후 영업신고를 진행합니다."
    },
    FREE: {
      code: "FREE",
      label: "자유업종",
      shortLabel: "자유",
      description: "해당 영업 자체의 별도 허가·등록·신고가 원칙적으로 없는 업종입니다.",
      timing: "사업자등록은 별도이며 건축물 용도·소방·옥외광고·판매품목별 규제는 그대로 확인합니다."
    },
    CONDITIONAL: {
      code: "CONDITIONAL",
      label: "복합·조건확인",
      shortLabel: "조건확인",
      description: "판매품목·시설·운영방식에 따라 허가·등록·신고·자유업종이 달라집니다.",
      timing: "계약 전에 실제 영업내용을 확정해 관할기관에서 공식 업종과 행정유형을 먼저 확인합니다."
    }
  };

  var GENERALLY_FREE_IDS = {
    "retail-store": true,
    "office": true,
    "warehouse": true
  };

  function resolve(value, industryId) {
    var text = String(value == null ? "" : value).trim();
    if (GENERALLY_FREE_IDS[industryId] || /^자유업종/.test(text)) return TYPES.FREE;
    if (text === "허가" || text === "인가") return TYPES.PERMIT;
    if (text === "등록" || text === "개설등록") return TYPES.REGISTRATION;
    if (text === "신고") return TYPES.REPORT;
    return TYPES.CONDITIONAL;
  }

  global.PermitIndustryAdministrationTypeV1 = {
    types: TYPES,
    resolve: resolve
  };
})(window);
