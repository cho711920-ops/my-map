/* JS부동산 v6.4.19 - 데스크톱/터치 태블릿/모바일 상세필터 위치 안정화 */
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
  var saleFilterAnchor = null;
  var saleFilterSnapshot = null;
  var PHONE_TOOLBAR_IDS = ["sourceFilter", "typeFilter", "brokerageFeeFilter"];

  function isDedicatedPhone() {
    return !!(window.JSPhoneDeviceV1 && window.JSPhoneDeviceV1.isPhone());
  }

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
    var tabletUserAgent = /Android|Tablet|SM-T|SM-X|Galaxy Tab/i.test(
      String((navigator && navigator.userAgent) || "")
    );

    return (
      width >= 769 &&
      width <= 1800 &&
      (touchPoints > 0 || coarsePointer || noHover || tabletUserAgent)
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
      if (source && target) {
        target.value = source.value || "";
        target.placeholder = source.placeholder || target.placeholder;
        target.setAttribute("aria-label", source.getAttribute("aria-label") || target.placeholder);
        var originalRow = source.closest(".row");
        var sheetRow = target.closest(".v6-detail-sheet-row");
        if (sheetRow) sheetRow.hidden = !!(originalRow && originalRow.hidden);
      }
    });
    syncSaleFilters();
    syncPhoneFilters();
  }

  function ensurePhoneFilters(root) {
    if (!isDedicatedPhone() || root.querySelector(".js-phone-filter-actions")) return;
    [
      ["minDeposit", "보증금 · 만원"], ["minRent", "월세 · 만원"],
      ["minPremium", "권리금 · 만원"], ["minArea", "면적 · 평"],
      ["minFloor", "층수"], ["industryFilter", "업종"]
    ].forEach(function (entry) {
      var field = sheetField(entry[0]);
      var row = field && field.closest(".v6-detail-sheet-row");
      if (!row) return;
      var label = document.createElement("label");
      label.className = "js-phone-filter-label js-phone-filter-only";
      label.htmlFor = field.id;
      label.textContent = entry[1];
      row.insertBefore(label, row.firstChild);
    });
    var body = root.querySelector(".v6-detail-sheet-body");
    var advanced = document.createElement("details");
    advanced.className = "js-phone-filter-advanced js-phone-filter-only";
    advanced.innerHTML = '<summary>출처 · 매물 구분 · 중개보수</summary>';
    PHONE_TOOLBAR_IDS.forEach(function (id, index) {
      var label = document.createElement("label");
      label.textContent = ["출처", "매물 구분", "중개보수 · 만원"][index];
      var select = document.createElement("select");
      select.id = "v6DetailSheet_" + id;
      select.setAttribute("aria-label", label.textContent);
      label.appendChild(select);
      advanced.appendChild(label);
    });
    body.appendChild(advanced);
    var status = document.createElement("p");
    status.className = "js-phone-filter-status js-phone-filter-only";
    status.setAttribute("aria-live", "polite");
    body.appendChild(status);
    var footer = document.createElement("footer");
    footer.className = "js-phone-filter-actions js-phone-filter-only";
    footer.innerHTML = '<button type="button" class="js-phone-filter-reset">조건 초기화</button>' +
      '<button type="button" class="js-phone-filter-apply">필터 적용</button>';
    root.querySelector(".v6-detail-sheet").appendChild(footer);
  }

  function syncPhoneFilters() {
    if (!isDedicatedPhone()) return;
    var root = document.getElementById("v6DetailSheetPortal");
    if (!root) return;
    ensurePhoneFilters(root);
    PHONE_TOOLBAR_IDS.forEach(function (id) {
      var source = originalField(id);
      var target = sheetField(id);
      if (!source || !target) return;
      target.textContent = "";
      Array.prototype.forEach.call(source.options, function (option) {
        var copy = document.createElement("option");
        copy.value = option.value;
        copy.textContent = option.value === "" ? "전체" : option.textContent;
        copy.disabled = option.disabled;
        target.appendChild(copy);
      });
      target.value = source.value;
    });
    var price = sheetField("minDeposit");
    var priceLabel = price && price.closest(".v6-detail-sheet-row").querySelector(".js-phone-filter-label");
    if (priceLabel) priceLabel.textContent = /매매/.test(price.placeholder) ? "매매가 · 만원" : "보증금 · 만원";
    var status = root.querySelector(".js-phone-filter-status");
    if (status) status.textContent = "조건을 바꾼 뒤 필터 적용을 눌러 주세요.";
  }

  function resetPhoneDraft() {
    if (!isDedicatedPhone()) return;
    FIELD_IDS.concat(PHONE_TOOLBAR_IDS).forEach(function (id) {
      var field = sheetField(id);
      if (field) field.value = "";
    });
    // The sale controls retain their original IDs and cancellation snapshot.
    var sale = document.getElementById("saleFiltersV1");
    if (sale) sale.querySelectorAll("input, select, textarea").forEach(function (field) { field.value = ""; });
    var status = document.querySelector("#v6DetailSheetPortal .js-phone-filter-status");
    if (status) status.textContent = "조건을 초기화했습니다. 필터 적용을 누르면 반영됩니다.";
  }

  function syncSaleFilters() {
    var source = document.getElementById("saleFiltersV1");
    var target = document.getElementById("v6DetailSheetSaleFilters");
    if (!source || !target) return;
    // Move the actual controls, preserving IDs, values, handlers and the shared
    // sale-workbench state. Never create a second copy of the sale filters.
    if (!saleFilterAnchor && source.parentNode !== target) {
      saleFilterAnchor = document.createComment("mobile-sale-filter-return");
      source.parentNode.insertBefore(saleFilterAnchor, source);
    }
    if (source.parentNode !== target) target.appendChild(source);
  }

  function captureSaleFilterValues() {
    var source = document.getElementById("saleFiltersV1");
    saleFilterSnapshot = source ? Array.prototype.map.call(source.querySelectorAll("input, select, textarea"), function(field) {
      return {field: field, value: field.value, checked: field.checked};
    }) : [];
  }

  function finishSaleFilterEdit(applied) {
    if (!applied && saleFilterSnapshot) {
      saleFilterSnapshot.forEach(function(saved) {
        saved.field.value = saved.value;
        if (typeof saved.checked === "boolean") saved.field.checked = saved.checked;
      });
    }
    saleFilterSnapshot = null;
  }

  function restoreSaleFilters() {
    var source = document.getElementById("saleFiltersV1");
    if (source && saleFilterAnchor && saleFilterAnchor.parentNode) {
      saleFilterAnchor.parentNode.insertBefore(source, saleFilterAnchor);
      saleFilterAnchor.remove();
      saleFilterAnchor = null;
    }
  }

  function syncToOriginal() {
    FIELD_IDS.forEach(function (id) {
      var source = sheetField(id);
      var target = originalField(id);
      if (source && target) target.value = source.value || "";
    });
    if (isDedicatedPhone()) PHONE_TOOLBAR_IDS.forEach(function (id) {
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
          '<div id="v6DetailSheetSaleFilters"></div>' +
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
      var applyTarget = event.target.closest(".v6-detail-sheet-apply, .js-phone-filter-apply");
      var resetTarget = event.target.closest(".js-phone-filter-reset");

      if (closeTarget) {
        close();
      } else if (applyTarget) {
        apply();
      } else if (resetTarget) {
        resetPhoneDraft();
      }

      event.stopPropagation();
    }, false);

    root.addEventListener("keydown", function (event) {
      if (window.JSDialogFocusV1 && window.JSDialogFocusV1.handleKeydown(root, event, close)) return;
      if (event.key === "Enter" && event.target.matches("input")) {
        event.preventDefault();
        apply();
      }
      if (event.key === "Escape") { event.stopPropagation(); close(); }
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
    /* 우측 사이드바에서도 화면 밖으로 밀리지 않도록 버튼 기준으로 고정합니다. */
    var popupWidth = Math.min(440, Math.max(320, viewportWidth - margin * 2));
    var left = Math.max(
      margin,
      Math.min(rect.left, viewportWidth - popupWidth - margin)
    );

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
    if (!root.classList.contains("open")) captureSaleFilterValues();
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
    if (window.JSDialogFocusV1) window.JSDialogFocusV1.activate(root, root.querySelector(".v6-detail-sheet-close"));
  }

  function close(options) {
    var root = document.getElementById("v6DetailSheetPortal");
    var wasOpen = !!(root && root.classList.contains("open"));
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
    finishSaleFilterEdit(!!(options && options.applied));
    restoreSaleFilters();
    if (wasOpen && window.JSDialogFocusV1) window.JSDialogFocusV1.deactivate(root);
  }

  function toggle() {
    if (!useDetailSheet()) return;
    var root = ensureSheet();
    if (root.classList.contains("open")) close();
    else open();
  }

  function apply() {
    // Draft edits must not leak into shared filters if validation rejects them.
    var previous = isDedicatedPhone() ? FIELD_IDS.concat(PHONE_TOOLBAR_IDS).map(function (id) {
      var field = originalField(id);
      return field ? {field: field, value: field.value} : null;
    }).filter(Boolean) : [];
    syncToOriginal();
    var applied = false;
    try {
      applied = typeof window.applyFilter !== "function" || window.applyFilter() !== false;
    } finally {
      if (!applied) previous.forEach(function (saved) { saved.field.value = saved.value; });
    }
    if (!applied) return;
    close({applied: true});
  }

  window.addEventListener("js-listing-trade-mode-change", function() {
    var root = document.getElementById("v6DetailSheetPortal");
    if (root && root.classList.contains("open")) {
      captureSaleFilterValues();
      syncToSheet();
    }
  });

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
