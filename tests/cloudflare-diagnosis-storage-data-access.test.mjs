import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const storageSource = readFileSync(new URL("../js/diagnosis-storage.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("diagnosis conflict UI uses a cache-busted STEP 6 asset", () => {
  assert.match(indexSource, /js\/diagnosis-storage\.js\?v=1\.3\.0-account-cas/);
  assert.match(indexSource, /js\/permit-diagnosis-step6\.js\?v=1\.4\.0-cloud-cas/);
});
const step6Source = readFileSync(new URL("../js/permit-diagnosis-step6.js", import.meta.url), "utf8");

function harness(options = {}) {
  const local = options.local || new Map();
  const reads = [];
  const mutations = [];
  const fetches = [];
  const controllers = [];
  const warnings = [];
  let readResult = {ok: true, found: false};
  let mutationResult = {ok: true};
  let readError = null;
  let mutationError = null;
  let readHandler = options.readHandler || null;
  let mutationHandler = options.mutationHandler || null;
  const windowSetTimeout = options.windowSetTimeout || setTimeout;
  const windowClearTimeout = options.windowClearTimeout || clearTimeout;

  class AbortControllerFake {
    constructor() {
      this.signal = {aborted: false};
      controllers.push(this);
    }
    abort() { this.signal.aborted = true; }
  }

  const window = {
    JSAuthenticatedAccountEmail: options.email || "tester@example.test",
    JSLegacyStorageOwnerEmailV1: options.legacyOwnerEmail || "",
    saveApiURL: options.saveApiURL,
    setTimeout: windowSetTimeout,
    clearTimeout: windowClearTimeout,
    console: {
      warn(message) { warnings.push(String(message)); }
    },
    localStorage: {
      getItem(key) { return local.has(key) ? local.get(key) : null; },
      setItem(key, value) {
        if (options.quotaFailure) throw new Error("QuotaExceededError");
        local.set(key, String(value));
      },
      removeItem(key) {
        if (options.quotaFailure) throw new Error("QuotaExceededError");
        local.delete(key);
      }
    }
  };
  if (options.shared !== false) {
    window.JSDataAccessV6 = {
      read(action, params, settings) {
        reads.push({action, params, settings});
        try {
          if (readHandler) return Promise.resolve(readHandler(action, params, settings));
          return readError ? Promise.reject(readError) : Promise.resolve(readResult);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      mutate(action, payload, settings) {
        mutations.push({action, payload, settings});
        try {
          if (mutationHandler) return Promise.resolve(mutationHandler(action, payload, settings));
          return mutationError ? Promise.reject(mutationError) : Promise.resolve(mutationResult);
        } catch (error) {
          return Promise.reject(error);
        }
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
    setTimeout: windowSetTimeout,
    clearTimeout: windowClearTimeout
  });

  return {
    window,
    storage: window.PermitDiagnosisStorageV1,
    local,
    reads,
    mutations,
    fetches,
    controllers,
    warnings,
    setReadResult(value) { readResult = value; },
    setMutationResult(value) { mutationResult = value; },
    setReadError(value) { readError = value; },
    setMutationError(value) { mutationError = value; },
    setReadHandler(value) { readHandler = value; },
    setMutationHandler(value) { mutationHandler = value; }
  };
}

function attachStep6(app) {
  const listeners = new Map();
  const status = {
    textContent: "",
    error: false,
    classList: {
      toggle(_name, enabled) { status.error = Boolean(enabled); }
    }
  };
  const report = {innerHTML: ""};
  const saveButtonAttributes = new Set();
  const saveButton = {
    disabled: false,
    setAttribute(name) { saveButtonAttributes.add(name); },
    removeAttribute(name) { saveButtonAttributes.delete(name); },
    hasAttribute(name) { return saveButtonAttributes.has(name); }
  };
  const elements = new Map([
    ["permitStep6StatusV1", status],
    ["permitStep6ReportV1", report]
  ]);
  const document = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((listener) => listener(event));
      return true;
    },
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) {
      return selector === "[data-permit-diagnosis-save]" ? saveButton : null;
    }
  };
  class CustomEventFake {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  app.window.PermitIndustryCandidateSelectorV1 = {
    escapeHtml(value) { return String(value == null ? "" : value); }
  };
  app.window.PermitDiagnosisReportV1 = {
    render(value) { return JSON.stringify(value); }
  };
  vm.runInNewContext(step6Source, {
    window: app.window,
    document,
    CustomEvent: CustomEventFake,
    Promise,
    Date,
    String,
    Boolean,
    Error
  });
  return {
    api: app.window.PermitDiagnosisStep6V1,
    status,
    report,
    saveButton,
    dispatch(type, detail) { document.dispatchEvent({type, detail}); }
  };
}

function configureStep6(ui, diagnosisStatus) {
  const input = {
    listingId: "LISTING-TWO-TABS",
    address: "대전 서구 테스트로 1",
    floor: "1",
    unit: "101"
  };
  const industry = {id: "restaurant", officialName: "일반음식점"};
  ui.dispatch("permit:industry-selected-v1", {industry});
  ui.dispatch("permit:public-data-v1", {
    diagnosis: {
      input,
      record: {use: "제2종 근린생활시설", level: "호실"},
      queriedAt: "2026-09-10T00:00:00.000Z"
    }
  });
  ui.dispatch("permit:procedure-diagnosed-v1", {
    result: {
      currentUse: "제2종 근린생활시설",
      targetType: {label: "제2종 근린생활시설"},
      procedure: {code: "NO_CHANGE", label: "변경 불필요"},
      ruleVersion: "test-rule"
    }
  });
  ui.dispatch("permit:facility-checks-updated-v1", {
    checks: {},
    summary: {status: diagnosisStatus}
  });
  return {input, industry};
}

function record(recordKey = "restaurant_abc") {
  return {recordKey, diagnosisStatus: "YELLOW", updatedAt: "2026-08-14T00:00:00.000Z"};
}

function cloudStore() {
  const state = {version: 0, data: null};
  return {
    state,
    read() {
      return {
        ok: true,
        found: state.data !== null,
        data: state.data === null ? null : JSON.parse(JSON.stringify(state.data)),
        version: state.version
      };
    },
    mutate(_action, payload) {
      if (Number(payload.expectedVersion) !== state.version) {
        const error = new Error("다른 창에서 변경됨");
        error.status = 409;
        throw error;
      }
      state.version += 1;
      state.data = JSON.parse(JSON.stringify(payload.data));
      return {ok: true, version: state.version};
    }
  };
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
  assert.equal(app.reads[0].params.expectedAccountEmail, "tester@example.test");
  assert.equal(app.reads[0].settings.cache, "no-store");
  assert.equal(app.reads[0].settings.signal, app.controllers[0].signal);
  assert.deepEqual(app.storage.loadLocal(cloudRecord.recordKey), cloudRecord);
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
  assert.equal(app.mutations[0].payload.expectedAccountEmail, "tester@example.test");
  assert.equal(app.mutations[0].payload.expectedVersion, 0);
  assert.equal(app.mutations[0].settings.signal, app.controllers[0].signal);
  assert.deepEqual(app.storage.loadLocal(savedRecord.recordKey), savedRecord);
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
  assert.deepEqual(app.storage.loadDirtyDraft(savedRecord.recordKey).record, savedRecord);
});

