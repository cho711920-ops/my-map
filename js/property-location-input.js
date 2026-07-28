(function (global) {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function getSelectedItem() {
    var key = global.selectedItemKey;
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    if (!key) return null;
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
    var room = parseRoom(item.room);
    return {
      address: text(item.address),
      floor: room.floor,
      unit: room.unit,
      area: pyeongToSquareMeters(item.area),
      areaSourcePyeong: text(item.area),
      listingId: text(item.propertyId),
      listingName: text(item.name)
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
    parseRoom: parseRoom,
    pyeongToSquareMeters: pyeongToSquareMeters,
    fromItem: fromItem,
    searchAddress: searchAddress
  };
})(window);
