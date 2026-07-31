(function() {
  "use strict";

  var state = { active: false, primaryId: "", duplicateIds: [] };
  var originalAddListItem = window.addListItem;

  function text(value) { return String(value == null ? "" : value).trim(); }
  function escape(value) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(text(value));
    return text(value).replace(/[&<>"']/g, function(char) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char];
    });
  }
  function findItem(propertyId) {
    return (window.visibleListItems || []).filter(function(item) {
      return text(item.propertyId) === text(propertyId);
    })[0] || null;
  }
  function summary(item) {
    if (!item) return "매물정보 없음";
    return [item.name, item.address, item.room, "보 " + text(item.deposit),
      "월 " + text(item.rent), "평 " + text(item.area)].filter(Boolean).join(" · ");
  }
  function refreshList() {
    if (typeof window.showList === "function") window.showList((window.visibleListItems || []).slice());
    renderBar();
  }
  function injectToolbar() {
    var toolbar = document.getElementById("listToolbar");
    if (!toolbar || document.getElementById("listingDuplicateCleanupButton")) return;
    var button = document.createElement("button");
    button.id = "listingDuplicateCleanupButton";
    button.type = "button";
    button.className = "list-toolbar-btn listing-duplicate-cleanup-button";
    button.textContent = "중복정리";
    button.onclick = function() { setActive(!state.active); };
    toolbar.appendChild(button);

    var bar = document.createElement("div");
    bar.id = "listingDuplicateCleanupBar";
    bar.className = "listing-duplicate-cleanup-bar";
    bar.hidden = true;
    toolbar.insertAdjacentElement("afterend", bar);
  }
  function setActive(active) {
    state.active = !!active;
    state.primaryId = "";
    state.duplicateIds = [];
    document.body.classList.toggle("listing-duplicate-cleanup-mode", state.active);
    var button = document.getElementById("listingDuplicateCleanupButton");
    if (button) button.classList.toggle("on", state.active);
    refreshList();
  }
  function decorate(card, item) {
    if (!card || !state.active || !text(item && item.propertyId)) return;
    var propertyId = text(item.propertyId);
    var isPrimary = state.primaryId === propertyId;
    var isDuplicate = state.duplicateIds.indexOf(propertyId) >= 0;
    card.classList.toggle("duplicate-cleanup-primary", isPrimary);
    card.classList.toggle("duplicate-cleanup-target", isDuplicate);
    var controls = document.createElement("div");
    controls.className = "listing-duplicate-card-controls";
    controls.innerHTML =
      '<label><input type="radio" name="listingDuplicatePrimary" ' +
        (isPrimary ? "checked" : "") + '><span>대표로 유지</span></label>' +
      '<label><input type="checkbox" ' + (isDuplicate ? "checked" : "") +
        (isPrimary ? " disabled" : "") + '><span>중복으로 정리</span></label>';
    var inputs = controls.querySelectorAll("input");
    inputs[0].onclick = function(event) {
      event.stopPropagation();
      state.primaryId = propertyId;
      state.duplicateIds = state.duplicateIds.filter(function(id) { return id !== propertyId; });
      refreshList();
    };
    inputs[1].onclick = function(event) {
      event.stopPropagation();
      state.duplicateIds = state.duplicateIds.filter(function(id) { return id !== propertyId; });
      if (event.currentTarget.checked && propertyId !== state.primaryId) state.duplicateIds.push(propertyId);
      refreshList();
    };
    card.insertBefore(controls, card.firstChild);
  }
  function renderBar() {
    var bar = document.getElementById("listingDuplicateCleanupBar");
    if (!bar) return;
    bar.hidden = !state.active;
    if (!state.active) return;
    bar.innerHTML =
      '<span><b>같은 매물 중복정리</b> · 대표 <strong>' +
      (state.primaryId ? "1" : "0") + '</strong>건 · 중복 <strong>' +
      state.duplicateIds.length + '</strong>건</span>' +
      '<span class="listing-duplicate-bar-actions">' +
        '<button type="button" data-action="cancel">취소</button>' +
        '<button type="button" class="execute" data-action="execute"' +
          (!state.primaryId || !state.duplicateIds.length ? " disabled" : "") +
          '>선택 중복정리</button></span>';
    bar.querySelector('[data-action="cancel"]').onclick = function() { setActive(false); };
    bar.querySelector('[data-action="execute"]').onclick = openConfirmation;
  }
  function modal() {
    var node = document.getElementById("listingDuplicateConfirmModal");
    if (node) return node;
    node = document.createElement("div");
    node.id = "listingDuplicateConfirmModal";
    node.className = "listing-duplicate-confirm-modal";
    node.hidden = true;
    node.innerHTML =
      '<div class="listing-duplicate-modal-backdrop"></div>' +
      '<section role="dialog" aria-modal="true"><header><h3>기존 중복매물 정리 확인</h3>' +
      '<button type="button" data-close>×</button></header><div data-content></div>' +
      '<footer><button type="button" data-close>취소</button>' +
      '<button type="button" class="execute" data-confirm>중복정리 실행</button></footer></section>';
    document.body.appendChild(node);
    node.querySelectorAll("[data-close], .listing-duplicate-modal-backdrop").forEach(function(button) {
      button.onclick = closeConfirmation;
    });
    node.querySelector("[data-confirm]").onclick = executeCleanup;
    return node;
  }
  function openConfirmation() {
    if (!state.primaryId || !state.duplicateIds.length) return;
    var node = modal();
    var primary = findItem(state.primaryId);
    node.querySelector("[data-content]").innerHTML =
      '<article class="primary"><b>대표매물 유지</b><p>' + escape(summary(primary)) + '</p></article>' +
      '<article class="duplicates"><b>중복통합이력으로 이동</b>' +
        state.duplicateIds.map(function(id) {
          return '<p>' + escape(summary(findItem(id))) + '</p>';
        }).join("") + '</article>' +
      '<ul><li><b>주소·층·호실·임대조건·평수가 달라도 사용자가 선택한 매물을 정리합니다.</b></li>' +
      '<li>대표매물의 임대조건은 그대로 유지됩니다.</li>' +
      '<li>중복매물의 출처·링크·연락처는 대표매물로 이전됩니다.</li>' +
      '<li><b>자동 중복검사 기준과 관계없이 사용자의 선택을 그대로 적용합니다.</b></li>' +
      '<li>이 실행은 사용자가 직접 확인한 수동 정리로 이력에 기록됩니다.</li></ul>';
    node.hidden = false;
  }
  function closeConfirmation() {
    var node = document.getElementById("listingDuplicateConfirmModal");
    if (node) node.hidden = true;
  }
  function removeDuplicatesFromCurrentView(duplicateIds) {
    var duplicateMap = {};
    (duplicateIds || []).forEach(function(id) { duplicateMap[text(id)] = true; });
    ["allItems", "currentItems", "visibleListItems"].forEach(function(name) {
      if (!Array.isArray(window[name])) return;
      window[name] = window[name].filter(function(item) {
        return !duplicateMap[text(item && item.propertyId)];
      });
    });
    if (typeof window.showList === "function") {
      window.showList((window.visibleListItems || []).slice());
    }
  }
  function executeCleanup() {
    var confirmButton = modal().querySelector("[data-confirm]");
    confirmButton.disabled = true;
    confirmButton.textContent = "정리 중…";
    fetch(window.saveApiURL, {
      method: "POST", credentials: "same-origin",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        action: "consolidateExistingMasters",
        primaryMasterId: state.primaryId,
        duplicateMasterIds: state.duplicateIds,
        manualOverride: true,
        manualOverrideReason: "사용자 선택중복 직접 정리"
      })
    }).then(function(response) { return response.json(); }).then(function(result) {
      if (!result || result.ok === false) throw new Error(result && result.message || "중복정리에 실패했습니다.");
      var removedIds = state.duplicateIds.slice();
      closeConfirmation();
      setActive(false);
      removeDuplicatesFromCurrentView(removedIds);
      if (typeof window.showQuickAddToastV636 === "function") {
        window.showQuickAddToastV636(
          numberOrZero(result.consolidated) + "건 중복정리 완료 · 목록을 최신화합니다.",
          "success"
        );
      }
      if (typeof window.refreshCustomerMatchesAfterDuplicateMergeV7186 === "function") {
        Promise.resolve(
          window.refreshCustomerMatchesAfterDuplicateMergeV7186(
            result.primaryMasterId || "",
            removedIds
          )
        ).catch(function(error) {
          console.warn("중복정리 후 고객매칭 새로고침 실패", error);
        });
      }
      setTimeout(function() {
        if (typeof window.loadSheet === "function") window.loadSheet(true);
        else window.location.reload();
      }, 0);
    }).catch(function(error) {
      window.alert(error.message || "중복정리에 실패했습니다.");
    }).finally(function() {
      confirmButton.disabled = false;
      confirmButton.textContent = "중복정리 실행";
    });
  }
  function numberOrZero(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : 0;
  }

  if (typeof originalAddListItem === "function") {
    window.addListItem = function(item, appendTarget) {
      var target = appendTarget || document.getElementById("list");
      originalAddListItem(item, appendTarget);
      decorate(target && target.lastElementChild, item);
    };
  }
  window.toggleListingDuplicateCleanup = setActive;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectToolbar);
  } else {
    injectToolbar();
  }
})();
