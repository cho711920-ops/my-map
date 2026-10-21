const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {createHash} = require("node:crypto");

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
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

test('closed-session proof clears only its checkpoint and permits a new manifest without replay', async()=>{
  const rescan={ok:false,code:'naver_closed_session_rescan',requiresFreshManifest:true,message:'latest full manifest required'};
  const h=harness(({payload})=>jsonResponse(payload.action==='mutationStatus'?{ok:true,ready:true,result:rescan}:{ok:true,needsDetail:[]}));
  h.storage.set('pending-save-test',JSON.stringify({requestId:'old-batch',sessionId:'old-session',fingerprint:'a'.repeat(64),count:5}));
  h.storage.set('city-progress-test',JSON.stringify({sessionId:'old-session',nextIndex:817}));
  h.storage.set('auto-progress-test',JSON.stringify({old:{sessionId:'old-session'},other:{sessionId:'other-session',nextIndex:12}}));
  const payload={action:'classifySourceManifest',requestId:'fresh-manifest',sessionId:'fresh-session',collectorKey:'test-only'};
  await h.context.fetchCollectorJson(payload,60000,'invalid');
  assert.deepEqual(h.calls.map(c=>c.payload.action),['mutationStatus','classifySourceManifest']);
  assert.equal(h.storage.has('pending-save-test'),false);assert.equal(h.storage.has('city-progress-test'),false);
  assert.deepEqual(JSON.parse(h.storage.get('auto-progress-test')),{other:{sessionId:'other-session',nextIndex:12}});
});

test('server-confirmed pending receipts preserve the pending key and return an explicit wait without polling or replay',async()=>{
  const retryAt=Date.now()+15*60000;
  const h=harness(()=>jsonResponse({ok:true,ready:false,recoveryWaitV56:{code:'naver_save_result_pending',retryAt,message:'확인 대기'}}));
  h.storage.set('pending-save-test',JSON.stringify({requestId:'old-batch',sessionId:'old-session',fingerprint:'a'.repeat(64),count:5}));
  const before=h.storage.get('pending-save-test');
  await assert.rejects(h.context.fetchCollectorJson({action:'classifySourceManifest',requestId:'new-manifest',sessionId:'new'},60000,'invalid'),
    error=>error.recoveryWaitV56?.code==='naver_save_result_pending'&&error.recoveryWaitV56.retryAt===retryAt);
  assert.deepEqual(h.calls.map(x=>x.payload.action),['mutationStatus']);assert.equal(h.storage.get('pending-save-test'),before);
  assert.equal(h.delays.length,0);
});

test('a closed-session direct rejection is never retried or mistaken for a successful batch', async()=>{
  const h=harness(()=>jsonResponse({ok:false,code:'naver_closed_session_rescan',requiresFreshManifest:true,message:'restart from manifest'}));
  await assert.rejects(h.context.postBatchWithRetry([],6,{sessionId:'old-session',requestId:'old-batch'}),e=>e.collectorFreshScanRequired);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.action,'saveNaverBatch');assert.equal(h.storage.has('pending-save-test'),false);
});

