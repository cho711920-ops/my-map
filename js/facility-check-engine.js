(function (global) {
  "use strict";

  var allowed = ["YES", "NO", "UNKNOWN"];

  function createState(rule) {
    var state = {};
    (rule.checkGroups || []).forEach(function (group) {
      (group.checks || []).forEach(function (check) {
        state[check.id] = "UNKNOWN";
      });
    });
    return state;
  }

  function setStatus(state, checkId, status) {
    if (!state || allowed.indexOf(status) < 0) return state;
    state[checkId] = status;
    return state;
  }

  function summarize(rule, state) {
    var summary = { YES: 0, NO: 0, UNKNOWN: 0, total: 0, status: "ORANGE", label: "행정·시설 확인 필요" };
    var criticalNo = false;
    var criticalUnknown = false;
    var anyNo = false;

    (rule.checkGroups || []).forEach(function (group) {
      (group.checks || []).forEach(function (check) {
        var status = allowed.indexOf(state[check.id]) >= 0 ? state[check.id] : "UNKNOWN";
        summary[status] += 1;
        summary.total += 1;
        if (status === "NO") {
          anyNo = true;
          if (check.severity === "critical") criticalNo = true;
        }
        if (status === "UNKNOWN" && check.severity === "critical") criticalUnknown = true;
      });
    });

    if (criticalNo) {
      summary.status = "RED";
      summary.label = "현재 자료상 입점 곤란";
    } else if (criticalUnknown) {
      summary.status = "ORANGE";
      summary.label = "용도·소방·행정 확인 필요";
    } else if (anyNo || summary.UNKNOWN > 0) {
      summary.status = "YELLOW";
      summary.label = "시설 보완·추가 확인 필요";
    } else {
      summary.status = "GREEN";
      summary.label = "현재 자료상 가능성 높음";
    }
    return summary;
  }

  global.PermitFacilityCheckEngineV1 = {
    statuses: allowed.slice(),
    createState: createState,
    setStatus: setStatus,
    summarize: summarize
  };
})(window);
