/* =========================================================
   JS부동산 AI 분석 스크립트
   중복 브리핑/번갈아 표시 완전 수정본
   - v3.3 상권 브리핑 반복 렌더링 중지
   - v3.3.1 추천업종 TOP3 반복 렌더링 중지
   - v4.0 통합 투자 브리핑만 표시
   - DOM 반복 삭제/재생성으로 인한 깜빡임 및 스크롤 튐 방지
   ========================================================= */

/* JS부동산 AI 분석/상권분석 전용 스크립트 */
function clampNumber(value, min, max) {
  value = Number(value) || 0;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}


function hasText(item, pattern) {
  var text = [item.name, item.address, item.room, item.type, item.memo].join(" ");
  return pattern.test(text);
}


function formatAiMoney(value) {
  value = Number(value) || 0;
  if (!value) return "0";
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}


function buildStarRating(score) {
  score = Number(score) || 0;
  var full = 1;
  if (score >= 90) full = 5;
  else if (score >= 80) full = 4;
  else if (score >= 70) full = 3;
  else if (score >= 60) full = 2;
  else full = 1;

  var stars = "";
  for (var i = 1; i <= 5; i++) {
    stars += i <= full ? "★" : "☆";
  }
  return stars;
}


function getAiGradeCode(score) {
  score = Number(score) || 0;
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}


function getAiDecisionText(score) {
  score = Number(score) || 0;
  if (score >= 90) return "최우선 확인";
  if (score >= 80) return "적극 검토";
  if (score >= 70) return "조건 협의";
  if (score >= 60) return "현장 확인";
  return "신중 검토";
}


function getAiRiskLevel(score, consCount) {
  score = Number(score) || 0;
  consCount = Number(consCount) || 0;
  if (score >= 85 && consCount <= 2) return "낮음";
  if (score >= 70) return "보통";
  if (score >= 60) return "주의";
  return "높음";
}


function getAiNegotiationTips(item, rentPerPyeong) {
  var tips = [];
  var deposit = Number(item.deposit) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;
  var premium = Number(item.premium) || 0;
  var area = Number(item.area) || 0;

  if (premium > 3000) {
    tips.push("권리금 산정 근거와 최근 매출자료를 요청하고 조정 여지를 확인");
  } else if (premium > 0) {
    tips.push("권리금 포함 집기/시설 범위를 명확히 적고 인수 제외 품목 확인");
  } else {
    tips.push("무권리 조건이라면 원상복구·시설상태를 더 꼼꼼히 확인");
  }

  if (fee > 0) {
    tips.push("관리비 " + formatAiMoney(fee) + "만원에 포함된 항목과 별도 부과 항목 확인");
  }

  if (rentPerPyeong >= 8) {
    tips.push("평당 월비가 높아 월세 또는 렌트프리 협의 가능성 확인");
  } else if (rent > 0) {
    tips.push("월세 조정이 어렵다면 계약기간·렌트프리·시설보수 조건 협의");
  }

  if (deposit >= 5000) {
    tips.push("보증금이 높으므로 감액 또는 월세 전환 조건 비교");
  }

  if (area > 0) {
    tips.push(area + "평 실제 전용면적과 공용면적 차이 확인");
  }

  return tips.slice(0, 4);
}


function getAiFieldCheckList(item, rentPerPyeong) {
  var checks = [];
  var premium = Number(item.premium) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;

  checks.push("점심/저녁 시간대 유동인구와 주변 공실 여부 확인");
  checks.push("간판 위치, 전면 노출, 출입 동선, 주차 조건 확인");

  if (premium > 0) checks.push("권리금 대상 시설물·집기 목록을 사진으로 남기기");
  if (rent > 0 || fee > 0) checks.push("월세·관리비·부가세·공과금 별도 여부 확인");
  if (rentPerPyeong >= 8) checks.push("동일 상권 유사 평수 월세와 비교");
  checks.push("원상복구 범위와 특약 문구 확인");

  return checks.slice(0, 5);
}


function getAiBusinessFitList(item, rentPerPyeong) {
  var area = Number(item.area) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;
  var premium = Number(item.premium) || 0;
  var totalMonthly = rent + fee;
  var text = [item.name, item.address, item.room, item.type, item.memo].join(" ");

  var candidates = [];
  if (area > 0 && area <= 15) {
    candidates = ["테이크아웃", "네일/미용", "무인점포", "소형사무실"];
  } else if (area > 15 && area <= 35) {
    candidates = ["카페", "미용실", "소매점", "공방"];
  } else if (area > 35 && area <= 70) {
    candidates = ["음식점", "학원", "판매점", "사무실"];
  } else if (area > 70) {
    candidates = ["대형식당", "전시장", "학원", "사무실"];
  } else {
    candidates = ["카페", "소매점", "사무실", "공방"];
  }

  if (/사무실/.test(item.type || "")) candidates = ["사무실", "쇼룸", "공방", "학원"];
  if (/음식|식당|주방|배달/i.test(text)) candidates = ["음식점", "배달전문", "카페", "분식"];
  if (/학원|교습|교육/i.test(text)) candidates = ["학원", "교습소", "스터디룸", "사무실"];

  return candidates.map(function(name) {
    var score = 62;
    var reasons = [];

    if (area > 0) {
      if ((name === "테이크아웃" || name === "네일/미용" || name === "무인점포") && area <= 18) {
        score += 14;
        reasons.push("소형 평수 적합");
      }
      if ((name === "카페" || name === "미용실" || name === "소매점" || name === "공방") && area > 15 && area <= 40) {
        score += 12;
        reasons.push("중소형 운영 적합");
      }
      if ((name === "음식점" || name === "학원" || name === "판매점") && area >= 35) {
        score += 10;
        reasons.push("면적 활용 가능");
      }
      if ((name === "사무실" || name === "쇼룸") && area >= 20) {
        score += 8;
        reasons.push("업무공간 구성 가능");
      }
    }

    if (/1층|일층|전면|통유리|대로|메인|코너|사거리/i.test(text)) {
      score += 10;
      reasons.push("노출/접근성 키워드");
    }

    if (/주차|주차가능/i.test(text)) {
      score += 5;
      reasons.push("주차 조건 확인 가치");
    } else if (/주차불가|주차\s*없|협소/i.test(text)) {
      if (name === "음식점" || name === "학원" || name === "대형식당") {
        score -= 8;
        reasons.push("주차 제약 확인");
      }
    }

    if (rentPerPyeong > 0 && rentPerPyeong <= 4) {
      score += 8;
      reasons.push("평당 월비 부담 낮음");
    } else if (rentPerPyeong >= 8) {
      score -= 9;
      reasons.push("평당 월비 높음");
    }

    if (premium === 0) {
      score += 6;
      reasons.push("무권리 진입 가능");
    } else if (premium >= 3000) {
      score -= 6;
      reasons.push("권리금 회수 검토 필요");
    }

    if (totalMonthly > 0 && totalMonthly <= 100) {
      score += 5;
      reasons.push("월고정비 낮음");
    }

    score = clampNumber(score, 30, 96);
    if (reasons.length === 0) reasons.push("현장 조건 확인 후 판단");

    return {
      name: name,
      score: score,
      reason: reasons.slice(0, 2).join(" · ")
    };
  }).sort(function(a, b) {
    return b.score - a.score;
  }).slice(0, 4);
}


function getDongNameFromText(text) {
  var m = String(text || "").match(/([가-힣0-9]+동)/);
  return m ? m[1] : "";
}


function getItemDong(item) {
  return getDongNameFromText([item.address, item.name, item.memo].join(" "));
}


function getFloorGroup(item) {
  var text = [item.room, item.name, item.memo].join(" ");
  if (/지하|\bB\s?\d|B1|비\d/i.test(text)) return "지하";
  if (/1\s*층|일층|1F|1층/.test(text)) return "1층";
  if (/2\s*층|2F|2층/.test(text)) return "2층";
  if (/3\s*층|3F|3층/.test(text)) return "3층";
  if (/4\s*층|4F|4층/.test(text)) return "4층이상";
  if (/5\s*층|6\s*층|7\s*층|8\s*층|9\s*층|10\s*층|[5-9]F|10F/.test(text)) return "4층이상";
  return "층정보없음";
}


function getRentPerAreaValue(item) {
  var area = Number(item.area) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;
  if (area <= 0) return 0;
  return Math.round(((rent + fee) / area) * 10) / 10;
}


function averageNumber(values) {
  var nums = values.map(function(v) { return Number(v) || 0; }).filter(function(v) { return v > 0; });
  if (!nums.length) return 0;
  var sum = nums.reduce(function(a, b) { return a + b; }, 0);
  return Math.round((sum / nums.length) * 10) / 10;
}


