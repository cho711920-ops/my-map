/* =========================================================
   JS부동산 지도/시트 로딩 스크립트 v4.4.1
   자동업데이트 화면 상태 유지 수정본
   - 매물리스트 초기화 방지
   - 리스트 스크롤 위치 유지
   - 선택 매물 및 선택 클러스터 유지
   - AI 사이드패널 열림 상태 및 내부 스크롤 유지
   - 기존 클러스터 색상과 크기는 그대로 유지
   ========================================================= */

/* =========================================================
   JS부동산 지도/마커/클러스터 스크립트 수정본
   - 클러스터는 출처와 무관하게 기본 파란색
   - 클러스터 내부 매물이 모두 거래완료일 때만 회색
   - 거래가능 매물이 1개라도 있으면 파란색
   - 클러스터 원 크기와 기존 동작은 그대로 유지
   ========================================================= */

/* JS부동산 지도/마커/클러스터/시트 로딩 전용 스크립트 */
var jsCurrentLocationOverlayV630 = null;
var jsCurrentLocationWatchIdV630 = null;


function updateCurrentLocationOverlayV630(position) {
  if (!position || !position.coords || !map || !window.kakao) return;

  var lat = Number(position.coords.latitude);
  var lng = Number(position.coords.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  var coords = new kakao.maps.LatLng(lat, lng);

  if (!jsCurrentLocationOverlayV630) {
    var content = document.createElement("div");
    content.className = "js-current-location-dot-v630";
    content.setAttribute("title", "현재 위치");

    jsCurrentLocationOverlayV630 = new kakao.maps.CustomOverlay({
      position: coords,
      content: content,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 20000
    });

    jsCurrentLocationOverlayV630.setMap(map);
  } else {
    jsCurrentLocationOverlayV630.setPosition(coords);
  }
}


function startCurrentLocationTrackingV630() {
  if (!navigator.geolocation || jsCurrentLocationWatchIdV630 !== null) return;

  try {
    jsCurrentLocationWatchIdV630 = navigator.geolocation.watchPosition(
      updateCurrentLocationOverlayV630,
      function(error) {
        console.warn("현재 위치 표시 실패", error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 8000,
        timeout: 15000
      }
    );
  } catch (error) {
    console.warn("현재 위치 추적 시작 실패", error);
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

  /*
   * v6.3 현장모드: 지도 이동을 방해하지 않고 현재 위치만 보라색 점으로 표시합니다.
   */
  startCurrentLocationTrackingV630();

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


/* =========================================================
   v4.4.1 자동업데이트 화면 상태 유지
   - 현재 매물리스트 유지
   - 리스트 스크롤 위치 유지
   - 선택 매물/클러스터 유지
   - AI 사이드패널 열림 상태와 스크롤 유지
   ========================================================= */
function captureAutoUpdateViewState() {
  var sidebar = document.getElementById("sidebar");
  var aiBody = document.getElementById("aiSidePanelBody");
  var aiOpen = document.body.classList.contains("ai-side-panel-open");

  return {
    selectedItemKey: selectedItemKey || "",
    selectedGroupKey: selectedGroupKey || "",
    selectedGroupKeys: (selectedGroupKeys || []).slice(),
    multiClusterMode: !!multiClusterMode,
    visibleKeys: (visibleListItems || []).map(function(item) {
      return item.key;
    }),
    sidebarScrollTop: sidebar ? sidebar.scrollTop : 0,
    aiOpen: aiOpen,
    aiItemKey: typeof aiSidePanelCurrentKey !== "undefined"
      ? (aiSidePanelCurrentKey || selectedItemKey || "")
      : (selectedItemKey || ""),
    aiScrollTop: aiBody ? aiBody.scrollTop : 0
  };
}


function findItemsBySavedKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) return [];

  var keySet = {};
  keys.forEach(function(key) {
    keySet[key] = true;
  });

  var foundMap = {};
  (allItems || []).forEach(function(item) {
    if (keySet[item.key]) {
      foundMap[item.key] = item;
    }
  });

  // 기존 리스트 순서를 그대로 유지
  return keys.map(function(key) {
    return foundMap[key] || null;
  }).filter(Boolean);
}


function restoreAutoUpdateViewState(state) {
  if (!state) return;

  var sidebar = document.getElementById("sidebar");
  var aiBody = document.getElementById("aiSidePanelBody");

  var restoredList = findItemsBySavedKeys(state.visibleKeys);
  var selectedItem = state.selectedItemKey
    ? (allItems || []).find(function(item) {
        return item.key === state.selectedItemKey;
      }) || null
    : null;

  /*
   * 자동업데이트 전에 보고 있던 리스트가 남아 있으면
   * 전체 검색결과 대신 그 리스트를 다시 보여줍니다.
   */
  if (restoredList.length) {
    visibleListItems = restoredList.slice();
    showList(restoredList);
  }

  selectedItemKey = selectedItem ? selectedItem.key : null;

  /*
   * 클러스터 키가 새 렌더링 후에도 존재하면 선택 상태를 유지합니다.
   * 없으면 리스트는 유지하되 클러스터 선택 테두리만 해제합니다.
   */
  var sameClusterExists = state.selectedGroupKey && overlays.some(function(overlay) {
    return overlay.__cluster && overlay.__cluster.key === state.selectedGroupKey;
  });

  selectedGroupKey = sameClusterExists ? state.selectedGroupKey : null;

  if (state.multiClusterMode) {
    multiClusterMode = true;
    selectedGroupKeys = (state.selectedGroupKeys || []).filter(function(groupKey) {
      return overlays.some(function(overlay) {
        return overlay.__cluster && overlay.__cluster.key === groupKey;
      });
    });
  } else {
    selectedGroupKeys = [];
  }

  if (typeof updateMultiClusterButton === "function") {
    updateMultiClusterButton();
  }

  if (typeof updateMultiClusterStatus === "function") {
    updateMultiClusterStatus();
  }

  redrawSelectedMarkers();

  requestAnimationFrame(function() {
    if (sidebar) {
      sidebar.scrollTop = state.sidebarScrollTop || 0;
    }
  });

  /*
   * AI 패널이 열려 있었다면 같은 매물로 다시 열고
   * 패널 내부 스크롤 위치도 복원합니다.
   */
  if (state.aiOpen && state.aiItemKey && typeof openAiSidePanel === "function") {
    var aiItem = (allItems || []).find(function(item) {
      return item.key === state.aiItemKey;
    }) || null;

    if (aiItem) {
      openAiSidePanel(aiItem);

      setTimeout(function() {
        var latestAiBody = document.getElementById("aiSidePanelBody");
        if (latestAiBody) {
          latestAiBody.scrollTop = state.aiScrollTop || 0;
        }
      }, 180);
    }
  }
}


function loadSheet(isAuto) {
  if (isLoadingSheet) {
    pendingAutoUpdate = true;
    document.getElementById("status").innerHTML = "주소 변환중... 자동 업데이트 대기";
    return;
  }

  /*
   * 자동업데이트일 때만 현재 화면 상태를 저장합니다.
   * 최초 로딩과 수동 필터 동작에는 영향을 주지 않습니다.
   */
  var autoUpdateViewState = isAuto ? captureAutoUpdateViewState() : null;

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
          source: clean(c[14]),
          latlng: null
        };

        item.key = itemKey(item);

        if (item.address) rawItems.push(item);
      }

      geocodeItems(rawItems, function(doneItems) {
        allItems = doneItems;
        updateTypeOptions(allItems);

        /*
         * 자동업데이트가 같은 화면을 복원하는 동안에는
         * 작업 체크박스 선택을 유지합니다.
         */
        preserveActionSelectionDuringRender = !!isAuto;

        /*
         * 지도/마커와 현재 필터 결과는 최신 데이터로 다시 계산합니다.
         */
        applyFilter();

        /*
         * 수정 직후에는 저장 직전 화면 상태를 우선 복원합니다.
         */
        if (
          typeof pendingPropertyEditStateV634 !== "undefined" &&
          pendingPropertyEditStateV634
        ) {
          var editPendingV634 = pendingPropertyEditStateV634;
          var aliasesV634 = editPendingV634.aliases || [];
          var preferredKeyV634 = editPendingV634.newKey || "";
          var availableKeyV634 = "";

          if (
            preferredKeyV634 &&
            (allItems || []).some(function(item) {
              return item && item.key === preferredKeyV634;
            })
          ) {
            availableKeyV634 = preferredKeyV634;
          } else {
            aliasesV634.some(function(aliasKey) {
              var exists = (allItems || []).some(function(item) {
                return item && item.key === aliasKey;
              });

              if (exists) {
                availableKeyV634 = aliasKey;
                return true;
              }

              return false;
            });
          }

          var editRestoreStateV634 = remapEditViewStateV634(
            editPendingV634.viewState,
            aliasesV634,
            availableKeyV634 || preferredKeyV634
          );

          editRestoreStateV634 =
            keepOnlyFilteredEditKeysV634(editRestoreStateV634);

          if (editRestoreStateV634) {
            restoreAutoUpdateViewState(editRestoreStateV634);
          }

          /*
           * 최신 key가 확인될 때만 임시 상태를 종료합니다.
           */
          if (availableKeyV634 === preferredKeyV634) {
            pendingPropertyEditStateV634 = null;
            pendingPropertyEditNewKeyV633 = null;
          }
        } else if (isAuto && autoUpdateViewState) {
          restoreAutoUpdateViewState(autoUpdateViewState);
        }

        preserveActionSelectionDuringRender = false;

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

    var selectedClass = (typeof isClusterSelected === "function" && isClusterSelected(cluster.key)) ? " selected" : "";
    var doneClass = allDone ? " done" : "";
    var gongsilClass = !allDone && cluster.items.some(function(item) {
      return typeof isGongsilBoxItem === "function" && isGongsilBoxItem(item);
    }) ? " source-gongsil" : "";

    /*
     * 클러스터는 출처와 무관하게 기본 파란색을 사용합니다.
     * 클러스터 안의 모든 매물이 거래완료일 때만 done 클래스가 붙어 회색이 됩니다.
     */
    var overlayContent =
      '<div class="circle-marker' + gongsilClass + doneClass + selectedClass + '" onclick="openCluster(\'' + encodeURIComponent(cluster.key) + '\')">' + count + '</div>';

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

  selectedItemKey = null;

  /*
   * 다중선택 OFF: 기존처럼 한 클러스터만 표시
   */
  if (!multiClusterMode) {
    selectedGroupKey = key;
    selectedGroupKeys = [];

    var singleItems = overlay.__cluster.items;
    showList(singleItems);
    document.getElementById("status").innerHTML =
      "선택 매물 " + singleItems.length + "개";
  } else {
    /*
     * 다중선택 ON: 같은 클러스터를 다시 누르면 해제,
     * 다른 클러스터를 누르면 누적합니다.
     */
    selectedGroupKey = null;

    if (selectedGroupKeys.includes(key)) {
      selectedGroupKeys = selectedGroupKeys.filter(function(groupKey) {
        return groupKey !== key;
      });
    } else {
      selectedGroupKeys.push(key);
    }

    var combinedItems = [];
    var seen = {};

    overlays.forEach(function(currentOverlay) {
      if (
        !currentOverlay.__cluster ||
        !selectedGroupKeys.includes(currentOverlay.__cluster.key)
      ) {
        return;
      }

      currentOverlay.__cluster.items.forEach(function(item) {
        if (!seen[item.key]) {
          seen[item.key] = true;
          combinedItems.push(item);
        }
      });
    });

    if (combinedItems.length) {
      showList(combinedItems);
    } else {
      applyFilter();
    }

    document.getElementById("status").innerHTML =
      "선택 클러스터 " + selectedGroupKeys.length +
      "개 · 매물 " + combinedItems.length + "개";

    if (typeof updateMultiClusterStatus === "function") {
      updateMultiClusterStatus();
    }
  }

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

    var selectedClass = (typeof isClusterSelected === "function" && isClusterSelected(cluster.key)) ? " selected" : "";
    var doneClass = allDone ? " done" : "";
    var gongsilClass = !allDone && cluster.items.some(function(item) {
      return typeof isGongsilBoxItem === "function" && isGongsilBoxItem(item);
    }) ? " source-gongsil" : "";

    /*
     * 선택 상태가 바뀌어 다시 그릴 때도
     * 일반 클러스터는 파란색, 전부 거래완료인 클러스터만 회색을 유지합니다.
     */
    var content =
      '<div class="circle-marker' + gongsilClass + doneClass + selectedClass + '" onclick="openCluster(\'' + encodeURIComponent(cluster.key) + '\')">' + count + '</div>';

    o.setContent(content);
  });
}


