var sheetURL = "https://docs.google.com/spreadsheets/d/1zRWqjc7xVkiTnFHFujBNI72qr_aDCgxiQipQlnGgWmU/gviz/tq?tqx=out:csv";
var saveApiURL = ""; // Apps Script 웹앱 URL을 여기에 붙여넣으면 자동등록이 켜집니다.

var map, geocoder;
var allItems = [];
var currentItems = [];
var overlays = [];
var selectedGroupKey = null;
var selectedItemKey = null;
var favoriteOnly = false;
var hideDone = false;
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
  document.getElementById("favoriteBtn").innerText = favoriteOnly ? "전체" : "찜만";
  document.getElementById("favoriteBtn").classList.toggle("on", favoriteOnly);
  applyFilter();
}

function toggleDetailFilter() {
  document.getElementById("detailFilter").classList.toggle("open");
  document.getElementById("detailBtn").classList.toggle("on");
}

function naverRoadviewUrl(lat, lng) {
  return "https://map.naver.com/v5/search/" + lat + "," + lng;
}

function openRoadviewModal(lat, lng) {
  document.getElementById("roadviewLink").href = naverRoadviewUrl(lat, lng);
  document.getElementById("roadviewModal").style.display = "block";
}

function closeRoadviewModal() {
  document.getElementById("roadviewModal").style.display = "none";
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

function setupEnterSearch() {
  var inputs = document.querySelectorAll("#keyword, #minDeposit, #maxDeposit, #minRent, #maxRent, #minArea, #maxArea");

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

  select.innerHTML = '<option value="">구분 전체</option>';

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

function groupByAddress(items) {
  var grouped = {};

  items.forEach(function(item) {
    var key = item.address;

    if (!grouped[key]) {
      grouped[key] = {
        key: key,
        address: item.address,
        latlng: item.latlng,
        items: []
      };
    }

    grouped[key].items.push(item);
  });

  return Object.values(grouped);
}

function getClusterDistance() {
  var level = map.getLevel();

  if (level <= 3) return 25;
  if (level <= 5) return 45;
  if (level <= 7) return 65;
  if (level <= 9) return 85;
  return 110;
}

function createDynamicClusters(addressGroups) {
  var projection = map.getProjection();
  var distance = getClusterDistance();
  var clusters = [];

  addressGroups.forEach(function(group) {
    var point = projection.containerPointFromCoords(group.latlng);
    var added = false;

    for (var i = 0; i < clusters.length; i++) {
      var cluster = clusters[i];
      var dx = point.x - cluster.point.x;
      var dy = point.y - cluster.point.y;
      var gap = Math.sqrt(dx * dx + dy * dy);

      if (gap <= distance) {
        cluster.groups.push(group);
        cluster.items = cluster.items.concat(group.items);

        var n = cluster.groups.length;
        cluster.point = new kakao.maps.Point(
          (cluster.point.x * (n - 1) + point.x) / n,
          (cluster.point.y * (n - 1) + point.y) / n
        );

        cluster.latlng = projection.coordsFromContainerPoint(cluster.point);
        added = true;
        break;
      }
    }

    if (!added) {
      clusters.push({
        point: point,
        latlng: group.latlng,
        groups: [group],
        items: group.items.slice()
      });
    }
  });

  clusters.forEach(function(cluster, index) {
    cluster.key = cluster.groups.map(function(g) { return g.key; }).join("||") + "|" + index;
  });

  return clusters;
}

kakao.maps.load(function() {
  map = new kakao.maps.Map(document.getElementById("map"), {
    center: new kakao.maps.LatLng(36.3504, 127.3845),
    level: 5
  });

  geocoder = new kakao.maps.services.Geocoder();

  kakao.maps.event.addListener(map, "idle", function() {
    if (isRendering) return;
    applyFilter();
  });

  setupEnterSearch();
  setupMobilePanelDrag();
  loadSheet();

  setInterval(function() {
    if (isLoadingSheet) {
      pendingAutoUpdate = true;
      console.log("주소 변환중이라 자동 업데이트를 건너뜁니다.");
      return;
    }

    loadSheet(true);
  }, 60000);
});

function loadSheet(isAuto) {
  if (isLoadingSheet) {
    pendingAutoUpdate = true;
    document.getElementById("status").innerHTML = "주소 변환중... 자동 업데이트 대기";
    return;
  }

  isLoadingSheet = true;
  errorItems = [];
  document.getElementById("status").innerHTML = isAuto ? "자동 업데이트 준비중..." : "시트 읽는중...";

  fetch(sheetURL)
    .then(function(res) { return res.text(); })
    .then(function(data) {
      var rows = data.trim().split("\n");
      var rawItems = [];

      for (var i = 1; i < rows.length; i++) {
        var c = parseCSVLine(rows[i]);

        var item = {
          name: clean(c[0]),
          address: clean(c[1]),
          room: clean(c[2]),
          type: clean(c[3]),
          deposit: Number(clean(c[4])) || 0,
          rent: Number(clean(c[5])) || 0,
          fee: Number(clean(c[6])) || 0,
          premium: Number(clean(c[7])) || 0,
          area: Number(clean(c[8])) || 0,
          landlordPhone: clean(c[9]),
          tenantPhone: clean(c[10]),
          memo: clean(c[11]),
          state: clean(c[12]),
          regDate: clean(c[13]),
          latlng: null
        };

        item.key = itemKey(item);

        if (item.address) rawItems.push(item);
      }

      geocodeItems(rawItems, function(doneItems) {
        allItems = doneItems;
        updateTypeOptions(allItems);
        applyFilter();
        updateErrorStatus();
        var waitText = pendingAutoUpdate ? " / 중복 업데이트 1회 건너뜀" : "";
        document.getElementById("status").innerHTML = isAuto ? "자동 업데이트 완료 " + allItems.length + "개" + waitText : "매물 " + allItems.length + "개 불러옴" + waitText;
        pendingAutoUpdate = false;
        isLoadingSheet = false;
      });
    })
    .catch(function(err) {
      isLoadingSheet = false;
      document.getElementById("status").innerHTML = "시트 오류";
      console.error(err);
    });
}

function geocodeItems(items, callback) {
  var done = [];
  var total = items.length;
  var index = 0;
  var convertedCount = 0;
  var cachedCount = 0;

  // 성능 핵심:
  // 1) 이미 변환했던 주소는 localStorage 캐시에서 즉시 사용
  // 2) 캐시에 없는 새 주소만 카카오 주소검색으로 순차 변환
  // 3) 실패한 주소는 1회 재시도 후에만 주소오류 처리
  var requestDelay = 170;
  var retryDelay = 450;
  var maxRetry = 1;

  if (total === 0) {
    callback([]);
    return;
  }

  function updateProgress(mode) {
    var text = "주소 처리중 " + Math.min(index + 1, total) + " / " + total;

    if (mode === "cache") {
      text += " · 저장좌표 " + cachedCount + "개 사용";
    }

    if (mode === "search") {
      text += " · 새 주소 변환중";
    }

    if (mode === "retry") {
      text = "주소 재시도중 " + (index + 1) + " / " + total;
    }

    document.getElementById("status").innerHTML = text;
  }

  function finishOne(delay) {
    convertedCount++;
    index++;

    if (index >= total) {
      saveGeocodeCache();
      callback(done);
      return;
    }

    setTimeout(processNext, delay || 0);
  }

  function searchAddress(item, retryCount) {
    var addressKey = normalizeAddressForCache(item.address);

    geocoder.addressSearch(addressKey, function(result, status) {
      if (status === kakao.maps.services.Status.OK && result && result.length > 0) {
        var lat = result[0].y;
        var lng = result[0].x;

        geocodeCache[addressKey] = {
          lat: lat,
          lng: lng,
          savedAt: new Date().toISOString()
        };
        geocodeCacheDirty = true;

        item.latlng = new kakao.maps.LatLng(lat, lng);
        done.push(item);
        finishOne(requestDelay);
        return;
      }

      if (retryCount < maxRetry) {
        updateProgress("retry");

        setTimeout(function() {
          searchAddress(item, retryCount + 1);
        }, retryDelay);

        return;
      }

      errorItems.push(item);
      finishOne(requestDelay);
    });
  }

  function processNext() {
    var item = items[index];

    if (!item || !item.address) {
      finishOne(0);
      return;
    }

    var addressKey = normalizeAddressForCache(item.address);
    var cached = geocodeCache[addressKey];

    if (cached && cached.lat && cached.lng) {
      item.latlng = new kakao.maps.LatLng(cached.lat, cached.lng);
      done.push(item);
      cachedCount++;
      updateProgress("cache");

      // 캐시된 주소는 기다리지 않고 빠르게 넘김.
      // 50개마다 아주 짧게 쉬어서 모바일 화면 멈춤을 방지.
      finishOne(cachedCount % 50 === 0 ? 15 : 0);
      return;
    }

    updateProgress("search");
    searchAddress(item, 0);
  }

  processNext();
}

function getFilteredItems() {
  if (!map) return allItems;

  var bounds = map.getBounds();

  var keyword = document.getElementById("keyword").value.trim();
  var selectedType = document.getElementById("typeFilter").value;
  var sortType = document.getElementById("sortFilter").value;

  var minDeposit = Number(document.getElementById("minDeposit").value) || 0;
  var maxDeposit = Number(document.getElementById("maxDeposit").value) || 999999999;

  var minRent = Number(document.getElementById("minRent").value) || 0;
  var maxRent = Number(document.getElementById("maxRent").value) || 999999999;

  var minArea = Number(document.getElementById("minArea").value) || 0;
  var maxArea = Number(document.getElementById("maxArea").value) || 999999999;

  var filtered = allItems.filter(function(item) {
    var matchKeyword =
      !keyword ||
      item.name.includes(keyword) ||
      item.address.includes(keyword) ||
      item.room.includes(keyword) ||
      item.type.includes(keyword) ||
      item.memo.includes(keyword);

    var matchType = !selectedType || item.type === selectedType;

    var matchPrice =
      item.deposit >= minDeposit &&
      item.deposit <= maxDeposit &&
      item.rent >= minRent &&
      item.rent <= maxRent &&
      item.area >= minArea &&
      item.area <= maxArea;

    var matchFavorite = !favoriteOnly || isFavorite(item);
    var matchDone = !hideDone || !isDone(item);
    var inMap = item.latlng && bounds.contain(item.latlng);

    return matchKeyword && matchType && matchPrice && matchFavorite && matchDone && inMap;
  });

  filtered.sort(function(a, b) {
    if (sortType === "latest") {
      var dateA = new Date((a.regDate || "").replace(/\./g, "-")).getTime() || 0;
      var dateB = new Date((b.regDate || "").replace(/\./g, "-")).getTime() || 0;
      return dateB - dateA;
    }

    if (sortType === "name") {
      return (a.name || "").localeCompare((b.name || ""), "ko");
    }

    if (sortType === "depositLow") return a.deposit - b.deposit;
    if (sortType === "depositHigh") return b.deposit - a.deposit;
    if (sortType === "rentLow") return a.rent - b.rent;
    if (sortType === "rentHigh") return b.rent - a.rent;
    if (sortType === "areaHigh") return b.area - a.area;
    if (sortType === "areaLow") return a.area - b.area;

    return 0;
  });

  return filtered;
}

function clearMap() {
  overlays.forEach(function(o) { o.setMap(null); });
  overlays = [];
  document.getElementById("list").innerHTML = "";
}

function applyFilter() {
  var filtered = getFilteredItems();
  currentItems = filtered;

  drawItems(filtered);
  document.getElementById("status").innerHTML = "검색 결과 " + filtered.length + "개";
}

function drawItems(items) {
  isRendering = true;
  clearMap();

  var addressGroups = groupByAddress(items);
  var clusters = createDynamicClusters(addressGroups);

  clusters.forEach(function(cluster) {
    var count = cluster.items.length;
    var allDone = cluster.items.length > 0 && cluster.items.every(function(item) {
      return isDone(item);
    });

    var selectedClass = selectedGroupKey === cluster.key ? " selected" : "";
    var doneClass = allDone ? " done" : "";

    var overlayContent =
      '<div class="circle-marker' + doneClass + selectedClass + '" onclick="openCluster(\'' + encodeURIComponent(cluster.key) + '\')">' + count + '</div>';

    var overlay = new kakao.maps.CustomOverlay({
      position: cluster.latlng,
      content: overlayContent,
      yAnchor: 0.5,
      xAnchor: 0.5
    });

    overlay.__cluster = cluster;
    overlay.setMap(map);
    overlays.push(overlay);
  });

  showList(items);
  isRendering = false;
}

function openCluster(encodedKey) {
  var key = decodeURIComponent(encodedKey);

  var overlay = overlays.find(function(o) {
    return o.__cluster && o.__cluster.key === key;
  });

  if (!overlay) return;

  selectedGroupKey = key;
  selectedItemKey = null;

  var items = overlay.__cluster.items;

  showList(items);
  document.getElementById("status").innerHTML = "선택 매물 " + items.length + "개";

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("open");
  }

  redrawSelectedMarkers();
}

function redrawSelectedMarkers() {
  overlays.forEach(function(o) {
    if (!o.__cluster) return;

    var cluster = o.__cluster;
    var count = cluster.items.length;
    var allDone = cluster.items.length > 0 && cluster.items.every(function(item) {
      return isDone(item);
    });

    var selectedClass = selectedGroupKey === cluster.key ? " selected" : "";
    var doneClass = allDone ? " done" : "";

    var content =
      '<div class="circle-marker' + doneClass + selectedClass + '" onclick="openCluster(\'' + encodeURIComponent(cluster.key) + '\')">' + count + '</div>';

    o.setContent(content);
  });
}

function openItem(item) {
  selectedItemKey = item.key;
  selectedGroupKey = null;

  showList([item]);
  document.getElementById("status").innerHTML = "선택 매물 1개";

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("open");
  }
}

