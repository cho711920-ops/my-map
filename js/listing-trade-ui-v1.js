(function (global) {
  "use strict";

  var MODES = {
    lease: { label: "상가임대", tradeType: "lease", group: "lease" },
    building_sale: { label: "건물매매", tradeType: "sale", group: "building" },
    land_sale: { label: "토지매매", tradeType: "sale", group: "land" }
  };
  var BUILDING_CATEGORIES = {
    commercial: true,
    multifamily: true,
    house: true,
    building: true,
    factory_warehouse: true,
    apartment: true, villa: true, officetel: true, one_room: true, office: true,
    mixed_house: true, reconstruction: true, redevelopment: true,
    apartment_presale: true, officetel_presale: true, knowledge_center: true,
    other: true
  };
  var currentMode = "lease";

  function clean(value) { return String(value == null ? "" : value).trim(); }

  function normalizedTradeType(item) {
    var value = clean(item && (item.tradeType || item.trade_type)).toLowerCase();
    if (value === "sale" || value === "매매" || value === "buy") return "sale";
    return "lease";
  }

  function normalizedSaleCategory(item) {
    var value = clean(item && (item.saleCategory || item.sale_category)).toLowerCase();
    var compact = value.replace(/[\s/_-]+/g, "");
    var aliases = {
      commercial: "commercial", "상가": "commercial", "상가매매": "commercial",
      multifamily: "multifamily", "다가구": "multifamily", "다세대": "villa",
      apartment: "apartment", "아파트": "apartment", villa: "villa", "빌라": "villa",
      officetel: "officetel", "오피스텔": "officetel", oneroom: "one_room", "원룸": "one_room",
      office: "office", "사무실": "office", mixedhouse: "mixed_house", "상가주택": "mixed_house",
      reconstruction: "reconstruction", redevelopment: "redevelopment",
      apartmentpresale: "apartment_presale", officetelpresale: "officetel_presale",
      knowledgecenter: "knowledge_center",
      house: "house", "주택": "house", "단독주택": "house",
      building: "building", "건물": "building", "통건물": "building", "빌딩": "building",
      land: "land", "토지": "land", "대지": "land", "임야": "land",
      factorywarehouse: "factory_warehouse", "공장창고": "factory_warehouse",
      other: "other", "기타": "other"
    };
    return aliases[compact] || compact;
  }

  function matchesItem(item, mode) {
    var selected = MODES[mode || currentMode] || MODES.lease;
    var tradeType = normalizedTradeType(item);
    if (tradeType !== selected.tradeType) return false;
    if (selected.group === "lease") return true;
    var category = normalizedSaleCategory(item);
    if (selected.group === "land") return category === "land";
    return category !== "land" && Boolean(BUILDING_CATEGORIES[category || "other"]);
  }

  function updateFilterLabels() {
    var sale = currentMode !== "lease";
    var depositMin = document.getElementById("minDeposit");
    var depositMax = document.getElementById("maxDeposit");
    var rentRow = document.getElementById("listingTradeRentFilterRowV1");
    var premiumRow = document.getElementById("listingTradePremiumFilterRowV1");
    var brokerage = document.querySelector(".list-brokerage-control");
    if (depositMin) {
      depositMin.placeholder = sale ? "매매가 최소(만원)" : "보증금 최소";
      depositMin.setAttribute("aria-label", sale ? "매매가 최소" : "보증금 최소");
    }
    if (depositMax) {
      depositMax.placeholder = sale ? "매매가 최대(만원)" : "보증금 최대";
      depositMax.setAttribute("aria-label", sale ? "매매가 최대" : "보증금 최대");
    }
    if (rentRow) rentRow.hidden = sale;
    if (premiumRow) premiumRow.hidden = sale;
    if (brokerage) brokerage.hidden = sale;
  }

  function updateSelector() {
    var select = document.getElementById("listingTradeModeSelectV1");
    var label = document.getElementById("listingTradeModeLabelV1");
    if (select) select.value = currentMode;
    if (label) label.textContent = MODES[currentMode].label;
    document.documentElement.setAttribute("data-listing-trade-mode", currentMode);
    updateFilterLabels();
  }

  function setMode(mode, options) {
    if (!MODES[mode]) mode = "lease";
    var previousMode = currentMode;
    currentMode = mode;
    if (previousMode !== currentMode && (!options || options.resetFilters !== false)) {
      ["typeFilter", "minDeposit", "maxDeposit", "minRent", "maxRent", "minPremium", "maxPremium"]
        .forEach(function(id) {
          var element = document.getElementById(id);
          if (element) element.value = "";
        });
    }
    updateSelector();
    if (typeof global.updateTypeOptions === "function") global.updateTypeOptions(global.allItems || []);
    if ((!options || options.apply !== false) && typeof global.applyFilter === "function") global.applyFilter();
    global.dispatchEvent(new CustomEvent("js-listing-trade-mode-change", {
      detail: { mode: currentMode, tradeType: MODES[currentMode].tradeType }
    }));
  }

  function onSelectorChange(select) {
    setMode(clean(select && select.value));
  }

  function displayPrice(item) {
    if (normalizedTradeType(item) === "sale") {
      var price = Number(item && (item.salePrice ?? item.sale_price));
      return Number.isFinite(price) ? price : 0;
    }
    return Number(item && item.deposit) || 0;
  }

  function modeLabel() { return MODES[currentMode].label; }
  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, function(ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function nonnegative(value) {
    if (value == null || clean(value) === "" || typeof value === "boolean") return null;
    var parsed = Number(clean(value).replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  function sourceName(value) {
    var name = clean(value).toLowerCase();
    if (/공실|gongsil/.test(name)) return "gongsil";
    if (/네이버|naver/.test(name)) return "naver";
    if (/당근|daangn|danggeun|karrot/.test(name)) return "daangn";
    return name;
  }
  function saleSummary(item) {
    if (!isSale(item)) return {};
    if (item.saleDetails || item.saleSummary) return item.saleDetails || item.saleSummary;
    // Never combine a representative's price with another source's income.
    var price = nonnegative(item.salePrice ?? item.sale_price);
    var candidates = (item.unifiedOriginalsV8 || []).filter(function(original) {
      return isSale(original) && price > 0 && nonnegative(original.salePrice) === price &&
        sourceName(original.source) === sourceName(item.source) &&
        normalizedSaleCategory(original) === normalizedSaleCategory(item);
    });
    var link = clean(item.sourceLink);
    var linked = link ? candidates.filter(function(original) { return clean(original.link) === link; }) : [];
    if (linked.length) candidates = linked;
    if (!candidates.length) return {};
    var first = candidates[0].saleDetails || candidates[0].saleSummary || {};
    var keys = ["scope", "landAreaM2", "grossAreaM2", "exclusiveAreaM2", "totalDeposit", "monthlyIncome"];
    return candidates.every(function(original) {
      var summary = original.saleDetails || original.saleSummary || {};
      return keys.every(function(key) { return clean(summary[key]) === clean(first[key]); });
    }) ? first : {};
  }
  var yieldExplanation = "연 임대수입 ÷ (매매가 − 임대보증금) × 100. 보증금 차감 기준 단순 연 수익률이며 대출이자·취득비용·세금·공실·운영비는 미반영입니다.";
  function saleYield(item) {
    if (!isSale(item)) return null;
    var detail = saleSummary(item);
    var price = nonnegative(item.salePrice ?? item.sale_price);
    var deposit = nonnegative(detail.totalDeposit);
    var income = nonnegative(detail.monthlyIncome);
    if (!(price > 0) || deposit == null || income == null || price <= deposit) return null;
    var rate = income * 12 / (price - deposit) * 100;
    return Number.isFinite(rate) ? rate : null;
  }
  function saleYieldBadge(item) {
    if (!isSale(item)) return "";
    var rate = saleYield(item);
    return '<span class="pyeong-mini-badge listing-sale-yield-v1' + (rate == null ? ' unavailable' : '') +
      '" title="' + escapeHtml(yieldExplanation) + '" aria-label="' +
      escapeHtml(rate == null ? '수익률 확인 필요: 매매가·임대보증금·월수입 확인 필요' : '보증금 차감 기준 단순 연 수익률 ' + rate.toFixed(2) + '%') +
      '">수익률 ' + (rate == null ? '확인 필요' : rate.toFixed(2) + '%') + '</span>';
  }
  function saleAreaHtml(item) {
    if (!isSale(item)) return "";
    var detail = saleSummary(item);
    var land = detail.scope === "land" || normalizedSaleCategory(item) === "land";
    function area(label, value, fullLabel) {
      var parsed = nonnegative(value);
      var formatted = parsed > 0 ? (parsed / 3.305785).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + '평' : '미확인';
      return '<span title="' + escapeHtml(fullLabel) + '">' + escapeHtml(label) + ' <b>' + escapeHtml(formatted) + '</b></span>';
    }
    var html = area(land ? '토지' : '대지', detail.landAreaM2, land ? '토지면적' : '대지면적');
    if (!land) html += '<i>·</i>' + area('연', detail.grossAreaM2, '연면적');
    if (!land && nonnegative(detail.exclusiveAreaM2) > 0) html += '<i>·</i>' + area('전용', detail.exclusiveAreaM2, '전용면적');
    return '<span class="listing-sale-areas-v1">' + html + '</span>';
  }
  function saleDetailsHtml(item) {
    if (!isSale(item) || !item.saleDetails) return "";
    var detail = item.saleDetails;
    var escape = function(value) { return clean(value).replace(/[&<>"']/g, function(ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    }); };
    var rows = [];
    function add(label, value, suffix) {
      if (value == null || value === "") return;
      rows.push('<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + escape(suffix || "") + '</dd></div>');
    }
    function area(label, value) {
      if (!(Number(value) > 0)) return;
      add(label, Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "㎡ (" +
        (Number(value) / 3.305785).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "평)");
    }
    add("매매 범위", { land: "토지", whole_building: "건물 전체", unit: "개별 공간" }[detail.scope]);
    area("대지면적", detail.landAreaM2);
    area("연면적", detail.grossAreaM2);
    area("건축면적", detail.buildingAreaM2);
    area("전용면적", detail.exclusiveAreaM2);
    add("기존 보증금 합계", detail.totalDeposit, "만원");
    add("기존 월 임대수입", detail.monthlyIncome, "만원");
    var rate = saleYield(item);
    add("단순 연 수익률", rate == null ? "확인 필요" : rate.toFixed(2) + "% (보증금 차감)");
    add("지상층수", detail.aboveGroundFloors, "층");
    add("지하층수", detail.belowGroundFloors, "층");
    add("방 수", detail.roomCount, "개"); add("욕실 수", detail.bathroomCount, "개");
    add("지목", detail.landUse); add("용도지역", detail.zoning);
    add("도로접면", detail.roadAccess); add("건축물 용도", detail.buildingUse);
    add("사용승인일", detail.approvalDate);
    return rows.length ? '<dl class="listing-sale-details-v1">' + rows.join("") +
      '</dl><p class="listing-sale-yield-note-v1">' + escapeHtml(yieldExplanation) + '</p>' : "";
  }
  function getMode() { return currentMode; }
  function isSale(item) { return normalizedTradeType(item) === "sale"; }

  global.JSListingTradeV1 = {
    modes: MODES,
    getMode: getMode,
    setMode: setMode,
    modeLabel: modeLabel,
    onSelectorChange: onSelectorChange,
    matchesItem: matchesItem,
    normalizedTradeType: normalizedTradeType,
    normalizedSaleCategory: normalizedSaleCategory,
    displayPrice: displayPrice,
    saleDetailsHtml: saleDetailsHtml,
    saleSummary: saleSummary,
    saleYield: saleYield,
    saleYieldBadge: saleYieldBadge,
    saleAreaHtml: saleAreaHtml,
    isSale: isSale
  };

  updateSelector();
})(window);
