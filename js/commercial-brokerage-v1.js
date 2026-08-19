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

    var filters = {
      feeAtMost100: function(fee) { return fee <= 100; },
      feeAtLeast100: function(fee) { return fee >= 100; },
      feeAtLeast200: function(fee) { return fee >= 200; },
      feeAtLeast300: function(fee) { return fee >= 300; },
      feeAtLeast500: function(fee) { return fee >= 500; },

      /* 이전 화면이 잠깐 남아 있어도 각 선택 순서를 새 누적 하한 의미로 연결합니다. */
      fee0to100: function(fee) { return fee <= 100; },
      fee100to200: function(fee) { return fee >= 100; },
      fee200to300: function(fee) { return fee >= 200; },
      fee300to500: function(fee) { return fee >= 300; },
      feeOver500: function(fee) { return fee >= 500; },
      lte100: function(fee) { return fee <= 100; },
      lte200: function(fee) { return fee >= 100; },
      lte300: function(fee) { return fee >= 200; },
      lte500: function(fee) { return fee >= 300; },
      gt500: function(fee) { return fee >= 500; }
    };
    var filter = filters[value];
    return typeof filter === "function" && filter(calculation.maximumFee);
  }

  global.JSCommercialBrokerageV1 = Object.freeze({
    calculateMaximumFee: calculateMaximumFee,
    matchesFilter: matchesFilter,
    maximumRate: COMMERCIAL_LEASE_MAX_RATE
  });
})(typeof window !== "undefined" ? window : globalThis);