function harness(fetch) {
  const timers = new Map();
  const calls = [];
  const delays = [];
  const storage = new Map();
  let nextTimer = 1;
  const context = vm.createContext({
    AbortController,
    TextEncoder,
    crypto: {subtle: {digest: async (_, data) => Uint8Array.from(createHash("sha256").update(data).digest()).buffer}},
    COLLECTOR_API_URL: "https://collector.invalid/api/collector",
    COLLECTOR_REQUEST_TIMEOUT_MS: 60000,
    COLLECTOR_FINALIZE_TIMEOUT_MS: 120000,
    COLLECTOR_RESULT_TIMEOUT_MS: 30000,
    COLLECTOR_RECOVERY_ATTEMPTS: 4,
    COLLECTOR_RECOVERY_DELAY_MS: 5000,
    FIN_DETAIL_TIMEOUT_MS: 15000,
    FIN_DETAIL_CONCURRENCY: 5,
    BATCH_SIZE: 20, DEFAULT_BATCH_SIZE: 20, MIN_BATCH_SIZE: 5, MAX_BATCH_SIZE: 40,
    BATCH_SIZE_STORAGE_KEY: "batch-size-test",
    PENDING_SAVE_STORAGE_KEY: "pending-save-test",
    CITY_PROGRESS_KEY: "city-progress-test",AUTO_DISTRICT_PROGRESS_KEY:"auto-progress-test",
    localStorage: {get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null, getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)},
    state: {stopRequested: false, runGeneration: 1},
    panel: {isConnected: true},
    VERSION: "6.0.7",
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
  for (const name of ["loadNaverBatchSize", "rememberNaverBatchSize", "collectorRequestFailure",
    "collectorRecoveryIsCurrent", "recoverCollectorRequest", "naverBatchRequestId",
    "pendingNaverSaves", "pendingNaverSave", "rememberPendingNaverSave", "clearPendingNaverSave", "resetClosedNaverCheckpoint", "requireFreshNaverManifest", "reconcilePendingNaverSave",
    "fetchCollectorText", "fetchCollectorJson", "classifyNaverManifest",
    "postBatch", "postBatchWithRetry", "finalizeNaverSession", "addNaverDiagnostics", "getNaverSessionResult",
    "fetchFinJson", "enrichNaverDetailBatch", "collectAndSave", "retryFailedCityArticles",
    "collectFinDaejeonAll"]) {
    vm.runInContext(functionSource(name), context);
  }
  return {
    context, calls, delays, timers, storage,
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
      assert.deepEqual(h.delays, operation.action === "getNaverSessionResult" ? [] : [5000, 5000, 5000]);
      if (operation.action !== "getNaverSessionResult") {
        assert.equal(h.calls[1].payload.action, "mutationStatus");
        assert.equal(h.calls[1].payload.targetAction, operation.action);
        assert.equal(h.calls[1].payload.requestId, h.calls[0].payload.requestId);
        assert.equal(h.calls.filter(call => call.payload.action === "mutationStatus").length, 4);
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
  assert.match(h.calls[1].payload.requestId, /^session-1-batch-0-[a-f0-9]{64}$/);
  assert.equal(h.calls[1].payload.requestId, h.calls[0].payload.requestId);
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await flush();
    h.expire(30000);
  }
  await rejected;
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", ...Array(4).fill("mutationStatus")]);
  assert.equal(h.timers.size, 0);
});

for (const malformed of [null, {}, [], 1, "saved", {ok: "true"}]) {
  test(`a malformed JSON save envelope ${JSON.stringify(malformed)} is reconciled without replay`, async () => {
    const h = harness(({payload}) => payload.action === "mutationStatus"
      ? jsonResponse({ok: true, ready: false})
      : jsonResponse(malformed));
    await assert.rejects(h.context.postBatchWithRetry([], 6, {requestId: "same-batch"}),
      error => error.collectorRequestAmbiguous && error.collectorAction === "saveNaverBatch");
    assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", ...Array(4).fill("mutationStatus")]);
    assert.equal(h.calls[1].payload.requestId, h.calls[0].payload.requestId);
    assert.deepEqual(h.delays, [5000, 5000, 5000]);
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
  assert.match(h.calls[1].payload.requestId, /^session-1-batch-0-[a-f0-9]{64}$/);
  assert.equal(h.calls[2].payload.complete, true);
  assert.equal(h.calls[2].payload.processedCount, 2);
  assert.equal(h.timers.size, 0);
});

test("a 1201-row manifest uses 500/500/201 chunks with exact offsets and complete accounting", async () => {
  const dashboards = [];
  const h = harness(({payload}) => {
    assert.equal(payload.action, "classifySourceManifest");
    const entries = payload.entries;
    return jsonResponse({ok: true, needsDetail: [entries[0].sourceId, entries.at(-1).sourceId],
      unchanged: entries.length - 2, changed: 1, unknown: 1});
  });
  h.context.updateDashboard = update => dashboards.push(JSON.parse(JSON.stringify(update)));
  const items = Array.from({length: 1201}, (_, index) => ({articleNo: String(index + 1), areaSquareMeter: 33}));
  const classified = await h.context.classifyNaverManifest(items, {sessionId: "session-large", scope: "서구 전체"});
  assert.deepEqual(h.calls.map(call => call.payload.entries.length), [500, 500, 201]);
  assert.deepEqual(h.calls.map(call => call.payload.requestId),
    [0, 500, 1000].map(offset => `session-large-manifest-${offset}`));
  assert.deepEqual(h.calls.flatMap(call => call.payload.entries.map(entry => entry.sourceId)),
    items.map(item => `네이버-${item.articleNo}`));
  assert.deepEqual(Array.from(classified.items, item => item.articleNo), ["1", "500", "501", "1000", "1001", "1201"]);
  assert.equal(classified.unchanged, 1195);
  assert.equal(classified.changed, 3);
  assert.equal(classified.unknown, 3);
  assert.equal(classified.items.length + classified.unchanged, items.length);
  assert.deepEqual(dashboards.map(update => update.processed), [500, 1000, 1201]);
  assert.deepEqual(dashboards.map(update => update.remaining), [701, 201, 0]);
  assert.equal(dashboards.at(-1).skippedUnchanged, 1195);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.delays, []);
});

test("an ambiguous second manifest chunk is reconciled by its exact offset without replay or advancement", async () => {
  const h = harness(({payload}) => {
    if (payload.action === "mutationStatus") return jsonResponse({ok: true, ready: false});
    if (payload.requestId.endsWith("-0")) return jsonResponse({ok: true, needsDetail: [], unchanged: 500});
    return new Promise(() => {});
  });
  const items = Array.from({length: 1201}, (_, index) => ({articleNo: String(index + 1)}));
  const pending = h.context.classifyNaverManifest(items, {sessionId: "session-large", scope: "서구 전체"});
  const rejected = assert.rejects(pending, error => error.collectorRequestAmbiguous &&
    error.collectorAction === "classifySourceManifest");
  await flush();
  h.expire(60000);
  await rejected;
  const writes = h.calls.filter(call => call.payload.action === "classifySourceManifest");
  const reads = h.calls.filter(call => call.payload.action === "mutationStatus");
  assert.deepEqual(writes.map(call => call.payload.requestId), ["session-large-manifest-0", "session-large-manifest-500"]);
  assert.equal(reads.length, 4);
  assert.equal(reads.every(call => call.payload.requestId === "session-large-manifest-500" &&
    call.payload.targetAction === "classifySourceManifest"), true);
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
    assert.equal(h.calls.filter(call => call.payload.action === "mutationStatus").length, 4);
  });
}

