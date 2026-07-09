(function () {
  "use strict";

  var lastKey = "";

  function num(v) {
    var n = Number(String(v || "").replace(/[^0-9.]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function getDong(address) {
    var m = String(address || "").match(/[가-힣0-9]+동/);
    return m ? m[0] : "";
  }

  function getFloor(room) {
    var txt = String(room || "");
    if (/지하|B|b/.test(txt)) return "지하";
    var m = txt.match(/(\d+)\s*층/);
    if (m) return m[1] + "층";
    if (/1층|101|102|103/.test(txt)) return "1층";
    return "";
  }

  function perRent(item) {
    var rent = num(item.rent);
    var fee = num(item.fee);
    var area = num(item.area);
    if (!area) return 0;
    return Math.round(((rent + fee) / area) * 10) / 10;
  }

  function avg(arr, getter) {
    var vals = arr.map(getter).filter(function (v) { return v > 0; });
    if (!vals.length) return 0;
    return Math.round((vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) * 10) / 10;
  }

  function diffText(current, average, unit) {
    if (!current || !average) return "비교 데이터 부족";
    var diff = Math.round(((current - average) / average) * 1000) / 10;
    if (diff < 0) return "주변 평균보다 " + Math.abs(diff) + "% 낮음";
    if (diff > 0) return "주변 평균보다 " + diff + "% 높음";
    return "주변 평균과 비슷함";
  }

  function makeMarketAnalysis(item) {
    var all = window.allItems || [];
    var dong = getDong(item.address);
    var floor = getFloor(item.room);
    var area = num(item.area);

    var similar = all.filter(function (x) {
      if (!x || x.key === item.key) return false;
      if (x.state === "계약완료") return false;
      if (dong && getDong(x.address) !== dong) return false;

      var xArea = num(x.area);
      var areaOk = !area || !xArea || Math.abs(xArea - area) <= Math.max(8, area * 0.35);
      var floorOk = !floor || !getFloor(x.room) || getFloor(x.room) === floor;

      return areaOk && floorOk;
    });

    if (similar.length < 3) {
      similar = all.filter(function (x) {
        return x && x.key !== item.key && x.state !== "계약완료" && (!dong || getDong(x.address) === dong);
      });
    }

    var curPer = perRent(item);
    var avgPer = avg(similar, perRent);
    var curPremium = num(item.premium);
    var avgPremium = avg(similar, function (x) { return num(x.premium); });
    var curFee = num(item.fee);
    var avgFee = avg(similar, function (x) { return num(x.fee); });

    var comments = [];

    if (curPer && avgPer && curPer < avgPer) comments.push("평당월비가 주변 유사 매물보다 낮아 임차인 유입 경쟁력이 있습니다.");
    if (curPer && avgPer && curPer > avgPer) comments.push("평당월비가 주변 평균보다 높아 월세 협상이 필요합니다.");
    if (curPremium && avgPremium && curPremium < avgPremium) comments.push("권리금이 주변 평균보다 낮아 초기 진입 부담이 작습니다.");
    if (curPremium && avgPremium && curPremium > avgPremium) comments.push("권리금이 주변 평균보다 높아 권리금 협상이 우선입니다.");
    if (curFee && avgFee && curFee > avgFee) comments.push("관리비가 주변보다 높은 편이라 고정비 확인이 필요합니다.");

    if (!comments.length) comments.push("유사 매물 데이터가 아직 부족해 추가 데이터가 쌓이면 분석 정확도가 올라갑니다.");

    return {
      count: similar.length,
      dong: dong || "주변",
      floor: floor || "유사층",
      curPer: curPer,
      avgPer: avgPer,
      curPremium: curPremium,
      avgPremium: avgPremium,
      curFee: curFee,
      avgFee: avgFee,
      comments: comments
    };
  }

  function renderMarketBox(item) {
    var a = makeMarketAnalysis(item);

    return ''
      + '<div class="ai-market-box" id="aiMarketBox">'
      + '  <div class="ai-market-title">📊 AI 시장분석 브리핑</div>'
      + '  <div class="ai-market-sub">' + a.dong + ' / ' + a.floor + ' 기준 유사매물 ' + a.count + '건 비교</div>'
      + '  <div class="ai-market-grid">'
      + '    <div><b>평당월비</b><strong>' + (a.curPer || '-') + '만</strong><span>평균 ' + (a.avgPer || '-') + '만</span><em>' + diffText(a.curPer, a.avgPer, "만") + '</em></div>'
      + '    <div><b>권리금</b><strong>' + (a.curPremium || 0) + '</strong><span>평균 ' + (a.avgPremium || '-') + '</span><em>' + diffText(a.curPremium, a.avgPremium, "") + '</em></div>'
      + '    <div><b>관리비</b><strong>' + (a.curFee || 0) + '</strong><span>평균 ' + (a.avgFee || '-') + '</span><em>' + diffText(a.curFee, a.avgFee, "") + '</em></div>'
      + '  </div>'
      + '  <div class="ai-market-comment">'
      + a.comments.map(function (c) { return '<p>• ' + c + '</p>'; }).join("")
      + '  </div>'
      + '</div>';
  }

  function injectStyle() {
    if (document.getElementById("aiMarketStyle")) return;
    var style = document.createElement("style");
    style.id = "aiMarketStyle";
    style.innerHTML = ''
      + '.ai-market-box{margin-top:10px;padding:12px;border:1px solid #cfe3ff;border-radius:12px;background:#f8fbff;}'
      + '.ai-market-title{font-weight:900;color:#006de5;margin-bottom:4px;}'
      + '.ai-market-sub{font-size:12px;color:#666;margin-bottom:8px;}'
      + '.ai-market-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}'
      + '.ai-market-grid div{background:white;border:1px solid #e1ecff;border-radius:10px;padding:8px;text-align:center;}'
      + '.ai-market-grid b{display:block;font-size:12px;color:#333;}'
      + '.ai-market-grid strong{display:block;font-size:16px;color:#006de5;margin:3px 0;}'
      + '.ai-market-grid span{display:block;font-size:11px;color:#777;}'
      + '.ai-market-grid em{display:block;font-size:11px;color:#111;margin-top:4px;font-style:normal;font-weight:700;}'
      + '.ai-market-comment{margin-top:8px;font-size:12px;line-height:1.45;color:#333;}'
      + '.ai-market-comment p{margin:3px 0;}';
    document.head.appendChild(style);
  }

  function updateMarketAnalysis() {
    injectStyle();

    var key = window.selectedItemKey;
    if (!key || key === lastKey) return;

    var all = window.allItems || [];
    var item = all.find(function (x) { return x.key === key; });
    if (!item) return;

    lastKey = key;

    setTimeout(function () {
      var selected = document.querySelector(".item.selected");
      if (!selected) return;

      var old = selected.querySelector("#aiMarketBox");
      if (old) old.remove();

      selected.insertAdjacentHTML("beforeend", renderMarketBox(item));
    }, 80);
  }

  document.addEventListener("click", function () {
    setTimeout(updateMarketAnalysis, 150);
  });

  setInterval(updateMarketAnalysis, 700);

  window.JSAnalysis = {
    makeMarketAnalysis: makeMarketAnalysis,
    renderMarketBox: renderMarketBox,
    updateMarketAnalysis: updateMarketAnalysis
  };
})();
