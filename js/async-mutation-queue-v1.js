(function(global) {
  "use strict";

  var STORAGE_KEY = "js_async_mutation_outbox_v1";
  var ACTIVE_KEY = "js_async_mutation_active_v1";
  var API_URL = "/api/apps-script";
  var sending = false;
  var pollTimer = null;
  var hideTimer = null;
  var lastSavingCount = 0;
  var externalSavingCount = 0;
  var externalFailedCount = 0;
  var lastServerStatus = {completed: 0, processing: 0, pending: 0, failed: 0};

  function readOutbox() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeOutbox(tasks) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks || []));
    } catch (_) {}
  }

  function readActive() {
    try {
      var parsed = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeActive(tasks) {
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(tasks || []));
    } catch (_) {}
  }

  function createRequestId(action) {
    return "webq-" + String(action || "save").replace(/[^a-z0-9_-]/gi, "").slice(0, 30) +
      "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function ensureIndicator() {
    var indicator = document.getElementById("asyncMutationStatusV1");
    if (indicator) return indicator;
    indicator = document.createElement("button");
    indicator.type = "button";
    indicator.id = "asyncMutationStatusV1";
    indicator.className = "async-mutation-status-v1 idle";
    indicator.hidden = true;
    indicator.innerHTML =
      "<span><small>완료</small><b>0</b></span>" +
      "<span><small>저장중</small><b>0</b></span>" +
      "<span><small>실패</small><b>0</b></span>";
    indicator.title = "백그라운드 저장 상태";
    indicator.addEventListener("click", refreshStatus);
    indicator.dataset.statusBoundV1 = "1";
    var quickAdd = document.querySelector(".quick-add-with-sync");
    if (quickAdd && quickAdd.parentNode) {
      quickAdd.insertAdjacentElement("beforebegin", indicator);
    } else {
      document.body.appendChild(indicator);
    }
    return indicator;
  }

  function renderStatus() {
    var indicator = ensureIndicator();
    var unsent = readOutbox().length;
    var pending = Number(lastServerStatus.pending || 0) + unsent;
    var processing = Number(lastServerStatus.processing || 0);
    var completed = Number(lastServerStatus.completed || 0);
    var failed = Number(lastServerStatus.failed || 0) + externalFailedCount;
    var saving = pending + processing + externalSavingCount;
    var justCompleted = lastSavingCount > 0 && saving === 0 && failed === 0;
    if (saving || failed) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      indicator.className = "async-mutation-status-v1 " + (failed ? "failed" : "working");
      indicator.hidden = false;
    } else if (justCompleted) {
      indicator.className = "async-mutation-status-v1 completed";
      indicator.hidden = false;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function() {
        hideTimer = null;
        if (externalSavingCount || externalFailedCount || readOutbox().length) return renderStatus();
        indicator.className = "async-mutation-status-v1 idle";
        indicator.hidden = true;
      }, 3000);
    } else if (!indicator.classList.contains("completed") || !hideTimer) {
      indicator.className = "async-mutation-status-v1 idle";
      indicator.hidden = true;
    }
    indicator.innerHTML =
      "<span><small>완료</small><b>" + completed + "</b></span>" +
      "<span><small>저장중</small><b>" + saving + "</b></span>" +
      "<span><small>실패</small><b>" + failed + "</b></span>";
    indicator.setAttribute(
      "aria-label",
      "완료 " + completed + "건, 저장 중 " + saving + "건, 실패 " + failed + "건"
    );
    indicator.title = unsent
      ? "서버 전송 대기 " + unsent + "건 포함 · 누르면 새로 확인"
      : "누르면 저장 상태 새로 확인";
    lastSavingCount = saving;
  }

  function setExternalState(active, failed) {
    externalSavingCount = active ? 1 : 0;
    externalFailedCount = failed ? 1 : 0;
    renderStatus();
  }

  function sendOutbox() {
    if (sending) return;
    var tasks = readOutbox();
    if (!tasks.length) {
      renderStatus();
      return;
    }
    sending = true;
    var task = tasks[0];
    fetch(API_URL, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        action: "enqueueMutation",
        taskAction: task.action,
        requestId: task.requestId,
        payload: task.payload
      })
    }).then(function(response) {
      if (!response.ok) throw new Error("작업대기열 접수 HTTP " + response.status);
      return response.json();
    }).then(function(result) {
      if (!result || result.ok === false) {
        throw new Error((result && result.message) || "작업대기열 접수 실패");
      }
      var latest = readOutbox().filter(function(item) {
        return item.requestId !== task.requestId;
      });
      writeOutbox(latest);
      var active = readActive();
      if (!active.some(function(item) { return item.requestId === task.requestId; })) {
        active.push({
          requestId: task.requestId,
          action: task.action,
          createdAt: task.createdAt
        });
        writeActive(active);
      }
      sending = false;
      renderStatus();
      if (latest.length) setTimeout(sendOutbox, 80);
      else refreshStatus();
    }).catch(function(error) {
      sending = false;
      task.lastError = String(error && error.message || error);
      task.lastTriedAt = Date.now();
      var latest = readOutbox();
      var index = latest.findIndex(function(item) {
        return item.requestId === task.requestId;
      });
      if (index >= 0) latest[index] = task;
      writeOutbox(latest);
      renderStatus();
      setTimeout(sendOutbox, 3000);
    });
  }

  function enqueue(action, payload) {
    var requestId = String(payload && payload.requestId || createRequestId(action));
    var taskPayload = Object.assign({}, payload || {}, {requestId: requestId});
    var tasks = readOutbox();
    if (!tasks.some(function(item) { return item.requestId === requestId; })) {
      tasks.push({
        requestId: requestId,
        action: action,
        payload: taskPayload,
        createdAt: Date.now()
      });
      writeOutbox(tasks);
    }
    renderStatus();
    setTimeout(sendOutbox, 0);
    return Promise.resolve({
      ok: true,
      queued: true,
      local: true,
      requestId: requestId
    });
  }

  function parseJobResult(job) {
    try {
      return job && job.result ? JSON.parse(job.result) : {};
    } catch (_) {
      return {};
    }
  }

  function publishFinishedJobs(result) {
    var jobs = result && Array.isArray(result.jobs) ? result.jobs : [];
    if (!jobs.length) return;
    var jobById = {};
    jobs.forEach(function(job) { jobById[String(job.id || "")] = job; });
    var active = readActive();
    var remaining = [];
    active.forEach(function(task) {
      var job = jobById[task.requestId];
      if (!job || ["완료", "실패"].indexOf(String(job.status || "")) < 0) {
        remaining.push(task);
        return;
      }
      var detail = {
        requestId: task.requestId,
        action: task.action,
        ok: job.status === "완료",
        status: job.status,
        attempts: Number(job.attempts || 0),
        error: String(job.error || ""),
        verification: String(job.verification || ""),
        result: parseJobResult(job)
      };
      global.dispatchEvent(new CustomEvent("js-async-mutation-finished", {
        detail: detail
      }));
    });
    writeActive(remaining);
  }

  function refreshStatus() {
    return fetch(API_URL + "?action=workQueueStatus&_=" + Date.now(), {
      credentials: "same-origin",
      cache: "no-store"
    }).then(function(response) {
      if (!response.ok) throw new Error("상태 조회 실패");
      return response.json();
    }).then(function(result) {
      if (result && result.ok !== false) lastServerStatus = result;
      publishFinishedJobs(result);
      renderStatus();
      return result;
    }).catch(function() {
      renderStatus();
      return lastServerStatus;
    });
  }

  function start() {
    var indicator = ensureIndicator();
    if (!indicator.dataset.statusBoundV1) {
      indicator.addEventListener("click", refreshStatus);
      indicator.dataset.statusBoundV1 = "1";
    }
    renderStatus();
    sendOutbox();
    refreshStatus();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshStatus, 5000);
    global.addEventListener("online", sendOutbox);
  }

  global.JSAsyncMutations = {
    enqueue: enqueue,
    refreshStatus: refreshStatus,
    retry: sendOutbox,
    setExternalState: setExternalState,
    pendingCount: function() {
      return readOutbox().length + readActive().length;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {once: true});
  } else {
    start();
  }
})(window);