function compareLabel(current, avg, unit, lowerIsGood) {
  var diff = percentDiff(current, avg);
  if (!current || !avg) {
    return { text:"비교 데이터 부족", cls:"ai-market-neutral", diff:0 };
  }
  var abs = Math.abs(diff);
  if (abs < 5) {
    return { text:"주변 평균과 비슷", cls:"ai-market-neutral", diff:diff };
  }
  var isLower = diff < 0;
  var good = lowerIsGood ? isLower : !isLower;
  return {
    text:(isLower ? "평균보다 " + abs + "% 낮음" : "평균보다 " + abs + "% 높음"),
    cls:good ? "ai-market-low" : "ai-market-high",
    diff:diff
  };
}


function pickSimilarItemsForMarket(item) {
  var dong = getItemDong(item);
  var floor = getFloorGroup(item);
  var area = Number(item.area) || 0;
  var type = item.type || "";
  var candidates = allItems.filter(function(other) {
    if (!other || other.key === item.key) return false;
    if (isDone(other)) return false;
    if (dong && getItemDong(other) !== dong) return false;
    if (type && other.type && other.type !== type) return false;
    return true;
  });

  var stage = "같은 동";
  var filtered = candidates.slice();

  if (floor && floor !== "층정보없음") {
    var byFloor = filtered.filter(function(other) { return getFloorGroup(other) === floor; });
    if (byFloor.length >= 3) {
      filtered = byFloor;
      stage += " · 같은 층";
    }
  }

  if (area > 0) {
    var minArea = area * 0.7;
    var maxArea = area * 1.3;
    var byArea = filtered.filter(function(other) {
      var a = Number(other.area) || 0;
      return a > 0 && a >= minArea && a <= maxArea;
    });
    if (byArea.length >= 3) {
      filtered = byArea;
      stage += " · 비슷한 평수";
    }
  }

  if (filtered.length < 3 && candidates.length >= 3) {
    filtered = candidates;
    stage = dong ? "같은 동 전체" : "전체 유사매물";
  }

  return { items:filtered, stage:stage, dong:dong, floor:floor };
}


function getMarketAnalysis(item) {
  var similar = pickSimilarItemsForMarket(item);
  var items = similar.items || [];
  var currentRentPerArea = getRentPerAreaValue(item);
  var currentPremium = Number(item.premium) || 0;
  var currentFee = Number(item.fee) || 0;
  var currentDeposit = Number(item.deposit) || 0;
  var currentStart = currentDeposit + currentPremium;

  var avgRentPerArea = averageNumber(items.map(getRentPerAreaValue));
  var avgPremium = averageNumber(items.map(function(v) { return v.premium; }));
  var avgFee = averageNumber(items.map(function(v) { return v.fee; }));
  var avgStart = averageNumber(items.map(function(v) { return (Number(v.deposit) || 0) + (Number(v.premium) || 0); }));

  var rentCompare = compareLabel(currentRentPerArea, avgRentPerArea, "만", true);
  var premiumCompare = compareLabel(currentPremium, avgPremium, "만", true);
  var feeCompare = compareLabel(currentFee, avgFee, "만", true);
  var startCompare = compareLabel(currentStart, avgStart, "만", true);

  var briefs = [];
  if (items.length < 3) {
    briefs.push("비교 가능한 유사 매물이 적어 참고용으로만 확인하세요.");
  } else {
    briefs.push((similar.dong || "현재 권역") + " 기준 유사 매물 " + items.length + "건과 비교했습니다.");
  }

  if (rentCompare.diff <= -10) briefs.push("평당월비가 주변보다 낮아 임차인 유치나 업종 운영 측면에서 경쟁력이 있습니다.");
  else if (rentCompare.diff >= 10) briefs.push("평당월비가 주변보다 높아 예상 매출과 월세 부담을 보수적으로 확인해야 합니다.");

  if (premiumCompare.diff <= -15) briefs.push("권리금이 주변보다 낮아 초기 진입비용 협상력이 좋습니다.");
  else if (premiumCompare.diff >= 15) briefs.push("권리금이 주변보다 높아 시설·매출·입지 근거 확인이 필요합니다.");

  if (startCompare.diff <= -12) briefs.push("보증금+권리금 기준 초기비용이 주변보다 낮은 편입니다.");
  else if (startCompare.diff >= 12) briefs.push("초기비용이 주변보다 높아 회수기간을 반드시 계산해야 합니다.");

  if (hasText(item, /코너|사거리|대로|큰길|전면|통유리|유동/i)) {
    briefs.push("메모상 노출·코너·대로변 키워드가 있어 현장 유동과 간판 위치 확인 가치가 큽니다.");
  }

  if (briefs.length === 1) briefs.push("평당월비·권리금·관리비를 함께 비교해 협상 우선순위를 잡는 것이 좋습니다.");

  return {
    count: items.length,
    scope: similar.stage,
    dong: similar.dong,
    floor: similar.floor,
    currentRentPerArea: currentRentPerArea,
    avgRentPerArea: avgRentPerArea,
    rentCompare: rentCompare,
    currentPremium: currentPremium,
    avgPremium: avgPremium,
    premiumCompare: premiumCompare,
    currentFee: currentFee,
    avgFee: avgFee,
    feeCompare: feeCompare,
    currentStart: currentStart,
    avgStart: avgStart,
    startCompare: startCompare,
    briefs: briefs.slice(0, 5)
  };
}


function marketValueText(value, suffix) {
  value = Number(value) || 0;
  if (!value) return "-";
  return formatAiMoney(value) + (suffix || "");
}


function buildMarketCompareItem(label, current, avg, compare, suffix) {
  return '' +
    '<div class="ai-market-item">' +
      '<div class="ai-market-label">' + escapeHtml(label) + '</div>' +
      '<div class="ai-market-value">' + escapeHtml(marketValueText(current, suffix)) + '</div>' +
      '<div class="ai-market-compare ' + compare.cls + '">주변평균 ' + escapeHtml(marketValueText(avg, suffix)) + ' · ' + escapeHtml(compare.text) + '</div>' +
    '</div>';
}


function buildMarketAnalysisHtml(market) {
  if (!market) return "";
  var summary = market.count >= 3
    ? (market.scope + " 기준 " + market.count + "건 비교")
    : "유사 매물 데이터가 부족해 참고 분석으로 표시합니다.";

  return '' +
    '<div class="ai-section full ai-market-section">' +
      '<div class="ai-section-title">AI 시장분석 브리핑</div>' +
      '<div class="ai-market-summary">' + escapeHtml(summary) + '</div>' +
      '<div class="ai-market-grid">' +
        buildMarketCompareItem('평당월비', market.currentRentPerArea, market.avgRentPerArea, market.rentCompare, '만') +
        buildMarketCompareItem('권리금', market.currentPremium, market.avgPremium, market.premiumCompare, '만') +
        buildMarketCompareItem('관리비', market.currentFee, market.avgFee, market.feeCompare, '만') +
        buildMarketCompareItem('초기비용', market.currentStart, market.avgStart, market.startCompare, '만') +
      '</div>' +
      '<ul class="ai-market-brief">' + buildAiList(market.briefs) + '</ul>' +
    '</div>';
}


function buildMarketAnalysisText(market) {
  if (!market) return "";
  return [
    "AI 시장분석: " + (market.count >= 3 ? market.scope + " 기준 " + market.count + "건 비교" : "유사 매물 데이터 부족 / 참고 분석"),
    "- 평당월비: 현재 " + marketValueText(market.currentRentPerArea, "만") + " / 평균 " + marketValueText(market.avgRentPerArea, "만") + " / " + market.rentCompare.text,
    "- 권리금: 현재 " + marketValueText(market.currentPremium, "만") + " / 평균 " + marketValueText(market.avgPremium, "만") + " / " + market.premiumCompare.text,
    "- 관리비: 현재 " + marketValueText(market.currentFee, "만") + " / 평균 " + marketValueText(market.avgFee, "만") + " / " + market.feeCompare.text,
    "- 초기비용: 현재 " + marketValueText(market.currentStart, "만") + " / 평균 " + marketValueText(market.avgStart, "만") + " / " + market.startCompare.text,
    "- 브리핑: " + market.briefs.join(" | ")
  ].join("\n");
}


function getCommercialBoxId(item) {
  var raw = String((item && item.key) || "");
  var hash = 0;
  for (var i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash = hash & hash;
  }
  return "aiCommerce_" + Math.abs(hash);
}


function getCommercialCacheKey(item) {
  if (!item || !item.latlng) return "";
  var lat = typeof item.latlng.getLat === "function" ? item.latlng.getLat() : "";
  var lng = typeof item.latlng.getLng === "function" ? item.latlng.getLng() : "";
  return [item.key || "", lat, lng, commercialRadius].join("|");
}


function flattenCommercialSearchItems() {
  var out = [];
  commercialSearchGroups.forEach(function(group) {
    group.items.forEach(function(item) {
      out.push({ group: group.group, key: item.key, label: item.label, keyword: item.keyword });
    });
  });
  return out;
}


