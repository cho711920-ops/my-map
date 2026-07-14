/* JS부동산 공통 UI/리스트/필터 핵심 스크립트 */
var sheetURL = "https://docs.google.com/spreadsheets/d/1zRWqjc7xVkiTnFHFujBNI72qr_aDCgxiQipQlnGgWmU/gviz/tq?tqx=out:csv";
var saveApiURL = "https://script.google.com/macros/s/AKfycbzPedWbaT4yaLNxqrvKI9F3L4JVZ0Q8wVnsSyLEELmaW2h9QuyfGYsESW_7rDxbdqNw/exec"; // JS부동산 구글시트 쓰기용 Apps Script 웹앱 URL

var map, geocoder;
var allItems = [];
var currentItems = [];
var overlays = [];
var selectedGroupKey = null;
var selectedItemKey = null;
var favoriteOnly = false;
var hideDone = true;
var gongsilOnly = false;
var multiClusterMode = false;
var selectedGroupKeys = [];
var preserveActionSelectionDuringRender = false;
var openMemoKey = null;
var editingMemoKey = null;
var memoEditMode = "replace";
var roadviewFullMap = null;
var roadviewFullMapMarker = null;
var roadviewTargetPosition = null;
var roadviewCameraPosition = null;
var currentRoadviewPan = 0;
var currentRoadviewMode = "roadview";
var currentRoadviewItemKey = null;
var currentRoadviewPosition = null;
var errorItems = [];
var isLoadingSheet = false;
var pendingAutoUpdate = false;
var geocodeCacheKey = "JS_REAL_ESTATE_GEOCODE_CACHE_V1";
var geocodeCache = loadGeocodeCache();
var geocodeCacheDirty = false;
var selectedPrintKeys = [];
var visibleListItems = [];
var favoriteKeys = JSON.parse(localStorage.getItem("favoriteKeys") || "[]");
var isRendering = false;
var doneTogglePendingKeys = {};


function loadGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(geocodeCacheKey) || "{}");
  } catch (e) {
    console.warn("좌표 캐시 읽기 실패", e);
    return {};
  }
}


function saveGeocodeCache() {
  if (!geocodeCacheDirty) return;

  try {
    localStorage.setItem(geocodeCacheKey, JSON.stringify(geocodeCache));
    geocodeCacheDirty = false;
  } catch (e) {
    console.warn("좌표 캐시 저장 실패", e);
  }
}


function normalizeAddressForCache(address) {
  return String(address || "").replace(/\s+/g, " ").trim();
}


function clean(t) {
  return (t || "").replaceAll('"', '').trim();
}


function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function parseCSVLine(line) {
  var result = [];
  var current = "";
  var insideQuotes = false;

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];

    if (ch === '"') {
      insideQuotes = !insideQuotes;
    } else if (ch === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}


function itemKey(item) {
  return item.name + "|" + item.address + "|" + item.room + "|" + item.type;
}


function isDone(item) {
  return item.state === "계약완료";
}


function isFavorite(item) {
  return favoriteKeys.includes(item.key);
}


function toggleFavorite(key) {
  if (favoriteKeys.includes(key)) {
    favoriteKeys = favoriteKeys.filter(function(k) { return k !== key; });
  } else {
    favoriteKeys.push(key);
  }

  localStorage.setItem("favoriteKeys", JSON.stringify(favoriteKeys));
  applyFilter();
}


function toggleFavoriteOnly() {
  favoriteOnly = !favoriteOnly;
  document.getElementById("favoriteBtn").innerText = "찜목록";
  document.getElementById("favoriteBtn").classList.toggle("on", favoriteOnly);
  applyFilter();
}


function positionDetailFilter() {
  var panel = document.getElementById("detailFilter");
  var sidebar = document.getElementById("sidebar");
  var detailBtn = document.getElementById("detailBtn");

  if (!panel || !sidebar || !detailBtn) return;

  if (window.innerWidth <= 768) {
    panel.style.left = "8px";
    panel.style.right = "8px";
    panel.style.top = Math.max(8, detailBtn.getBoundingClientRect().bottom + 6) + "px";
    panel.style.width = "auto";
    return;
  }

  var sidebarRect = sidebar.getBoundingClientRect();
  var btnRect = detailBtn.getBoundingClientRect();
  var panelWidth = Math.min(360, Math.max(300, window.innerWidth - sidebarRect.right - 30));
  var left = Math.min(
    window.innerWidth - panelWidth - 12,
    Math.max(sidebarRect.right + 12, btnRect.left)
  );

  panel.style.left = left + "px";
  panel.style.right = "auto";
  panel.style.top = Math.max(12, btnRect.bottom + 8) + "px";
  panel.style.width = panelWidth + "px";
}


function toggleDetailFilter() {
  var panel = document.getElementById("detailFilter");
  var button = document.getElementById("detailBtn");
  var willOpen = !panel.classList.contains("open");

  panel.classList.toggle("open", willOpen);
  button.classList.toggle("on", willOpen);

  if (willOpen) {
    positionDetailFilter();
  }
}


window.addEventListener("resize", function() {
  var panel = document.getElementById("detailFilter");
  if (panel && panel.classList.contains("open")) {
    positionDetailFilter();
  }
});


function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}


function setupEnterSearch() {
  var inputs = document.querySelectorAll("#keyword, #minDeposit, #maxDeposit, #minRent, #maxRent, #minArea, #maxArea, #minFloor, #maxFloor");

  inputs.forEach(function(input) {
    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        applyFilter();
      }
    });
  });
}


function setupMobilePanelDrag() {
  var sidebar = document.getElementById("sidebar");
  var handle = document.getElementById("dragHandle");

  if (!sidebar || !handle) return;

  var startY = 0;
  var startHeight = 0;
  var minRatio = 0.45;
  var maxRatio = 0.70;
  var dragging = false;
  var moved = false;
  var suppressClick = false;

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function setHeightByRatio(ratio) {
    sidebar.style.height = (window.innerHeight * ratio) + "px";
  }

  function startDrag(clientY) {
    if (!isMobile()) return;

    dragging = true;
    moved = false;
    startY = clientY;
    startHeight = sidebar.getBoundingClientRect().height;
    sidebar.style.transition = "none";
  }

  function moveDrag(clientY) {
    if (!dragging || !isMobile()) return;

    var deltaY = startY - clientY;

    if (Math.abs(deltaY) > 4) {
      moved = true;
    }

    var newHeight = startHeight + deltaY;

    var minHeight = window.innerHeight * minRatio;
    var maxHeight = window.innerHeight * maxRatio;

    if (newHeight < minHeight) newHeight = minHeight;
    if (newHeight > maxHeight) newHeight = maxHeight;

    sidebar.style.height = newHeight + "px";
  }

  function endDrag() {
    if (!dragging || !isMobile()) return;

    dragging = false;

    var currentHeight = sidebar.getBoundingClientRect().height;
    var middleHeight = window.innerHeight * ((minRatio + maxRatio) / 2);

    sidebar.style.transition = "height 0.28s cubic-bezier(0.22, 1, 0.36, 1)";

    if (currentHeight >= middleHeight) {
      setHeightByRatio(maxRatio);
    } else {
      setHeightByRatio(minRatio);
    }

    if (moved) {
      suppressClick = true;
      setTimeout(function() {
        suppressClick = false;
      }, 250);
    }
  }

  handle.addEventListener("touchstart", function(e) {
    if (e.touches && e.touches.length === 1) {
      startDrag(e.touches[0].clientY);
    }
  }, { passive:true });

  handle.addEventListener("touchmove", function(e) {
    if (!dragging) return;

    // 손잡이에서 한 손가락으로 움직일 때만 패널 드래그 처리
    // 두 손가락 확대/축소나 지도 터치는 막지 않음
    if (!e.touches || e.touches.length !== 1) return;

    e.preventDefault();
    moveDrag(e.touches[0].clientY);
  }, { passive:false });

  handle.addEventListener("touchend", function() {
    endDrag();
  });

  handle.addEventListener("touchcancel", function() {
    endDrag();
  });

  handle.addEventListener("mousedown", function(e) {
    startDrag(e.clientY);
  });

  window.addEventListener("mousemove", function(e) {
    moveDrag(e.clientY);
  });

  window.addEventListener("mouseup", function() {
    endDrag();
  });

  handle.addEventListener("click", function() {
    if (!isMobile()) return;
    if (suppressClick) return;

    var currentHeight = sidebar.getBoundingClientRect().height;
    var middleHeight = window.innerHeight * ((minRatio + maxRatio) / 2);

    sidebar.style.transition = "height 0.28s cubic-bezier(0.22, 1, 0.36, 1)";

    if (currentHeight < middleHeight) {
      setHeightByRatio(maxRatio);
    } else {
      setHeightByRatio(minRatio);
    }
  });

  window.addEventListener("resize", function() {
    if (isMobile()) {
      setHeightByRatio(minRatio);
    } else {
      sidebar.style.height = "";
      sidebar.style.transition = "";
    }
  });

  if (isMobile()) {
    setHeightByRatio(minRatio);
  }
}


