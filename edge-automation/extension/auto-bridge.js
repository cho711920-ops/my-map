(function () {
  "use strict";

  if (window.__JS_AUTO_COLLECTOR_BRIDGE__) return;
  window.__JS_AUTO_COLLECTOR_BRIDGE__ = true;

  var runtimeNames = {
    naver: "__JS_NAVER_COLLECTOR__",
    daangn: "__JS_DAANGN_COLLECTOR__",
    gongsil: "__JS_GONGSIL_COLLECTOR__"
  };

  var activeRuns = Object.create(null);

  function delay(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }

  async function waitForRuntime(source) {
    var runtimeName = runtimeNames[source];
    for (var attempt = 0; attempt < 120; attempt += 1) {
      var runtime = window[runtimeName];
      if (runtime && typeof runtime.runAutomatic === "function") return runtime;
      await delay(250);
    }
    throw new Error("자동수집 실행 기능을 30초 안에 불러오지 못했습니다.");
  }

  function postStarted(runId) {
    window.postMessage({ type: "JS_COLLECTOR_AUTOMATION_STARTED", runId: runId }, "*");
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data || event.data.type !== "JS_AUTO_START_MAIN") return;
    var target = event.data.target || {};
    var runId = event.data.runId || "";
    if (activeRuns[runId]) {
      if (activeRuns[runId].started) postStarted(runId);
      return;
    }

    activeRuns[runId] = { started: false };
    waitForRuntime(target.source).then(function (runtime) {
      activeRuns[runId].started = true;
      postStarted(runId);
      return Promise.resolve(runtime.runAutomatic(target));
    }).then(function (result) {
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
    }).finally(function () {
      delete activeRuns[runId];
    });
  });
})();
