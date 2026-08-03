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
var activeMemoCardV728 = null;
var editingMemoKey = null;
var memoEditMode = "replace";
var memoSavePendingKeysV655 = Object.create(null);
var memoDraftValuesV655 = Object.create(null);
var memoStatusMessagesV655 = Object.create(null);
var roadviewFullMap = null;
var roadviewFullMapMarker = null;
var roadviewTargetPosition = null;
var roadviewCameraPosition = null;
var currentRoadviewPan = 0;
var currentRoadviewMode = "naver";
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

function postSafeMutationV654(action, payload) {
  var body = Object.assign({}, payload || {}, {
    action: action,
    requestId: payload && payload.requestId
      ? payload.requestId
      : "web-save-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10)
  });
  var retryDelays = [0, 500, 1000, 1800, 3000, 5000];

  function isRetryableResult(result) {
    if (result && result.retryable === true) return true;
    var message = String(result && result.message || "");
    return /Lock timeout|holding the lock|잠금|저장 작업과 겹/i.test(message);
  }

  function send(attempt) {
    return fetch(saveApiURL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(response) {
      if (!response.ok) {
        var error = new Error("저장 요청을 처리하지 못했습니다. (HTTP " + response.status + ")");
        error.retryable = response.status >= 500;
        throw error;
      }
      return response.json();
    }).then(function(result) {
      if (!result || result.ok === false) {
        var error = new Error((result && result.message) || "실제 시트 저장에 실패했습니다.");
        error.retryable = isRetryableResult(result);
        throw error;
      }
      return Object.assign({}, result, {
        queued: false,
        persisted: true,
        requestId: body.requestId
      });
    }).catch(function(error) {
      var networkRetry = error instanceof TypeError;
      if (attempt + 1 >= retryDelays.length || (!error.retryable && !networkRetry)) {
        throw error;
      }
      return new Promise(function(resolve) {
        setTimeout(resolve, retryDelays[attempt + 1]);
      }).then(function() {
        return send(attempt + 1);
      });
    });
  }

  return send(0);
}

var asyncMutationSheetReloadTimerV654 = null;
window.addEventListener("js-async-mutation-finished", function(event) {
  var detail = event && event.detail || {};
  if (["toggleDone", "updateProperty", "deleteProperty"].indexOf(detail.action) < 0) return;
  if (!detail.ok) {
    var status = document.getElementById("status");
    if (status) status.textContent = "백그라운드 저장 실패 · 상태 버튼에서 확인";
    return;
  }
  if (asyncMutationSheetReloadTimerV654) clearTimeout(asyncMutationSheetReloadTimerV654);
  asyncMutationSheetReloadTimerV654 = setTimeout(function() {
    asyncMutationSheetReloadTimerV654 = null;
    loadSheet(true);
  }, 250);
});
var listRenderLimit = 0;
var listRenderScrollBound = false;
var listCardReusePoolV6521 = null;
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
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
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


