/* JS부동산 공통 UI/리스트/필터 핵심 스크립트 */
var sheetURL = "/api/sheet";
var saveApiURL = "/api/apps-script"; // 로그인 세션을 검사하는 Vercel 보안 프록시

var map, geocoder;
var allItems = [];
var currentItems = [];
var overlays = [];
var selectedGroupKey = null;
var selectedItemKey = null;
var favoriteOnly = false;
var hideDone = true;
var gongsilOnly = false;
var todayNewOnly = false;
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
var sharedGeocodeCacheLoadPromise = null;
var sharedGeocodeCacheReady = false;
var pendingSharedGeocodeEntries = Object.create(null);
var sharedGeocodeFlushTimer = null;
var sharedGeocodeFlushInProgress = false;
var sharedGeocodeFlushFailures = 0;
var selectedPrintKeys = [];
var visibleListItems = [];
var listRenderLimit = 0;
var listRenderScrollBound = false;
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


function queueSharedGeocodeEntry(address, value) {
  var normalizedAddress = normalizeAddressForCache(address);
  var lat = Number(value && value.lat);
  var lng = Number(value && value.lng);

  if (!normalizedAddress || !isFinite(lat) || !isFinite(lng)) return;

  pendingSharedGeocodeEntries[normalizedAddress] = {
    address: normalizedAddress,
    lat: lat,
    lng: lng
  };

  scheduleSharedGeocodeFlush();
}


function scheduleSharedGeocodeFlush(delay) {
  if (!sharedGeocodeCacheReady || sharedGeocodeFlushInProgress) return;
  if (sharedGeocodeFlushTimer) clearTimeout(sharedGeocodeFlushTimer);

  sharedGeocodeFlushTimer = setTimeout(function() {
    sharedGeocodeFlushTimer = null;
    flushSharedGeocodeCache();
  }, Number(delay) || 800);
}


function flushSharedGeocodeCache() {
  if (!sharedGeocodeCacheReady || sharedGeocodeFlushInProgress) return;

  var keys = Object.keys(pendingSharedGeocodeEntries).slice(0, 500);
  if (!keys.length) return;

  var entries = keys.map(function(key) {
    return pendingSharedGeocodeEntries[key];
  });

  sharedGeocodeFlushInProgress = true;

  fetch(saveApiURL, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "saveGeocodeCache",
      entries: entries
    })
  })
    .then(function(response) {
      if (!response.ok) throw new Error("공용 좌표 캐시 저장 실패");
      return response.json();
    })
    .then(function(result) {
      if (!result || result.ok === false) {
        throw new Error((result && result.message) || "공용 좌표 캐시 저장 실패");
      }

      keys.forEach(function(key) {
        delete pendingSharedGeocodeEntries[key];
      });
      sharedGeocodeFlushFailures = 0;
    })
    .catch(function(error) {
      sharedGeocodeFlushFailures += 1;
      console.warn("공용 좌표 캐시 저장을 다음 접속 때 다시 시도합니다.", error);
    })
    .finally(function() {
      sharedGeocodeFlushInProgress = false;
      if (
        Object.keys(pendingSharedGeocodeEntries).length &&
        sharedGeocodeFlushFailures < 3
      ) {
        scheduleSharedGeocodeFlush(
          Math.min(12000, 1200 * Math.pow(2, sharedGeocodeFlushFailures))
        );
      }
    });
}


function loadSharedGeocodeCache() {
  if (sharedGeocodeCacheLoadPromise) return sharedGeocodeCacheLoadPromise;

  sharedGeocodeCacheLoadPromise = fetch(saveApiURL + "?action=geocodeCache", {
    credentials: "same-origin",
    cache: "no-store"
  })
    .then(function(response) {
      if (!response.ok) throw new Error("공용 좌표 캐시 조회 실패");
      return response.json();
    })
    .then(function(result) {
      if (!result || result.ok === false) {
        throw new Error((result && result.message) || "공용 좌표 캐시 조회 실패");
      }

      var sharedEntries = result.entries || {};
      var localEntries = Object.assign({}, geocodeCache || {});

      Object.keys(sharedEntries).forEach(function(address) {
        var normalizedAddress = normalizeAddressForCache(address);
        var entry = sharedEntries[address] || {};
        var lat = Number(entry.lat);
        var lng = Number(entry.lng);
        if (!normalizedAddress || !isFinite(lat) || !isFinite(lng)) return;

        geocodeCache[normalizedAddress] = {
          lat: lat,
          lng: lng,
          savedAt: entry.savedAt || "shared"
        };
        geocodeCacheDirty = true;
      });

      saveGeocodeCache();
      sharedGeocodeCacheReady = true;

      /* 기존 PC의 로컬 좌표를 최초 한 번 중앙 캐시에 올려 다른 기기와 공유합니다. */
      Object.keys(localEntries).forEach(function(address) {
        if (!sharedEntries[address]) {
          queueSharedGeocodeEntry(address, localEntries[address]);
        }
      });

      scheduleSharedGeocodeFlush();
      return result;
    })
    .catch(function(error) {
      /* 서버 캐시가 잠시 실패해도 기존 로컬 캐시와 카카오 주소검색으로 계속 동작합니다. */
      console.warn("공용 좌표 캐시를 불러오지 못해 로컬 좌표로 계속합니다.", error);
      sharedGeocodeCacheReady = false;
      return { ok: false, count: 0, entries: {} };
    });

  return sharedGeocodeCacheLoadPromise;
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
  var detailBtn = document.getElementById("detailBtn");

  if (!panel || !detailBtn) return;

  var viewportWidth = Math.max(
    Number(window.innerWidth) || 0,
    Number(document.documentElement && document.documentElement.clientWidth) || 0
  );
  var viewportHeight = Math.max(
    Number(window.innerHeight) || 0,
    Number(document.documentElement && document.documentElement.clientHeight) || 0
  );
  var btnRect = detailBtn.getBoundingClientRect();
  var margin = 12;
  var gap = 8;

  if (viewportWidth <= 768) {
    panel.style.left = "8px";
    panel.style.right = "8px";
    panel.style.top = Math.max(8, btnRect.bottom + 6) + "px";
    panel.style.width = "auto";
    return;
  }

  /*
   * 매물목록이 좌/우 어느 쪽에 있더라도 필터 버튼 자체를 기준으로 배치합니다.
   * 이전 코드는 사이드바 오른쪽 끝을 기준으로 계산해, 우측 사이드바에서는
   * 팝업이 매물목록 위에 붙는 문제가 있었습니다.
   */
  var panelWidth = Math.min(360, Math.max(300, viewportWidth - margin * 2));
  var left = Math.max(
    margin,
    Math.min(btnRect.left, viewportWidth - panelWidth - margin)
  );
  var top = btnRect.bottom + gap;

  panel.style.left = left + "px";
  panel.style.right = "auto";
  panel.style.width = panelWidth + "px";

  var panelHeight = Math.max(0, panel.offsetHeight || 0);
  if (panelHeight && top + panelHeight > viewportHeight - margin) {
    if (btnRect.top - panelHeight - gap >= margin) {
      top = btnRect.top - panelHeight - gap;
    } else {
      top = Math.max(margin, viewportHeight - panelHeight - margin);
    }
  }
  panel.style.top = Math.max(margin, top) + "px";
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
  var inputs = document.querySelectorAll("#keyword, #minDeposit, #maxDeposit, #minRent, #maxRent, #minPremium, #maxPremium, #minArea, #maxArea, #minFloor, #maxFloor");

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


function normalizeSearchComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}