function showList(items) {
  visibleListItems = items.slice();
  document.getElementById("list").innerHTML = "";

  items.forEach(function(item) {
    addListItem(item);
  });

  updatePrintSelectedButton();
}

function addListItem(item) {
  var div = document.createElement("div");
  var printSelected = selectedPrintKeys.includes(item.key);

  div.className =
    "item" +
    (selectedItemKey === item.key ? " selected" : "") +
    (isDone(item) ? " done" : "") +
    (printSelected ? " print-selected" : "");

  var doneLabel = isDone(item) ? '<span class="done-badge">계약완료</span>' : "";
  var typeLabel = item.type ? '<span class="type-badge">' + escapeHtml(item.type) + '</span>' : "";
  var encodedKey = encodeURIComponent(item.key);
  var safeKey = escapeHtml(item.key);

  div.innerHTML =
    '<div class="item-top">' +
      '<div class="item-left">' +
        '<input type="checkbox" class="print-check" ' + (printSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); togglePrintSelection(\'' + encodedKey + '\')">' +
        '<div class="item-title-wrap">' +
          '<div class="title">' + doneLabel + typeLabel + escapeHtml(item.name) + ' / ' + escapeHtml(item.address) + ' / ' + escapeHtml(item.room) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="star ' + (isFavorite(item) ? 'on' : '') + '" onclick="event.stopPropagation(); toggleFavorite(\'' + safeKey + '\')">★</div>' +
    '</div>' +
    '<div class="price-line">보증금 ' + item.deposit + ' / 월세 ' + item.rent + ' | 관리비 ' + item.fee + ' | 권리금 ' + item.premium + ' | ' + item.area + '평</div>' +
    '<div class="info-line-compact">임대인 ' + escapeHtml(item.landlordPhone) + ' | 세입자 ' + escapeHtml(item.tenantPhone) + '</div>' +
    '<div class="memo-line">' + escapeHtml(item.memo) + '</div>';

  div.onclick = function() {
    openItem(item);
  };

  document.getElementById("list").appendChild(div);
}

function resetFilter() {
  document.getElementById("keyword").value = "";
  document.getElementById("typeFilter").value = "";
  document.getElementById("sortFilter").value = "latest";
  document.getElementById("minDeposit").value = "";
  document.getElementById("maxDeposit").value = "";
  document.getElementById("minRent").value = "";
  document.getElementById("maxRent").value = "";
  document.getElementById("minArea").value = "";
  document.getElementById("maxArea").value = "";

  favoriteOnly = false;
  hideDone = false;
  document.getElementById("favoriteBtn").innerText = "찜만";
  document.getElementById("favoriteBtn").classList.remove("on");
  document.getElementById("hideDoneBtn").innerText = "완료숨김";
  document.getElementById("hideDoneBtn").classList.remove("on");
  selectedGroupKey = null;
  selectedItemKey = null;

  drawItems(allItems);
  document.getElementById("status").innerHTML = "전체 매물 " + allItems.length + "개";
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

function updatePrintSelectedButton() {
  var btn = document.getElementById("printSelectedBtn");
  if (!btn) return;

  btn.innerText = selectedPrintKeys.length > 0 ? "선택인쇄 " + selectedPrintKeys.length : "선택인쇄";
}

function getSelectedPrintItems() {
  return allItems.filter(function(item) {
    return selectedPrintKeys.includes(item.key);
  });
}

function toggleHideDone() {
  hideDone = !hideDone;

  var btn = document.getElementById("hideDoneBtn");

  if (hideDone) {
    btn.innerText = "전체보기";
    btn.classList.add("on");
  } else {
    btn.innerText = "완료숨김";
    btn.classList.remove("on");
  }

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

function printSelectedList() {
  var printItems = getSelectedPrintItems();

  if (!printItems || printItems.length === 0) {
    alert("인쇄할 매물을 체크해주세요.");
    return;
  }

  function shortText(text, maxLen) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
  }

  var html = `
  <!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8">
  <title>JS부동산 선택 매물 리스트</title>

  <style>
  * { box-sizing:border-box; }

  body {
    font-family:Arial, sans-serif;
    margin:0;
    padding:10px;
    color:#222;
    background:white;
  }

  h1 {
    font-size:18px;
    margin:0 0 3px 0;
  }

  .summary {
    font-size:11px;
    color:#555;
    margin-bottom:7px;
    padding-bottom:6px;
    border-bottom:2px solid #222;
  }

  .print-grid {
    display:grid;
    grid-template-columns:repeat(2, minmax(0, 1fr));
    gap:5px 6px;
    width:100%;
  }

  .print-item {
    border:1px solid #d7dce3;
    border-radius:6px;
    padding:5px 7px;
    margin:0;
    page-break-inside:avoid;
    break-inside:avoid;
    line-height:1.22;
    min-width:0;
  }

  .print-item.done {
    background:#f2f2f2;
    color:#777;
  }

  .line1 {
    font-size:14px;
    font-weight:800;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }

  .line {
    font-size:12.5px;
    margin-top:2px;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }

  .memo-print {
    font-size:12px;
    margin-top:2px;
    white-space:normal;
    overflow:hidden;
    line-height:1.35;
    display:-webkit-box;
    -webkit-line-clamp:2;
    -webkit-box-orient:vertical;
    word-break:break-all;
  }

  .type {
    display:inline-block;
    font-weight:800;
    color:#005bea;
  }

  .done-label {
    display:inline-block;
    color:#777;
    font-weight:800;
    margin-left:4px;
  }

  @media print {
    @page {
      size:A4 portrait;
      margin:7mm;
    }

    body {
      margin:0;
      padding:0;
      width:100%;
    }

    h1 {
      font-size:16px;
    }

    .summary {
      font-size:10px;
      margin-bottom:6px;
      padding-bottom:5px;
    }

    .print-grid {
      display:grid !important;
      grid-template-columns:repeat(2, minmax(0, 1fr)) !important;
      gap:4px 5px;
      width:100%;
    }

    .print-item {
      padding:4px 6px;
      margin:0;
      border-radius:5px;
      break-inside:avoid;
      page-break-inside:avoid;
    }

    .line1 {
      font-size:12.2px;
    }

    .line {
      font-size:11.7px;
      margin-top:1px;
    }

    .memo-print {
      font-size:11.5px;
      margin-top:1px;
      line-height:1.28;
      white-space:normal;
      overflow:hidden;
      display:-webkit-box;
      -webkit-line-clamp:2;
      -webkit-box-orient:vertical;
      word-break:break-all;
    }
  }
  </style>
  </head>

  <body>
  <h1>JS부동산 선택 매물 리스트</h1>
  <div class="summary">총 ${printItems.length}개 / 출력일 ${new Date().toLocaleString("ko-KR")}</div>
  <div class="print-grid">
  `;

  printItems.forEach(function(item) {
    var done = isDone(item);
    var stateLabel = done ? '<span class="done-label">계약완료</span>' : '';
    var typeText = item.type ? '[' + escapeHtml(item.type) + ']' : '[구분없음]';
    var nameText = item.name ? escapeHtml(item.name) + ' / ' : '';
    var memoText = shortText(item.memo || "", 160);

    html += `
    <div class="print-item ${done ? 'done' : ''}">
      <div class="line1"><span class="type">${typeText}</span> ${nameText}${escapeHtml(item.address || "")} / ${escapeHtml(item.room || "")}${stateLabel}</div>
      <div class="line">보${item.deposit} / 월${item.rent} / 관${item.fee} / 권${item.premium} / ${item.area}평</div>
      <div class="line">임대인 ${escapeHtml(item.landlordPhone || "")} / 세입자 ${escapeHtml(item.tenantPhone || "")}</div>
      <div class="memo-print">메모 : ${escapeHtml(memoText)}</div>
    </div>
    `;
  });

  html += `
  </div>
  </body>
  </html>
  `;

  var win = window.open("", "", "width=1000,height=900");

  if (!win) {
    alert("팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 눌러주세요.");
    return;
  }

  win.document.write(html);
  win.document.close();
  win.focus();

  setTimeout(function() {
    win.print();
  }, 300);
}


function openQuickAddModal() {
  var modal = document.getElementById("quickAddModal");
  if (!modal) return;
  modal.style.display = "block";
  setQuickAddNow();
  setTimeout(function() {
    var raw = document.getElementById("qaRaw");
    if (raw) raw.focus();
  }, 80);
}

function closeQuickAddModal() {
  var modal = document.getElementById("quickAddModal");
  if (modal) modal.style.display = "none";
}

function setQuickAddNow() {
  var regDate = document.getElementById("qaRegDate");
  if (regDate && !regDate.value) {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, "0");
    var dd = String(now.getDate()).padStart(2, "0");
    var hh = String(now.getHours()).padStart(2, "0");
    var mi = String(now.getMinutes()).padStart(2, "0");
    regDate.value = yyyy + "-" + mm + "-" + dd + " " + hh + ":" + mi;
  }
}

function onlyNumberText(value) {
  return String(value || "").replace(/,/g, "").replace(/만원/g, "").replace(/만/g, "").replace(/[^0-9.]/g, "");
}

function normalizePhone(value) {
  return String(value || "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
}

function findFirstMatch(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m && m[1]) return onlyNumberText(m[1]);
  }
  return "";
}