function parseCSVRecordsV655(data) {
  var source = String(data == null ? "" : data).replace(/^\uFEFF/, "");
  var rows = [];
  var row = [];
  var current = "";
  var insideQuotes = false;

  function finishCell() {
    row.push(current);
    current = "";
  }

  function finishRow() {
    finishCell();
    rows.push(row);
    row = [];
  }

  for (var i = 0; i < source.length; i++) {
    var ch = source[i];

    if (ch === '"') {
      if (insideQuotes && source[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (ch === "," && !insideQuotes) {
      finishCell();
      continue;
    }

    if ((ch === "\r" || ch === "\n") && !insideQuotes) {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      finishRow();
      continue;
    }

    if (ch === "\r" && insideQuotes && source[i + 1] === "\n") {
      current += "\n";
      i += 1;
      continue;
    }

    current += ch;
  }

  if (current || row.length) finishRow();
  return rows;
}


function itemKey(item) {
  return item.name + "|" + item.address + "|" + item.room + "|" + item.type;
}


function isDone(item) {
  return item.state === "계약완료";
}


function isFavorite(item) {
  var propertyRef = item && item.propertyId ? "property:" + String(item.propertyId) : "";
  return favoriteKeys.includes(item.key) || (!!propertyRef && favoriteKeys.includes(propertyRef));
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
  var quickTools = document.getElementById("mapQuickTools");
  var quickToolsRect = quickTools ? quickTools.getBoundingClientRect() : null;
  var rightLimit = viewportWidth - margin;
  if (quickToolsRect && quickToolsRect.left > panelWidth + margin) {
    rightLimit = Math.min(rightLimit, quickToolsRect.left - gap);
  }
  var maxLeft = Math.max(margin, rightLimit - panelWidth);
  var left = Math.max(margin, Math.min(btnRect.left, maxLeft));
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


function getFilteredItems(options) {
  var includeUnlocated = !!(options && options.includeUnlocated);
  var ignoreMapBounds = !!(options && options.ignoreMapBounds);
  if (!map) return allItems;

  var bounds = map.getBounds();

  var keyword = document.getElementById("keyword").value.trim();
  var selectedType = document.getElementById("typeFilter").value;
  var selectedSource = String((document.getElementById("sourceFilter") || {}).value || "");
  var selectedFloorQuick = String((document.getElementById("floorQuickFilter") || {}).value || "");
  var sortType = document.getElementById("sortFilter").value;
  var industryKeyword = String((document.getElementById("industryFilter") || {}).value || "").trim().toLowerCase();
  var radiusFilter = window.mapRadiusFilterV658 || null;

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
    var customerMatchStatus = operationsMatchIds
      ? String((window.operationsMatchStatusByPropertyId || {})[String(item.propertyId || "").trim()] || "").trim()
      : "";
    var matchCustomerHeldVisibility =
      !operationsMatchIds ||
      customerMatchStatus !== "보류" ||
      !!window.customerMatchHeldVisibleV1;
    var matchKeyword = matchesMultiKeyword(item, keyword);

    var matchType = !selectedType || item.type === selectedType;
    var matchSource = !selectedSource ||
      (window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.matchesSource === "function"
        ? window.JSUnifiedListingsV8.matchesSource(item, selectedSource)
        : getItemSourceType(item) === selectedSource);

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
    var matchQuickFloor =
      !selectedFloorQuick ||
      (selectedFloorQuick === "basement" && itemFloor !== null && itemFloor < 0) ||
      (selectedFloorQuick === "first" && itemFloor === 1) ||
      (selectedFloorQuick === "upper" && itemFloor !== null && itemFloor >= 2) ||
      (selectedFloorQuick === "unknown" && itemFloor === null);

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
    var inMap = ignoreMapBounds
      ? true
      : (radiusFilter
        ? isItemWithinMapRadiusV658(item, radiusFilter)
        : (!item.latlng ? includeUnlocated : bounds.contain(item.latlng)));

    return matchCustomerSelection && matchCustomerHeldVisibility &&
      matchKeyword && matchType && matchSource && matchIndustry && matchPrice &&
      matchFloor && matchQuickFloor &&
      matchFavorite && matchDone && matchGongsil && matchTodayNew && inMap;
  });

  filtered.sort(function(a, b) {
    if (sortType === "latest") {
      var latestDifference = listingRegistrationTime(b) - listingRegistrationTime(a);
      if (latestDifference) return latestDifference;
      return (Number(b.sheetRow) || 0) - (Number(a.sheetRow) || 0);
    }

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

function listingRegistrationTime(item) {
  var raw = String((item && (item.registrationAt || item.regDate)) || "").trim();
  if (!raw) return 0;
  var matched = raw.match(
    /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
  );
  if (matched) {
    return new Date(
      Number(matched[1]),
      Number(matched[2]) - 1,
      Number(matched[3]),
      Number(matched[4] || 0),
      Number(matched[5] || 0),
      Number(matched[6] || 0)
    ).getTime();
  }
  return Date.parse(raw.replace(/\./g, "-")) || 0;
}

function getCoordinateDistanceMetersV658(first, second) {
  if (!first || !second) return Infinity;
  var earthRadius = 6371000;
  var toRadians = function(value) { return Number(value) * Math.PI / 180; };
  var lat1 = toRadians(first.lat);
  var lat2 = toRadians(second.lat);
  var deltaLat = toRadians(second.lat - first.lat);
  var deltaLng = toRadians(second.lng - first.lng);
  var haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isItemWithinMapRadiusV658(item, radiusFilter) {
  var coords = getItemCoordinates(item);
  if (!coords || !radiusFilter) return false;
  return getCoordinateDistanceMetersV658(coords, radiusFilter) <= Number(radiusFilter.meters || 0);
}


function applyFilter() {
  var filtered = getFilteredItems();
  currentItems = filtered;

  drawItems(filtered);
  var pinnedItems = typeof getPinnedClusterItemsV6515 === "function"
    ? getPinnedClusterItemsV6515()
    : [];
  if (pinnedItems.length) {
    document.getElementById("status").innerHTML = multiClusterMode
      ? "선택 클러스터 " + (selectedGroupKeys || []).length + "개 · 매물 " + pinnedItems.length + "개"
      : "선택 매물 " + pinnedItems.length + "개";
    return;
  }
  var radiusFilter = window.mapRadiusFilterV658 || null;
  document.getElementById("status").innerHTML = radiusFilter
    ? "반경 " + Number(radiusFilter.meters || 0).toLocaleString("ko-KR") + "m 안 매물 " + filtered.length + "개"
    : "검색 결과 " + filtered.length + "개";
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


function isConfirmedVisitItem(item) {
  var memo = String((item && item.memo) ? item.memo : "");

  return /\(\s*확인매물\s*\)/i.test(memo);
}


function isGongsilBoxItem(item) {
  var unifiedSources = item && Array.isArray(item.sourceTypesV8)
    ? item.sourceTypesV8
    : [];

  /*
   * v8에서는 대표카드의 메모가 네이버·당근 원본에서 왔더라도
   * 연결된 원본 중 공실박스가 하나라도 있으면 공실박스 매물로 표시합니다.
   */
  return unifiedSources.indexOf("gongsil") >= 0 || isFieldVisitItem(item);
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
    var item = visibleListItems[index];
    var reusableCard = listCardReusePoolV6521 && listCardReusePoolV6521[item.key];
    if (reusableCard && reusableCard.classList.contains("customer-match-map-card-v721") !== isCustomerMatchMapCardV721(item)) {
      reusableCard = null;
    }
    if (reusableCard) {
      fragment.appendChild(reusableCard);
      delete listCardReusePoolV6521[item.key];
    } else {
      addListItem(item, fragment);
    }
  }

  list.appendChild(fragment);
  Array.prototype.forEach.call(
    list.querySelectorAll(".unified-expand-btn-v8:not([data-shimmer-observed-v812])"),
    function(button) {
      observeUnifiedDuplicateShimmerV812(button.closest(".item"));
    }
  );
  listRenderLimit = nextLimit;
  if (listRenderLimit >= visibleListItems.length) listCardReusePoolV6521 = null;
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


var unifiedDuplicateShimmerObserverV812 = null;

function resetUnifiedDuplicateShimmerObserverV812() {
  if (unifiedDuplicateShimmerObserverV812) {
    unifiedDuplicateShimmerObserverV812.disconnect();
  }
  Array.prototype.forEach.call(
    document.querySelectorAll(".unified-expand-btn-v8[data-shimmer-observed-v812]"),
    function(button) {
      button.classList.remove("duplicate-shimmer-visible-v812");
      button.removeAttribute("data-shimmer-observed-v812");
    }
  );
  unifiedDuplicateShimmerObserverV812 = null;
}


function observeUnifiedDuplicateShimmerV812(card) {
  if (!card || typeof card.querySelector !== "function") return;
  var button = card.querySelector(".unified-expand-btn-v8");
  if (!button) return;
  if (button.hasAttribute("data-shimmer-observed-v812")) return;
  button.setAttribute("data-shimmer-observed-v812", "1");

  if (!("IntersectionObserver" in window)) {
    button.classList.add("duplicate-shimmer-visible-v812");
    return;
  }

  if (!unifiedDuplicateShimmerObserverV812) {
    unifiedDuplicateShimmerObserverV812 = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        entry.target.classList.toggle("duplicate-shimmer-visible-v812", entry.isIntersecting);
      });
    }, {
      root: null,
      rootMargin: "80px 0px",
      threshold: 0.01
    });
  }

  unifiedDuplicateShimmerObserverV812.observe(button);
}


function showList(items) {
  var list = document.getElementById("list");
  resetUnifiedDuplicateShimmerObserverV812();
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
  var reuseExistingCards = !!window.jsReuseListCardsOnNextRenderV6521;
  window.jsReuseListCardsOnNextRenderV6521 = false;
  listCardReusePoolV6521 = null;

  if (reuseExistingCards && list) {
    listCardReusePoolV6521 = Object.create(null);
    Array.prototype.forEach.call(
      list.querySelectorAll(".item[data-listing-key]"),
      function(card) {
        var key = card.getAttribute("data-listing-key");
        if (!key || listCardReusePoolV6521[key]) return;
        listCardReusePoolV6521[key] = card;
        card.remove();
      }
    );
  }

  visibleListItems = items.slice();
  if (list) list.innerHTML = "";
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

  if (
    window.JSKakaoNavigation &&
    typeof window.JSKakaoNavigation.open === "function"
  ) {
    window.JSKakaoNavigation.open({
      lat: coords.lat,
      lng: coords.lng,
      name: destinationName
    });
    return;
  }

  var fallbackUrl =
    "https://map.kakao.com/link/to/" +
    encodeURIComponent(destinationName) + "," +
    coords.lat + "," +
    coords.lng;

  window.open(fallbackUrl, "_blank", "noopener,noreferrer");
}


var roadviewInstance = null;
var naverRoadviewInstanceV653 = null;
var naverRoadviewMapV654 = null;
var naverRoadviewStreetLayerV654 = null;
var naverRoadviewPositionMarkerV654 = null;
var naverRoadviewTargetMarkerV654 = null;
var naverRoadviewSdkPromiseV653 = null;
var naverRoadviewFallbackTimerV653 = null;
var naverRoadviewLoadingV653 = false;
var kakaoRoadviewLoadingV653 = false;
var roadviewOpenSequenceV653 = 0;
var currentRoadviewCoords = null;
var naverRoadviewRequestSequenceV658 = 0;
var naverRoadviewRequestReadyV658 = false;
var naverRoadviewCandidateIndexV658 = 0;
var naverRoadviewCandidatesV658 = [];
var naverRoadviewRetryTimerV658 = null;
var naverRoadviewListenersBoundV658 = false;
var naverRoadviewActiveTargetKeyV658 = "";
var naverRoadviewLastTargetKeyV658 = "";


function buildNaverRoadviewDirectionIconV654(pan) {
  var direction = Number(pan || 0);
  if (!isFinite(direction)) direction = 0;

  return {
    content:
      '<div class="naver-roadview-direction-marker-v654" aria-label="현재 거리뷰 위치와 방향">' +
        '<span class="naver-roadview-direction-cone-v654" style="transform:rotate(' + direction + 'deg)"></span>' +
        '<span class="naver-roadview-direction-person-v654">●</span>' +
      '</div>',
    anchor: new window.naver.maps.Point(24, 24)
  };
}


function getNaverRoadviewPositionV654() {
  if (!naverRoadviewInstanceV653) return null;

  try {
    var location = naverRoadviewInstanceV653.getLocation();
    if (location && location.coord) return location.coord;
  } catch (error) {}

  try {
    return naverRoadviewInstanceV653.getPosition();
  } catch (error) {
    return null;
  }
}


function updateNaverRoadviewDirectionV654() {
  if (!naverRoadviewInstanceV653 || !naverRoadviewPositionMarkerV654) return;

  var pov = null;
  try {
    pov = naverRoadviewInstanceV653.getPov();
  } catch (error) {
    pov = null;
  }

  try {
    naverRoadviewPositionMarkerV654.setIcon(
      buildNaverRoadviewDirectionIconV654(pov && pov.pan)
    );
  } catch (error) {}
}


function updateNaverRoadviewMapV654(moveCenter) {
  if (!naverRoadviewMapV654 || !naverRoadviewPositionMarkerV654) return;

  var position = getNaverRoadviewPositionV654();
  if (!position) return;

  try {
    naverRoadviewPositionMarkerV654.setPosition(position);
    if (moveCenter !== false) naverRoadviewMapV654.panTo(position);
  } catch (error) {}

  updateNaverRoadviewDirectionV654();
}


function setupNaverRoadviewMapV654(position) {
  var mapContainer = document.getElementById("naverRoadviewMapV654");
  if (!mapContainer || !window.naver || !window.naver.maps || !position) return;

  var targetPosition = currentRoadviewCoords
    ? new window.naver.maps.LatLng(
        currentRoadviewCoords.lat,
        currentRoadviewCoords.lng
      )
    : position;

  if (naverRoadviewMapV654) {
    try {
      if (naverRoadviewTargetMarkerV654) {
        naverRoadviewTargetMarkerV654.setPosition(targetPosition);
      }
      naverRoadviewMapV654.panTo(position);
    } catch (error) {}
    updateNaverRoadviewMapV654(true);
    return;
  }

  mapContainer.innerHTML = "";
  naverRoadviewMapV654 = new window.naver.maps.Map(mapContainer, {
    center: position,
    zoom: 17,
    zoomControl: true,
    zoomControlOptions: {
      position: window.naver.maps.Position.TOP_LEFT,
      style: window.naver.maps.ZoomControlStyle.SMALL
    },
    scaleControl: false,
    mapDataControl: false
  });

  naverRoadviewStreetLayerV654 = new window.naver.maps.StreetLayer();
  window.naver.maps.Event.once(naverRoadviewMapV654, "init", function() {
    if (naverRoadviewStreetLayerV654 && naverRoadviewMapV654) {
      naverRoadviewStreetLayerV654.setMap(naverRoadviewMapV654);
    }
  });

  naverRoadviewPositionMarkerV654 = new window.naver.maps.Marker({
    map: naverRoadviewMapV654,
    position: position,
    zIndex: 220,
    icon: buildNaverRoadviewDirectionIconV654(0)
  });

  naverRoadviewTargetMarkerV654 = new window.naver.maps.Marker({
    map: naverRoadviewMapV654,
    position: targetPosition,
    zIndex: 180,
    title: "매물 위치",
    icon: {
      content:
        '<div class="naver-roadview-target-marker-v654" aria-label="매물 위치">' +
          '<span></span>' +
        '</div>',
      anchor: new window.naver.maps.Point(15, 36)
    }
  });

  window.naver.maps.Event.addListener(naverRoadviewMapV654, "click", function(event) {
    if (!naverRoadviewInstanceV653 || !event || !event.coord) return;
    try {
      naverRoadviewInstanceV653.setPosition(event.coord);
    } catch (error) {}
  });

  window.setTimeout(function() {
    if (naverRoadviewStreetLayerV654 && naverRoadviewMapV654) {
      try {
        naverRoadviewStreetLayerV654.setMap(naverRoadviewMapV654);
      } catch (error) {}
    }
  }, 120);
}


function syncNaverRoadviewLayoutV654() {
  var panoramaContainer = document.getElementById("naverRoadviewContainer");
  if (
    panoramaContainer &&
    naverRoadviewInstanceV653 &&
    window.naver &&
    window.naver.maps
  ) {
    try {
      naverRoadviewInstanceV653.setSize(
        new window.naver.maps.Size(
          panoramaContainer.clientWidth,
          panoramaContainer.clientHeight
        )
      );
    } catch (error) {}
  }

  if (naverRoadviewMapV654 && window.naver && window.naver.maps) {
    try {
      window.naver.maps.Event.trigger(naverRoadviewMapV654, "resize");
    } catch (error) {}
    updateNaverRoadviewMapV654(false);
  }
}


function destroyNaverRoadviewMapV654() {
  if (window.naver && window.naver.maps && window.naver.maps.Event) {
    try {
      if (naverRoadviewMapV654) {
        window.naver.maps.Event.clearInstanceListeners(naverRoadviewMapV654);
      }
    } catch (error) {}
  }

  try {
    if (naverRoadviewStreetLayerV654) naverRoadviewStreetLayerV654.setMap(null);
    if (naverRoadviewPositionMarkerV654) naverRoadviewPositionMarkerV654.setMap(null);
    if (naverRoadviewTargetMarkerV654) naverRoadviewTargetMarkerV654.setMap(null);
  } catch (error) {}

  naverRoadviewMapV654 = null;
  naverRoadviewStreetLayerV654 = null;
  naverRoadviewPositionMarkerV654 = null;
  naverRoadviewTargetMarkerV654 = null;

  var mapContainer = document.getElementById("naverRoadviewMapV654");
  if (mapContainer) mapContainer.innerHTML = "";
}


if (!window.__jsNaverRoadviewResizeBoundV654) {
  window.addEventListener("resize", function() {
    var modal = document.querySelector("#roadviewModal.roadview-modal.open");
    if (!modal || currentRoadviewMode !== "naver") return;
    window.setTimeout(syncNaverRoadviewLayoutV654, 80);
  });
  window.__jsNaverRoadviewResizeBoundV654 = true;
}


function isInvalidNaverMapsKeyV662(value) {
  var normalized = String(value || "").trim().toUpperCase();
  return !normalized || [
    "X-NCP-APIGW-API-KEY-ID",
    "YOUR_CLIENT_ID",
    "YOUR_NCP_KEY_ID",
    "NAVER_MAPS_NCP_KEY_ID",
    "PLACEHOLDER",
    "UNDEFINED",
    "NULL"
  ].indexOf(normalized) >= 0;
}

function loadNaverMapsSdkV653() {
  if (
    window.naver &&
    window.naver.maps &&
    window.naver.maps.Panorama
  ) {
    return Promise.resolve(window.naver.maps);
  }

  if (naverRoadviewSdkPromiseV653) {
    return naverRoadviewSdkPromiseV653.then(function() {
      if (
        window.naver &&
        window.naver.maps &&
        window.naver.maps.Panorama
      ) {
        return window.naver.maps;
      }

      /*
       * Panorama가 닫히는 순간 네이버 SDK 내부 상태가 손상된 경우
       * 이미 완료된 Promise를 다시 쓰지 않고 SDK를 깨끗하게 재요청한다.
       */
      naverRoadviewSdkPromiseV653 = null;
      var staleSdk = document.getElementById("naverMapsSdkV653");
      if (staleSdk) staleSdk.remove();
      document.querySelectorAll('script[src*="maps-panorama.js"]').forEach(function(script) {
        script.remove();
      });
      return loadNaverMapsSdkV653();
    }, function() {
      naverRoadviewSdkPromiseV653 = null;
      return loadNaverMapsSdkV653();
    });
  }

  naverRoadviewSdkPromiseV653 = fetch("/api/naver-maps-config", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin"
  })
    .then(function(response) {
      if (!response.ok) throw new Error("NAVER_MAPS_CONFIG_FAILED");
      return response.json();
    })
    .then(function(config) {
      var ncpKeyId = String(config && config.ncpKeyId || "").trim();
      if (isInvalidNaverMapsKeyV662(ncpKeyId)) {
        throw new Error("NAVER_MAPS_KEY_INVALID");
      }

      return new Promise(function(resolve, reject) {
        var existing = document.getElementById("naverMapsSdkV653");
        var pollId = null;
        var pollStarted = false;
        var timeoutId = setTimeout(function() {
          if (pollId) clearInterval(pollId);
          reject(new Error("NAVER_MAPS_SDK_TIMEOUT"));
        }, 12000);

        function finish() {
          if (
            window.naver &&
            window.naver.maps &&
            window.naver.maps.Panorama
          ) {
            clearTimeout(timeoutId);
            if (pollId) clearInterval(pollId);
            resolve(window.naver.maps);
            return true;
          }
          return false;
        }

        function waitForPanoramaModule() {
          if (finish() || pollStarted) return;
          pollStarted = true;
          pollId = setInterval(finish, 80);
        }

        window.__jsNaverMapsReadyV653 = waitForPanoramaModule;

        if (existing) {
          if (finish()) return;
          waitForPanoramaModule();
          existing.addEventListener("load", function() {
            waitForPanoramaModule();
          }, { once: true });
          existing.addEventListener("error", function() {
            clearTimeout(timeoutId);
            reject(new Error("NAVER_MAPS_SDK_FAILED"));
          }, { once: true });
          return;
        }

        var script = document.createElement("script");
        script.id = "naverMapsSdkV653";
        script.async = true;
        script.defer = true;
        script.src =
          "https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=" +
          encodeURIComponent(ncpKeyId) +
          "&submodules=panorama&callback=__jsNaverMapsReadyV653";
        script.onload = function() {
          waitForPanoramaModule();
        };
        script.onerror = function() {
          clearTimeout(timeoutId);
          reject(new Error("NAVER_MAPS_SDK_FAILED"));
        };
        document.head.appendChild(script);
      });
    })
    .catch(function(error) {
      naverRoadviewSdkPromiseV653 = null;
      throw error;
    });

  return naverRoadviewSdkPromiseV653;
}


function formatNaverPanoramaDateV653(value) {
  var digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return "";
  return digits.slice(0, 4) + "년 " + digits.slice(4, 6) + "월 촬영";
}


function updateNaverPanoramaInfoV653() {
  var info = document.getElementById("naverRoadviewCaptureInfo");
  if (!info || !naverRoadviewInstanceV653) return;

  var location = null;
  try {
    location = naverRoadviewInstanceV653.getLocation();
  } catch (error) {
    location = null;
  }

  var title = String(location && (location.title || location.address) || "").trim();
  var captureDate = formatNaverPanoramaDateV653(
    location && (location.photodate || location.photoDate || location.date)
  );

  if (!title && !captureDate) {
    info.hidden = true;
    info.textContent = "";
    return;
  }

  info.innerHTML =
    (title ? '<strong class="naver-roadview-capture-title-v653">' + escapeHtml(title) + "</strong>" : "") +
    (captureDate ? '<span class="naver-roadview-capture-date-v653">' + escapeHtml(captureDate) + " (최신)</span>" : "");
  info.hidden = false;
}


function clearNaverRoadviewTimersV658() {
  if (naverRoadviewFallbackTimerV653) {
    clearTimeout(naverRoadviewFallbackTimerV653);
    naverRoadviewFallbackTimerV653 = null;
  }
  if (naverRoadviewRetryTimerV658) {
    clearTimeout(naverRoadviewRetryTimerV658);
    naverRoadviewRetryTimerV658 = null;
  }
}


function getNaverRoadviewTargetKeyV658(coords) {
  if (!coords) return "";
  return Number(coords.lat).toFixed(6) + "," + Number(coords.lng).toFixed(6);
}


function buildNaverRoadviewCandidatesV658(coords) {
  var lat = Number(coords && coords.lat);
  var lng = Number(coords && coords.lng);
  if (!isFinite(lat) || !isFinite(lng)) return [];

  /*
   * 네이버 Panorama.setPosition은 공식적으로 반경 300m의 가장 가까운
   * 거리뷰를 찾습니다. 건물 중심 좌표가 큰 필지 안쪽에 있는 경우를 위해
   * 110m 바깥 네 방향도 순차 확인하되, 첫 좌표를 항상 최우선으로 둡니다.
   */
  var radiusMeters = 110;
  var latDelta = radiusMeters / 111320;
  var lngScale = Math.max(0.2, Math.cos(lat * Math.PI / 180));
  var lngDelta = radiusMeters / (111320 * lngScale);

  return [
    { lat: lat, lng: lng },
    { lat: lat + latDelta, lng: lng },
    { lat: lat, lng: lng + lngDelta },
    { lat: lat - latDelta, lng: lng },
    { lat: lat, lng: lng - lngDelta }
  ];
}


function fallbackNaverRoadviewToKakaoV653(message, sequence) {
  if (sequence !== roadviewOpenSequenceV653) return;

  var modal = document.querySelector("#roadviewModal.roadview-modal");
  var status = document.getElementById("naverRoadviewModalStatus");
  if (!modal || !modal.classList.contains("open")) return;

  naverRoadviewLoadingV653 = false;
  clearNaverRoadviewTimersV658();

  if (status) {
    status.textContent = message || "주변에서 네이버 거리뷰를 찾지 못해 카카오맵으로 전환합니다.";
    status.className = "roadview-inline-status error";
  }

  setTimeout(function() {
    if (
      sequence === roadviewOpenSequenceV653 &&
      modal.classList.contains("open") &&
      currentRoadviewMode === "naver" &&
      !naverRoadviewRequestReadyV658
    ) {
      switchRoadviewMode("kakao");
    }
  }, 250);
}


function markNaverRoadviewReadyV658() {
  var sequence = naverRoadviewRequestSequenceV658;
  if (
    sequence !== roadviewOpenSequenceV653 ||
    currentRoadviewMode !== "naver"
  ) return;

  var modal = document.querySelector("#roadviewModal.roadview-modal.open");
  var status = document.getElementById("naverRoadviewModalStatus");
  if (!modal || !status || !naverRoadviewInstanceV653) return;

  var panoId = "";
  try {
    panoId = String(naverRoadviewInstanceV653.getPanoId() || "");
  } catch (error) {}
  if (!panoId) return;

  naverRoadviewRequestReadyV658 = true;
  naverRoadviewLoadingV653 = false;
  naverRoadviewLastTargetKeyV658 = naverRoadviewActiveTargetKeyV658;
  clearNaverRoadviewTimersV658();

  status.textContent = "네이버 거리뷰 연결 완료";
  status.className = "roadview-inline-status success";
  updateNaverPanoramaInfoV653();

  var panoramaPosition = getNaverRoadviewPositionV654();
  if (panoramaPosition) setupNaverRoadviewMapV654(panoramaPosition);
  updateNaverRoadviewMapV654(true);
  window.setTimeout(syncNaverRoadviewLayoutV654, 30);
  window.setTimeout(syncNaverRoadviewLayoutV654, 120);
  setTimeout(function() {
    if (sequence === roadviewOpenSequenceV653) status.classList.add("hidden");
  }, 650);
}


function tryNextNaverRoadviewCandidateV658() {
  var sequence = naverRoadviewRequestSequenceV658;
  if (
    naverRoadviewRequestReadyV658 ||
    sequence !== roadviewOpenSequenceV653 ||
    currentRoadviewMode !== "naver"
  ) return;

  var nextIndex = naverRoadviewCandidateIndexV658 + 1;
  if (nextIndex >= naverRoadviewCandidatesV658.length) {
    fallbackNaverRoadviewToKakaoV653(
      "주변 4방향까지 확인했지만 네이버 거리뷰가 없어 카카오맵으로 전환합니다.",
      sequence
    );
    return;
  }

  naverRoadviewCandidateIndexV658 = nextIndex;
  var next = naverRoadviewCandidatesV658[nextIndex];
  var status = document.getElementById("naverRoadviewModalStatus");
  if (status) {
    status.textContent = "주변 네이버 거리뷰를 확인하고 있습니다. " + nextIndex + "/4";
    status.className = "roadview-inline-status loading";
  }

  if (naverRoadviewRetryTimerV658) clearTimeout(naverRoadviewRetryTimerV658);
  naverRoadviewRetryTimerV658 = setTimeout(function() {
    if (
      !naverRoadviewInstanceV653 ||
      sequence !== roadviewOpenSequenceV653 ||
      naverRoadviewRequestReadyV658
    ) return;
    try {
      naverRoadviewInstanceV653.setPosition(
        new window.naver.maps.LatLng(next.lat, next.lng)
      );
    } catch (error) {
      tryNextNaverRoadviewCandidateV658();
    }
  }, 70);
}


function bindNaverRoadviewEventsV658() {
  if (
    naverRoadviewListenersBoundV658 ||
    !naverRoadviewInstanceV653 ||
    !window.naver ||
    !window.naver.maps
  ) return;

  naverRoadviewListenersBoundV658 = true;
  window.naver.maps.Event.addListener(
    naverRoadviewInstanceV653,
    "pano_status",
    function(panoStatus) {
      var statusValue = String(
        panoStatus && (panoStatus.status || panoStatus.data) || panoStatus || ""
      ).toUpperCase();
      if (statusValue === "OK") {
        markNaverRoadviewReadyV658();
      } else if (statusValue === "ERROR") {
        if (naverRoadviewRequestReadyV658) {
          var status = document.getElementById("naverRoadviewModalStatus");
          if (status) {
            status.textContent = "선택한 위치에는 네이버 거리뷰가 없습니다.";
            status.className = "roadview-inline-status error";
          }
          return;
        }
        tryNextNaverRoadviewCandidateV658();
      }
    }
  );

  window.naver.maps.Event.addListener(
    naverRoadviewInstanceV653,
    "pano_changed",
    function() {
      markNaverRoadviewReadyV658();
      updateNaverPanoramaInfoV653();
      updateNaverRoadviewMapV654(true);
    }
  );

  window.naver.maps.Event.addListener(
    naverRoadviewInstanceV653,
    "pov_changed",
    function() {
      updateNaverRoadviewDirectionV654();
    }
  );

  window.naver.maps.Event.addListener(
    naverRoadviewInstanceV653,
    "init",
    function() {
      markNaverRoadviewReadyV658();
      updateNaverPanoramaInfoV653();
      updateNaverRoadviewMapV654(true);
    }
  );
}


function prepareNaverRoadviewRequestV658(sequence) {
  naverRoadviewRequestSequenceV658 = sequence;
  naverRoadviewRequestReadyV658 = false;
  naverRoadviewCandidateIndexV658 = 0;
  naverRoadviewCandidatesV658 = buildNaverRoadviewCandidatesV658(currentRoadviewCoords);
  naverRoadviewActiveTargetKeyV658 = getNaverRoadviewTargetKeyV658(currentRoadviewCoords);
  clearNaverRoadviewTimersV658();

  naverRoadviewFallbackTimerV653 = setTimeout(function() {
    if (
      sequence === roadviewOpenSequenceV653 &&
      !naverRoadviewRequestReadyV658
    ) {
      fallbackNaverRoadviewToKakaoV653(
        "네이버 거리뷰 응답이 지연되어 카카오맵으로 전환합니다.",
        sequence
      );
    }
  }, 6500);
}


function startNaverRoadviewV653(sequence) {
  var modal = document.querySelector("#roadviewModal.roadview-modal");
  var container = document.getElementById("naverRoadviewContainer");
  var status = document.getElementById("naverRoadviewModalStatus");

  if (
    !modal ||
    !container ||
    !status ||
    !currentRoadviewCoords ||
    !modal.classList.contains("open") ||
    sequence !== roadviewOpenSequenceV653
  ) return;

  if (naverRoadviewLoadingV653 && naverRoadviewRequestSequenceV658 === sequence) return;
  naverRoadviewLoadingV653 = true;
  status.textContent = "네이버 최신 거리뷰를 찾고 있습니다.";
  status.className = "roadview-inline-status loading";
  prepareNaverRoadviewRequestV658(sequence);

  loadNaverMapsSdkV653()
    .then(function() {
      if (
        sequence !== roadviewOpenSequenceV653 ||
        !modal.classList.contains("open") ||
        currentRoadviewMode !== "naver"
      ) {
        naverRoadviewLoadingV653 = false;
        return;
      }

      var position = new window.naver.maps.LatLng(
        currentRoadviewCoords.lat,
        currentRoadviewCoords.lng
      );

      if (!naverRoadviewInstanceV653) {
        container.innerHTML = "";
        naverRoadviewListenersBoundV658 = false;
        naverRoadviewInstanceV653 = new window.naver.maps.Panorama(container, {
          position: position,
          pov: { pan: 0, tilt: -7, fov: 95 },
          flightSpot: true,
          aroundControl: true,
          zoomControl: true,
          visible: true
        });
        bindNaverRoadviewEventsV658();
        window.setTimeout(markNaverRoadviewReadyV658, 0);
      } else {
        bindNaverRoadviewEventsV658();
        syncNaverRoadviewLayoutV654();

        if (
          naverRoadviewLastTargetKeyV658 === naverRoadviewActiveTargetKeyV658
        ) {
          markNaverRoadviewReadyV658();
        } else {
          try {
            naverRoadviewInstanceV653.setPosition(position);
          } catch (error) {
            tryNextNaverRoadviewCandidateV658();
          }
        }
      }

      window.setTimeout(syncNaverRoadviewLayoutV654, 30);
    })
    .catch(function(error) {
      if (window.console && typeof window.console.error === "function") {
        window.console.error("[JS roadview] NAVER panorama failed", error);
      }
      fallbackNaverRoadviewToKakaoV653(
        "네이버 거리뷰를 불러오지 못해 카카오맵으로 전환합니다.",
        sequence
      );
    });
}


function warmNaverRoadviewSdkV658() {
  loadNaverMapsSdkV653().catch(function() {
    /* 첫 클릭에서 다시 시도하므로 사전 준비 실패는 화면에 노출하지 않습니다. */
  });
}


if (!window.__jsNaverRoadviewWarmupBoundV658) {
  window.addEventListener("load", function() {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(warmNaverRoadviewSdkV658, { timeout: 1200 });
    } else {
      window.setTimeout(warmNaverRoadviewSdkV658, 500);
    }
  }, { once: true });
  window.__jsNaverRoadviewWarmupBoundV658 = true;
}


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
    switchRoadviewMode("naver");
  });
}


