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
    selectedCustomerId: ""
  };

  window.operationsMatchPropertyIds = null;

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
    panel.innerHTML =
      '<div class="operations-stat-grid">' +
        dashboardCard("활성 대표매물", activeCount, "JS웹에 표시되는 운영 매물", "primary") +
        dashboardCard("검증 대기", reviewCount, "사람의 판단이 필요한 원본", reviewCount ? "warning" : "success") +
        dashboardCard("수집 원본", data.raw, "출처별 원본 스냅샷", "") +
        dashboardCard("고객 문의", data.openCustomers != null ? data.openCustomers : data.customers, "진행 중인 고객 조건", "") +
        dashboardCard("자동 매칭", data.newMatches != null ? data.newMatches : data.matches, "현재 추천 후보", "") +
        dashboardCard("변경 이력", data.history, "수정·통합·상태변경 기록", "") +
      '</div>' +
      '<div class="operations-workflow-card">' +
        '<div><b>자동 처리 흐름</b><span>수집원본 → 자동 중복판정 → 대표매물/검증대기 → 고객 재매칭</span></div>' +
        '<div class="operations-source-priority"><span>대표출처 우선순위</span><b>직접등록 › 당근 › 공실박스 › 네이버</b></div>' +
      '</div>' +
      '<div class="operations-guidance">' +
        '<b>사람이 확인할 일은 두 가지뿐입니다.</b>' +
        '<p>매물검증 시트의 애매한 중복을 결정하고, 고객문의 시트에 새 고객 조건을 입력하세요. 나머지 대표매물 갱신·이력·매칭은 자동으로 처리됩니다.</p>' +
      '</div>';
  }

  function matchCountForCustomer(customerId) {
    return state.matches.filter(function(row) {
      return field(row, state.matchHeaders, "고객ID") === customerId;
    }).length;
  }

  function renderCustomers() {
    var list = document.getElementById("operationsCustomerList");
    if (!list) return;
    if (!state.customers.length) {
      list.innerHTML = '<div class="operations-empty"><b>등록된 고객이 없습니다.</b><span>고객문의 시트에 한 행을 입력하면 고객ID와 조건버전이 자동 생성됩니다.</span></div>';
      renderMatches("");
      return;
    }
    list.innerHTML = state.customers.map(function(row) {
      var id = field(row, state.customerHeaders, "고객ID");
      var name = field(row, state.customerHeaders, "고객명/상호") || "이름 미입력";
      var status = field(row, state.customerHeaders, "상태") || "상담중";
      var region = field(row, state.customerHeaders, "희망지역") || "지역 전체";
      var request = field(row, state.customerHeaders, "요청사항");
      var count = matchCountForCustomer(id);
      var selected = id === state.selectedCustomerId ? " selected" : "";
      return '<button type="button" class="operations-customer-card' + selected + '" data-customer-id="' + escape(id) + '">' +
        '<span class="operations-customer-status">' + escape(status) + '</span>' +
        '<strong>' + escape(name) + '</strong>' +
        '<span>' + escape(region) + '</span>' +
        (request ? '<small>' + escape(request) + '</small>' : '') +
        '<b>' + count.toLocaleString("ko-KR") + '건 매칭</b>' +
      '</button>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll("[data-customer-id]"), function(button) {
      button.addEventListener("click", function() {
        state.selectedCustomerId = button.getAttribute("data-customer-id") || "";
        renderCustomers();
        renderMatches(state.selectedCustomerId);
      });
    });
    if (!state.selectedCustomerId && state.customers.length) {
      state.selectedCustomerId = field(state.customers[0], state.customerHeaders, "고객ID");
      renderCustomers();
      renderMatches(state.selectedCustomerId);
    }
  }

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
    var rows = state.matches.filter(function(row) {
      return field(row, state.matchHeaders, "고객ID") === customerId;
    }).sort(function(a, b) {
      return number(field(b, state.matchHeaders, "점수")) - number(field(a, state.matchHeaders, "점수"));
    });
    var customerRow = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === customerId;
    });
    var customerName = customerRow ? field(customerRow, state.customerHeaders, "고객명/상호") : "선택 고객";
    var header = '<div class="operations-match-heading"><div><span>' + escape(customerName) + '</span><b>' + rows.length.toLocaleString("ko-KR") + '건 추천</b></div>' +
      '<button type="button" onclick="showSelectedCustomerMatchesOnMap()"' + (rows.length ? '' : ' disabled') + '>이 매물만 지도에 표시</button></div>';
    if (!rows.length) {
      list.innerHTML = header + '<div class="operations-empty"><b>현재 조건에 맞는 매물이 없습니다.</b><span>조건을 수정하거나 새 매물이 들어오면 자동으로 다시 비교됩니다.</span></div>';
      return;
    }
    list.innerHTML = header + '<div class="operations-match-cards">' + rows.map(function(row) {
      var propertyId = field(row, state.matchHeaders, "대표매물ID");
      var property = getProperty(propertyId);
      var score = field(row, state.matchHeaders, "점수");
      var reasons = field(row, state.matchHeaders, "추천이유");
      var warnings = field(row, state.matchHeaders, "주의사항");
      var title = property ? (property.name || property.type || "매물") : propertyId;
      var address = property ? [property.address, property.room].filter(Boolean).join(" · ") : "지도 데이터를 새로고침하면 상세정보가 연결됩니다.";
      var price = property ? "보증금 " + number(property.deposit).toLocaleString("ko-KR") + " / 월세 " + number(property.rent).toLocaleString("ko-KR") + " · " + number(property.area) + "평" : "";
      return '<article class="operations-match-card">' +
        '<div class="operations-match-score"><b>' + escape(score) + '</b><span>점</span></div>' +
        '<div class="operations-match-body"><strong>' + escape(title) + '</strong><span>' + escape(address) + '</span>' +
          (price ? '<b>' + escape(price) + '</b>' : '') +
          '<p>' + escape(reasons || "기본 조건 충족") + '</p>' +
          (warnings ? '<small>확인: ' + escape(warnings) + '</small>' : '') +
        '</div>' +
      '</article>';
    }).join("") + '</div>';
  }

  function loadOperationsData(force) {
    if (state.loading) return Promise.resolve();
    if (state.loaded && !force) return Promise.resolve();
    state.loading = true;
    setMessage("운영자료를 불러오는 중입니다…", "loading");
    return Promise.all([
      apiGet("operationsDashboard"),
      apiGet("customerList"),
      apiGet("customerMatches")
    ]).then(function(results) {
      state.dashboard = results[0];
      state.customerHeaders = results[1].headers || [];
      state.customers = results[1].rows || [];
      state.matchHeaders = results[2].headers || [];
      state.matches = results[2].rows || [];
      state.loaded = true;
      renderDashboard();
      renderCustomers();
      renderMatches(state.selectedCustomerId);
      setMessage("자동화 자료가 최신 상태로 연결되었습니다.", "success");
    }).catch(function(error) {
      setMessage(error.message || "운영자료 조회 중 오류가 발생했습니다.", "error");
    }).finally(function() {
      state.loading = false;
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

    var customerRow = state.customers.find(function(row) {
      return field(row, state.customerHeaders, "고객ID") === customerId;
    });
    var name = customerRow ? field(customerRow, state.customerHeaders, "고객명/상호") : "선택 고객";
    var status = document.getElementById("customerMatchMapStatus");
    var statusText = document.getElementById("customerMatchMapStatusText");
    if (status) status.hidden = false;
    if (statusText) statusText.textContent = name + " · 매칭 " + ids.length + "건만 표시 중";

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
    var status = document.getElementById("customerMatchMapStatus");
    if (status) status.hidden = true;
    if (typeof window.applyFilter === "function") window.applyFilter();
  };

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") window.closeOperationsCenter();
  });
})();
