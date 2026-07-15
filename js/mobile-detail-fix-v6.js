/* JS부동산 v6.0 STEP3.3 - 모바일 상세필터를 정렬과 같은 독립 시트로 표시 */
(function () {
  "use strict";

  var FIELD_IDS = [
    "minDeposit", "maxDeposit",
    "minRent", "maxRent",
    "minArea", "maxArea",
    "minFloor", "maxFloor"
  ];

  function isDetailSheetDevice() {
    var width = Math.max(
      document.documentElement ? document.documentElement.clientWidth : 0,
      window.innerWidth || 0
    );

    var touchCapable =
      (navigator.maxTouchPoints || 0) > 0 ||
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

    /*
     * 스마트폰은 기존처럼 항상 전용 하단 시트를 사용하고,
     * 769~1200px 구간은 터치 태블릿일 때만 전용 시트를 사용합니다.
     * PC의 기존 필터 동작은 변경하지 않습니다.
     */
    return width <= 768 || (width <= 1200 && touchCapable);
  }

  function syncDeviceClass() {
    document.documentElement.classList.toggle(
      "v6-detail-sheet-device",
      isDetailSheetDevice()
    );
  }

  function originalField(id) {
    return document.getElementById(id);
  }

  function sheetField(id) {
    return document.getElementById("v6DetailSheet_" + id);
  }

  function syncToSheet() {
    FIELD_IDS.forEach(function (id) {
      var source = originalField(id);
      var target = sheetField(id);
      if (source && target) target.value = source.value || "";
    });
  }

  function syncToOriginal() {
    FIELD_IDS.forEach(function (id) {
      var source = sheetField(id);
      var target = originalField(id);
      if (source && target) target.value = source.value || "";
    });
  }

  function ensureSheet() {
    var root = document.getElementById("v6DetailSheetPortal");
    if (root) return root;

    root = document.createElement("div");
    root.id = "v6DetailSheetPortal";
    root.className = "v6-detail-sheet-portal";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="v6-detail-sheet-dim" data-v6-detail-close></div>' +
      '<section class="v6-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="v6DetailSheetTitle">' +
        '<div class="v6-detail-sheet-handle"></div>' +
        '<header class="v6-detail-sheet-head">' +
          '<strong id="v6DetailSheetTitle">상세필터</strong>' +
          '<button type="button" class="v6-detail-sheet-close" data-v6-detail-close aria-label="닫기">×</button>' +
        '</header>' +
        '<div class="v6-detail-sheet-body">' +
          '<div class="v6-detail-sheet-row"><input id="v6DetailSheet_minDeposit" inputmode="numeric" placeholder="보증금 최소"><input id="v6DetailSheet_maxDeposit" inputmode="numeric" placeholder="보증금 최대"></div>' +
          '<div class="v6-detail-sheet-row"><input id="v6DetailSheet_minRent" inputmode="numeric" placeholder="월세 최소"><input id="v6DetailSheet_maxRent" inputmode="numeric" placeholder="월세 최대"></div>' +
          '<div class="v6-detail-sheet-row"><input id="v6DetailSheet_minArea" inputmode="decimal" placeholder="평수 최소"><input id="v6DetailSheet_maxArea" inputmode="decimal" placeholder="평수 최대"></div>' +
          '<div class="v6-detail-sheet-row"><input id="v6DetailSheet_minFloor" inputmode="numeric" placeholder="층수 최소 (예: B1 또는 -1)"><input id="v6DetailSheet_maxFloor" inputmode="numeric" placeholder="층수 최대 (예: 3)"></div>' +
          '<button type="button" class="v6-detail-sheet-apply">필터 적용</button>' +
        '</div>' +
      '</section>';

    root.addEventListener("click", function (event) {
      if (event.target.closest("[data-v6-detail-close]")) close();
      if (event.target.closest(".v6-detail-sheet-apply")) apply();
    });

    root.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && event.target.matches("input")) {
        event.preventDefault();
        apply();
      }
      if (event.key === "Escape") close();
    });

    document.body.appendChild(root);
    return root;
  }

  function removeLegacyDetailState() {
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    if (panel) {
      panel.classList.remove("open", "v6-detail-dropdown-open", "v6-detail-portal-open", "v6-detail-stable-open");
      panel.removeAttribute("style");
    }
    if (button) button.classList.remove("on");

    ["v6DetailPortalDim", "v6DetailStableDim", "v6DetailDim"].forEach(function (id) {
      var dim = document.getElementById(id);
      if (dim) dim.classList.remove("open");
    });
    document.body.classList.remove("v6-detail-portal-lock", "v6-detail-stable-lock");
  }

  function open() {
    if (!isDetailSheetDevice()) return;
    removeLegacyDetailState();
    var root = ensureSheet();
    syncToSheet();
    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("v6-detail-sheet-open");
    var button = document.getElementById("detailBtn");
    if (button) {
      button.classList.add("on");
      button.setAttribute("aria-expanded", "true");
    }
  }

  function close() {
    var root = document.getElementById("v6DetailSheetPortal");
    if (root) {
      root.classList.remove("open");
      root.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("v6-detail-sheet-open");
    var button = document.getElementById("detailBtn");
    if (button) {
      button.classList.remove("on");
      button.setAttribute("aria-expanded", "false");
    }
    removeLegacyDetailState();
  }

  function toggle() {
    if (!isDetailSheetDevice()) return;
    var root = ensureSheet();
    if (root.classList.contains("open")) close();
    else open();
  }

  function apply() {
    syncToOriginal();
    if (typeof window.applyFilter === "function") window.applyFilter();
    close();
  }

  syncDeviceClass();

  /* 기존 인라인 onclick/중복 보완 이벤트보다 먼저 가로챕니다. */
  document.addEventListener("click", function (event) {
    if (!isDetailSheetDevice()) return;
    var trigger = event.target && event.target.closest ? event.target.closest("#detailBtn") : null;
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    toggle();
  }, true);

  window.addEventListener("resize", function () {
    syncDeviceClass();
    if (!isDetailSheetDevice()) close();
  });

  window.toggleDetailFilter = function () {
    if (isDetailSheetDevice()) {
      toggle();
      return;
    }
    var panel = document.getElementById("detailFilter");
    var button = document.getElementById("detailBtn");
    if (!panel || !button) return;
    var willOpen = !panel.classList.contains("open");
    panel.classList.toggle("open", willOpen);
    button.classList.toggle("on", willOpen);
    if (willOpen && typeof window.positionDetailFilter === "function") window.positionDetailFilter();
  };

  window.JSV6MobileDetailFix = { open: open, close: close, toggle: toggle, apply: apply };
})();