test("diagnosis treats a changed authenticated account as terminal and preserves its scoped draft", async () => {
  const app = harness({email: "original@example.test"});
  const savedRecord = record("restaurant_stale_account");
  const mismatch = new Error("account mismatch");
  mismatch.status = 409;
  mismatch.payload = {code: "account_changed"};
  app.setMutationError(mismatch);

  const result = await app.storage.save(savedRecord);

  assert.equal(result.cloudSaved, false);
  assert.equal(result.accountChanged, true);
  assert.equal(result.terminal, true);
  assert.equal(result.pendingDraft, true);
  assert.match(result.warning, /새로고침한 뒤 다시 로그인/);
  assert.equal(app.mutations.length, 1);
  assert.equal(app.reads.length, 0, "account mismatch must not enter conflict refresh/retry");
  assert.equal(app.mutations[0].payload.expectedAccountEmail, "original@example.test");
  assert.deepEqual(app.storage.loadDirtyDraft(savedRecord.recordKey).record, savedRecord);

  app.setReadError(mismatch);
  await assert.rejects(app.storage.load(savedRecord.recordKey), (error) => {
    assert.equal(error.code, "account_changed");
    assert.match(error.message, /새로고침한 뒤 다시 로그인/);
    return true;
  });
  assert.deepEqual(app.storage.loadDirtyDraft(savedRecord.recordKey).record, savedRecord);
});

