(function () {
  "use strict";

  var BASE_URL = "https://js-map.com/js/";
  var hostname = String(location.hostname || "").toLowerCase();
  var filename = "";

  if (/(^|\.)(?:new|fin)\.land\.naver\.com$/.test(hostname)) {
    filename = "naver-collector.js";
  } else if (/(^|\.)realty\.daangn\.com$/.test(hostname)) {
    filename = "daangn-collector.js";
  } else if (/(^|\.)gongsilbox\.com$/.test(hostname)) {
    filename = "gongsil-collector.js";
  }

  if (!filename) {
    alert("네이버페이 부동산, 당근부동산 또는 공실박스 지도에서 JS 수집 버튼을 실행해 주세요.");
    return;
  }

  var previous = document.getElementById("js-realestate-collector-runtime");
  if (previous) previous.remove();
  var script = document.createElement("script");
  script.id = "js-realestate-collector-runtime";
  script.async = true;
  script.src = BASE_URL + filename + "?v=" + Date.now();
  script.onerror = function () {
    alert("JS 수집기 최신 버전을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.");
  };
  (document.head || document.documentElement).appendChild(script);
})();
