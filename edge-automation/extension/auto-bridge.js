(function () {
  "use strict";

  if (window.__JS_AUTO_COLLECTOR_BRIDGE__) return;
  window.__JS_AUTO_COLLECTOR_BRIDGE__ = true;

  var runtimeNames = {
    naver: "__JS_NAVER_COLLECTOR__",
    daangn: "__JS_DAANGN_COLLECTOR__",
    gongsil: "__JS_GONGSIL_COLLECTOR__"
  };

  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data || event.data.type !== "JS_AUTO_START_MAIN") return;
    var target = event.data.target || {};
    var runId = event.data.runId || "";
    var runtime = window[runtimeNames[target.source]];
    if (!runtime || typeof runtime.runAutomatic !== "function") {
      window.postMessage({
        type: "JS_COLLECTOR_AUTOMATION_RESULT",
        runId: runId,
        ok: false,
        message: "자동수집 실행 기능을 불러오지 못했습니다."
      }, "*");
      return;
    }

    Promise.resolve(runtime.runAutomatic(target)).then(function (result) {
      window.postMessage({
        type: "JS_COLLECTOR_AUTOMATION_RESULT",
        runId: runId,
        ok: true,
        result: result || {}
      }, "*");
    }).catch(function (error) {
      window.postMessage({
        type: "JS_COLLECTOR_AUTOMATION_RESULT",
        runId: runId,
        ok: false,
        message: String(error && error.message ? error.message : error)
      }, "*");
    });
  });
})();
