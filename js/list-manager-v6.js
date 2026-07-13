/* JS부동산 v6.0 STEP1 - 찜목록 / 임장목록 관리 */
(function () {
  "use strict";

  var FAVORITE_KEY = "js_favorite_lists_v6";
  var VISIT_KEY = "js_visit_lists_v6";
  var LEGACY_MIGRATION_KEY = "js_favorite_lists_v6_migrated";
  var currentManagerType = "favorite";
  var currentItemKey = "";

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
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey(type)) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("목록 불러오기 실패", error);
      return [];
    }
  }

  function saveLists(type, lists) {
    localStorage.setItem(storageKey(type), JSON.stringify(lists));
    if (type === "favorite") syncLegacyFavoriteKeys(lists);
  }

  function syncLegacyFavoriteKeys(lists) {
    var union = [];
    lists.forEach(function (list) {
      (list.itemKeys || []).forEach(function (key) {
        if (union.indexOf(key) === -1) union.push(key);
      });
    });
    window.favoriteKeys = union;
    localStorage.setItem("favoriteKeys", JSON.stringify(union));
  }

  function migrateLegacyFavorites() {
    if (localStorage.getItem(LEGACY_MIGRATION_KEY) === "1") {
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

    saveLists("favorite", lists);
    localStorage.setItem(LEGACY_MIGRATION_KEY, "1");
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
          '<div class="lm-footer"><button class="lm-primary" type="button" onclick="applyItemListSelection()">적용</button></div>' +
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

  function createList(type) {
    var name = promptListName(type, "");
    if (!name) return null;
    var lists = loadLists(type);
    if (lists.some(function (list) { return list.name === name; })) {
      alert("같은 이름의 목록이 이미 있습니다.");
      return null;
    }
    var list = {
      id: uid(type === "visit" ? "visit" : "fav"),
      name: name,
      itemKeys: [],
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
      '<button class="lm-primary" type="button" onclick="createManagedList()">+ 새 ' + label + '목록</button>' +
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
    if (createList(currentManagerType)) renderManager();
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

  function renderPicker() {
    var item = getItem(currentItemKey);
    var lists = loadLists(currentManagerType);
    var label = typeLabel(currentManagerType);
    document.getElementById("lmPickerTitle").textContent = label + "추가";
    document.getElementById("lmPickerSubtitle").textContent = item ? (item.address || item.name || "선택 매물") : "선택 매물";
    var html = '<button class="lm-new-inline" type="button" onclick="createPickerList()">+ 새 ' + label + '목록 만들기</button>';
    if (!lists.length) {
      html += '<div class="lm-empty">목록을 먼저 만들어주세요.</div>';
    } else {
      html += '<div class="lm-check-list">';
      lists.forEach(function (list) {
        var checked = (list.itemKeys || []).indexOf(currentItemKey) !== -1;
        html += '<label class="lm-check-row"><input type="checkbox" data-list-id="' + list.id + '" ' + (checked ? 'checked' : '') + '><span>' + escapeHtml(list.name) + '</span><strong>' + (list.itemKeys || []).length + '개</strong></label>';
      });
      html += '</div>';
    }
    document.getElementById("lmPickerBody").innerHTML = html;
  }

  window.createPickerList = function () {
    if (createList(currentManagerType)) renderPicker();
  };

  window.applyItemListSelection = function () {
    var lists = loadLists(currentManagerType);
    var checkedById = {};
    document.querySelectorAll("#lmPickerBody input[data-list-id]").forEach(function (input) {
      checkedById[input.getAttribute("data-list-id")] = input.checked;
    });
    lists.forEach(function (list) {
      var keys = Array.isArray(list.itemKeys) ? list.itemKeys.slice() : [];
      var has = keys.indexOf(currentItemKey) !== -1;
      var shouldHave = !!checkedById[list.id];
      if (shouldHave && !has) keys.push(currentItemKey);
      if (!shouldHave && has) keys = keys.filter(function (key) { return key !== currentItemKey; });
      list.itemKeys = keys;
      list.updatedAt = nowIso();
    });
    saveLists(currentManagerType, lists);
    closeItemListPicker();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.closeItemListPicker = function () {
    currentItemKey = "";
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
    save: function (type, lists) { saveLists(type === "visit" ? "visit" : "favorite", lists); },
    getItem: getItem
  };

  function ensureCommandBackdrop() {
    var backdrop = document.getElementById("v6CommandBackdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "v6CommandBackdrop";
      backdrop.className = "v6-command-backdrop";
      backdrop.addEventListener("click", function () {
        window.closeV6ActionMenus();
        if (typeof window.closeSortDropdown === "function") window.closeSortDropdown();
      });
      document.body.appendChild(backdrop);
    }
    return backdrop;
  }

  function syncCommandBackdrop() {
    var backdrop = ensureCommandBackdrop();
    var menuOpen = !!document.querySelector(".v6-command-menu.open");
    var sortOpen = !!document.querySelector("#sortDropdown.open");
    backdrop.classList.toggle("open", menuOpen || sortOpen);
    document.body.classList.toggle("v6-menu-open", menuOpen || sortOpen);
  }

  window.closeV6ActionMenus = function () {
    document.querySelectorAll(".v6-command-menu.open").forEach(function (menu) {
      menu.classList.remove("open");
      var trigger = menu.querySelector(".v6-command-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
    syncCommandBackdrop();
  };

  window.toggleV6ActionMenu = function (name, event) {
    if (event) event.stopPropagation();
    var target = document.querySelector('.v6-command-menu[data-command-menu="' + name + '"]');
    if (!target) return;
    var willOpen = !target.classList.contains("open");
    if (typeof window.closeSortDropdown === "function") window.closeSortDropdown();
    window.closeV6ActionMenus();
    if (willOpen) {
      target.classList.add("open");
      var trigger = target.querySelector(".v6-command-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
    }
    syncCommandBackdrop();
  };

  /* 기존 정렬 드롭다운을 모바일에서도 같은 단일 팝업 체계로 관리합니다. */
  if (typeof window.toggleSortDropdown === "function") {
    var originalToggleSort = window.toggleSortDropdown;
    window.toggleSortDropdown = function (event) {
      window.closeV6ActionMenus();
      originalToggleSort(event);
      window.setTimeout(syncCommandBackdrop, 0);
    };
  }
  if (typeof window.closeSortDropdown === "function") {
    var originalCloseSort = window.closeSortDropdown;
    window.closeSortDropdown = function () {
      originalCloseSort();
      window.setTimeout(syncCommandBackdrop, 0);
    };
  }

  function updateMultiButtonVisibility() {
    var button = document.getElementById("multiClusterBtn");
    if (!button) return;
    var count = getSelectedItemKeys().length;
    button.classList.toggle("has-selection", count > 0);
  }

  document.addEventListener("change", function (event) {
    if (event.target && event.target.matches('input[type="checkbox"]')) window.setTimeout(updateMultiButtonVisibility, 0);
  });
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".v6-command-menu") && !event.target.closest("#sortDropdown") && !event.target.closest("#v6CommandBackdrop")) {
      window.closeV6ActionMenus();
    }
    window.setTimeout(updateMultiButtonVisibility, 0);
  });
  window.setTimeout(updateMultiButtonVisibility, 300);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeListManager();
      closeItemListPicker();
      window.closeV6ActionMenus();
    }
  });

  migrateLegacyFavorites();
  ensureModal();
})();

