(function (global) {
  "use strict";

  var cache = null;
  var districtPattern = /(동구|중구|서구|유성구|대덕구)/;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function load() {
    if (cache) return Promise.resolve(cache);
    return fetch("data/agency-role-map.json?v=20260729-step5", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("관할기관 정보를 불러오지 못했습니다.");
        return response.json();
      })
      .then(function (data) {
        cache = data;
        return data;
      });
  }

  function detectJurisdiction(address) {
    var source = text(address).replace(/^대전광역시/, "대전").replace(/^대전시/, "대전");
    var match = source.match(districtPattern);
    if (!match || source.indexOf("대전") === -1) return null;
    return "대전 " + match[1];
  }

  function agencyForRole(role, jurisdiction, data) {
    var shared = data.sharedAgencies || {};
    if (role.agencyType === "districtOffice") return jurisdiction.districtOffice;
    if (role.agencyType === "fireHeadquarters") return shared.fireHeadquarters;
    if (role.agencyType === "electricalSafety") return shared.electricalSafety;
    if (role.agencyType === "educationOffice") {
      return jurisdiction.educationOffice === "west"
        ? shared.educationWest
        : shared.educationEast;
    }
    return null;
  }

  function resolve(address, data) {
    var jurisdictionKey = detectJurisdiction(address);
    var jurisdiction = jurisdictionKey && data.jurisdictions[jurisdictionKey];
    if (!jurisdiction) {
      return {
        jurisdictionKey: null,
        contacts: [],
        notice: "대전 5개 구 관할을 확인하지 못했습니다. 주소를 지번주소로 다시 확인해 주세요."
      };
    }
    return {
      jurisdictionKey: jurisdictionKey,
      contacts: (data.roles || []).map(function (role) {
        var agency = agencyForRole(role, jurisdiction, data);
        return {
          id: role.id,
          roleLabel: role.label,
          departmentRequest: role.departmentRequest,
          agencyName: agency ? agency.name : "UNKNOWN",
          directPhone: "",
          representativePhone: agency ? agency.representativePhone : "",
          officialUrl: agency ? agency.officialUrl : "",
          verifiedAt: data.verifiedAt
        };
      }),
      notice: data.notice
    };
  }

  global.PermitAgencyContactResolverV1 = {
    load: load,
    detectJurisdiction: detectJurisdiction,
    resolve: resolve
  };
})(window);
