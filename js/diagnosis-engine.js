(function (global) {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function procedure(code, rules) {
    var value = rules.procedures && rules.procedures[code];
    return Object.assign({ code: code }, value || rules.procedures.UNDETERMINED);
  }

  function findException(currentTypeId, targetTypeId, rules) {
    return (rules.exceptions || []).filter(function (exception) {
      return exception.fromUseTypeIds.indexOf(currentTypeId) !== -1 &&
        exception.toUseTypeIds.indexOf(targetTypeId) !== -1;
    })[0] || null;
  }

  function compare(current, targetType, procedureRules) {
    if (!current.known || current.ambiguous || !current.group || !targetType) {
      return {
        procedure: procedure("UNDETERMINED", procedureRules),
        reason: "현재 건축물 용도를 하나의 시설군으로 확정하지 못했습니다."
      };
    }
    if (current.type && current.type.id === targetType.id) {
      return {
        procedure: procedure("NO_CHANGE", procedureRules),
        reason: "현재 대장 용도와 목표 건축물 용도가 일치합니다."
      };
    }
    var exception = current.type && findException(current.type.id, targetType.id, procedureRules);
    if (exception) {
      return {
        procedure: procedure(exception.procedure, procedureRules),
        reason: exception.note
      };
    }
    var targetGroupOrder = null;
    var currentOrder = Number(current.group.order);
    if (targetType.groupId === current.group.id) {
      return {
        procedure: procedure("LEDGER_CHANGE", procedureRules),
        reason: "같은 시설군 안의 용도변경입니다."
      };
    }
    targetGroupOrder = targetType.groupOrder;
    if (!Number.isFinite(Number(targetGroupOrder))) {
      return {
        procedure: procedure("UNDETERMINED", procedureRules),
        reason: "목표 용도의 시설군 순서를 확인하지 못했습니다."
      };
    }
    if (Number(targetGroupOrder) < currentOrder) {
      return {
        procedure: procedure("PERMIT", procedureRules),
        reason: "현재 시설군에서 상위 시설군으로 변경하는 경우입니다."
      };
    }
    return {
      procedure: procedure("REPORT", procedureRules),
      reason: "현재 시설군에서 하위 시설군으로 변경하는 경우입니다."
    };
  }

  function attachGroupOrder(type, useRules) {
    if (!type) return null;
    var group = (useRules.facilityGroups || []).filter(function (item) {
      return item.id === type.groupId;
    })[0];
    return Object.assign({}, type, { groupOrder: group ? group.order : null, groupLabel: group ? group.label : "" });
  }

  function evaluate(options) {
    var diagnosis = options.diagnosis || {};
    var record = diagnosis.record || {};
    var input = diagnosis.input || {};
    var useRules = options.useRules;
    var procedureRules = options.procedureRules;
    var current = global.PermitBuildingUseEngineV1.classifyUse(record.use, useRules);
    var target = global.PermitBuildingUseEngineV1.targetForIndustry(
      options.industryId,
      input.area,
      options.sameBuildingRelevantUseArea,
      useRules
    );
    var targetType = target.target
      ? attachGroupOrder(global.PermitBuildingUseEngineV1.typeById(target.target.useTypeId, useRules), useRules)
      : null;
    var alternativeType = target.alternative
      ? attachGroupOrder(global.PermitBuildingUseEngineV1.typeById(target.alternative.useTypeId, useRules), useRules)
      : null;
    var scopeReliable = record.level === "층" || record.level === "호실";
    var comparison = compare(current, targetType, procedureRules);
    var alternativeComparison = alternativeType
      ? compare(current, alternativeType, procedureRules)
      : null;
    var finalProcedure = comparison.procedure;
    var risks = [];

    if (!scopeReliable) {
      finalProcedure = procedure("UNDETERMINED", procedureRules);
      risks.push("현재 용도가 건물 전체 범위라 해당 층·호실의 실제 용도를 확정할 수 없습니다.");
    }
    if (!target.thresholdKnown) {
      finalProcedure = procedure("UNDETERMINED", procedureRules);
      risks.push("같은 건물의 게임 관련 시설 면적 합계가 확인되지 않았습니다.");
    }
    if (diagnosis.zones === "") {
      risks.push("용도지역·지구 자료가 없어 도시계획상 허용 여부를 별도 확인해야 합니다.");
    }
    if ((finalProcedure.code === "PERMIT" || finalProcedure.code === "REPORT") &&
        Number(input.area) >= Number(procedureRules.architectReview.permitAreaSquareMeters)) {
      risks.push(procedureRules.architectReview.note);
    }

    return {
      industryId: options.industryId,
      currentUse: text(record.use),
      currentScope: text(record.level),
      current: current,
      target: target,
      targetType: targetType,
      alternativeType: alternativeType,
      comparison: comparison,
      alternativeComparison: alternativeComparison,
      procedure: finalProcedure,
      scopeReliable: scopeReliable,
      risks: risks,
      ruleVersion: useRules.ruleVersion + " / " + procedureRules.ruleVersion,
      verifiedAt: procedureRules.verifiedAt,
      sources: procedureRules.sources || [],
      disclaimer: procedureRules.disclaimer
    };
  }

  global.PermitDiagnosisEngineV1 = {
    compare: compare,
    evaluate: evaluate
  };
})(window);
