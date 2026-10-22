/* JS부동산 공통 UI/리스트/필터 핵심 스크립트 */
var sheetURL = window.JSDataAccessV6 ? window.JSDataAccessV6.endpoints.listings : "/api/sheet";
var saveApiURL = window.JSDataAccessV6 ? window.JSDataAccessV6.endpoints.data : "/api/data"; // 로그인 세션을 검사하는 Cloudflare D1 API

var map, geocoder;
var allItems = [];

function isPhoneListingV2() {
  var device = window.JSPhoneDeviceV1;
  return !!(device && (typeof device.isMobileLayout === "function" ? device.isMobileLayout() :
    typeof device.isPhone === "function" && device.isPhone()));
}

function getListingScrollContainerV2() {
  return (isPhoneListingV2() && document.getElementById("list")) || document.getElementById("sidebar");
}

var listingMobilePresentationV2 = isPhoneListingV2();
window.addEventListener("js-phone-device-change", function() {
  var mobile = isPhoneListingV2();
  if (mobile === listingMobilePresentationV2) return;
  var previousScroller = document.getElementById(listingMobilePresentationV2 ? "list" : "sidebar");
  var previousTop = previousScroller ? previousScroller.scrollTop : 0;
  listingMobilePresentationV2 = mobile;
  // Render the same already-filtered identities, without applying map bounds,
  // clearing selections or changing an active favorite-folder scope.
  if (!document.getElementById("list")) return;
  showList(visibleListItems || []);
  var scroller = getListingScrollContainerV2();
  if (scroller) scroller.scrollTop = previousTop;
});

function buildPhoneFavoriteButtonV2(item, encodedFavoriteRef) {
  if (!isPhoneListingV2()) return "";
  var saved = isFavorite(item);
  return '<button type="button" class="phone-card-favorite-v2' + (saved ? ' saved' : '') +
    '" aria-label="' + (saved ? '저장된 매물의 찜 폴더 선택' : '찜 폴더에 저장') +
    '" onclick="event.stopPropagation(); openItemListDestinationPicker(\'' + encodedFavoriteRef.replace(/'/g, '%27') + '\')">' +
    '<span aria-hidden="true">' + (saved ? '♥' : '♡') + '</span></button>';
}
var currentItems = [];
window.jsInitialFullListingsLoadingV1 = true;
var overlays = [];
var selectedGroupKey = null;
var selectedItemKey = null;
var selectedListCardIdV845 = null;
var favoriteOnly = false;
var favoriteFilterKeys = [];
var activeFavoriteFolderId = "";
var activeFavoriteFolderName = "";
var doneViewStorageKeyV656 = "JS_REAL_ESTATE_DONE_VIEW_V1";
var hideDone = true;
var doneOnly = false;
try {
  var savedDoneViewModeV656 = localStorage.getItem(doneViewStorageKeyV656);
  if (savedDoneViewModeV656 === "all") hideDone = false;
  if (savedDoneViewModeV656 === "only") {
    hideDone = false;
    doneOnly = true;
  }
} catch (_) {}
var gongsilOnly = false;
var todayNewOnly = false;
var newListingDays = 0;
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
var addressErrorSnapshotV41 = null;
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
        var error = new Error((result && result.message) || "실제 D1 저장에 실패했습니다.");
        error.retryable = isRetryableResult(result);
        throw error;
      }
      return Object.assign({}, result, {
        queued: result && result.queued === true,
        persisted: !result || result.persisted !== false,
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
  var refreshUnifiedSources = Boolean(detail.result && detail.result.fullReload);
  asyncMutationSheetReloadTimerV654 = setTimeout(function() {
    asyncMutationSheetReloadTimerV654 = null;
    loadSheet(true, refreshUnifiedSources);
  }, 250);
});
var listRenderLimit = 0;
var listRenderStart = 0;
var listRenderScrollBound = false;
var listCardReusePoolV6521 = null;
var listVirtualTopHeightV1 = 0;
var listVirtualScrollScheduledV1 = false;
var listVirtualItemHeightsV1 = Object.create(null);
var favoriteKeys = [];
try {
  var storedFavoriteKeysV1 = JSON.parse(localStorage.getItem("favoriteKeys") || "[]");
  favoriteKeys = Array.isArray(storedFavoriteKeysV1) ? storedFavoriteKeysV1 : [];
} catch (_) {
  favoriteKeys = [];
}
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


function saveSharedGeocodeEntriesV6102(entries) {
  var access = window.JSDataAccessV6;
  var request;

  if (access && typeof access.mutate === "function") {
    request = access.mutate("saveGeocodeCache", { entries: entries }, {
      errorMessage: "공용 좌표 캐시 저장 실패"
    });
  } else {
    request = fetch(saveApiURL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "saveGeocodeCache",
        entries: entries
      })
    }).then(function(response) {
      if (!response.ok) throw new Error("공용 좌표 캐시 저장 실패");
      return response.json();
    });
  }

  return Promise.resolve(request).then(function(result) {
    if (!result || result.ok === false || result.persisted === false) {
      throw new Error((result && result.message) || "공용 좌표 캐시 저장 실패");
    }
    return result;
  });
}