test("a confirmed finalization CPU failure preserves saves and a fresh manifest retry skips them", async () => {
  let saved = false;
  let completeAttempts = 0;
  let sessionNumber = 0;
  let detailCalls = 0;
  const h = harness(({payload}) => {
    if (payload.action === "classifySourceManifest") {
      return jsonResponse({ok: true, needsDetail: saved ? [] : ["네이버-123"], unchanged: saved ? 1 : 0});
    }
    if (payload.action === "saveNaverBatch") {
      saved = true;
      return jsonResponse({ok: true, accepted: 1, saved: 1, created: 1});
    }
    if (payload.action === "finalizeNaverSession") {
      if (payload.complete && ++completeAttempts === 1) {
        return jsonResponse({ok: false, message: "D1_ERROR: CPU time limit exceeded during finalization"});
      }
      return jsonResponse({ok: true, complete: payload.complete, totals: {
        accepted: 0, saved: 0, created: 0, failed: 0, newSourceAdsReported: true, newSourceAds: 0
      }});
    }
    assert.fail("unexpected action " + payload.action);
  });
  const dashboard = {};
  Object.assign(h.context, {
    state: {busy: false, preparing: false, stopRequested: false, selectionMode: "district",
      selectedDistrict: {}, dashboard},
    saveButton: {}, retryButton: {},
    createCollectionSessionId: () => "session-" + (++sessionNumber),
    normalize: item => item,
    enrichNaverDetailBatch: async items => {
      detailCalls += 1;
      return items.map(item => ({item, valid: true}));
    },
    showNaverSaveWait() {},
    updateDashboard: updates => Object.assign(dashboard, updates),
    addResultTotals(totals, result) {
      for (const key of ["accepted", "saved", "created"]) totals[key] += Number(result[key] || 0);
    },
    newSourceAdCounts: result => result && result.newSourceAdsReported === true
      ? {newSourceAds: result.newSourceAds, newSourceAdsReported: true} : {},
    adjustBatchSize() {}, finishCollectorRun() {}, isFinNaver: () => true
  });
  const failed = await h.context.collectAndSave([{articleNo: "123"}], "서구 전체", {complete: true});
  assert.equal(failed.ok, false);
  assert.equal(failed.complete, false);
  assert.match(failed.message, /CPU time limit/);
  assert.equal(failed.totals.accepted, 1);
  assert.equal(failed.totals.saved, 1);
  const finals = h.calls.filter(call => call.payload.action === "finalizeNaverSession");
  assert.deepEqual(finals.map(call => call.payload.complete), [true, false]);
  assert.equal(finals[1].payload.expectedCount, 0, "partial preservation cannot claim a complete census");
  assert.equal(finals[1].payload.completionProof, null);
  assert.equal(finals[1].payload.presenceScope, null);
  assert.equal(h.calls.some(call => call.payload.action === "mutationStatus"), false,
    "a confirmed JSON error is not an ambiguous write");

  const retried = await h.context.collectAndSave([{articleNo: "123"}], "서구 전체", {complete: true});
  assert.equal(retried.ok, true);
  assert.equal(retried.complete, true);
  assert.equal(retried.classification.unchanged, 1);
  assert.equal(retried.totals.newSourceAds, 0);
  assert.equal(detailCalls, 1);
  assert.equal(h.calls.filter(call => call.payload.action === "saveNaverBatch").length, 1);
  assert.deepEqual(h.calls.filter(call => call.payload.action === "classifySourceManifest")
    .map(call => call.payload.sessionId), ["session-1", "session-2"]);
  assert.equal(h.timers.size, 0);
});

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
    assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", ...Array(4).fill("mutationStatus")]);
    assert.match(h.calls[1].payload.requestId, /^session-city-retry-123-[a-f0-9]{64}$/);
    assert.equal(h.calls[1].payload.requestId, h.calls[0].payload.requestId);
    assert.equal(progress.failedItems.length, 2);
    assert.equal(cleared, false);
    assert.equal(h.context.state.busy, false);
    assert.equal(h.timers.size, 0);
  });
}

