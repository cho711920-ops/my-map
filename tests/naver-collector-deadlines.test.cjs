const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "js", "naver-collector.js"), "utf8");

function functionSource(name) {
  const marker = new RegExp(`  (?:async )?function ${name}\\(`);
  const start = source.search(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const tail = source.slice(start + 2);
  const next = tail.slice(1).search(/\n {2}(?:async )?function /);
  return next < 0 ? tail : tail.slice(0, next + 1);
}

function jsonResponse(result) {
  return {ok: true, status: 200, text: async () => JSON.stringify(result)};
}

async function flush() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function harness(fetch) {
  const timers = new Map();
  const calls = [];
  const delays = [];
  let nextTimer = 1;
  const context = vm.createContext({
    AbortController,
    COLLECTOR_API_URL: "https://collector.invalid/api/collector",
    COLLECTOR_REQUEST_TIMEOUT_MS: 60000,
    COLLECTOR_FINALIZE_TIMEOUT_MS: 120000,
    COLLECTOR_RESULT_TIMEOUT_MS: 30000,
    FIN_DETAIL_TIMEOUT_MS: 15000,
    FIN_DETAIL_CONCURRENCY: 5,
    BATCH_SIZE: 100,
    VERSION: "6.0.5",
    location: {href: "https://fin.land.naver.com/map"},
    window: {
      setTimeout(callback, ms) {
        const id = nextTimer++;
        timers.set(id, {callback, ms});
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
      setInterval() { return 1; },
      clearInterval() {}
    },
    nativeFetch: async (url, options) => {
      const payload = options.body ? JSON.parse(options.body) : null;
      const request = {url, options, payload};
      calls.push(request);
      return fetch(request);
    },
    delay: async ms => { delays.push(ms); },
    getCollectorKey: () => "test-only-key",
    throwIfStopRequested() {},
    clean: value => String(value == null ? "" : value).trim(),
    setStatus() {},
    setProgress() {},
    updateDashboard() {},
    parseFinFilters: () => ({tradeTypes: ["B2"]})
  });
  for (const name of ["collectorRequestFailure", "fetchCollectorText", "fetchCollectorJson", "classifyNaverManifest",
    "postBatch", "postBatchWithRetry", "finalizeNaverSession", "getNaverSessionResult",
    "fetchFinJson", "enrichNaverDetailBatch", "collectAndSave", "retryFailedCityArticles",
    "collectFinDaejeonAll"]) {
    vm.runInContext(functionSource(name), context);
  }
  return {
    context, calls, delays, timers,
    expire(ms) {
      assert.equal(timers.size, 1, "only the current request owns a deadline");
      const [id, timer] = timers.entries().next().value;
      assert.equal(timer.ms, ms);
      timers.delete(id);
      timer.callback();
    }
  };
}

const operations = [
  {action: "classifySourceManifest", ms: 60000, run: c => c.classifyNaverManifest([
    {articleNo: "123", areaSquareMeter: 33}
  ], {sessionId: "session-1", scope: "test"})},
  {action: "saveNaverBatch", ms: 60000, run: c => c.postBatchWithRetry([
    {articleNo: "123"}
  ], 6, {sessionId: "session-1", requestId: "session-1-batch-0"})},
  {action: "finalizeNaverSession", ms: 120000, run: c => c.finalizeNaverSession({
    sessionId: "session-1", complete: true
  })},
  {action: "getNaverSessionResult", ms: 30000, run: c => c.getNaverSessionResult({sessionId: "session-1"})}
];

for (const operation of operations) {
  for (const stalledPart of ["fetch", "body"]) {
    test(`${operation.action} bounds a stalled ${stalledPart} without replaying its mutation`, async () => {
      const h = harness(({payload}) => {
        if (payload.action === "mutationStatus") return jsonResponse({ok: true, ready: false});
        return stalledPart === "fetch" ? new Promise(() => {}) : {text: () => new Promise(() => {})};
      });
      const pending = operation.run(h.context);
      const rejected = assert.rejects(pending, error => {
        assert.equal(error.collectorAction, operation.action);
        assert.equal(error.collectorRequestAmbiguous, operation.action !== "getNaverSessionResult");
        return true;
      });
      await flush();
      h.expire(operation.ms);
      await rejected;
      assert.equal(h.calls.filter(call => call.payload.action === operation.action).length, 1);
      assert.equal(h.calls[0].options.signal.aborted, true);
      assert.equal(h.timers.size, 0);
      assert.deepEqual(h.delays, []);
      if (operation.action !== "getNaverSessionResult") {
        assert.equal(h.calls[1].payload.action, "mutationStatus");
        assert.equal(h.calls[1].payload.targetAction, operation.action);
        assert.equal(h.calls[1].payload.requestId, h.calls[0].payload.requestId);
      }
    });
  }
}

test("a timed-out save recovers its confirmed result using the original action and request ID", async () => {
  const saved = {ok: true, saved: 1, created: 1};
  const h = harness(({payload}) => payload.action === "mutationStatus"
    ? jsonResponse({ok: true, ready: true, result: saved})
    : new Promise(() => {}));
  const pending = h.context.postBatchWithRetry([{articleNo: "123"}], 6, {
    sessionId: "session-1", requestId: "session-1-batch-0"
  });
  await flush();
  h.expire(60000);
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), saved);
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
  assert.equal(h.calls[1].payload.requestId, "session-1-batch-0");
  assert.equal(h.calls[1].payload.targetAction, "saveNaverBatch");
  assert.equal(h.timers.size, 0);
});

