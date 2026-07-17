(function () {
  "use strict";

  var CACHE_PREFIX = "jsPublicCommerceV3:";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  var ANALYSIS_RADIUS = 500;
  var requestSequence = 0;
  var currentDataByItemKey = {};
  var currentAnalysisByItemKey = {};
  var competitorMapObjects = [];
  var competitorMapLegend = null;
  var activeCompetitionItemKey = "";
  var activeCompetitionSectorId = "";

  var SECTORS = [
    { id:"medical", name:"의원·클리닉", pattern:/의료|의원|병원|치과|한의|약국|클리닉/i, floorType:"purpose", minArea:18, maxArea:120 },
    { id:"education", name:"학원·교육", pattern:/교육|학원|교습|독서실|스터디|직업 훈련/i, floorType:"purpose", minArea:15, maxArea:120 },
    { id:"office", name:"사무·전문서비스", pattern:/법무|회계|세무|부동산|광고|컨설팅|여행사|사무|전문 서비스|금융|보험/i, floorType:"purpose", minArea:10, maxArea:100 },
    { id:"fitness", name:"체육·웰니스", pattern:/스포츠|체육|헬스|요가|필라테스|무도|댄스|운동/i, floorType:"purpose", minArea:25, maxArea:180, basementOkay:true },
    { id:"beauty", name:"뷰티·미용", pattern:/미용|네일|피부 관리|마사지|뷰티|이용/i, floorType:"flex", minArea:8, maxArea:60 },
    { id:"food", name:"외식·카페", pattern:/한식|중식|일식|서양식|음식|주점|카페|커피|제과|분식|치킨|피자|패스트푸드/i, floorType:"storefront", minArea:8, maxArea:100 },
    { id:"retail", name:"소매·편의", pattern:/소매|편의점|슈퍼|의류|화장품|안경|휴대폰|전자|문구|식료품/i, floorType:"storefront", minArea:5, maxArea:80 },
    { id:"life", name:"생활서비스", pattern:/세탁|수리|개인 서비스|반려|애완|사진|인쇄|택배/i, floorType:"flex", minArea:5, maxArea:60 }
  ];

  var SYNERGY_RULES = {
    medical:[{name:"약국",pattern:/약국/i},{name:"카페",pattern:/카페|커피/i},{name:"뷰티·미용",pattern:/미용|피부 관리|뷰티/i}],
    education:[{name:"카페",pattern:/카페|커피/i},{name:"문구·서점",pattern:/문구|서점/i},{name:"외식",pattern:/한식|분식|패스트푸드|음식/i}],
    office:[{name:"카페",pattern:/카페|커피/i},{name:"외식",pattern:/한식|음식|식당/i},{name:"인쇄·사진",pattern:/인쇄|사진/i}],
    fitness:[{name:"의료",pattern:/의원|의료|병원/i},{name:"뷰티·미용",pattern:/미용|피부 관리|뷰티/i},{name:"카페",pattern:/카페|커피/i}],
    beauty:[{name:"의료",pattern:/의원|의료|병원/i},{name:"카페",pattern:/카페|커피/i},{name:"화장품·의류",pattern:/화장품|의류/i}],
    food:[{name:"카페",pattern:/카페|커피/i},{name:"소매",pattern:/편의점|슈퍼|소매/i},{name:"숙박",pattern:/숙박|호텔/i}],
    retail:[{name:"외식",pattern:/한식|음식|식당/i},{name:"생활서비스",pattern:/세탁|수리|개인 서비스/i},{name:"뷰티·미용",pattern:/미용|피부 관리/i}],
    life:[{name:"소매",pattern:/편의점|슈퍼|소매/i},{name:"외식",pattern:/한식|음식|식당/i},{name:"뷰티·미용",pattern:/미용|피부 관리/i}]
  };

  function safeNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function round1(value) {
    return Math.round(safeNumber(value) * 10) / 10;
  }

  function esc(value) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(String(value == null ? "" : value));
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getCoordinates(item) {
    if (!item || !item.latlng) return null;
    var lat = typeof item.latlng.getLat === "function" ? item.latlng.getLat() : item.lat;
    var lng = typeof item.latlng.getLng === "function" ? item.latlng.getLng() : item.lng;
    lat = Number(lat);
    lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat:lat, lng:lng } : null;
  }

  function cacheKey(item, coords) {
    return CACHE_PREFIX + [
      item && (item.propertyId || item.id || item.key || ""),
      coords.lat.toFixed(4),
      coords.lng.toFixed(4),
      ANALYSIS_RADIUS
    ].join("|");
  }

  function readCache(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (!parsed || !parsed.savedAt || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
      return parsed.data || null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt:Date.now(), data:data }));
    } catch (_) {}
  }

  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var callbackName = "__jsPublicCommerce" + Date.now() + "_" + (++requestSequence);
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
        reject(new Error("공식 상권 데이터를 불러오지 못했습니다."));
      };
      timer = setTimeout(function () {
        cleanup();
        reject(new Error("공식 상권 데이터 응답이 지연되고 있습니다."));
      }, timeoutMs || 30000);
      script.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
  }

  function parseFloor(item) {
    var value = null;
    if (typeof window.getItemFloorNumber === "function") {
      value = window.getItemFloorNumber(item);
    }

    if (value === null || typeof value === "undefined" || !Number.isFinite(Number(value))) {
      var room = String((item && item.room) || "").trim().toUpperCase();
      var fallback = room || String((item && item.floor) || "").trim().toUpperCase();
      var basement = fallback.match(/(?:B|지하|지)\s*(\d{1,2})/i);
      if (basement) value = -Math.max(1, Number(basement[1]) || 1);
      if (value === null || typeof value === "undefined") {
        var explicit = fallback.match(/(\d{1,2})\s*(?:층|F)/i);
        if (explicit) value = Number(explicit[1]);
      }
      if ((value === null || typeof value === "undefined") && /^\d{3,4}호?$/.test(fallback)) {
        var digits = fallback.replace(/\D/g, "");
        value = digits.length === 3 ? Number(digits.charAt(0)) : Number(digits.slice(0, -2));
      }
    }

    value = Number(value);
    if (!Number.isFinite(value)) return { value:null, label:"층수 미입력" };
    if (value < 0) return { value:value, label:"지하 " + Math.abs(value) + "층" };
    return { value:value, label:value + "층" };
  }

  function money(value) {
    return safeNumber(value).toLocaleString("ko-KR") + "만원";
  }

  function radiusSummary(data, radius) {
    var rows = data && Array.isArray(data.radii) ? data.radii : [];
    for (var i = 0; i < rows.length; i += 1) {
      if (safeNumber(rows[i].radius) === radius) return rows[i];
    }
    if (data && safeNumber(data.radius) === radius) {
      return {
        radius:radius,
        totalCount:safeNumber(data.totalCount),
        densityPerHa:0,
        diversityScore:0,
        largeCategories:data.largeCategories || [],
        mediumCategories:data.mediumCategories || [],
        smallCategories:data.smallCategories || []
      };
    }
    return { radius:radius, totalCount:0, densityPerHa:0, diversityScore:0, largeCategories:[], mediumCategories:[], smallCategories:[] };
  }

  function metricRows(data, level) {
    var metrics = data && data.categoryMetrics && data.categoryMetrics[level];
    if (Array.isArray(metrics)) return metrics;
    var fallback = data && data[level + "Categories"];
    return (Array.isArray(fallback) ? fallback : []).map(function (row) {
      return {
        name:row.name,
        count100:0,
        count300:safeNumber(row.count),
        count500:safeNumber(row.count),
        nearestDistance:null,
        share300:0
      };
    });
  }

  function aggregateSectorMetric(data, pattern) {
    var rows = metricRows(data, "medium");
    var result = { count100:0, count300:0, count500:0, nearestDistance:null, matched:[] };
    rows.forEach(function (row) {
      if (!pattern.test(String(row.name || ""))) return;
      result.count100 += safeNumber(row.count100);
      result.count300 += safeNumber(row.count300);
      result.count500 += safeNumber(row.count500);
      if (row.nearestDistance !== null && typeof row.nearestDistance !== "undefined") {
        var distance = safeNumber(row.nearestDistance);
        if (result.nearestDistance === null || distance < result.nearestDistance) result.nearestDistance = distance;
      }
      result.matched.push(String(row.name || ""));
    });
    return result;
  }

  function sectorDefinition(sectorId) {
    for (var i = 0; i < SECTORS.length; i += 1) {
      if (SECTORS[i].id === sectorId) return SECTORS[i];
    }
    return SECTORS[0];
  }

  function storesForSector(data, sectorId) {
    var definition = sectorDefinition(sectorId);
    return (data && Array.isArray(data.stores) ? data.stores : [])
      .filter(function (store) {
        return definition.pattern.test(String(store.medium || ""));
      })
      .sort(function (a, b) {
        return safeNumber(a.distance) - safeNumber(b.distance);
      });
  }

  function directionalCompetition(stores, item) {
    var coords = getCoordinates(item);
    var counts = { north:0, east:0, south:0, west:0 };
    if (!coords) return { counts:counts, gap:"확인 불가", dense:"확인 불가" };
    (stores || []).forEach(function (store) {
      var dLat = safeNumber(store.lat) - coords.lat;
      var dLng = safeNumber(store.lng) - coords.lng;
      if (Math.abs(dLat) >= Math.abs(dLng)) {
        counts[dLat >= 0 ? "north" : "south"] += 1;
      } else {
        counts[dLng >= 0 ? "east" : "west"] += 1;
      }
    });
    var labels = { north:"북쪽", east:"동쪽", south:"남쪽", west:"서쪽" };
    var keys = Object.keys(counts).sort(function (a, b) { return counts[a] - counts[b]; });
    return { counts:counts, gap:labels[keys[0]], dense:labels[keys[keys.length - 1]] };
  }

  function synergyRows(data, sectorId) {
    var rules = SYNERGY_RULES[sectorId] || [];
    return rules.map(function (rule) {
      var metric = aggregateSectorMetric(data, rule.pattern);
      return { name:rule.name, count300:metric.count300, count100:metric.count100 };
    }).sort(function (a, b) { return b.count300 - a.count300; });
  }

  function floorFitScore(definition, floor) {
    if (floor.value === null) return 18;
    if (floor.value < 0) {
      if (definition.basementOkay) return 34;
      if (definition.floorType === "purpose") return 20;
      return 4;
    }
    if (floor.value === 1) {
      if (definition.floorType === "storefront") return 35;
      if (definition.floorType === "flex") return 32;
      return 25;
    }
    if (floor.value === 2) {
      if (definition.floorType === "purpose") return 35;
      if (definition.floorType === "flex") return 28;
      return 13;
    }
    if (definition.floorType === "purpose") return 35;
    if (definition.floorType === "flex") return 22;
    return 3;
  }

  function areaFitScore(definition, area) {
    if (!area) return 10;
    if (area >= definition.minArea && area <= definition.maxArea) return 20;
    if (area >= definition.minArea * 0.7 && area <= definition.maxArea * 1.35) return 12;
    return 4;
  }

  function floorReason(definition, floor) {
    if (floor.value === null) return "층수 입력 시 적합도 정밀화 필요";
    if (floor.value < 0) return definition.basementOkay ? floor.label + " 운영이 가능한 업종" : floor.label + "은 접근성 제약 검토 필요";
    if (floor.value === 1) return definition.floorType === "storefront" ? "1층 즉시 유입에 적합" : "1층 접근성 이점 활용 가능";
    if (definition.floorType === "purpose") return floor.label + " 목적방문형 운영에 적합";
    if (definition.floorType === "flex") return floor.label + " 예약·재방문 구조 검토 가능";
    return floor.label + "은 즉시 유입형 업종에 불리";
  }

  function areaReason(definition, area) {
    if (!area) return "면적 입력 시 운영 규모 검토 가능";
    if (area >= definition.minArea && area <= definition.maxArea) return area + "평 운영 규모 적합";
    if (area < definition.minArea) return area + "평으로 최소 운영면적 검토 필요";
    return area + "평 대형 면적 활용계획 필요";
  }

  function competitionLabel(metric, total300) {
    var share = total300 > 0 ? metric.count300 / total300 : 0;
    if (metric.count300 >= 80 || share >= 0.16) return "경쟁 밀집";
    if (metric.count300 >= 30 || share >= 0.07) return "경쟁 보통";
    return "경쟁 낮음";
  }

  function buildSectorAnalyses(data, item, floor) {
    var area = safeNumber(item && item.area);
    var total300 = radiusSummary(data, 300).totalCount;
    return SECTORS.map(function (definition) {
      var metric = aggregateSectorMetric(data, definition.pattern);
      var floorScore = floorFitScore(definition, floor);
      var areaScore = areaFitScore(definition, area);
      var share = total300 > 0 ? metric.count300 / total300 : 0;
      var ecosystemScore = Math.min(30, Math.round(Math.sqrt(Math.max(0, share) * 100) * 6));
      var localScore = metric.count100 > 0 ? Math.min(10, 4 + metric.count100) : 0;
      var evidenceScore = metric.count500 > 0 ? 5 : 0;
      var score = Math.min(100, floorScore + areaScore + ecosystemScore + localScore + evidenceScore);
      var risks = [];
      if (floorScore <= 5) risks.push("층수와 업종 유입방식 불일치");
      if (competitionLabel(metric, total300) === "경쟁 밀집") risks.push("유사업종 밀집으로 차별화 필요");
      if (areaScore <= 4) risks.push("일반적인 운영면적과 차이 큼");
      if (!metric.count300) risks.push("300m 내 동종 생태계 확인 부족");
      return {
        id:definition.id,
        name:definition.name,
        score:score,
        metric:metric,
        floorScore:floorScore,
        areaScore:areaScore,
        competition:competitionLabel(metric, total300),
        reasons:[
          floorReason(definition, floor),
          areaReason(definition, area),
          "300m 내 유사 업종 " + metric.count300 + "개"
        ],
        risks:risks
      };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function profileSignals(sectors) {
    function find(id) {
      for (var i = 0; i < sectors.length; i += 1) if (sectors[i].id === id) return sectors[i].metric.count300;
      return 0;
    }
    return [
      { name:"외식·회식 집적형", count:find("food") },
      { name:"의료·교육 목적방문형", count:find("medical") + find("education") + find("fitness") },
      { name:"업무·전문서비스형", count:find("office") },
      { name:"생활밀착 소비형", count:find("retail") + find("life") + find("beauty") }
    ].sort(function (a, b) { return b.count - a.count; });
  }

  function concentrationInfo(data) {
    var row100 = radiusSummary(data, 100);
    var row300 = radiusSummary(data, 300);
    var ratio = row300.densityPerHa > 0 ? row100.densityPerHa / row300.densityPerHa : 0;
    var label = "분산형 상권";
    if (ratio >= 1.6) label = "초근접 핵심부";
    else if (ratio >= 1.05) label = "상권 중심부";
    else if (ratio >= 0.65) label = "상권 연결부";
    return { ratio:round1(ratio), label:label };
  }

  function diversityInfo(data) {
    var score = safeNumber(radiusSummary(data, 300).diversityScore);
    var label = score >= 90 ? "업종 매우 다양" : score >= 80 ? "업종 다양" : score >= 65 ? "업종 균형" : "일부 업종 편중";
    return { score:score, label:label };
  }

  function buildAnalysis(data, item) {
    var floor = parseFloor(item);
    var sectors = buildSectorAnalyses(data, item, floor);
    var profiles = profileSignals(sectors);
    var concentration = concentrationInfo(data);
    var diversity = diversityInfo(data);
    var recommendations = sectors.slice(0, 3);
    var unsuitable = sectors.filter(function (sector) {
      return sector.floorScore <= 5 || sector.score <= 35;
    }).slice(0, 3);
    if (!unsuitable.length) unsuitable = sectors.slice(-2).reverse();

    var area = safeNumber(item && item.area);
    var rent = safeNumber(item && item.rent);
    var fee = safeNumber(item && item.fee);
    var perArea = area > 0 ? round1((rent + fee) / area) : 0;
    var topNames = recommendations.map(function (row) { return row.name; }).join("·");
    var summary = profiles[0].name + " 성격이 가장 강하고, 매물은 " + concentration.label + "에 위치한 것으로 추정됩니다. ";
    summary += floor.label + (area ? "·" + area + "평" : "") + " 조건에서는 " + topNames + " 임차군을 우선 제안하는 편이 합리적입니다.";
    if (perArea) summary += " 월세와 관리비를 합친 평당 월 고정비는 " + perArea + "만원입니다.";

    return {
      floor:floor,
      sectors:sectors,
      profiles:profiles,
      concentration:concentration,
      diversity:diversity,
      recommendations:recommendations,
      unsuitable:unsuitable,
      perArea:perArea,
      summary:summary
    };
  }

  function radiusCardsHtml(data) {
    return [100, 300, 500].map(function (radius) {
      var row = radiusSummary(data, radius);
      return '<div class="commerce-radius-card"><span>' + radius + 'm</span><strong>' + safeNumber(row.totalCount).toLocaleString("ko-KR") + '개</strong><small>㏊당 ' + round1(row.densityPerHa) + '개</small></div>';
    }).join("");
  }

  function recommendationHtml(rows) {
    return rows.map(function (row, index) {
      var risk = row.risks.length ? row.risks[0] : "추가 현장조건 확인 필요";
      return '<article class="commerce-recommend-card" data-sector-id="' + esc(row.id) + '">' +
        '<div class="commerce-recommend-rank"><span>' + (index + 1) + '순위</span><strong>' + esc(row.name) + '</strong><b>' + row.score + '점</b></div>' +
        '<div class="commerce-score-track"><i style="width:' + row.score + '%"></i></div>' +
        '<ul><li>' + esc(row.reasons[0]) + '</li><li>' + esc(row.reasons[1]) + '</li><li>공식 업소: 100m ' + row.metric.count100 + '개 · 300m ' + row.metric.count300 + '개</li></ul>' +
        '<div class="commerce-risk"><span>' + esc(row.competition) + '</span>' + esc(risk) + '</div>' +
        '<button type="button" onclick="showPublicSectorCompetition(\'' + esc(row.id) + '\')">지도 경쟁업체 보기</button>' +
      '</article>';
    }).join("");
  }

  function sectorSelectOptions(selectedId) {
    return SECTORS.map(function (definition) {
      return '<option value="' + esc(definition.id) + '"' + (definition.id === selectedId ? ' selected' : '') + '>' + esc(definition.name) + '</option>';
    }).join("");
  }

  function sectorDetailHtml(data, item, analysis, sectorId) {
    var definition = sectorDefinition(sectorId);
    var sector = analysis.sectors.filter(function (row) { return row.id === definition.id; })[0] || analysis.sectors[0];
    var stores = storesForSector(data, definition.id);
    var nearest = stores.slice(0, 5);
    var direction = directionalCompetition(stores, item);
    var synergy = synergyRows(data, definition.id);
    var directionCounts = direction.counts;
    var nearestHtml = nearest.length ? nearest.map(function (store, index) {
      return '<div class="commerce-nearest-row"><b>' + (index + 1) + '</b><span><strong>' + esc(store.name || store.small || "업소명 미등록") + '</strong><small>' + esc(store.small || store.medium || "") + (store.address ? ' · ' + esc(store.address) : '') + '</small></span><em>' + safeNumber(store.distance) + 'm</em></div>';
    }).join("") : '<div class="public-commerce-empty">해당 업종군의 개별 업소 위치가 없습니다.</div>';
    var synergyHtml = synergy.map(function (row) {
      return '<span><b>' + esc(row.name) + '</b>100m ' + row.count100 + '개 · 300m ' + row.count300 + '개</span>';
    }).join("");

    return '<div class="commerce-sector-toolbar"><label>상세 분석 업종<select id="commerceSectorSelect" onchange="showPublicSectorCompetition(this.value)">' + sectorSelectOptions(definition.id) + '</select></label><button type="button" onclick="showPublicSectorCompetition(\'' + esc(definition.id) + '\')">지도에 표시</button></div>' +
      '<div class="commerce-sector-summary"><div><span>100m</span><strong>' + sector.metric.count100 + '개</strong></div><div><span>300m</span><strong>' + sector.metric.count300 + '개</strong></div><div><span>500m</span><strong>' + sector.metric.count500 + '개</strong></div><div><span>최근접</span><strong>' + (sector.metric.nearestDistance === null ? '-' : sector.metric.nearestDistance + 'm') + '</strong></div></div>' +
      '<div class="commerce-direction"><div><span>상대적 공백 방향</span><strong>' + esc(direction.gap) + '</strong></div><div><span>밀집 방향</span><strong>' + esc(direction.dense) + '</strong></div><small>북 ' + directionCounts.north + ' · 동 ' + directionCounts.east + ' · 남 ' + directionCounts.south + ' · 서 ' + directionCounts.west + '</small></div>' +
      '<div class="commerce-detail-columns"><section><h5>최근접 경쟁업체</h5>' + nearestHtml + '</section><section><h5>연관 업종 생태계</h5><div class="commerce-synergy-list">' + synergyHtml + '</div></section></div>' +
      '<p class="commerce-sector-note">지도에는 성능 보호를 위해 가까운 업체부터 업종군별 최대 40개를 표시합니다. 전체 경쟁 수치는 모든 공식 업소를 반영합니다.</p>';
  }

  function categoryTableHtml(data) {
    var rows = metricRows(data, "medium").slice(0, 7);
    if (!rows.length) return '<div class="public-commerce-empty">표시할 업종 데이터가 없습니다.</div>';
    return '<div class="commerce-category-table">' +
      '<div class="commerce-category-row commerce-category-head"><span>업종군</span><b>100m</b><b>300m</b><b>500m</b><b>최근접</b></div>' +
      rows.map(function (row) {
        return '<div class="commerce-category-row"><span>' + esc(row.name) + '</span><b>' + safeNumber(row.count100) + '</b><b>' + safeNumber(row.count300) + '</b><b>' + safeNumber(row.count500) + '</b><b>' + (row.nearestDistance === null || typeof row.nearestDistance === "undefined" ? '-' : safeNumber(row.nearestDistance) + 'm') + '</b></div>';
      }).join("") + '</div>';
  }

  function renderSuccess(target, data, item) {
    if (safeNumber(data.version) < 3 || !Array.isArray(data.radii) || !Array.isArray(data.stores)) {
      target.innerHTML = '<div class="public-commerce-error"><b>경쟁업체 지도용 Apps Script 업데이트 필요</b><span>v6.3.37 전체 코드로 교체·배포하면 업종별 경쟁업체 위치가 표시됩니다.</span></div>';
      return;
    }

    var itemKey = String((item && item.key) || "");
    var analysis = buildAnalysis(data, item);
    currentDataByItemKey[itemKey] = data;
    currentAnalysisByItemKey[itemKey] = analysis;
    var profileNames = analysis.profiles.slice(0, 2).map(function (row) { return row.name; });
    var initialSectorId = analysis.recommendations[0] ? analysis.recommendations[0].id : SECTORS[0].id;
    var unsuitable = analysis.unsuitable.map(function (row) {
      var reason = row.floorScore <= 5 ? "층수 유입방식 불일치" : "비교 적합도 낮음";
      return '<span><b>' + esc(row.name) + '</b>' + esc(reason) + '</span>';
    }).join("");

    target.innerHTML = '' +
      '<div class="public-commerce-head">' +
        '<div><span class="public-commerce-source">공식데이터 · 소상공인시장진흥공단</span><h3>매물 맞춤 전문 브리핑</h3></div>' +
        '<div class="public-commerce-count"><strong>' + safeNumber(radiusSummary(data, 300).totalCount).toLocaleString("ko-KR") + '</strong><span>반경 300m 영업 업소</span></div>' +
      '</div>' +
      '<div class="commerce-profile-line"><span>상권 유형 추정</span>' + profileNames.map(function (name) { return '<b>' + esc(name) + '</b>'; }).join("") + '</div>' +
      '<div class="public-commerce-brief"><span class="commerce-inference-tag">업소구성 기반 해석</span>' + esc(analysis.summary) + '</div>' +
      '<div class="commerce-radius-grid">' + radiusCardsHtml(data) + '</div>' +
      '<div class="commerce-signal-grid">' +
        '<div><span>입지 집중도</span><strong>' + esc(analysis.concentration.label) + '</strong><small>100m/300m 밀도비 ' + analysis.concentration.ratio + '</small></div>' +
        '<div><span>업종 다양성</span><strong>' + esc(analysis.diversity.label) + '</strong><small>구성지수 ' + analysis.diversity.score + '/100</small></div>' +
        '<div><span>매물 조건</span><strong>' + esc(analysis.floor.label) + ' · ' + (safeNumber(item && item.area) ? safeNumber(item.area) + '평' : '면적 미입력') + '</strong><small>' + (analysis.perArea ? '평당 월고정비 ' + analysis.perArea + '만원' : '고정비 계산자료 부족') + '</small></div>' +
      '</div>' +
      '<section class="commerce-section"><div class="commerce-section-title"><div><span>매물조건+공식업소 분석</span><h4>우선 제안 임차 타깃</h4></div><small>성공확률이 아닌 비교 적합도</small></div><div class="commerce-recommend-grid">' + recommendationHtml(analysis.recommendations) + '</div></section>' +
      '<section class="commerce-section commerce-sector-detail"><div class="commerce-section-title"><div><span>업종별 위치 분석</span><h4>경쟁업체 지도·최근접 분석</h4></div><small>버튼을 누르면 지도에 표시</small></div><div id="commerceSectorDetailBody">' + sectorDetailHtml(data, item, analysis, initialSectorId) + '</div></section>' +
      '<section class="commerce-section commerce-unsuitable"><div class="commerce-section-title"><div><span>층수·면적 기준</span><h4>우선순위가 낮은 업종</h4></div></div><div>' + unsuitable + '</div></section>' +
      '<section class="commerce-section"><div class="commerce-section-title"><div><span>공식데이터</span><h4>주요 업종 경쟁·집적 현황</h4></div><small>거리별 영업 업소 수</small></div>' + categoryTableHtml(data) + '</section>' +
      '<div class="public-commerce-evidence">출처: 소상공인시장진흥공단 상가(상권)정보 API · 분석시각 ' + esc(data.generatedAt || "-") + (data.cached ? ' · 캐시 사용' : '') + '<br>업소 수는 공식 데이터의 현재 등록 현황입니다. 상권 유형·임차 타깃·적합도는 매물 층수·면적과 업소 구성을 결합한 JS부동산 분석이며 매출·유동인구 추정값은 포함하지 않습니다.</div>';
  }

  function removeCompetitorLegend() {
    if (competitorMapLegend && competitorMapLegend.parentNode) {
      competitorMapLegend.parentNode.removeChild(competitorMapLegend);
    }
    competitorMapLegend = null;
  }

  window.clearPublicCompetitorMap = function () {
    competitorMapObjects.forEach(function (object) {
      try { object.setMap(null); } catch (_) {}
    });
    competitorMapObjects = [];
    removeCompetitorLegend();
    activeCompetitionItemKey = "";
    activeCompetitionSectorId = "";
    document.querySelectorAll(".commerce-recommend-card.active").forEach(function (card) {
      card.classList.remove("active");
    });
  };

  function updateLegendStore(store) {
    if (!competitorMapLegend) return;
    var detail = competitorMapLegend.querySelector(".commerce-map-legend-detail");
    if (detail) {
      detail.textContent = (store.name || store.small || "업소명 미등록") + " · " + safeNumber(store.distance) + "m · " + (store.address || store.small || "");
    }
  }

  function createCompetitorLegend(definition, stores, shownCount) {
    removeCompetitorLegend();
    var legend = document.createElement("div");
    legend.className = "commerce-map-legend";
    legend.innerHTML = '<div><span>경쟁업체 지도</span><strong>' + esc(definition.name) + '</strong><small>전체 ' + stores.length + '개 · 가까운 순 ' + shownCount + '개 표시</small><em class="commerce-map-legend-detail">마커를 누르면 업체 정보가 표시됩니다.</em></div><div class="commerce-map-legend-actions"><button type="button" onclick="restorePublicCompetitionPanel()">카드보기</button><button type="button" onclick="clearPublicCompetitorMap()">표시해제</button></div>';
    document.body.appendChild(legend);
    competitorMapLegend = legend;
  }

  window.restorePublicCompetitionPanel = function () {
    var panel = document.getElementById("aiSidePanel");
    if (!panel || !activeCompetitionItemKey) return;
    panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("ai-side-panel-open");
    if (typeof window.relayoutMapAfterAiPanel === "function") window.relayoutMapAfterAiPanel();
    else if (typeof map !== "undefined" && map && typeof map.relayout === "function") setTimeout(function () { map.relayout(); }, 250);
  };

  function hidePanelForMobileMap() {
    if (window.innerWidth > 768) return;
    var panel = document.getElementById("aiSidePanel");
    document.body.classList.remove("ai-side-panel-open");
    if (panel) panel.setAttribute("aria-hidden", "true");
    if (typeof map !== "undefined" && map && typeof map.relayout === "function") {
      setTimeout(function () { map.relayout(); }, 220);
    }
  }

  function addCompetitionCircles(center) {
    [100, 300, 500].forEach(function (radius, index) {
      var colors = ["#0a78ff", "#25a56a", "#7b61ff"];
      var circle = new kakao.maps.Circle({
        center:center,
        radius:radius,
        strokeWeight:index === 1 ? 2 : 1,
        strokeColor:colors[index],
        strokeOpacity:index === 1 ? 0.65 : 0.35,
        strokeStyle:index === 1 ? "solid" : "dash",
        fillColor:colors[index],
        fillOpacity:0.015,
        zIndex:9000 + index
      });
      circle.setMap(map);
      competitorMapObjects.push(circle);
    });
  }

  window.showPublicSectorCompetition = function (sectorId) {
    var item = getCurrentItem();
    if (!item) {
      alert("먼저 매물을 선택해주세요.");
      return;
    }
    var itemKey = String(item.key || "");
    var data = currentDataByItemKey[itemKey];
    var analysis = currentAnalysisByItemKey[itemKey];
    if (!data || safeNumber(data.version) < 3 || !analysis) {
      alert("경쟁업체 위치 데이터를 불러온 뒤 다시 눌러주세요.");
      return;
    }
    var definition = sectorDefinition(sectorId);
    var stores = storesForSector(data, definition.id);
    var detail = document.getElementById("commerceSectorDetailBody");
    if (detail) detail.innerHTML = sectorDetailHtml(data, item, analysis, definition.id);

    window.clearPublicCompetitorMap();
    activeCompetitionItemKey = itemKey;
    activeCompetitionSectorId = definition.id;
    document.querySelectorAll(".commerce-recommend-card[data-sector-id]").forEach(function (card) {
      card.classList.toggle("active", card.getAttribute("data-sector-id") === definition.id);
    });

    if (typeof map === "undefined" || !map || !window.kakao || !kakao.maps) {
      alert("지도가 준비된 뒤 다시 눌러주세요.");
      return;
    }
    var coords = getCoordinates(item);
    if (!coords) {
      alert("매물 좌표가 없어 지도에 표시할 수 없습니다.");
      return;
    }
    var center = new kakao.maps.LatLng(coords.lat, coords.lng);
    addCompetitionCircles(center);

    var centerContent = document.createElement("div");
    centerContent.className = "commerce-property-center-marker";
    centerContent.innerHTML = '<span>매물</span>';
    var centerOverlay = new kakao.maps.CustomOverlay({ position:center, content:centerContent, xAnchor:0.5, yAnchor:0.5, zIndex:12000 });
    centerOverlay.setMap(map);
    competitorMapObjects.push(centerOverlay);

    var markerLimit = 40;
    var visibleStores = stores.slice(0, markerLimit);
    visibleStores.forEach(function (store, index) {
      var markerContent = document.createElement("button");
      markerContent.type = "button";
      markerContent.className = "commerce-competitor-marker" + (index < 10 ? " nearest" : "");
      markerContent.title = (store.name || store.small || definition.name) + " · " + safeNumber(store.distance) + "m";
      markerContent.setAttribute("aria-label", markerContent.title);
      markerContent.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        updateLegendStore(store);
      });
      var position = new kakao.maps.LatLng(safeNumber(store.lat), safeNumber(store.lng));
      var overlay = new kakao.maps.CustomOverlay({ position:position, content:markerContent, xAnchor:0.5, yAnchor:0.5, zIndex:10000 - index });
      overlay.setMap(map);
      competitorMapObjects.push(overlay);
    });

    createCompetitorLegend(definition, stores, visibleStores.length);
    map.setCenter(center);
    map.setLevel(window.innerWidth <= 768 ? 6 : 5);
    if (typeof map.relayout === "function") setTimeout(function () { map.relayout(); map.setCenter(center); }, 240);
    hidePanelForMobileMap();
  };

  function renderError(target, message) {
    target.innerHTML = '<div class="public-commerce-error"><b>공식 상권 브리핑 준비 중</b><span>' + esc(message || "데이터를 불러오지 못했습니다.") + '</span></div>';
  }

  window.loadPublicCommercialBrief = function (item) {
    var target = document.getElementById("publicCommercialBrief");
    if (!target) return;
    var coords = getCoordinates(item);
    if (!coords) {
      renderError(target, "매물 좌표가 없어 공식 상권을 분석할 수 없습니다.");
      return;
    }
    if (!window.saveApiURL) {
      renderError(target, "Apps Script 주소가 설정되지 않았습니다.");
      return;
    }

    var key = cacheKey(item, coords);
    var cached = readCache(key);
    if (cached && cached.ok && safeNumber(cached.version) >= 3) {
      renderSuccess(target, cached, item);
      return;
    }

    target.innerHTML = '<div class="public-commerce-loading"><b>100·300·500m 공식 상권을 분석하고 있습니다</b><span>최초 조회는 업소 수에 따라 수 초 걸릴 수 있습니다.</span></div>';
    var params = [
      "action=commercialArea",
      "lat=" + encodeURIComponent(coords.lat),
      "lng=" + encodeURIComponent(coords.lng),
      "radius=" + ANALYSIS_RADIUS,
      "propertyId=" + encodeURIComponent(item.propertyId || item.id || item.key || "")
    ].join("&");

    jsonp(saveApiURL + (saveApiURL.indexOf("?") >= 0 ? "&" : "?") + params, 35000)
      .then(function (data) {
        if (!data || !data.ok || data.action !== "commercialArea") {
          throw new Error((data && data.message) || "공식 상권정보 API 설정을 확인해주세요.");
        }
        if (safeNumber(data.version) >= 3) writeCache(key, data);
        renderSuccess(target, data, item);
      })
      .catch(function (error) {
        renderError(target, error && error.message);
      });
  };

  function getCurrentItem() {
    var key = String(window.selectedItemKey || "");
    return (window.allItems || []).find(function (item) { return String(item.key || "") === key; }) || null;
  }

  function propertyFactsHtml(item) {
    var area = safeNumber(item && item.area);
    var rent = safeNumber(item && item.rent);
    var fee = safeNumber(item && item.fee);
    var perArea = area > 0 ? round1((rent + fee) / area) : 0;
    return '' +
      '<div class="professional-property-title">' + esc((item && item.name) || "매물") + '</div>' +
      '<div class="professional-property-address">' + esc([item && item.address, item && item.room].filter(Boolean).join(" · ")) + '</div>' +
      '<div class="professional-facts">' +
        '<div><span>층수</span><strong>' + esc(parseFloor(item).label) + '</strong></div>' +
        '<div><span>면적</span><strong>' + (area ? area + "평" : "-") + '</strong></div>' +
        '<div><span>보증금</span><strong>' + money(item && item.deposit) + '</strong></div>' +
        '<div><span>월세</span><strong>' + money(rent) + '</strong></div>' +
        '<div><span>관리비</span><strong>' + money(fee) + '</strong></div>' +
        '<div><span>권리금</span><strong>' + money(item && item.premium) + '</strong></div>' +
        '<div><span>평당 월고정비</span><strong>' + (perArea ? perArea + "만원" : "-") + '</strong></div>' +
      '</div>';
  }

  window.buildSmartItemCardHtml = function (item) {
    return '' +
      '<article class="ai-professional-card" onclick="event.stopPropagation();">' +
        '<header class="professional-card-head"><div><span>JS부동산</span><h2>상가 매물 전문 브리핑</h2></div><b>공식데이터 연동</b></header>' +
        propertyFactsHtml(item) +
        '<section class="public-commerce-card professional-commerce-wrap"><div id="publicCommercialBrief"><div class="public-commerce-loading">공식 상권 브리핑 준비 중…</div></div></section>' +
      '</article>';
  };

  function reportText(item, data, analysis) {
    var area = safeNumber(item && item.area);
    var rent = safeNumber(item && item.rent);
    var fee = safeNumber(item && item.fee);
    var lines = [
      "[JS부동산 상가 매물 전문 브리핑]",
      "매물: " + [item && item.name, item && item.address, item && item.room].filter(Boolean).join(" / "),
      "조건: " + parseFloor(item).label + " / " + (area ? area + "평" : "면적 미입력"),
      "금액: 보증금 " + money(item && item.deposit) + " / 월세 " + money(rent) + " / 관리비 " + money(fee) + " / 권리금 " + money(item && item.premium),
      "평당 월고정비: " + (analysis && analysis.perArea ? analysis.perArea + "만원" : "-")
    ];

    if (data && data.ok && analysis) {
      lines.push("", "[핵심 브리핑]", analysis.summary);
      lines.push("", "[거리별 공식 업소]", [100, 300, 500].map(function (radius) {
        var row = radiusSummary(data, radius);
        return radius + "m " + row.totalCount + "개(㏊당 " + round1(row.densityPerHa) + "개)";
      }).join(" / "));
      lines.push("입지 집중도: " + analysis.concentration.label + " / 업종 다양성: " + analysis.diversity.label + " " + analysis.diversity.score + "점");
      lines.push("", "[우선 제안 임차 타깃]");
      analysis.recommendations.forEach(function (row, index) {
        lines.push((index + 1) + ". " + row.name + " " + row.score + "점 · " + row.reasons.join(" · ") + " · " + row.competition);
      });
      lines.push("", "[우선순위가 낮은 업종]", analysis.unsuitable.map(function (row) { return row.name; }).join(" / "));
      lines.push("", "[주요 업종 경쟁·집적]", metricRows(data, "medium").slice(0, 8).map(function (row) {
        return row.name + " 100m " + row.count100 + "개·300m " + row.count300 + "개·500m " + row.count500 + "개";
      }).join(" / "));
      var selectedSectorId = activeCompetitionItemKey === String((item && item.key) || "") && activeCompetitionSectorId
        ? activeCompetitionSectorId
        : (analysis.recommendations[0] ? analysis.recommendations[0].id : SECTORS[0].id);
      var selectedDefinition = sectorDefinition(selectedSectorId);
      var selectedStores = storesForSector(data, selectedSectorId);
      var selectedDirection = directionalCompetition(selectedStores, item);
      var selectedSynergy = synergyRows(data, selectedSectorId);
      lines.push("", "[" + selectedDefinition.name + " 경쟁업체 상세]", "전체 500m " + selectedStores.length + "개 / 상대적 공백 " + selectedDirection.gap + " / 밀집 " + selectedDirection.dense);
      lines.push("최근접 업체: " + selectedStores.slice(0, 5).map(function (store) {
        return (store.name || store.small || "업소명 미등록") + " " + store.distance + "m";
      }).join(" / "));
      lines.push("연관 업종: " + selectedSynergy.map(function (row) { return row.name + " 300m " + row.count300 + "개"; }).join(" / "));
      lines.push("", "분석시각: " + (data.generatedAt || "-"));
    } else {
      lines.push("", "공식 상권 데이터가 아직 준비되지 않았습니다.");
    }
    lines.push("출처: 소상공인시장진흥공단 상가(상권)정보 API");
    lines.push("안내: 상권 유형·임차 타깃·적합도는 공식 업소 현황과 매물조건을 결합한 분석이며 매출·유동인구 추정값은 포함하지 않습니다.");
    return lines.join("\n");
  }

  window.buildSmartItemAnalysisText = function (item) {
    var key = String((item && item.key) || "");
    return reportText(item, currentDataByItemKey[key], currentAnalysisByItemKey[key]);
  };

  window.printAIInvestmentReport = function () {
    var item = getCurrentItem();
    if (!item) {
      alert("먼저 매물을 선택해주세요.");
      return;
    }
    var key = String(item.key || "");
    var data = currentDataByItemKey[key];
    var analysis = currentAnalysisByItemKey[key];
    if (!data || !data.ok || !analysis) {
      alert("공식 상권 브리핑을 불러온 뒤 다시 눌러주세요.");
      return;
    }

    var report = reportText(item, data, analysis);
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>JS부동산 상가 매물 브리핑</title><style>' +
      '@page{size:A4;margin:13mm}body{font-family:Arial,"Malgun Gothic",sans-serif;color:#172033;margin:0}.report{max-width:780px;margin:auto}.head{display:flex;justify-content:space-between;border-bottom:3px solid #1671e8;padding-bottom:12px}.head h1{margin:0;font-size:24px;color:#1467d8}.source{font-size:10px;color:#667085}.property{padding:15px 0}.property h2{margin:0 0 5px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.fact,.section{border:1px solid #dbe6f4;border-radius:9px;padding:10px}.fact span{display:block;font-size:10px;color:#667085}.fact b{display:block;margin-top:4px;font-size:13px}.section{margin-top:11px;page-break-inside:avoid}.section h3{margin:0 0 8px;color:#1467d8}.brief{line-height:1.7;font-weight:700}.targets{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.target{border:1px solid #dbe6f4;border-radius:8px;padding:9px}.target strong{display:block}.target b{color:#1467d8}.target small{display:block;margin-top:5px;line-height:1.45;color:#526174}.pre{white-space:pre-wrap;font-size:11px;line-height:1.6}.foot{margin-top:13px;font-size:9px;color:#667085}</style></head><body><div class="report">' +
      '<div class="head"><h1>상가 매물 전문 브리핑</h1><div class="source">공식데이터 · 소상공인시장진흥공단</div></div>' +
      '<div class="property"><h2>' + esc(item.name || "매물") + '</h2><div>' + esc([item.address,item.room].filter(Boolean).join(" · ")) + '</div></div>' +
      '<div class="facts"><div class="fact"><span>층수</span><b>' + esc(analysis.floor.label) + '</b></div><div class="fact"><span>면적</span><b>' + (safeNumber(item.area) ? safeNumber(item.area) + '평' : '-') + '</b></div><div class="fact"><span>보증금 / 월세</span><b>' + money(item.deposit) + ' / ' + money(item.rent) + '</b></div><div class="fact"><span>평당 월고정비</span><b>' + (analysis.perArea ? analysis.perArea + '만원' : '-') + '</b></div></div>' +
      '<section class="section"><h3>핵심 브리핑</h3><div class="brief">' + esc(analysis.summary) + '</div></section>' +
      '<section class="section"><h3>우선 제안 임차 타깃</h3><div class="targets">' + analysis.recommendations.map(function(row){return '<div class="target"><strong>'+esc(row.name)+'</strong><b>'+row.score+'점</b><small>'+esc(row.reasons.join(' · '))+'</small></div>';}).join('') + '</div></section>' +
      '<section class="section"><h3>상권 상세 근거</h3><div class="pre">' + esc(report) + '</div></section>' +
      '<div class="foot">출처: 소상공인시장진흥공단 상가(상권)정보 API · 분석시각 ' + esc(data.generatedAt || "-") + '<br>상권 유형·임차 타깃·적합도는 공식 업소 현황과 매물 조건을 결합한 분석이며 매출·유동인구 추정값은 포함하지 않습니다.</div>' +
      '</div></body></html>';

    var win = window.open("", "_blank", "width=900,height=1000");
    if (!win) {
      alert("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해주세요.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 350);
  };
})();