function updateTypeOptions(items) {
  var select = document.getElementById("typeFilter");
  var currentValue = select.value;
  var types = [];

  items.forEach(function(item) {
    if (item.type && !types.includes(item.type)) {
      types.push(item.type);
    }
  });

  types.sort();

  select.innerHTML = '<option value="">구분</option>';

  types.forEach(function(type) {
    var option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    select.appendChild(option);
  });

  if (types.includes(currentValue)) {
    select.value = currentValue;
  }
}


/* === v4.3.1 층수 범위 필터 === */
function getItemFloorNumber(item) {
  var room = String((item && item.room) || "").trim();
  var memo = String((item && item.memo) || "").trim();
  var name = String((item && item.name) || "").trim();
  var text = [room, name, memo].join(" ");

  // 지하층: -1로 통일
  if (/지하|地下|\bB\s*1\b|\bB1\b|비\s*1\s*층/i.test(text)) return -1;

  // "3층", "10 층"처럼 층이 명시된 경우를 최우선 사용
  var explicitFloor = text.match(/(?:^|[^0-9])(\d{1,2})\s*층/);
  if (explicitFloor) return Number(explicitFloor[1]) || 0;

  // "3F", "10F" 표기
  var floorF = text.match(/(?:^|[^0-9])(\d{1,2})\s*F(?:[^A-Z]|$)/i);
  if (floorF) return Number(floorF[1]) || 0;

  // 호실만 있는 경우: 101호→1층, 201호→2층, 1001호→10층
  var roomNumber = room.match(/(?:^|[^0-9])(\d{3,4})\s*호/);
  if (roomNumber) {
    var value = roomNumber[1];
    var inferred = value.length === 3
      ? Number(value.charAt(0))
      : Number(value.slice(0, value.length - 2));

    if (inferred > 0) return inferred;
  }

  // 층수 정보가 없으면 null
  return null;
}


function readOptionalNumberInput(id) {
  var el = document.getElementById(id);
  if (!el) return null;

  var value = String(el.value || "").trim();
  if (value === "") return null;

  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}


function buildSearchText(item) {
  return [
    item && item.name,
    item && item.address,
    item && item.room,
    item && item.type,
    item && item.memo
  ].map(function(value) {
    return String(value || "").toLowerCase();
  }).join(" ");
}


/*
 * 쉼표(,) = OR 검색
 * 각 쉼표 그룹 안의 공백 = AND 검색
 *
 * 예:
 * 괴정,탄방,월평
 * → 괴정 OR 탄방 OR 월평
 *
 * 괴정 1층,탄방 1층
 * → (괴정 AND 1층) OR (탄방 AND 1층)
 */
function matchesMultiKeyword(item, rawKeyword) {
  var keyword = String(rawKeyword || "").trim().toLowerCase();

  if (!keyword) return true;

  var searchText = buildSearchText(item);

  var orGroups = keyword
    .split(",")
    .map(function(group) {
      return group.trim();
    })
    .filter(Boolean);

  if (!orGroups.length) return true;

  return orGroups.some(function(group) {
    var andWords = group
      .split(/\s+/)
      .map(function(word) {
        return word.trim();
      })
      .filter(Boolean);

    return andWords.every(function(word) {
      return searchText.includes(word);
    });
  });
}


var SORT_LABELS = {
  latest: "최신",
  oldest: "오래된순",
  aiScoreHigh: "AI점수",
  pyeongHigh: "평당↓",
  pyeongLow: "평당↑",
  depositHigh: "보증금↓",
  depositLow: "보증금↑",
  rentHigh: "월세↓",
  rentLow: "월세↑",
  premiumHigh: "권리금↓",
  premiumLow: "권리금↑",
  areaHigh: "평수↓",
  areaLow: "평수↑",
  name: "건물명",
  address: "주소순"
};


function toggleSortDropdown(event) {
  if (event) event.stopPropagation();

  var dropdown = document.getElementById("sortDropdown");
  var button = document.getElementById("sortDropdownBtn");

  if (!dropdown || !button) return;

  var willOpen = !dropdown.classList.contains("open");
  dropdown.classList.toggle("open", willOpen);
  button.setAttribute("aria-expanded", willOpen ? "true" : "false");
}


function closeSortDropdown() {
  var dropdown = document.getElementById("sortDropdown");
  var button = document.getElementById("sortDropdownBtn");

  if (dropdown) dropdown.classList.remove("open");
  if (button) button.setAttribute("aria-expanded", "false");
}


function updateSortDropdownUI() {
  var input = document.getElementById("sortFilter");
  var button = document.getElementById("sortDropdownBtn");
  var menu = document.getElementById("sortDropdownMenu");

  if (!input || !button || !menu) return;

  var value = input.value || "latest";

  /*
   * 첫 접속 기본값은 최신등록순이지만 버튼에는 정렬로 표시합니다.
   * 사용자가 다른 기준을 선택한 뒤에는 현재 기준을 짧게 표시합니다.
   */
  button.textContent = value === "latest" ? "정렬" : (SORT_LABELS[value] || "정렬");

  Array.prototype.forEach.call(
    menu.querySelectorAll("[data-sort-value]"),
    function(option) {
      var selected = option.getAttribute("data-sort-value") === value;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-selected", selected ? "true" : "false");
    }
  );
}


function selectSortOption(value) {
  var input = document.getElementById("sortFilter");

  if (!input) return;

  input.value = value || "latest";
  updateSortDropdownUI();
  closeSortDropdown();
  applyFilter();
}


document.addEventListener("click", function(event) {
  var dropdown = document.getElementById("sortDropdown");

  if (dropdown && !dropdown.contains(event.target)) {
    closeSortDropdown();
  }
});


setTimeout(updateSortDropdownUI, 0);


function getFilteredItems() {
  if (!map) return allItems;

  var bounds = map.getBounds();

  var keyword = document.getElementById("keyword").value.trim();
  var selectedType = document.getElementById("typeFilter").value;
  var sortType = document.getElementById("sortFilter").value;
  var industryKeyword = String((document.getElementById("industryFilter") || {}).value || "").trim().toLowerCase();

  var minDeposit = Number(document.getElementById("minDeposit").value) || 0;
  var maxDeposit = Number(document.getElementById("maxDeposit").value) || 999999999;

  var minRent = Number(document.getElementById("minRent").value) || 0;
  var maxRent = Number(document.getElementById("maxRent").value) || 999999999;

  var minArea = Number(document.getElementById("minArea").value) || 0;
  var maxArea = Number(document.getElementById("maxArea").value) || 999999999;

  var minFloor = readOptionalNumberInput("minFloor");
  var maxFloor = readOptionalNumberInput("maxFloor");
  var hasFloorFilter = minFloor !== null || maxFloor !== null;

  if (minFloor !== null && maxFloor !== null && minFloor > maxFloor) {
    var floorSwap = minFloor;
    minFloor = maxFloor;
    maxFloor = floorSwap;
  }

  var filtered = allItems.filter(function(item) {
    var matchKeyword = matchesMultiKeyword(item, keyword);

    var matchType = !selectedType || item.type === selectedType;

    var industryTerms = industryKeyword.split(",").map(function(term) {
      return term.trim();
    }).filter(Boolean);
    var memoTextForIndustry = String(item.memo || "").toLowerCase();
    var matchIndustry = !industryTerms.length || industryTerms.some(function(term) {
      return memoTextForIndustry.indexOf(term) !== -1;
    });

    var matchPrice =
      item.deposit >= minDeposit &&
      item.deposit <= maxDeposit &&
      item.rent >= minRent &&
      item.rent <= maxRent &&
      item.area >= minArea &&
      item.area <= maxArea;

    var itemFloor = getItemFloorNumber(item);
    var matchFloor = true;

    if (hasFloorFilter) {
      // 층수 범위를 사용하면 층수 미확인 매물은 제외
      matchFloor =
        itemFloor !== null &&
        (minFloor === null || itemFloor >= minFloor) &&
        (maxFloor === null || itemFloor <= maxFloor);
    }

    var matchFavorite = !favoriteOnly || isFavorite(item);
    var matchDone = !hideDone || !isDone(item);
    var matchGongsil = !gongsilOnly || isGongsilBoxItem(item);
    var inMap = item.latlng && bounds.contain(item.latlng);

    return matchKeyword && matchType && matchIndustry && matchPrice && matchFloor &&
      matchFavorite && matchDone && matchGongsil && inMap;
  });

  filtered.sort(function(a, b) {
    var dateA = new Date((a.regDate || "").replace(/\./g, "-")).getTime() || 0;
    var dateB = new Date((b.regDate || "").replace(/\./g, "-")).getTime() || 0;

    if (sortType === "latest") return dateB - dateA;
    if (sortType === "oldest") return dateA - dateB;

    if (sortType === "name") {
      return (a.name || "").localeCompare((b.name || ""), "ko");
    }

    if (sortType === "address") {
      return (a.address || "").localeCompare((b.address || ""), "ko");
    }

    if (sortType === "aiScoreHigh") {
      var aiA = getSmartItemAnalysis(a).score || 0;
      var aiB = getSmartItemAnalysis(b).score || 0;
      return aiB - aiA;
    }

    var pyeongA = Number(a.area) > 0 ? Number(a.rent || 0) / Number(a.area) : 0;
    var pyeongB = Number(b.area) > 0 ? Number(b.rent || 0) / Number(b.area) : 0;

    if (sortType === "pyeongHigh") return pyeongB - pyeongA;
    if (sortType === "pyeongLow") return pyeongA - pyeongB;
    if (sortType === "depositLow") return a.deposit - b.deposit;
    if (sortType === "depositHigh") return b.deposit - a.deposit;
    if (sortType === "rentLow") return a.rent - b.rent;
    if (sortType === "rentHigh") return b.rent - a.rent;
    if (sortType === "premiumLow") return a.premium - b.premium;
    if (sortType === "premiumHigh") return b.premium - a.premium;
    if (sortType === "areaHigh") return b.area - a.area;
    if (sortType === "areaLow") return a.area - b.area;

    return 0;
  });

  return filtered;
}


