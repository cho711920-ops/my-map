(function (global, document) {
  "use strict";

  var state = {
    industry: null,
    diagnosis: null,
    procedure: null,
    facilities: null
  };

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function text(value, fallback) {
    var result = String(value == null ? "" : value).trim();
    return result || fallback || "미확인";
  }

  function input() {
    return state.diagnosis && state.diagnosis.input ? state.diagnosis.input : {};
  }

  function summaryLines() {
    var result = [];
    var currentUse = state.procedure && state.procedure.currentUse;
    var targetUse = state.procedure && state.procedure.targetType && state.procedure.targetType.label;
    var procedure = state.procedure && state.procedure.procedure && state.procedure.procedure.label;
    if (currentUse) result.push("현재 확인 용도: " + currentUse);
    if (targetUse) result.push("업종 목표 용도: " + targetUse);
    if (procedure) result.push("예상 행정절차: " + procedure);
    if (state.facilities) {
      result.push("현장 확인: 확인 " + state.facilities.YES + "개 · 문제 " +
        state.facilities.NO + "개 · 미확인 " + state.facilities.UNKNOWN + "개");
    }
    return result;
  }

  function nextActions() {
    var actions = [
      "고객의 실제 영업 메뉴·시설·운영방식을 최종 확정합니다.",
      "관할 구청 영업 담당과 건축 담당에게 계약 전 가능 여부를 확인합니다.",
      "임대인에게 시설공사·배기·급배수·전기·가스·간판 허용 범위를 서면 확인합니다.",
      "불가 또는 추가공사 발생 시 계약 해제·비용부담 기준을 특약으로 협의합니다."
    ];
    if (state.facilities && state.facilities.NO > 0) {
      actions.unshift("현재 ‘문제’로 표시한 항목을 해결하기 전에는 계약·공사를 확정하지 않습니다.");
    }
    if (!state.diagnosis) {
      actions.unshift("후보 매물을 정한 뒤 ‘공식자료로 용도 확인’을 실행합니다.");
    }
    return actions;
  }

  function plainText() {
    var industry = state.industry || {};
    var values = [
      "[고객 업종·매물 사전 브리핑]",
      "업종: " + text(industry.officialName),
      "매물: " + text(input().address) + " " + text(input().floor, "") + "층 " + text(input().unit, ""),
      ""
    ].concat(summaryLines()).concat(["", "다음 진행"]).concat(nextActions().map(function (line, index) {
      return (index + 1) + ". " + line;
    })).concat(["", "※ 사전 검토자료이며 최종 신고·허가 가능 여부는 관할기관 확인이 필요합니다."]);
    return values.join("\n");
  }

  function render() {
    var host = document.getElementById("permitBrokerBriefingV2");
    if (!host || !state.industry) return;
    var lines = summaryLines();
    host.innerHTML = '<section class="permit-broker-briefing-v2">' +
      '<header><div><small>고객 설명용</small><h4>업종·매물 사전 브리핑</h4></div>' +
        '<button type="button" id="permitCopyBriefingV2">브리핑 복사</button></header>' +
      '<div class="permit-broker-briefing-summary-v2">' +
        '<div><span>고객 업종</span><strong>' + escapeHtml(state.industry.officialName) + '</strong></div>' +
        '<div><span>검토 매물</span><strong>' + escapeHtml(text(input().address)) + '</strong></div>' +
        '<div><span>현재 판단</span><strong>' +
          escapeHtml(state.procedure && state.procedure.status || "매물 확인 전") + '</strong></div>' +
      '</div>' +
      (lines.length ? '<ul>' + lines.map(function (line) {
        return '<li>' + escapeHtml(line) + '</li>';
      }).join("") + '</ul>' :
        '<p class="permit-broker-briefing-wait-v2">업종 실무안내를 먼저 확인하고, 후보 매물을 정하면 용도와 위험요소를 이곳에 요약합니다.</p>') +
      '<h5>다음 진행</h5><ol>' + nextActions().map(function (line) {
        return '<li>' + escapeHtml(line) + '</li>';
      }).join("") + '</ol>' +
      '<p class="permit-broker-briefing-notice-v2">사전 검토자료이며 최종 신고·허가 가능 여부는 관할기관 확인이 필요합니다.</p>' +
    '</section>';
  }

  function copyBriefing() {
    if (!global.navigator.clipboard || !global.navigator.clipboard.writeText) return;
    global.navigator.clipboard.writeText(plainText()).then(function () {
      var button = document.getElementById("permitCopyBriefingV2");
      if (button) {
        button.textContent = "복사 완료";
        global.setTimeout(function () { button.textContent = "브리핑 복사"; }, 1200);
      }
    });
  }

  document.addEventListener("permit:industry-selected-v1", function (event) {
    state.industry = event.detail && event.detail.industry;
    state.diagnosis = null;
    state.procedure = null;
    state.facilities = null;
    render();
  });
  document.addEventListener("permit:public-data-v1", function (event) {
    state.diagnosis = event.detail && event.detail.diagnosis;
    render();
  });
  document.addEventListener("permit:procedure-diagnosed-v1", function (event) {
    state.procedure = event.detail && event.detail.result;
    render();
  });
  document.addEventListener("permit:facility-checks-updated-v1", function (event) {
    state.facilities = event.detail && event.detail.summary;
    render();
  });
  document.addEventListener("permit:reset-v1", function () {
    state.industry = null;
    state.diagnosis = null;
    state.procedure = null;
    state.facilities = null;
  });
  document.addEventListener("click", function (event) {
    if (event.target.closest("#permitCopyBriefingV2")) copyBriefing();
  });

  global.PermitBrokerBriefingV2 = {
    render: render,
    plainText: plainText
  };
})(window, document);
