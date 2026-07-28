(function (global) {
  "use strict";

  var cache = {};
  var supported = {
    "internet-computer-game": "data/industry-rules/internet-computer-game.json",
    "general-restaurant": "data/industry-rules/general-restaurant.json",
    "rest-restaurant": "data/industry-rules/rest-restaurant.json"
  };

  function validate(rule, industryId) {
    if (!rule || rule.industryId !== industryId || !Array.isArray(rule.checkGroups)) {
      throw new Error("업종 규칙 형식이 올바르지 않습니다.");
    }
    return rule;
  }

  function load(industryId) {
    if (!supported[industryId]) return Promise.resolve(null);
    if (cache[industryId]) return Promise.resolve(cache[industryId]);
    return fetch(supported[industryId] + "?v=20260729-step7", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("업종별 점검 규칙을 불러오지 못했습니다.");
        return response.json();
      })
      .then(function (rule) {
        cache[industryId] = validate(rule, industryId);
        return cache[industryId];
      });
  }

  global.PermitIndustryRuleLoaderV1 = {
    load: load,
    supports: function (industryId) { return Boolean(supported[industryId]); }
  };
})(window);
