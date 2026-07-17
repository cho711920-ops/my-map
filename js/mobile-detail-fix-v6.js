/* JS부동산 v6.2.4 - 태블릿 필터 버튼 아래, 매물목록 비가림 팝업 */
(function () {
  "use strict";

  var FIELD_IDS = [
    "minDeposit", "maxDeposit",
    "minRent", "maxRent",
    "minPremium", "maxPremium",
    "minArea", "maxArea",
    "minFloor", "maxFloor",
    "industryFilter"
  ];

  function isPhone() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
  }

  function isTouchTablet() {
    var width = Math.max(
      Number(window.innerWidth) || 0,
      Number(document.documentElement && document.documentElement.clientWidth) || 0
    );
    var touchPoints = Number((navigator && navigator.maxTouchPoints) || 0);
    var coarsePointer = !!(
      window.matchMedia &&
      window.matchMedia("(pointer: coarse)").matches
    );
    var noHover = !!(
      window.matchMedia &&
      window.matchMedia("(hover: none)").matches
    );

    /*
     * 삼성 태블릿 가로모드는 CSS viewport가 1200~1400px까지 올라갈 수 있습니다.
     * 기존 1199px 제한 때문에 태블릿이 PC 필터로 잘못 분류됐습니다.
     * 터치 + 굵은 포인터(또는 hover 없음)인 기기만 태블릿으로 인정하므로
     * 일반 PC에는 적용되지 않습니다.
     */
    return (
      width >= 769 &&
      width <= 1800 &&
      touchPoints > 0 &&
      (coarsePointer || noHover)
    );
  }

  function useDetailSheet() {
    return isPhone() || isTouchTablet();
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
          '<div class="v6-detail-sheet-row"><input id="v6DetailSheet_minPremium" inputmode="numeric" placeholder="권리금 최소"><input id="v6DetailSheet_maxPremium" inputmode="numeric" placeholder="권리금 최대"></div>' +
          '<div class="v6-detail-sheet-row"><input id="v6DetailSheet_minArea" inputmode="decimal" placeholder="평수 최소"><input id="v6DetailSheet_maxArea" inputmode="decimal" placeholder="평수 최대"></div>' +
          '<div class="v6-detail-sheet-row"><input id="v6DetailSheet_minFloor" inputmode="text" placeholder="층수 최소 (예: B1 또는 -1)"><input id="v6DetailSheet_maxFloor" inputmode="text" placeholder="층수 최대 (예: 3)"></div>' +
          '<div class="v6-detail-sheet-row v6-detail-sheet-row-single"><input id="v6DetailSheet_industryFilter" inputmode="text" placeholder="업종구분 (예: 식당, 카페)"></div>' +
          '<button type="button" class="v6-detail-sheet-apply">필터 적용</button>' +
        '</div>' +
      '</section>';

    ["pointerdown", "touchstart", "mousedown"].forEach(function (type) {
      root.addEventListener(type, function (event) {
        /* 기본 입력 동작은 유지하고 다른 필터 제어 코드로만 전달되지 않게 합니다. */
        event.stopPropagation();
      }, false);
    });

    root.addEventListener("click", function (event) {
      var closeTarget = event.target.closest("[data-v6-detail-close]");
      var applyTarget = event.target.closest(".v6-detail-sheet-apply");

      if (closeTarget) {
        close();
      } else if (applyTarget) {
        apply();
      }

      event.stopPropagation();
    }, false);

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

  function positionTabletPopup(root) {
    if (!root || isPhone()) return;

    var button = document.getElementById("detailBtn");
    var sheet = root.querySelector(".v6-detail-sheet");
    if (!button || !sheet) return;

    var rect = button.getBoundingClientRect();
    var viewportWidth = Math.max(
      Number(window.innerWidth) || 0,
      Number(document.documentElement && document.documentElement.clientWidth) || 0
    );
    var viewportHeight = Math.max(
      Number(window.innerHeight) || 0,
      Number(document.documentElement && document.documentElement.clientHeight) || 0
    );

    var margin = 12;
    var gap = 6;
    var sidebar = document.getElementById("sidebar");
    var sidebarRight = sidebar
      ? Math.max(0, sidebar.getBoundingClientRect().right)
      : 0;

    /*
     * 태블릿 팝업은 매물목록 오른쪽에서 시작하고,
     * 가능한 한 필터 버튼의 왼쪽 선에 맞춥니다.
     */
    var availableRightWidth = Math.max(
      320,
      viewportWidth - Math.max(sidebarRight + 8, margin) - margin
    );
    var popupWidth = Math.min(
      480,
      Math.max(420, availableRightWidth)
    );

    /* 좁은 세로 화면에서는 남은 지도 폭에 맞춰 자동 축소 */
    if (popupWidth > availableRightWidth) {
      popupWidth = availableRightWidth;
    }

    var minimumLeft = Math.max(sidebarRight + 8, margin);
    var maximumLeft = Math.max(minimumLeft, viewportWidth - popupWidth - margin);
    var left = Math.max(minimumLeft, Math.min(rect.left, maximumLeft));

    var top = rect.bottom + gap;
    var estimatedHeight = Math.min(430, viewportHeight - top - margin);

    /* 아래 공간이 부족하면 버튼 위쪽에 표시합니다. */
    if (estimatedHeight < 300 && rect.top > 320) {
      top = Math.max(margin, rect.top - 420 - gap);
    }

    root.style.setProperty("--v6-tablet-popup-left", Math.round(left) + "px");
    root.style.setProperty("--v6-tablet-popup-top", Math.round(top) + "px");
    root.style.setProperty("--v6-tablet-popup-width", Math.round(popupWidth) + "px");
  }

  function open() {
    if (!useDetailSheet()) return;
    removeLegacyDetailState();
    var root = ensureSheet();
    syncToSheet();
    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
    document.documentElement.setAttribute("data-v6-detail-mode", isPhone() ? "phone" : "tablet");
    if (!isPhone()) positionTabletPopup(root);
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
    document.documentElement.removeAttribute("data-v6-detail-mode");
    var button = document.getElementById("detailBtn");
    if (button) {
      button.classList.remove("on");
      button.setAttribute("aria-expanded", "false");
    }
    removeLegacyDetailState();
  }

  function toggle() {
    if (!useDetailSheet()) return;
    var root = ensureSheet();
    if (root.classList.contains("open")) close();
    else open();
  }

  function apply() {
    syncToOriginal();
    if (typeof window.applyFilter === "function") window.applyFilter();
    close();
  }

  /* 기존 인라인 onclick/중복 보완 이벤트보다 먼저 가로챕니다. */
  document.addEventListener("click", function (event) {
    if (!useDetailSheet()) return;
    var trigger = event.target && event.target.closest ? event.target.closest("#detailBtn") : null;
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    toggle();
  }, true);

  window.addEventListener("resize", function () {
    if (!useDetailSheet()) {
      close();
      return;
    }

    var root = document.getElementById("v6DetailSheetPortal");
    if (root && root.classList.contains("open") && !isPhone()) {
      positionTabletPopup(root);
    }
  });

  window.addEventListener("orientationchange", function () {
    setTimeout(function () {
      var root = document.getElementById("v6DetailSheetPortal");
      if (root && root.classList.contains("open") && !isPhone()) {
        positionTabletPopup(root);
      }
    }, 120);
  });

  window.toggleDetailFilter = function () {
    if (useDetailSheet()) {
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