function openItem(item) {
  selectedItemKey = item.key;

  /*
   * 일반 선택 모드에서 리스트 매물을 누르면 해당 클러스터만 표시합니다.
   * 다중선택 모드에서는 기존 누적 선택을 건드리지 않아 상태가 꼬이지 않게 합니다.
   */
  if (!multiClusterMode) {
    var matchedOverlay = overlays.find(function(overlay) {
      return (
        overlay &&
        overlay.__cluster &&
        overlay.__cluster.items.some(function(clusterItem) {
          return clusterItem && clusterItem.key === item.key;
        })
      );
    });

    selectedGroupKey =
      matchedOverlay && matchedOverlay.__cluster
        ? matchedOverlay.__cluster.key
        : null;

    if (typeof redrawSelectedMarkers === "function") {
      redrawSelectedMarkers();
    }
  }

  /*
   * 리스트 안에 AI카드를 펼치지 않고,
   * 선택 상태만 다시 표시한 뒤 독립 AI 패널을 엽니다.
   */
  showList(visibleListItems && visibleListItems.length ? visibleListItems : [item]);
  document.getElementById("status").innerHTML = multiClusterMode
    ? "다중 클러스터 선택 유지 · 현재 매물 AI 분석"
    : "선택 매물 1개 · AI 분석 패널 표시";

  if (typeof openAiSidePanel === "function") {
    openAiSidePanel(item);
  }

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("open");
  }
}
