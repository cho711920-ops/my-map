(function () {
  "use strict";

  var CACHE_PREFIX = "jsRegionalMarketV1:";
  var CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  var requestSequence = 0;
  var regionalDataByItemKey = {};

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, digits) {
    var parsed = number(value);
    if (parsed === null) return "-";
    return parsed.toLocaleString("ko-KR", {
      maximumFractionDigits: typeof digits === "number" ? digits : 1
    });
  }

  function escapeHtml(value) {
    if (typeof window.escapeHtml === "function") {
      return window.escapeHtml(String(value == null ? "" : value));
    }
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function itemKey(item) {
    return String((item && (item.key || item.propertyId || item.id)) || "");
  }

  function coordinates(item) {
    if (!item) return null;
    var lat = item.lat;
    var lng = item.lng;
    if (item.latlng) {
      lat = typeof item.latlng.getLat === "function" ? item.latlng.getLat() : lat;
      lng = typeof item.latlng.getLng === "function" ? item.latlng.getLng() : lng;
    }
    lat = Number(lat);
    lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat, lng: lng } : null;
  }

  function cacheKey(item, coords) {
    return CACHE_PREFIX + [
      itemKey(item),
      coords.lat.toFixed(4),
      coords.lng.toFixed(4)
    ].join("|");
  }

  function readCache(key) {
    try {
      var saved = JSON.parse(localStorage.getItem(key) || "null");
      var ttl = saved && Number(saved.ttlMs) > 0 ? Number(saved.ttlMs) : CACHE_TTL_MS;
      if (!saved || !saved.savedAt || Date.now() - saved.savedAt > ttl) return null;
      return saved.data || null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      var ready = data && data.sgis && data.sgis.status === "ready" &&
        data.rone && data.rone.status === "ready";
      localStorage.setItem(key, JSON.stringify({
        savedAt: Date.now(),
        ttlMs: ready ? CACHE_TTL_MS : 5 * 60 * 1000,
        data: data
      }));
    } catch (_) {}
  }

  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var callbackName = "__jsRegionalMarket" + Date.now() + "_" + (++requestSequence);
      var script = document.createElement("script");
      var timer = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      }

      window[callbackName] = function (data) {
        cleanup();
        resolve(data);
      };
      script.onerror = function () {
        cleanup();
        reject(new Error("지역 공공데이터를 불러오지 못했습니다."));
      };
      timer = setTimeout(function () {
        cleanup();
        reject(new Error("지역 공공데이터 응답이 지연되고 있습니다."));
      }, timeoutMs || 40000);
      script.src = url + (url.indexOf("?") >= 0 ? "&" : "?") +
        "callback=" + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
  }

  function ensureSlot() {
    var commerce = document.getElementById("publicCommercialBrief");
    if (!commerce) return null;
    var existing = document.getElementById("regionalMarketBrief");
    if (existing) return existing;
    var section = document.createElement("section");
    section.className = "regional-market-card";
    section.id = "regionalMarketBrief";
    var commerceSection = commerce.closest("section") || commerce.parentNode;
    commerceSection.parentNode.insertBefore(section, commerceSection.nextSibling);
    return section;
  }

  function sourceBadge(type, label) {
    var logo = type === "sgis"
      ? "https://sgis.mods.go.kr/mobile/resources/m2021/img/img2022/logo2022.png"
      : "https://www.reb.or.kr/r-one/images/rone/portal/logo@2x.png";
    return '<span class="regional-source regional-source-' + type + '">' +
      '<img src="' + logo + '" alt="' + escapeHtml(label) + ' 공식 로고" referrerpolicy="no-referrer">' +
      '<em>' + escapeHtml(label) + '</em></span>';
  }

  function setupPanel(type, title, source, message) {
    return '<section class="regional-block regional-block-setup">' +
      '<div class="regional-title"><div>' + sourceBadge(type, source) +
      '<h4>' + escapeHtml(title) + '</h4></div><span>연결 준비</span></div>' +
      '<p>' + escapeHtml(message) + '</p>' +
      '<small>인증정보는 웹 코드가 아니라 Cloudflare 비밀 변수에 보관합니다.</small>' +
      '</section>';
  }

  function errorPanel(type, title, source, message) {
    return '<section class="regional-block regional-block-error">' +
      '<div class="regional-title"><div>' + sourceBadge(type, source) +
      '<h4>' + escapeHtml(title) + '</h4></div><span>조회 확인</span></div>' +
      '<p>' + escapeHtml(message || "자료를 불러오지 못했습니다.") + '</p></section>';
  }

  function demandPanel(sgis) {
    if (!sgis || sgis.status === "setup_required") {
      return setupPanel("sgis", "배후수요 분석", "SGIS", sgis && sgis.message);
    }
    if (sgis.status !== "ready") {
      return errorPanel("sgis", "배후수요 분석", "SGIS", sgis && sgis.message);
    }
    var location = sgis.location || {};
    return '<section class="regional-block">' +
      '<div class="regional-title"><div>' + sourceBadge("sgis", "SGIS") +
      '<h4>배후수요 분석</h4></div><span>' + escapeHtml(location.dong || "행정동") + ' 기준</span></div>' +
      '<div class="regional-demand-type"><span>수요구조 판독</span><strong>' +
        escapeHtml(sgis.demandType || "혼합형 배후수요") + '</strong><p>' +
        escapeHtml(sgis.interpretation || "") + '</p></div>' +
      '<div class="regional-metric-grid regional-metric-grid-six">' +
        metric("거주인구", formatNumber(sgis.residents, 0), "명") +
        metric("가구", formatNumber(sgis.households, 0), "가구") +
        metric("평균연령", formatNumber(sgis.averageAge, 1), "세") +
        metric("사업체", formatNumber(sgis.companies, 0), "개") +
        metric("종사자", formatNumber(sgis.employees, 0), "명") +
        metric("종사자/거주인구", formatNumber(sgis.employeeResidentRatio, 1), "%") +
      '</div>' +
      '<div class="regional-evidence">공식통계: 인구·가구 ' + escapeHtml(sgis.populationYear || "-") +
        '년 / 사업체·종사자 ' + escapeHtml(sgis.companyYear || "-") +
        '년 · 행정동 ' + escapeHtml(location.fullAddress || "-") + '</div>' +
      '</section>';
  }

  function metric(label, value, unit) {
    return '<div class="regional-metric"><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(value) + '<small>' + escapeHtml(unit || "") + '</small></strong></div>';
  }

  function marketMetric(row) {
    var local = number(row && row.value);
    var national = number(row && row.nationwideValue);
    var delta = local !== null && national !== null ? Math.round((local - national) * 10) / 10 : null;
    var comparison = delta === null ? "전국 비교 없음" :
      "전국 대비 " + (delta > 0 ? "+" : "") + formatNumber(delta, 1) + (row.unit || "");
    return '<div class="regional-market-metric"><span>' + escapeHtml(row.name || "지표") + '</span>' +
      '<strong>' + formatNumber(local, 2) + '<small>' + escapeHtml(row.unit || "") + '</small></strong>' +
      '<em>' + escapeHtml(comparison) + '</em></div>';
  }

  function rentalPanel(rone) {
    if (!rone || rone.status === "setup_required") {
      return setupPanel("rone", "임대시장 분석", "한국부동산원 R-ONE", rone && rone.message);
    }
    if (rone.status !== "ready") {
      return errorPanel("rone", "임대시장 분석", "한국부동산원 R-ONE", rone && rone.message);
    }
    var metrics = Array.isArray(rone.metrics) ? rone.metrics : [];
    var market = metrics.length ? metrics[0].market : "";
    var exact = metrics.some(function (row) { return row.exactMarketMatch; });
    var basisText = exact
      ? "매물 주소와 일치하는 R-ONE 조사시장"
      : (market && market !== "전국" ? "세부 조사시장 미일치 · 시도 기준" : "세부 조사시장 없음 · 전국 기준");
    return '<section class="regional-block">' +
      '<div class="regional-title"><div>' + sourceBadge("rone", "한국부동산원 R-ONE") +
      '<h4>임대시장 분석</h4></div><span>' + escapeHtml(rone.period || "최신 분기") + '</span></div>' +
      '<div class="regional-market-basis"><span>비교시장</span><strong>' +
        escapeHtml(market || "전국") + '</strong><small>' +
        escapeHtml(basisText) + '</small></div>' +
      '<div class="regional-market-grid">' + metrics.map(marketMetric).join("") + '</div>' +
      '<div class="regional-evidence">' + escapeHtml(rone.note || "") + '</div>' +
      '</section>';
  }

  function findMetric(rone, name) {
    var rows = rone && Array.isArray(rone.metrics) ? rone.metrics : [];
    return rows.find(function (row) { return row.name === name; }) || null;
  }

  function combinedPanel(data, item) {
    var sgis = data && data.sgis;
    var rone = data && data.rone;
    var lines = [];
    if (sgis && sgis.status === "ready") {
      lines.push(sgis.demandType + "로, " + sgis.interpretation);
    }
    var vacancy = findMetric(rone, "공실률");
    if (vacancy && number(vacancy.value) !== null) {
      var vacancyText = "비교시장 공실률은 " + formatNumber(vacancy.value, 1) + "%";
      if (number(vacancy.nationwideValue) !== null) {
        vacancyText += number(vacancy.value) > number(vacancy.nationwideValue)
          ? "로 전국보다 높아 임차수요 검증이 중요합니다."
          : "로 전국 이하여서 공실 부담은 상대적으로 낮은 편입니다.";
      } else {
        vacancyText += "입니다.";
      }
      lines.push(vacancyText);
    }
    var marketRent = findMetric(rone, "시장 임대료");
    var area = number(item && item.area);
    var itemRent = number(item && item.rent);
    if (marketRent && area && itemRent !== null && number(marketRent.value) !== null) {
      var itemPerPyeong = Math.round((itemRent / area) * 10) / 10;
      var marketPerPyeong = Math.round((number(marketRent.value) * 3.3058 / 10) * 10) / 10;
      lines.push("매물 월세는 평당 약 " + formatNumber(itemPerPyeong, 1) +
        "만원, R-ONE 표본 임대료 환산값은 평당 약 " + formatNumber(marketPerPyeong, 1) +
        "만원입니다. 관리비·층·시설 차이는 별도 조정해야 합니다.");
    }
    if (!lines.length) return "두 공공데이터 인증을 연결하면 배후수요와 임대시장 지표를 합친 중개 브리핑이 표시됩니다.";
    return lines.join(" ");
  }

  function render(slot, data, item) {
    regionalDataByItemKey[itemKey(item)] = data;
    slot.innerHTML = '<div class="regional-market-head"><div><span>공공데이터 확장 분석</span>' +
      '<h3>배후수요 · 임대시장 브리핑</h3></div><b>2단계</b></div>' +
      '<div class="regional-combined"><span>중개 브리핑 요약</span><p>' +
      escapeHtml(combinedPanel(data, item)) + '</p><small>공식 통계와 매물조건을 결합한 해석이며, 개별 매출·유동인구를 추정하지 않습니다.</small></div>' +
      '<div class="regional-blocks">' + demandPanel(data.sgis) + rentalPanel(data.rone) + '</div>' +
      '<div class="regional-foot">출처: SGIS · 한국부동산원 R-ONE · 조회 ' +
      escapeHtml(data.generatedAt || "-") + (data.cached ? " · 캐시 사용" : "") + '</div>';
  }

  function renderLoading(slot) {
    slot.innerHTML = '<div class="regional-loading"><b>배후수요와 임대시장 자료를 확인하고 있습니다</b>' +
      '<span>SGIS 행정동 통계와 R-ONE 최신 분기를 각각 조회합니다.</span></div>';
  }

  function renderError(slot, message) {
    slot.innerHTML = '<div class="regional-error"><b>지역 분석을 불러오지 못했습니다</b><span>' +
      escapeHtml(message || "잠시 후 다시 시도해주세요.") + '</span></div>';
  }

  function loadRegionalMarket(item) {
    var slot = ensureSlot();
    if (!slot) return;
    var coords = coordinates(item);
    if (!coords || !window.saveApiURL) {
      renderError(slot, !coords ? "매물 좌표가 없습니다." : "JS부동산 서버 주소가 설정되지 않았습니다.");
      return;
    }
    var key = cacheKey(item, coords);
    var cached = readCache(key);
    if (cached && cached.ok) {
      render(slot, cached, item);
      return;
    }
    renderLoading(slot);
    var params = [
      "action=regionalMarket",
      "lat=" + encodeURIComponent(coords.lat),
      "lng=" + encodeURIComponent(coords.lng),
      "address=" + encodeURIComponent((item && item.address) || ""),
      "propertyId=" + encodeURIComponent((item && (item.propertyId || item.id || item.key)) || "")
    ].join("&");
    jsonp(window.saveApiURL + (window.saveApiURL.indexOf("?") >= 0 ? "&" : "?") + params, 50000)
      .then(function (data) {
        if (!data || !data.ok || data.action !== "regionalMarket") {
          throw new Error((data && data.message) || "지역 분석 API 설정을 확인해주세요.");
        }
        writeCache(key, data);
        render(slot, data, item);
      })
      .catch(function (error) {
        renderError(slot, error && error.message);
      });
  }

  function regionalReportText(item) {
    var data = regionalDataByItemKey[itemKey(item)];
    if (!data) return "";
    var lines = ["", "[배후수요·임대시장 브리핑]", combinedPanel(data, item)];
    if (data.sgis && data.sgis.status === "ready") {
      lines.push("SGIS " + (data.sgis.location && data.sgis.location.fullAddress || "행정동") +
        ": 거주인구 " + formatNumber(data.sgis.residents, 0) + "명 / 가구 " +
        formatNumber(data.sgis.households, 0) + " / 사업체 " + formatNumber(data.sgis.companies, 0) +
        " / 종사자 " + formatNumber(data.sgis.employees, 0));
    }
    if (data.rone && data.rone.status === "ready") {
      lines.push("R-ONE " + (data.rone.period || "최신 분기") + ": " + data.rone.metrics.map(function (row) {
        return row.name + " " + formatNumber(row.value, 2) + (row.unit || "");
      }).join(" / "));
    }
    lines.push("출처: SGIS · 한국부동산원 R-ONE");
    return lines.join("\n");
  }

  var originalLoad = window.loadPublicCommercialBrief;
  window.loadPublicCommercialBrief = function (item) {
    if (typeof originalLoad === "function") originalLoad(item);
    setTimeout(function () { loadRegionalMarket(item); }, 0);
  };

  var originalAnalysisText = window.buildSmartItemAnalysisText;
  window.buildSmartItemAnalysisText = function (item) {
    var base = typeof originalAnalysisText === "function" ? originalAnalysisText(item) : "";
    return base + regionalReportText(item);
  };

  var originalPrint = window.printAIInvestmentReport;
  window.printAIInvestmentReport = function () {
    var card = document.querySelector(".ai-professional-card");
    if (!card) {
      if (typeof originalPrint === "function") originalPrint();
      return;
    }
    var popup = window.open("", "_blank", "width=980,height=1100");
    if (!popup) {
      alert("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해주세요.");
      return;
    }
    popup.document.open();
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><base href="' +
      escapeHtml(location.href) + '"><title>JS부동산 상가 매물 전문 브리핑</title>' +
      '<link rel="stylesheet" href="css/commercial-public-v6.css?v=6.4.15-readable">' +
      '<link rel="stylesheet" href="css/regional-market-v1.css?v=1.0.5-readable">' +
      '<link rel="stylesheet" href="css/ai-report-print-v1.css?v=1.0.0">' +
      '</head><body><main class="print-wrap">' + card.outerHTML + '</main></body></html>');
    popup.document.close();
    var printed = false;
    function startPrint() {
      if (printed || popup.closed) return;
      printed = true;
      popup.focus();
      popup.print();
    }
    if (popup.document.readyState === "complete") {
      setTimeout(startPrint, 250);
    } else {
      popup.addEventListener("load", function () {
        setTimeout(startPrint, 250);
      }, { once: true });
    }
    setTimeout(startPrint, 3000);
  };
})();