function setFieldIfEmpty(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (!el.value && value !== undefined && value !== null && String(value).trim() !== "") {
    el.value = String(value).trim();
  }
}

function parseQuickAddText() {
  var rawEl = document.getElementById("qaRaw");
  if (!rawEl) return;

  var raw = rawEl.value || "";
  var compact = raw.replace(/\s+/g, " ").trim();
  var lines = raw.split(/\n+/).map(function(v) { return v.trim(); }).filter(Boolean);

  if (!compact) {
    alert("외부 매물 내용을 먼저 붙여넣어 주세요.");
    return;
  }

  setQuickAddNow();

  var source = document.getElementById("qaSource").value || "외부";

  var addressMatch = compact.match(/((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)?\s*[가-힣0-9]+동\s*\d+(?:-\d+)?)/);
  setFieldIfEmpty("qaAddress", addressMatch ? addressMatch[1].replace(/\s+/g, " ").trim() : "");

  if (lines.length > 0) setFieldIfEmpty("qaName", lines[0].slice(0, 40));

  if (!document.getElementById("qaType").value) {
    if (/상가/.test(compact)) document.getElementById("qaType").value = "상가";
    else if (/사무실|오피스/.test(compact)) document.getElementById("qaType").value = "사무실";
    else if (/매매/.test(compact)) document.getElementById("qaType").value = "매매";
    else if (/전세/.test(compact)) document.getElementById("qaType").value = "전세";
    else document.getElementById("qaType").value = "월세";
  }

  var deposit = findFirstMatch(compact, [
    /보증금\s*([0-9,.]+)\s*(?:만원|만)?/,
    /보\s*([0-9,.]+)\s*\/\s*월/,
    /([0-9,.]+)\s*\/\s*[0-9,.]+/
  ]);

  var rent = findFirstMatch(compact, [
    /월세\s*([0-9,.]+)\s*(?:만원|만)?/,
    /월\s*([0-9,.]+)\s*(?:만원|만)?/,
    /[0-9,.]+\s*\/\s*([0-9,.]+)/
  ]);

  var fee = findFirstMatch(compact, [
    /관리비\s*([0-9,.]+)\s*(?:만원|만)?/,
    /관\s*([0-9,.]+)\s*(?:만원|만)?/
  ]);

  var premium = findFirstMatch(compact, [
    /권리금\s*([0-9,.]+)\s*(?:만원|만)?/,
    /권\s*([0-9,.]+)\s*(?:만원|만)?/
  ]);

  var areaMatch = compact.match(/([0-9]+(?:\.[0-9]+)?)\s*평/);
  var roomMatch = compact.match(/((?:지하\s*)?\d+층|\d+호|[Bb]\d+)/);
  var phones = compact.match(/01[016789][-\s]?[0-9]{3,4}[-\s]?[0-9]{4}/g) || [];

  setFieldIfEmpty("qaDeposit", deposit);
  setFieldIfEmpty("qaRent", rent);
  setFieldIfEmpty("qaFee", fee);
  setFieldIfEmpty("qaPremium", premium);
  setFieldIfEmpty("qaArea", areaMatch ? areaMatch[1] : "");
  setFieldIfEmpty("qaRoom", roomMatch ? roomMatch[1].replace(/\s+/g, "") : "");
  setFieldIfEmpty("qaLandlordPhone", phones[0] ? normalizePhone(phones[0]) : "");
  setFieldIfEmpty("qaTenantPhone", phones[1] ? normalizePhone(phones[1]) : "");

  var memoEl = document.getElementById("qaMemo");
  if (memoEl && !memoEl.value) memoEl.value = "출처:" + source + " / " + compact.slice(0, 260);

  updateQuickAddWarning();
}

