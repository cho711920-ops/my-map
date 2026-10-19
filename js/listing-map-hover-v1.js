/* A transient desktop preview, independent of clicked cluster/list selection. */
(function(global) {
  "use strict";
  var list = document.getElementById("list");
  if (!list) return;
  var pointer = global.matchMedia("(any-hover: hover) and (any-pointer: fine)");
  var activeCard = null;
  var overlay = null;
  var overlayMap = null;

  function clear() {
    activeCard = null;
    if (overlay) overlay.setMap(null);
  }

  function preview(event) {
    if (event.pointerType !== "mouse" || event.buttons || !pointer.matches ||
        (global.JSPhoneDeviceV1 && global.JSPhoneDeviceV1.isHandheld()) ||
        document.documentElement.classList.contains("js-map-list-closed-v1")) return clear();
    var card = event.target.closest("#list .item[data-list-index-v1]");
    if (!card || card === activeCard) return;
    // The virtual list may recycle DOM: use the current index and verify identity.
    var index = Number(card.getAttribute("data-list-index-v1"));
    var item = Number.isInteger(index) && index >= 0 && (global.visibleListItems || [])[index];
    var position = item && item.latlng;
    var map = global.map;
    if (!item || card.getAttribute("data-listing-key") !== String(item.key) ||
        typeof global.actionSelectionKeyV660 !== "function" ||
        card.getAttribute("data-list-card-id-v681") !== global.actionSelectionKeyV660(item) ||
        !position || typeof position.getLat !== "function" || typeof position.getLng !== "function" ||
        !Number.isFinite(position.getLat()) || !Number.isFinite(position.getLng()) ||
        Math.abs(position.getLat()) > 90 || Math.abs(position.getLng()) > 180 ||
        !map || typeof map.getBounds !== "function" || !global.kakao ||
        !global.kakao.maps || typeof global.kakao.maps.CustomOverlay !== "function") return clear();
    var bounds = map.getBounds();
    // Never pan to an off-screen listing or look up a missing coordinate.
    if (!bounds || !bounds.contain(position)) return clear();
    if (overlayMap !== map) {
      clear();
      overlay = null;
      overlayMap = map;
    }
    if (!overlay) {
      var marker = document.createElement("div");
      marker.className = "js-listing-hover-pin-v1";
      marker.setAttribute("aria-hidden", "true");
      overlay = new global.kakao.maps.CustomOverlay({
        // Anchor the arrow tip to the listing coordinate, rather than its center.
        content: marker, xAnchor: .5, yAnchor: 1, zIndex: 1200
      });
    }
    overlay.setPosition(position);
    overlay.setMap(map);
    activeCard = card;
  }

  // Only real mouse movement starts a preview. Replacing rows under a stationary
  // cursor can synthesize pointerover, which must not resurrect a cleared marker.
  list.addEventListener("pointermove", preview);
  list.addEventListener("pointerout", function(event) {
    if (activeCard && (!event.relatedTarget || !activeCard.contains(event.relatedTarget))) clear();
  });
  list.addEventListener("pointercancel", clear);
  document.addEventListener("pointerdown", clear, true);
  var sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.addEventListener("scroll", clear, {capture: true, passive: true});
  global.addEventListener("blur", clear);
  global.addEventListener("resize", clear);
  global.addEventListener("js-phone-device-change", clear);
  document.addEventListener("visibilitychange", clear);
  pointer.addEventListener("change", clear);
  new MutationObserver(clear).observe(list, {childList: true});
  new MutationObserver(clear).observe(document.documentElement, {
    attributes: true, attributeFilter: ["class", "data-map-list-panel"]
  });
})(window);