function applyFilter() {
  var filtered = getFilteredItems();
  currentItems = filtered;

  drawItems(filtered);
  document.getElementById("status").innerHTML = "검색 결과 " + filtered.length + "개";
}


/* === v3.0.13 추가: 리스트 평당가 뱃지 + 출처별 마커 색상 로직 === */


function getRentPerPyeongValue(item) {
  var area = Number(item && item.area) || 0;
  var rent = Number(item && item.rent) || 0;
  var fee = Number(item && item.fee) || 0;
  if (!area) return 0;
  return Math.round(((rent + fee) / area) * 10) / 10;
}


function getPyeongBadgeClass(value) {
  if (!value) return "";
  if (value <= 4.5) return " low";
  if (value <= 7) return " mid";
  return " high";
}


function buildPyeongMiniBadge(item) {
  var value = getRentPerPyeongValue(item);
  if (!value) return '<span class="pyeong-mini-badge">평당 -</span>';
  return '<span class="pyeong-mini-badge' + getPyeongBadgeClass(value) + '">평당 ' + escapeHtml(value) + '만</span>';
}


function isFieldVisitItem(item) {
  var memo = String((item && item.memo) ? item.memo : "");

  return /\(\s*임장가자\s*\)|\(\s*공실박스\s*\)/i.test(memo);
}


function isGongsilBoxItem(item) {
  return isFieldVisitItem(item);
}


function getItemSourceType(item) {
  var source = String((item && item.source) ? item.source : "").trim().toLowerCase();

  if (/공실박스|gongsil/.test(source)) return "gongsil";
  if (/네이버|naver/.test(source)) return "naver";
  if (/당근|daangn|karrot/.test(source)) return "danggeun";
  if (/직접확인|직접등록|직접매물|직접|현장확인/.test(source)) return "direct";

  var memo = String((item && item.memo) ? item.memo : "");
  var match = memo.match(/출처\s*[:：]\s*([^\/|,，\n]+)/);

  if (!match || !match[1]) return "unknown";

  source = String(match[1] || "").trim().toLowerCase();

  if (/공실박스|gongsil/.test(source)) return "gongsil";
  if (/네이버|naver/.test(source)) return "naver";
  if (/당근|daangn|karrot/.test(source)) return "danggeun";
  if (/직접확인|직접등록|직접매물|직접|현장확인/.test(source)) return "direct";

  return "unknown";
}

function getClusterSourceType(items) {
  var counts = { gongsil:0, naver:0, danggeun:0, direct:0, unknown:0 };
  (items || []).forEach(function(item) {
    var source = getItemSourceType(item);
    counts[source] = (counts[source] || 0) + 1;
  });

  var activeSources = Object.keys(counts).filter(function(key) {
    return key !== "unknown" && counts[key] > 0;
  });

  // 명확한 출처가 없으면 기본 파란색(source-unknown)
  if (activeSources.length === 0) return "unknown";

  // 명확한 출처가 2종류 이상 섞였을 때만 혼합색
  if (activeSources.length >= 2) return "mixed";

  return activeSources[0];
}


function showList(items) {
  var previousSignature = (visibleListItems || []).map(function(item) {
    return item.key;
  }).join("||");

  var nextSignature = (items || []).map(function(item) {
    return item.key;
  }).join("||");

  /*
   * 사용자가 보고 있는 리스트 구성이 바뀌면 체크를 자동 해제합니다.
   * 단, 자동업데이트가 같은 화면을 복원하는 동안에는 유지합니다.
   */
  if (
    previousSignature &&
    previousSignature !== nextSignature &&
    !preserveActionSelectionDuringRender
  ) {
    selectedPrintKeys = [];
  }

  visibleListItems = items.slice();
  document.getElementById("list").innerHTML = "";

  items.forEach(function(item) {
    addListItem(item);
  });

  updatePrintSelectedButton();
  syncListMasterCheckbox();
}


