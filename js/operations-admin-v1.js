(function (global) {
  "use strict";

  var API = "/api/data";
  var previousSwitch = global.switchOperationsTab;
  var state = { profile: null, history: [], nextCursor: 0, users: [], loading: false };

  function text(value) { return String(value == null ? "" : value).trim(); }
  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, function (character) {
      return {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character];
    });
  }
  function apiGet(action, params) {
    var query = new URLSearchParams(Object.assign({ action: action, _: Date.now() }, params || {}));
    return fetch(API + "?" + query.toString(), { credentials: "same-origin", cache: "no-store" })
      .then(parseResponse);
  }
  function apiPost(action, payload) {
    return fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(parseResponse);
  }
  function parseResponse(response) {
    return response.json().catch(function () { return {}; }).then(function (result) {
      if (!response.ok || !result || result.ok === false) {
        throw new Error(result && result.message || "요청을 처리하지 못했습니다.");
      }
      return result;
    });
  }
  function formatAt(value) {
    var date = new Date(value);
    if (!value || isNaN(date.getTime())) return text(value) || "-";
    return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function actionLabel(value) {
    return ({
      updateProperty: "임대조건·매물정보 수정",
      updatePropertyMemo: "메모·연락처 수정",
      toggleDone: "계약상태 변경",
      deleteProperty: "매물 삭제",
      quickAdd: "빠른등록",
      moveOriginalListing: "원본매물 이동",
      consolidateExistingMasters: "중복매물 통합",
      restoreListingHistory: "이전 값 복구"
    })[text(value)] || text(value) || "변경";
  }
  function fieldLabel(value) {
    return ({
      title: "매물명", building_name: "건물명", room: "호실", deposit: "보증금",
      monthly_rent: "월세", maintenance_fee: "관리비", premium: "권리금", area_m2: "면적",
      landlord_phone: "임대인 연락처", tenant_phone: "임차인 연락처",
      operating_memo: "메모", contacts_json: "연락처 목록", status: "상태"
    })[text(value)] || text(value);
  }
  function shortValue(value) {
    if (Array.isArray(value)) {
      value = value.map(function (entry) {
        if (!entry || typeof entry !== "object") return text(entry);
        return [text(entry.role), text(entry.phone)].filter(Boolean).join(" ");
      }).filter(Boolean).join(" · ");
    } else if (value && typeof value === "object") {
      value = JSON.stringify(value);
    }
    var result = text(value);
    return result.length > 70 ? result.slice(0, 67) + "…" : result || "없음";
  }
  function setMessage(message, tone) {
    var node = document.getElementById("operationsCenterMessage");
    if (!node) return;
    node.textContent = message || "";
    node.className = "operations-center-message" + (tone ? " " + tone : "");
  }

  function renderHistory() {
    var panel = document.getElementById("operationsHistoryPanel");
    if (!panel) return;
    var canRestore = state.profile && state.profile.canManageUsers;
    panel.innerHTML = '<section class="operations-admin-toolbar"><div><strong>매물 변경이력</strong>' +
      '<span>누가 언제 어떤 값을 바꿨는지 확인합니다.</span></div>' +
      '<button type="button" onclick="refreshListingHistoryV1()">새로고침</button></section>' +
      '<div class="operations-history-list-v1">' +
      (state.history.length ? state.history.map(function (item) {
        var title = text(item.title) || text(item.propertyId) || "매물";
        var location = [item.address, item.room].map(text).filter(Boolean).join(" · ");
        var changes = (item.changes || []).slice(0, 8).map(function (change) {
          return '<li><b>' + escapeHtml(fieldLabel(change.field)) + '</b><span>' +
            escapeHtml(shortValue(change.before)) + '</span><i>→</i><em>' +
            escapeHtml(shortValue(change.after)) + '</em></li>';
        }).join("");
        return '<article class="operations-history-card-v1"><header><div><strong>' + escapeHtml(title) +
          '</strong><span>' + escapeHtml(location) + '</span></div><time>' + escapeHtml(formatAt(item.createdAt)) +
          '</time></header><div class="operations-history-meta-v1"><b>' + escapeHtml(actionLabel(item.changeAction)) +
          '</b><span>' + escapeHtml(item.actorEmail || "시스템") + '</span></div>' +
          (changes ? '<ul>' + changes + '</ul>' : '<p>세부 값이 없는 시스템 처리 기록입니다.</p>') +
          (canRestore && item.restorable ? '<footer><button type="button" onclick="restoreListingHistoryV1(' +
            Number(item.id || 0) + ')">이 값으로 복구</button></footer>' : '') + '</article>';
      }).join("") : '<div class="operations-admin-empty-v1">저장된 변경이력이 없습니다.</div>') +
      '</div>' + (state.nextCursor ? '<button class="operations-admin-more-v1" type="button" onclick="loadMoreListingHistoryV1()">이전 기록 더 보기</button>' : '');
  }

  function loadHistory(reset) {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    if (reset) { state.history = []; state.nextCursor = 0; }
    setMessage("변경이력을 불러오는 중입니다.", "loading");
    return apiGet("listingHistory", { cursor: state.nextCursor || 0, limit: 60 }).then(function (result) {
      state.history = state.history.concat(result.items || []);
      state.nextCursor = Number(result.nextCursor || 0);
      renderHistory();
      setMessage("변경이력을 최신 상태로 불러왔습니다.", "success");
    }).catch(function (error) {
      setMessage(error.message, "error");
    }).finally(function () { state.loading = false; });
  }

  function roleLabel(role) {
    return ({ owner: "소유자", admin: "관리자", member: "편집자", viewer: "조회자" })[role] || role;
  }
  function renderUsers() {
    var panel = document.getElementById("operationsUsersPanel");
    if (!panel) return;
    if (!state.profile || !state.profile.canManageUsers) {
      panel.innerHTML = '<div class="operations-admin-empty-v1">사용자 관리는 관리자만 이용할 수 있습니다.</div>';
      return;
    }
    panel.innerHTML = '<section class="operations-admin-toolbar"><div><strong>사용자 권한 관리</strong>' +
      '<span>로그인을 허용하고 수정 가능 범위를 계정별로 지정합니다.</span></div></section>' +
      '<form class="operations-user-form-v1" onsubmit="saveAllowedUserV1(event)">' +
      '<input name="email" type="email" placeholder="Google 이메일" required>' +
      '<input name="displayName" type="text" placeholder="표시 이름 (선택)">' +
      '<select name="role"><option value="member">편집자</option><option value="viewer">조회자</option>' +
      (state.profile.role === "owner" ? '<option value="admin">관리자</option>' : '') + '</select>' +
      '<button type="submit">사용자 추가</button></form>' +
      '<div class="operations-user-list-v1">' + state.users.map(function (entry) {
        var immutable = entry.role === "owner" || entry.source === "ENV" ||
          (state.profile.role !== "owner" && entry.role === "admin");
        return '<article><div><strong>' + escapeHtml(entry.displayName || entry.email.split("@")[0]) +
          '</strong><span>' + escapeHtml(entry.email) + '</span></div><label><span>권한</span><select data-user-role="' +
          escapeHtml(entry.email) + '" ' + (immutable ? 'disabled' : '') + '>' +
          ["admin", "member", "viewer"].map(function (role) {
            if (role === "admin" && state.profile.role !== "owner" && entry.role !== "admin") return "";
            return '<option value="' + role + '" ' + (entry.role === role ? 'selected' : '') + '>' + roleLabel(role) + '</option>';
          }).join("") + '</select></label><label class="operations-user-active-v1"><input type="checkbox" data-user-active="' +
          escapeHtml(entry.email) + '" ' + (entry.active ? 'checked' : '') + ' ' + (immutable ? 'disabled' : '') +
          '><span>사용 허용</span></label>' + (immutable ? '<small>환경설정에서 고정된 계정</small>' :
          '<button type="button" onclick="updateAllowedUserV1(\'' + encodeURIComponent(entry.email) + '\')">저장</button>') + '</article>';
      }).join("") + '</div>';
  }

  function loadUsers() {
    if (!state.profile || !state.profile.canManageUsers) { renderUsers(); return Promise.resolve(); }
    setMessage("사용자 목록을 불러오는 중입니다.", "loading");
    return apiGet("userManagement").then(function (result) {
      state.users = result.users || [];
      renderUsers();
      setMessage("사용자 권한을 확인했습니다.", "success");
    }).catch(function (error) { setMessage(error.message, "error"); });
  }

  function activateAdminTab(tab) {
    ["operationsDashboardPanel", "operationsCollectionsPanel", "operationsReviewsPanel", "operationsCustomersPanel",
      "operationsHistoryPanel", "operationsUsersPanel"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = id !== (tab === "history" ? "operationsHistoryPanel" : "operationsUsersPanel");
    });
    ["operationsTabDashboard", "operationsTabCollections", "operationsTabReviews", "operationsTabCustomers",
      "operationsTabHistory", "operationsTabUsers"].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.classList.toggle("active", id === (tab === "history" ? "operationsTabHistory" : "operationsTabUsers"));
    });
    if (tab === "history") loadHistory(true); else loadUsers();
  }

  function deactivateAdminTabs() {
    ["operationsHistoryPanel", "operationsUsersPanel"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = true;
    });
    ["operationsTabHistory", "operationsTabUsers"].forEach(function (id) {
      var button = document.getElementById(id);
      if (button) button.classList.remove("active");
    });
  }

  global.switchOperationsTab = function (tab) {
    if (tab !== "history" && tab !== "users") {
      deactivateAdminTabs();
      return previousSwitch(tab);
    }
    activateAdminTab(tab);
  };
  global.refreshListingHistoryV1 = function () { return loadHistory(true); };
  global.loadMoreListingHistoryV1 = function () { return loadHistory(false); };
  global.restoreListingHistoryV1 = function (historyId) {
    if (!confirm("선택한 시점의 값으로 매물을 복구할까요? 현재 값도 변경이력에 남습니다.")) return;
    setMessage("이전 값을 복구하는 중입니다.", "loading");
    apiPost("restoreListingHistory", { historyId: historyId }).then(function () {
      if (typeof global.loadSheet === "function") global.loadSheet(true);
      return loadHistory(true);
    }).then(function () { setMessage("이전 값으로 복구했습니다.", "success"); })
      .catch(function (error) { setMessage(error.message, "error"); });
  };
  global.saveAllowedUserV1 = function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    apiPost("saveAllowedUser", {
      email: form.email.value,
      displayName: form.displayName.value,
      role: form.role.value,
      active: true
    }).then(function () { form.reset(); return loadUsers(); })
      .then(function () { setMessage("사용자를 저장했습니다. 새 권한은 다음 로그인부터 적용됩니다.", "success"); })
      .catch(function (error) { setMessage(error.message, "error"); });
  };
  global.updateAllowedUserV1 = function (encodedEmail) {
    var email = decodeURIComponent(encodedEmail || "");
    var role = document.querySelector('[data-user-role="' + CSS.escape(email) + '"]');
    var active = document.querySelector('[data-user-active="' + CSS.escape(email) + '"]');
    apiPost("saveAllowedUser", { email: email, role: role && role.value, active: !active || active.checked })
      .then(loadUsers).then(function () { setMessage("사용자 권한을 저장했습니다.", "success"); })
      .catch(function (error) { setMessage(error.message, "error"); });
  };

  apiGet("userProfile").then(function (profile) {
    state.profile = profile;
    var usersTab = document.getElementById("operationsTabUsers");
    if (usersTab) usersTab.hidden = !profile.canManageUsers;
  }).catch(function () {
    var usersTab = document.getElementById("operationsTabUsers");
    if (usersTab) usersTab.hidden = true;
  });
})(window);
