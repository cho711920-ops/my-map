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

    var mechanicalParking = sumKnown([building.indoorMechanicalParking, building.outdoorMechanicalParking]);
    var selfParking = sumKnown([building.indoorSelfParking, building.outdoorSelfParking]);
    var zoneText = zones.length ? zones.join(" / ") : "정보 없음";
    var buildingName = joinText(building.buildingName, building.dongName);
    var floorTableRows = groupedFloorRows(building.floors || [], listingFloor);
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
      registerTableRow("엘리베이터", countPair("승용", building.passengerElevators, "비상용", building.emergencyElevators), "주차", countPair("기계식", mechanicalParking, "자주식", selfParking) + " / 합계 " + registerValue(parkingTotal == null ? null : numberText(parkingTotal, "대"))),
      registerTableRow("허가일", dateText(building.permitDate), "착공일", dateText(building.startDate)),
      registerTableRow("내진능력", building.seismicAbility, "내진설계 적용 여부", building.seismicDesign)
    ].join("");

    body.innerHTML = '' +
      selector +
      '<section class="building-register-sheet-section">' +
        '<h3>건축물대장 기본정보</h3>' +
        '<div class="building-register-table-wrap"><table class="building-register-summary-table"><tbody>' +
          summaryRows +
        '</tbody></table></div>' +
      '</section>' +
      '<p class="building-register-reference">* 공공데이터 참고용 자료로 실제 발급본과 차이가 있을 수 있습니다.</p>' +
      '<section class="building-register-floor-section">' +
        '<h3>층별내역</h3>' +
        '<div class="building-register-table-wrap"><table class="building-register-floor-table">' +
          '<thead><tr><th>층</th><th>용도</th><th>면적</th><th>구조</th></tr></thead>' +
          '<tbody>' + (floorTableRows || '<tr><td colspan="4" class="empty-floor">조회된 층별내역이 없습니다.</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</section>' +
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
