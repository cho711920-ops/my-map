/* =========================================================
   JS부동산 지도/D1 로딩 스크립트 v4.4.1
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

/* JS부동산 지도/마커/클러스터/D1 로딩 전용 스크립트 */
var jsCurrentLocationOverlayV630 = null;
var jsCurrentLocationWatchIdV630 = null;
var jsMapIdleTimerV638 = null;
var jsLastIdleViewportKeyV638 = "";
var jsLastRenderedItemsV639 = [];
var jsClusterSelectionMemoryV638 = {
  singleItemIds: [],
  multiItemIdGroups: []
};
var jsPinnedClusterSelectionV6515 = null;
var jsPinnedClusterSpatialChangeIgnoreUntilV6517 = 0;
var jsMapUserNavigationIntentUntilV6525 = 0;
var jsDefaultMapCenterV6524 = {
  lat: 36.3504,
  lng: 127.3845
};
var jsDefaultMapLevelV6524 = 7;
var jsLegacyDefaultMapLevelV690 = 7;
var jsAdministrativeListSelectionV6570 = null;
var jsAutomaticDataRefreshIntervalV681 = 60 * 1000;
var jsListingsRevisionV682 = "";
var jsListingsRevisionPendingV682 = false;
var jsListingsRevisionInfoV683 = null;
var jsMapClusterEngineDefaultV690 = "world-grid";
var jsMapClusterEngineStorageKeyV690 = "js_map_cluster_engine_v690";
var jsMapResizeObserverV690 = null;
var jsMapResizeRelayoutTimerV690 = null;
var jsInitialListingsCacheHitV1 = false;


/*
 * v6.9.0 당근형 고정 공간 클러스터 전환 장치
 * - 기본값은 지도 전체에 고정된 world-grid입니다.
 * - 문제가 생기면 URL `?clusterEngine=legacy` 또는 아래 공개 API로
 *   기존 화면 픽셀 격자를 즉시 다시 사용할 수 있습니다.
 * - 매물/DB는 건드리지 않고 표시 계산만 전환합니다.
 */
function normalizeMapClusterEngineV690(value) {
  return String(value || "").trim().toLowerCase() === "legacy"
    ? "legacy"
    : "world-grid";
}


function getMapClusterEngineV690() {
  var queryMode = "";
  try {
    queryMode = new URLSearchParams(window.location.search || "").get("clusterEngine") || "";
  } catch (_) {}
  if (queryMode) return normalizeMapClusterEngineV690(queryMode);

  var runtimeMode = String(window.JS_MAP_CLUSTER_ENGINE_V690 || "").trim();
  if (runtimeMode) return normalizeMapClusterEngineV690(runtimeMode);

  try {
    var storedMode = window.localStorage.getItem(jsMapClusterEngineStorageKeyV690);
    if (storedMode) return normalizeMapClusterEngineV690(storedMode);
  } catch (_) {}

  return jsMapClusterEngineDefaultV690;
}


function shouldUseWorldGridClustersV690() {
  return getMapClusterEngineV690() === "world-grid";
}


function syncMapClusterEngineClassV690() {
  if (typeof document === "undefined" || !document.documentElement) return;
  var stable = shouldUseWorldGridClustersV690();
  document.documentElement.classList.toggle("js-world-grid-clusters-v690", stable);
  document.documentElement.classList.toggle("js-legacy-grid-clusters-v690", !stable);
}


function setMapClusterEngineV690(mode, persist) {
  var normalized = normalizeMapClusterEngineV690(mode);
  window.JS_MAP_CLUSTER_ENGINE_V690 = normalized;

  if (persist !== false) {
    try {
      window.localStorage.setItem(jsMapClusterEngineStorageKeyV690, normalized);
    } catch (_) {}
  }

  syncMapClusterEngineClassV690();
  if (typeof applyFilter === "function") applyFilter();
  return normalized;
}


window.JSMapClusterEngineV690 = {
  get: getMapClusterEngineV690,
  set: setMapClusterEngineV690,
  useStable: function() { return setMapClusterEngineV690("world-grid"); },
  useLegacy: function() { return setMapClusterEngineV690("legacy"); }
};

syncMapClusterEngineClassV690();


function relayoutMapPreservingCenterV690(forcedCenter) {
  if (!map || typeof map.relayout !== "function") return;
  var center = forcedCenter || (typeof map.getCenter === "function" ? map.getCenter() : null);
  map.relayout();
  if (center && typeof map.setCenter === "function") map.setCenter(center);
}


function setupMapViewportRelayoutV690(mapElement) {
  if (!mapElement) return;

  var scheduleRelayout = function() {
    if (jsMapResizeRelayoutTimerV690) clearTimeout(jsMapResizeRelayoutTimerV690);
    jsMapResizeRelayoutTimerV690 = setTimeout(function() {
      jsMapResizeRelayoutTimerV690 = null;
      relayoutMapPreservingCenterV690();
    }, 40);
  };

  if (typeof ResizeObserver === "function") {
    jsMapResizeObserverV690 = new ResizeObserver(scheduleRelayout);
    jsMapResizeObserverV690.observe(mapElement);
  }
  window.addEventListener("resize", scheduleRelayout);

  /*
   * 인증 해제 직후 비동기 CSS가 적용되면 지도 폭이 약 1,280px에서
   * 실제 지도 영역으로 줄어듭니다. 초기 중심을 세 번 짧게 보정해
   * 5개 구가 오른쪽 목록 뒤로 밀리지 않게 합니다.
   */
  var overviewCenter = new kakao.maps.LatLng(
    jsDefaultMapCenterV6524.lat,
    jsDefaultMapCenterV6524.lng
  );
  [0, 140, 480].forEach(function(delay) {
    setTimeout(function() {
      if (Date.now() <= jsMapUserNavigationIntentUntilV6525) return;
      relayoutMapPreservingCenterV690(overviewCenter);
    }, delay);
  });
}


function fetchDataRevisionV682(scope) {
  if (window.JSDataAccessV6) {
    return window.JSDataAccessV6.read("dataRevision", {
      scope: scope || "listings"
    }, { errorMessage: "Data revision check failed" }).then(function(result) {
      if ((scope || "listings") === "listings") jsListingsRevisionInfoV683 = result || null;
      return String(result && result.revision || "");
    });
  }
  var api = window.saveApiURL || "/api/data";
  var query = new URLSearchParams({
    action: "dataRevision",
    scope: scope || "listings",
    _: String(Date.now())
  });
  return fetch(api + "?" + query.toString(), {
    credentials: "same-origin",
    cache: "no-store"
  }).then(function(response) {
    if (!response.ok) throw new Error("Data revision check failed (HTTP " + response.status + ")");
    return response.json();
  }).then(function(result) {
    if ((scope || "listings") === "listings") jsListingsRevisionInfoV683 = result || null;
    return String(result && result.revision || "");
  });
}

function listingChangeRowToItemV683(row, index) {
  var item = {
    name: clean(row.title), address: clean(row.address), room: clean(row.room), type: clean(row.listing_type),
    deposit: Number(row.deposit) || 0, rent: Number(row.monthly_rent) || 0,
    fee: Number(row.maintenance_fee) || 0, premium: Number(row.premium) || 0, area: Number(row.area_m2) || 0,
    displayValuePresence: {
      deposit: row.deposit !== null && row.deposit !== "", rent: row.monthly_rent !== null && row.monthly_rent !== "",
      fee: row.maintenance_fee !== null && row.maintenance_fee !== "", premium: row.premium !== null && row.premium !== "",
      area: row.area_m2 !== null && row.area_m2 !== ""
    },
    landlordPhone: clean(row.landlord_phone), tenantPhone: clean(row.tenant_phone),
    memo: clean(row.operating_memo), state: clean(row.status), regDate: clean(row.first_collected_at),
    source: clean(row.main_source), propertyId: clean(row.property_id), sourceLink: clean(row.source_url),
    contactListRaw: String(row.contacts_json == null ? "" : row.contacts_json).trim(),
    buildingYear: clean(row.building_year), buildingElevators: Number(row.building_elevators) || 0,
    buildingElevatorCapacity: Number(row.building_elevator_capacity) || 0,
    buildingApprovalDate: clean(row.building_approval_date), buildingInfoCheckedAt: clean(row.building_info_checked_at),
    buildingInfoStatus: clean(row.building_info_status), registrationAt: clean(row.registration_at),
    lastCollectedAt: clean(row.last_collected_at),
    tradeType: clean(row.trade_type) || "lease",
    saleCategory: clean(row.sale_category),
    salePrice: row.sale_price === null || row.sale_price === "" ? null : Number(row.sale_price),
    latitude: row.latitude === null || row.latitude === "" ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === "" ? null : Number(row.longitude),
    sheetRow: Number(index || 0) + 1, latlng: null
  };
  if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && window.kakao && kakao.maps) {
    item.latlng = new kakao.maps.LatLng(item.latitude, item.longitude);
  }
  item.key = itemKey(item);
  return item;
}

function applyListingChangesV683(info) {
  var ids = info && Array.isArray(info.changeIds) ? info.changeIds.map(clean).filter(Boolean).slice(0, 50) : [];
  if (!ids.length || info.fullReload) return Promise.resolve(false);
  var request = window.JSDataAccessV6
    ? window.JSDataAccessV6.read("listingChanges", { ids: ids.join(",") }, { errorMessage: "Listing delta failed" })
    : fetch((window.saveApiURL || "/api/data") + "?" + new URLSearchParams({ action: "listingChanges", ids: ids.join(","), _: String(Date.now()) }).toString(), {
    credentials: "same-origin", cache: "no-store"
  }).then(function(response) {
    if (!response.ok) throw new Error("Listing delta failed (HTTP " + response.status + ")");
    return response.json();
  });
  return request.then(function(result) {
    var changed = {};
    ids.forEach(function(id) { changed[id] = true; });
    var retained = (allItems || []).filter(function(item) { return !changed[clean(item && item.propertyId)]; });
    var replacements = (result.items || []).map(listingChangeRowToItemV683).filter(function(item) {
      return item.address && item.state !== "deleted";
    });
    allItems = retained.concat(replacements);
    if (window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.load === "function") {
      return window.JSUnifiedListingsV8.load(false).then(function(unified) {
        if (typeof window.JSUnifiedListingsV8.attach === "function") window.JSUnifiedListingsV8.attach(allItems, unified);
      });
    }
  }).then(function() {
    updateTypeOptions(allItems);
    applyFilter();
    updateErrorStatus();
    var status = document.getElementById("status");
    if (status) status.textContent = "변경된 매물 " + ids.length + "건만 동기화했습니다.";
    return true;
  });
}


function rememberListingsRevisionV682() {
  return fetchDataRevisionV682("listings").then(function(revision) {
    if (revision) jsListingsRevisionV682 = revision;
    return revision;
  }).catch(function() {
    return "";
  });
}


function refreshListingsWhenChangedV682() {
  if (jsListingsRevisionPendingV682 || isLoadingSheet) return;
  jsListingsRevisionPendingV682 = true;
  fetchDataRevisionV682("listings").then(function(revision) {
    if (!revision) return;
    if (!jsListingsRevisionV682) {
      return Promise.resolve(loadSheet(true, false)).then(function(loaded) {
        if (loaded !== false) jsListingsRevisionV682 = revision;
      });
    }
    if (revision === jsListingsRevisionV682) return;
    return applyListingChangesV683(jsListingsRevisionInfoV683).then(function(applied) {
      if (applied) {
        jsListingsRevisionV682 = revision;
        return;
      }
      return Promise.resolve(loadSheet(true, true)).then(function(loaded) {
        if (loaded !== false) jsListingsRevisionV682 = revision;
      });
    });
  }).catch(function(error) {
    console.warn("Listing revision check failed", error);
  }).then(function() {
    jsListingsRevisionPendingV682 = false;
  });
}