function switchRoadviewMode(mode) {
  var naverPane = document.getElementById("naverRoadviewPane");
  var roadviewPane = document.getElementById("roadviewPane");
  var mapPane = document.getElementById("roadviewMapPane");
  var naverButton = document.getElementById("naverRoadviewTabBtn");
  var roadviewButton = document.getElementById("roadviewTabBtn");
  var mapButton = document.getElementById("roadviewMapTabBtn");

  if (
    !naverPane ||
    !roadviewPane ||
    !mapPane ||
    !naverButton ||
    !roadviewButton ||
    !mapButton
  ) return;

  if (mode === "roadview") mode = "kakao";
  currentRoadviewMode = ["naver", "kakao", "map"].indexOf(mode) >= 0
    ? mode
    : "naver";
  var naverActive = currentRoadviewMode === "naver";
  var kakaoActive = currentRoadviewMode === "kakao";
  var mapActive = currentRoadviewMode === "map";

  naverPane.classList.toggle("active", naverActive);
  roadviewPane.classList.toggle("active", kakaoActive);
  mapPane.classList.toggle("active", mapActive);
  naverButton.classList.toggle("active", naverActive);
  roadviewButton.classList.toggle("active", kakaoActive);
  mapButton.classList.toggle("active", mapActive);
  naverButton.setAttribute("aria-selected", naverActive ? "true" : "false");
  roadviewButton.setAttribute("aria-selected", kakaoActive ? "true" : "false");
  mapButton.setAttribute("aria-selected", mapActive ? "true" : "false");

  if (naverActive) {
    startNaverRoadviewV653(roadviewOpenSequenceV653);
  }

  if (kakaoActive) {
    startKakaoRoadviewV653(roadviewOpenSequenceV653);
  }

  if (mapActive && !roadviewFullMap && roadviewTargetPosition) {
    setupRoadviewFullMap(roadviewTargetPosition);
  }

  if (mapActive && roadviewFullMap && roadviewTargetPosition) {
    setTimeout(function() {
      roadviewFullMap.relayout();
      roadviewFullMap.setCenter(roadviewTargetPosition);
      roadviewFullMap.setLevel(3);
    }, 60);
  }

  if (kakaoActive && roadviewInstance) {
    setTimeout(function() {
      if (typeof roadviewInstance.relayout === "function") {
        roadviewInstance.relayout();
      }
      updateRoadviewTargetPin();
    }, 60);
  }

  if (naverActive && naverRoadviewInstanceV653 && window.naver && window.naver.maps) {
    setTimeout(function() {
      syncNaverRoadviewLayoutV654();
    }, 60);
    setTimeout(syncNaverRoadviewLayoutV654, 220);
  }
}