function searchPlaceCount(keyword, latlng, callback) {
  if (!window.kakao || !kakao.maps || !kakao.maps.services || !kakao.maps.services.Places || !latlng) {
    callback(0, []);
    return;
  }

  var ps = new kakao.maps.services.Places();
  ps.keywordSearch(keyword, function(data, status, pagination) {
    if (status === kakao.maps.services.Status.OK) {
      var count = 0;
      if (pagination && typeof pagination.totalCount === "number") {
        count = pagination.totalCount;
      } else if (data && data.length) {
        count = data.length;
      }
      callback(count, data || []);
      return;
    }
    callback(0, []);
  }, {
    location: latlng,
    radius: commercialRadius,
    sort: kakao.maps.services.SortBy.DISTANCE
  });
}


function analyzeCommercialArea(item, callback) {
  var cacheKey = getCommercialCacheKey(item);
  if (!item || !item.latlng) {
    callback({ available:false, reason:"좌표 정보가 없어 상권분석을 할 수 없습니다." });
    return;
  }

  if (cacheKey && commercialAnalysisCache[cacheKey]) {
    callback(commercialAnalysisCache[cacheKey]);
    return;
  }

  var tasks = flattenCommercialSearchItems();
  var index = 0;
  var counts = {};
  var labels = {};
  var groups = {};

  tasks.forEach(function(t) {
    counts[t.key] = 0;
    labels[t.key] = t.label;
    if (!groups[t.group]) groups[t.group] = [];
    groups[t.group].push(t.key);
  });

  function next() {
    if (index >= tasks.length) {
      var analysis = buildCommercialAnalysisResult(item, counts, labels, groups);
      if (cacheKey) commercialAnalysisCache[cacheKey] = analysis;
      callback(analysis);
      return;
    }

    var task = tasks[index++];
    searchPlaceCount(task.keyword, item.latlng, function(count) {
      counts[task.key] = count;
      // 카카오 API 호출 간격을 조금 둬서 브라우저/API 부담을 줄임
      setTimeout(next, 90);
    });
  }

  next();
}


function commercialCount(counts, key) {
  return Number(counts[key]) || 0;
}


function buildCommercialAnalysisResult(item, counts, labels, groups) {
  var foodTotal = ["korean","chinese","japanese","snack","chicken","pizza","burger","beer","meat","gukbap","bakery","dessert"].reduce(function(sum, key) { return sum + commercialCount(counts, key); }, 0);
  var beautyTotal = ["hair","nail","eyelash","skin","waxing","massage","makeup"].reduce(function(sum, key) { return sum + commercialCount(counts, key); }, 0);
  var educationTotal = ["academy","english","math","taekwondo","piano","art","study"].reduce(function(sum, key) { return sum + commercialCount(counts, key); }, 0);
  var medicalTotal = ["hospital","dental","pharmacy","oriental"].reduce(function(sum, key) { return sum + commercialCount(counts, key); }, 0);

  var recommendations = [];
  function addRec(name, score, reason) {
    recommendations.push({ name:name, score:clampNumber(score, 30, 99), reason:reason });
  }

  var convenience = commercialCount(counts, "convenience");
  var cafe = commercialCount(counts, "cafe");
  var nail = commercialCount(counts, "nail");
  var hair = commercialCount(counts, "hair");
  var japanese = commercialCount(counts, "japanese");
  var chinese = commercialCount(counts, "chinese");
  var snack = commercialCount(counts, "snack");
  var dessert = commercialCount(counts, "dessert");
  var bakery = commercialCount(counts, "bakery");
  var pharmacy = commercialCount(counts, "pharmacy");
  var hospital = commercialCount(counts, "hospital");
  var bus = commercialCount(counts, "bus");

  if (convenience === 0) addRec("편의점", 96, "선택 반경 내 편의점 경쟁이 거의 없습니다.");
  else if (convenience <= 1) addRec("편의점", 86, "편의점 경쟁이 적은 편입니다.");

  if (beautyTotal >= 5 && nail <= 1) addRec("네일샵", 90, "미용실·뷰티 수요는 보이지만 네일샵 경쟁은 적습니다.");
  if (hair >= 6 && commercialCount(counts, "eyelash") <= 1) addRec("속눈썹/뷰티샵", 84, "미용실 기반 뷰티 상권에서 세부 업종 공백이 있습니다.");

  if (foodTotal >= 15 && japanese <= 1) addRec("일식/덮밥", 86, "음식 수요는 강한데 일식 경쟁이 적습니다.");
  if (foodTotal >= 15 && chinese <= 1) addRec("중식/마라/면요리", 82, "음식점 밀집 대비 중식 계열 경쟁이 낮습니다.");
  if (educationTotal >= 8 && snack <= 2) addRec("분식/테이크아웃", 84, "학원가 수요 대비 간편식 업종이 부족합니다.");
  if (cafe >= 8 && dessert <= 2 && bakery <= 2) addRec("디저트/베이커리", 83, "카페 수요는 있으나 디저트 전문 경쟁은 낮은 편입니다.");

  if (medicalTotal >= 5 && pharmacy <= 1) addRec("약국", 88, "병원·의료 수요 대비 약국 경쟁이 낮습니다.");
  if (bus >= 3 && convenience <= 1) addRec("무인매장/편의형 소매", 80, "버스정류장 접근성과 생활수요를 활용할 수 있습니다.");

  if (recommendations.length === 0) {
    addRec("현장형 업종 검토", 70, "뚜렷한 공백 업종은 적어 유동·간판·전면 조건 확인이 우선입니다.");
  }

  recommendations.sort(function(a, b) { return b.score - a.score; });

  var briefs = [];
  if (foodTotal >= 20) briefs.push("음식점 밀집도가 높아 식사·야간 수요가 있는 상권으로 보입니다.");
  else if (foodTotal >= 8) briefs.push("음식점 수요가 어느 정도 형성된 생활상권입니다.");

  if (educationTotal >= 8) briefs.push("학원·교육 업종이 많아 학생/학부모 동선 활용 업종을 검토할 수 있습니다.");
  if (beautyTotal >= 6) briefs.push("미용실·뷰티 업종이 많아 뷰티 수요는 있으나 경쟁도 함께 확인해야 합니다.");
  if (convenience === 0) briefs.push("편의점이 거의 없어 코너/대로변 조건이 맞으면 편의점 검토 가치가 큽니다.");
  if (cafe >= 12) briefs.push("카페 경쟁은 높은 편이므로 일반 카페보다 디저트·테이크아웃 차별화가 유리합니다.");
  if (medicalTotal >= 5) briefs.push("의료·약국 수요가 있는 상권으로 보이며 대기수요 업종을 검토할 수 있습니다.");
  if (briefs.length === 0) briefs.push("반경 300m 상권 데이터는 수집됐지만, 현장 유동·전면·주차 조건 확인이 필요합니다.");

  var blueOceans = [];
  function addBlue(key, name, reason) {
    var c = commercialCount(counts, key);
    if (c <= 1) blueOceans.push({ name:name, count:c, reason:reason });
  }
  addBlue("convenience", "편의점", "생활·음식 수요 대비 경쟁이 적음");
  addBlue("japanese", "일식/덮밥", "음식 상권 내 세부 경쟁이 낮음");
  addBlue("nail", "네일샵", "뷰티 수요 대비 세부 업종 공백 가능");
  addBlue("eyelash", "속눈썹", "미용실 주변 연계수요 활용 가능");
  addBlue("dessert", "디저트", "카페 수요 대비 디저트 전문점 부족 가능");
  addBlue("pharmacy", "약국", "의료시설 대비 약국 경쟁이 낮음");

  var saturated = [];
  function addHot(key, name, limit) {
    var c = commercialCount(counts, key);
    if (c >= limit) saturated.push({ name:name, count:c });
  }
  addHot("cafe", "카페", 12);
  addHot("hair", "미용실", 10);
  addHot("korean", "한식", 10);
  addHot("academy", "학원", 10);
  addHot("beer", "호프", 8);

  var topScore = recommendations.length ? recommendations[0].score : 70;
  var successScore = topScore;
  if (commercialCount(counts, "bus") >= 2) successScore += 3;
  if (foodTotal >= 12) successScore += 2;
  if (educationTotal >= 8) successScore += 2;
  if (saturated.length >= 3) successScore -= 5;
  successScore = clampNumber(successScore, 35, 98);

  var successLabel = "보통";
  if (successScore >= 90) successLabel = "매우 높음";
  else if (successScore >= 80) successLabel = "높음";
  else if (successScore >= 70) successLabel = "양호";
  else if (successScore < 60) successLabel = "신중";

  if (blueOceans.length > 0) {
    briefs.unshift("블루오션 후보: " + blueOceans.slice(0, 3).map(function(x) { return x.name + "(" + x.count + "개)"; }).join(" / ") + " 업종은 경쟁이 낮아 우선 검토 가치가 있습니다.");
  }
  if (saturated.length > 0) {
    briefs.push("포화주의 업종: " + saturated.slice(0, 3).map(function(x) { return x.name + "(" + x.count + "개)"; }).join(" / ") + " 계열은 차별화 전략이 필요합니다.");
  }

  return {
    available:true,
    radius: commercialRadius,
    counts: counts,
    labels: labels,
    groups: groups,
    totals: {
      food: foodTotal,
      beauty: beautyTotal,
      education: educationTotal,
      medical: medicalTotal
    },
    recommendations: recommendations.slice(0, 5),
    blueOceans: blueOceans.slice(0, 5),
    saturated: saturated.slice(0, 5),
    successScore: successScore,
    successLabel: successLabel,
    briefs: briefs.slice(0, 7)
  };
}


