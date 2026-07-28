(function (global) {
  "use strict";

  function text(value, fallback) {
    var result = String(value == null ? "" : value).trim();
    return result || fallback || "미확인";
  }

  function optionalText(value) {
    return String(value == null ? "" : value).trim();
  }

  var questions = {
    "building-use": [
      "현재 대장 용도로 선택 업종 입점이 가능한지",
      "기재내용 변경·용도변경 신고·허가 중 어떤 절차인지",
      "건축사 도면 또는 현장 확인이 필요한지",
      "주차·피난·방화 기준과 같은 건물 면적 합산 기준이 있는지",
      "해당 층·호실의 정확한 건축물 용도를 확인할 수 있는지"
    ],
    "business-registration": [
      "선택 업종의 정확한 등록·허가·신고 구분",
      "접수 전에 필요한 서류와 현장 확인 절차",
      "건축물 용도와 면적에 따른 추가 조건",
      "다른 부서와 먼저 협의해야 하는 사항"
    ],
    "food-hygiene": [
      "음식·음료 판매 방식에 따라 필요한 식품영업 신고 종류",
      "조리장·급수·배수·세척·환기 시설 기준",
      "영업신고 전에 받아야 할 교육·검사와 준비서류"
    ],
    "fire-safety": [
      "다중이용업소 해당 여부와 안전시설등 완비증명 필요 여부",
      "비상구·피난통로·방화문·방염·스프링클러 기준",
      "공사 전에 관할 소방서와 협의하거나 도면 검토를 받아야 하는지"
    ],
    "education-zone": [
      "주소가 교육환경보호구역에 포함되는지",
      "선택 업종이 금지행위·시설 또는 심의 대상인지",
      "등록 전에 필요한 확인서나 심의 절차가 있는지"
    ],
    "electrical-safety": [
      "예상 설치 전력에 맞는 계약전력·분전반 용량 검토 방법",
      "증설 공사와 사용전검사 또는 안전점검 필요 여부",
      "현장 점검 신청 시 필요한 자료와 담당 사업소"
    ]
  };

  function locationLine(input) {
    var parts = [text(input.address)];
    if (optionalText(input.floor)) parts.push(optionalText(input.floor) + "층");
    if (optionalText(input.unit)) parts.push(optionalText(input.unit) + "호");
    if (optionalText(input.area)) parts.push(optionalText(input.area) + "㎡");
    return parts.join(", ");
  }

  function generate(contact, context) {
    var industry = context.industry || {};
    var procedure = context.procedure || {};
    var list = questions[contact.id] || [];
    var lines = [
      locationLine(context.input || {}) + "입니다.",
      "건축물대장상 현재 용도는 " + text(context.currentUse) + "이고, " +
        text(industry.officialName, "선택 업종") + "을(를) 준비하고 있습니다.",
      "현재 사전진단의 예상 절차는 " + text(procedure.label, "자동판정 불가") + "입니다.",
      "",
      contact.departmentRequest + "로 연결 부탁드립니다.",
      ""
    ];
    list.forEach(function (question, index) {
      lines.push((index + 1) + ". " + question);
    });
    lines.push("", "최종 적용 절차와 담당부서를 확인 부탁드립니다.");
    return lines.join("\n");
  }

  global.PermitCallScriptGeneratorV1 = {
    generate: generate,
    locationLine: locationLine
  };
})(window);