function startKakaoRoadviewV653(sequence) {
  var modal = document.querySelector("#roadviewModal.roadview-modal");
  var container = document.getElementById("roadviewContainer");
  var status = document.getElementById("roadviewModalStatus");

  if (
    !modal ||
    !container ||
    !status ||
    !currentRoadviewPosition ||
    !modal.classList.contains("open") ||
    sequence !== roadviewOpenSequenceV653
  ) return;

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

  if (roadviewInstance) {
    setTimeout(function() {
      if (roadviewInstance && typeof roadviewInstance.relayout === "function") {
        roadviewInstance.relayout();
      }
    }, 60);
    return;
  }

  if (kakaoRoadviewLoadingV653) return;
  kakaoRoadviewLoadingV653 = true;
  status.textContent = "가장 가까운 카카오 로드뷰를 찾고 있습니다.";
  status.className = "roadview-inline-status loading";

  var roadviewClient = new kakao.maps.RoadviewClient();
  roadviewClient.getNearestPanoId(currentRoadviewPosition, 150, function(panoId) {
    if (
      sequence !== roadviewOpenSequenceV653 ||
      !modal.classList.contains("open")
    ) return;

    kakaoRoadviewLoadingV653 = false;

    if (!panoId) {
      status.textContent = "이 위치 반경 150m 안에서 카카오 로드뷰를 찾지 못했습니다.";
      status.className = "roadview-inline-status error";
      container.innerHTML =
        '<div class="roadview-empty">' +
          '<div class="roadview-empty-icon">🏠</div>' +
          '<div>주변 도로에 카카오 로드뷰가 없을 수 있습니다.</div>' +
        '</div>';
      return;
    }

    container.innerHTML = "";
    roadviewInstance = new kakao.maps.Roadview(container);
    roadviewInstance.setPanoId(panoId, currentRoadviewPosition);

    kakao.maps.event.addListener(roadviewInstance, "viewpoint_changed", function() {
      var viewpoint = roadviewInstance.getViewpoint();
      updateRoadviewDirection(viewpoint ? viewpoint.pan : 0);
    });

    kakao.maps.event.addListener(roadviewInstance, "position_changed", function() {
      updateRoadviewCameraPosition(roadviewInstance.getPosition());
    });

    kakao.maps.event.addListener(roadviewInstance, "init", function() {
      var position = roadviewInstance.getPosition();
      var viewpoint = roadviewInstance.getViewpoint();
      updateRoadviewCameraPosition(position);
      updateRoadviewDirection(viewpoint ? viewpoint.pan : 0);
    });

    status.textContent = "카카오 로드뷰 연결 완료";
    status.className = "roadview-inline-status success";
    setTimeout(function() {
      if (sequence === roadviewOpenSequenceV653) status.classList.add("hidden");
    }, 900);

    setTimeout(function() {
      if (roadviewInstance && typeof roadviewInstance.relayout === "function") {
        roadviewInstance.relayout();
      }
      updateRoadviewTargetPin();
    }, 100);
  });
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
  var naverContainer = document.getElementById("naverRoadviewContainer");
  var title = document.getElementById("roadviewModalTitle");
  var address = document.getElementById("roadviewModalAddress");
  var status = document.getElementById("roadviewModalStatus");
  var naverStatus = document.getElementById("naverRoadviewModalStatus");
  var naverInfo = document.getElementById("naverRoadviewCaptureInfo");

  if (
    !modal ||
    !container ||
    !naverContainer ||
    !title ||
    !address ||
    !status ||
    !naverStatus
  ) {
    alert("거리뷰 화면을 찾지 못했습니다.");
    return;
  }

  roadviewOpenSequenceV653 += 1;
  currentRoadviewItemKey = item.key;
  currentRoadviewCoords = coords;
  currentRoadviewPosition = new kakao.maps.LatLng(coords.lat, coords.lng);

  title.textContent = item.name || "네이버 거리뷰";
  address.textContent = [item.address || "", item.room || ""].filter(Boolean).join(" ");

  status.textContent = "카카오 로드뷰를 준비하고 있습니다.";
  status.className = "roadview-inline-status loading";
  naverStatus.textContent = "네이버 최신 거리뷰를 찾고 있습니다.";
  naverStatus.className = "roadview-inline-status loading";

  container.innerHTML = "";
  if (naverInfo) {
    naverInfo.hidden = true;
    naverInfo.textContent = "";
  }
  roadviewInstance = null;
  naverRoadviewLoadingV653 = false;
  kakaoRoadviewLoadingV653 = false;
  clearNaverRoadviewTimersV658();

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("roadview-modal-open");

  /* 일반 매물목록과 AI 임장 모두 동일한 태블릿 전체화면 보정을 사용합니다. */
  if (typeof window.prepareRoadviewViewport === "function") {
    window.prepareRoadviewViewport();
  }

  roadviewTargetPosition = currentRoadviewPosition;
  roadviewCameraPosition = currentRoadviewPosition;
  currentRoadviewPan = 0;
  currentRoadviewMode = "naver";
  switchRoadviewMode("naver");
}


function openPropertySourceLink(encodedTarget) {
  var item = getPropertyByEncodedKeyV630(encodedTarget);
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
  var naverContainer = document.getElementById("naverRoadviewContainer");
  var naverInfo = document.getElementById("naverRoadviewCaptureInfo");

  if (!modal) return;

  /*
   * 네이버 Panorama는 display:none 상태로 보관했다가 다시 setPosition하면
   * SDK 내부 타이머가 끊길 수 있다. SDK 파일과 보조 지도는 재사용하되,
   * Panorama 인스턴스만 닫을 때 정상 종료하고 다음 매물에서 새로 만든다.
   */
  if (naverRoadviewInstanceV653) {
    try {
      if (window.naver && window.naver.maps && window.naver.maps.Event) {
        window.naver.maps.Event.clearInstanceListeners(naverRoadviewInstanceV653);
      }
      if (typeof naverRoadviewInstanceV653.destroy === "function") {
        naverRoadviewInstanceV653.destroy();
      }
    } catch (error) {}
    naverRoadviewInstanceV653 = null;
    naverRoadviewListenersBoundV658 = false;
  }
  if (naverContainer) naverContainer.innerHTML = "";

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("roadview-modal-open");

  if (container) {
    container.innerHTML = "";
  }

  if (naverInfo) {
    naverInfo.hidden = true;
    naverInfo.textContent = "";
  }

  roadviewOpenSequenceV653 += 1;
  clearNaverRoadviewTimersV658();
  naverRoadviewRequestReadyV658 = false;
  naverRoadviewRequestSequenceV658 = roadviewOpenSequenceV653;
  roadviewInstance = null;
  naverRoadviewLoadingV653 = false;
  kakaoRoadviewLoadingV653 = false;
  roadviewFullMap = null;
  roadviewFullMapMarker = null;
  roadviewTargetPosition = null;
  roadviewCameraPosition = null;
  currentRoadviewPan = 0;
  currentRoadviewMode = "naver";
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


function captureMemoListScrollPosition(anchorKey) {
  var sidebar = document.getElementById("sidebar");
  var anchor = anchorKey
    ? document.querySelector('[data-listing-key="' + CSS.escape(anchorKey) + '"]')
    : null;

  return {
    anchorKey: anchorKey || "",
    anchorTop: anchor && sidebar
      ? anchor.getBoundingClientRect().top - sidebar.getBoundingClientRect().top
      : null,
    sidebarTop: sidebar ? sidebar.scrollTop : 0,
    windowX: window.scrollX || 0,
    windowY: window.scrollY || 0
  };
}


function restoreMemoListScrollPosition(position) {
  if (!position) return;

  function restore() {
    var sidebar = document.getElementById("sidebar");

    if (sidebar) {
      var anchor = position.anchorKey
        ? document.querySelector('[data-listing-key="' + CSS.escape(position.anchorKey) + '"]')
        : null;

      if (anchor && position.anchorTop != null) {
        var currentTop =
          anchor.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
        sidebar.scrollTop += currentTop - position.anchorTop;
      } else {
        sidebar.scrollTop = position.sidebarTop;
      }
    }

    if (
      window.scrollX !== position.windowX ||
      window.scrollY !== position.windowY
    ) {
      window.scrollTo(position.windowX, position.windowY);
    }
  }

  requestAnimationFrame(function() {
    restore();
    requestAnimationFrame(restore);
  });
}


function showMemoListKeepingPosition(anchorKey) {
  refreshMemoCardV655(anchorKey, false);
}

function toggleItemMemo(encodedKey, sourceButton) {
  var key = decodeURIComponent(encodedKey);
  var previousOpenKey = openMemoKey;
  var previousOpenCard = activeMemoCardV728;
  var clickedCard = sourceButton && sourceButton.closest
    ? sourceButton.closest('.item[data-listing-key]')
    : null;
  var closingCurrent = openMemoKey === key &&
    (!clickedCard || !previousOpenCard || clickedCard === previousOpenCard);

  openMemoKey = closingCurrent ? null : key;
  activeMemoCardV728 = closingCurrent ? null : clickedCard;
  editingMemoKey = null;
  memoEditMode = "replace";
  delete memoDraftValuesV655[key];

  if (previousOpenKey && previousOpenCard &&
      (previousOpenKey !== key || previousOpenCard !== clickedCard || closingCurrent)) {
    refreshMemoCardV655(previousOpenKey, false, previousOpenCard, false);
  }
  if (!closingCurrent) {
    refreshMemoCardV655(key, false, clickedCard, true);
  }
}


function beginMemoEdit(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var previousOpenKey = openMemoKey;

  editingMemoKey = key;
  memoEditMode = "replace";
  openMemoKey = key;
  delete memoDraftValuesV655[key];
  delete memoStatusMessagesV655[key];

  if (previousOpenKey && previousOpenKey !== key) {
    refreshMemoCardV655(previousOpenKey, false);
  }
  refreshMemoCardV655(key, true);
}


function beginMemoAdd(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var previousOpenKey = openMemoKey;

  editingMemoKey = key;
  memoEditMode = "append";
  openMemoKey = key;
  memoDraftValuesV655[key] = "";
  delete memoStatusMessagesV655[key];

  if (previousOpenKey && previousOpenKey !== key) {
    refreshMemoCardV655(previousOpenKey, false);
  }
  refreshMemoCardV655(key, true);
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
  var key = editingMemoKey || openMemoKey;
  editingMemoKey = null;
  memoEditMode = "replace";
  delete memoDraftValuesV655[key];
  delete memoStatusMessagesV655[key];
  refreshMemoCardV655(key, false);
}


function autoResizeMemoEditor(element) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = element.scrollHeight + "px";
}


