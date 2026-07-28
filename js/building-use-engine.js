(function (global) {
  "use strict";

  var cache = null;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function loadJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("건축물 용도 규칙을 불러오지 못했습니다.");
      return response.json();
    });
  }

  function load() {
    if (cache) return Promise.resolve(cache);
    return Promise.all([
      loadJson("data/building-use-rules.json?v=20260729-step4"),
      loadJson("data/permit-procedure-rules.json?v=20260729-step4")
    ]).then(function (results) {
      cache = { useRules: results[0], procedureRules: results[1] };
      return cache;
    });
  }

  function matches(source, patterns) {
    var normalized = text(source).replace(/\s+/g, "");
    return (patterns || []).some(function (pattern) {
      return normalized.indexOf(text(pattern).replace(/\s+/g, "")) !== -1;
    });
  }

  function classifyUse(useText, rules) {
    var source = text(useText);
    if (!source) return { known: false, ambiguous: false, source: "", matches: [] };
    var types = (rules.useTypes || []).filter(function (type) {
      return matches(source, type.patterns);
    });
    var groups = (rules.facilityGroups || []).filter(function (group) {
      return matches(source, group.patterns);
    });
    var groupIds = Array.from(new Set(
      types.map(function (type) { return type.groupId; })
        .concat(groups.map(function (group) { return group.id; }))
    ));
    var typeIds = Array.from(new Set(types.map(function (type) { return type.id; })));
    var exactType = typeIds.length === 1 ? types.filter(function (type) {
      return type.id === typeIds[0];
    })[0] : null;
    var exactGroup = groupIds.length === 1
      ? (rules.facilityGroups || []).filter(function (group) {
        return group.id === groupIds[0];
      })[0]
      : null;
    return {
      known: Boolean(exactGroup),
      ambiguous: groupIds.length > 1 || typeIds.length > 1,
      source: source,
      type: exactType,
      group: exactGroup,
      matches: types
    };
  }

  function targetForIndustry(industryId, proposedArea, sameBuildingArea, rules) {
    var targetRule = rules.industryTargets && rules.industryTargets[industryId];
    if (!targetRule) return { known: false, reason: "선택 업종의 건축물 용도 규칙이 없습니다." };
    if (targetRule.fixed) {
      return {
        known: true,
        thresholdKnown: true,
        branch: "fixed",
        target: targetRule.fixed,
        sameBuildingArea: null,
        threshold: null,
        reason: targetRule.fixed.condition || "고정 용도 기준"
      };
    }
    var threshold = Number(targetRule.thresholdSquareMeters);
    var proposed = Number(proposedArea);
    var total = Number(sameBuildingArea);
    if (Number.isFinite(total) && total >= 0) {
      return {
        known: true,
        thresholdKnown: true,
        branch: total < threshold ? "below" : "atOrAbove",
        target: total < threshold ? targetRule.below : targetRule.atOrAbove,
        sameBuildingArea: total,
        threshold: threshold
      };
    }
    if (Number.isFinite(proposed) && proposed >= threshold) {
      return {
        known: true,
        thresholdKnown: true,
        branch: "atOrAbove",
        target: targetRule.atOrAbove,
        sameBuildingArea: null,
        threshold: threshold,
        reason: "해당 영업장 면적만으로도 500㎡ 이상입니다."
      };
    }
    return {
      known: true,
      thresholdKnown: false,
      branch: "belowCandidate",
      target: targetRule.below,
      alternative: targetRule.atOrAbove,
      sameBuildingArea: null,
      threshold: threshold,
      reason: "전용면적만으로 확정하지 않습니다. 같은 건물의 관련 용도 면적 합계 확인이 필요합니다."
    };
  }

  function typeById(id, rules) {
    return (rules.useTypes || []).filter(function (type) { return type.id === id; })[0] || null;
  }

  global.PermitBuildingUseEngineV1 = {
    load: load,
    classifyUse: classifyUse,
    targetForIndustry: targetForIndustry,
    typeById: typeById
  };
})(window);