function getQuickAddRowValues() {
  var source = document.getElementById("qaSource").value || "외부";
  var memo = document.getElementById("qaMemo").value || "";
  if (memo.indexOf("출처:") === -1) memo = "출처:" + source + (memo ? " / " + memo : "");

  return [
    document.getElementById("qaName").value,
    document.getElementById("qaAddress").value,
    document.getElementById("qaRoom").value,
    document.getElementById("qaType").value,
    onlyNumberText(document.getElementById("qaDeposit").value),
    onlyNumberText(document.getElementById("qaRent").value),
    onlyNumberText(document.getElementById("qaFee").value),
    onlyNumberText(document.getElementById("qaPremium").value),
    onlyNumberText(document.getElementById("qaArea").value),
    document.getElementById("qaLandlordPhone").value,
    document.getElementById("qaTenantPhone").value,
    memo,
    document.getElementById("qaState").value,
    document.getElementById("qaRegDate").value
  ];
}

function validateQuickAdd() {
  var address = (document.getElementById("qaAddress").value || "").trim();
  var name = (document.getElementById("qaName").value || "").trim();
  if (!address && !name) {
    alert("건물이름 또는 주소 중 하나는 입력해야 합니다.");
    return false;
  }
  return true;
}

function updateQuickAddWarning() {
  var box = document.getElementById("quickAddWarning");
  if (!box) return;
  var address = (document.getElementById("qaAddress").value || "").trim();
  var room = (document.getElementById("qaRoom").value || "").trim();
  if (!address) {
    box.style.display = "none";
    return;
  }

  var same = allItems.filter(function(item) {
    var sameAddress = item.address && address && item.address.replace(/\s+/g, "") === address.replace(/\s+/g, "");
    var sameRoom = !room || !item.room || item.room.replace(/\s+/g, "") === room.replace(/\s+/g, "");
    return sameAddress && sameRoom;
  });

  if (same.length > 0) {
    box.style.display = "block";
    box.innerHTML = "이미 비슷한 주소가 " + same.length + "개 있습니다. 중복 여부를 확인하세요.";
  } else {
    box.style.display = "none";
  }
}

