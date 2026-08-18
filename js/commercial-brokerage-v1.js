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

    var ranges = {
      fee0to100: { minExclusive: -1, maxInclusive: 100 },
      fee100to200: { minExclusive: 100, maxInclusive: 200 },
      fee200to300: { minExclusive: 200, maxInclusive: 300 },
      fee300to500: { minExclusive: 300, maxInclusive: 500 },
      feeOver500: { minExclusive: 500, maxInclusive: Infinity },

      /* 이전 브라우저 DOM을 잠깐 재사용해도 새 구간 의미로 안전하게 동작합니다. */
      lte100: { minExclusive: -1, maxInclusive: 100 },
      lte200: { minExclusive: 100, maxInclusive: 200 },
      lte300: { minExclusive: 200, maxInclusive: 300 },
      lte500: { minExclusive: 300, maxInclusive: 500 },
      gt500: { minExclusive: 500, maxInclusive: Infinity }
    };
    var range = ranges[value];
    if (!range) return false;
    return calculation.maximumFee > range.minExclusive &&
      calculation.maximumFee <= range.maxInclusive;
  }

  global.JSCommercialBrokerageV1 = Object.freeze({
    calculateMaximumFee: calculateMaximumFee,
    matchesFilter: matchesFilter,
    maximumRate: COMMERCIAL_LEASE_MAX_RATE
  });
})(typeof window !== "undefined" ? window : globalThis);