function resetToDaejeonOverviewV6524() {
  if (!map || !window.kakao || !kakao.maps) return;
  map.setLevel(shouldUseWorldGridClustersV690()
    ? jsDefaultMapLevelV6524
    : jsLegacyDefaultMapLevelV690);
  map.setCenter(new kakao.maps.LatLng(
    jsDefaultMapCenterV6524.lat,
    jsDefaultMapCenterV6524.lng
  ));
}


window.resetToDaejeonOverviewV6524 = resetToDaejeonOverviewV6524;


function getMapSpatialKeyV6515() {
  if (!map) return "";
  var center = map.getCenter();
  return [
    map.getLevel(),
    center ? center.getLat().toFixed(6) : "",
    center ? center.getLng().toFixed(6) : ""
  ].join("|");
}


function getPinnedClusterItemsV6515() {
  var pin = jsPinnedClusterSelectionV6515;
  if (!pin || !pin.itemIdentities || !pin.itemIdentities.length) return [];
  var byIdentity = Object.create(null);
  (allItems || []).forEach(function(item) {
    var identity = getStableItemIdentityV638(item);
    if (identity) byIdentity[identity] = item;
  });
  return pin.itemIdentities.map(function(identity) {
    return byIdentity[identity] || null;
  }).filter(Boolean);
}


function pinCurrentClusterSelectionV6515() {
  var snapshot = captureClusterSelectionSnapshotV638();
  var itemIdentities = [];
  var seen = Object.create(null);
  var groups = snapshot.multiClusterMode
    ? (snapshot.multiItemIdGroups || [])
    : [snapshot.singleItemIds || []];

  groups.forEach(function(group) {
    (group || []).forEach(function(identity) {
      if (!identity || seen[identity]) return;
      seen[identity] = true;
      itemIdentities.push(identity);
    });
  });

  if (!itemIdentities.length) {
    jsPinnedClusterSelectionV6515 = null;
    return;
  }

  jsPinnedClusterSelectionV6515 = {
    spatialKey: getMapSpatialKeyV6515(),
    snapshot: snapshot,
    itemIdentities: itemIdentities
  };
}


function clearPinnedClusterSelectionV6515(clearSelection) {
  jsPinnedClusterSelectionV6515 = null;
  jsPinnedClusterSpatialChangeIgnoreUntilV6517 = 0;
  if (!clearSelection) return;
  selectedGroupKey = null;
  selectedGroupKeys = [];
  if (typeof clearLinkedListingSelectionV845 === "function") {
    clearLinkedListingSelectionV845();
  } else {
    selectedItemKey = null;
    selectedListCardIdV845 = null;
  }
  jsClusterSelectionMemoryV638.singleItemIds = [];
  jsClusterSelectionMemoryV638.multiItemIdGroups = [];
}


function preservePinnedClusterSelectionDuringRelayoutV6517(durationMs) {
  if (!jsPinnedClusterSelectionV6515) return;
  var keepMs = Math.max(600, Number(durationMs) || 1200);
  jsPinnedClusterSpatialChangeIgnoreUntilV6517 = Math.max(
    jsPinnedClusterSpatialChangeIgnoreUntilV6517,
    Date.now() + keepMs
  );
}


function keepPinnedClusterSelectionAcrossTransientUiV6525(durationMs) {
  if (!jsPinnedClusterSelectionV6515) return;

  jsPinnedClusterSelectionV6515.snapshot = captureClusterSelectionSnapshotV638();
  jsPinnedClusterSelectionV6515.spatialKey = getMapSpatialKeyV6515();
  preservePinnedClusterSelectionDuringRelayoutV6517(durationMs || 2400);
}


function restorePinnedClusterSelectionAfterTransientUiV6525() {
  if (!jsPinnedClusterSelectionV6515) return;

  jsPinnedClusterSelectionV6515.spatialKey = getMapSpatialKeyV6515();
  restoreClusterSelectionSnapshotV638(jsPinnedClusterSelectionV6515.snapshot);

  var pinnedItems = getPinnedClusterItemsV6515();
  if (pinnedItems.length && typeof showList === "function") {
    showList(pinnedItems);
  }

  var statusElement = document.getElementById("status");
  if (statusElement && pinnedItems.length) {
    statusElement.textContent = "선택 매물 " + pinnedItems.length + "개";
  }

  if (typeof redrawSelectedMarkers === "function") {
    redrawSelectedMarkers();
  }
}


function markMapUserNavigationIntentV6525(event) {
  var target = event && event.target;
  if (target && target.closest && target.closest(".circle-marker")) return;
  jsMapUserNavigationIntentUntilV6525 = Date.now() + 1800;
}


function shouldClearPinnedClusterForMapNavigationV6525() {
  if (!jsPinnedClusterSelectionV6515) return true;
  if (document.visibilityState === "hidden") return false;
  if (document.body.classList.contains("roadview-modal-open")) return false;
  if (Date.now() <= jsPinnedClusterSpatialChangeIgnoreUntilV6517) return false;
  return Date.now() <= jsMapUserNavigationIntentUntilV6525;
}


function closeOpenListingDetailsForMapSelectionV6525() {
  if (
    window.JSUnifiedListingsV8 &&
    typeof window.JSUnifiedListingsV8.close === "function"
  ) {
    window.JSUnifiedListingsV8.close();
  }

  if (
    document.body.classList.contains("ai-side-panel-open") &&
    typeof window.closeAiSidePanel === "function"
  ) {
    window.closeAiSidePanel();
  }
}


window.keepPinnedClusterSelectionAcrossTransientUiV6525 =
  keepPinnedClusterSelectionAcrossTransientUiV6525;
window.restorePinnedClusterSelectionAfterTransientUiV6525 =
  restorePinnedClusterSelectionAfterTransientUiV6525;


function getStableItemIdentityV638(item) {
  if (!item) return "";

  var propertyId = String(item.propertyId || "").trim();
  if (propertyId) return "property:" + propertyId;

  var itemKeyValue = String(item.key || "").trim();
  if (itemKeyValue) return "key:" + itemKeyValue;

  return "location:" + [
    item.address || "",
    item.room || "",
    item.type || ""
  ].map(function(value) {
    return String(value).trim();
  }).join("|");
}