function getItemCoordinates(item) {
  if (!item || !item.latlng) return null;

  try {
    var lat = typeof item.latlng.getLat === "function"
      ? item.latlng.getLat()
      : Number(item.lat || item.latitude);

    var lng = typeof item.latlng.getLng === "function"
      ? item.latlng.getLng()
      : Number(item.lng || item.longitude);

    if (!isFinite(lat) || !isFinite(lng)) return null;

    return {
      lat: lat,
      lng: lng
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}


function openKakaoNavigation(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var item = allItems.find(function(currentItem) {
    return currentItem.key === key;
  });

  if (!item) {
    alert("매물 정보를 찾지 못했습니다.");
    return;
  }

  var coords = getItemCoordinates(item);

  if (!coords) {
    alert("이 매물의 지도 좌표가 아직 준비되지 않았습니다.");
    return;
  }

  /*
   * 카카오맵 목적지 이름도 건물명이 아닌 주소로 표시합니다.
   * 좌표는 기존 매물 좌표를 그대로 사용하므로 정확한 위치로 이동합니다.
   */
  var destinationName = String(item.address || "").trim();

  if (!destinationName) {
    destinationName = "매물 위치";
  } else if (
    !/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(destinationName)
  ) {
    destinationName = "대전 " + destinationName;
  }

  /*
   * 카카오맵 공식 링크 형식:
   * /link/to/이름,위도,경도
   * 모바일에서는 카카오맵 앱 연결을 지원하고,
   * 앱이 없거나 PC이면 카카오맵 웹으로 열립니다.
   */
  var url =
    "https://map.kakao.com/link/to/" +
    encodeURIComponent(destinationName) + "," +
    coords.lat + "," +
    coords.lng;

  window.open(url, "_blank", "noopener,noreferrer");
}


var roadviewInstance = null;
var currentRoadviewCoords = null;


function normalizeAngle(value) {
  var angle = Number(value || 0) % 360;
  return angle < -180 ? angle + 360 : (angle > 180 ? angle - 360 : angle);
}


function bearingBetween(fromPosition, toPosition) {
  if (!fromPosition || !toPosition) return 0;

  var lat1 = fromPosition.getLat() * Math.PI / 180;
  var lat2 = toPosition.getLat() * Math.PI / 180;
  var lngDiff = (toPosition.getLng() - fromPosition.getLng()) * Math.PI / 180;

  var y = Math.sin(lngDiff) * Math.cos(lat2);
  var x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lngDiff);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}


function updateRoadviewTargetPin() {
  var pin = document.getElementById("roadviewTargetPin");
  var pane = document.getElementById("roadviewPane");

  if (!pin || !pane || !roadviewTargetPosition || !roadviewCameraPosition) {
    if (pin) pin.classList.remove("visible");
    return;
  }

  var targetBearing = bearingBetween(
    roadviewCameraPosition,
    roadviewTargetPosition
  );

  /*
   * 카카오 로드뷰 pan과 목표 방위각의 차이를 이용해
   * 화면상 작은 핀의 가로 위치를 계산합니다.
   * 건물의 정확한 외곽선이 아니라 '이 방향의 매물'을 알려주는 표식입니다.
   */
  var difference = normalizeAngle(targetBearing - currentRoadviewPan);
  var halfVisibleAngle = 62;

  if (Math.abs(difference) > halfVisibleAngle) {
    pin.classList.remove("visible");
    return;
  }

  var xPercent = 50 + (difference / halfVisibleAngle) * 46;
  xPercent = Math.max(4, Math.min(96, xPercent));

  pin.style.left = xPercent + "%";
  pin.classList.add("visible");
}


function updateRoadviewDirection(pan) {
  currentRoadviewPan = Number(pan || 0);
  updateRoadviewTargetPin();
}


function updateRoadviewCameraPosition(position) {
  if (!position) return;

  roadviewCameraPosition = position;
  updateRoadviewTargetPin();
}


function setupRoadviewFullMap(targetPosition) {
  var mapContainer = document.getElementById("roadviewFullMap");

  if (!mapContainer) return;

  mapContainer.innerHTML = "";

  roadviewFullMap = new kakao.maps.Map(mapContainer, {
    center: targetPosition,
    level: 3
  });

  roadviewFullMapMarker = new kakao.maps.Marker({
    map: roadviewFullMap,
    position: targetPosition
  });

  kakao.maps.event.addListener(roadviewFullMapMarker, "click", function() {
    switchRoadviewMode("roadview");
  });
}


function switchRoadviewMode(mode) {
  var roadviewPane = document.getElementById("roadviewPane");
  var mapPane = document.getElementById("roadviewMapPane");
  var roadviewButton = document.getElementById("roadviewTabBtn");
  var mapButton = document.getElementById("roadviewMapTabBtn");

  if (!roadviewPane || !mapPane || !roadviewButton || !mapButton) return;

  currentRoadviewMode = mode === "map" ? "map" : "roadview";
  var mapActive = currentRoadviewMode === "map";

  roadviewPane.classList.toggle("active", !mapActive);
  mapPane.classList.toggle("active", mapActive);
  roadviewButton.classList.toggle("active", !mapActive);
  mapButton.classList.toggle("active", mapActive);
  roadviewButton.setAttribute("aria-selected", mapActive ? "false" : "true");
  mapButton.setAttribute("aria-selected", mapActive ? "true" : "false");

  if (mapActive && roadviewFullMap && roadviewTargetPosition) {
    setTimeout(function() {
      roadviewFullMap.relayout();
      roadviewFullMap.setCenter(roadviewTargetPosition);
      roadviewFullMap.setLevel(3);
    }, 60);
  }

  if (!mapActive && roadviewInstance) {
    setTimeout(function() {
      if (typeof roadviewInstance.relayout === "function") {
        roadviewInstance.relayout();
      }
      updateRoadviewTargetPin();
    }, 60);
  }
}

function openKakaoRoadview(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var item = allItems.find(function(currentItem) {
    return currentItem.key === key;
  });

  if (!item) {
    alert("매물 정보를 찾지 못했습니다.");
    return;
  }

  var coords = getItemCoordinates(item);

  if (!coords) {
    alert("이 매물의 지도 좌표가 아직 준비되지 않았습니다.");
    return;
  }

  var modal = document.querySelector("#roadviewModal.roadview-modal");
  var container = document.getElementById("roadviewContainer");
  var title = document.getElementById("roadviewModalTitle");
  var address = document.getElementById("roadviewModalAddress");
  var status = document.getElementById("roadviewModalStatus");

  if (!modal || !container || !title || !address || !status) {
    alert("카카오 로드뷰 화면을 찾지 못했습니다.");
    return;
  }

  currentRoadviewItemKey = item.key;
  currentRoadviewCoords = coords;
  currentRoadviewPosition = new kakao.maps.LatLng(coords.lat, coords.lng);

  title.textContent = item.name || "카카오 로드뷰";
  address.textContent = [item.address || "", item.room || ""].filter(Boolean).join(" ");

  status.textContent = "가장 가까운 로드뷰를 찾고 있습니다.";
  status.className = "roadview-inline-status loading";

  container.innerHTML = "";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("roadview-modal-open");

  if (
    typeof kakao === "undefined" ||
    !kakao.maps ||
    !kakao.maps.Roadview ||
    !kakao.maps.RoadviewClient
  ) {
    status.textContent = "카카오 지도 SDK를 불러오지 못했습니다.";
    status.className = "roadview-inline-status error";
    return;
  }

  roadviewTargetPosition = currentRoadviewPosition;
  roadviewCameraPosition = currentRoadviewPosition;
  currentRoadviewPan = 0;
  currentRoadviewMode = "roadview";
  switchRoadviewMode("roadview");
  setupRoadviewFullMap(currentRoadviewPosition);

  var roadviewClient = new kakao.maps.RoadviewClient();

  roadviewClient.getNearestPanoId(currentRoadviewPosition, 150, function(panoId) {
    if (!modal.classList.contains("open")) return;

    if (!panoId) {
      status.textContent = "이 위치 반경 150m 안에서 로드뷰를 찾지 못했습니다.";
      status.className = "roadview-inline-status error";
      container.innerHTML =
        '<div class="roadview-empty">' +
          '<div class="roadview-empty-icon">🏠</div>' +
          '<div>주변 도로에 카카오 로드뷰가 없을 수 있습니다.</div>' +
        '</div>';
      return;
    }

    roadviewInstance = new kakao.maps.Roadview(container);
    roadviewInstance.setPanoId(panoId, currentRoadviewPosition);

    kakao.maps.event.addListener(roadviewInstance, "viewpoint_changed", function() {
      var viewpoint = roadviewInstance.getViewpoint();
      updateRoadviewDirection(viewpoint ? viewpoint.pan : 0);
    });

    /*
     * 로드뷰 안에서 이동할 때 실제 촬영 위치도 미니맵에 반영합니다.
     */
    kakao.maps.event.addListener(roadviewInstance, "position_changed", function() {
      var position = roadviewInstance.getPosition();
      updateRoadviewCameraPosition(position);
    });

    /*
     * 최초 로드뷰 위치를 목표 매물 위치와 분리하여 표시합니다.
     */
    kakao.maps.event.addListener(roadviewInstance, "init", function() {
      var position = roadviewInstance.getPosition();
      var viewpoint = roadviewInstance.getViewpoint();

      updateRoadviewCameraPosition(position);
      updateRoadviewDirection(viewpoint ? viewpoint.pan : 0);
    });

    status.textContent = "로드뷰 연결 완료";
    status.className = "roadview-inline-status success";

    setTimeout(function() {
      status.classList.add("hidden");
    }, 900);

    setTimeout(function() {
      if (roadviewInstance && typeof roadviewInstance.relayout === "function") {
        roadviewInstance.relayout();
      }
      updateRoadviewTargetPin();
    }, 100);
  });
}

function closeRoadviewModal() {
  var modal = document.querySelector("#roadviewModal.roadview-modal");
  var container = document.getElementById("roadviewContainer");

  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("roadview-modal-open");

  if (container) {
    container.innerHTML = "";
  }

  roadviewInstance = null;
  roadviewFullMap = null;
  roadviewFullMapMarker = null;
  roadviewTargetPosition = null;
  roadviewCameraPosition = null;
  currentRoadviewPan = 0;
  currentRoadviewMode = "roadview";
  currentRoadviewItemKey = null;
  currentRoadviewCoords = null;
  currentRoadviewPosition = null;
}


document.addEventListener("keydown", function(event) {
  if (event.key === "Escape") {
    var modal = document.querySelector("#roadviewModal.roadview-modal");

    if (modal && modal.classList.contains("open")) {
      closeRoadviewModal();
    }
  }
});


function formatListRegistrationDate(value) {
  var text = String(value || "").trim();

  if (!text) return "";

  var match = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);

  if (match) {
    return match[1].slice(2) + "." +
      String(match[2]).padStart(2, "0") + "." +
      String(match[3]).padStart(2, "0");
  }

  return text;
}


function toggleItemMemo(encodedKey) {
  var key = decodeURIComponent(encodedKey);

  openMemoKey = openMemoKey === key ? null : key;
  editingMemoKey = null;
  showList(visibleListItems);
}


function beginMemoEdit(encodedKey) {
  editingMemoKey = decodeURIComponent(encodedKey);
  memoEditMode = "replace";
  openMemoKey = editingMemoKey;
  showList(visibleListItems);

  requestAnimationFrame(function() {
    var editor = document.querySelector('[data-memo-editor-key="' + CSS.escape(editingMemoKey) + '"]');

    if (editor) {
      editor.focus();
      editor.style.height = "auto";
      editor.style.height = editor.scrollHeight + "px";
    }
  });
}


function beginMemoAdd(encodedKey) {
  editingMemoKey = decodeURIComponent(encodedKey);
  memoEditMode = "append";
  openMemoKey = editingMemoKey;
  showList(visibleListItems);

  requestAnimationFrame(function() {
    var editor = document.querySelector(
      '[data-memo-editor-key="' + CSS.escape(editingMemoKey) + '"]'
    );

    if (editor) {
      editor.value = "";
      editor.placeholder = "추가할 메모를 입력하세요.";
      editor.focus();
      autoResizeMemoEditor(editor);
    }
  });
}


