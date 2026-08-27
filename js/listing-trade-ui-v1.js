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
    add("지상층수", detail.aboveGroundFloors, "층");
    add("지하층수", detail.belowGroundFloors, "층");
    add("방 수", detail.roomCount, "개"); add("욕실 수", detail.bathroomCount, "개");
    add("지목", detail.landUse); add("용도지역", detail.zoning);
    add("도로접면", detail.roadAccess); add("건축물 용도", detail.buildingUse);
    add("사용승인일", detail.approvalDate);
    return rows.length ? '<dl class="listing-sale-details-v1">' + rows.join("") + '</dl>' : "";
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
    isSale: isSale
  };

  updateSelector();
})(window);