test("diagnosis device records and dirty drafts are isolated by authenticated account", async () => {
  const sharedLocal = new Map();
  const recordKey = "restaurant_account_isolation";
  const accountARecord = {
    ...record(recordKey),
    diagnosisStatus: "RED",
    updatedAt: "2026-09-10T01:00:00.000Z"
  };
  const accountBRecord = {
    ...record(recordKey),
    diagnosisStatus: "GREEN",
    updatedAt: "2026-09-10T02:00:00.000Z"
  };
  const accountA = harness({local: sharedLocal, email: "agent-a@example.test"});
  const accountB = harness({local: sharedLocal, email: "agent-b@example.test"});
  accountA.setMutationError(new Error("account A offline"));

  assert.equal((await accountA.storage.save(accountARecord)).cloudSaved, false);
  assert.deepEqual(accountA.storage.loadDirtyDraft(recordKey).record, accountARecord);

  // An ownerless key from an older release is deliberately not attributed to
  // the next signed-in account.
  sharedLocal.set(`js_permit_diagnosis_v1_${recordKey}`, JSON.stringify(accountARecord));
  accountB.setReadResult({ok: true, found: false, version: 0});
  assert.equal(await accountB.storage.load(recordKey), null);
  assert.equal(accountB.storage.loadDirtyDraft(recordKey), null);

  const savedByB = await accountB.storage.save(accountBRecord);
  assert.equal(savedByB.cloudSaved, true);
  assert.deepEqual(accountB.storage.loadLocal(recordKey), accountBRecord);
  assert.deepEqual(accountA.storage.loadLocal(recordKey), accountARecord);
  assert.deepEqual(accountA.storage.loadDirtyDraft(recordKey).record, accountARecord);
  assert.equal(accountB.storage.loadDirtyDraft(recordKey), null);
  assert(sharedLocal.has(`js_permit_diagnosis_v1_agent-a%40example.test_${recordKey}`));
  assert(sharedLocal.has(`js_permit_diagnosis_v1_agent-b%40example.test_${recordKey}`));
  assert.deepEqual(JSON.parse(sharedLocal.get(`js_permit_diagnosis_v1_${recordKey}`)), accountARecord);
});

test("ownerless legacy diagnosis records migrate only with exact pre-asset account proof", () => {
  const owner = "legacy-owner@example.test";
  const recordKey = "restaurant_legacy_owner";
  const legacyRecord = {
    ...record(recordKey),
    diagnosisStatus: "RED",
    history: [{diagnosisStatus: "YELLOW"}]
  };
  const legacyDirty = {
    schemaVersion: "1.0.0",
    recordKey,
    record: legacyRecord,
    reason: "conflict",
    remoteVersion: 2,
    remoteRecord: {...legacyRecord, diagnosisStatus: "GREEN"}
  };
  const legacyConflict = {
    schemaVersion: "1.0.0",
    recordKey,
    entries: [{localRecord: legacyRecord, remoteRecord: legacyDirty.remoteRecord}]
  };
  const local = new Map([
    [`js_permit_diagnosis_v1_${recordKey}`, JSON.stringify(legacyRecord)],
    [`js_permit_diagnosis_dirty_v1_${recordKey}`, JSON.stringify(legacyDirty)],
    [`js_permit_diagnosis_conflict_v1_${recordKey}`, JSON.stringify(legacyConflict)]
  ]);
  const app = harness({local, email: owner, legacyOwnerEmail: owner.toUpperCase()});

  assert.deepEqual(app.storage.loadLocal(recordKey), legacyRecord);
  assert.deepEqual(app.storage.loadDirtyDraft(recordKey), legacyDirty);
  assert.deepEqual(app.storage.loadConflict(recordKey), legacyConflict);
  for (const prefix of [
    "js_permit_diagnosis_v1_",
    "js_permit_diagnosis_dirty_v1_",
    "js_permit_diagnosis_conflict_v1_"
  ]) {
    assert(local.has(`${prefix}${encodeURIComponent(owner)}_${recordKey}`));
    assert.equal(local.has(`${prefix}${recordKey}`), false);
  }

  const protectedKey = "restaurant_existing_scoped";
  const scopedRecord = {...record(protectedKey), diagnosisStatus: "GREEN"};
  const olderLegacyRecord = {...record(protectedKey), diagnosisStatus: "RED"};
  local.set(`js_permit_diagnosis_v1_${encodeURIComponent(owner)}_${protectedKey}`, JSON.stringify(scopedRecord));
  local.set(`js_permit_diagnosis_v1_${protectedKey}`, JSON.stringify(olderLegacyRecord));
  assert.deepEqual(app.storage.loadLocal(protectedKey), scopedRecord);
  assert.deepEqual(JSON.parse(local.get(`js_permit_diagnosis_v1_${protectedKey}`)), olderLegacyRecord);

  const quarantined = harness({
    local: new Map([[`js_permit_diagnosis_v1_${recordKey}`, JSON.stringify(legacyRecord)]]),
    email: "different@example.test",
    legacyOwnerEmail: owner
  });
  assert.equal(quarantined.storage.loadLocal(recordKey), null);
});

