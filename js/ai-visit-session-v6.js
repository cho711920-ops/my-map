/* JS부동산 v6.0 STEP2 - AI임장 시작 / 진행 세션 */
(function () {
  "use strict";

  var SESSION_KEY = "js_ai_visit_session_v6";
  var activeSession = null;
  var focusMarker = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getVisitLists() {
    if (window.JSV6ListStore && typeof window.JSV6ListStore.load === "function") {
      return window.JSV6ListStore.load("visit");
    }
    try {
      var parsed = JSON.parse(localStorage.getItem("js_visit_lists_v6") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function getItem(key) {
    if (window.JSV6ListStore && typeof window.JSV6ListStore.getItem === "function") {
      return window.JSV6ListStore.getItem(key);
    }
    if (!Array.isArray(window.allItems)) return null;
    return window.allItems.find(function (item) { return item.key === key; }) || null;
  }

  function getValidItems(list) {
    return (list.itemKeys || []).map(getItem).filter(Boolean);
  }

  function ensureUi() {
    if (document.getElementById("aiVisitLauncherModal")) return;

    var host = document.createElement("div");
    host.innerHTML =
      '<div id="aiVisitLauncherModal" class="aiv-modal" aria-hidden="true">' +
        '<div class="aiv-backdrop" onclick="JSAiVisitV6.closeLauncher()"></div>' +
        '<section class="aiv-launcher" role="dialog" aria-modal="true" aria-labelledby="aivLauncherTitle">' +
          '<header class="aiv-modal-header">' +
            '<div><div id="aivLauncherTitle" class="aiv-modal-title">AI임장 시작</div><div class="aiv-modal-subtitle">방문할 임장목록을 선택하세요.</div></div>' +
            '<button type="button" class="aiv-icon-close" onclick="JSAiVisitV6.closeLauncher()" aria-label="닫기">×</button>' +
          '</header>' +
          '<div id="aivLauncherBody" class="aiv-launcher-body"></div>' +
        '</section>' +
      '</div>' +

      '<div id="aiVisitConfirmModal" class="aiv-modal" aria-hidden="true">' +
        '<div class="aiv-backdrop" onclick="JSAiVisitV6.closeConfirm()"></div>' +
        '<section class="aiv-confirm" role="dialog" aria-modal="true" aria-labelledby="aivConfirmTitle">' +
          '<header class="aiv-modal-header">' +
            '<div><div id="aivConfirmTitle" class="aiv-modal-title">AI임장 시작 확인</div></div>' +
            '<button type="button" class="aiv-icon-close" onclick="JSAiVisitV6.closeConfirm()" aria-label="닫기">×</button>' +
          '</header>' +
          '<div id="aivConfirmBody" class="aiv-confirm-body"></div>' +
          '<footer class="aiv-confirm-footer">' +
            '<button type="button" class="aiv-btn secondary" onclick="JSAiVisitV6.closeConfirm()">취소</button>' +
            '<button id="aivConfirmStartBtn" type="button" class="aiv-btn primary">시작하기</button>' +
          '</footer>' +
        '</section>' +
      '</div>' +

      '<section id="aiVisitWorkspace" class="aiv-workspace" aria-hidden="true">' +
        '<header class="aiv-workspace-header">' +
          '<div class="aiv-heading-wrap">' +
            '<div class="aiv-brand-mark">AI</div>' +
            '<div><div id="aivWorkspaceTitle" class="aiv-workspace-title">AI임장</div><div id="aivWorkspaceProgress" class="aiv-workspace-progress"></div></div>' +
          '</div>' +
          '<button type="button" class="aiv-exit-btn" onclick="JSAiVisitV6.requestExit()">종료</button>' +
        '</header>' +
        '<div class="aiv-workspace-main">' +
          '<main class="aiv-current-panel">' +
            '<div class="aiv-section-kicker">현재 방문 매물</div>' +
            '<div id="aivCurrentCard" class="aiv-current-card"></div>' +
          '</main>' +
          '<aside class="aiv-route-panel">' +
            '<div class="aiv-route-head"><strong>방문 예정 목록</strong><span id="aivRouteCount"></span></div>' +
            '<div id="aivRouteList" class="aiv-route-list"></div>' +
          '</aside>' +
        '</div>' +
      '</section>';

    while (host.firstChild) document.body.appendChild(host.firstChild);
  }

  function openModal(id) {
    ensureUi();
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("aiv-modal-open");
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".aiv-modal.open")) document.body.classList.remove("aiv-modal-open");
  }

  function renderLauncher() {
    var body = document.getElementById("aivLauncherBody");
    if (!body) return;
    var lists = getVisitLists();

    if (!lists.length) {
      body.innerHTML = '<div class="aiv-empty"><strong>임장목록이 없습니다.</strong><span>먼저 보기 → 임장목록에서 목록을 만들어주세요.</span></div>';
      return;
    }

    body.innerHTML = '<div class="aiv-list-select">' + lists.map(function (list) {
      var count = getValidItems(list).length;
      return '<button type="button" class="aiv-list-option ' + (count ? '' : 'empty') + '" onclick="JSAiVisitV6.openConfirmForList(\'' + list.id + '\')">' +
        '<span class="aiv-list-option-main"><strong>' + escapeHtml(list.name) + '</strong><small>' + (count ? '등록된 매물로 AI임장을 시작합니다.' : '등록된 매물이 없습니다.') + '</small></span>' +
        '<span class="aiv-list-count">' + count + '개</span>' +
      '</button>';
    }).join("") + '</div>';
  }

  function openLauncher() {
    ensureUi();
    renderLauncher();
    openModal("aiVisitLauncherModal");
  }

  function openConfirmForList(listId) {
    ensureUi();
    var list = getVisitLists().find(function (entry) { return entry.id === listId; });
    if (!list) {
      alert("임장목록을 찾지 못했습니다.");
      return;
    }

    var items = getValidItems(list);
    if (!items.length) {
      alert("이 임장목록에는 등록된 매물이 없습니다.");
      return;
    }

    closeModal("aiVisitLauncherModal");
    document.getElementById("aivConfirmBody").innerHTML =
      '<div class="aiv-confirm-name">' + escapeHtml(list.name) + '</div>' +
      '<div class="aiv-confirm-count">총 <strong>' + items.length + '개</strong> 매물</div>' +
      '<p>이번 단계에서는 목록에 등록된 순서대로 진행됩니다.<br>현재 위치 기반 최적 동선은 다음 단계에서 연결됩니다.</p>';

    var startButton = document.getElementById("aivConfirmStartBtn");
    startButton.onclick = function () { startSession(list); };
    openModal("aiVisitConfirmModal");
  }

  function saveSession() {
    if (!activeSession) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(activeSession));
    } catch (error) {
      console.error("AI임장 세션 저장 실패", error);
    }
  }

  function loadStoredSession() {
    try {
      var parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return parsed && parsed.active ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function startSession(list) {
    var keys = getValidItems(list).map(function (item) { return item.key; });
    activeSession = {
      active: true,
      listId: list.id,
      listName: list.name,
      itemKeys: keys,
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveSession();
    closeModal("aiVisitConfirmModal");
    openWorkspace();
  }

  function openWorkspace() {
    ensureUi();
    if (!activeSession || !activeSession.itemKeys.length) return;
    var workspace = document.getElementById("aiVisitWorkspace");
    workspace.classList.add("open");
    workspace.setAttribute("aria-hidden", "false");
    document.body.classList.add("aiv-workspace-open");
    renderWorkspace();
  }

  function validSessionItems() {
    if (!activeSession) return [];
    return activeSession.itemKeys.map(getItem).filter(Boolean);
  }

  function moneyLabel(label, value) {
    if (value == null || value === "" || value === "0" || value === 0) return "";
    return '<span><em>' + escapeHtml(label) + '</em><strong>' + escapeHtml(value) + '</strong></span>';
  }

  function fieldLine(label, value) {
    if (value == null || value === "") return "";
    return '<div class="aiv-detail-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function renderCurrentCard(item, index, total) {
    var priceBits = [
      moneyLabel("보증금", item.deposit),
      moneyLabel("월세", item.rent),
      moneyLabel("관리비", item.fee),
      moneyLabel("권리금", item.premium)
    ].filter(Boolean).join("");

    var meta = [item.type, item.room].filter(Boolean).map(function (value) {
      return '<span>' + escapeHtml(value) + '</span>';
    }).join("");

    return '<div class="aiv-current-index">' + (index + 1) + '<small>/ ' + total + '</small></div>' +
      '<div class="aiv-current-top">' +
        '<div>' +
          '<div class="aiv-current-meta">' + meta + '</div>' +
          '<h2>' + escapeHtml(item.name || item.address || "매물") + '</h2>' +
          '<div class="aiv-current-address">' + escapeHtml(item.address || "주소 없음") + '</div>' +
        '</div>' +
      '</div>' +
      (priceBits ? '<div class="aiv-price-grid">' + priceBits + '</div>' : '') +
      '<div class="aiv-detail-grid">' +
        fieldLine("평수", item.area || item.pyeong) +
        fieldLine("임대인", item.landlordPhone) +
        fieldLine("세입자", item.tenantPhone) +
        fieldLine("등록일", item.regDate) +
      '</div>' +
      '<div id="aivMemoBox" class="aiv-memo-box"><div class="aiv-memo-title">메모</div><div class="aiv-memo-text">' + escapeHtml(item.memo || "메모가 없습니다.") + '</div></div>' +
      '<div class="aiv-primary-actions">' +
        '<button type="button" onclick="JSAiVisitV6.openNavigation()">내비</button>' +
        '<button type="button" onclick="JSAiVisitV6.openRoadview()">로드뷰</button>' +
        '<button type="button" onclick="JSAiVisitV6.toggleMemo()">메모</button>' +
      '</div>' +
      '<div class="aiv-step-actions">' +
        '<button type="button" ' + (index === 0 ? 'disabled' : '') + ' onclick="JSAiVisitV6.goPrevious()">이전</button>' +
        '<button type="button" ' + (index >= total - 1 ? 'disabled' : '') + ' onclick="JSAiVisitV6.goNext()">다음</button>' +
      '</div>';
  }

  function renderWorkspace() {
    var items = validSessionItems();
    if (!items.length) {
      closeWorkspace(false);
      alert("AI임장에 표시할 매물을 찾지 못했습니다.");
      return;
    }

    if (activeSession.currentIndex >= items.length) activeSession.currentIndex = items.length - 1;
    if (activeSession.currentIndex < 0) activeSession.currentIndex = 0;
    activeSession.itemKeys = items.map(function (item) { return item.key; });
    activeSession.updatedAt = new Date().toISOString();
    saveSession();

    var current = items[activeSession.currentIndex];
    document.getElementById("aivWorkspaceTitle").textContent = "AI임장 · " + activeSession.listName;
    document.getElementById("aivWorkspaceProgress").textContent = (activeSession.currentIndex + 1) + " / " + items.length + " 진행 중";
    document.getElementById("aivRouteCount").textContent = items.length + "개";
    document.getElementById("aivCurrentCard").innerHTML = renderCurrentCard(current, activeSession.currentIndex, items.length);
    document.getElementById("aivRouteList").innerHTML = items.map(function (item, index) {
      return '<button type="button" class="aiv-route-item ' + (index === activeSession.currentIndex ? 'active' : '') + '" onclick="JSAiVisitV6.goTo(' + index + ')">' +
        '<span class="aiv-route-number">' + (index + 1) + '</span>' +
        '<span class="aiv-route-copy"><strong>' + escapeHtml(item.name || item.address || "매물") + '</strong><small>' + escapeHtml(item.address || "") + '</small></span>' +
      '</button>';
    }).join("");

    focusCurrentOnMap(current);
  }

  function focusCurrentOnMap(item) {
    if (!item || !window.map || !window.kakao || !kakao.maps) return;
    var coords = typeof window.getItemCoordinates === "function" ? window.getItemCoordinates(item) : null;
    if (!coords || !isFinite(coords.lat) || !isFinite(coords.lng)) return;

    var position = new kakao.maps.LatLng(coords.lat, coords.lng);
    try {
      window.map.panTo(position);
      if (focusMarker) focusMarker.setMap(null);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path fill="#2563eb" stroke="#fff" stroke-width="3" d="M17 1.5C8.4 1.5 1.5 8.4 1.5 17c0 12 15.5 23.5 15.5 23.5S32.5 29 32.5 17C32.5 8.4 25.6 1.5 17 1.5z"/><circle cx="17" cy="17" r="6" fill="#fff"/></svg>';
      var image = new kakao.maps.MarkerImage(
        'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        new kakao.maps.Size(34, 42),
        { offset: new kakao.maps.Point(17, 42) }
      );
      focusMarker = new kakao.maps.Marker({ position: position, image: image, zIndex: 9999 });
      focusMarker.setMap(window.map);
    } catch (error) {
      console.error("현재 매물 지도 강조 실패", error);
    }
  }

  function currentItem() {
    var items = validSessionItems();
    return items[activeSession ? activeSession.currentIndex : 0] || null;
  }

  function encodedCurrentKey() {
    var item = currentItem();
    return item ? encodeURIComponent(item.key) : "";
  }

  function openNavigation() {
    var encoded = encodedCurrentKey();
    if (!encoded || typeof window.openKakaoNavigation !== "function") return alert("내비 기능을 불러오지 못했습니다.");
    window.openKakaoNavigation(encoded);
  }

  function openRoadview() {
    var encoded = encodedCurrentKey();
    if (!encoded || typeof window.openKakaoRoadview !== "function") return alert("로드뷰 기능을 불러오지 못했습니다.");
    window.openKakaoRoadview(encoded);
  }

  function toggleMemo() {
    var box = document.getElementById("aivMemoBox");
    if (box) box.classList.toggle("open");
  }

  function goTo(index) {
    if (!activeSession) return;
    var items = validSessionItems();
    if (index < 0 || index >= items.length) return;
    activeSession.currentIndex = index;
    renderWorkspace();
  }

  function requestExit() {
    if (!activeSession) return closeWorkspace(false);
    var ok = confirm("AI임장을 종료하시겠습니까?\n현재 순서는 이 기기에 저장되어 다시 이어갈 수 있습니다.");
    if (!ok) return;
    closeWorkspace(true);
  }

  function closeWorkspace(keepSession) {
    var workspace = document.getElementById("aiVisitWorkspace");
    if (workspace) {
      workspace.classList.remove("open");
      workspace.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("aiv-workspace-open");
    if (focusMarker) {
      focusMarker.setMap(null);
      focusMarker = null;
    }
    if (!keepSession) {
      activeSession = null;
      localStorage.removeItem(SESSION_KEY);
    }
  }

  function offerResume() {
    var stored = loadStoredSession();
    if (!stored) return;
    var listStillExists = getVisitLists().some(function (list) { return list.id === stored.listId; });
    if (!listStillExists || !stored.itemKeys || !stored.itemKeys.length) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    activeSession = stored;
    window.setTimeout(function () {
      if (confirm('진행 중인 AI임장이 있습니다.\n"' + stored.listName + '" ' + (stored.currentIndex + 1) + '번째 매물부터 이어갈까요?')) {
        openWorkspace();
      }
    }, 700);
  }

  window.JSAiVisitV6 = {
    openLauncher: openLauncher,
    closeLauncher: function () { closeModal("aiVisitLauncherModal"); },
    openConfirmForList: openConfirmForList,
    closeConfirm: function () { closeModal("aiVisitConfirmModal"); },
    openNavigation: openNavigation,
    openRoadview: openRoadview,
    toggleMemo: toggleMemo,
    goPrevious: function () { if (activeSession) goTo(activeSession.currentIndex - 1); },
    goNext: function () { if (activeSession) goTo(activeSession.currentIndex + 1); },
    goTo: goTo,
    requestExit: requestExit
  };

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (document.getElementById("aiVisitWorkspace") && document.getElementById("aiVisitWorkspace").classList.contains("open")) {
        requestExit();
      } else {
        closeModal("aiVisitLauncherModal");
        closeModal("aiVisitConfirmModal");
      }
    }
  });

  ensureUi();
  offerResume();
})();
