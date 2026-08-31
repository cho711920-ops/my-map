/* JS부동산 v7 - 계정별 통합 찜폴더 */
(function (global) {
  "use strict";

  var state = {
    pendingRefs: [],
    expanded: {},
    source: "browse"
  };
  var favoriteDetailObserverV7 = null;
  var favoriteLocationMapV7 = null;
  var favoriteLocationMarkerV7 = null;
  var favoriteLocationCircleV7 = null;
  var favoriteLocationPositionV7 = null;

  function store() {
    return global.JSV6ListStore || null;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uid() {
    return "fav_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function load(type) {
    var api = store();
    if (!api || typeof api.load !== "function") return [];
    var lists = api.load(type || "favorite");
    return Array.isArray(lists) ? lists : [];
  }

  function save(lists) {
    var api = store();
    if (!api || typeof api.save !== "function") return false;
    try {
      return api.save("favorite", lists) !== false;
    } catch (error) {
      console.error("찜폴더 저장 실패", error);
      return false;
    }
  }

  function resolveItem(ref) {
    ref = String(ref || "");
    var propertyPrefix = "property:";
    var propertyId = ref.indexOf(propertyPrefix) === 0 ? ref.slice(propertyPrefix.length) : "";
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    if (propertyId) {
      return items.find(function (item) {
        return String(item && item.propertyId || "") === propertyId;
      }) || null;
    }
    var api = store();
    if (api && typeof api.getItem === "function") {
      var stored = api.getItem(ref);
      if (stored) return stored;
    }
    return items.find(function (item) { return String(item && item.key || "") === ref; }) || null;
  }

  function stableRef(item, fallback) {
    var propertyId = String(item && item.propertyId || "").trim();
    if (propertyId) return "property:" + propertyId;
    return String(item && item.key || fallback || "").trim();
  }

  function refSignature(ref) {
    var item = resolveItem(ref);
    return stableRef(item, ref);
  }

  function uniqueRefs(refs) {
    var seen = {};
    return (refs || []).map(function (ref) {
      return refSignature(ref);
    }).filter(function (ref) {
      if (!ref || seen[ref]) return false;
      seen[ref] = true;
      return true;
    });
  }

  function reconcileSavedFolder(savedFolder) {
    global.setTimeout(function () {
      var latest = load("favorite");
      var current = latest.find(function (entry) {
        return String(entry.id) === String(savedFolder.id);
      });
      var expectedRefs = uniqueRefs(savedFolder.itemKeys || []);
      var changed = false;
      if (!current) {
        latest.push({
          id: savedFolder.id,
          name: savedFolder.name,
          itemKeys: expectedRefs,
          createdAt: savedFolder.createdAt || nowIso(),
          updatedAt: savedFolder.updatedAt || nowIso()
        });
        changed = true;
      } else {
        var mergedRefs = uniqueRefs((current.itemKeys || []).concat(expectedRefs));
        if (JSON.stringify(mergedRefs) !== JSON.stringify(uniqueRefs(current.itemKeys || []))) {
          current.itemKeys = mergedRefs;
          current.updatedAt = nowIso();
          changed = true;
        }
      }
      if (changed && !save(latest)) {
        showToast("찜폴더 저장을 다시 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.", "warning");
        return;
      }
      var modal = document.getElementById("unifiedFavoriteModalV7");
      if (modal && modal.classList.contains("open")) render();
    }, 450);
  }

  function getSelectedRefs() {
    var selectedItems = typeof global.getSelectedPrintItems === "function"
      ? global.getSelectedPrintItems()
      : [];
    if (Array.isArray(selectedItems) && selectedItems.length) {
      return uniqueRefs(selectedItems.map(function (item) { return stableRef(item); }));
    }
    var keys = Array.isArray(global.selectedPrintKeys) ? global.selectedPrintKeys : [];
    return uniqueRefs(keys);
  }

  function showToast(message, tone) {
    var toast = document.getElementById("unifiedFavoriteToastV7");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "unifiedFavoriteToastV7";
      toast.className = "unified-favorite-toast-v7";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.className = "unified-favorite-toast-v7 " + (tone || "success");
    toast.textContent = message;
    global.clearTimeout(showToast._timer);
    global.requestAnimationFrame(function () { toast.classList.add("show"); });
    showToast._timer = global.setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }

  function migrateVisitFolders() {
    var favorites = load("favorite");
    var visits = load("visit");
    if (!visits.length) return false;
    var changed = false;

    visits.forEach(function (visit) {
      if (!visit || !visit.name) return;
      var target = favorites.find(function (favorite) {
        return String(favorite.name || "").trim() === String(visit.name || "").trim();
      });
      if (!target) {
        var existingIds = favorites.map(function (entry) { return String(entry.id || ""); });
        var nextId = "fav_from_" + String(visit.id || uid()).replace(/[^a-zA-Z0-9_-]/g, "");
        if (existingIds.indexOf(nextId) >= 0) nextId = uid();
        target = {
          id: nextId,
          name: String(visit.name),
          itemKeys: [],
          createdAt: visit.createdAt || nowIso(),
          updatedAt: nowIso(),
          migratedFromVisit: true
        };
        favorites.push(target);
        changed = true;
      }
      var before = uniqueRefs(target.itemKeys || []);
      var merged = uniqueRefs(before.concat(visit.itemKeys || []));
      if (JSON.stringify(before) !== JSON.stringify(merged)) {
        target.itemKeys = merged;
        target.updatedAt = nowIso();
        changed = true;
      }
    });

    if (changed && !save(favorites)) return false;
    var api = store();
    if (api && typeof api.remove === "function") {
      visits.forEach(function (visit) {
        if (visit && visit.id) api.remove("visit", visit.id, []);
      });
    } else if (api && typeof api.save === "function") {
      try {
        if (api.save("visit", []) === false) return changed;
      } catch (error) {
        console.warn("이전 임장목록 정리 실패", error);
      }
    }
    return changed;
  }

  function clearSavedSelection() {
    if (state.source !== "selection" || !state.pendingRefs.length) return;
    state.pendingRefs = [];
    if (typeof global.clearSelectedPrintItems === "function") {
      global.clearSelectedPrintItems();
    }
  }

  function ensureModal() {
    if (document.getElementById("unifiedFavoriteModalV7")) return;
    var modal = document.createElement("div");
    modal.id = "unifiedFavoriteModalV7";
    modal.className = "lm-modal unified-favorite-modal-v7";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="lm-backdrop unified-favorite-backdrop-v7" onclick="closeUnifiedFavoritesV7()"></div>' +
      '<section class="unified-favorite-dialog-v7" role="dialog" aria-modal="true" aria-labelledby="unifiedFavoriteTitleV7">' +
        '<header class="unified-favorite-head-v7">' +
          '<div><strong id="unifiedFavoriteTitleV7">찜목록</strong>' +
          '<span>내 계정에만 저장·동기화됩니다</span></div>' +
          '<div class="unified-favorite-head-actions-v7">' +
            '<b id="unifiedFavoriteSelectedV7"></b>' +
            '<button class="unified-favorite-close-v7" type="button" aria-label="찜목록 닫기" onclick="closeUnifiedFavoritesV7()">×</button>' +
          '</div>' +
        '</header>' +
        '<div class="unified-favorite-layout-v7">' +
          '<aside id="unifiedFavoriteMapHostV7" class="unified-favorite-map-host-v7" aria-hidden="true">' +
            '<header class="unified-favorite-map-head-v7"><div><strong>매물 위치</strong><span>선택 매물 중심 반경 50m</span></div>' +
              '<b>50m</b></header>' +
            '<div id="unifiedFavoriteMiniMapV7" class="unified-favorite-mini-map-v7" role="img" aria-label="선택한 매물의 위치 지도"></div>' +
            '<div id="unifiedFavoriteMapStatusV7" class="unified-favorite-map-status-v7" aria-live="polite"></div>' +
          '</aside>' +
          '<aside id="unifiedFavoriteDetailHostV7" class="unified-favorite-detail-host-v7" aria-hidden="true"></aside>' +
          '<div class="unified-favorite-list-pane-v7">' +
            '<form id="unifiedFavoriteCreateFormV7" class="unified-favorite-create-v7">' +
              '<label for="unifiedFavoriteNameV7">찜폴더명</label>' +
              '<input id="unifiedFavoriteNameV7" type="text" maxlength="30" placeholder="새 찜폴더 이름">' +
              '<button id="unifiedFavoriteAddV7" type="submit">폴더 추가</button>' +
            '</form>' +
            '<div id="unifiedFavoriteBodyV7" class="unified-favorite-body-v7"></div>' +
          '</div>' +
        '</div>' +
      '</section>';
    document.body.appendChild(modal);
    var createForm = document.getElementById("unifiedFavoriteCreateFormV7");
    if (createForm) createForm.addEventListener("submit", function (event) {
      event.preventDefault();
      global.createUnifiedFavoriteFolderV7(event);
    });
  }

  function positionModal() {
    var modal = document.getElementById("unifiedFavoriteModalV7");
    var dialog = modal && modal.querySelector(".unified-favorite-dialog-v7");
    if (!modal || !dialog || global.innerWidth <= 768) return;
    var detailOpen = dialog.classList.contains("has-detail-v7");
    var width = detailOpen
      ? Math.min(1360, Math.max(920, global.innerWidth - 48))
      : Math.min(620, Math.max(500, global.innerWidth * 0.5));
    width = Math.min(width, global.innerWidth - 32);
    var left = Math.max(16, (global.innerWidth - width) / 2);
    var verticalGap = Math.max(16, Math.min(68, (global.innerHeight - 500) / 2));
    var top = verticalGap;
    var height = Math.max(500, global.innerHeight - (verticalGap * 2));
    dialog.style.left = left + "px";
    dialog.style.top = top + "px";
    dialog.style.width = width + "px";
    dialog.style.height = height + "px";
    dialog.style.maxHeight = height + "px";
    refreshFavoriteLocationMapV7();
  }

  function finiteCoordinateV7(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function itemCoordinatesV7(item) {
    if (!item) return null;
    var lat = finiteCoordinateV7(item.latitude != null && item.latitude !== "" ? item.latitude : item.lat);
    var lng = finiteCoordinateV7(item.longitude != null && item.longitude !== "" ? item.longitude : item.lng);
    if ((lat == null || lng == null) && item.latlng) {
      try {
        lat = finiteCoordinateV7(typeof item.latlng.getLat === "function" ? item.latlng.getLat() : lat);
        lng = finiteCoordinateV7(typeof item.latlng.getLng === "function" ? item.latlng.getLng() : lng);
      } catch (_) {}
    }
    if ((lat == null || lng == null) && Array.isArray(item.unifiedOriginalsV8)) {
      item.unifiedOriginalsV8.some(function (original) {
        var originalLat = finiteCoordinateV7(original && (original.latitude != null && original.latitude !== "" ? original.latitude : original.lat));
        var originalLng = finiteCoordinateV7(original && (original.longitude != null && original.longitude !== "" ? original.longitude : original.lng));
        if (originalLat == null || originalLng == null) return false;
        lat = originalLat;
        lng = originalLng;
        return true;
      });
    }
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return {lat: lat, lng: lng};
  }

  function setFavoriteMapStatusV7(message, empty) {
    var status = document.getElementById("unifiedFavoriteMapStatusV7");
    var container = document.getElementById("unifiedFavoriteMiniMapV7");
    if (status) status.textContent = message || "";
    if (container) container.classList.toggle("is-empty-v7", !!empty);
  }

  function clearFavoriteLocationMapV7() {
    if (favoriteLocationMarkerV7 && typeof favoriteLocationMarkerV7.setMap === "function") {
      favoriteLocationMarkerV7.setMap(null);
    }
    if (favoriteLocationCircleV7 && typeof favoriteLocationCircleV7.setMap === "function") {
      favoriteLocationCircleV7.setMap(null);
    }
    favoriteLocationMarkerV7 = null;
    favoriteLocationCircleV7 = null;
    favoriteLocationPositionV7 = null;
  }

  function refreshFavoriteLocationMapV7() {
    if (!favoriteLocationMapV7 || !favoriteLocationPositionV7 || !global.kakao || !global.kakao.maps) return;
    global.setTimeout(function () {
      if (!favoriteLocationMapV7 || !favoriteLocationPositionV7) return;
      global.kakao.maps.event.trigger(favoriteLocationMapV7, "resize");
      favoriteLocationMapV7.setCenter(favoriteLocationPositionV7);
    }, 240);
  }

  function renderFavoriteLocationMapV7(item) {
    var host = document.getElementById("unifiedFavoriteMapHostV7");
    var container = document.getElementById("unifiedFavoriteMiniMapV7");
    if (!host || !container) return;
    host.setAttribute("aria-hidden", "false");
    clearFavoriteLocationMapV7();
    var coords = itemCoordinatesV7(item);
    var address = String(item && item.address || "").trim();
    if (!coords) {
      favoriteLocationMapV7 = null;
      container.innerHTML = '<div class="unified-favorite-map-empty-v7"><strong>위치 좌표 없음</strong><span>이 매물에는 지도에 표시할 정확한 좌표가 저장되어 있지 않습니다.</span></div>';
      setFavoriteMapStatusV7(address || "매물 주소를 확인해 주세요.", true);
      return;
    }
    if (!global.kakao || !global.kakao.maps || typeof global.kakao.maps.Map !== "function") {
      favoriteLocationMapV7 = null;
      container.innerHTML = '<div class="unified-favorite-map-empty-v7"><strong>지도를 불러오는 중</strong><span>잠시 후 매물을 다시 눌러 주세요.</span></div>';
      setFavoriteMapStatusV7(address || "선택한 매물 위치", true);
      return;
    }
    container.innerHTML = "";
    container.classList.remove("is-empty-v7");
    var position = new global.kakao.maps.LatLng(coords.lat, coords.lng);
    favoriteLocationPositionV7 = position;
    favoriteLocationMapV7 = new global.kakao.maps.Map(container, {center: position, level: 3});
    favoriteLocationMarkerV7 = new global.kakao.maps.Marker({
      map: favoriteLocationMapV7,
      position: position,
      title: address || "매물 위치"
    });
    favoriteLocationCircleV7 = new global.kakao.maps.Circle({
      map: favoriteLocationMapV7,
      center: position,
      radius: 50,
      strokeWeight: 2,
      strokeColor: "#1677e8",
      strokeOpacity: 0.92,
      strokeStyle: "solid",
      fillColor: "#60a5fa",
      fillOpacity: 0.18
    });
    setFavoriteMapStatusV7(address || "선택한 매물의 저장 위치", false);
    refreshFavoriteLocationMapV7();
  }

  function itemPhoto(item) {
    var candidates = [item && item.thumbnailV8, item && item.thumbnail, item && item.photo, item && item.photoUrl,
      item && item.image, item && item.imageUrl, item && item.representativePhoto];
    if (item && Array.isArray(item.images)) candidates = candidates.concat(item.images);
    if (item && Array.isArray(item.unifiedOriginalsV8)) {
      item.unifiedOriginalsV8.forEach(function (original) {
        if (!original) return;
        if (original.thumbnail) candidates.push(original.thumbnail);
        if (Array.isArray(original.images)) candidates = candidates.concat(original.images);
      });
    }
    return String(candidates.filter(function (value) { return /^https?:\/\//i.test(String(value || "")); })[0] || "");
  }

  function favoriteItemPrice(item) {
    if (!item) return "원본 데이터는 삭제되지 않았습니다";
    if (String(item.tradeType || "").toLowerCase() === "sale") {
      var salePrice = item.salePrice;
      var formattedSalePrice = global.JSSaleWorkbenchV1 && typeof global.JSSaleWorkbenchV1.price === "function"
        ? global.JSSaleWorkbenchV1.price(salePrice)
        : (Number.isFinite(Number(salePrice)) ? Number(salePrice).toLocaleString("ko-KR") + "만원" : "가격 확인 필요");
      return "매매 " + formattedSalePrice + " · 평 " + (item.area || "-");
    }
    return "보 " + (item.deposit || "-") + " / 월 " + (item.rent || "-") + " · 평 " + (item.area || "-");
  }

  function itemRow(ref, folderId) {
    var item = resolveItem(ref);
    var title = item ? (item.name || item.address || "매물") : "현재 목록에서 확인할 수 없는 매물";
    var address = item ? [item.address, item.room].filter(Boolean).join(" · ") : "매물ID " + ref.replace(/^property:/, "");
    var price = favoriteItemPrice(item);
    var photo = itemPhoto(item);
    var encodedRef = encodeURIComponent(ref);
    return '<article class="unified-favorite-item-v7">' +
      '<button type="button" class="unified-favorite-open-v7" onclick="openUnifiedFavoriteItemV7(\'' + encodedRef + '\')" ' +
        'aria-label="' + escapeHtml(title) + ' 상세보기">' +
        '<span class="unified-favorite-thumb-v7">' +
          (photo ? '<img src="' + escapeHtml(photo) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" ' +
            'onerror="this.parentNode.classList.add(\'empty\');this.remove();this.parentNode.innerHTML=\'<span>사진 없음</span>\'">' : '<span>사진 없음</span>') +
        '</span><span class="unified-favorite-item-info-v7"><strong>' + escapeHtml(title) + '</strong>' +
          '<span>' + escapeHtml(address) + '</span><b>' + escapeHtml(price) + '</b></span>' +
      '</button>' +
      '<button type="button" class="unified-favorite-remove-v7" onclick="removeUnifiedFavoriteItemV7(\'' +
        escapeHtml(folderId) + '\',\'' + encodeURIComponent(ref) + '\')">찜 제거</button></article>';
  }

  function render() {
    ensureModal();
    var lists = load("favorite");
    var body = document.getElementById("unifiedFavoriteBodyV7");
    var selected = document.getElementById("unifiedFavoriteSelectedV7");
    if (selected) selected.textContent = state.pendingRefs.length ? state.pendingRefs.length + "개 매물 선택" : "";
    if (!body) return;

    if (!lists.length) {
      body.innerHTML = '<div class="unified-favorite-empty-v7"><strong>아직 찜폴더가 없습니다.</strong>' +
        '<span>위에서 폴더를 만든 뒤 선택한 매물을 추가하세요.</span></div>';
      return;
    }

    body.innerHTML = '<div class="unified-favorite-folder-grid-v7">' + lists.map(function (list) {
      var refs = uniqueRefs(list.itemKeys || []);
      var open = !!state.expanded[list.id];
      return '<section class="unified-favorite-folder-v7' + (open ? ' open' : '') + '">' +
        '<div class="unified-favorite-folder-main-v7"><button type="button" class="unified-favorite-folder-name-v7" ' +
          'onclick="toggleUnifiedFavoriteFolderV7(\'' + escapeHtml(list.id) + '\')"><span>' + escapeHtml(list.name) +
          '</span><b>' + refs.length + '개</b><em>' + (open ? '접기' : '보기') + '</em></button>' +
          '<div class="unified-favorite-folder-actions-v7">' +
            (state.pendingRefs.length ? '<button type="button" class="add" onclick="addSelectedToUnifiedFavoriteV7(\'' + escapeHtml(list.id) + '\')">선택매물 담기</button>' : '') +
            '<button type="button" onclick="showUnifiedFavoriteOnMapV7(\'' + escapeHtml(list.id) + '\')">지도 보기</button>' +
            '<button type="button" class="visit" onclick="startUnifiedFavoriteVisitV7(\'' + escapeHtml(list.id) + '\')">임장하기</button>' +
            '<button type="button" onclick="renameUnifiedFavoriteFolderV7(\'' + escapeHtml(list.id) + '\')">이름변경</button>' +
            '<button type="button" class="danger" onclick="deleteUnifiedFavoriteFolderV7(\'' + escapeHtml(list.id) + '\')">폴더삭제</button>' +
          '</div></div>' +
        (open ? '<div class="unified-favorite-items-v7">' +
          (refs.length ? refs.map(function (ref) { return itemRow(ref, list.id); }).join("") : '<p>이 폴더에 찜한 매물이 없습니다.</p>') +
          '</div>' : '') + '</section>';
    }).join("") + '</div>';
  }

  function open(options) {
    options = options || {};
    ensureModal();
    migrateVisitFolders();
    state.source = options.source || "browse";
    state.pendingRefs = uniqueRefs(options.refs || (state.source === "selection" ? getSelectedRefs() : []));
    render();
    var modal = document.getElementById("unifiedFavoriteModalV7");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("lm-modal-open");
    positionModal();
    global.setTimeout(function () {
      var input = document.getElementById("unifiedFavoriteNameV7");
      if (input && state.source === "selection") input.focus();
    }, 30);
  }

  function close() {
    var modal = document.getElementById("unifiedFavoriteModalV7");
    if (!modal) return;
    releaseFavoriteDetailV7();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lm-modal-open");
    state.pendingRefs = [];
  }

  global.openUnifiedFavoritesV7 = function (options) { open(options); };
  global.closeUnifiedFavoritesV7 = close;
  global.openListManager = function () { open({source: "browse"}); };
  global.closeListManager = close;

  global.openSelectedFavoritesManagerV7 = function () {
    var refs = getSelectedRefs();
    if (!refs.length) {
      showToast("찜할 매물을 먼저 체크해 주세요.", "warning");
      return;
    }
    open({source: "selection", refs: refs});
  };

  global.createUnifiedFavoriteFolderV7 = function (event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    var input = document.getElementById("unifiedFavoriteNameV7");
    var name = String(input && input.value || "").trim();
    if (!name) {
      showToast("찜폴더 이름을 입력해 주세요.", "warning");
      if (input) input.focus();
      return;
    }
    var lists = load("favorite");
    if (lists.some(function (list) { return String(list.name || "").trim() === name; })) {
      showToast("같은 이름의 찜폴더가 이미 있습니다.", "warning");
      return;
    }
    var addedCount = state.pendingRefs.length;
    var list = {id: uid(), name: name, itemKeys: state.pendingRefs.slice(), createdAt: nowIso(), updatedAt: nowIso()};
    lists.push(list);
    if (!save(lists)) {
      showToast("찜폴더를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.", "warning");
      if (input) input.focus();
      return;
    }
    state.expanded[list.id] = true;
    if (input) input.value = "";
    clearSavedSelection();
    render();
    showToast('"' + name + '" 폴더를 만들었습니다.' + (addedCount ? " 선택매물도 담았습니다." : ""));
    reconcileSavedFolder(list);
    if (typeof global.applyFilter === "function") global.applyFilter();
  };

  global.toggleUnifiedFavoriteFolderV7 = function (id) {
    state.expanded[id] = !state.expanded[id];
    render();
  };

  global.addSelectedToUnifiedFavoriteV7 = function (id) {
    if (!state.pendingRefs.length) return showToast("선택한 매물이 없습니다.", "warning");
    var lists = load("favorite");
    var list = lists.find(function (entry) { return String(entry.id) === String(id); });
    if (!list) return;
    var before = uniqueRefs(list.itemKeys || []);
    var merged = uniqueRefs(before.concat(state.pendingRefs));
    list.itemKeys = merged;
    list.updatedAt = nowIso();
    if (!save(lists)) {
      showToast("선택매물을 찜폴더에 저장하지 못했습니다. 다시 시도해 주세요.", "warning");
      return;
    }
    reconcileSavedFolder(list);
    state.expanded[id] = true;
    clearSavedSelection();
    render();
    showToast((merged.length - before.length) + "개 매물을 찜폴더에 담았습니다.", merged.length > before.length ? "success" : "info");
    if (typeof global.applyFilter === "function") global.applyFilter();
  };

  global.removeUnifiedFavoriteItemV7 = function (id, encodedRef) {
    var ref = decodeURIComponent(encodedRef || "");
    var signature = refSignature(ref);
    var lists = load("favorite");
    var list = lists.find(function (entry) { return String(entry.id) === String(id); });
    if (!list) return;
    list.itemKeys = (list.itemKeys || []).filter(function (entry) { return refSignature(entry) !== signature; });
    list.updatedAt = nowIso();
    save(lists);
    state.expanded[id] = true;
    render();
    showToast("찜폴더에서 매물을 제거했습니다.");
    if (typeof global.applyFilter === "function") global.applyFilter();
  };

  global.openUnifiedFavoriteItemV7 = function (encodedRef) {
    var ref = decodeURIComponent(encodedRef || "");
    var item = resolveItem(ref);
    var propertyId = String(item && item.propertyId || "").trim();
    if (!propertyId || !global.JSUnifiedListingsV8 || typeof global.JSUnifiedListingsV8.open !== "function") {
      showToast("상세정보를 불러오지 못했습니다. 목록을 새로고침한 뒤 다시 눌러 주세요.", "warning");
      return;
    }
    if (global.innerWidth <= 768) {
      close();
      global.JSUnifiedListingsV8.open(encodeURIComponent(propertyId));
      return;
    }
    var dialog = document.querySelector(".unified-favorite-dialog-v7");
    var host = document.getElementById("unifiedFavoriteDetailHostV7");
    var mapHost = document.getElementById("unifiedFavoriteMapHostV7");
    if (!dialog || !host || !mapHost) return;
    dialog.classList.add("has-detail-v7");
    host.setAttribute("aria-hidden", "false");
    mapHost.setAttribute("aria-hidden", "false");
    positionModal();
    renderFavoriteLocationMapV7(item);
    global.JSUnifiedListingsV8.open(encodeURIComponent(propertyId));
    global.setTimeout(mountFavoriteDetailV7, 0);
  };

  function setFavoriteDetailPaneV7(open) {
    var dialog = document.querySelector(".unified-favorite-dialog-v7");
    var host = document.getElementById("unifiedFavoriteDetailHostV7");
    var mapHost = document.getElementById("unifiedFavoriteMapHostV7");
    if (dialog) dialog.classList.toggle("has-detail-v7", !!open);
    if (host) host.setAttribute("aria-hidden", open ? "false" : "true");
    if (mapHost) mapHost.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) clearFavoriteLocationMapV7();
    var modal = document.getElementById("unifiedFavoriteModalV7");
    if (modal && modal.classList.contains("open")) positionModal();
  }

  function mountFavoriteDetailV7() {
    var host = document.getElementById("unifiedFavoriteDetailHostV7");
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!host || !drawer) {
      setFavoriteDetailPaneV7(false);
      return;
    }
    drawer.classList.add("unified-favorite-embedded-detail-v7");
    host.appendChild(drawer);
    if (favoriteDetailObserverV7) favoriteDetailObserverV7.disconnect();
    if (typeof global.MutationObserver === "function") {
      favoriteDetailObserverV7 = new global.MutationObserver(function () {
        if (drawer.getAttribute("aria-hidden") === "true") setFavoriteDetailPaneV7(false);
      });
      favoriteDetailObserverV7.observe(drawer, {attributes: true, attributeFilter: ["aria-hidden"]});
    }
  }

  function releaseFavoriteDetailV7() {
    var host = document.getElementById("unifiedFavoriteDetailHostV7");
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (favoriteDetailObserverV7) {
      favoriteDetailObserverV7.disconnect();
      favoriteDetailObserverV7 = null;
    }
    if (drawer && host && host.contains(drawer)) {
      if (global.JSUnifiedListingsV8 && typeof global.JSUnifiedListingsV8.close === "function") {
        global.JSUnifiedListingsV8.close();
      }
      drawer.classList.remove("unified-favorite-embedded-detail-v7");
      document.body.appendChild(drawer);
    }
    setFavoriteDetailPaneV7(false);
  }

  global.renameUnifiedFavoriteFolderV7 = function (id) {
    var lists = load("favorite");
    var list = lists.find(function (entry) { return String(entry.id) === String(id); });
    if (!list) return;
    var name = global.prompt("새 찜폴더 이름을 입력해 주세요.", list.name);
    if (name == null) return;
    name = String(name).trim();
    if (!name) return showToast("찜폴더 이름을 입력해 주세요.", "warning");
    if (lists.some(function (entry) { return entry !== list && String(entry.name || "").trim() === name; })) {
      return showToast("같은 이름의 찜폴더가 이미 있습니다.", "warning");
    }
    list.name = name;
    list.updatedAt = nowIso();
    save(lists);
    render();
  };

  global.deleteUnifiedFavoriteFolderV7 = function (id) {
    var lists = load("favorite");
    var list = lists.find(function (entry) { return String(entry.id) === String(id); });
    if (!list) return;
    lists = lists.filter(function (entry) { return String(entry.id) !== String(id); });
    var api = store();
    var saved = api && typeof api.remove === "function"
      ? api.remove("favorite", id, lists) !== false
      : save(lists);
    if (!saved) {
      showToast("찜폴더를 삭제하지 못했습니다. 다시 시도해 주세요.", "warning");
      return;
    }
    delete state.expanded[id];
    render();
    showToast("찜폴더를 삭제했습니다.");
    if (typeof global.applyFilter === "function") global.applyFilter();
  };

  global.showUnifiedFavoriteOnMapV7 = function (id) {
    var list = load("favorite").find(function (entry) { return String(entry.id) === String(id); });
    if (!list) return;
    var refs = uniqueRefs(list.itemKeys || []);
    var filterKeys = refs.slice();
    global.favoriteKeys = filterKeys;
    try { localStorage.setItem("favoriteKeys", JSON.stringify(filterKeys)); } catch (_) {}
    global.favoriteOnly = true;
    var button = document.getElementById("favoriteBtn");
    if (button) button.classList.add("on");
    close();
    if (typeof global.applyFilter === "function") global.applyFilter();
  };

  global.startUnifiedFavoriteVisitV7 = function (id) {
    close();
    if (global.JSAiVisitV6 && typeof global.JSAiVisitV6.openConfirmForList === "function") {
      global.JSAiVisitV6.openConfirmForList(id);
      return;
    }
    showToast("임장 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.", "warning");
  };

  global.openItemListDestinationPicker = function (encodedKey) {
    var key = decodeURIComponent(encodedKey || "");
    open({source: "single", refs: [refSignature(key)]});
  };
  global.openItemListPicker = function (type, encodedKey) {
    global.openItemListDestinationPicker(encodedKey);
  };
  global.closeItemListPicker = close;

  global.addEventListener("resize", function () {
    var modal = document.getElementById("unifiedFavoriteModalV7");
    if (modal && modal.classList.contains("open")) positionModal();
  });

  global.addEventListener("js-v6-list-store-change", function (event) {
    if (!event || !event.detail || event.detail.type !== "favorite") return;
    var modal = document.getElementById("unifiedFavoriteModalV7");
    if (modal && modal.classList.contains("open")) render();
  });

  global.setTimeout(function () { migrateVisitFolders(); }, 2800);
})(window);
