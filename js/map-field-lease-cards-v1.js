/* Field-mode presentation only. Reuse filtered master listings, never fetch
 * provider details or change saved listings/folders while following GPS. */
(function (global) {
  "use strict";
  var numberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

  function active() {
    // While waiting for GPS the map can still show the whole city. Never turn
    // thousands of distant buildings into cards before entering field zoom.
    var level = global.map && typeof global.map.getLevel === "function" ? Number(global.map.getLevel()) : 0;
    var fieldState = global.JSFieldModeV1 && typeof global.JSFieldModeV1.state === "function"
      ? global.JSFieldModeV1.state() : null;
    return !!(global.JSFieldModeV1 && global.JSFieldModeV1.isFollowing() &&
      level >= 1 && level <= 2 && (!fieldState || fieldState.scale === 20 || fieldState.scale === 30) &&
      (!global.JSListingTradeV1 || global.JSListingTradeV1.getMode() === "lease"));
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (letter) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[letter];
    });
  }

  function encoded(value) { return encodeURIComponent(String(value || "")).replace(/'/g, "%27"); }
  function identity(item) { return item.propertyId ? "id:" + item.propertyId : "key:" + item.key; }

  function number(item, field) {
    var value = item[field];
    if (item.displayValuePresence && item.displayValuePresence[field] === false ||
        value == null || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0) return "-";
    return numberFormatter.format(Number(value));
  }

  function lines(item) {
    var room = typeof global.formatListingRoomForCardV653 === "function"
      ? global.formatListingRoomForCardV653(item.room) : String(item.room || "").trim();
    var area = Number(item.area) > 0 ? number(item, "area") : "-";
    return {
      top: (room || "층수 -") + " · " + (area === "-" ? "평수 -" : area + "평"),
      bottom: "보 " + number(item, "deposit") + " / 월 " + number(item, "rent")
    };
  }

  function compare(first, second) {
    var floor = typeof global.getItemFloorNumber === "function" ? global.getItemFloorNumber : function () { return null; };
    var a = floor(first), b = floor(second);
    if (a == null && b != null) return 1;
    if (a != null && b == null) return -1;
    if (a != null && b != null && a !== b) return a - b;
    return identity(first).localeCompare(identity(second));
  }

  function clusters(addressGroups) {
    return addressGroups.map(function (group) {
      var items = group.items.filter(function (item) {
        return global.JSListingTradeV1 ? global.JSListingTradeV1.matchesItem(item, "lease")
          : !/^(sale|buy|매매)$/i.test(String(item.tradeType || item.trade_type || ""));
      });
      return { key: group.key + "|field-lease", groups: [group],
        latlng: group.latlng, items: items.sort(compare), fieldLease: true };
    }).filter(function (cluster) { return cluster.items.length > 0; });
  }

  function content(cluster, classNames) {
    var items = cluster.items || [];
    // Keep the current property reachable when the same building has many ads.
    var preview = items.slice(0, 3);
    var selected = items.find(function (item) {
      if (typeof global.isLinkedListingSelectedV845 === "function") return global.isLinkedListingSelectedV845(item);
      return item.key && item.key === global.selectedItemKey;
    });
    if (selected && preview.indexOf(selected) < 0) preview[2] = selected;
    return '<div class="field-lease-card-v1' + esc(classNames || "") + '" role="group" aria-label="임대조건 · 금액 단위 만원">' +
      preview.map(function (item) {
        var label = lines(item);
        var done = typeof global.isDone === "function" && global.isDone(item);
        return '<button type="button" class="field-lease-row-v1' +
          (done ? ' done' : '') + (item === selected ? ' selected' : '') + '" ' +
          'title="' + esc(label.top + " · " + label.bottom + "만원" + (done ? " · 계약완료" : "")) + '" ' +
          'aria-label="' + esc(label.top + " · " + label.bottom + "만원 · " + (done ? "계약완료 · " : "") + "상세 보기") + '" ' +
          'onclick="event.stopPropagation(); JSFieldLeaseCardsV1.open(\'' + encoded(cluster.key) + '\',\'' + encoded(identity(item)) + '\')">' +
          '<span class="field-lease-top-v1">' + esc(label.top) + '</span>' +
          '<strong class="field-lease-price-v1">' + esc(label.bottom) + '</strong>' +
          (done ? '<small>계약완료</small>' : '') + '</button>';
      }).join("") +
      (items.length > preview.length ? '<button type="button" class="field-lease-more-v1" ' +
        'onclick="event.stopPropagation(); JSFieldLeaseCardsV1.more(\'' + encoded(cluster.key) + '\')">' +
        '외 ' + (items.length - preview.length) + '개 더 보기</button>' : '') + '</div>';
  }

  function findCluster(key) {
    if (!active()) return null;
    var overlay = (global.overlays || []).find(function (entry) {
      return entry.__cluster && entry.__cluster.fieldLease && entry.__cluster.key === key;
    });
    return overlay && overlay.__cluster;
  }

  function open(key, itemId) {
    var cluster, id;
    try { cluster = findCluster(decodeURIComponent(key)); id = decodeURIComponent(itemId); } catch (_) { return false; }
    var item = cluster && cluster.items.find(function (entry) { return identity(entry) === id; });
    if (!item) return false;
    // A previous building's "more" selection must not win on the next GPS
    // redraw. Keep multi-selection semantics; otherwise pin this exact group.
    if (!global.multiClusterMode && typeof global.clearPinnedClusterSelectionV6515 === "function") global.clearPinnedClusterSelectionV6515(false);
    if (!global.multiClusterMode && typeof global.showList === "function") global.showList(cluster.items);
    if (typeof global.selectListingOnMapV844 === "function") global.selectListingOnMapV844(item);
    if (!global.multiClusterMode && typeof global.pinCurrentClusterSelectionV6515 === "function") global.pinCurrentClusterSelectionV6515();
    if (global.multiClusterMode && global.jsPinnedClusterSelectionV6515 &&
        global.jsPinnedClusterSelectionV6515.snapshot && typeof global.getStableItemIdentityV638 === "function") {
      global.jsPinnedClusterSelectionV6515.snapshot.selectedItemIdentity = global.getStableItemIdentityV638(item);
    }
    if (item.propertyId && global.JSUnifiedListingsV8) {
      global.JSUnifiedListingsV8.toggleCardDetail(encoded(item.propertyId));
    } else if (typeof global.openCluster === "function") global.openCluster(key);
    return true;
  }

  function more(key) {
    var cluster;
    try { cluster = findCluster(decodeURIComponent(key)); } catch (_) { return false; }
    if (!cluster || typeof global.openCluster !== "function") return false;
    global.openCluster(key);
    return true;
  }

  global.JSFieldLeaseCardsV1 = { active: active, clusters: clusters, content: content, open: open, more: more, lines: lines };
})(window);
