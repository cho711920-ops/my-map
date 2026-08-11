(function () {
  "use strict";

  var LOCAL_CACHE_PREFIX = "js-building-register-v11:";
  var LOCAL_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  var PARCEL_CACHE_PREFIX = "js-building-parcel-v1:";
  var PARCEL_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  var BADGE_CACHE_PREFIX = "js-building-badge-v3:";
  var BADGE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  var BADGE_MAX_CONCURRENCY = 4;
  var BADGE_MAX_RETRIES = 2;
  var badgeRequests = Object.create(null);
  var capacityRequestsV820 = Object.create(null);
  var badgeMemoryV6520 = Object.create(null);
  var badgeAddressMemoryV810 = Object.create(null);
  var badgeQueue = [];
  var badgeActive = 0;
  var badgeObserver = null;
  var buildingInfoPrefetchQueueV810 = [];
  var buildingInfoPrefetchSeenV810 = Object.create(null);
  var buildingInfoPrefetchActiveV810 = 0;
  var BUILDING_INFO_PREFETCH_CONCURRENCY_V810 = 2;
  var BUILDING_CLIENT_VERSION_V811 = "8.2.1";
  var state = {
    item: null,
    parcel: null,
    data: null,
    buildingIndex: 0,
    unitIndex: 0,
    loading: false,
    detailsLoading: false,
    previewShown: false,
    requestToken: 0
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asNumber(value) {
    if (value === "" || value == null) return null;
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function parseNumber(value) {
    var match = String(value == null ? "" : value)
      .replace(/,/g, "")
      .match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function numberText(value, suffix, digits) {
    var number = asNumber(value);
    if (number == null) return "정보 없음";
    return number.toLocaleString("ko-KR", {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits == null ? 2 : digits
    }) + (suffix || "");
  }

  function areaText(value) {
    var area = asNumber(value);
    if (area == null) return "정보 없음";
    var pyeong = area / 3.305785;
    return numberText(area, "㎡") + " · " + numberText(pyeong, "평", 1);
  }

  function dateText(value) {
    var digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 8) return value ? String(value) : "정보 없음";
    return digits.slice(0, 4) + "." + digits.slice(4, 6) + "." + digits.slice(6, 8);
  }

  function joinText() {
    var values = Array.prototype.slice.call(arguments).filter(function (value) {
      return value != null && String(value).trim();
    });
    return values.length ? values.join(" · ") : "정보 없음";
  }

  function normalizedBuildingAddressKeyV810(value) {
    return String(value || "")
      .replace(/대한민국|대전광역시|대전시/g, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/번지/g, "")
      .replace(/\s+/g, "")
      .trim()
      .toLowerCase();
  }

  function persistentBadgeFromItemV810(item) {
    var status = String(item && item.buildingInfoStatus || "").trim();
    // D1 originally persisted successful lookups as "connected", while the
    // legacy sheet import used "확인완료". Both mean that the values came from
    // the building register and are safe to reuse after a reload.
    if (!item || (status !== "확인완료" && status !== "connected")) return null;
    return {
      year: String(item.buildingYear || "").replace(/\D/g, "").slice(0, 4),
      elevators: Number(item.buildingElevators || 0),
      capacity: Number(item.buildingElevatorCapacity || 0),
      verified: true,
      persistent: true
    };
  }

  function rememberBadgeV810(item, badge) {
    if (!item || !badge) return;
    var normalized = {
      year: String(badge.year || ""),
      elevators: Number(badge.elevators || 0),
      capacity: Number(badge.capacity || 0),
      verified: !!badge.verified,
      persistent: !!badge.persistent
    };
    var itemKey = stableBadgeItemKeyV6520(item);
    var addressKey = normalizedBuildingAddressKeyV810(item.address);
    if (itemKey) badgeMemoryV6520[itemKey] = normalized;
    if (addressKey) badgeAddressMemoryV810[addressKey] = normalized;
    if (typeof allItems !== "undefined" && Array.isArray(allItems) && addressKey) {
      allItems.forEach(function(candidate) {
        if (normalizedBuildingAddressKeyV810(candidate && candidate.address) !== addressKey) return;
        candidate.buildingYear = normalized.year;
        candidate.buildingElevators = normalized.elevators;
        candidate.buildingElevatorCapacity = normalized.capacity;
        if (normalized.verified) candidate.buildingInfoStatus = "확인완료";
      });
    }
  }

  function ensureModal() {
    var existing = document.getElementById("buildingRegisterModalV640");
    if (existing) return existing;

    var modal = document.createElement("div");
    modal.id = "buildingRegisterModalV640";
    modal.className = "building-register-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '' +
      '<div class="building-register-backdrop" data-building-register-close></div>' +
      '<section class="building-register-dialog" role="dialog" aria-modal="true" aria-labelledby="buildingRegisterTitleV640">' +
        '<header class="building-register-header">' +
          '<div class="building-register-brand">' +
            '<img src="assets/molit-logo.png" alt="국토교통부">' +
            '<div><span>공식 건축물대장 조회</span><h2 id="buildingRegisterTitleV640">건축물대장</h2></div>' +
          '</div>' +
          '<button type="button" class="building-register-x" data-building-register-close aria-label="닫기">×</button>' +
        '</header>' +
        '<div id="buildingRegisterBodyV640" class="building-register-body"></div>' +
        '<footer class="building-register-footer">' +
          '<button type="button" class="building-register-refresh" id="buildingRegisterRefreshV640">최신조회</button>' +
          '<button type="button" class="building-register-close" data-building-register-close>닫기</button>' +
        '</footer>' +
      '</section>';
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-building-register-close]").forEach(function (button) {
      button.addEventListener("click", closeModal);
    });
    document.getElementById("buildingRegisterRefreshV640").addEventListener("click", function () {
      if (!state.loading && state.parcel) fetchRegister(true);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal.classList.contains("open")) closeModal();
    });
    return modal;
  }

  function openModal() {
    var modal = ensureModal();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("building-register-open");
  }

  function closeModal() {
    var modal = document.getElementById("buildingRegisterModalV640");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("building-register-open");
  }

  function bodyElement() {
    return document.getElementById("buildingRegisterBodyV640");
  }

  function setLoading(message) {
    state.loading = true;
    var body = bodyElement();
    if (body) {
      var loading = '<div class="building-register-loading"><i></i><b>' +
        esc(message || "건축물대장을 조회하고 있습니다") +
        '</b><span>기본정보를 먼저 표시하고 상세자료를 이어서 불러옵니다.</span></div>';
      if (state.previewShown && state.item) {
        body.innerHTML = '<section class="building-register-preview">' +
          '<span>매물정보로 먼저 확인</span><strong>' +
          esc(state.item.name || state.item.type || "건물명 확인 중") +
          '</strong><p>' + esc([state.item.address, state.item.room].filter(Boolean).join(" · ")) +
          '</p></section>' + loading;
      } else {
        body.innerHTML = loading;
      }
    }
    updateRefreshButton();
  }

  function setError(message) {
    state.loading = false;
    var body = bodyElement();
    if (body) {
      body.innerHTML = '' +
        '<div class="building-register-error">' +
          '<strong>건축물대장을 불러오지 못했습니다.</strong>' +
          '<p>' + esc(message || "잠시 후 다시 시도해주세요.") + '</p>' +
          '<small>공공데이터포털에서 ‘건축HUB 건축물대장정보 서비스’ 활용신청 여부도 확인해주세요.</small>' +
        '</div>';
    }
    updateRefreshButton();
  }

  function updateRefreshButton() {
    var button = document.getElementById("buildingRegisterRefreshV640");
    if (!button) return;
    button.disabled = state.loading || state.detailsLoading;
    button.textContent = state.detailsLoading ? "상세조회 중" : (state.loading ? "조회 중" : "최신조회");
  }

  function findItem(encodedKey) {
    var key;
    try { key = decodeURIComponent(encodedKey); } catch (_) { key = encodedKey; }
    var items = typeof allItems !== "undefined" ? allItems : (window.allItems || []);
    return (items || []).find(function (item) {
      return String(item.key || "") === String(key || "");
    }) || null;
  }

  function parcelFromAddress(address) {
    var code = String(address && address.b_code || "").replace(/\D/g, "");
    var main = String(address && address.main_address_no || "0").replace(/\D/g, "") || "0";
    var sub = String(address && address.sub_address_no || "0").replace(/\D/g, "") || "0";
    if (code.length !== 10) throw new Error("주소에서 법정동 코드를 확인하지 못했습니다.");
    return {
      sigunguCd: code.slice(0, 5),
      bjdongCd: code.slice(5, 10),
      platGbCd: String(address.mountain_yn || "N").toUpperCase() === "Y" ? "1" : "0",
      bun: ("0000" + main).slice(-4),
      ji: ("0000" + sub).slice(-4),
      lotAddress: String(address.address_name || "")
    };
  }

  function resolveParcel(item) {
    return new Promise(function (resolve, reject) {
      if (typeof kakao === "undefined" || !kakao.maps || !kakao.maps.services) {
        reject(new Error("카카오 주소 서비스를 준비하지 못했습니다."));
        return;
      }
      var service = typeof geocoder !== "undefined" && geocoder
        ? geocoder
        : new kakao.maps.services.Geocoder();
      var done = function (results, status) {
        if (status === kakao.maps.services.Status.OK && results && results[0] && results[0].address) {
          try { resolve(parcelFromAddress(results[0].address)); } catch (error) { reject(error); }
          return true;
        }
        return false;
      };

      service.addressSearch(String(item.address || ""), function (results, status) {
        if (done(results, status)) return;
        var coords = typeof getItemCoordinates === "function" ? getItemCoordinates(item) : null;
        if (!coords || typeof service.coord2Address !== "function") {
          reject(new Error("매물 주소의 지번을 확인하지 못했습니다."));
          return;
        }
        service.coord2Address(coords.lng, coords.lat, function (reverseResults, reverseStatus) {
          if (!done(reverseResults, reverseStatus)) {
            reject(new Error("매물 위치에서 지번 주소를 확인하지 못했습니다."));
          }
        });
      });
    });
  }

  function parcelKey(parcel) {
    return [parcel.sigunguCd, parcel.bjdongCd, parcel.platGbCd, parcel.bun, parcel.ji].join("-");
  }

  function itemParcelKey(item) {
    return String(item && (item.propertyId || item.id || item.key || item.address) || "").trim();
  }

  function itemAddressParcelKey(item) {
    var address = String(item && item.address || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return address ? "address:" + address : "";
  }

  function readParcelCache(item) {
    try {
      var keys = [itemParcelKey(item), itemAddressParcelKey(item)].filter(Boolean);
      for (var index = 0; index < keys.length; index++) {
        var raw = localStorage.getItem(PARCEL_CACHE_PREFIX + keys[index]);
        if (!raw) continue;
        var wrapper = JSON.parse(raw);
        if (!wrapper || Date.now() - Number(wrapper.savedAt || 0) > PARCEL_CACHE_TTL) continue;
        if (wrapper.parcel) return wrapper.parcel;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function writeParcelCache(item, parcel) {
    try {
      var keys = [itemParcelKey(item), itemAddressParcelKey(item)].filter(Boolean);
      if (!keys.length || !parcel) return;
      var value = JSON.stringify({
        savedAt: Date.now(),
        parcel: parcel
      });
      keys.forEach(function(key) {
        localStorage.setItem(PARCEL_CACHE_PREFIX + key, value);
      });
    } catch (_) {}
  }

  function readCache(parcel) {
    try {
      var raw = localStorage.getItem(LOCAL_CACHE_PREFIX + parcelKey(parcel));
      if (!raw) return null;
      var wrapper = JSON.parse(raw);
      if (!wrapper || Date.now() - Number(wrapper.savedAt || 0) > LOCAL_CACHE_TTL) return null;
      if (!wrapper.data || Number(wrapper.data.version || 0) < 10) return null;
      return wrapper.data;
    } catch (_) {
      return null;
    }
  }

  function writeCache(parcel, data) {
    try {
      localStorage.setItem(LOCAL_CACHE_PREFIX + parcelKey(parcel), JSON.stringify({
        savedAt: Date.now(),
        data: data
      }));
    } catch (_) {}
  }

  function readBadgeCache(parcel) {
    try {
      var raw = localStorage.getItem(BADGE_CACHE_PREFIX + parcelKey(parcel));
      if (!raw) return null;
      var wrapper = JSON.parse(raw);
      if (!wrapper || Date.now() - Number(wrapper.savedAt || 0) > BADGE_CACHE_TTL) return null;
      return wrapper.data || null;
    } catch (_) {
      return null;
    }
  }

  function writeBadgeCache(parcel, data) {
    if (!parcel || !data) return;
    try {
      localStorage.setItem(BADGE_CACHE_PREFIX + parcelKey(parcel), JSON.stringify({
        savedAt: Date.now(),
        data: data
      }));
    } catch (_) {}
  }

  function normalizedName(value) {
    return String(value || "").replace(/[\s()[\]{}·.,_-]+/g, "").toLowerCase();
  }

  function compatibleName(first, second) {
    first = normalizedName(first);
    second = normalizedName(second);
    if (!first || !second) return true;
    return first === second || first.indexOf(second) >= 0 || second.indexOf(first) >= 0;
  }

  function compatibleDong(first, second) {
    first = normalizedName(first);
    second = normalizedName(second);
    if (!first || !second) return true;
    if (first === second) return true;
    var firstWithoutSuffix = first.length > 1 ? first.replace(/동$/, "") : first;
    var secondWithoutSuffix = second.length > 1 ? second.replace(/동$/, "") : second;
    return firstWithoutSuffix === secondWithoutSuffix;
  }

  function buildingIdentityText(row) {
    row = row || {};
    return [
      row.buildingName,
      row.dongName,
      row.mainUse,
      row.otherUse,
      row.registerType
    ].filter(Boolean).join(" ");
  }

  function isCommercialBuilding(building) {
    return /상가|상업|점포|근린생활|판매시설|업무시설|복리시설|생활편익/i.test(
      buildingIdentityText(building)
    );
  }

  function isApartmentBuilding(building) {
    return /아파트|공동주택/i.test(buildingIdentityText(building));
  }

  function buildingCategory(building) {
    var text = buildingIdentityText(building);
    var apartment = /아파트|공동주택/i.test(text);
    var commercial = /상가|상업|점포|근린생활|판매시설|업무시설|복리시설|생활편익/i.test(text);
    if (apartment && commercial) return "단지내상가";
    if (/집합/i.test(String(building && building.registerType || "")) && commercial) return "집합상가";
    if (commercial) return "상가건물";
    if (apartment) return "아파트 주동";
    return "일반건물";
  }

  function isGeneralRegister(building) {
    var registerType = String(building && building.registerType || "");
    return /일반/.test(registerType) && !/집합/.test(registerType);
  }

  function unitMatchesBuilding(unit, building, buildings) {
    unit = unit || {};
    building = building || {};
    buildings = Array.isArray(buildings) ? buildings : [];

    if (unit.managementKey && building.managementKey &&
        unit.managementKey === building.managementKey) {
      return true;
    }

    var unitName = normalizedName(unit.buildingName);
    var buildingName = normalizedName(building.buildingName);
    var unitDong = normalizedName(unit.dongName);
    var buildingDong = normalizedName(building.dongName);

    if (unitDong && buildingDong && !compatibleDong(unitDong, buildingDong)) return false;
    if (unitName && buildingName && !compatibleName(unitName, buildingName)) return false;

    if (unitDong && buildingDong) return true;
    if (buildingDong && !unitDong) {
      /*
       * 같은 아파트 지번에 101동·102동·상가동이 함께 있을 때 동명이 없는
       * 호실을 임의로 섞지 않습니다. 한 동뿐인 지번에서만 안전하게 허용합니다.
       */
      return Boolean(
        unitName &&
        compatibleName(unitName, buildingName) &&
        unitName.indexOf(buildingDong) >= 0
      ) || (buildings.length === 1 && (!unitName || compatibleName(unitName, buildingName)));
    }
    if (unitDong && !buildingDong) {
      return Boolean(
        unitName &&
        buildingName &&
        compatibleName(unitName, buildingName) &&
        (buildings.length === 1 || buildingName.indexOf(unitDong) >= 0)
      );
    }
    if (unitName && buildingName) {
      var sameNameBuildings = buildings.filter(function (row) {
        return compatibleName(row && row.buildingName, building.buildingName);
      });
      return compatibleName(unitName, buildingName) && sameNameBuildings.length <= 1;
    }
    return buildings.length === 1;
  }

  function unitEntriesForBuilding(building, units, buildings) {
    return (Array.isArray(units) ? units : []).map(function (row, index) {
      return { row: row, index: index };
    }).filter(function (entry) {
      return unitMatchesBuilding(entry.row, building, buildings);
    });
  }

  function listingLooksCommercial(item) {
    return /상가|점포|사무|업무|근린|공장|창고|토지/i.test(
      [item && item.type, item && item.name].filter(Boolean).join(" ")
    );
  }

  function buildingScore(data, item, building) {
    var buildings = Array.isArray(data && data.buildings) ? data.buildings : [];
    var units = Array.isArray(data && data.units) ? data.units : [];
    var score = 0;
    var itemName = normalizedName(item && item.name);
    var buildingName = normalizedName([
      building && building.buildingName,
      building && building.dongName
    ].filter(Boolean).join(" "));
    var genericItemName = /^(일반상가|집합상가|상가|상가점포|사무실|공장창고)$/;

    if (itemName && !genericItemName.test(itemName) && buildingName &&
        compatibleName(itemName, buildingName)) {
      score += 140;
    }

    var commercialListing = listingLooksCommercial(item);
    var commercialBuilding = isCommercialBuilding(building);
    if (commercialListing && commercialBuilding) score += 120;
    if (commercialListing && /상가동|단지내상가|아파트단지내상가/i.test(buildingIdentityText(building))) {
      score += 150;
    }
    if (commercialListing && isApartmentBuilding(building) && !commercialBuilding) score -= 130;
    if (/집합/i.test(String(building && building.registerType || "")) && commercialListing) score += 25;

    var matchingEntries = unitEntriesForBuilding(building, units, buildings);
    score += Math.min(60, matchingEntries.length);
    var targetRoom = roomKey(item && item.room);
    if (targetRoom && matchingEntries.some(function (entry) {
      return roomKey(entry.row && entry.row.roomName) === targetRoom;
    })) {
      score += 180;
    }
    return score;
  }

  function bestBuildingIndex(data, item) {
    var buildings = Array.isArray(data && data.buildings) ? data.buildings : [];
    if (!buildings.length) return 0;
    var bestIndex = 0;
    var bestScore = -Infinity;
    buildings.forEach(function (building, index) {
      var score = buildingScore(data, item, building);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function bestVisibleUnitGlobalIndex(entries, listingRoom) {
    if (!entries.length) return 0;
    var localIndex = bestUnitIndex(entries.map(function (entry) {
      return entry.row;
    }), listingRoom);
    return entries[localIndex] ? entries[localIndex].index : entries[0].index;
  }

  function buildingForBadge(data, item) {
    var buildings = Array.isArray(data && data.buildings) ? data.buildings : [];
    if (!buildings.length) return null;
    return buildings[bestBuildingIndex(data, item)] || buildings[0];
  }

  function firstNumber(row, fields) {
    row = row || {};
    for (var i = 0; i < fields.length; i += 1) {
      var value = asNumber(row[fields[i]]);
      if (value != null) return value;
    }
    return null;
  }

  function elevatorCount(row) {
    if (!row) return null;
    var passenger = firstNumber(row, [
      "passengerElevators",
      "rideUseElvtCnt",
      "rideUseElevatorCount"
    ]);
    var emergency = firstNumber(row, [
      "emergencyElevators",
      "emgenUseElvtCnt",
      "emergencyElevatorCount"
    ]);
    if (passenger == null && emergency == null) {
      var total = firstNumber(row, ["elevators", "elevatorCount", "totalElevators"]);
      return total == null ? null : Math.max(0, total);
    }
    return Math.max(0, Number(passenger || 0) + Number(emergency || 0));
  }

  function sameBuildingForBadge(selected, candidate, buildingCount) {
    if (!selected || !candidate) return false;
    if (selected === candidate) return true;

    var selectedKey = String(selected.managementKey || "").trim();
    var candidateKey = String(candidate.managementKey || "").trim();
    if (selectedKey && candidateKey && selectedKey === candidateKey) return true;

    var selectedName = normalizedName(selected.buildingName);
    var candidateName = normalizedName(candidate.buildingName);
    var selectedDong = normalizedName(selected.dongName);
    var candidateDong = normalizedName(candidate.dongName);

    if (selectedDong && candidateDong) {
      return compatibleDong(selectedDong, candidateDong) &&
        (!selectedName || !candidateName || compatibleName(selectedName, candidateName));
    }
    if (
      isCommercialBuilding(selected) &&
      isApartmentBuilding(candidate) &&
      !isCommercialBuilding(candidate)
    ) {
      return false;
    }
    if (Number(buildingCount || 0) === 1) {
      return !selectedName || !candidateName || compatibleName(selectedName, candidateName);
    }
    return Boolean(
      selectedName &&
      candidateName &&
      selectedName === candidateName &&
      !selectedDong &&
      !candidateDong
    );
  }

  function relatedBadgeRows(data, selected) {
    var buildings = Array.isArray(data && data.buildings) ? data.buildings : [];
    var recaps = Array.isArray(data && data.recaps) ? data.recaps : [];
    var rows = [selected];
    buildings.concat(recaps).forEach(function(row) {
      if (!row || rows.indexOf(row) >= 0) return;
      if (sameBuildingForBadge(selected, row, buildings.length)) rows.push(row);
    });
    return rows;
  }

  function badgeFromData(data, item) {
    var building = buildingForBadge(data, item);
    if (!building) return { year: "", elevators: 0, verified: false };
    var rows = relatedBadgeRows(data, building);
    var dateDigits = "";
    var elevators = 0;
    rows.forEach(function(row) {
      if (!dateDigits) {
        var rowDateDigits = String(
          row.approvalDate || row.useAprDay || row.useApprovalDate || ""
        ).replace(/\D/g, "");
        if (rowDateDigits.length >= 4) dateDigits = rowDateDigits;
      }
      var rowElevators = elevatorCount(row);
      if (rowElevators != null) elevators = Math.max(elevators, rowElevators);
    });
    var capacity = Number(
      building.elevatorMaxCapacity ||
      data && data.elevatorInfo && data.elevatorInfo.maxCapacity ||
      item && item.buildingElevatorCapacity ||
      0
    );
    return {
      year: dateDigits.length >= 4 ? dateDigits.slice(0, 4) : "",
      elevators: elevators,
      capacity: capacity,
      verified: true
    };
  }

  function mergeKnownBadgeV821(badge, knownBadge) {
    if (!knownBadge) return badge;
    badge = badge || { year: "", elevators: 0, capacity: 0, verified: false };
    return {
      year: String(badge.year || knownBadge.year || ""),
      // A cached title-row lookup must never hide an elevator count that was
      // already verified and persisted in D1 for this listing/address.
      elevators: Math.max(Number(badge.elevators || 0), Number(knownBadge.elevators || 0)),
      capacity: Math.max(Number(badge.capacity || 0), Number(knownBadge.capacity || 0)),
      verified: !!(badge.verified || knownBadge.verified),
      persistent: !!(badge.persistent || knownBadge.persistent)
    };
  }

  function applyBadgeToCard(card, badge) {
    if (!card || !badge) return;
    var badgeItem = card.__buildingBadgeItemV650;
    rememberBadgeV810(badgeItem, badge);
    var addressKey = normalizedBuildingAddressKeyV810(badgeItem && badgeItem.address);
    var targetCards = addressKey
      ? document.querySelectorAll(".item[data-building-address-key]")
      : [card];
    Array.prototype.forEach.call(targetCards, function(targetCard) {
      if (addressKey && targetCard.getAttribute("data-building-address-key") !== addressKey) return;
      var years = targetCard.querySelectorAll(".item-building-year-v650");
      var elevator = targetCard.querySelector(".item-elevator-v650");
      var elevatorCapacity = targetCard.querySelector(".item-elevator-capacity-v820");
      Array.prototype.forEach.call(years, function(year) {
        year.textContent = badge.year ? "준" + badge.year : "준공 -";
        year.classList.toggle("verified", !!badge.verified);
      });
      if (elevator) {
        elevator.hidden = !(badge.verified && badge.elevators > 0);
        if (!elevator.hidden) {
          var capacityText = Number(badge.capacity || 0) > 0 ? " · 최대 " + Number(badge.capacity) + "인승" : "";
          elevator.title = "건축물대장 엘리베이터 " + badge.elevators + "대" + capacityText;
          elevator.setAttribute("aria-label", "엘리베이터 " + badge.elevators + "대" + capacityText);
          if (elevatorCapacity) {
            elevatorCapacity.textContent = Number(badge.capacity || 0) > 0 ? Number(badge.capacity) + "인" : "";
            elevatorCapacity.hidden = !(Number(badge.capacity || 0) > 0);
          }
        }
      }
    });
  }

  function refreshBadgeCards(parcel, data) {
    var key = parcelKey(parcel);
    Array.prototype.forEach.call(document.querySelectorAll(".item[data-building-parcel-key]"), function(card) {
      if (card.getAttribute("data-building-parcel-key") !== key || !card.__buildingBadgeItemV650) return;
      applyBadgeToCard(card, badgeFromData(data, card.__buildingBadgeItemV650));
    });
  }

  function badgeRequestUrl(item, parcel) {
    if (typeof saveApiURL === "undefined" || !saveApiURL) {
      throw new Error("JS부동산 서버 주소가 설정되지 않았습니다.");
    }
    var params = [
      "action=buildingRegister",
      "client=" + encodeURIComponent(BUILDING_CLIENT_VERSION_V811),
      "mode=summary",
      "sigunguCd=" + encodeURIComponent(parcel.sigunguCd),
      "bjdongCd=" + encodeURIComponent(parcel.bjdongCd),
      "platGbCd=" + encodeURIComponent(parcel.platGbCd),
      "bun=" + encodeURIComponent(parcel.bun),
      "ji=" + encodeURIComponent(parcel.ji),
      "propertyId=" + encodeURIComponent(item && (item.propertyId || item.id || item.key) || ""),
      "address=" + encodeURIComponent(item && item.address || parcel.lotAddress || "")
    ];
    return saveApiURL + (saveApiURL.indexOf("?") >= 0 ? "&" : "?") + params.join("&");
  }

  function capacityRequestUrl(item, parcel, elevators) {
    var params = [
      "action=elevatorCapacity",
      "client=" + encodeURIComponent(BUILDING_CLIENT_VERSION_V811),
      "sigunguCd=" + encodeURIComponent(parcel.sigunguCd),
      "bjdongCd=" + encodeURIComponent(parcel.bjdongCd),
      "platGbCd=" + encodeURIComponent(parcel.platGbCd),
      "bun=" + encodeURIComponent(parcel.bun),
      "ji=" + encodeURIComponent(parcel.ji),
      "elevators=" + encodeURIComponent(elevators || 0),
      "propertyId=" + encodeURIComponent(item && (item.propertyId || item.id || item.key) || ""),
      "address=" + encodeURIComponent(item && item.address || parcel.lotAddress || "")
    ];
    return saveApiURL + (saveApiURL.indexOf("?") >= 0 ? "&" : "?") + params.join("&");
  }

  function requestCapacityData(item, parcel, elevators) {
    var key = parcelKey(parcel);
    if (capacityRequestsV820[key]) return capacityRequestsV820[key];
    capacityRequestsV820[key] = jsonp(capacityRequestUrl(item, parcel, elevators), 25000)
      .then(function(data) {
        if (!data || !data.ok || data.action !== "elevatorCapacity") return null;
        return data;
      })
      .catch(function() { return null; })
      .finally(function() { delete capacityRequestsV820[key]; });
    return capacityRequestsV820[key];
  }

  function requestBadgeData(item, parcel, persistToServer) {
    var key = parcelKey(parcel) + (persistToServer ? ":persist" : "");
    if (!persistToServer) {
      var fullCached = readCache(parcel);
      if (fullCached && fullCached.ok) return Promise.resolve(fullCached);
      var cached = readBadgeCache(parcel);
      if (cached && cached.ok) return Promise.resolve(cached);
    }
    if (badgeRequests[key]) return badgeRequests[key];

    badgeRequests[key] = jsonp(badgeRequestUrl(item, parcel), 60000).then(function(data) {
      if (!data || !data.ok || data.action !== "buildingRegister") {
        throw new Error((data && data.message) || "건축물대장 요약정보를 확인하지 못했습니다.");
      }
      if (persistToServer && (!data.buildingInfoCache || !data.buildingInfoCache.ok)) {
        throw new Error(
          data.buildingInfoCache && data.buildingInfoCache.message
            ? data.buildingInfoCache.message
            : "주소별 건물정보를 D1에 저장하지 못했습니다."
        );
      }
      writeBadgeCache(parcel, data);
      return data;
    }).finally(function() {
      delete badgeRequests[key];
    });
    return badgeRequests[key];
  }

  function ensureBadgeForCard(card, item) {
    var knownBadge = persistentBadgeFromItemV810(item) ||
      badgeAddressMemoryV810[normalizedBuildingAddressKeyV810(item.address)];
    var cachedParcel = readParcelCache(item);
    var parcelPromise = cachedParcel ? Promise.resolve(cachedParcel) : resolveParcel(item).then(function(parcel) {
      writeParcelCache(item, parcel);
      return parcel;
    });
    return parcelPromise.then(function(parcel) {
      if (!card.isConnected) return null;
      card.setAttribute("data-building-parcel-key", parcelKey(parcel));
      return requestBadgeData(item, parcel).then(function(data) {
        var badge = mergeKnownBadgeV821(badgeFromData(data, item), knownBadge);
        if (card.isConnected) applyBadgeToCard(card, badge);
        if (!(badge.elevators > 0 && !(badge.capacity > 0))) return data;
        return requestCapacityData(item, parcel, badge.elevators).then(function(capacityData) {
          if (capacityData && Number(capacityData.maxCapacity || 0) > 0) {
            badge.capacity = Number(capacityData.maxCapacity);
            badge.persistent = !!capacityData.persisted;
            rememberBadgeV810(item, badge);
            if (card.isConnected) applyBadgeToCard(card, badge);
          }
          return data;
        });
      });
    }).catch(function() {
      if (card.isConnected) applyBadgeToCard(card, { year: "", elevators: 0, verified: false });
      return null;
    });
  }

  function startBadgeRequest(entry) {
    if (!entry || !entry.card || !entry.card.isConnected) return;
    badgeActive += 1;
    entry.card.setAttribute("data-building-badge-loading", "1");
    ensureBadgeForCard(entry.card, entry.item).then(function(data) {
      if (data || !entry.card.isConnected) {
        entry.card.removeAttribute("data-building-badge-retries");
        return;
      }
      var retries = Number(entry.card.getAttribute("data-building-badge-retries") || 0);
      if (retries >= BADGE_MAX_RETRIES) return;
      entry.card.setAttribute("data-building-badge-retries", String(retries + 1));
      setTimeout(function() {
        queueBadge(entry.card, entry.item);
      }, 1200 * (retries + 1));
    }).finally(function() {
      if (entry.card) entry.card.removeAttribute("data-building-badge-loading");
      badgeActive -= 1;
      runBadgeQueue();
    });
  }

  function runBadgeQueue() {
    while (badgeActive < BADGE_MAX_CONCURRENCY && badgeQueue.length) {
      var entry = badgeQueue.shift();
      if (!entry.card.isConnected || entry.card.getAttribute("data-building-badge-loading") === "1") continue;
      startBadgeRequest(entry);
    }
  }

  function queueBadge(card, item) {
    if (!card || !item || card.getAttribute("data-building-badge-loading") === "1") return;
    if (badgeQueue.some(function(entry) { return entry.card === card; })) return;
    badgeQueue.push({ card: card, item: item });
    runBadgeQueue();
  }

  function bindBadge(card, item) {
    if (!card || !item) return;
    card.__buildingBadgeItemV650 = item;
    card.setAttribute("data-building-address-key", normalizedBuildingAddressKeyV810(item.address));
    var persistentBadge = persistentBadgeFromItemV810(item);
    var addressBadge = badgeAddressMemoryV810[normalizedBuildingAddressKeyV810(item.address)];
    var knownBadge = persistentBadge || addressBadge;
    var needsCapacity = false;
    if (persistentBadge || addressBadge) {
      applyBadgeToCard(card, knownBadge);
      // Existing D1 rows already know the elevator count but may predate the
      // capacity field. Keep the icon visible immediately, then enrich only
      // those elevator buildings lazily as their cards enter the viewport.
      needsCapacity = knownBadge.elevators > 0 && !(knownBadge.capacity > 0);
      if (!needsCapacity) return;
    }
    var cachedParcel = readParcelCache(item);
    if (cachedParcel) {
      card.setAttribute("data-building-parcel-key", parcelKey(cachedParcel));
      var cachedData = readCache(cachedParcel) || readBadgeCache(cachedParcel);
      if (cachedData && cachedData.ok) {
        var cachedBadge = mergeKnownBadgeV821(badgeFromData(cachedData, item), knownBadge);
        applyBadgeToCard(card, cachedBadge);
        needsCapacity = cachedBadge.elevators > 0 && !(cachedBadge.capacity > 0);
        // Elevator capacity is a separate official API. A cached building
        // register response must not prevent that lazy enrichment request.
        if (!needsCapacity) return;
      }
    }

    if ("IntersectionObserver" in window) {
      if (!badgeObserver) {
        badgeObserver = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (!entry.isIntersecting) return;
            badgeObserver.unobserve(entry.target);
            queueBadge(entry.target, entry.target.__buildingBadgeItemV650);
          });
        }, { root: document.getElementById("sidebar") || null, rootMargin: "500px 0px" });
      }
      badgeObserver.observe(card);
      return;
    }
    queueBadge(card, item);
  }

  function stableBadgeItemKeyV6520(item) {
    if (!item) return "";
    return String(
      item.propertyId || item.id || item.key || ""
    ).trim();
  }

  function getCachedBadge(item) {
    if (!item) return null;
    var persistentBadge = persistentBadgeFromItemV810(item);
    if (persistentBadge) {
      rememberBadgeV810(item, persistentBadge);
      return persistentBadge;
    }
    var addressKey = normalizedBuildingAddressKeyV810(item.address);
    if (addressKey && badgeAddressMemoryV810[addressKey]) return badgeAddressMemoryV810[addressKey];
    var itemKey = stableBadgeItemKeyV6520(item);
    if (itemKey && badgeMemoryV6520[itemKey]) {
      return badgeMemoryV6520[itemKey];
    }
    var cachedParcel = readParcelCache(item);
    if (!cachedParcel) return null;
    var cachedData = readCache(cachedParcel) || readBadgeCache(cachedParcel);
    if (!cachedData || !cachedData.ok) return null;
    var badge = badgeFromData(cachedData, item);
    rememberBadgeV810(item, badge);
    return badge;
  }

  function runBuildingInfoPrefetchV810() {
    while (
      buildingInfoPrefetchActiveV810 < BUILDING_INFO_PREFETCH_CONCURRENCY_V810 &&
      buildingInfoPrefetchQueueV810.length
    ) {
      (function(entry) {
        var item = entry.item;
        buildingInfoPrefetchActiveV810 += 1;
        var cachedParcel = readParcelCache(item);
        var parcelPromise = cachedParcel
          ? Promise.resolve(cachedParcel)
          : resolveParcel(item).then(function(parcel) {
              writeParcelCache(item, parcel);
              return parcel;
            });
        parcelPromise.then(function(parcel) {
          return requestBadgeData(item, parcel, true).then(function(data) {
            var badge = badgeFromData(data, item);
            badge.persistent = true;
            rememberBadgeV810(item, badge);
            applyBadgeToCard(
              Array.prototype.find.call(document.querySelectorAll(".item[data-building-address-key]"), function(card) {
                return card.getAttribute("data-building-address-key") === normalizedBuildingAddressKeyV810(item.address);
              }),
              badge
            );
          });
        }).catch(function() {
          if (entry.retries < 2) {
            setTimeout(function() {
              buildingInfoPrefetchQueueV810.push({ item: item, retries: entry.retries + 1 });
              runBuildingInfoPrefetchV810();
            }, 1500 * (entry.retries + 1));
          }
          return null;
        }).finally(function() {
          buildingInfoPrefetchActiveV810 -= 1;
          runBuildingInfoPrefetchV810();
        });
      })(buildingInfoPrefetchQueueV810.shift());
    }
  }

  function prefetchMissingBuildingInfoV810(items) {
    (items || []).forEach(function(item) {
      if (!item || persistentBadgeFromItemV810(item)) return;
      var addressKey = normalizedBuildingAddressKeyV810(item.address);
      if (!addressKey || buildingInfoPrefetchSeenV810[addressKey]) return;
      buildingInfoPrefetchSeenV810[addressKey] = true;
      buildingInfoPrefetchQueueV810.push({ item: item, retries: 0 });
    });
    runBuildingInfoPrefetchV810();
  }

  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var callbackName = "__buildingRegisterCallback" + Date.now() + Math.floor(Math.random() * 100000);
      var script = document.createElement("script");
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("건축물대장 조회 시간이 초과되었습니다."));
      }, timeoutMs || 30000);

      function cleanup() {
        clearTimeout(timer);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = function (data) {
        cleanup();
        resolve(data);
      };
      script.onerror = function () {
        cleanup();
        reject(new Error("JS부동산 서버와 연결하지 못했습니다."));
      };
      script.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
  }

  function requestUrl(force, mode) {
    if (typeof saveApiURL === "undefined" || !saveApiURL) {
      throw new Error("JS부동산 서버 주소가 설정되지 않았습니다.");
    }
    var parcel = state.parcel;
    var params = [
      "action=buildingRegister",
      "client=" + encodeURIComponent(BUILDING_CLIENT_VERSION_V811),
      "sigunguCd=" + encodeURIComponent(parcel.sigunguCd),
      "bjdongCd=" + encodeURIComponent(parcel.bjdongCd),
      "platGbCd=" + encodeURIComponent(parcel.platGbCd),
      "bun=" + encodeURIComponent(parcel.bun),
      "ji=" + encodeURIComponent(parcel.ji),
      "propertyId=" + encodeURIComponent(state.item.propertyId || state.item.id || state.item.key || ""),
      "address=" + encodeURIComponent(state.item.address || parcel.lotAddress || "")
    ];
    if (force) params.push("force=1");
    if (mode) params.push("mode=" + encodeURIComponent(mode));
    return saveApiURL + (saveApiURL.indexOf("?") >= 0 ? "&" : "?") + params.join("&");
  }

  function requestRegister(force, mode) {
    var url = requestUrl(force, mode);
    return jsonp(url, 120000).then(function (data) {
      if (!data || !data.ok || data.action !== "buildingRegister") {
        throw new Error((data && data.message) || "건축물대장 API 설정을 확인해주세요.");
      }
      return data;
    });
  }

  function applyRegisterData(data, requestToken, writeLocalCache) {
    if (requestToken !== state.requestToken) return null;
    state.data = data;
    state.buildingIndex = bestBuildingIndex(data, state.item);
    var buildings = Array.isArray(data.buildings) ? data.buildings : [];
    var entries = unitEntriesForBuilding(
      buildings[state.buildingIndex],
      data.units || [],
      buildings
    );
    state.unitIndex = bestVisibleUnitGlobalIndex(entries, state.item && state.item.room);
    if (writeLocalCache) writeCache(state.parcel, data);
    writeBadgeCache(state.parcel, data);
    refreshBadgeCards(state.parcel, data);
    render();
    return data;
  }

  function fetchRegister(force) {
    var requestToken = state.requestToken;
    var cached = !force ? readCache(state.parcel) : null;
    if (cached && cached.ok) {
      if (requestToken !== state.requestToken) return Promise.resolve(null);
      state.data = cached;
      state.buildingIndex = bestBuildingIndex(cached, state.item);
      var buildings = Array.isArray(cached.buildings) ? cached.buildings : [];
      var entries = unitEntriesForBuilding(
        buildings[state.buildingIndex],
        cached.units || [],
        buildings
      );
      state.unitIndex = bestVisibleUnitGlobalIndex(entries, state.item && state.item.room);
      render();
      return Promise.resolve(cached);
    }

    setLoading(force ? "최신 건축물대장을 다시 조회하고 있습니다" : "건축물대장을 조회하고 있습니다");
    var firstMode = force ? "full" : "summary";
    return requestRegister(force, firstMode).then(function (data) {
      if (requestToken !== state.requestToken) return null;
      applyRegisterData(data, requestToken, !data.partial);
      if (!data.partial || force) return data;

      state.detailsLoading = true;
      updateRefreshButton();
      return requestRegister(false, "full").then(function (fullData) {
        state.detailsLoading = false;
        return applyRegisterData(fullData, requestToken, true);
      }).catch(function () {
        state.detailsLoading = false;
        updateRefreshButton();
        return data;
      });
    }).catch(function (error) {
      if (requestToken !== state.requestToken) return null;
      state.detailsLoading = false;
      setError(error && error.message);
      return null;
    });
  }

  function extractListingFloor(room) {
    var text = String(room || "").trim();
    var match = text.match(/지하\s*(\d+)\s*층?/i) || text.match(/B\s*(\d+)\s*(?:층|F)?/i);
    if (match) return -Number(match[1]);
    match = text.match(/(-?\d+)\s*층/);
    if (match) return Number(match[1]);
    match = text.match(/^(\d{3,4})\s*호/);
    if (match) return Math.floor(Number(match[1]) / 100);
    return null;
  }

  function roomKey(value) {
    var text = String(value || "").toUpperCase().replace(/\s+/g, "");
    if (!text) return "";
    var basement = text.match(/B(\d{1,4})(?:호|실)?/) || text.match(/지하\s*(\d{1,2})층?\s*(\d{1,4})호/);
    if (basement) return "B" + String(basement[basement.length - 1]).replace(/^0+/, "");
    var room = text.match(/(\d{2,5})호/) || text.match(/^(\d{3,5})$/);
    return room ? String(room[1]).replace(/^0+/, "") : "";
  }

  function bestUnitIndex(units, listingRoom) {
    var target = roomKey(listingRoom);
    if (!target || !Array.isArray(units) || !units.length) return 0;
    var exact = units.findIndex(function (unit) {
      return roomKey(unit && unit.roomName) === target;
    });
    return exact >= 0 ? exact : 0;
  }

  function unitOptionLabel(unit, index) {
    var floor = joinText(unit && unit.floorType, unit && (unit.floorName || floorLabel(unit.floorNo)));
    var label = joinText(unit && unit.dongName, unit && unit.roomName, floor);
    return label === "정보 없음" ? "전유부 " + (index + 1) : label;
  }

  function signedFloor(row) {
    var floorNo = asNumber(row && row.floorNo);
    if (floorNo == null) return null;
    return /지하/i.test(String(row && row.floorType || "")) ? -Math.abs(floorNo) : floorNo;
  }

  function floorLabel(floor) {
    if (floor == null) return "미입력";
    return floor < 0 ? "지하 " + Math.abs(floor) + "층" : floor + "층";
  }

  function uniqueText(rows, field) {
    var seen = {};
    return (rows || []).map(function (row) { return String(row && row[field] || "").trim(); })
      .filter(function (value) { if (!value || seen[value]) return false; seen[value] = true; return true; })
      .join(" · ") || "정보 없음";
  }

  function ageText(approvalDate) {
    var year = Number(String(approvalDate || "").replace(/\D/g, "").slice(0, 4));
    if (!year) return "정보 없음";
    var age = new Date().getFullYear() - year;
    return age >= 0 ? age + "년" : "정보 없음";
  }

  function rowHtml(label, value, wide) {
    return '<div class="building-register-row' + (wide ? ' wide' : '') + '"><span>' +
      esc(label) + '</span><b>' + (value == null || value === "" ? "정보 없음" : value) + '</b></div>';
  }

  function sectionHtml(title, rows, className) {
    return '<section class="building-register-section ' + (className || "") + '"><h3>' + esc(title) +
      '</h3><div class="building-register-grid">' + rows.join("") + '</div></section>';
  }

  function registerValue(value) {
    if (value == null || value === "" || value === "정보 없음") return "-";
    return String(value);
  }

  function registerTableRow(leftLabel, leftValue, rightLabel, rightValue) {
    var html = '<tr><th>' + esc(leftLabel) + '</th><td' + (rightLabel ? '' : ' colspan="3"') + '>' +
      esc(registerValue(leftValue)) + '</td>';
    if (rightLabel) {
      html += '<th>' + esc(rightLabel) + '</th><td>' + esc(registerValue(rightValue)) + '</td>';
    }
    return html + '</tr>';
  }

  function uniquePush(list, value) {
    value = String(value || "").trim();
    if (!value || value === "정보 없음" || list.indexOf(value) >= 0) return;
    list.push(value);
  }

  function sumKnown(values) {
    var numbers = (values || []).map(asNumber).filter(function (value) { return value != null; });
    return numbers.length ? numbers.reduce(function (sum, value) { return sum + value; }, 0) : null;
  }

  function countPair(firstLabel, firstValue, secondLabel, secondValue) {
    return firstLabel + " " + registerValue(asNumber(firstValue) == null ? null : numberText(firstValue, "대")) +
      " / " + secondLabel + " " + registerValue(asNumber(secondValue) == null ? null : numberText(secondValue, "대"));
  }

  function groupedFloorRows(floors, listingFloor) {
    var groups = {};
    (floors || []).forEach(function (row, index) {
      var signed = signedFloor(row);
      var label = String(row.floorName || floorLabel(signed) || "층 정보 없음").trim();
      var key = signed == null ? "name:" + label + ":" + index : "floor:" + signed;
      if (!groups[key]) {
        groups[key] = {
          signed: signed,
          label: label,
          area: 0,
          uses: [],
          structures: []
        };
      }
      groups[key].area += asNumber(row.area) || 0;
      uniquePush(groups[key].uses, joinText(row.mainUse, row.otherUse));
      uniquePush(groups[key].structures, joinText(row.structure, row.otherStructure));
    });

    return Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) {
      if (a.signed == null && b.signed == null) return a.label.localeCompare(b.label, "ko");
      if (a.signed == null) return 1;
      if (b.signed == null) return -1;
      return b.signed - a.signed;
    }).map(function (group) {
      var matched = listingFloor != null && group.signed === listingFloor;
      return '<tr' + (matched ? ' class="matched-floor"' : '') + '>' +
        '<th scope="row">' + esc(group.label) + (matched ? '<small>매물층</small>' : '') + '</th>' +
        '<td>' + esc(registerValue(group.uses.join(" · "))) + '</td>' +
        '<td>' + esc(group.area ? numberText(group.area, "㎡") : "-") + '</td>' +
        '<td>' + esc(registerValue(group.structures.join(" · "))) + '</td>' +
      '</tr>';
    }).join("");
  }

  function detailedFloorRows(floors, listingFloor) {
    var sorted = (floors || []).map(function (row, index) {
      return { row: row || {}, index: index, signed: signedFloor(row) };
    }).sort(function (a, b) {
      if (a.signed == null && b.signed == null) return a.index - b.index;
      if (a.signed == null) return 1;
      if (b.signed == null) return -1;
      return b.signed - a.signed || a.index - b.index;
    });
    var floorCounts = {};
    sorted.forEach(function (entry) {
      var key = entry.signed == null
        ? "name:" + String(entry.row.floorName || "")
        : "floor:" + entry.signed;
      floorCounts[key] = (floorCounts[key] || 0) + 1;
    });
    return sorted.map(function (entry) {
      var row = entry.row;
      var key = entry.signed == null
        ? "name:" + String(row.floorName || "")
        : "floor:" + entry.signed;
      var label = String(row.floorName || floorLabel(entry.signed) || "층 정보 없음").trim();
      var roomName = String(
        row.roomName || row.hoNm || row.unitName || ""
      ).trim();
      if (roomName && roomName !== "정보 없음") label += " · " + roomName;
      var roomUnavailable = !roomName && floorCounts[key] > 1;
      var matched = listingFloor != null && entry.signed === listingFloor;
      return '<tr' + (matched ? ' class="matched-floor"' : '') + '>' +
        '<th scope="row">' + esc(label) +
          (roomUnavailable ? '<small class="floor-room-unavailable">호실 미제공</small>' : '') +
          (matched ? '<small>매물층</small>' : '') + '</th>' +
        '<td>' + esc(joinText(row.mainUse, row.otherUse)) + '</td>' +
        '<td>' + esc(areaText(row.area)) + '</td>' +
        '<td>' + esc(joinText(row.structure, row.otherStructure)) + '</td>' +
      '</tr>';
    }).join("");
  }

  function buildingOptionLabel(building, index) {
    var label = joinText(building.buildingName, building.dongName, building.mainAnnex);
    if (label === "정보 없음") label = "건축물 " + (index + 1);
    return "[" + buildingCategory(building) + "] " + label;
  }

  function unitAvailabilityNotice(data, building, units, visibleUnits) {
    if (visibleUnits.length) return "";
    var category = buildingCategory(building);
    var totalUnits = Array.isArray(units) ? units.length : 0;
    if (data && data.partial) {
      return '<div class="building-register-unit-notice loading"><strong>호실 상세자료를 불러오는 중입니다.</strong>' +
        '<span>잠시 후 선택한 건물·동의 배치도가 자동으로 표시됩니다.</span></div>';
    }
    if (totalUnits > 0) {
      return '<div class="building-register-unit-notice"><strong>선택한 건물·동의 호실만 표시합니다.</strong>' +
        '<span>같은 번지의 다른 아파트 동 호실 ' + esc(totalUnits) +
        '건은 섞이지 않도록 제외했습니다. 건물·동 선택에서 다른 동을 선택할 수 있습니다.</span></div>';
    }
    if (isGeneralRegister(building)) {
      return '<div class="building-register-unit-notice"><strong>공식 호실 번호가 없는 일반건축물입니다.</strong>' +
        '<span>아래 행은 101호·102호를 뜻하지 않습니다. 같은 층에 별도로 등록된 용도·면적 항목이며, 공식 데이터에 호실 번호가 있는 건물만 층별 호실 배치도로 표시합니다.</span></div>';
    }
    return '<div class="building-register-unit-notice"><strong>선택한 ' + esc(category) + '의 호실 상세자료가 없습니다.</strong>' +
      '<span>최신조회를 눌러 다시 확인할 수 있으며, 공공데이터에 전유부가 없으면 기본정보만 표시됩니다.</span></div>';
  }

  function unitFloorSortValue(row) {
    var floorNo = asNumber(row && row.floorNo);
    if (floorNo == null) floorNo = parseNumber(row && row.floorName);
    if (floorNo == null) return Number.MAX_SAFE_INTEGER;
    return /지하|地下|B/i.test(String(row && (row.floorType || row.floorName) || ""))
      ? -Math.abs(floorNo)
      : floorNo;
  }

  function compareUnitEntries(a, b) {
    var floorDifference = unitFloorSortValue(a.row) - unitFloorSortValue(b.row);
    if (floorDifference) return floorDifference;
    var aRoom = parseNumber(a.row && a.row.roomName);
    var bRoom = parseNumber(b.row && b.row.roomName);
    if (aRoom != null && bRoom != null && aRoom !== bRoom) return aRoom - bRoom;
    return String(a.row && a.row.roomName || "").localeCompare(
      String(b.row && b.row.roomName || ""),
      "ko",
      { numeric: true }
    );
  }

  function unitDetails(row) {
    row = row || {};
    var areas = Array.isArray(row.areas) ? row.areas : [];
    var exclusive = sumKnown(areas.filter(function (area) {
      return /전유/.test(String(area && area.areaType || ""));
    }).map(function (area) { return area.area; }));
    var shared = sumKnown(areas.filter(function (area) {
      return /공용/.test(String(area && area.areaType || ""));
    }).map(function (area) { return area.area; }));
    if (exclusive == null) exclusive = asNumber(row.area);
    var total = sumKnown([exclusive, shared]);
    var uses = [];
    uniquePush(uses, joinText(row.mainUse, row.otherUse));
    areas.forEach(function (area) {
      uniquePush(uses, joinText(area && area.mainUse, area && area.otherUse));
    });
    var structures = [];
    uniquePush(structures, joinText(row.structure, row.otherStructure));
    areas.forEach(function (area) {
      uniquePush(structures, joinText(area && area.structure, area && area.otherStructure));
    });
    return {
      exclusive: exclusive,
      shared: shared,
      total: total,
      use: uses.join(" · ") || "정보 없음",
      structure: structures.join(" · ") || "정보 없음"
    };
  }

  function unitAreaTone(totalArea) {
    var pyeong = asNumber(totalArea);
    pyeong = pyeong == null ? null : pyeong / 3.305785;
    if (pyeong == null) return "area-tone-unknown";
    if (pyeong < 10) return "area-tone-1";
    if (pyeong < 20) return "area-tone-2";
    if (pyeong < 30) return "area-tone-3";
    if (pyeong < 40) return "area-tone-4";
    if (pyeong < 50) return "area-tone-5";
    if (pyeong < 70) return "area-tone-6";
    return "area-tone-7";
  }

  function unitFloorGroupLabel(row) {
    var floor = unitFloorSortValue(row);
    if (floor !== Number.MAX_SAFE_INTEGER) return floorLabel(floor);
    return joinText(row && row.floorType, row && row.floorName);
  }

  function unitBrowserHtml(visibleUnits, selectedUnit) {
    if (!visibleUnits.length) return "";
    var listingIndex = bestUnitIndex(
      visibleUnits.map(function (entry) { return entry.row; }),
      state.item && state.item.room
    );
    var listingEntryIndex = visibleUnits[listingIndex] && visibleUnits[listingIndex].index;
    var groups = {};
    visibleUnits.forEach(function (entry) {
      var key = String(unitFloorSortValue(entry.row));
      if (!groups[key]) {
        groups[key] = {
          sort: unitFloorSortValue(entry.row),
          label: unitFloorGroupLabel(entry.row),
          entries: []
        };
      }
      groups[key].entries.push(entry);
    });
    var groupRows = Object.keys(groups).map(function (key) {
      return groups[key];
    }).sort(function (a, b) {
      return b.sort - a.sort;
    });

    var selectedDetails = unitDetails(selectedUnit);
    var selectedTitle = selectedUnit
      ? joinText(selectedUnit.roomName, unitFloorGroupLabel(selectedUnit))
      : "호실을 선택해주세요";
    var selectedSummary = selectedUnit ? '' +
      '<div class="building-register-selected-unit">' +
        '<div><span>선택 호실</span><strong>' + esc(selectedTitle) + '</strong></div>' +
        '<div><span>용도</span><strong>' + esc(selectedDetails.use) + '</strong></div>' +
        '<div><span>면적</span><strong>전유 ' + esc(areaText(selectedDetails.exclusive)) +
          ' / 공용 ' + esc(areaText(selectedDetails.shared)) +
          ' / 합계 ' + esc(areaText(selectedDetails.total)) + '</strong></div>' +
      '</div>' : "";

    return '' +
      '<section class="building-register-unit-browser">' +
        '<div class="building-register-unit-browser-head"><b>층별 호실 배치도</b><span>현재 매물 호실은 빨간 테두리로 표시됩니다. 호실을 누르면 용도와 면적이 바로 바뀝니다.</span></div>' +
        '<div class="building-register-unit-matrix">' +
          groupRows.map(function (group) {
            return '<div class="building-register-floor-row">' +
              '<strong class="building-register-floor-label">' + esc(group.label) + '</strong>' +
              '<div class="building-register-floor-units">' +
                group.entries.map(function (entry) {
                  var row = entry.row || {};
                  var details = unitDetails(row);
                  var floor = unitFloorGroupLabel(row);
                  var tooltip = '[' + registerValue(row.roomName) + ' · ' + registerValue(details.use) +
                    '] ' + floor + ' / 전유 ' + areaText(details.exclusive) +
                    ' / 공용 ' + areaText(details.shared) + ' / 합계 ' + areaText(details.total);
                  return '<button type="button" class="building-register-unit-cell ' +
                    unitAreaTone(details.total) +
                    (entry.index === state.unitIndex ? ' selected' : '') +
                    (entry.index === listingEntryIndex ? ' listing-unit' : '') +
                    '" data-unit-index="' + entry.index + '" data-tooltip="' + esc(tooltip) + '">' +
                    esc(row.roomName || "호실 미상") +
                  '</button>';
                }).join("") +
              '</div>' +
            '</div>';
          }).join("") +
        '</div>' +
        selectedSummary +
      '</section>';
  }

  function render() {
    state.loading = false;
    state.previewShown = false;
    updateRefreshButton();
    var data = state.data || {};
    var buildings = Array.isArray(data.buildings) ? data.buildings : [];
    var units = Array.isArray(data.units) ? data.units : [];
    var body = bodyElement();
    if (!body) return;
    if (!buildings.length) {
      body.innerHTML = '<div class="building-register-empty"><strong>조회된 건축물대장이 없습니다.</strong><p>주소·지번이 맞는지 확인해주세요.</p></div>';
      return;
    }

    if (state.buildingIndex >= buildings.length) state.buildingIndex = 0;
    var building = buildings[state.buildingIndex];
    var visibleUnits = unitEntriesForBuilding(building, units, buildings).sort(compareUnitEntries);
    var selectedVisibleIndex = visibleUnits.findIndex(function (entry) { return entry.index === state.unitIndex; });
    if (selectedVisibleIndex < 0 && visibleUnits.length) {
      state.unitIndex = bestVisibleUnitGlobalIndex(visibleUnits, state.item && state.item.room);
      selectedVisibleIndex = visibleUnits.findIndex(function (entry) { return entry.index === state.unitIndex; });
    }
    var unit = selectedVisibleIndex >= 0 ? visibleUnits[selectedVisibleIndex].row : null;
    var listingFloor = extractListingFloor(state.item && state.item.room);
    var parkingTotal = sumKnown([
      building.indoorMechanicalParking,
      building.outdoorMechanicalParking,
      building.indoorSelfParking,
      building.outdoorSelfParking
    ]);
    var zones = (building.zones || []).map(function (zone) {
      return joinText(zone.type, zone.name, zone.detail);
    }).filter(function (value, index, values) {
      return value !== "정보 없음" && values.indexOf(value) === index;
    });

    var selector = buildings.length > 1 ? '' +
      '<label class="building-register-selector"><span>건물·동 선택</span><select id="buildingRegisterSelectV640">' +
        buildings.map(function (row, index) {
          return '<option value="' + index + '"' + (index === state.buildingIndex ? ' selected' : '') + '>' +
            esc(buildingOptionLabel(row, index)) + '</option>';
        }).join("") +
      '</select></label>' : "";

    var unitSelector = unitBrowserHtml(visibleUnits, unit);
    var unitNotice = unitAvailabilityNotice(data, building, units, visibleUnits);

    var mechanicalParking = sumKnown([building.indoorMechanicalParking, building.outdoorMechanicalParking]);
    var selfParking = sumKnown([building.indoorSelfParking, building.outdoorSelfParking]);
    var elevatorCapacity = Number(building.elevatorMaxCapacity || data && data.elevatorInfo && data.elevatorInfo.maxCapacity ||
      state.item && state.item.buildingElevatorCapacity || 0);
    var elevatorDescription = countPair("승용", building.passengerElevators, "비상용", building.emergencyElevators) +
      (elevatorCapacity > 0 ? " / 최대정원 " + numberText(elevatorCapacity, "인") : "");
    var zoneText = zones.length ? zones.join(" / ") : "정보 없음";
    var buildingName = joinText(building.buildingName, building.dongName);
    var floorTableRows = isGeneralRegister(building)
      ? detailedFloorRows(building.floors || [], listingFloor)
      : groupedFloorRows(building.floors || [], listingFloor);
    var floorSection = visibleUnits.length ? "" : '' +
      '<section class="building-register-floor-section">' +
        '<h3>층별내역</h3>' +
        '<div class="building-register-table-wrap"><table class="building-register-floor-table">' +
          '<thead><tr><th>층·호실</th><th>용도</th><th>면적</th><th>구조</th></tr></thead>' +
          '<tbody>' + (floorTableRows || '<tr><td colspan="4" class="empty-floor">조회된 층별내역이 없습니다.</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</section>';
    var summaryRows = [
      registerTableRow("소재지", building.lotAddress || state.parcel.lotAddress || state.item.address),
      registerTableRow("도로명", building.roadAddress),
      registerTableRow("건물명", buildingName, "건축물대장구분", building.registerType),
      registerTableRow("용도지역", zoneText, "사용승인일", dateText(building.approvalDate)),
      registerTableRow("주용도", building.mainUse, "기타용도", building.otherUse),
      registerTableRow("주구조", joinText(building.structure, building.otherStructure), "지붕구조", joinText(building.roof, building.otherRoof)),
      registerTableRow("대지면적", areaText(building.siteArea), "건축면적", areaText(building.buildingArea)),
      registerTableRow("연면적", areaText(building.totalArea), "(용적률산정용)연면적", areaText(building.floorArea)),
      registerTableRow("건폐율", numberText(building.buildingCoverageRatio, "%"), "용적률", numberText(building.floorAreaRatio, "%")),
      registerTableRow("세대수", numberText(building.householdCount, "세대"), "가구수", numberText(building.familyCount, "가구")),
      registerTableRow("지상층수", numberText(building.groundFloors, "층"), "지하층수", numberText(building.undergroundFloors, "층")),
      registerTableRow("엘리베이터", elevatorDescription, "주차", countPair("기계식", mechanicalParking, "자주식", selfParking) + " / 합계 " + registerValue(parkingTotal == null ? null : numberText(parkingTotal, "대"))),
      registerTableRow("허가일", dateText(building.permitDate), "착공일", dateText(building.startDate)),
      registerTableRow("내진능력", building.seismicAbility, "내진설계 적용 여부", building.seismicDesign)
    ].join("");

    var unitSection = "";
    if (unit) {
      var unitAreas = Array.isArray(unit.areas) ? unit.areas : [];
      var unitInfo = unitDetails(unit);
      var exclusiveArea = unitInfo.exclusive;
      var publicArea = unitInfo.shared;
      var totalUnitArea = unitInfo.total;
      var unitUses = unitInfo.use;
      var unitStructures = unitInfo.structure;
      var unitSummaryRows = [
        registerTableRow("동", unit.dongName, "호실", unit.roomName),
        registerTableRow("층", joinText(unit.floorType, unit.floorName || floorLabel(unit.floorNo)), "대장구분", unit.registerType),
        registerTableRow("전유면적", areaText(exclusiveArea), "공용면적", areaText(publicArea)),
        registerTableRow("전유+공용 합계", areaText(totalUnitArea), "주용도", unitUses),
        registerTableRow("구조", unitStructures)
      ].join("");
      var unitAreaRows = unitAreas.map(function (row) {
        return '<tr><th scope="row">' + esc(row.areaType || "구분 없음") + '</th>' +
          '<td>' + esc(joinText(row.mainUse, row.otherUse)) + '</td>' +
          '<td>' + esc(areaText(row.area)) + '</td>' +
          '<td>' + esc(joinText(row.structure, row.otherStructure)) + '</td></tr>';
      }).join("");
      unitSection = '' +
        '<section class="building-register-sheet-section building-register-exclusive-section">' +
          '<h3>집합건물 전유부</h3>' +
          '<div class="building-register-table-wrap"><table class="building-register-summary-table"><tbody>' +
            unitSummaryRows +
          '</tbody></table></div>' +
        '</section>' +
        '<section class="building-register-floor-section building-register-exclusive-area-section">' +
          '<h3>전유·공용면적 내역</h3>' +
          '<div class="building-register-table-wrap"><table class="building-register-floor-table">' +
            '<thead><tr><th>구분</th><th>용도</th><th>면적</th><th>구조</th></tr></thead>' +
            '<tbody>' + (unitAreaRows || '<tr><td colspan="4" class="empty-floor">조회된 전유·공용면적 내역이 없습니다.</td></tr>') + '</tbody>' +
          '</table></div>' +
        '</section>';
    }

    body.innerHTML = '' +
      selector +
      unitSelector +
      unitNotice +
      '<section class="building-register-sheet-section">' +
        '<h3>건축물대장 기본정보</h3>' +
        '<div class="building-register-table-wrap"><table class="building-register-summary-table"><tbody>' +
          summaryRows +
        '</tbody></table></div>' +
      '</section>' +
      unitSection +
      '<p class="building-register-reference">* 공공데이터 참고용 자료로 실제 발급본과 차이가 있을 수 있습니다.</p>' +
      floorSection +
      '<div class="building-register-notice"><strong>위반건축물 여부 안내</strong><p>공공 건축물대장 API에는 위반건축물 표시 항목이 제공되지 않습니다. 계약·중개 전 정부24 발급본 또는 관할 행정기관에서 별도 확인하세요.</p></div>' +
      '<div class="building-register-source">' +
        '<img src="assets/molit-logo.png" alt="국토교통부">' +
        '<div><b>출처: ' + esc(data.source || "국토교통부 건축HUB 건축물대장정보 서비스") + '</b>' +
          '<span>조회 ' + esc(data.queriedAt || "-") + ' · 제공기관 갱신주기 ' + esc(data.updateCycle || "월간") +
          (data.recordCounts ? ' · 호실 ' + esc(data.recordCounts.exclusiveUnits || 0) +
            '건 / 면적 ' + esc(data.recordCounts.exclusiveAreas || 0) + '건' : '') +
          (data.cached ? ' · 서버 캐시' : '') + '</span></div>' +
        '<a href="' + esc(data.sourcePage || "https://www.data.go.kr/data/15134735/openapi.do") + '" target="_blank" rel="noopener">공식 API</a>' +
      '</div>';

    var select = document.getElementById("buildingRegisterSelectV640");
    if (select) {
      select.addEventListener("change", function () {
        state.buildingIndex = Number(this.value) || 0;
        var nextBuilding = buildings[state.buildingIndex];
        var nextEntries = unitEntriesForBuilding(nextBuilding, units, buildings);
        state.unitIndex = bestVisibleUnitGlobalIndex(nextEntries, state.item && state.item.room);
        render();
      });
    }
    Array.prototype.forEach.call(body.querySelectorAll(".building-register-unit-card, .building-register-unit-cell"), function (button) {
      button.addEventListener("click", function () {
        state.unitIndex = Number(this.getAttribute("data-unit-index")) || 0;
        render();
      });
    });
  }

  window.openBuildingRegisterV640 = function (encodedKey) {
    var item = findItem(encodedKey);
    if (!item) {
      alert("매물 정보를 찾지 못했습니다.");
      return;
    }
    state.item = item;
    state.parcel = null;
    state.data = null;
    state.buildingIndex = 0;
    state.unitIndex = 0;
    state.detailsLoading = false;
    state.previewShown = true;
    var requestToken = ++state.requestToken;
    openModal();
    var cachedParcel = readParcelCache(item);
    if (cachedParcel) {
      state.parcel = cachedParcel;
      fetchRegister(false);
      return;
    }
    setLoading("매물의 지번을 확인하고 있습니다");
    resolveParcel(item).then(function (parcel) {
      if (requestToken !== state.requestToken) return null;
      state.parcel = parcel;
      writeParcelCache(item, parcel);
      return fetchRegister(false);
    }).catch(function (error) {
      if (requestToken !== state.requestToken) return;
      setError(error && error.message);
    });
  };

  window.closeBuildingRegisterV640 = closeModal;
  window.refreshBuildingRegisterV640 = function () {
    if (state.parcel) fetchRegister(true);
  };
  window.JSBuildingRegisterBadges = {
    bind: bindBadge,
    getCached: getCachedBadge,
    prefetchMissing: prefetchMissingBuildingInfoV810,
    refreshVisible: function() {
      Array.prototype.forEach.call(document.querySelectorAll(".item[data-listing-key]"), function(card) {
        if (card.__buildingBadgeItemV650) bindBadge(card, card.__buildingBadgeItemV650);
      });
    }
  };
  window.JSBuildingRegisterDiagnosticsV652 = {
    buildingCategory: buildingCategory,
    bestBuildingIndex: bestBuildingIndex,
    unitEntriesForBuilding: unitEntriesForBuilding,
    bestVisibleUnitGlobalIndex: bestVisibleUnitGlobalIndex,
    elevatorCount: elevatorCount,
    badgeFromData: badgeFromData
  };
})();
