/* Recover failed or stalled base-map images only. Keep SDK load listeners, tile origins/paths,
 * transforms, coordinates and listing refresh ownership unchanged. */
(function(global) {
  'use strict';
  var active = null;
  function tileUrl(img) {
    if (!img || img.tagName !== 'IMG') return '';
    try {
      var url = new URL(img.src || img.currentSrc,global.location.href);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        /^(?:mts\d*\.(?:kakaocdn|daumcdn)\.net|map\d*\.daumcdn\.net)$/.test(url.hostname) &&
        /^\/(?:api\/v1\/tile\/|map_(?:2d|skyview|hybrid)\/)/.test(url.pathname) ? url.href : '';
    } catch (_) { return ''; }
  }
  function attach(viewport,map) {
    if (active) active.destroy();
    if (!viewport || !map || !global.kakao || !global.kakao.maps || !global.kakao.maps.event) { active = null; return null; }
    var events = global.kakao.maps.event, known = new WeakMap(), pending = new Set();
    var timer = null, timerAt = 0, moving = false, paused = false, disposed = false;
    var budgetAt = Date.now(), budgetUsed = 0, counters = {errors:0,retries:0,recovered:0};
    var bindings = [], observer = null;
    var stallMs = 10000;
    function blocked() { return disposed || paused || moving || document.visibilityState === 'hidden' || global.navigator.onLine === false; }
    function clearTimer() { if (timer !== null) global.clearTimeout(timer); timer = null; timerAt = 0; }
    function schedule(delay) {
      if (!pending.size || blocked()) return;
      var at = Date.now() + Math.max(0,delay || 0);
      if (timer !== null && timerAt <= at) return;
      clearTimer(); timerAt = at; timer = global.setTimeout(flush,Math.max(0,at - Date.now()));
    }
    function visible(img,box) {
      if (!viewport.isConnected || !img.isConnected || !viewport.contains(img) || !box.width || !box.height) return false;
      // A failed SDK image has zero intrinsic size. Its own rectangle cannot
      // establish visibility. The SDK also waits for buffered edge tiles
      // before completing a layer; recover those along with the visible ones.
      return global.getComputedStyle(viewport).visibility !== 'hidden';
    }
    function current(row) {
      var url = tileUrl(row.img);
      return url === row.url || !!row.retryUrl && url === row.retryUrl;
    }
    function flush() {
      timer = null; timerAt = 0;
      if (blocked()) return;
      var now = Date.now(), next = Infinity, sent = 0, box = viewport.getBoundingClientRect();
      if (now - budgetAt >= 60000) { budgetAt = now; budgetUsed = 0; }
      pending.forEach(function(row) {
        if (now >= row.expires || !current(row) || row.img.complete && row.img.naturalWidth > 0 || row.attempts >= 2) { pending.delete(row); return; }
        // Pause a hidden map, but include the SDK's connected buffer tiles.
        if (!visible(row.img,box)) return;
        if (row.nextAt > now) { next = Math.min(next,row.nextAt); return; }
        if (budgetUsed >= 32) { next = Math.min(next,budgetAt + 60000); return; }
        if (sent >= 4) { next = Math.min(next,now + 80); return; }
        row.attempts++; row.nextAt = now + stallMs; budgetUsed++; counters.retries++; sent++;
        // Preserve the SDK's node and load listeners; never fake opacity or
        // swap layers. Completed failures retain their exact original URL.
        if (!row.img.complete || row.bypass) {
          // Browsers coalesce an identical in-flight URL, even after src is
          // removed briefly. Only a ten-second stalled request gets a bounded
          // cache-bypass query; preserve its CDN, path and original parameters.
          row.bypass = true;
          var retryUrl = new URL(row.url);
          retryUrl.searchParams.set('_js_tile_retry_v192',String(now)+'-'+row.attempts);
          row.retryUrl = retryUrl.href; row.img.src = row.retryUrl;
        } else row.img.src = row.url;
        next = Math.min(next,row.nextAt);
      });
      if (Number.isFinite(next)) schedule(next - Date.now());
    }
    function failed(event) {
      var img = event.target, url = tileUrl(img);
      if (!url || !viewport.contains(img) || disposed) return;
      counters.errors++;
      var row = known.get(img);
      if (!row || !current(row)) {
        if (row) pending.delete(row);
        row = {img:img,url:url,attempts:0}; known.set(img,row);
      }
      if (row.attempts >= 2) { pending.delete(row); return; }
      row.expires = Date.now() + 120000;
      row.nextAt = Date.now() + (row.attempts ? 1200 : 350);
      pending.add(row);
      while (pending.size > 128) pending.delete(pending.values().next().value);
      schedule(row.nextAt - Date.now());
    }
    function loaded(event) {
      var row = known.get(event.target);
      if (row && pending.has(row) && current(row) && row.img.naturalWidth > 0) { pending.delete(row); if (row.attempts > 0) counters.recovered++; }
      if (!pending.size) clearTimer();
    }
    function start() { moving = true; clearTimer(); }
    function discover(img) {
      var url = tileUrl(img);
      if (!url || !viewport.contains(img) || disposed || img.complete && img.naturalWidth > 0) return;
      var row = known.get(img);
      if (row && current(row) && (pending.has(row) || row.attempts >= 2)) return;
      if (img.complete) { failed({target:img}); return; }
      if (row) pending.delete(row);
      row = {img:img,url:url,attempts:0,expires:Date.now()+120000,nextAt:Date.now()+stallMs};
      known.set(img,row); pending.add(row);
      while (pending.size > 128) pending.delete(pending.values().next().value);
      schedule(stallMs);
    }
    function scan(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === 'IMG') discover(node);
      else node.querySelectorAll('img').forEach(discover);
    }
    function idle() { moving = false; scan(viewport); schedule(0); }
    function wake() { scan(viewport); schedule(100); }
    function hide() { paused = true; clearTimer(); }
    function show() { paused = false; moving = false; wake(); }
    function visibility() { if (document.visibilityState === 'hidden') clearTimer(); else { moving = false; wake(); } }
    viewport.addEventListener('error',failed,true); viewport.addEventListener('load',loaded,true);
    // SDK tiles may finish while detached, then be inserted or reused later.
    // Observe only insertion/src changes; never styles or cluster attributes.
    if (typeof global.MutationObserver === 'function') {
      observer = new global.MutationObserver(function(records) {
        records.forEach(function(record) {
          if (record.type === 'attributes') discover(record.target);
          else record.addedNodes.forEach(scan);
        });
      });
      observer.observe(viewport,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
    }
    ['dragstart','zoom_start'].forEach(function(name) { events.addListener(map,name,start); bindings.push([name,start]); });
    ['idle','dragend'].forEach(function(name) { events.addListener(map,name,idle); bindings.push([name,idle]); });
    global.addEventListener('online',wake); global.addEventListener('pagehide',hide); global.addEventListener('pageshow',show);
    document.addEventListener('visibilitychange',visibility);
    var controller = {
      stats:function() { return {errors:counters.errors,retries:counters.retries,recovered:counters.recovered,pending:pending.size}; },
      destroy:function() {
        if (disposed) return; disposed = true; clearTimer(); pending.clear();
        if (observer) observer.disconnect();
        viewport.removeEventListener('error',failed,true); viewport.removeEventListener('load',loaded,true);
        bindings.forEach(function(binding) { events.removeListener(map,binding[0],binding[1]); });
        global.removeEventListener('online',wake); global.removeEventListener('pagehide',hide); global.removeEventListener('pageshow',show);
        document.removeEventListener('visibilitychange',visibility);
      }
    };
    active = controller;
    // One deadline per incomplete tile, cleared by its native load event.
    // Healthy navigation never refetches a completed image or polls the map.
    scan(viewport);
    return controller;
  }
  global.JSMapTileRecoveryV105 = {attach:attach,stats:function() { return active ? active.stats() : {errors:0,retries:0,recovered:0,pending:0}; }};
})(window);
