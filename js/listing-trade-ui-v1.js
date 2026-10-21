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

  // Display-only translation: legacy favorite/selection keys contain item.type.
  // Never replace that stored value when rendering an existing listing.
  var NAVER_TYPES = {
    A01: ["아파트", "apartment"], A02: ["오피스텔", "officetel"],
    A04: ["재건축", "reconstruction"], A05: ["연립", "villa"], A06: ["다세대", "villa"],
    A07: ["도시형생활주택", "other"], B01: ["아파트분양권", "apartment_presale"],
    B02: ["오피스텔분양권", "officetel_presale"], C01: ["원룸", "one_room"],
    C02: ["빌라/연립", "villa"], C03: ["단독/다가구", "house"], C04: ["전원주택", "house"],
    C06: ["한옥주택", "house"], D01: ["사무실", "office"], D02: ["상가점포", "commercial"],
    D03: ["빌딩/건물", "building"], D04: ["상가건물", "building"], D05: ["상가주택", "mixed_house"],
    E01: ["숙박/콘도", "other"], E02: ["공장/창고", "factory_warehouse"], E03: ["토지/임야", "land"],
    E04: ["지식산업센터", "knowledge_center"], F01: ["재개발", "redevelopment"],
    G01: ["고시원", "other"], Z00: ["기타", "other"],
    APT: ["아파트", "apartment"], OPST: ["오피스텔", "officetel"], JGC: ["재건축", "reconstruction"],
    ABYG: ["아파트분양권", "apartment_presale"], OBYG: ["오피스텔분양권", "officetel_presale"],
    VL: ["빌라/연립", "villa"], DSD: ["다세대", "villa"], DDDGG: ["단독/다가구", "house"],
    JWJT: ["전원주택", "house"], SGJT: ["상가주택", "mixed_house"], OR: ["원룸", "one_room"],
    JGB: ["재개발", "redevelopment"], TJ: ["토지/임야", "land"], GM: ["빌딩/건물", "building"],
    GJCG: ["공장/창고", "factory_warehouse"], APTHG: ["지식산업센터", "knowledge_center"]
  };

  function naverTypeLabel(value) {
    var text = clean(value);
    var entry = NAVER_TYPES[text.toUpperCase()];
    if (entry) return entry[0];
    return /^[A-Z][A-Z0-9_]*$/i.test(text) ? "기타(유형 확인 필요)" : text;
  }

  function isNaverItem(item) {
    return /^(naver|네이버)$/i.test(clean(item && (item.source || item.mainSource || item.main_source)));
  }

  function displayType(item) {
    var value = clean(item && (item.type || item.listing_type || item.category));
    return isNaverItem(item) ? naverTypeLabel(value) : value;
  }

  function naverCategory(item) {
    if (!isNaverItem(item)) return "";
    var detail = item.saleDetails || item.saleSummary || {};
    var value = clean(item.type || item.listing_type || item.category || detail.sourceType);
    var entry = NAVER_TYPES[value.toUpperCase()] || NAVER_TYPES[clean(item.realEstateTypeCode || detail.sourceTypeCode).toUpperCase()];
    if (!entry) {
      Object.keys(NAVER_TYPES).some(function(code) {
        if (NAVER_TYPES[code][0] !== value) return false;
        entry = NAVER_TYPES[code];
        return true;
      });
    }
    return entry ? entry[1] : "";
  }

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
    var category = aliases[compact] || compact;
    return !category || category === "other" ? naverCategory(item) || category : category;
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
    if (global.JSSaleWorkbenchV1) global.JSSaleWorkbenchV1.syncMode();
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
    // Dismiss the previous market's detail/photo overlay before replacing its list.
    // This also invalidates pending detail responses without restoring stale focus.
    if (previousMode !== mode && global.JSUnifiedListingsV8 && typeof global.JSUnifiedListingsV8.closeForOverlay === "function") global.JSUnifiedListingsV8.closeForOverlay();
    currentMode = mode;
    if (previousMode !== currentMode && (!options || options.resetFilters !== false)) {
      ["typeFilter", "minDeposit", "maxDeposit", "minRent", "maxRent", "minPremium", "maxPremium", "minArea", "maxArea", "minFloor", "maxFloor", "floorQuickFilter", "brokerageFeeFilter"]
        .forEach(function(id) {
          var element = document.getElementById(id);
          if (element) element.value = "";
        });
      var sort = document.getElementById("sortFilter");
      if (sort) sort.value = "latest";
      if (typeof global.updateSortDropdownUI === "function") global.updateSortDropdownUI();
    }
    if (previousMode !== currentMode && (!options || options.resetFilters !== false) && global.JSSaleWorkbenchV1) global.JSSaleWorkbenchV1.reset();
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
  function saleSummary(item, comparisonKeys) {
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
    var keys = comparisonKeys || ["scope", "landAreaM2", "grossAreaM2", "exclusiveAreaM2", "buildingAreaM2", "totalDeposit", "monthlyIncome", "monthlyNetIncome", "statedMonthlyIncome", "loanAmount", "investmentAmount", "advertisedYield", "landUse", "zoning"];
    return candidates.every(function(original) {
      var summary = original.saleDetails || original.saleSummary || {};
      return keys.every(function(key) {
        return summary[key] && typeof summary[key] === 'object' || first[key] && typeof first[key] === 'object'
          ? JSON.stringify(summary[key]) === JSON.stringify(first[key]) : clean(summary[key]) === clean(first[key]);
      });
    }) ? first : {};
  }

  // Stored scope has provider/quick-add defaults. Only the read adapter's
  // evidence-backed saleExtent says what is actually being sold.
  function buildingSaleSummary(item, keys) {
    if (!isSale(item)) return {};
    var detail = item.saleDetails || item.saleSummary || {};
    if (detail.saleExtent || !item) return detail;
    if (item.saleSummary && item.saleSummary.saleExtent) return item.saleSummary;
    if (!item.unifiedOriginalsV8) return detail;
    // A legacy master snapshot can lack the new read-only evidence. Prefer
    // a compatible representative source, using the usual price/source guard.
    // An explicit representative link must match; another ad is not evidence.
    var originals = item.unifiedOriginalsV8;
    if (clean(item.sourceLink)) originals = originals.filter(function(original) { return clean(original.link) === clean(item.sourceLink); });
    var original = saleSummary(Object.assign({}, item, {saleDetails: null, saleSummary: null, unifiedOriginalsV8: originals}), keys);
    // A disagreement between fresh originals must not revive stale master floors.
    return original;
  }
  function buildingSaleExtent(item) {
    if (!isSale(item) || normalizedSaleCategory(item) === "land") return "";
    var detail = buildingSaleSummary(item, ["saleExtent"]);
    if (detail.scope === "land") return "";
    return /^(whole_building|unit)$/.test(detail.saleExtent) ? detail.saleExtent : "unknown";
  }
  function buildingSaleScopeLabel(item) {
    return {whole_building: "건물 전체 매매", unit: "특정 층·호실 매매", unknown: "매매 범위 미확인"}[buildingSaleExtent(item)] || "";
  }
  // The source values remain available internally, but sale scope/floors are
  // deliberately no longer presented on building-sale cards.
  function buildingSaleInfoHtml() { return ""; }
  function isBuildingSale(item) {
    return isSale(item) && normalizedSaleCategory(item) !== "land" && saleSummary(item).scope !== "land";
  }
  function buildingSaleAreaInfoHtml(item) {
    return isBuildingSale(item) ? '<div class="building-sale-area-info-v1" aria-label="광고 면적 정보">' + saleAreaHtml(item) + '</div>' : "";
  }

  // Display only: room is also part of legacy favorite/visit identity.
  function buildingFloorLabel(item) {
    if (!isSale(item) || normalizedSaleCategory(item) === "land") return "";
    var detail = buildingSaleSummary(item, ["saleExtent", "saleTargetFloor", "saleTargetRoom", "saleSourceFloorText", "aboveGroundFloors", "belowGroundFloors", "totalFloors"]);
    if (detail.scope === "land") return "";
    var extent = buildingSaleExtent(item);
    if (extent === "unknown") return typeof detail.saleSourceFloorText === "string" && detail.saleSourceFloorText.trim()
      ? "원본 층 표기: " + detail.saleSourceFloorText.trim().slice(0, 60) : "매매 대상 층·호실 미확인";
    function count(value, allowZero) {
      if (typeof value !== "number" && typeof value !== "string") return null;
      var parsed = nonnegative(value);
      return parsed != null && Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : null;
    }
    var above = count(detail.aboveGroundFloors, false);
    var below = count(detail.belowGroundFloors, true);
    var total = count(detail.totalFloors, false);
    var targetFloor = typeof detail.saleTargetFloor === "string" ? detail.saleTargetFloor.trim().slice(0, 60) : "";
    var targetRoom = typeof detail.saleTargetRoom === "string" ? detail.saleTargetRoom.trim().slice(0, 60) : "";
    var conflictingTargets = item.unifiedOriginalsV8 && item.unifiedOriginalsV8.length && !Object.keys(detail).length;
    var room = targetFloor || targetRoom || (conflictingTargets ? "" : clean(item.room));
    var compact = room.replace(/\s+/g, "");
    var whole = extent === "whole_building";
    if (whole) {
      if (above != null && below != null) {
        if (below === 0 && above === 1) return "지상 1층";
        return (below > 0 ? "지하 " + below + "층" : "지상 1층") + " ~ 지상 " + above + "층";
      }
      if (above != null) return "지상 " + above + "층 · 지하 미확인";
      if (total != null) return "총 " + total + "층" + (below == null ? "" : below > 0 ? " · 지하 " + below + "층" : " · 지하 없음");
      if (below != null) return (below > 0 ? "지하 " + below + "층" : "지하 없음") + " · 지상 미확인";
      return "층수 미확인";
    }
    // Read-time provider evidence wins over a legacy room/floor string. These
    // fields are display-only; never overwrite room, which participates in keys.
    if (targetFloor === "비공개") {
      return "해당층 비공개" + (targetRoom ? " · " + targetRoom : "") +
        (total != null || above != null ? " / 총 " + (total || above) + "층" : "");
    }
    // A provider's 3/10 is current/total, never a lowest/highest range.
    var pair = compact.match(/^((?:지하|지상|B)?-?\d+(?:\.0+)?(?:층|F)?|저층?|중층?|고층?)[/／](\d+(?:\.0+)?)(?:층|F)?$/i);
    var current = pair ? pair[1] : compact;
    if (pair) total = count(pair[2], false) || total;
    if (total == null) total = above;
    var floor = null;
    var basement = current.match(/^(?:지하|B|-)\s*(\d+(?:\.0+)?)(?:층|F)?$/i);
    var ground = current.match(/^(?:지상)?(\d+(?:\.0+)?)(?:층|F)$/i) || (pair || targetFloor ? current.match(/^(\d+(?:\.0+)?)$/) : null);
    if (basement && Number(basement[1]) > 0) floor = "지하 " + Number(basement[1]) + "층";
    else if (ground && Number(ground[1]) > 0) floor = Number(ground[1]) + "층";
    else if (/^(저|중|고)층?$/.test(current)) floor = current.charAt(0) + "층";
    if (floor) return "해당 " + floor + (targetRoom && targetRoom !== targetFloor ? " · " + targetRoom : "") + (total != null ? " / 총 " + total + "층" : "");
    if (/^(?:지상|지하|B|-)?0(?:\.0+)?(?:층|F)?$/i.test(current) || /^(?:-|미확인|층수미확인|호실-)$/i.test(compact)) room = "";
    // Keep explicit room identifiers such as 301호; do not turn them into floors.
    return (room || (total != null ? "해당층 미확인" : "층수 미확인")) + (total != null ? " / 총 " + total + "층" : "");
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
    if (normalizedSaleCategory(item) === "land" && global.JSSaleWorkbenchV1) {
      var unit = global.JSSaleWorkbenchV1.unitPrice(item);
      return '<span class="pyeong-mini-badge listing-sale-yield-v1' + (unit == null ? ' unavailable' : '') + '" title="매매가 ÷ 광고 토지면적(평). 지적공부 전체면적과 다를 수 있습니다.">평당 ' +
        (unit == null ? '미확인' : unit.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '만') + '</span>';
    }
    var rate = saleYield(item);
    var advertised = nonnegative(saleSummary(item).advertisedYield);
    if (rate == null && advertised != null) return '<span class="pyeong-mini-badge listing-sale-yield-v1" title="광고 설명에 기재된 연 수익률입니다. 대출·이자 반영 등 계산 기준은 상세정보에서 확인하세요. 웹의 단순 연 수익률과 다릅니다.">광고 연 ' + advertised.toFixed(2) + '%</span>';
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
      return '<span title="' + escapeHtml(fullLabel) + '">' + escapeHtml(label) + ' <b>' + (global.JSSaleDossierV9 ? global.JSSaleDossierV9.areaHtml(parsed,true) : escapeHtml(formatted)) + '</b></span>';
    }
    var html = land ? area('토지', detail.landAreaM2, '토지면적') : buildingSaleAreas(item).map(function(entry) {
      return area(entry.label, entry.value, entry.fullLabel);
    }).join('<i>·</i>');
    if (!html) html = '<span class="unavailable">면적 정보 미확인</span>';
    return '<span class="listing-sale-areas-v1">' + html + '</span>';
  }
  function buildingSaleAreas(item) {
    if (!isBuildingSale(item)) return [];
    var detail = saleSummary(item);
    return [["전용", "exclusiveAreaM2", "전용면적"], ["대지", "landAreaM2", "대지면적"],
      ["연면적", "grossAreaM2", "연면적"], ["건축(건평)", "buildingAreaM2", "건축면적(건평)"]].map(function(field) {
      var value = detail[field[1]];
      return {label: field[0], fullLabel: field[2], value: typeof value === "number" || typeof value === "string" ? nonnegative(value) : null};
    }).filter(function(entry) { return entry.value > 0 && Number.isFinite(entry.value); });
  }
  function buildingSaleAreaText(item) {
    return buildingSaleAreas(item).map(function(entry) {
      return entry.label + " " + (entry.value / 3.305785).toLocaleString("ko-KR", {maximumFractionDigits: 1}) + "평";
    }).join(" · ") || "면적 정보 미확인";
  }
  function landText(value) {
    var text = typeof value === "string" ? clean(value).replace(/\s+/g, " ") : "";
    return /^(?:-|—|미확인|확인\s*필요)$/.test(text) ? "" : text;
  }
  function landUseLabel(item) {
    if (!isSale(item)) return "";
    var detail = saleSummary(item);
    if (detail.scope !== "land" && normalizedSaleCategory(item) !== "land") return "";
    var value = landText(detail.landUse);
    return value ? "지목: " + value : "지목 미확인";
  }
  function saleLandInfoHtml(item) {
    if (!isSale(item)) return "";
    var detail = saleSummary(item);
    if (detail.scope !== "land" && normalizedSaleCategory(item) !== "land") return "";
    function field(label, value) {
      var text = landText(value);
      return '<span' + (text ? '' : ' class="unavailable"') + '>' + label +
        ' <b>' + escapeHtml(text || '미확인') + '</b></span>';
    }
    return '<span class="listing-land-info-v1">' + field('용도지역', detail.zoning) + '</span>';
  }
  function landCardMetricsHtml(item) {
    if (!isSale(item) || normalizedSaleCategory(item) !== "land") return "";
    var d = saleSummary(item), area = nonnegative(d.landAreaM2);
    var price = nonnegative(displayPrice(item)), unit = price > 0 && area > 0 ? price / (area / 3.305785) : null;
    function number(value) { return value.toLocaleString('ko-KR', {maximumFractionDigits: 1}); }
    return '<div class="land-card-metrics-v4" aria-label="광고 면적과 단가">' +
      '<div><span>토지면적</span><strong>' + (area > 0 ? global.JSSaleDossierV9 ? global.JSSaleDossierV9.areaHtml(area) : number(area / 3.305785) + '<small>평</small>' : '면적 미제공') + '</strong>' +
      (area > 0 ? '<small>' + (global.JSSaleDossierV9 ? '광고면적' : number(area) + '㎡ · 광고면적') + '</small>' : '') + '</div>' +
      '<div title="매매가 ÷ 광고 토지면적(평). 지적공부 면적과 다를 수 있습니다."><span>평당 매매가</span><strong>' +
      (unit == null ? '산정 불가' : number(unit) + '<small>만원</small>') + '</strong><small>광고면적 기준</small></div></div>';
  }
  function buildingUnitPricesHtml(item) {
    if (!isBuildingSale(item)) return '';
    var d=saleSummary(item), price=nonnegative(item.salePrice ?? item.sale_price), fields=[];
    if (!(price>0)) return '';
    [['대지 기준','landAreaM2'],['연면적 기준','grossAreaM2']].forEach(function(field){
      var area=nonnegative(d[field[1]]);
      if(area>0)fields.push('<span>'+field[0]+' <b>'+(price/(area/3.305785)).toLocaleString('ko-KR',{maximumFractionDigits:1})+'만원/평</b></span>');
    });
    return fields.length ? '<div class="building-unit-prices-v5" title="각 단가는 건물 총매매가를 해당 광고면적으로 나눈 비교 지표입니다. 토지만의 가격이 아닙니다.">'+fields.join('')+'</div>' : '';
  }
  function saleListMetricsHtml(item) {
    if (!isSale(item)) return '';
    var land = normalizedSaleCategory(item) === 'land', d = saleSummary(item), price = nonnegative(displayPrice(item));
    var entries = land ? (nonnegative(d.landAreaM2) > 0 ? [{label:'토지',fullLabel:'토지면적',value:nonnegative(d.landAreaM2)}] : []) : buildingSaleAreas(item);
    if (!entries.length) return '<span class="sale-list-missing-v16">면적 정보 미제공</span>';
    function number(v) { return v.toLocaleString('ko-KR',{maximumFractionDigits:1}); }
    return '<dl class="sale-list-metrics-v16" aria-label="광고 면적과 단가">' + entries.map(function(entry) {
      var shown = global.JSSaleDossierV9 ? global.JSSaleDossierV9.areaHtml(entry.value,true) : escapeHtml(number(entry.value/3.305785)+'평');
      var unit = price > 0 && (land || ['대지','연면적'].includes(entry.label)) ? price/(entry.value/3.305785) : null;
      return '<div data-sale-metric-v16="' + escapeHtml(entry.fullLabel) + '"><dt>' + escapeHtml(entry.label) + '</dt><dd>' + shown + '</dd>' +
        (unit == null ? '' : '<small title="총매매가 ÷ 광고 ' + escapeHtml(entry.fullLabel) + '(평). 해당 면적 기준 비교 단가입니다.">' + number(unit) + '만원/평</small>') + '</div>';
    }).join('') + '</dl>';
  }
  function saleDetailsHtml(item) {
    if (!isSale(item) || !item.saleDetails) return "";
    var detail = item.saleDetails;
    var escape = function(value) { return clean(value).replace(/[&<>"']/g, function(ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    }); };
    var rows = [], groups = [];
    function group(title) {
      var keys={'광고 면적':'areas','임대·수익 현황':'income','가격 기준':'income','건물 기본정보':'building','원문 대조·확인사항':'review','필지·이용 조건':'land'};
      if (rows.length) groups.push('<div class="sale-fact-group-v2" data-sale-section="' + keys[title] + '"><dt>' + escape(title) + '</dt><dd><dl>' + rows.join('') + '</dl></dd></div>');
      rows = [];
    }
    function add(label, value, suffix) {
      if (value == null || value === "") return;
      var shown = suffix && /^(?:만원|%)/.test(suffix) && nonnegative(value) != null
        ? nonnegative(value).toLocaleString('ko-KR', {maximumFractionDigits: 2}) : value;
      var wide = label === "토지 평당가" || clean(value).length > 24 || label.length > 13;
      rows.push('<div' + (wide ? ' class="sale-fact-wide-v2"' : '') + '><dt>' + escape(label) + '</dt><dd>' + escape(shown) + escape(suffix || "") + '</dd></div>');
    }
    function area(label, value) {
      if (!["number", "string"].includes(typeof value) || !Number.isFinite(Number(value)) || !(Number(value) > 0)) return;
      add(label, Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "㎡ (" +
        (Number(value) / 3.305785).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "평)");
    }
    if (normalizedSaleCategory(item) === "land" || detail.scope === "land") add("매매 범위", "토지");
    area("대지면적", detail.landAreaM2);
    area("연면적", detail.grossAreaM2);
    area("건축면적", detail.buildingAreaM2);
    area("전용면적", detail.exclusiveAreaM2);
    group("광고 면적");
    add("기존 보증금 합계", detail.totalDeposit, "만원");
    add("기존 월 임대수입", detail.monthlyIncome, "만원");
    add("광고 융자금", detail.loanAmount, "만원");
    add("광고 월수익 (이자 차감 표기)", detail.monthlyNetIncome, "만원");
    add("광고 월수익 (계산 기준 미확인)", detail.statedMonthlyIncome, "만원");
    add("광고 실투자금", detail.investmentAmount, "만원");
    add("광고 기재 연 수익률", detail.advertisedYield, "% (광고 기준)");
    var rate = saleYield(item);
    var land = normalizedSaleCategory(item) === "land" || detail.scope === "land";
    if (land && global.JSSaleWorkbenchV1) {
      var unitPrice = global.JSSaleWorkbenchV1.unitPrice(item);
      add("토지 평당가", unitPrice == null ? "확인 필요" : unitPrice.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "만원 (광고면적 기준)");
    } else if (rate != null) add("단순 연 수익률", rate.toFixed(2) + "% (보증금 차감)");
    group(land ? "가격 기준" : "임대·수익 현황");
    add(detail.descriptionVersion ? "세대수 (설명 기준)" : "세대수", detail.householdCount, "세대");
    add("가구 수", detail.familyCount, "가구");
    add("방 수", detail.roomCount, "개"); add("욕실 수", detail.bathroomCount, "개");
    add("건축물 용도", detail.buildingUse); add("기타 용도", detail.otherUse);
    add("사용승인일", detail.approvalDate);
    group("건물 기본정보");
    (detail.descriptionWarnings || []).forEach(function(warning) { add("확인 필요", warning); });
    var advertised = detail.descriptionFinancials || {};
    var financialLabels = { salePrice: "매매가", loanAmount: "융자", totalDeposit: "보증금", monthlyIncome: "월 임대수입",
      monthlyNetIncome: "이자 차감 월수익", statedMonthlyIncome: "월수익 (기준 미확인)", investmentAmount: "실투자금", advertisedYield: "연 수익률" };
    Object.keys(financialLabels).forEach(function(key) {
      var current = key === "salePrice" ? item.salePrice : detail[key];
      if (advertised[key] != null && (current == null || Number(current) !== Number(advertised[key])))
        add("설명 기재 " + financialLabels[key], advertised[key], key === "advertisedYield" ? "% (계산 미적용)" : "만원 (계산 미적용)");
    });
    group("원문 대조·확인사항");
    add("지목", detail.landUse); add("용도지역", detail.zoning);
    add("추가 용도지역", detail.secondaryZoning); add("토지 형상", detail.parcelShape);
    area("지적공부 면적 (광고면적과 구분)", detail.cadastralAreaM2);
    if (Number(detail.cadastralAreaM2) > 0 && Number(detail.landAreaM2) > 0 && Math.abs(detail.cadastralAreaM2 - detail.landAreaM2) > 1)
      add("면적 확인", "광고면적과 지적공부 면적이 다릅니다. 일부 지분·복수 필지 여부를 확인하세요. 평당가는 광고면적 기준입니다.");
    add("도로접면", detail.roadAccess);
    group("필지·이용 조건");
    return groups.length || detail.descriptionText ? '<dl class="listing-sale-details-v1">' + groups.join("") +
      '</dl><p class="listing-sale-yield-note-v1">' + escapeHtml(land ? '토지 평당가는 매매가 ÷ 광고면적(평)입니다. 일부 지분·복수 필지와 지적공부 면적 차이를 확인하세요.' : yieldExplanation) +
      (detail.descriptionVersion ? '<br>설명에서 추출한 조건은 광고 기재값입니다. 이자 차감 월수익은 월 임대수입으로 사용하지 않습니다.' : '') + '</p>' +
      (detail.descriptionText ? '<details class="listing-sale-description-v1"><summary>수집된 매매 상세설명 전체 보기</summary><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + escape(detail.descriptionText) + '</div></details>' : '') : "";
  }
  // Presentation only. Keep facts tied to this original's price and source.
  function saleCardFactsHtml(item, listCard) {
    if (!isSale(item)) return "";
    var d = saleSummary(item, ["totalDeposit", "monthlyIncome", "monthlyNetIncome", "statedMonthlyIncome", "loanAmount", "investmentAmount", "advertisedYield", "zoning", "roadAccess", "parcelShape", "buildingUse", "rentalReference", "rentalScenarios", "rentalBreakdown"]), land = normalizedSaleCategory(item) === "land", fields = [];
    function money(label, value) {
      var n = nonnegative(value);
      if (n != null) fields.push([label, n.toLocaleString('ko-KR', {maximumFractionDigits: 1}) + '만원']);
    }
    if (land) {
      if (listCard && landText(d.zoning)) fields.push(['용도지역', landText(d.zoning)]);
      if (landText(d.roadAccess)) fields.push(['도로', landText(d.roadAccess)]);
      if (landText(d.parcelShape)) fields.push(['형상', landText(d.parcelShape)]);
    } else {
      money('보증금 합계', d.totalDeposit); money('월 임대수입', d.monthlyIncome);
      (d.rentalScenarios || []).slice(0,2).forEach(function(scenario) {
        var basis = scenario.kind === 'full_occupancy' ? '만실 기준' : scenario.kind === 'expected' ? '예상' : '';
        if (!basis) return;
        money(basis + ' 보증금', scenario.totalDeposit);money(basis + ' 월 임대수입', scenario.monthlyIncome);
      });
      if (listCard && d.rentalReference) {
        [['totalDeposit', '보증금'], ['monthlyIncome', '월세']].forEach(function(pair) {
          var field = pair[0], fact = d.rentalReference[field];
          if (nonnegative(d[field]) != null || !fact || (d.manualSaleFieldsV1 || []).indexOf(field) >= 0) return;
          var amount = nonnegative(fact.value);
          if (amount == null || ['partial_scope', 'price_conflict'].indexOf(fact.reason) < 0) return;
          var reason = fact.reason === 'partial_scope' ? '일부 층·호실 조건' : '광고 매매가 불일치';
          fields.push(['원문 ' + pair[1] + ' · 확인 필요', amount.toLocaleString('ko-KR', {maximumFractionDigits: 1}) + '만원',
            reason + ' · 건물 전체 수익률 계산에 미반영' + (fact.unitAssumed ? ' · 원문 단위 생략, 만원 기준' : '')]);
        });
      }
      money('광고 융자금', d.loanAmount);
      money('광고 월수익 · 이자 차감', d.monthlyNetIncome);
      money('광고 월수익 · 기준 미확인', d.statedMonthlyIncome);
      money('광고 실투자금', d.investmentAmount);
      if (listCard) {
        var rate = saleYield(item), advertised = nonnegative(d.advertisedYield);
        if (rate != null) fields.push(['단순 연 수익률', rate.toFixed(2) + '%', yieldExplanation]);
        else if (advertised != null) fields.push(['광고 연 수익률 · 기준 확인', advertised.toFixed(2) + '%', '광고 기재 연 수익률입니다. 대출·이자 등 계산 기준은 원문 확인이 필요합니다.']);
      }
      if (landText(d.buildingUse)) fields.push(['용도', landText(d.buildingUse)]);
    }
    var assumedUnits = !land && (Array.isArray(d.descriptionUnitAssumptions) && d.descriptionUnitAssumptions.length ||
      listCard && d.rentalReference && Object.keys(d.rentalReference).some(function(field) {
        return d.rentalReference[field] && d.rentalReference[field].unitAssumed && (d.manualSaleFieldsV1 || []).indexOf(field) < 0;
      }));
    var unitNote = assumedUnits ? '<small class="sale-card-unit-note-v59">금액 단위: 원문 생략 · 만원 기준</small>' : '';
    var supplemental = !land ? rentalSupplementHtmlV61(d) : '';
    return fields.length || supplemental ? '<div class="sale-card-facts-v2">' + fields.map(function(f) {
      return '<span' + (f[2] ? ' title="' + escapeHtml(f[2]) + '"' : '') + '><span>' + escapeHtml(f[0]) + '</span><b>' + escapeHtml(f[1]) + '</b></span>';
    }).join('') + unitNote + supplemental + '</div>' : '';
  }
  function rentalSupplementHtmlV61(detail) {
    var html = '';
    if ((detail.rentalScenarios || []).length) html += '<small class="sale-rental-note-v61">광고 가정 조건 · 현재 임대수입·수익률 계산에 미반영' +
      (detail.rentalScenarios.some(function(s){return (s.unitAssumptions || []).length;}) ? ' · 생략된 금액 단위는 만원 기준' : '') + '</small>';
    var rows = (detail.rentalBreakdown || []).slice(0,8);
    if (!rows.length) return html;
    function money(value) {var n=nonnegative(value);return n==null?'미기재':n.toLocaleString('ko-KR')+'만원';}
    html += '<section class="sale-rental-breakdown-v61"><strong>층별 임대조건 · 원문 기재</strong><table><thead><tr><th>층</th><th>보증금</th><th>월세</th></tr></thead><tbody>' +
      rows.map(function(row){return '<tr><th>'+escapeHtml(row.floor+(row.perUnit?' · 호실별':'')+(row.previous?' · 이전 조건':''))+'</th><td>'+escapeHtml(money(row.totalDeposit))+'</td><td>'+escapeHtml(money(row.monthlyIncome))+'</td></tr>';}).join('')+'</tbody></table>';
    var floors=rows.map(function(r){return r.floor;});
    if (rows.every(function(r){return !r.perUnit&&!r.previous;}) && floors.every(function(f){return /^(?:지하)?\d+층$/.test(f);}) && new Set(floors).size===floors.length) {
      var deposits=rows.filter(function(r){return nonnegative(r.totalDeposit)!=null;}),rents=rows.filter(function(r){return nonnegative(r.monthlyIncome)!=null;});
      html += '<small>층 전체 조건이라는 가정의 기재금액 합: 보증금 '+money(deposits.length?deposits.reduce(function(sum,r){return sum+Number(r.totalDeposit);},0):null)+
        ' · 월세 '+money(rents.length?rents.reduce(function(sum,r){return sum+Number(r.monthlyIncome);},0):null)+(rents.length<rows.length?' (일부 월세 미기재)':'')+'</small>';
    }
    return html+'<small>층 전체·호실별 금액인지 확인 필요 · 호실 수로 곱하지 않음 · 현재 수익률 계산에 미반영' +
      (rows.some(function(r){return (r.unitAssumptions || []).length;}) ? ' · 원문 생략 금액 단위는 만원 기준' : '') + '</small></section>';
  }
  function saleOverviewHtml(item) {
    if (!isSale(item)) return "";
    var land = normalizedSaleCategory(item) === "land";
    var money = global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.price(displayPrice(item)) : String(displayPrice(item));
    var d=saleSummary(item), metrics=land?[['지목',d.landUse],['용도지역',d.zoning],['도로접면',d.roadAccess],['토지형상',d.parcelShape]].filter(function(f){return landText(f[1]);}):[];
    var metricHtml=metrics.length?'<div class="sale-land-metrics-v3">'+metrics.map(function(f){return '<div><span>'+escapeHtml(f[0])+'</span><strong>'+escapeHtml(f[1])+'</strong></div>';}).join('')+'</div>':'';
    return '<div class="sale-overview-v2 ' + (land ? 'land' : 'building') + '" data-sale-section="summary"><span class="sale-overview-label-v2">' +
      (land ? '토지 매입 검토' : '건물·공간 매입 검토') + ' · ' + escapeHtml(displayType(item)) + '</span><div class="sale-overview-price-v2"><span>매매</span><strong>' + escapeHtml(money) + '</strong></div>' +
      '<div class="sale-overview-indicators-v2">' + saleYieldBadge(item) + (land ? saleAreaHtml(item) : '') + '</div>' + (land?metricHtml:saleCardFactsHtml(item)) + saleReviewGapsHtml(item) + '</div>';
  }
  function saleReviewGapsHtml(item) {
    if (!isSale(item)) return '';
    var d = saleSummary(item), land = normalizedSaleCategory(item) === 'land', missing = [];
    if (!(nonnegative(displayPrice(item)) > 0)) missing.push('매매가');
    if (land) {
      if (!(nonnegative(d.landAreaM2) > 0)) missing.push('광고 토지면적');
      [['지목', d.landUse], ['용도지역', d.zoning], ['도로접면', d.roadAccess]].forEach(function(f) {
        if (!landText(f[1])) missing.push(f[0]);
      });
    } else {
      if (nonnegative(d.totalDeposit) == null) missing.push('임대보증금 합계');
      if (nonnegative(d.monthlyIncome) == null) missing.push('월 임대수입');
    }
    return missing.length ? '<details class="sale-review-gaps-v2"><summary>' +
      (land ? '필지 검토 시 확인할 정보' : '수익 계산을 위해 확인할 금액') + ' · ' + missing.length +
      '개</summary><p>' + missing.map(escapeHtml).join(' · ') +
      '</p><small>' + ((d.rentalScenarios || []).length || (d.rentalBreakdown || []).length
        ? '현재 임대 합계가 확인되지 않았습니다. 광고 가정·층별 조건과 구분해 확인해 주세요.'
        : '현재 광고에 제공되지 않은 항목입니다. 원본 광고나 제공처에서 확인해 주세요.') + '</small></details>' : '';
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
    displayType: displayType,
    naverTypeLabel: naverTypeLabel,
    displayPrice: displayPrice,
    saleDetailsHtml: saleDetailsHtml,
    saleCardFactsHtml: saleCardFactsHtml,
    saleOverviewHtml: saleOverviewHtml,
    saleReviewGapsHtml: saleReviewGapsHtml,
    saleSummary: saleSummary,
    buildingFloorLabel: buildingFloorLabel,
    buildingSaleExtent: buildingSaleExtent,
    buildingSaleScopeLabel: buildingSaleScopeLabel,
    buildingSaleInfoHtml: buildingSaleInfoHtml,
    buildingSaleAreaInfoHtml: buildingSaleAreaInfoHtml,
    buildingSaleAreaText: buildingSaleAreaText,
    isBuildingSale: isBuildingSale,
    saleYield: saleYield,
    saleYieldBadge: saleYieldBadge,
    saleAreaHtml: saleAreaHtml,
    saleLandInfoHtml: saleLandInfoHtml,
    landCardMetricsHtml: landCardMetricsHtml,
    buildingUnitPricesHtml: buildingUnitPricesHtml,
    saleListMetricsHtml: saleListMetricsHtml,
    landUseLabel: landUseLabel,
    isSale: isSale
  };

  updateSelector();
})(window);