function getSearchComparableFields(item) {
  return [
    item && item.name,
    item && item.address,
    item && item.room,
    item && item.type,
    item && item.memo
  ].map(function(value) {
    var text = String(value || "").toLowerCase();

    return {
      text: text,
      compact: normalizeSearchComparableText(text)
    };
  });
}


function parseExactJibunKeyword(value) {
  var compact = normalizeSearchComparableText(value);
  var match = compact.match(/([가-힣]+(?:동|읍|면|리))(\d+(?:-\d+)?)$/);

  if (!match) return null;

  return {
    compact: match[1] + match[2]
  };
}


function matchesExactJibunAddress(item, parsedKeyword) {
  if (!parsedKeyword || !parsedKeyword.compact) return false;

  var compactAddress = normalizeSearchComparableText(item && item.address);
  var startIndex = compactAddress.indexOf(parsedKeyword.compact);

  while (startIndex !== -1) {
    var nextCharacter = compactAddress.charAt(startIndex + parsedKeyword.compact.length);

    /* 753 검색이 753-1 또는 7530까지 포함하지 않도록 지번 끝 경계를 확인한다. */
    if (!nextCharacter || !/[0-9-]/.test(nextCharacter)) return true;

    startIndex = compactAddress.indexOf(parsedKeyword.compact, startIndex + 1);
  }

  return false;
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
  var comparableFields = getSearchComparableFields(item);

  var orGroups = keyword
    .split(",")
    .map(function(group) {
      return group.trim();
    })
    .filter(Boolean);

  if (!orGroups.length) return true;

  return orGroups.some(function(group) {
    var exactJibunKeyword = parseExactJibunKeyword(group);

    /* 월평동753 / 월평동 753처럼 주소와 지번만 입력한 경우 주소 열만 정확히 검색한다. */
    if (exactJibunKeyword) {
      return matchesExactJibunAddress(item, exactJibunKeyword);
    }

    var andWords = group
      .split(/\s+/)
      .map(function(word) {
        return word.trim();
      })
      .filter(Boolean);

    return andWords.every(function(word) {
      var compactWord = normalizeSearchComparableText(word);

      return (
        searchText.includes(word) ||
        (compactWord && comparableFields.some(function(field) {
          return field.compact.includes(compactWord);
        }))
      );
    });
  });
}


var SORT_LABELS = {
  latest: "최신",
  address: "주소 오름순",
  addressAsc: "주소 오름순",
  addressDesc: "주소 내림순",
  floorLow: "층수↑",
  floorHigh: "층수↓",
  depositHigh: "보증금↓",
  depositLow: "보증금↑",
  rentHigh: "월세↓",
  rentLow: "월세↑"
};

var NATURAL_ADDRESS_COLLATOR = typeof Intl !== "undefined" && Intl.Collator
  ? new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" })
  : null;

function compareNaturalAddress(a, b) {
  var addressA = String((a && a.address) || "").replace(/\s+/g, " ").trim();
  var addressB = String((b && b.address) || "").replace(/\s+/g, " ").trim();

  if (NATURAL_ADDRESS_COLLATOR) {
    return NATURAL_ADDRESS_COLLATOR.compare(addressA, addressB);
  }

  return addressA.localeCompare(addressB, "ko");
}

function getSortFloorNumber(item) {
  var room = String((item && item.room) || "").trim();
  if (!room) return null;
  return parseFloorNotationV612(room, true);
}