function getMemoItemV655(key) {
  return (allItems || []).find(function(item) {
    return item && item.key === key;
  }) || (visibleListItems || []).find(function(item) {
    return item && item.key === key;
  }) || null;
}


function getMemoCardV655(key, preferredCard) {
  if (!key) return null;
  if (preferredCard && preferredCard.isConnected &&
      preferredCard.getAttribute("data-listing-key") === key) {
    return preferredCard;
  }
  if (activeMemoCardV728 && activeMemoCardV728.isConnected &&
      activeMemoCardV728.getAttribute("data-listing-key") === key) {
    return activeMemoCardV728;
  }
  var cards = Array.from(document.querySelectorAll(
    '.item[data-listing-key="' + CSS.escape(key) + '"]'
  ));
  return cards.find(function(card) { return card.offsetParent !== null; }) || cards[0] || null;
}


function memoStatusMarkupV655(key) {
  var status = memoStatusMessagesV655[key];
  if (!status || !status.text) return "";
  return '<span class="memo-inline-status ' +
    escapeHtml(status.tone || "info") + '">' +
    escapeHtml(status.text) +
  '</span>';
}


function buildMemoPanelMarkupV655(item) {
  if (!item) return "";
  var key = item.key;
  var encodedKey = encodeURIComponent(key);
  var safeKey = escapeHtml(key);
  var saving = !!memoSavePendingKeysV655[key];
  var statusMarkup = memoStatusMarkupV655(key);

  if (editingMemoKey === key) {
    var hasDraft = Object.prototype.hasOwnProperty.call(memoDraftValuesV655, key);
    var editorValue = hasDraft
      ? memoDraftValuesV655[key]
      : (memoEditMode === "append" ? "" : item.memo || "");
    var placeholder = memoEditMode === "append"
      ? "추가할 메모를 입력하세요."
      : "메모를 입력하세요.";

    return '<div class="item-memo-panel editing" onclick="event.stopPropagation()">' +
      '<textarea class="item-memo-editor" data-memo-editor-key="' + safeKey + '" ' +
        'placeholder="' + escapeHtml(placeholder) + '" ' +
        'oninput="memoDraftValuesV655[decodeURIComponent(\'' + encodedKey +
          '\')]=this.value; autoResizeMemoEditor(this)">' +
        escapeHtml(editorValue) +
      '</textarea>' +
      '<div class="item-memo-actions">' +
        statusMarkup +
        '<button type="button" class="memo-save-btn" data-memo-save-key="' + safeKey + '" ' +
          (saving ? 'disabled ' : '') +
          'onclick="saveItemMemo(\'' + encodedKey + '\')">' +
          (saving ? "저장중" : "저장") +
        '</button>' +
        '<button type="button" class="memo-cancel-btn" ' +
          (saving ? 'disabled ' : '') +
          'onclick="cancelMemoEdit()">취소</button>' +
      '</div>' +
    '</div>';
  }

  return '<div class="item-memo-panel" onclick="event.stopPropagation()">' +
    '<div class="item-memo-content">' +
      (item.memo
        ? escapeHtml(item.memo)
        : '<span class="memo-empty">메모가 없습니다.</span>') +
    '</div>' +
    '<div class="item-memo-actions">' +
      statusMarkup +
      '<button type="button" class="memo-edit-btn" ' +
        (saving ? 'disabled ' : '') +
        'onclick="beginMemoEdit(\'' + encodedKey + '\')">수정</button>' +
      '<button type="button" class="memo-add-btn" ' +
        (saving ? 'disabled ' : '') +
        'onclick="beginMemoAdd(\'' + encodedKey + '\')">추가하기</button>' +
    '</div>' +
  '</div>';
}


function focusMemoEditorV655(key) {
  requestAnimationFrame(function() {
    var card = getMemoCardV655(key);
    var editor = card && card.querySelector(
      '[data-memo-editor-key="' + CSS.escape(key) + '"]'
    );
    if (!editor) return;
    try {
      editor.focus({ preventScroll: true });
    } catch (_) {
      editor.focus();
    }
    autoResizeMemoEditor(editor);
  });
}


function refreshMemoCardV655(key, focusEditor, preferredCard, forceOpen) {
  var card = getMemoCardV655(key, preferredCard);
  if (!card) return;
  var item = getMemoItemV655(key);
  var isOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : openMemoKey === key && (!activeMemoCardV728 || card === activeMemoCardV728);
  var toggle = card.querySelector(".item-memo-toggle");
  var panel = card.querySelector(".item-memo-panel");

  card.classList.toggle("memo-open", isOpen);
  if (toggle) {
    toggle.classList.toggle("on", isOpen);
    toggle.setAttribute("title", "메모 " + (isOpen ? "닫기" : "열기"));
    toggle.setAttribute("aria-label", "메모 " + (isOpen ? "닫기" : "열기"));
    toggle.innerHTML = '<span class="item-memo-label-v728">' +
      (isOpen ? '메모 ▲' : '메모 ▼') +
      '</span>';
  }
  if (panel) panel.remove();
  if (isOpen && item) {
    card.insertAdjacentHTML("beforeend", buildMemoPanelMarkupV655(item));
  }
  if (focusEditor && isOpen) focusMemoEditorV655(key);
}


function showMemoStatusV655(key, text, tone, clearAfter) {
  memoStatusMessagesV655[key] = {
    text: String(text || ""),
    tone: String(tone || "info")
  };
  refreshMemoCardV655(key, false);
  if (!clearAfter) return;
  setTimeout(function() {
    var current = memoStatusMessagesV655[key];
    if (!current || current.text !== text || memoSavePendingKeysV655[key]) return;
    delete memoStatusMessagesV655[key];
    refreshMemoCardV655(key, false);
  }, clearAfter);
}


function saveItemMemo(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var item = getMemoItemV655(key);

  var memoCard = getMemoCardV655(key);
  var editor = memoCard && memoCard.querySelector(
    '[data-memo-editor-key="' + CSS.escape(key) + '"]'
  );

  if (!item || !editor) {
    alert("메모 수정 대상을 찾지 못했습니다.");
    return;
  }

  if (!saveApiURL) {
    alert("구글시트 쓰기 연결 URL을 확인해주세요.");
    return;
  }

  if (memoSavePendingKeysV655[key]) return;

  if (!String(item.propertyId || "").trim()) {
    showMemoStatusV655(key, "매물ID가 없어 저장할 수 없습니다.", "error", 0);
    return;
  }

  var enteredMemo = editor.value.trim();
  var previousMemo = item.memo || "";
  var newMemo = enteredMemo;
  var savingMode = memoEditMode;

  if (savingMode === "append") {
    if (!enteredMemo) {
      showMemoStatusV655(key, "추가할 메모를 입력해주세요.", "error", 0);
      return;
    }

    var addedLine = "[" + memoDateLabel() + "] " + enteredMemo;
    newMemo = previousMemo
      ? previousMemo.replace(/\s+$/, "") + "\n" + addedLine
      : addedLine;
  }

  memoSavePendingKeysV655[key] = {
    previousMemo: previousMemo,
    enteredMemo: enteredMemo,
    mode: savingMode
  };
  item.memo = newMemo;
  editingMemoKey = null;
  memoEditMode = "replace";
  delete memoDraftValuesV655[key];
  memoStatusMessagesV655[key] = { text: "저장 중…", tone: "saving" };
  refreshMemoCardV655(key, false);

  var payload = {
    key: {
      propertyId: item.propertyId || ""
    },
    memo: newMemo,
    contacts: extractListContactsV650(item).map(function(contact) {
      return { role: contact.role, phone: contact.phone.display };
    })
  };

  postSafeMutationV654("updatePropertyMemo", payload).then(function(result) {
    if (!result || result.persisted !== true) {
      throw new Error("메모 저장값을 시트에서 재확인하지 못했습니다.");
    }
    var savedPhoneKeys = Object.create(null);
    (Array.isArray(result && result.contacts) ? result.contacts : []).forEach(function(contact) {
      var savedPhone = normalizeListPhoneV650(contact && (contact.phone || contact.number));
      if (savedPhone) savedPhoneKeys[savedPhone.key] = true;
    });
    var missingContact = payload.contacts.find(function(contact) {
      var expectedPhone = normalizeListPhoneV650(contact && contact.phone);
      return expectedPhone && !savedPhoneKeys[expectedPhone.key];
    });
    if (missingContact) {
      throw new Error("메모의 연락처가 시트 연락처목록에 저장되지 않아 메모 정리를 중단했습니다.");
    }
    if (Array.isArray(result && result.contacts)) {
      item.contactListRaw = JSON.stringify(result.contacts);
    }
    if (result && typeof result.memo === "string") {
      item.memo = result.memo;
    }
    delete memoSavePendingKeysV655[key];
    delete memoDraftValuesV655[key];
    editingMemoKey = null;
    memoEditMode = "replace";
    memoStatusMessagesV655[key] = { text: "저장완료", tone: "success" };
    refreshMemoCardV655(key, false);
    showMemoStatusV655(key, "저장완료", "success", 1400);
    document.getElementById("status").innerHTML = "메모 저장완료";
  }).catch(function(error) {
    console.error(error);
    var pending = memoSavePendingKeysV655[key] || {
      previousMemo: previousMemo,
      enteredMemo: enteredMemo,
      mode: savingMode
    };
    item.memo = pending.previousMemo;
    delete memoSavePendingKeysV655[key];
    memoDraftValuesV655[key] = pending.enteredMemo;
    memoStatusMessagesV655[key] = {
      text: error && error.message
        ? error.message
        : "메모 저장에 실패했습니다.",
      tone: "error"
    };
    openMemoKey = key;
    editingMemoKey = key;
    memoEditMode = pending.mode || "replace";
    refreshMemoCardV655(key, true);
    document.getElementById("status").innerHTML = "메모 저장 실패 · 입력내용 유지";
  });
}