function buildCommercialAnalysisHtml(analysis) {
  if (!analysis) {
    return '<div class="ai-commerce-loading">상권분석 데이터를 준비중입니다.</div>';
  }
  if (!analysis.available) {
    return '<div class="ai-commerce-loading">' + escapeHtml(analysis.reason || "상권분석을 불러오지 못했습니다.") + '</div>';
  }

  var recHtml = analysis.recommendations.map(function(rec) {
    return '<li><b>' + escapeHtml(rec.name) + ' ' + rec.score + '점</b> · ' + escapeHtml(rec.reason) + '</li>';
  }).join("");

  return '' +
    buildRadiusTabs() +
    '<div class="ai-commerce-summary">반경 ' + analysis.radius + 'm 기준 카카오 Places 검색 결과입니다. 실제 폐업/신규점포는 현장 확인이 필요합니다.</div>' +
    '<div class="ai-commerce-grid">' +
      '<div class="ai-commerce-block"><div class="ai-commerce-block-title">생활/교통</div><div class="ai-commerce-chip-wrap">' + buildCommerceChips(analysis, "생활") + '</div></div>' +
      '<div class="ai-commerce-block"><div class="ai-commerce-block-title">음식 상세</div><div class="ai-commerce-chip-wrap">' + buildCommerceChips(analysis, "음식", 10) + '</div></div>' +
      '<div class="ai-commerce-block"><div class="ai-commerce-block-title">뷰티 상세</div><div class="ai-commerce-chip-wrap">' + buildCommerceChips(analysis, "뷰티") + '</div></div>' +
      '<div class="ai-commerce-block"><div class="ai-commerce-block-title">교육/의료</div><div class="ai-commerce-chip-wrap">' + buildCommerceChips(analysis, "교육/의료") + '</div></div>' +
    '</div>' +
    buildOpportunityHtml(analysis) +
    '<div class="ai-commerce-recommend"><div class="ai-commerce-recommend-title">AI 추천업종 후보</div><ol>' + recHtml + '</ol></div>' +
    '<ul class="ai-commerce-brief">' + buildAiList(analysis.briefs) + '</ul>';
}


function buildCommercialAnalysisText(analysis) {
  if (!analysis || !analysis.available) return "AI 상권분석: 데이터 없음";
  var lines = ["AI 상권분석: 반경 " + analysis.radius + "m"];
  ["생활","음식","뷰티","교육/의료"].forEach(function(groupName) {
    var keys = (analysis.groups[groupName] || []);
    var parts = keys.map(function(key) {
      return (analysis.labels[key] || key) + " " + commercialCount(analysis.counts, key);
    });
    lines.push("- " + groupName + ": " + parts.join(" / "));
  });
  lines.push("- 추천업종: " + analysis.recommendations.map(function(r) { return r.name + " " + r.score + "점(" + r.reason + ")"; }).join(" | "));
  lines.push("- 예상 성공가능성: " + (analysis.successScore || "-") + "점 / " + (analysis.successLabel || "보통"));
  lines.push("- 블루오션 후보: " + ((analysis.blueOceans || []).map(function(x) { return x.name + " " + x.count + "개"; }).join(" / ") || "뚜렷한 후보 없음"));
  lines.push("- 포화주의 업종: " + ((analysis.saturated || []).map(function(x) { return x.name + " " + x.count + "개"; }).join(" / ") || "낮음"));
  lines.push("- 브리핑: " + analysis.briefs.join(" | "));
  return lines.join("\n");
}


function loadCommercialAreaAnalysis(item) {
  var boxId = getCommercialBoxId(item);
  var box = document.getElementById(boxId);
  if (!box) return;

  box.innerHTML = buildRadiusTabs() + '<div class="ai-commerce-loading">카카오 Places로 반경 ' + commercialRadius + 'm 상권을 분석중입니다...<br>편의점·음식점·뷰티샵·학원·병원 등을 순차 검색합니다.</div>';

  analyzeCommercialArea(item, function(analysis) {
    var target = document.getElementById(boxId);
    if (!target) return;
    target.innerHTML = buildCommercialAnalysisHtml(analysis);
  });
}


function getSmartItemAnalysis(item) {
  var score = 62;
  var pros = [];
  var cons = [];
  var tags = [];
  var businesses = [];

  var deposit = Number(item.deposit) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;
  var premium = Number(item.premium) || 0;
  var area = Number(item.area) || 0;
  var totalMonthly = rent + fee;
  var rentPerPyeong = area > 0 ? Math.round((totalMonthly / area) * 10) / 10 : 0;

  if (isDone(item)) {
    score -= 35;
    cons.push("계약완료 상태라 현재 검토 우선순위가 낮음");
  } else {
    score += 5;
    pros.push("현재 계약 가능 상태로 보임");
  }

  if (rent > 0) {
    score += 5;
    pros.push("월세 정보가 있어 수익성 판단 가능");
  } else {
    cons.push("월세 정보가 없어 수익성 판단이 제한됨");
  }

  if (area > 0) {
    score += 4;
    pros.push(area + "평 규모로 면적 확인 가능");
  } else {
    cons.push("평수 정보가 없어 업종 적합성 판단이 어려움");
  }

  if (premium === 0) {
    score += 12;
    pros.push("권리금이 없거나 0으로 보여 진입 부담이 낮음");
  } else if (premium > 0 && premium <= 1000) {
    score += 8;
    pros.push("권리금 " + formatAiMoney(premium) + "만원 수준으로 비교적 부담이 낮음");
  } else if (premium > 3000) {
    score -= 8;
    cons.push("권리금 " + formatAiMoney(premium) + "만원으로 초기 부담 확인 필요");
  }

  if (deposit > 0 && deposit <= 2000) {
    score += 5;
    pros.push("보증금 부담이 비교적 낮은 편");
  } else if (deposit >= 5000) {
    score -= 4;
    cons.push("보증금이 높아 초기 자금 부담 확인 필요");
  }

  if (fee > 0 && rent > 0 && fee >= rent * 0.2) {
    score -= 5;
    cons.push("관리비 비중이 높아 실제 월 고정비 확인 필요");
  }

  if (rentPerPyeong > 0) {
    tags.push("평당월비 " + rentPerPyeong + "만");
    if (rentPerPyeong <= 4) {
      score += 6;
      pros.push("평당 월비가 낮아 가성비 검토 가치 있음");
    } else if (rentPerPyeong >= 8) {
      score -= 5;
      cons.push("평당 월비가 높은 편이라 매출 가능성 확인 필요");
    }
  }

  if (hasText(item, /대로|큰길|코너|역세권|유동|메인|사거리|버스|전면/i)) {
    score += 8;
    pros.push("입지 키워드가 좋아 노출/유동 가능성이 있음");
    tags.push("입지우수");
  }

  if (hasText(item, /주차불가|주차\s*없|협소/i)) {
    score -= 6;
    cons.push("주차 조건은 현장 확인 필요");
  } else if (hasText(item, /주차|주차가능/i)) {
    score += 4;
    pros.push("주차 관련 장점이 있을 가능성");
    tags.push("주차확인");
  }

  if (hasText(item, /1층|일층|전면|통유리/i)) {
    score += 6;
    pros.push("1층/전면 키워드가 있어 접근성 검토 가치 있음");
    tags.push("접근성");
  }

  if (area > 0) {
    if (area <= 15) businesses = ["테이크아웃", "소형사무실", "네일/미용"];
    else if (area <= 35) businesses = ["카페", "미용실", "소매점"];
    else if (area <= 70) businesses = ["음식점", "학원", "판매점"];
    else businesses = ["대형식당", "전시장", "사무실"];
  } else {
    businesses = ["카페", "사무실", "소매점"];
  }

  if (/상가|점포|가게/.test(item.type || "")) tags.push("상가");
  if (/사무실/.test(item.type || "")) businesses = ["사무실", "공방", "쇼룸"];
  if (rent > 0 && totalMonthly <= 100) tags.push("월고정비낮음");
  if (premium === 0) tags.push("무권리검토");
  if (isFavorite(item)) tags.push("찜매물");

  if (pros.length === 0) pros.push("기본 정보 기준으로 추가 현장 확인 추천");
  if (cons.length === 0) cons.push("큰 약점은 보이지 않으나 권리관계/현장상태 확인 필요");
  if (tags.length === 0) tags.push("기본검토");

  score = clampNumber(score, 10, 98);

  var grade = "보통";
  if (score >= 85) grade = "강력검토";
  else if (score >= 75) grade = "검토추천";
  else if (score >= 60) grade = "보통";
  else grade = "주의";

  var oneLine = "";
  if (score >= 85) oneLine = "조건이 좋아 우선 확인할 만한 매물입니다.";
  else if (score >= 75) oneLine = "가격과 입지 조건을 함께 비교해볼 만한 매물입니다.";
  else if (score >= 60) oneLine = "기본 검토는 가능하지만 현장 확인이 필요합니다.";
  else oneLine = "조건 확인 전까지는 신중하게 접근하는 것이 좋습니다.";

  var gradeCode = getAiGradeCode(score);
  var stars = buildStarRating(score);
  var decision = getAiDecisionText(score);
  var riskLevel = getAiRiskLevel(score, cons.length);
  var negotiationTips = getAiNegotiationTips(item, rentPerPyeong);
  var fieldChecks = getAiFieldCheckList(item, rentPerPyeong);
  var businessFits = getAiBusinessFitList(item, rentPerPyeong);
  var marketAnalysis = getMarketAnalysis(item);

  return {
    score: score,
    grade: grade,
    gradeCode: gradeCode,
    stars: stars,
    decision: decision,
    riskLevel: riskLevel,
    oneLine: oneLine,
    pros: pros.slice(0, 4),
    cons: cons.slice(0, 4),
    businesses: businesses.slice(0, 4),
    tags: tags.slice(0, 5),
    negotiationTips: negotiationTips,
    fieldChecks: fieldChecks,
    businessFits: businessFits,
    marketAnalysis: marketAnalysis
  };
}