function memoDateLabel() {
  var today = new Date();

  return [
    String(today.getFullYear()).slice(2),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join(".");
}


function cancelMemoEdit() {
  editingMemoKey = null;
  memoEditMode = "replace";
  showList(visibleListItems);
}


function autoResizeMemoEditor(element) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = element.scrollHeight + "px";
}


function saveItemMemo(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var item = allItems.find(function(currentItem) {
    return currentItem.key === key;
  });

  var editor = document.querySelector('[data-memo-editor-key="' + CSS.escape(key) + '"]');

  if (!item || !editor) {
    alert("메모 수정 대상을 찾지 못했습니다.");
    return;
  }

  if (!saveApiURL) {
    alert("구글시트 쓰기 연결 URL을 확인해주세요.");
    return;
  }

  var enteredMemo = editor.value.trim();
  var previousMemo = item.memo || "";
  var newMemo = enteredMemo;

  if (memoEditMode === "append") {
    if (!enteredMemo) {
      alert("추가할 메모를 입력해주세요.");
      return;
    }

    var addedLine = "[" + memoDateLabel() + "] " + enteredMemo;
    newMemo = previousMemo
      ? previousMemo.replace(/\s+$/, "") + "\n" + addedLine
      : addedLine;
  }
  var saveButton = document.querySelector('[data-memo-save-key="' + CSS.escape(key) + '"]');

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "저장중";
  }

  item.memo = newMemo;
  editingMemoKey = null;
  memoEditMode = "replace";
  showList(visibleListItems);

  var payload = {
    action: "toggleDone",
    key: {
      name: item.name || "",
      address: item.address || "",
      room: item.room || "",
      type: item.type || ""
    },
    state: item.state || "",
    memo: newMemo
  };

  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  }).then(function() {
    document.getElementById("status").innerHTML = "메모 저장 요청 완료";

    setTimeout(function() {
      loadSheet(true);
    }, 1800);
  }).catch(function(error) {
    console.error(error);
    item.memo = previousMemo;
    editingMemoKey = key;
    memoEditMode = "replace";
    showList(visibleListItems);
    alert("메모 저장 중 오류가 발생했습니다.");
  });
}


function addListItem(item) {
  var div = document.createElement("div");
  var printSelected = selectedPrintKeys.includes(item.key);
  var memoOpen = openMemoKey === item.key;
  var memoEditing = editingMemoKey === item.key;

  div.className =
    "item" +
    (selectedItemKey === item.key ? " selected" : "") +
    (isDone(item) ? " done" : "") +
    (printSelected ? " print-selected" : "") +
    (memoOpen ? " memo-open" : "");

  var doneLabel = isDone(item)
    ? '<span class="done-badge">계약완료</span>'
    : "";

  var typeLabel = item.type
    ? '<span class="type-badge">' + escapeHtml(item.type) + '</span>'
    : "";

  var sourceLabel = isFieldVisitItem(item)
    ? '<span class="gongsil-source-badge">임장가자</span>'
    : "";

  var encodedKey = encodeURIComponent(item.key);
  var safeKey = escapeHtml(item.key);
  var pyeongMiniBadge = buildPyeongMiniBadge(item);
  var regDateLabel = formatListRegistrationDate(item.regDate);

  var memoPanel = "";

  if (memoOpen) {
    if (memoEditing) {
      memoPanel =
        '<div class="item-memo-panel editing" onclick="event.stopPropagation()">' +
          '<textarea class="item-memo-editor" data-memo-editor-key="' + safeKey + '" ' +
            'oninput="autoResizeMemoEditor(this)">' +
            (memoEditMode === "append" ? "" : escapeHtml(item.memo || "")) +
          '</textarea>' +
          '<div class="item-memo-actions">' +
            '<button type="button" class="memo-save-btn" data-memo-save-key="' + safeKey + '" ' +
              'onclick="saveItemMemo(\'' + encodedKey + '\')">저장</button>' +
            '<button type="button" class="memo-cancel-btn" onclick="cancelMemoEdit()">취소</button>' +
          '</div>' +
        '</div>';
    } else {
      memoPanel =
        '<div class="item-memo-panel" onclick="event.stopPropagation()">' +
          '<div class="item-memo-content">' +
            (item.memo ? escapeHtml(item.memo) : '<span class="memo-empty">메모가 없습니다.</span>') +
          '</div>' +
          '<div class="item-memo-actions">' +
            '<button type="button" class="memo-edit-btn" onclick="beginMemoEdit(\'' + encodedKey + '\')">수정</button>' +
            '<button type="button" class="memo-add-btn" onclick="beginMemoAdd(\'' + encodedKey + '\')">추가하기</button>' +
          '</div>' +
        '</div>';
    }
  }

  div.innerHTML =
    '<div class="item-action-row">' +
      '<div class="item-action-left">' +
        '<label class="item-action-select" title="이 매물을 작업 대상으로 선택">' +
          '<input type="checkbox" class="action-select-check" ' +
            (printSelected ? 'checked' : '') +
            ' onclick="event.stopPropagation(); togglePrintSelection(\'' + encodedKey + '\')">' +
        '</label>' +
        '<button type="button" class="item-nav-btn" title="카카오맵 길찾기" ' +
          'onclick="event.stopPropagation(); openKakaoNavigation(\'' + encodedKey + '\')">내비</button>' +
        '<button type="button" class="item-roadview-btn" title="카카오 로드뷰" ' +
          'onclick="event.stopPropagation(); openKakaoRoadview(\'' + encodedKey + '\')">로드뷰</button>' +
        '<button type="button" class="item-list-add-btn favorite" ' +
          'onclick="event.stopPropagation(); openItemListPicker(\'favorite\',\'' + encodedKey + '\')">찜추가</button>' +
        '<button type="button" class="item-list-add-btn visit" ' +
          'onclick="event.stopPropagation(); openItemListPicker(\'visit\',\'' + encodedKey + '\')">임장추가</button>' +
      '</div>' +
      '<button type="button" class="item-memo-toggle ' + (memoOpen ? 'on' : '') + '" ' +
        'onclick="event.stopPropagation(); toggleItemMemo(\'' + encodedKey + '\')">' +
        (memoOpen ? '메모 ▲' : '메모 ▼') +
      '</button>' +
    '</div>' +

    '<div class="item-identity-row">' +
      doneLabel +
      sourceLabel +
      pyeongMiniBadge +
      typeLabel +
      '<span class="item-building-name">' + escapeHtml(item.name) + '</span>' +
    '</div>' +

    '<div class="item-address-room">' +
      '<span class="item-address-inline">' +
        '<span class="item-address-text">' + escapeHtml(item.address) + '</span>' +
        (item.room
          ? '<span class="item-room-badge">' + escapeHtml(item.room) + '</span>'
          : '') +
      '</span>' +
    '</div>' +

    '<div class="price-line">' +
      '<span class="price-main">보증금 ' + escapeHtml(item.deposit) + ' / 월세 ' + escapeHtml(item.rent) + '</span>' +
      '<span class="price-separator">·</span>' +
      '<span class="price-fee">관리비 ' + escapeHtml(item.fee) + '</span>' +
      '<span class="price-separator">·</span>' +
      '<span class="price-premium">권리금 ' + escapeHtml(item.premium) + '</span>' +
      '<span class="price-separator">·</span>' +
      '<span class="price-area">' + escapeHtml(item.area) + '평</span>' +
    '</div>' +

    '<div class="item-contact-date-row">' +
      '<div class="info-line-compact">임대인 ' +
        escapeHtml(item.landlordPhone) +
        ' | 세입자 ' +
        escapeHtml(item.tenantPhone) +
      '</div>' +
      (regDateLabel
        ? '<div class="item-reg-date">등록 ' + escapeHtml(regDateLabel) + '</div>'
        : '') +
    '</div>' +

    memoPanel;

  div.onclick = function() {
    openItem(item);
  };

  document.getElementById("list").appendChild(div);

  if (memoEditing) {
    requestAnimationFrame(function() {
      var editor = div.querySelector(".item-memo-editor");

      if (editor) {
        autoResizeMemoEditor(editor);
      }
    });
  }
}


/* === v3.0.6.1 수정: AI 스마트 매물카드 안정판 === */


/* === v3.0.9 추가: AI 협상/현장체크 로직 === */


/* === v3.0.10 추가: 업종별 적합도 로직 === */


/* === v3.1.0 추가: AI 시장분석 엔진 1단계 === */