function getCustomerMatchStatus(item, cardContext) {
  if (cardContext && cardContext.status) return String(cardContext.status).trim();
  var propertyId = String(item && item.propertyId || "").trim();
  return propertyId && window.operationsMatchStatusByPropertyId
    ? String(window.operationsMatchStatusByPropertyId[propertyId] || "").trim()
    : "";
}

function buildCustomerMatchInlineControls(item, cardContext) {
  var propertyId = String(item && item.propertyId || "").trim();
  var status = getCustomerMatchStatus(item, cardContext);
  if (!propertyId || !status) return "";
  var encodedId = encodeURIComponent(propertyId);
  var introduced = status === "소개";
  var held = status === "보류";
  var operationHandler = cardContext
    ? "handleOperationsCustomerMatchToggleV719(this,'" + encodeURIComponent(cardContext.matchId || "") + "','" + encodeURIComponent(cardContext.customerId || "") + "','" + encodeURIComponent(cardContext.propertyId || propertyId) + "',"
    : "handleCustomerMatchListAction(this,'" + encodedId + "',";
  return '<div class="customer-match-inline-actions" onclick="event.stopPropagation()">' +
    '<label class="customer-match-choice-v719 introduce' + (introduced ? ' checked' : '') + '"><input type="checkbox"' + (introduced ? ' checked' : '') + ' onchange="' + operationHandler + '\'소개\')"><span>후보</span></label>' +
    '<label class="customer-match-choice-v719 hold' + (held ? ' checked' : '') + '"><input type="checkbox"' + (held ? ' checked' : '') + ' onchange="' + operationHandler + '\'보류\')"><span>보류</span></label>' +
  '</div>';
}

window.handleCustomerMatchListAction = function(button, encodedPropertyId, selectedStatus) {
  var propertyId = decodeURIComponent(encodedPropertyId || "");
  if (!propertyId || typeof window.updateCustomerMatchFromMap !== "function") return;
  var currentStatus = getCustomerMatchStatus({propertyId: propertyId});
  var nextStatus = button && button.checked ? selectedStatus : (currentStatus === selectedStatus ? "신규" : currentStatus);
  if (!nextStatus || nextStatus === currentStatus) return;
  var card = button && button.closest ? button.closest(".customer-match-map-card-v721") : null;
  function applyCardStatusVisualV722(status) {
    if (!card) return;
    card.classList.toggle("customer-match-new", status === "신규");
    card.classList.toggle("customer-match-introduced", status === "소개");
    card.classList.toggle("customer-match-held", status === "보류");
    card.querySelectorAll(".customer-match-choice-v719").forEach(function(label) {
      var input = label.querySelector('input[type="checkbox"]');
      var labelStatus = label.classList.contains("introduce") ? "소개" : "보류";
      var checked = labelStatus === status;
      if (input) input.checked = checked;
      label.classList.toggle("checked", checked);
    });
  }
  applyCardStatusVisualV722(nextStatus);
  button.disabled = true;
  window.updateCustomerMatchFromMap(propertyId, nextStatus)
    .then(function() {
      if (button && button.isConnected) button.disabled = false;
    })
    .catch(function(error) {
      applyCardStatusVisualV722(currentStatus);
      if (button && button.isConnected) button.disabled = false;
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
  "가": { short: "가", name: "가족", priority: 70 },
  "기": { short: "기", name: "기타", priority: 10 }
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
  if (/^(기타|기)$/.test(label)) return "기";
  return "기";
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

  var storedContacts = item && item.contactListRaw;
  if (typeof storedContacts === "string" && storedContacts.trim()) {
    try {
      storedContacts = JSON.parse(storedContacts);
    } catch (_) {
      storedContacts = [];
    }
  }
  if (Array.isArray(storedContacts)) {
    storedContacts.forEach(function(contact) {
      add(contact && contact.role, contact && (contact.phone || contact.number));
    });
  }

  var memo = String(item && item.memo || "");
  var rolePattern = "(주인|건물주|소유자|임대인|사장|남성|남자|사모|여성|여자|관리업체|관리인|관리|부동산|중개사|중개|세입자|임차인|임차|가족|주|임|남|여|관|부|세|가)";
  var roleBoundary = "(?:^|[\\s\\(\\[\\{,;:：·/\\.\\-!?。])";
  var phonePattern = "(0(?:10|11|16|17|18|19)[-\\s]?\\d{3,4}[-\\s]?\\d{4}|02[-\\s]?\\d{3,4}[-\\s]?\\d{4}|0(?:[3-6][1-5]|70)[-\\s]?\\d{3,4}[-\\s]?\\d{4})";
  var roleBridge = "(?:[\\s\\)\\(\\]:：=.,·-]*(?:(?:추가\\s*)?(?:연락처|번호)|전화번호|전화)?[\\s\\)\\(\\]:：=.,·-]*)";
  var matcher = new RegExp(roleBoundary + rolePattern + roleBridge + phonePattern, "g");
  var match;
  while ((match = matcher.exec(memo))) {
    add(match[1], match[2]);
  }

  var everyPhoneMatcher = new RegExp(phonePattern, "g");
  while ((match = everyPhoneMatcher.exec(memo))) {
    var prefix = memo.slice(Math.max(0, match.index - 18), match.index);
    var roleMatch = prefix.match(new RegExp(roleBoundary + rolePattern + roleBridge + "$"));
    add(roleMatch ? roleMatch[1] : "기", match[1]);
  }

  return contacts.slice(0, 6);
}

function normalizeLinkedGongsilContactsV8(rawContacts) {
  var contacts = [];
  var seen = Object.create(null);
  (Array.isArray(rawContacts) ? rawContacts : []).forEach(function(contact) {
    var phone = normalizeListPhoneV650(contact && contact.phone);
    if (!phone || seen[phone.key]) return;
    seen[phone.key] = true;
    contacts.push({
      role: listContactRoleV650(contact && contact.role),
      phone: phone,
      origin: "gongsil",
      source: "공실박스",
      sourceId: String(contact && contact.sourceId || "").trim(),
      room: String(contact && contact.room || "").trim(),
      buildingName: String(contact && contact.buildingName || "").trim()
    });
  });
  return contacts;
}

function mergePopupContactsV8(primaryContacts, linkedContacts) {
  var merged = [];
  var seen = Object.create(null);
  (primaryContacts || []).concat(linkedContacts || []).forEach(function(contact) {
    if (!contact || !contact.phone || seen[contact.phone.key]) return;
    seen[contact.phone.key] = true;
    merged.push(contact);
  });
  return merged.slice(0, 6);
}

function renderListContactPopupV8(item, primaryContacts, options) {
  options = options || {};
  var body = document.getElementById("listContactBodyV654");
  if (!body) return;
  var linked = normalizeLinkedGongsilContactsV8(options.linkedContacts || []);
  var contacts = mergePopupContactsV8(primaryContacts, linked);
  var markup = contacts.map(function(contact) {
    var meta = LIST_CONTACT_ROLE_META_V650[contact.role] || LIST_CONTACT_ROLE_META_V650["기"];
    var sourceNote = contact.origin === "gongsil"
      ? '<small class="list-contact-source-v8">공실박스 원본' +
          (contact.room ? ' · ' + escapeHtml(contact.room) : '') + '</small>'
      : '';
    return '<a class="list-contact-row-v654 role-' + escapeHtml(contact.role || "기") +
      '" href="tel:' + contact.phone.tel + '" onclick="event.stopPropagation()">' +
      '<span class="list-contact-role-v654">' + escapeHtml(meta.name) + '</span>' +
      '<span class="list-contact-number-v8"><strong>' + escapeHtml(contact.phone.display) + '</strong>' +
        sourceNote + '</span>' +
      '<span class="list-contact-call-label-v654">전화</span></a>';
  }).join("");
  if (options.loading) {
    markup += '<div class="list-contact-loading-v8">연결된 공실박스 원본 연락처 확인 중…</div>';
  } else if (options.error) {
    markup += '<div class="list-contact-error-v8">' + escapeHtml(options.error) + '</div>';
  }
  body.innerHTML = markup || '<div class="list-contact-empty-v654">등록된 연락처가 없습니다.</div>';
}

function buildCardActionIconV662(type) {
  var icons = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.1 2.8c.5-.3 1.2-.1 1.5.4l2 3.7c.3.5.2 1.1-.2 1.5L8.8 10a13 13 0 0 0 5.2 5.2l1.6-1.6c.4-.4 1-.5 1.5-.2l3.7 2c.5.3.7 1 .4 1.5l-1.4 2.7c-.3.6-.9.9-1.5.9C10.1 19.9 4.1 13.9 3.5 5.7c0-.6.3-1.2.9-1.5l2.7-1.4Z"/></svg>',
    roadview: '<svg viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="7" fill="#ffd154"/><path fill="#168bd2" d="M15 5.2a7.2 7.2 0 0 0-7.2 7.2c0 5 7.2 12.4 7.2 12.4s7.2-7.4 7.2-12.4A7.2 7.2 0 0 0 15 5.2Zm0 10.2a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/></svg>',
    navigation: '<svg viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="7" fill="#ffe100"/><path fill="#2677c9" d="M15 4.3 25 10v11.5L15 27.2 5 21.5V10L15 4.3Z"/><path fill="#ffe100" d="M10 20.5v-6.4c0-1.5 1.2-2.7 2.7-2.7h3.5V8l6.1 5-6.1 5v-3.2h-2.7v5.7H10Z"/></svg>',
    settings: '<svg viewBox="0 0 30 30" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="7" fill="#d8e0e6" stroke="#40515e" stroke-width="1.4"/><path fill="#40515e" d="m16.8 6 .6 2.1c.5.2 1 .5 1.4.8l2.1-.5 1.7 2.9-1.5 1.6v1.7l1.5 1.6-1.7 2.9-2.1-.5c-.4.3-.9.6-1.4.8l-.6 2.1h-3.4l-.6-2.1c-.5-.2-1-.5-1.4-.8l-2.1.5-1.7-2.9 1.5-1.6v-1.7l-1.5-1.6 1.7-2.9 2.1.5c.4-.3.9-.6 1.4-.8l.6-2.1h3.4Zm-1.7 5.1a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Z"/></svg>'
  };
  return '<span class="item-action-icon-v662 item-action-icon-' + type + '-v662">' + (icons[type] || '') + '</span>';
}

function buildFavoriteStarIconV663(active) {
  return '<svg class="favorite-star-icon-v663" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 3.3 14.7 8.8l6 .9-4.35 4.25 1.03 6L12 17.1l-5.38 2.85 1.03-6L3.3 9.7l6-.9L12 3.3Z" ' +
      'fill="' + (active ? '#f7c928' : 'none') + '" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
}

function buildListContactButtonV654(item, encodedTarget, headerPlacement) {
  var contacts = extractListContactsV650(item);
  var hasContacts = contacts.length > 0 || Number(item && item.gongsilContactCountV8) > 0;
  return '<button type="button" class="item-contact-button-v654 ' +
    (hasContacts ? 'has-contacts' : 'no-contacts') +
    (headerPlacement ? ' header-placement' : ' action-placement') +
    '" title="' + (hasContacts ? '연락처 열기' : '등록된 연락처 없음') +
    '" aria-label="' + (hasContacts ? '연락처 열기' : '등록된 연락처 없음') +
    '" onpointerenter="prefetchListContactPopupV654(\'' + encodedTarget + '\')"' +
    ' onfocus="prefetchListContactPopupV654(\'' + encodedTarget + '\')"' +
    ' onclick="event.stopPropagation(); openListContactPopupV654(\'' + encodedTarget + '\')">' +
    buildCardActionIconV662('phone') + '</button>';
}

function applyLinkedContactResultV8(item, result) {
  if (!item) return;
  item.gongsilContactsV8 = Array.isArray(result && result.contacts) ? result.contacts : [];
  item.gongsilContactsLoadedV8 = true;
  item.gongsilContactCountV8 = Number(result && result.contactCount) || item.gongsilContactsV8.length;
}

function prefetchListContactPopupV654(encodedTarget) {
  var item = getPropertyByEncodedKeyV630(encodedTarget);
  if (!item || Number(item.gongsilContactCountV8) <= 0 || item.gongsilContactsLoadedV8) {
    return Promise.resolve(item || null);
  }
  var propertyId = String(item.propertyId || "").trim();
  var api = window.JSUnifiedListingsV8;
  if (!propertyId || !api || typeof api.loadContacts !== "function") return Promise.resolve(item);
  var cached = typeof api.getCachedContacts === "function" ? api.getCachedContacts(propertyId) : null;
  if (cached) {
    applyLinkedContactResultV8(item, cached);
    return Promise.resolve(item);
  }
  if (item.gongsilContactsPendingV8) return item.gongsilContactsPendingV8;
  item.gongsilContactsPendingV8 = api.loadContacts(propertyId).then(function(result) {
    applyLinkedContactResultV8(item, result);
    item.gongsilContactsPendingV8 = null;
    return item;
  }, function(error) {
    item.gongsilContactsPendingV8 = null;
    throw error;
  });
  return item.gongsilContactsPendingV8;
}

function closeListContactPopupV654() {
  var modal = document.getElementById("listContactModalV654");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("list-contact-modal-open-v654");
}

function openListContactPopupV654(encodedTarget) {
  var item = getPropertyByEncodedKeyV630(encodedTarget);
  if (!item) return;

  var propertyId = String(item.propertyId || "").trim();
  var contactApi = window.JSUnifiedListingsV8;
  var cachedContacts = propertyId && contactApi && typeof contactApi.getCachedContacts === "function"
    ? contactApi.getCachedContacts(propertyId)
    : null;
  if (cachedContacts) applyLinkedContactResultV8(item, cachedContacts);

  var contacts = extractListContactsV650(item);
  var modal = document.getElementById("listContactModalV654");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "listContactModalV654";
    modal.className = "list-contact-modal-v654";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="list-contact-backdrop-v654" onclick="closeListContactPopupV654()"></div>' +
      '<section class="list-contact-dialog-v654" role="dialog" aria-modal="true" aria-labelledby="listContactTitleV654">' +
        '<header><div><strong id="listContactTitleV654">매물 연락처</strong><p id="listContactAddressV654"></p></div>' +
          '<button type="button" class="list-contact-close-v654" onclick="closeListContactPopupV654()" aria-label="닫기">×</button></header>' +
        '<div id="listContactBodyV654" class="list-contact-body-v654"></div>' +
        '<p class="list-contact-note-v654">공실박스 번호는 JS_연락처원본에서 연결된 원본매물ID로만 조회합니다.</p>' +
      '</section>';
    document.body.appendChild(modal);
  }

  document.getElementById("listContactAddressV654").textContent =
    [item.name, item.address, item.room].filter(Boolean).join(" · ");
  modal._contactPropertyIdV8 = propertyId;
  var hasLinkedContacts = Number(item.gongsilContactCountV8) > 0;
  renderListContactPopupV8(item, contacts, {
    linkedContacts: item.gongsilContactsLoadedV8 ? item.gongsilContactsV8 : [],
    loading: hasLinkedContacts && !item.gongsilContactsLoadedV8
  });

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("list-contact-modal-open-v654");

  if (hasLinkedContacts && !item.gongsilContactsLoadedV8 && propertyId &&
      window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.loadContacts === "function") {
    prefetchListContactPopupV654(encodedTarget).then(function() {
      if (modal._contactPropertyIdV8 !== propertyId) return;
      renderListContactPopupV8(item, contacts, {linkedContacts: item.gongsilContactsV8});
    }).catch(function(error) {
      if (modal._contactPropertyIdV8 !== propertyId) return;
      renderListContactPopupV8(item, contacts, {
        error: (error && error.message) || "공실박스 원본 연락처를 불러오지 못했습니다."
      });
    });
  }
}

