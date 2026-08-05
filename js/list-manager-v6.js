/* JS부동산 v6.0 STEP1 - 찜목록 / 임장목록 관리 */
(function () {
  "use strict";

  var FAVORITE_KEY = "js_favorite_lists_v6";
  var VISIT_KEY = "js_visit_lists_v6";
  var LEGACY_MIGRATION_KEY = "js_favorite_lists_v6_migrated";
  var currentManagerType = "favorite";
  var currentItemKey = "";
  var cloudSaveTimers = {};
  var cloudSaveRetries = {};
  var cloudRevisions = { favorite: 0, visit: 0 };
  var pendingCloudSave = { favorite: false, visit: false };
  var memoryLists = { favorite: null, visit: null };
  var deletedListIds = { favorite: null, visit: null };
  var cloudSyncReady = false;

  function getSelectedItemKeys() {
    var keys = Array.isArray(window.selectedPrintKeys) ? window.selectedPrintKeys : [];
    return keys.filter(function (key, index) {
      return key && keys.indexOf(key) === index;
    });
  }

  function showListToast(message, tone) {
    var toast = document.getElementById("v6ListToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "v6ListToast";
      toast.className = "v6-list-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.className = "v6-list-toast " + (tone || "success");
    toast.textContent = message;
    window.clearTimeout(showListToast._timer);
    requestAnimationFrame(function () { toast.classList.add("show"); });
    showListToast._timer = window.setTimeout(function () {
      toast.classList.remove("show");
    }, 2800);
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function storageKey(type) {
    return type === "visit" ? VISIT_KEY : FAVORITE_KEY;
  }

  function typeLabel(type) {
    return type === "visit" ? "임장" : "찜";
  }

  function loadLists(type) {
    type = type === "visit" ? "visit" : "favorite";
    if (Array.isArray(memoryLists[type])) return memoryLists[type];
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey(type)) || "[]");
      memoryLists[type] = Array.isArray(parsed) ? parsed : [];
      return memoryLists[type];
    } catch (error) {
      console.error("목록 불러오기 실패", error);
      memoryLists[type] = [];
      return memoryLists[type];
    }
  }

  function dirtyKey(type) {
    return "js_list_sync_dirty_v6_" + type;
  }

  function deletedKey(type) {
    return "js_list_deleted_ids_v6_" + type;
  }

  function loadDeletedIds(type) {
    type = type === "visit" ? "visit" : "favorite";
    if (deletedListIds[type] && typeof deletedListIds[type] === "object") return deletedListIds[type];
    try {
      var parsed = JSON.parse(localStorage.getItem(deletedKey(type)) || "{}");
      deletedListIds[type] = parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      deletedListIds[type] = {};
    }
    return deletedListIds[type];
  }

  function persistDeletedIds(type) {
    try { localStorage.setItem(deletedKey(type), JSON.stringify(loadDeletedIds(type))); } catch (_) {}
  }

  function markDeletedListId(type, id) {
    id = String(id || "").trim();
    if (!id) return;
    loadDeletedIds(type)[id] = Date.now();
    persistDeletedIds(type);
  }

  function hasDeletedListIds(type) {
    return Object.keys(loadDeletedIds(type)).length > 0;
  }

  function excludeDeletedLists(type, lists) {
    var deleted = loadDeletedIds(type);
    return (Array.isArray(lists) ? lists : []).filter(function(list) {
      return !list || !list.id || !deleted[String(list.id)];
    });
  }

  function clearSyncedDeletedIds(type, lists) {
    var active = {};
    (lists || []).forEach(function(list) { if (list && list.id) active[String(list.id)] = true; });
    var deleted = loadDeletedIds(type);
    Object.keys(deleted).forEach(function(id) {
      if (!active[id]) delete deleted[id];
    });
    persistDeletedIds(type);
  }

  function isCloudDirty(type) {
    try {
      return pendingCloudSave[type] || localStorage.getItem(dirtyKey(type)) === "1";
    } catch (_) {
      return !!pendingCloudSave[type];
    }
  }

  function saveLists(type, lists, options) {
    options = options || {};
    type = type === "visit" ? "visit" : "favorite";
    lists = Array.isArray(lists) ? lists : [];
    memoryLists[type] = lists;
    try {
      localStorage.setItem(storageKey(type), JSON.stringify(lists));
      if (type === "favorite") syncLegacyFavoriteKeys(lists);
    } catch (error) {
      console.warn(typeLabel(type) + "목록 기기 저장을 건너뛰고 계정 동기화를 계속합니다.", error);
    }
    try {
      window.dispatchEvent(new CustomEvent("js-v6-list-store-change", {
        detail: { type: type, remote: !!options.remote }
      }));
    } catch (_) {}
    if (options.remote) return true;
    cloudRevisions[type] = Number(cloudRevisions[type] || 0) + 1;
    try { localStorage.setItem(dirtyKey(type), "1"); } catch (_) {}
    scheduleCloudSave(type, lists);
    return true;
  }

  function cloudScope(type) {
    return type === "visit" ? "visitLists" : "favorites";
  }

  function mergeCloudAndLocalLists(remoteLists, localLists) {
    var mergedById = {};
    var order = [];
    function put(list, preferOnTie) {
      if (!list || !list.id) return;
      var id = String(list.id);
      var current = mergedById[id];
      if (!current) order.push(id);
      var currentTime = current ? Date.parse(current.updatedAt || current.createdAt || 0) || 0 : -1;
      var incomingTime = Date.parse(list.updatedAt || list.createdAt || 0) || 0;
      if (!current || incomingTime > currentTime || (preferOnTie && incomingTime === currentTime)) {
        mergedById[id] = list;
      }
    }
    (remoteLists || []).forEach(function(list) { put(list, false); });
    (localLists || []).forEach(function(list) { put(list, true); });
    return order.map(function(id) { return mergedById[id]; }).filter(Boolean);
  }

  function scheduleCloudSave(type, lists) {
    pendingCloudSave[type] = true;
    if (!cloudSyncReady) return;
    window.clearTimeout(cloudSaveTimers[type]);
    cloudSaveTimers[type] = window.setTimeout(function () {
      flushCloudSave(type, Array.isArray(lists) ? lists : loadLists(type), 0);
    }, 250);
  }

  function flushCloudSave(type, lists, attempt) {
    var snapshot = JSON.stringify(lists || []);
    var revision = Number(cloudRevisions[type] || 0);
    fetch(window.saveApiURL || "/api/data", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "saveCloudState",
          scope: cloudScope(type),
          recordKey: "default",
          data: lists,
          version: Date.now()
        })
      }).then(function(response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(function(result) {
        if (!result || result.ok === false) throw new Error(result && result.message || "저장 응답 오류");
        cloudSaveRetries[type] = 0;
        pendingCloudSave[type] = false;
        if (revision === Number(cloudRevisions[type] || 0) && snapshot === JSON.stringify(loadLists(type))) {
          clearSyncedDeletedIds(type, lists);
          try { localStorage.removeItem(dirtyKey(type)); } catch (_) {}
          return;
        }
        scheduleCloudSave(type, loadLists(type));
      }).catch(function(error) {
        console.warn(typeLabel(type) + "목록 동기화 실패", error);
        var nextAttempt = Math.min(Number(attempt || 0) + 1, 4);
        cloudSaveRetries[type] = nextAttempt;
        pendingCloudSave[type] = true;
        if (nextAttempt < 4) {
          window.clearTimeout(cloudSaveTimers[type]);
          cloudSaveTimers[type] = window.setTimeout(function() {
            flushCloudSave(type, loadLists(type), nextAttempt);
          }, [0, 900, 2500, 6000][nextAttempt]);
        } else {
          showListToast(typeLabel(type) + "목록은 이 기기에 안전하게 저장됐습니다. 계정 동기화는 자동 재시도합니다.", "warning");
          window.clearTimeout(cloudSaveTimers[type]);
          cloudSaveTimers[type] = window.setTimeout(function() {
            flushCloudSave(type, loadLists(type), 0);
          }, 30000);
        }
      });
  }

  async function loadCloudLists(type) {
    var revisionAtStart = Number(cloudRevisions[type] || 0);
    var dirtyAtStart = isCloudDirty(type) || pendingCloudSave[type] || revisionAtStart > 0 || hasDeletedListIds(type);
    var url = (window.saveApiURL || "/api/data") +
      "?action=loadCloudState&scope=" + encodeURIComponent(cloudScope(type)) +
      "&recordKey=default&_=" + Date.now();
    var response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("로그인 계정의 목록을 불러오지 못했습니다.");
    var result = await response.json();
    if (!result.ok) throw new Error(result.message || "목록 동기화에 실패했습니다.");
    var local = loadLists(type);
    if (result.found && Array.isArray(result.data)) {
      var remoteLists = excludeDeletedLists(type, result.data);
      if (dirtyAtStart || revisionAtStart !== Number(cloudRevisions[type] || 0)) {
        var merged = mergeCloudAndLocalLists(remoteLists, local);
        saveLists(type, merged, { remote: true });
        try { localStorage.setItem(dirtyKey(type), "1"); } catch (_) {}
        return { found: true, needsPush: true };
      }
      saveLists(type, remoteLists, { remote: true });
      return { found: true, needsPush: false };
    }
    return { found: false, needsPush: local.length > 0 };
  }

  async function syncListsFromCloud() {
    try {
      var found = await Promise.all([loadCloudLists("favorite"), loadCloudLists("visit")]);
      cloudSyncReady = true;
      if (found[0].needsPush || pendingCloudSave.favorite || isCloudDirty("favorite")) scheduleCloudSave("favorite", loadLists("favorite"));
      if (found[1].needsPush || pendingCloudSave.visit || isCloudDirty("visit")) scheduleCloudSave("visit", loadLists("visit"));
      if (typeof window.applyFilter === "function") window.applyFilter();
    } catch (error) {
      cloudSyncReady = true;
      console.warn("로그인 계정 목록 동기화 실패", error);
      if (pendingCloudSave.favorite || isCloudDirty("favorite")) scheduleCloudSave("favorite", loadLists("favorite"));
      if (pendingCloudSave.visit || isCloudDirty("visit")) scheduleCloudSave("visit", loadLists("visit"));
    }
  }

  function syncLegacyFavoriteKeys(lists) {
    var union = [];
    lists.forEach(function (list) {
      (list.itemKeys || []).forEach(function (key) {
        if (union.indexOf(key) === -1) union.push(key);
      });
    });
    window.favoriteKeys = union;
    try {
      localStorage.setItem("favoriteKeys", JSON.stringify(union));
    } catch (error) {
      console.warn("기존 찜 표시용 기기 저장을 건너뜁니다.", error);
    }
  }

  function migrateLegacyFavorites() {
    var migrationComplete = false;
    try { migrationComplete = localStorage.getItem(LEGACY_MIGRATION_KEY) === "1"; } catch (_) {}
    if (migrationComplete) {
      syncLegacyFavoriteKeys(loadLists("favorite"));
      return;
    }

    var lists = loadLists("favorite");
    var legacy = [];
    try {
      legacy = JSON.parse(localStorage.getItem("favoriteKeys") || "[]");
      if (!Array.isArray(legacy)) legacy = [];
    } catch (error) {
      legacy = [];
    }

    if (legacy.length) {
      var defaultList = lists.find(function (list) { return list.name === "관심매물"; });
      if (!defaultList) {
        defaultList = {
          id: uid("fav"),
          name: "관심매물",
          itemKeys: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        lists.unshift(defaultList);
      }
      legacy.forEach(function (key) {
        if (defaultList.itemKeys.indexOf(key) === -1) defaultList.itemKeys.push(key);
      });
      defaultList.updatedAt = nowIso();
    }

    if (legacy.length) saveLists("favorite", lists);
    else syncLegacyFavoriteKeys(lists);
    try { localStorage.setItem(LEGACY_MIGRATION_KEY, "1"); } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getItem(key) {
    if (!Array.isArray(window.allItems)) return null;
    var propertyPrefix = "property:";
    var propertyId = String(key || "").indexOf(propertyPrefix) === 0
      ? String(key).slice(propertyPrefix.length)
      : "";
    if (propertyId) {
      return window.allItems.find(function (item) {
        return String(item && item.propertyId || "") === propertyId;
      }) || null;
    }
    return window.allItems.find(function (item) { return item.key === key; }) || null;
  }

  function itemSummary(item) {
    if (!item) return "삭제되었거나 불러오지 못한 매물";
    var title = item.name || item.address || "매물";
    var sub = [item.address, item.room].filter(Boolean).join(" · ");
    var price = "보증금 " + (item.deposit || "-") + " / 월세 " + (item.rent || "-");
    return '<div class="lm-item-title">' + escapeHtml(title) + '</div>' +
      '<div class="lm-item-sub">' + escapeHtml(sub) + '</div>' +
      '<div class="lm-item-price">' + escapeHtml(price) + '</div>';
  }

  function ensureModal() {
    if (document.getElementById("listManagerModal")) return;
    var wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<div id="listManagerModal" class="lm-modal" aria-hidden="true">' +
        '<div class="lm-backdrop" onclick="closeListManager()"></div>' +
        '<div class="lm-dialog" role="dialog" aria-modal="true">' +
          '<div class="lm-header">' +
            '<div><div id="lmTitle" class="lm-title"></div><div id="lmSubtitle" class="lm-subtitle"></div></div>' +
            '<button class="lm-close" type="button" onclick="closeListManager()">×</button>' +
          '</div>' +
          '<div id="lmBody" class="lm-body"></div>' +
        '</div>' +
      '</div>' +
      '<div id="itemListPickerModal" class="lm-modal" aria-hidden="true">' +
        '<div class="lm-backdrop" onclick="closeItemListPicker()"></div>' +
        '<div class="lm-dialog lm-picker-dialog" role="dialog" aria-modal="true">' +
          '<div class="lm-header">' +
            '<div><div id="lmPickerTitle" class="lm-title"></div><div id="lmPickerSubtitle" class="lm-subtitle"></div></div>' +
            '<button class="lm-close" type="button" onclick="closeItemListPicker()">×</button>' +
          '</div>' +
          '<div id="lmPickerBody" class="lm-body"></div>' +
          '<div id="lmPickerFooter" class="lm-footer"><button class="lm-primary" type="button" onclick="closeItemListPicker()">완료</button></div>' +
        '</div>' +
      '</div>';
    while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);
  }

  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("lm-modal-open");
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".lm-modal.open")) document.body.classList.remove("lm-modal-open");
  }

  function promptListName(type, currentName) {
    var label = typeLabel(type);
    var name = window.prompt(label + "목록 이름을 입력해주세요.", currentName || "");
    if (name == null) return null;
    name = name.trim();
    if (!name) {
      alert("목록 이름을 입력해주세요.");
      return null;
    }
    return name;
  }

  function createList(type, initialItemKey, providedName) {
    var name = providedName == null ? promptListName(type, "") : String(providedName || "").trim();
    if (providedName != null && !name) {
      showListToast("목록 이름을 입력해주세요.", "warning");
      return null;
    }
    if (!name) return null;
    var lists = loadLists(type);
    if (lists.some(function (list) { return list.name === name; })) {
      alert("같은 이름의 목록이 이미 있습니다.");
      return null;
    }
    var list = {
      id: uid(type === "visit" ? "visit" : "fav"),
      name: name,
      itemKeys: initialItemKey ? [initialItemKey] : [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    lists.push(list);
    saveLists(type, lists);
    return list;
  }

  function renderManager() {
    var lists = loadLists(currentManagerType);
    var label = typeLabel(currentManagerType);
    document.getElementById("lmTitle").textContent = label + "목록";
    document.getElementById("lmSubtitle").textContent = "목록 " + lists.length + "개 · 등록 매물 " +
      lists.reduce(function (sum, list) { return sum + (list.itemKeys || []).length; }, 0) + "개";

    var selectedCount = getSelectedItemKeys().length;
    var html = '<div class="lm-toolbar">' +
      '<div class="lm-selection-summary ' + (selectedCount ? 'active' : '') + '">' +
        (selectedCount ? '<strong>' + selectedCount + '개 선택됨</strong><span>아래 목록의 “선택 매물 추가”를 누르세요.</span>' : '<span>매물카드에서 여러 매물을 체크하면 한 번에 추가할 수 있습니다.</span>') +
      '</div>' +
      '<div class="lm-manager-create-form">' +
        '<input id="lmNewManagedListName" type="text" maxlength="30" placeholder="새 ' + label + '목록 이름" ' +
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();createManagedList();}">' +
        '<button class="lm-primary" type="button" onclick="createManagedList()">새 목록 만들기</button>' +
      '</div>' +
    '</div>';
    if (!lists.length) {
      html += '<div class="lm-empty">아직 만든 ' + label + '목록이 없습니다.</div>';
    } else {
      html += '<div class="lm-list-grid">';
      lists.forEach(function (list) {
        html += '<section class="lm-list-card">' +
          '<div class="lm-list-card-head">' +
            '<button class="lm-list-open" type="button" onclick="toggleManagedList(\'' + list.id + '\')">' +
              '<span>' + escapeHtml(list.name) + '</span><strong>' + (list.itemKeys || []).length + '개</strong>' +
            '</button>' +
            '<div class="lm-list-actions">' +
              (selectedCount ? '<button class="bulk-add" type="button" onclick="addSelectedItemsToManagedList(\'' + list.id + '\')">선택 매물 ' + selectedCount + '개 추가</button>' : '') +
              (currentManagerType === "favorite" ? '<button type="button" onclick="showFavoriteListOnMap(\'' + list.id + '\')">지도에서 보기</button>' : '') +
              (currentManagerType === "visit" ? '<button class="ai-visit-start" type="button" onclick="startAiVisitFromManagedList(\'' + list.id + '\')">AI임장 시작</button>' : '') +
              '<button type="button" onclick="renameManagedList(\'' + list.id + '\')">이름변경</button>' +
              '<button class="danger" type="button" onclick="deleteManagedList(\'' + list.id + '\')">삭제</button>' +
            '</div>' +
          '</div>' +
          '<div id="lmListItems_' + list.id + '" class="lm-list-items"></div>' +
        '</section>';
      });
      html += '</div>';
    }
    document.getElementById("lmBody").innerHTML = html;
  }

  window.openListManager = function (type) {
    ensureModal();
    currentManagerType = type === "visit" ? "visit" : "favorite";
    renderManager();
    openModal("listManagerModal");
  };

  window.closeListManager = function () { closeModal("listManagerModal"); };

  window.createManagedList = function () {
    var nameInput = document.getElementById("lmNewManagedListName");
    var list = createList(currentManagerType, "", nameInput && nameInput.value);
    if (!list) return;
    renderManager();
    showListToast('"' + list.name + '" 목록을 만들었습니다.', "success");
    var nextInput = document.getElementById("lmNewManagedListName");
    if (nextInput) nextInput.focus();
  };

  window.renameManagedList = function (id) {
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === id; });
    if (!list) return;
    var name = promptListName(currentManagerType, list.name);
    if (!name || name === list.name) return;
    if (lists.some(function (entry) { return entry.id !== id && entry.name === name; })) {
      alert("같은 이름의 목록이 이미 있습니다.");
      return;
    }
    list.name = name;
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    renderManager();
  };

  window.deleteManagedList = function (id) {
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === id; });
    if (!list) return;
    if (!confirm('"' + list.name + '" 목록을 삭제할까요?\n목록만 삭제되며 매물 원본은 삭제되지 않습니다.')) return;
    lists = lists.filter(function (entry) { return entry.id !== id; });
    saveLists(currentManagerType, lists);
    renderManager();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.toggleManagedList = function (id) {
    var box = document.getElementById("lmListItems_" + id);
    if (!box) return;
    if (box.dataset.open === "1") {
      box.dataset.open = "0";
      box.innerHTML = "";
      return;
    }
    var list = loadLists(currentManagerType).find(function (entry) { return entry.id === id; });
    if (!list) return;
    box.dataset.open = "1";
    if (!(list.itemKeys || []).length) {
      box.innerHTML = '<div class="lm-empty small">등록된 매물이 없습니다.</div>';
      return;
    }
    box.innerHTML = (list.itemKeys || []).map(function (key) {
      return '<div class="lm-managed-item">' +
        '<div class="lm-managed-info">' + itemSummary(getItem(key)) + '</div>' +
        '<button type="button" onclick="removeItemFromManagedList(\'' + id + '\',\'' + encodeURIComponent(key) + '\')">제거</button>' +
      '</div>';
    }).join("");
  };

  window.removeItemFromManagedList = function (listId, encodedKey) {
    var key = decodeURIComponent(encodedKey);
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === listId; });
    if (!list) return;
    list.itemKeys = (list.itemKeys || []).filter(function (entry) { return entry !== key; });
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    renderManager();
    setTimeout(function () { window.toggleManagedList(listId); }, 0);
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.addSelectedItemsToManagedList = function (listId) {
    var selectedKeys = getSelectedItemKeys();
    if (!selectedKeys.length) {
      showListToast("먼저 매물카드에서 추가할 매물을 체크해주세요.", "warning");
      return;
    }

    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === listId; });
    if (!list) return;

    var keys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
    var added = 0;
    var duplicated = 0;
    selectedKeys.forEach(function (key) {
      if (keys.indexOf(key) === -1) {
        keys.push(key);
        added += 1;
      } else {
        duplicated += 1;
      }
    });

    list.itemKeys = keys;
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    renderManager();
    if (typeof window.applyFilter === "function") window.applyFilter();

    var message = '"' + list.name + '"에 ' + added + '개를 추가했습니다.';
    if (duplicated) message += ' · 중복 ' + duplicated + '개 제외';
    showListToast(message, added ? "success" : "info");
  };

  window.showFavoriteListOnMap = function (listId) {
    var list = loadLists("favorite").find(function (entry) { return entry.id === listId; });
    if (!list) return;
    window.favoriteKeys = (list.itemKeys || []).slice();
    localStorage.setItem("favoriteKeys", JSON.stringify(window.favoriteKeys));
    window.favoriteOnly = true;
    var button = document.getElementById("favoriteBtn");
    if (button) button.classList.add("on");
    closeListManager();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.openItemListPicker = function (type, encodedKey) {
    ensureModal();
    currentManagerType = type === "visit" ? "visit" : "favorite";
    currentItemKey = decodeURIComponent(encodedKey);
    renderPicker();
    openModal("itemListPickerModal");
  };

  window.openItemListDestinationPicker = function (encodedKey) {
    ensureModal();
    currentItemKey = decodeURIComponent(encodedKey);
    var item = getItem(currentItemKey);
    document.getElementById("lmPickerTitle").textContent = "찜·임장 추가";
    document.getElementById("lmPickerSubtitle").textContent = item
      ? (item.address || item.name || "선택 매물")
      : "선택 매물";
    document.getElementById("lmPickerBody").innerHTML =
      '<div class="lm-destination-grid">' +
        '<button class="lm-destination favorite" type="button" onclick="selectItemListDestination(\'favorite\')">' +
          '<strong>찜목록</strong><span>관심 매물로 분류</span>' +
        '</button>' +
        '<button class="lm-destination visit" type="button" onclick="selectItemListDestination(\'visit\')">' +
          '<strong>임장목록</strong><span>현장 확인 매물로 분류</span>' +
        '</button>' +
      '</div>';
    document.getElementById("lmPickerFooter").style.display = "none";
    openModal("itemListPickerModal");
  };

  window.selectItemListDestination = function (type) {
    currentManagerType = type === "visit" ? "visit" : "favorite";
    renderPicker();
  };

  function renderPicker() {
    var item = getItem(currentItemKey);
    var lists = loadLists(currentManagerType);
    var label = typeLabel(currentManagerType);
    document.getElementById("lmPickerFooter").style.display = "flex";
    document.getElementById("lmPickerTitle").textContent = label + "추가";
    document.getElementById("lmPickerSubtitle").textContent = item ? (item.address || item.name || "선택 매물") : "선택 매물";
    var html = '<div class="lm-new-inline-form">' +
      '<input id="lmNewPickerListName" type="text" maxlength="30" placeholder="새 ' + label + '목록 이름" ' +
        'onkeydown="if(event.key===\'Enter\'){event.preventDefault();createPickerList();}">' +
      '<button class="lm-new-inline" type="button" onclick="createPickerList()">목록 만들고 매물 추가</button>' +
    '</div>';
    if (!lists.length) {
      html += '<div class="lm-empty">목록을 먼저 만들어주세요.</div>';
    } else {
      html += '<div class="lm-check-list">';
      lists.forEach(function (list) {
        var checked = (list.itemKeys || []).indexOf(currentItemKey) !== -1;
        html += '<label class="lm-check-row"><input type="checkbox" data-list-id="' + list.id + '" ' +
          (checked ? 'checked' : '') + ' onchange="togglePickerListItem(this)"><span>' +
          escapeHtml(list.name) + '</span><strong>' + (list.itemKeys || []).length + '개</strong></label>';
      });
      html += '</div>';
    }
    document.getElementById("lmPickerBody").innerHTML = html;
  }

  window.createPickerList = function () {
    var itemKey = currentItemKey;
    var nameInput = document.getElementById("lmNewPickerListName");
    var list = createList(currentManagerType, itemKey, nameInput && nameInput.value);
    if (!list) return;
    showListToast('"' + list.name + '" 목록을 만들고 매물을 추가했습니다.', "success");
    window.closeItemListPicker();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.togglePickerListItem = function (input) {
    if (!input) return;
    var listId = input.getAttribute("data-list-id");
    var lists = loadLists(currentManagerType);
    var list = lists.find(function (entry) { return entry.id === listId; });
    if (!list || !currentItemKey) return;
    var keys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
    var has = keys.indexOf(currentItemKey) !== -1;
    if (input.checked && !has) keys.push(currentItemKey);
    if (!input.checked && has) keys = keys.filter(function (key) { return key !== currentItemKey; });
    if (input.checked === has) return;
    list.itemKeys = keys;
    list.updatedAt = nowIso();
    saveLists(currentManagerType, lists);
    showListToast('"' + list.name + '" 목록에 ' +
      (input.checked ? "매물을 추가했습니다." : "매물을 제외했습니다."), "success");
    renderPicker();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.applyItemListSelection = function () {
    var lists = loadLists(currentManagerType);
    var checkedById = {};
    document.querySelectorAll("#lmPickerBody input[data-list-id]").forEach(function (input) {
      checkedById[input.getAttribute("data-list-id")] = input.checked;
    });
    var changed = 0;
    lists.forEach(function (list) {
      var keys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
      var has = keys.indexOf(currentItemKey) !== -1;
      var shouldHave = !!checkedById[list.id];
      if (shouldHave && !has) keys.push(currentItemKey);
      if (!shouldHave && has) keys = keys.filter(function (key) { return key !== currentItemKey; });
      if (shouldHave === has) return;
      list.itemKeys = keys;
      list.updatedAt = nowIso();
      changed += 1;
    });
    if (changed) saveLists(currentManagerType, lists);
    showListToast(changed ? "목록 저장을 완료했습니다." : "변경된 목록이 없습니다.", changed ? "success" : "info");
    closeItemListPicker();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.closeItemListPicker = function () {
    currentItemKey = "";
    var footer = document.getElementById("lmPickerFooter");
    if (footer) footer.style.display = "flex";
    closeModal("itemListPickerModal");
  };

  window.startAiVisitPreview = function () {
    if (window.JSAiVisitV6 && typeof window.JSAiVisitV6.openLauncher === "function") {
      window.JSAiVisitV6.openLauncher();
      return;
    }
    alert("AI임장 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
  };

  window.startAiVisitFromManagedList = function (listId) {
    if (window.JSAiVisitV6 && typeof window.JSAiVisitV6.openConfirmForList === "function") {
      window.JSAiVisitV6.openConfirmForList(listId);
      return;
    }
    alert("AI임장 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.");
  };

  window.JSV6ListStore = {
    load: function (type) { return loadLists(type === "visit" ? "visit" : "favorite"); },
    save: function (type, lists) { return saveLists(type === "visit" ? "visit" : "favorite", lists); },
    remove: function (type, id, lists) {
      type = type === "visit" ? "visit" : "favorite";
      markDeletedListId(type, id);
      return saveLists(type, lists);
    },
    getItem: getItem
  };


  function isMobileLayout() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
  }

  function closeDesktopMenus() {
    document.querySelectorAll(".v6-command-menu.open").forEach(function (menu) {
      menu.classList.remove("open");
      var trigger = menu.querySelector(".v6-command-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function closeDesktopSort() {
    var dropdown = document.getElementById("sortDropdown");
    var button = document.getElementById("sortDropdownBtn");
    if (dropdown) dropdown.classList.remove("open");
    if (button) button.setAttribute("aria-expanded", "false");
  }

  function ensureMobileSheet() {
    var root = document.getElementById("v6MobileMenuPortal");
    if (root) return root;
    root = document.createElement("div");
    root.id = "v6MobileMenuPortal";
    root.className = "v6-mobile-menu-portal";
    root.innerHTML =
      '<div class="v6-mobile-menu-dim" data-v6-close></div>' +
      '<section class="v6-mobile-menu-sheet" role="dialog" aria-modal="true">' +
        '<div class="v6-mobile-menu-handle"></div>' +
        '<div class="v6-mobile-menu-head"><strong id="v6MobileMenuTitle"></strong><button type="button" class="v6-mobile-menu-close" data-v6-close>×</button></div>' +
        '<div id="v6MobileMenuBody" class="v6-mobile-menu-body"></div>' +
      '</section>';
    root.addEventListener("click", function (event) {
      if (event.target.closest("[data-v6-close]")) closeMobileSheet();
    });
    document.body.appendChild(root);
    return root;
  }

  function closeMobileSheet() {
    var root = document.getElementById("v6MobileMenuPortal");
    if (root) {
      root.classList.remove("open");
      root.removeAttribute("data-menu-type");
    }
    document.body.classList.remove("v6-mobile-sheet-open");
  }

  function openMobileSheet(title, source, type) {
    var root = ensureMobileSheet();
    if (root.classList.contains("open") && root.getAttribute("data-menu-type") === type) {
      closeMobileSheet();
      return;
    }
    closeDetailPopup();
    closeDesktopMenus();
    closeDesktopSort();
    var body = root.querySelector("#v6MobileMenuBody");
    root.querySelector("#v6MobileMenuTitle").textContent = title;
    body.innerHTML = "";
    Array.prototype.forEach.call(source ? source.children : [], function (child) {
      if (child.classList && child.classList.contains("v6-command-divider")) {
        var divider = document.createElement("div");
        divider.className = "v6-mobile-menu-divider";
        body.appendChild(divider);
        return;
      }
      if (type === "sort" && child.classList && child.classList.contains("sort-menu-row")) {
        var sortRow = child.cloneNode(true);
        sortRow.classList.add("v6-mobile-sort-row");
        Array.prototype.forEach.call(sortRow.querySelectorAll("button"), function (sortButton) {
          sortButton.classList.add("v6-mobile-sort-choice");
          sortButton.addEventListener("click", function () { window.setTimeout(closeMobileSheet, 0); });
        });
        body.appendChild(sortRow);
        return;
      }
      if (child.tagName !== "BUTTON") return;
      var clone = child.cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.add("v6-mobile-menu-item");
      clone.style.display = "block";
      clone.addEventListener("click", function () { window.setTimeout(closeMobileSheet, 0); });
      body.appendChild(clone);
    });
    root.setAttribute("data-menu-type", type);
    root.classList.add("open");
    document.body.classList.add("v6-mobile-sheet-open");
  }

  function ensureDetailDim() {
    var dim = document.getElementById("v6DetailDim");
    if (dim) return dim;
    dim = document.createElement("div");
    dim.id = "v6DetailDim";
    dim.className = "v6-detail-dim";
    dim.addEventListener("click", closeDetailPopup);
    document.body.appendChild(dim);
    return dim;
  }

  function closeDetailPopup() {
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    var dim = document.getElementById("v6DetailDim");
    if (panel) panel.classList.remove("open");
    if (button) button.classList.remove("on");
    if (dim) dim.classList.remove("open");
  }

  var originalToggleDetail = window.toggleDetailFilter;
  window.toggleDetailFilter = function () {
    if (!isMobileLayout()) {
      closeMobileSheet();
      closeDesktopMenus();
      closeDesktopSort();
      return originalToggleDetail ? originalToggleDetail() : undefined;
    }
    closeMobileSheet();
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    if (!panel || !button) return;
    var willOpen = !panel.classList.contains("open");
    closeDetailPopup();
    if (willOpen) {
      panel.removeAttribute("style");
      panel.classList.add("open");
      button.classList.add("on");
      ensureDetailDim().classList.add("open");
    }
  };

  window.closeV6ActionMenus = function () {
    closeDesktopMenus();
    closeMobileSheet();
  };

  window.toggleV6ActionMenu = function (name, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var target = document.querySelector('.v6-command-menu[data-command-menu="' + name + '"]');
    if (!target) return;
    if (isMobileLayout()) {
      openMobileSheet(name === "view" ? "보기" : "작업", document.getElementById("v6ActionMenu_" + name), name);
      return;
    }
    closeDetailPopup();
    closeDesktopSort();
    var willOpen = !target.classList.contains("open");
    closeDesktopMenus();
    if (willOpen) {
      target.classList.add("open");
      var trigger = target.querySelector(".v6-command-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
    }
  };

  var originalToggleSort = window.toggleSortDropdown;
  window.toggleSortDropdown = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (isMobileLayout()) {
      openMobileSheet("정렬", document.getElementById("sortDropdownMenu"), "sort");
      return;
    }
    closeDetailPopup();
    closeDesktopMenus();
    if (originalToggleSort) originalToggleSort(event);
    syncSortButtonMarkup();
  };

  var originalCloseSort = window.closeSortDropdown;
  window.closeSortDropdown = function () {
    closeMobileSheet();
    if (originalCloseSort) originalCloseSort();
    else closeDesktopSort();
    syncSortButtonMarkup();
  };

  function syncSortButtonMarkup() {
    var button = document.getElementById("sortDropdownBtn");
    if (!button) return;
    var label = button.querySelector(".v6-sort-label");
    var text = label ? label.textContent : (button.textContent || "정렬").trim();
    button.innerHTML = '<span class="v6-sort-label"></span><span class="v6-filter-caret" aria-hidden="true"></span>';
    button.querySelector(".v6-sort-label").textContent = text || "정렬";
  }

  var originalSelectSort = window.selectSortOption;
  window.selectSortOption = function (value) {
    if (originalSelectSort) originalSelectSort(value);
    syncSortButtonMarkup();
    closeMobileSheet();
  };

  function updateMultiButtonVisibility() {
    var button = document.getElementById("multiClusterBtn");
    if (!button) return;
    button.classList.toggle("has-selection", getSelectedItemKeys().length > 0);
  }

  document.addEventListener("change", function (event) {
    if (event.target && event.target.matches('input[type="checkbox"]')) window.setTimeout(updateMultiButtonVisibility, 0);
  });

  document.addEventListener("click", function (event) {
    if (!isMobileLayout() && !event.target.closest(".v6-command-menu") && !event.target.closest("#sortDropdown")) {
      closeDesktopMenus();
      closeDesktopSort();
      syncSortButtonMarkup();
    }
    window.setTimeout(updateMultiButtonVisibility, 0);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    closeListManager();
    closeItemListPicker();
    closeDesktopMenus();
    closeDesktopSort();
    closeMobileSheet();
    closeDetailPopup();
  });

  window.addEventListener("resize", function () {
    closeDesktopMenus();
    closeDesktopSort();
    closeMobileSheet();
    closeDetailPopup();
  });

  window.addEventListener("online", function() {
    if (isCloudDirty("favorite")) scheduleCloudSave("favorite", loadLists("favorite"));
    if (isCloudDirty("visit")) scheduleCloudSave("visit", loadLists("visit"));
  });

  function bindMobileDetailButtonFix() {
    var button = document.getElementById("detailBtn");
    if (!button || button.dataset.v6DetailBound === "1") return;
    button.dataset.v6DetailBound = "1";
    button.addEventListener("click", function (event) {
      if (!isMobileLayout()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.toggleDetailFilter();
    }, true);

    var applyButton = document.querySelector("#detailFilter .apply-btn");
    if (applyButton && applyButton.dataset.v6DetailApplyBound !== "1") {
      applyButton.dataset.v6DetailApplyBound = "1";
      applyButton.addEventListener("click", function () {
        window.setTimeout(closeDetailPopup, 0);
      });
    }
  }

  window.setTimeout(function () {
    syncSortButtonMarkup();
    updateMultiButtonVisibility();
    bindMobileDetailButtonFix();
  }, 100);

  migrateLegacyFavorites();
  syncListsFromCloud();
  ensureModal();
})();
