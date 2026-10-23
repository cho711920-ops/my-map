(function () {
  "use strict";
  var query = new URLSearchParams(location.search);
  var token = query.get("js_auto_token") || "";
  var expected = query.get("js_auto_expected") || "";
  if (!/^\d{10,16}$/.test(token) || !/^\d+\.\d+\.\d+$/.test(expected)) return;
  var status = document.createElement("p");
  status.id = "js-auto-web-startup-status";
  status.setAttribute("role", "status");
  status.textContent = "확장 실행 상태를 확인하고 있습니다.";
  (document.querySelector("main") || document.body).prepend(status);
  var attempts = 0, done = false, pendingId = "", issued = new Set();
  window.addEventListener("message", function (event) {
    if (done || event.source !== window || !event.data || event.data.type !== "JS_AUTO_COLLECTOR_STATE_RESULT" || !issued.has(event.data.requestId) || !event.data.ok) return;
    issued.delete(event.data.requestId);
    var state = event.data.state || {};
    if (state.version !== expected || !state.runState || state.runState.active !== true) return;
    // Compatibility with an already-running pre-update content script: its
    // existing public state bridge proves an active run without restarting
    // the extension or accessing browser storage/credentials. Read-only only.
    var result = state.runState.market === "sale" ? "busy" : "active";
    document.title = "JS_AUTO_ACK_V79:" + token + ":" + state.version + ":" + result;
    status.textContent = result === "active" ? "상가임대 자동수집의 실제 실행을 확인했습니다." : "진행 중인 매매 수집을 유지합니다. 상가임대 예약 요청의 대기 상태는 수집 설정에서 확인해 주세요.";
    done = true;
  });
  function poll() {
    if (done) return;
    if (attempts >= 90) {
      status.textContent = "실제 수집 시작을 확인하지 못했습니다. 확장 설정의 실행 상태를 확인해 주세요.";
      return;
    }
    pendingId = "startup-v79-" + token + "-" + (++attempts);
    issued.add(pendingId);
    window.postMessage({type: "JS_AUTO_COLLECTOR_STATE_REQUEST", requestId: pendingId}, location.origin);
    setTimeout(poll, 500);
  }
  poll();
})();
