(function () {
  "use strict";

  var CACHE_PREFIX = "jsPublicCommerceV1:";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  var DEFAULT_RADIUS = 300;
  var requestSequence = 0;
  var currentDataByItemKey = {};

  function safeNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function getCoordinates(item) {
    if (!item || !item.latlng) return null;
    var lat = typeof item.latlng.getLat === "function" ? item.latlng.getLat() : item.lat;
    var lng = typeof item.latlng.getLng === "function" ? item.latlng.getLng() : item.lng;
    lat = Number(lat);
    lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat:lat, lng:lng } : null;
  }

  function cacheKey(item, coords, radius) {
    return CACHE_PREFIX + [
      item && (item.propertyId || item.id || item.key || ""),
      coords.lat.toFixed(5),
      coords.lng.toFixed(5),
      radius
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
      }, timeoutMs || 18000);

      script.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
  }

  function parseFloor(item) {
    var raw = String((item && item.floor) || "").trim().toUpperCase();
    if (!raw) return { value:null, label:"층수 미입력" };
    var basement = raw.match(/B\s*(\d+)/);
    if (basement) return { value:-Number(basement[1]), label:"지하 " + basement[1] + "층" };
    var match = raw.match(/-?\d+/);
    if (!match) return { value:null, label:raw };
    var value = Number(match[0]);
    return { value:value, label:value < 0 ? "지하 " + Math.abs(value) + "층" : value + "층" };
  }

  function topRows(rows, limit) {
    return (Array.isArray(rows) ? rows : []).slice(0, limit || 5);
  }

  function isPurposeVisitCategory(name) {
    return /교육|학원|의료|병원|의원|전문|법무|회계|부동산|스포츠|체육|미용|서비스/.test(String(name || ""));
  }

  function isStreetCategory(name) {
    return /음식|소매|카페|커피|편의점|제과|의류|화장품/.test(String(name || ""));
  }

  function selectFloorFit(data, item) {
    var floor = parseFloor(item);
    var candidates = topRows(data.mediumCategories, 12);
    var preferred = candidates.filter(function (row) {
      if (floor.value === null) return true;
      if (floor.value >= 2) return isPurposeVisitCategory(row.name);
      if (floor.value === 1) return isStreetCategory(row.name) || isPurposeVisitCategory(row.name);
      return /음식|스포츠|체육|오락|서비스/.test(String(row.name || ""));
    });
    if (!preferred.length) preferred = candidates;
    return { floor:floor, rows:preferred.slice(0, 3) };
  }

  function buildBrief(data, item) {
    var floorFit = selectFloorFit(data, item);
    var top = topRows(data.smallCategories, 3);
    var area = safeNumber(item && item.area);
    var rent = safeNumber(item && item.rent);
    var fee = safeNumber(item && item.fee);
    var perArea = area > 0 ? Math.round(((rent + fee) / area) * 10) / 10 : 0;
    var place = String((item && (item.name || item.address)) || "해당 매물");
    var sentence = place + " 반경 " + data.radius + "m에는 영업 업소 " + data.totalCount + "개가 확인됩니다.";
    if (top.length) {
      sentence += " 주요 업종은 " + top.map(function (row) { return row.name + " " + row.count + "개"; }).join(", ") + "입니다.";
    }
    sentence += " 이 매물은 " + floorFit.floor.label + (area ? " · " + area + "평" : "") + " 조건입니다.";
    if (floorFit.rows.length) {
      sentence += " 현재 상권에서 확인되는 업종 중 " + floorFit.rows.map(function (row) { return row.name; }).join("·") + " 계열을 우선 브리핑할 수 있습니다.";
    }
    if (perArea) sentence += " 월세와 관리비 합계는 평당 약 " + perArea + "만원입니다.";
    return { text:sentence, floorFit:floorFit, perArea:perArea };
  }

  function rowsHtml(rows, emptyText) {
    if (!rows || !rows.length) return '<div class="public-commerce-empty">' + escapeHtml(emptyText || "표시할 데이터가 없습니다.") + '</div>';
    return rows.map(function (row) {
      return '<div class="public-commerce-row"><span>' + escapeHtml(row.name) + '</span><strong>' + safeNumber(row.count) + '개</strong></div>';
    }).join("");
  }

  function renderSuccess(target, data, item) {
    currentDataByItemKey[String((item && item.key) || "")] = data;
    var brief = buildBrief(data, item);
    var topSmall = topRows(data.smallCategories, 5);
    var topLarge = topRows(data.largeCategories, 4);
    target.innerHTML = '' +
      '<div class="public-commerce-head">' +
        '<div><span class="public-commerce-source">출처: 소상공인365</span><h3>매물 맞춤 상권 브리핑</h3></div>' +
        '<div class="public-commerce-count"><strong>' + safeNumber(data.totalCount) + '</strong><span>반경 ' + safeNumber(data.radius) + 'm 업소</span></div>' +
      '</div>' +
      '<div class="public-commerce-brief">' + escapeHtml(brief.text) + '</div>' +
      '<div class="public-commerce-columns">' +
        '<section><h4>상권 구성</h4>' + rowsHtml(topLarge, "상권 구성 데이터 없음") + '</section>' +
        '<section><h4>주요 세부업종</h4>' + rowsHtml(topSmall, "세부업종 데이터 없음") + '</section>' +
      '</div>' +
      '<section class="public-commerce-fit"><h4>' + escapeHtml(brief.floorFit.floor.label) + ' 조건에 맞춘 브리핑 업종군</h4>' +
        rowsHtml(brief.floorFit.rows, "층수에 맞는 업종군을 선별할 데이터가 부족합니다.") +
      '</section>' +
      '<div class="public-commerce-evidence">출처: 소상공인365(소상공인시장진흥공단 상가·상권정보 API) · 분석시각 ' + escapeHtml(data.generatedAt || "-") + '</div>';
  }

  function renderError(target, message) {
    target.innerHTML = '<div class="public-commerce-error"><b>공식 상권 브리핑 준비 중</b><span>' + escapeHtml(message || "데이터를 불러오지 못했습니다.") + '</span></div>';
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

    var radius = DEFAULT_RADIUS;
    var key = cacheKey(item, coords, radius);
    var cached = readCache(key);
    if (cached && cached.ok) {
      renderSuccess(target, cached, item);
      return;
    }

    target.innerHTML = '<div class="public-commerce-loading">공식 상가·상권 데이터를 분석하고 있습니다…</div>';
    var params = [
      "action=commercialArea",
      "lat=" + encodeURIComponent(coords.lat),
      "lng=" + encodeURIComponent(coords.lng),
      "radius=" + encodeURIComponent(radius),
      "propertyId=" + encodeURIComponent(item.propertyId || item.id || item.key || "")
    ].join("&");

    jsonp(saveApiURL + (saveApiURL.indexOf("?") >= 0 ? "&" : "?") + params, 18000)
      .then(function (data) {
        if (!data || !data.ok || data.action !== "commercialArea") {
          throw new Error((data && data.message) || "새 Apps Script 배포와 공식 상권정보 API 설정이 필요합니다.");
        }
        writeCache(key, data);
        renderSuccess(target, data, item);
      })
      .catch(function (error) {
        renderError(target, error && error.message);
      });
  };

  function money(value) {
    var number = safeNumber(value);
    return number.toLocaleString("ko-KR") + "만원";
  }

  function getCurrentItem() {
    var key = String(window.selectedItemKey || "");
    return (window.allItems || []).find(function (item) { return String(item.key || "") === key; }) || null;
  }

  function propertyFactsHtml(item) {
    var area = safeNumber(item && item.area);
    var rent = safeNumber(item && item.rent);
    var fee = safeNumber(item && item.fee);
    var perArea = area > 0 ? Math.round(((rent + fee) / area) * 10) / 10 : 0;
    return '' +
      '<div class="professional-property-title">' + escapeHtml((item && item.name) || "매물") + '</div>' +
      '<div class="professional-property-address">' + escapeHtml([item && item.address, item && item.room].filter(Boolean).join(" · ")) + '</div>' +
      '<div class="professional-facts">' +
        '<div><span>층수</span><strong>' + escapeHtml(parseFloor(item).label) + '</strong></div>' +
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
        '<header class="professional-card-head"><div><span>JS부동산</span><h2>상가 매물 전문 브리핑</h2></div><b>출처: 소상공인365</b></header>' +
        propertyFactsHtml(item) +
        '<section class="public-commerce-card professional-commerce-wrap"><div id="publicCommercialBrief"><div class="public-commerce-loading">공식 상권 브리핑 준비 중…</div></div></section>' +
      '</article>';
  };

  function reportText(item, data) {
    var area = safeNumber(item && item.area);
    var rent = safeNumber(item && item.rent);
    var fee = safeNumber(item && item.fee);
    var premium = safeNumber(item && item.premium);
    var perArea = area > 0 ? Math.round(((rent + fee) / area) * 10) / 10 : 0;
    var lines = [
      "[JS부동산 상가 매물 전문 브리핑]",
      "매물: " + [item && item.name, item && item.address, item && item.room].filter(Boolean).join(" / "),
      "조건: " + parseFloor(item).label + " / " + (area ? area + "평" : "면적 미입력"),
      "금액: 보증금 " + money(item && item.deposit) + " / 월세 " + money(rent) + " / 관리비 " + money(fee) + " / 권리금 " + money(premium),
      "평당 월고정비: " + (perArea ? perArea + "만원" : "-")
    ];

    if (data && data.ok) {
      var brief = buildBrief(data, item);
      lines.push("", "[상권 브리핑]", brief.text);
      lines.push("", "[상권 구성]", topRows(data.largeCategories, 5).map(function (row) { return row.name + " " + row.count + "개"; }).join(" / "));
      lines.push("", "[주요 세부업종]", topRows(data.smallCategories, 8).map(function (row) { return row.name + " " + row.count + "개"; }).join(" / "));
      lines.push("", "[층수 조건에 맞춘 브리핑 업종군]", brief.floorFit.rows.map(function (row) { return row.name + " " + row.count + "개"; }).join(" / ") || "데이터 부족");
      lines.push("", "분석시각: " + (data.generatedAt || "-"));
    } else {
      lines.push("", "공식 상권 데이터가 아직 준비되지 않았습니다.");
    }
    lines.push("출처: 소상공인365(소상공인시장진흥공단 상가·상권정보 API)");
    return lines.join("\n");
  }

  window.buildSmartItemAnalysisText = function (item) {
    return reportText(item, currentDataByItemKey[String((item && item.key) || "")]);
  };

  window.printAIInvestmentReport = function () {
    var item = getCurrentItem();
    if (!item) {
      alert("먼저 매물을 선택해주세요.");
      return;
    }
    var data = currentDataByItemKey[String(item.key || "")];
    if (!data || !data.ok) {
      alert("공식 상권 브리핑을 불러온 뒤 다시 눌러주세요.");
      return;
    }

    var brief = buildBrief(data, item);
    var area = safeNumber(item.area);
    var rent = safeNumber(item.rent);
    var fee = safeNumber(item.fee);
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>JS부동산 상가 매물 브리핑</title><style>' +
      '@page{size:A4;margin:14mm}body{font-family:Arial,"Malgun Gothic",sans-serif;color:#172033;margin:0}.report{max-width:760px;margin:auto}.head{display:flex;justify-content:space-between;border-bottom:3px solid #1671e8;padding-bottom:12px}.head h1{margin:0;font-size:25px;color:#1467d8}.source{font-size:11px;color:#667085}.property{padding:16px 0}.property h2{margin:0 0 5px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.fact{border:1px solid #dbe6f4;border-radius:9px;padding:9px}.fact span{display:block;font-size:10px;color:#667085}.fact b{display:block;margin-top:4px;font-size:14px}.section{margin-top:12px;border:1px solid #dbe6f4;border-radius:11px;padding:13px;page-break-inside:avoid}.section h3{margin:0 0 8px;color:#1467d8}.brief{line-height:1.75;font-weight:700}.rows{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px}.row{display:flex;justify-content:space-between;border-bottom:1px dashed #dbe6f4;padding:5px 0;font-size:12px}.foot{margin-top:14px;font-size:10px;color:#667085}</style></head><body><div class="report">' +
      '<div class="head"><h1>상가 매물 전문 브리핑</h1><div class="source">출처: 소상공인365</div></div>' +
      '<div class="property"><h2>' + escapeHtml(item.name || "매물") + '</h2><div>' + escapeHtml([item.address,item.room].filter(Boolean).join(" · ")) + '</div></div>' +
      '<div class="facts">' +
        '<div class="fact"><span>층수</span><b>' + escapeHtml(parseFloor(item).label) + '</b></div>' +
        '<div class="fact"><span>면적</span><b>' + (area ? area + "평" : "-") + '</b></div>' +
        '<div class="fact"><span>보증금 / 월세</span><b>' + money(item.deposit) + ' / ' + money(rent) + '</b></div>' +
        '<div class="fact"><span>관리비 / 권리금</span><b>' + money(fee) + ' / ' + money(item.premium) + '</b></div>' +
      '</div>' +
      '<section class="section"><h3>매물 맞춤 상권 브리핑</h3><div class="brief">' + escapeHtml(brief.text) + '</div></section>' +
      '<section class="section"><h3>반경 ' + data.radius + 'm 상권 구성 · 총 ' + data.totalCount + '개 업소</h3><div class="rows">' + topRows(data.largeCategories,8).map(function(row){return '<div class="row"><span>'+escapeHtml(row.name)+'</span><b>'+row.count+'개</b></div>';}).join('') + '</div></section>' +
      '<section class="section"><h3>주요 세부업종</h3><div class="rows">' + topRows(data.smallCategories,12).map(function(row){return '<div class="row"><span>'+escapeHtml(row.name)+'</span><b>'+row.count+'개</b></div>';}).join('') + '</div></section>' +
      '<section class="section"><h3>' + escapeHtml(brief.floorFit.floor.label) + ' 조건에 맞춘 브리핑 업종군</h3><div class="rows">' + brief.floorFit.rows.map(function(row){return '<div class="row"><span>'+escapeHtml(row.name)+'</span><b>'+row.count+'개</b></div>';}).join('') + '</div></section>' +
      '<div class="foot">출처: 소상공인365(소상공인시장진흥공단 상가·상권정보 API) · 분석시각 ' + escapeHtml(data.generatedAt || "-") + '</div>' +
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