test("a stalled recovery read is bounded and preserves the original ambiguous write error", async () => {
  const h = harness(() => new Promise(() => {}));
  const pending = h.context.postBatchWithRetry([], 6, {requestId: "same-batch"});
  const rejected = assert.rejects(pending, error => error.collectorRequestAmbiguous &&
    error.collectorAction === "saveNaverBatch");
  await flush();
  h.expire(60000);
  await flush();
  h.expire(30000);
  await rejected;
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
  assert.equal(h.timers.size, 0);
});

for (const malformed of [null, {}, [], 1, "saved", {ok: "true"}]) {
  test(`a malformed JSON save envelope ${JSON.stringify(malformed)} is reconciled without replay`, async () => {
    const h = harness(({payload}) => payload.action === "mutationStatus"
      ? jsonResponse({ok: true, ready: false})
      : jsonResponse(malformed));
    await assert.rejects(h.context.postBatchWithRetry([], 6, {requestId: "same-batch"}),
      error => error.collectorRequestAmbiguous && error.collectorAction === "saveNaverBatch");
    assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
    assert.equal(h.calls[1].payload.requestId, "same-batch");
    assert.deepEqual(h.delays, []);
    assert.equal(h.timers.size, 0);
  });
}

test("a malformed JSON save envelope recovers the confirmed original result", async () => {
  const saved = {ok: true, saved: 1, created: 1};
  const h = harness(({payload}) => payload.action === "mutationStatus"
    ? jsonResponse({ok: true, ready: true, result: saved})
    : jsonResponse({}));
  const result = await h.context.postBatchWithRetry([], 6, {requestId: "same-batch"});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), saved);
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
  assert.deepEqual(h.delays, []);
  assert.equal(h.timers.size, 0);
});

test("successful requests preserve payloads, manifest filtering, and results with no remaining timer", async () => {
  const h = harness(({payload}) => jsonResponse(payload.action === "classifySourceManifest"
    ? {ok: true, needsDetail: ["네이버-2"], unchanged: 1, changed: 1, unknown: 0}
    : {ok: true, complete: true, saved: 1, finished: true}));
  const classified = await h.context.classifyNaverManifest([
    {articleNo: "1", areaSquareMeter: 33}, {articleNo: "2", areaSquareMeter: 66}
  ], {sessionId: "session-1", scope: "test"});
  assert.deepEqual(Array.from(classified.items, item => item.articleNo), ["2"]);
  assert.equal(classified.unchanged, 1);
  await h.context.postBatch(classified.items, {sessionId: "session-1", requestId: "session-1-batch-0"});
  await h.context.finalizeNaverSession({sessionId: "session-1", complete: true, processedCount: 2});
  const result = await h.context.getNaverSessionResult({sessionId: "session-1"});
  assert.equal(result.finished, true);
  assert.equal(h.calls[0].payload.requestId, "session-1-manifest-0");
  assert.equal(h.calls[1].payload.sessionId, "session-1");
  assert.equal(h.calls[1].payload.requestId, "session-1-batch-0");
  assert.equal(h.calls[2].payload.complete, true);
  assert.equal(h.calls[2].payload.processedCount, 2);
  assert.equal(h.timers.size, 0);
});

for (const status of [401, 403, 404]) {
  test(`detail HTTP ${status} fails once and remains a failed item in its batch`, async () => {
    const h = harness(() => ({ok: false, status}));
    h.context.state = {stopRequested: false};
    h.context.enrichNaverDetail = () => h.context.fetchFinJson("/detail", 5);
    const results = await h.context.enrichNaverDetailBatch([{articleNo: "123"}]);
    assert.equal(h.calls.length, 1);
    assert.equal(results[0].valid, false);
    assert.equal(results[0].fetchFailed, true);
    assert.equal(results[0].reason, `HTTP ${status}`);
    assert.deepEqual(h.delays, []);
    assert.equal(h.timers.size, 0);
  });
}

for (const status of [429, 503]) {
  test(`detail HTTP ${status} retries only between attempts`, async () => {
    const h = harness(() => ({ok: false, status}));
    await assert.rejects(h.context.fetchFinJson("/detail", 4), new RegExp(`HTTP ${status}`));
    assert.equal(h.calls.length, 4);
    assert.deepEqual(h.delays, [250, 1000, 2250]);
    assert.equal(h.timers.size, 0);
  });
}