test("a late third-read success reconciles exactly one saved write", async () => {
  let reads = 0;
  const saved = {ok: true, saved: 20, created: 2};
  const h = harness(({payload}) => {
    if (payload.action === "mutationStatus") {
      reads += 1;
      return jsonResponse(reads < 3 ? {ok: true, ready: false} : {ok: true, ready: true, result: saved});
    }
    return new Promise(() => {});
  });
  const pending = h.context.postBatchWithRetry([{articleNo: "123", contact: "must-not-persist"}], 6,
    {sessionId: "session-late", requestId: "session-late-batch-0"});
  await flush();
  const descriptor = h.context.pendingNaverSave();
  assert.deepEqual(Object.keys(descriptor).sort(), ["count", "createdAt", "fingerprint", "requestId", "scope", "sessionId"]);
  assert.equal(JSON.stringify(descriptor).includes("must-not-persist"), false);
  assert.equal(JSON.stringify(descriptor).includes("test-only-key"), false);
  h.expire(60000);
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), saved);
  assert.equal(h.context.BATCH_SIZE, 10);
  assert.equal(h.context.loadNaverBatchSize(), 10);
  assert.equal(Boolean(h.context.pendingNaverSave()), false);
  assert.deepEqual(h.delays, [5000, 5000]);
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", ...Array(3).fill("mutationStatus")]);
  for (const call of h.calls.slice(1)) {
    assert.equal(call.payload.requestId, h.calls[0].payload.requestId);
    assert.equal(call.payload.targetAction, "saveNaverBatch");
  }
});