function percentDiff(current, avg) {
  current = Number(current) || 0;
  avg = Number(avg) || 0;
  if (!current || !avg) return 0;
  return Math.round(((current - avg) / avg) * 1000) / 10;
}


/* === v3.1.1 추가: 카카오 Places 기반 AI 상권분석 1단계 === */
var commercialRadius = 300;
var commercialAnalysisCache = {};

var commercialSearchGroups = [
  { group:"생활", items:[
    { key:"convenience", label:"편의점", keyword:"편의점" },
    { key:"cafe", label:"카페", keyword:"카페" },
    { key:"bank", label:"은행", keyword:"은행" },
    { key:"bus", label:"버스정류장", keyword:"버스정류장" },
    { key:"laundry", label:"세탁소", keyword:"세탁소" },
    { key:"coinLaundry", label:"빨래방", keyword:"빨래방" },
    { key:"post", label:"우체국", keyword:"우체국" }
  ]},
  { group:"음식", items:[
    { key:"korean", label:"한식", keyword:"한식" },
    { key:"chinese", label:"중식", keyword:"중국집" },
    { key:"japanese", label:"일식", keyword:"일식" },
    { key:"snack", label:"분식", keyword:"분식" },
    { key:"chicken", label:"치킨", keyword:"치킨" },
    { key:"pizza", label:"피자", keyword:"피자" },
    { key:"burger", label:"햄버거", keyword:"햄버거" },
    { key:"beer", label:"호프", keyword:"호프" },
    { key:"meat", label:"고깃집", keyword:"고기집" },
    { key:"gukbap", label:"국밥", keyword:"국밥" },
    { key:"bakery", label:"베이커리", keyword:"베이커리" },
    { key:"dessert", label:"디저트", keyword:"디저트" }
  ]},
  { group:"뷰티", items:[
    { key:"hair", label:"미용실", keyword:"미용실" },
    { key:"nail", label:"네일", keyword:"네일" },
    { key:"eyelash", label:"속눈썹", keyword:"속눈썹" },
    { key:"skin", label:"피부샵", keyword:"피부관리" },
    { key:"waxing", label:"왁싱", keyword:"왁싱" },
    { key:"massage", label:"마사지", keyword:"마사지" },
    { key:"makeup", label:"메이크업", keyword:"메이크업" }
  ]},
  { group:"교육/의료", items:[
    { key:"academy", label:"학원", keyword:"학원" },
    { key:"english", label:"영어학원", keyword:"영어학원" },
    { key:"math", label:"수학학원", keyword:"수학학원" },
    { key:"taekwondo", label:"태권도", keyword:"태권도" },
    { key:"piano", label:"피아노", keyword:"피아노학원" },
    { key:"art", label:"미술", keyword:"미술학원" },
    { key:"study", label:"독서실", keyword:"독서실" },
    { key:"hospital", label:"병원", keyword:"병원" },
    { key:"dental", label:"치과", keyword:"치과" },
    { key:"pharmacy", label:"약국", keyword:"약국" },
    { key:"oriental", label:"한의원", keyword:"한의원" }
  ]}
];


function buildRadiusTabs() {
  var radiuses = [50, 100, 200, 300, 500];
  return '<div class="ai-radius-tabs">' + radiuses.map(function(r) {
    return '<button class="ai-radius-btn ' + (commercialRadius === r ? 'on' : '') + '" onclick="event.stopPropagation(); setCommercialRadius(' + r + ')">' + r + 'm</button>';
  }).join("") + '</div>' +
  '<div class="ai-commerce-mode">50m=바로 옆 경쟁 / 100m=같은 블록 / 200m=도보권 / 300m=기본상권 / 500m=생활권</div>';
}


function getSelectedCommercialItem() {
  var key = window.selectedItemKey || selectedItemKey;
  if (!key) return null;
  return (allItems || []).find(function(item) { return item.key === key; }) || null;
}


function setCommercialRadius(radius) {
  commercialRadius = Number(radius) || 300;
  var item = getSelectedCommercialItem();
  if (item) loadCommercialAreaAnalysis(item);
}


function commerceChipClass(key, count) {
  count = Number(count) || 0;
  if ((key === "convenience" || key === "nail" || key === "japanese" || key === "dessert") && count <= 1) return "good";
  if (count >= 15) return "danger";
  if (count >= 8) return "warn";
  return "";
}


function buildCommerceChips(analysis, groupName, limit) {
  if (!analysis || !analysis.groups || !analysis.groups[groupName]) return "";
  var keys = analysis.groups[groupName].slice();
  keys.sort(function(a, b) {
    return commercialCount(analysis.counts, b) - commercialCount(analysis.counts, a);
  });
  if (limit) keys = keys.slice(0, limit);
  return keys.map(function(key) {
    var count = commercialCount(analysis.counts, key);
    var label = analysis.labels[key] || key;
    return '<span class="ai-commerce-chip ' + commerceChipClass(key, count) + '">' + escapeHtml(label) + ' <b>' + count + '</b></span>';
  }).join("");
}


function buildOpportunityHtml(analysis) {
  if (!analysis || !analysis.available) return "";

  var blue = (analysis.blueOceans || []).slice(0, 3).map(function(x) {
    return '<span class="ai-opportunity-pill">' + escapeHtml(x.name) + ' ' + x.count + '</span>';
  }).join("") || '<span class="ai-opportunity-desc">뚜렷한 공백 업종 없음</span>';

  var hot = (analysis.saturated || []).slice(0, 3).map(function(x) {
    return '<span class="ai-opportunity-pill hot">' + escapeHtml(x.name) + ' ' + x.count + '</span>';
  }).join("") || '<span class="ai-opportunity-desc">과밀 업종 낮음</span>';

  return '' +
    '<div class="ai-opportunity-panel">' +
      '<div class="ai-opportunity-card score">' +
        '<div class="ai-opportunity-head">예상 성공가능성</div>' +
        '<div class="ai-opportunity-main">' + (analysis.successScore || '-') + '점 · ' + escapeHtml(analysis.successLabel || '보통') + '</div>' +
        '<div class="ai-opportunity-desc">경쟁도·생활수요·음식/교육/의료 밀집도를 종합한 내부 적합도 점수입니다.</div>' +
      '</div>' +
      '<div class="ai-opportunity-card blue">' +
        '<div class="ai-opportunity-head">블루오션 후보</div>' +
        '<div class="ai-opportunity-list">' + blue + '</div>' +
      '</div>' +
      '<div class="ai-opportunity-card hot">' +
        '<div class="ai-opportunity-head">포화주의 업종</div>' +
        '<div class="ai-opportunity-list">' + hot + '</div>' +
      '</div>' +
    '</div>';
}


function resetFilter() {
  document.getElementById("keyword").value = "";
  document.getElementById("typeFilter").value = "";
  document.getElementById("sortFilter").value = "latest";
  updateSortDropdownUI();
  document.getElementById("minDeposit").value = "";
  document.getElementById("maxDeposit").value = "";
  document.getElementById("minRent").value = "";
  document.getElementById("maxRent").value = "";
  document.getElementById("minArea").value = "";
  document.getElementById("maxArea").value = "";
  document.getElementById("minFloor").value = "";
  document.getElementById("maxFloor").value = "";
  var industryInput = document.getElementById("industryFilter");
  if (industryInput) industryInput.value = "";

  favoriteOnly = false;
  hideDone = true;
  gongsilOnly = false;
  multiClusterMode = false;
  selectedGroupKeys = [];
  document.getElementById("favoriteBtn").innerText = "찜목록";
  document.getElementById("favoriteBtn").classList.remove("on");
  updateHideDoneMenuUI();
  document.getElementById("gongsilOnlyBtn").innerText = "임장할매물만보기";
  document.getElementById("gongsilOnlyBtn").classList.remove("on");
  updateMultiClusterButton();
  updateMultiClusterStatus();
  selectedGroupKey = null;
  selectedItemKey = null;

  applyFilter();
}


/* =========================================================
   v4.4 거래완료 원클릭 토글
   - 화면 즉시 반영
   - 상태 열: 계약완료 / 공란
   - 메모 열: 거래완료 날짜 자동 기록
   - 구글시트 Apps Script로 기존 행 수정
   ========================================================= */
function getItemByKeyForStatus(key) {
  return (allItems || []).find(function(item) {
    return item.key === key;
  }) || (visibleListItems || []).find(function(item) {
    return item.key === key;
  }) || null;
}


