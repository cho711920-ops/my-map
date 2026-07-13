/* JS부동산 v6.0 STEP2.14 - 모바일 상세필터 단독 안정화 */
(function () {
  "use strict";

  function isPhone() { return window.matchMedia("(max-width: 768px)").matches; }
  function panel() { return document.getElementById("detailFilter"); }
  function button() { return document.getElementById("detailBtn"); }

  function ensureDim() {
    var dim = document.getElementById("v6DetailStableDim");
    if (dim) return dim;
    dim = document.createElement("div");
    dim.id = "v6DetailStableDim";
    dim.className = "v6-detail-stable-dim";
    dim.addEventListener("click", close);
    document.body.appendChild(dim);
    return dim;
  }

  function close() {
    var target = panel();
    var trigger = button();
    var dim = document.getElementById("v6DetailStableDim");
    if (target) target.classList.remove("v6-detail-stable-open", "open");
    if (trigger) trigger.classList.remove("on");
    if (dim) dim.classList.remove("open");
    document.body.classList.remove("v6-detail-stable-lock");
  }

  function open() {
    var target = panel();
    var trigger = button();
    if (!target || !trigger) return;
    target.classList.add("open", "v6-detail-stable-open");
    trigger.classList.add("on");
    ensureDim().classList.add("open");
    document.body.classList.add("v6-detail-stable-lock");
  }

  function toggle(event) {
    if (!isPhone()) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    var target = panel();
    if (!target) return;
    if (target.classList.contains("v6-detail-stable-open")) close();
    else open();
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest("#detailBtn") : null;
    if (trigger && isPhone()) {
      toggle(event);
      return;
    }
    if (!isPhone()) return;
    var target = panel();
    if (!target || !target.classList.contains("v6-detail-stable-open")) return;
    if (event.target.closest("#detailFilter")) return;
    close();
  }, true);

  document.addEventListener("click", function (event) {
    if (!isPhone()) return;
    if (event.target && event.target.closest && event.target.closest("#detailFilter .apply-btn")) {
      window.setTimeout(close, 0);
    }
  });

  window.addEventListener("resize", function () { if (!isPhone()) close(); });
  window.JSV6MobileDetailFix = { open: open, close: close, toggle: toggle };
})();
