/* This file is served only by the loopback test server, never by production. */
(function() {
  "use strict";
  // Substitute only the external map SDK boundary. Filtering, card rendering,
  // detail toggling, favorite persistence and mobile controls are real modules.
  window.map = {getBounds: function() {return {contain: function() {return true;}};}, getLevel: function() {return 5;}};
  window.drawItems = function(items) {window.showList(items);};
  window.selectListingOnMapV844 = function() {};
  window.clearPinnedClusterSelectionV6515 = function() {};
  window.openItem = function(item) {window.JSUnifiedListingsV8.open(encodeURIComponent(item.propertyId));};
  window.allItems = window.__fixtureItems.map(function(item) {
    return Object.assign({}, item, {latlng: {getLat: function() {return 36.35;}, getLng: function() {return 127.38;}}});
  });
  window.jsInitialFullListingsLoadingV1 = false;
  var originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    var checkbox = document.getElementById("fixtureQuotaFailure");
    if (key === "js_async_mutation_outbox_v1" && checkbox && checkbox.checked) throw new DOMException("Fixture quota", "QuotaExceededError");
    return originalSetItem.call(this, key, value);
  };
  document.querySelector("#fixtureModules").textContent = " · 찜UI " + (typeof window.openListManager === "function" ? "준비" : "누락") + " / 찜저장 " + (window.JSV6ListStore ? "준비" : "누락");
  document.querySelector("#fixtureSave").addEventListener("click", function() {
    var result = document.querySelector("#fixtureSaveResult");
    result.textContent = "";
    window.JSAsyncMutations.enqueue("updatePropertyMemo", {propertyId: "FIXTURE-LEASE-1", memo: "fixture"})
      .then(function() {result.textContent = "전송 대기 접수";}, function() {result.textContent = "저장 실패 · 다시 시도";});
  });
  window.JSUnifiedListingsV8.load(true).then(function(result) {
    window.JSUnifiedListingsV8.attach(window.allItems, result);
    window.applyFilter();
    window.setupEnterSearch();
    if (window.JSLocalMetricsV1) window.JSLocalMetricsV1.markFirstData();
    document.documentElement.dataset.fixtureReady = "true";
  }).catch(function(error) {
    document.documentElement.dataset.fixtureError = error.message;
    console.error(error);
  });
})();
