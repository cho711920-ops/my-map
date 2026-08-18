(function(global) {
  "use strict";

  var COMMERCIAL_LEASE_MAX_RATE = 0.009;
  var LOW_VALUE_THRESHOLD_MANWON = 5000;

  function moneyValue(value) {
    var text = String(value == null ? "" : value).replace(/,/g, "").trim();
    if (!text) return null;
    var number = Number(text);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function calculateMaximumFee(item) {
    var deposit = moneyValue(item && item.deposit);
    var rent = moneyValue(item && item.rent);
    if (deposit === null || rent === null || (deposit === 0 && rent === 0)) return null;

    var standardAmount = deposit + rent * 100;
    var rentMultiplier = standardAmount < LOW_VALUE_THRESHOLD_MANWON ? 70 : 100;
    var transactionAmount = deposit + rent * rentMultiplier;
    var maximumFee = Math.round(transactionAmount * COMMERCIAL_LEASE_MAX_RATE * 10000) / 10000;

    return {
      transactionAmount: transactionAmount,
      maximumFee: maximumFee,
      rate: COMMERCIAL_LEASE_MAX_RATE,
      rentMultiplier: rentMultiplier
    };
  }

  function matchesFilter(item, filterValue) {
    var value = String(filterValue || "");
    if (!value) return true;

    var calculation = calculateMaximumFee(item);
    if (!calculation) return false;

    if (value === "gt500") return calculation.maximumFee > 500;

    var limits = {
      lte100: 100,
      lte200: 200,
      lte300: 300,
      lte500: 500
    };
    var limit = limits[value];
    return Number.isFinite(limit) && calculation.maximumFee <= limit;
  }

  global.JSCommercialBrokerageV1 = Object.freeze({
    calculateMaximumFee: calculateMaximumFee,
    matchesFilter: matchesFilter,
    maximumRate: COMMERCIAL_LEASE_MAX_RATE
  });
})(typeof window !== "undefined" ? window : globalThis);