const ambiguousRunCases = ["saveNaverBatch", "finalizeNaverSession"].flatMap(action =>
  ["timeout", "network", "body", "invalid-json", "invalid-envelope"].map(failureMode => ({action, failureMode})));
for (const {action: timedOutAction, failureMode} of ambiguousRunCases) {
  test(`an ambiguous ${timedOutAction} ${failureMode} does not complete or send another mutation`, async () => {
    const h = harness(({payload}) => {
      if (payload.action === "classifySourceManifest") {
        return jsonResponse({ok: true, needsDetail: ["네이버-123"], unchanged: 0});
      }
      if (payload.action === "mutationStatus") return jsonResponse({ok: true, ready: false});
      if (payload.action === timedOutAction) {
        if (failureMode === "network") throw new TypeError("Failed to fetch");
        if (failureMode === "body") return {text: async () => { throw new TypeError("Body stream failed"); }};
        if (failureMode === "invalid-json") return {text: async () => "<html>Gateway error</html>"};
        if (failureMode === "invalid-envelope") return jsonResponse({});
        return new Promise(() => {});
      }
      return jsonResponse({ok: true, accepted: 1, saved: 1});
    });
    const dashboard = {};
    let confirmedBatches = 0;
    Object.assign(h.context, {
      state: {busy: false, preparing: false, stopRequested: false, selectionMode: "district",
        selectedDistrict: {}, dashboard},
      saveButton: {}, retryButton: {},
      createCollectionSessionId: () => "session-1",
      normalize: item => item,
      enrichNaverDetailBatch: async items => items.map(item => ({item, valid: true})),
      showNaverSaveWait() {},
      updateDashboard: updates => Object.assign(dashboard, updates),
      addResultTotals(totals, result) {
        confirmedBatches += 1;
        totals.accepted += result.accepted;
        totals.saved += result.saved;
      },
      adjustBatchSize() {}, finishCollectorRun() {}, isFinNaver: () => true
    });
    const pending = h.context.collectAndSave([{articleNo: "123"}], "test", {complete: true});
    await flush();
    if (failureMode === "timeout") {
      h.expire(timedOutAction === "saveNaverBatch" ? 60000 : 120000);
    }
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.complete, false);
    assert.equal(h.context.state.busy, false);
    assert.equal(confirmedBatches, timedOutAction === "saveNaverBatch" ? 0 : 1);
    assert.equal(h.calls.filter(call => call.payload.action === "saveNaverBatch").length, 1);
    const finalizations = h.calls.filter(call => call.payload.action === "finalizeNaverSession");
    assert.equal(finalizations.length, timedOutAction === "finalizeNaverSession" ? 1 : 0);
    assert.equal(finalizations.some(call => call.payload.complete === false), false);
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.filter(call => call.payload.action === "mutationStatus").length, 1);
  });
}

for (const failureMode of ["timeout", "network", "invalid-envelope"]) {
  test(`city failed-item retry stops after an ambiguous ${failureMode} without further writes or finalization`, async () => {
    let saveRequests = 0;
    const h = harness(({payload}) => {
      if (payload.action === "mutationStatus") return jsonResponse({ok: true, ready: false});
      if (payload.action === "saveNaverBatch" && ++saveRequests === 1) {
        if (failureMode === "network") throw new TypeError("Failed to fetch");
        if (failureMode === "invalid-envelope") return jsonResponse({});
        return new Promise(() => {});
      }
      return jsonResponse({ok: true, saved: 1});
    });
    const progress = {mode: "fin-district", sessionId: "session-city", scope: "city",
      startedAt: "2026-09-18T00:00:00Z", queue: [{name: "서구"}], completed: 4,
      seenIds: ["123", "456"], failed: 0,
      failedItems: [{articleNo: "123", item: {articleNo: "123"}},
        {articleNo: "456", item: {articleNo: "456"}}]};
    let cleared = false;
    Object.assign(h.context, {
      state: {busy: false, prepareId: 0, selectedDistrict: {}},
      saveButton: {}, retryButton: {}, cityButton: {},
      beginCollectorRun() {}, finishCollectorRun() {}, updateCityButton() {},
      createEmptyDashboard: () => ({}), loadCityProgress: () => progress,
      saveCityProgress() {}, saveCityFailedItems() {}, persistNaverProgress() {},
      clearCityProgress() { cleared = true; },
      collectFinDistrictRaw: async () => {},
      waitForNaverSessionResult: async () => ({finished: true}),
      addResultTotals() {}, formatNumber: value => String(value || 0)
    });
    const pending = h.context.collectFinDaejeonAll();
    await flush();
    if (failureMode === "timeout") h.expire(60000);
    await pending;
    assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
    assert.equal(h.calls[1].payload.requestId, "session-city-retry-123");
    assert.equal(progress.failedItems.length, 2);
    assert.equal(cleared, false);
    assert.equal(h.context.state.busy, false);
    assert.equal(h.timers.size, 0);
  });
}
