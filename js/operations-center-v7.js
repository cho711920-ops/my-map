(function() {
  "use strict";

  var state = {
    loaded: false,
    loading: false,
    dashboard: null,
    customerHeaders: [],
    customers: [],
    matchHeaders: [],
    matches: [],
    activityHeaders: [],
    activities: [],
    matchSummary: {},
    loadedMatchCustomerId: "",
    matchLoading: false,
    selectedCustomerId: "",
    customerSearch: "",
    matchStatusFilter: "all",
    customerView: "active",
    editingCustomerId: ""
  };

  window.operationsMatchPropertyIds = null;
  window.operationsMatchStatusByPropertyId = {};
  window.operationsMatchContextByPropertyId = {};

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function escape(value) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(text(value));
    return text(value).replace(/[&<>"']/g, function(character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function number(value) {
    var parsed = Number(String(value == null ? "" : value).replace(/,/g, ""));
    return isFinite(parsed) ? parsed : 0;
  }

  function headerIndex(headers, name) {
    return (headers || []).indexOf(name);
  }

  function field(row, headers, name) {
    var index = headerIndex(headers, name);
    return index >= 0 ? text(row[index]) : "";
  }

  function apiGet(action, params) {
    var query = new URLSearchParams(Object.assign({ action: action }, params || {}));
    return fetch(saveApiURL + "?" + query.toString(), {
      credentials: "same-origin",
      cache: "no-store"
    }).then(function(response) {
      if (!response.ok) throw new Error("운영자료를 불러오지 못했습니다. (HTTP " + response.status + ")");
      return response.json();
    }).then(function(result) {
      if (!result || result.ok === false) throw new Error((result && result.message) || "운영자료 조회에 실패했습니다.");
      return result;
    });
  }

  function apiPost(action, payload) {
    return fetch(saveApiURL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function(response) {
      if (!response.ok) throw new Error("운영 요청을 처리하지 못했습니다. (HTTP " + response.status + ")");
      return response.json();
    }).then(function(result) {
      if (!result || result.ok === false) throw new Error((result && result.message) || "운영 요청 처리에 실패했습니다.");
      return result;
    });
  }

  function setMessage(message, type) {
    var element = document.getElementById("operationsCenterMessage");
    if (!element) return;
    element.textContent = message || "";
    element.className = "operations-center-message" + (type ? " " + type : "");
  }

  function dashboardCard(label, value, hint, tone) {
    return '<article class="operations-stat-card ' + (tone || "") + '">' +
      '<span>' + escape(label) + '</span>' +
      '<strong>' + number(value).toLocaleString("ko-KR") + '</strong>' +
      '<small>' + escape(hint) + '</small>' +
      '</article>';
  }

  function renderDashboard() {
    var panel = document.getElementById("operationsDashboardPanel");
    if (!panel) return;
    var data = state.dashboard || {};
    var reviewCount = data.pendingReview != null ? data.pendingReview : data.review;
    var activeCount = data.activeMaster != null ? data.activeMaster : data.master;
    var cleanup = data.lastCompaction || {};
    var cleanupRemoved = number(cleanup.rawRemoved) + number(cleanup.reviewRemoved);
    var cleanupHint = cleanup.at
      ? cleanup.at + " · 원본 " + number(cleanup.rawRemaining).toLocaleString("ko-KR") + "건 유지"
      : "매일 새벽 4시 자동 중복정리";
    panel.innerHTML =
      '<div class="operations-stat-grid">' +
        dashboardCard("활성 대표매물", activeCount, "JS웹에 표시되는 운영 매물", "primary") +
        dashboardCard("검증 대기", reviewCount, "사람의 판단이 필요한 원본", reviewCount ? "warning" : "success") +
        dashboardCard("수집 원본", data.raw, "출처별 원본 스냅샷", "") +
        dashboardCard("고객 문의", data.openCustomers != null ? data.openCustomers : data.customers, "진행 중인 고객 조건", "") +
        dashboardCard("신규 고객매칭", data.newMatches != null ? data.newMatches : data.matches, "아직 후보·보류로 정하지 않은 추천", data.newMatches ? "primary" : "") +
        dashboardCard("미연락 경고", data.overdueMatches, (data.contactReminderDays || 3) + "일 이상 연락기록 없는 신규 추천", data.overdueMatches ? "warning" : "success") +
        dashboardCard("오늘 후속관리", data.dueFollowups, "다음 연락·미팅일이 된 고객", data.dueFollowups ? "warning" : "success") +
        dashboardCard("거래확인 후보", data.transactionCheckCandidates, "전체수집 3회 연속 미노출된 보류매물", data.transactionCheckCandidates ? "warning" : "success") +
        dashboardCard("후보 매물", data.introducedMatches, "고객이 후보로 선택한 매물", "success") +
        dashboardCard("변경 이력", data.history, "수정·통합·상태변경 기록", "") +
        dashboardCard("최근 자동정리", cleanupRemoved, cleanupHint, cleanup.at ? "success" : "") +
      '</div>' +
      '<div class="operations-workflow-card">' +
        '<div><b>자동 처리 흐름</b><span>수집원본 → 자동 중복판정 → 대표매물/검증대기 → 고객 재매칭</span></div>' +
        '<div class="operations-source-priority"><span>대표출처 우선순위</span><b>직접등록 › 당근 › 공실박스 › 네이버</b></div>' +
      '</div>' +
      '<div class="operations-guidance">' +
        '<b>사람이 확인할 일은 두 가지뿐입니다.</b>' +
        '<p>매물검증의 애매한 중복만 결정하세요. 고객 등록·조건수정·후속관리는 이 화면에서 처리하고, 대표매물 갱신·이력·재매칭은 자동으로 처리됩니다.</p>' +
      '</div>';
  }

  function matchCountForCustomer(customerId) {
    return state.matches.filter(function(row) {
      return field(row, state.matchHeaders, "고객ID") === customerId;
    }).length;
  }

  function matchStatus(row) {
    return field(row, state.matchHeaders, "진행상태") || "신규";
  }

  function parseMatchDate(value) {
    var normalized = text(value).replace(/\./g, "-").replace(/\s+/, "T");
    var parsed = normalized ? new Date(normalized) : null;
    return parsed && !isNaN(parsed.getTime()) ? parsed : null;
  }

  function isOverdueMatch(row) {
    if (matchStatus(row) !== "신규" || field(row, state.matchHeaders, "연락일시")) return false;
    var firstMatched = parseMatchDate(field(row, state.matchHeaders, "최초매칭일시"));
    var days = number(state.dashboard && state.dashboard.contactReminderDays) || 3;
    return !!firstMatched && Date.now() - firstMatched.getTime() >= days * 24 * 60 * 60 * 1000;
  }

  function customerMatchStats(customerId) {
    if (state.matchSummary[customerId]) return state.matchSummary[customerId];
    var rows = state.matches.filter(function(row) {
      return field(row, state.matchHeaders, "고객ID") === customerId;
    });
    return {
      total: rows.length,
      fresh: rows.filter(function(row) { return matchStatus(row) === "신규"; }).length,
      introduced: rows.filter(function(row) { return matchStatus(row) === "소개"; }).length,
      held: rows.filter(function(row) { return matchStatus(row) === "보류"; }).length,
      overdue: rows.filter(isOverdueMatch).length
    };
  }

  function adjustMatchSummary(customerId, oldStatus, newStatus) {
    var stats = state.matchSummary[customerId];
    if (!stats || oldStatus === newStatus) return;
    function change(status, amount) {
      if (status === "신규") stats.fresh = Math.max(0, number(stats.fresh) + amount);
      if (status === "소개") stats.introduced = Math.max(0, number(stats.introduced) + amount);
      if (status === "보류") stats.held = Math.max(0, number(stats.held) + amount);
    }
    change(oldStatus, -1);
    change(newStatus, 1);
  }

  function latestCustomerActivity(customerId) {
    var rows = state.activities.filter(function(row) {
      return field(row, state.activityHeaders, "고객ID") === customerId;
    });
    return rows.length ? rows[rows.length - 1] : null;
  }

  function customerFollowup(customerId) {
    var row = latestCustomerActivity(customerId);
    var next = row ? field(row, state.activityHeaders, "다음연락일") : "";
    var date = parseMatchDate(next);
    return {
      stage: row ? field(row, state.activityHeaders, "단계") : "",
      next: next,
      due: !!date && date.getTime() <= Date.now()
    };
  }

  function isArchivedCustomer(row) {
    return ["계약완료", "종료"].indexOf(field(row, state.customerHeaders, "상태")) >= 0;
  }

  function renderCustomers() {
    var list = document.getElementById("operationsCustomerList");
    if (!list) return;
    if (!state.customers.length) {
      list.innerHTML = '<div class="operations-empty"><b>등록된 고객이 없습니다.</b><span>고객문의 시트에 한 행을 입력하면 고객ID와 조건버전이 자동 생성됩니다.</span></div>';
      renderMatches("");
      return;
    }
    var search = text(state.customerSearch).toLowerCase();
    var activeCount = state.customers.filter(function(row) { return !isArchivedCustomer(row); }).length;
    var archivedCount = state.customers.length - activeCount;
    var beforeMeetingCount = state.customers.filter(function(row) { return field(row, state.customerHeaders, "상태") === "미팅전"; }).length;
    var afterMeetingCount = state.customers.filter(function(row) { return field(row, state.customerHeaders, "상태") === "미팅후"; }).length;
    var pausedCount = state.customers.filter(function(row) { return field(row, state.customerHeaders, "상태") === "보류"; }).length;
    var filteredCustomers = state.customers.filter(function(row) {
      if (state.customerView === "active" && isArchivedCustomer(row)) return false;
      if (state.customerView === "before" && field(row, state.customerHeaders, "상태") !== "미팅전") return false;
      if (state.customerView === "after" && field(row, state.customerHeaders, "상태") !== "미팅후") return false;
      if (state.customerView === "paused" && field(row, state.customerHeaders, "상태") !== "보류") return false;
      if (state.customerView === "archived" && !isArchivedCustomer(row)) return false;
      if (!search) return true;
      return ["고객명/상호", "희망지역", "연락처", "상태"].some(function(header) {
        return field(row, state.customerHeaders, header).toLowerCase().indexOf(search) >= 0;
      });
    }).sort(function(a, b) {
      var aId = field(a, state.customerHeaders, "고객ID");
      var bId = field(b, state.customerHeaders, "고객ID");
      var aStats = customerMatchStats(aId);
      var bStats = customerMatchStats(bId);
      var aFollowup = customerFollowup(aId);
      var bFollowup = customerFollowup(bId);
      return Number(bFollowup.due) - Number(aFollowup.due) || bStats.fresh - aStats.fresh ||
        field(b, state.customerHeaders, "수정일시").localeCompare(field(a, state.customerHeaders, "수정일시"));
    });
    list.innerHTML = '<div class="operations-customer-tools"><input id="operationsCustomerSearch" type="search" placeholder="고객명·지역·연락처 검색" value="' + escape(state.customerSearch) + '"><span>' + filteredCustomers.length.toLocaleString("ko-KR") + '명</span></div>' +
      '<div class="operations-customer-views">' +
        customerViewButton("active", "진행 전체", activeCount) +
        customerViewButton("before", "미팅전", beforeMeetingCount) +
        customerViewButton("after", "미팅후", afterMeetingCount) +
        customerViewButton("paused", "보류", pausedCount) +
        customerViewButton("archived", "종료 보관함", archivedCount) +
      '</div>' +
      '<div class="operations-customer-grid">' + filteredCustomers.map(function(row) {
      var id = field(row, state.customerHeaders, "고객ID");
      var name = field(row, state.customerHeaders, "고객명/상호") || "이름 미입력";
      var status = field(row, state.customerHeaders, "상태") || "미팅전";
      var region = field(row, state.customerHeaders, "희망지역") || "지역 전체";
      var request = field(row, state.customerHeaders, "요청사항");
      var stats = customerMatchStats(id);
      var followup = customerFollowup(id);
      var selected = id === state.selectedCustomerId ? " selected" : "";
      var alertClass = stats.overdue || followup.due ? " has-overdue" : "";
      return '<button type="button" class="operations-customer-card' + selected + alertClass + '" data-customer-id="' + escape(id) + '">' +
        '<span class="operations-customer-status">' + escape(status) + '</span>' +
        '<strong>' + escape(name) + '</strong>' +
        '<span>' + escape(region) + '</span>' +
        (request ? '<small>' + escape(request) + '</small>' : '') +
        '<b>' + stats.total.toLocaleString("ko-KR") + '건 매칭 · 신규 ' + stats.fresh.toLocaleString("ko-KR") + '건</b>' +
        (stats.introduced ? '<em>후보 ' + stats.introduced.toLocaleString("ko-KR") + '</em>' : '') +
        (stats.held ? '<u>보류 ' + stats.held.toLocaleString("ko-KR") + '</u>' : '') +
        (stats.overdue ? '<i>미연락 경고 ' + stats.overdue.toLocaleString("ko-KR") + '건</i>' : '') +
        (followup.next ? '<i class="' + (followup.due ? "due" : "scheduled") + '">다음 ' + escape(followup.next) + '</i>' : '') +
      '</button>';
    }).join("") + '</div>';
    var searchInput = document.getElementById("operationsCustomerSearch");
    if (searchInput) searchInput.addEventListener("input", function() {
      state.customerSearch = searchInput.value || "";
      renderCustomers();
      var next = document.getElementById("operationsCustomerSearch");
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
    });
    Array.prototype.forEach.call(list.querySelectorAll("[data-customer-id]"), function(button) {
      button.addEventListener("click", function() {
        state.selectedCustomerId = button.getAttribute("data-customer-id") || "";
        state.matchStatusFilter = "all";
        state.matches = [];
        state.loadedMatchCustomerId = "";
        renderCustomers();
        renderMatches(state.selectedCustomerId);
        loadCustomerMatches(state.selectedCustomerId);
      });
    });
    if ((!state.selectedCustomerId || !filteredCustomers.some(function(row) {
      return field(row, state.customerHeaders, "고객ID") === state.selectedCustomerId;
    })) && filteredCustomers.length) {
      state.selectedCustomerId = field(filteredCustomers[0], state.customerHeaders, "고객ID");
      renderCustomers();
      renderMatches(state.selectedCustomerId);
      loadCustomerMatches(state.selectedCustomerId);
    }
  }

  function customerViewButton(key, label, count) {
    return '<button type="button" class="' + (state.customerView === key ? "active" : "") +
      '" onclick="setCustomerView(\'' + key + '\')">' + label + ' <b>' +
      Number(count || 0).toLocaleString("ko-KR") + '</b></button>';
  }

  window.setCustomerView = function(view) {
    state.customerView = view || "active";
    renderCustomers();
  };

  function getProperty(propertyId) {
    return (window.allItems || []).find(function(item) {
      return text(item.propertyId) === text(propertyId);
    }) || null;
  }

  function renderMatches(customerId) {
    var list = document.getElementById("operationsMatchList");
    if (!list) return;
    if (!customerId) {
      list.innerHTML = '<div class="operations-empty"><b>고객을 선택해 주세요.</b><span>선택한 고객의 조건에 맞는 대표매물을 점수순으로 보여드립니다.</span></div>';
      return;
    }
    var allRows = state.matches.filter(function(row) {
      return field(row, state.matchHeaders, "고객ID") === customerId;
    }).sort(function(a, b) {
      return number(field(b, state.matchHeaders, "점수")) - number(field(a, state.matchHeaders, "점수"));
    });
    var counts = {
      all: allRows.length,
      fresh: allRows.filter(function(row) { return matchStatus(row) === "신규"; }).length,
      introduced: allRows.filter(function(row) { return matchStatus(row) === "소개"; }).length,
      held: allRows.filter(function(row) { return matchStatus(row) === "보류"; }).length
    };
    var rows = allRows.filter(function(row) {
      if (state.matchStatusFilter === "fresh") return matchStatus(row) === "신규";
      if (state.matchStatusFilter === "introduced") return matchStatus(row) === "소개";
      if (state.matchStatusFilter === "held") return matchStatus(row) === "보류";
      return true;
    });
    var customerRow = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === customerId;
    });
    var customerName = customerRow ? field(customerRow, state.customerHeaders, "고객명/상호") : "선택 고객";
    var overdueCount = allRows.filter(isOverdueMatch).length;
    var followup = customerFollowup(customerId);
    var header = (overdueCount ? '<div class="operations-customer-alert"><b>새 매물 안내 필요</b><span>신규매물 ' + overdueCount.toLocaleString("ko-KR") + '건이 ' + (number(state.dashboard && state.dashboard.contactReminderDays) || 3) + '일 이상 확인되지 않았습니다.</span></div>' : '') +
      (followup.due ? '<div class="operations-customer-alert"><b>후속관리 예정일</b><span>' + escape(followup.next) + ' · ' + escape(followup.stage || "상담") + '</span></div>' : '') +
      '<div class="operations-match-heading"><div><span>' + escape(customerName) + '</span><b>' + counts.all.toLocaleString("ko-KR") + '건 추천</b></div>' +
      '<div class="operations-match-heading-actions"><button type="button" onclick="openCustomerEditor(\'' + escape(customerId) + '\')">조건 수정</button>' +
      '<button type="button" onclick="openCustomerActivity(\'' + escape(customerId) + '\')">상담·미팅 기록</button>' +
      '<button type="button" onclick="showSelectedCustomerMatchesOnMap()"' + (allRows.length ? '' : ' disabled') + '>지도에서 보기</button></div></div>' +
      '<div class="operations-match-filters">' +
        matchFilterButton("all", "전체", counts.all) + matchFilterButton("fresh", "신규", counts.fresh) +
        matchFilterButton("introduced", "후보", counts.introduced) + matchFilterButton("held", "보류", counts.held) +
      '</div>';
    if (!allRows.length) {
      if (state.matchLoading && state.loadedMatchCustomerId !== customerId) {
        list.innerHTML = header + '<div class="operations-empty"><b>이 고객의 추천매물을 불러오는 중입니다…</b><span>고객이 많아져도 선택한 고객 자료만 빠르게 불러옵니다.</span></div>';
        return;
      }
      list.innerHTML = header + '<div class="operations-empty"><b>현재 조건에 맞는 매물이 없습니다.</b><span>조건을 수정하거나 새 매물이 들어오면 자동으로 다시 비교됩니다.</span></div>';
      return;
    }
    if (!rows.length) {
      list.innerHTML = header + '<div class="operations-empty"><b>이 상태의 매물이 없습니다.</b><span>위의 다른 상태를 눌러 확인해 주세요.</span></div>';
      return;
    }
    list.innerHTML = header + '<div class="operations-match-cards">' + rows.map(function(row) {
      var propertyId = field(row, state.matchHeaders, "대표매물ID");
      var property = getProperty(propertyId);
      var score = field(row, state.matchHeaders, "점수");
      var reasons = field(row, state.matchHeaders, "추천이유");
      var warnings = field(row, state.matchHeaders, "주의사항");
      var status = matchStatus(row);
      var matchId = field(row, state.matchHeaders, "매칭ID");
      var title = property ? (property.name || property.type || "매물") : propertyId;
      var address = property ? [property.address, property.room].filter(Boolean).join(" · ") : "지도 데이터를 새로고침하면 상세정보가 연결됩니다.";
      var price = property ? "보증금 " + number(property.deposit).toLocaleString("ko-KR") + " / 월세 " + number(property.rent).toLocaleString("ko-KR") + " · " + number(property.area) + "평" : "";
      var introduced = status === "소개";
      var held = status === "보류";
      var visualStatus = introduced ? "후보" : status;
      return '<article class="operations-match-card' + (introduced ? ' introduced' : '') + (held ? ' held' : '') + (isOverdueMatch(row) ? ' overdue' : '') + '">' +
        '<div class="operations-match-score"><b>' + escape(score) + '</b><span>점</span></div>' +
        '<div class="operations-match-body"><div class="operations-match-title"><strong>' + escape(title) + '</strong><span>' + escape(visualStatus) + '</span></div><span>' + escape(address) + '</span>' +
          (price ? '<b>' + escape(price) + '</b>' : '') +
          '<p>' + escape(reasons || "기본 조건 충족") + '</p>' +
          (warnings ? '<small>확인: ' + escape(warnings) + '</small>' : '') +
          '<div class="operations-match-actions">' +
            (introduced ? '<span class="introduced-label">✓ 후보 매물</span>' : '<button type="button" class="introduce" data-match-action="소개" data-match-id="' + escape(matchId) + '" data-customer-id="' + escape(customerId) + '" data-master-id="' + escape(propertyId) + '">후보등록</button>') +
            (held ? '<span class="held-label">보류한 매물</span>' : '<button type="button" class="hold" data-match-action="보류" data-match-id="' + escape(matchId) + '" data-customer-id="' + escape(customerId) + '" data-master-id="' + escape(propertyId) + '">보류함</button>') +
          '</div>' +
        '</div>' +
      '</article>';
    }).join("") + '</div>';
    Array.prototype.forEach.call(list.querySelectorAll("[data-match-action]"), function(button) {
      button.addEventListener("click", function() { updateCustomerMatchStatus(button); });
    });
  }

  function matchFilterButton(key, label, count) {
    return '<button type="button" class="' + (state.matchStatusFilter === key ? 'active' : '') + '" onclick="setCustomerMatchStatusFilter(\'' + key + '\')">' + label + ' <b>' + Number(count || 0).toLocaleString("ko-KR") + '</b></button>';
  }

  window.setCustomerMatchStatusFilter = function(filter) {
    state.matchStatusFilter = filter || "all";
    renderMatches(state.selectedCustomerId);
  };

  function updateCustomerMatchStatus(button) {
    var status = button.getAttribute("data-match-action") || "";
    button.disabled = true;
    button.textContent = "저장 중…";
    setMessage(status + " 상태를 저장하고 있습니다…", "loading");
    apiPost("updateCustomerMatch", {
      matchId: button.getAttribute("data-match-id") || "",
      customerId: button.getAttribute("data-customer-id") || "",
      masterId: button.getAttribute("data-master-id") || "",
      status: status
    }).then(function() {
      state.loaded = false;
      return loadOperationsData(true);
    }).then(function() {
      setMessage(status === "소개" ? "후보 매물로 표시했습니다." : "보류한 매물로 표시했습니다.", "success");
    }).catch(function(error) {
      button.disabled = false;
      button.textContent = status === "소개" ? "후보등록" : "보류함";
      setMessage(error.message || "고객매칭 상태 저장에 실패했습니다.", "error");
    });
  }

  function loadOperationsData(force) {
    if (state.loading) return Promise.resolve();
    if (state.loaded && !force) return Promise.resolve();
    state.loading = true;
    setMessage("운영자료를 불러오는 중입니다…", "loading");
    return Promise.all([
      apiGet("operationsDashboard"),
      apiGet("customerList"),
      apiGet("customerMatchSummary"),
      apiGet("customerActivities")
    ]).then(function(results) {
      state.dashboard = results[0];
      state.customerHeaders = results[1].headers || [];
      state.customers = results[1].rows || [];
      state.matchSummary = {};
      (results[2].customers || []).forEach(function(item) {
        state.matchSummary[text(item.customerId)] = item;
      });
      state.matches = [];
      state.loadedMatchCustomerId = "";
      state.activityHeaders = results[3].headers || [];
      state.activities = results[3].rows || [];
      state.loaded = true;
      renderDashboard();
      renderCustomers();
      renderMatches(state.selectedCustomerId);
      return loadCustomerMatches(state.selectedCustomerId).then(function() {
        setMessage("자동화 자료가 최신 상태로 연결되었습니다.", "success");
      });
    }).catch(function(error) {
      setMessage(error.message || "운영자료 조회 중 오류가 발생했습니다.", "error");
    }).finally(function() {
      state.loading = false;
    });
  }

  function loadCustomerMatches(customerId) {
    customerId = text(customerId);
    if (!customerId) return Promise.resolve();
    if (state.loadedMatchCustomerId === customerId && !state.matchLoading) return Promise.resolve();
    state.matchLoading = true;
    renderMatches(customerId);
    return apiGet("customerMatches", { customerId: customerId }).then(function(result) {
      if (state.selectedCustomerId !== customerId) return;
      state.matchHeaders = result.headers || [];
      state.matches = result.rows || [];
      state.loadedMatchCustomerId = customerId;
      renderCustomers();
      renderMatches(customerId);
    }).catch(function(error) {
      setMessage(error.message || "선택 고객의 추천매물을 불러오지 못했습니다.", "error");
    }).finally(function() {
      state.matchLoading = false;
      if (state.selectedCustomerId === customerId) renderMatches(customerId);
    });
  }

  window.openOperationsCenter = function(tab) {
    var center = document.getElementById("operationsCenter");
    if (!center) return;
    center.classList.add("open");
    center.setAttribute("aria-hidden", "false");
    document.body.classList.add("operations-center-open");
    window.switchOperationsTab(tab || "dashboard");
    loadOperationsData(true);
  };

  window.closeOperationsCenter = function() {
    var center = document.getElementById("operationsCenter");
    if (!center) return;
    center.classList.remove("open");
    center.setAttribute("aria-hidden", "true");
    document.body.classList.remove("operations-center-open");
  };

  window.switchOperationsTab = function(tab) {
    var isCustomers = tab === "customers";
    var dashboardPanel = document.getElementById("operationsDashboardPanel");
    var customerPanel = document.getElementById("operationsCustomersPanel");
    var dashboardButton = document.getElementById("operationsTabDashboard");
    var customerButton = document.getElementById("operationsTabCustomers");
    if (dashboardPanel) dashboardPanel.hidden = isCustomers;
    if (customerPanel) customerPanel.hidden = !isCustomers;
    if (dashboardButton) dashboardButton.classList.toggle("active", !isCustomers);
    if (customerButton) customerButton.classList.toggle("active", isCustomers);
  };

  window.rebuildCustomerMatchesNow = function() {
    setMessage("전체 고객 조건과 활성 매물을 다시 비교하는 중입니다…", "loading");
    apiPost("rebuildCustomerMatches").then(function(result) {
      state.loaded = false;
      setMessage("재계산 완료: " + number(result.matches).toLocaleString("ko-KR") + "건이 매칭되었습니다.", "success");
      return loadOperationsData(true);
    }).catch(function(error) {
      setMessage(error.message || "고객 매칭 재계산에 실패했습니다.", "error");
    });
  };

  window.showSelectedCustomerMatchesOnMap = function() {
    var customerId = state.selectedCustomerId;
    var rows = state.matches.filter(function(row) {
      return field(row, state.matchHeaders, "고객ID") === customerId;
    });
    var ids = rows.map(function(row) {
      return field(row, state.matchHeaders, "대표매물ID");
    }).filter(Boolean);
    window.operationsMatchPropertyIds = new Set(ids);
    window.operationsMatchStatusByPropertyId = {};
    window.operationsMatchContextByPropertyId = {};
    rows.forEach(function(row) {
      var propertyId = field(row, state.matchHeaders, "대표매물ID");
      if (!propertyId) return;
      window.operationsMatchStatusByPropertyId[propertyId] = matchStatus(row);
      window.operationsMatchContextByPropertyId[propertyId] = {
        matchId: field(row, state.matchHeaders, "매칭ID"),
        customerId: customerId,
        propertyId: propertyId,
        status: matchStatus(row)
      };
    });

    var customerRow = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === customerId;
    });
    var name = customerRow ? field(customerRow, state.customerHeaders, "고객명/상호") : "선택 고객";
    var status = document.getElementById("customerMatchMapStatus");
    var statusText = document.getElementById("customerMatchMapStatusText");
    if (status) status.hidden = false;
    var stats = customerMatchStats(customerId);
    if (statusText) statusText.textContent = name + " · 신규 " + stats.fresh + " · 후보 " + stats.introduced + " · 보류 " + stats.held;

    var matched = (window.allItems || []).filter(function(item) {
      return window.operationsMatchPropertyIds.has(text(item.propertyId));
    });
    if (window.map && window.kakao && matched.length) {
      var bounds = new kakao.maps.LatLngBounds();
      var coordinateCount = 0;
      matched.forEach(function(item) {
        if (!item.latlng) return;
        bounds.extend(item.latlng);
        coordinateCount += 1;
      });
      if (coordinateCount) map.setBounds(bounds);
    }
    window.closeOperationsCenter();
    setTimeout(function() {
      if (typeof window.applyFilter === "function") window.applyFilter();
    }, 180);
  };

  window.clearCustomerMatchMapFilter = function() {
    window.operationsMatchPropertyIds = null;
    window.operationsMatchStatusByPropertyId = {};
    window.operationsMatchContextByPropertyId = {};
    var status = document.getElementById("customerMatchMapStatus");
    if (status) status.hidden = true;
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.openCustomerEditor = function(customerId) {
    var modal = document.getElementById("customerEditorModal");
    var form = document.getElementById("customerEditorForm");
    if (!modal || !form) return;
    var id = text(customerId);
    var row = id ? state.customers.find(function(customer) {
      return field(customer, state.customerHeaders, "고객ID") === id;
    }) : null;
    state.editingCustomerId = row ? id : "";
    form.reset();
    Array.prototype.forEach.call(form.querySelectorAll("[data-customer-field]"), function(input) {
      input.value = row ? field(row, state.customerHeaders, input.getAttribute("data-customer-field")) : "";
    });
    if (!row) {
      var statusInput = form.querySelector('[data-customer-field="상태"]');
      if (statusInput) statusInput.value = "미팅전";
    }
    var title = document.getElementById("customerEditorTitle");
    if (title) title.textContent = row
      ? (field(row, state.customerHeaders, "고객명/상호") + " 정보·조건 수정")
      : "신규 고객 등록";
    var memo = document.getElementById("customerConsultationMemo");
    var nextDate = document.getElementById("customerNextContactDate");
    if (memo) memo.value = "";
    if (nextDate) nextDate.value = "";
    modal.hidden = false;
    document.body.classList.add("customer-crm-open");
    var first = form.querySelector('[data-customer-field="고객명/상호"]');
    if (first) window.setTimeout(function() { first.focus(); }, 50);
  };

  window.closeCustomerEditor = function() {
    var modal = document.getElementById("customerEditorModal");
    if (modal) modal.hidden = true;
    state.editingCustomerId = "";
    document.body.classList.remove("customer-crm-open");
  };

  window.saveCustomerFromWeb = function(event) {
    event.preventDefault();
    var form = document.getElementById("customerEditorForm");
    var button = document.getElementById("customerEditorSaveBtn");
    if (!form || !button) return;
    var customer = {};
    Array.prototype.forEach.call(form.querySelectorAll("[data-customer-field]"), function(input) {
      customer[input.getAttribute("data-customer-field")] = input.value;
    });
    button.disabled = true;
    button.textContent = "저장·매칭 중…";
    setMessage("고객정보를 저장하고 전체 매물과 바로 비교하고 있습니다…", "loading");
    apiPost("saveCustomer", {
      customerId: state.editingCustomerId,
      customer: customer,
      consultationMemo: text(document.getElementById("customerConsultationMemo") && document.getElementById("customerConsultationMemo").value),
      nextContactDate: text(document.getElementById("customerNextContactDate") && document.getElementById("customerNextContactDate").value)
    }).then(function(result) {
      state.selectedCustomerId = result.customerId || state.selectedCustomerId;
      state.loaded = false;
      window.closeCustomerEditor();
      return loadOperationsData(true);
    }).then(function() {
      state.customerView = "active";
      renderCustomers();
      renderMatches(state.selectedCustomerId);
      setMessage("고객정보 저장과 즉시 재매칭이 완료됐습니다.", "success");
    }).catch(function(error) {
      setMessage(error.message || "고객정보 저장에 실패했습니다.", "error");
    }).finally(function() {
      button.disabled = false;
      button.textContent = "저장 후 바로 매칭";
    });
  };

  window.openCustomerActivity = function(customerId) {
    var id = text(customerId) || state.selectedCustomerId;
    if (!id) return;
    state.selectedCustomerId = id;
    var customer = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === id;
    });
    var title = document.getElementById("customerActivityTitle");
    if (title) title.textContent = (customer ? field(customer, state.customerHeaders, "고객명/상호") : "고객") + " 상담·미팅 기록";
    var modal = document.getElementById("customerActivityModal");
    var stage = document.getElementById("customerActivityStage");
    var memo = document.getElementById("customerActivityMemo");
    var nextDate = document.getElementById("customerActivityNextDate");
    if (stage) stage.value = "상담";
    if (memo) memo.value = "";
    if (nextDate) nextDate.value = "";
    if (modal) modal.hidden = false;
    document.body.classList.add("customer-crm-open");
  };

  window.closeCustomerActivity = function() {
    var modal = document.getElementById("customerActivityModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("customer-crm-open");
  };

  window.saveCustomerActivity = function(event) {
    event.preventDefault();
    var button = document.getElementById("customerActivitySaveBtn");
    if (!button) return;
    button.disabled = true;
    button.textContent = "저장 중…";
    apiPost("addCustomerActivity", {
      customerId: state.selectedCustomerId,
      stage: text(document.getElementById("customerActivityStage") && document.getElementById("customerActivityStage").value),
      memo: text(document.getElementById("customerActivityMemo") && document.getElementById("customerActivityMemo").value),
      nextContactDate: text(document.getElementById("customerActivityNextDate") && document.getElementById("customerActivityNextDate").value)
    }).then(function() {
      state.loaded = false;
      window.closeCustomerActivity();
      return loadOperationsData(true);
    }).then(function() {
      setMessage("상담기록과 다음 연락·미팅일을 저장했습니다.", "success");
    }).catch(function(error) {
      setMessage(error.message || "상담기록 저장에 실패했습니다.", "error");
    }).finally(function() {
      button.disabled = false;
      button.textContent = "기록 저장";
    });
  };

  window.updateCustomerMatchFromMap = function(propertyId, nextStatus) {
    var context = window.operationsMatchContextByPropertyId[text(propertyId)];
    if (!context || !context.matchId) return Promise.reject(new Error("고객 매칭정보를 찾지 못했습니다."));
    return apiPost("updateCustomerMatch", {
      matchId: context.matchId,
      customerId: context.customerId,
      masterId: context.propertyId,
      status: nextStatus
    }).then(function() {
      var oldStatus = context.status;
      context.status = nextStatus;
      window.operationsMatchStatusByPropertyId[text(propertyId)] = nextStatus;
      state.loaded = false;
      var matchedRow = state.matches.find(function(row) {
        return field(row, state.matchHeaders, "매칭ID") === context.matchId;
      });
      var statusIndex = headerIndex(state.matchHeaders, "진행상태");
      if (matchedRow && statusIndex >= 0) matchedRow[statusIndex] = nextStatus;
      adjustMatchSummary(context.customerId, oldStatus, nextStatus);
      if (typeof window.applyFilter === "function") window.applyFilter();
      return nextStatus;
    });
  };

  function refreshCustomerAlertBadge() {
    apiGet("operationsDashboard").then(function(data) {
      var button = document.getElementById("operationsCustomerMenuBtn");
      if (!button) return;
      var alerts = number(data.newMatches) + number(data.dueFollowups);
      button.textContent = alerts ? "고객매칭 · 알림 " + alerts.toLocaleString("ko-KR") : "고객매칭";
      button.classList.toggle("has-alert", alerts > 0);
    }).catch(function() {});
  }

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      window.closeCustomerEditor();
      window.closeCustomerActivity();
      window.closeOperationsCenter();
    }
  });
  window.setTimeout(refreshCustomerAlertBadge, 1200);
})();
