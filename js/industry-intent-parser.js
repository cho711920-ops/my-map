(function (global) {
  "use strict";

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreIndustry(industry, requestText) {
    var text = normalize(requestText);
    var score = 0;

    (industry.keywords || []).forEach(function (keyword) {
      var normalizedKeyword = normalize(keyword);
      if (!normalizedKeyword || text.indexOf(normalizedKeyword) < 0) return;
      score += normalizedKeyword.length >= 5 ? 7 : 5;
    });

    if (text.indexOf(normalize(industry.commonName)) >= 0) score += 4;
    if (text.indexOf(normalize(industry.officialName)) >= 0) score += 9;

    if (industry.id === "internet-computer-game") {
      if (/\bpc\s*\d+|컴퓨터\s*\d+|게임/.test(text)) score += 2;
      if (/성인/.test(text)) score += 1;
      if (/음식|음료|카페/.test(text)) score += 1;
    }

    return score;
  }

  function interpret(requestText, industries, limit) {
    var text = normalize(requestText);
    if (!text) return [];

    var ranked = (industries || [])
      .map(function (industry) {
        return {
          industry: industry,
          score: scoreIndustry(industry, text)
        };
      })
      .filter(function (entry) {
        return entry.score > 0;
      })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.industry.officialName).localeCompare(String(b.industry.officialName), "ko");
      });

    return ranked.slice(0, Math.max(1, Number(limit) || 4));
  }

  global.PermitIndustryIntentParserV1 = {
    normalize: normalize,
    scoreIndustry: scoreIndustry,
    interpret: interpret
  };
})(window);