function buildAiList(items) {
  return items.map(function(text) {
    return "<li>" + escapeHtml(text) + "</li>";
  }).join("");
}


function buildAiTags(items) {
  return items.map(function(text) {
    return '<span class="ai-tag">' + escapeHtml(text) + '</span>';
  }).join("");
}


function getAiBusinessVerdict(score) {
  if (score >= 85) return "강력추천";
  if (score >= 75) return "추천";
  if (score >= 65) return "보통";
  if (score >= 55) return "주의";
  return "비추천";
}


function buildAiBusinessSummary(items) {
  if (!items || items.length === 0) return "업종 후보를 계산할 수 없습니다.";
  var top = items[0];
  return "가장 적합한 업종은 " + top.name + "입니다. " + top.reason + " 기준으로 " + top.score + "점으로 평가됩니다.";
}


function buildAiBusinessFitHtml(items) {
  if (!items || items.length === 0) {
    return '<div class="ai-business-summary">업종별 적합도 정보가 없습니다. 평수, 월세, 메모를 보완하면 더 정확해집니다.</div>';
  }

  var html = '<div class="ai-business-fit-strong">' +
    '<div class="ai-business-summary">' + escapeHtml(buildAiBusinessSummary(items)) + '</div>';

  html += items.map(function(item) {
    var width = clampNumber(item.score, 0, 100);
    var verdict = getAiBusinessVerdict(item.score);
    return '' +
      '<div class="ai-business-row-strong">' +
        '<div class="ai-business-row-top">' +
          '<div class="ai-business-name-strong">' + escapeHtml(item.name) + '<span class="ai-business-verdict">' + escapeHtml(verdict) + '</span></div>' +
          '<div class="ai-business-score-strong">' + item.score + '점</div>' +
        '</div>' +
        '<div class="ai-business-bar-strong"><div class="ai-business-bar-fill-strong" style="width:' + width + '%"></div></div>' +
        '<div class="ai-business-reason-strong"><b>추천사유</b> · ' + escapeHtml(item.reason) + '</div>' +
      '</div>';
  }).join("");

  html += '</div>';
  return html;
}


function buildSmartItemCardHtml(item) {
  var ai = getSmartItemAnalysis(item);
  var deposit = Number(item.deposit) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;
  var premium = Number(item.premium) || 0;
  var area = Number(item.area) || 0;
  var totalMonthly = rent + fee;
  var startMoney = deposit + premium;
  var rentPerArea = area > 0 ? Math.round((totalMonthly / area) * 10) / 10 : 0;
  var encodedKey = encodeURIComponent(item.key || "");

  return '' +
    '<div class="ai-card" onclick="event.stopPropagation();">' +
      '<div class="ai-card-header">' +
        '<div class="ai-card-title">🤖 AI 스마트 매물카드</div>' +
        '<div class="ai-card-badge">' + escapeHtml(ai.grade) + '</div>' +
      '</div>' +
      '<div class="ai-score-wrap">' +
        '<div class="ai-score"><strong>' + ai.score + '</strong><span>투자점수</span></div>' +
        '<div class="ai-summary">' + escapeHtml(ai.oneLine) + '<br>보증금 ' + formatAiMoney(deposit) + ' / 월세 ' + formatAiMoney(rent) + ' / 권리금 ' + formatAiMoney(premium) + '</div>' +
      '</div>' +
      '<div class="ai-decision-row">' +
        '<div class="ai-decision-card"><strong class="ai-grade-' + String(ai.gradeCode).toLowerCase() + '">' + ai.gradeCode + '등급</strong><span>투자등급</span></div>' +
        '<div class="ai-decision-card"><strong>' + escapeHtml(ai.decision) + '</strong><span>AI판단</span></div>' +
        '<div class="ai-decision-card"><strong class="ai-stars">' + ai.stars + '</strong><span>추천도</span></div>' +
      '</div>' +
      '<div class="ai-metrics">' +
        '<div class="ai-metric"><strong>' + formatAiMoney(startMoney) + '</strong><span>초기비용</span></div>' +
        '<div class="ai-metric"><strong>' + formatAiMoney(totalMonthly) + '</strong><span>월고정비</span></div>' +
        '<div class="ai-metric"><strong>' + (rentPerArea ? rentPerArea : '-') + '</strong><span>평당월비</span></div>' +
        '<div class="ai-metric"><strong>' + (area ? area + '평' : '-') + '</strong><span>면적</span></div>' +
      '</div>' +
      '<div class="ai-grid">' +
        '<div class="ai-section"><div class="ai-section-title">장점</div><ul class="ai-list">' + buildAiList(ai.pros) + '</ul></div>' +
        '<div class="ai-section"><div class="ai-section-title">주의점</div><ul class="ai-list">' + buildAiList(ai.cons) + '</ul></div>' +
        '<div class="ai-section"><div class="ai-section-title">추천업종</div><div class="ai-tags">' + buildAiTags(ai.businesses) + '</div></div>' +
        '<div class="ai-section"><div class="ai-section-title">키워드</div><div class="ai-tags">' + buildAiTags(ai.tags) + '</div></div>' +
        buildMarketAnalysisHtml(ai.marketAnalysis) +
        '<div class="ai-section full ai-commerce-section"><div class="ai-section-title">AI 상권분석 반경 선택</div><div id="' + getCommercialBoxId(item) + '"><div class="ai-commerce-loading">상권분석 준비중...</div></div></div>' +
        '<div class="ai-section full"><div class="ai-section-title">업종별 적합도 / 추천사유</div><div class="ai-business-fit">' + buildAiBusinessFitHtml(ai.businessFits) + '</div></div>' +
        '<div class="ai-section full ai-alert-section"><div class="ai-section-title">현장체크</div><ul class="ai-list ai-action-list">' + buildAiList(ai.fieldChecks) + '</ul></div>' +
        '<div class="ai-section full ai-negotiation-section"><div class="ai-section-title">협상포인트</div><ul class="ai-list ai-action-list">' + buildAiList(ai.negotiationTips) + '</ul></div>' +
      '</div>' +
      '<div class="ai-card-actions">' +
        '<button class="ai-copy-btn" onclick="event.stopPropagation(); copySmartItemAnalysis(\'' + encodedKey + '\')">AI분석 복사</button>' +
      '</div>' +
      '<div class="ai-note">※ 현재 입력된 매물정보와 메모 키워드를 바탕으로 한 보조 분석입니다. 최종 판단은 현장 확인과 계약 조건 확인 후 진행하세요.</div>' +
    '</div>';
}


function getItemByEncodedKey(encodedKey) {
  var key = decodeURIComponent(encodedKey || "");
  return allItems.find(function(item) {
    return item.key === key;
  }) || visibleListItems.find(function(item) {
    return item.key === key;
  }) || null;
}