test("an older save success cannot clear a newer failed diagnosis draft", async () => {
  const pending = [];
  const app = harness({
    mutationHandler() {
      return new Promise((resolve, reject) => pending.push({resolve, reject}));
    }
  });
  const recordKey = "restaurant_overlapping_save";
  const olderRecord = {
    ...record(recordKey),
    diagnosisStatus: "YELLOW",
    updatedAt: "2026-09-10T03:00:00.000Z"
  };
  const newerRecord = {
    ...record(recordKey),
    diagnosisStatus: "RED",
    updatedAt: "2026-09-10T03:01:00.000Z"
  };

  const olderSave = app.storage.save(olderRecord);
  const newerSave = app.storage.save(newerRecord);
  await Promise.resolve();
  assert.equal(pending.length, 2);
  assert.deepEqual(app.storage.loadLocal(recordKey), newerRecord);
  assert.deepEqual(app.storage.loadDirtyDraft(recordKey).record, newerRecord);

  pending[0].resolve({ok: true, version: 1});
  const olderResult = await olderSave;
  assert.equal(olderResult.cloudSaved, true);
  assert.equal(olderResult.pendingDraft, true);
  assert.deepEqual(app.storage.loadDirtyDraft(recordKey).record, newerRecord);

  const newerError = new Error("newer request lost connection");
  newerError.status = 503;
  pending[1].reject(newerError);
  const newerResult = await newerSave;
  assert.equal(newerResult.cloudSaved, false);
  assert.equal(newerResult.pendingDraft, true);
  assert.match(newerResult.warning, /newer request lost connection/);
  const retained = app.storage.loadDirtyDraft(recordKey);
  assert.deepEqual(retained.record, newerRecord);
  assert.equal(retained.operationId, newerResult.operationId);
  assert.notEqual(retained.operationId, olderResult.operationId);
});

test("an older failed response cannot recreate a draft after the newer save succeeds", async () => {
  const pending = [];
  const app = harness({
    mutationHandler() {
      return new Promise((resolve, reject) => pending.push({resolve, reject}));
    }
  });
  const recordKey = "restaurant_reverse_response_order";
  const olderRecord = {
    ...record(recordKey),
    diagnosisStatus: "YELLOW",
    updatedAt: "2026-09-10T04:00:00.000Z"
  };
  const newerRecord = {
    ...record(recordKey),
    diagnosisStatus: "GREEN",
    updatedAt: "2026-09-10T04:01:00.000Z"
  };

  const olderSave = app.storage.save(olderRecord);
  const newerSave = app.storage.save(newerRecord);
  await Promise.resolve();
  pending[1].resolve({ok: true, version: 1});
  const newerResult = await newerSave;
  assert.equal(newerResult.cloudSaved, true);
  assert.equal(newerResult.pendingDraft, false);
  assert.equal(app.storage.loadDirtyDraft(recordKey), null);

  pending[0].reject(new Error("late older failure"));
  const olderResult = await olderSave;
  assert.equal(olderResult.cloudSaved, false);
  assert.equal(olderResult.pendingDraft, false);
  assert.equal(app.storage.loadDirtyDraft(recordKey), null);
  assert.deepEqual(app.storage.loadLocal(recordKey), newerRecord);
});

