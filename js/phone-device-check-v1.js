/* Opt-in, on-device troubleshooting. No account data, persistence or telemetry. */
(function phoneDeviceCheckV1(global) {
  "use strict";
  if (new URLSearchParams(global.location.search).get("phoneCheck") !== "1") return;

  var panel;
  var output;
  var notice;
  var model = "미확인";

  function report() {
    var nav = global.navigator || {};
    var display = global.screen || {};
    var viewport = global.visualViewport;
    var hints = nav.userAgentData;
    var device = global.JSPhoneDeviceV1;
    return [
      "화면 진단 2026-09-23.1",
      "새 모바일 판별: " + (device && device.isPhone() ? "적용" : "적용 안 됨"),
      "새 모바일 CSS: " + (document.documentElement.classList.contains("js-phone-app-v2") ? "적용" : "적용 안 됨"),
      "screen: " + display.width + " × " + display.height,
      "screen available: " + display.availWidth + " × " + display.availHeight,
      "layout: " + global.innerWidth + " × " + global.innerHeight,
      "document width: " + document.documentElement.clientWidth,
      "visual viewport: " + (viewport ? Math.round(viewport.width) + " × " + Math.round(viewport.height) + " / scale " + viewport.scale : "없음"),
      "pixel ratio: " + global.devicePixelRatio,
      "orientation: " + (display.orientation ? display.orientation.type : global.orientation),
      "touch points: " + nav.maxTouchPoints,
      "coarse pointer: " + global.matchMedia("(pointer: coarse)").matches,
      "UA mobile hint: " + (hints ? hints.mobile : "없음"),
      "platform: " + nav.platform + " / " + (hints ? hints.platform : "없음"),
      "model: " + model,
      "UA: " + nav.userAgent
    ].join("\n");
  }

  function refresh() {
    if (output) output.textContent = report();
  }

  function boot() {
    panel = document.createElement("section");
    panel.id = "jsPhoneDeviceCheckV1";
    panel.setAttribute("aria-label", "기기 화면 확인");
    panel.style.cssText = "position:fixed;z-index:2147483647;inset:8px;max-width:600px;margin:auto;box-sizing:border-box;overflow:auto;padding:16px;border:2px solid #096be0;border-radius:16px;background:white;color:#172033;font:14px/1.5 sans-serif;";
    panel.innerHTML = '<h2 style="font-size:20px;margin:0 0 8px">기기 화면 확인</h2>' +
      '<p style="margin:0 0 10px">폴드를 접은 상태에서 아래 내용을 복사해 대화에 붙여넣어 주세요. 화면 정보만 표시하며 계정·매물 정보는 읽거나 전송하지 않습니다.</p>' +
      '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 monospace;background:#f3f7fc;padding:10px;border-radius:8px"></pre>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" data-device-check-copy>진단 내용 복사</button>' +
      '<button type="button" data-device-check-refresh>다시 확인</button><button type="button" data-device-check-close>닫기</button></div>' +
      '<p role="status" style="margin:8px 0 0"></p>';
    output = panel.querySelector("pre");
    notice = panel.querySelector('[role="status"]');
    panel.querySelectorAll("button").forEach(function(button) {
      button.style.cssText = "min-height:44px;padding:8px 12px;background:#eef5ff;color:#174677;border:1px solid #a9c9ef;border-radius:8px;font:inherit;";
    });
    panel.querySelector("[data-device-check-refresh]").addEventListener("click", refresh);
    panel.querySelector("[data-device-check-copy]").addEventListener("click", function() {
      refresh();
      if (!global.navigator.clipboard || !global.navigator.clipboard.writeText) {
        notice.textContent = "자동 복사가 지원되지 않습니다. 위 내용을 화면 캡처해서 보내주세요.";
        return;
      }
      global.navigator.clipboard.writeText(output.textContent).then(function() {
        notice.textContent = "복사했습니다. 대화창에 붙여넣어 주세요.";
      }, function() {
        notice.textContent = "복사가 차단됐습니다. 위 내용을 화면 캡처해서 보내주세요.";
      });
    });
    panel.querySelector("[data-device-check-close]").addEventListener("click", function() {
      panel.remove();
      global.removeEventListener("resize", refresh);
      global.removeEventListener("js-phone-device-change", refresh);
    });
    document.body.appendChild(panel);
    refresh();
    global.addEventListener("resize", refresh);
    global.addEventListener("js-phone-device-change", refresh);
    var hints = global.navigator.userAgentData;
    if (hints && typeof hints.getHighEntropyValues === "function") {
      // Read locally only after the user explicitly opens the diagnostic URL.
      Promise.resolve().then(function() { return hints.getHighEntropyValues(["model"]); }).then(function(values) {
        model = values.model || "브라우저가 제공하지 않음";
        refresh();
      }, function() { model = "브라우저에서 조회 차단"; refresh(); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once: true});
  else boot();
})(window);