window.openListContactPopupV654 = openListContactPopupV654;
window.closeListContactPopupV654 = closeListContactPopupV654;
window.prefetchListContactPopupV654 = prefetchListContactPopupV654;

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
    '<svg class="item-elevator-glyph-v651" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="2" y="2" width="20" height="20" rx="2"></rect>' +
      '<path class="item-elevator-divider-v665" d="M11 4.5v15"></path>' +
      '<path class="item-elevator-arrows-v660" d="M7 10V5m-2 2 2-2 2 2m-2 7v5m-2-2 2 2 2-2"></path>' +
      '<circle class="item-elevator-person-v662" cx="16" cy="8" r="1.6"></circle>' +
      '<path class="item-elevator-person-v662" d="M16 10.5v4.5m-2.7-2.6 2.7-1.9 2.7 1.9M16 15l-2.4 3.8M16 15l2.4 3.8"></path>' +
    '</svg>' +
  '</span>';
}

window.closeCustomerMatchCardMenusV721 = function(exceptPanel) {
  document.querySelectorAll(".customer-match-menu-panel-v721").forEach(function(panel) {
    if (panel === exceptPanel) return;
    panel.hidden = true;
    panel.classList.remove("open-upward-v722");
    var card = panel.closest && panel.closest(".customer-match-map-card-v721");
    if (card) card.classList.remove("customer-match-menu-open-v721");
    var toggle = panel.parentElement && panel.parentElement.querySelector(".customer-match-menu-toggle-v721");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  });
};

window.toggleCustomerMatchCardMenuV721 = function(button, event) {
  if (event) event.stopPropagation();
  var wrapper = button && button.closest ? button.closest(".customer-match-card-menu-v721") : null;
  var panel = wrapper ? wrapper.querySelector(".customer-match-menu-panel-v721") : null;
  if (!panel) return;
  var willOpen = panel.hidden;
  window.closeCustomerMatchCardMenusV721(willOpen ? panel : null);
  panel.hidden = !willOpen;
  var card = wrapper.closest && wrapper.closest(".customer-match-map-card-v721");
  if (card) card.classList.toggle("customer-match-menu-open-v721", willOpen);
  button.setAttribute("aria-expanded", willOpen ? "true" : "false");
  if (willOpen) {
    panel.classList.remove("open-upward-v722");
    window.requestAnimationFrame(function() {
      if (panel.hidden) return;
      var panelRect = panel.getBoundingClientRect();
      if (panelRect.bottom > window.innerHeight - 8) panel.classList.add("open-upward-v722");
    });
  } else {
    panel.classList.remove("open-upward-v722");
  }
};

if (!window.customerMatchMenuOutsideBoundV721) {
  window.customerMatchMenuOutsideBoundV721 = true;
  document.addEventListener("click", function(event) {
    if (event && event.target && event.target.closest && event.target.closest(".customer-match-card-menu-v721")) return;
    window.closeCustomerMatchCardMenusV721();
  });
}

function isCustomerMatchMapCardV721(item, customerMatchContextV719) {
  var customerMatchPropertyIdV721 = String(item && item.propertyId || "").trim();
  return !customerMatchContextV719 &&
    window.operationsMatchPropertyIds instanceof Set &&
    window.operationsMatchPropertyIds.has(customerMatchPropertyIdV721) &&
    (!window.matchMedia || window.matchMedia("(min-width: 769px)").matches);
}