/* =========================================================
   STEP2.6 모바일 메뉴 포털 안정화
   - 보기/작업/정렬을 body 직속 단일 바텀시트로 표시
   - 기존 stacking-context 및 투명 레이어 클릭 충돌 제거
   ========================================================= */
(function () {
  "use strict";

  function isMobileLayout() {
    return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  }

  function ensureMobileSheet() {
    var root = document.getElementById("v6MobileMenuPortal");
    if (root) return root;

    root = document.createElement("div");
    root.id = "v6MobileMenuPortal";
    root.className = "v6-mobile-menu-portal";
    root.innerHTML =
      '<div class="v6-mobile-menu-dim" data-v6-sheet-close></div>' +
      '<section class="v6-mobile-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="v6MobileMenuTitle">' +
        '<div class="v6-mobile-menu-handle" aria-hidden="true"></div>' +
        '<div class="v6-mobile-menu-head">' +
          '<strong id="v6MobileMenuTitle"></strong>' +
          '<button type="button" class="v6-mobile-menu-close" data-v6-sheet-close aria-label="닫기">×</button>' +
        '</div>' +
        '<div id="v6MobileMenuBody" class="v6-mobile-menu-body"></div>' +
      '</section>';

    root.addEventListener("click", function (event) {
      if (event.target.closest("[data-v6-sheet-close]")) closeMobileSheet();
    });
    document.body.appendChild(root);
    return root;
  }

  function closeOriginalMenus() {
    document.querySelectorAll(".v6-command-menu.open").forEach(function (menu) {
      menu.classList.remove("open");
      var trigger = menu.querySelector(".v6-command-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
    var sort = document.getElementById("sortDropdown");
    if (sort) sort.classList.remove("open");
    var sortButton = document.getElementById("sortDropdownBtn");
    if (sortButton) sortButton.setAttribute("aria-expanded", "false");
    var oldBackdrop = document.getElementById("v6CommandBackdrop");
    if (oldBackdrop) oldBackdrop.classList.remove("open");
    document.body.classList.remove("v6-menu-open");
  }

  function closeMobileSheet() {
    var root = document.getElementById("v6MobileMenuPortal");
    if (root) root.classList.remove("open");
    document.body.classList.remove("v6-mobile-sheet-open");
  }

  function cloneButtons(source, body, closeAfterClick) {
    Array.prototype.forEach.call(source.children, function (child) {
      if (child.classList && child.classList.contains("v6-command-divider")) {
        var divider = document.createElement("div");
        divider.className = "v6-mobile-menu-divider";
        body.appendChild(divider);
        return;
      }
      if (child.tagName !== "BUTTON") return;
      var clone = child.cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.add("v6-mobile-menu-item");
      clone.style.display = "flex";
      clone.addEventListener("click", function () {
        if (closeAfterClick) window.setTimeout(closeMobileSheet, 0);
      });
      body.appendChild(clone);
    });
  }

  function openMobileSheet(title, source, type) {
    if (!source) return;
    closeOriginalMenus();
    var root = ensureMobileSheet();
    var body = root.querySelector("#v6MobileMenuBody");
    var heading = root.querySelector("#v6MobileMenuTitle");
    heading.textContent = title;
    body.innerHTML = "";
    cloneButtons(source, body, true);
    root.setAttribute("data-menu-type", type || "");
    root.classList.add("open");
    document.body.classList.add("v6-mobile-sheet-open");
  }

  var desktopToggleAction = window.toggleV6ActionMenu;
  window.toggleV6ActionMenu = function (name, event) {
    if (!isMobileLayout()) {
      return desktopToggleAction ? desktopToggleAction(name, event) : undefined;
    }
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var source = document.getElementById("v6ActionMenu_" + name);
    openMobileSheet(name === "view" ? "보기" : "작업", source, name);
  };

  var desktopCloseActions = window.closeV6ActionMenus;
  window.closeV6ActionMenus = function () {
    closeMobileSheet();
    closeOriginalMenus();
    if (!isMobileLayout() && desktopCloseActions) desktopCloseActions();
  };

  var desktopToggleSort = window.toggleSortDropdown;
  window.toggleSortDropdown = function (event) {
    if (!isMobileLayout()) {
      return desktopToggleSort ? desktopToggleSort(event) : undefined;
    }
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    openMobileSheet("정렬", document.getElementById("sortDropdownMenu"), "sort");
  };

  var desktopCloseSort = window.closeSortDropdown;
  window.closeSortDropdown = function () {
    closeMobileSheet();
    closeOriginalMenus();
    if (!isMobileLayout() && desktopCloseSort) desktopCloseSort();
  };

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMobileSheet();
  });
  window.addEventListener("resize", function () {
    if (!isMobileLayout()) closeMobileSheet();
  });
})();

/* =========================================================
   v6.0 STEP2.10 상세/구분/정렬 최종 안정화
   - 모바일 상세필터를 독립 모달로 표시
   - 정렬 재클릭 닫기
   - PC/태블릿 정렬을 버튼 아래 세로 드롭다운으로 고정
   ========================================================= */
(function () {
  "use strict";

  var detailHome = null;
  var detailNext = null;

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  }

  function closeMobilePortal() {
    var portal = document.getElementById("v6MobileMenuPortal");
    if (portal) {
      portal.classList.remove("open");
      portal.removeAttribute("data-menu-type");
    }
    document.body.classList.remove("v6-mobile-sheet-open");
  }

  function ensureDetailPortal() {
    var portal = document.getElementById("v6DetailFilterPortal");
    if (portal) return portal;

    portal = document.createElement("div");
    portal.id = "v6DetailFilterPortal";
    portal.className = "v6-detail-filter-portal";
    portal.innerHTML =
      '<div class="v6-detail-filter-dim" data-detail-close></div>' +
      '<section class="v6-detail-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="v6DetailFilterTitle">' +
        '<div class="v6-detail-filter-head">' +
          '<strong id="v6DetailFilterTitle">상세필터</strong>' +
          '<button type="button" class="v6-detail-filter-close" data-detail-close aria-label="닫기">×</button>' +
        '</div>' +
        '<div id="v6DetailFilterBody" class="v6-detail-filter-body"></div>' +
      '</section>';

    portal.addEventListener("click", function (event) {
      if (event.target.closest("[data-detail-close]")) {
        window.closeV6DetailFilter();
      }
    });
    document.body.appendChild(portal);
    return portal;
  }

  function restoreDetailPanel() {
    var panel = document.getElementById("detailFilter");
    if (!panel || !detailHome || panel.parentNode === detailHome) return;
    if (detailNext && detailNext.parentNode === detailHome) {
      detailHome.insertBefore(panel, detailNext);
    } else {
      detailHome.appendChild(panel);
    }
  }

  window.closeV6DetailFilter = function () {
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    var portal = document.getElementById("v6DetailFilterPortal");

    if (panel) panel.classList.remove("open");
    if (button) {
      button.classList.remove("on");
      button.setAttribute("aria-expanded", "false");
    }
    if (portal) portal.classList.remove("open");
    document.body.classList.remove("v6-detail-filter-open");
    restoreDetailPanel();
  };

  var originalToggleDetail = window.toggleDetailFilter;
  window.toggleDetailFilter = function () {
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    if (!panel || !button) return;

    if (!isMobile()) {
      closeMobilePortal();
      if (typeof window.closeV6ActionMenus === "function") window.closeV6ActionMenus();
      if (typeof window.closeSortDropdown === "function") window.closeSortDropdown();
      if (originalToggleDetail) originalToggleDetail();
      button.setAttribute("aria-expanded", panel.classList.contains("open") ? "true" : "false");
      return;
    }

    var portal = ensureDetailPortal();
    var alreadyOpen = portal.classList.contains("open");
    if (alreadyOpen) {
      window.closeV6DetailFilter();
      return;
    }

    closeMobilePortal();
    if (typeof window.closeV6ActionMenus === "function") window.closeV6ActionMenus();
    if (typeof window.closeSortDropdown === "function") window.closeSortDropdown();

    if (!detailHome) {
      detailHome = panel.parentNode;
      detailNext = panel.nextSibling;
    }

    portal.querySelector("#v6DetailFilterBody").appendChild(panel);
    panel.removeAttribute("style");
    panel.classList.add("open");
    button.classList.add("on");
    button.setAttribute("aria-expanded", "true");
    portal.classList.add("open");
    document.body.classList.add("v6-detail-filter-open");
  };

  /* 필터 적용 뒤 모바일 상세창 자동 닫기 */
  document.addEventListener("click", function (event) {
    if (event.target && event.target.closest("#detailFilter .apply-btn") && isMobile()) {
      window.setTimeout(window.closeV6DetailFilter, 0);
    }
  });

  var previousToggleSort = window.toggleSortDropdown;
  window.toggleSortDropdown = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    window.closeV6DetailFilter();

    if (isMobile()) {
      var portal = document.getElementById("v6MobileMenuPortal");
      if (portal && portal.classList.contains("open") && portal.getAttribute("data-menu-type") === "sort") {
        closeMobilePortal();
        return;
      }
      if (previousToggleSort) previousToggleSort(event);
      return;
    }

    if (typeof window.closeV6ActionMenus === "function") window.closeV6ActionMenus();
    var dropdown = document.getElementById("sortDropdown");
    var button = document.getElementById("sortDropdownBtn");
    if (!dropdown || !button) return;
    var willOpen = !dropdown.classList.contains("open");
    dropdown.classList.toggle("open", willOpen);
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
  };

  var previousToggleAction = window.toggleV6ActionMenu;
  window.toggleV6ActionMenu = function (name, event) {
    window.closeV6DetailFilter();
    if (previousToggleAction) return previousToggleAction(name, event);
  };

  document.addEventListener("click", function (event) {
    if (!isMobile()) return;
    var panel = document.getElementById("detailFilter");
    var portal = document.getElementById("v6DetailFilterPortal");
    if (!panel || !portal || !portal.classList.contains("open")) return;
    if (!event.target.closest(".v6-detail-filter-sheet") && !event.target.closest("#detailBtn")) {
      window.closeV6DetailFilter();
    }
  });

  window.addEventListener("resize", function () {
    if (!isMobile()) window.closeV6DetailFilter();
  });

  var detailButton = document.getElementById("detailBtn");
  if (detailButton) detailButton.setAttribute("aria-expanded", "false");
})();