function getItemsDataSignatureV638(items) {
  var hash = 2166136261;
  var count = 0;

  (items || []).forEach(function(item) {
    count += 1;
    [
      item.propertyId,
      item.key,
      item.name,
      item.address,
      item.room,
      item.type,
      item.deposit,
      item.rent,
      item.fee,
      item.premium,
      item.area,
      item.landlordPhone,
      item.tenantPhone,
      item.memo,
      item.state,
      item.regDate,
      item.source,
      item.sourceLink,
      item.sheetRow
    ].forEach(function(value) {
      var textValue = String(value == null ? "" : value) + "\u001f";
      for (var i = 0; i < textValue.length; i++) {
        hash ^= textValue.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    });
  });

  return count + ":" + (hash >>> 0).toString(16);
}


function getClusterItemIdentitiesV638(cluster) {
  var seen = Object.create(null);

  return ((cluster && cluster.items) || []).map(function(item) {
    return getStableItemIdentityV638(item);
  }).filter(function(identity) {
    if (!identity || seen[identity]) return false;
    seen[identity] = true;
    return true;
  });
}


function findClusterOverlayByKeyV638(groupKey) {
  if (!groupKey) return null;

  return (overlays || []).find(function(overlay) {
    return overlay && overlay.__cluster && overlay.__cluster.key === groupKey;
  }) || null;
}


function findItemByStableIdentityV638(identity) {
  if (!identity) return null;

  var currentItem = (allItems || []).find(function(item) {
    return getStableItemIdentityV638(item) === identity;
  }) || null;

  if (currentItem) return currentItem;

  for (var i = 0; i < (overlays || []).length; i++) {
    var cluster = overlays[i] && overlays[i].__cluster;
    var items = cluster && cluster.items ? cluster.items : [];
    var matched = items.find(function(item) {
      return getStableItemIdentityV638(item) === identity;
    });

    if (matched) return matched;
  }

  return null;
}


function findBestClusterOverlayV638(itemIdentities, preferredIdentity, usedKeys) {
  var identitySet = Object.create(null);
  (itemIdentities || []).forEach(function(identity) {
    if (identity) identitySet[identity] = true;
  });

  var bestOverlay = null;
  var bestScore = 0;

  (overlays || []).forEach(function(overlay) {
    if (!overlay || !overlay.__cluster) return;
    if (usedKeys && usedKeys[overlay.__cluster.key]) return;

    var overlapCount = 0;
    var hasPreferredItem = false;

    (overlay.__cluster.items || []).forEach(function(item) {
      var identity = getStableItemIdentityV638(item);
      if (identitySet[identity]) overlapCount += 1;
      if (preferredIdentity && identity === preferredIdentity) {
        hasPreferredItem = true;
      }
    });

    var score = overlapCount + (hasPreferredItem ? 100000 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestOverlay = overlay;
    }
  });

  return bestScore > 0 ? bestOverlay : null;
}


function captureClusterSelectionSnapshotV638() {
  var selectedItem = selectedListCardIdV845 && typeof getLinkedSelectionCardIdV845 === "function"
    ? (allItems || []).find(function(item) {
        return getLinkedSelectionCardIdV845(item) === selectedListCardIdV845;
      }) || null
    : null;
  if (!selectedItem && selectedItemKey) {
    selectedItem = (allItems || []).find(function(item) {
      return item && item.key === selectedItemKey;
    }) || null;
  }

  if (!selectedItem && selectedItemKey) {
    (overlays || []).some(function(overlay) {
      selectedItem = ((overlay && overlay.__cluster && overlay.__cluster.items) || []).find(function(item) {
        if (!item) return false;
        return selectedListCardIdV845 && typeof getLinkedSelectionCardIdV845 === "function"
          ? getLinkedSelectionCardIdV845(item) === selectedListCardIdV845
          : item.key === selectedItemKey;
      }) || null;
      return !!selectedItem;
    });
  }

  var selectedItemIdentity = getStableItemIdentityV638(selectedItem);
  var singleItemIds = [];
  var singleOverlay = findClusterOverlayByKeyV638(selectedGroupKey);

  if (singleOverlay) {
    singleItemIds = getClusterItemIdentitiesV638(singleOverlay.__cluster);
    jsClusterSelectionMemoryV638.singleItemIds = singleItemIds.slice();
  } else if (selectedItemIdentity) {
    singleItemIds = jsClusterSelectionMemoryV638.singleItemIds.length
      ? jsClusterSelectionMemoryV638.singleItemIds.slice()
      : [selectedItemIdentity];
  } else if (selectedGroupKey) {
    singleItemIds = jsClusterSelectionMemoryV638.singleItemIds.slice();
  } else {
    jsClusterSelectionMemoryV638.singleItemIds = [];
  }

  var multiItemIdGroups = [];
  if (multiClusterMode && (selectedGroupKeys || []).length) {
    selectedGroupKeys.forEach(function(groupKey) {
      var selectedOverlay = findClusterOverlayByKeyV638(groupKey);
      if (selectedOverlay) {
        multiItemIdGroups.push(getClusterItemIdentitiesV638(selectedOverlay.__cluster));
      }
    });

    if (multiItemIdGroups.length) {
      jsClusterSelectionMemoryV638.multiItemIdGroups = multiItemIdGroups.map(function(group) {
        return group.slice();
      });
    } else {
      multiItemIdGroups = jsClusterSelectionMemoryV638.multiItemIdGroups.map(function(group) {
        return group.slice();
      });
    }
  } else {
    jsClusterSelectionMemoryV638.multiItemIdGroups = [];
  }

  return {
    selectedItemIdentity: selectedItemIdentity,
    singleItemIds: singleItemIds,
    multiItemIdGroups: multiItemIdGroups,
    multiClusterMode: !!multiClusterMode
  };
}


function restoreClusterSelectionSnapshotV638(snapshot) {
  if (!snapshot) return;

  var preferredIdentity = snapshot.selectedItemIdentity || "";
  var restoredItem = findItemByStableIdentityV638(preferredIdentity);
  if (restoredItem) {
    selectedItemKey = restoredItem.key;
    selectedListCardIdV845 = typeof getLinkedSelectionCardIdV845 === "function"
      ? getLinkedSelectionCardIdV845(restoredItem)
      : "";
  }

  if (snapshot.multiClusterMode) {
    var usedKeys = Object.create(null);
    var restoredGroupKeys = [];

    (snapshot.multiItemIdGroups || []).forEach(function(itemIdentities) {
      var matchedOverlay = findBestClusterOverlayV638(itemIdentities, "", usedKeys);
      if (!matchedOverlay || !matchedOverlay.__cluster) return;

      var matchedKey = matchedOverlay.__cluster.key;
      usedKeys[matchedKey] = true;
      restoredGroupKeys.push(matchedKey);
    });

    selectedGroupKey = null;
    selectedGroupKeys = restoredGroupKeys;
    jsClusterSelectionMemoryV638.multiItemIdGroups = (snapshot.multiItemIdGroups || []).map(function(group) {
      return group.slice();
    });
    return;
  }

  selectedGroupKeys = [];

  var singleIds = (snapshot.singleItemIds || []).slice();
  if (!singleIds.length && preferredIdentity) singleIds.push(preferredIdentity);

  var matchedSingleOverlay = findBestClusterOverlayV638(
    singleIds,
    preferredIdentity,
    null
  );

  selectedGroupKey = matchedSingleOverlay && matchedSingleOverlay.__cluster
    ? matchedSingleOverlay.__cluster.key
    : null;

  jsClusterSelectionMemoryV638.singleItemIds = singleIds;
}


function updateCurrentLocationOverlayV630(position) {
  if (
    window.JSKakaoNavigation &&
    typeof window.JSKakaoNavigation.rememberPosition === "function"
  ) {
    window.JSKakaoNavigation.rememberPosition(position);
  }

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

  /*
   * 화면을 일정한 격자로 나눌 때 사용하는 한 칸의 크기입니다.
   * 확대 단계에서도 클러스터 원보다 충분히 넓게 유지해 겹침을 막고,
   * 축소할수록 한 칸을 넓혀 더 많은 매물을 한 묶음으로 표시합니다.
   */
  if (level <= 3) return 64;
  if (level <= 5) return 72;
  if (level <= 7) return 80;
  if (level <= 9) return 88;
  return 96;
}


function getWorldGridCellSizeMetersV690(level) {
  var value = Number(level) || 0;

  /*
   * 카카오 레벨이 한 단계 확대될 때 고정 공간 칸도 절반으로 줄입니다.
   * 같은 레벨에서 지도를 드래그하면 이 경계는 움직이지 않습니다.
   * 동 단위 다음 첫 공간 단계는 1.28km로 넉넉히 묶어 큰 클러스터를
   * 먼저 보여주고, 그 다음 단계부터 절반씩 자연스럽게 분해합니다.
   */
  if (value >= 6) return 1280;
  if (value === 5) return 640;
  if (value === 4) return 320;
  if (value === 3) return 160;
  return 80;
}


function toWorldMercatorMetersV690(lat, lng) {
  var earthRadius = 6378137;
  var limitedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
  var longitude = Number(lng) || 0;
  var latRadians = limitedLat * Math.PI / 180;

  return {
    x: earthRadius * longitude * Math.PI / 180,
    y: earthRadius * Math.log(Math.tan(Math.PI / 4 + latRadians / 2))
  };
}


function createWorldGridClustersV690(addressGroups, level) {
  var cellSize = getWorldGridCellSizeMetersV690(level);
  var cells = Object.create(null);

  (addressGroups || []).forEach(function(group) {
    if (!group || !group.latlng) return;
    var lat = Number(group.latlng.getLat());
    var lng = Number(group.latlng.getLng());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    var point = toWorldMercatorMetersV690(lat, lng);
    var cellX = Math.floor(point.x / cellSize);
    var cellY = Math.floor(point.y / cellSize);
    var cellKey = cellX + ":" + cellY;

    if (!cells[cellKey]) {
      cells[cellKey] = {
        cellX: cellX,
        cellY: cellY,
        cellSizeMeters: cellSize,
        groups: [],
        items: [],
        latitudeTotal: 0,
        longitudeTotal: 0,
        addressPointCount: 0,
        worldGrid: true
      };
    }

    cells[cellKey].groups.push(group);
    cells[cellKey].items = cells[cellKey].items.concat(group.items || []);
    cells[cellKey].latitudeTotal += lat;
    cells[cellKey].longitudeTotal += lng;
    cells[cellKey].addressPointCount += 1;
  });

  return Object.keys(cells).sort(function(firstKey, secondKey) {
    var first = cells[firstKey];
    var second = cells[secondKey];
    return first.cellY - second.cellY || first.cellX - second.cellX;
  }).map(function(cellKey) {
    var cluster = cells[cellKey];
    var pointCount = cluster.addressPointCount || 1;
    cluster.latlng = new kakao.maps.LatLng(
      cluster.latitudeTotal / pointCount,
      cluster.longitudeTotal / pointCount
    );
    cluster.key = "world-grid:" + cellSize + ":" + cluster.cellX + ":" + cluster.cellY;
    return cluster;
  });
}


function filterClustersToMapViewportV690(clusters, margin) {
  if (!map || typeof map.getProjection !== "function" || typeof document === "undefined") {
    return clusters || [];
  }

  var projection = map.getProjection();
  var mapElement = document.getElementById("map");
  var width = mapElement ? Number(mapElement.clientWidth) || 0 : 0;
  var height = mapElement ? Number(mapElement.clientHeight) || 0 : 0;
  var buffer = Number(margin) || 0;
  if (!projection || !width || !height) return clusters || [];

  return (clusters || []).filter(function(cluster) {
    if (!cluster || !cluster.latlng) return false;
    var point = projection.containerPointFromCoords(cluster.latlng);
    return point &&
      point.x >= -buffer && point.x <= width + buffer &&
      point.y >= -buffer && point.y <= height + buffer;
  });
}


function getStableClusterSourceItemsV690(fallbackItems) {
  if (!shouldUseWorldGridClustersV690() || typeof getFilteredItems !== "function") {
    return (fallbackItems || []).slice();
  }

  /*
   * 반경검색은 원 자체가 지도 상태이므로 기존 결과를 그대로 사용합니다.
   * 일반 검색·필터는 화면 밖 120px까지 같은 고정 셀을 완성할 수 있도록
   * 지도 경계만 제외한 전체 필터 결과를 사용합니다.
   */
  if (window.mapRadiusFilterV658) return (fallbackItems || []).slice();

  /*
   * 구·동 행정 클러스터는 현재 화면 밖까지 포함한 전체 지역 합계를 표시해야 합니다.
   * 반면 공간 클러스터는 현재 지도 목록과 같은 매물 집합을 고정 세계 격자에 넣어야
   * 화면 가장자리의 큰 격자 중심점 때문에 화면 안 매물이 누락되지 않습니다.
   */
  var level = map && typeof map.getLevel === "function"
    ? Number(map.getLevel()) || 0
    : 0;
  if (!getAdministrativeClusterModeV655(level)) {
    return (fallbackItems || []).slice();
  }

  return getFilteredItems({
    includeUnlocated: false,
    ignoreMapBounds: true
  });
}


function getMapViewportKeyV638() {
  if (!map) return "";

  var center = map.getCenter();
  var mapElement = document.getElementById("map");

  return [
    map.getLevel(),
    center ? center.getLat().toFixed(6) : "",
    center ? center.getLng().toFixed(6) : "",
    mapElement ? mapElement.clientWidth : 0,
    mapElement ? mapElement.clientHeight : 0
  ].join("|");
}


function createExactAddressClustersV6519(addressGroups) {
  return (addressGroups || []).map(function(group) {
    return {
      groups: [group],
      items: (group.items || []).slice(),
      latlng: group.latlng,
      key: group.key + "|exact-address",
      exactAddress: true
    };
  });
}


/*
 * v6.5.27 행정구역 단계형 클러스터
 * - level 8 이상: 구 단위
 * - level 7: 동 단위
 * - level 6 이하: 공간 숫자 클러스터
 */
function getAddressAdminRegionV655(address) {
  var tokens = String(address || "")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  var districts = ["동구", "중구", "서구", "유성구", "대덕구"];
  var district = "";
  var neighborhood = "";

  tokens.forEach(function(token) {
    if (!district && districts.indexOf(token) >= 0) district = token;
    if (!neighborhood && /^[가-힣]+\d*(?:동|가)$/.test(token)) neighborhood = token;
  });

  return {
    district: district,
    neighborhood: neighborhood
  };
}


function setAdministrativeListSelectionV6570(cluster) {
  if (!cluster || !cluster.regionMode || !cluster.regionLabel) {
    jsAdministrativeListSelectionV6570 = null;
    return;
  }

  jsAdministrativeListSelectionV6570 = {
    mode: cluster.regionMode,
    regionLabel: String(cluster.regionLabel || "").trim(),
    districtLabel: String(cluster.districtLabel || "").trim()
  };
}


function clearAdministrativeListSelectionV6570() {
  jsAdministrativeListSelectionV6570 = null;
}


function clearMapListSelectionForNavigationV6571() {
  clearPinnedClusterSelectionV6515(true);
  clearAdministrativeListSelectionV6570();
}


function getAdministrativeListItemsV6570(items) {
  var selection = jsAdministrativeListSelectionV6570;
  var sourceItems = (items || []).slice();
  if (!selection || !selection.regionLabel) return sourceItems;

  /*
   * 동 이름표를 누르면 확대된 현재 화면 안의 일부만 남기지 않고,
   * 현재 검색·출처·가격 조건을 만족하는 해당 동 전체를 목록에 유지합니다.
   */
  if (typeof getFilteredItems === "function") {
    sourceItems = getFilteredItems({
      includeUnlocated: true,
      ignoreMapBounds: true
    });
  }

  return sourceItems.filter(function(item) {
    var region = getAddressAdminRegionV655(item && (item.address || item.rawAddress || ""));
    if (selection.mode === "district") {
      return region.district === selection.regionLabel;
    }
    return region.neighborhood === selection.regionLabel &&
      (!selection.districtLabel || region.district === selection.districtLabel);
  });
}


function getAdministrativeListStatusV6570(items) {
  var selection = jsAdministrativeListSelectionV6570;
  if (!selection) return "";
  return selection.regionLabel + " 매물 " + ((items || []).length) + "개";
}


window.clearAdministrativeListSelectionV6570 = clearAdministrativeListSelectionV6570;


function getAdministrativeClusterModeV655(level) {
  var value = Number(level) || 0;
  if (value >= 8) return "district";
  if (value >= 7) return "neighborhood";
  return "";
}


function createAdministrativeClustersV655(addressGroups, mode) {
  var cells = Object.create(null);

  (addressGroups || []).forEach(function(group) {
    if (!group || !group.latlng) return;
    var region = getAddressAdminRegionV655(group.address || group.key);
    var label = mode === "district" ? region.district : region.neighborhood;
    if (!label) label = mode === "district" ? "기타" : (region.district || "기타");
    var regionKey = mode === "district"
      ? label
      : (region.district || "기타") + ":" + label;

    if (!cells[regionKey]) {
      cells[regionKey] = {
        groups: [],
        items: [],
        weightedLat: 0,
        weightedLng: 0,
        addressPointCount: 0,
        regionMode: mode,
        regionLabel: label,
        districtLabel: region.district || ""
      };
    }

    /*
     * 행정동 이름표의 위치는 매물 수가 아니라 서로 다른 지번주소의 중심으로 잡습니다.
     * 한 주소에 원본매물이 많이 붙어도 이름표가 그 주소 쪽으로 쏠리지 않게 합니다.
     */
    cells[regionKey].groups.push(group);
    cells[regionKey].items = cells[regionKey].items.concat(group.items || []);
    cells[regionKey].weightedLat += Number(group.latlng.getLat());
    cells[regionKey].weightedLng += Number(group.latlng.getLng());
    cells[regionKey].addressPointCount += 1;
  });

  return Object.keys(cells).sort().map(function(regionKey) {
    var cluster = cells[regionKey];
    var weight = cluster.addressPointCount || 1;
    cluster.latlng = new kakao.maps.LatLng(
      cluster.weightedLat / weight,
      cluster.weightedLng / weight
    );
    cluster.key = "admin:" + mode + ":" + regionKey;
    return cluster;
  });
}


function estimateAdministrativeClusterBoxV656(cluster) {
  var label = String(cluster && cluster.regionLabel || "");
  var count = String(((cluster && cluster.items) || []).length || 0);
  var contentWidth = Math.max(label.length * 13, (count.length + 3) * 6.8);

  return {
    width: Math.max(68, Math.min(88, Math.ceil(contentWidth + 18))),
    height: 46
  };
}


function administrativeBoxesOverlapV656(first, second, gap) {
  var spacing = Number(gap) || 0;
  return first.left < second.right + spacing &&
    first.right + spacing > second.left &&
    first.top < second.bottom + spacing &&
    first.bottom + spacing > second.top;
}


/*
 * 동 이름표가 많은 화면에서도 서로 가리지 않도록 가까운 빈자리를 찾습니다.
 * 당근 지도처럼 원래 행정구역 중심에서 멀리 밀어내지 않고, 가까운 자리가
 * 모두 찼으면 수량이 적은 이름표를 이번 화면에서만 생략합니다.
 */
function resolveAdministrativeClusterPositionsV656(clusters) {
  if (!map || typeof map.getProjection !== "function" || typeof document === "undefined") {
    return clusters || [];
  }

  var projection = map.getProjection();
  var mapElement = document.getElementById("map");
  var width = mapElement ? Number(mapElement.clientWidth) || 0 : 0;
  var height = mapElement ? Number(mapElement.clientHeight) || 0 : 0;
  if (!projection || !width || !height) return clusters || [];

  var candidates = [];
  var step = 8;
  var maxRing = 8;

  for (var offsetX = -maxRing; offsetX <= maxRing; offsetX += 1) {
    for (var offsetY = -maxRing; offsetY <= maxRing; offsetY += 1) {
      candidates.push({
        x: offsetX * step,
        y: offsetY * step,
        distance: offsetX * offsetX + offsetY * offsetY
      });
    }
  }

  candidates.sort(function(first, second) {
    return first.distance - second.distance ||
      Math.abs(first.y) - Math.abs(second.y) ||
      Math.abs(first.x) - Math.abs(second.x) ||
      first.y - second.y ||
      first.x - second.x;
  });

  var rows = (clusters || []).map(function(cluster) {
    return {
      cluster: cluster,
      point: projection.containerPointFromCoords(cluster.latlng)
    };
  }).filter(function(row) {
    return !!row.point;
  }).sort(function(first, second) {
    return ((second.cluster.items || []).length - (first.cluster.items || []).length) ||
      first.point.y - second.point.y ||
      first.point.x - second.point.x ||
      String(first.cluster.regionLabel || "").localeCompare(String(second.cluster.regionLabel || ""), "ko");
  });

  var placedBoxes = [];
  var placedClusters = [];
  rows.forEach(function(row) {
    var boxSize = estimateAdministrativeClusterBoxV656(row.cluster);
    var halfWidth = boxSize.width / 2;
    var halfHeight = boxSize.height / 2;
    var chosen = null;

    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      var candidate = candidates[candidateIndex];
      var centerX = Math.max(halfWidth + 4, Math.min(width - halfWidth - 4, row.point.x + candidate.x));
      var centerY = Math.max(halfHeight + 4, Math.min(height - halfHeight - 4, row.point.y + candidate.y));
      var box = {
        left: centerX - halfWidth,
        right: centerX + halfWidth,
        top: centerY - halfHeight,
        bottom: centerY + halfHeight
      };
      var overlaps = placedBoxes.some(function(placed) {
        return administrativeBoxesOverlapV656(box, placed, 4);
      });

      if (!overlaps) {
        chosen = { point: new kakao.maps.Point(centerX, centerY), box: box };
        break;
      }
    }

    if (!chosen) {
      row.cluster.hiddenByCollisionV690 = true;
      return;
    }
    placedBoxes.push(chosen.box);
    row.cluster.displayLatlng = projection.coordsFromContainerPoint(chosen.point);
    placedClusters.push(row.cluster);
  });

  return placedClusters;
}


