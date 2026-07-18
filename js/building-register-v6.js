(function () {
  "use strict";

  var LOCAL_CACHE_PREFIX = "js-building-register-v1:";
  var LOCAL_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  var state = {
    item: null,
    parcel: null,
    data: null,
    buildingIndex: 0,
    loading: false,
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
      body.innerHTML = '<div class="building-register-loading"><i></i><b>' +
        esc(message || "건축물대장을 조회하고 있습니다") +
        '</b><span>표제부·층별개요·지역지구구역을 확인합니다.</span></div>';
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
    button.disabled = state.loading;
    button.textContent = state.loading ? "조회 중" : "최신조회";
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

  function readCache(parcel) {
    try {
      var raw = localStorage.getItem(LOCAL_CACHE_PREFIX + parcelKey(parcel));
      if (!raw) return null;
      var wrapper = JSON.parse(raw);
      if (!wrapper || Date.now() - Number(wrapper.savedAt || 0) > LOCAL_CACHE_TTL) return null;
      return wrapper.data || null;
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
        reject(new Error("Apps Script와 연결하지 못했습니다."));
      };
      script.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
  }

  function requestUrl(force) {
    if (typeof saveApiURL === "undefined" || !saveApiURL) {
      throw new Error("Apps Script 주소가 설정되지 않았습니다.");
    }
    var parcel = state.parcel;
    var params = [
      "action=buildingRegister",
      "sigunguCd=" + encodeURIComponent(parcel.sigunguCd),
      "bjdongCd=" + encodeURIComponent(parcel.bjdongCd),
      "platGbCd=" + encodeURIComponent(parcel.platGbCd),
      "bun=" + encodeURIComponent(parcel.bun),
      "ji=" + encodeURIComponent(parcel.ji),
      "propertyId=" + encodeURIComponent(state.item.propertyId || state.item.id || state.item.key || "")
    ];
    if (force) params.push("force=1");
    return saveApiURL + (saveApiURL.indexOf("?") >= 0 ? "&" : "?") + params.join("&");
  }

  function fetchRegister(force) {
    var requestToken = state.requestToken;
    var cached = !force ? readCache(state.parcel) : null;
    if (cached && cached.ok) {
      if (requestToken !== state.requestToken) return Promise.resolve(null);
      state.data = cached;
      state.buildingIndex = 0;
      render();
      return Promise.resolve(cached);
    }

    setLoading(force ? "최신 건축물대장을 다시 조회하고 있습니다" : "건축물대장을 조회하고 있습니다");
    var url;
    try { url = requestUrl(force); } catch (error) { setError(error.message); return Promise.resolve(null); }
    return jsonp(url, 35000).then(function (data) {
      if (requestToken !== state.requestToken) return null;
      if (!data || !data.ok || data.action !== "buildingRegister") {
        throw new Error((data && data.message) || "건축물대장 API 설정을 확인해주세요.");
      }
      state.data = data;
      state.buildingIndex = 0;
      writeCache(state.parcel, data);
      render();
      return data;
    }).catch(function (error) {
      if (requestToken !== state.requestToken) return null;
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

  function buildingOptionLabel(building, index) {
    return joinText(building.buildingName, building.dongName, building.mainAnnex) === "정보 없음"
      ? "건축물 " + (index + 1)
      : joinText(building.buildingName, building.dongName, building.mainAnnex);
  }

  function render() {
    state.loading = false;
    updateRefreshButton();
    var data = state.data || {};
    var buildings = Array.isArray(data.buildings) ? data.buildings : [];
    var body = bodyElement();
    if (!body) return;
    if (!buildings.length) {
      body.innerHTML = '<div class="building-register-empty"><strong>조회된 건축물대장이 없습니다.</strong><p>주소·지번이 맞는지 확인해주세요.</p></div>';
      return;
    }

    if (state.buildingIndex >= buildings.length) state.buildingIndex = 0;
    var building = buildings[state.buildingIndex];
    var listingFloor = extractListingFloor(state.item && state.item.room);
    var matchedFloors = (building.floors || []).filter(function (row) {
      return listingFloor != null && signedFloor(row) === listingFloor;
    });
    var matchedArea = matchedFloors.reduce(function (sum, row) { return sum + (asNumber(row.area) || 0); }, 0);
    var parkingTotal = [
      building.indoorMechanicalParking,
      building.outdoorMechanicalParking,
      building.indoorSelfParking,
      building.outdoorSelfParking
    ].reduce(function (sum, value) { return sum + (asNumber(value) || 0); }, 0);
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

    var basicRows = [
      rowHtml("건물명", esc(building.buildingName || building.dongName || "정보 없음")),
      rowHtml("대장 종류", esc(building.registerType || "정보 없음")),
      rowHtml("주용도", esc(joinText(building.mainUse, building.otherUse))),
      rowHtml("구조", esc(joinText(building.structure, building.otherStructure))),
      rowHtml("지붕", esc(joinText(building.roof, building.otherRoof))),
      rowHtml("층수", esc("지상 " + numberText(building.groundFloors, "층") + " · 지하 " + numberText(building.undergroundFloors, "층"))),
      rowHtml("높이", esc(numberText(building.height, "m"))),
      rowHtml("사용승인", esc(dateText(building.approvalDate))),
      rowHtml("건축물 연령", esc(ageText(building.approvalDate)))
    ];
    var floorRows = [
      rowHtml("매물 입력층", esc(floorLabel(listingFloor))),
      rowHtml("대장 층 확인", esc(matchedFloors.length ? matchedFloors.map(function (row) {
        return row.floorName || floorLabel(signedFloor(row));
      }).join(" · ") : "일치 자료 없음")),
      rowHtml("층 공식 용도", esc(uniqueText(matchedFloors, "mainUse"))),
      rowHtml("기타 용도", esc(uniqueText(matchedFloors, "otherUse"))),
      rowHtml("층 구조", esc(uniqueText(matchedFloors, "structure"))),
      rowHtml("층 면적", esc(matchedFloors.length ? areaText(matchedArea) : "정보 없음"))
    ];
    var areaRows = [
      rowHtml("대지면적", esc(areaText(building.siteArea))),
      rowHtml("건축면적", esc(areaText(building.buildingArea))),
      rowHtml("연면적", esc(areaText(building.totalArea))),
      rowHtml("용적률 산정면적", esc(areaText(building.floorArea))),
      rowHtml("건폐율", esc(numberText(building.buildingCoverageRatio, "%"))),
      rowHtml("용적률", esc(numberText(building.floorAreaRatio, "%")))
    ];
    var facilityRows = [
      rowHtml("승용 승강기", esc(numberText(building.passengerElevators, "대"))),
      rowHtml("비상용 승강기", esc(numberText(building.emergencyElevators, "대"))),
      rowHtml("주차 합계", esc(numberText(parkingTotal, "대"))),
      rowHtml("옥내 자주식", esc(numberText(building.indoorSelfParking, "대"))),
      rowHtml("옥외 자주식", esc(numberText(building.outdoorSelfParking, "대"))),
      rowHtml("옥내 기계식", esc(numberText(building.indoorMechanicalParking, "대"))),
      rowHtml("옥외 기계식", esc(numberText(building.outdoorMechanicalParking, "대")))
    ];
    var permitRows = [
      rowHtml("허가일", esc(dateText(building.permitDate))),
      rowHtml("착공일", esc(dateText(building.startDate))),
      rowHtml("사용승인일", esc(dateText(building.approvalDate))),
      rowHtml("내진설계 적용", esc(building.seismicDesign || "정보 없음")),
      rowHtml("내진능력", esc(building.seismicAbility || "정보 없음"))
    ];

    body.innerHTML = '' +
      '<div class="building-register-address">' +
        '<div><span>지번 주소</span><strong>' + esc(building.lotAddress || state.parcel.lotAddress || state.item.address || "정보 없음") + '</strong></div>' +
        '<div><span>도로명 주소</span><strong>' + esc(building.roadAddress || "정보 없음") + '</strong></div>' +
      '</div>' + selector +
      '<div class="building-register-sections">' +
        sectionHtml("기본 현황", basicRows) +
        sectionHtml("매물층 대장 확인", floorRows, matchedFloors.length ? "floor-match" : "floor-warning") +
        sectionHtml("면적·비율", areaRows) +
        sectionHtml("승강기·주차", facilityRows) +
        sectionHtml("허가·안전", permitRows) +
        sectionHtml("지역·지구", [rowHtml("지정 현황", esc(zones.length ? zones.join(" / ") : "정보 없음"), true)]) +
      '</div>' +
      '<div class="building-register-notice"><strong>위반건축물 여부 안내</strong><p>공공 건축물대장 API에는 위반건축물 표시 항목이 제공되지 않습니다. 계약·중개 전 정부24 발급본 또는 관할 행정기관에서 별도 확인하세요.</p></div>' +
      '<div class="building-register-source">' +
        '<img src="assets/molit-logo.png" alt="국토교통부">' +
        '<div><b>출처: ' + esc(data.source || "국토교통부 건축HUB 건축물대장정보 서비스") + '</b>' +
          '<span>조회 ' + esc(data.queriedAt || "-") + ' · 제공기관 갱신주기 ' + esc(data.updateCycle || "월간") +
          (data.cached ? ' · 서버 캐시' : '') + '</span></div>' +
        '<a href="' + esc(data.sourcePage || "https://www.data.go.kr/data/15134735/openapi.do") + '" target="_blank" rel="noopener">공식 API</a>' +
      '</div>';

    var select = document.getElementById("buildingRegisterSelectV640");
    if (select) {
      select.addEventListener("change", function () {
        state.buildingIndex = Number(this.value) || 0;
        render();
      });
    }
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
    var requestToken = ++state.requestToken;
    openModal();
    setLoading("매물의 지번을 확인하고 있습니다");
    resolveParcel(item).then(function (parcel) {
      if (requestToken !== state.requestToken) return null;
      state.parcel = parcel;
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
})();
