(function (global) {
  "use strict";

  var SOURCE = {
    title: "건축물의 용도별 오수발생량 및 정화조 처리대상인원 산정방법",
    authority: "환경부고시 제2025-165호",
    effectiveDate: "2025-10-01",
    url: "https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200201&flNm=%5B%EB%B3%84%ED%91%9C%5D+%EA%B1%B4%EC%B6%95%EB%AC%BC%EC%9D%98+%EC%9A%A9%EB%8F%84%EB%B3%84+%EC%98%A4%EC%88%98%EB%B0%9C%EC%83%9D%EB%9F%89+%EB%B0%8F+%EC%A0%95%ED%99%94%EC%A1%B0+%EC%B2%98%EB%A6%AC%EB%8C%80%EC%83%81%EC%9D%B8%EC%9B%90+%EC%82%B0%EC%A0%95%EA%B8%B0%EC%A4%80&flSeq=157950723"
  };

  var RULES = {
    "rest-restaurant": {
      label: "휴게음식점",
      personsPerSquareMeter: 0.175,
      litersPerSquareMeterDay: 35,
      formulaN: "N = 0.175 × A",
      formulaQ: "Q = 35 × A"
    },
    "general-restaurant": {
      label: "일반음식점",
      personsPerSquareMeter: 0.175,
      litersPerSquareMeterDay: 60,
      formulaN: "N = 0.175 × A",
      formulaQ: "Q = 60 × A"
    }
  };

  function number(value) {
    var normalized = String(value == null ? "" : value).replace(/,/g, "").trim();
    if (!normalized) return null;
    var parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function round(value, digits) {
    var unit = Math.pow(10, digits || 0);
    return Math.round((value + Number.EPSILON) * unit) / unit;
  }

  function calculate(industryId, input) {
    var rule = RULES[industryId];
    var area = number(input && input.area);
    var totalCapacity = number(input && input.totalCapacity);
    var existingLoad = number(input && input.existingLoad);

    if (!rule) {
      return { supported: false, status: "UNKNOWN", message: "이 업종의 공식 계산식은 아직 연결되지 않았습니다." };
    }
    if (area == null || area <= 0) {
      return {
        supported: true,
        status: "UNKNOWN",
        rule: rule,
        source: SOURCE,
        message: "공용면적을 포함한 해당 용도 연면적(A)을 입력해주세요."
      };
    }

    var targetPersons = round(area * rule.personsPerSquareMeter, 2);
    var dailyLiters = round(area * rule.litersPerSquareMeterDay, 0);
    var remaining = null;
    var status = "UNKNOWN";
    var message = "건물 정화조 총용량과 현재 사용량을 입력하면 부족 여부까지 계산합니다.";

    if (totalCapacity != null && existingLoad != null) {
      remaining = round(totalCapacity - existingLoad - targetPersons, 2);
      status = remaining >= 0 ? "ENOUGH" : "SHORT";
      message = remaining >= 0
        ? "입력한 수치상 필요한 처리인원을 수용할 여유가 있습니다."
        : "입력한 수치상 정화조 처리용량이 부족합니다.";
    }

    return {
      supported: true,
      status: status,
      rule: rule,
      source: SOURCE,
      area: area,
      targetPersons: targetPersons,
      dailyLiters: dailyLiters,
      dailyTons: round(dailyLiters / 1000, 2),
      totalCapacity: totalCapacity,
      existingLoad: existingLoad,
      remaining: remaining,
      message: message
    };
  }

  global.PermitWastewaterCapacityEngineV1 = {
    source: SOURCE,
    rules: RULES,
    calculate: calculate
  };
})(window);