function createClustersForCurrentZoomV655(addressGroups) {
  var level = map && map.getLevel ? Number(map.getLevel()) || 0 : 0;
  var mode = getAdministrativeClusterModeV655(level);
  var useWorldGrid = shouldUseWorldGridClustersV690();

  if (mode) {
    var administrativeClusters = createAdministrativeClustersV655(addressGroups, mode);
    if (useWorldGrid) {
      administrativeClusters = filterClustersToMapViewportV690(administrativeClusters, 80);
    }

    return resolveAdministrativeClusterPositionsV656(administrativeClusters);
  }

  if (!useWorldGrid) return createDynamicClusters(addressGroups);

  var spatialClusters = level <= 1
    ? createExactAddressClustersV6519(addressGroups)
    : createWorldGridClustersV690(addressGroups, level);

  return filterClustersToMapViewportV690(spatialClusters, 120);
}


function createDynamicClusters(addressGroups) {
  /*
   * 카카오맵 최대 확대(level 1)에서는 화면 격자로 서로 다른 지번을 합치지 않습니다.
   * 같은 지번의 매물만 하나의 클러스터로 유지하여 인접 건물 매물이 섞이는 것을 막습니다.
   */
  if (map && Number(map.getLevel()) <= 1) {
    return createExactAddressClustersV6519(addressGroups);
  }

  var projection = map.getProjection();
  var gridSize = getClusterDistance();
  var cells = Object.create(null);
  var mapElement = document.getElementById("map");
  var mapWidth = mapElement ? mapElement.clientWidth : 0;
  var mapHeight = mapElement ? mapElement.clientHeight : 0;

  addressGroups.forEach(function(group) {
    var point = projection.containerPointFromCoords(group.latlng);
    if (!point) return;
    var cellX = Math.floor(point.x / gridSize);
    var cellY = Math.floor(point.y / gridSize);
    var cellKey = cellX + ":" + cellY;

    if (!cells[cellKey]) {
      cells[cellKey] = {
        cellX: cellX,
        cellY: cellY,
        groups: [],
        items: []
      };
    }

    cells[cellKey].groups.push(group);
    cells[cellKey].items = cells[cellKey].items.concat(group.items);
  });

  return Object.keys(cells).sort(function(a, b) {
    var first = cells[a];
    var second = cells[b];
    return first.cellY - second.cellY || first.cellX - second.cellX;
  }).map(function(cell) {
    var cluster = cells[cell];
    var halfMarker = 24;
    var centerX = (cluster.cellX + 0.5) * gridSize;
    var centerY = (cluster.cellY + 0.5) * gridSize;

    if (mapWidth) centerX = Math.max(halfMarker, Math.min(mapWidth - halfMarker, centerX));
    if (mapHeight) centerY = Math.max(halfMarker, Math.min(mapHeight - halfMarker, centerY));

    cluster.point = new kakao.maps.Point(centerX, centerY);
    cluster.latlng = projection.coordsFromContainerPoint(cluster.point);
    cluster.key = cluster.groups.map(function(group) {
      return group.key;
    }).join("||") + "|grid:" + cluster.cellX + ":" + cluster.cellY;
    return cluster;
  });
}


function scheduleMapIdleRefreshV638() {
  if (jsMapIdleTimerV638) clearTimeout(jsMapIdleTimerV638);

  jsMapIdleTimerV638 = setTimeout(function() {
    jsMapIdleTimerV638 = null;

    if (isRendering) return;

    var viewportKey = getMapViewportKeyV638();
    if (viewportKey && viewportKey === jsLastIdleViewportKeyV638) return;

    jsLastIdleViewportKeyV638 = viewportKey;

    if (
      jsPinnedClusterSelectionV6515 &&
      jsPinnedClusterSelectionV6515.spatialKey !== getMapSpatialKeyV6515()
    ) {
      if (Date.now() <= jsPinnedClusterSpatialChangeIgnoreUntilV6517) {
        jsPinnedClusterSelectionV6515.spatialKey = getMapSpatialKeyV6515();
      } else if (shouldClearPinnedClusterForMapNavigationV6525()) {
        clearPinnedClusterSelectionV6515(true);
      } else {
        jsPinnedClusterSelectionV6515.spatialKey = getMapSpatialKeyV6515();
      }
    }

    /*
     * 이전 화면에서 필터링된 일부 매물만 재사용하면 크게 축소했다가
     * 확대할 때 빠진 매물이 생깁니다. 지도 범위가 바뀔 때마다 전체
     * allItems 기준 필터 결과를 다시 계산합니다.
     *
     * 일반 탐색 중에는 매물리스트도 현재 지도 화면에 맞춰 갱신합니다.
     * 사용자가 클러스터를 열어 비교·수정 중인 경우에는 그 목록을
     * 유지해 지도 이동이나 패널 재배치로 선택이 풀리지 않게 합니다.
     */
    var latestMapItems = typeof getFilteredItems === "function"
      ? getFilteredItems()
      : jsLastRenderedItemsV639;

    currentItems = latestMapItems;
    jsLastRenderedItemsV639 = latestMapItems.slice();
    drawMapClustersOnlyV639(jsLastRenderedItemsV639);

    var hasPinnedClusterList = !!jsPinnedClusterSelectionV6515 || !!selectedGroupKey || (
      !!multiClusterMode && (selectedGroupKeys || []).length > 0
    );

    if (!hasPinnedClusterList && typeof showList === "function") {
      /*
       * 지도 이동 때 화면에 이미 있던 카드 DOM을 재사용합니다.
       * 준공년도 배지가 조회된 카드는 다시 "-"로 돌아가지 않습니다.
       */
      window.jsReuseListCardsOnNextRenderV6521 = true;
      var administrativeItems = getAdministrativeListItemsV6570(jsLastRenderedItemsV639);
      showList(administrativeItems);

      var statusElement = document.getElementById("status");
      if (statusElement) {
        statusElement.innerHTML = getAdministrativeListStatusV6570(administrativeItems) ||
          ("현재 지도 매물 " + jsLastRenderedItemsV639.length + "개");
      }
    }
  }, 120);
}