function makeDoneMemo(memo, checked) {
  var text = String(memo || "").trim();
  var markerPattern = /(?:\s*\/\s*)?\[거래완료\s+\d{4}-\d{2}-\d{2}\]/g;

  // 체크 해제 시 자동으로 넣었던 거래완료 표시 제거
  if (!checked) {
    return text.replace(markerPattern, "").replace(/\s*\/\s*$/, "").trim();
  }

  // 이미 거래완료 표시가 있으면 중복 추가하지 않음
  if (/\[거래완료\s+\d{4}-\d{2}-\d{2}\]/.test(text)) {
    return text;
  }

  var today = new Date();
  var yyyy = today.getFullYear();
  var mm = String(today.getMonth() + 1).padStart(2, "0");
  var dd = String(today.getDate()).padStart(2, "0");
  var marker = "[거래완료 " + yyyy + "-" + mm + "-" + dd + "]";

  return text ? text + " / " + marker : marker;
}


function restoreListScrollAfterRender(scrollTop) {
  requestAnimationFrame(function() {
    var sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.scrollTop = scrollTop;
  });
}


function refreshDoneStatusUI(keepScroll) {
  var sidebar = document.getElementById("sidebar");
  var scrollTop = keepScroll && sidebar ? sidebar.scrollTop : 0;

  if (typeof applyFilter === "function") {
    applyFilter();
  } else {
    redrawSelectedMarkers();
    showList(visibleListItems);
  }

  restoreListScrollAfterRender(scrollTop);
}


function toggleDoneStatus(encodedKey, checked) {
  var key = decodeURIComponent(encodedKey || "");
  var item = getItemByKeyForStatus(key);

  if (!item) {
    alert("거래완료 상태를 변경할 매물을 찾지 못했습니다.");
    return;
  }

  if (!saveApiURL) {
    alert(
      "구글시트 자동수정 URL이 아직 연결되지 않았습니다.\n\n" +
      "구글시트 쓰기 연결 URL을 확인해주세요."
    );
    showList(visibleListItems);
    return;
  }

  if (doneTogglePendingKeys[key]) return;

  var previousState = item.state || "";
  var previousMemo = item.memo || "";
  var nextState = checked ? "계약완료" : "";
  var nextMemo = makeDoneMemo(previousMemo, checked);

  doneTogglePendingKeys[key] = true;

  // 먼저 화면에 즉시 반영
  item.state = nextState;
  item.memo = nextMemo;
  refreshDoneStatusUI(true);

  var payload = {
    action: "toggleDone",
    key: {
      name: item.name || "",
      address: item.address || "",
      room: item.room || "",
      type: item.type || ""
    },
    state: nextState,
    memo: nextMemo
  };

  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  }).then(function() {
    delete doneTogglePendingKeys[key];
    refreshDoneStatusUI(true);

    document.getElementById("status").innerHTML =
      checked ? "거래완료 저장 요청 완료" : "계약가능 복구 요청 완료";

    // 시트 반영값을 다시 읽어 실제 저장 상태를 확인
    setTimeout(function() {
      loadSheet(true);
    }, 1800);
  }).catch(function(error) {
    console.error(error);

    // 저장 요청 자체가 실패한 경우 화면도 원상복구
    item.state = previousState;
    item.memo = previousMemo;
    delete doneTogglePendingKeys[key];
    refreshDoneStatusUI(true);

    alert("거래완료 상태 저장 중 오류가 발생했습니다.");
  });
}


function togglePrintSelection(encodedKey) {
  var key = decodeURIComponent(encodedKey);

  if (selectedPrintKeys.includes(key)) {
    selectedPrintKeys = selectedPrintKeys.filter(function(k) { return k !== key; });
  } else {
    selectedPrintKeys.push(key);
  }

  showList(visibleListItems);
}


function selectAllVisibleItems() {
  visibleListItems.forEach(function(item) {
    if (!selectedPrintKeys.includes(item.key)) {
      selectedPrintKeys.push(item.key);
    }
  });

  showList(visibleListItems);
}


function clearSelectedPrintItems() {
  selectedPrintKeys = [];
  showList(visibleListItems);
}

function toggleVisibleSelection(shouldSelect) {
  if (shouldSelect) {
    selectAllVisibleItems();
  } else {
    clearSelectedPrintItems();
  }
}

function syncListMasterCheckbox() {
  var checkbox = document.getElementById("listMasterCheckbox");
  if (!checkbox) return;

  var visibleKeys = (visibleListItems || []).map(function(item) { return item.key; });
  var selectedCount = visibleKeys.filter(function(key) {
    return selectedPrintKeys.includes(key);
  }).length;

  checkbox.checked = visibleKeys.length > 0 && selectedCount === visibleKeys.length;
  checkbox.indeterminate = selectedCount > 0 && selectedCount < visibleKeys.length;

  var label = document.querySelector(".list-master-label");
  if (label) {
    label.textContent = selectedCount > 0 ? "선택 " + selectedCount : "전체";
  }
}


function updatePrintSelectedButton() {
  var printBtn = document.getElementById("printSelectedBtn");
  var completeBtn = document.getElementById("completeSelectedBtn");
  var fieldVisitBtn = document.getElementById("fieldVisitBtn");
  var count = selectedPrintKeys.length;

  if (printBtn) {
    printBtn.innerText = count > 0 ? "선택인쇄 " + count : "선택인쇄";
    printBtn.disabled = count === 0;
  }

  if (completeBtn) {
    completeBtn.innerText = count > 0 ? "계약완료 " + count : "계약완료";
    completeBtn.disabled = count === 0;
  }

  if (fieldVisitBtn) {
    fieldVisitBtn.innerText = count > 0 ? "임장완료 " + count : "임장완료";
    fieldVisitBtn.disabled = count === 0;
  }
}


function removeFieldVisitMarkerFromMemo(memo) {
  var text = String(memo || "");

  text = text
    .replace(/\(\s*임장가자\s*\)/gi, "")
    .replace(/\(\s*공실박스\s*\)/gi, "")
    .replace(/\s*\/\s*\/\s*/g, " / ")
    .replace(/^\s*\/\s*/, "")
    .replace(/\s*\/\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}


function removeGongsilBoxMarkerFromMemo(memo) {
  return removeFieldVisitMarkerFromMemo(memo);
}

function markSelectedAsVisited() {
  if (!selectedPrintKeys.length) {
    alert("임장 처리할 매물을 선택해주세요.");
    return;
  }

  if (!saveApiURL) {
    alert("구글시트 자동수정 URL이 아직 연결되지 않았습니다.");
    return;
  }

  var selectedItems = getSelectedPrintItems();
  var targetItems = selectedItems.filter(function(item) {
    return isFieldVisitItem(item);
  });

  if (!targetItems.length) {
    alert("선택한 매물 중 (임장가자) 매물이 없습니다.");
    return;
  }

  var skippedCount = selectedItems.length - targetItems.length;

  var confirmText = targetItems.length === 1
    ? "임장을 완료할까요?"
    : "선택한 " + targetItems.length + "개 매물의 임장을 완료할까요?";

  if (skippedCount > 0) {
    confirmText += "\n임장 대상이 아닌 " + skippedCount + "개 매물은 제외됩니다.";
  }

  if (!confirm(confirmText)) return;

  var sidebar = document.getElementById("sidebar");
  var scrollTop = sidebar ? sidebar.scrollTop : 0;
  var previousValues = {};

  targetItems.forEach(function(item) {
    previousValues[item.key] = item.memo || "";
    doneTogglePendingKeys[item.key] = true;
    item.memo = removeFieldVisitMarkerFromMemo(item.memo || "");
  });

  refreshDoneStatusUI(true);
  document.getElementById("status").innerHTML =
    "임장 처리 " + targetItems.length + "개 저장중...";

  var requests = targetItems.map(function(item) {
    var payload = {
      /*
       * 기존 Apps Script의 toggleDone 수정 기능을 재사용합니다.
       * 상태는 그대로 두고 메모만 최신값으로 저장합니다.
       */
      action: "toggleDone",
      key: {
        name: item.name || "",
        address: item.address || "",
        room: item.room || "",
        type: item.type || ""
      },
      state: item.state || "",
      memo: item.memo || ""
    };

    return fetch(saveApiURL, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });
  });

  Promise.all(requests).then(function() {
    targetItems.forEach(function(item) {
      delete doneTogglePendingKeys[item.key];
    });

    selectedPrintKeys = [];
    refreshDoneStatusUI(true);

    requestAnimationFrame(function() {
      if (sidebar) sidebar.scrollTop = scrollTop;
    });

    document.getElementById("status").innerHTML =
      "임장 처리 " + targetItems.length + "개 저장 요청 완료";

    setTimeout(function() {
      loadSheet(true);
    }, 1800);
  }).catch(function(error) {
    console.error(error);

    targetItems.forEach(function(item) {
      item.memo = previousValues[item.key] || "";
      delete doneTogglePendingKeys[item.key];
    });

    refreshDoneStatusUI(true);
    alert("임장 처리 저장 중 오류가 발생했습니다.");
  });
}