function copyQuickAddRow() {
  if (!validateQuickAdd()) return;
  var values = getQuickAddRowValues();
  var rowText = values.map(function(v) {
    return String(v || "").replace(/\t/g, " ").replace(/\n/g, " ").trim();
  }).join("\t");

  function done() {
    alert("시트에 붙여넣을 한 줄을 복사했습니다.\n구글시트 맨 아래 첫 칸에 붙여넣으면 됩니다.");
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(rowText).then(done).catch(function() { fallbackCopyText(rowText); });
  } else {
    fallbackCopyText(rowText);
  }
}

function fallbackCopyText(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  alert("시트에 붙여넣을 한 줄을 복사했습니다.");
}

function saveQuickAddToSheet() {
  if (!validateQuickAdd()) return;
  if (!saveApiURL) {
    alert("자동등록 URL이 아직 연결되지 않았습니다.\nApps Script 배포 URL을 HTML의 saveApiURL에 넣어주세요.\n지금은 '시트 행 복사'를 사용할 수 있습니다.");
    return;
  }

  var values = getQuickAddRowValues();
  var btn = document.querySelector(".auto-save-btn");
  var oldText = btn ? btn.innerText : "";
  if (btn) {
    btn.innerText = "등록중...";
    btn.disabled = true;
  }

  fetch(saveApiURL, {
    method:"POST",
    mode:"no-cors",
    headers:{ "Content-Type":"text/plain;charset=utf-8" },
    body:JSON.stringify({ values: values })
  }).then(function() {
    alert("자동등록 요청을 보냈습니다.\n잠시 후 지도에 반영됩니다.");
    closeQuickAddModal();
    clearQuickAddForm();
    setTimeout(function() { loadSheet(true); }, 1500);
  }).catch(function(err) {
    console.error(err);
    alert("자동등록 요청 중 오류가 발생했습니다.\n연결 URL을 확인해주세요.");
  }).finally(function() {
    if (btn) {
      btn.innerText = oldText;
      btn.disabled = false;
    }
  });
}