kakao.maps.load(function() {
  map = new kakao.maps.Map(document.getElementById("map"), {
    center: new kakao.maps.LatLng(
      jsDefaultMapCenterV6524.lat,
      jsDefaultMapCenterV6524.lng
    ),
    level: shouldUseWorldGridClustersV690()
      ? jsDefaultMapLevelV6524
      : jsLegacyDefaultMapLevelV690
  });

  geocoder = new kakao.maps.services.Geocoder();

  var mapElementV6525 = document.getElementById("map");
  if (mapElementV6525) {
    mapElementV6525.addEventListener("pointerdown", markMapUserNavigationIntentV6525, true);
    mapElementV6525.addEventListener("touchstart", markMapUserNavigationIntentV6525, {
      capture: true,
      passive: true
    });
    mapElementV6525.addEventListener("wheel", markMapUserNavigationIntentV6525, {
      capture: true,
      passive: true
    });
  }

  setupMapViewportRelayoutV690(mapElementV6525);

  /*
   * v6.3 현장모드: 지도 이동을 방해하지 않고 현재 위치만 보라색 점으로 표시합니다.
   */
  startCurrentLocationTrackingV630();

  kakao.maps.event.addListener(map, "idle", function() {
    if (isRendering) return;
    scheduleMapIdleRefreshV638();
  });

  kakao.maps.event.addListener(map, "dragstart", function() {
    if (shouldClearPinnedClusterForMapNavigationV6525()) {
      clearMapListSelectionForNavigationV6571();
    } else {
      keepPinnedClusterSelectionAcrossTransientUiV6525(2400);
    }
  });

  kakao.maps.event.addListener(map, "zoom_start", function() {
    if (shouldClearPinnedClusterForMapNavigationV6525()) {
      clearMapListSelectionForNavigationV6571();
    } else {
      keepPinnedClusterSelectionAcrossTransientUiV6525(2400);
    }
  });

  kakao.maps.event.addListener(map, "click", function(mouseEvent) {
    if (!window.mapRoadviewSelectionActive || !mouseEvent || !mouseEvent.latLng) return;
    setMapRoadviewSelection(false);
    if (typeof openKakaoRoadviewAtPosition === "function") {
      openKakaoRoadviewAtPosition(mouseEvent.latLng.getLat(), mouseEvent.latLng.getLng());
    }
  });

  setupEnterSearch();
  setupMobilePanelDrag();
  setupQuickAddShortcuts();
  Promise.resolve(loadSheet()).then(function(loaded) {
    if (loaded !== false) rememberListingsRevisionV682();
  });

  setInterval(function() {
    if (document.visibilityState === "hidden") {
      return;
    }

    if (isLoadingSheet) {
      pendingAutoUpdate = true;
      console.log("주소 변환중이라 자동 업데이트를 건너뜁니다.");
      return;
    }

    refreshListingsWhenChangedV682();
  }, jsAutomaticDataRefreshIntervalV681);

  document.addEventListener("visibilitychange", function() {
    if (!jsPinnedClusterSelectionV6515) return;

    keepPinnedClusterSelectionAcrossTransientUiV6525(3000);
    if (document.visibilityState !== "visible") return;

    window.setTimeout(function() {
      keepPinnedClusterSelectionAcrossTransientUiV6525(2200);
      restorePinnedClusterSelectionAfterTransientUiV6525();
    }, 120);
  });
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
  var clusterSelection = captureClusterSelectionSnapshotV638();

  return {
    selectedItemKey: selectedItemKey || "",
    selectedListCardIdV845: selectedListCardIdV845 || "",
    selectedGroupKey: selectedGroupKey || "",
    selectedGroupKeys: (selectedGroupKeys || []).slice(),
    multiClusterMode: !!multiClusterMode,
    clusterSelection: clusterSelection,
    visibleKeys: (visibleListItems || []).map(function(item) {
      return item.key;
    }),
    visibleListCardIdsV845: (visibleListItems || []).map(function(item) {
      return typeof getLinkedSelectionCardIdV845 === "function"
        ? getLinkedSelectionCardIdV845(item)
        : "";
    }),
    sidebarScrollTop: sidebar ? sidebar.scrollTop : 0,
    aiOpen: aiOpen,
    aiItemKey: typeof aiSidePanelCurrentKey !== "undefined"
      ? (aiSidePanelCurrentKey || selectedItemKey || "")
      : (selectedItemKey || ""),
    aiScrollTop: aiBody ? aiBody.scrollTop : 0
  };
}


function findItemsBySavedKeys(keys, linkedCardIdsV845) {
  var useLinkedCardIdsV845 = Array.isArray(linkedCardIdsV845) &&
    linkedCardIdsV845.length === (keys || []).length &&
    linkedCardIdsV845.some(Boolean) &&
    typeof getLinkedSelectionCardIdV845 === "function";
  var savedIdsV845 = useLinkedCardIdsV845 ? linkedCardIdsV845 : keys;
  if (!Array.isArray(savedIdsV845) || !savedIdsV845.length) return [];

  var keySet = {};
  savedIdsV845.forEach(function(key) {
    keySet[key] = true;
  });

  var foundMap = {};
  (allItems || []).forEach(function(item) {
    var itemIdV845 = useLinkedCardIdsV845 ? getLinkedSelectionCardIdV845(item) : item.key;
    if (keySet[itemIdV845]) {
      foundMap[itemIdV845] = item;
    }
  });

  // 기존 리스트 순서를 그대로 유지
  return savedIdsV845.map(function(key) {
    return foundMap[key] || null;
  }).filter(Boolean);
}


function restoreAutoUpdateViewState(state) {
  if (!state) return;

  var sidebar = document.getElementById("sidebar");
  var aiBody = document.getElementById("aiSidePanelBody");

  var restoredList = findItemsBySavedKeys(state.visibleKeys, state.visibleListCardIdsV845);
  var clusterSelection = state.clusterSelection || null;
  var selectedItem = state.selectedListCardIdV845 && typeof getLinkedSelectionCardIdV845 === "function"
    ? (allItems || []).find(function(item) {
        return getLinkedSelectionCardIdV845(item) === state.selectedListCardIdV845;
      }) || null
    : null;

  if (!selectedItem && clusterSelection && clusterSelection.selectedItemIdentity) {
    selectedItem = findItemByStableIdentityV638(clusterSelection.selectedItemIdentity);
  }

  if (!selectedItem && state.selectedItemKey) {
    selectedItem = (allItems || []).find(function(item) {
      return item.key === state.selectedItemKey;
    }) || null;
  }


  /*
   * 자동업데이트 전에 보고 있던 리스트가 남아 있으면
   * 전체 검색결과 대신 그 리스트를 다시 보여줍니다.
   */
  if (restoredList.length) {
    visibleListItems = restoredList.slice();
    showList(restoredList);
  }

  selectedItemKey = selectedItem ? selectedItem.key : null;
  selectedListCardIdV845 = selectedItem && typeof getLinkedSelectionCardIdV845 === "function"
    ? getLinkedSelectionCardIdV845(selectedItem)
    : null;

  /*
   * 클러스터 키가 새 렌더링 후에도 존재하면 선택 상태를 유지합니다.
   * 없으면 리스트는 유지하되 클러스터 선택 테두리만 해제합니다.
   */
  multiClusterMode = !!state.multiClusterMode;

  if (clusterSelection) {
    clusterSelection.multiClusterMode = !!state.multiClusterMode;
    if (selectedItem && !clusterSelection.selectedItemIdentity) {
      clusterSelection.selectedItemIdentity = getStableItemIdentityV638(selectedItem);
    }
    restoreClusterSelectionSnapshotV638(clusterSelection);
  } else {
    var sameClusterExists = state.selectedGroupKey && overlays.some(function(overlay) {
      return overlay.__cluster && overlay.__cluster.key === state.selectedGroupKey;
    });

    selectedGroupKey = sameClusterExists ? state.selectedGroupKey : null;
    selectedGroupKeys = state.multiClusterMode
      ? (state.selectedGroupKeys || []).filter(function(groupKey) {
          return !!findClusterOverlayByKeyV638(groupKey);
        })
      : [];
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


function showListWithoutReleasingPinnedClusterV685(fallbackItems) {
  /*
   * D1 목록보다 늦게 도착하는 통합매물 응답이나 자동 새로고침이
   * 사용자가 열어둔 클러스터 목록을 전체 목록으로 덮어쓰지 않게 합니다.
   * 새 데이터에서 고정 매물을 잠시 찾지 못해도 기존 DOM을 유지합니다.
   */
  if (jsPinnedClusterSelectionV6515) {
    var pinnedItems = getPinnedClusterItemsV6515();
    if (pinnedItems.length && typeof showList === "function") {
      showList(pinnedItems);
    }
    return true;
  }

  if (typeof showList === "function") {
    showList(fallbackItems || []);
  }
  return false;
}


function hydrateInitialListingsCacheItemsV1(snapshot) {
  var rows = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
  return rows.map(function(cached, index) {
    var item = Object.assign({}, cached || {});
    item.displayValuePresence = Object.assign({}, cached && cached.displayValuePresence || {});
    item.sheetRow = Number(item.sheetRow) || index + 2;
    item.latlng = null;
    var latitude = item.latitude == null || item.latitude === "" ? NaN : Number(item.latitude);
    var longitude = item.longitude == null || item.longitude === "" ? NaN : Number(item.longitude);
    if (
      Number.isFinite(latitude) && Number.isFinite(longitude) &&
      latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
      window.kakao && kakao.maps
    ) {
      item.latitude = latitude;
      item.longitude = longitude;
      item.latlng = new kakao.maps.LatLng(latitude, longitude);
    }
    item.key = itemKey(item);
    return item;
  }).filter(function(item) { return !!item.address; });
}


function showInitialListingsCacheV1(snapshot) {
  if (!snapshot || !window.JSUnifiedListingsV8 ||
      typeof window.JSUnifiedListingsV8.attach !== "function") return false;
  var cachedItems = hydrateInitialListingsCacheItemsV1(snapshot);
  if (!cachedItems.length) return false;

  window.JSUnifiedListingsV8.attach(cachedItems, snapshot.unified || { groups: {} });
  allItems = cachedItems;
  updateTypeOptions(allItems);
  currentItems = getFilteredItems({ includeUnlocated: true });
  /*
   * 캐시 화면은 카드부터 즉시 보여 줍니다. 1만 건 공간 클러스터는 곧 도착할
   * 최신 D1 목록이 한 번만 그리게 하며, 네트워크가 늦을 때만 1.2초 뒤
   * 캐시 좌표로 보완합니다.
   */
  showList(getAdministrativeListItemsV6570(currentItems));
  jsInitialListingsCacheHitV1 = true;
  document.documentElement.setAttribute("data-initial-list-cache-hit", "true");
  var statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.textContent = "저장된 최근 매물 먼저 표시 · 최신 전체목록 확인 중...";
  }
  window.setTimeout(function() {
    if (allItems !== cachedItems || !jsInitialListingsCacheHitV1) return;
    drawMapClustersOnlyV639(currentItems);
  }, 1200);
  return true;
}


function hasReadyCoordinateWithoutSharedCacheV8213(item) {
  if (!item) return true;
  if (item.latlng) return true;

  var sourceLat = item.latitude == null || item.latitude === "" ? NaN : Number(item.latitude);
  var sourceLng = item.longitude == null || item.longitude === "" ? NaN : Number(item.longitude);
  if (
    Number.isFinite(sourceLat) && Number.isFinite(sourceLng) &&
    sourceLat >= -90 && sourceLat <= 90 &&
    sourceLng >= -180 && sourceLng <= 180
  ) {
    return true;
  }

  var addressKey = typeof normalizeAddressForCache === "function"
    ? normalizeAddressForCache(item.address)
    : "";
  var cached = addressKey && typeof geocodeCache !== "undefined"
    ? geocodeCache[addressKey]
    : null;
  return !!(
    cached &&
    Number.isFinite(Number(cached.lat)) &&
    Number.isFinite(Number(cached.lng))
  );
}


function loadSheet(isAuto, forceRefresh) {
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
  var autoUpdateDataSignatureV638 = isAuto
    ? getItemsDataSignatureV638(allItems || [])
    : "";

  isLoadingSheet = true;
  errorItems = [];
  document.getElementById("status").innerHTML = isAuto ? "자동 업데이트 준비중..." : "D1 매물 불러오는 중...";
  var liveInitialDataAppliedV1 = false;
  var liveInitialItemsForCacheV1 = null;
  var initialCacheWriteStartedV1 = false;

  if (!isAuto && window.JSInitialListingsCacheV1 &&
      typeof window.JSInitialListingsCacheV1.read === "function") {
    window.JSInitialListingsCacheV1.read().then(function(snapshot) {
      if (liveInitialDataAppliedV1 || !isLoadingSheet) return;
      showInitialListingsCacheV1(snapshot);
    });
  }

  /*
   * 저장 직후와 데이터 리비전 변경 뒤에는 운영 D1 데이터를 강제로 다시 읽습니다.
   * 리비전 기준값이 아직 없는 최초 자동 확인만 ETag 재검증을 사용합니다.
   */
  var shouldForceRefresh = arguments.length >= 2
    ? !!forceRefresh
    : !!isAuto;
  var sheetRequest = window.JSDataAccessV6
    ? window.JSDataAccessV6.listingsCsv(shouldForceRefresh)
    : fetch(sheetURL, shouldForceRefresh ? {
      cache: "reload",
      headers: { "X-JS-Force-Refresh": "1" }
    } : {
      cache: "default"
    }).then(function(res) {
      if (res.ok) return res.text();
      return res.text().then(function(body) {
        var message = "D1 매물 데이터를 불러오지 못했습니다. (HTTP " + res.status + ")";
        try {
          var parsed = JSON.parse(body);
          if (parsed && parsed.message) message += " " + parsed.message;
        } catch (_) {}
        throw new Error(message);
      });
    });

  var unifiedResult = null;
  var renderedItemsAwaitingUnified = null;
  function persistInitialListingsCacheV1() {
    if (
      isAuto || initialCacheWriteStartedV1 || !liveInitialItemsForCacheV1 ||
      !unifiedResult || unifiedResult.ok === false ||
      !window.JSInitialListingsCacheV1 ||
      typeof window.JSInitialListingsCacheV1.write !== "function"
    ) return;
    initialCacheWriteStartedV1 = true;
    window.JSInitialListingsCacheV1.write(liveInitialItemsForCacheV1, unifiedResult).then(function(saved) {
      if (saved) document.documentElement.setAttribute("data-initial-list-cache-live", "true");
    });
  }
  var unifiedRequest = window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.load === "function"
    ? window.JSUnifiedListingsV8.load(Boolean(isAuto))
    : Promise.resolve({ ok: false, groups: {} });

  unifiedRequest.then(function(result) {
    unifiedResult = result || { ok: false, groups: {} };
    if (!renderedItemsAwaitingUnified || !window.JSUnifiedListingsV8 ||
        typeof window.JSUnifiedListingsV8.attach !== "function") return;

    var targetItems = allItems && allItems.length ? allItems : renderedItemsAwaitingUnified;
    var list = document.getElementById("list");
    var scrollTop = list ? list.scrollTop : 0;
    window.JSUnifiedListingsV8.attach(targetItems, unifiedResult);
    currentItems = getFilteredItems({ includeUnlocated: true });
    window.jsReuseListCardsOnNextRenderV6521 = true;
    showListWithoutReleasingPinnedClusterV685(currentItems);
    if (list) list.scrollTop = scrollTop;
    persistInitialListingsCacheV1();
  }).catch(function(error) {
    console.warn("Unified listing background load failed", error);
  });

  /*
   * 공용 좌표 캐시는 D1 CSV에 좌표가 빠진 행이 있을 때만 지연 요청합니다.
   * 현재처럼 모든 행에 좌표가 있으면 초기 네트워크와 JSON 파싱에서 제외합니다.
   */
  var sharedGeocodeRequest = null;
  function getSharedGeocodeRequestV691() {
    if (!sharedGeocodeRequest) {
      sharedGeocodeRequest = typeof loadSharedGeocodeCache === "function"
        ? loadSharedGeocodeCache()
        : Promise.resolve({ ok: false, entries: {} });
    }
    return sharedGeocodeRequest;
  }

  return sheetRequest
    .then(function(data) {
      var rows = parseCSVRecordsV655(data);
      var rawItems = [];

      for (var i = 1; i < rows.length; i++) {
        var c = rows[i];

        var rawDeposit = clean(c[4]);
        var rawRent = clean(c[5]);
        var rawFee = clean(c[6]);
        var rawPremium = clean(c[7]);
        var rawArea = clean(c[8]);
        var item = {
          name: clean(c[0]),
          address: clean(c[1]),
          room: clean(c[2]),
          type: clean(c[3]),
          deposit: Number(rawDeposit) || 0,
          rent: Number(rawRent) || 0,
          fee: Number(rawFee) || 0,
          premium: Number(rawPremium) || 0,
          area: Number(rawArea) || 0,
          displayValuePresence: {
            deposit: rawDeposit !== "",
            rent: rawRent !== "",
            fee: rawFee !== "",
            premium: rawPremium !== "",
            area: rawArea !== ""
          },
          landlordPhone: clean(c[9]),
          tenantPhone: clean(c[10]),
          memo: clean(c[11]),
          state: clean(c[12]),
          regDate: clean(c[13]),
          source: clean(c[14]),
          propertyId: clean(c[15]),
          sourceLink: clean(c[16]),
          contactListRaw: String(c[17] == null ? "" : c[17]).trim(),
          buildingYear: clean(c[18]),
          buildingElevators: Number(clean(c[19])) || 0,
          buildingApprovalDate: clean(c[20]),
          buildingInfoCheckedAt: clean(c[21]),
          buildingInfoStatus: clean(c[22]),
          registrationAt: clean(c[23]),
          lastCollectedAt: clean(c[24]),
          latitude: clean(c[25]) === "" ? null : Number(c[25]),
          longitude: clean(c[26]) === "" ? null : Number(c[26]),
          buildingElevatorCapacity: Number(clean(c[27])) || 0,
          tradeType: clean(c[28]) || "lease",
          saleCategory: clean(c[29]),
          salePrice: clean(c[30]) === "" ? null : Number(c[30]),
          sheetRow: i + 1,
          latlng: null
        };

        item.key = itemKey(item);

        if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
            item.latitude >= -90 && item.latitude <= 90 &&
            item.longitude >= -180 && item.longitude <= 180 &&
            window.kakao && kakao.maps) {
          item.latlng = new kakao.maps.LatLng(item.latitude, item.longitude);
        }

        if (item.address) rawItems.push(item);
      }

      renderedItemsAwaitingUnified = rawItems;
      if (unifiedResult && window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.attach === "function") {
        window.JSUnifiedListingsV8.attach(rawItems, unifiedResult);
      }

      /*
       * D1 초기화 직후에는 좌표 캐시가 비어 있어 수백 건의 주소 변환이 필요합니다.
       * 좌표가 준비될 때까지 목록까지 0건으로 숨기지 않고, D1에서 읽은 매물 카드를
       * 먼저 보여 준 뒤 지도 마커만 순차적으로 추가합니다.
       */
      liveInitialDataAppliedV1 = true;
      allItems = rawItems;
      updateTypeOptions(allItems);
      currentItems = getFilteredItems({ includeUnlocated: true });
      liveInitialItemsForCacheV1 = currentItems;
      persistInitialListingsCacheV1();
      var allRowsAlreadyLocatedV691 = rawItems.length > 0 && rawItems.every(function(item) {
        return !!item.latlng;
      });
      var allRowsReadyWithoutSharedCacheV8213 = rawItems.length > 0 && rawItems.every(function(item) {
        return hasReadyCoordinateWithoutSharedCacheV8213(item);
      });
      var keptPinnedClusterListV685 = allRowsAlreadyLocatedV691
        ? false
        : showListWithoutReleasingPinnedClusterV685(currentItems);
      /*
       * Missing building data is resolved only for cards that enter the visible
       * list. Bulk-prefetching every address kept server functions alive long
       * after the map was left idle and generated unnecessary hosting cost.
       */
      if (!keptPinnedClusterListV685) {
        document.getElementById("status").innerHTML =
          allRowsAlreadyLocatedV691
            ? "매물 " + currentItems.length + "개 지도 표시 중..."
            : "매물 " + currentItems.length + "개 목록 먼저 표시 · 지도 좌표 준비 중...";
      }

      /*
       * 현재 D1 CSV에 좌표가 모두 있으면 0.7MB 공용 좌표 캐시 요청과
       * 목록/클러스터의 두 번째 렌더를 생략하고 즉시 한 번만 그립니다.
       */
      if (allRowsAlreadyLocatedV691 && !isAuto) {
        applyFilter();
        updateErrorStatus();
        pendingAutoUpdate = false;
        isLoadingSheet = false;
        document.getElementById("status").innerHTML = "매물 " + allItems.length + "개 불러옴";
        return true;
      }

      (allRowsAlreadyLocatedV691 || allRowsReadyWithoutSharedCacheV8213
        ? Promise.resolve({ ok: true, entries: {} })
        : getSharedGeocodeRequestV691()).then(function() {
        geocodeItems(rawItems, function(doneItems) {
        var hasPendingPropertyEditV638 =
          typeof pendingPropertyEditStateV634 !== "undefined" &&
          !!pendingPropertyEditStateV634;
        var canKeepCurrentRenderV638 =
          !!isAuto &&
          !hasPendingPropertyEditV638 &&
          autoUpdateDataSignatureV638 === getItemsDataSignatureV638(doneItems);

        allItems = doneItems;

        /*
         * D1 내용이 바뀌지 않은 자동 확인은 기존 DOM과 클러스터를 그대로 둡니다.
         * 데이터 변경이 있을 때만 아래의 필터/지도/목록 렌더링을 한 번 수행합니다.
         */
        if (canKeepCurrentRenderV638) {
          updateErrorStatus();
          pendingAutoUpdate = false;
          isLoadingSheet = false;
          document.getElementById("status").innerHTML =
            "자동 업데이트 확인 완료 " + allItems.length + "개";
          return;
        }

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
        }, function(progressItems, remainingCount) {
        /*
         * 첫 접속에서는 좌표 캐시가 있는 매물을 먼저 보여 줍니다.
         * 캐시에 없는 주소는 뒤에서 변환하면서 묶음 단위로 지도에 추가합니다.
         */
        if (!progressItems || !progressItems.length || isAuto) return;

        allItems = progressItems;
        updateTypeOptions(allItems);
        preserveActionSelectionDuringRender = !!isAuto;
        applyFilter();
        preserveActionSelectionDuringRender = false;

        document.getElementById("status").innerHTML =
          "저장된 좌표 " + progressItems.length + "개 먼저 표시 / 나머지 " +
          Math.max(0, Number(remainingCount) || 0) + "개 처리 중...";
        });
      });
      return true;
    })
    .catch(function(err) {
      isLoadingSheet = false;
      document.getElementById("status").innerHTML = "D1 불러오기 오류";
      console.error(err);
      return false;
    });
}


function uniqueGeocodeValuesV6417(values) {
  var seen = {};

  return (values || []).filter(function(value) {
    var normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized || seen[normalized]) return false;
    seen[normalized] = true;
    return true;
  });
}