test("a server running claim is polled, never posted again", async () => {
  const h = harness(({payload}) => jsonResponse(payload.action === "mutationStatus"
    ? {ok: true, ready: true, result: {ok: true, saved: 1}}
    : {ok: false, requestPending: true, message: "already running"}));
  const result = await h.context.postBatchWithRetry([{articleNo: "123"}], 6, {requestId: "pending-batch"});
  assert.equal(result.saved, 1);
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
  assert.equal(h.calls[1].payload.requestId, h.calls[0].payload.requestId);
  assert.equal(Boolean(h.context.pendingNaverSave()), false);
});

test("a recovered confirmed failure is not replayed under the cached request ID", async () => {
  const h = harness(({payload}) => {
    if (payload.action === "mutationStatus") return jsonResponse({ok: true, ready: true,
      result: {ok: false, message: "confirmed storage failure"}});
    throw new TypeError("lost response");
  });
  await assert.rejects(h.context.postBatchWithRetry([], 6, {requestId: "failed-batch"}),
    error => error.collectorFailureConfirmed && error.message === "confirmed storage failure");
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
  assert.equal(Boolean(h.context.pendingNaverSave()), false);
});

test("a normal terminal save failure is not posted again under its cached ID", async () => {
  const h = harness(() => jsonResponse({ok: false, message: "confirmed save failure"}));
  await assert.rejects(h.context.postBatchWithRetry([], 6, {requestId: "failed-batch"}),
    error => error.collectorFailureConfirmed && error.message === "confirmed save failure");
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch"]);
  assert.equal(Boolean(h.context.pendingNaverSave()), false);
  assert.deepEqual(h.delays, []);
});

test("the explicit legacy pre-write lock response keeps its bounded lock retry", async () => {
  let attempts = 0;
  const h = harness(() => jsonResponse(++attempts < 3
    ? {ok: false, message: "다른 수집 저장이 진행 중입니다."}
    : {ok: true, saved: 1}));
  assert.equal((await h.context.postBatchWithRetry([], 6, {requestId: "locked-batch"})).saved, 1);
  assert.deepEqual(h.calls.map(call => call.payload.action), Array(3).fill("saveNaverBatch"));
  assert.equal(new Set(h.calls.map(call => call.payload.requestId)).size, 1);
  assert.deepEqual(h.delays, [2000, 4000]);
});

for (const canceledBy of ["panel", "run"]) {
  for (const canceledAt of ["read", "delay"]) {
    test(`${canceledBy} replacement during ${canceledAt} stops further recovery without replay`, async () => {
      let h;
      const cancel = () => canceledBy === "panel" ? h.context.panel.isConnected = false : h.context.state.runGeneration++;
      h = harness(({payload}) => {
        if (payload.action !== "mutationStatus") throw new TypeError("lost response");
        if (canceledAt === "read") cancel();
        return jsonResponse({ok: true, ready: false});
      });
      if (canceledAt === "delay") h.context.delay = async () => { cancel(); };
      await assert.rejects(h.context.postBatchWithRetry([], 6, {requestId: "canceled-batch"}),
        error => error.collectorRequestAmbiguous);
      assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus"]);
      assert.equal(Boolean(h.context.pendingNaverSave()), true);
      assert.equal(h.timers.size, 0);
    });
  }
}

