import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const storageSource = readFileSync(new URL("../js/diagnosis-storage.js", import.meta.url), "utf8");

function harness(options = {}) {
  const local = new Map();
  const reads = [];
  const mutations = [];
  const fetches = [];
  const controllers = [];
  let readResult = {ok: true, found: false};
  let mutationResult = {ok: true};
  let readError = null;
  let mutationError = null;

  class AbortControllerFake {
    constructor() {
      this.signal = {aborted: false};
      controllers.push(this);
    }
    abort() { this.signal.aborted = true; }
  }

  const window = {
    saveApiURL: options.saveApiURL,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) { return local.has(key) ? local.get(key) : null; },
      setItem(key, value) {
        if (options.quotaFailure) throw new Error("QuotaExceededError");
        local.set(key, String(value));
      }
    }
  };
  if (options.shared !== false) {
    window.JSDataAccessV6 = {
      read(action, params, settings) {
        reads.push({action, params, settings});
        return readError ? Promise.reject(readError) : Promise.resolve(readResult);
      },
      mutate(action, payload, settings) {
        mutations.push({action, payload, settings});
        return mutationError ? Promise.reject(mutationError) : Promise.resolve(mutationResult);
      }
    };
  }

  async function fetchFake(url, settings = {}) {
    fetches.push({url: String(url), settings});
    if (settings.method === "POST") return response({ok: true});
    return response(readResult);
  }
  function response(payload, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload
    };
  }

  vm.runInNewContext(storageSource, {
    window,
    fetch: fetchFake,
    AbortController: AbortControllerFake,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Error,
    encodeURIComponent,
    setTimeout,
    clearTimeout
  });

  return {
    storage: window.PermitDiagnosisStorageV1,
    local,
    reads,
    mutations,
    fetches,
    controllers,
    setReadResult(value) { readResult = value; },
    setMutationResult(value) { mutationResult = value; },
    setReadError(value) { readError = value; },
    setMutationError(value) { mutationError = value; }
  };
}

function record(recordKey = "restaurant_abc") {
  return {recordKey, diagnosisStatus: "YELLOW", updatedAt: "2026-08-14T00:00:00.000Z"};
}

test("diagnosis load uses the shared boundary and refreshes the local copy", async () => {
  const app = harness();
  const cloudRecord = record();
  app.setReadResult({ok: true, found: true, data: cloudRecord});

  const loaded = await app.storage.load(cloudRecord.recordKey);

  assert.deepEqual(loaded, cloudRecord);
  assert.equal(app.reads.length, 1);
  assert.equal(app.fetches.length, 0);
  assert.equal(app.reads[0].action, "loadCloudState");
  assert.equal(app.reads[0].params.scope, "permitDiagnosis");
  assert.equal(app.reads[0].params.recordKey, cloudRecord.recordKey);
  assert.equal(app.reads[0].settings.cache, "no-store");
  assert.equal(app.reads[0].settings.signal, app.controllers[0].signal);
  assert.deepEqual(JSON.parse(app.local.get(`js_permit_diagnosis_v1_${cloudRecord.recordKey}`)), cloudRecord);
});

test("diagnosis load preserves local fallback for missing and failed cloud reads", async () => {
  const app = harness();
  const localRecord = record("restaurant_local");
  app.storage.saveLocal(localRecord);

  app.setReadResult({ok: true, found: false});
  assert.deepEqual(await app.storage.load(localRecord.recordKey), localRecord);

  app.setReadError(new Error("temporary D1 read failure"));
  assert.deepEqual(await app.storage.load(localRecord.recordKey), localRecord);
  assert.equal(app.reads.length, 2);
});

test("diagnosis save writes locally first and mutates through the shared boundary", async () => {
  const app = harness();
  const savedRecord = record("restaurant_shared");

  const result = await app.storage.save(savedRecord);

  assert.equal(result.cloudSaved, true);
  assert.equal(result.localSaved, true);
  assert.equal(app.mutations.length, 1);
  assert.equal(app.fetches.length, 0);
  assert.equal(app.mutations[0].action, "saveCloudState");
  assert.equal(app.mutations[0].payload.scope, "permitDiagnosis");
  assert.equal(app.mutations[0].payload.recordKey, savedRecord.recordKey);
  assert.deepEqual(app.mutations[0].payload.data, savedRecord);
  assert.equal(typeof app.mutations[0].payload.version, "number");
  assert.equal(app.mutations[0].settings.signal, app.controllers[0].signal);
  assert.deepEqual(JSON.parse(app.local.get(`js_permit_diagnosis_v1_${savedRecord.recordKey}`)), savedRecord);
});

test("diagnosis save reports cloud failure without losing a local record", async () => {
  const app = harness();
  const savedRecord = record("restaurant_retry");
  app.setMutationError(new Error("temporary D1 write failure"));

  const result = await app.storage.save(savedRecord);

  assert.equal(result.cloudSaved, false);
  assert.equal(result.localSaved, true);
  assert.match(result.warning, /temporary D1 write failure/);
  assert.deepEqual(app.storage.loadLocal(savedRecord.recordKey), savedRecord);
});

test("diagnosis cloud save continues when browser storage quota is exhausted", async () => {
  const app = harness({quotaFailure: true});
  const result = await app.storage.save(record("restaurant_quota"));

  assert.equal(result.localSaved, false);
  assert.equal(result.cloudSaved, true);
  assert.equal(app.mutations.length, 1);
});

test("diagnosis storage retains direct API read and write fallback", async () => {
  const app = harness({shared: false, saveApiURL: "/legacy-data"});
  const cloudRecord = record("restaurant_legacy");
  app.setReadResult({ok: true, found: true, data: cloudRecord});

  assert.deepEqual(await app.storage.load(cloudRecord.recordKey), cloudRecord);
  const saved = await app.storage.save(cloudRecord);

  assert.equal(saved.cloudSaved, true);
  assert.equal(app.fetches.length, 2);
  assert.match(app.fetches[0].url, /^\/legacy-data\?action=loadCloudState&scope=permitDiagnosis&recordKey=restaurant_legacy&_=/);
  assert.equal(app.fetches[0].settings.credentials, "same-origin");
  assert.equal(app.fetches[0].settings.cache, "no-store");
  assert.equal(app.fetches[1].url, "/legacy-data");
  assert.equal(app.fetches[1].settings.method, "POST");
  assert.equal(app.fetches[1].settings.credentials, "same-origin");
  assert.deepEqual(JSON.parse(app.fetches[1].settings.body), {
    action: "saveCloudState",
    scope: "permitDiagnosis",
    recordKey: cloudRecord.recordKey,
    data: cloudRecord,
    version: JSON.parse(app.fetches[1].settings.body).version
  });
});
