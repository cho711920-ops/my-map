/* JS부동산 지도/마커/클러스터/시트 로딩 전용 스크립트 */
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
  setupQuickAddShortcuts();
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


function clearMap() {
  overlays.forEach(function(o) { o.setMap(null); });
  overlays = [];
  document.getElementById("list").innerHTML = "";
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
    var sourceClass = " source-" + getClusterSourceType(cluster.items);

    var overlayContent =
      '<div class="circle-marker' + sourceClass + doneClass + selectedClass + '" onclick="openCluster(\'' + encodeURIComponent(cluster.key) + '\')">' + count + '</div>';

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
    var sourceClass = " source-" + getClusterSourceType(cluster.items);

    var content =
      '<div class="circle-marker' + sourceClass + doneClass + selectedClass + '" onclick="openCluster(\'' + encodeURIComponent(cluster.key) + '\')">' + count + '</div>';

    o.setContent(content);
  });
}


function openItem(item) {
  selectedItemKey = item.key;
  selectedGroupKey = null;

  /*
   * 리스트 안에 AI카드를 펼치지 않고,
   * 선택 상태만 다시 표시한 뒤 독립 AI 패널을 엽니다.
   */
  showList(visibleListItems && visibleListItems.length ? visibleListItems : [item]);
  document.getElementById("status").innerHTML = "선택 매물 1개 · AI 분석 패널 표시";

  if (typeof openAiSidePanel === "function") {
    openAiSidePanel(item);
  }

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("open");
  }
}
