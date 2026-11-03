/* Recover failed base-map images only. Keep SDK load listeners, tile URLs,
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
    var bindings = [];
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
    function flush() {
      timer = null; timerAt = 0;
      if (blocked()) return;
      var now = Date.now(), next = Infinity, sent = 0, box = viewport.getBoundingClientRect();
      if (now - budgetAt >= 60000) { budgetAt = now; budgetUsed = 0; }
      pending.forEach(function(row) {
        if (now >= row.expires || tileUrl(row.img) !== row.url || row.img.complete && row.img.naturalWidth > 0 || row.attempts >= 2) { pending.delete(row); return; }
        // Pause a hidden map, but include the SDK's connected buffer tiles.
        if (!visible(row.img,box) || !row.img.complete) return;
        if (row.nextAt > now) { next = Math.min(next,row.nextAt); return; }
        if (budgetUsed >= 32) { next = Math.min(next,budgetAt + 60000); return; }
        if (sent >= 4) { next = Math.min(next,now + 80); return; }
        row.attempts++; row.nextAt = Infinity; budgetUsed++; counters.retries++; sent++;
        // Reusing the exact URL lets the SDK's own load listener finish its
        // fade/layer bookkeeping. Never force opacity or swap SDK DOM nodes.
        row.img.src = row.url;
      });
      if (Number.isFinite(next)) schedule(next - Date.now());
    }
    function failed(event) {
      var img = event.target, url = tileUrl(img);
      if (!url || !viewport.contains(img) || disposed) return;
      counters.errors++;
      var row = known.get(img);
      if (!row || row.url !== url) {
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
      if (row && pending.has(row) && tileUrl(row.img) === row.url && row.img.naturalWidth > 0) { pending.delete(row); counters.recovered++; }
      if (!pending.size) clearTimer();
    }
    function start() { moving = true; clearTimer(); }
    function idle() { moving = false; schedule(0); }
    function wake() { schedule(100); }
    function hide() { paused = true; clearTimer(); }
    function show() { paused = false; moving = false; wake(); }
    function visibility() { if (document.visibilityState === 'hidden') clearTimer(); else wake(); }
    viewport.addEventListener('error',failed,true); viewport.addEventListener('load',loaded,true);
    ['dragstart','zoom_start'].forEach(function(name) { events.addListener(map,name,start); bindings.push([name,start]); });
    events.addListener(map,'idle',idle); bindings.push(['idle',idle]);
    global.addEventListener('online',wake); global.addEventListener('pagehide',hide); global.addEventListener('pageshow',show);
    document.addEventListener('visibilitychange',visibility);
    var controller = {
      stats:function() { return {errors:counters.errors,retries:counters.retries,recovered:counters.recovered,pending:pending.size}; },
      destroy:function() {
        if (disposed) return; disposed = true; clearTimer(); pending.clear();
        viewport.removeEventListener('error',failed,true); viewport.removeEventListener('load',loaded,true);
        bindings.forEach(function(binding) { events.removeListener(map,binding[0],binding[1]); });
        global.removeEventListener('online',wake); global.removeEventListener('pagehide',hide); global.removeEventListener('pageshow',show);
        document.removeEventListener('visibilitychange',visibility);
      }
    };
    active = controller;
    // Also cover an already-failed cached image when attaching to an existing
    // map. No polling or mutation observer is needed for healthy tiles.
    viewport.querySelectorAll('img').forEach(function(img) { if (img.complete && !img.naturalWidth) failed({target:img}); });
    return controller;
  }
  global.JSMapTileRecoveryV105 = {attach:attach,stats:function() { return active ? active.stats() : {errors:0,retries:0,recovered:0,pending:0}; }};
})(window);
