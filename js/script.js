/* JS부동산 공통 UI/리스트/필터 핵심 스크립트 */
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
var gongsilOnly = false;
var multiClusterMode = false;
var selectedGroupKeys = [];
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

  var minFloor = readOptionalNumberInput("minFloor");
  var maxFloor = readOptionalNumberInput("maxFloor");
  var hasFloorFilter = minFloor !== null || maxFloor !== null;

  if (minFloor !== null && maxFloor !== null && minFloor > maxFloor) {
    var floorSwap = minFloor;
    minFloor = maxFloor;
    maxFloor = floorSwap;
  }

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

    return matchKeyword && matchType && matchPrice && matchFloor &&
      matchFavorite && matchDone && matchGongsil && inMap;
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

    if (sortType === "aiScoreHigh") {
      var aiA = getSmartItemAnalysis(a).score || 0;
      var aiB = getSmartItemAnalysis(b).score || 0;
      return aiB - aiA;
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


function isGongsilBoxItem(item) {
  var memo = String((item && item.memo) ? item.memo : "");
  return /\(\s*공실박스\s*\)|출처\s*[:：]\s*공실박스/i.test(memo);
}


function getItemSourceType(item) {
  if (isGongsilBoxItem(item)) return "gongsil";

  var memo = String((item && item.memo) ? item.memo : "");
  var m = memo.match(/출처\s*[:：]\s*([^\/|,，\n]+)/);

  if (!m || !m[1]) return "unknown";

  var source = String(m[1] || "").trim().toLowerCase();

  if (/네이버|naver/.test(source)) return "naver";
  if (/당근|daangn|karrot/.test(source)) return "danggeun";
  if (/직접확인|직접매물|직접|현장확인/.test(source)) return "direct";
  if (/공실박스|gongsil/.test(source)) return "gongsil";

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
  var sourceLabel = isGongsilBoxItem(item)
    ? '<span class="gongsil-source-badge">공실박스</span>'
    : "";
  var encodedKey = encodeURIComponent(item.key);
  var safeKey = escapeHtml(item.key);
  var pyeongMiniBadge = buildPyeongMiniBadge(item);

  div.innerHTML =
    '<div class="item-top">' +
      '<div class="item-left">' +
        '<label class="item-action-select" title="이 매물을 작업 대상으로 선택">' +
          '<input type="checkbox" class="action-select-check" ' + (printSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); togglePrintSelection(\'' + encodedKey + '\')">' +
        '</label>' +
        '<div class="item-title-wrap">' +
          '<div class="title">' + doneLabel + sourceLabel + typeLabel + pyeongMiniBadge + escapeHtml(item.name) + ' / ' + escapeHtml(item.address) + ' / ' + escapeHtml(item.room) + '</div>' +
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
  document.getElementById("minDeposit").value = "";
  document.getElementById("maxDeposit").value = "";
  document.getElementById("minRent").value = "";
  document.getElementById("maxRent").value = "";
  document.getElementById("minArea").value = "";
  document.getElementById("maxArea").value = "";
  document.getElementById("minFloor").value = "";
  document.getElementById("maxFloor").value = "";

  favoriteOnly = false;
  hideDone = false;
  gongsilOnly = false;
  multiClusterMode = false;
  selectedGroupKeys = [];
  document.getElementById("favoriteBtn").innerText = "찜만";
  document.getElementById("favoriteBtn").classList.remove("on");
  document.getElementById("hideDoneBtn").innerText = "완료숨김";
  document.getElementById("hideDoneBtn").classList.remove("on");
  document.getElementById("gongsilOnlyBtn").innerText = "공실박스만";
  document.getElementById("gongsilOnlyBtn").classList.remove("on");
  updateMultiClusterButton();
  updateMultiClusterStatus();
  selectedGroupKey = null;
  selectedItemKey = null;

  drawItems(allItems);
  document.getElementById("status").innerHTML = "전체 매물 " + allItems.length + "개";
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
      "Apps Script 배포 URL을 script.js 상단의 saveApiURL에 넣어주세요."
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


function updatePrintSelectedButton() {
  var printBtn = document.getElementById("printSelectedBtn");
  var completeBtn = document.getElementById("completeSelectedBtn");
  var count = selectedPrintKeys.length;

  if (printBtn) {
    printBtn.innerText = count > 0 ? "인쇄 " + count : "인쇄";
    printBtn.disabled = count === 0;
  }

  if (completeBtn) {
    completeBtn.innerText = count > 0 ? "완료 " + count : "완료";
    completeBtn.disabled = count === 0;
  }
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

  if (!confirm("선택한 " + selectedItems.length + "개 매물을 거래완료로 처리할까요?")) {
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
    btn.innerText = "전체출처";
    btn.classList.add("on");
  } else {
    btn.innerText = "공실박스만";
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

  btn.innerText = multiClusterMode ? "다중선택 ON" : "다중선택 OFF";
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
