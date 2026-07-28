(function (global) {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return global.PermitIndustryCandidateSelectorV1.escapeHtml(value);
  }

  function normalizeRoom(value) {
    var source = text(value).toUpperCase().replace(/\s+/g, "");
    var basement = source.match(/B(\d+)/) || source.match(/지하(\d+).*?(\d+)호/);
    if (basement) return "B" + text(basement[basement.length - 1]).replace(/^0+/, "");
    var room = source.match(/(\d{2,5})호/) || source.match(/^(\d{2,5})$/);
    return room ? text(room[1]).replace(/^0+/, "") : "";
  }

  function normalizeFloor(value) {
    var source = text(value).toUpperCase().replace(/\s+/g, "");
    var basement = source.match(/(?:B|지하)(\d+)/);
    if (basement) return -Number(basement[1]);
    var floor = source.match(/(-?\d+)층?/) || source.match(/^(-?\d+)$/);
    return floor ? Number(floor[1]) : null;
  }

  function rowFloor(row) {
    var number = Number(row && row.floorNo);
    if (!Number.isFinite(number)) number = normalizeFloor(row && row.floorName);
    if (!Number.isFinite(number)) return null;
    return /지하|B/i.test(text(row && (row.floorType || row.floorName))) ? -Math.abs(number) : number;
  }

  function uses(row) {
    var values = [row && row.mainUse, row && row.otherUse];
    (row && Array.isArray(row.areas) ? row.areas : []).forEach(function (area) {
      values.push(area && area.mainUse, area && area.otherUse);
    });
    return Array.from(new Set(values.map(text).filter(Boolean))).join(" · ");
  }

  function areaOf(unit) {
    var areas = unit && Array.isArray(unit.areas) ? unit.areas : [];
    var exclusive = areas.filter(function (area) {
      return /전유/.test(text(area && area.areaType));
    }).reduce(function (sum, area) {
      return sum + (Number(area && area.area) || 0);
    }, 0);
    return exclusive || Number(unit && unit.area) || null;
  }

  function sumKnown(values) {
    var known = (values || []).filter(function (value) {
      return value !== "" && value != null && Number.isFinite(Number(value));
    });
    if (!known.length) return null;
    return known.reduce(function (sum, value) {
      return sum + Number(value);
    }, 0);
  }

  function selectRecord(data, input) {
    var units = Array.isArray(data.units) ? data.units : [];
    var buildings = Array.isArray(data.buildings) ? data.buildings : [];
    var targetRoom = normalizeRoom(input.unit);
    var targetFloor = normalizeFloor(input.floor);
    var matchingUnits = targetRoom ? units.filter(function (row) {
      return normalizeRoom(row && row.roomName) === targetRoom &&
        (targetFloor == null || rowFloor(row) === targetFloor);
    }) : [];
    var unit = matchingUnits.length === 1 ? matchingUnits[0] : null;

    if (unit) {
      return {
        level: "호실",
        use: uses(unit),
        area: areaOf(unit),
        floor: rowFloor(unit),
        unit: text(unit.roomName),
        building: buildings.find(function (row) {
          return row.managementKey && row.managementKey === unit.managementKey;
        }) || buildings[0] || null
      };
    }

    var floorRows = [];
    buildings.forEach(function (building) {
      (Array.isArray(building.floors) ? building.floors : []).forEach(function (row) {
        if (targetFloor != null && rowFloor(row) === targetFloor) floorRows.push(row);
      });
    });
    if (targetFloor != null && buildings.length === 1 && floorRows.length) {
      return {
        level: "층",
        use: Array.from(new Set(floorRows.map(uses).filter(Boolean))).join(" · "),
        area: floorRows.reduce(function (sum, row) { return sum + (Number(row.area) || 0); }, 0) || null,
        floor: targetFloor,
        unit: "",
        building: buildings[0] || null
      };
    }

    return {
      level: "건물",
      use: uses(buildings[0] || {}),
      area: null,
      floor: null,
      unit: "",
      building: buildings[0] || null
    };
  }

  function zoneText(building) {
    return Array.from(new Set((building && Array.isArray(building.zones) ? building.zones : [])
      .map(function (zone) { return text(zone && zone.name); })
      .filter(Boolean))).join(" · ");
  }

  function automaticChecks(record, input) {
    var result = {};
    if ((record.level === "호실" || record.level === "층") && record.use) {
      result["building-ledger-use"] =
        /제\s*2\s*종.*근린생활시설|판매시설/.test(record.use) ? "YES" : "NO";
    }
    return result;
  }

  function buildDiagnosis(data, input, addressResult) {
    var record = selectRecord(data, input);
    var building = record.building || {};
    var parking = sumKnown([
      building.indoorMechanicalParking,
      building.outdoorMechanicalParking,
      building.indoorSelfParking,
      building.outdoorSelfParking
    ]);
    var elevators = sumKnown([
      building.passengerElevators,
      building.emergencyElevators
    ]);
    var scopeReason = "";
    if (record.level === "건물" && !text(input.floor)) {
      scopeReason = "선택 매물에 층 정보가 없어 건물 전체 자료까지만 확인했습니다. 층을 입력하면 층별 용도와 면적을 다시 조회합니다.";
    } else if (record.level === "건물" && text(input.unit) && !(data.units || []).length) {
      scopeReason = "일반건축물 대장에는 호실별 전유부가 없어 입력한 " + text(input.unit) + "를 직접 확인할 수 없습니다.";
    } else if (record.level === "건물" && text(input.floor)) {
      scopeReason = "공식 API에 입력한 층과 일치하는 층별 자료가 없어 건물 전체 자료까지만 확인했습니다.";
    }
    return {
      input: input,
      parcel: addressResult.parcel,
      lotAddress: addressResult.address,
      roadAddress: addressResult.roadAddress,
      record: record,
      building: building,
      zones: zoneText(building),
      parking: parking,
      elevators: elevators,
      scopeReason: scopeReason,
      recordCounts: data.recordCounts || {},
      queriedAt: data.queriedAt,
      source: data.source,
      sourcePage: data.sourcePage,
      cached: data.cached,
      limitations: data.limitations || [],
      autoChecks: automaticChecks(record, input)
    };
  }

  function query(input) {
    return global.PermitPropertyLocationInputV1.searchAddress(input.address)
      .then(function (addressResult) {
        if (!addressResult.parcel) throw new Error("주소에서 지번 코드를 확인하지 못했습니다.");
        var params = new URLSearchParams(addressResult.parcel);
        if (input.listingId) params.set("propertyId", input.listingId);
        return fetch("/api/permit-public-data?" + params.toString(), {
          credentials: "same-origin",
          cache: "no-store"
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (!response.ok || !data.ok) {
              throw new Error(data.message || "공공데이터를 조회하지 못했습니다.");
            }
            return buildDiagnosis(data, input, addressResult);
          });
        });
      });
  }

  function field(label, value, unknownReason) {
    var display = value;
    if (display === "" || display == null) {
      display = "UNKNOWN" + (unknownReason ? " · " + unknownReason : "");
    }
    return '<div class="permit-public-field-v1"><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(display) + '</strong></div>';
  }

  function dateText(value) {
    var digits = text(value).replace(/\D/g, "");
    return digits.length === 8
      ? digits.slice(0, 4) + "." + digits.slice(4, 6) + "." + digits.slice(6, 8)
      : text(value);
  }

  function render(diagnosis) {
    var record = diagnosis.record || {};
    var building = diagnosis.building || {};
    var floor = record.floor == null ? "" : (record.floor < 0 ? "지하 " + Math.abs(record.floor) + "층" : record.floor + "층");
    var areaReason = record.level === "건물"
      ? (!text(diagnosis.input && diagnosis.input.floor) ? "층 입력 필요" : "일치 층 자료 없음")
      : "대장 면적 미제공";
    var zoneReason = Number(diagnosis.recordCounts && diagnosis.recordCounts.zones) === 0
      ? "해당 주소 API 자료 없음"
      : "건물 연결 자료 없음";
    return '<section class="permit-public-result-v1">' +
      '<header class="permit-public-result-head-v1"><div><h4>주소 기반 공공데이터</h4>' +
        '<p>' + escapeHtml(diagnosis.queriedAt || "조회 시각 미제공") +
        (diagnosis.cached ? " · 캐시" : " · 최신 응답") + '</p></div>' +
        '<span class="permit-public-source-badge-v1">공식 OPEN API</span></header>' +
      '<div class="permit-public-grid-v1">' +
        field("지번주소", diagnosis.lotAddress) +
        field("도로명주소", diagnosis.roadAddress) +
        field("대장 확인 범위", record.level + (floor ? " · " + floor : "") + (record.unit ? " · " + record.unit : "")) +
        field("현재 건축물 용도", record.use) +
        field("확인 범위 면적", record.area != null ? record.area + "㎡" : "", areaReason) +
        field("사용승인일", dateText(building.approvalDate)) +
        field("주차대수", diagnosis.parking != null ? diagnosis.parking + "대" : "", "공공대장 미제공") +
        field("승강기", diagnosis.elevators != null ? diagnosis.elevators + "대" : "", "공공대장 미제공") +
        field("건축물대장 구분", building.registerType) +
        field("주용도", building.mainUse) +
        field("용도지역·지구", diagnosis.zones, zoneReason) +
        field("위반건축물", "UNKNOWN · 발급본 확인") +
      '</div>' +
      (diagnosis.scopeReason
        ? '<div class="permit-public-scope-notice-v1"><strong>확인 범위 안내</strong>' +
          escapeHtml(diagnosis.scopeReason) + '</div>'
        : '') +
      '<div class="permit-public-notices-v1"><strong>출처:</strong> ' +
        '<a href="' + escapeHtml(diagnosis.sourcePage) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(diagnosis.source) + '</a><br>' +
        diagnosis.limitations.map(escapeHtml).join("<br>") +
      '</div></section>';
  }

  global.PermitBuildingDataAdapterV1 = {
    normalizeRoom: normalizeRoom,
    normalizeFloor: normalizeFloor,
    sumKnown: sumKnown,
    selectRecord: selectRecord,
    automaticChecks: automaticChecks,
    buildDiagnosis: buildDiagnosis,
    query: query,
    render: render
  };
})(window);