function compareFloorItems(a, b, highFirst) {
  var floorA = getSortFloorNumber(a);
  var floorB = getSortFloorNumber(b);
  var blankA = floorA === null || !Number.isFinite(Number(floorA));
  var blankB = floorB === null || !Number.isFinite(Number(floorB));

  // 층수 공란은 정렬 방향과 관계없이 항상 가장 낮은 위치(목록 맨 앞)로 둡니다.
  if (blankA && !blankB) return -1;
  if (!blankA && blankB) return 1;
  if (!blankA && !blankB && Number(floorA) !== Number(floorB)) {
    return highFirst
      ? Number(floorB) - Number(floorA)
      : Number(floorA) - Number(floorB);
  }

  return compareNaturalAddress(a, b);
}


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
  var buttonLabel = button.querySelector(".v6-sort-label");
  if (buttonLabel) {
    buttonLabel.textContent = value === "latest" ? "정렬" : (SORT_LABELS[value] || "정렬");
  } else {
    button.textContent = value === "latest" ? "정렬" : (SORT_LABELS[value] || "정렬");
  }

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

  var minPremium = Number(document.getElementById("minPremium").value) || 0;
  var maxPremium = Number(document.getElementById("maxPremium").value) || 999999999;

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
    var operationsMatchIds = window.operationsMatchPropertyIds;
    var matchCustomerSelection = !operationsMatchIds || operationsMatchIds.has(String(item.propertyId || "").trim());
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
      (Number(item.premium) || 0) >= minPremium &&
      (Number(item.premium) || 0) <= maxPremium &&
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
    var matchTodayNew = !todayNewOnly || isTodayRegistration(item.regDate);
    var inMap = item.latlng && bounds.contain(item.latlng);

    return matchCustomerSelection && matchKeyword && matchType && matchIndustry && matchPrice && matchFloor &&
      matchFavorite && matchDone && matchGongsil && matchTodayNew && inMap;
  });

  filtered.sort(function(a, b) {
    var dateA = new Date((a.regDate || "").replace(/\./g, "-")).getTime() || 0;
    var dateB = new Date((b.regDate || "").replace(/\./g, "-")).getTime() || 0;

    if (sortType === "latest") return dateB - dateA;

    if (sortType === "address" || sortType === "addressAsc") return compareNaturalAddress(a, b);
    if (sortType === "addressDesc") return compareNaturalAddress(b, a);
    if (sortType === "floorLow") return compareFloorItems(a, b, false);
    if (sortType === "floorHigh") return compareFloorItems(a, b, true);
    if (sortType === "depositLow") return Number(a.deposit || 0) - Number(b.deposit || 0) || compareNaturalAddress(a, b);
    if (sortType === "depositHigh") return Number(b.deposit || 0) - Number(a.deposit || 0) || compareNaturalAddress(a, b);
    if (sortType === "rentLow") return Number(a.rent || 0) - Number(b.rent || 0) || compareNaturalAddress(a, b);
    if (sortType === "rentHigh") return Number(b.rent || 0) - Number(a.rent || 0) || compareNaturalAddress(a, b);

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


function getListRenderChunkSize() {
  return window.innerWidth <= 768 ? 36 : 80;
}

function isTodayRegistration(value) {
  var text = String(value || "").trim();
  var match = text.match(/(\d{2,4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!match) return false;
  var year = Number(match[1]);
  if (year < 100) year += 2000;
  var today = new Date();
  return year === today.getFullYear() && Number(match[2]) === today.getMonth() + 1 &&
    Number(match[3]) === today.getDate();
}

function toggleTodayNewOnly() {
  todayNewOnly = !todayNewOnly;
  var button = document.getElementById("todayNewBtn");
  if (button) {
    button.classList.toggle("on", todayNewOnly);
    button.setAttribute("aria-checked", todayNewOnly ? "true" : "false");
  }
  applyFilter();
}


function renderNextListChunk(targetLimit) {
  var list = document.getElementById("list");
  if (!list || listRenderLimit >= visibleListItems.length) return;

  var chunkSize = getListRenderChunkSize();
  var nextLimit = Math.min(
    visibleListItems.length,
    Math.max(listRenderLimit + chunkSize, Number(targetLimit) || 0)
  );
  var fragment = document.createDocumentFragment();

  for (var index = listRenderLimit; index < nextLimit; index++) {
    addListItem(visibleListItems[index], fragment);
  }

  list.appendChild(fragment);
  listRenderLimit = nextLimit;
  list.setAttribute("data-rendered-count", String(listRenderLimit));
  list.setAttribute("data-total-count", String(visibleListItems.length));
}


function bindIncrementalListRendering() {
  if (listRenderScrollBound) return;

  var sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  listRenderScrollBound = true;
  sidebar.addEventListener("scroll", function() {
    if (sidebar.scrollHeight - sidebar.scrollTop - sidebar.clientHeight < 900) {
      renderNextListChunk();
    }
  }, { passive: true });
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

  var previousRenderLimit = listRenderLimit;
  var sameList = previousSignature === nextSignature;

  visibleListItems = items.slice();
  document.getElementById("list").innerHTML = "";
  listRenderLimit = 0;
  bindIncrementalListRendering();

  renderNextListChunk(
    sameList
      ? Math.max(previousRenderLimit, getListRenderChunkSize())
      : getListRenderChunkSize()
  );

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

  /* 일반 매물목록과 AI 임장 모두 동일한 태블릿 전체화면 보정을 사용합니다. */
  if (typeof window.prepareRoadviewViewport === "function") {
    window.prepareRoadviewViewport();
  }

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


function openPropertySourceLink(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var item = allItems.find(function(currentItem) {
    return currentItem.key === key;
  });
  var url = String(item && item.sourceLink || "").trim();

  if (!/^https?:\/\//i.test(url)) {
    alert("이 매물에는 원본 링크가 없습니다.");
    return;
  }

  var opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}

function openKakaoRoadviewAtPosition(lat, lng) {
  lat = Number(lat);
  lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || !window.kakao || !kakao.maps) return;

  var temporaryKey = "__map_roadview_" + Date.now();
  var temporaryItem = {
    key: temporaryKey,
    name: "지도 선택 위치",
    address: "선택한 지점의 가장 가까운 로드뷰",
    room: "",
    latlng: new kakao.maps.LatLng(lat, lng)
  };

  allItems.push(temporaryItem);
  try {
    openKakaoRoadview(encodeURIComponent(temporaryKey));
  } finally {
    var temporaryIndex = allItems.indexOf(temporaryItem);
    if (temporaryIndex >= 0) allItems.splice(temporaryIndex, 1);
  }
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
    row: item.sheetRow || 0,
    key: {
      name: item.name || "",
      address: item.address || "",
      room: item.room || "",
      type: item.type || "",
      deposit: item.deposit == null ? "" : item.deposit,
      rent: item.rent == null ? "" : item.rent
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


function getCustomerMatchStatus(item) {
  var propertyId = String(item && item.propertyId || "").trim();
  return propertyId && window.operationsMatchStatusByPropertyId
    ? String(window.operationsMatchStatusByPropertyId[propertyId] || "").trim()
    : "";
}

function buildCustomerMatchInlineControls(item) {
  var propertyId = String(item && item.propertyId || "").trim();
  var status = getCustomerMatchStatus(item);
  if (!propertyId || !status) return "";
  var encodedId = encodeURIComponent(propertyId);
  var visualLabel = status === "소개" ? "후보 매물" : (status === "보류" ? "보류한 매물" : (status === "신규" ? "신규매물" : ""));
  return '<div class="customer-match-inline-actions" onclick="event.stopPropagation()">' +
    (visualLabel ? '<span class="customer-match-inline-badge status-' + (status === "소개" ? "introduced" : (status === "보류" ? "held" : "new")) + '">' + visualLabel + '</span>' : '<span class="customer-match-inline-spacer" aria-hidden="true"></span>') +
    (status !== "소개" ? '<button type="button" class="introduce" onclick="handleCustomerMatchListAction(this,\'' + encodedId + '\',\'소개\')">후보등록</button>' : '') +
    (status !== "보류" ? '<button type="button" class="hold" onclick="handleCustomerMatchListAction(this,\'' + encodedId + '\',\'보류\')">보류함</button>' : '') +
  '</div>';
}

window.handleCustomerMatchListAction = function(button, encodedPropertyId, nextStatus) {
  var propertyId = decodeURIComponent(encodedPropertyId || "");
  if (!propertyId || typeof window.updateCustomerMatchFromMap !== "function") return;
  button.disabled = true;
  var oldText = button.textContent;
  button.textContent = "저장 중…";
  window.updateCustomerMatchFromMap(propertyId, nextStatus).catch(function(error) {
    button.disabled = false;
    button.textContent = oldText;
    alert((error && error.message) || "고객 매칭 상태를 저장하지 못했습니다.");
  });
};

var LIST_CONTACT_ROLE_META_V650 = {
  "주": { short: "주", name: "주인", priority: 90 },
  "임": { short: "임", name: "임대인", priority: 40 },
  "남": { short: "남", name: "사장", priority: 80 },
  "여": { short: "여", name: "사모", priority: 80 },
  "관": { short: "관", name: "관리", priority: 70 },
  "부": { short: "부", name: "부동산", priority: 70 },
  "세": { short: "세", name: "세입자", priority: 70 },
  "가": { short: "가", name: "가족", priority: 70 }
};

function normalizeListPhoneV650(value) {
  var digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length === 11 && digits.slice(0, 3) === "010") {
    return {
      key: digits,
      tel: digits,
      display: digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7)
    };
  }
  if (digits.length === 10 && digits.slice(0, 2) === "02") {
    return {
      key: digits,
      tel: digits,
      display: digits.slice(0, 2) + "-" + digits.slice(2, 6) + "-" + digits.slice(6)
    };
  }
  if (digits.length === 9 && digits.slice(0, 2) === "02") {
    return {
      key: digits,
      tel: digits,
      display: digits.slice(0, 2) + "-" + digits.slice(2, 5) + "-" + digits.slice(5)
    };
  }
  if (digits.length === 10 && digits.charAt(0) === "0") {
    return {
      key: digits,
      tel: digits,
      display: digits.slice(0, 3) + "-" + digits.slice(3, 6) + "-" + digits.slice(6)
    };
  }
  return null;
}

function listContactRoleV650(value) {
  var label = String(value || "").replace(/\s+/g, "");
  if (/^(주인|건물주|소유자|주)$/.test(label)) return "주";
  if (/^(임대인|임)$/.test(label)) return "임";
  if (/^(사장|남성|남자|남)$/.test(label)) return "남";
  if (/^(사모|여성|여자|여)$/.test(label)) return "여";
  if (/^(관리업체|관리인|관리|관)$/.test(label)) return "관";
  if (/^(부동산|중개사|중개|부)$/.test(label)) return "부";
  if (/^(세입자|임차인|임차|세)$/.test(label)) return "세";
  if (/^(가족|가)$/.test(label)) return "가";
  return "";
}

function extractListContactsV650(item) {
  var contacts = [];
  var byPhone = Object.create(null);

  function add(role, phoneValue) {
    role = listContactRoleV650(role);
    var phone = normalizeListPhoneV650(phoneValue);
    if (!role || !phone) return;
    var existing = byPhone[phone.key];
    if (existing) {
      var existingMeta = LIST_CONTACT_ROLE_META_V650[existing.role];
      var nextMeta = LIST_CONTACT_ROLE_META_V650[role];
      if (nextMeta && existingMeta && nextMeta.priority > existingMeta.priority) {
        existing.role = role;
      }
      return;
    }
    var contact = { role: role, phone: phone };
    byPhone[phone.key] = contact;
    contacts.push(contact);
  }

  add("임", item && item.landlordPhone);
  add("세", item && item.tenantPhone);

  var memo = String(item && item.memo || "");
  var rolePattern = "(주인|건물주|소유자|임대인|사장|남성|남자|사모|여성|여자|관리업체|관리인|관리|부동산|중개사|중개|세입자|임차인|임차|가족|주|임|남|여|관|부|세|가)";
  var phonePattern = "(0(?:10|11|16|17|18|19)[-\\s]?\\d{3,4}[-\\s]?\\d{4}|02[-\\s]?\\d{3,4}[-\\s]?\\d{4}|0(?:[3-6][1-5]|70)[-\\s]?\\d{3,4}[-\\s]?\\d{4})";
  var matcher = new RegExp(rolePattern + "(?:\\s*(?:추가번호)?\\s*\\d*)?\\s*[\\)\\(\\]:：=.-]?\\s*" + phonePattern, "g");
  var match;
  while ((match = matcher.exec(memo))) {
    add(match[1], match[2]);
  }

  return contacts.slice(0, 4);
}

function buildListContactRailV650(item) {
  var contacts = extractListContactsV650(item);
  if (!contacts.length) return "";
  return '<div class="item-contact-rail-v650 contact-count-' + contacts.length +
    '" onclick="event.stopPropagation()" aria-label="연락처">' +
    contacts.map(function(contact) {
      var meta = LIST_CONTACT_ROLE_META_V650[contact.role];
      var accessible = meta.name + " " + contact.phone.display + " 전화걸기";
      return '<a class="item-contact-call-v650 role-' + contact.role +
        '" href="tel:' + contact.phone.tel + '" title="' + escapeHtml(accessible) +
        '" aria-label="' + escapeHtml(accessible) + '">' + meta.short + '</a>';
    }).join("") +
  '</div>';
}

function listDisplayValueV650(item, field) {
  var presence = item && item.displayValuePresence;
  var value = item ? item[field] : "";
  if (presence && presence[field] === false) return "-";
  if (value == null || String(value).trim() === "") return "-";
  var number = Number(value);
  if (isFinite(number)) return number.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return String(value).trim();
}

function buildListElevatorIconV650() {
  return '<span class="item-elevator-v650" hidden title="건축물대장 엘리베이터 확인" aria-label="엘리베이터 있음">' +
    '<span class="item-elevator-glyph-v651" aria-hidden="true">🛗</span>' +
  '</span>';
}

function addListItem(item, appendTarget) {
  var div = document.createElement("div");
  var printSelected = selectedPrintKeys.includes(item.key);
  var memoOpen = openMemoKey === item.key;
  var memoEditing = editingMemoKey === item.key;

  div.className =
    "item" +
    (selectedItemKey === item.key ? " selected" : "") +
    (isDone(item) ? " done" : "") +
    (printSelected ? " print-selected" : "") +
    (memoOpen ? " memo-open" : "") +
    (getCustomerMatchStatus(item) === "신규" ? " customer-match-new" : "") +
    (getCustomerMatchStatus(item) === "소개" ? " customer-match-introduced" : "") +
    (getCustomerMatchStatus(item) === "보류" ? " customer-match-held" : "");

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
  var encodedEditTargetV648 = encodeURIComponent(
    item.propertyId
      ? "id:" + String(item.propertyId).trim()
      : "key:" + item.key
  );
  var safeKey = escapeHtml(item.key);
  var pyeongMiniBadge = buildPyeongMiniBadge(item);
  var regDateLabel = formatListRegistrationDate(item.regDate);
  var hasSourceLink = /^https?:\/\//i.test(String(item.sourceLink || "").trim());
  var sourceLinkButton = hasSourceLink
    ? '<button type="button" class="item-source-link-btn active" title="원본 매물 페이지 열기" ' +
        'onclick="event.stopPropagation(); openPropertySourceLink(\'' + encodedKey + '\')">링크</button>'
    : '<button type="button" class="item-source-link-btn disabled" title="원본 링크 없음" disabled>링크</button>';
  var customerMatchControls = buildCustomerMatchInlineControls(item);
  var contactRail = buildListContactRailV650(item);
  var depositDisplay = listDisplayValueV650(item, "deposit");
  var rentDisplay = listDisplayValueV650(item, "rent");
  var feeDisplay = listDisplayValueV650(item, "fee");
  var premiumDisplay = listDisplayValueV650(item, "premium");
  var areaDisplay = listDisplayValueV650(item, "area");

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

  div.setAttribute("data-listing-key", item.key);
  div.innerHTML =
    '<div class="item-card-grid-v650">' +
      contactRail +
      '<div class="item-compact-main-v650">' +
        '<div class="item-compact-head-v650">' +
          '<label class="item-action-select item-head-select-v650" title="이 매물을 작업 대상으로 선택">' +
            '<input type="checkbox" class="action-select-check" ' +
              (printSelected ? 'checked' : '') +
              ' onclick="event.stopPropagation(); togglePrintSelection(\'' + encodedKey + '\')">' +
          '</label>' +
          '<span class="item-building-year-v650" title="건축물대장 사용승인일">준공 -</span>' +
          doneLabel +
          sourceLabel +
          '<span class="item-building-name" title="' + escapeHtml(item.name || "건물명 -") + '">' + escapeHtml(item.name || "건물명 -") + '</span>' +
          '<span class="item-address-room-v650">' +
            '<span class="item-address-text" title="' + escapeHtml(item.address || "주소 -") + '">' + escapeHtml(item.address || "주소 -") + '</span>' +
            (item.room
              ? '<span class="item-room-badge">' + escapeHtml(item.room) + '</span>'
              : '<span class="item-room-badge empty">호실 -</span>') +
            buildListElevatorIconV650() +
          '</span>' +
          (regDateLabel
            ? '<span class="item-reg-date item-reg-date-head-v651' +
                (!customerMatchControls ? ' standard-card-v651' : '') +
                '">등록 ' + escapeHtml(regDateLabel) + '</span>'
            : '') +
        '</div>' +

        '<div class="price-line item-compact-price-v650">' +
          pyeongMiniBadge +
          typeLabel +
          '<span class="price-main"><b><span class="price-label-full-v650">보증금</span><span class="price-label-short-v650">보</span></b> ' + escapeHtml(depositDisplay) + ' / <b><span class="price-label-full-v650">월세</span><span class="price-label-short-v650">월</span></b> ' + escapeHtml(rentDisplay) + '</span>' +
          '<span class="price-separator">·</span>' +
          '<span class="price-fee"><b><span class="price-label-full-v650">관리비</span><span class="price-label-short-v650">관</span></b> ' + escapeHtml(feeDisplay) + '</span>' +
          '<span class="price-separator">·</span>' +
          '<span class="price-premium"><b><span class="price-label-full-v650">권리금</span><span class="price-label-short-v650">권</span></b> ' + escapeHtml(premiumDisplay) + '</span>' +
          '<span class="price-separator">·</span>' +
          '<span class="price-area"><b><span class="price-label-full-v650">평수</span><span class="price-label-short-v650">평</span></b> ' + escapeHtml(areaDisplay) + '</span>' +
        '</div>' +

        '<div class="item-action-row item-compact-actions-v650">' +
          customerMatchControls +
          '<div class="item-action-left">' +
            '<button type="button" class="item-nav-btn" title="카카오맵 길찾기" ' +
          'onclick="event.stopPropagation(); openKakaoNavigation(\'' + encodedKey + '\')">내비</button>' +
            '<button type="button" class="item-roadview-btn" title="카카오 로드뷰" ' +
          'onclick="event.stopPropagation(); openKakaoRoadview(\'' + encodedKey + '\')">로드뷰</button>' +
            '<button type="button" class="item-building-register-btn" title="국토교통부 건축물대장" ' +
          'onclick="event.stopPropagation(); openBuildingRegisterV640(\'' + encodedKey + '\')">대장</button>' +
            '<button type="button" class="item-list-add-btn favorite" title="찜 또는 임장목록에 추가" ' +
          'onclick="event.stopPropagation(); openItemListDestinationPicker(\'' + encodedKey + '\')">찜</button>' +
            sourceLinkButton +
            '<button type="button" class="item-edit-btn-v630" title="임대조건 수정" ' +
          'onclick="event.stopPropagation(); openPropertyEditModalV630(\'' + encodedEditTargetV648 + '\')">수정</button>' +
          '</div>' +
          (!customerMatchControls && regDateLabel
            ? '<span class="item-reg-date item-reg-date-mobile-v651">등록 ' + escapeHtml(regDateLabel) + '</span>'
            : '') +
          '<button type="button" class="item-memo-toggle ' + (memoOpen ? 'on' : '') + '" ' +
            'onclick="event.stopPropagation(); toggleItemMemo(\'' + encodedKey + '\')">' +
            (memoOpen ? '메모 ▲' : '메모 ▼') +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    memoPanel;

  div.onclick = function() {
    openItem(item);
  };

  (appendTarget || document.getElementById("list")).appendChild(div);
  if (window.JSBuildingRegisterBadges && typeof window.JSBuildingRegisterBadges.bind === "function") {
    window.JSBuildingRegisterBadges.bind(div, item);
  }

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
  document.getElementById("minPremium").value = "";
  document.getElementById("maxPremium").value = "";
  document.getElementById("minArea").value = "";
  document.getElementById("maxArea").value = "";
  document.getElementById("minFloor").value = "";
  document.getElementById("maxFloor").value = "";
  var industryInput = document.getElementById("industryFilter");
  if (industryInput) industryInput.value = "";

  favoriteOnly = false;
  hideDone = true;
  gongsilOnly = false;
  todayNewOnly = false;
  multiClusterMode = false;
  selectedGroupKeys = [];
  document.getElementById("favoriteBtn").innerText = "찜목록";
  document.getElementById("favoriteBtn").classList.remove("on");
  updateHideDoneMenuUI();
  var gongsilOnlyButton = document.getElementById("gongsilOnlyBtn");
  if (gongsilOnlyButton) {
    gongsilOnlyButton.classList.remove("on");
    gongsilOnlyButton.setAttribute("aria-checked", "false");
  }
  var todayNewButton = document.getElementById("todayNewBtn");
  if (todayNewButton) {
    todayNewButton.classList.remove("on");
    todayNewButton.setAttribute("aria-checked", "false");
  }
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
    row: item.sheetRow || 0,
    key: {
      propertyId: item.propertyId || "",
      name: item.name || "",
      address: item.address || "",
      room: item.room || "",
      type: item.type || "",
      deposit: item.deposit == null ? "" : item.deposit,
      rent: item.rent == null ? "" : item.rent
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
      row: item.sheetRow || 0,
      key: {
        propertyId: item.propertyId || "",
        name: item.name || "",
        address: item.address || "",
        room: item.room || "",
        type: item.type || "",
        deposit: item.deposit == null ? "" : item.deposit,
        rent: item.rent == null ? "" : item.rent
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
      row: item.sheetRow || 0,
      key: {
        propertyId: item.propertyId || "",
        name: item.name || "",
        address: item.address || "",
        room: item.room || "",
        type: item.type || "",
        deposit: item.deposit == null ? "" : item.deposit,
        rent: item.rent == null ? "" : item.rent
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
  if (btn) {
    btn.classList.toggle("on", gongsilOnly);
    btn.setAttribute("aria-checked", gongsilOnly ? "true" : "false");
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
    var reason = item.geocodeErrorReason ? " (" + item.geocodeErrorReason + ")" : "";
    return (index + 1) + ". " + item.name + " / " + item.address + " / " + item.room + reason;
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


/* =========================================================
   v6.1.2 층수 필터 표준화
   B1/B01/B101/지1/지하1/-1 => -1
   B201 => -2, 101호 => 1, 502호 => 5
   ========================================================= */
function parseFloorNotationV612(value, allowRoomInference) {
  var text = String(value == null ? "" : value).trim();
  if (!text) return null;

  var compact = text.toUpperCase().replace(/\s+/g, "");

  /* B 표기는 무조건 지하. B101은 지하1층, B201은 지하2층 */
  var basementB = compact.match(/B(\d{1,4})/);
  if (basementB) {
    var bDigits = basementB[1];
    var bFloor;
    if (bDigits.length <= 2) {
      bFloor = Number(bDigits);
    } else {
      bFloor = Number(bDigits.slice(0, -2));
      if (!bFloor) bFloor = Number(bDigits.slice(-2));
    }
    return bFloor > 0 ? -bFloor : -1;
  }

  var koreanBasement = compact.match(/(?:지하|지)(\d{1,2})/);
  if (koreanBasement) return -Math.max(1, Number(koreanBasement[1]) || 1);

  var negativeFloor = compact.match(/(?:^|[^0-9])-(\d{1,2})(?:층|F|$)/);
  if (negativeFloor) return -Math.max(1, Number(negativeFloor[1]) || 1);

  var explicitFloor = compact.match(/(?:^|[^0-9])(\d{1,2})(?:층|F)(?:[^0-9]|$)/);
  if (explicitFloor) return Number(explicitFloor[1]) || null;

  if (allowRoomInference !== false) {
    var room = compact.match(/(?:^|[^0-9])(\d{3,4})호?(?:[^0-9]|$)/);
    if (room) {
      var digits = room[1];
      var floor = digits.length === 3 ? Number(digits.charAt(0)) : Number(digits.slice(0, -2));
      return floor > 0 ? floor : null;
    }
  }

  /* 필터 입력칸의 일반 숫자 */
  if (/^-?\d+(?:\.\d+)?$/.test(compact)) {
    var n = Number(compact);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function getItemFloorNumber(item) {
  var room = String((item && item.room) || "").trim();
  var fromRoom = parseFloorNotationV612(room, true);
  if (fromRoom !== null) return fromRoom;

  /* 호실에 정보가 없을 때만 건물명·메모를 보조로 확인 */
  var name = String((item && item.name) || "").trim();
  var memo = String((item && item.memo) || "").trim();
  var fromText = parseFloorNotationV612(name + " " + memo, false);
  return fromText;
}

function readOptionalNumberInput(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  var value = String(el.value || "").trim();
  if (!value) return null;
  return parseFloorNotationV612(value, false);
}

/* =========================================================
   v6.2 상세필터 안정화
   - 필터 내부 입력/버튼의 기본 동작 보존
   - 내부 클릭이 외부 닫기 로직으로 전달되는 것만 방지
   - Enter 즉시 필터 적용
   ========================================================= */
function setupStableDetailFilterV62() {
  var panel = document.getElementById("detailFilter");
  if (!panel || panel.dataset.v62StableBound === "1") return;

  panel.dataset.v62StableBound = "1";

  panel.addEventListener("click", function(event) {
    event.stopPropagation();
  }, false);

  panel.addEventListener("keydown", function(event) {
    if (event.key !== "Enter") return;
    if (!event.target || !event.target.matches("input, select")) return;

    event.preventDefault();
    applyFilter();
  }, false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupStableDetailFilterV62);
} else {
  setupStableDetailFilterV62();
}



/* =========================================================
   v6.3.0 현장모드 - 매물 임대조건 수정
   - 임장추가 버튼 옆 '수정'
   - 기존 행을 새 행으로 추가하지 않고 정확히 찾아 수정
   - 주소/건물이름/구분은 식별 기준으로 유지하고 편집 대상에서 제외
   ========================================================= */

var propertyEditTargetV630 = null;
var propertyEditSavingV630 = false;

/*
 * v6.3.2 QA2
 * 건물이름 또는 호실을 수정하면 item.key도 바뀝니다.
 * 시트를 다시 불러온 뒤 새 key를 찾아 선택·리스트를 복원하기 위한 임시 상태입니다.
 */
var pendingPropertyEditNewKeyV633 = null;

/*
 * v6.3.4 수정 상태 안정화
 * - 같은 매물 연속 수정
 * - 필터 유지
 * - 다중 클러스터 선택 유지
 */
var propertyEditReloadTimerV634 = null;
var pendingPropertyEditStateV634 = null;



function getPropertyByEncodedKeyV630(encodedKey) {
  var locator = decodeURIComponent(String(encodedKey || ""));

  if (locator.indexOf("id:") === 0) {
    var propertyId = locator.slice(3).trim();
    var matches = (allItems || []).filter(function(item) {
      return item && String(item.propertyId || "").trim() === propertyId;
    });

    /*
     * ID가 없거나 둘 이상이면 어떤 매물도 대신 선택하지 않습니다.
     * 동일 주소·동일 호실 매물의 첫 번째 항목으로 넘어가는 것을 방지합니다.
     */
    return matches.length === 1 ? matches[0] : null;
  }

  var key = locator.indexOf("key:") === 0
    ? locator.slice(4)
    : locator;

  return (allItems || []).find(function(item) {
    return item && item.key === key;
  }) || null;
}


function ensurePropertyEditModalV630() {
  if (document.getElementById("propertyEditModalV630")) return;

  var modal = document.createElement("div");
  modal.id = "propertyEditModalV630";
  modal.className = "property-edit-modal-v630";
  modal.setAttribute("aria-hidden", "true");

  modal.innerHTML =
    '<div class="property-edit-backdrop-v630" onclick="closePropertyEditModalV630()"></div>' +
    '<div class="property-edit-dialog-v630" role="dialog" aria-modal="true" aria-labelledby="propertyEditTitleV630">' +
      '<div class="property-edit-header-v630">' +
        '<div>' +
          '<strong id="propertyEditTitleV630">매물 임대조건 수정</strong>' +
          '<div id="propertyEditIdentityV630" class="property-edit-identity-v630"></div>' +
        '</div>' +
        '<button type="button" class="property-edit-close-v630" onclick="closePropertyEditModalV630()" aria-label="닫기">×</button>' +
      '</div>' +

      '<div class="property-edit-grid-v630">' +
        '<label class="property-edit-wide-v630">건물이름 (변경가능)' +
          '<input id="peNameV630" type="text" inputmode="text" autocomplete="off" maxlength="120" spellcheck="false">' +
        '</label>' +
        '<label class="property-edit-wide-v630 property-edit-readonly-label-v631">주소 (변경불가)' +
          '<input id="peAddressV630" type="text" readonly aria-readonly="true">' +
        '</label>' +
        '<label>호실<input id="peRoomV630" type="text"></label>' +
        '<label>보증금<input id="peDepositV630" type="number" inputmode="numeric"></label>' +
        '<label>월세<input id="peRentV630" type="number" inputmode="numeric"></label>' +
        '<label>관리비<input id="peFeeV630" type="number" inputmode="numeric"></label>' +
        '<label>권리금<input id="pePremiumV630" type="number" inputmode="numeric"></label>' +
        '<label>평수<input id="peAreaV630" type="number" inputmode="decimal" step="0.1"></label>' +
        '<label>임대인 전화번호<input id="peLandlordPhoneV630" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>' +
        '<label>세입자 전화번호<input id="peTenantPhoneV630" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>' +
        '<label class="property-edit-wide-v630">상태' +
          '<select id="peStateV630">' +
            '<option value="">계약가능</option>' +
            '<option value="계약완료">계약완료</option>' +
          '</select>' +
        '</label>' +
        '<label class="property-edit-wide-v630">메모' +
          '<textarea id="peMemoV630" rows="5"></textarea>' +
        '</label>' +
      '</div>' +

      '<div id="propertyEditStatusV630" class="property-edit-status-v630"></div>' +

      '<div class="property-edit-actions-v630">' +
        '<button type="button" id="propertyEditDeleteBtnV648" class="property-edit-delete-v648" onclick="deletePropertyV648()">매물삭제</button>' +
        '<div class="property-edit-actions-right-v648">' +
          '<button type="button" class="property-edit-cancel-v630" onclick="closePropertyEditModalV630()">취소</button>' +
          '<button type="button" id="propertyEditSaveBtnV630" class="property-edit-save-v630" onclick="savePropertyEditV630()">저장</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      closePropertyEditModalV630();
    }
  });
}


function openPropertyEditModalV630(encodedKey) {
  ensurePropertyEditModalV630();

  var item = getPropertyByEncodedKeyV630(encodedKey);

  if (!item) {
    alert("수정할 매물을 찾지 못했습니다.");
    return;
  }

  propertyEditTargetV630 = item;
  propertyEditSavingV630 = false;

  var deleteButtonV648 = document.getElementById("propertyEditDeleteBtnV648");
  var saveButtonV648 = document.getElementById("propertyEditSaveBtnV630");

  if (deleteButtonV648) {
    deleteButtonV648.disabled = false;
    deleteButtonV648.textContent = "매물삭제";
  }

  if (saveButtonV648) {
    saveButtonV648.disabled = false;
    saveButtonV648.textContent = "저장";
  }

  document.getElementById("propertyEditIdentityV630").textContent =
    [item.name, item.address, item.type].filter(Boolean).join(" · ");

  document.getElementById("peNameV630").value = item.name || "";
  document.getElementById("peAddressV630").value = item.address || "";
  document.getElementById("peRoomV630").value = item.room || "";
  document.getElementById("peDepositV630").value = item.deposit || 0;
  document.getElementById("peRentV630").value = item.rent || 0;
  document.getElementById("peFeeV630").value = item.fee || 0;
  document.getElementById("pePremiumV630").value = item.premium || 0;
  document.getElementById("peAreaV630").value = item.area || 0;
  document.getElementById("peLandlordPhoneV630").value = item.landlordPhone || "";
  document.getElementById("peTenantPhoneV630").value = item.tenantPhone || "";
  document.getElementById("peStateV630").value = item.state || "";
  document.getElementById("peMemoV630").value = item.memo || "";
  document.getElementById("propertyEditStatusV630").textContent = "";

  var modal = document.getElementById("propertyEditModalV630");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  setTimeout(function() {
    var first = document.getElementById("peNameV630");
    if (first) first.focus();
  }, 50);
}


function closePropertyEditModalV630() {
  if (propertyEditSavingV630) return;

  var modal = document.getElementById("propertyEditModalV630");
  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  propertyEditTargetV630 = null;
}


function numberFromEditV630(id) {
  var element = document.getElementById(id);
  var value = Number(element && element.value);

  return Number.isFinite(value) ? value : 0;
}


function normalizeBuildingNameV638(value) {
  return String(value == null ? "" : value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}


function buildOriginalPropertyValuesV630(item) {
  return [
    item.name || "",
    item.address || "",
    item.room || "",
    item.type || "",
    item.deposit || 0,
    item.rent || 0,
    item.fee || 0,
    item.premium || 0,
    item.area || 0,
    item.landlordPhone || "",
    item.tenantPhone || "",
    item.memo || "",
    item.state || "",
    item.regDate || "",
    item.source || ""
  ];
}




function replaceEditKeyV634(key, aliases, nextKey) {
  if (!key) return key;
  return aliases.indexOf(key) >= 0 ? nextKey : key;
}


function remapEditViewStateV634(state, aliases, nextKey) {
  if (!state) return null;

  return {
    selectedItemKey: replaceEditKeyV634(
      state.selectedItemKey || "",
      aliases,
      nextKey
    ),
    selectedGroupKey: state.selectedGroupKey || "",
    selectedGroupKeys: (state.selectedGroupKeys || []).slice(),
    multiClusterMode: !!state.multiClusterMode,
    clusterSelection: state.clusterSelection || null,
    visibleKeys: (state.visibleKeys || []).map(function(key) {
      return replaceEditKeyV634(key, aliases, nextKey);
    }),
    sidebarScrollTop: Number(state.sidebarScrollTop || 0),
    aiOpen: !!state.aiOpen,
    aiItemKey: replaceEditKeyV634(
      state.aiItemKey || "",
      aliases,
      nextKey
    ),
    aiScrollTop: Number(state.aiScrollTop || 0)
  };
}


function keepOnlyFilteredEditKeysV634(state) {
  if (!state) return null;

  var allowed = {};
  (currentItems || []).forEach(function(item) {
    if (item && item.key) allowed[item.key] = true;
  });

  state.visibleKeys = (state.visibleKeys || []).filter(function(key) {
    return !!allowed[key];
  });

  if (state.selectedItemKey && !allowed[state.selectedItemKey]) {
    state.selectedItemKey = "";
  }

  if (state.aiItemKey && !allowed[state.aiItemKey]) {
    state.aiItemKey = "";
    state.aiOpen = false;
  }

  return state;
}


function mergeEditAliasesV634(oldKey, newKey, item) {
  var aliases = [];

  if (
    pendingPropertyEditStateV634 &&
    pendingPropertyEditStateV634.address === String(item.address || "") &&
    pendingPropertyEditStateV634.type === String(item.type || "")
  ) {
    aliases = (pendingPropertyEditStateV634.aliases || []).slice();
  }

  [oldKey, newKey].forEach(function(key) {
    if (key && aliases.indexOf(key) < 0) aliases.push(key);
  });

  return aliases;
}


function restoreEditedViewNowV634(viewState, aliases, newKey) {
  applyFilter();

  var restoredState = remapEditViewStateV634(
    viewState,
    aliases,
    newKey
  );

  restoredState = keepOnlyFilteredEditKeysV634(restoredState);

  if (restoredState && typeof restoreAutoUpdateViewState === "function") {
    preserveActionSelectionDuringRender = true;
    restoreAutoUpdateViewState(restoredState);
    preserveActionSelectionDuringRender = false;
  }

  if (
    restoredState &&
    restoredState.selectedItemKey &&
    typeof redrawSelectedMarkers === "function"
  ) {
    redrawSelectedMarkers();
  }
}


function schedulePropertyEditReloadV634() {
  if (propertyEditReloadTimerV634) {
    clearTimeout(propertyEditReloadTimerV634);
  }

  /*
   * 연속 수정 시 마지막 저장 기준으로 한 번만 재조회합니다.
   */
  propertyEditReloadTimerV634 = setTimeout(function() {
    propertyEditReloadTimerV634 = null;
    loadSheet(true);
  }, 2200);
}


function savePropertyEditV630() {
  if (propertyEditSavingV630 || !propertyEditTargetV630) return;

  if (!saveApiURL) {
    alert("Apps Script 저장 주소가 설정되지 않았습니다.");
    return;
  }

  var item = propertyEditTargetV630;
  var saveButton = document.getElementById("propertyEditSaveBtnV630");
  var deleteButton = document.getElementById("propertyEditDeleteBtnV648");
  var status = document.getElementById("propertyEditStatusV630");

  /*
   * 저장 직전 화면 상태를 보관합니다.
   */
  var editViewStateV634 =
    typeof captureAutoUpdateViewState === "function"
      ? captureAutoUpdateViewState()
      : null;

  var updated = {
    name: normalizeBuildingNameV638(
      document.getElementById("peNameV630").value
    ),
    room: String(document.getElementById("peRoomV630").value || "").trim(),
    deposit: numberFromEditV630("peDepositV630"),
    rent: numberFromEditV630("peRentV630"),
    fee: numberFromEditV630("peFeeV630"),
    premium: numberFromEditV630("pePremiumV630"),
    area: numberFromEditV630("peAreaV630"),
    landlordPhone: String(document.getElementById("peLandlordPhoneV630").value || "").trim(),
    tenantPhone: String(document.getElementById("peTenantPhoneV630").value || "").trim(),
    memo: String(document.getElementById("peMemoV630").value || "").trim(),
    state: String(document.getElementById("peStateV630").value || "").trim()
  };
  var updatedValuePresenceV650 = {
    deposit: String(document.getElementById("peDepositV630").value || "").trim() !== "",
    rent: String(document.getElementById("peRentV630").value || "").trim() !== "",
    fee: String(document.getElementById("peFeeV630").value || "").trim() !== "",
    premium: String(document.getElementById("pePremiumV630").value || "").trim() !== "",
    area: String(document.getElementById("peAreaV630").value || "").trim() !== ""
  };

  propertyEditSavingV630 = true;
  saveButton.disabled = true;
  if (deleteButton) deleteButton.disabled = true;
  saveButton.textContent = "저장 중...";
  status.textContent = "시트1 수정 요청 중...";

  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action: "updateProperty",
      row: item.sheetRow || 0,
      key: {
        propertyId: item.propertyId || "",
        name: item.name || "",
        address: item.address || "",
        room: item.room || "",
        type: item.type || ""
      },
      originalValues: buildOriginalPropertyValuesV630(item),
      updated: updated
    })
  }).then(function() {
    /*
     * QA3 안정화:
     * gviz 캐시를 이용한 성공/실패 판정은 제거합니다.
     * 화면에서는 수정값을 즉시 반영하고, 잠시 뒤 최신 시트를 다시 읽습니다.
     */
    var oldKey = item.key;

    item.name = updated.name;
    item.room = updated.room;
    item.deposit = updated.deposit;
    item.rent = updated.rent;
    item.fee = updated.fee;
    item.premium = updated.premium;
    item.area = updated.area;
    item.displayValuePresence = updatedValuePresenceV650;
    item.landlordPhone = updated.landlordPhone;
    item.tenantPhone = updated.tenantPhone;
    item.memo = updated.memo;
    item.state = updated.state;
    item.key = itemKey(item);

    var editAliasesV634 = mergeEditAliasesV634(
      oldKey,
      item.key,
      item
    );

    pendingPropertyEditNewKeyV633 = item.key;
    pendingPropertyEditStateV634 = {
      aliases: editAliasesV634,
      newKey: item.key,
      address: String(item.address || ""),
      type: String(item.type || ""),
      viewState: remapEditViewStateV634(
        editViewStateV634,
        editAliasesV634,
        item.key
      )
    };

    if (selectedItemKey === oldKey || selectedItemKey === item.key) {
      selectedItemKey = item.key;
    }

    propertyEditSavingV630 = false;
    saveButton.disabled = false;
    if (deleteButton) deleteButton.disabled = false;
    saveButton.textContent = "저장";
    status.textContent = "";

    var modal = document.getElementById("propertyEditModalV630");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }

    propertyEditTargetV630 = null;

    /*
     * 필터·리스트·다중 선택 상태를 즉시 복원합니다.
     */
    restoreEditedViewNowV634(
      pendingPropertyEditStateV634.viewState,
      pendingPropertyEditStateV634.aliases,
      pendingPropertyEditStateV634.newKey
    );

    var mainStatus = document.getElementById("status");
    if (mainStatus) {
      mainStatus.innerHTML = "매물 수정 요청 완료 · 최신 시트 동기화 중";
    }

    schedulePropertyEditReloadV634();
  }).catch(function(error) {
    console.error(error);
    pendingPropertyEditNewKeyV633 = null;
    pendingPropertyEditStateV634 = null;
    propertyEditSavingV630 = false;
    saveButton.disabled = false;
    if (deleteButton) deleteButton.disabled = false;
    saveButton.textContent = "저장";
    status.textContent = "수정 요청에 실패했습니다.";
    alert("매물 수정 중 오류가 발생했습니다.");
  });
}


/* =========================================================
   v6.4.8 매물삭제
   - 수정 팝업 하단 좌측의 빨간 삭제 버튼
   - P열 매물ID가 유일하게 일치할 때만 서버에서 삭제
   - 행번호·주소·호실을 이용한 대체 삭제 금지
   - Apps Script의 실제 처리 결과 확인 후에만 완료 처리
   ========================================================= */

function buildPropertyDeleteLabelV648(item) {
  return [
    item && item.name ? item.name : "건물이름 없음",
    item && item.address ? item.address : "주소 없음",
    item && item.room ? item.room : "호실 없음",
    "보증금 " + (Number(item && item.deposit) || 0) +
      " / 월세 " + (Number(item && item.rent) || 0)
  ].join("\n");
}


function createPropertyDeleteRequestIdV648() {
  return "property-delete-" + Date.now() + "-" +
    Math.random().toString(36).slice(2, 12);
}


function readMutationStatusJsonpV648(requestId) {
  return new Promise(function(resolve, reject) {
    var callbackName = "__propertyDeleteStatusV648_" +
      Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    var script = document.createElement("script");
    var settled = false;
    var timeout = setTimeout(function() {
      finish(new Error("삭제 결과 확인 시간이 초과되었습니다."));
    }, 7000);

    function cleanup() {
      clearTimeout(timeout);
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value || {});
    }

    window[callbackName] = function(payload) {
      finish(null, payload);
    };

    script.onerror = function() {
      finish(new Error("삭제 결과를 확인하지 못했습니다."));
    };

    script.src = saveApiURL +
      "?action=mutationStatus" +
      "&requestId=" + encodeURIComponent(requestId) +
      "&callback=" + encodeURIComponent(callbackName) +
      "&_=" + Date.now();

    document.head.appendChild(script);
  });
}


function waitForPropertyDeleteResultV648(requestId, attempt) {
  var currentAttempt = Number(attempt) || 0;

  return readMutationStatusJsonpV648(requestId).then(function(status) {
    if (status && status.ready) {
      return status.result || {
        ok: false,
        message: "삭제 결과가 비어 있습니다."
      };
    }

    if (currentAttempt >= 19) {
      throw new Error(
        "삭제 결과 확인 시간이 초과되었습니다. 시트에서 삭제 여부를 확인해주세요."
      );
    }

    return new Promise(function(resolve) {
      setTimeout(resolve, 400);
    }).then(function() {
      return waitForPropertyDeleteResultV648(requestId, currentAttempt + 1);
    });
  });
}


function deletePropertyV648() {
  if (propertyEditSavingV630 || !propertyEditTargetV630) return;

  if (!saveApiURL) {
    alert("Apps Script 저장 주소가 설정되지 않았습니다.");
    return;
  }

  var item = propertyEditTargetV630;
  var propertyId = String(item.propertyId || "").trim();

  if (!propertyId) {
    alert(
      "이 매물에는 P열 매물ID가 없어 안전하게 삭제할 수 없습니다.\n" +
      "시트의 매물ID를 생성하고 목록을 새로고침한 뒤 다시 시도해주세요."
    );
    return;
  }

  var confirmed = window.confirm(
    "정말 이 매물을 삭제하시겠습니까?\n\n" +
    buildPropertyDeleteLabelV648(item) +
    "\n\n삭제한 행은 되돌릴 수 없습니다."
  );

  if (!confirmed) return;

  var deleteButton = document.getElementById("propertyEditDeleteBtnV648");
  var saveButton = document.getElementById("propertyEditSaveBtnV630");
  var status = document.getElementById("propertyEditStatusV630");
  var requestId = createPropertyDeleteRequestIdV648();

  propertyEditSavingV630 = true;

  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent = "삭제 중...";
  }
  if (saveButton) saveButton.disabled = true;
  if (status) status.textContent = "매물ID 확인 후 시트1에서 삭제 중...";

  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action: "deleteProperty",
      requestId: requestId,
      key: {
        propertyId: propertyId
      },
      originalValues: buildOriginalPropertyValuesV630(item)
    })
  }).then(function() {
    return waitForPropertyDeleteResultV648(requestId, 0);
  }).then(function(result) {
    if (!result || !result.ok) {
      throw new Error(
        result && result.message
          ? result.message
          : "서버가 매물 삭제를 거부했습니다."
      );
    }

    propertyEditSavingV630 = false;
    propertyEditTargetV630 = null;
    pendingPropertyEditNewKeyV633 = null;
    pendingPropertyEditStateV634 = null;

    if (propertyEditReloadTimerV634) {
      clearTimeout(propertyEditReloadTimerV634);
      propertyEditReloadTimerV634 = null;
    }

    var modal = document.getElementById("propertyEditModalV630");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }

    selectedItemKey = null;
    selectedGroupKey = null;
    selectedGroupKeys = [];
    openMemoKey = null;
    editingMemoKey = null;

    var mainStatus = document.getElementById("status");
    if (mainStatus) mainStatus.innerHTML = "매물 삭제 완료 · 최신 시트 불러오는 중";

    loadSheet(false);
  }).catch(function(error) {
    console.error(error);
    propertyEditSavingV630 = false;

    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.textContent = "매물삭제";
    }
    if (saveButton) saveButton.disabled = false;

    var message = error && error.message
      ? error.message
      : "매물 삭제 중 오류가 발생했습니다.";

    if (status) status.textContent = message;
    alert(message);
  });
}