test("safe stop reconciles the already-sent write without posting another write", async () => {
  let h;
  let reads = 0;
  h = harness(({payload}) => {
    if (payload.action !== "mutationStatus") throw new TypeError("lost response");
    h.context.state.stopRequested = true;
    return jsonResponse(++reads < 2 ? {ok: true, ready: false}
      : {ok: true, ready: true, result: {ok: true, saved: 1}});
  });
  assert.equal((await h.context.postBatchWithRetry([], 6, {requestId: "stop-batch"})).saved, 1);
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch", "mutationStatus", "mutationStatus"]);
  assert.equal(h.context.state.stopRequested, true);
  assert.equal(Boolean(h.context.pendingNaverSave()), false);
});

test("a replaced panel cannot continue the old run after its late normal save response", async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const pending = h.context.postBatchWithRetry([], 6, {requestId: "replaced-panel"});
  await flush();
  h.context.panel.isConnected = false;
  release(jsonResponse({ok: true, saved: 1}));
  await assert.rejects(pending, error => error.collectorRequestAmbiguous);
  assert.deepEqual(h.calls.map(call => call.payload.action), ["saveNaverBatch"]);
  assert.equal(Boolean(h.context.pendingNaverSave()), true);
  assert.equal(h.timers.size, 0);
});

test("unresolved safe stop preserves ambiguity and its pending descriptor", async () => {
  let h;
  h = harness(({payload}) => {
    if (payload.action !== "mutationStatus") throw new TypeError("lost response");
    h.context.state.stopRequested = true;
    return jsonResponse({ok: true, ready: false});
  });
  await assert.rejects(h.context.postBatchWithRetry([], 6, {requestId: "stop-batch"}),
    error => error.collectorRequestAmbiguous && error.safeStop);
  assert.equal(h.calls.filter(call => call.payload.action === "saveNaverBatch").length, 1);
  assert.equal(h.calls.filter(call => call.payload.action === "mutationStatus").length, 4);
  assert.equal(Boolean(h.context.pendingNaverSave()), true);
});

for (const nextAction of ["classifySourceManifest", "saveNaverBatch", "finalizeNaverSession"]) {
  test(`a fresh tab blocks ${nextAction} until the previous save is confirmed`, async () => {
    const prior = harness(({payload}) => payload.action === "mutationStatus"
      ? jsonResponse({ok: true, ready: false}) : Promise.reject(new TypeError("lost response")));
    await assert.rejects(prior.context.postBatchWithRetry([{articleNo: "1"}], 6,
      {sessionId: "old-city-session", requestId: "old-city-index-0"}));
    const fresh = harness(() => jsonResponse({ok: true, ready: false}));
    for (const [key, value] of prior.storage) fresh.storage.set(key, value);
    const payload = {action: nextAction, collectorKey: "test-only-key", requestId: "new-batch", data: []};
    await assert.rejects(fresh.context.fetchCollectorJson(payload, 60000, "bad result"),
      error => error.collectorRequestAmbiguous);
    assert.deepEqual(fresh.calls.map(call => call.payload.action), Array(4).fill("mutationStatus"));
    assert.equal(fresh.calls.every(call => call.payload.requestId === prior.calls[0].payload.requestId), true);
    assert.deepEqual([...fresh.storage], [...prior.storage]);
  });
}

