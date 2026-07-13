/* JS부동산 v6.0 STEP3.1 - 모바일 상세필터 포털 안정화 */
(function () {
  "use strict";

  var placeholder = null;
  var originalParent = null;
  var originalNextSibling = null;
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

  function ensureDim() {
    var dim = document.getElementById("v6DetailPortalDim");
    if (dim) return dim;
    dim = document.createElement("div");
    dim.id = "v6DetailPortalDim";
    dim.className = "v6-detail-portal-dim";
    dim.addEventListener("click", close);
    document.body.appendChild(dim);
    return dim;
  }

  function moveToBody(target) {
    if (!target || target.parentNode === document.body) return;
    originalParent = target.parentNode;
    originalNextSibling = target.nextSibling;
    placeholder = document.createComment("v6-detail-filter-placeholder");
    originalParent.insertBefore(placeholder, target);
    document.body.appendChild(target);
  }

  function restorePosition(target) {
    if (!target || !originalParent) return;
    if (placeholder && placeholder.parentNode === originalParent) {
      originalParent.insertBefore(target, placeholder);
      placeholder.remove();
    } else if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
      originalParent.insertBefore(target, originalNextSibling);
    } else {
      originalParent.appendChild(target);
    }
    placeholder = null;
    originalParent = null;
    originalNextSibling = null;
  }

  function open() {
    if (!isPhone()) return;
    var target = panel();
    var trigger = button();
    if (!target || !trigger) return;

    moveToBody(target);
    target.classList.add("open", "v6-detail-portal-open");
    target.setAttribute("aria-hidden", "false");
    trigger.classList.add("on");
    trigger.setAttribute("aria-expanded", "true");
    ensureDim().classList.add("open");
    document.body.classList.add("v6-detail-portal-lock");
    opened = true;

    window.requestAnimationFrame(function () {
      var firstInput = target.querySelector("input");
      if (firstInput) firstInput.focus({ preventScroll: true });
    });
  }

  function close() {
    var target = panel();
    var trigger = button();
    var dim = document.getElementById("v6DetailPortalDim");

    if (target) {
      target.classList.remove("v6-detail-portal-open", "open");
      target.setAttribute("aria-hidden", "true");
      restorePosition(target);
    }
    if (trigger) {
      trigger.classList.remove("on");
      trigger.setAttribute("aria-expanded", "false");
    }
    if (dim) dim.classList.remove("open");
    document.body.classList.remove("v6-detail-portal-lock");
    opened = false;
  }

  function toggle(event) {
    if (!isPhone()) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    }
    if (opened) close();
    else open();
  }

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
    if (!isPhone() && opened) close();
  });

  window.JSV6MobileDetailFix = { open: open, close: close, toggle: toggle };
})();
