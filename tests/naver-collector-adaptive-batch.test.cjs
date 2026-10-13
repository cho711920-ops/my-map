const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");

const source = fs.readFileSync(path.resolve(__dirname, "..", "js", "naver-collector.js"), "utf8");
function functionSource(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.notEqual(start, -1);
  const tail = source.slice(start + 2);
  const next = tail.slice(1).search(/\n {2}(?:async )?function /);
  return next < 0 ? tail : tail.slice(0, next + 1);
}
function harness(storage = new Map()) {
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    }
  });
  for (const name of ["DEFAULT_BATCH_SIZE", "MIN_BATCH_SIZE", "MAX_BATCH_SIZE", "BATCH_SIZE_STORAGE_KEY"]) {
    vm.runInContext(source.match(new RegExp(`  var ${name} = [^;]+;`))[0], context);
  }
  for (const name of ["loadNaverBatchSize", "rememberNaverBatchSize", "adjustBatchSize", "naverBatchRequestId"]) {
    vm.runInContext(functionSource(name), context);
  }
  vm.runInContext("var BATCH_SIZE = loadNaverBatchSize();", context);
  return {context, storage};
}

test("new tabs start at 20 and reuse a previously reduced bounded size", () => {
  const first = harness();
  assert.equal(first.context.BATCH_SIZE, 20);
  first.context.rememberNaverBatchSize(10);
  assert.equal(harness(first.storage).context.BATCH_SIZE, 10);
});

for (const [saved, expected] of [["100", 40], ["2", 5], ["8.9", 8], ["0", 20], ["NaN", 20], ["Infinity", 20]]) {
  test(`stored batch preference ${saved} resolves safely to ${expected}`, () => {
    const storage = new Map([["js_naver_save_batch_size_v1", saved]]);
    assert.equal(harness(storage).context.BATCH_SIZE, expected);
  });
}

test("adaptive saves grow slowly, shrink on slow/failed responses, and stay within 5–40", () => {
  const h = harness();
  assert.equal(h.context.adjustBatchSize(1000, 0), 25);
  assert.equal(h.context.adjustBatchSize(13000, 0), 17);
  assert.equal(h.context.adjustBatchSize(1000, 1), 11);
  for (let i = 0; i < 20; i += 1) h.context.adjustBatchSize(13000, 0);
  assert.equal(h.context.BATCH_SIZE, 5);
  assert.equal(harness(h.storage).context.BATCH_SIZE, 5);
  for (let i = 0; i < 20; i += 1) h.context.adjustBatchSize(1000, 0);
  assert.equal(h.context.BATCH_SIZE, 40);
  assert.equal(harness(h.storage).context.BATCH_SIZE, 40);
});

test("city checkpoint IDs bind exact payload content, not just its resumable index", async () => {
  const h = harness();
  const payload = {action: "saveNaverBatch", requestId: "city-session-index-0", sessionId: "city-session",
    collectorKey: "not-part-of-identity", data: [{articleNo: "1", rent: 100}, {articleNo: "2", rent: 200}]};
  const original = await h.context.naverBatchRequestId(payload);
  assert.equal(original, await h.context.naverBatchRequestId(JSON.parse(JSON.stringify(payload))));
  assert.equal(original, await h.context.naverBatchRequestId({...payload, collectorKey: "rotated-key"}));
  assert.notEqual(original, await h.context.naverBatchRequestId({...payload, data: payload.data.slice(0, 1)}));
  assert.notEqual(original, await h.context.naverBatchRequestId({...payload, data: [{articleNo: "1", rent: 101}]}));
  const bounded = await h.context.naverBatchRequestId({...payload, requestId: "x".repeat(300)});
  assert.ok(bounded.length <= 160);
  assert.match(original, /^city-session-index-0-[a-f0-9]{64}$/);
});

test("adaptive detailed saves cover every candidate once as the batch size changes", async () => {
  const h = harness();
  const requests = [];
  const dashboard = {};
  Object.assign(h.context, {
    state: {busy: false, preparing: false, stopRequested: false, dashboard},
    window: {setInterval: () => 1, clearInterval() {}},
    location: {href: "https://fin.land.naver.com/map"},
    saveButton: {}, retryButton: {},
    parseFinFilters: () => ({tradeTypes: ["B2"]}),
    createCollectionSessionId: () => "adaptive-session",
    normalize: item => item,
    classifyNaverManifest: async items => ({items, unchanged: 0}),
    enrichNaverDetailBatch: async items => items.map(item => ({item, valid: true})),
    postBatchWithRetry: async (items, attempts, metadata) => {
      requests.push({ids: items.map(item => item.articleNo), requestId: metadata.requestId});
      return {ok: true, created: items.length, accepted: items.length};
    },
    finalizeNaverSession: async () => ({ok: true, complete: true, totals: {created: 80}}),
    addResultTotals: (totals, result) => { totals.created += result.created; totals.accepted += result.accepted; },
    updateDashboard: data => Object.assign(dashboard, data),
    setStatus() {}, setProgress() {}, showNaverSaveWait() {}, finishCollectorRun() {},
    delay: async () => {}, clean: String, isFinNaver: () => true
  });
  vm.runInContext(functionSource("collectAndSave"), h.context);
  const input = Array.from({length: 80}, (_, index) => ({articleNo: String(index + 1)}));
  const result = await h.context.collectAndSave(input, "서구 전체", {complete: true});
  assert.equal(result.ok, true);
  assert.deepEqual(requests.map(request => request.ids.length), [20, 25, 30, 5]);
  assert.deepEqual(requests.flatMap(request => Array.from(request.ids)), input.map(item => item.articleNo));
  assert.deepEqual(requests.map(request => request.requestId), [0, 20, 45, 75].map(index => `adaptive-session-batch-${index}`));
  assert.equal(dashboard.processed, 80);
});