test("a fresh tab may compare again only after the exact previous write is confirmed", async () => {
  const prior = harness(({payload}) => payload.action === "mutationStatus"
    ? jsonResponse({ok: true, ready: false}) : Promise.reject(new TypeError("lost response")));
  await assert.rejects(prior.context.postBatchWithRetry([], 6,
    {sessionId: "old-session", requestId: "old-session-batch-0"}));
  const fresh = harness(({payload}) => jsonResponse(payload.action === "mutationStatus"
    ? {ok: true, ready: true, result: {ok: true, saved: 1}}
    : {ok: true, needsDetail: [], unchanged: 1}));
  for (const [key, value] of prior.storage) fresh.storage.set(key, value);
  await fresh.context.classifyNaverManifest([{articleNo: "1"}], {sessionId: "fresh-session"});
  assert.deepEqual(fresh.calls.map(call => call.payload.action), ["mutationStatus", "classifySourceManifest"]);
  assert.equal(fresh.calls[0].payload.requestId, prior.calls[0].payload.requestId);
  assert.equal(Boolean(fresh.context.pendingNaverSave()), false);
});

test("a same-payload resumed batch returns its confirmed old result without posting", async () => {
  const prior = harness(({payload}) => payload.action === "mutationStatus"
    ? jsonResponse({ok: true, ready: false}) : Promise.reject(new TypeError("lost response")));
  const data = [{articleNo: "123"}];
  const metadata = {sessionId: "same-city", requestId: "same-city-index-0"};
  await assert.rejects(prior.context.postBatchWithRetry(data, 6, metadata));
  const fresh = harness(() => jsonResponse({ok: true, ready: true, result: {ok: true, saved: 1}}));
  for (const [key, value] of prior.storage) fresh.storage.set(key, value);
  assert.equal((await fresh.context.postBatchWithRetry(data, 6, metadata)).saved, 1);
  assert.deepEqual(fresh.calls.map(call => call.payload.action), ["mutationStatus"]);
  assert.equal(fresh.calls[0].payload.requestId, prior.calls[0].payload.requestId);
});

test("a damaged pending descriptor blocks new writes instead of discarding uncertainty", async () => {
  const h = harness(() => { throw new Error("must not call server"); });
  h.storage.set("pending-save-test", "invalid JSON");
  await assert.rejects(h.context.postBatchWithRetry([], 6, {requestId: "fresh-batch"}),
    error => error.collectorRequestAmbiguous);
  assert.equal(h.calls.length, 0);
});

for (const interruptedAt of ["fetch", "json", "delay"]) {
  test(`superseded passive preparation stops after ${interruptedAt} without changing automatic progress`, async () => {
    const capture = {
      articles: [{articleNo: "1"}],
      json: {result: {totalCount: 90, hasNextPage: true, lastInfo: [{cursor: "2"}], list: [{articleNo: "1"}]}},
      requestOptions: {requestBody: {}},
      responseUrl: "https://fin.land.naver.com/front-api/v1/article/legalDivisionArticleList"
    };
    let release;
    const paused = new Promise(resolve => { release = resolve; });
    let requests = 0;
    let progressWrites = 0;
    const automaticRows = [{articleNo: "automatic"}];
    const state = {busy: false, preparing: false, prepareId: 1, capture};
    const context = vm.createContext({
      state, FIN_PAGE_SIZE: 30, FIN_MAX_PAGES: 500, CITY_PAGE_DELAY: 70,
      nativeFetch() {},
      articleId: item => item.articleNo,
      articleList: json => json.result.list,
      expectedCount: () => 90,
      hasMore: json => json.result.hasNextPage,
      formatNumber: String,
      setStatus() { progressWrites += 1; },
      setProgress() { progressWrites += 1; },
      updateDashboard() { progressWrites += 1; },
      showCapture() { throw new Error("Obsolete capture must not be shown"); },
      saveButton: {},
      fetchPageWithRetry: async () => {
        requests += 1;
        if (interruptedAt === "fetch") await paused;
        return {ok: true, json: async () => {
          if (interruptedAt === "json") await paused;
          return {result: {totalCount: 90, hasNextPage: true, lastInfo: [{cursor: "3"}], list: [{articleNo: "2"}]}};
        }};
      },
      delay: async () => { if (interruptedAt === "delay") await paused; }
    });
    for (const name of ["naverProviderTotal", "checkedNaverTotal", "checkedNaverList", "naverPresenceScope", "naverListResult",
      "prepareFullCapture", "collectAll", "collectFinCapturedRequest"]) {
      vm.runInContext(functionSource(name), context);
    }
    const pending = context.prepareFullCapture(capture, 1);
    await flush();
    assert.equal(requests, 1);
    // This is the same token invalidation performed by runAutomatic.
    state.prepareId += 1;
    state.capture = null;
    state.collected = automaticRows;
    state.preparing = true;
    const writesBeforeRelease = progressWrites;
    release();
    await pending;
    assert.equal(requests, 1, "no further obsolete page is requested");
    assert.equal(progressWrites, writesBeforeRelease, "automatic progress stays intact");
    assert.equal(state.collected, automaticRows);
    assert.equal(state.preparing, true, "passive finally does not reset the automatic preparation");
    assert.equal(capture.prepared, undefined);
  });
}