function buildAddressCandidatesV6417(address) {
  var normalized = normalizeAddressForCache(address);
  if (!normalized) return [];

  var candidates = [normalized];
  if (!/^(?:대전|대전광역시)\s/.test(normalized)) {
    candidates.push("대전 " + normalized);
    candidates.push("대전광역시 " + normalized);
  }

  return uniqueGeocodeValuesV6417(candidates);
}


function compactGeocodeTextV6417(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}


function simplifyBuildingNameV6417(name) {
  var simplified = String(name || "").replace(/\s+/g, " ").trim();
  var previous = "";

  while (simplified && simplified !== previous) {
    previous = simplified;
    simplified = simplified
      .replace(/\s*(?:단지내)?(?:오피스텔|아파트|주상복합|OT)?\s*(?:상가|점포|판매시설)$/i, "")
      .replace(/\s*(?:아파트|오피스텔|주상복합)$/i, "")
      .trim();
  }

  return simplified || String(name || "").trim();
}


function isSpecificBuildingNameV6417(name) {
  var compact = compactGeocodeTextV6417(name);
  var genericNames = {
    "": true,
    "상가": true,
    "점포": true,
    "상가점포": true,
    "일반상가": true,
    "집합상가": true,
    "상가주택": true,
    "상가건물": true,
    "근린생활시설": true,
    "사무실": true,
    "공장": true,
    "창고": true,
    "주택": true,
    "건물": true,
    "토지": true,
    "기타": true
  };

  return compact.length >= 4 && !genericNames[compact];
}