function clearQuickAddForm() {
  ["qaRaw","qaName","qaAddress","qaRoom","qaType","qaDeposit","qaRent","qaFee","qaPremium","qaArea","qaLandlordPhone","qaTenantPhone","qaMemo","qaRegDate"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });
  var state = document.getElementById("qaState");
  if (state) state.value = "";
  setQuickAddNow();
}

function openGoogleSheet() {
  window.open("https://docs.google.com/spreadsheets/d/1zRWqjc7xVkiTnFHFujBNI72qr_aDCgxiQipQlnGgWmU/edit", "_blank");
}


/* === JS부동산 AI 등록 v2.0 오버라이드 === */
function normalizeKoreanNumber(value) {
  var text = String(value || "").replace(/,/g, "").replace(/\s+/g, "").trim();
  if (!text) return "";
  if (/무권|무권리|없음|협의/.test(text)) return /무권|무권리|없음/.test(text) ? "0" : "";

  var total = 0;
  var hasUnit = false;

  var eok = text.match(/([0-9]+(?:\.[0-9]+)?)억/);
  if (eok) {
    total += parseFloat(eok[1]) * 10000;
    hasUnit = true;
  }

  var chun = text.match(/([0-9]+(?:\.[0-9]+)?)(?:천|천만)/);
  if (chun) {
    total += parseFloat(chun[1]) * 1000;
    hasUnit = true;
  }

  var man = text.match(/([0-9]+(?:\.[0-9]+)?)(?:만원|만)/);
  if (man) {
    total += parseFloat(man[1]);
    hasUnit = true;
  }

  if (hasUnit) return String(Math.round(total * 10) / 10).replace(/\.0$/, "");

  var plain = text.replace(/[^0-9.]/g, "");
  return plain;
}

function onlyNumberText(value) {
  return normalizeKoreanNumber(value);
}

function findFirstMatch(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m && m[1]) return normalizeKoreanNumber(m[1]);
  }
  return "";
}

function setFieldValue(id, value, overwrite) {
  var el = document.getElementById(id);
  if (!el) return;
  if (overwrite || !el.value) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      el.value = String(value).trim();
    }
  }
}

function pickTitleLine(lines) {
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;
    if (/010|보증금|월세|관리비|권리금|[0-9,.]+\s*\/\s*[0-9,.]+|평|만원|주소|매물번호|연락처/.test(line)) continue;
    if (line.length >= 2 && line.length <= 45) return line;
  }
  return lines[0] ? lines[0].slice(0, 40) : "";
}

function buildCleanMemo(raw, source) {
  var text = String(raw || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map(function(v) { return v.trim(); })
    .filter(Boolean)
    .join(" / ");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 320) text = text.slice(0, 320) + "...";
  return "출처:" + source + (text ? " / " + text : "");
}

function detectSourceFromRaw(raw) {
  var sourceEl = document.getElementById("qaSource");
  if (!sourceEl) return;
  var text = String(raw || "");
  if (/공실박스|gongsil/i.test(text)) sourceEl.value = "공실박스";
  else if (/네이버|naver/i.test(text)) sourceEl.value = "네이버";
  else if (/당근|daangn|karrot/i.test(text)) sourceEl.value = "당근";
}

function parseQuickAddText() {
  var rawEl = document.getElementById("qaRaw");
  if (!rawEl) return;

  var raw = rawEl.value || "";
  var compact = raw.replace(/\s+/g, " ").trim();
  var lines = raw.split(/\n+/).map(function(v) { return v.trim(); }).filter(Boolean);

  if (!compact) {
    alert("외부 매물 내용을 먼저 붙여넣어 주세요.");
    return;
  }

  setQuickAddNow();
  detectSourceFromRaw(raw);
  var source = document.getElementById("qaSource").value || "외부";

  var addressPatterns = [
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)/
  ];
  var address = "";
  for (var ai = 0; ai < addressPatterns.length; ai++) {
    var am = compact.match(addressPatterns[ai]);
    if (am && am[1]) { address = am[1].replace(/\s+/g, " ").trim(); break; }
  }

  var title = pickTitleLine(lines);

  var type = "";
  if (/상가|점포|가게|권리/.test(compact)) type = "상가";
  else if (/사무실|오피스|업무/.test(compact)) type = "사무실";
  else if (/매매/.test(compact)) type = "매매";
  else if (/전세/.test(compact)) type = "전세";
  else if (/월세|임대/.test(compact)) type = "월세";

  var deposit = findFirstMatch(compact, [
    /보증금\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)/,
    /보\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)\s*(?:\/|월)/,
    /([0-9,.]+\s*(?:억|천만|천|만원|만)?)\s*\/\s*[0-9,.]+/
  ]);

  var rent = findFirstMatch(compact, [
    /월세\s*([0-9,.]+\s*(?:만원|만)?)/,
    /월\s*([0-9,.]+\s*(?:만원|만)?)/,
    /[0-9,.]+\s*(?:억|천만|천|만원|만)?\s*\/\s*([0-9,.]+\s*(?:만원|만)?)/
  ]);

  var fee = findFirstMatch(compact, [
    /관리비\s*([0-9,.]+\s*(?:만원|만)?)/,
    /관\s*([0-9,.]+\s*(?:만원|만)?)/
  ]);

  var premium = "";
  if (/무권|무권리/.test(compact)) premium = "0";
  else premium = findFirstMatch(compact, [
    /권리금\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)/,
    /권\s*([0-9,.]+\s*(?:억|천만|천|만원|만)?)/
  ]);

  var areaMatch = compact.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:평|py|PY)/i);
  var roomMatch = compact.match(/((?:지하\s*)?\d+\s*층|[Bb]\s?\d+|\d+\s*호|[0-9]+F|[0-9]+층\s*[0-9]+호)/);
  var phones = compact.match(/01[016789][\-\s\.]?[0-9]{3,4}[\-\s\.]?[0-9]{4}/g) || [];

  setFieldValue("qaAddress", address, false);
  setFieldValue("qaName", title, false);
  setFieldValue("qaType", type || "상가", false);
  setFieldValue("qaDeposit", deposit, false);
  setFieldValue("qaRent", rent, false);
  setFieldValue("qaFee", fee, false);
  setFieldValue("qaPremium", premium, false);
  setFieldValue("qaArea", areaMatch ? areaMatch[1] : "", false);
  setFieldValue("qaRoom", roomMatch ? roomMatch[1].replace(/\s+/g, "") : "", false);
  setFieldValue("qaLandlordPhone", phones[0] ? normalizePhone(phones[0].replace(/\./g, "-")) : "", false);
  setFieldValue("qaTenantPhone", phones[1] ? normalizePhone(phones[1].replace(/\./g, "-")) : "", false);

  var memoEl = document.getElementById("qaMemo");
  if (memoEl && !memoEl.value) memoEl.value = buildCleanMemo(raw, source);

  updateQuickAddWarning();
  updateQuickAddPreview();
}