function buildSmartItemAnalysisText(item) {
  var ai = getSmartItemAnalysis(item);
  var deposit = Number(item.deposit) || 0;
  var rent = Number(item.rent) || 0;
  var fee = Number(item.fee) || 0;
  var premium = Number(item.premium) || 0;
  var area = Number(item.area) || 0;
  var totalMonthly = rent + fee;
  var startMoney = deposit + premium;
  var rentPerArea = area > 0 ? Math.round((totalMonthly / area) * 10) / 10 : 0;

  return [
    "[JS부동산 AI 스마트 매물카드]",
    "매물: " + [item.name, item.address, item.room].filter(Boolean).join(" / "),
    "투자점수: " + ai.score + "점 (" + ai.gradeCode + "등급 / " + ai.grade + ")",
    "AI판단: " + ai.decision + " / 추천도 " + ai.stars + " / 위험도 " + ai.riskLevel,
    "한줄평: " + ai.oneLine,
    "금액: 보증금 " + formatAiMoney(deposit) + " / 월세 " + formatAiMoney(rent) + " / 관리비 " + formatAiMoney(fee) + " / 권리금 " + formatAiMoney(premium),
    "핵심지표: 초기비용 " + formatAiMoney(startMoney) + " / 월고정비 " + formatAiMoney(totalMonthly) + " / 평당월비 " + (rentPerArea || "-") + " / 면적 " + (area ? area + "평" : "-"),
    buildMarketAnalysisText(ai.marketAnalysis),
    buildCommercialAnalysisText(commercialAnalysisCache[getCommercialCacheKey(item)]),
    "장점: " + ai.pros.join(" | "),
    "주의점: " + ai.cons.join(" | "),
    "추천업종: " + ai.businesses.join(" | "),
    "업종별 적합도: " + ai.businessFits.map(function(v) { return v.name + " " + v.score + "점(" + v.reason + ")"; }).join(" | "),
    "키워드: " + ai.tags.join(" | "),
    "현장체크: " + ai.fieldChecks.join(" | "),
    "협상포인트: " + ai.negotiationTips.join(" | ")
  ].join("\n");
}