test("a pending district does not block a different district and both uncertain request IDs survive", async () => {
  const h = harness(({payload}) => payload.action === "mutationStatus"
    ? jsonResponse({ok: true, ready: false}) : Promise.reject(new TypeError("lost response")));
  await assert.rejects(h.context.postBatchWithRetry([{articleNo: "1"}], 6,
    {sessionId: "seo-session", requestId: "seo-batch-0", scope: "대전 서구 전체"}));
  const firstId = h.context.pendingNaverSave().requestId;
  h.calls.length = 0;
  await assert.rejects(h.context.postBatchWithRetry([{articleNo: "2"}], 6,
    {sessionId: "dong-session", requestId: "dong-batch-0", scope: "대전 동구 전체"}));
  assert.equal(h.calls[0].payload.action, "saveNaverBatch");
  assert.equal(h.calls.some(c => c.payload.requestId === firstId), false);
  assert.equal(h.context.pendingNaverSaves().length, 2);
  const records = Array.from(h.context.pendingNaverSaves());
  h.context.clearPendingNaverSave(records[1].requestId);
  assert.equal(h.context.pendingNaverSaves().length, 1);
  assert.equal(h.context.pendingNaverSave().requestId, firstId);
});

for (const scope of ["대전 서구 전체", "", "선택 클러스터"]) {
  test(`same/unknown scope '${scope}' cannot bypass an unconfirmed district save`, async () => {
    const h = harness(({payload}) => payload.action === "mutationStatus"
      ? jsonResponse({ok:true,ready:false}) : Promise.reject(new TypeError("lost response")));
    await assert.rejects(h.context.postBatchWithRetry([{articleNo:"1"}], 6,
      {sessionId:"old", requestId:"old-batch", scope:"대전 서구 전체"}));
    h.calls.length = 0;
    await assert.rejects(h.context.fetchCollectorJson({action:"classifySourceManifest",sessionId:"new",
      requestId:"new-manifest",scope,collectorKey:"test-only"},60000,"invalid"));
    assert.equal(h.calls.every(c => c.payload.action === "mutationStatus"), true);
    assert.equal(h.context.pendingNaverSaves().length, 1);
  });
}

test("closed-session recovery still forbids a direct save/finalization without a fresh census", async()=>{
  for (const action of ["saveNaverBatch","finalizeNaverSession"]) {
    const h=harness(()=>jsonResponse({ok:true,ready:true,result:{ok:false,code:"naver_closed_session_rescan",requiresFreshManifest:true}}));
    h.storage.set("pending-save-test",JSON.stringify({requestId:"old-batch",sessionId:"old",fingerprint:"a".repeat(64),count:5}));
    await assert.rejects(h.context.fetchCollectorJson({action,sessionId:"new",requestId:"new-request",data:[]},60000,"invalid"), e=>e.collectorFreshScanRequired);
    assert.deepEqual(h.calls.map(c=>c.payload.action),["mutationStatus"]);
  }
});