function getQuickAddObject() {
  return {
    source: document.getElementById("qaSource").value || "외부",
    name: document.getElementById("qaName").value || "",
    address: document.getElementById("qaAddress").value || "",
    room: document.getElementById("qaRoom").value || "",
    type: document.getElementById("qaType").value || "",
    deposit: onlyNumberText(document.getElementById("qaDeposit").value),
    rent: onlyNumberText(document.getElementById("qaRent").value),
    fee: onlyNumberText(document.getElementById("qaFee").value),
    premium: onlyNumberText(document.getElementById("qaPremium").value),
    area: onlyNumberText(document.getElementById("qaArea").value),
    landlordPhone: document.getElementById("qaLandlordPhone").value || "",
    tenantPhone: document.getElementById("qaTenantPhone").value || "",
    memo: document.getElementById("qaMemo").value || "",
    state: document.getElementById("qaState").value || "",
    regDate: document.getElementById("qaRegDate").value || ""
  };
}

function updateQuickAddPreview() {
  var box = document.getElementById("quickAddPreview");
  if (!box) return;
  var o = getQuickAddObject();
  var required = [
    ["건물이름", o.name], ["주소", o.address], ["구분", o.type],
    ["보증금", o.deposit], ["월세", o.rent], ["평수", o.area]
  ];
  var okCount = required.filter(function(x) { return String(x[1] || "").trim() !== ""; }).length;
  var status = okCount >= 5 ? '<span class="good">분석 양호</span>' : '<span class="warn">확인 필요</span>';
  var price = "보" + (o.deposit || "-") + " / 월" + (o.rent || "-") + " / 관" + (o.fee || "-") + " / 권" + (o.premium || "-") + " / " + (o.area || "-") + "평";
  box.innerHTML =
    '<b>AI 분석 미리보기</b> · ' + status + ' <span class="muted">(' + okCount + '/6 핵심항목)</span>' +
    '<div class="preview-row">' + escapeHtml(o.source) + ' · ' + escapeHtml(o.type || '구분없음') + ' · ' + escapeHtml(o.name || '건물이름 없음') + '</div>' +
    '<div class="preview-row">' + escapeHtml(o.address || '주소 없음') + ' / ' + escapeHtml(o.room || '호실 없음') + '</div>' +
    '<div class="preview-row">' + escapeHtml(price) + '</div>' +
    '<div class="preview-row">임대인 ' + escapeHtml(o.landlordPhone || '-') + ' / 세입자 ' + escapeHtml(o.tenantPhone || '-') + '</div>';
}

function updateQuickAddWarning() {
  var box = document.getElementById("quickAddWarning");
  if (!box) return;
  var address = (document.getElementById("qaAddress").value || "").trim();
  var room = (document.getElementById("qaRoom").value || "").trim();
  if (!address) {
    box.style.display = "none";
    updateQuickAddPreview();
    return;
  }

  var same = allItems.filter(function(item) {
    var sameAddress = item.address && address && item.address.replace(/\s+/g, "") === address.replace(/\s+/g, "");
    var sameRoom = !room || !item.room || item.room.replace(/\s+/g, "") === room.replace(/\s+/g, "");
    return sameAddress && sameRoom;
  });

  if (same.length > 0) {
    var first = same[0];
    box.style.display = "block";
    box.innerHTML = "⚠ 이미 비슷한 주소가 " + same.length + "개 있습니다. " +
      "첫 매물: " + escapeHtml(first.name || "") + " / 보" + first.deposit + " / 월" + first.rent + " / " + escapeHtml(first.room || "") +
      "<br>중복등록인지 확인 후 진행하세요.";
  } else {
    box.style.display = "none";
  }
  updateQuickAddPreview();
}

function getQuickAddRowValues() {
  var o = getQuickAddObject();
  var memo = o.memo || "";
  if (memo.indexOf("출처:") === -1) memo = "출처:" + o.source + (memo ? " / " + memo : "");

  return [
    o.name, o.address, o.room, o.type,
    o.deposit, o.rent, o.fee, o.premium, o.area,
    o.landlordPhone, o.tenantPhone, memo, o.state, o.regDate
  ];
}

function validateQuickAdd() {
  updateQuickAddWarning();
  var o = getQuickAddObject();
  if (!o.address && !o.name) {
    alert("건물이름 또는 주소 중 하나는 입력해야 합니다.");
    return false;
  }
  if (!o.deposit && !o.rent && !o.area) {
    return confirm("가격/평수 정보가 거의 비어 있습니다. 그래도 진행할까요?");
  }
  return true;
}

function clearQuickAddForm() {
  ["qaRaw","qaName","qaAddress","qaRoom","qaType","qaDeposit","qaRent","qaFee","qaPremium","qaArea","qaLandlordPhone","qaTenantPhone","qaMemo","qaRegDate"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });
  var state = document.getElementById("qaState");
  if (state) state.value = "";
  var preview = document.getElementById("quickAddPreview");
  if (preview) preview.innerHTML = "AI 분석 전입니다. 외부 매물 내용을 붙여넣고 AI 분석을 눌러주세요.";
  var warn = document.getElementById("quickAddWarning");
  if (warn) warn.style.display = "none";
  setQuickAddNow();
}

