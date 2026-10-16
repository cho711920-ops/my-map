(function() {
  "use strict";
  var OPERATIONS_CACHE_KEY = "js_operations_dashboard_cache_v2";
  var OPERATIONS_CACHE_MAX_AGE = 10 * 60 * 1000;
  var state = {
    loaded: false,
    loading: false,
    dashboard: null,
    activeTab: "dashboard",
    dashboardLoaded: false,
    dashboardLoadedAt: 0,
    loadPromise: null,
    transactionCandidates: null,
    transactionCandidatesLoading: false,
    transactionCandidatesOpenV1: false,
    transactionCandidatePageV1: 0,
    transactionCandidateScopeV1: "전체 공개 매물 · 서버 기준",
    transactionCandidateSummaryV1: null,
    transactionCandidateAdTotalV1: null,
    transactionCandidateRequestV1: 0,
    transactionAvailabilityFrameV1: false,
    transactionOriginalPageV1: 0,
    transactionCandidatesErrorV1: "",
    transactionExpandedId: "",
    transactionCompletingId: ""
  };
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

function transactionImageUrl(value) {
    var url = text(value);
    if (!/^https:\/\//i.test(url) || /\/avatars\//i.test(url) || /\/origin\/profile\//i.test(url)) return "";
    try {
      var parsed = new URL(url, window.location.href);
      if (/^(?:img\.kr\.gcp-karroter\.net|landthumb-phinf\.pstatic\.net|dnvefa72aowie\.cloudfront\.net|file1\.gongsilbox\.com)$/i.test(parsed.hostname)) {
        return "/api/listing-image?url=" + encodeURIComponent(parsed.toString());
      }
    } catch (_) {
      return "";
    }
    return url;
  }

function apiGet(action, params) {
    if (!window.JSDataAccessV6 || typeof window.JSDataAccessV6.read !== "function") {
      return Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    }
    return window.JSDataAccessV6.read(action, params, {
      errorMessage: "운영자료 조회에 실패했습니다."
    }).catch(function(error) {
      if (window.JSLocalMetricsV1) window.JSLocalMetricsV1.error("read");
      throw error;
    });
  }

function setMessage(message, type) {
    var element = document.getElementById("operationsCenterMessage");
    if (!element) return;
    element.textContent = message || "";
    element.className = "operations-center-message" + (type ? " " + type : "");
  }

function persistOperationsCache() {
    try {
      sessionStorage.setItem(OPERATIONS_CACHE_KEY, JSON.stringify({
        at: Date.now(),
        dashboard: state.dashboard
      }));
    } catch (_) {}
  }

function dashboardCard(label, value, hint, tone, actionTarget) {
    var actionable = Boolean(actionTarget);
    var reviews = actionTarget === "reviews";
    var transactions = actionTarget === "transactions";
    var tag = actionable ? "button" : "article";
    var action = actionable
      ? (reviews
        ? ' type="button" onclick="switchOperationsTab(\'reviews\')"'
        : transactions
          ? ' type="button" onclick="openTransactionCandidates()"'
          : '')
      : "";
    return '<' + tag + action + ' class="operations-stat-card ' + (tone || "") +
      (actionable ? ' actionable' : '') + '">' +
      '<span>' + escape(label) + '</span>' +
      '<strong>' + number(value).toLocaleString("ko-KR") + '</strong>' +
      '<small>' + escape(hint) + '</small>' +
      (actionable ? '<em>' + (reviews ? '매물검증 바로 보기 →' : transactions ? '후보 목록 보기 →' : '') + '</em>' : '') +
      '</' + tag + '>';
  }

function currentTransactionSummaryV1(includeRows) {
    var api = window.JSUnifiedListingsV8;
    if (!api || typeof api.candidateSummary !== "function") return null;
    try {
      var summary = api.candidateSummary({ includeRows: !!includeRows });
      return summary && summary.ready && Number.isFinite(summary.candidateAdCount) ? summary : null;
    } catch (_) { return null; }
  }

function transactionScopeHintV1(summary, serverData) {
    if (!summary && Number(serverData && serverData.advertisementPolicyVersion) === 3 && Number.isFinite(serverData.candidateAdCount)) {
      summary = {scopeLabel: "전체 공개 통합매물 · 서버 기준", candidateAdCount: serverData.candidateAdCount,
        manualCompletedCount: serverData.manualCompleted, doneCount: serverData.completedOnlyTotal};
    }
    return summary
      ? (text(summary.scopeLabel) || "현재 지도·검색조건") + " · 직접 계약완료 " +
          number(summary.manualCompletedCount).toLocaleString("ko-KR") + "건 별도 · 후보 광고 " +
          number(summary.candidateAdCount).toLocaleString("ko-KR") + "개 · 완료만 보기 합계 " +
          number(summary.doneCount).toLocaleString("ko-KR") + "건"
      : "전체 공개 통합매물 기준 · 후보 광고가 있는 매물 · 직접 계약완료 별도";
  }

function renderDashboard() {
    var panel = document.getElementById("operationsDashboardPanel");
    if (!panel) return;
    var data = state.dashboard || {};
    var reviewCount = data.pendingReview != null ? data.pendingReview : data.review;
    var activeCount = data.activeMaster != null ? data.activeMaster : data.master;
    var transactionSummary = currentTransactionSummaryV1(state.transactionCandidatesOpenV1);
    var transactionCount = transactionSummary ? transactionSummary.candidateCount : data.transactionCheckCandidates;
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
        dashboardCard("거래확인 후보", transactionCount, transactionScopeHintV1(transactionSummary, data), transactionCount ? "warning" : "success", "transactions") +
        dashboardCard("변경 이력", data.history, "수정·통합·상태변경 기록", "") +
        dashboardCard("최근 자동정리", cleanupRemoved, cleanupHint, cleanup.at && hasCurrentListings ? "success" : "") +
      '</div>' +
      '<div class="operations-workflow-card">' +
        '<div><b>자동 처리 흐름</b><span>출처별 원본 보존 → 동일 공간 연결/검증 → 통합매물 표시</span></div>' +
        '<div class="operations-source-priority"><span>원본 보존 방식</span><b>당근 · 네이버 · 공실박스 링크와 조건을 각각 보존</b></div>' +
      '</div>' +
      '<div class="operations-guidance">' +
        '<b>검증이 필요한 매물을 확인하세요.</b>' +
        '<p>매물검증에서 동일 공간 여부를 확인하고, 출처별 원본과 변경 이력을 살펴보세요.</p>' +
      '</div>';
    if (window.JSLocalMetricsV1) {
      var diagnostics = document.createElement("section");
      diagnostics.className = "operations-guidance";
      panel.appendChild(diagnostics);
      window.JSLocalMetricsV1.render(diagnostics);
    }
    if (state.transactionCandidatesOpenV1) {
      if (transactionSummary) useCurrentTransactionCandidatesV1(false, transactionSummary);
      renderTransactionCandidates(false);
    }
  }

window.JSOperationsDiagnosticsV7151 = {
    dashboardCard: dashboardCard,
    getDashboard: function() { return state.dashboard; }
  };

window.openOperationsCenter = function(tab) {
    if (window.JSUnifiedListingsV8 && typeof window.JSUnifiedListingsV8.closeForOverlay === "function") {
      window.JSUnifiedListingsV8.closeForOverlay();
    }
    var center = document.getElementById("operationsCenter");
    if (!center) return;
    center.classList.add("open");
    center.setAttribute("aria-hidden", "false");
    document.body.classList.add("operations-center-open");
    var targetTab = tab || "dashboard";
    return window.switchOperationsTab(targetTab);
  };

window.closeOperationsCenter = function() {
    var center = document.getElementById("operationsCenter");
    if (!center) return;
    center.classList.remove("open");
    center.setAttribute("aria-hidden", "true");
    document.body.classList.remove("operations-center-open");
  };

function isCandidateOriginalRowV1(original) {
    return original && original.candidateEligible !== false &&
      ["legacy_candidate", "census_missing"].indexOf(original.availabilityKind) >= 0;
  }

function candidateOriginalRowsV1(row) {
    return (Array.isArray(row.candidateOriginals) ? row.candidateOriginals : []).filter(isCandidateOriginalRowV1);
  }

function candidateValueV1(value) {
    var parsed = value == null || value === "" ? NaN : Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed.toLocaleString("ko-KR") : "미확인";
  }

function candidatePriceV1(original, tradeType) {
    original = original || {};
    if (text(original.tradeType || tradeType) === "sale") {
      var price = candidateValueV1(original.salePrice);
      return "매매 " + price + (price === "미확인" ? "" : "만원");
    }
    return "보 " + candidateValueV1(original.deposit) + " / 월 " + candidateValueV1(original.rent);
  }

function candidateOriginalCardV1(row, original) {
    var propertyId = encodeURIComponent(text(row.propertyId)).replace(/'/g, '%27');
    var originalId = encodeURIComponent(text(original.originalId)).replace(/'/g, '%27');
    var providerId = text(original.providerSourceId || original.sourceId || original.sourceListingId || original.originalId);
    var price = candidatePriceV1(original, row.tradeType);
    var room = typeof window.formatListingRoomForCardV653 === "function"
      ? window.formatListingRoomForCardV653(original.room, original.floor) : original.room;
    var legacy = original.availabilityKind === "legacy_candidate";
    var imageUrl = transactionImageUrl(original.thumbnail || (original.images || [])[0]);
    var link = text(original.link || original.sourceUrl);
    return '<div class="operations-transaction-original-v3" data-original-id="' + escape(original.originalId) + '">' +
      '<strong>' + escape(original.source || "출처 미확인") + ' · 광고번호 ' + escape(providerId || "미확인") + '</strong>' +
      '<p>' + escape([original.address || row.address, room].filter(Boolean).join(" ")) + '</p>' +
      (imageUrl ? '<img src="' + escape(imageUrl) + '" alt="해당 후보 광고의 마지막 보관 사진" loading="lazy" referrerpolicy="no-referrer" width="100" height="100">' : '') +
      '<div class="operations-transaction-terms-v2"><b>' + escape(price) + '</b>' +
        '<span>관리비 ' + candidateValueV1(original.fee) + '</span><span>권리금 ' + candidateValueV1(original.premium) + '</span>' +
        '<span>평 ' + candidateValueV1(original.area) + '</span></div>' +
      '<p>' + (legacy ? '기존 화면 유지 기록 · 실제 종료 미검증' :
        '동일 범위 전체수집에서 광고 미노출 확인 · 실제 계약완료 미확정') + '</p>' +
      (/^https?:\/\//i.test(link) && text(original.originalId)
        ? '<button type="button" class="operations-transaction-complete-v2" onclick="openTransactionCandidateOriginalSourceV1(\'' +
          propertyId + '\',\'' + originalId + '\')">이 후보 광고 원본 링크 ↗</button>' : '') + '</div>';
  }

function candidateOriginalListV1(row) {
    var originals = candidateOriginalRowsV1(row);
    var lastPage = Math.max(0, Math.ceil(originals.length / 50) - 1);
    var page = Math.max(0, Math.min(number(state.transactionOriginalPageV1), lastPage));
    state.transactionOriginalPageV1 = page;
    var start = page * 50;
    var shown = originals.slice(start, start + 50);
    var exactCount = row.candidateOriginalCount == null ? originals.length : number(row.candidateOriginalCount);
    var partial = row.candidateOriginalsHasMore || exactCount > originals.length;
    return '<section class="operations-transaction-originals-v3"><h4>후보 광고 ' + exactCount.toLocaleString("ko-KR") + '개</h4>' +
      (partial ? '<p>전체 후보 광고 ' + exactCount.toLocaleString("ko-KR") + '개 중 ' + originals.length.toLocaleString("ko-KR") +
        '개의 원본 정보를 불러왔습니다. 나머지 원본을 종료나 삭제로 판단하지 않습니다.</p>' : '') +
      (shown.length ? shown.map(function(original) { return candidateOriginalCardV1(row, original); }).join("") :
        '<p>이 후보 광고의 개별 정보를 아직 불러오지 못했습니다.</p>') +
      (originals.length > 50 ? '<div role="group" aria-label="후보 광고 페이지">' +
        '<button type="button" onclick="pageTransactionCandidateOriginalsV1(-1)"' + (page ? '' : ' disabled') + '>이전 광고 50개</button> ' +
        '<span>' + (start + 1).toLocaleString("ko-KR") + '–' + (start + shown.length).toLocaleString("ko-KR") +
          ' / ' + originals.length.toLocaleString("ko-KR") + '개</span> ' +
        '<button type="button" onclick="pageTransactionCandidateOriginalsV1(1)"' + (page < lastPage ? '' : ' disabled') +
          '>다음 광고 50개</button></div>' : '') + '</section>';
  }

function transactionCandidateCard(row) {
    var propertyId = text(row.propertyId);
    var candidateId = propertyId;
    var encodedId = encodeURIComponent(candidateId).replace(/'/g, '%27');
    var expanded = state.transactionExpandedId === candidateId;
    var first = (Array.isArray(row.candidateOriginals) ? row.candidateOriginals : []).find(isCandidateOriginalRowV1) || {};
    var price = candidatePriceV1(first, row.tradeType);
    var imageUrl = transactionImageUrl(first.thumbnail || (first.images || [])[0]);
    var sourceText = (row.sources || []).join(" · ") || row.mainSource || row.source || "원본";
    var sourceCount = Math.max(0, number(row.sourceCount != null ? row.sourceCount : row.endedSourceCount));
    var candidateCount = row.candidateOriginalCount == null ? candidateOriginalRowsV1(row).length : number(row.candidateOriginalCount);
    var activeCount = number(row.activeSourceCount);
    var room = typeof window.formatListingRoomForCardV653 === "function"
      ? window.formatListingRoomForCardV653(row.room, row.floor) : row.room;
    var detail = expanded
      ? '<div class="operations-transaction-detail-v2">' +
          '<div class="operations-transaction-photo-v2 ' + (imageUrl ? 'has-photo' : 'no-photo') + '">' +
            (imageUrl
              ? '<img src="' + escape(imageUrl) + '" alt="마지막 정상 매물 사진" loading="lazy" referrerpolicy="no-referrer">'
              : '<span>등록된 사진 없음</span>') +
            '<em>첫 조건 일치 후보 광고의 보관 사진</em>' +
          '</div>' +
          '<div class="operations-transaction-info-v2">' +
            '<strong>' + escape(row.title || row.type || "매물") + '</strong>' +
            '<span>' + escape([row.address, room].filter(Boolean).join(" ")) + '</span>' +
            '<div class="operations-transaction-terms-v2"><b>' + escape(price) + '</b>' +
              '<span>관리비 ' + candidateValueV1(first.fee) + '</span>' +
              '<span>권리금 ' + candidateValueV1(first.premium) + '</span>' +
              '<span>평 ' + candidateValueV1(first.area) + '</span></div>' +
            '<small>통합매물 ' + escape(propertyId) + ' · 출처 ' + escape(sourceText) +
              ' · 연결 원본 ' + sourceCount.toLocaleString("ko-KR") + '개 · 후보 광고 ' + candidateCount.toLocaleString("ko-KR") +
              '개 · 활성 광고 ' + activeCount.toLocaleString("ko-KR") + '개</small>' +
            '<p>후보 광고가 있는 통합매물입니다. 같은 물건의 다른 광고는 정상일 수 있으며, 후보 표시는 실제 계약완료 확인이 아닙니다.</p>' +
            (row.memo ? '<p>' + escape(row.memo) + '</p>' : '<p class="empty">등록된 메모가 없습니다.</p>') +
            candidateOriginalListV1(row) +
          '</div>' +
        '</div>'
      : '';
    return '<article data-property-id="' + escape(propertyId) + '" class="' + (expanded ? 'expanded' : '') + '">' +
      '<div class="operations-transaction-summary-v2">' +
        '<div class="operations-transaction-summary-text-v2"><strong>' + escape(row.title || row.type || "매물") + '</strong>' +
          '<span>' + escape([row.address, room].filter(Boolean).join(" ")) + '</span>' +
          '<small>' + escape(price) + ' · 평 ' + candidateValueV1(first.area) +
          ' · ' + escape(sourceText) + ' · 후보 광고 ' + candidateCount.toLocaleString("ko-KR") +
          '개 · 활성 광고 ' + activeCount.toLocaleString("ko-KR") + '개</small></div>' +
        '<button type="button" onclick="openTransactionCandidatePropertyV1(\'' + encodedId + '\')">' +
          (expanded ? '접기' : '매물 확인') + '</button>' +
      '</div>' + detail + '</article>';
  }

function renderTransactionCandidates(shouldScroll) {
    var panel = document.getElementById("operationsDashboardPanel");
    if (!panel) return;
    var old = document.getElementById("operationsTransactionCandidatesV1");
    if (old) old.remove();
    var section = document.createElement("section");
    section.id = "operationsTransactionCandidatesV1";
    section.className = "operations-transaction-candidates-v1";
    var rows = state.transactionCandidates || [];
    var total = state.transactionCandidateTotal == null ? rows.length : number(state.transactionCandidateTotal);
    var lastPage = Math.max(0, Math.ceil(rows.length / 50) - 1);
    var page = Math.max(0, Math.min(number(state.transactionCandidatePageV1), lastPage));
    state.transactionCandidatePageV1 = page;
    var start = page * 50;
    var visibleRows = rows.slice(start, start + 50);
    var scope = text(state.transactionCandidateScopeV1) || "전체 공개 매물 · 서버 기준";
    var counts = state.transactionCandidatesLoading ? "후보 매물 확인 중" : state.transactionCandidatesErrorV1 ? "후보 확인 실패" :
      "총 " + number(total).toLocaleString("ko-KR") + "개 통합매물";
    if (!state.transactionCandidatesLoading && !state.transactionCandidatesErrorV1) {
      if (state.transactionCandidateAdTotalV1 != null) counts += " · 후보 광고 " + number(state.transactionCandidateAdTotalV1).toLocaleString("ko-KR") + "개";
      if (total > rows.length) counts += " 중 최근 " + rows.length.toLocaleString("ko-KR") + "개 통합매물 불러옴";
    }
    var pagination = rows.length > 50
      ? '<div class="operations-transaction-pagination-v1" role="group" aria-label="거래확인 후보 페이지">' +
          '<button type="button" onclick="pageTransactionCandidatesV1(-1)"' + (page ? '' : ' disabled') + '>이전 50개</button> ' +
          '<span>' + (start + 1).toLocaleString("ko-KR") + '–' + (start + visibleRows.length).toLocaleString("ko-KR") +
            ' / ' + rows.length.toLocaleString("ko-KR") + '개</span> ' +
          '<button type="button" onclick="pageTransactionCandidatesV1(1)"' + (page < lastPage ? '' : ' disabled') + '>다음 50개</button></div>'
      : '';
    section.innerHTML = '<header><div><strong>거래확인 후보 · 통합매물 기준</strong><span>' + escape(scope) + ' · ' + counts +
      '</span></div>' +
      '<button type="button" onclick="closeTransactionCandidatesV1()">닫기</button></header>' +
      '<p>후보 광고가 있는 통합매물을 1건씩 표시합니다. 같은 물건의 다른 정상 광고는 유지하며, 후보 광고의 조건과 원본 링크는 매물을 펼쳐 개별 확인합니다. 직접 계약완료는 별도 집계하며 삭제·게시 보류 매물은 제외합니다.</p>' +
      (state.transactionCandidateSummaryV1 ? '<p>' + escape(transactionScopeHintV1(state.transactionCandidateSummaryV1)) + '</p>' :
        '<p>지도 ‘계약완료만 보기’는 현재 지도·시장·검색조건의 후보와 직접 계약완료를 함께 표시하므로 전체 서버 후보 수와 다를 수 있습니다.</p>') +
      (state.transactionCandidatesLoading
        ? '<p class="operations-transaction-empty-v1">후보 매물을 불러오는 중입니다.</p>'
        : state.transactionCandidatesErrorV1 ? '<p class="operations-transaction-empty-v1">' + escape(state.transactionCandidatesErrorV1) + '</p>'
        : rows.length
          ? '<div class="operations-transaction-list-v1">' + visibleRows.map(transactionCandidateCard).join("") + '</div>' + pagination
          : '<p class="operations-transaction-empty-v1">현재 범위의 거래확인 후보가 없습니다.</p>');
    panel.appendChild(section);
    if (shouldScroll) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

function useCurrentTransactionCandidatesV1(resetPage, summary) {
    summary = summary || currentTransactionSummaryV1(true);
    if (!summary || !Array.isArray(summary.candidates)) return false;
    state.transactionCandidateRequestV1 += 1;
    state.transactionCandidates = summary.candidates;
    state.transactionCandidateTotal = number(summary.candidateCount);
    state.transactionCandidateAdTotalV1 = number(summary.candidateAdCount);
    state.transactionCandidateScopeV1 = text(summary.scopeLabel) || "현재 지도·검색조건";
    state.transactionCandidateSummaryV1 = summary;
    state.transactionCandidatesLoading = false;
    state.transactionCandidatesErrorV1 = "";
    if (resetPage) state.transactionCandidatePageV1 = 0;
    return true;
  }

function revealTransactionCandidateV1(propertyId) {
    if (!propertyId) return;
    var index = (state.transactionCandidates || []).findIndex(function(candidate) {
      return text(candidate.propertyId) === propertyId;
    });
    state.transactionExpandedId = index >= 0 ? propertyId : "";
    state.transactionOriginalPageV1 = 0;
    if (index >= 0) state.transactionCandidatePageV1 = Math.floor(index / 50);
    else setMessage("이 매물은 현재 지도·검색조건의 거래확인 후보가 아닙니다.", "info");
  }

function loadTransactionCandidatesV1(propertyId) {
    state.transactionCandidatesOpenV1 = true;
    state.transactionCandidatePageV1 = 0;
    state.transactionOriginalPageV1 = 0;
    state.transactionCandidatesErrorV1 = "";
    state.transactionExpandedId = "";
    if (useCurrentTransactionCandidatesV1(true)) {
      revealTransactionCandidateV1(propertyId);
      renderTransactionCandidates(true);
      return Promise.resolve();
    }
    var generation = ++state.transactionCandidateRequestV1;
    state.transactionCandidatesLoading = true;
    state.transactionCandidateScopeV1 = "전체 공개 매물 · 서버 기준";
    state.transactionCandidateSummaryV1 = null;
    renderTransactionCandidates(true);
    return apiGet("transactionCandidates").then(function(result) {
      if (generation !== state.transactionCandidateRequestV1 || !state.transactionCandidatesOpenV1) return;
      if (useCurrentTransactionCandidatesV1(true)) {
        revealTransactionCandidateV1(propertyId);
        renderTransactionCandidates(false);
        return;
      }
      if (Number(result.advertisementPolicyVersion) !== 3) throw new Error("광고별 후보 자료를 최신 기준으로 확인하지 못했습니다. 다시 열어 주세요.");
      state.transactionCandidates = result.candidates || [];
      state.transactionCandidateTotal = Number(result.count || 0);
      state.transactionCandidateAdTotalV1 = result.candidateAdCount == null ? null : number(result.candidateAdCount);
      state.transactionCandidatesLoading = false;
      revealTransactionCandidateV1(propertyId);
      renderTransactionCandidates(false);
    }).catch(function(error) {
      if (generation !== state.transactionCandidateRequestV1 || !state.transactionCandidatesOpenV1) return;
      state.transactionCandidatesLoading = false;
      state.transactionCandidatesErrorV1 = error.message || "거래확인 후보를 불러오지 못했습니다.";
      setMessage(error.message || "거래확인 후보를 불러오지 못했습니다.", "error");
      renderTransactionCandidates(false);
    });
  }

window.openTransactionCandidates = function() {
    return loadTransactionCandidatesV1("");
  };

window.openTransactionCandidateFromListingV1 = function(encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    if (!propertyId) return;
    return Promise.resolve(window.openOperationsCenter("dashboard")).then(function() {
      return loadTransactionCandidatesV1(propertyId);
    }).then(function() {
      requestAnimationFrame(function() {
        var expanded = document.querySelector(".operations-transaction-list-v1 article.expanded");
        if (expanded) expanded.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }).catch(function(error) {
      state.transactionCandidatesLoading = false;
      setMessage(error.message || "거래확인 후보를 불러오지 못했습니다.", "error");
      renderTransactionCandidates(false);
    });
  };

window.closeTransactionCandidatesV1 = function() {
    state.transactionCandidatesOpenV1 = false;
    state.transactionCandidateRequestV1 += 1;
    state.transactionExpandedId = "";
    var section = document.getElementById("operationsTransactionCandidatesV1");
    if (section) section.remove();
  };

window.pageTransactionCandidatesV1 = function(direction) {
    state.transactionCandidatePageV1 += Number(direction) < 0 ? -1 : 1;
    state.transactionOriginalPageV1 = 0;
    renderTransactionCandidates(false);
  };

window.pageTransactionCandidateOriginalsV1 = function(direction) {
    state.transactionOriginalPageV1 += Number(direction) < 0 ? -1 : 1;
    renderTransactionCandidates(false);
  };

window.openTransactionCandidatePropertyV1 = function(encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    state.transactionOriginalPageV1 = 0;
    state.transactionExpandedId = state.transactionExpandedId === propertyId ? "" : propertyId;
    renderTransactionCandidates(false);
    if (!state.transactionExpandedId) return;
    requestAnimationFrame(function() {
      var expanded = document.querySelector(".operations-transaction-list-v1 article.expanded");
      if (expanded) expanded.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

window.openTransactionCandidateSourceV1 = function(encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var row = (state.transactionCandidates || []).filter(function(candidate) {
      return text(candidate.propertyId) === propertyId;
    })[0];
    var first = row && candidateOriginalRowsV1(row)[0];
    if (!first) return;
    window.openTransactionCandidateOriginalSourceV1(encodedPropertyId, encodeURIComponent(text(first.originalId)));
  };

window.openTransactionCandidateOriginalSourceV1 = function(encodedPropertyId, encodedOriginalId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var row = (state.transactionCandidates || []).find(function(candidate) { return text(candidate.propertyId) === propertyId; });
    var original = row && candidateOriginalRowsV1(row).find(function(candidate) { return text(candidate.originalId) === originalId; });
    var link = text(original && (original.link || original.sourceUrl));
    if (!/^https?:\/\//i.test(link)) return;
    var popup = window.open(link, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  };

window.completeTransactionCandidateV1 = function() {
    setMessage("광고 미노출은 실제 계약완료와 별도입니다. 계약완료는 매물 상세에서 직접 확인 후 처리해 주세요.", "info");
  };

window.addEventListener("js-listing-availability-changed", function() {
    var center = document.getElementById("operationsCenter");
    if (!center || !center.classList.contains("open") || state.activeTab !== "dashboard") return;
    if (state.transactionAvailabilityFrameV1) return;
    state.transactionAvailabilityFrameV1 = true;
    var schedule = window.requestAnimationFrame || function(callback) { window.setTimeout(callback, 0); };
    schedule(function() {
      state.transactionAvailabilityFrameV1 = false;
      if (!center.classList.contains("open") || state.activeTab !== "dashboard") return;
      renderDashboard();
    });
  });
  function loadOperationsData(force) {
    if (state.loading) return state.loadPromise || Promise.resolve();
    if (!force && state.dashboardLoaded && Date.now() - state.dashboardLoadedAt < 60000) { renderDashboard(); return Promise.resolve(); }
    state.loading = true;
    setMessage("운영자료를 불러오는 중입니다…", "loading");
    state.loadPromise = apiGet("operationsDashboard").then(function(result) {
      state.dashboard = result; state.dashboardLoaded = true; state.loaded = true; state.dashboardLoadedAt = Date.now();
      renderDashboard(); persistOperationsCache(); setMessage("운영자료가 최신 상태로 연결되었습니다.", "success");
    }).catch(function(error) { setMessage(error.message || "운영자료 조회에 실패했습니다.", "error"); })
      .finally(function() { state.loading = false; state.loadPromise = null; });
    return state.loadPromise;
  }
  window.switchOperationsTab = function() {
    state.activeTab = "dashboard";
    var panel = document.getElementById("operationsDashboardPanel"), button = document.getElementById("operationsTabDashboard");
    if (panel) panel.hidden = false;
    if (button) button.classList.add("active");
    if (document.getElementById("operationsCenter").classList.contains("open")) return loadOperationsData(false);
    return Promise.resolve();
  };
  document.addEventListener("keydown", function(event) {
    if (event.defaultPrevented || event.isComposing || event.key !== "Escape") return;
    if (document.querySelector("dialog[open], .unified-gallery-modal-v8.open, .tell-modal-v8.open")) return;
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (drawer && drawer.getAttribute("aria-hidden") !== "true") return;
    var center = document.getElementById("operationsCenter");
    if (center && center.classList.contains("open")) { event.preventDefault(); event.stopImmediatePropagation(); window.closeOperationsCenter(); }
  });
  try {
    var cache = JSON.parse(sessionStorage.getItem(OPERATIONS_CACHE_KEY) || "null");
    if (cache && Date.now() - Number(cache.at || 0) <= OPERATIONS_CACHE_MAX_AGE && cache.dashboard && Number(cache.dashboard.advertisementPolicyVersion) === 3) {
      state.dashboard = cache.dashboard; state.dashboardLoaded = true; state.dashboardLoadedAt = Number(cache.at);
    }
  } catch (_) {}
  function refreshVisibleDashboard() {
    var center = document.getElementById("operationsCenter");
    if (document.visibilityState === "visible" && center && center.classList.contains("open") && state.activeTab === "dashboard") loadOperationsData(true);
  }
  if (typeof window.setInterval === "function") window.setInterval(refreshVisibleDashboard, 180000);
  document.addEventListener("visibilitychange", refreshVisibleDashboard);
})();
