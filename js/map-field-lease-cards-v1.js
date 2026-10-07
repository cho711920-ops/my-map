/* Field-mode presentation only. Reuse filtered master listings, never fetch
 * provider details or change saved listings/folders while following GPS. */
(function (global) {
  "use strict";
  var numberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
  var pendingLayout = false;
  var previousOffsets = Object.create(null);

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
    return '<div class="field-lease-anchor-v1' + esc(classNames || "") + '" data-field-lease-key="' + encoded(cluster.key) + '">' +
      '<svg class="field-lease-leader-v1" width="1" height="1" aria-hidden="true" focusable="false">' +
      '<line class="field-lease-connector-halo-v1" x1="0" y1="-11" x2="0" y2="0"/>' +
      '<line class="field-lease-connector-v1" x1="0" y1="-11" x2="0" y2="0"/>' +
      '<path class="field-lease-tail-v1" d="M -5 -20 L 0 -11 L 5 -20"/></svg>' +
      '<span class="field-lease-location-v1" aria-hidden="true"></span>' +
      '<div class="field-lease-card-v1' + esc(classNames || "") + '" role="group" aria-label="임대조건 · 금액 단위 만원">' +
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
        '외 ' + (items.length - preview.length) + '개 더 보기</button>' : '') + '</div></div>';
  }

  function clamp(value, low, high) { return Math.max(low, Math.min(Math.max(low, high), value)); }
  function intersection(a, b) {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }

  // Bounded, deterministic label placement. Never move a geographic anchor or
  // hide a listing when a very dense viewport has no completely empty space.
  function planLayout(rows, width, height) {
    var ordered = rows.slice().sort(function (a, b) {
      return Number(!!b.selected) - Number(!!a.selected) || String(a.key).localeCompare(String(b.key));
    });
    var primary = placeRows(ordered, rows, width, height);
    // In a short landscape viewport, a cached small selected card can split
    // all space usable by a tall building card. Retry once with large cards
    // first, only for small groups and only if the stable layout has collisions.
    if (primary.overlap > 0 && rows.length > 1 && rows.length <= 24) {
      var packed = placeRows(rows.slice().sort(function (a, b) {
        return b.width * b.height - a.width * a.height || String(a.key).localeCompare(String(b.key));
      }).map(function (row) { return Object.assign({}, row, {previous: null}); }), rows, width, height);
      if (packed.overlap < primary.overlap) return packed.positions;
    }
    return primary.positions;
  }

  function placeRows(ordered, rows, width, height) {
    var placed = [];
    var totalOverlap = 0;
    var positions = ordered.map(function (row) {
      var w = row.width, h = row.height, p = row.point;
      var base = {x: -w / 2, y: -h - 20};
      var candidates = [];
      if (row.previous && Number.isFinite(row.previous.x) && Number.isFinite(row.previous.y)) candidates.push(row.previous);
      candidates.push(base, {x: -w - 20, y: -h / 2}, {x: 20, y: -h / 2}, {x: -w / 2, y: 20});
      for (var ring = 1; ring <= 2; ring += 1) {
        for (var dx = -1; dx <= 1; dx += 1) {
          for (var dy = -1; dy <= 1; dy += 1) {
            if (dx || dy) candidates.push({x: base.x + dx * (w + 12) * ring, y: base.y + dy * (h + 12) * ring});
          }
        }
      }
      var best = null;
      var triedEdges = false;
      for (var i = 0; i < candidates.length; i += 1) {
        var left = clamp(p.x + candidates[i].x, 8, width - w - 8);
        var top = clamp(p.y + candidates[i].y, 8, height - h - 8);
        var box = {left: left, top: top, right: left + w, bottom: top + h};
        var padded = {left: left - 5, top: top - 5, right: left + w + 5, bottom: top + h + 5};
        var overlap = placed.reduce(function (sum, other) { return sum + intersection(padded, other); }, 0);
        // Do not cover this or another visible property's ground point merely
        // to find room for a label. Tiny/hyper-dense screens degrade without loss.
        overlap += rows.reduce(function (sum, other) {
          return sum + intersection(padded, {left: other.point.x - 6, top: other.point.y - 6,
            right: other.point.x + 6, bottom: other.point.y + 6}) * 4;
        }, 0);
        var candidate = {key: row.key, x: left - p.x, y: top - p.y, width: w, height: h, box: box, overlap: overlap};
        if (!best || overlap < best.overlap) best = candidate;
        // Prefer the cached offset, then the nearest simple placements.
        if (overlap === 0) break;
        if (i === candidates.length - 1 && !triedEdges) {
          triedEdges = true;
          // Short and tall multi-row cards can block every fixed ring even
          // though room remains just beyond an obstacle. Search the edges of
          // at most eight nearby labels; keep the fallback work bounded.
          placed.slice().sort(function (a, b) {
            return Math.hypot((a.left + a.right) / 2 - p.x, (a.top + a.bottom) / 2 - p.y) -
              Math.hypot((b.left + b.right) / 2 - p.x, (b.top + b.bottom) / 2 - p.y);
          }).slice(0, 8).forEach(function (obstacle) {
            var nearX = clamp(p.x - w / 2, obstacle.left - w + 16, obstacle.right - 16);
            var nearY = clamp(p.y - h / 2, obstacle.top - h + 16, obstacle.bottom - 16);
            candidates.push(
              {x: nearX - p.x, y: obstacle.top - h - 10 - p.y},
              {x: nearX - p.x, y: obstacle.bottom + 10 - p.y},
              {x: obstacle.left - w - 10 - p.x, y: nearY - p.y},
              {x: obstacle.right + 10 - p.x, y: nearY - p.y}
            );
          });
        }
      }
      totalOverlap += best.overlap;
      placed.push(best.box);
      return {key: best.key, x: best.x, y: best.y, width: w, height: h};
    });
    return {positions: positions, overlap: totalOverlap};
  }

  function leaderFor(x, y, width, height) {
    var right = x + width, bottom = y + height;
    // Project the anchor onto the nearest edge, avoiding rounded corners.
    var options = [
      {x: clamp(0, x + 8, right - 8), y: y},
      {x: clamp(0, x + 8, right - 8), y: bottom},
      {x: x, y: clamp(0, y + 8, bottom - 8)},
      {x: right, y: clamp(0, y + 8, bottom - 8)}
    ];
    options.sort(function (a, b) { return a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y; });
    var start = options[0];
    var length = Math.hypot(start.x, start.y);
    var ux = length ? -start.x / length : 0, uy = length ? -start.y / length : 1;
    var tipX = start.x + ux * Math.min(9, length), tipY = start.y + uy * Math.min(9, length);
    function n(value) { return Math.round(value * 100) / 100; }
    return {x: start.x, y: start.y, tipX: tipX, tipY: tipY,
      tailPath: "M " + n(start.x - uy * 5) + " " + n(start.y + ux * 5) +
        " L " + n(tipX) + " " + n(tipY) + " L " + n(start.x + uy * 5) + " " + n(start.y - ux * 5)};
  }

  function layout() {
    pendingLayout = false;
    if (!active() || typeof document === "undefined") { previousOffsets = Object.create(null); return; }
    var viewport = document.getElementById("map");
    var projection = typeof global.getMapDisplayProjectionV1 === "function" ? global.getMapDisplayProjectionV1() : null;
    if (!viewport || !projection || !viewport.clientWidth || !viewport.clientHeight) return;
    var clustersByKey = Object.create(null);
    (global.overlays || []).forEach(function (overlay) {
      if (overlay.__cluster && overlay.__cluster.fieldLease) clustersByKey[encoded(overlay.__cluster.key)] = overlay.__cluster;
    });
    // Read all sizes/projections before the first DOM write to avoid layout
    // thrashing. No observers on cards, network calls, or per-animation-frame work.
    var rows = Array.from(viewport.querySelectorAll(".field-lease-anchor-v1")).map(function (node) {
      var key = node.getAttribute("data-field-lease-key"), cluster = clustersByKey[key];
      var card = node.querySelector(".field-lease-card-v1");
      var point = cluster && projection.containerPointFromCoords(cluster.latlng);
      if (!card || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      return {key: key, node: node, card: card, point: point, width: card.offsetWidth, height: card.offsetHeight,
        selected: card.classList.contains("selected"), previous: previousOffsets[key]};
    }).filter(function (row) { return row && row.width > 0 && row.height > 0; });
    var usableWidth = viewport.clientWidth;
    var rail = document.getElementById("mapQuickTools");
    if (rail && typeof rail.getBoundingClientRect === "function" && typeof viewport.getBoundingClientRect === "function") {
      var railRect = rail.getBoundingClientRect(), mapRect = viewport.getBoundingClientRect();
      var railLeft = railRect.left - mapRect.left;
      // Keep shifted labels out from under the fixed right-hand map tools.
      // Hidden portrait controls have zero size and reserve no map space.
      if (railRect.width > 0 && railRect.height > 0 && railLeft > usableWidth / 2 && railLeft < usableWidth) {
        usableWidth = railLeft - 4;
      }
    }
    var byKey = Object.create(null), nextOffsets = Object.create(null);
    rows.forEach(function (row) { byKey[row.key] = row; });
    planLayout(rows, usableWidth, viewport.clientHeight).forEach(function (position) {
      var row = byKey[position.key];
      var leader = leaderFor(position.x, position.y, position.width, position.height);
      row.card.style.left = position.x + "px";
      row.card.style.top = position.y + "px";
      row.card.style.transform = "none";
      row.node.querySelectorAll("line").forEach(function (line) {
        line.setAttribute("x1", leader.tipX);
        line.setAttribute("y1", leader.tipY);
      });
      row.node.querySelector(".field-lease-tail-v1").setAttribute("d", leader.tailPath);
      nextOffsets[row.key] = {x: position.x, y: position.y};
    });
    previousOffsets = nextOffsets;
  }

  function scheduleLayout() {
    if (pendingLayout || typeof global.requestAnimationFrame !== "function") return;
    pendingLayout = true;
    global.requestAnimationFrame(layout);
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

  global.JSFieldLeaseCardsV1 = { active: active, clusters: clusters, content: content, open: open, more: more, lines: lines,
    scheduleLayout: scheduleLayout, planLayout: planLayout, leaderFor: leaderFor };
  if (typeof document !== "undefined" && document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleLayout);
})(window);
