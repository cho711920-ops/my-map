/* Optional lease-only presentation. Remove this script and its stylesheet to
 * restore the original list; no listing data or event handlers are replaced. */
(function(global) {
  "use strict";
  var root = document.documentElement;
  var storageKey = "js_map_lease_list_view_v80";
  var preference = "small";
  var readingAnchor = null;
  try {
    var savedPreference = global.localStorage.getItem(storageKey);
    if (savedPreference === "small" || savedPreference === "large") preference = savedPreference;
  } catch (_) { /* Keep the in-memory choice when device storage is unavailable. */ }

  var head = document.querySelector(".map-list-panel-head-v1");
  if (!head) return;
  var controls = document.createElement("div");
  controls.id = "leaseListViewV80";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "상가임대 매물목록 크기");
  ["small", "large"].forEach(function(value) {
    var button = document.createElement("button");
    button.type = "button";
    button.dataset.leaseListView = value;
    button.textContent = value === "small" ? "작게 보기" : "크게 보기";
    controls.appendChild(button);
  });
  head.insertBefore(controls, document.getElementById("mapListCloseV1"));

  function isLease() {
    return global.JSListingTradeV1 && global.JSListingTradeV1.getMode() === "lease";
  }

  function sync() {
    controls.hidden = !isLease();
    if (isLease()) root.setAttribute("data-lease-list-view-v80", preference);
    else root.removeAttribute("data-lease-list-view-v80");
    Array.prototype.forEach.call(controls.children, function(button) {
      button.setAttribute("aria-pressed", String(button.dataset.leaseListView === preference));
    });
  }

  controls.addEventListener("click", function(event) {
    var button = event.target.closest("button[data-lease-list-view]");
    if (!button || !controls.contains(button) || !isLease()) return;
    var next = button.dataset.leaseListView;
    if (next === preference) return;
    var apply = function() { preference = next; sync(); };
    if (typeof global.reflowListingDensityV80 === "function") readingAnchor = global.reflowListingDensityV80(apply, true, readingAnchor);
    else apply();
    try { global.localStorage.setItem(storageKey, preference); } catch (_) { /* Display still works. */ }
  });

  function syncMarket() {
    readingAnchor = null;
    // Filtering renders before the market-change event. Re-measure the newly
    // rendered lease rows after enabling the preference, without reloading them.
    if (isLease() && typeof global.reflowListingDensityV80 === "function") global.reflowListingDensityV80(sync, true);
    else sync();
  }
  global.addEventListener("js-listing-trade-mode-change", syncMarket);
  global.addEventListener("js-phone-device-change", syncMarket);
  sync();
})(window);
