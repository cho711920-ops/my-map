(function() {
  "use strict";

  var originalSwitch = window.switchOperationsTab;
  var REVIEW_CACHE_KEY = "js_operations_review_cache_v1";
  var REVIEW_CACHE_MAX_AGE = 10 * 60 * 1000;
  var extraState = {
    tab: "",
    collection: null,
    reviews: null,
    selectedGroupKey: "",
    selectedReviewId: "",
    selectedReviewIds: [],
    risk: "all",
    loading: false,
    refreshing: false,
    collectionLoading: false
  };

  function text(value) { return String(value == null ? "" : value).trim(); }
  function number(value) {
    var parsed = Number(String(value == null ? "" : value).replace(/,/g, ""));
    return isFinite(parsed) ? parsed : 0;
  }
  function escape(value) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(text(value));
    return text(value).replace(/[&<>"']/g, function(c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function apiGet(action, params) {
    var query = new URLSearchParams(Object.assign({action: action}, params || {}));
    return fetch(saveApiURL + "?" + query.toString(), {cache: "no-store", credentials: "same-origin"})
      .then(function(response) { return response.json(); })
      .then(function(result) {
        if (!result || result.ok === false) throw new Error(result && result.message || "자료를 불러오지 못했습니다.");
        return result;
      });
  }
  function apiPost(action, payload) {
    return fetch(saveApiURL, {
      method: "POST", credentials: "same-origin",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(Object.assign({action: action}, payload || {}))
    }).then(function(response) { return response.json(); }).then(function(result) {
      if (!result || result.ok === false) throw new Error(result && result.message || "처리하지 못했습니다.");
      return result;
    });
  }
  function message(value, tone) {
    var node = document.getElementById("operationsCenterMessage");
    if (!node) return;
    node.textContent = value || "";
    node.className = "operations-center-message" + (tone ? " " + tone : "");
  }
  function saveReviewCache() {
    if (!extraState.reviews) return;
    try {
      sessionStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify({
        at: Date.now(),
        data: extraState.reviews
      }));
    } catch (_) {}
  }
  function restoreReviewCache() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(REVIEW_CACHE_KEY) || "null");
      if (!cached || Date.now() - Number(cached.at || 0) > REVIEW_CACHE_MAX_AGE) return;
      extraState.reviews = cached.data || null;
    } catch (_) {}
  }
  function formatAt(value) {
    var raw = text(value);
    if (!raw) return "-";
    var date = new Date(raw);
    if (isNaN(date.getTime())) return raw;
    var parts = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(date).reduce(function(result, part) {
      result[part.type] = part.value; return result;
    }, {});
    return [parts.year, parts.month, parts.day].join(".") + " " + parts.hour + ":" + parts.minute;
  }

  function resultCells(result) {
    result = result || {};
    return '<div class="collection-result-grid">' +
      '<div><b>' + number(result.found).toLocaleString("ko-KR") + '</b><small>발견</small></div>' +
      '<div class="new"><b>' + number(result.created).toLocaleString("ko-KR") + '</b><small>신규</small></div>' +
      '<div><b>' + (number(result.merged) + number(result.updated)).toLocaleString("ko-KR") + '</b><small>통합·갱신</small></div>' +
      '<div class="review"><b>' + number(result.review).toLocaleString("ko-KR") + '</b><small>검증</small></div>' +
      '<div><b>' + number(result.duplicate).toLocaleString("ko-KR") + '</b><small>중복</small></div>' +
      '<div class="fail"><b>' + number(result.failed).toLocaleString("ko-KR") + '</b><small>실패</small></div>' +
    '</div>';
  }

  function renderCollections() {
    var panel = document.getElementById("operationsCollectionsPanel");
    if (!panel) return;
    var data = extraState.collection || {};
    var sources = data.sources || [];
    var raw = data.raw || {};
    panel.innerHTML = '<div class="collection-overview">' +
      '<div class="collection-toolbar"><div><strong>매일 수집현황</strong><span>수집기는 응답속도에 따라 묶음 크기를 자동조절하며, 중단되면 마지막 성공 지점부터 이어집니다.</span></div>' +
      '<button type="button" onclick="refreshCollectionStatus()">새로고침</button></div>' +
      '<div class="collection-source-grid">' + sources.map(function(source) {
        var statusClass = source.complete ? "complete" : (number(source.lastResult && source.lastResult.failed) ? "error" : "");
        return '<article class="collection-source-card"><header><h3>' + escape(source.source) + '</h3>' +
          '<span class="' + statusClass + '">' + escape(source.lastStatus || "수집 전") + '</span></header>' +
          '<p>' + escape(formatAt(source.lastAt)) + ' · ' + escape(source.lastScope || "수집 기록 없음") +
          '<br>완전수집 ' + (source.complete ? "Y" : "N") + '</p>' + resultCells(source.lastResult) + '</article>';
      }).join("") + '</div>' +
      '<div class="collection-toolbar"><div><strong>수집원본 최신상태</strong><span>전체 ' + number(raw.total).toLocaleString("ko-KR") +
      '건 · 처리대기 ' + number(raw.pending).toLocaleString("ko-KR") + '건 · 오류 ' + number(raw.error).toLocaleString("ko-KR") +
      '건 · 검증대기 ' + number(data.pendingReview).toLocaleString("ko-KR") + '건</span></div></div>' +
      '<div class="collection-table-wrap"><table class="collection-table"><thead><tr><th>완료시각</th><th>출처</th><th>범위</th><th>완전</th><th>발견</th><th>신규</th><th>통합·갱신</th><th>검증</th><th>중복</th><th>실패</th><th>상태</th></tr></thead><tbody>' +
      (data.recent || []).map(function(row) {
        return '<tr><td>' + escape(formatAt(row.endedAt)) + '</td><td>' + escape(row.source) + '</td><td>' + escape(row.scope) +
          '</td><td class="' + (row.complete ? "ok" : "warn") + '">' + (row.complete ? "Y" : "N") +
          '</td><td>' + number(row.found) + '</td><td>' + number(row.created) + '</td><td>' +
          (number(row.merged) + number(row.updated)) + '</td><td>' + number(row.review) + '</td><td>' +
          number(row.duplicate) + '</td><td>' + number(row.failed) + '</td><td>' + escape(row.status) + '</td></tr>';
      }).join("") + '</tbody></table></div></div>';
  }

  function filteredGroups() {
    var groups = extraState.reviews && extraState.reviews.groups || [];
    return groups.filter(function(group) {
      return extraState.risk === "all" || group.risk === extraState.risk;
    });
  }
  function selectedGroup() {
    var groups = filteredGroups();
    return groups.filter(function(group) { return group.groupKey === extraState.selectedGroupKey; })[0] || groups[0] || null;
  }
  function selectedReviewItem(group) {
    if (!group || !group.items || !group.items.length) return null;
    return group.items.filter(function(item) {
      return item.reviewId === extraState.selectedReviewId;
    })[0] || group.items[0];
  }
  function selectedReviewItems(group) {
    if (!group || !group.items || !group.items.length) return [];
    var selected = {};
    (extraState.selectedReviewIds || []).forEach(function(reviewId) {
      selected[text(reviewId)] = true;
    });
    return group.items.filter(function(item) { return !!selected[text(item.reviewId)]; });
  }
  function clearReviewSelection() {
    extraState.selectedReviewId = "";
    extraState.selectedReviewIds = [];
  }
  function values(item) {
    return '<div class="review-values">' +
      '<div><small>보증금</small><b>' + escape(item.deposit) + '</b></div>' +
      '<div><small>월세</small><b>' + escape(item.rent) + '</b></div>' +
      '<div><small>평수</small><b>' + escape(item.area) + '</b></div>' +
      '<div><small>층·호실</small><b>' + escape(item.room || "-") + '</b></div>' +
      '<div><small>구분</small><b>' + escape(item.category || "-") + '</b></div>' +
      '<div><small>출처</small><b>' + escape(item.source || "-") + '</b></div>' +
    '</div>';
  }
  function compactValues(item) {
    return '<span><b>보</b> ' + escape(item.deposit || "-") + '</span>' +
      '<span><b>월</b> ' + escape(item.rent || "-") + '</span>' +
      '<span><b>평</b> ' + escape(item.area || "-") + '</span>' +
      '<span><b>층·호</b> ' + escape(item.room || "-") + '</span>' +
      '<span><b>구분</b> ' + escape(item.category || "-") + '</span>' +
      '<span><b>출처</b> ' + escape(item.source || "-") + '</span>';
  }
  function renderReviews() {
    var panel = document.getElementById("operationsReviewsPanel");
    if (!panel) return;
    var data = extraState.reviews || {};
    var groups = filteredGroups();
    var group = selectedGroup();
    if (group) extraState.selectedGroupKey = group.groupKey;
    var filters = ["all", "높음", "중간", "낮음"];
    panel.innerHTML = '<div class="review-toolbar"><div><strong>매물검증 연속처리</strong><span>위험도와 차이값을 확인하고 통합·별도등록·보류만 선택하세요. 처리 후 다음 항목이 자동으로 열립니다.</span></div>' +
      '<div class="review-toolbar-actions"><button type="button" title="전체 검증대상을 검사하고 주소·층/호실·가격·평수가 정확히 맞는 항목만 자동통합합니다." onclick="repairRoomlessExactReviews()">자동중복 정리</button>' +
      '<button type="button" onclick="refreshReviewWorkspace()">새로고침</button></div></div>' +
      '<div class="review-workspace"><aside class="review-queue"><div class="review-filter-buttons">' +
      filters.map(function(filter) {
        return '<button type="button" class="' + (extraState.risk === filter ? "active" : "") +
          '" onclick="setReviewRiskFilter(\'' + filter + '\')">' + (filter === "all" ? "전체" : filter) + '</button>';
      }).join("") + '</div>' +
      (groups.length ? groups.map(function(entry) {
        return '<button type="button" class="review-group-button ' +
          (entry.groupKey === extraState.selectedGroupKey ? "active" : "") +
          '" onclick="selectReviewGroup(\'' + escape(entry.groupKey) + '\')"><b>' + number(entry.score) + '점</b><strong>' +
          escape(entry.address || "주소 확인 필요") + '</strong><span>' + escape(entry.room || "호실 없음") +
          ' · ' + escape(entry.risk) + ' 위험</span><small>' + number(entry.count) + '건 묶음 · ' +
          escape(entry.recommendation) + '</small></button>';
      }).join("") : '<div class="operations-empty"><b>검증할 매물이 없습니다.</b><span>확실한 신규와 중복은 자동처리되었습니다.</span></div>') +
      '</aside><main class="review-detail">' + renderReviewDetail(group) + '</main></div>';
  }
  function renderReviewDetail(group) {
    if (!group) return '<div class="operations-empty"><b>처리할 항목이 없습니다.</b></div>';
    if (!group.items || !group.items.length) return '<div class="operations-empty"><b>처리할 항목이 없습니다.</b></div>';
    var validIds = {};
    group.items.forEach(function(entry) { validIds[text(entry.reviewId)] = true; });
    extraState.selectedReviewIds = (extraState.selectedReviewIds || []).filter(function(reviewId) {
      return !!validIds[text(reviewId)];
    });
    var selectedIds = {};
    extraState.selectedReviewIds.forEach(function(reviewId) { selectedIds[text(reviewId)] = true; });
    var selectedCount = extraState.selectedReviewIds.length;
    var candidates = group.candidates || [];
    return '<div class="review-summary"><div><h3>' + escape(group.address || "주소 확인 필요") + '</h3><p>' +
      escape(group.room || "호실 없음") + ' · 중복후보 ' + candidates.length + '개 · 수집원본 ' +
      group.items.length + '개</p></div><span class="review-risk">' + escape(group.risk) + ' 위험 · ' +
      number(group.score) + '점</span></div>' +
      '<section class="review-existing-panel"><header class="review-section-heading">' +
        '<div><span class="review-existing-badge">기존매물</span><strong>통합 대상 ' +
          candidates.length + '건</strong></div>' +
        '<small>빨간 표시가 현재 JS매물현황에 등록된 매물입니다.</small>' +
      '</header><div class="review-existing-list">' +
      (candidates.length ? candidates.map(function(candidate) {
        return '<article class="review-candidate review-candidate-compact">' +
          '<div class="review-compact-main"><header><h4>' +
            escape(candidate.buildingName || "기존 대표매물") +
          '</h4><span>' + escape(candidate.source) + '</span></header>' +
          '<p>' + escape(candidate.address) + ' ' + escape(candidate.room) +
          (candidate.memo ? ' · ' + escape(candidate.memo) : '') + '</p></div>' +
          '<div class="review-compact-values">' + compactValues(candidate) + '</div>' +
          '<button type="button" onclick="openPropertyTimeline(\'' +
            escape(candidate.propertyId) + '\')">변경이력</button></article>';
      }).join("") : '<article class="review-candidate review-candidate-empty"><h4>연결된 기존 매물 없음</h4>' +
        '<p>비교할 기존 매물이 없으므로 별도 신규등록이 권장됩니다.</p></article>') +
      '</div></section>' +
      '<section class="review-new-panel"><header class="review-section-heading">' +
        '<div><span class="review-new-badge">신규수집</span><strong>' + group.items.length +
          '건</strong></div><label class="review-select-all"><input type="checkbox" onchange="toggleReviewGroupSelection(this.checked)"' +
          (selectedCount === group.items.length ? ' checked' : '') + '><span>전체선택</span></label>' +
          '<small>체크한 매물을 한 번에 처리합니다.</small>' +
      '</header><div id="reviewNewItemList" class="review-new-list">' +
      group.items.map(function(entry, index) {
        var selected = !!selectedIds[text(entry.reviewId)];
        return '<label class="review-item review-item-select review-item-compact' +
          (selected ? ' selected' : '') + '" data-review-id="' + escape(entry.reviewId) + '">' +
          '<input class="review-item-checkbox" type="checkbox"' + (selected ? ' checked' : '') +
          ' onchange="toggleReviewItemSelection(\'' + escape(entry.reviewId) + '\', this.checked)">' +
          '<span class="review-item-number">' + (index + 1) + '</span>' +
          '<span class="review-compact-main"><span class="review-compact-title"><strong>' +
            (selected ? '선택한 신규매물' : '같은 묶음 신규매물') +
          '</strong><em>' + escape(entry.type) + '</em></span><span class="review-compact-address">' +
            escape(entry.address) + ' ' + escape(entry.room) + '</span><span class="review-compact-note">' +
            escape(entry.comparison || entry.memo || "비교 메모 없음") + '</span></span>' +
          '<span class="review-compact-values">' + compactValues(entry) + '</span></label>';
      }).join("") +
      '</div></section><div class="review-action-buttons">' +
      '<strong>선택 <b>' + selectedCount + '</b>건</strong>' +
      '<button class="merge" type="button" onclick="decideCurrentReview(\'merge\')"' +
        (!selectedCount || !candidates.length ? ' disabled' : '') + '>기존과 통합</button>' +
      '<button class="create" type="button" onclick="decideCurrentReview(\'create\')"' +
        (!selectedCount ? ' disabled' : '') + '>별도 신규등록</button>' +
      '<button class="hold" type="button" onclick="decideCurrentReview(\'hold\')"' +
        (!selectedCount ? ' disabled' : '') + '>보류</button>' +
      '</div>';
  }

  function loadCollection(force) {
    if (extraState.collectionLoading || (!force && extraState.collection)) return Promise.resolve(renderCollections());
    extraState.collectionLoading = true;
    message("수집현황을 불러오는 중입니다…", "loading");
    return apiGet("collectionStatus").then(function(data) {
      extraState.collection = data; renderCollections();
      message("수집현황을 최신 상태로 불러왔습니다.", "success");
    }).catch(function(error) { message(error.message, "error"); })
      .finally(function() { extraState.collectionLoading = false; });
  }
  function loadReviews(force, silent) {
    if (extraState.refreshing) return Promise.resolve(renderReviews());
    if (!force && extraState.reviews) {
      renderReviews();
      if (!silent) {
        message("검증대상 " + number(extraState.reviews.total).toLocaleString("ko-KR") +
          "건 · 우선순위 목록을 바로 표시했습니다.", "success");
      }
      return Promise.resolve();
    }
    extraState.refreshing = true;
    if (!silent) message("매물검증 묶음을 만드는 중입니다…", "loading");
    return apiGet("reviewWorkspace").then(function(data) {
      extraState.reviews = data;
      if (!selectedGroup()) extraState.selectedGroupKey = "";
      renderReviews();
      saveReviewCache();
      if (!silent) {
        message("검증대상 " + number(data.total).toLocaleString("ko-KR") + "건을 " +
          number(data.groupCount).toLocaleString("ko-KR") + "개 묶음으로 정리했습니다. · 우선 " +
          number(data.loadedGroupCount || (data.groups || []).length).toLocaleString("ko-KR") +
          "개 묶음 표시", "success");
      }
    }).catch(function(error) {
      if (!silent) message(error.message, "error");
    }).finally(function() { extraState.refreshing = false; });
  }

  window.switchOperationsTab = function(tab) {
    var extra = tab === "collections" || tab === "reviews";
    ["operationsCollectionsPanel", "operationsReviewsPanel"].forEach(function(id) {
      var node = document.getElementById(id);
      if (node) node.hidden = id !== (tab === "collections" ? "operationsCollectionsPanel" : "operationsReviewsPanel");
    });
    ["operationsTabCollections", "operationsTabReviews"].forEach(function(id) {
      var button = document.getElementById(id);
      if (button) button.classList.toggle("active", id === (tab === "collections" ? "operationsTabCollections" : "operationsTabReviews"));
    });
    if (!extra) {
      extraState.tab = "";
      document.getElementById("operationsCollectionsPanel").hidden = true;
      document.getElementById("operationsReviewsPanel").hidden = true;
      if (originalSwitch) originalSwitch(tab);
      return;
    }
    extraState.tab = tab;
    var dashboard = document.getElementById("operationsDashboardPanel");
    var customers = document.getElementById("operationsCustomersPanel");
    if (dashboard) dashboard.hidden = true;
    if (customers) customers.hidden = true;
    var dashboardButton = document.getElementById("operationsTabDashboard");
    var customerButton = document.getElementById("operationsTabCustomers");
    if (dashboardButton) dashboardButton.classList.remove("active");
    if (customerButton) customerButton.classList.remove("active");
    if (tab === "collections") loadCollection(false);
    else loadReviews(false);
  };

  window.refreshCollectionStatus = function() { extraState.collection = null; return loadCollection(true); };
  window.refreshReviewWorkspace = function() { extraState.reviews = null; return loadReviews(true); };
  window.repairRoomlessExactReviews = function() {
    if (extraState.loading) return;
    extraState.loading = true;
    message("주소·층/호실·가격이 같고 평수 차이가 1평 미만인 매물을 자동통합하는 중입니다…", "loading");
    apiPost("repairRoomlessExactReviews", {}).then(function(result) {
      extraState.reviews = null;
      sessionStorage.removeItem(REVIEW_CACHE_KEY);
      showReviewDecisionModal("자동중복 정리 완료",
        "주소·층/호실·보증금·월세가 같고 평수 차이가 1평 미만인 검증매물 " +
        number(result.merged).toLocaleString("ko-KR") + "건을 기존 매물에 통합했습니다.", "", true);
      return loadReviews(true, true);
    }).then(function() {
      message("자동중복 정리와 검증목록 갱신을 완료했습니다.", "success");
    }).catch(function(error) {
      message(error.message, "error");
      showReviewDecisionModal("자동중복 정리 실패", error.message || "다시 시도해 주세요.", "", true);
    }).finally(function() {
      extraState.loading = false;
    });
  };
  window.setReviewRiskFilter = function(filter) {
    extraState.risk = filter || "all"; extraState.selectedGroupKey = ""; clearReviewSelection(); renderReviews();
  };
  window.selectReviewGroup = function(key) {
    extraState.selectedGroupKey = text(key);
    clearReviewSelection();
    renderReviews();
  };
  function renderReviewDetailOnly(scrollTop) {
    var detail = document.querySelector("#operationsReviewsPanel .review-detail");
    if (!detail) return renderReviews();
    detail.innerHTML = renderReviewDetail(selectedGroup());
    window.requestAnimationFrame(function() {
      var list = document.getElementById("reviewNewItemList");
      if (list && isFinite(scrollTop)) list.scrollTop = scrollTop;
    });
  }
  window.toggleReviewItemSelection = function(reviewId, checked) {
    reviewId = text(reviewId);
    var selected = (extraState.selectedReviewIds || []).filter(function(id) {
      return text(id) !== reviewId;
    });
    if (checked) selected.push(reviewId);
    extraState.selectedReviewIds = selected;
    extraState.selectedReviewId = selected[0] || "";
    var list = document.getElementById("reviewNewItemList");
    renderReviewDetailOnly(list ? list.scrollTop : 0);
  };
  window.toggleReviewGroupSelection = function(checked) {
    var group = selectedGroup();
    extraState.selectedReviewIds = checked && group
      ? group.items.map(function(item) { return text(item.reviewId); })
      : [];
    extraState.selectedReviewId = extraState.selectedReviewIds[0] || "";
    var list = document.getElementById("reviewNewItemList");
    renderReviewDetailOnly(list ? list.scrollTop : 0);
  };
  window.selectReviewItem = function(reviewId) {
    var id = text(reviewId);
    window.toggleReviewItemSelection(id, (extraState.selectedReviewIds || []).indexOf(id) < 0);
  };
  function reviewDecisionModal() {
    var modal = document.getElementById("reviewDecisionModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "reviewDecisionModal";
    modal.className = "review-decision-modal";
    modal.hidden = true;
    modal.innerHTML = '<div class="review-decision-backdrop" onclick="closeReviewDecisionModal()"></div>' +
      '<section class="review-decision-dialog" role="dialog" aria-modal="true">' +
        '<header><h3 id="reviewDecisionTitle"></h3><p id="reviewDecisionText"></p></header>' +
        '<div class="review-decision-actions">' +
          '<button id="reviewDecisionCancel" type="button" onclick="closeReviewDecisionModal()">취소</button>' +
          '<button id="reviewDecisionConfirm" class="primary" type="button">확인</button>' +
        '</div>' +
      '</section>';
    document.body.appendChild(modal);
    return modal;
  }
  function showReviewDecisionModal(title, description, action, resultOnly) {
    var modal = reviewDecisionModal();
    document.getElementById("reviewDecisionTitle").textContent = title;
    document.getElementById("reviewDecisionText").textContent = description;
    var cancel = document.getElementById("reviewDecisionCancel");
    var confirm = document.getElementById("reviewDecisionConfirm");
    cancel.hidden = !!resultOnly;
    confirm.textContent = resultOnly ? "닫기" : "처리하기";
    confirm.onclick = resultOnly
      ? window.closeReviewDecisionModal
      : function() {
          window.closeReviewDecisionModal();
          executeReviewDecision(action);
        };
    modal.hidden = false;
  }
  window.closeReviewDecisionModal = function() {
    var modal = document.getElementById("reviewDecisionModal");
    if (modal) modal.hidden = true;
  };
  window.decideCurrentReview = function(action) {
    var group = selectedGroup();
    var selectedCount = selectedReviewItems(group).length;
    if (!selectedCount) {
      message("먼저 처리할 신규매물을 체크해 주세요.", "error");
      return;
    }
    var labels = {
      merge: {
        title: selectedCount + "건을 기존 매물과 통합할까요?",
        description: "선택한 신규 원본을 한 번에 기존 매물의 출처이력으로 통합합니다.\n기존 임대조건은 그대로 유지하고, 비어 있는 값·연락처·메모·출처 링크만 보강합니다."
      },
      create: {
        title: selectedCount + "건을 별도 신규매물로 등록할까요?",
        description: "선택한 매물마다 새로운 매물ID를 만들어 JS통합매물현황에 일괄 등록합니다."
      },
      hold: {
        title: selectedCount + "건을 보류할까요?",
        description: "선택한 매물을 검증목록에서 제거하고 ‘검증보류’ 시트에 일괄 보관합니다.\n같은 출처 매물과 주소·임대조건이 같은 매물은 다음 수집에서도 자동 제외됩니다."
      }
    };
    var info = labels[action];
    if (!info) return;
    showReviewDecisionModal(info.title, info.description, action, false);
  };
  function executeReviewDecision(action) {
    var group = selectedGroup();
    if (!group || !group.items.length || extraState.loading) return;
    var items = selectedReviewItems(group);
    if (!items.length) return;
    var reviewIds = items.map(function(item) { return item.reviewId; });
    var masterId = group.candidateIds && group.candidateIds[0] || items[0].masterId || "";
    if (action === "merge" && !masterId) {
      message("통합할 기존 대표매물이 없어 별도 신규등록을 선택해 주세요.", "error");
      return;
    }
    extraState.loading = true;
    message("선택한 " + reviewIds.length + "건을 한 번에 처리하는 중입니다…", "loading");
    apiPost("applyReviewBatch", {
      reviewIds: reviewIds, reviewAction: action, masterId: masterId
    }).then(function(result) {
      var processedIds = result.processedReviewIds && result.processedReviewIds.length
        ? result.processedReviewIds.map(text)
        : reviewIds.slice(0, number(result.processed || reviewIds.length));
      var processedMap = {};
      processedIds.forEach(function(reviewId) { processedMap[reviewId] = true; });
      if (extraState.reviews) {
        var removedGroups = 0;
        (extraState.reviews.groups || []).forEach(function(entry) {
          entry.items = (entry.items || []).filter(function(item) {
            return !processedMap[text(item.reviewId)];
          });
          entry.count = entry.items.length;
          if (!entry.count) removedGroups += 1;
        });
        extraState.reviews.groups = (extraState.reviews.groups || []).filter(function(entry) {
          return entry.count > 0;
        });
        extraState.reviews.total = result.remaining !== undefined
          ? number(result.remaining)
          : Math.max(0, number(extraState.reviews.total) - processedIds.length);
        extraState.reviews.groupCount = Math.max(
          0, number(extraState.reviews.groupCount) - removedGroups
        );
        extraState.reviews.loadedGroupCount = extraState.reviews.groups.length;
      }
      clearReviewSelection();
      if (!selectedGroup()) extraState.selectedGroupKey = "";
      saveReviewCache();
      renderReviews();
      extraState.loading = false;
      var remaining = number(result.remaining !== undefined ? result.remaining : extraState.reviews && extraState.reviews.total)
        .toLocaleString("ko-KR");
      var failed = number(result.failed);
      var resultMessage = processedIds.length.toLocaleString("ko-KR") + "건 처리 완료" +
        (failed ? " · 실패 " + failed.toLocaleString("ko-KR") + "건" : "") +
        "\n남은 검증 " + remaining + "건";
      message(resultMessage.replace("\n", " · "), failed ? "error" : "success");
      showReviewDecisionModal(failed ? "일부 처리가 완료되었습니다" : "일괄 처리가 완료되었습니다",
        resultMessage, "", true);
    }).catch(function(error) {
      message(error.message, "error");
      showReviewDecisionModal("처리하지 못했습니다", error.message || "다시 시도해 주세요.", "", true);
    })
      .finally(function() { extraState.loading = false; });
  }

  function timelineModal() {
    var modal = document.getElementById("propertyTimelineModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "propertyTimelineModal";
    modal.className = "property-timeline-modal";
    modal.hidden = true;
    modal.innerHTML = '<div class="property-timeline-backdrop" onclick="closePropertyTimeline()"></div>' +
      '<section class="property-timeline-dialog"><header><div><small>매물 변경이력</small><h3 id="propertyTimelineTitle">변경 타임라인</h3></div>' +
      '<button type="button" onclick="closePropertyTimeline()">×</button></header><div id="propertyTimelineList" class="property-timeline-list"></div></section>';
    document.body.appendChild(modal);
    return modal;
  }
  window.openPropertyTimeline = function(propertyId) {
    var modal = timelineModal();
    modal.hidden = false;
    document.getElementById("propertyTimelineTitle").textContent = propertyId + " 변경 타임라인";
    document.getElementById("propertyTimelineList").innerHTML = '<div class="operations-empty"><b>이력을 불러오는 중입니다…</b></div>';
    apiGet("propertyTimeline", {propertyId: propertyId}).then(function(data) {
      document.getElementById("propertyTimelineList").innerHTML = data.items && data.items.length
        ? data.items.map(function(item) {
          return '<article class="property-timeline-item"><b>' + escape(item.action) + '</b><span>' +
            escape(item.reason || "자동 기록") + '</span><small>' + escape(formatAt(item.at)) + ' · ' +
            escape(item.source) + '</small></article>';
        }).join("")
        : '<div class="operations-empty"><b>저장된 변경이력이 없습니다.</b></div>';
    }).catch(function(error) {
      document.getElementById("propertyTimelineList").innerHTML = '<div class="operations-empty"><b>' +
        escape(error.message) + '</b></div>';
    });
  };
  window.closePropertyTimeline = function() {
    var modal = document.getElementById("propertyTimelineModal");
    if (modal) modal.hidden = true;
  };
  document.addEventListener("keydown", function(event) {
    if (extraState.tab !== "reviews" || !document.getElementById("operationsCenter").classList.contains("open")) return;
    if (/input|textarea|select/i.test(document.activeElement && document.activeElement.tagName || "")) return;
    if (event.key === "1") window.decideCurrentReview("merge");
    if (event.key === "2") window.decideCurrentReview("create");
    if (event.key === "3") window.decideCurrentReview("hold");
    if (event.key === "Escape") window.closePropertyTimeline();
  });
  restoreReviewCache();
  setTimeout(function() {
    if (!extraState.refreshing) loadReviews(true, true);
  }, 5000);
})();
