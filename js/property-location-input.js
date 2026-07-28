(function (global) {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function getCheckedItems() {
    if (typeof global.getSelectedPrintItems === "function") {
      try {
        var selected = global.getSelectedPrintItems();
        if (Array.isArray(selected)) return selected.filter(Boolean);
      } catch (_) {}
    }

    var keys = Array.isArray(global.selectedPrintKeys) ? global.selectedPrintKeys : [];
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    return items.filter(function (item) {
      return item && keys.indexOf(item.key) !== -1;
    });
  }

  function getSelectedItemResult() {
    var checkedItems = getCheckedItems();
    if (checkedItems.length > 1) {
      return {
        item: null,
        count: checkedItems.length,
        source: "checked",
        message: "체크된 매물이 " + checkedItems.length + "개입니다. 진단할 매물 1개만 체크해주세요."
      };
    }
    if (checkedItems.length === 1) {
      return { item: checkedItems[0], count: 1, source: "checked", message: "" };
    }

    var key = global.selectedItemKey;
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    if (!key) {
      return {
        item: null,
        count: 0,
        source: "",
        message: "매물카드를 누르거나 진단할 매물 1개를 체크해주세요."
      };
    }
    var item = items.find(function (candidate) {
      return candidate && candidate.key === key;
    }) || null;
    return {
      item: item,
      count: item ? 1 : 0,
      source: item ? "active" : "",
      message: item ? "" : "선택한 매물을 현재 목록에서 찾지 못했습니다. 매물카드를 다시 눌러주세요."
    };
  }

  function getSelectedItem() {
    return getSelectedItemResult().item;
  }

  function normalizeFloor(value) {
    var raw = text(value);
    if (!raw) return "";
    var parsed = parseRoom(raw);
    if (parsed.floor) return parsed.floor;
    return /^-?\d+$/.test(raw) ? raw + "층" : raw;
  }

  function normalizeUnit(value) {
    var raw = text(value);
    if (!raw) return "";
    var match = raw.match(/B?\s*\d+\s*호/i);
    if (match) return match[0].replace(/\s+/g, "");
    return /^\d+$/.test(raw) ? raw + "호" : raw;
  }

  function firstValue(item, fields) {
    for (var i = 0; i < fields.length; i++) {
      var value = item && item[fields[i]];
      if (value != null && text(value) !== "") return value;
    }
    return "";
  }

  function findByKey(key) {
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    return items.find(function (item) {
      return item && item.key === key;
    }) || null;
  }

  function parseRoom(roomText) {
    var room = text(roomText);
    var floorMatch = room.match(/(?:지하\s*\d+|B\s*\d+|\d+)\s*층/i);
    var unitMatch = room.match(/(?:B?\s*\d+)\s*호/i);
    return {
      floor: floorMatch ? floorMatch[0].replace(/\s+/g, "") : "",
      unit: unitMatch ? unitMatch[0].replace(/\s+/g, "") : (floorMatch ? "" : room)
    };
  }

  function pyeongToSquareMeters(area) {
    var value = Number(String(area == null ? "" : area).replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) return "";
    return (value * 3.305785).toFixed(2);
  }

  function fromItem(item) {
    if (!item) return null;
    var room = parseRoom(firstValue(item, ["room", "roomInfo", "floorInfo"]));
    var directFloor = firstValue(item, ["floor", "floorName"]);
    var directUnit = firstValue(item, ["unit", "ho", "unitName"]);
    var areaPyeong = firstValue(item, ["area", "pyeong", "exclusiveAreaPyeong"]);
    return {
      address: text(firstValue(item, ["address", "lotAddress", "roadAddress"])),
      floor: room.floor || normalizeFloor(directFloor),
      unit: room.unit || normalizeUnit(directUnit),
      area: pyeongToSquareMeters(areaPyeong),
      areaSourcePyeong: text(areaPyeong),
      listingId: text(firstValue(item, ["propertyId", "listingId", "propertyNumber", "listingNo", "id"])),
      listingName: text(firstValue(item, ["name", "buildingName"])) || "선택 매물"
    };
  }

  function searchAddress(address) {
    return new Promise(function (resolve, reject) {
      var query = text(address);
      if (!query) {
        reject(new Error("주소를 입력해주세요."));
        return;
      }
      if (!global.kakao || !global.kakao.maps || !global.kakao.maps.services) {
        reject(new Error("주소 검색 서비스를 아직 불러오지 못했습니다."));
        return;
      }

      var geocoder = new global.kakao.maps.services.Geocoder();
      geocoder.addressSearch(query, function (result, status) {
        if (status !== global.kakao.maps.services.Status.OK || !result || !result[0]) {
          reject(new Error("주소를 찾지 못했습니다. 지번 또는 도로명주소를 확인해주세요."));
          return;
        }
        var first = result[0];
        var lot = first.address || {};
        var legalCode = text(lot.b_code).replace(/\D/g, "");
        resolve({
          address: text(first.address && first.address.address_name) ||
            text(first.road_address && first.road_address.address_name) ||
            query,
          roadAddress: text(first.road_address && first.road_address.address_name),
          x: Number(first.x),
          y: Number(first.y),
          parcel: legalCode.length === 10 ? {
            sigunguCd: legalCode.slice(0, 5),
            bjdongCd: legalCode.slice(5, 10),
            platGbCd: text(lot.mountain_yn).toUpperCase() === "Y" ? "1" : "0",
            bun: ("0000" + (text(lot.main_address_no).replace(/\D/g, "") || "0")).slice(-4),
            ji: ("0000" + (text(lot.sub_address_no).replace(/\D/g, "") || "0")).slice(-4),
            lotAddress: text(lot.address_name)
          } : null
        });
      });
    });
  }

  global.PermitPropertyLocationInputV1 = {
    getSelectedItem: getSelectedItem,
    getSelectedItemResult: getSelectedItemResult,
    getCheckedItems: getCheckedItems,
    findByKey: findByKey,
    parseRoom: parseRoom,
    pyeongToSquareMeters: pyeongToSquareMeters,
    fromItem: fromItem,
    searchAddress: searchAddress
  };
})(window);
