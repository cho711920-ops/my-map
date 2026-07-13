/* JS부동산 v6.0 STEP3.2 - 모바일 상세필터 드롭다운 안정화 */
(function () {
  "use strict";

  var opened = false;

  function isPhone() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function panel() {
    return document.getElementById("detailFilter");
  }

  function button() {
    return document.getElementById("detailBtn");
  }

  function removeLegacyLayers() {
    ["v6DetailPortalDim", "v6DetailStableDim", "v6DetailDim"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.classList.remove("open");
    });
    document.body.classList.remove(
      "v6-detail-portal-lock",
      "v6-detail-stable-lock"
    );
  }

  function positionPanel() {
    var target = panel();
    var trigger = button();
    if (!target || !trigger || !opened || !isPhone()) return;

    var rect = trigger.getBoundingClientRect();
    var viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    var left = 8;
    var right = 8;
    var top = Math.max(8, rect.bottom + 6);
    var availableBelow = (window.visualViewport ? window.visualViewport.height : window.innerHeight) - top - 8;

    target.style.setProperty("--v6-detail-left", left + "px");
    target.style.setProperty("--v6-detail-right", right + "px");
    target.style.setProperty("--v6-detail-top", top + "px");
    target.style.setProperty("--v6-detail-max-height", Math.max(220, availableBelow) + "px");
    target.style.setProperty("--v6-detail-width", Math.max(280, viewportWidth - left - right) + "px");
  }

  function open() {
    if (!isPhone()) return;
    var target = panel();
    var trigger = button();
    if (!target || !trigger) return;

    removeLegacyLayers();
    target.classList.remove("v6-detail-portal-open", "v6-detail-stable-open");
    target.classList.add("open", "v6-detail-dropdown-open");
    target.setAttribute("aria-hidden", "false");
    trigger.classList.add("on");
    trigger.setAttribute("aria-expanded", "true");
    opened = true;
    positionPanel();
  }

  function close() {
    var target = panel();
    var trigger = button();
    if (target) {
      target.classList.remove("v6-detail-dropdown-open", "v6-detail-portal-open", "v6-detail-stable-open", "open");
      target.setAttribute("aria-hidden", "true");
      target.removeAttribute("style");
    }
    if (trigger) {
      trigger.classList.remove("on");
      trigger.setAttribute("aria-expanded", "false");
    }
    removeLegacyLayers();
    opened = false;
  }

  function toggle(event) {
    if (!isPhone()) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    }
    if (opened || (panel() && panel().classList.contains("v6-detail-dropdown-open"))) close();
    else open();
  }

  /* 인라인 onclick과 기존 보완 이벤트보다 먼저 처리합니다. */
  document.addEventListener("click", function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest("#detailBtn") : null;
    if (trigger && isPhone()) {
      toggle(event);
      return;
    }

    if (!opened || !isPhone()) return;
    var target = panel();
    if (target && event.target.closest && event.target.closest("#detailFilter")) return;
    close();
  }, true);

  document.addEventListener("click", function (event) {
    if (!opened || !isPhone()) return;
    if (event.target && event.target.closest && event.target.closest("#detailFilter .apply-btn")) {
      window.setTimeout(close, 0);
    }
  });

  window.addEventListener("resize", function () {
    if (!isPhone()) close();
    else if (opened) positionPanel();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      if (opened) positionPanel();
    });
    window.visualViewport.addEventListener("scroll", function () {
      if (opened) positionPanel();
    });
  }

  /* 다른 코드가 호출해도 같은 동작을 사용하도록 마지막에 덮어씁니다. */
  window.toggleDetailFilter = function () {
    if (isPhone()) toggle();
    else {
      var target = panel();
      var trigger = button();
      if (!target || !trigger) return;
      var willOpen = !target.classList.contains("open");
      target.classList.toggle("open", willOpen);
      trigger.classList.toggle("on", willOpen);
      if (willOpen && typeof window.positionDetailFilter === "function") window.positionDetailFilter();
    }
  };

  window.JSV6MobileDetailFix = { open: open, close: close, toggle: toggle };
})();