test("same-version diagnosis conflict keeps local and remote records without merging legal fields", async () => {
  const cloud = cloudStore();
  const sharedLocal = new Map();
  const firstTab = harness({
    local: sharedLocal,
    readHandler: () => cloud.read(),
    mutationHandler: (action, payload) => cloud.mutate(action, payload)
  });
  const secondTab = harness({
    local: sharedLocal,
    readHandler: () => cloud.read(),
    mutationHandler: (action, payload) => cloud.mutate(action, payload)
  });
  const recordKey = "restaurant_two_tabs";
  const remoteRecord = {
    ...record(recordKey),
    diagnosisStatus: "GREEN",
    legalRuleVersion: "remote-rule",
    history: [{diagnosisStatus: "REMOTE_HISTORY"}]
  };
  const localRecord = {
    ...record(recordKey),
    diagnosisStatus: "RED",
    legalRuleVersion: "local-rule",
    updatedAt: "2026-08-14T00:01:00.000Z",
    history: [{diagnosisStatus: "LOCAL_HISTORY"}]
  };

  await Promise.all([firstTab.storage.load(recordKey), secondTab.storage.load(recordKey)]);
  assert.equal((await firstTab.storage.save(remoteRecord)).cloudSaved, true);

  const conflict = await secondTab.storage.save(localRecord);

  assert.equal(conflict.cloudSaved, false);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.pendingDraft, true);
  assert.equal(conflict.cloudVersion, 1);
  assert.match(conflict.warning, /초안과 클라우드 변경본을 각각 보존/);
  assert.deepEqual(conflict.latestRecord, remoteRecord);
  assert.deepEqual(secondTab.storage.loadLocal(recordKey), localRecord);
  assert.deepEqual(secondTab.storage.loadDirtyDraft(recordKey).record, localRecord);
  const archive = secondTab.storage.loadConflict(recordKey);
  assert.deepEqual(archive.entries[0].localRecord, localRecord);
  assert.deepEqual(archive.entries[0].remoteRecord, remoteRecord);
  assert.deepEqual(archive.entries[0].localRecord.history, [{diagnosisStatus: "LOCAL_HISTORY"}]);
  assert.deepEqual(archive.entries[0].remoteRecord.history, [{diagnosisStatus: "REMOTE_HISTORY"}]);
  assert.equal(archive.entries[0].localRecord.legalRuleVersion, "local-rule");
  assert.equal(archive.entries[0].remoteRecord.legalRuleVersion, "remote-rule");
  assert.equal(secondTab.warnings.length, 1);
});

test("diagnosis reload retains a conflict draft and a later explicit save retries the latest version", async () => {
  const cloud = cloudStore();
  const sharedLocal = new Map();
  const firstTab = harness({
    local: sharedLocal,
    readHandler: () => cloud.read(),
    mutationHandler: (action, payload) => cloud.mutate(action, payload)
  });
  const secondTab = harness({
    local: sharedLocal,
    readHandler: () => cloud.read(),
    mutationHandler: (action, payload) => cloud.mutate(action, payload)
  });
  const recordKey = "restaurant_retry_after_reload";
  const remoteRecord = {...record(recordKey), diagnosisStatus: "GREEN"};
  const localRecord = {
    ...record(recordKey),
    diagnosisStatus: "RED",
    updatedAt: "2026-08-14T00:02:00.000Z"
  };

  await Promise.all([firstTab.storage.load(recordKey), secondTab.storage.load(recordKey)]);
  await firstTab.storage.save(remoteRecord);
  assert.equal((await secondTab.storage.save(localRecord)).conflict, true);

  assert.deepEqual(await secondTab.storage.load(recordKey), localRecord);
  assert.deepEqual(secondTab.storage.loadLocal(recordKey), localRecord);
  assert.deepEqual(secondTab.storage.loadDirtyDraft(recordKey).remoteRecord, remoteRecord);

  const retried = await secondTab.storage.save(localRecord);
  assert.equal(retried.cloudSaved, true);
  assert.equal(retried.pendingDraft, false);
  assert.deepEqual(secondTab.mutations.map(({payload}) => payload.expectedVersion), [0, 1]);
  assert.equal(cloud.state.version, 2);
  assert.deepEqual(cloud.state.data, localRecord);
  assert.equal(secondTab.storage.loadDirtyDraft(recordKey), null);
  const archive = secondTab.storage.loadConflict(recordKey);
  assert.match(archive.entries[0].resolvedAt, /^2026-|^20/);
  assert.equal(archive.entries[0].resolvedVersion, 2);
  assert.deepEqual(await secondTab.storage.load(recordKey), localRecord);
});

