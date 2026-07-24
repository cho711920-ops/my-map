(function() {
  "use strict";

  var originalSwitch = window.switchOperationsTab;
  var extraState = {
    tab: "",
    collection: null,
    reviews: null,
    selectedGroupKey: "",
    risk: "all",
    loading: false
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
  function formatAt(value) { return text(value) || "-"; }

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
  function renderReviews() {
    var panel = document.getElementById("operationsReviewsPanel");
    if (!panel) return;
    var data = extraState.reviews || {};
    var groups = filteredGroups();
    var group = selectedGroup();
    if (group) extraState.selectedGroupKey = group.groupKey;
    var filters = ["all", "높음", "중간", "낮음"];
    panel.innerHTML = '<div class="review-toolbar"><div><strong>매물검증 연속처리</strong><span>위험도와 차이값을 확인하고 통합·별도등록·보류만 선택하세요. 처리 후 다음 항목이 자동으로 열립니다.</span></div>' +
      '<button type="button" onclick="refreshReviewWorkspace()">새로고침</button></div>' +
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
    var item = group.items[0];
    var candidates = group.candidates || [];
    return '<div class="review-summary"><div><h3>' + escape(group.address || "주소 확인 필요") + '</h3><p>' +
      escape(group.room || "호실 없음") + ' · 중복후보 ' + candidates.length + '개 · 수집원본 ' +
      group.items.length + '개</p></div><span class="review-risk">' + escape(group.risk) + ' 위험 · ' +
      number(group.score) + '점</span></div><div class="review-compare-grid">' +
      '<article class="review-item"><header><h4>새로 수집된 매물</h4><span>' + escape(item.type) + '</span></header>' +
      '<p>' + escape(item.address) + ' ' + escape(item.room) + '<br>' + escape(item.comparison || item.memo) + '</p>' +
      values(item) + '</article>' +
      (candidates.length ? candidates.map(function(candidate) {
        return '<article class="review-candidate"><header><h4>' + escape(candidate.buildingName || "기존 대표매물") +
          '</h4><span>' + escape(candidate.source) + '</span></header><p>' + escape(candidate.address) + ' ' +
          escape(candidate.room) + '<br>' + escape(candidate.memo) + '</p>' + values(candidate) +
          '<button type="button" onclick="openPropertyTimeline(\'' + escape(candidate.propertyId) + '\')">변경 타임라인</button></article>';
      }).join("") : '<article class="review-candidate"><h4>연결된 기존 매물 없음</h4><p>별도 신규등록이 권장됩니다.</p></article>') +
      '</div><div class="review-action-buttons">' +
      '<button class="merge" type="button" onclick="decideCurrentReview(\'merge\')">1 · 기존과 통합</button>' +
      '<button class="create" type="button" onclick="decideCurrentReview(\'create\')">2 · 별도 신규등록</button>' +
      '<button class="hold" type="button" onclick="decideCurrentReview(\'hold\')">3 · 보류</button>' +
      '</div>';
  }

  function loadCollection(force) {
    if (extraState.loading || (!force && extraState.collection)) return Promise.resolve(renderCollections());
    extraState.loading = true;
    message("수집현황을 불러오는 중입니다…", "loading");
    return apiGet("collectionStatus").then(function(data) {
      extraState.collection = data; renderCollections();
      message("수집현황을 최신 상태로 불러왔습니다.", "success");
    }).catch(function(error) { message(error.message, "error"); })
      .finally(function() { extraState.loading = false; });
  }
  function loadReviews(force) {
    if (extraState.loading || (!force && extraState.reviews)) return Promise.resolve(renderReviews());
    extraState.loading = true;
    message("매물검증 묶음을 만드는 중입니다…", "loading");
    return apiGet("reviewWorkspace").then(function(data) {
      extraState.reviews = data;
      if (!selectedGroup()) extraState.selectedGroupKey = "";
      renderReviews();
      message("검증대상 " + number(data.total).toLocaleString("ko-KR") + "건을 " +
        number(data.groupCount).toLocaleString("ko-KR") + "개 묶음으로 정리했습니다.", "success");
    }).catch(function(error) { message(error.message, "error"); })
      .finally(function() { extraState.loading = false; });
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
  window.setReviewRiskFilter = function(filter) {
    extraState.risk = filter || "all"; extraState.selectedGroupKey = ""; renderReviews();
  };
  window.selectReviewGroup = function(key) { extraState.selectedGroupKey = text(key); renderReviews(); };
  window.decideCurrentReview = function(action) {
    var group = selectedGroup();
    if (!group || !group.items.length || extraState.loading) return;
    var item = group.items[0];
    var masterId = group.candidateIds && group.candidateIds[0] || item.masterId || "";
    if (action === "merge" && !masterId) {
      message("통합할 기존 대표매물이 없어 별도 신규등록을 선택해 주세요.", "error");
      return;
    }
    extraState.loading = true;
    message("검증결정을 저장하는 중입니다…", "loading");
    apiPost("applyReviewDecision", {
      reviewId: item.reviewId, reviewAction: action, masterId: masterId
    }).then(function(result) {
      extraState.reviews = null;
      extraState.selectedGroupKey = "";
      message(result.message || "검증결정을 저장했습니다.", "success");
      return loadReviews(true);
    }).catch(function(error) { message(error.message, "error"); })
      .finally(function() { extraState.loading = false; });
  };

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
            escape(item.reason || "자동 기록") + '</span><small>' + escape(item.at) + ' · ' +
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
})();