function openQuickAddModal() {
  var modal = document.getElementById("quickAddModal");
  if (!modal) return;
  modal.style.display = "block";
  setQuickAddNow();
  updateQuickAddPreview();
  setTimeout(function() {
    var raw = document.getElementById("qaRaw");
    if (raw) raw.focus();
  }, 80);
}

['qaName','qaAddress','qaRoom','qaType','qaDeposit','qaRent','qaFee','qaPremium','qaArea','qaLandlordPhone','qaTenantPhone','qaMemo','qaState','qaRegDate'].forEach(function(id) {
  setTimeout(function() {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', function() { updateQuickAddWarning(); updateQuickAddPreview(); });
    if (el) el.addEventListener('change', function() { updateQuickAddWarning(); updateQuickAddPreview(); });
  }, 500);
});



/* === JS부동산 AI Parser v1.0.1 최종 오버라이드: 권1000/보2000/월100 등 복붙 약어 인식 강화 === */
function moneyValueFromLabel(text, labelPattern) {
  text = String(text || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  var re = new RegExp("(?:^|[^가-힣A-Za-z0-9])(?:" + labelPattern + ")\\s*[:：=\\-]?\\s*([0-9][0-9,.]*(?:\\s*(?:억|천만|천|만원|만))?)", "i");
  var m = text.match(re);
  if (m && m[1]) return normalizeKoreanNumber(m[1]);

  // 문장 맨 앞에서 바로 시작하는 경우 보정: 권1000, 보2000, 월110
  var re2 = new RegExp("^(?:" + labelPattern + ")\\s*[:：=\\-]?\\s*([0-9][0-9,.]*(?:\\s*(?:억|천만|천|만원|만))?)", "i");
  m = text.match(re2);
  if (m && m[1]) return normalizeKoreanNumber(m[1]);

  return "";
}

function slashPriceValue(text, index) {
  text = String(text || "").replace(/,/g, "").replace(/\s+/g, " ").trim();
  var m = text.match(/([0-9]+(?:\.[0-9]+)?(?:\s*(?:억|천만|천|만원|만))?)\s*\/\s*([0-9]+(?:\.[0-9]+)?(?:\s*(?:만원|만)?)?)/);
  if (!m) return "";
  return normalizeKoreanNumber(index === 1 ? m[1] : m[2]);
}

function parseQuickAddText() {
  var rawEl = document.getElementById("qaRaw");
  if (!rawEl) return;

  var raw = rawEl.value || "";
  var compact = raw.replace(/\s+/g, " ").trim();
  var lines = raw.split(/\n+/).map(function(v) { return v.trim(); }).filter(Boolean);

  if (!compact) {
    alert("외부 매물 내용을 먼저 붙여넣어 주세요.");
    return;
  }

  setQuickAddNow();
  detectSourceFromRaw(raw);
  var source = document.getElementById("qaSource").value || "외부";

  var addressPatterns = [
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?[가-힣0-9]+동\s*\d+(?:-\d+)?)/,
    /((?:대전(?:광역시)?\s*)?(?:동구|중구|서구|유성구|대덕구)\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)/
  ];
  var address = "";
  for (var ai = 0; ai < addressPatterns.length; ai++) {
    var am = compact.match(addressPatterns[ai]);
    if (am && am[1]) { address = am[1].replace(/\s+/g, " ").trim(); break; }
  }

  var title = pickTitleLine(lines);

  var type = "";
  if (/상가|점포|가게|권리|무권/.test(compact)) type = "상가";
  else if (/사무실|오피스|업무/.test(compact)) type = "사무실";
  else if (/매매/.test(compact)) type = "매매";
  else if (/전세/.test(compact)) type = "전세";
  else if (/월세|임대/.test(compact)) type = "월세";

  var deposit = moneyValueFromLabel(compact, "보증금|보");
  if (!deposit) deposit = slashPriceValue(compact, 1);

  var rent = moneyValueFromLabel(compact, "월세|월");
  if (!rent) rent = slashPriceValue(compact, 2);

  var fee = "";
  if (/관리비\s*(없음|무|무료|0원|0만원|0만)|관\s*(없음|무|무료)/.test(compact)) fee = "0";
  else fee = moneyValueFromLabel(compact, "관리비|관리|관");

  var premium = "";
  if (/무권|무권리|권무|권리금\s*(없음|무|0원|0만원|0만)|권\s*(없음|무|0원|0만원|0만)/.test(compact)) {
    premium = "0";
  } else if (/권리금\s*협의|권리\s*협의|권\s*협의/.test(compact)) {
    premium = "";
  } else {
    // 핵심 수정: 권1000, 권 1000, 권리1000, 권리금1000 모두 숫자 전체 인식
    premium = moneyValueFromLabel(compact, "권리금|권리|권");
  }

  var areaMatch = compact.match(/(?:약\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:평|py|PY)/i);
  var roomMatch = compact.match(/((?:지하\s*)?\d+\s*층|[Bb]\s?\d+|\d+\s*호|[0-9]+F|[0-9]+층\s*[0-9]+호)/);
  var phones = compact.match(/01[016789][\-\s\.]?[0-9]{3,4}[\-\s\.]?[0-9]{4}|0[2-6][0-9]?[\-\s\.]?[0-9]{3,4}[\-\s\.]?[0-9]{4}/g) || [];

  setFieldValue("qaAddress", address, false);
  setFieldValue("qaName", title, false);
  setFieldValue("qaType", type || "상가", false);
  setFieldValue("qaDeposit", deposit, false);
  setFieldValue("qaRent", rent, false);
  setFieldValue("qaFee", fee, false);
  setFieldValue("qaPremium", premium, false);
  setFieldValue("qaArea", areaMatch ? areaMatch[1] : "", false);
  setFieldValue("qaRoom", roomMatch ? roomMatch[1].replace(/\s+/g, "") : "", false);
  setFieldValue("qaLandlordPhone", phones[0] ? normalizePhone(phones[0].replace(/\./g, "-")) : "", false);
  setFieldValue("qaTenantPhone", phones[1] ? normalizePhone(phones[1].replace(/\./g, "-")) : "", false);

  var memoEl = document.getElementById("qaMemo");
  if (memoEl && !memoEl.value) memoEl.value = buildCleanMemo(raw, source);

  updateQuickAddWarning();
  updateQuickAddPreview();
}
