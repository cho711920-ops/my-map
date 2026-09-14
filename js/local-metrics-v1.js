/* Local-only, bounded aggregate diagnostics. No identifiers or content. */
(function(global) {
  "use strict";
  var KEY = "js_local_metrics_v1";
  var labels = {firstData: "첫 매물 표시", search: "검색 처리", detail: "상세 표시"};
  var errorNames = ["network", "storage", "runtime", "resource", "read", "save"];
  var startedAt = now();
  var firstDataRecorded = false;
  var data = {version: 1, durations: {}, errors: {}};

  function now() { return global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now(); }
  function integer(value) { return Math.max(0, Math.min(1000000, Math.floor(Number(value) || 0))); }
  function restore() {
    try {
      var saved = JSON.parse(global.sessionStorage.getItem(KEY) || "null");
      if (!saved || saved.version !== 1) return;
      Object.keys(labels).forEach(function(name) {
        var row = saved.durations && saved.durations[name];
        if (!row || !integer(row.count)) return;
        data.durations[name] = {count: integer(row.count), total: Math.max(0, Math.min(6e11, Number(row.total) || 0)),
          max: Math.max(0, Math.min(600000, Number(row.max) || 0)), last: Math.max(0, Math.min(600000, Number(row.last) || 0))};
      });
      errorNames.forEach(function(name) { data.errors[name] = integer(saved.errors && saved.errors[name]); });
    } catch (_) { /* Diagnostics must never interrupt a user operation. */ }
  }
  function persist() {
    try { global.sessionStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* Optional diagnostics. */ }
  }
  function record(name, duration) {
    if (!Object.prototype.hasOwnProperty.call(labels, name) || !Number.isFinite(duration)) return;
    var milliseconds = Math.round(Math.max(0, Math.min(600000, duration)));
    var row = data.durations[name] || {count: 0, total: 0, max: 0, last: 0};
    if (row.count >= 1000000) return;
    row.count += 1; row.total += milliseconds; row.max = Math.max(row.max, milliseconds); row.last = milliseconds;
    data.durations[name] = row;
    persist();
  }
  function start(name) {
    return Object.prototype.hasOwnProperty.call(labels, name) ? {name: name, at: now(), finished: false} : null;
  }
  function finish(token) {
    if (!token || token.finished) return;
    token.finished = true;
    record(token.name, now() - token.at);
  }
  function markFirstData() {
    if (firstDataRecorded) return;
    firstDataRecorded = true;
    record("firstData", global.performance && typeof global.performance.now === "function" ? now() : now() - startedAt);
  }
  function error(category) {
    if (errorNames.indexOf(category) < 0) return;
    data.errors[category] = integer((data.errors[category] || 0) + 1);
    persist();
  }
  function snapshot() { return JSON.parse(JSON.stringify(data)); }
  function reset() { data = {version: 1, durations: {}, errors: {}}; persist(); }
  function render(container) {
    if (!container || !global.document) return;
    container.textContent = "";
    var panel = global.document.createElement("details");
    var summary = global.document.createElement("summary");
    summary.textContent = "이 기기 성능 점검 (현재 탭)";
    panel.appendChild(summary);
    var notice = global.document.createElement("p");
    notice.textContent = "처리시간과 오류 종류별 횟수만 이 탭에 저장합니다. 서버 전송·검색어·매물·고객 정보 기록은 하지 않습니다. 실제 전체 사용자 속도와는 다릅니다.";
    panel.appendChild(notice);
    Object.keys(labels).forEach(function(name) {
      var row = data.durations[name];
      var line = global.document.createElement("p");
      line.textContent = labels[name] + (row ? ": " + row.count + "회 · 평균 " + Math.round(row.total / row.count) + "ms · 최근 " + row.last + "ms · 최대 " + row.max + "ms" : ": 아직 측정 없음");
      panel.appendChild(line);
    });
    var errors = global.document.createElement("p");
    errors.textContent = "오류 횟수: " + errorNames.map(function(name) { return name + " " + (data.errors[name] || 0); }).join(" · ");
    panel.appendChild(errors);
    var refresh = global.document.createElement("button");
    refresh.type = "button"; refresh.textContent = "다시 확인"; refresh.onclick = function() { render(container); container.firstElementChild.open = true; };
    panel.appendChild(refresh);
    var clear = global.document.createElement("button");
    clear.type = "button"; clear.textContent = "이 탭의 점검 기록 지우기"; clear.onclick = function() { reset(); render(container); };
    panel.appendChild(clear);
    container.appendChild(panel);
  }
  restore();
  global.addEventListener("error", function(event) { error(event && event.target && event.target !== global ? "resource" : "runtime"); }, true);
  global.addEventListener("unhandledrejection", function() { error("runtime"); });
  global.JSLocalMetricsV1 = Object.freeze({start: start, finish: finish, markFirstData: markFirstData, error: error, snapshot: snapshot, reset: reset, render: render});
})(window);
