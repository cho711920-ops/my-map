/* =========================================================
   JS부동산 빠른등록 보조 규칙
   @ 뒤의 모든 문장을 메모로 분리합니다.

   예:
   상가주택 둔산동2057 1층 10평 권800
   임)010-1234-5678 세)010-6465-8555
   @비번1111 연락시 주인이 문열어줌

   결과:
   건물이름: 상가주택
   메모: 비번1111 연락시 주인이 문열어줌
   ========================================================= */

(function () {
  "use strict";

  function splitAtMemo(raw) {
    var text = String(raw || "");
    var atIndex = text.indexOf("@");

    if (atIndex < 0) {
      return {
        hasMarker: false,
        mainText: text,
        memoText: ""
      };
    }

    return {
      hasMarker: true,
      mainText: text.slice(0, atIndex).trim(),
      memoText: text.slice(atIndex + 1).trim()
    };
  }

  function extractBuildingNameBeforeAddress(text) {
    var source = String(text || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();

    if (!source) return "";

    /*
     * 주소 시작점을 찾습니다.
     * 예:
     * 상가주택 둔산동2057       → 상가주택
     * 엔젤빌딩 유성구 원신흥동568-7 → 엔젤빌딩
     */
    var addressPattern =
      /(?:대전광역시|대전시|대전)?\s*(?:(?:동구|중구|서구|유성구|대덕구)\s+)?[가-힣0-9]+(?:동|읍|면)\s*\d+(?:-\d+)?/;

    var match = addressPattern.exec(source);

    if (!match) return "";

    return source.slice(0, match.index).trim();
  }

  function setValue(id, value) {
    var element = document.getElementById(id);
    if (element) element.value = value;
  }

  var originalParseQuickAddText = window.parseQuickAddText;

  if (typeof originalParseQuickAddText !== "function") {
    console.error("빠른등록 원본 분석 함수를 찾지 못했습니다.");
    return;
  }

  window.parseQuickAddText = function () {
    var rawElement = document.getElementById("qaRaw");

    if (!rawElement) {
      return originalParseQuickAddText.apply(this, arguments);
    }

    var originalRaw = rawElement.value || "";
    var separated = splitAtMemo(originalRaw);

    /*
     * @가 없으면 기존 분석 동작을 그대로 유지합니다.
     */
    if (!separated.hasMarker) {
      return originalParseQuickAddText.apply(this, arguments);
    }

    /*
     * 기존 AI 분석에는 @ 앞부분만 전달해 메모 문장이
     * 건물이름이나 다른 항목에 섞이지 않도록 합니다.
     */
    rawElement.value = separated.mainText;

    try {
      originalParseQuickAddText.apply(this, arguments);
    } finally {
      /*
       * 사용자가 붙여넣은 원문은 입력창에 그대로 보존합니다.
       */
      rawElement.value = originalRaw;
    }

    /*
     * @ 뒤 문장은 @를 제외하고 메모에 정확히 입력합니다.
     */
    setValue("qaMemo", separated.memoText);

    /*
     * 주소 앞 문구가 존재하면 건물이름으로 우선 적용합니다.
     */
    var buildingName = extractBuildingNameBeforeAddress(separated.mainText);
    if (buildingName) {
      setValue("qaName", buildingName);
    }

    if (typeof window.updateQuickAddWarning === "function") {
      window.updateQuickAddWarning();
    }

    if (typeof window.updateQuickAddPreview === "function") {
      window.updateQuickAddPreview();
    }
  };
})();


/* =========================================================
   v5.4 출처 별도 열 저장
   ========================================================= */
(function () {
  "use strict";

  function cleanSourceFromMemo(value) {
    return String(value || "")
      .replace(/출처\s*[:：]\s*[^\/|,，\n]+/gi, "")
      .replace(/\s*\/\s*\/\s*/g, " / ")
      .replace(/^\s*\/\s*/, "")
      .replace(/\s*\/\s*$/, "")
      .trim();
  }

  function ensureVisitMarker(memo, source) {
    var text = cleanSourceFromMemo(memo);

    if (/공실박스/i.test(String(source || ""))) {
      if (!/\(\s*임장가자\s*\)/i.test(text)) {
        text = text ? "(임장가자) / " + text : "(임장가자)";
      }
    }

    return text;
  }

  var originalGetQuickAddRowValues = window.getQuickAddRowValues;

  window.getQuickAddRowValues = function () {
    var sourceElement = document.getElementById("qaSource");
    var memoElement = document.getElementById("qaMemo");
    var source = sourceElement ? sourceElement.value : "";
    var memo = memoElement ? memoElement.value : "";

    var values = typeof originalGetQuickAddRowValues === "function"
      ? originalGetQuickAddRowValues()
      : [];

    values = values.slice(0, 14);
    values[11] = ensureVisitMarker(memo, source);
    values.push(source);

    return values;
  };

  var previousParse = window.parseQuickAddText;

  if (typeof previousParse === "function") {
    window.parseQuickAddText = function () {
      previousParse.apply(this, arguments);

      var memoElement = document.getElementById("qaMemo");
      var sourceElement = document.getElementById("qaSource");

      if (memoElement) {
        memoElement.value = ensureVisitMarker(
          memoElement.value,
          sourceElement ? sourceElement.value : ""
        );
      }

      if (typeof window.updateQuickAddWarning === "function") {
        window.updateQuickAddWarning();
      }

      if (typeof window.updateQuickAddPreview === "function") {
        window.updateQuickAddPreview();
      }
    };
  }
})();