function flushSharedGeocodeCache() {
  if (!sharedGeocodeCacheReady || sharedGeocodeFlushInProgress) return;

  var keys = Object.keys(pendingSharedGeocodeEntries).slice(0, 500);
  if (!keys.length) return;

  var entries = keys.map(function(key) {
    return pendingSharedGeocodeEntries[key];
  });

  sharedGeocodeFlushInProgress = true;

  return saveSharedGeocodeEntriesV6102(entries)
    .then(function(result) {
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

  var sharedRequest = window.JSDataAccessV6 && typeof window.JSDataAccessV6.read === "function"
    ? window.JSDataAccessV6.read("geocodeCache", {}, {
      cache: "default",
      errorMessage: "공용 좌표 캐시 조회 실패"
    })
    : fetch(saveApiURL + "?action=geocodeCache", {
      credentials: "same-origin",
      cache: "default"
    }).then(function(response) {
      if (!response.ok) throw new Error("공용 좌표 캐시 조회 실패");
      return response.json();
    });

  sharedGeocodeCacheLoadPromise = sharedRequest
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
  var parts = [];
  var start = 0;
  var insideQuotes = false;
  var tokens = /[",\r\n]/g;

  function finishCell(end) {
    var tail = source.slice(start, end);
    row.push(parts.length ? parts.join("") + tail : tail);
    parts = [];
  }

  function finishRow(end) {
    finishCell(end);
    rows.push(row);
    row = [];
  }

  // Scan separators in native code and copy each text span once. Per-character
  // concatenation retained millions of string fragments on large full reads.
  var match;
  while ((match = tokens.exec(source))) {
    var i = match.index;
    var ch = match[0];

    if (ch === '"') {
      if (insideQuotes && source[i + 1] === '"') {
        parts.push(source.slice(start, i), '"');
        tokens.lastIndex = i + 2;
      } else {
        parts.push(source.slice(start, i));
        insideQuotes = !insideQuotes;
      }
      start = tokens.lastIndex;
      continue;
    }

    if (ch === "," && !insideQuotes) {
      finishCell(i);
      start = tokens.lastIndex;
      continue;
    }

    if ((ch === "\r" || ch === "\n") && !insideQuotes) {
      if (ch === "\r" && source[i + 1] === "\n") tokens.lastIndex = i + 2;
      finishRow(i);
      start = tokens.lastIndex;
      continue;
    }

    if (ch === "\r" && insideQuotes && source[i + 1] === "\n") {
      parts.push(source.slice(start, i), "\n");
      tokens.lastIndex = i + 2;
      start = tokens.lastIndex;
      continue;
    }

  }

  if (parts.join("") || start < source.length || row.length) finishRow(source.length);
  return rows;
}


function itemKey(item) {
  return item.name + "|" + item.address + "|" + item.room + "|" + item.type;
}


function isDone(item) {
  return item.state === "계약완료" || item.sourceAllUnavailableV1 === true;
}


function isFavorite(item) {
  var propertyRef = item && item.propertyId ? "property:" + String(item.propertyId) : "";
  var matchKeys = favoriteOnly && activeFavoriteFolderId && Array.isArray(favoriteFilterKeys)
    ? favoriteFilterKeys
    : favoriteKeys;
  return matchKeys.includes(item.key) || (!!propertyRef && matchKeys.includes(propertyRef));
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
  var nextFavoriteOnly = !favoriteOnly;
  if (typeof window.clearActiveFavoriteFolderFilterV1 === "function") {
    window.clearActiveFavoriteFolderFilterV1({ disableFilter: !nextFavoriteOnly, silent: true });
  } else {
    activeFavoriteFolderId = "";
    activeFavoriteFolderName = "";
    favoriteFilterKeys = [];
  }
  favoriteOnly = nextFavoriteOnly;
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


function selectSearchTextOnMousePointerV824(input, event) {
  if (!input || !String(input.value || "").trim()) return false;
  if (!event || event.pointerType !== "mouse" || event.button !== 0) return false;
  if (
    typeof input.selectionStart === "number" &&
    typeof input.selectionEnd === "number" &&
    input.selectionStart !== input.selectionEnd
  ) {
    return false;
  }
  if (typeof input.select !== "function") return false;

  input.select();
  return true;
}


function setupSearchMouseSelectAllV824() {
  var root = document.documentElement;
  if (!root || root.dataset.searchMouseSelectAllV824 === "1") return;
  root.dataset.searchMouseSelectAllV824 = "1";

  document.addEventListener("pointerup", function(event) {
    var input = event.target;
    if (!input || (input.id !== "keyword" && input.id !== "jsMobileKeywordV1")) return;
    selectSearchTextOnMousePointerV824(input, event);
  });
}


setupSearchMouseSelectAllV824();


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


function getListingTypeLabelV1(item) {
  return window.JSListingTradeV1 && window.JSListingTradeV1.displayType
    ? window.JSListingTradeV1.displayType(item) : String(item && item.type || "");
}

function updateTypeOptions(items) {
  var select = document.getElementById("typeFilter");
  var currentValue = select.value;
  var types = [];

  items.forEach(function(item) {
    if (window.JSListingTradeV1 && !window.JSListingTradeV1.matchesItem(item)) return;
    var label = getListingTypeLabelV1(item);
    if (label && !types.includes(label)) {
      types.push(label);
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

  if (!types.includes(currentValue) && currentValue && window.JSListingTradeV1) {
    currentValue = window.JSListingTradeV1.naverTypeLabel(currentValue);
  }
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
    item && (item.sourceFloorVerifiedV1 ? formatListingRoomForCardV653(item.advertisedRoomV1, item.floor) : item.room),
    item && item.type,
    getListingTypeLabelV1(item),
    item && item.memo
  ].map(function(value) {
    var text = String(value || "").toLowerCase();

    return {
      text: text,
      compact: normalizeSearchComparableText(text)
    };
  });
}


function parseOriginalListingNumberKeyword(value) {
  var normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (/^https?:\/\//.test(normalized)) {
    try {
      var url = new URL(normalized);
      if (/(^|\.)(?:naver\.com|daangn\.com|gongsilbox\.com)$/.test(url.hostname)) return { provider: "", number: "", url: url.href.replace(/#.*$/, "").replace(/\/$/, "") };
    } catch (_) { return null; }
  }
  if (/^m-[a-z0-9-]{6,}$/i.test(normalized)) return { provider: "manual", number: normalized };
  var match = normalized.match(/^(?:(네이버|naver|당근|daangn|danggeun|karrot|공실박스|gongsilbox|gongsil|직접등록|직접확인|manual)\s*)?(?:매물(?:번호)?\s*)?(?:[:#-]\s*)?(\d+)$/i);

  if (!match || (!match[1] && match[2].length < 6)) return null;

  var provider = String(match[1] || "").toLowerCase();
  if (/^(?:네이버|naver)$/.test(provider)) provider = "naver";
  else if (/^(?:당근|daangn|danggeun|karrot)$/.test(provider)) provider = "daangn";
  else if (/^(?:공실박스|gongsilbox|gongsil)$/.test(provider)) provider = "gongsil";
  else if (/^(?:직접등록|직접확인|manual)$/.test(provider)) provider = "manual";

  return {
    provider: provider,
    number: match[2]
  };
}


function matchesOriginalListingNumber(item, parsedKeyword) {
  if (!parsedKeyword) return false;
  var originals = Array.isArray(item && item.unifiedOriginalsV8) ? item.unifiedOriginalsV8 : [];
  if (parsedKeyword.url) {
    return [item && item.sourceLink].concat(originals.map(function(o) { return o.link; })).some(function(link) {
      try { return new URL(link).href.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "") === parsedKeyword.url; } catch (_) { return false; }
    });
  }
  if (!parsedKeyword.number) return false;
  if ((!parsedKeyword.provider || parsedKeyword.provider === "manual") && String(item && item.propertyId || "").toLowerCase() === parsedKeyword.number) return true;
  var indexedIds = Array.isArray(item && item.sourceListingSearchV6579) ? item.sourceListingSearchV6579 : [];
  var indexedMatch = indexedIds.some(function(value) {
    var parts = String(value || "").split(":");
    var provider = ({ n: "naver", d: "daangn", g: "gongsil", m: "manual" })[parts[0]] || "";
    return provider && (!parsedKeyword.provider || parsedKeyword.provider === provider) &&
      parts.slice(1).join(":") === parsedKeyword.number;
  });
  if (indexedMatch) return true;

  return originals.some(function(original) {
    var source = String(original && original.source || "").trim().toLowerCase();
    var sourceKey = /네이버|naver/.test(source)
      ? "naver"
      : (/당근|daangn|danggeun|karrot/.test(source) ? "daangn" : (/공실박스|gongsil/.test(source) ? "gongsil" : (/직접등록|직접확인|manual/.test(source) ? "manual" : "")));
    if (!sourceKey || (parsedKeyword.provider && parsedKeyword.provider !== sourceKey)) return false;

    var sourceId = String(original && (original.providerSourceId || original.sourceId) || "").trim()
      .replace(/::(?:lease|sale)$/, "");
    if (sourceKey === "naver") sourceId = sourceId.replace(/^네이버-/i, "");
    return sourceId === parsedKeyword.number;
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
    item && (item.sourceFloorVerifiedV1 ? formatListingRoomForCardV653(item.advertisedRoomV1, item.floor) : item.room),
    item && item.type,
    getListingTypeLabelV1(item),
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
    var originalListingNumberKeyword = parseOriginalListingNumberKeyword(group);
    if (originalListingNumberKeyword) {
      return matchesOriginalListingNumber(item, originalListingNumberKeyword);
    }

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
  var latestLabel = doneOnly ? "미노출 최신순" : "최근등록순";
  var currentLabel = value === "latest" ? (doneOnly ? latestLabel : "정렬") :
    (window.JSSaleWorkbenchV1 && window.JSSaleWorkbenchV1.sortLabel(value) || SORT_LABELS[value] || "정렬");
  if (buttonLabel) {
    buttonLabel.textContent = currentLabel;
  } else {
    button.textContent = currentLabel;
  }

  Array.prototype.forEach.call(
    menu.querySelectorAll("[data-sort-value]"),
    function(option) {
      var selected = option.getAttribute("data-sort-value") === value;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-selected", selected ? "true" : "false");
      if (option.getAttribute("data-sort-value") === "latest") {
        var label = option.querySelector("span:last-child");
        if (label) label.textContent = latestLabel;
      }
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


function readOptionalFilterNumberV1(id, fallback) {
  var input = document.getElementById(id);
  if (!input) return fallback;
  var raw = String(input.value == null ? "" : input.value).trim();
  if (raw === "") return fallback;
  var value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}


function getFilteredItems(options) {
  var includeUnlocated = !!(options && options.includeUnlocated);
  var ignoreMapBounds = !!(options && options.ignoreMapBounds);
  var candidateItems = options && Array.isArray(options.items) ? options.items : allItems;
  if (!map) return candidateItems;

  var bounds = map.getBounds();

  var keyword = document.getElementById("keyword").value.trim();
  var mobileGlobalKeywordSearch = !!keyword &&
    !!window.jsMobileGlobalKeywordV1;
  var selectedType = document.getElementById("typeFilter").value;
  var selectedSource = String((document.getElementById("sourceFilter") || {}).value || "");
  var selectedFloorQuick = String((document.getElementById("floorQuickFilter") || {}).value || "");
  var selectedBrokerageFee = String((document.getElementById("brokerageFeeFilter") || {}).value || "");
  var sortType = document.getElementById("sortFilter").value;
  var industryKeyword = String((document.getElementById("industryFilter") || {}).value || "").trim().toLowerCase();
  var industryTerms = industryKeyword.split(",").map(function(term) { return term.trim(); }).filter(Boolean);
  var radiusFilter = window.mapRadiusFilterV658 || null;
  var polygonFilter = window.mapPolygonFilterV661 || null;

  var minDeposit = readOptionalFilterNumberV1("minDeposit", 0);
  var saleMode = window.JSListingTradeV1 && window.JSListingTradeV1.getMode() !== "lease";
  var saleFilterValues = window.JSSaleWorkbenchV1 ? window.JSSaleWorkbenchV1.filterValues() : {};
  var maxDeposit = readOptionalFilterNumberV1("maxDeposit", Infinity);

  var minRent = readOptionalFilterNumberV1("minRent", 0);
  var maxRent = readOptionalFilterNumberV1("maxRent", Infinity);

  var minPremium = readOptionalFilterNumberV1("minPremium", 0);
  var maxPremium = readOptionalFilterNumberV1("maxPremium", Infinity);

  var minArea = readOptionalFilterNumberV1("minArea", 0);
  var maxArea = readOptionalFilterNumberV1("maxArea", Infinity);

  function hasBoundsInputV2(first, second) {
    return [first, second].some(function(id) {
      var input = document.getElementById(id);
      return input && String(input.value == null ? "" : input.value).trim() !== "";
    });
  }
  var hasDepositBounds = hasBoundsInputV2("minDeposit", "maxDeposit");
  var hasRentBounds = hasBoundsInputV2("minRent", "maxRent");
  var hasPremiumBounds = hasBoundsInputV2("minPremium", "maxPremium");
  var hasAreaBounds = hasBoundsInputV2("minArea", "maxArea");

  var minFloor = readOptionalNumberInput("minFloor");
  var maxFloor = readOptionalNumberInput("maxFloor");
  var hasFloorFilter = minFloor !== null || maxFloor !== null;

  if (minFloor !== null && maxFloor !== null && minFloor > maxFloor) {
    var floorSwap = minFloor;
    minFloor = maxFloor;
    maxFloor = floorSwap;
  }

  function matchesListingConditionsV2(item) {
    var matchTradeMode = !window.JSListingTradeV1 || window.JSListingTradeV1.matchesItem(item);
    // A different market cannot pass any combination of the remaining filters.
    // Avoid parsing sale finances and long descriptions for these rejected ads.
    if (!matchTradeMode) return false;
    var matchKeyword = matchesMultiKeyword(item, keyword);

    var matchType = !selectedType || getListingTypeLabelV1(item) === selectedType;
    var matchSource = !selectedSource ||
      (window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.matchesSource === "function"
        ? window.JSUnifiedListingsV8.matchesSource(item, selectedSource, {includeUnavailable: !!(options && options.ignoreDone)})
        : getItemSourceType(item) === selectedSource);
    var matchBrokerageFee = saleMode || !selectedBrokerageFee ||
      !!(window.JSCommercialBrokerageV1 &&
        typeof window.JSCommercialBrokerageV1.matchesFilter === "function" &&
        window.JSCommercialBrokerageV1.matchesFilter(item, selectedBrokerageFee));

    var memoTextForIndustry = industryTerms.length ? String(item.memo || "").toLowerCase() : "";
    var matchIndustry = !industryTerms.length || industryTerms.some(function(term) {
      return memoTextForIndustry.indexOf(term) !== -1;
    });

    var filterPrice = saleMode ? window.JSListingTradeV1.displayPrice(item) : Number(item.deposit || 0);
    var presence = item.displayValuePresence || {};
    var matchPrice =
      (!hasDepositBounds || presence[saleMode ? "salePrice" : "deposit"] !== false) &&
      (saleMode || ((!hasRentBounds || presence.rent !== false) &&
        (!hasPremiumBounds || presence.premium !== false) && (!hasAreaBounds || presence.area !== false))) &&
      filterPrice >= minDeposit &&
      filterPrice <= maxDeposit &&
      (saleMode || (item.rent >= minRent && item.rent <= maxRent)) &&
      (saleMode || ((Number(item.premium) || 0) >= minPremium && (Number(item.premium) || 0) <= maxPremium)) &&
      (saleMode || (item.area >= minArea && item.area <= maxArea));
    var matchSaleFields = !window.JSSaleWorkbenchV1 || window.JSSaleWorkbenchV1.matches(item, saleFilterValues);

    var itemFloor = !saleMode && (hasFloorFilter || selectedFloorQuick) ? getItemFloorNumber(item) : null;
    var matchFloor = true;
    var matchQuickFloor =
      saleMode || !selectedFloorQuick ||
      (selectedFloorQuick === "basement" && itemFloor !== null && itemFloor < 0) ||
      (selectedFloorQuick === "first" && itemFloor === 1) ||
      (selectedFloorQuick === "upper" && itemFloor !== null && itemFloor >= 2) ||
      (selectedFloorQuick === "unknown" && itemFloor === null);

    if (hasFloorFilter && !saleMode) {
      // 층수 미확인은 함께 표시하되 가격·출처·찜 등 다른 조건은 그대로 적용합니다.
      matchFloor =
        itemFloor === null || (
          (minFloor === null || itemFloor >= minFloor) &&
          (maxFloor === null || itemFloor <= maxFloor));
    }

    var matchFavorite = !favoriteOnly || isFavorite(item);
    var matchDone = options && options.ignoreDone ? true : (doneOnly
      ? (item.state === "계약완료" || Number(item.unifiedCandidateOriginalCountV2 || 0) > 0)
      : (!hideDone || !isDone(item)));
    var matchGongsil = !gongsilOnly || isGongsilBoxItem(item) ||
      !!(options && options.ignoreDone && window.JSUnifiedListingsV8 &&
        window.JSUnifiedListingsV8.matchesSource(item, "gongsil", {includeUnavailable: true}));
    var matchTodayNew = !newListingDays || (newListingDays === 1 && window.JSTodayListingsV1
      ? window.JSTodayListingsV1.matches(item) : isRegistrationWithinDays(item.regDate, newListingDays));
    var todayGlobalScope = newListingDays === 1 && window.JSTodayListingsV1 && window.JSTodayListingsV1.globalScope();
    var inMap = ignoreMapBounds || mobileGlobalKeywordSearch || (todayGlobalScope && !polygonFilter && !radiusFilter)
      ? true
      : (polygonFilter
        ? isItemWithinMapPolygonV661(item, polygonFilter)
        : (radiusFilter
          ? isItemWithinMapRadiusV658(item, radiusFilter)
          : (!item.latlng ? includeUnlocated : bounds.contain(item.latlng))));

    return matchTradeMode &&
      matchKeyword && matchType && matchSource && matchBrokerageFee && matchIndustry && matchPrice &&
      matchSaleFields && matchFloor && matchQuickFloor &&
      matchFavorite && matchDone && matchGongsil && matchTodayNew && inMap;
  }

  var availabilityView = options && options.availabilityView || (options && options.ignoreDone ? "all"
    : doneOnly ? "completed" : hideDone ? "active" : "all");
  var filtered = [];
  candidateItems.forEach(function(master) {
    // Original projections inherit the master's trade type. Reject another
    // market before allocating a display copy for each of its originals.
    // Category filtering stays per-original (manual category overrides matter).
    if (window.JSListingTradeV1 && typeof window.JSListingTradeV1.normalizedTradeType === "function" &&
        window.JSListingTradeV1.normalizedTradeType(master) !== (saleMode ? "sale" : "lease")) return;
    // The confirmed Today master gate is identical for every original in this
    // group. Reject unrelated masters before building source projections.
    if (newListingDays === 1 && window.JSTodayListingsV1 && !window.JSTodayListingsV1.matches(master)) return;
    var projected = window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.filterItemForView === "function"
      ? window.JSUnifiedListingsV8.filterItemForView(master, matchesListingConditionsV2, availabilityView)
      : matchesListingConditionsV2(master) ? master : null;
    if (projected) filtered.push(projected);
  });

  var saleSortValuesV5 = saleMode && window.JSSaleWorkbenchV1 && window.JSSaleWorkbenchV1.sortLabel(sortType)
    ? new Map(filtered.map(function(item) { return [item, window.JSSaleWorkbenchV1.sortValue(item, sortType)]; })) : null;
  var registrationTimesV68 = sortType === "latest"
    ? new Map(filtered.map(function(item) { return [item, listingRegistrationTime(item)]; })) : null;
  filtered.sort(function(a, b) {
    if (saleSortValuesV5) return window.JSSaleWorkbenchV1.compareSortValues(saleSortValuesV5.get(a), saleSortValuesV5.get(b), sortType) || compareNaturalAddress(a, b);
    if (sortType === "latest") {
      if (availabilityView === "completed") {
        var absenceDifference = (Number(b.unifiedAbsenceConfirmedTimeV1) || 0) - (Number(a.unifiedAbsenceConfirmedTimeV1) || 0);
        if (absenceDifference) return absenceDifference;
      }
      var latestDifference = registrationTimesV68.get(b) - registrationTimesV68.get(a);
      if (latestDifference) return latestDifference;
      return (Number(b.sheetRow) || 0) - (Number(a.sheetRow) || 0);
    }

    if (sortType === "address" || sortType === "addressAsc") return compareNaturalAddress(a, b);
    if (sortType === "addressDesc") return compareNaturalAddress(b, a);
    if (sortType === "floorLow") return compareFloorItems(a, b, false);
    if (sortType === "floorHigh") return compareFloorItems(a, b, true);
    if (sortType === "depositLow") return (saleMode ? window.JSListingTradeV1.displayPrice(a) - window.JSListingTradeV1.displayPrice(b) : Number(a.deposit || 0) - Number(b.deposit || 0)) || compareNaturalAddress(a, b);
    if (sortType === "depositHigh") return (saleMode ? window.JSListingTradeV1.displayPrice(b) - window.JSListingTradeV1.displayPrice(a) : Number(b.deposit || 0) - Number(a.deposit || 0)) || compareNaturalAddress(a, b);
    if (sortType === "rentLow") return Number(a.rent || 0) - Number(b.rent || 0) || compareNaturalAddress(a, b);
    if (sortType === "rentHigh") return Number(b.rent || 0) - Number(a.rent || 0) || compareNaturalAddress(a, b);

    return 0;
  });

  return window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.collapseWholeBuildingSalesV55 === "function"
    ? window.JSUnifiedListingsV8.collapseWholeBuildingSalesV55(filtered) : filtered;
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

function isCoordinateInPolygonV661(coords, points) {
  if (!coords || !Array.isArray(points) || points.length < 3) return false;
  var x = Number(coords.lng);
  var y = Number(coords.lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  var inside = false;
  for (var index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    var currentPoint = points[index] || {};
    var previousPoint = points[previous] || {};
    var currentX = Number(currentPoint.lng);
    var currentY = Number(currentPoint.lat);
    var previousX = Number(previousPoint.lng);
    var previousY = Number(previousPoint.lat);
    if (![currentX, currentY, previousX, previousY].every(Number.isFinite)) continue;
    var crossProduct = (x - currentX) * (previousY - currentY) -
      (y - currentY) * (previousX - currentX);
    var boundaryTolerance = 1e-10;
    var isOnBoundary = Math.abs(crossProduct) <= boundaryTolerance &&
      x >= Math.min(currentX, previousX) - boundaryTolerance &&
      x <= Math.max(currentX, previousX) + boundaryTolerance &&
      y >= Math.min(currentY, previousY) - boundaryTolerance &&
      y <= Math.max(currentY, previousY) + boundaryTolerance;
    if (isOnBoundary) return true;
    var crosses = (currentY > y) !== (previousY > y) &&
      x < (previousX - currentX) * (y - currentY) / (previousY - currentY) + currentX;
    if (crosses) inside = !inside;
  }
  return inside;
}

function isItemWithinMapPolygonV661(item, polygonFilter) {
  var coords = getItemCoordinates(item);
  return !!coords && !!polygonFilter &&
    isCoordinateInPolygonV661(coords, polygonFilter.points || []);
}


function getFilterInputValueV844(id) {
  var input = document.getElementById(id);
  return String((input && input.value) || "").trim();
}


function getSelectedFilterLabelV844(id) {
  var select = document.getElementById(id);
  if (!select || !select.value) return "";
  var option = select.options && select.selectedIndex >= 0
    ? select.options[select.selectedIndex]
    : null;
  return String((option && option.textContent) || select.value || "").trim();
}


function formatFilterNumberV844(value) {
  var number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("ko-KR", { maximumFractionDigits: 2 })
    : String(value || "").trim();
}


function buildRangeFilterChipV844(label, minId, maxId, unit) {
  var minRaw = getFilterInputValueV844(minId);
  var maxRaw = getFilterInputValueV844(maxId);
  var minNumber = Number(minRaw);
  var maxNumber = Number(maxRaw);
  var hasMin = minRaw !== "" && Number.isFinite(minNumber);
  var hasMax = maxRaw !== "" && Number.isFinite(maxNumber);

  if (!hasMin && !hasMax) return "";
  if (hasMin && hasMax) {
    return label + " " + formatFilterNumberV844(minNumber) + "~" + formatFilterNumberV844(maxNumber) + unit;
  }
  if (hasMin) return label + " " + formatFilterNumberV844(minNumber) + unit + " 이상";
  return label + " " + formatFilterNumberV844(maxNumber) + unit + " 이하";
}


function getActiveFilterChipsV844() {
  var chips = [];
  var push = function(key, label) {
    if (label) chips.push({ key: key, label: label });
  };
  var keyword = getFilterInputValueV844("keyword");
  var source = getSelectedFilterLabelV844("sourceFilter");
  var type = getSelectedFilterLabelV844("typeFilter");
  var brokerage = getSelectedFilterLabelV844("brokerageFeeFilter");
  var floorQuick = getSelectedFilterLabelV844("floorQuickFilter");
  var industry = getFilterInputValueV844("industryFilter");
  var radiusFilter = window.mapRadiusFilterV658 || null;
  var polygonFilter = window.mapPolygonFilterV661 || null;

  push("keyword", keyword ? "검색 " + keyword : "");
  push("source", source ? "출처 " + source : "");
  push("type", type ? "구분 " + type : "");
  push("brokerage", brokerage ? "중개보수 " + brokerage : "");
  push("floorQuick", floorQuick ? "층 " + floorQuick : "");
  var saleMode = window.JSListingTradeV1 && window.JSListingTradeV1.getMode() !== "lease";
  push("tradeMode", window.JSListingTradeV1 && window.JSListingTradeV1.getMode() !== "lease"
    ? window.JSListingTradeV1.modeLabel() : "");
  push("deposit", buildRangeFilterChipV844(saleMode ? "매매가" : "보증금", "minDeposit", "maxDeposit", "만원"));
  if (!saleMode) push("rent", buildRangeFilterChipV844("월세", "minRent", "maxRent", "만원"));
  if (!saleMode) push("premium", buildRangeFilterChipV844("권리금", "minPremium", "maxPremium", "만원"));
  if (!saleMode) push("area", buildRangeFilterChipV844("평수", "minArea", "maxArea", "평"));
  if (!saleMode) push("floor", buildRangeFilterChipV844("층", "minFloor", "maxFloor", "층"));
  if (window.JSSaleWorkbenchV1) chips = chips.concat(window.JSSaleWorkbenchV1.chips());
  push("industry", industry ? "업종 " + industry : "");

  if (favoriteOnly) push("favoriteOnly", activeFavoriteFolderName ? "찜: " + activeFavoriteFolderName : "찜목록");
  if (doneOnly) {
    push("doneOnly", "계약완료만");
  } else if (!hideDone) {
    push("includeDone", "계약완료 포함");
  }
  if (gongsilOnly) push("gongsilOnly", "임장할매물만");
  if (newListingDays) push("newListingDays", newListingDays === 1 ? "오늘 신규매물" : "최근 " + newListingDays + "일 신규매물");
  if (radiusFilter && Number(radiusFilter.meters) > 0) {
    push("radius", "반경 " + Number(radiusFilter.meters).toLocaleString("ko-KR") + "m");
  }
  if (polygonFilter && Array.isArray(polygonFilter.points) && polygonFilter.points.length >= 3) {
    push("polygon", "그린 영역");
  }

  return chips;
}


function syncFilterToggleControlsV844() {
  var favoriteButton = document.getElementById("favoriteBtn");
  if (favoriteButton) favoriteButton.classList.toggle("on", !!favoriteOnly);

  if (typeof updateHideDoneMenuUI === "function") updateHideDoneMenuUI();

  var gongsilButton = document.getElementById("gongsilOnlyBtn");
  if (gongsilButton) {
    gongsilButton.classList.toggle("on", !!gongsilOnly);
    gongsilButton.setAttribute("aria-checked", gongsilOnly ? "true" : "false");
  }

  [
    ["todayNewBtn", 1],
    ["newListing3DaysBtn", 3],
    ["newListing7DaysBtn", 7],
    ["newListing15DaysBtn", 15]
  ].forEach(function(entry) {
    var button = document.getElementById(entry[0]);
    var selected = newListingDays === entry[1];
    if (!button) return;
    button.classList.toggle("on", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  });

  if (typeof window.syncMapQuickToolStateV657 === "function") {
    window.syncMapQuickToolStateV657();
  }
}


function clearActiveFilterChipV844(key) {
  if (window.JSSaleWorkbenchV1) window.JSSaleWorkbenchV1.clearChip(key);
  var inputIds = {
    keyword: ["keyword"],
    source: ["sourceFilter"],
    type: ["typeFilter"],
    brokerage: ["brokerageFeeFilter"],
    floorQuick: ["floorQuickFilter"],
    deposit: ["minDeposit", "maxDeposit"],
    rent: ["minRent", "maxRent"],
    premium: ["minPremium", "maxPremium"],
    area: ["minArea", "maxArea"],
    floor: ["minFloor", "maxFloor"],
    industry: ["industryFilter"]
  };

  (inputIds[key] || []).forEach(function(id) {
    var input = document.getElementById(id);
    if (input) input.value = "";
  });

  if (key === "keyword") window.jsMobileGlobalKeywordV1 = false;
  if (key === "tradeMode" && window.JSListingTradeV1) {
    window.JSListingTradeV1.setMode("lease", { apply: false });
    if (typeof updateTypeOptions === "function") updateTypeOptions(allItems || []);
  }
  if (key === "favoriteOnly") {
    favoriteOnly = false;
    if (typeof window.clearActiveFavoriteFolderFilterV1 === "function") {
      window.clearActiveFavoriteFolderFilterV1({ disableFilter: true, silent: true });
    } else {
      activeFavoriteFolderId = "";
      activeFavoriteFolderName = "";
      favoriteFilterKeys = [];
    }
  }
  if (key === "doneOnly" || key === "includeDone") {
    doneOnly = false;
    hideDone = true;
    if (typeof saveDoneViewModeV656 === "function") saveDoneViewModeV656();
  }
  if (key === "gongsilOnly") gongsilOnly = false;
  if (key === "todayNewOnly" || key === "newListingDays") {
    todayNewOnly = false;
    newListingDays = 0;
    if (window.JSTodayListingsV1) window.JSTodayListingsV1.onPeriodChanged(0);
  }
  if (key === "radius" || key === "polygon") {
    if (typeof window.clearMapMeasurementsV657 === "function") {
      window.clearMapMeasurementsV657(true);
    } else {
      window.mapRadiusFilterV658 = null;
      window.mapPolygonFilterV661 = null;
    }
  }

  syncFilterToggleControlsV844();
  applyFilter();
}


function renderActiveFilterChipsV844() {
  var container = document.getElementById("activeFilterChipsV844");
  if (!container) return;
  var chips = getActiveFilterChipsV844();

  container.replaceChildren();
  container.hidden = chips.length === 0;

  chips.forEach(function(chip) {
    var button = document.createElement("button");
    var label = document.createElement("span");
    var remove = document.createElement("span");
    button.type = "button";
    button.className = "active-filter-chip-v844";
    button.setAttribute("aria-label", chip.label + " 필터 해제");
    button.title = chip.label + " 필터 해제";
    label.textContent = chip.label;
    remove.className = "active-filter-chip-remove-v844";
    remove.setAttribute("aria-hidden", "true");
    remove.textContent = "×";
    button.appendChild(label);
    button.appendChild(remove);
    button.addEventListener("click", function() {
      clearActiveFilterChipV844(chip.key);
    });
    container.appendChild(button);
  });
}


window.clearActiveFilterChipV844 = clearActiveFilterChipV844;
window.renderActiveFilterChipsV844 = renderActiveFilterChipsV844;


function applyFilter() {
  if (window.jsInitialFullListingsLoadingV1 && !(allItems || []).length) {
    var initialStatusV1 = document.getElementById("status");
    if (initialStatusV1) initialStatusV1.textContent = "전체 매물 한 번에 준비 중...";
    if (window.JSTodayListingsV1) window.JSTodayListingsV1.render([]);
    return [];
  }
  var searchMetricV1 = window.JSLocalMetricsV1 && window.JSLocalMetricsV1.start("search");
  try {
  var appliedKeywordV1 = String((document.getElementById("keyword") || {}).value || "").trim();
  if (window.jsLastAppliedKeywordV1 !== undefined && window.jsLastAppliedKeywordV1 !== appliedKeywordV1) {
    if (typeof clearMapListSelectionForNavigationV6571 === "function") {
      clearMapListSelectionForNavigationV6571();
    } else {
      if (typeof clearPinnedClusterSelectionV6515 === "function") clearPinnedClusterSelectionV6515(true);
      if (typeof window.clearAdministrativeListSelectionV6570 === "function") window.clearAdministrativeListSelectionV6570();
    }
  }
  window.jsLastAppliedKeywordV1 = appliedKeywordV1;
  var filtered = getFilteredItems();
  currentItems = filtered;

  drawItems(filtered);
  renderActiveFilterChipsV844();
  if (window.JSTodayListingsV1) window.JSTodayListingsV1.render(filtered);
  var pinnedItems = typeof getPinnedClusterItemsV6515 === "function"
    ? getPinnedClusterItemsV6515()
    : [];
  if (pinnedItems.length) {
    document.getElementById("status").innerHTML = multiClusterMode
      ? "선택 클러스터 " + (selectedGroupKeys || []).length + "개 · 매물 " + pinnedItems.length + "개"
      : "선택 매물 " + pinnedItems.length + "개";
    return filtered;
  }
  var radiusFilter = window.mapRadiusFilterV658 || null;
  var polygonFilter = window.mapPolygonFilterV661 || null;
  document.getElementById("status").innerHTML = polygonFilter
    ? "그린 영역 안 매물 " + filtered.length + "개"
    : (radiusFilter
      ? "반경 " + Number(radiusFilter.meters || 0).toLocaleString("ko-KR") + "m 안 매물 " + filtered.length + "개"
      : "검색 결과 " + filtered.length + "개");
  return filtered;
  } finally {
    if (window.JSLocalMetricsV1) window.JSLocalMetricsV1.finish(searchMetricV1);
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("js-listing-availability-changed"));
    }
  }
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
  if (window.JSListingTradeV1 && window.JSListingTradeV1.isSale(item)) {
    return window.JSListingTradeV1.saleYieldBadge(item);
  }
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
  return window.innerWidth <= 768 ? 14 : 18;
}

function getListRenderWindowSizeV1() {
  return getListRenderChunkSize() * 2;
}

function getListVirtualItemKeyV1(item, index) {
  return actionSelectionKeyV660(item) || "__list_index_" + index;
}

function measureListCardOuterHeightV1(card) {
  if (!card) return 0;
  var style = window.getComputedStyle ? window.getComputedStyle(card) : null;
  var marginTop = style ? parseFloat(style.marginTop) || 0 : 0;
  var marginBottom = style ? parseFloat(style.marginBottom) || 0 : 0;
  return card.getBoundingClientRect().height + marginTop + marginBottom;
}

function rememberListCardHeightV1(card) {
  if (!card) return 0;
  var index = Number(card.getAttribute("data-list-index-v1"));
  if (!Number.isFinite(index) || index < 0 || index >= visibleListItems.length) return 0;
  var height = measureListCardOuterHeightV1(card);
  if (height > 0) {
    listVirtualItemHeightsV1[getListVirtualItemKeyV1(visibleListItems[index], index)] = height;
  }
  return height;
}

function cacheRenderedListCardHeightsV1(list) {
  if (!list) return;
  Array.prototype.forEach.call(
    list.querySelectorAll(".item[data-list-index-v1]"),
    rememberListCardHeightV1
  );
}

function ensureListVirtualTopSpacerV1(list) {
  if (!list) return null;
  var spacer = list.querySelector(".list-virtual-top-spacer-v1");
  if (!spacer) {
    spacer = document.createElement("div");
    spacer.className = "list-virtual-top-spacer-v1";
    spacer.setAttribute("aria-hidden", "true");
    list.insertBefore(spacer, list.firstChild);
  }
  spacer.style.height = Math.max(0, listVirtualTopHeightV1) + "px";
  return spacer;
}

function unobserveVirtualizedListCardV1(card) {
  if (!card || !unifiedDuplicateShimmerObserverV812) return;
  var shimmer = card.querySelector(".unified-expand-btn-v8");
  if (shimmer) unifiedDuplicateShimmerObserverV812.unobserve(shimmer);
}

function appendVirtualListItemV1(index, target) {
  var item = visibleListItems[index];
  if (!item) return null;
  var listCardIdV681 = actionSelectionKeyV660(item);
  var reusableCard = listCardReusePoolV6521 && listCardReusePoolV6521[listCardIdV681];
  var favoriteContext = typeof window.getFavoriteMapRemovalContextV1 === "function"
    ? window.getFavoriteMapRemovalContextV1(item) : null;
  if (reusableCard && (reusableCard.getAttribute("data-favorite-map-folder-id") || "") !==
      (favoriteContext ? favoriteContext.folderId : "")) reusableCard = null;
  if (reusableCard) {
    syncReusableSaleFactsV60(reusableCard, item);
    reusableCard.setAttribute("data-list-index-v1", String(index));
    target.appendChild(reusableCard);
    delete listCardReusePoolV6521[listCardIdV681];
    return reusableCard;
  }
  var card = addListItem(item, target);
  if (card) card.setAttribute("data-list-index-v1", String(index));
  return card;
}

function syncReusableSaleFactsV60(card, item) {
  var ui = window.JSListingTradeV1;
  if (!ui || !ui.isSale(item) || !card.classList.contains("listing-sale-card-v1")) return;
  var holder = document.createElement("div");
  holder.innerHTML = ui.saleCardFactsHtml(item, true);
  var next = holder.firstElementChild;
  var previous = card.querySelector(":scope > .sale-card-facts-v2");
  if ((previous ? previous.outerHTML : "") === (next ? next.outerHTML : "")) return;
  if (previous && next) previous.replaceWith(next);
  else if (previous) previous.remove();
  else if (next) card.insertBefore(next, card.querySelector(":scope > .item-compact-actions-v650"));
  // The table view shares these exact financial values. Keep the existing card,
  // actions, memo editor and checkbox instead of rebuilding the whole list.
  var row = card.querySelector(":scope > .sale-table-row-v10");
  if (row && window.JSSaleReviewV10) {
    row.remove();
    window.JSSaleReviewV10.mountCard(card, item);
  }
}

function syncListVirtualMetadataV1(list) {
  if (!list) return;
  list.setAttribute("data-rendered-start", String(listRenderStart));
  list.setAttribute("data-rendered-count", String(Math.max(0, listRenderLimit - listRenderStart)));
  list.setAttribute("data-rendered-end", String(listRenderLimit));
  list.setAttribute("data-total-count", String(visibleListItems.length));
  if (window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.prepareListThumbnails === "function") {
    window.JSUnifiedListingsV8.prepareListThumbnails();
  }
  if (window.JSListingRefreshV1 && typeof window.JSListingRefreshV1.requestVisibleOriginals === "function") {
    window.JSListingRefreshV1.requestVisibleOriginals();
  }
}


var listVirtualOffsetsV2 = [0];
var listVirtualEstimatedHeightV2 = 0;

function ensureListVirtualBottomSpacerV2(list) {
  var spacer = list.querySelector(".list-virtual-bottom-spacer-v2");
  if (!spacer) {
    spacer = document.createElement("div");
    spacer.className = "list-virtual-bottom-spacer-v2";
    spacer.setAttribute("aria-hidden", "true");
    list.appendChild(spacer);
  }
  return spacer;
}

function updateListVirtualSpaceV2(list) {
  // Read all card sizes before changing either spacer. Do not interleave
  // a layout read with each of the removed cards.
  cacheRenderedListCardHeightsV1(list);
  if (!listVirtualEstimatedHeightV2) {
    var measured = Object.values(listVirtualItemHeightsV1).filter(function(height) { return height > 0; });
    listVirtualEstimatedHeightV2 = measured.length
      ? measured.reduce(function(sum, height) { return sum + height; }, 0) / measured.length : 125;
  }
  listVirtualOffsetsV2 = [0];
  visibleListItems.forEach(function(item, index) {
    var height = Number(listVirtualItemHeightsV1[getListVirtualItemKeyV1(item, index)]) || listVirtualEstimatedHeightV2;
    listVirtualOffsetsV2.push(listVirtualOffsetsV2[index] + height);
  });
  listVirtualTopHeightV1 = listVirtualOffsetsV2[listRenderStart] || 0;
  ensureListVirtualTopSpacerV1(list);
  ensureListVirtualBottomSpacerV2(list).style.height = Math.max(0,
    listVirtualOffsetsV2[visibleListItems.length] - (listVirtualOffsetsV2[listRenderLimit] || 0)) + "px";
}

function renderListWindowV2(start, end) {
  var list = document.getElementById("list"), scroller = getListingScrollContainerV2();
  if (!list) return;
  var previousTop = scroller ? scroller.scrollTop : 0;
  var cards = Array.from(list.querySelectorAll(".item[data-list-index-v1]"));
  var viewportTop = scroller ? scroller.getBoundingClientRect().top : 0;
  var anchor = cards.find(function(card) { return card.getBoundingClientRect().bottom > viewportTop; });
  var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
  cacheRenderedListCardHeightsV1(list);
  var retained = Object.create(null);
  cards.forEach(function(card) {
    var index = Number(card.getAttribute("data-list-index-v1"));
    if (index >= start && index < end) retained[index] = card;
    else { unobserveVirtualizedListCardV1(card); card.remove(); }
  });
  var bottom = ensureListVirtualBottomSpacerV2(list);
  var firstRetained = cards.find(function(card) { return retained[Number(card.getAttribute("data-list-index-v1"))]; });
  var prefix = document.createDocumentFragment(), suffix = document.createDocumentFragment();
  var firstIndex = firstRetained ? Number(firstRetained.getAttribute("data-list-index-v1")) : end;
  for (var index = start; index < end; index++) {
    if (!retained[index]) appendVirtualListItemV1(index, index < firstIndex ? prefix : suffix);
  }
  list.insertBefore(prefix, firstRetained || bottom);
  list.insertBefore(suffix, bottom);
  listRenderStart = start; listRenderLimit = end;
  updateListVirtualSpaceV2(list);
  if (anchor && anchor.isConnected && scroller) {
    var shift = anchor.getBoundingClientRect().top - anchorTop;
    if (Math.abs(shift) > 0.5) scroller.scrollTop += shift;
  } else if (scroller) {
    scroller.scrollTop = previousTop;
  }
  list.querySelectorAll(".unified-expand-btn-v8:not([data-shimmer-observed-v812])").forEach(function(button) {
    observeUnifiedDuplicateShimmerV812(button.closest(".item"));
  });
  syncListVirtualMetadataV1(list);
}

function listIndexAtOffsetV2(offset) {
  var low = 0, high = visibleListItems.length;
  while (low < high) {
    var middle = Math.floor((low + high) / 2);
    if (listVirtualOffsetsV2[middle + 1] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, Math.max(0, visibleListItems.length - 1));
}

// Density changes invalidate all estimates. Keep the first visible card at the
// same viewport position, including lists whose earlier rows are virtualized.
function reflowSaleListDensityV8(apply) {
  if (!window.JSListingTradeV1 || window.JSListingTradeV1.getMode() === 'lease') { apply(); return; }
  var list = document.getElementById('list'), scroller = getListingScrollContainerV2();
  if (!list || !scroller) { apply(); return; }
  var top = scroller.getBoundingClientRect().top;
  var anchor = Array.from(list.querySelectorAll('.item[data-list-index-v1]')).find(function(card) { return card.getBoundingClientRect().bottom > top; });
  var before = anchor ? anchor.getBoundingClientRect().top : null;
  apply();
  listVirtualItemHeightsV1 = Object.create(null); listVirtualEstimatedHeightV2 = 0;
  updateListVirtualSpaceV2(list);
  if (anchor && anchor.isConnected) scroller.scrollTop += anchor.getBoundingClientRect().top - before;
}

function renderPreviousListChunkV1() {
  if (listRenderStart <= 0) return;
  var start = Math.max(0, listRenderStart - getListRenderChunkSize());
  renderListWindowV2(start, Math.min(visibleListItems.length, start + getListRenderWindowSizeV1()));
}

function renderNextListChunk(targetLimit) {
  if (listRenderLimit >= visibleListItems.length) return;
  var end = Math.min(visibleListItems.length, Math.max(listRenderLimit + getListRenderChunkSize(), Number(targetLimit) || 0));
  renderListWindowV2(Math.max(0, end - getListRenderWindowSizeV1()), end);
}

function bindIncrementalListRendering() {
  if (listRenderScrollBound) return;
  var sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  listRenderScrollBound = true;
  function onListScroll(event) {
    var scroller = getListingScrollContainerV2();
    if (!scroller || event.currentTarget !== scroller || listVirtualScrollScheduledV1) return;
    listVirtualScrollScheduledV1 = true;
    window.requestAnimationFrame(function() {
      listVirtualScrollScheduledV1 = false;
      var list = document.getElementById("list");
      if (!list || !visibleListItems.length) return;
      var offset = Math.max(0, scroller.scrollTop - (scroller === list ? 0 : list.offsetTop));
      var first = listIndexAtOffsetV2(offset), last = listIndexAtOffsetV2(offset + scroller.clientHeight);
      if (first >= listRenderStart && last < listRenderLimit &&
          (listRenderStart === 0 || first - listRenderStart >= 3) &&
          (listRenderLimit === visibleListItems.length || listRenderLimit - last >= 3)) return;
      var start = Math.max(0, first - Math.floor(getListRenderChunkSize() / 2));
      var end = Math.min(visibleListItems.length, Math.max(start + getListRenderWindowSizeV1(), last + 4));
      renderListWindowV2(start, end);
    });
  }
  sidebar.addEventListener("scroll", onListScroll, {passive: true});
  var list = document.getElementById("list");
  if (list) list.addEventListener("scroll", onListScroll, {passive: true});
}


function isTodayRegistration(value) {
  return isRegistrationWithinDays(value, 1);
}

function listingRegistrationDayV1(value) {
  var text = String(value || "").trim();
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    var date = new Date(text);
    if (!Number.isFinite(date.getTime())) return "";
    // Korea has a fixed UTC+09:00 offset. Avoid an Intl formatter per listing.
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  var match = text.match(/^(\d{2,4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!match) return "";
  var year = Number(match[1]);
  if (year < 100) year += 2000;
  var month = Number(match[2]), day = Number(match[3]);
  var dateOnly = new Date(Date.UTC(year, month - 1, day));
  if (dateOnly.getUTCFullYear() !== year || dateOnly.getUTCMonth() !== month - 1 || dateOnly.getUTCDate() !== day) return "";
  return String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function isRegistrationWithinDays(value, days, now) {
  var registrationDay = listingRegistrationDayV1(value);
  if (!registrationDay) return false;
  var current = now instanceof Date ? now : new Date();
  var todayDay = listingRegistrationDayV1(current.toISOString());
  var elapsedDays = Math.floor((Date.parse(todayDay + "T00:00:00Z") - Date.parse(registrationDay + "T00:00:00Z")) / 86400000);
  return elapsedDays >= 0 && elapsedDays < Number(days || 0);
}

function toggleTodayNewOnly() {
  toggleNewListingDays(1);
}

function toggleNewListingDays(days) {
  var allowed = [1, 3, 7, 15];
  var selected = allowed.indexOf(Number(days)) >= 0 ? Number(days) : 0;
  newListingDays = newListingDays === selected ? 0 : selected;
  todayNewOnly = newListingDays === 1;
  syncFilterToggleControlsV844();
  if (window.JSTodayListingsV1) {
    window.JSTodayListingsV1.onPeriodChanged(newListingDays);
    // Today refresh already renders its loading state and confirmed pages.
    if (newListingDays === 1) return;
  }
  applyFilter();
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


function remapPassiveListActionSelectionsV48(previousItems, nextItems) {
  if (!selectedPrintKeys.length) return;
  var previousByKey = Object.create(null), previousCounts = Object.create(null);
  var nextKeys = new Set(), nextByProperty = Object.create(null), nextCounts = Object.create(null);
  (previousItems || []).forEach(function(item) {
    previousByKey[actionSelectionKeyV660(item)] = item;
    var id = String(item.propertyId || "");
    if (id) previousCounts[id] = (previousCounts[id] || 0) + 1;
  });
  (nextItems || []).forEach(function(item) {
    var key = actionSelectionKeyV660(item), id = String(item.propertyId || "");
    nextKeys.add(key);
    if (id) { nextByProperty[id] = key; nextCounts[id] = (nextCounts[id] || 0) + 1; }
  });
  selectedPrintKeys = Array.from(new Set(selectedPrintKeys.map(function(key) {
    if (nextKeys.has(key)) return key;
    var previous = previousByKey[key];
    if (!previous) return key;
    var id = String(previous.propertyId || "");
    return id && previousCounts[id] === 1 && nextCounts[id] === 1 ? nextByProperty[id] : "";
  }).filter(Boolean)));
}

function findListReadingAnchorIndexV48(items, anchor) {
  var exact = (items || []).findIndex(function(item) { return actionSelectionKeyV660(item) === anchor.id; });
  if (exact >= 0 || !anchor.propertyId) return exact;
  // CSV row numbers change on a full refresh. Use the property ID only when
  // unambiguous, without changing the identity used by actions/duplicate rows.
  var matches = [];
  (items || []).forEach(function(item, index) {
    if (String(item.propertyId || "") === anchor.propertyId) matches.push(index);
  });
  return matches.length === 1 ? matches[0] : -1;
}

function captureListReadingAnchorV29(items) {
  var sidebar = getListingScrollContainerV2();
  var list = document.getElementById("list");
  if (!sidebar || !list) return null;
  var allowed = items ? new Set(items.map(actionSelectionKeyV660)) : null;
  var propertyCounts = Object.create(null);
  if (items) items.forEach(function(item) {
    var id = String(item.propertyId || "");
    if (id) propertyCounts[id] = (propertyCounts[id] || 0) + 1;
  });
  var top = sidebar.getBoundingClientRect().top;
  var cards = Array.from(list.querySelectorAll(".item[data-list-card-id-v681]")).filter(function(card) {
    return card.getBoundingClientRect().bottom > top;
  });
  var card = cards.find(function(card) {
    return !allowed || allowed.has(card.getAttribute("data-list-card-id-v681")) ||
      propertyCounts[card.getAttribute("data-property-id")] === 1;
  });
  // If this whole rendered window was removed, stay near its former index
  // rather than jumping to the first result or retaining deleted listings.
  if (!card && cards.length && items && items.length) {
    var oldIndex = (visibleListItems || []).findIndex(function(item) {
      return actionSelectionKeyV660(item) === cards[0].getAttribute("data-list-card-id-v681");
    });
    if (oldIndex >= 0) {
      var nearest = items[Math.min(oldIndex, items.length - 1)];
      return {id: actionSelectionKeyV660(nearest), propertyId: String(nearest.propertyId || ""),
        offset: cards[0].getBoundingClientRect().top - top};
    }
  }
  return card ? {id: card.getAttribute("data-list-card-id-v681"),
    propertyId: card.getAttribute("data-property-id") || "", offset: card.getBoundingClientRect().top - top} : null;
}

function restoreListReadingAnchorV29(anchor) {
  if (!anchor) return false;
  var sidebar = getListingScrollContainerV2();
  var list = document.getElementById("list");
  if (!sidebar || !list) return false;
  var cards = Array.from(list.querySelectorAll(".item[data-list-card-id-v681]"));
  var card = cards.find(function(card) {
    return card.getAttribute("data-list-card-id-v681") === anchor.id;
  });
  if (!card && anchor.propertyId) {
    var matches = cards.filter(function(card) { return card.getAttribute("data-property-id") === anchor.propertyId; });
    if (matches.length === 1) card = matches[0];
  }
  if (!card) return false;
  sidebar.scrollTop += card.getBoundingClientRect().top - sidebar.getBoundingClientRect().top - anchor.offset;
  return true;
}

function showList(items) {
  if (window.JSMapListPanelV1) window.JSMapListPanelV1.syncTitle(items);
  var list = document.getElementById("list");
  var sidebar = getListingScrollContainerV2();
  var previousSidebarTop = sidebar ? sidebar.scrollTop : 0;
  cacheRenderedListCardHeightsV1(list);
  var reviewContext = typeof window.getFavoriteMapRemovalContextV1 === "function"
    ? window.getFavoriteMapRemovalContextV1() : null;
  document.documentElement.classList.toggle("favorite-map-review-v1", !!reviewContext);
  var keepReviewPosition = !!(reviewContext && window.jsFavoriteMapRemovalInProgressV1);
  var sameMembers = (visibleListItems || []).length === items.length && (visibleListItems || []).every(function(item, index) {
    return actionSelectionKeyV660(item) === actionSelectionKeyV660(items[index]);
  });
  var keepReadingPosition = keepReviewPosition || sameMembers || preserveActionSelectionDuringRender || !!window.jsReuseListCardsOnNextRenderV6521;
  var reviewAnchor = keepReadingPosition ? captureListReadingAnchorV29(items) : null;
  var reviewStart = 0;
  var reviewTopHeight = 0;
  if (reviewAnchor) {
    var anchorIndex = findListReadingAnchorIndexV48(items, reviewAnchor);
    reviewStart = Math.max(0, anchorIndex - getListRenderChunkSize());
    for (var prefixIndex = 0; prefixIndex < reviewStart; prefixIndex++) {
      reviewTopHeight += Number(listVirtualItemHeightsV1[getListVirtualItemKeyV1(items[prefixIndex], prefixIndex)]) || listVirtualEstimatedHeightV2 || 0;
    }
  }
  resetUnifiedDuplicateShimmerObserverV812();
  var previousSignature = (visibleListItems || []).map(function(item) {
    return actionSelectionKeyV660(item);
  }).join("||");

  var nextSignature = (items || []).map(function(item) {
    return actionSelectionKeyV660(item);
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
  } else if (preserveActionSelectionDuringRender && previousSignature !== nextSignature) {
    // Preserve the checked property across row renumbering without leaving
    // stale checked counts for removed rows or selecting an ambiguous sibling.
    remapPassiveListActionSelectionsV48(visibleListItems, items);
  }

  var previousRenderLimit = listRenderLimit;
  var previousRenderStart = listRenderStart;
  var previousVirtualTopHeight = listVirtualTopHeightV1;
  var sameList = previousSignature === nextSignature;
  var reuseExistingCards = !!window.jsReuseListCardsOnNextRenderV6521;
  window.jsReuseListCardsOnNextRenderV6521 = false;
  listCardReusePoolV6521 = null;

  if (reuseExistingCards && list) {
    listCardReusePoolV6521 = Object.create(null);
    Array.prototype.forEach.call(
      list.querySelectorAll(".item[data-list-card-id-v681]"),
      function(card) {
        var key = card.getAttribute("data-list-card-id-v681");
        if (!key || listCardReusePoolV6521[key]) return;
        listCardReusePoolV6521[key] = card;
        card.remove();
      }
    );
  }

  visibleListItems = items.slice();
  if (window.JSSaleReviewFlowV12 && window.JSListingTradeV1 && window.JSListingTradeV1.getMode() !== 'lease') window.JSSaleReviewFlowV12.refreshNavigation();
  if (list) list.innerHTML = "";
  listRenderStart = 0;
  listRenderLimit = 0;
  listVirtualTopHeightV1 = 0;
  syncListVirtualMetadataV1(list);
  bindIncrementalListRendering();

  if (
    list &&
    !visibleListItems.length &&
    (document.documentElement.classList.contains("js-mobile-app-v1") || newListingDays === 1)
  ) {
    var todayEmptyV1 = window.JSTodayListingsV1 && typeof window.JSTodayListingsV1.emptyMessage === "function"
      ? window.JSTodayListingsV1.emptyMessage() : null;
    list.innerHTML = '<div class="jsm-list-empty-v1"><b>' + escapeHtml(todayEmptyV1 ? todayEmptyV1.title : "검색 결과가 없습니다.") +
      '</b><span>' + escapeHtml(todayEmptyV1 ? todayEmptyV1.description : "검색어를 줄이거나 필터를 초기화해 보세요.") + '</span></div>';
    syncListVirtualMetadataV1(list);
    listCardReusePoolV6521 = null;
    if (sidebar) sidebar.scrollTop = 0;
    updatePrintSelectedButton();
    syncListMasterCheckbox();
    return;
  }

  if (reviewAnchor) {
    listRenderStart = Math.max(0, reviewStart);
    listRenderLimit = listRenderStart;
    listVirtualTopHeightV1 = reviewTopHeight;
  } else if (sameList && previousRenderStart < visibleListItems.length) {
    listRenderStart = previousRenderStart;
    listRenderLimit = previousRenderStart;
    listVirtualTopHeightV1 = previousVirtualTopHeight;
  } else {
    listVirtualItemHeightsV1 = Object.create(null);
    listVirtualEstimatedHeightV2 = 0;
  }
  ensureListVirtualTopSpacerV1(list);
  renderNextListChunk(
    reviewAnchor
      ? listRenderStart + getListRenderWindowSizeV1()
      : sameList
      ? Math.max(previousRenderLimit, getListRenderChunkSize())
      : getListRenderChunkSize()
  );
  listCardReusePoolV6521 = null;

  if (sidebar) {
    sidebar.scrollTop = sameList || reviewAnchor ? previousSidebarTop : 0;
    restoreListReadingAnchorV29(reviewAnchor);
  }

  updatePrintSelectedButton();
  syncListMasterCheckbox();
}


function getItemCoordinates(item) {
  if (!item) return null;

  function validPair(lat, lng) {
    if (lat == null || lat === "" || lng == null || lng === "") return null;
    lat = Number(lat); lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? {lat: lat, lng: lng} : null;
  }

  try {
    var point = item.latlng;
    var mapped = point && validPair(typeof point.getLat === "function" ? point.getLat() : point.lat,
      typeof point.getLng === "function" ? point.getLng() : point.lng);
    if (mapped) return mapped;
  } catch (_) {}
  return validPair(item.latitude, item.longitude) || validPair(item.lat, item.lng);
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
var naverRoadviewSdkReadyV1 = false;
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
var naverMapsAuthFailedV663 = false;
var previousNaverMapsAuthFailureV663 = null;
var naverMapsNamespaceV663 = null;
var naverRoadviewMapTilesReadyV665 = false;
var naverRoadviewMapTileTimerV665 = null;


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


function clearNaverRoadviewMapTileTimerV665() {
  if (!naverRoadviewMapTileTimerV665) return;
  window.clearTimeout(naverRoadviewMapTileTimerV665);
  naverRoadviewMapTileTimerV665 = null;
}


function markNaverRoadviewMapTilesReadyV665() {
  naverRoadviewMapTilesReadyV665 = true;
  clearNaverRoadviewMapTileTimerV665();
  recoverNaverMapsAuthStateV664();
}


function verifyNaverRoadviewMapTilesV665() {
  clearNaverRoadviewMapTileTimerV665();
  naverRoadviewMapTileTimerV665 = window.setTimeout(function() {
    if (
      naverRoadviewMapTilesReadyV665 ||
      naverMapsAuthFailedV663 ||
      !naverRoadviewMapV654 ||
      !window.naver ||
      !window.naver.maps
    ) return;

    /*
     * 숨겨진 패널에서 초기화됐거나 지도 메타데이터가 늦은 경우 기본
     * 지도 유형과 크기를 다시 확정해 빈 배경만 남는 상태를 복구합니다.
     */
    try {
      naverRoadviewMapV654.setMapTypeId(window.naver.maps.MapTypeId.NORMAL);
      window.naver.maps.Event.trigger(naverRoadviewMapV654, "resize");
      var position = getNaverRoadviewPositionV654();
      if (position) naverRoadviewMapV654.setCenter(position);
    } catch (error) {}
  }, 2500);
}


function setupNaverRoadviewMapV654(position) {
  var mapContainer = document.getElementById("naverRoadviewMapV654");
  if (
    naverMapsAuthFailedV663 ||
    !mapContainer ||
    !window.naver ||
    !window.naver.maps ||
    !position
  ) return;

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
  naverRoadviewMapTilesReadyV665 = false;
  clearNaverRoadviewMapTileTimerV665();
  naverRoadviewMapV654 = new window.naver.maps.Map(mapContainer, {
    center: position,
    zoom: 17,
    mapTypeId: window.naver.maps.MapTypeId.NORMAL,
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

  window.naver.maps.Event.addListener(
    naverRoadviewMapV654,
    "tilesloaded",
    markNaverRoadviewMapTilesReadyV665
  );
  verifyNaverRoadviewMapTilesV665();

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
  var mapsNamespace = window.naver && window.naver.maps
    ? window.naver.maps
    : naverMapsNamespaceV663;
  if (
    panoramaContainer &&
    naverRoadviewInstanceV653 &&
    mapsNamespace
  ) {
    try {
      naverRoadviewInstanceV653.setSize(
        new mapsNamespace.Size(
          panoramaContainer.clientWidth,
          panoramaContainer.clientHeight
        )
      );
    } catch (error) {}
  }

  if (naverRoadviewMapV654 && mapsNamespace) {
    try {
      mapsNamespace.Event.trigger(naverRoadviewMapV654, "resize");
    } catch (error) {}
    updateNaverRoadviewMapV654(false);
  }
}


function destroyNaverRoadviewMapV654() {
  var mapsNamespace = window.naver && window.naver.maps
    ? window.naver.maps
    : naverMapsNamespaceV663;
  if (mapsNamespace && mapsNamespace.Event) {
    try {
      if (naverRoadviewMapV654) {
        mapsNamespace.Event.clearInstanceListeners(naverRoadviewMapV654);
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
  naverRoadviewMapTilesReadyV665 = false;
  clearNaverRoadviewMapTileTimerV665();

  var mapContainer = document.getElementById("naverRoadviewMapV654");
  if (mapContainer) mapContainer.innerHTML = "";
}


function showNaverMapsAuthFallbackV663() {
  naverMapsAuthFailedV663 = true;
  naverRoadviewSdkPromiseV653 = null;

  var split = document.querySelector(
    "#naverRoadviewPane .naver-roadview-split-v654"
  );
  var mapPanel = document.querySelector(
    "#naverRoadviewPane .naver-roadview-map-panel-v654"
  );
  var status = document.getElementById("naverRoadviewModalStatus");

  if (split) split.classList.add("naver-map-auth-failed-v663");
  if (mapPanel) mapPanel.setAttribute("aria-hidden", "true");

  destroyNaverRoadviewMapV654();

  if (status) {
    status.textContent =
      "\uB124\uC774\uBC84 \uC9C0\uB3C4 \uC778\uC99D\uC744 \uD655\uC778\uD558\uB294 \uB3D9\uC548 \uAC70\uB9AC\uBDF0\uB9CC \uD45C\uC2DC\uD569\uB2C8\uB2E4. \uC9C0\uB3C4 \uD0ED\uC740 \uC815\uC0C1\uC801\uC73C\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.";
    status.className = "roadview-inline-status error";
  }

  window.setTimeout(syncNaverRoadviewLayoutV654, 30);
}


function recoverNaverMapsAuthStateV664() {
  naverMapsAuthFailedV663 = false;

  var split = document.querySelector(
    "#naverRoadviewPane .naver-roadview-split-v654"
  );
  var mapPanel = document.querySelector(
    "#naverRoadviewPane .naver-roadview-map-panel-v654"
  );

  if (split) split.classList.remove("naver-map-auth-failed-v663");
  if (mapPanel) mapPanel.removeAttribute("aria-hidden");
}


if (!window.__jsNaverMapsAuthFailureBoundV663) {
  previousNaverMapsAuthFailureV663 =
    typeof window.navermap_authFailure === "function"
      ? window.navermap_authFailure
      : null;

  window.navermap_authFailure = function() {
    showNaverMapsAuthFallbackV663();
    if (previousNaverMapsAuthFailureV663) {
      try {
        previousNaverMapsAuthFailureV663();
      } catch (error) {}
    }
  };

  window.__jsNaverMapsAuthFailureBoundV663 = true;
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
    naverMapsNamespaceV663 = window.naver.maps;
    recoverNaverMapsAuthStateV664();
    return Promise.resolve(window.naver.maps);
  }

  if (naverRoadviewSdkPromiseV653) {
    // Share one in-flight attempt, including its failure. Concurrent callers
    // must not each start a recursive retry after the same network error.
    if (!naverRoadviewSdkReadyV1) return naverRoadviewSdkPromiseV653;
    /* A previously ready SDK whose namespace disappeared needs a clean load. */
    naverRoadviewSdkPromiseV653 = null;
    var staleSdk = document.getElementById("naverMapsSdkV653");
    if (staleSdk) staleSdk.remove();
    document.querySelectorAll('script[src*="maps-panorama.js"]').forEach(function(script) {
      script.remove();
    });
  }

  naverRoadviewSdkReadyV1 = false;
  var sdkRequest = fetch("/api/naver-maps-config", {
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
        var scriptNode = existing;
        var settled = false;
        var pollId = null;
        var pollStarted = false;
        var timeoutId = setTimeout(function() {
          fail("NAVER_MAPS_SDK_TIMEOUT");
        }, 12000);

        function fail(message) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (pollId) clearInterval(pollId);
          // A failed script will never fire load again. Remove it so a later
          // user action can make one fresh SDK request after connectivity recovers.
          if (scriptNode) {
            scriptNode.onload = null;
            scriptNode.onerror = null;
            scriptNode.remove();
          }
          reject(new Error(message));
        }

        function finish() {
          if (settled) return true;
          if (
            window.naver &&
            window.naver.maps &&
            window.naver.maps.Panorama
          ) {
            naverMapsNamespaceV663 = window.naver.maps;
            recoverNaverMapsAuthStateV664();
            settled = true;
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
            fail("NAVER_MAPS_SDK_FAILED");
          }, { once: true });
          return;
        }

        var script = document.createElement("script");
        scriptNode = script;
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
          fail("NAVER_MAPS_SDK_FAILED");
        };
        document.head.appendChild(script);
      });
    })
    .then(function(maps) {
      if (naverRoadviewSdkPromiseV653 === sdkRequest) naverRoadviewSdkReadyV1 = true;
      return maps;
    }).catch(function(error) {
      if (naverRoadviewSdkPromiseV653 === sdkRequest) {
        naverRoadviewSdkPromiseV653 = null;
        naverRoadviewSdkReadyV1 = false;
      }
      throw error;
    });

  naverRoadviewSdkPromiseV653 = sdkRequest;
  return naverRoadviewSdkPromiseV653;
}


function formatNaverPanoramaDateV653(value) {
  var digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return "";
  return digits.slice(0, 4) + "년 " + digits.slice(4, 6) + "월 촬영";
}


function setNaverRoadviewHistoryReadyV666(isReady) {
  var button = document.getElementById("naverRoadviewHistoryBtn");
  if (!button) return;

  var ready = Boolean(isReady) && currentRoadviewMode === "naver";
  button.disabled = !ready;
  button.setAttribute("aria-disabled", ready ? "false" : "true");
  button.title = ready
    ? "공식 네이버 지도에서 과거 촬영사진 보기"
    : "네이버 거리뷰를 불러온 뒤 사용할 수 있습니다.";
}


function formatNaverRoadviewLinkNumberV666(value, fallback, min, max) {
  var number = Number(value);
  if (!isFinite(number)) number = fallback;
  number = Math.max(min, Math.min(max, number));
  return Math.round(number * 100) / 100;
}


function buildNaverRoadviewHistoryUrlV666() {
  if (!naverRoadviewInstanceV653) return "";

  var panoId = "";
  var pov = null;
  try {
    panoId = String(naverRoadviewInstanceV653.getPanoId() || "").trim();
    pov = naverRoadviewInstanceV653.getPov();
  } catch (error) {
    return "";
  }
  if (!panoId) return "";

  var pan = formatNaverRoadviewLinkNumberV666(pov && pov.pan, 0, -180, 180);
  var tilt = formatNaverRoadviewLinkNumberV666(pov && pov.tilt, 0, -90, 90);
  var fov = formatNaverRoadviewLinkNumberV666(pov && pov.fov, 90, 20, 100);

  /*
   * 네이버 지도 웹이 공유하는 전체 거리뷰 주소 형식입니다. 현재 panoId와
   * 시야를 함께 넘겨 지도 검색 화면을 거치지 않고 공식 거리뷰로 진입합니다.
   * 촬영 날짜 선택은 공식 네이버 거리뷰 화면에서 제공합니다.
   */
  return "https://map.naver.com/p?c=17.00,0,0,0,adh&p=" +
    encodeURIComponent(panoId) + "," + pan + "," + tilt + "," + fov + ",Float";
}


function openNaverPastRoadviewV666() {
  var url = buildNaverRoadviewHistoryUrlV666();
  if (!url) {
    alert("네이버 거리뷰가 준비된 후 다시 눌러 주세요.");
    return;
  }

  var opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
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


function showNaverRoadviewUnavailableV664(message, sequence) {
  if (sequence !== roadviewOpenSequenceV653) return;

  var modal = document.querySelector("#roadviewModal.roadview-modal");
  var status = document.getElementById("naverRoadviewModalStatus");
  if (!modal || !modal.classList.contains("open")) return;

  naverRoadviewLoadingV653 = false;
  clearNaverRoadviewTimersV658();
  setNaverRoadviewHistoryReadyV666(false);

  if (status) {
    status.textContent = message || "주변에서 네이버 거리뷰를 찾지 못했습니다. 카카오맵은 위 탭에서 직접 선택할 수 있습니다.";
    status.className = "roadview-inline-status error";
  }

  /*
   * 네이버가 늦거나 해당 위치에 거리뷰가 없더라도 사용자의 탭 선택을
   * 임의로 바꾸지 않습니다. 연동 지도는 유지해 위치를 계속 확인할 수
   * 있고, 카카오맵은 사용자가 필요할 때 위 탭에서 직접 선택합니다.
   */
  if (
    !naverMapsAuthFailedV663 &&
    currentRoadviewCoords &&
    window.naver &&
    window.naver.maps
  ) {
    setupNaverRoadviewMapV654(new window.naver.maps.LatLng(
      currentRoadviewCoords.lat,
      currentRoadviewCoords.lng
    ));
    window.setTimeout(syncNaverRoadviewLayoutV654, 30);
  }
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
  setNaverRoadviewHistoryReadyV666(true);

  status.textContent = "네이버 거리뷰 연결 완료";
  status.className = "roadview-inline-status success";
  updateNaverPanoramaInfoV653();

  var panoramaPosition = getNaverRoadviewPositionV654();
  if (panoramaPosition && !naverMapsAuthFailedV663) {
    setupNaverRoadviewMapV654(panoramaPosition);
  }
  updateNaverRoadviewMapV654(true);
  window.setTimeout(syncNaverRoadviewLayoutV654, 30);
  window.setTimeout(syncNaverRoadviewLayoutV654, 120);
  setTimeout(function() {
    if (
      sequence === roadviewOpenSequenceV653 &&
      !naverMapsAuthFailedV663
    ) status.classList.add("hidden");
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
    showNaverRoadviewUnavailableV664(
      "주변 4방향까지 확인했지만 네이버 거리뷰를 찾지 못했습니다. 카카오맵은 위 탭에서 선택할 수 있습니다.",
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
  }, 250);
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
        setNaverRoadviewHistoryReadyV666(false);
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
  setNaverRoadviewHistoryReadyV666(false);

  naverRoadviewFallbackTimerV653 = setTimeout(function() {
    if (
      sequence === roadviewOpenSequenceV653 &&
      !naverRoadviewRequestReadyV658
    ) {
      showNaverRoadviewUnavailableV664(
        "네이버 거리뷰 응답이 지연되고 있습니다. 다시 시도하거나 카카오맵 탭을 선택해 주세요.",
        sequence
      );
    }
  }, 12000);
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

      /* 거리뷰 응답을 기다리는 동안에도 오른쪽 네이버 지도를 먼저 표시합니다. */
      recoverNaverMapsAuthStateV664();
      setupNaverRoadviewMapV654(position);
      window.setTimeout(syncNaverRoadviewLayoutV654, 30);

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
      showNaverRoadviewUnavailableV664(
        "네이버 거리뷰를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
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
  var scheduleNaverRoadviewWarmupV1 = function() {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(warmNaverRoadviewSdkV658, { timeout: 1200 });
    } else {
      window.setTimeout(warmNaverRoadviewSdkV658, 500);
    }
  };
  if (document.readyState === "complete") scheduleNaverRoadviewWarmupV1();
  else window.addEventListener("load", scheduleNaverRoadviewWarmupV1, { once: true });
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
  setNaverRoadviewHistoryReadyV666(
    naverActive && naverRoadviewRequestReadyV658
  );

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

var roadviewCoordinateRequestsV52 = new Map();

function roadviewRoadAddressV52(address) {
  var match = String(address || "").trim().replace(/\s+/g, " ").match(/^(?:(?:대전광역시|대전) )?(동구|중구|서구|유성구|대덕구) ([가-힣0-9·.\-]+(?:로|길))\s+(\d+)(?:-(\d+))?$/);
  return match && Number(match[3]) > 0 ? "대전광역시 " + match[1] + " " + match[2] + " " + Number(match[3]) +
    (Number(match[4]) > 0 ? "-" + Number(match[4]) : "") : "";
}

function resolveRoadviewCoordinatesV52(item) {
  var coords = getItemCoordinates(item);
  if (coords) return Promise.resolve(coords);
  var address = String(item && item.address || "").trim();
  var parcel = addressParcelForReviewV41(address);
  var road = !parcel && roadviewRoadAddressV52(address);
  var query = parcel ? parcel.query : road;
  if (!query) return Promise.reject(Error("정확한 지번 또는 건물번호가 있는 도로명주소가 필요합니다. 원본 주소를 확인해 주세요."));
  if (roadviewCoordinateRequestsV52.has(query)) return roadviewCoordinateRequestsV52.get(query);
  var pending = parcel ? recheckAddressV41(address) : new Promise(function(resolve, reject) {
    var services = window.kakao && kakao.maps && kakao.maps.services;
    if (!services || !services.Geocoder) { reject(Error("지도 주소 검색을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.")); return; }
    var settled = false;
    var timer = setTimeout(function() { finish(Error("주소 조회 시간이 초과됐습니다. 다시 로드뷰를 눌러 주세요.")); }, 8000);
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); }
    try {
      new services.Geocoder().addressSearch(query, function(rows, status) {
        if (settled) return;
        if (status !== services.Status.OK) { finish(Error("주소 검색 결과가 없습니다. 원본 주소를 확인해 주세요.")); return; }
        var matches = new Map();
        (rows || []).forEach(function(row) {
          if (roadviewRoadAddressV52(row.road_address && row.road_address.address_name) !== road) return;
          var point = getItemCoordinates({latitude: row.y, longitude: row.x});
          if (point && point.lat >= 30 && point.lat <= 40 && point.lng >= 120 && point.lng <= 135) matches.set(point.lat + "," + point.lng, point);
        });
        if (matches.size !== 1) { finish(Error("주소와 정확히 일치하는 위치를 하나로 확인하지 못했습니다. 원본 주소를 확인해 주세요.")); return; }
        finish(null, Array.from(matches.values())[0]);
      }, {size: 30, analyze_type: services.AnalyzeType ? services.AnalyzeType.EXACT : "exact"});
    } catch (_) { finish(Error("주소 검색을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.")); }
  });
  roadviewCoordinateRequestsV52.set(query, pending);
  function clear() { if (roadviewCoordinateRequestsV52.get(query) === pending) roadviewCoordinateRequestsV52.delete(query); }
  pending.then(clear, clear);
  return pending;
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

  if (typeof window.keepPinnedClusterSelectionAcrossTransientUiV6525 === "function") {
    window.keepPinnedClusterSelectionAcrossTransientUiV6525(4000);
  } else if (typeof preservePinnedClusterSelectionDuringRelayoutV6517 === "function") {
    preservePinnedClusterSelectionDuringRelayoutV6517(4000);
  }

  roadviewOpenSequenceV653 += 1;
  var sequence = roadviewOpenSequenceV653;
  var requestedAddress = String(item.address || "");
  currentRoadviewItemKey = item.key;
  currentRoadviewCoords = coords;
  currentRoadviewPosition = coords ? new kakao.maps.LatLng(coords.lat, coords.lng) : null;

  title.textContent = item.name || "네이버 거리뷰";
  address.textContent = [item.address || "", item.room || ""].filter(Boolean).join(" ");

  status.textContent = "카카오 로드뷰를 준비하고 있습니다.";
  status.className = "roadview-inline-status loading";
  naverStatus.textContent = "네이버 최신 거리뷰를 찾고 있습니다.";
  naverStatus.className = "roadview-inline-status loading";
  setNaverRoadviewHistoryReadyV666(false);

  container.innerHTML = "";
  naverContainer.style.visibility = coords ? "" : "hidden";
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
  if (coords) {
    switchRoadviewMode("naver");
    return;
  }
  status.textContent = naverStatus.textContent = "매물 주소의 정확한 위치를 확인하고 있습니다.";
  function stillCurrent() {
    return sequence === roadviewOpenSequenceV653 && modal.classList.contains("open") &&
      currentRoadviewItemKey === item.key;
  }
  resolveRoadviewCoordinatesV52(item).then(function(resolved) {
    if (!stillCurrent()) return;
    var live = allItems.find(function(entry) { return entry.key === item.key; });
    if (!live || String(live.address || "") !== requestedAddress || String(item.address || "") !== requestedAddress) {
      throw Error("조회 중 매물 정보가 갱신되었습니다. 창을 닫고 다시 로드뷰를 눌러 주세요.");
    }
    currentRoadviewCoords = resolved;
    currentRoadviewPosition = new kakao.maps.LatLng(resolved.lat, resolved.lng);
    item.latlng = live.latlng = currentRoadviewPosition;
    roadviewTargetPosition = roadviewCameraPosition = currentRoadviewPosition;
    naverContainer.style.visibility = "";
    switchRoadviewMode(currentRoadviewMode);
  }).catch(function(error) {
    if (!stillCurrent()) return;
    status.textContent = naverStatus.textContent = error.message || "매물 위치를 확인하지 못했습니다. 다시 시도해 주세요.";
    status.className = naverStatus.className = "roadview-inline-status error";
  });
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

  if (typeof window.keepPinnedClusterSelectionAcrossTransientUiV6525 === "function") {
    window.keepPinnedClusterSelectionAcrossTransientUiV6525(4000);
  }

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
  setNaverRoadviewHistoryReadyV666(false);
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

  if (typeof window.restorePinnedClusterSelectionAfterTransientUiV6525 === "function") {
    window.setTimeout(function() {
      window.restorePinnedClusterSelectionAfterTransientUiV6525();
    }, 80);
  }
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
  var sidebar = getListingScrollContainerV2();
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
    var sidebar = getListingScrollContainerV2();

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


function resizeMemoEditorNowV6107(element) {
  if (!element || !element.isConnected) return;
  element.style.height = "auto";
  element.style.height = element.scrollHeight + "px";
}


function autoResizeMemoEditor(element, immediate) {
  if (!element) return;

  if (immediate || typeof requestAnimationFrame !== "function") {
    if (element.__memoResizeFrameV6107 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(element.__memoResizeFrameV6107);
    }
    element.__memoResizeFrameV6107 = 0;
    resizeMemoEditorNowV6107(element);
    return;
  }

  if (element.__memoResizeFrameV6107) return;
  element.__memoResizeFrameV6107 = requestAnimationFrame(function() {
    element.__memoResizeFrameV6107 = 0;
    resizeMemoEditorNowV6107(element);
  });
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
    autoResizeMemoEditor(editor, true);
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
    alert("JS부동산 D1 서버 연결을 확인해주세요.");
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
      throw new Error("메모 저장값을 D1에서 재확인하지 못했습니다.");
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
      throw new Error("메모의 연락처가 D1 연락처목록에 저장되지 않아 메모 정리를 중단했습니다.");
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

  /* 네이버·당근 광고문구에는 중개업소 전화번호가 포함될 수 있습니다.
   * 해당 번호를 임대인 연락처로 오인하지 않도록 원본 설명과 저장 필드를
   * 연락처 후보에서 제외합니다. 다만 사용자가 메모에 직접 역할을 붙여 적은
   * 임대인·세입자 번호는 신뢰 가능한 수동 입력이므로 별도로 허용합니다. */
  var providerSource = String(item && item.source || "").toLowerCase();
  var externalProvider = providerSource.indexOf("네이버") >= 0 || providerSource.indexOf("naver") >= 0 ||
      providerSource.indexOf("당근") >= 0 || providerSource.indexOf("daangn") >= 0 ||
      providerSource.indexOf("danggeun") >= 0;

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

  if (!externalProvider) {
    add("임", item && item.landlordPhone);
    add("세", item && item.tenantPhone);
  }

  var storedContacts = item && item.contactListRaw;
  if (typeof storedContacts === "string" && storedContacts.trim()) {
    try {
      storedContacts = JSON.parse(storedContacts);
    } catch (_) {
      storedContacts = [];
    }
  }
  if (!externalProvider && Array.isArray(storedContacts)) {
    storedContacts.forEach(function(contact) {
      add(contact && contact.role, contact && (contact.phone || contact.number));
    });
  }

  var memo = String(item && item.memo || "");
  var rolePattern = externalProvider
    ? "(주인|건물주|소유자|임대인|사장|남성|남자|사모|여성|여자|관리업체|관리인|관리|세입자|임차인|임차|가족|주|임|남|여|관|세|가)"
    : "(주인|건물주|소유자|임대인|사장|남성|남자|사모|여성|여자|관리업체|관리인|관리|부동산|중개사|중개|세입자|임차인|임차|가족|주|임|남|여|관|부|세|가)";
  var roleBoundary = "(?:^|[\\s\\(\\[\\{,;:：·/\\.\\-!?。])";
  var phonePattern = "(0(?:10|11|16|17|18|19)[-\\s]?\\d{3,4}[-\\s]?\\d{4}|02[-\\s]?\\d{3,4}[-\\s]?\\d{4}|0(?:[3-6][1-5]|70)[-\\s]?\\d{3,4}[-\\s]?\\d{4})";
  var roleBridge = "(?:[\\s\\)\\(\\]:：=.,·-]*(?:(?:추가\\s*)?(?:연락처|번호)|전화번호|전화)?[\\s\\)\\(\\]:：=.,·-]*)";
  var matcher = new RegExp(roleBoundary + rolePattern + roleBridge + phonePattern, "g");
  var match;
  while ((match = matcher.exec(memo))) {
    add(match[1], match[2]);
  }

  // 역할이 없는 광고 전화번호는 네이버·당근 매물에서 절대 표시하지 않습니다.
  if (!externalProvider) {
    var everyPhoneMatcher = new RegExp(phonePattern, "g");
    while ((match = everyPhoneMatcher.exec(memo))) {
      var prefix = memo.slice(Math.max(0, match.index - 18), match.index);
      var roleMatch = prefix.match(new RegExp(roleBoundary + rolePattern + roleBridge + "$"));
      add(roleMatch ? roleMatch[1] : "기", match[1]);
    }
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
    var sourceRole = String(contact && contact.role || "").trim();
    contacts.push({
      role: listContactRoleV650(sourceRole),
      roleLabel: /^(?:주인|관리|사장)$/.test(sourceRole) ? sourceRole : "",
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
      '<span class="list-contact-role-v654">' + escapeHtml(contact.roleLabel || meta.name) + '</span>' +
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

function persistentListElevatorV843(item) {
  var status = String(item && item.buildingInfoStatus || "").trim();
  var elevators = Number(item && item.buildingElevators || 0);
  return (status === "확인완료" || status === "connected") && elevators > 0;
}

function buildListElevatorIconV843(item) {
  var hasElevator = persistentListElevatorV843(item);
  return '<span class="item-elevator-v650"' + (hasElevator ? '' : ' hidden') +
    ' title="공식자료 승강기 있음" aria-label="승강기 있음">' +
    '<svg class="item-elevator-glyph-v651" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="2" y="2" width="20" height="20" rx="2"></rect>' +
      '<path class="item-elevator-divider-v665" d="M11 4.5v15"></path>' +
      '<path class="item-elevator-arrows-v660" d="M7 10V5m-2 2 2-2 2 2m-2 7v5m-2-2 2 2 2-2"></path>' +
      '<circle class="item-elevator-person-v662" cx="16" cy="8" r="1.6"></circle>' +
      '<path class="item-elevator-person-v662" d="M16 10.5v4.5m-2.7-2.6 2.7-1.9 2.7 1.9M16 15l-2.4 3.8M16 15l2.4 3.8"></path>' +
    '</svg>' +
  '</span>';
}


function addListItem(item, appendTarget) {
    var div = document.createElement("div");
    var favoriteMapContextV1 = typeof window.getFavoriteMapRemovalContextV1 === "function"
        ? window.getFavoriteMapRemovalContextV1(item) : null;
    var printSelected = selectedPrintKeys.includes(actionSelectionKeyV660(item));
    var memoOpen = openMemoKey === item.key;
    var memoEditing = editingMemoKey === item.key;
    var cachedBuildingBadgeV6519 = window.JSBuildingRegisterBadges &&
        typeof window.JSBuildingRegisterBadges.getCached === "function"
        ? window.JSBuildingRegisterBadges.getCached(item)
        : null;
    var cachedBuildingYearTextV6519 = cachedBuildingBadgeV6519 && cachedBuildingBadgeV6519.year
        ? "준" + cachedBuildingBadgeV6519.year
        : "준공 -";
    var cachedBuildingYearClassV6519 = cachedBuildingBadgeV6519 && cachedBuildingBadgeV6519.verified
        ? " verified"
        : "";
    div.className =
        "item" +
            (isLinkedListingSelectedV845(item) ? " selected" : "") +
            (item.state === "계약완료" ? " done" : "") +
            (printSelected ? " print-selected" : "") +
            (memoOpen ? " memo-open" : "");
    var encodedKey = encodeURIComponent(item.key);
    var encodedActionSelectionKeyV660 = encodeURIComponent(actionSelectionKeyV660(item));
    var selectionControlV1 = '<label class="item-action-select item-head-select-v650" title="이 매물을 작업 대상으로 선택">' +
        '<input type="checkbox" class="action-select-check" ' + (printSelected ? 'checked' : '') +
        ' onclick="event.stopPropagation(); togglePrintSelection(\'' + encodedActionSelectionKeyV660 + '\')"></label>';
    if (favoriteMapContextV1) {
        div.setAttribute("data-favorite-map-folder-id", favoriteMapContextV1.folderId);
        selectionControlV1 += '<button type="button" class="favorite-map-remove-v1" ' +
            'title="' + escapeHtml(favoriteMapContextV1.folderName + ' 폴더에서만 찜 제거') + '" ' +
            'aria-label="' + escapeHtml((item.address || item.name || '매물') + ' 찜 제거') + '" ' +
            'onclick="event.stopPropagation(); removeFavoriteMapItemV1(' +
            escapeHtml(JSON.stringify(encodeURIComponent(favoriteMapContextV1.folderId))) + ',' +
            escapeHtml(JSON.stringify(encodeURIComponent(favoriteMapContextV1.ref))) + ')">찜 제거</button>';
    }
    var doneLabel = item.state === "계약완료"
        ? '<button type="button" class="done-badge done-restore-button-v1" ' +
            'title="계약가능으로 복구" aria-label="계약완료 상태를 계약가능으로 복구" ' +
            'onclick="event.stopPropagation(); restoreCompletedListing(\'' + encodedKey + '\')">계약완료 ↩</button>'
        : "";
    var displayType = getListingTypeLabelV1(item);
    var typeLabel = displayType
        ? '<span class="type-badge">' + escapeHtml(displayType) + '</span>'
        : "";
    var buildingFloorLabelV1 = window.JSListingTradeV1 && window.JSListingTradeV1.buildingFloorLabel
        ? window.JSListingTradeV1.buildingFloorLabel(item) : "";
    var landUseLabelV1 = window.JSListingTradeV1 && window.JSListingTradeV1.landUseLabel
        ? window.JSListingTradeV1.landUseLabel(item) : "";
    var roomDisplayV1 = item.sourceFloorVerifiedV1 ? item.advertisedRoomV1 : item.room;
    var roomLabelV1 = landUseLabelV1 || buildingFloorLabelV1 || formatListingRoomForCardV653(roomDisplayV1, item.floor);
    if (!landUseLabelV1 && item.sourceFloorVerifiedV1 && !roomDisplayV1 && getItemFloorNumber(item) === null)
        roomLabelV1 = "층수 미확인";
    var buildingSaleV1 = window.JSListingTradeV1 && window.JSListingTradeV1.isBuildingSale && window.JSListingTradeV1.isBuildingSale(item);
    var buildingSaleInfoV1 = window.JSListingTradeV1 && window.JSListingTradeV1.buildingSaleAreaInfoHtml
        ? window.JSListingTradeV1.buildingSaleAreaInfoHtml(item) : "";
    var sourceLabel = isFieldVisitItem(item)
        ? '<span class="gongsil-source-badge verification-pending-v661">미확인</span>'
        : (isConfirmedVisitItem(item) || isGongsilBoxItem(item)
            ? '<span class="gongsil-source-badge verification-done-v661">확인</span>'
            : "");
    var favoriteRefV821 = item.propertyId
        ? "property:" + String(item.propertyId).trim()
        : item.key;
    var encodedFavoriteRefV821 = encodeURIComponent(favoriteRefV821);
    var encodedEditTargetV648 = encodeURIComponent(item.propertyId
        ? "id:" + String(item.propertyId).trim()
        : "key:" + item.key);
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
    if (unifiedCardPartsV8.sourceButton)
        sourceLinkButton = unifiedCardPartsV8.sourceButton;
    var favoriteHeaderButtonV661 = "";
    favoriteHeaderButtonV661 = buildPhoneFavoriteButtonV2(item, encodedFavoriteRefV821);
    var actionContactButtonV654 = buildListContactButtonV654(item, encodedEditTargetV648, false);
    var depositDisplay = listDisplayValueV650(item, "deposit");
    var rentDisplay = listDisplayValueV650(item, "rent");
    var feeDisplay = listDisplayValueV650(item, "fee");
    var premiumDisplay = listDisplayValueV650(item, "premium");
    var areaDisplay = listDisplayValueV650(item, "area");
    var saleCardV1 = window.JSListingTradeV1 && window.JSListingTradeV1.isSale(item);
    var landCardV4 = saleCardV1 && window.JSListingTradeV1.normalizedSaleCategory(item) === "land";
    var salePriceDisplayV1 = saleCardV1
        ? (window.JSSaleWorkbenchV1 ? window.JSSaleWorkbenchV1.price(window.JSListingTradeV1.displayPrice(item)) : Number(window.JSListingTradeV1.displayPrice(item) || 0).toLocaleString("ko-KR"))
        : "";
    var priceValuesMarkupV1 = saleCardV1
        ? '<span class="price-main listing-sale-price-v1"><b>매매</b> ' + escapeHtml(salePriceDisplayV1) + '</span>' +
            (buildingSaleV1 ? '' : '<span class="price-separator">·</span>' + window.JSListingTradeV1.saleAreaHtml(item))
        : '<span class="price-main"><b><span class="price-label-full-v650">보증금</span><span class="price-label-short-v650">보</span></b> ' + escapeHtml(depositDisplay) + ' / <b><span class="price-label-full-v650">월세</span><span class="price-label-short-v650">월</span></b> ' + escapeHtml(rentDisplay) + '</span>' +
            '<span class="price-separator">·</span>' +
            '<span class="price-fee"><b><span class="price-label-full-v650">관리비</span><span class="price-label-short-v650">관</span></b> ' + escapeHtml(feeDisplay) + '</span>' +
            '<span class="price-separator">·</span>' +
            '<span class="price-premium"><b><span class="price-label-full-v650">권리금</span><span class="price-label-short-v650">권</span></b> ' + escapeHtml(premiumDisplay) + '</span>' +
            '<span class="price-separator">·</span>' +
            '<span class="price-area"><b><span class="price-label-full-v650">평수</span><span class="price-label-short-v650">평</span></b> ' + escapeHtml(areaDisplay) + '</span>';
    var memoToggleButton = '<button type="button" class="item-memo-toggle ' + (memoOpen ? 'on' : '') + '" ' +
        'title="메모 ' + (memoOpen ? '닫기' : '열기') + '" aria-label="메모 ' + (memoOpen ? '닫기' : '열기') + '" ' +
        'onclick="event.stopPropagation(); toggleItemMemo(\'' + encodedKey + '\', this)">' +
        '<span class="item-memo-label-v728">' + (memoOpen ? '메모 ▲' : '메모 ▼') + '</span>' +
        '</button>';
    var memoPanel = memoOpen ? buildMemoPanelMarkupV655(item) : "";
    var navButtonV721 = '<button type="button" class="item-nav-btn" title="카카오내비" aria-label="카카오내비" ' +
        'onclick="event.stopPropagation(); openKakaoNavigation(\'' + encodedKey + '\')"><span class="item-action-text-v661">내비</span>' + buildCardActionIconV662('navigation') + '</button>';
    var roadviewButtonV721 = '<button type="button" class="item-roadview-btn" title="로드뷰" aria-label="로드뷰" ' +
        'onclick="event.stopPropagation(); openKakaoRoadview(\'' + encodedKey + '\')"><span class="item-action-text-v661">로드뷰</span>' + buildCardActionIconV662('roadview') + '</button>';
    var registerButtonV721 = '<button type="button" class="item-building-register-btn" title="국토교통부 건축물대장" ' +
        'onclick="event.stopPropagation(); openBuildingRegisterV640(\'' + encodedKey + '\')">대장</button>';
    if (landCardV4)
        registerButtonV721 = '<button type="button" class="item-building-register-btn land-parcel-lookup-v4" title="토지이음·밸류맵 필지 조회" ' +
            'onclick="event.stopPropagation(); JSSaleWorkbenchV1.lookup(' + escapeHtml(JSON.stringify({address: item.address || ""})) + ')">필지조회</button>';
    var favoriteButtonV721 = '<button type="button" class="item-list-add-btn favorite" title="찜 목록에 추가" ' +
        'onclick="event.stopPropagation(); openItemListDestinationPicker(\'' + encodedFavoriteRefV821 + '\')">찜</button>';
    var editButtonV721 = '<button type="button" class="item-edit-btn-v630" title="임대조건 수정" aria-label="임대조건 수정" ' +
        'onclick="event.stopPropagation(); openPropertyEditModalV630(\'' + encodedEditTargetV648 + '\')"><span class="item-action-text-v661">수정</span>' + buildCardActionIconV662('settings') + '</button>';
    if (saleCardV1)
        editButtonV721 = editButtonV721.replace(/임대조건 수정/g, "매매정보 수정");
    var regularActionButtonsV721 = actionContactButtonV654 + navButtonV721 + roadviewButtonV721 +
        registerButtonV721 + favoriteButtonV721 + editButtonV721 + sourceLinkButton;
    var standardActionsV721 = "" + '<div class="item-action-left">' + regularActionButtonsV721 + '</div>' + memoToggleButton;
    div.setAttribute("data-listing-key", item.key);
    div.setAttribute("data-list-card-id-v681", actionSelectionKeyV660(item));
    div.setAttribute("data-property-id", String(item.propertyId || "").trim());
    if (saleCardV1)
        div.classList.add("listing-sale-card-v1");
    div.setAttribute("title", "매물 상세 보기");
    if (isPhoneListingV2()) {
        div.setAttribute("title", "매물 상세 보기");
        div.setAttribute("tabindex", "0");
        div.setAttribute("role", "group");
        div.setAttribute("aria-label", (item.name || "매물") + " 상세 보기");
        div.onkeydown = function(event) {
            if (event.target !== div || (event.key !== "Enter" && event.key !== " "))
                return;
            event.preventDefault();
            if (window.JSUnifiedListingsV8)
                window.JSUnifiedListingsV8.handleCardClick(item, event);
        };
    }
    if (!saleCardV1) div.innerHTML =
        '<div class="item-card-grid-v650' +
            ((' standard-card-grid-v661')) + '">' +
            unifiedCardPartsV8.thumbnail +
            '<div class="item-compact-main-v650' +
            ((' standard-card-main-v661')) + '">' +
            '<div class="item-compact-head-v650">' +
            selectionControlV1 +
            '<span class="item-building-year-v650 item-building-year-head-v652' +
            cachedBuildingYearClassV6519 +
            '" title="건축물대장 사용승인일">' +
            escapeHtml(cachedBuildingYearTextV6519) +
            '</span>' +
            doneLabel +
            ('') +
            '<span class="item-building-name" title="' + escapeHtml(item.name || "건물명 -") + '">' + escapeHtml(item.name || "건물명 -") + '</span>' +
            '<span class="item-address-room-v650">' +
            '<span class="item-address-text" title="' + escapeHtml(item.address || "주소 -") + '">' + escapeHtml(item.address || "주소 -") + '</span>' +
            (buildingSaleV1 ? '' : roomLabelV1
                ? '<span class="item-room-badge' + (landUseLabelV1 ? ' land-use-badge-v1' : buildingFloorLabelV1 ? ' building-sale-floor-v1' : '') + '" title="' + escapeHtml(roomLabelV1) + '">' + escapeHtml(roomLabelV1) + '</span>'
                : '<span class="item-room-badge empty">호실 -</span>') +
            buildListElevatorIconV843(item) +
            '</span>' +
            favoriteHeaderButtonV661 +
            ('') +
            '</div>' +
            buildingSaleInfoV1 +
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
            priceValuesMarkupV1 +
            '</span>' +
            (regDateLabel
                ? '<span class="item-reg-date item-reg-date-price-mobile-v652">등록 ' + escapeHtml(regDateLabel) + '</span>'
                : '') +
            (saleCardV1 ? window.JSListingTradeV1.saleLandInfoHtml(item) : '') +
            '</div>' +
            (saleCardV1 ? window.JSListingTradeV1.saleCardFactsHtml(item) : '') +
            '<div class="item-action-row item-compact-actions-v650' +
            (('')) + '">' +
            (standardActionsV721) +
            '</div>' +
            '</div>' +
            '</div>' +
            memoPanel;
    if (buildingSaleV1) {
        div.classList.add("listing-building-card-v5");
        div.innerHTML = '<div class="sale-card-heading-v5">' + selectionControlV1 +
            '<span class="sale-card-category-v5">' + escapeHtml(displayType || "건물매매") + '</span>' + doneLabel +
            '<div class="sale-card-meta-v5"><span class="sale-card-source-v14">' + escapeHtml(item.source || "출처 미제공") + '</span>' +
            (cachedBuildingBadgeV6519 && cachedBuildingBadgeV6519.year ? '<span class="item-building-year-v650' + cachedBuildingYearClassV6519 + '">' + escapeHtml(cachedBuildingYearTextV6519) + '</span>' : '') +
            buildListElevatorIconV843(item) + sourceLabel + '</div>' + favoriteHeaderButtonV661 + '</div>' +
            '<div class="item-card-grid-v650 standard-card-grid-v661">' + unifiedCardPartsV8.thumbnail +
            '<div class="item-compact-main-v650 standard-card-main-v661">' +
            '<div class="item-compact-head-v650"><span class="item-building-name">' + escapeHtml(item.name || "매매 매물") + '</span>' +
            '<span class="item-address-room-v650"><span class="item-address-text">' + escapeHtml(item.address || "주소 미제공") + '</span></span></div>' +
            '<div class="price-line item-compact-price-v650"><span class="item-price-values-v652"><span class="price-main listing-sale-price-v1"><b>매매</b> ' + escapeHtml(salePriceDisplayV1) + '</span></span>' + window.JSListingTradeV1.saleListMetricsHtml(item) + '</div></div></div>' +
            window.JSListingTradeV1.saleCardFactsHtml(item, true) +
            '<div class="item-action-row item-compact-actions-v650">' + standardActionsV721 + '</div>' + memoPanel;
    }
    if (landCardV4) {
        div.classList.add("listing-land-card-v4");
        var landNameV4 = String(item.name || "").trim();
        var landTitleV4 = landNameV4 && landNameV4 !== item.address ? landNameV4 : "토지 매물";
        div.innerHTML = '<div class="land-card-heading-v4">' + selectionControlV1 +
            '<span class="land-card-category-v4">토지매매</span>' +
            '<span class="item-room-badge land-use-badge-v1">' + escapeHtml(landUseLabelV1) + '</span>' + doneLabel +
            '<div class="land-card-meta-v4"><span>' + escapeHtml(item.source || "출처 미제공") + '</span>' + sourceLabel + '</div>' + favoriteHeaderButtonV661 + '</div>' +
            '<div class="item-card-grid-v650 standard-card-grid-v661">' + unifiedCardPartsV8.thumbnail +
            '<div class="item-compact-main-v650 standard-card-main-v661">' +
            '<div class="item-compact-head-v650"><span class="item-building-name" title="' + escapeHtml(landTitleV4) + '">' + escapeHtml(landTitleV4) + '</span>' +
            '<span class="item-address-room-v650"><span class="item-address-text">' + escapeHtml(item.address || "주소 미제공") + '</span></span></div>' +
            '<div class="price-line item-compact-price-v650"><span class="item-price-values-v652"><span class="price-main listing-sale-price-v1"><b>매매</b> ' + escapeHtml(salePriceDisplayV1) + '</span></span>' +
            window.JSListingTradeV1.saleListMetricsHtml(item) + '</div></div></div>' +
            window.JSListingTradeV1.saleCardFactsHtml(item, true) +
            '<div class="item-action-row item-compact-actions-v650">' + standardActionsV721 + '</div>' + memoPanel;
    }
    if (saleCardV1 && window.JSSaleDossierV9) window.JSSaleDossierV9.refreshUnits(div);
    if (saleCardV1 && window.JSSaleReviewV10) window.JSSaleReviewV10.mountCard(div, item);
    var cardWarmupTimerV6107 = 0;
    function cancelCardWarmupV6107() {
        if (!cardWarmupTimerV6107)
            return;
        window.clearTimeout(cardWarmupTimerV6107);
        cardWarmupTimerV6107 = 0;
    }
    function warmUpCardDetailsV6107() {
        if (!div.isConnected)
            return;
        if (window.JSUnifiedListingsV8 &&
            typeof window.JSUnifiedListingsV8.prefetch === "function") {
            window.JSUnifiedListingsV8.prefetch(encodeURIComponent(String(item && item.propertyId || "")));
        }
        if (Number(item && item.gongsilContactCountV8) > 0) {
            prefetchListContactPopupV654(encodedEditTargetV648).catch(function() { });
        }
    }
    div.onclick = function(event) {
        cancelCardWarmupV6107();
        if (window.JSUnifiedListingsV8 &&
            typeof window.JSUnifiedListingsV8.handleCardClick === "function") {
            window.JSUnifiedListingsV8.handleCardClick(item, event);
        }
    };
    // Action buttons stop bubbling before the normal card click handler.
    // Capture their owning card without opening another detail or changing checks.
    div.addEventListener("click", function(event) {
        var action = event.target && event.target.closest && event.target.closest("button,a");
        if (!action || action.disabled || action.getAttribute("aria-disabled") === "true" || !div.closest("#list")) return;
        // Removal owns its confirmation and closes only the removed detail.
        // Do not move selection or discard another detail before confirmation.
        if (action.matches(".favorite-map-remove-v1")) return;
        selectListingForActionV54(item);
    }, true);
    div.onpointerenter = function() {
        cancelCardWarmupV6107();
        cardWarmupTimerV6107 = window.setTimeout(function() {
            cardWarmupTimerV6107 = 0;
            if (div.matches && !div.matches(":hover"))
                return;
            warmUpCardDetailsV6107();
        }, 180);
    };
    div.onpointerleave = cancelCardWarmupV6107;
    div.onpointerdown = cancelCardWarmupV6107;
    (appendTarget || document.getElementById("list")).appendChild(div);
    observeUnifiedDuplicateShimmerV812(div);
    if (!landCardV4 && window.JSBuildingRegisterBadges && typeof window.JSBuildingRegisterBadges.bind === "function") {
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


function resetFilter() {
  if (window.JSSaleWorkbenchV1) window.JSSaleWorkbenchV1.reset();
  if (window.JSListingTradeV1 && typeof window.JSListingTradeV1.setMode === "function") {
    window.JSListingTradeV1.setMode("lease", { apply: false });
  }
  document.getElementById("keyword").value = "";
  document.getElementById("typeFilter").value = "";
  var sourceFilter = document.getElementById("sourceFilter");
  var floorQuickFilter = document.getElementById("floorQuickFilter");
  var brokerageFeeFilter = document.getElementById("brokerageFeeFilter");
  if (sourceFilter) sourceFilter.value = "";
  if (floorQuickFilter) floorQuickFilter.value = "";
  if (brokerageFeeFilter) brokerageFeeFilter.value = "";
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
  if (typeof window.clearActiveFavoriteFolderFilterV1 === "function") {
    window.clearActiveFavoriteFolderFilterV1({ disableFilter: true, silent: true });
  } else {
    activeFavoriteFolderId = "";
    activeFavoriteFolderName = "";
    favoriteFilterKeys = [];
  }
  hideDone = true;
  doneOnly = false;
  saveDoneViewModeV656();
  gongsilOnly = false;
  todayNewOnly = false;
  newListingDays = 0;
  if (window.JSTodayListingsV1) window.JSTodayListingsV1.onPeriodChanged(0);
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
  ["todayNewBtn", "newListing3DaysBtn", "newListing7DaysBtn", "newListing15DaysBtn"].forEach(function(id) {
    var newListingButton = document.getElementById(id);
    if (!newListingButton) return;
    newListingButton.classList.remove("on");
    newListingButton.setAttribute("aria-checked", "false");
  });
  updateMultiClusterButton();
  updateMultiClusterStatus();
  if (typeof window.clearMapMeasurementsV657 === "function") {
    window.clearMapMeasurementsV657(true);
  } else {
    window.mapRadiusFilterV658 = null;
    window.mapPolygonFilterV661 = null;
  }
  selectedGroupKey = null;
  clearLinkedListingSelectionV845();
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
   - Cloudflare D1 API로 기존 매물 수정
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


function restoreCompletedListing(encodedKey) {
  var key = decodeURIComponent(encodedKey || "");
  var item = getItemByKeyForStatus(key);

  if (!item || item.state !== "계약완료") {
    alert("복구할 계약완료 매물을 찾지 못했습니다.");
    return;
  }

  var linkedCount = Math.max(1, Number(item.unifiedOriginalCountV8) || 1);
  var message =
    "이 매물을 계약가능 상태로 복구할까요?\n" +
    "거래완료 날짜 표식도 함께 제거됩니다.";

  if (linkedCount > 1) {
    message += "\n연결된 동일매물 " + linkedCount + "개도 그대로 유지합니다.";
  }

  if (!confirm(message)) return;
  toggleDoneStatus(encodedKey, false);
}


function restoreListScrollAfterRender(scrollTop) {
  requestAnimationFrame(function() {
    var sidebar = getListingScrollContainerV2();
    if (sidebar) sidebar.scrollTop = scrollTop;
  });
}


function refreshDoneStatusUI(keepScroll) {
  var sidebar = getListingScrollContainerV2();
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
      "JS부동산 D1 서버가 아직 연결되지 않았습니다.\n\n" +
      "서버 연결 상태를 확인해주세요."
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

    var restoredOriginalCount = Math.max(
      0,
      Number(result && result.activeSourceCount) || 0
    );
    document.getElementById("status").innerHTML =
      checked
        ? "거래완료 저장 요청 완료"
        : "계약가능 복구 요청 완료" +
          (restoredOriginalCount > 1
            ? " · 동일매물 " + restoredOriginalCount + "개 유지"
            : "");

    // D1 반영값을 다시 읽어 실제 저장 상태를 확인
    if (!result || !result.queued) {
      setTimeout(function() { loadSheet(true, true); }, 700);
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


function actionSelectionKeyV660(item) {
  if (!item) return "";
  var propertyId = String(item && item.propertyId || "").trim();
  var sheetRow = Number(item.sheetRow);
  var rowSuffix = Number.isFinite(sheetRow) && sheetRow > 0 ? "|row:" + sheetRow : "";
  if (propertyId) return "property:" + propertyId + rowSuffix;

  var sourceLink = String(item.sourceLink || "").trim();
  if (sourceLink) return "source:" + sourceLink + rowSuffix;

  return "item:" + String(item.key || "") + rowSuffix;
}

window.actionSelectionKeyV660 = actionSelectionKeyV660;


function getLinkedSelectionCardIdV845(item) {
  return actionSelectionKeyV660(item);
}


function isLinkedListingSelectedV845(item) {
  if (!item || !selectedItemKey || !selectedListCardIdV845) return false;
  return selectedItemKey === item.key &&
    selectedListCardIdV845 === getLinkedSelectionCardIdV845(item);
}


function clearLinkedListingSelectionV845() {
  selectedItemKey = null;
  selectedListCardIdV845 = null;
}


window.getLinkedSelectionCardIdV845 = getLinkedSelectionCardIdV845;
window.clearLinkedListingSelectionV845 = clearLinkedListingSelectionV845;

function selectListingForActionV54(item) {
  if (!item || !item.key) return;
  if (!isLinkedListingSelectedV845(item) && typeof window.selectListingOnMapV844 === "function") {
    window.selectListingOnMapV844(item);
  }
  selectedItemKey = item.key;
  selectedListCardIdV845 = getLinkedSelectionCardIdV845(item);
  document.querySelectorAll("#list .item").forEach(function(card) {
    card.classList.toggle("selected", card.getAttribute("data-list-card-id-v681") === selectedListCardIdV845);
  });
  var unified = window.JSUnifiedListingsV8;
  var drawer = document.getElementById("unifiedDetailDrawerV8");
  if (drawer && drawer.classList.contains("open") && unified &&
      typeof unified.isOpenForProperty === "function" && !unified.isOpenForProperty(String(item.propertyId || "")) &&
      typeof unified.closeForOverlay === "function") {
    unified.closeForOverlay();
  }
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
    var key = actionSelectionKeyV660(item);
    if (key && !selectedPrintKeys.includes(key)) {
      selectedPrintKeys.push(key);
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

  var visibleKeys = (visibleListItems || []).map(actionSelectionKeyV660).filter(Boolean);
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
  if (window.JSSaleWorkbenchV1) window.JSSaleWorkbenchV1.syncComparisonTray();
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
    alert("JS부동산 D1 서버가 아직 연결되지 않았습니다.");
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
    var selectionKey = actionSelectionKeyV660(item);
    previousValues[selectionKey] = item.memo || "";
    doneTogglePendingKeys[selectionKey] = true;
    item.memo = markFieldVisitConfirmedInMemo(item.memo || "");
  });

  refreshDoneStatusUI(true);
  document.getElementById("status").innerHTML =
    "임장 처리 " + targetItems.length + "개 저장중...";

  var requests = targetItems.map(function(item) {
    var payload = {
      /*
       * 기존 toggleDone 수정 기능을 D1 API에서 재사용합니다.
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
      delete doneTogglePendingKeys[actionSelectionKeyV660(item)];
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
      var selectionKey = actionSelectionKeyV660(item);
      item.memo = previousValues[selectionKey] || "";
      delete doneTogglePendingKeys[selectionKey];
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
    alert("JS부동산 D1 서버가 아직 연결되지 않았습니다.");
    return;
  }

  if (!confirm(selectedItems.length === 1 ? "정말 거래완료 하시겠습니까?" : "선택한 " + selectedItems.length + "개 매물을 정말 거래완료 하시겠습니까?")) {
    return;
  }

  var sidebar = document.getElementById("sidebar");
  var scrollTop = sidebar ? sidebar.scrollTop : 0;

  selectedItems.forEach(function(item) {
    doneTogglePendingKeys[actionSelectionKeyV660(item)] = true;
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
      delete doneTogglePendingKeys[actionSelectionKeyV660(item)];
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
      delete doneTogglePendingKeys[actionSelectionKeyV660(item)];
    });

    refreshDoneStatusUI(true);
    alert("선택 매물 완료 저장 중 오류가 발생했습니다.");
  });
}


function getSelectedPrintItems() {
  return allItems.filter(function(item) {
    return selectedPrintKeys.includes(actionSelectionKeyV660(item));
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
  clearLinkedListingSelectionV845();
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
    clearLinkedListingSelectionV845();
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

  // 버튼 전체를 다시 만들면 SVG 아이콘이 사라지므로 문구만 갱신한다.
  var label = btn.querySelector("span");
  if (!label) {
    label = document.createElement("span");
    btn.appendChild(label);
  }
  label.textContent = "다중선택";

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
  if (typeof updateSortDropdownUI === "function") updateSortDropdownUI();
  var btn = document.getElementById("hideDoneBtn");
  if (btn) {
    btn.classList.toggle("on", !!hideDone);
    btn.setAttribute("aria-checked", hideDone ? "true" : "false");

    var check = btn.querySelector(".view-toggle-check");
    if (check) check.textContent = hideDone ? "✓" : "";
  }

  var doneOnlyBtn = document.getElementById("doneOnlyBtn");
  if (doneOnlyBtn) {
    doneOnlyBtn.classList.toggle("on", !!doneOnly);
    doneOnlyBtn.setAttribute("aria-checked", doneOnly ? "true" : "false");

    var doneOnlyCheck = doneOnlyBtn.querySelector(".view-toggle-check");
    if (doneOnlyCheck) doneOnlyCheck.textContent = doneOnly ? "✓" : "";
  }

  if (typeof window.syncMapQuickToolStateV657 === "function") {
    window.syncMapQuickToolStateV657();
  }
}

function saveDoneViewModeV656() {
  var mode = doneOnly ? "only" : (hideDone ? "hide" : "all");
  try {
    localStorage.setItem(doneViewStorageKeyV656, mode);
  } catch (_) {}
}

function refreshDoneViewFilterV656() {
  saveDoneViewModeV656();
  if (window.JSUnifiedListingsV8 && window.JSUnifiedListingsV8.refreshOriginalVisibility) {
    window.JSUnifiedListingsV8.refreshOriginalVisibility(allItems || []);
  }
  updateHideDoneMenuUI();
  selectedGroupKey = null;
  clearLinkedListingSelectionV845();
  if (typeof clearPinnedClusterSelectionV6515 === "function") {
    clearPinnedClusterSelectionV6515(false);
  }
  applyFilter();
}

function toggleHideDone() {
  hideDone = !hideDone;
  if (hideDone) doneOnly = false;
  refreshDoneViewFilterV656();
}

function toggleDoneOnly() {
  doneOnly = !doneOnly;
  if (doneOnly) hideDone = false;
  refreshDoneViewFilterV656();
}


function updateErrorStatus() {
  var errorBox = document.getElementById("errorStatus");

  if (!errorBox) return;

  var errors = addressErrorsForMarketV41();
  errorBox.setAttribute('role', 'button');
  errorBox.tabIndex = 0;
  errorBox.onkeydown = function(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showAddressErrors(); } };
  if (errors.length > 0) {
    errorBox.style.display = "block";
    errorBox.textContent = "주소 확인 " + errors.length + "개";
    errorBox.title = '현재 시장의 지도 위치 미확인 매물 · 원본 확인 및 개별 재조회';
  } else {
    errorBox.style.display = "none";
  }
}


function showAddressErrors() {
  var errors = addressErrorsForMarketV41();
  if (!errors.length) return;
  var previous = document.getElementById('addressReviewV41');if (previous) previous.remove();
  var dialog = document.createElement('dialog');dialog.id = 'addressReviewV41';dialog.className = 'address-review-v41';
  dialog.setAttribute('aria-labelledby', 'addressReviewTitleV41');
  var header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');
  title.id='addressReviewTitleV41';title.textContent=(window.JSListingTradeV1?window.JSListingTradeV1.modeLabel()+' · ':'')+'주소 확인 '+errors.length+'개';
  close.type='button';close.textContent='×';close.setAttribute('aria-label','주소 확인 닫기');close.onclick=function(){dialog.close();};header.append(title,close);
  var note=document.createElement('p');note.textContent='지도 위치를 확인하지 못한 매물입니다. 원본 주소를 확인하거나 정확한 지번만 개별 재조회합니다. 광고 주소·가격·찜은 그대로 보존합니다.';
  var list=document.createElement('ol'),status=document.createElement('p');status.setAttribute('role','status');
  var busy=false;
  errors.slice(0,100).forEach(function(item){
    var row=document.createElement('li'),name=document.createElement('strong'),address=document.createElement('p'),reason=document.createElement('p'),actions=document.createElement('div'),retry=document.createElement('button');
    name.textContent=item.name||'이름 미제공';address.textContent=item.address||'주소 미제공';
    reason.textContent=addressReviewReasonV62(item);
    var originals=item.unifiedDisplayOriginalsV2||item.unifiedAllOriginalsV1||[],source=originals.find(function(o){return o.link;})||item;
    var link=source.link||source.sourceLink||item.sourceLink||item.link;
    if(/^https?:\/\//i.test(link||'')){var original=document.createElement('a');original.href=link;original.target='_blank';original.rel='noopener noreferrer';original.textContent='원본 확인';actions.append(original);}
    retry.type='button';retry.textContent='지번 다시 조회';actions.append(retry);
    var parsed=addressParcelForReviewV41(item.address);
    if(!parsed){retry.disabled=true;reason.textContent+=' · 정확한 동·지번을 원본에서 먼저 확인해 주세요.';}
    retry.onclick=async function(){
      if(busy)return;
      if(isLoadingSheet){status.textContent='전체 매물 준비 중입니다. 끝난 뒤 다시 조회해 주세요.';return;}
      busy=true;list.querySelectorAll('button').forEach(function(b){b.disabled=true;});status.textContent='선택한 지번 한 곳만 확인하고 있습니다…';
      try{
        var result=await recheckAddressV41(item.address);
        if(!dialog.isConnected||!dialog.open)return;
        // A new snapshot must never inherit a response for the old object.
        if(!(addressErrorSnapshotV41||allItems).includes(item)){status.textContent='매물 자료가 갱신됐습니다. 주소 확인창을 다시 열어 주세요.';return;}
        item.latlng=new kakao.maps.LatLng(result.lat,result.lng);
        geocodeCache[normalizeAddressForCache(item.address)]={lat:result.lat,lng:result.lng,source:'address',matchedAddress:result.address,savedAt:new Date().toISOString()};
        geocodeCacheDirty=true;saveGeocodeCache();queueSharedGeocodeEntry(item.address,geocodeCache[normalizeAddressForCache(item.address)]);
        errorItems=errorItems.filter(function(value){return value!==item;});
        if(!allItems.includes(item))allItems.push(item);
        var view=typeof captureAutoUpdateViewState==='function'?captureAutoUpdateViewState():null;
        applyFilter();if(view&&typeof restoreAutoUpdateViewState==='function')restoreAutoUpdateViewState(view);
        reason.textContent='정확한 지번의 지도 위치를 확인했습니다. 광고 주소는 유지됩니다.';row.dataset.resolved='true';retry.textContent='위치 확인됨';updateErrorStatus();
        status.textContent='선택한 매물의 지도 위치를 보완했습니다.';
      }catch(error){status.textContent=error.message||'조회 결과를 확인하지 못했습니다.';}
      finally{busy=false;list.querySelectorAll('button').forEach(function(b){b.disabled=!b.dataset.addressRetryValid||b.closest('li').dataset.resolved==='true';});}
    };
    if(parsed)retry.dataset.addressRetryValid='true';row.append(name,address,reason,actions);list.append(row);
  });
  dialog.append(header,note,list,status);document.body.append(dialog);
  if(errors.length>100){var limit=document.createElement('p');limit.textContent='처음 100건을 표시합니다. 해결 후 다시 열면 남은 건을 확인할 수 있습니다.';status.before(limit);}
  dialog.addEventListener('close',function(){dialog.remove();});dialog.showModal();close.focus({preventScroll:true});
}

function addressErrorsForMarketV41() {
  var seen=new Set(),current=new Set(addressErrorSnapshotV41||allItems||[]);
  return (errorItems||[]).filter(function(item){
    if(!item||!current.has(item)||item.latlng||window.JSListingTradeV1&&!window.JSListingTradeV1.matchesItem(item))return false;
    var key=String(item.propertyId||item.key||'')+'|'+String(item.address||'');if(seen.has(key))return false;seen.add(key);return true;
  });
}

function addressReviewReasonV62(item) {
  var originals=item.unifiedDisplayOriginalsV2||item.unifiedAllOriginalsV1||[];
  var active=originals.filter(function(original){return !original.sourceUnavailable&&original.active!==0;});
  if(active.length&&active.every(function(original){return original.addressDisclosure==='hidden';})) {
    return '원본 주소 비공개 · 공개 지번으로 위치를 확정하지 못했습니다. 원본 제공자에게 정확한 지번을 확인해 주세요.';
  }
  return item.geocodeErrorReason||'주소·건물명 검색 결과 없음';
}

function recheckAddressV41(address) {
  return new Promise(function(resolve,reject){
    var links=window.JSParcelExternalLinksV1,parsed=addressParcelForReviewV41(address),services=window.kakao&&kakao.maps&&kakao.maps.services;
    if(!parsed){reject(Error('정확한 동·지번이 필요합니다. 층수·평수를 지번으로 추정하지 않습니다.'));return;}
    if(!services||!services.Geocoder){reject(Error('지도 주소 검색이 준비되지 않았습니다. 잠시 후 다시 확인해 주세요.'));return;}
    var settled=false,timer=setTimeout(function(){finish(Error('주소 조회 시간이 초과됐습니다. 결과는 변경하지 않았습니다.'));},8000);
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);}
    try{new services.Geocoder().addressSearch(parsed.query,function(rows,status){
      if(settled)return;
      if(status!==services.Status.OK){finish(Error('주소 검색 결과가 없습니다. 원본의 지번을 확인해 주세요.'));return;}
      try{
        var exact=links.matchParcel(address,rows),row=rows.find(function(r){try{return links.matchParcel(address,[r]).pnu===exact.pnu;}catch(_){return false;}});
        var lat=Number(row&&row.y),lng=Number(row&&row.x);
        if(!row||!row.y||!row.x||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<30||lat>40||lng<120||lng>135)throw Error('정확한 지번의 좌표를 확인하지 못했습니다.');
        finish(null,{lat:lat,lng:lng,address:exact.address});
      }catch(error){finish(error);}
    },{size:30,analyze_type:services.AnalyzeType?services.AnalyzeType.EXACT:'exact'});}catch(_){finish(Error('주소 검색을 실행하지 못했습니다.'));}
  });
}
function addressParcelForReviewV41(address) {
  var links=window.JSParcelExternalLinksV1,parsed=links&&links.parseAddress(address);
  // A descriptive word such as 소형상가 is not a numbered legal town (종로1가).
  return parsed&&/(?:동|리|\d가)$/.test(parsed.town)?parsed:null;
}
window.addEventListener('js-listing-trade-mode-change',function(){updateErrorStatus();var dialog=document.getElementById('addressReviewV41');if(dialog&&dialog.open)dialog.close();});


/* === JS부동산 AI 등록 v2.0 오버라이드 === */


['qaName','qaAddress','qaRoom','qaType','qaDeposit','qaRent','qaFee','qaPremium','qaArea','qaLandlordPhone','qaTenantPhone','qaMemo','qaState','qaRegDate'].forEach(function(id) {
  setTimeout(function() {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', function() { updateQuickAddWarning(); updateQuickAddPreview(); });
    if (el) el.addEventListener('change', function() { updateQuickAddWarning(); updateQuickAddPreview(); });
  }, 500);
});


/* === JS부동산 AI Parser v1.0.1 최종 오버라이드: 권1000/보2000/월100 등 복붙 약어 인식 강화 === */


/* v6.1 기본 계약완료 숨김 UI 초기화 */
setTimeout(function() {
  updateHideDoneMenuUI();
}, 0);


/* =========================================================
   v6.1.2 층수 필터 표준화
   B1/B01/B101/지1/지하1/-1 => -1
   B201 => -2, 101호 => 1, 502호 => 5
   ========================================================= */
function parseExplicitFloorLabelV1(value) {
  var text = String(value == null ? "" : value).toUpperCase().replace(/\s+/g, "");
  var korean = text.match(/(?:지하|(?:^|[^가-힣])지)0*(\d{1,2})(?:층|F)?/);
  if (korean) return -Math.max(1, Number(korean[1]) || 1);
  var negative = text.match(/(?:^|[^0-9])-(\d{1,2})(?:층|F)/);
  if (negative) return -Math.max(1, Number(negative[1]) || 1);
  var basement = text.match(/(?:^|[^A-Z0-9])B0*(\d{1,2})(?:층|F)/);
  if (basement) return -Math.max(1, Number(basement[1]) || 1);
  var aboveGround = text.match(/(?:^|[^0-9A-Z])(\d{1,2})(?:층|F)/);
  return aboveGround ? Number(aboveGround[1]) || null : null;
}

function listingFloorLabelV1(floor) {
  return floor < 0 ? "지하" + Math.abs(floor) + "층" : floor + "층";
}

function literalListingRoomLabelV1(value) {
  var text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return /호(?:실)?$/i.test(text) ? text.replace(/호실$/i, "호") : text + "호";
}

function parseFloorNotationV612(value, allowRoomInference) {
  var text = String(value == null ? "" : value).trim();
  if (!text) return null;

  var compact = text.toUpperCase().replace(/\s+/g, "");

  var labeledFloor = parseExplicitFloorLabelV1(compact);
  if (labeledFloor !== null) return labeledFloor;

  // A literal unit label is not an independently confirmed basement floor.
  if (allowRoomInference !== false && /^B0\d{1,3}호(?:실)?$/.test(compact)) return null;

  /* 공급사 표기: 해당층/총층 (예: 1/1, 6/7, -1/4) */
  var currentAndTotal = compact.match(/^(-?\d+(?:\.\d+)?)[/／]\d+(?:\.\d+)?$/);
  if (currentAndTotal) {
    var currentFloor = Number(currentAndTotal[1]);
    return Number.isFinite(currentFloor) && currentFloor !== 0 ? currentFloor : null;
  }

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

/* 카드에는 해당층만 표시하고 공급사의 총층 표기는 숨깁니다. */
function formatListingRoomForCardV653(value, knownFloor) {
  var text = String(value == null ? "" : value).trim();
  var authoritativeFloor = parseFloorNotationV612(knownFloor, false);
  var hasKnownFloor = authoritativeFloor !== null && authoritativeFloor !== 0;
  if (!text) return hasKnownFloor ? listingFloorLabelV1(authoritativeFloor) : "";
  var composite = text.match(/^((?:지하|지)\s*\d{1,2}\s*층?|(?:-?\d{1,2}|B\d{1,2})\s*(?:층|F))\s*(B?\d{1,4}(?:\s*[,/~·-]\s*B?\d{1,4})*(?:호(?:실)?)?)$/i);
  if (composite) {
    var currentFloor = hasKnownFloor ? authoritativeFloor : parseFloorNotationV612(composite[1], false);
    if (currentFloor !== null) return listingFloorLabelV1(currentFloor) + " " + literalListingRoomLabelV1(composite[2]);
  }
  var explicitUnit = /^B0\d{1,3}호(?:실)?$/i.test(text.replace(/\s+/g, ""));
  var unitWithKnownFloor = hasKnownFloor && /^(?:B\d{2,4}(?:호(?:실)?)?|\d{3,4}(?:호(?:실)?)?|\d{1,2}호(?:실)?|B?\d{1,4}(?:[,/~·-]B?\d{1,4})+호(?:실)?)$/i.test(text.replace(/\s+/g, ""));
  if (explicitUnit || unitWithKnownFloor) {
    return hasKnownFloor ? listingFloorLabelV1(authoritativeFloor) + " " + literalListingRoomLabelV1(text) : text;
  }
  if (hasKnownFloor && /^(?:(?:지하|지)\d{0,2}(?:층|F)?|B\d{0,4}(?:층|F|호)?|-?\d+(?:\.\d+)?(?:층|F)?(?:[/／]\d+(?:\.\d+)?)?)$/i.test(text.replace(/\s+/g, "")) &&
      parseFloorNotationV612(text, false) !== null) return listingFloorLabelV1(authoritativeFloor);
  var compact = text.replace(/\s+/g, "");
  var currentAndTotal = compact.match(/^(-?\d+(?:\.\d+)?)[/／]\d+(?:\.\d+)?$/);
  if (currentAndTotal) {
    var current = Number(currentAndTotal[1]);
    if (Number.isFinite(current) && current !== 0) {
      return current < 0 ? "지하" + Math.abs(current) + "층" : current + "층";
    }
  }
  var decimalFloor = compact.match(/^(-?\d+(?:\.0+)?)(?:층|F)$/i);
  if (decimalFloor) {
    var floor = Number(decimalFloor[1]);
    if (Number.isFinite(floor) && floor !== 0) {
      return floor < 0 ? "지하" + Math.abs(floor) + "층" : floor + "층";
    }
  }
  return text;
}

function getItemFloorNumber(item) {
  var fromFloor = parseFloorNotationV612(item && item.floor, false);
  if (item && item.sourceFloorVerifiedV1) return fromFloor;
  if (fromFloor !== null) return fromFloor;
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


/* 매물 수정·삭제 UI는 property-edit-v648.js에서 이어서 로드합니다. */