function getAddressRegionTokensV6417(address) {
  return uniqueGeocodeValuesV6417(
    String(address || "")
      .replace(/[(),]/g, " ")
      .split(/\s+/)
      .filter(function(token) {
        return /^[가-힣0-9]+(?:구|동|읍|면|리)$/.test(token);
      })
  );
}


function buildPlaceKeywordsV6417(item) {
  var originalName = String((item && item.name) || "").replace(/\s+/g, " ").trim();
  var simpleName = simplifyBuildingNameV6417(originalName);
  if (!isSpecificBuildingNameV6417(simpleName)) return [];

  var regionText = getAddressRegionTokensV6417(item && item.address).join(" ");
  return uniqueGeocodeValuesV6417([
    ["대전", regionText, originalName].filter(Boolean).join(" "),
    ["대전", regionText, simpleName].filter(Boolean).join(" "),
    ["대전", simpleName].filter(Boolean).join(" "),
    simpleName
  ]);
}


function pickPlaceResultV6417(results, item) {
  var buildingKey = compactGeocodeTextV6417(simplifyBuildingNameV6417(item && item.name));
  var regionTokens = getAddressRegionTokensV6417(item && item.address);
  var best = null;
  var bestScore = -1;

  (results || []).forEach(function(result) {
    var candidateNameKey = compactGeocodeTextV6417(simplifyBuildingNameV6417(result && result.place_name));
    var addressText = [result && result.address_name, result && result.road_address_name]
      .filter(Boolean)
      .join(" ");
    var addressKey = compactGeocodeTextV6417(addressText);
    var nameMatched =
      buildingKey &&
      candidateNameKey &&
      (candidateNameKey.indexOf(buildingKey) >= 0 || buildingKey.indexOf(candidateNameKey) >= 0);

    if (!nameMatched) return;

    var regionMatches = regionTokens.filter(function(token) {
      return addressKey.indexOf(compactGeocodeTextV6417(token)) >= 0;
    }).length;

    /* 같은 건물명이 다른 지역에도 있을 수 있으므로, 주소에 구/동 중 하나는 일치해야 합니다. */
    if (regionTokens.length && regionMatches === 0) return;

    var score = candidateNameKey === buildingKey ? 30 : 20;
    score += regionMatches * 5;
    if (result && result.category_group_code) score += 1;

    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  });

  return best;
}


function geocodeItems(items, callback, progressCallback) {
  var done = [];
  var total = items.length;
  var pendingItems = [];
  var pendingTotal = 0;
  var index = 0;
  var convertedCount = 0;
  var cachedCount = 0;

  // 성능 핵심:
  // 1) 이미 변환했던 주소는 localStorage 캐시에서 즉시 사용
  // 2) 캐시에 없는 새 주소만 카카오 주소검색으로 순차 변환
  // 3) 주소 DB에 없는 옛 지번은 건물명으로 한 번 더 찾아 현재 좌표를 사용
  // 4) 카카오 일시 오류는 최대 3회 재시도한 뒤에만 오류 처리
  var requestDelay = 170;
  var retryDelay = 450;
  var maxRetry = 3;
  var places = new kakao.maps.services.Places();
  var lastProgressCount = 0;

  if (total === 0) {
    callback([]);
    return;
  }

  /*
   * 기존 방식은 캐시 확인도 한 행씩 처리해서 마지막 행이 끝날 때까지
   * 클러스터가 전혀 보이지 않았습니다. 먼저 전체 캐시를 한 번에 읽어
   * 좌표가 준비된 매물을 즉시 표시합니다.
   */
  items.forEach(function(item) {
    if (!item || !item.address) return;

    var addressKey = normalizeAddressForCache(item.address);
    var sourceLat = item.latitude == null || item.latitude === "" ? NaN : Number(item.latitude);
    var sourceLng = item.longitude == null || item.longitude === "" ? NaN : Number(item.longitude);
    var cached = geocodeCache[addressKey];

    if (Number.isFinite(sourceLat) && Number.isFinite(sourceLng) &&
        sourceLat >= -90 && sourceLat <= 90 && sourceLng >= -180 && sourceLng <= 180) {
      item.latlng = new kakao.maps.LatLng(sourceLat, sourceLng);
      done.push(item);
      cachedCount++;
    } else if (cached && cached.lat && cached.lng) {
      item.latlng = new kakao.maps.LatLng(cached.lat, cached.lng);
      done.push(item);
      cachedCount++;
    } else {
      pendingItems.push(item);
    }
  });

  pendingTotal = pendingItems.length;

  if (pendingTotal === 0) {
    callback(done);
    return;
  }

  if (cachedCount > 0 && cachedCount < total && typeof progressCallback === "function") {
    lastProgressCount = done.length;
    progressCallback(done.slice(), pendingTotal);
  }

  function updateProgress(mode) {
    var text = "새 주소 처리중 " + Math.min(index + 1, pendingTotal) + " / " + pendingTotal;

    if (mode === "cache") {
      text += " · 저장좌표 " + cachedCount + "개 사용";
    }

    if (mode === "search") {
      text += " · 새 주소 변환중";
    }

    if (mode === "retry") {
      text = "주소 재시도중 " + (index + 1) + " / " + pendingTotal;
    }

    document.getElementById("status").innerHTML = text;
  }

  function finishOne(delay) {
    convertedCount++;
    index++;

    if (index >= pendingTotal) {
      saveGeocodeCache();
      callback(done);
      return;
    }

    /* 새 좌표마다 전체 DOM을 다시 만들지 않고 8개 단위로 추가 표시합니다. */
    if (
      typeof progressCallback === "function" &&
      done.length > lastProgressCount &&
      done.length - lastProgressCount >= 8
    ) {
      lastProgressCount = done.length;
      progressCallback(done.slice(), pendingTotal - index);
    }

    setTimeout(processNext, delay || 0);
  }

  function saveGeocodeSuccess(item, addressKey, lat, lng, metadata) {
    geocodeCache[addressKey] = {
      lat: lat,
      lng: lng,
      savedAt: new Date().toISOString(),
      source: (metadata && metadata.source) || "address",
      matchedAddress: (metadata && metadata.matchedAddress) || ""
    };
    geocodeCacheDirty = true;
    if (typeof queueSharedGeocodeEntry === "function") {
      queueSharedGeocodeEntry(addressKey, geocodeCache[addressKey]);
    }

    item.latlng = new kakao.maps.LatLng(lat, lng);
    item.geocodeFallback = (metadata && metadata.source) || "address";
    done.push(item);
    finishOne(requestDelay);
  }

  function finishGeocodeError(item, hadTransientError) {
    item.geocodeErrorReason = hadTransientError
      ? "카카오 지도 일시 오류 또는 검색 결과 없음"
      : "주소·건물명 검색 결과 없음";
    errorItems.push(item);
    finishOne(requestDelay);
  }

  function searchPlaceFallback(item, keywords, keywordIndex, retryCount, hadTransientError) {
    if (!keywords || keywordIndex >= keywords.length) {
      finishGeocodeError(item, hadTransientError);
      return;
    }

    var keyword = keywords[keywordIndex];
    places.keywordSearch(keyword, function(result, status) {
      if (status === kakao.maps.services.Status.OK && result && result.length > 0) {
        var matched = pickPlaceResultV6417(result, item);
        if (matched && matched.y && matched.x) {
          saveGeocodeSuccess(
            item,
            normalizeAddressForCache(item.address),
            matched.y,
            matched.x,
            {
              source: "building",
              matchedAddress: matched.road_address_name || matched.address_name || keyword
            }
          );
          return;
        }
      }

      if (status === kakao.maps.services.Status.ERROR && retryCount < 2) {
        updateProgress("retry");
        setTimeout(function() {
          searchPlaceFallback(item, keywords, keywordIndex, retryCount + 1, true);
        }, retryDelay * Math.pow(2, retryCount));
        return;
      }

      setTimeout(function() {
        searchPlaceFallback(
          item,
          keywords,
          keywordIndex + 1,
          0,
          hadTransientError || status === kakao.maps.services.Status.ERROR
        );
      }, 120);
    }, { size: 15 });
  }

  function searchAddress(item, candidates, candidateIndex, retryCount, hadTransientError) {
    var addressKey = normalizeAddressForCache(item.address);
    if (!candidates || candidateIndex >= candidates.length) {
      searchPlaceFallback(item, buildPlaceKeywordsV6417(item), 0, 0, hadTransientError);
      return;
    }

    geocoder.addressSearch(candidates[candidateIndex], function(result, status) {
      if (status === kakao.maps.services.Status.OK && result && result.length > 0) {
        saveGeocodeSuccess(item, addressKey, result[0].y, result[0].x, {
          source: "address",
          matchedAddress: result[0].address_name || candidates[candidateIndex]
        });
        return;
      }

      if (status === kakao.maps.services.Status.ERROR && retryCount < maxRetry) {
        updateProgress("retry");

        setTimeout(function() {
          searchAddress(item, candidates, candidateIndex, retryCount + 1, true);
        }, retryDelay * Math.pow(2, retryCount));

        return;
      }

      setTimeout(function() {
        searchAddress(
          item,
          candidates,
          candidateIndex + 1,
          0,
          hadTransientError || status === kakao.maps.services.Status.ERROR
        );
      }, 120);
    });
  }

  function processNext() {
    var item = pendingItems[index];

    if (!item || !item.address) {
      finishOne(0);
      return;
    }

    var addressKey = normalizeAddressForCache(item.address);
    var cached = geocodeCache[addressKey];

    if (cached && cached.lat && cached.lng) {
      /* 시작 시 캐시에서 이미 넣은 행은 중복 추가하지 않습니다. */
      if (!item.latlng) {
        item.latlng = new kakao.maps.LatLng(cached.lat, cached.lng);
        done.push(item);
        cachedCount++;
      }
      updateProgress("cache");

      // 캐시된 주소는 기다리지 않고 빠르게 넘김.
      // 50개마다 아주 짧게 쉬어서 모바일 화면 멈춤을 방지.
      finishOne(cachedCount % 50 === 0 ? 15 : 0);
      return;
    }

    updateProgress("search");
    searchAddress(item, buildAddressCandidatesV6417(item.address), 0, 0, false);
  }

  processNext();
}


