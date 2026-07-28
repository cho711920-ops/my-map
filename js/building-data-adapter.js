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
    var parking = [
      building.indoorMechanicalParking,
      building.outdoorMechanicalParking,
      building.indoorSelfParking,
      building.outdoorSelfParking
    ].reduce(function (sum, value) { return sum + (Number(value) || 0); }, 0);
    return {
      input: input,
      parcel: addressResult.parcel,
      lotAddress: addressResult.address,
      roadAddress: addressResult.roadAddress,
      record: record,
      building: building,
      zones: zoneText(building),
      parking: parking,
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

  function field(label, value) {
    return '<div class="permit-public-field-v1"><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(value || "UNKNOWN") + '</strong></div>';
  }

  function render(diagnosis) {
    var record = diagnosis.record || {};
    var building = diagnosis.building || {};
    var floor = record.floor == null ? "" : (record.floor < 0 ? "지하 " + Math.abs(record.floor) + "층" : record.floor + "층");
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
        field("대장 면적", record.area ? record.area + "㎡" : "") +
        field("사용승인일", building.approvalDate) +
        field("주차대수", diagnosis.parking ? diagnosis.parking + "대" : "") +
        field("승강기", (Number(building.passengerElevators) || 0) + (Number(building.emergencyElevators) || 0) ?
          ((Number(building.passengerElevators) || 0) + (Number(building.emergencyElevators) || 0)) + "대" : "") +
        field("건축물대장 구분", building.registerType) +
        field("주용도", building.mainUse) +
        field("용도지역·지구", diagnosis.zones) +
        field("위반건축물", "UNKNOWN · 발급본 확인") +
      '</div>' +
      '<div class="permit-public-notices-v1"><strong>출처:</strong> ' +
        '<a href="' + escapeHtml(diagnosis.sourcePage) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(diagnosis.source) + '</a><br>' +
        diagnosis.limitations.map(escapeHtml).join("<br>") +
      '</div></section>';
  }

  global.PermitBuildingDataAdapterV1 = {
    normalizeRoom: normalizeRoom,
    normalizeFloor: normalizeFloor,
    selectRecord: selectRecord,
    automaticChecks: automaticChecks,
    buildDiagnosis: buildDiagnosis,
    query: query,
    render: render
  };
})(window);
