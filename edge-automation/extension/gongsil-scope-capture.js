/* Capture the provider's existing map response before document_idle injects the
 * collector. This creates no request, UI or timer and contains no access key. */
(() => {
  "use strict";
  if (window.__JS_GONGSIL_SCOPE_CAPTURE_V1__) return;
  const state = { version: 1, sequence: 0, capture: null };
  window.__JS_GONGSIL_SCOPE_CAPTURE_V1__ = state;
  const isCircle = input => {
    try {
      const url = new URL(typeof input === "string" ? input : input?.url || "", location.href);
      return /(^|\.)gongsilbox\.com$/i.test(url.hostname) && /^\/api\/maps\/circle$/i.test(url.pathname);
    } catch { return false; }
  };
  const finish = (sequence, body, result) => {
    if (sequence !== state.sequence || !body || result?.res !== "success") return;
    const groups = Array.isArray(result?.datas?.res) ? result.datas.res : [];
    const count = groups.reduce((sum, row) => sum + (Array.isArray(row?.fidxs) ? row.fidxs.length : 0), 0);
    if (!groups.length || groups.length > 5000 || count > 30000 ||
        JSON.stringify(body.search || {}).length > 64000) return;
    state.capture = {
      body: { btype: body.btype, level: body.level, areacoord: body.areacoord,
        removecoord: body.removecoord, search: body.search, isZzim: body.isZzim, aptCircle: body.aptCircle },
      groups: groups.map(row => ({ fidxs: Array.isArray(row.fidxs) ? row.fidxs : [] })),
      capturedAt: Date.now()
    };
  };
  const parseBody = value => {
    try { return typeof value === "string" && value.length <= 100000 ? JSON.parse(value) : null; }
    catch { return null; }
  };
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function(input, init) {
      const circle = isCircle(input);
      const sequence = circle ? ++state.sequence : 0;
      if (circle) state.capture = null;
      // Clone Request bodies before native fetch consumes them.
      let requestBody = init?.body || "";
      if (circle && init?.body == null && typeof input?.clone === "function") {
        try { requestBody = input.clone().text().catch(() => ""); } catch { requestBody = ""; }
      }
      const response = await originalFetch.apply(this, arguments);
      if (circle && response.ok) {
        try {
          const copy = response.clone();
          Promise.all([Promise.resolve(requestBody), copy.json()])
            .then(([body, result]) => finish(sequence, parseBody(body), result))
            .catch(() => {});
        } catch { /* Failure to capture must never change the provider's response. */ }
      }
      return response;
    };
  }
  if (typeof XMLHttpRequest === "function") {
    const requests = new WeakMap();
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      requests.set(this, { circle: isCircle(url), method: String(method).toUpperCase() });
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const request = requests.get(this);
      if (request?.circle && request.method === "POST") {
        const sequence = ++state.sequence;
        state.capture = null;
        const parsed = parseBody(body);
        this.addEventListener("load", () => {
          try {
            if (this.status < 200 || this.status >= 300) return;
            finish(sequence, parsed, this.responseType === "json" ? this.response : JSON.parse(this.responseText));
          } catch { /* Keep failed, incomplete and unsupported map responses fail-closed. */ }
        }, { once: true });
      }
      return originalSend.apply(this, arguments);
    };
  }
})();