function clearMap() {
  overlays.forEach(function(o) { o.setMap(null); });
  overlays = [];
  document.getElementById("list").innerHTML = "";
}


function clearMapOverlaysOnlyV639() {
  overlays.forEach(function(o) { o.setMap(null); });
  overlays = [];
}


function getVisibleAddressGroupsV639(items) {
  var groups = groupByAddress(items || []);
  if (!map || !map.getProjection) return groups;

  var projection = map.getProjection();
  var mapElement = document.getElementById("map");
  if (!projection || !mapElement) return groups;

  var margin = 120;
  var width = mapElement.clientWidth;
  var height = mapElement.clientHeight;

  return groups.filter(function(group) {
    if (!group || !group.latlng) return false;
    var point = projection.containerPointFromCoords(group.latlng);
    return point &&
      point.x >= -margin && point.x <= width + margin &&
      point.y >= -margin && point.y <= height + margin;
  });
}


/* =========================================================
   v6.5.7 클러스터 UI — 수량별 3단계 크기 클래스
   ========================================================= */
function getPremiumClusterSizeClassV635(count) {
  var value = Number(count) || 0;
  if (value >= 500) return " cluster-size-xxl";
  if (value >= 120) return " cluster-size-xl";
  if (value >= 30) return " cluster-size-lg";
  if (value >= 8) return " cluster-size-md";
  return " cluster-size-sm";
}

function buildClusterOverlayContentV655(cluster, classNames) {
  var count = ((cluster && cluster.items) || []).length;
  var classes = "circle-marker" + getPremiumClusterSizeClassV635(count) + (classNames || "");

  if (cluster && cluster.regionMode) {
    classes += " admin-region-cluster-v655 admin-region-" + cluster.regionMode + "-v690";
    return '<button type="button" class="' + classes + '"' +
      ' onclick="openAdministrativeClusterV655(\'' + encodeURIComponent(cluster.key) + '\')"' +
      ' aria-label="' + cluster.regionLabel + ' 매물 ' + count + '개 목록 보기">' +
      '<strong>' + cluster.regionLabel + '</strong><span>매물 <b>' + count.toLocaleString("ko-KR") + '</b></span></button>';
  }

  if (cluster && cluster.worldGrid) classes += " world-grid-cluster-v690";
  return '<div class="' + classes + '" onclick="openCluster(\'' + encodeURIComponent(cluster.key) + '\')">' + count + '</div>';
}

function getCustomerMatchClusterClassV764(cluster) {
  if (!window.operationsMatchPropertyIds || !window.operationsMatchStatusByPropertyId) return "";
  var hasCandidate = false;
  var hasHeld = false;
  ((cluster && cluster.items) || []).forEach(function(item) {
    var propertyId = String(item && item.propertyId || "").trim();
    var status = propertyId ? String(window.operationsMatchStatusByPropertyId[propertyId] || "").trim() : "";
    if (status === "소개") hasCandidate = true;
    if (status === "보류") hasHeld = true;
  });
  if (hasCandidate) return " customer-match-candidate";
  if (hasHeld) return " customer-match-held";
  return "";
}

function getFieldVisitClusterClassV684(cluster, allDone) {
  if (allDone) return "";

  /*
   * 노란 클러스터는 공실박스라는 출처 표시가 아니라 아직 임장 확인이
   * 필요한 매물이 있다는 뜻입니다. 통합 원본에 공실박스가 남아 있어도
   * (확인매물)로 바뀐 뒤에는 노란색을 제거해야 합니다.
   */
  var hasPendingVisit = ((cluster && cluster.items) || []).some(function(item) {
    return typeof isFieldVisitItem === "function" && isFieldVisitItem(item);
  });

  return hasPendingVisit ? " source-gongsil" : "";
}

function drawMapClustersOnlyV639(items) {
  var selectionSnapshotV638 = jsPinnedClusterSelectionV6515
    ? jsPinnedClusterSelectionV6515.snapshot
    : captureClusterSelectionSnapshotV638();
  isRendering = true;
  clearMapOverlaysOnlyV639();

  var clusterSourceItems = getStableClusterSourceItemsV690(items);
  var addressGroups = shouldUseWorldGridClustersV690()
    ? groupByAddress(clusterSourceItems)
    : getVisibleAddressGroupsV639(items);
  var clusters = createClustersForCurrentZoomV655(addressGroups);

  clusters.forEach(function(cluster) {
    var count = cluster.items.length;
    var allDone = cluster.items.length > 0 && cluster.items.every(function(item) {
      return isDone(item);
    });

    var selectedClass = (typeof isClusterSelected === "function" && isClusterSelected(cluster.key)) ? " selected" : "";
    var doneClass = allDone ? " done" : "";
    var customerMatchClass = getCustomerMatchClusterClassV764(cluster);
    var gongsilClass = getFieldVisitClusterClassV684(cluster, allDone);

    /*
     * 클러스터는 출처와 무관하게 기본 파란색을 사용합니다.
     * 클러스터 안의 모든 매물이 거래완료일 때만 done 클래스가 붙어 회색이 됩니다.
     */
    var overlayContent = buildClusterOverlayContentV655(
      cluster,
      gongsilClass + doneClass + customerMatchClass + selectedClass
    );

    var overlay = new kakao.maps.CustomOverlay({
      position: cluster.displayLatlng || cluster.latlng,
      content: overlayContent,
      yAnchor: 0.5,
      xAnchor: 0.5
    });

    overlay.__cluster = cluster;
    overlay.setMap(map);
    overlays.push(overlay);
  });

  restoreClusterSelectionSnapshotV638(selectionSnapshotV638);
  isRendering = false;

  if (typeof redrawSelectedMarkers === "function") {
    redrawSelectedMarkers();
  }
}

window.mapRoadviewSelectionActive = false;

function setMapRoadviewSelection(active) {
  window.mapRoadviewSelectionActive = !!active;
  var button = document.getElementById("mapRoadviewSelectBtn");
  var mapElement = document.getElementById("map");
  if (button) {
    button.classList.toggle("active", window.mapRoadviewSelectionActive);
    button.setAttribute("aria-pressed", window.mapRoadviewSelectionActive ? "true" : "false");
    button.title = window.mapRoadviewSelectionActive
      ? "지도에서 위치를 누르세요 (다시 누르면 취소)"
      : "지도에서 로드뷰 선택";
  }
  if (mapElement) mapElement.classList.toggle("roadview-pick-mode", window.mapRoadviewSelectionActive);

  if (map && kakao && kakao.maps && kakao.maps.MapTypeId) {
    if (window.mapRoadviewSelectionActive) {
      map.addOverlayMapTypeId(kakao.maps.MapTypeId.ROADVIEW);
    } else {
      map.removeOverlayMapTypeId(kakao.maps.MapTypeId.ROADVIEW);
    }
  }
}

function toggleMapRoadviewSelection() {
  setMapRoadviewSelection(!window.mapRoadviewSelectionActive);
}


function drawItems(items) {
  jsLastRenderedItemsV639 = (items || []).slice();
  drawMapClustersOnlyV639(jsLastRenderedItemsV639);
  var pinnedItems = getPinnedClusterItemsV6515();
  showList(pinnedItems.length
    ? pinnedItems
    : getAdministrativeListItemsV6570(jsLastRenderedItemsV639));
}


function openCluster(encodedKey) {
  var key = decodeURIComponent(encodedKey);

  var overlay = overlays.find(function(o) {
    return o.__cluster && o.__cluster.key === key;
  });

  if (!overlay) return;

  jsMapUserNavigationIntentUntilV6525 = 0;
  closeOpenListingDetailsForMapSelectionV6525();

  if (typeof clearLinkedListingSelectionV845 === "function") {
    clearLinkedListingSelectionV845();
  } else {
    selectedItemKey = null;
    selectedListCardIdV845 = null;
  }

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
      clearPinnedClusterSelectionV6515(false);
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

  pinCurrentClusterSelectionV6515();
  redrawSelectedMarkers();
}


function openAdministrativeClusterV655(encodedKey) {
  var key = decodeURIComponent(encodedKey);
  var overlay = overlays.find(function(currentOverlay) {
    return currentOverlay.__cluster && currentOverlay.__cluster.key === key;
  });
  if (!overlay || !overlay.__cluster || !map) return;

  var cluster = overlay.__cluster;
  jsMapUserNavigationIntentUntilV6525 = 0;
  closeOpenListingDetailsForMapSelectionV6525();
  clearPinnedClusterSelectionV6515(true);
  setAdministrativeListSelectionV6570(cluster);
  showList(cluster.items || []);
  var statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.innerHTML = getAdministrativeListStatusV6570(cluster.items || []);
  }
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
    var customerMatchClass = getCustomerMatchClusterClassV764(cluster);
    var gongsilClass = getFieldVisitClusterClassV684(cluster, allDone);

    /*
     * 선택 상태가 바뀌어 다시 그릴 때도
     * 일반 클러스터는 파란색, 전부 거래완료인 클러스터만 회색을 유지합니다.
     */
    var content = buildClusterOverlayContentV655(
      cluster,
      gongsilClass + doneClass + customerMatchClass + selectedClass
    );

    o.setContent(content);
  });
}


function selectListingOnMapV844(item) {
  if (!item || !item.key) return;
  var linkedCardIdV845 = typeof getLinkedSelectionCardIdV845 === "function"
    ? getLinkedSelectionCardIdV845(item)
    : "";
  selectedItemKey = item.key;
  selectedListCardIdV845 = linkedCardIdV845;

  if (!multiClusterMode) {
    var matchedOverlay = overlays.find(function(overlay) {
      return (
        overlay &&
        overlay.__cluster &&
        overlay.__cluster.items.some(function(clusterItem) {
          if (!clusterItem) return false;
          return linkedCardIdV845 && typeof getLinkedSelectionCardIdV845 === "function"
            ? getLinkedSelectionCardIdV845(clusterItem) === linkedCardIdV845
            : clusterItem.key === item.key;
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

  document.querySelectorAll("#list .item").forEach(function(card) {
    card.classList.toggle(
      "selected",
      card.getAttribute("data-list-card-id-v681") === linkedCardIdV845
    );
  });
}


window.selectListingOnMapV844 = selectListingOnMapV844;


function openItem(item) {
  preservePinnedClusterSelectionDuringRelayoutV6517(1500);
  selectListingOnMapV844(item);

  /*
   * 리스트 안에 AI카드를 펼치지 않고,
   * 선택 상태만 다시 표시한 뒤 독립 AI 패널을 엽니다.
  */
  showList(visibleListItems && visibleListItems.length ? visibleListItems : [item]);
  var pinnedClusterItemsV6518 = getPinnedClusterItemsV6515();
  document.getElementById("status").innerHTML = pinnedClusterItemsV6518.length
    ? "선택 매물 " + pinnedClusterItemsV6518.length + "개 · 스마트 매물카드"
    : (multiClusterMode
      ? "다중 클러스터 선택 유지 · 현재 매물 AI 분석"
      : "선택 매물 1개 · AI 분석 패널 표시");

  if (typeof openAiSidePanel === "function") {
    openAiSidePanel(item);
  }

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("open");
  }
}