function addListItem(item, appendTarget, customerMatchContextV719) {
  var div = document.createElement("div");
  var customerMatchMapCardV721 = isCustomerMatchMapCardV721(item, customerMatchContextV719);
  var printSelected = selectedPrintKeys.includes(item.key);
  var memoOpen = openMemoKey === item.key;
  var memoEditing = editingMemoKey === item.key;
  var cachedBuildingBadgeV6519 =
    window.JSBuildingRegisterBadges &&
    typeof window.JSBuildingRegisterBadges.getCached === "function"
      ? window.JSBuildingRegisterBadges.getCached(item)
      : null;
  var cachedBuildingYearTextV6519 =
    cachedBuildingBadgeV6519 && cachedBuildingBadgeV6519.year
      ? "준" + cachedBuildingBadgeV6519.year
      : "준공 -";
  var cachedBuildingYearClassV6519 =
    cachedBuildingBadgeV6519 && cachedBuildingBadgeV6519.verified
      ? " verified"
      : "";

  var customerMatchStatusV719 = getCustomerMatchStatus(item, customerMatchContextV719);
  div.className =
    "item" +
    (selectedItemKey === item.key ? " selected" : "") +
    (isDone(item) ? " done" : "") +
    (printSelected ? " print-selected" : "") +
    (memoOpen ? " memo-open" : "") +
    (customerMatchStatusV719 === "신규" ? " customer-match-new" : "") +
    (customerMatchStatusV719 === "소개" ? " customer-match-introduced" : "") +
    (customerMatchStatusV719 === "보류" ? " customer-match-held" : "") +
    (customerMatchContextV719 ? " operations-match-listing-card-v719" : "") +
    (customerMatchMapCardV721 ? " customer-match-map-card-v721" : "");

  var doneLabel = isDone(item)
    ? '<span class="done-badge">계약완료</span>'
    : "";

  var typeLabel = item.type
    ? '<span class="type-badge">' + escapeHtml(item.type) + '</span>'
    : "";

  var sourceLabel = isFieldVisitItem(item)
    ? '<span class="gongsil-source-badge verification-pending-v661">미확인</span>'
    : (isConfirmedVisitItem(item) || isGongsilBoxItem(item)
      ? '<span class="gongsil-source-badge verification-done-v661">확인</span>'
      : "");

  var encodedKey = encodeURIComponent(item.key);
  var encodedEditTargetV648 = encodeURIComponent(
    item.propertyId
      ? "id:" + String(item.propertyId).trim()
      : "key:" + item.key
  );
  var pyeongMiniBadge = buildPyeongMiniBadge(item);
  var regDateLabel = formatListRegistrationDate(item.regDate);
  var unifiedCardPartsV8 = window.JSUnifiedListingsV8 &&
    typeof window.JSUnifiedListingsV8.cardParts === "function"
      ? window.JSUnifiedListingsV8.cardParts(item)
      : { thumbnail: "", badge: "", sourceButton: "" };
  var hasSourceLink = /^https?:\/\//i.test(String(item.sourceLink || "").trim());
  var sourceLinkButton = hasSourceLink
    ? '<button type="button" class="item-source-link-btn active" title="원본 매물 페이지 열기" ' +
        'onclick="event.stopPropagation(); openPropertySourceLink(\'' + encodedEditTargetV648 + '\')">링크</button>'
    : '<button type="button" class="item-source-link-btn disabled" title="원본 링크 없음" disabled>링크</button>';
  if (unifiedCardPartsV8.sourceButton) sourceLinkButton = unifiedCardPartsV8.sourceButton;
  var customerMatchControls = buildCustomerMatchInlineControls(item, customerMatchContextV719);
  var favoriteHeaderButtonV661 = "";
  var actionContactButtonV654 = buildListContactButtonV654(item, encodedEditTargetV648, false);
  var depositDisplay = listDisplayValueV650(item, "deposit");
  var rentDisplay = listDisplayValueV650(item, "rent");
  var feeDisplay = listDisplayValueV650(item, "fee");
  var premiumDisplay = listDisplayValueV650(item, "premium");
  var areaDisplay = listDisplayValueV650(item, "area");
  var memoToggleButton =
    '<button type="button" class="item-memo-toggle ' + (memoOpen ? 'on' : '') + '" ' +
      'title="메모 ' + (memoOpen ? '닫기' : '열기') + '" aria-label="메모 ' + (memoOpen ? '닫기' : '열기') + '" ' +
      'onclick="event.stopPropagation(); toggleItemMemo(\'' + encodedKey + '\', this)">' +
      '<span class="item-memo-label-v728">' + (memoOpen ? '메모 ▲' : '메모 ▼') + '</span>' +
    '</button>';

  var memoPanel = memoOpen ? buildMemoPanelMarkupV655(item) : "";
  var navButtonV721 =
    '<button type="button" class="item-nav-btn" title="카카오내비" aria-label="카카오내비" ' +
      'onclick="event.stopPropagation(); openKakaoNavigation(\'' + encodedKey + '\')"><span class="item-action-text-v661">내비</span>' + buildCardActionIconV662('navigation') + '</button>';
  var roadviewButtonV721 =
    '<button type="button" class="item-roadview-btn" title="로드뷰" aria-label="로드뷰" ' +
      'onclick="event.stopPropagation(); openKakaoRoadview(\'' + encodedKey + '\')"><span class="item-action-text-v661">로드뷰</span>' + buildCardActionIconV662('roadview') + '</button>';
  var registerButtonV721 =
    '<button type="button" class="item-building-register-btn" title="국토교통부 건축물대장" ' +
      'onclick="event.stopPropagation(); openBuildingRegisterV640(\'' + encodedKey + '\')">대장</button>';
  var favoriteButtonV721 =
    '<button type="button" class="item-list-add-btn favorite" title="찜 목록에 추가" ' +
      'onclick="event.stopPropagation(); openItemListDestinationPicker(\'' + encodedKey + '\')">찜</button>';
  var editButtonV721 =
    '<button type="button" class="item-edit-btn-v630" title="임대조건 수정" aria-label="임대조건 수정" ' +
      'onclick="event.stopPropagation(); openPropertyEditModalV630(\'' + encodedEditTargetV648 + '\')"><span class="item-action-text-v661">수정</span>' + buildCardActionIconV662('settings') + '</button>';
  var regularActionButtonsV721 = actionContactButtonV654 + navButtonV721 + roadviewButtonV721 +
    registerButtonV721 + favoriteButtonV721 + editButtonV721 + sourceLinkButton;
  var menuRegisterButtonV721 = registerButtonV721.replace('>대장</button>', '>건축물대장</button>');
  var menuEditButtonV721 = editButtonV721.replace('>수정</span>', '>수정하기</span>');
  var customerMatchMenuV721 =
    '<div class="customer-match-card-menu-v721" onclick="event.stopPropagation()">' +
      '<button type="button" class="customer-match-menu-toggle-v721" aria-expanded="false" ' +
        'onclick="toggleCustomerMatchCardMenuV721(this,event)">메뉴</button>' +
      '<div class="customer-match-menu-panel-v721" hidden>' +
        navButtonV721 + roadviewButtonV721 + menuRegisterButtonV721 + menuEditButtonV721 +
      '</div>' +
    '</div>';
  var customerMatchMapActionsV721 =
    '<div class="item-action-left">' + actionContactButtonV654 + customerMatchMenuV721 + sourceLinkButton + '</div>' +
    memoToggleButton + customerMatchControls;
  var standardActionsV721 =
    customerMatchControls + '<div class="item-action-left">' + regularActionButtonsV721 + '</div>' + memoToggleButton;

  div.setAttribute("data-listing-key", item.key);
  div.setAttribute("data-property-id", String(item.propertyId || "").trim());
  div.setAttribute("title", "더블클릭하면 스마트 매물카드 열기");
  div.innerHTML =
    '<div class="item-card-grid-v650' +
      (customerMatchMapCardV721
        ? ' standard-card-grid-v661 customer-match-map-card-grid-v721'
        : (customerMatchControls ? ' customer-match-card-grid-v654' : ' standard-card-grid-v661')) + '">' +
      unifiedCardPartsV8.thumbnail +
      '<div class="item-compact-main-v650' +
        (customerMatchMapCardV721
          ? ' standard-card-main-v661 customer-match-map-card-main-v721'
          : (customerMatchControls ? ' customer-match-card-main-v654' : ' standard-card-main-v661')) + '">' +
        '<div class="item-compact-head-v650">' +
          '<label class="item-action-select item-head-select-v650" title="이 매물을 작업 대상으로 선택">' +
            '<input type="checkbox" class="action-select-check" ' +
              (printSelected ? 'checked' : '') +
              ' onclick="event.stopPropagation(); togglePrintSelection(\'' + encodedKey + '\')">' +
          '</label>' +
          '<span class="item-building-year-v650 item-building-year-head-v652' +
            cachedBuildingYearClassV6519 +
            '" title="건축물대장 사용승인일">' +
            escapeHtml(cachedBuildingYearTextV6519) +
          '</span>' +
          doneLabel +
          (customerMatchControls ? unifiedCardPartsV8.badge : '') +
          '<span class="item-building-name" title="' + escapeHtml(item.name || "건물명 -") + '">' + escapeHtml(item.name || "건물명 -") + '</span>' +
          '<span class="item-address-room-v650">' +
            '<span class="item-address-text" title="' + escapeHtml(item.address || "주소 -") + '">' + escapeHtml(item.address || "주소 -") + '</span>' +
            (item.room
              ? '<span class="item-room-badge">' + escapeHtml(item.room) + '</span>'
              : '<span class="item-room-badge empty">호실 -</span>') +
            buildListElevatorIconV650() +
          '</span>' +
          favoriteHeaderButtonV661 +
          (customerMatchControls && regDateLabel
            ? '<span class="item-reg-date item-reg-date-head-v651' +
                (!customerMatchControls ? ' standard-card-v651' : '') +
                '">등록 ' + escapeHtml(regDateLabel) + '</span>'
            : '') +
        '</div>' +

        '<div class="price-line item-compact-price-v650">' +
          sourceLabel +
          pyeongMiniBadge +
          '<span class="item-building-year-v650 item-building-year-mobile-v652' +
            cachedBuildingYearClassV6519 +
            '" title="건축물대장 사용승인일">' +
            escapeHtml(cachedBuildingYearTextV6519) +
          '</span>' +
          typeLabel +
          '<span class="item-price-values-v652">' +
            '<span class="price-main"><b><span class="price-label-full-v650">보증금</span><span class="price-label-short-v650">보</span></b> ' + escapeHtml(depositDisplay) + ' / <b><span class="price-label-full-v650">월세</span><span class="price-label-short-v650">월</span></b> ' + escapeHtml(rentDisplay) + '</span>' +
            '<span class="price-separator">·</span>' +
            '<span class="price-fee"><b><span class="price-label-full-v650">관리비</span><span class="price-label-short-v650">관</span></b> ' + escapeHtml(feeDisplay) + '</span>' +
            '<span class="price-separator">·</span>' +
            '<span class="price-premium"><b><span class="price-label-full-v650">권리금</span><span class="price-label-short-v650">권</span></b> ' + escapeHtml(premiumDisplay) + '</span>' +
            '<span class="price-separator">·</span>' +
            '<span class="price-area"><b><span class="price-label-full-v650">평수</span><span class="price-label-short-v650">평</span></b> ' + escapeHtml(areaDisplay) + '</span>' +
          '</span>' +
          (!customerMatchControls && regDateLabel
            ? '<span class="item-reg-date item-reg-date-price-mobile-v652">등록 ' + escapeHtml(regDateLabel) + '</span>'
            : '') +
        '</div>' +

        '<div class="item-action-row item-compact-actions-v650' +
          (customerMatchMapCardV721
            ? ' customer-match-map-actions-v721'
            : (customerMatchControls ? ' customer-match-card-actions-v653' : '')) + '">' +
          (customerMatchMapCardV721 ? customerMatchMapActionsV721 : standardActionsV721) +
        '</div>' +
      '</div>' +
    '</div>' +
    memoPanel;

  div.onclick = function(event) {
    if (window.JSUnifiedListingsV8 &&
        typeof window.JSUnifiedListingsV8.handleCardClick === "function") {
      window.JSUnifiedListingsV8.handleCardClick(item, event);
    }
  };

  div.onpointerenter = function() {
    if (window.JSUnifiedListingsV8 &&
        typeof window.JSUnifiedListingsV8.prefetch === "function") {
      window.JSUnifiedListingsV8.prefetch(encodeURIComponent(String(item && item.propertyId || "")));
    }
    if (Number(item && item.gongsilContactCountV8) > 0) {
      prefetchListContactPopupV654(encodedEditTargetV648).catch(function() {});
    }
  };

  div.ondblclick = function(event) {
    if (
      event &&
      event.target &&
      event.target.closest &&
      event.target.closest("button, input, label, a, textarea, select, .item-memo-panel")
    ) return;
    openItem(item);
  };

  (appendTarget || document.getElementById("list")).appendChild(div);
  observeUnifiedDuplicateShimmerV812(div);
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
  return div;
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
  var sourceFilter = document.getElementById("sourceFilter");
  var floorQuickFilter = document.getElementById("floorQuickFilter");
  if (sourceFilter) sourceFilter.value = "";
  if (floorQuickFilter) floorQuickFilter.value = "";
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
  if (typeof window.clearMapMeasurementsV657 === "function") {
    window.clearMapMeasurementsV657(true);
  } else {
    window.mapRadiusFilterV658 = null;
  }
  selectedGroupKey = null;
  selectedItemKey = null;
  if (typeof clearPinnedClusterSelectionV6515 === "function") {
    clearPinnedClusterSelectionV6515(false);
  }
  if (typeof window.clearAdministrativeListSelectionV6570 === "function") {
    window.clearAdministrativeListSelectionV6570();
  }
  if (typeof window.resetToDaejeonOverviewV6524 === "function") {
    window.resetToDaejeonOverviewV6524();
  }

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

  postSafeMutationV654("toggleDone", payload).then(function(result) {
    delete doneTogglePendingKeys[key];
    refreshDoneStatusUI(true);

    document.getElementById("status").innerHTML =
      checked ? "거래완료 저장 요청 완료" : "계약가능 복구 요청 완료";

    // 시트 반영값을 다시 읽어 실제 저장 상태를 확인
    if (!result || !result.queued) {
      setTimeout(function() { loadSheet(true); }, 1800);
    }
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

  if (typeof window.syncSelectionActionBarV657 === "function") {
    window.syncSelectionActionBarV657(count);
  }
}

window.renderCustomerMatchListingCardV719 = function(target, item, context) {
  return addListItem(item, target, context || {});
};


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


function markFieldVisitConfirmedInMemo(memo) {
  var text = removeFieldVisitMarkerFromMemo(memo)
    .replace(/\(\s*확인매물\s*\)/gi, "")
    .replace(/\s*\/\s*\/\s*/g, " / ")
    .replace(/^\s*\/\s*/, "")
    .replace(/\s*\/\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text ? "(확인매물) / " + text : "(확인매물)";
}

window.removeFieldVisitMarkerFromMemo = removeFieldVisitMarkerFromMemo;
window.markFieldVisitConfirmedInMemo = markFieldVisitConfirmedInMemo;


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
    item.memo = markFieldVisitConfirmedInMemo(item.memo || "");
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

    return postSafeMutationV654("toggleDone", payload);
  });

  Promise.all(requests).then(function(results) {
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

    if (!(results || []).some(function(result) { return result && result.queued; })) {
      setTimeout(function() { loadSheet(true); }, 1800);
    }
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

    return postSafeMutationV654("toggleDone", payload);
  });

  Promise.all(requests).then(function(results) {
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

    if (!(results || []).some(function(result) { return result && result.queued; })) {
      setTimeout(function() { loadSheet(true); }, 1800);
    }
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
  if (typeof clearPinnedClusterSelectionV6515 === "function") {
    clearPinnedClusterSelectionV6515(false);
  }
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
    if (typeof clearPinnedClusterSelectionV6515 === "function") {
      clearPinnedClusterSelectionV6515(false);
    }
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

  btn.innerHTML = "<span>다중</span>";

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
  if (typeof clearPinnedClusterSelectionV6515 === "function") {
    clearPinnedClusterSelectionV6515(false);
  }
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
    state: String(document.getElementById("peStateV630").value || "").trim(),
    contacts: extractListContactsV650(item).map(function(contact) {
      return { role: contact.role, phone: contact.phone.display };
    })
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

  postSafeMutationV654("updateProperty", {
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
  }).then(function(queueResult) {
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
    item.contactListRaw = JSON.stringify(updated.contacts || []);
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

    if (!queueResult || !queueResult.queued) schedulePropertyEditReloadV634();
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
    if (typeof clearPinnedClusterSelectionV6515 === "function") {
      clearPinnedClusterSelectionV6515(false);
    }
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