test("STEP 6 stale tab save warns before overwrite and only a second explicit save succeeds", async () => {
  const cloud = cloudStore();
  const sharedLocal = new Map();
  const suppressLongTimeout = (callback, delay) => {
    if (Number(delay) >= 5000) return 0;
    return setTimeout(callback, delay);
  };
  const common = {
    local: sharedLocal,
    windowSetTimeout: suppressLongTimeout,
    readHandler: () => cloud.read(),
    mutationHandler: (action, payload) => cloud.mutate(action, payload)
  };
  const firstTab = harness(common);
  const secondTab = harness(common);
  const firstUi = attachStep6(firstTab);
  const secondUi = attachStep6(secondTab);
  const identity = configureStep6(firstUi, "GREEN");
  configureStep6(secondUi, "RED");
  const recordKey = firstTab.storage.makeRecordKey(identity.input, identity.industry.id);
  const baseRecord = {
    schemaVersion: "1.0.0",
    recordKey,
    listingId: identity.input.listingId,
    diagnosisStatus: "YELLOW",
    legalRuleVersion: "base-rule",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    history: []
  };
  cloud.state.version = 1;
  cloud.state.data = JSON.parse(JSON.stringify(baseRecord));

  assert.deepEqual(await firstUi.api.loadCurrent(), baseRecord);
  assert.deepEqual(await secondUi.api.loadCurrent(), baseRecord);

  const firstSave = firstUi.api.saveCurrent();
  const coalescedDoubleClick = firstUi.api.saveCurrent();
  assert.equal(coalescedDoubleClick, firstSave);
  assert.equal(firstUi.saveButton.disabled, true);
  assert.equal(firstUi.saveButton.hasAttribute("aria-busy"), true);
  const firstResult = await firstSave;
  assert.equal(firstResult.cloudSaved, true);
  assert.equal(firstResult.record.diagnosisStatus, "GREEN");
  assert.equal(firstTab.mutations.length, 1);
  assert.equal(firstUi.saveButton.disabled, false);
  assert.equal(firstUi.saveButton.hasAttribute("aria-busy"), false);
  assert.equal(cloud.state.version, 2);
  const firstCloudRecord = JSON.parse(JSON.stringify(cloud.state.data));

  const staleResult = await secondUi.api.saveCurrent();
  assert.equal(staleResult.cloudSaved, false);
  assert.equal(staleResult.conflict, true);
  assert.equal(secondTab.mutations[0].payload.expectedVersion, 1);
  assert.equal(cloud.state.version, 2, "the stale STEP 6 save must not overwrite the first tab");
  assert.deepEqual(cloud.state.data, firstCloudRecord);
  assert.match(secondUi.status.textContent, /초안과 클라우드 변경본을 각각 보존/);
  assert.equal(secondUi.status.error, true);
  assert.equal(secondTab.reads.length, 2, "saveCurrent must not preflight-load before its CAS write");

  const retryResult = await secondUi.api.saveCurrent();
  assert.equal(retryResult.cloudSaved, true);
  assert.equal(retryResult.record.diagnosisStatus, "RED");
  assert.deepEqual(secondTab.mutations.map(({payload}) => payload.expectedVersion), [1, 2]);
  assert.equal(cloud.state.version, 3);
  assert.equal(cloud.state.data.diagnosisStatus, "RED");
  assert.match(secondUi.status.textContent, /계정 클라우드와 이 기기에 진단을 저장/);
  assert.equal(secondUi.status.error, false);
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
  assert.match(app.fetches[0].url, /^\/legacy-data\?action=loadCloudState&scope=permitDiagnosis&recordKey=restaurant_legacy&expectedAccountEmail=tester%40example\.test&_=/);
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
    expectedAccountEmail: "tester@example.test",
    expectedVersion: 0
  });
});
