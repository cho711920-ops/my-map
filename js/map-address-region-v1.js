/* Road -> parcel lookup is presentation metadata, never a listing/key rewrite. */
(function(global) {
  "use strict";
  var storageKey = "JS_MAP_PARCEL_REGIONS_V1";
  var ttl = 30 * 86400000;
  var cache = Object.create(null), pending = Object.create(null), retryAt = Object.create(null);
  var queue = [], running = false, notifyTimer = null, onReady = null;

  function roadParts(address) {
    var text = String(address || "").replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
    var city = text.match(/^([가-힣]+(?:특별자치시|특별자치도|광역시|특별시|시|도))\s/);
    if (city && city[1] !== "대전광역시" && city[1] !== "대전시") return null;
    if (/^(?:서울|부산|대구|인천|광주|울산|세종|경기|충북|충남|전북|전남|경북|경남|강원|제주)(?:\s|$)/.test(text)) return null;
    var district = text.match(/(?:^|\s)(동구|중구|서구|유성구|대덕구)(?=\s)/);
    var road = text.match(/(?:^|\s)([가-힣0-9·.\-]+(?:로|길))\s+(\d+(?:-\d+)?)(?=\s|$)/);
    if (!district || !road) return null;
    var number = road[2].split("-").map(function(n) { return String(Number(n)); }).join("-");
    var key = "대전광역시 " + district[1] + " " + road[1] + " " + number;
    return {key: key, district: district[1]};
  }

  function validParcel(parcel, district) {
    var text = String(parcel || "").replace(/\s+/g, " ").trim();
    return /^(?:대전광역시|대전)\s/.test(text) &&
      text.indexOf(" " + district + " ") >= 0 &&
      /\s[가-힣]+\d*(?:동|가)\s+(?:산\s*)?\d+(?:-\d+)?$/.test(text);
  }

  try {
    var saved = JSON.parse(global.localStorage.getItem(storageKey) || "{}");
    Object.keys(saved).slice(-2000).forEach(function(key) {
      var entry = saved[key], road = roadParts(key), age = Date.now() - Number(entry && entry.at);
      if (road && road.key === key && age >= 0 && age < ttl && validParcel(entry.parcel, road.district)) cache[key] = entry;
    });
  } catch (_) {}

  function read(address) {
    var road = roadParts(address), entry = road && cache[road.key];
    return entry && Date.now() - entry.at < ttl ? entry.parcel : "";
  }

  function notify() {
    if (notifyTimer) return;
    notifyTimer = global.setTimeout(function() {
      notifyTimer = null;
      var keys = Object.keys(cache);
      keys.slice(0, Math.max(0, keys.length - 2000)).forEach(function(key) { delete cache[key]; });
      try { global.localStorage.setItem(storageKey, JSON.stringify(cache)); } catch (_) {}
      if (onReady) onReady();
    }, 600);
  }

  function next() {
    if (running || !queue.length) return;
    running = true;
    var task = queue.shift(), finished = false;
    var timer = global.setTimeout(function() { finish(null); }, 8000);
    function finish(parcel) {
      if (finished) return;
      finished = true;
      global.clearTimeout(timer);
      delete pending[task.road.key];
      if (parcel) {
        cache[task.road.key] = {parcel: parcel, at: Date.now()};
        notify();
      } else retryAt[task.road.key] = Date.now() + 5 * 60000;
      // One unique address in flight, with a short gap. No per-ad requests.
      global.setTimeout(function() { running = false; next(); }, 200);
    }
    try {
      var services = global.kakao && global.kakao.maps && global.kakao.maps.services;
      task.geocoder.addressSearch(task.road.key, function(rows, status) {
        if (finished) return;
        if (!services || status !== services.Status.OK) return finish(null);
        var parcels = new Set();
        (rows || []).forEach(function(row) {
          var matched = roadParts(row.road_address && row.road_address.address_name);
          var parcel = row.address && row.address.address_name;
          if (matched && matched.key === task.road.key && validParcel(parcel, task.road.district)) parcels.add(parcel);
        });
        // Similar roads, another city, another house number or ambiguous results
        // must not silently move a listing into a guessed neighborhood.
        finish(parcels.size === 1 ? Array.from(parcels)[0] : null);
      }, {analyze_type: services && services.AnalyzeType ? services.AnalyzeType.EXACT : "exact", size: 5});
    } catch (_) { finish(null); }
  }

  function request(groups, geocoder, callback) {
    if (!geocoder || typeof geocoder.addressSearch !== "function") return;
    onReady = callback;
    (groups || []).forEach(function(group) {
      if (queue.length >= 100) return;
      var road = roadParts(group.address || group.key);
      if (!road || read(road.key) || pending[road.key] || Date.now() < (retryAt[road.key] || 0)) return;
      pending[road.key] = true;
      queue.push({road: road, geocoder: geocoder});
    });
    next();
  }

  global.JSMapAddressRegionV1 = {read: read, request: request};
})(window);