function completeSelectedItems() {
  var selectedItems = getSelectedPrintItems().filter(function(item) {
    return !isDone(item);
  });

  if (!selectedPrintKeys.length) {
    alert("완료 처리할 매물을 선택해주세요.");
    return;
  }

  if (!selectedItems.length) {
    alert("선택한 매물은 이미 모두 거래완료 상태입니다.");
    return;
  }

  if (!saveApiURL) {
    alert("구글시트 자동수정 URL이 아직 연결되지 않았습니다.");
    return;
  }

  if (!confirm(selectedItems.length === 1 ? "정말 거래완료 하시겠습니까?" : "선택한 " + selectedItems.length + "개 매물을 정말 거래완료 하시겠습니까?")) {
    return;
  }

  var sidebar = document.getElementById("sidebar");
  var scrollTop = sidebar ? sidebar.scrollTop : 0;

  selectedItems.forEach(function(item) {
    doneTogglePendingKeys[item.key] = true;
    item.state = "계약완료";
    item.memo = makeDoneMemo(item.memo || "", true);
  });

  refreshDoneStatusUI(true);
  document.getElementById("status").innerHTML =
    "선택 매물 " + selectedItems.length + "개 완료 저장중...";

  var requests = selectedItems.map(function(item) {
    var payload = {
      action: "toggleDone",
      key: {
        name: item.name || "",
        address: item.address || "",
        room: item.room || "",
        type: item.type || ""
      },
      state: "계약완료",
      memo: item.memo || ""
    };

    return fetch(saveApiURL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  });

  Promise.all(requests).then(function() {
    selectedItems.forEach(function(item) {
      delete doneTogglePendingKeys[item.key];
    });

    selectedPrintKeys = [];
    refreshDoneStatusUI(true);

    requestAnimationFrame(function() {
      if (sidebar) sidebar.scrollTop = scrollTop;
    });

    document.getElementById("status").innerHTML =
      "선택 매물 " + selectedItems.length + "개 거래완료 요청 완료";

    setTimeout(function() {
      loadSheet(true);
    }, 1800);
  }).catch(function(error) {
    console.error(error);

    selectedItems.forEach(function(item) {
      delete doneTogglePendingKeys[item.key];
    });

    refreshDoneStatusUI(true);
    alert("선택 매물 완료 저장 중 오류가 발생했습니다.");
  });
}


function getSelectedPrintItems() {
  return allItems.filter(function(item) {
    return selectedPrintKeys.includes(item.key);
  });
}


function toggleGongsilOnly() {
  gongsilOnly = !gongsilOnly;

  var btn = document.getElementById("gongsilOnlyBtn");

  if (gongsilOnly) {
    btn.innerText = "전체보기";
    btn.classList.add("on");
  } else {
    btn.innerText = "임장가자";
    btn.classList.remove("on");
  }

  selectedGroupKey = null;
  selectedItemKey = null;
  applyFilter();
}


function toggleMultiClusterMode() {
  multiClusterMode = !multiClusterMode;

  /*
   * 모드를 끄면 누적 선택을 모두 해제하고 일반 조회로 복귀합니다.
   */
  if (!multiClusterMode) {
    selectedGroupKeys = [];
    selectedGroupKey = null;
    selectedItemKey = null;
    applyFilter();
  }

  updateMultiClusterButton();
  updateMultiClusterStatus();

  if (typeof redrawSelectedMarkers === "function") {
    redrawSelectedMarkers();
  }
}


function updateMultiClusterButton() {
  var btn = document.getElementById("multiClusterBtn");
  if (!btn) return;

  btn.innerHTML = multiClusterMode
    ? "<span>다중해제</span>"
    : "<span>다중선택</span>";

  btn.classList.toggle("on", multiClusterMode);
}


function updateMultiClusterStatus() {
  var status = document.getElementById("multiClusterStatus");
  if (!status) return;

  if (!multiClusterMode || !selectedGroupKeys.length) {
    status.innerHTML = "";
    status.classList.remove("show");
    return;
  }

  var selectedItems = [];
  var seen = {};

  overlays.forEach(function(overlay) {
    if (!overlay.__cluster || !selectedGroupKeys.includes(overlay.__cluster.key)) return;

    overlay.__cluster.items.forEach(function(item) {
      if (!seen[item.key]) {
        seen[item.key] = true;
        selectedItems.push(item);
      }
    });
  });

  status.innerHTML =
    "선택 " + selectedGroupKeys.length + "개 클러스터 · 매물 " + selectedItems.length + "개";
  status.classList.add("show");
}


function isClusterSelected(clusterKey) {
  if (multiClusterMode) {
    return selectedGroupKeys.includes(clusterKey);
  }

  return selectedGroupKey === clusterKey;
}


function copyCurrentAIAnalysis() {
  if (!selectedItemKey) {
    alert("먼저 AI 분석할 매물을 선택해주세요.");
    return;
  }

  if (typeof copySmartItemAnalysis === "function") {
    copySmartItemAnalysis(encodeURIComponent(selectedItemKey));
    return;
  }

  alert("분석복사 기능을 찾지 못했습니다.");
}


function printCurrentAIReport() {
  if (!selectedItemKey) {
    alert("먼저 AI 분석할 매물을 선택해주세요.");
    return;
  }

  if (typeof printAIInvestmentReport === "function") {
    printAIInvestmentReport();
    return;
  }

  if (typeof printAiInvestmentReport === "function") {
    printAiInvestmentReport(encodeURIComponent(selectedItemKey));
    return;
  }

  alert("AI 리포트 인쇄 기능을 찾지 못했습니다.");
}


function updateSyncIndicatorFromStatus() {
  var statusBox = document.getElementById("status");
  var indicator = document.getElementById("syncIndicator");

  if (!statusBox || !indicator) return;

  var text = String(statusBox.textContent || "").trim();

  indicator.classList.remove("syncing", "ok", "error");

  if (/오류|실패/.test(text)) {
    indicator.classList.add("error");
    indicator.title = text || "동기화 오류";
  } else if (/로딩|불러오|변환중|업데이트중|저장중|대기/.test(text)) {
    indicator.classList.add("syncing");
    indicator.title = text || "동기화 중";
  } else {
    indicator.classList.add("ok");
    indicator.title = text || "동기화 정상";
  }
}


function initSyncIndicator() {
  var statusBox = document.getElementById("status");

  if (!statusBox || typeof MutationObserver === "undefined") {
    return;
  }

  updateSyncIndicatorFromStatus();

  var observer = new MutationObserver(function() {
    updateSyncIndicatorFromStatus();
  });

  observer.observe(statusBox, {
    childList: true,
    subtree: true,
    characterData: true
  });
}


setTimeout(initSyncIndicator, 0);


function updateHideDoneMenuUI() {
  var btn = document.getElementById("hideDoneBtn");
  if (!btn) return;

  btn.classList.toggle("on", !!hideDone);
  btn.setAttribute("aria-checked", hideDone ? "true" : "false");

  var check = btn.querySelector(".view-toggle-check");
  if (check) check.textContent = hideDone ? "✓" : "";
}

function toggleHideDone() {
  hideDone = !hideDone;
  updateHideDoneMenuUI();
  selectedGroupKey = null;
  selectedItemKey = null;
  applyFilter();
}


function updateErrorStatus() {
  var errorBox = document.getElementById("errorStatus");

  if (!errorBox) return;

  if (errorItems.length > 0) {
    errorBox.style.display = "block";
    errorBox.innerHTML = "주소 오류 " + errorItems.length + "개";
  } else {
    errorBox.style.display = "none";
  }
}


function showAddressErrors() {
  if (!errorItems || errorItems.length === 0) return;

  var lines = errorItems.map(function(item, index) {
    return (index + 1) + ". " + item.name + " / " + item.address + " / " + item.room;
  });

  alert("지도에 표시되지 않은 주소 오류 매물입니다.\\n\\n" + lines.join("\\n"));
}


/* === JS부동산 AI 등록 v2.0 오버라이드 === */


['qaName','qaAddress','qaRoom','qaType','qaDeposit','qaRent','qaFee','qaPremium','qaArea','qaLandlordPhone','qaTenantPhone','qaMemo','qaState','qaRegDate'].forEach(function(id) {
  setTimeout(function() {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', function() { updateQuickAddWarning(); updateQuickAddPreview(); });
    if (el) el.addEventListener('change', function() { updateQuickAddWarning(); updateQuickAddPreview(); });
  }, 500);
});



/* === JS부동산 AI Parser v1.0.1 최종 오버라이드: 권1000/보2000/월100 등 복붙 약어 인식 강화 === */


/* === v3.2.2.1 AI 투자리포트 A4 인쇄 수정본 === */


/* v6.1 기본 계약완료 숨김 UI 초기화 */
setTimeout(function() {
  hideDone = true;
  updateHideDoneMenuUI();
}, 0);