function copySmartItemAnalysis(encodedKey) {
  var item = getItemByEncodedKey(encodedKey);
  if (!item) {
    alert("복사할 매물을 찾지 못했습니다.");
    return;
  }

  var text = buildSmartItemAnalysisText(item);

  function done() {
    alert("AI 분석 내용을 복사했습니다.");
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function() {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }
}


function enhanceCommercialUI() {
  var selected = document.querySelector(".item.selected");
  if (!selected) return;

  // 0개 → 없음 표시
  selected.querySelectorAll("*").forEach(function(el) {
    if (el.children.length === 0 && el.innerText) {
      el.innerText = el.innerText.replace(/0개/g, "없음");
    }
  });

  // 반경 버튼 강조
  selected.querySelectorAll("button").forEach(function(btn) {
    var t = btn.innerText || "";
    if (/50m|100m|200m|300m|500m/.test(t)) {
      btn.classList.add("radius-clean-btn");

      btn.onclick = (function(oldClick) {
        return function(e) {
          selected.querySelectorAll(".radius-clean-btn").forEach(function(b) {
            b.classList.remove("radius-active");
          });
          btn.classList.add("radius-active");
          if (oldClick) oldClick.call(this, e);
        };
      })(btn.onclick);
    }
  });

  // 상권분석 박스 제목 강화
  selected.querySelectorAll("*").forEach(function(el) {
    if ((el.innerText || "").includes("AI 상권분석") && !el.classList.contains("commercial-title-done")) {
      el.classList.add("commercial-title-done");
      el.style.fontWeight = "900";
      el.style.color = "#005bea";
      el.style.fontSize = "15px";
    }
  });

  // 블루오션/포화주의 시각 강화
  selected.querySelectorAll("*").forEach(function(el) {
    var txt = el.innerText || "";

    if (txt.includes("블루오션") && !el.classList.contains("blue-ocean-mark")) {
      el.classList.add("blue-ocean-mark");
      el.style.background = "#eefaf2";
      el.style.border = "1px solid #b7ebc6";
      el.style.borderRadius = "10px";
      el.style.padding = "8px";
      el.style.marginTop = "6px";
    }

    if (txt.includes("포화") && !el.classList.contains("saturation-mark")) {
      el.classList.add("saturation-mark");
      el.style.background = "#fff7e6";
      el.style.border = "1px solid #ffd591";
      el.style.borderRadius = "10px";
      el.style.padding = "8px";
      el.style.marginTop = "6px";
    }
  });
}


function injectCommercialUIStyle() {
  if (document.getElementById("commercial-ui-style-v323")) return;

  var style = document.createElement("style");
  style.id = "commercial-ui-style-v323";
  style.innerHTML =
    ".radius-clean-btn{" +
    "margin:3px;padding:6px 9px;border-radius:999px;background:#eef4ff;color:#005bea;font-size:12px;font-weight:800;" +
    "}" +
    ".radius-clean-btn.radius-active{" +
    "background:#005bea!important;color:white!important;" +
    "}" +
    ".item.selected{" +
    "box-shadow:0 4px 16px rgba(0,91,234,0.12);" +
    "}";

  document.head.appendChild(style);
}


injectCommercialUIStyle();
// 중복 DOM 재가공 방지: 필요할 때만 통합 브리핑에서 처리
  /* === v3.3 AI 상권브리핑 + 기본반경 50m === */

var JS_V33_lastSelectedText = "";


function jsV33_getSelectedCard() {
  return document.querySelector(".item.selected");
}


function jsV33_clickDefault50m(card) {
  if (!card) return;

  var keyText = card.innerText || "";
  if (JS_V33_lastSelectedText === keyText) return;
  JS_V33_lastSelectedText = keyText;

  setTimeout(function() {
    var buttons = card.querySelectorAll("button");
    buttons.forEach(function(btn) {
      if ((btn.innerText || "").trim() === "50m") {
        btn.click();
        btn.style.background = "#005bea";
        btn.style.color = "#fff";
      }
    });
  }, 500);
}


function jsV33_getCount(card, label) {
  var text = card.innerText || "";
  var reg = new RegExp(label + "\\s*(\\d+)", "i");
  var m = text.match(reg);
  return m ? Number(m[1]) : 0;
}


function jsV33_grade(count, lowGood) {
  if (lowGood) {
    if (count === 0) return "★★★★★ 강력추천";
    if (count <= 1) return "★★★★☆ 추천";
    if (count <= 3) return "★★★☆☆ 보통";
    return "★☆☆☆☆ 경쟁심함";
  } else {
    if (count >= 5) return "★★★★★ 수요강함";
    if (count >= 3) return "★★★★☆ 양호";
    if (count >= 1) return "★★★☆☆ 보통";
    return "★★☆☆☆ 약함";
  }
}


function jsV33_makeBriefing(card) {
  var convenience = jsV33_getCount(card, "편의점");
  var cafe = jsV33_getCount(card, "카페");
  var korean = jsV33_getCount(card, "한식");
  var japanese = jsV33_getCount(card, "일식");
  var snack = jsV33_getCount(card, "분식");
  var beauty = jsV33_getCount(card, "미용실");
  var nail = jsV33_getCount(card, "네일");
  var academy = jsV33_getCount(card, "학원");

  var blue = [];
  var saturated = [];

  if (convenience <= 1) blue.push("편의점");
  if (japanese <= 1) blue.push("일식");
  if (snack <= 1) blue.push("분식");
  if (nail <= 1 && beauty >= 1) blue.push("네일샵");

  if (cafe >= 5) saturated.push("카페");
  if (beauty >= 5) saturated.push("미용실");
  if (korean >= 5) saturated.push("한식");

  var score = 70;
  score += Math.max(0, 2 - convenience) * 8;
  score += Math.max(0, 2 - nail) * 5;
  score += Math.min(academy, 5) * 2;
  score -= Math.max(0, cafe - 5) * 2;
  score -= Math.max(0, beauty - 5) * 2;
  if (score > 98) score = 98;
  if (score < 45) score = 45;

  return {
    score: score,
    convenience: convenience,
    cafe: cafe,
    korean: korean,
    japanese: japanese,
    snack: snack,
    beauty: beauty,
    nail: nail,
    academy: academy,
    blue: blue,
    saturated: saturated
  };
}


function jsV33_renderBriefing() {
  var card = jsV33_getSelectedCard();
  if (!card) return;

  jsV33_clickDefault50m(card);

  var old = card.querySelector("#jsV33Briefing");
  if (old) old.remove();

  var b = jsV33_makeBriefing(card);

  var html = ''
    + '<div id="jsV33Briefing" class="js-v33-briefing">'
    + '<div class="js-v33-title">🧠 AI 상권 브리핑</div>'
    + '<div class="js-v33-score">예상 성공가능성 <b>' + b.score + '점</b></div>'
    + '<div class="js-v33-bar"><span style="width:' + b.score + '%"></span></div>'

    + '<div class="js-v33-section"><b>생활/교통 판단</b>'
    + '<p>편의점 ' + b.convenience + '개 · ' + jsV33_grade(b.convenience, true) + '</p>'
    + '<p>학원 ' + b.academy + '개 · 주변 생활수요 참고 가능</p>'
    + '</div>'

    + '<div class="js-v33-section"><b>음식 상권 판단</b>'
    + '<p>한식 ' + b.korean + '개 · ' + jsV33_grade(b.korean, true) + '</p>'
    + '<p>일식 ' + b.japanese + '개 · ' + jsV33_grade(b.japanese, true) + '</p>'
    + '<p>분식 ' + b.snack + '개 · ' + jsV33_grade(b.snack, true) + '</p>'
    + '</div>'

    + '<div class="js-v33-section"><b>뷰티 상권 판단</b>'
    + '<p>미용실 ' + b.beauty + '개 · ' + jsV33_grade(b.beauty, true) + '</p>'
    + '<p>네일 ' + b.nail + '개 · ' + jsV33_grade(b.nail, true) + '</p>'
    + '</div>'

    + '<div class="js-v33-result blue"><b>블루오션 후보</b><br>' + (b.blue.length ? b.blue.join(" · ") : "뚜렷한 후보 없음") + '</div>'
    + '<div class="js-v33-result warn"><b>포화주의 업종</b><br>' + (b.saturated.length ? b.saturated.join(" · ") : "과밀 업종 낮음") + '</div>'

    + '<div class="js-v33-opinion"><b>AI 종합의견</b><br>'
    + (b.blue.length ? b.blue[0] + ' 업종은 근거리 경쟁이 낮아 우선 검토할 만합니다. ' : '')
    + (b.saturated.length ? b.saturated[0] + ' 업종은 경쟁이 높아 신중한 접근이 필요합니다. ' : '')
    + '최종 판단은 유동인구, 전면노출, 주차, 실제 경쟁점포 상태를 현장에서 확인한 뒤 진행하세요.'
    + '</div>'
    + '</div>';

  var target = card.querySelector(".ai-commercial-box") || card.querySelector(".ai-market-box") || card;
  target.insertAdjacentHTML("beforeend", html);
}


function jsV33_injectStyle() {
  if (document.getElementById("jsV33Style")) return;

  var style = document.createElement("style");
  style.id = "jsV33Style";
  style.innerHTML =
    ".js-v33-briefing{margin-top:12px;padding:12px;border:1px solid #bcd8ff;border-radius:14px;background:#f8fbff;text-align:left;}" +
    ".js-v33-title{font-size:15px;font-weight:900;color:#005bea;margin-bottom:8px;}" +
    ".js-v33-score{font-size:13px;margin-bottom:6px;}" +
    ".js-v33-score b{font-size:20px;color:#005bea;}" +
    ".js-v33-bar{height:10px;background:#e9f2ff;border-radius:999px;overflow:hidden;margin-bottom:10px;}" +
    ".js-v33-bar span{display:block;height:100%;background:linear-gradient(90deg,#1e88ff,#03c75a);}" +
    ".js-v33-section{background:white;border:1px solid #e1ecff;border-radius:10px;padding:9px;margin-top:8px;font-size:12px;line-height:1.45;}" +
    ".js-v33-section b{display:block;color:#111;margin-bottom:4px;}" +
    ".js-v33-section p{margin:3px 0;}" +
    ".js-v33-result{padding:9px;border-radius:10px;margin-top:8px;font-size:12px;line-height:1.5;}" +
    ".js-v33-result.blue{background:#eefaf2;border:1px solid #b7ebc6;}" +
    ".js-v33-result.warn{background:#fff7e6;border:1px solid #ffd591;}" +
    ".js-v33-opinion{margin-top:8px;background:#fff;border:1px solid #d9e6f7;border-radius:10px;padding:9px;font-size:12px;line-height:1.5;}";
  document.head.appendChild(style);
}


jsV33_injectStyle();
// v3.3 개별 상권 브리핑 반복 렌더링 중지 (v4.0 통합 브리핑 사용)
/* === v3.3.1 추천업종 TOP3 실무형 브리핑 === */


function jsV331_getSelectedCard() {
  return document.querySelector(".item.selected");
}


function jsV331_getCount(card, label) {
  var text = card.innerText || "";
  var reg = new RegExp(label + "\\s*(\\d+)", "i");
  var m = text.match(reg);
  return m ? Number(m[1]) : 0;
}


function jsV331_makeBusinessScores(card) {
  var c = {
    convenience: jsV331_getCount(card, "편의점"),
    cafe: jsV331_getCount(card, "카페"),
    korean: jsV331_getCount(card, "한식"),
    japanese: jsV331_getCount(card, "일식"),
    chinese: jsV331_getCount(card, "중식"),
    snack: jsV331_getCount(card, "분식"),
    chicken: jsV331_getCount(card, "치킨"),
    beer: jsV331_getCount(card, "호프"),
    beauty: jsV331_getCount(card, "미용실"),
    nail: jsV331_getCount(card, "네일"),
    eyelash: jsV331_getCount(card, "속눈썹"),
    skin: jsV331_getCount(card, "피부샵"),
    academy: jsV331_getCount(card, "학원"),
    hospital: jsV331_getCount(card, "병원"),
    pharmacy: jsV331_getCount(card, "약국"),
    bank: jsV331_getCount(card, "은행")
  };

  var list = [
    {
      name: "편의점",
      score: 95 - c.convenience * 18 + c.academy * 2 + c.korean,
      reasons: [
        "근거리 편의점 경쟁도를 우선 확인",
        "학원·음식점 수요와 함께 보면 생활밀착 수요 판단 가능",
        "전면 노출과 코너 여부 확인 필수"
      ]
    },
    {
      name: "분식",
      score: 88 - c.snack * 14 + c.academy * 3 + c.korean,
      reasons: [
        "학원가·주거지 수요와 궁합이 좋음",
        "한식 대비 소형평수 창업에 유리",
        "점심·간식 시간대 유동인구 확인 필요"
      ]
    },
    {
      name: "일식",
      score: 86 - c.japanese * 16 + c.korean + c.bank,
      reasons: [
        "일식 경쟁점이 적으면 차별화 가능",
        "직장·생활 상권에서 객단가 확보 가능",
        "주차와 저녁 유동 확인 필요"
      ]
    },
    {
      name: "네일샵",
      score: 87 - c.nail * 18 + c.beauty * 3,
      reasons: [
        "미용실은 있는데 네일샵이 적으면 뷰티 수요 흡수 가능",
        "소형평수 창업에 적합",
        "기존 미용실과의 동선 시너지 확인"
      ]
    },
    {
      name: "속눈썹",
      score: 84 - c.eyelash * 18 + c.beauty * 2,
      reasons: [
        "뷰티 상권 내 세부업종 공백 확인",
        "네일·피부샵과 비교해 경쟁도 낮으면 유리",
        "예약형 업종이라 접근성과 주차 확인 필요"
      ]
    },
    {
      name: "피부샵",
      score: 82 - c.skin * 15 + c.beauty * 2,
      reasons: [
        "뷰티 수요가 있는 지역이면 검토 가능",
        "고정 고객 확보형 업종",
        "주거 밀집도와 여성 유동 확인 필요"
      ]
    },
    {
      name: "약국",
      score: 78 - c.pharmacy * 20 + c.hospital * 5,
      reasons: [
        "병원은 있는데 약국이 적으면 강점",
        "의료시설 동선 확인 필요",
        "입점 가능 업종 제한 확인 필요"
      ]
    },
    {
      name: "카페",
      score: 75 - c.cafe * 10 + c.academy + c.bank,
      reasons: [
        "카페 수가 많으면 경쟁이 강함",
        "전면 노출과 테이크아웃 동선이 중요",
        "디저트 특화로 차별화 가능"
      ]
    }
  ];

  list.forEach(function(x) {
    if (x.score > 98) x.score = 98;
    if (x.score < 35) x.score = 35;
  });

  list.sort(function(a, b) {
    return b.score - a.score;
  });

  var saturated = [];
  if (c.cafe >= 5) saturated.push("카페");
  if (c.beauty >= 5) saturated.push("미용실");
  if (c.korean >= 5) saturated.push("한식");
  if (c.convenience >= 4) saturated.push("편의점");

  return {
    top: list.slice(0, 3),
    weak: list.slice(-3).reverse(),
    saturated: saturated
  };
}


function jsV331_renderTopBusiness() {
  var card = jsV331_getSelectedCard();
  if (!card) return;

  var old = card.querySelector("#jsV331BusinessBox");
  if (old) old.remove();

  var data = jsV331_makeBusinessScores(card);

  var topHtml = data.top.map(function(x, i) {
    return ''
      + '<div class="js-v331-rank">'
      + '<div class="js-v331-rank-head"><b>' + (i + 1) + '위 ' + x.name + '</b><strong>' + x.score + '점</strong></div>'
      + '<div class="js-v331-mini-bar"><span style="width:' + x.score + '%"></span></div>'
      + '<ul>'
      + x.reasons.map(function(r) { return '<li>' + r + '</li>'; }).join("")
      + '</ul>'
      + '</div>';
  }).join("");

  var weakHtml = data.weak.map(function(x) {
    return '<span>' + x.name + ' ' + x.score + '점</span>';
  }).join("");

  var html = ''
    + '<div id="jsV331BusinessBox" class="js-v331-box">'
    + '<div class="js-v331-title">🥇 AI 추천업종 TOP3</div>'
    + topHtml
    + '<div class="js-v331-warn"><b>비추천/신중 업종</b><br>' + (weakHtml || "없음") + '</div>'
    + '<div class="js-v331-check"><b>현장 확인 포인트</b><br>'
    + '□ 코너자리 여부 &nbsp; □ 전면 노출 &nbsp; □ 실제 경쟁점 영업상태<br>'
    + '□ 점심/저녁 유동 &nbsp; □ 주차 &nbsp; □ 간판 위치'
    + '</div>'
    + '</div>';

  var target = card.querySelector("#jsV33Briefing") || card;
  target.insertAdjacentHTML("afterend", html);
}


function jsV331_injectStyle() {
  if (document.getElementById("jsV331Style")) return;

  var style = document.createElement("style");
  style.id = "jsV331Style";
  style.innerHTML =
    ".js-v331-box{margin-top:12px;padding:12px;border:1px solid #d6e4ff;border-radius:14px;background:#ffffff;text-align:left;}" +
    ".js-v331-title{font-size:15px;font-weight:900;color:#005bea;margin-bottom:8px;}" +
    ".js-v331-rank{border:1px solid #e8f0ff;background:#f8fbff;border-radius:12px;padding:9px;margin-top:8px;}" +
    ".js-v331-rank-head{display:flex;justify-content:space-between;align-items:center;font-size:13px;}" +
    ".js-v331-rank-head strong{color:#005bea;font-size:16px;}" +
    ".js-v331-mini-bar{height:8px;background:#e9f2ff;border-radius:999px;overflow:hidden;margin:7px 0;}" +
    ".js-v331-mini-bar span{display:block;height:100%;background:linear-gradient(90deg,#1e88ff,#03c75a);}" +
    ".js-v331-rank ul{margin:6px 0 0 17px;padding:0;font-size:12px;line-height:1.45;color:#333;}" +
    ".js-v331-warn{margin-top:10px;padding:9px;border-radius:10px;background:#fff7e6;border:1px solid #ffd591;font-size:12px;line-height:1.5;}" +
    ".js-v331-warn span{display:inline-block;margin:3px 5px 0 0;background:#fff;padding:4px 7px;border-radius:999px;border:1px solid #ffe0a3;}" +
    ".js-v331-check{margin-top:10px;padding:9px;border-radius:10px;background:#f6ffed;border:1px solid #b7eb8f;font-size:12px;line-height:1.6;}";
  document.head.appendChild(style);
}


jsV331_injectStyle();
// v3.3.1 개별 추천업종 TOP3 반복 렌더링 중지 (v4.0 통합 브리핑 사용)
/* === v4.0 AI 엔진 통합 안정화: 스크롤 튐 방지 === */

/* 기존 반복 렌더링 함수 무력화 */
if (typeof jsV33_renderBriefing === "function") {
  jsV33_renderBriefing = function() {};
}
if (typeof jsV331_renderTopBusiness === "function") {
  jsV331_renderTopBusiness = function() {};
}

var JS_V40_LAST_SIG = "";


function jsV40Count(card, label) {
  var text = card.innerText || "";
  var reg = new RegExp(label + "\\s*(\\d+|없음)", "i");
  var m = text.match(reg);
  if (!m) return 0;
  return m[1] === "없음" ? 0 : Number(m[1]) || 0;
}


function jsV40ScoreLine(name, score) {
  return '<div class="js-v40-rank"><b>' + name + '</b><span>' + score + '점</span></div>';
}


function jsV40Build(card) {
  var convenience = jsV40Count(card, "편의점");
  var cafe = jsV40Count(card, "카페");
  var korean = jsV40Count(card, "한식");
  var japanese = jsV40Count(card, "일식");
  var snack = jsV40Count(card, "분식");
  var beauty = jsV40Count(card, "미용실");
  var nail = jsV40Count(card, "네일");
  var academy = jsV40Count(card, "학원");

  var list = [
    { name:"편의점", score:95 - convenience * 18 + academy * 2 },
    { name:"분식", score:88 - snack * 14 + academy * 3 },
    { name:"일식", score:86 - japanese * 16 + korean },
    { name:"네일샵", score:87 - nail * 18 + beauty * 3 },
    { name:"카페", score:75 - cafe * 10 + academy }
  ];

  list.forEach(function(x) {
    if (x.score > 98) x.score = 98;
    if (x.score < 35) x.score = 35;
  });

  list.sort(function(a,b){ return b.score - a.score; });

  var blue = [];
  if (convenience <= 1) blue.push("편의점");
  if (japanese <= 1) blue.push("일식");
  if (snack <= 1) blue.push("분식");
  if (nail <= 1 && beauty >= 1) blue.push("네일샵");

  var warn = [];
  if (cafe >= 5) warn.push("카페");
  if (beauty >= 5) warn.push("미용실");
  if (korean >= 5) warn.push("한식");

  var totalScore = Math.round((list[0].score + list[1].score + list[2].score) / 3);

  return {
    sig: [convenience,cafe,korean,japanese,snack,beauty,nail,academy].join("|"),
    score: totalScore,
    top: list.slice(0,3),
    blue: blue,
    warn: warn,
    convenience: convenience,
    cafe: cafe,
    beauty: beauty,
    academy: academy
  };
}


function jsV40Render() {
  var card = document.querySelector(".item.selected");
  if (!card) return;

  var data = jsV40Build(card);
  var key = (typeof selectedItemKey !== "undefined" ? selectedItemKey : "") + "|" + data.sig;

  if (JS_V40_LAST_SIG === key && card.querySelector("#jsV40UnifiedAI")) return;
  JS_V40_LAST_SIG = key;

  var old1 = card.querySelector("#jsV33Briefing");
  var old2 = card.querySelector("#jsV331BusinessBox");
  var old3 = card.querySelector("#jsV40UnifiedAI");
  if (old1) old1.remove();
  if (old2) old2.remove();
  if (old3) old3.remove();

  var topHtml = data.top.map(function(x, i) {
    return jsV40ScoreLine((i + 1) + "위 " + x.name, x.score);
  }).join("");

  var html = ''
    + '<div id="jsV40UnifiedAI" class="js-v40-box">'
    + '<div class="js-v40-title">🧠 AI 통합 투자 브리핑</div>'
    + '<div class="js-v40-score">예상 성공가능성 <b>' + data.score + '점</b></div>'
    + '<div class="js-v40-bar"><span style="width:' + data.score + '%"></span></div>'
    + '<div class="js-v40-section"><b>🥇 추천업종 TOP3</b>' + topHtml + '</div>'
    + '<div class="js-v40-section"><b>💎 블루오션 후보</b><p>' + (data.blue.length ? data.blue.join(" · ") : "뚜렷한 후보 없음") + '</p></div>'
    + '<div class="js-v40-section warn"><b>⚠️ 포화주의 업종</b><p>' + (data.warn.length ? data.warn.join(" · ") : "과밀 업종 낮음") + '</p></div>'
    + '<div class="js-v40-section"><b>📌 AI 판단 근거</b>'
    + '<p>편의점 ' + data.convenience + '개 / 카페 ' + data.cafe + '개 / 미용실 ' + data.beauty + '개 / 학원 ' + data.academy + '개 기준</p>'
    + '<p>근거리 경쟁도와 생활수요를 함께 반영했습니다.</p>'
    + '</div>'
    + '<div class="js-v40-opinion"><b>AI 종합의견</b><br>'
    + (data.blue.length ? data.blue[0] + ' 업종은 우선 검토 가치가 있습니다. ' : '')
    + (data.warn.length ? data.warn[0] + ' 업종은 경쟁이 높아 신중 검토가 필요합니다. ' : '')
    + '최종 판단은 유동인구, 전면노출, 주차, 실제 경쟁점포 상태 확인 후 진행하세요.'
    + '</div>'
    + '</div>';

  var target = card.querySelector(".ai-commercial-box") || card;
  target.insertAdjacentHTML("beforeend", html);
}


function jsV40Style() {
  if (document.getElementById("jsV40Style")) return;
  var style = document.createElement("style");
  style.id = "jsV40Style";
  style.innerHTML =
    ".js-v40-box{margin-top:12px;padding:12px;border:1px solid #bcd8ff;border-radius:14px;background:#f8fbff;text-align:left;}" +
    ".js-v40-title{font-size:15px;font-weight:900;color:#005bea;margin-bottom:8px;}" +
    ".js-v40-score{font-size:13px;margin-bottom:6px;}" +
    ".js-v40-score b{font-size:21px;color:#005bea;}" +
    ".js-v40-bar{height:10px;background:#e9f2ff;border-radius:999px;overflow:hidden;margin-bottom:10px;}" +
    ".js-v40-bar span{display:block;height:100%;background:linear-gradient(90deg,#1e88ff,#03c75a);}" +
    ".js-v40-section{background:white;border:1px solid #e1ecff;border-radius:10px;padding:9px;margin-top:8px;font-size:12px;line-height:1.5;}" +
    ".js-v40-section.warn{background:#ffffff;border-color:#d9e6f7;}" +
    ".js-v40-rank{display:flex;justify-content:space-between;align-items:center;margin:5px 0;padding:6px 8px;background:#f6f9ff;border-radius:8px;}" +
    ".js-v40-rank span{font-weight:900;color:#005bea;}" +
    ".js-v40-opinion{margin-top:8px;background:#fff;border:1px solid #d9e6f7;border-radius:10px;padding:9px;font-size:12px;line-height:1.5;}";
  document.head.appendChild(style);
}


jsV40Style();
setInterval(jsV40Render, 1000);
