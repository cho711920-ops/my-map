(function() {
  "use strict";

  var OPERATIONS_CACHE_KEY = "js_operations_fast_cache_v1";
  var OPERATIONS_CACHE_MAX_AGE = 10 * 60 * 1000;
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
    matchSourceFilter: "",
    matchTypeFilter: "",
    matchFloorFilter: "",
    matchSort: "score",
    customerView: "before",
    editingCustomerId: "",
    viewingMemoCustomerId: "",
    activeTab: "dashboard",
    customerLoaded: false,
    customerListLoaded: false,
    dashboardLoaded: false,
    rebuilding: false,
    alertPollTimer: null,
    alertFingerprint: "",
    alertCounts: [0, 0, 0],
    dismissedAlertKey: "",
    dismissedAlertFingerprint: "",
    dismissedAlertCounts: null,
    lastCustomerWorkspace: null,
    customerPrefetchPromise: null,
    loadPromise: null,
    customerWorkspaceEpoch: 0,
    customerConditionRefreshV727: { customerId: "", status: "idle" },
    customerEditorCloseTimerV727: null,
    customerEditorCloseResolveV727: null
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

  window.addEventListener("js-async-mutation-finished", function(event) {
    var detail = event && event.detail || {};
    if (["updateCustomerMatch", "addCustomerActivity"].indexOf(detail.action) < 0) return;
    if (!detail.ok) {
      setMessage(
        (detail.error || "백그라운드 고객 저장에 실패했습니다.") +
          " 작업상태에서 다시 시도할 수 있습니다.",
        "error"
      );
      state.loaded = false;
      loadOperationsData(true);
      return;
    }
    state.loaded = false;
    loadOperationsData(true);
  });

  function persistOperationsCache() {
    try {
      sessionStorage.setItem(OPERATIONS_CACHE_KEY, JSON.stringify({
        at: Date.now(),
        dashboard: state.dashboard,
        customerWorkspace: state.lastCustomerWorkspace
      }));
    } catch (_) {}
  }

  function dashboardCard(label, value, hint, tone, actionTarget) {
    var actionable = Boolean(actionTarget);
    var reviews = actionTarget === "reviews";
    var tag = actionable ? "button" : "article";
    var action = actionable
      ? (reviews
        ? ' type="button" onclick="switchOperationsTab(\'reviews\')"'
        : ' type="button" onclick="openCustomerWorkQueue(\'' + escape(actionTarget) + '\')"')
      : "";
    return '<' + tag + action + ' class="operations-stat-card ' + (tone || "") +
      (actionable ? ' actionable' : '') + '">' +
      '<span>' + escape(label) + '</span>' +
      '<strong>' + number(value).toLocaleString("ko-KR") + '</strong>' +
      '<small>' + escape(hint) + '</small>' +
      (actionable ? '<em>' + (reviews ? '매물검증 바로 보기 →' : '해당 고객 바로 보기 →') + '</em>' : '') +
      '</' + tag + '>';
  }

  function renderDashboard() {
    var panel = document.getElementById("operationsDashboardPanel");
    if (!panel) return;
    var data = state.dashboard || {};
    var reviewCount = data.pendingReview != null ? data.pendingReview : data.review;
    var activeCount = data.activeMaster != null ? data.activeMaster : data.master;
    var cleanup = data.lastCompaction || {};
    var cleanupRemoved = number(cleanup.rawRemoved) + number(cleanup.reviewRemoved);
    var hasCurrentListings = number(activeCount) > 0 || number(data.raw) > 0;
    var cleanupHint = cleanup.at && hasCurrentListings
      ? cleanup.at + " · 원본 " + number(cleanup.rawRemaining).toLocaleString("ko-KR") + "건 유지"
      : (hasCurrentListings ? "매일 새벽 4시 자동 중복정리" : "현재 초기화된 빈 상태");
    panel.innerHTML =
      '<div class="operations-stat-grid">' +
        dashboardCard("활성 통합매물", activeCount, "JS웹에 표시되는 실제 공간", "primary") +
        dashboardCard("검증 대기", reviewCount, "사람의 판단이 필요한 원본", reviewCount ? "warning" : "success", "reviews") +
        dashboardCard("수집 원본", data.raw, "출처별 원본 스냅샷", "") +
        dashboardCard("고객 문의", data.openCustomers != null ? data.openCustomers : data.customers, "진행 중인 고객 조건", "", "active") +
        dashboardCard("신규 고객매칭", data.newMatches != null ? data.newMatches : data.matches, "아직 후보·보류로 정하지 않은 추천", data.newMatches ? "primary" : "", "new") +
        dashboardCard("미연락 경고", data.overdueMatches, (data.contactReminderDays || 3) + "일 이상 연락기록 없는 신규 추천", data.overdueMatches ? "warning" : "success", "overdue") +
        dashboardCard("오늘 후속관리", data.dueFollowups, "다음 연락·미팅일이 된 고객", data.dueFollowups ? "warning" : "success", "due") +
        dashboardCard("거래확인 후보", data.transactionCheckCandidates, "전체수집 3회 연속 미노출된 보류매물", data.transactionCheckCandidates ? "warning" : "success") +
        dashboardCard("후보 매물", data.introducedMatches, "고객이 후보로 선택한 매물", "success") +
        dashboardCard("변경 이력", data.history, "수정·통합·상태변경 기록", "") +
        dashboardCard("최근 자동정리", cleanupRemoved, cleanupHint, cleanup.at && hasCurrentListings ? "success" : "") +
      '</div>' +
      '<div class="operations-workflow-card">' +
        '<div><b>자동 처리 흐름</b><span>출처별 원본 보존 → 동일 공간 연결/검증 → 통합매물 표시 → 고객 재매칭</span></div>' +
        '<div class="operations-source-priority"><span>원본 보존 방식</span><b>당근 · 네이버 · 공실박스 링크와 조건을 각각 보존</b></div>' +
      '</div>' +
      '<div class="operations-guidance">' +
        '<b>사람이 확인할 일은 두 가지뿐입니다.</b>' +
        '<p>매물검증의 애매한 동일 공간만 결정하세요. 고객 등록·조건수정·후속관리는 이 화면에서 처리하고, 통합매물 연결·이력·재매칭은 자동으로 처리됩니다.</p>' +
      '</div>';
  }
  window.JSOperationsDiagnosticsV7151 = {
    dashboardCard: dashboardCard,
    getDashboard: function() { return state.dashboard; }
  };

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

  function customerFollowup(customerId) {
    var rows = state.activities.filter(function(row) {
      return field(row, state.activityHeaders, "고객ID") === customerId &&
        field(row, state.activityHeaders, "다음연락일");
    });
    var row = rows.length ? rows[rows.length - 1] : null;
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

  function customerConditionTextV719(row) {
    var parts = [];
    var region = field(row, state.customerHeaders, "희망지역");
    var depositMax = number(field(row, state.customerHeaders, "보증금최대"));
    var rentMax = number(field(row, state.customerHeaders, "월세최대"));
    var category = field(row, state.customerHeaders, "희망구분");
    var maxFloor = field(row, state.customerHeaders, "최고층");
    if (region) parts.push(region);
    if (depositMax) parts.push("보증금 " + depositMax.toLocaleString("ko-KR") + " 이하");
    if (rentMax) parts.push("월세 " + rentMax.toLocaleString("ko-KR") + " 이하");
    if (category) parts.push(category);
    if (maxFloor) parts.push(maxFloor + "층 이하");
    return parts.join(" · ") || "등록된 조건 전체";
  }

  function resetMatchListingFiltersV719() {
    state.matchSourceFilter = "";
    state.matchTypeFilter = "";
    state.matchFloorFilter = "";
    state.matchSort = "score";
    state.matchStatusFilter = "all";
  }

  function renderCustomers() {
    var list = document.getElementById("operationsCustomerList");
    if (!list) return;
    if (!state.customers.length) {
      list.innerHTML = '<div class="operations-empty"><b>등록된 고객이 없습니다.</b><span>고객 추가 버튼으로 첫 고객을 등록해주세요.</span></div>';
      renderMatches("");
      return;
    }
    var search = text(state.customerSearch).toLowerCase();
    var activeCount = state.customers.filter(function(row) { return !isArchivedCustomer(row); }).length;
    var archivedCount = state.customers.length - activeCount;
    var beforeMeetingCount = state.customers.filter(function(row) { return field(row, state.customerHeaders, "상태") === "미팅전"; }).length;
    var afterMeetingCount = state.customers.filter(function(row) { return field(row, state.customerHeaders, "상태") === "미팅후"; }).length;
    var pausedCount = state.customers.filter(function(row) { return field(row, state.customerHeaders, "상태") === "보류"; }).length;
    var newCustomerCount = state.customers.filter(function(row) {
      return !isArchivedCustomer(row) && customerMatchStats(field(row, state.customerHeaders, "고객ID")).fresh > 0;
    }).length;
    var overdueCustomerCount = state.customers.filter(function(row) {
      return !isArchivedCustomer(row) && customerMatchStats(field(row, state.customerHeaders, "고객ID")).overdue > 0;
    }).length;
    var dueCustomerCount = state.customers.filter(function(row) {
      return !isArchivedCustomer(row) && customerFollowup(field(row, state.customerHeaders, "고객ID")).due;
    }).length;
    var filteredCustomers = state.customers.filter(function(row) {
      if (state.customerView === "active" && isArchivedCustomer(row)) return false;
      if (state.customerView === "before" && field(row, state.customerHeaders, "상태") !== "미팅전") return false;
      if (state.customerView === "after" && field(row, state.customerHeaders, "상태") !== "미팅후") return false;
      if (state.customerView === "paused" && field(row, state.customerHeaders, "상태") !== "보류") return false;
      if (state.customerView === "archived" && !isArchivedCustomer(row)) return false;
      if (state.customerView === "new" &&
          (isArchivedCustomer(row) || customerMatchStats(field(row, state.customerHeaders, "고객ID")).fresh <= 0)) return false;
      if (state.customerView === "overdue" &&
          (isArchivedCustomer(row) || customerMatchStats(field(row, state.customerHeaders, "고객ID")).overdue <= 0)) return false;
      if (state.customerView === "due" &&
          (isArchivedCustomer(row) || !customerFollowup(field(row, state.customerHeaders, "고객ID")).due)) return false;
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
    list.innerHTML = '<div class="operations-customer-list-heading-v719"><div><b>① 고객 목록</b><span>고객 현황을 한눈에 확인</span></div><strong>총 ' + state.customers.length.toLocaleString("ko-KR") + '명</strong></div>' +
      '<div class="operations-customer-tools"><input id="operationsCustomerSearch" type="search" placeholder="고객명 · 지역 · 연락처 검색" value="' + escape(state.customerSearch) + '"><span>' + filteredCustomers.length.toLocaleString("ko-KR") + '명</span></div>' +
      '<div class="operations-customer-views">' +
        customerViewButton("before", "미팅전", beforeMeetingCount) +
        customerViewButton("after", "미팅후", afterMeetingCount) +
        customerViewButton("paused", "보류", pausedCount) +
      '</div>' +
      '<div class="operations-customer-grid">' + (filteredCustomers.length ? filteredCustomers.map(function(row) {
      var id = field(row, state.customerHeaders, "고객ID");
      var name = field(row, state.customerHeaders, "고객명/상호") || "이름 미입력";
      var status = field(row, state.customerHeaders, "상태") || "미팅전";
      var region = field(row, state.customerHeaders, "희망지역") || "지역 전체";
      var request = field(row, state.customerHeaders, "요청사항");
      var stats = customerMatchStats(id);
      var followup = customerFollowup(id);
      var selected = id === state.selectedCustomerId ? " selected" : "";
      var alertClass = stats.overdue || followup.due ? " has-overdue" : "";
      return '<article tabindex="0" role="button" class="operations-customer-card' + selected + alertClass + '" data-customer-id="' + escape(id) + '">' +
        '<span class="operations-customer-avatar-v719">' + escape(name.charAt(0) || "고") + '</span>' +
        '<span class="operations-customer-status">' + escape(status) + '</span>' +
        '<strong>' + escape(name) + ' <small>' + escape(region) + '</small></strong>' +
        '<div class="operations-customer-meta-v720">' +
          '<span class="operations-customer-condition-v719">' + escape(customerConditionTextV719(row)) + '</span>' +
        '</div>' +
        (request ? '<small>' + escape(request) + '</small>' : '') +
        '<div class="operations-customer-stats-v719"><b>매칭 ' + stats.total.toLocaleString("ko-KR") + '</b><span>신규 ' + stats.fresh.toLocaleString("ko-KR") + '</span><em>후보 ' + stats.introduced.toLocaleString("ko-KR") + '</em><u>보류 ' + stats.held.toLocaleString("ko-KR") + '</u></div>' +
        (stats.overdue ? '<i>미연락 경고 ' + stats.overdue.toLocaleString("ko-KR") + '건</i>' : '') +
        (followup.next ? '<i class="' + (followup.due ? "due" : "scheduled") + '">다음 ' + escape(followup.next) + '</i>' : '') +
      '</article>';
    }).join("") : '<div class="operations-customer-view-empty">이 업무에 해당하는 고객이 없습니다.</div>') + '</div>';
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
        resetMatchListingFiltersV719();
        state.matches = [];
        state.loadedMatchCustomerId = "";
        renderCustomers();
        renderMatches(state.selectedCustomerId);
        loadCustomerMatches(state.selectedCustomerId);
      });
      button.addEventListener("keydown", function(event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          button.click();
        }
      });
    });
    if (!filteredCustomers.length) {
      state.selectedCustomerId = "";
      renderMatches("");
    } else if ((!state.selectedCustomerId || !filteredCustomers.some(function(row) {
      return field(row, state.customerHeaders, "고객ID") === state.selectedCustomerId;
    }))) {
      state.selectedCustomerId = field(filteredCustomers[0], state.customerHeaders, "고객ID");
      renderCustomers();
      renderMatches(state.selectedCustomerId);
      if (!state.loading) loadCustomerMatches(state.selectedCustomerId);
    }
  }

  function customerViewButton(key, label, count) {
    return '<button type="button" class="' + (state.customerView === key ? "active" : "") +
      '" onclick="setCustomerView(\'' + key + '\')">' + label + ' <b>' +
      Number(count || 0).toLocaleString("ko-KR") + '</b></button>';
  }

  window.setCustomerView = function(view) {
    state.customerView = view || "before";
    renderCustomers();
  };

  window.openCustomerWorkQueue = function(view) {
    window.closeCustomerWorkAlert();
    state.customerView = view || "active";
    state.activeTab = "customers";
    var center = document.getElementById("operationsCenter");
    if (center && center.classList.contains("open")) {
      window.switchOperationsTab("customers");
      loadOperationsData(false);
    } else {
      window.openOperationsCenter("customers");
    }
  };

  window.updateCustomerStatusFromWeb = function(nextStatus) {
    var customerId = state.selectedCustomerId;
    var customer = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === customerId;
    });
    var allowed = ["미팅전", "미팅후", "보류", "계약완료", "종료"];
    if (!customer || allowed.indexOf(nextStatus) < 0) return;
    var previousStatus = field(customer, state.customerHeaders, "상태") || "미팅전";
    if (previousStatus === nextStatus) return;
    var input = {};
    state.customerHeaders.slice(0, 19).forEach(function(header, index) {
      input[header] = customer[index];
    });
    input["상태"] = nextStatus;
    var select = document.querySelector(".customer-status-quick select");
    if (select) select.disabled = true;
    setMessage("고객 상태를 " + nextStatus + "(으)로 변경하고 있습니다…", "loading");
    apiPost("saveCustomer", {
      customerId: customerId,
      customer: input,
      consultationMemo: "고객 상태 변경: " + previousStatus + " → " + nextStatus,
      nextContactDate: ""
    }).then(function(result) {
      if (result.workspace) applyCustomerWorkspace(result.workspace);
      state.customerView = nextStatus === "미팅후" ? "after" : nextStatus === "보류" ? "paused" : "before";
      state.selectedCustomerId = result.customerId || customerId;
      renderCustomers();
      renderMatches(state.selectedCustomerId);
      setMessage(nextStatus === "종료"
        ? "고객을 종료 보관함으로 이동했습니다. 후보·보류 기록은 유지됩니다."
        : nextStatus === "계약완료"
          ? "계약완료 고객으로 보관했습니다. 필요하면 다시 진행 상태로 바꿀 수 있습니다."
          : "고객 상태를 " + nextStatus + "(으)로 변경했습니다.", "success");
    }).catch(function(error) {
      if (select) {
        select.value = previousStatus;
        select.disabled = false;
      }
      setMessage(error.message || "고객 상태 변경에 실패했습니다.", "error");
    });
  };

  function getProperty(propertyId) {
    return (window.allItems || []).find(function(item) {
      return text(item.propertyId) === text(propertyId);
    }) || null;
  }

  function matchPropertySourceV719(property) {
    var sourceTypes = property && Array.isArray(property.sourceTypesV8) ? property.sourceTypesV8 : [];
    var source = text(property && property.source).toLowerCase();
    if (sourceTypes.indexOf("danggeun") >= 0 || /당근|daangn|karrot/.test(source)) return "danggeun";
    if (sourceTypes.indexOf("naver") >= 0 || /네이버|naver/.test(source)) return "naver";
    if (sourceTypes.indexOf("gongsil") >= 0 || /공실박스|gongsil/.test(source)) return "gongsil";
    if (sourceTypes.indexOf("direct") >= 0 || /직접|현장/.test(source)) return "direct";
    return "unknown";
  }

  function matchPropertyFloorV719(property) {
    var source = text(property && (property.room || property.floor));
    var basement = source.match(/B\s*(\d+)|지하\s*(\d*)/i);
    if (basement) return "basement";
    var floor = source.match(/(-?\d+)\s*층/);
    var value = floor ? Number(floor[1]) : Number(property && property.floor);
    if (!isFinite(value) || !value) return "unknown";
    if (value < 0) return "basement";
    if (value === 1) return "first";
    return "upper";
  }

  function matchSelectOptionsV719(options, selected) {
    return options.map(function(option) {
      return '<option value="' + escape(option[0]) + '"' + (option[0] === selected ? ' selected' : '') + '>' + escape(option[1]) + '</option>';
    }).join("");
  }

  function renderCustomerMatchListingCardsV719(target, rows, customerId) {
    if (!target) return;
    var fragment = document.createDocumentFragment();
    rows.forEach(function(row) {
      var propertyId = field(row, state.matchHeaders, "대표매물ID");
      var property = getProperty(propertyId);
      if (!property) {
        var missing = document.createElement("article");
        missing.className = "operations-match-missing-v719";
        missing.innerHTML = '<b>' + escape(propertyId || "매물ID 없음") + '</b><span>지도 매물자료를 다시 불러오면 상세정보가 연결됩니다.</span>';
        fragment.appendChild(missing);
        return;
      }
      var context = {
        matchId: field(row, state.matchHeaders, "매칭ID"),
        customerId: customerId,
        propertyId: propertyId,
        status: matchStatus(row)
      };
      if (typeof window.renderCustomerMatchListingCardV719 === "function") {
        window.renderCustomerMatchListingCardV719(fragment, property, context);
      }
    });
    target.appendChild(fragment);
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
    }).filter(function(row) {
      var property = getProperty(field(row, state.matchHeaders, "대표매물ID"));
      if (!property) return true;
      if (state.matchSourceFilter && matchPropertySourceV719(property) !== state.matchSourceFilter) return false;
      if (state.matchTypeFilter && text(property.type) !== state.matchTypeFilter) return false;
      if (state.matchFloorFilter && matchPropertyFloorV719(property) !== state.matchFloorFilter) return false;
      return true;
    });
    var customerRow = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === customerId;
    });
    var customerName = customerRow ? field(customerRow, state.customerHeaders, "고객명/상호") : "선택 고객";
    var customerPhone = customerRow ? field(customerRow, state.customerHeaders, "연락처") : "";
    var customerStatus = customerRow ? field(customerRow, state.customerHeaders, "상태") || "미팅전" : "미팅전";
    var phoneHref = customerPhone ? "tel:" + customerPhone.replace(/[^0-9+]/g, "") : "";
    var overdueCount = allRows.filter(isOverdueMatch).length;
    var followup = customerFollowup(customerId);
    rows.sort(function(a, b) {
      var propertyA = getProperty(field(a, state.matchHeaders, "대표매물ID")) || {};
      var propertyB = getProperty(field(b, state.matchHeaders, "대표매물ID")) || {};
      if (state.matchSort === "latest") return text(propertyB.regDate).localeCompare(text(propertyA.regDate));
      if (state.matchSort === "rentLow") return number(propertyA.rent) - number(propertyB.rent);
      if (state.matchSort === "address") return text(propertyA.address).localeCompare(text(propertyB.address), "ko", {numeric: true});
      return number(field(b, state.matchHeaders, "점수")) - number(field(a, state.matchHeaders, "점수"));
    });
    var typeOptions = {};
    allRows.forEach(function(row) {
      var property = getProperty(field(row, state.matchHeaders, "대표매물ID"));
      if (property && text(property.type)) typeOptions[text(property.type)] = true;
    });
    var header = (overdueCount ? '<div class="operations-customer-alert"><b>새 매물 안내 필요</b><span>신규매물 ' + overdueCount.toLocaleString("ko-KR") + '건이 ' + (number(state.dashboard && state.dashboard.contactReminderDays) || 3) + '일 이상 확인되지 않았습니다.</span></div>' : '') +
      (followup.due ? '<div class="operations-customer-alert"><b>후속관리 예정일</b><span>' + escape(followup.next) + ' · ' + escape(followup.stage || "상담") + '</span></div>' : '') +
      '<div class="operations-match-heading"><div class="operations-match-customer-v719"><span class="operations-match-avatar-v719">' + escape(customerName.charAt(0) || "고") + '</span><div><b>② ' + escape(customerName) + ' 고객 매칭매물</b></div></div>' +
      '<div class="operations-match-heading-actions">' +
      (phoneHref ? '<a class="customer-call-link" href="' + escape(phoneHref) + '" aria-label="' + escape(customerName + "에게 전화") + '">☎ ' + escape(customerPhone) + '</a>' : '') +
      '<label class="customer-status-quick"><span>고객상태</span><select onchange="updateCustomerStatusFromWeb(this.value)">' +
        ["미팅전", "미팅후", "보류", "계약완료", "종료"].map(function(status) {
          return '<option value="' + status + '"' + (status === customerStatus ? ' selected' : '') + '>' + status + '</option>';
        }).join("") +
      '</select></label>' +
      '<button type="button" onclick="openCustomerMemo(\'' + escape(customerId) + '\')">상담·미팅 메모</button>' +
      '<button type="button" onclick="openCustomerEditor(\'' + escape(customerId) + '\')">조건 수정</button>' +
      '<button type="button" onclick="showSelectedCustomerMatchesOnMap()"' + (allRows.length ? '' : ' disabled') + '>지도에서 보기</button></div></div>' +
      customerConditionRefreshHtmlV727(customerId) +
      '<div class="operations-match-listing-toolbar-v719">' +
        '<select aria-label="출처 필터" onchange="setCustomerMatchListingFilterV719(\'source\',this.value)">' + matchSelectOptionsV719([["","출처"],["danggeun","당근"],["naver","네이버"],["gongsil","공실박스"],["direct","직접등록"]], state.matchSourceFilter) + '</select>' +
        '<select aria-label="구분 필터" onchange="setCustomerMatchListingFilterV719(\'type\',this.value)">' + matchSelectOptionsV719([["","구분"]].concat(Object.keys(typeOptions).sort().map(function(type) { return [type, type]; })), state.matchTypeFilter) + '</select>' +
        '<select aria-label="층 필터" onchange="setCustomerMatchListingFilterV719(\'floor\',this.value)">' + matchSelectOptionsV719([["","층"],["basement","지하"],["first","1층"],["upper","2층 이상"],["unknown","층 미확인"]], state.matchFloorFilter) + '</select>' +
        '<select aria-label="정렬" onchange="setCustomerMatchListingFilterV719(\'sort\',this.value)">' + matchSelectOptionsV719([["score","추천순"],["latest","최신등록"],["rentLow","월세 낮은순"],["address","주소순"]], state.matchSort) + '</select>' +
        '<button type="button" onclick="resetCustomerMatchListingFiltersV719()">전체 매물 보기</button>' +
        '<strong>' + counts.all.toLocaleString("ko-KR") + '건 <span>매칭 · 신규 ' + counts.fresh.toLocaleString("ko-KR") + ' · 후보 ' + counts.introduced.toLocaleString("ko-KR") + ' · 보류 ' + counts.held.toLocaleString("ko-KR") + '</span></strong>' +
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
    list.innerHTML = header + '<div id="operationsMatchCardsV719" class="operations-match-listing-cards-v719"></div>';
    renderCustomerMatchListingCardsV719(document.getElementById("operationsMatchCardsV719"), rows, customerId);
  }

  window.setCustomerMatchListingFilterV719 = function(kind, value) {
    if (kind === "source") state.matchSourceFilter = value || "";
    if (kind === "type") state.matchTypeFilter = value || "";
    if (kind === "floor") state.matchFloorFilter = value || "";
    if (kind === "sort") state.matchSort = value || "score";
    renderMatches(state.selectedCustomerId);
  };

  window.resetCustomerMatchListingFiltersV719 = function() {
    resetMatchListingFiltersV719();
    renderMatches(state.selectedCustomerId);
  };

  function matchFilterButton(key, label, count) {
    return '<button type="button" class="' + (state.matchStatusFilter === key ? 'active' : '') + '" onclick="setCustomerMatchStatusFilter(\'' + key + '\')">' + label + ' <b>' + Number(count || 0).toLocaleString("ko-KR") + '</b></button>';
  }

  window.setCustomerMatchStatusFilter = function(filter) {
    state.matchStatusFilter = filter || "all";
    renderMatches(state.selectedCustomerId);
  };

  function commitCustomerMatchStatusV719(matchId, customerId, propertyId, status) {
    var matchedRow = state.matches.find(function(row) {
      return field(row, state.matchHeaders, "매칭ID") === matchId;
    });
    var statusIndex = headerIndex(state.matchHeaders, "진행상태");
    var oldStatus = matchedRow ? matchStatus(matchedRow) : "신규";
    if (matchedRow && statusIndex >= 0) matchedRow[statusIndex] = status;
    adjustMatchSummary(customerId, oldStatus, status);
    renderCustomers();
    renderMatches(customerId);
    setMessage(status === "소개" ? "후보로 표시하고 저장 중입니다…" : status === "보류" ? "보류로 표시하고 저장 중입니다…" : "신규 상태로 되돌리고 저장 중입니다…", "loading");
    return apiPost("updateCustomerMatch", {
      matchId: matchId,
      customerId: customerId,
      masterId: propertyId,
      status: status
    }).then(function(result) {
      var resolvedMatchId = text(result && result.matchId) || matchId;
      var matchIdIndex = headerIndex(state.matchHeaders, "매칭ID");
      if (matchedRow && matchIdIndex >= 0) matchedRow[matchIdIndex] = resolvedMatchId;
      setMessage(status === "소개" ? "후보 매물로 표시했습니다." : status === "보류" ? "보류한 매물로 표시했습니다." : "신규 매물 상태로 되돌렸습니다.", "success");
      return result;
    }).catch(function(error) {
      if (matchedRow && statusIndex >= 0) matchedRow[statusIndex] = oldStatus;
      adjustMatchSummary(customerId, status, oldStatus);
      renderCustomers();
      renderMatches(customerId);
      setMessage(error.message || "고객매칭 상태 저장에 실패했습니다.", "error");
      throw error;
    });
  }

  function updateCustomerMatchStatus(button) {
    return commitCustomerMatchStatusV719(
      button.getAttribute("data-match-id") || "",
      button.getAttribute("data-customer-id") || "",
      button.getAttribute("data-master-id") || "",
      button.getAttribute("data-match-action") || ""
    );
  }

  window.handleOperationsCustomerMatchToggleV719 = function(input, encodedMatchId, encodedCustomerId, encodedPropertyId, selectedStatus) {
    var matchId = decodeURIComponent(encodedMatchId || "");
    var customerId = decodeURIComponent(encodedCustomerId || "");
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var matchedRow = state.matches.find(function(row) {
      return field(row, state.matchHeaders, "매칭ID") === matchId;
    });
    var oldStatus = matchedRow ? matchStatus(matchedRow) : "신규";
    var nextStatus = input && input.checked ? selectedStatus : (oldStatus === selectedStatus ? "신규" : oldStatus);
    if (!matchId || !customerId || !propertyId || nextStatus === oldStatus) return;
    if (input) input.disabled = true;
    commitCustomerMatchStatusV719(matchId, customerId, propertyId, nextStatus).catch(function() {
      if (input && input.isConnected) {
        input.disabled = false;
        input.checked = oldStatus === selectedStatus;
      }
    });
  };

  function applyCustomerWorkspace(result, requestEpoch) {
    if (requestEpoch != null && requestEpoch !== state.customerWorkspaceEpoch) return false;
    state.lastCustomerWorkspace = result;
    state.dashboard = Object.assign({}, state.dashboard || {}, {
      contactReminderDays: number(result.contactReminderDays) || 3
    });
    state.customerHeaders = result.customerHeaders || [];
    state.customers = result.customers || [];
    state.matchSummary = {};
    (result.matchSummary || []).forEach(function(item) {
      state.matchSummary[text(item.customerId)] = item;
    });
    state.activityHeaders = result.activityHeaders || [];
    state.activities = result.activities || [];
    state.matchHeaders = result.matchHeaders || [];
    state.matches = result.matches || [];
    state.selectedCustomerId = text(result.selectedCustomerId) || state.selectedCustomerId;
    state.loadedMatchCustomerId = state.selectedCustomerId;
    state.customerLoaded = true;
    state.customerListLoaded = true;
    state.loaded = true;
    renderCustomers();
    renderMatches(state.selectedCustomerId);
    persistOperationsCache();
    return true;
  }

  function applyCompactCustomerSaveV723(result, fallbackCustomerId) {
    var customerId = text(result && result.customerId) || text(fallbackCustomerId);
    if (!customerId || !result || !result.customerRow) return false;
    var rowIndex = state.customers.findIndex(function(row) {
      return field(row, state.customerHeaders, "고객ID") === customerId;
    });
    if (rowIndex >= 0) state.customers[rowIndex] = result.customerRow;
    else state.customers.push(result.customerRow);
    if (result.matchHeaders) state.matchHeaders = result.matchHeaders;
    if (result.matches) {
      state.matches = result.matches;
      state.loadedMatchCustomerId = customerId;
    }
    if (result.matchSummary) {
      state.matchSummary = {};
      result.matchSummary.forEach(function(item) {
        state.matchSummary[text(item.customerId)] = item;
      });
    }
    if (result.activityRow) state.activities.push(result.activityRow);
    state.selectedCustomerId = customerId;
    return true;
  }

  function customerConditionRefreshHtmlV727(customerId) {
    var refresh = state.customerConditionRefreshV727 || {};
    if (!customerId || text(refresh.customerId) !== text(customerId) || refresh.status === "idle") return "";
    if (refresh.status === "error") {
      return '<div class="customer-condition-refresh-v727 is-error" role="status" aria-live="assertive">' +
        '<strong>조건변경 저장을 확인하지 못했습니다. 조건 창을 다시 확인해 주세요.</strong></div>';
    }
    return '<div class="customer-condition-refresh-v727 is-active" role="status" aria-live="polite">' +
      '<span class="customer-condition-refresh-pulse-v727" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<strong>조건변경 저장 후 새로운 매물 업데이트 중</strong></div>';
  }

  function setCustomerConditionRefreshV727(customerId, status) {
    state.customerConditionRefreshV727 = {
      customerId: text(customerId),
      status: status || "idle"
    };
  }

  function cancelCustomerEditorCloseAnimationV727() {
    if (state.customerEditorCloseTimerV727) {
      window.clearTimeout(state.customerEditorCloseTimerV727);
      state.customerEditorCloseTimerV727 = null;
    }
    var modal = document.getElementById("customerEditorModal");
    if (modal) modal.classList.remove("customer-crm-modal-closing-v727");
    if (state.customerEditorCloseResolveV727) {
      state.customerEditorCloseResolveV727();
      state.customerEditorCloseResolveV727 = null;
    }
  }

  function closeCustomerEditorAnimatedV727() {
    var modal = document.getElementById("customerEditorModal");
    if (!modal || modal.hidden) return Promise.resolve();
    cancelCustomerEditorCloseAnimationV727();
    modal.classList.add("customer-crm-modal-closing-v727");
    state.editingCustomerId = "";
    document.body.classList.remove("customer-crm-open");
    return new Promise(function(resolve) {
      state.customerEditorCloseResolveV727 = resolve;
      state.customerEditorCloseTimerV727 = window.setTimeout(function() {
        state.customerEditorCloseTimerV727 = null;
        modal.hidden = true;
        modal.classList.remove("customer-crm-modal-closing-v727");
        if (state.customerEditorCloseResolveV727) {
          state.customerEditorCloseResolveV727();
          state.customerEditorCloseResolveV727 = null;
        }
      }, 240);
    });
  }

  function waitForCustomerConditionFeedbackV727(closePromise, startedAt) {
    return Promise.resolve(closePromise).then(function() {
      var remaining = Math.max(0, 650 - (Date.now() - startedAt));
      return new Promise(function(resolve) { window.setTimeout(resolve, remaining); });
    });
  }

  function updateCustomerRowOptimisticallyV723(customerId, customer) {
    var id = text(customerId);
    if (!id) return null;
    var rowIndex = state.customers.findIndex(function(row) {
      return field(row, state.customerHeaders, "고객ID") === id;
    });
    if (rowIndex < 0) return null;
    var previous = state.customers[rowIndex].slice();
    var next = previous.slice();
    state.customerHeaders.slice(0, 19).forEach(function(header, index) {
      if (Object.prototype.hasOwnProperty.call(customer, header)) next[index] = customer[header];
    });
    state.customers[rowIndex] = next;
    return { rowIndex: rowIndex, previous: previous };
  }

  function restoreCustomerEditorAfterFailureV723(customerId) {
    cancelCustomerEditorCloseAnimationV727();
    state.editingCustomerId = text(customerId);
    var modal = document.getElementById("customerEditorModal");
    if (modal) {
      modal.classList.remove("customer-crm-modal-closing-v727");
      modal.hidden = false;
    }
    document.body.classList.add("customer-crm-open");
  }

  function applyCustomerList(result) {
    if (!result || !result.rows) return;
    state.customerHeaders = result.headers || [];
    state.customers = result.rows || [];
    state.customerListLoaded = true;
    if (!state.selectedCustomerId && state.customers.length) {
      var idIndex = headerIndex(state.customerHeaders, "고객ID");
      var statusIndex = headerIndex(state.customerHeaders, "상태");
      for (var index = 0; index < state.customers.length; index += 1) {
        if (["계약완료", "종료"].indexOf(text(state.customers[index][statusIndex])) >= 0) continue;
        state.selectedCustomerId = text(state.customers[index][idIndex]);
        if (state.selectedCustomerId) break;
      }
    }
    renderCustomers();
  }

  function loadOperationsData(force) {
    if (state.loading) {
      if (!force) return state.loadPromise || Promise.resolve();
      return (state.loadPromise || Promise.resolve()).then(function() {
        return loadOperationsData(true);
      });
    }
    var customersMode = state.activeTab === "customers";
    if (!force && (customersMode ? state.customerLoaded : state.dashboardLoaded)) {
      if (customersMode) {
        renderCustomers();
        renderMatches(state.selectedCustomerId);
      } else {
        renderDashboard();
      }
      return Promise.resolve();
    }
    if (customersMode && !force && state.customerPrefetchPromise) {
      setMessage("고객목록을 준비하는 중입니다…", "loading");
      return state.customerPrefetchPromise.then(function() {
        renderCustomers();
        renderMatches(state.selectedCustomerId);
        setMessage("고객목록을 불러왔습니다.", "success");
      });
    }
    state.loading = true;
    setMessage("운영자료를 불러오는 중입니다…", "loading");
    var workspaceEpoch = customersMode ? ++state.customerWorkspaceEpoch : null;
    var request = customersMode
      ? apiGet("customerWorkspace", { customerId: state.selectedCustomerId })
      : apiGet("operationsDashboard");
    state.loadPromise = request.then(function(result) {
      if (customersMode) {
        applyCustomerWorkspace(result, workspaceEpoch);
      } else {
        state.dashboard = result;
        state.dashboardLoaded = true;
        state.loaded = true;
        renderDashboard();
        persistOperationsCache();
      }
      setMessage("자동화 자료가 최신 상태로 연결되었습니다.", "success");
    }).catch(function(error) {
      setMessage(error.message || "운영자료 조회 중 오류가 발생했습니다.", "error");
    }).finally(function() {
      state.loading = false;
      state.loadPromise = null;
    });
    return state.loadPromise;
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

  window.refreshCustomerMatchesAfterDuplicateMergeV7186 = function() {
    var customerId = text(state.selectedCustomerId);
    if (!customerId) return Promise.resolve({ ok: true, skipped: true });
    state.loadedMatchCustomerId = "";
    return apiGet("customerMatches", { customerId: customerId }).then(function(result) {
      if (state.selectedCustomerId !== customerId) return result;
      state.matchHeaders = result.headers || [];
      state.matches = result.rows || [];
      state.loadedMatchCustomerId = customerId;
      renderCustomers();
      renderMatches(customerId);

      if (window.operationsMatchPropertyIds instanceof Set) {
        var rows = state.matches.filter(function(row) {
          return field(row, state.matchHeaders, "고객ID") === customerId;
        });
        window.operationsMatchPropertyIds = new Set();
        window.operationsMatchStatusByPropertyId = {};
        window.operationsMatchContextByPropertyId = {};
        rows.forEach(function(row) {
          var propertyId = field(row, state.matchHeaders, "대표매물ID");
          if (!propertyId) return;
          window.operationsMatchPropertyIds.add(propertyId);
          window.operationsMatchStatusByPropertyId[propertyId] = matchStatus(row);
          window.operationsMatchContextByPropertyId[propertyId] = {
            matchId: field(row, state.matchHeaders, "매칭ID"),
            customerId: customerId,
            propertyId: propertyId,
            status: matchStatus(row)
          };
        });
        syncCustomerMatchHeldToggleV1();
        if (typeof window.applyFilter === "function") window.applyFilter();
      }
      return result;
    });
  };

  window.openOperationsCenter = function(tab) {
    var center = document.getElementById("operationsCenter");
    if (!center) return;
    center.classList.add("open");
    center.setAttribute("aria-hidden", "false");
    document.body.classList.add("operations-center-open");
    var targetTab = tab || "dashboard";
    window.switchOperationsTab(targetTab);
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
    state.activeTab = isCustomers ? "customers" : "dashboard";
    var dashboardPanel = document.getElementById("operationsDashboardPanel");
    var customerPanel = document.getElementById("operationsCustomersPanel");
    var dashboardButton = document.getElementById("operationsTabDashboard");
    var customerButton = document.getElementById("operationsTabCustomers");
    if (dashboardPanel) dashboardPanel.hidden = isCustomers;
    if (customerPanel) customerPanel.hidden = !isCustomers;
    if (dashboardButton) dashboardButton.classList.toggle("active", !isCustomers);
    if (customerButton) customerButton.classList.toggle("active", isCustomers);
    if (document.getElementById("operationsCenter").classList.contains("open")) loadOperationsData(false);
  };

  window.rebuildCustomerMatchesNow = function() {
    if (state.rebuilding) return;
    state.rebuilding = true;
    setMessage("전체 고객 조건과 활성 매물을 다시 비교하는 중입니다…", "loading");
    apiPost("rebuildCustomerMatches", {
      customerId: state.selectedCustomerId
    }).then(function(result) {
      var rebuildEpoch = ++state.customerWorkspaceEpoch;
      state.customerPrefetchPromise = null;
      if (result && result.workspace) {
        applyCustomerWorkspace(result.workspace, rebuildEpoch);
        return;
      }
      state.loaded = false;
      state.customerLoaded = false;
      state.loadedMatchCustomerId = "";
      state.lastCustomerWorkspace = null;
      try { sessionStorage.removeItem(OPERATIONS_CACHE_KEY); } catch (_) {}
      return loadOperationsData(true);
    }).then(function() {
      setMessage("재계산과 화면 갱신이 완료되었습니다.", "success");
    }).catch(function(error) {
      setMessage(error.message || "고객 매칭 재계산에 실패했습니다.", "error");
    }).finally(function() {
      state.rebuilding = false;
    });
  };

  function syncCustomerMatchMapStatusV722(customerId, customerName) {
    var id = text(customerId || window.customerMatchMapCustomerIdV722);
    if (!id) return;
    var name = text(customerName || window.customerMatchMapCustomerNameV722) || "선택 고객";
    var stats = customerMatchStats(id);
    var statusLabel = name + " · 신규 " + stats.fresh + " · 후보 " + stats.introduced + " · 보류 " + stats.held;
    var statusText = document.getElementById("customerMatchMapStatusText");
    var compactStatus = document.getElementById("customerMatchMapStatusCompactV2");
    var compactStatusText = document.getElementById("customerMatchMapStatusCompactTextV2");
    var overlayStatus = document.getElementById("customerMatchMapStatusOverlayV722");
    var overlayStatusText = document.getElementById("customerMatchMapStatusOverlayTextV722");
    if (statusText) statusText.textContent = statusLabel;
    if (compactStatusText) compactStatusText.textContent = statusLabel;
    if (compactStatus) compactStatus.title = statusLabel;
    if (overlayStatusText) overlayStatusText.textContent = statusLabel;
    if (overlayStatus) {
      overlayStatus.hidden = false;
      overlayStatus.title = statusLabel;
    }
  }

  window.showSelectedCustomerMatchesOnMap = function() {
    if (typeof window.clearPinnedClusterSelectionV6515 === "function") {
      window.clearPinnedClusterSelectionV6515(true);
    }
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
    window.customerMatchHeldVisibleV1 = false;
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
    var compactStatus = document.getElementById("customerMatchMapStatusCompactV2");
    if (status) status.hidden = false;
    if (compactStatus) compactStatus.hidden = false;
    window.customerMatchMapCustomerIdV722 = customerId;
    window.customerMatchMapCustomerNameV722 = name;
    syncCustomerMatchMapStatusV722(customerId, name);
    syncCustomerMatchHeldToggleV1();

    var matched = (window.allItems || []).filter(function(item) {
      var propertyId = text(item.propertyId);
      return window.operationsMatchPropertyIds.has(propertyId) &&
        window.operationsMatchStatusByPropertyId[propertyId] !== "보류";
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
    if (typeof window.clearPinnedClusterSelectionV6515 === "function") {
      window.clearPinnedClusterSelectionV6515(true);
    }
    window.operationsMatchPropertyIds = null;
    window.operationsMatchStatusByPropertyId = {};
    window.operationsMatchContextByPropertyId = {};
    window.customerMatchHeldVisibleV1 = false;
    syncCustomerMatchHeldToggleV1();
    var status = document.getElementById("customerMatchMapStatus");
    var compactStatus = document.getElementById("customerMatchMapStatusCompactV2");
    var overlayStatus = document.getElementById("customerMatchMapStatusOverlayV722");
    if (status) status.hidden = true;
    if (compactStatus) compactStatus.hidden = true;
    if (overlayStatus) overlayStatus.hidden = true;
    window.customerMatchMapCustomerIdV722 = "";
    window.customerMatchMapCustomerNameV722 = "";
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  function syncCustomerMatchHeldToggleV1() {
    var button = document.getElementById("customerMatchHeldToggleV1");
    if (!button) return;
    var customerMapActive = !!window.operationsMatchPropertyIds;
    var active = customerMapActive && !!window.customerMatchHeldVisibleV1;
    button.hidden = !customerMapActive;
    button.classList.toggle("on", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("title", active ? "보류 매물 숨기기" : "보류 매물 보기");
  }

  window.toggleCustomerMatchHeldV1 = function() {
    if (!window.operationsMatchPropertyIds) return;
    window.customerMatchHeldVisibleV1 = !window.customerMatchHeldVisibleV1;
    if (typeof window.clearPinnedClusterSelectionV6515 === "function") {
      window.clearPinnedClusterSelectionV6515(true);
    }
    syncCustomerMatchHeldToggleV1();
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  window.openCustomerEditor = function(customerId) {
    var modal = document.getElementById("customerEditorModal");
    var form = document.getElementById("customerEditorForm");
    if (!modal || !form) return;
    var id = text(customerId);
    cancelCustomerEditorCloseAnimationV727();
    if (text(state.customerConditionRefreshV727 && state.customerConditionRefreshV727.customerId) === id &&
        state.customerConditionRefreshV727.status === "error") {
      setCustomerConditionRefreshV727("", "idle");
    }
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
    cancelCustomerEditorCloseAnimationV727();
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
    var editingCustomerId = text(state.editingCustomerId);
    var isConditionUpdate = !!editingCustomerId;
    var feedbackStartedAt = Date.now();
    var optimisticUpdate = updateCustomerRowOptimisticallyV723(editingCustomerId, customer);
    var consultationMemo = text(document.getElementById("customerConsultationMemo") && document.getElementById("customerConsultationMemo").value);
    var nextContactDate = text(document.getElementById("customerNextContactDate") && document.getElementById("customerNextContactDate").value);
    button.disabled = true;
    button.textContent = "저장 확인 중…";
    if (isConditionUpdate) setCustomerConditionRefreshV727(editingCustomerId, "active");
    if (optimisticUpdate) {
      renderCustomers();
      renderMatches(editingCustomerId);
    } else if (isConditionUpdate) {
      renderMatches(editingCustomerId);
    }
    var closeAnimation = closeCustomerEditorAnimatedV727();
    setMessage("조건을 바로 반영했습니다. D1 저장과 재매칭을 확인하고 있습니다…", "loading");
    apiPost("saveCustomer", {
      customerId: editingCustomerId,
      customer: customer,
      consultationMemo: consultationMemo,
      nextContactDate: nextContactDate,
      compactResponse: true
    }).then(function(result) {
      state.selectedCustomerId = result.customerId || state.selectedCustomerId;
      if (result.workspace) {
        applyCustomerWorkspace(result.workspace);
      } else if (applyCompactCustomerSaveV723(result, editingCustomerId)) {
        state.customerLoaded = true;
        if (!Array.isArray(result.matches)) {
          state.loadedMatchCustomerId = "";
          return loadCustomerMatches(state.selectedCustomerId);
        }
      } else {
        state.customerLoaded = false;
        return loadOperationsData(true);
      }
    }).then(function() {
      if (isConditionUpdate && state.loadedMatchCustomerId !== state.selectedCustomerId) {
        throw new Error("새 매칭 결과를 확인하지 못했습니다.");
      }
      state.customerView = "before";
      renderCustomers();
      renderMatches(state.selectedCustomerId);
      return waitForCustomerConditionFeedbackV727(closeAnimation, feedbackStartedAt);
    }).then(function() {
      if (isConditionUpdate) setCustomerConditionRefreshV727("", "idle");
      renderMatches(state.selectedCustomerId);
      setMessage("고객정보가 D1에 저장되고 재매칭까지 확인됐습니다.", "success");
    }).catch(function(error) {
      if (optimisticUpdate) state.customers[optimisticUpdate.rowIndex] = optimisticUpdate.previous;
      if (isConditionUpdate) setCustomerConditionRefreshV727(editingCustomerId, "error");
      renderCustomers();
      renderMatches(editingCustomerId || state.selectedCustomerId);
      restoreCustomerEditorAfterFailureV723(editingCustomerId);
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

  window.openCustomerMemo = function(customerId) {
    var id = text(customerId);
    var customer = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === id;
    });
    if (!customer) return;
    state.viewingMemoCustomerId = id;
    var name = field(customer, state.customerHeaders, "고객명/상호") || "고객";
    var title = document.getElementById("customerMemoTitle");
    var content = document.getElementById("customerMemoContent");
    if (title) title.textContent = name + " 메모 작성";
    var memos = state.activities.filter(function(row) {
      return field(row, state.activityHeaders, "고객ID") === id &&
        field(row, state.activityHeaders, "단계") === "메모" &&
        field(row, state.activityHeaders, "상담내용");
    });
    if (content) {
      content.innerHTML = '<section class="customer-memo-history">' +
        '<div class="customer-memo-history-title"><b>저장된 메모</b><span>' +
        memos.length.toLocaleString("ko-KR") + '건</span></div>' +
        (memos.length ? memos.map(function(row) {
          return '<article class="customer-memo-entry"><time>' +
            escape(field(row, state.activityHeaders, "일시")) + '</time><p>' +
            escape(field(row, state.activityHeaders, "상담내용")) + '</p></article>';
        }).join("") : '<div class="customer-memo-empty">저장된 메모가 없습니다.</div>') +
        '</section>';
    }
    var quickMemo = document.getElementById("customerQuickMemoInput");
    if (quickMemo) quickMemo.value = "";
    var modal = document.getElementById("customerMemoModal");
    if (modal) modal.hidden = false;
    if (content) content.scrollTop = content.scrollHeight;
    document.body.classList.add("customer-crm-open");
  };

  window.closeCustomerMemo = function() {
    var modal = document.getElementById("customerMemoModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("customer-crm-open");
  };

  window.saveCustomerQuickMemo = function() {
    var customerId = state.viewingMemoCustomerId;
    var input = document.getElementById("customerQuickMemoInput");
    var button = document.getElementById("customerQuickMemoSaveBtn");
    var memo = text(input && input.value);
    if (!memo) {
      if (input) input.focus();
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = "저장 확인 중…";
    }
    window.closeCustomerMemo();
    setMessage("메모를 바로 접수했습니다. D1 저장을 확인하고 있습니다…", "loading");
    apiPost("addCustomerActivity", {
      customerId: customerId,
      stage: "상담",
      source: "customerMemo",
      memo: memo,
      nextContactDate: ""
    }).then(function(result) {
      if (result.activityRow) state.activities.push(result.activityRow);
      if (input) input.value = "";
      setMessage("상담·미팅 메모가 D1에 저장된 것을 확인했습니다.", "success");
    }).catch(function(error) {
      state.viewingMemoCustomerId = customerId;
      var modal = document.getElementById("customerMemoModal");
      if (modal) modal.hidden = false;
      if (input) input.value = memo;
      document.body.classList.add("customer-crm-open");
      setMessage(error.message || "메모 저장에 실패했습니다.", "error");
    }).finally(function() {
      if (button) {
        button.disabled = false;
        button.textContent = "메모 저장";
      }
    });
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
    }).then(function(result) {
      if (result.activityRow) state.activities.push(result.activityRow);
      var stage = text(result.stage);
      if (stage === "미팅완료" || stage === "임장") {
        var customer = state.customers.find(function(row) {
          return field(row, state.customerHeaders, "고객ID") === state.selectedCustomerId;
        });
        var statusIndex = headerIndex(state.customerHeaders, "상태");
        if (customer && statusIndex >= 0) customer[statusIndex] = "미팅후";
      }
      window.closeCustomerActivity();
      renderCustomers();
      renderMatches(state.selectedCustomerId);
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
    }).then(function(result) {
      var previousMatchId = context.matchId;
      var resolvedMatchId = text(result && result.matchId) || previousMatchId;
      var oldStatus = context.status;
      context.matchId = resolvedMatchId;
      context.status = nextStatus;
      window.operationsMatchStatusByPropertyId[text(propertyId)] = nextStatus;
      state.loaded = false;
      var matchedRow = state.matches.find(function(row) {
        var rowMatchId = field(row, state.matchHeaders, "매칭ID");
        return rowMatchId === previousMatchId || rowMatchId === resolvedMatchId;
      });
      var statusIndex = headerIndex(state.matchHeaders, "진행상태");
      var matchIdIndex = headerIndex(state.matchHeaders, "매칭ID");
      if (matchedRow && matchIdIndex >= 0) matchedRow[matchIdIndex] = resolvedMatchId;
      if (matchedRow && statusIndex >= 0) matchedRow[statusIndex] = nextStatus;
      adjustMatchSummary(context.customerId, oldStatus, nextStatus);
      syncCustomerMatchMapStatusV722(context.customerId);
      if (typeof window.applyFilter === "function") window.applyFilter();
      return nextStatus;
    });
  };

  function customerAlertCount(data) {
    data = data || {};
    return number(data.newMatchCustomers != null ? data.newMatchCustomers : data.newMatches) +
      number(data.overdueCustomers != null ? data.overdueCustomers : data.overdueMatches) +
      number(data.dueFollowups);
  }

  function customerAlertFingerprint(data) {
    return customerAlertCounts(data).join("-");
  }

  function customerAlertCounts(data) {
    data = data || {};
    return [
      number(data.newMatchCustomers != null ? data.newMatchCustomers : data.newMatches),
      number(data.overdueCustomers != null ? data.overdueCustomers : data.overdueMatches),
      number(data.dueFollowups)
    ];
  }

  function readCustomerAlertDismissal(key) {
    try {
      var saved = localStorage.getItem(key);
      if (!saved) return null;
      if (saved.charAt(0) !== "{") return { fingerprint: saved, counts: null };
      var parsed = JSON.parse(saved);
      return parsed && parsed.fingerprint ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function isCustomerAlertDismissed(key, fingerprint, counts) {
    var dismissed = null;
    if (state.dismissedAlertKey === key && state.dismissedAlertFingerprint) {
      dismissed = {
        fingerprint: state.dismissedAlertFingerprint,
        counts: state.dismissedAlertCounts
      };
    } else {
      dismissed = readCustomerAlertDismissal(key);
    }
    if (!dismissed) return false;
    if (dismissed.fingerprint === fingerprint) return true;
    if (!Array.isArray(dismissed.counts)) return false;
    return counts.every(function(count, index) {
      return count <= number(dismissed.counts[index]);
    });
  }

  function customerAlertStorageKey() {
    var today = new Date();
    var dateKey = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("");
    return "js_customer_work_alert_v711_" + dateKey;
  }

  function ensureCustomerWorkAlert() {
    var modal = document.getElementById("customerWorkAlert");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "customerWorkAlert";
    modal.className = "customer-work-alert";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="customer-work-alert-backdrop" onclick="closeCustomerWorkAlert()"></div>' +
      '<section class="customer-work-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="customerWorkAlertTitle">' +
        '<header><div><small>6단계 자동 업무 알림</small><h2 id="customerWorkAlertTitle">지금 확인할 고객 업무</h2></div>' +
        '<button type="button" onclick="closeCustomerWorkAlert()" aria-label="알림 닫기">×</button></header>' +
        '<div id="customerWorkAlertBody" class="customer-work-alert-body"></div>' +
        '<footer><button type="button" onclick="closeCustomerWorkAlert()">나중에</button>' +
        '<button type="button" class="primary" onclick="openCustomerWorkQueue(\'active\')">고객 업무 열기</button></footer>' +
      '</section>';
    document.body.appendChild(modal);
    return modal;
  }

  function alertQueueButton(view, label, count, description, tone) {
    return '<button type="button" class="customer-work-alert-item ' + tone +
      '" onclick="openCustomerWorkQueue(\'' + view + '\')">' +
      '<span><b>' + escape(label) + '</b><small>' + escape(description) + '</small></span>' +
      '<strong>' + number(count).toLocaleString("ko-KR") + '명</strong><em>바로 보기 →</em></button>';
  }

  function showCustomerWorkAlert(data, force) {
    var total = customerAlertCount(data);
    if (!total) return;
    var fingerprint = customerAlertFingerprint(data);
    var counts = customerAlertCounts(data);
    var key = customerAlertStorageKey();
    if (!force && isCustomerAlertDismissed(key, fingerprint, counts)) return;
    var modal = ensureCustomerWorkAlert();
    var body = document.getElementById("customerWorkAlertBody");
    var newCustomers = number(data.newMatchCustomers != null ? data.newMatchCustomers : data.newMatches);
    var overdueCustomers = number(data.overdueCustomers != null ? data.overdueCustomers : data.overdueMatches);
    var dueCustomers = number(data.dueFollowups);
    if (body) {
      body.innerHTML =
        '<p>매물을 새로 소개하거나 다시 연락해야 할 고객을 모았습니다.</p>' +
        '<div class="customer-work-alert-summary"><b>확인할 업무 ' + total.toLocaleString("ko-KR") + '건</b>' +
        '<span>항목이 겹치는 고객은 각 목록에서 함께 표시될 수 있습니다.</span></div>' +
        '<div class="customer-work-alert-items">' +
          (newCustomers ? alertQueueButton("new", "신규 매물 안내", newCustomers, "조건에 맞는 새 매물이 생긴 고객", "new") : '') +
          (overdueCustomers ? alertQueueButton("overdue", "미연락 경고", overdueCustomers, (number(data.contactReminderDays) || 3) + "일 이상 안내하지 않은 고객", "overdue") : '') +
          (dueCustomers ? alertQueueButton("due", "오늘 후속관리", dueCustomers, "연락·미팅 예정일이 된 고객", "due") : '') +
        '</div>';
    }
    state.alertFingerprint = fingerprint;
    state.alertCounts = counts;
    modal.hidden = false;
    document.body.classList.add("customer-work-alert-open");
  }

  window.closeCustomerWorkAlert = function() {
    var modal = document.getElementById("customerWorkAlert");
    if (modal) modal.hidden = true;
    document.body.classList.remove("customer-work-alert-open");
    if (state.alertFingerprint) {
      var key = customerAlertStorageKey();
      var payload = {
        fingerprint: state.alertFingerprint,
        counts: (state.alertCounts || []).slice(),
        dismissedAt: new Date().toISOString()
      };
      state.dismissedAlertKey = key;
      state.dismissedAlertFingerprint = payload.fingerprint;
      state.dismissedAlertCounts = payload.counts;
      try { localStorage.setItem(key, JSON.stringify(payload)); } catch (_) {}
    }
  };

  window.openCustomerWorkAlert = function() {
    if (state.dashboard) showCustomerWorkAlert(state.dashboard, true);
    else refreshCustomerAlertBadge(true);
  };

  function refreshCustomerAlertBadge(forcePopup) {
    apiGet("operationsDashboard").then(function(data) {
      state.dashboard = data;
      state.dashboardLoaded = true;
      persistOperationsCache();
      var button = document.getElementById("operationsCustomerMenuBtn");
      if (!button) return;
      var alerts = customerAlertCount(data);
      button.textContent = alerts ? "고객매칭 · 알림 " + alerts.toLocaleString("ko-KR") : "고객매칭";
      button.classList.toggle("has-alert", alerts > 0);
      button.setAttribute("aria-label", alerts ? "고객매칭, 확인할 업무 " + alerts + "건" : "고객매칭");
      // 고객업무 알림 수는 버튼에 유지하되 자동 팝업은 띄우지 않습니다.
      // 나중에 보완할 때 window.openCustomerWorkAlert()의 수동 호출만 다시 활용할 수 있습니다.
      if (alerts && forcePopup === true) showCustomerWorkAlert(data, true);
    }).catch(function() {});
  }

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      window.closeCustomerEditor();
      window.closeCustomerActivity();
      window.closeCustomerMemo();
      window.closeOperationsCenter();
    }
  });
  try {
    var fastCache = JSON.parse(sessionStorage.getItem(OPERATIONS_CACHE_KEY) || "null");
    if (fastCache && Date.now() - Number(fastCache.at || 0) <= OPERATIONS_CACHE_MAX_AGE) {
      if (fastCache.dashboard) {
        state.dashboard = fastCache.dashboard;
        state.dashboardLoaded = true;
      }
      if (fastCache.customerWorkspace) applyCustomerWorkspace(fastCache.customerWorkspace);
    }
  } catch (_) {}
  window.setTimeout(function() {
    if (!state.customerPrefetchPromise) {
      var prefetchEpoch = ++state.customerWorkspaceEpoch;
      state.customerPrefetchPromise = apiGet("customerWorkspace", { customerId: state.selectedCustomerId })
        .then(function(result) { applyCustomerWorkspace(result, prefetchEpoch); })
        .catch(function() {})
        .finally(function() { state.customerPrefetchPromise = null; });
    }
  }, 80);
  window.setTimeout(function() {
    refreshCustomerAlertBadge(false);
    if (!state.alertPollTimer) {
      state.alertPollTimer = window.setInterval(function() {
        if (document.visibilityState === "visible") refreshCustomerAlertBadge(false);
      }, 180000);
    }
  }, 1200);
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible") refreshCustomerAlertBadge(false);
  });
})();
