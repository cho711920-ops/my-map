const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync("js/list-manager-v6.js", "utf8");
const authSource = fs.readFileSync("js/auth-gate-v1.js", "utf8");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function extractFunction(name, from = source) {
  const start = from.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const parameterEnd = from.indexOf(") {", start);
  assert.notEqual(parameterEnd, -1, `${name} parameters must end before its body`);
  const brace = from.indexOf("{", parameterEnd);
  let depth = 0;
  for (let index = brace; index < from.length; index += 1) {
    if (from[index] === "{") depth += 1;
    if (from[index] === "}") depth -= 1;
    if (depth === 0) return from.slice(start, index + 1);
  }
  throw new Error(`could not extract ${name}`);
}

function runAuthAccountFlow(localValues, emails) {
  const localStorage = storage(localValues);
  const sessionStorage = storage(new Map());
  const context = { window: { localStorage, sessionStorage }, Object };
  vm.createContext(context);
  vm.runInContext([
    'const AUTH_ACCOUNT_SESSION_KEY = "js_authenticated_account_v1";',
    'const PRECISE_LOCATION_KEYS = ["js_kakao_navigation_location_v1", "js_ai_visit_location_v6"];',
    'const AI_VISIT_DEVICE_CACHE_KEYS = ["js_ai_visit_sessions_v6", "js_ai_visit_session_v6"];',
    extractFunction("removeStorageKeys", authSource),
    extractFunction("clearPreciseLocationCaches", authSource),
    extractFunction("syncLocationPrivacyForAccount", authSource)
  ].join("\n"), context);
  emails.forEach((email) => context.syncLocationPrivacyForAccount(email));
}

function storage(values) {
  return {
    get length() { return values.size; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    has(key) { return values.has(key); },
    key(index) { return Array.from(values.keys())[index] || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function createApp(cloud, options = {}) {
  const email = options.email || "merge@example.test";
  const encodedEmail = encodeURIComponent(email);
  const localValues = options.localValues || new Map();
  if (!localValues.has("js_list_account_email_v6")) localValues.set("js_list_account_email_v6", email);
  if (!localValues.has(`js_favorite_lists_v6::${encodedEmail}`)) {
    localValues.set(`js_favorite_lists_v6::${encodedEmail}`, JSON.stringify(cloud.favorite.data));
  }
  localValues.set(`js_favorite_lists_v6_migrated::${encodedEmail}`, "1");
  const localStorage = storage(localValues);
  const sessionStorage = storage(new Map());
  const requests = [];
  const activeTimers = new Set();
  function appSetTimeout(callback, delay) {
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      callback();
    }, delay);
    activeTimers.add(timer);
    return timer;
  }
  function appClearTimeout(timer) {
    activeTimers.delete(timer);
    clearTimeout(timer);
  }
  const document = {
    title: "JS부동산",
    visibilityState: "visible",
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
    addEventListener() {},
    createElement() { return { firstChild: null, innerHTML: "", classList: { add() {}, remove() {} }, setAttribute() {} }; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const window = {
    addEventListener() {}, clearTimeout: appClearTimeout, document, innerWidth: 1280, localStorage, sessionStorage,
    setTimeout: appSetTimeout, JSAuthenticatedAccountEmail: email,
    fetch: async (url) => {
      if (String(url) === "/api/session") return { ok: true, async json() { return { email }; } };
      throw new Error(`unexpected fetch ${url}`);
    },
    history: { state: {}, replaceState(state) { this.state = state; } },
    matchMedia() { return { matches: false }; },
    requestAnimationFrame(callback) { callback(); },
    JSDataAccessV6: {
      async read(action, params) {
        assert.equal(action, "loadCloudState");
        assert.equal(params.expectedAccountEmail, email);
        const target = params.scope === "favorites" ? cloud.favorite : cloud.visit;
        if (cloud.accountChangedReads) {
          throw Object.assign(new Error("account changed"), {
            status: 409,
            payload: { code: "account_changed", message: "reload required" }
          });
        }
        return { ok: true, found: target.data.length > 0, data: clone(target.data), version: target.version, deletedIds: clone(target.deletedIds || {}) };
      },
      async mutate(action, payload) {
        assert.equal(action, "saveCloudState");
        assert.equal(payload.expectedAccountEmail, email);
        const target = payload.scope === "favorites" ? cloud.favorite : cloud.visit;
        requests.push(clone(payload));
        if (cloud.accountChangedSaves) {
          throw Object.assign(new Error("account changed"), {
            status: 409,
            payload: { code: "account_changed", message: "reload required" }
          });
        }
        if (cloud.failSaves) throw Object.assign(new Error("offline"), { status: 503 });
        if (payload.expectedVersion !== target.version) {
          const error = new Error("conflict");
          error.status = 409;
          throw error;
        }
        target.version += 1;
        target.deletedIds = Object.assign({}, target.deletedIds || {}, payload.deletedIds || {});
        target.data = clone(payload.data).filter((list) => !target.deletedIds[list.id]);
        return { ok: true, data: clone(target.data), deletedIds: clone(target.deletedIds), version: target.version };
      }
    }
  };
  window.window = window;
  vm.runInNewContext(source, {
    alert() {}, clearTimeout: appClearTimeout, console: { error() {}, log() {}, warn() {} },
    CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options && options.detail; },
    Date, document, fetch: window.fetch, localStorage, requestAnimationFrame: window.requestAnimationFrame,
    sessionStorage, setTimeout: appSetTimeout, URLSearchParams, window
  }, { filename: "list-manager-v6.js" });
  return {
    localValues,
    requests,
    window,
    destroy() {
      Array.from(activeTimers).forEach(appClearTimeout);
    }
  };
}

test("favorite conflict reloads, three-way merges both devices, and retries with the new version", async () => {
  const baseFolder = {
    id: "folder-1", name: "관심", itemKeys: ["property:A"],
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z"
  };
  const cloud = {
    favorite: { version: 1, data: [clone(baseFolder)] },
    visit: { version: 0, data: [] }
  };
  const app = createApp(cloud);
  await new Promise((resolve) => setTimeout(resolve, 40));

  cloud.favorite.version = 2;
  cloud.favorite.data = [{
    ...clone(baseFolder), itemKeys: ["property:A", "property:REMOTE"], updatedAt: "2026-09-10T00:01:00Z"
  }];
  app.window.JSV6ListStore.save("favorite", [{
    ...clone(baseFolder), itemKeys: ["property:A", "property:LOCAL"], updatedAt: "2026-09-10T00:02:00Z"
  }]);

  await new Promise((resolve) => setTimeout(resolve, 420));
  assert.deepEqual(app.requests.map((payload) => payload.expectedVersion), [1, 2]);
  assert.equal(cloud.favorite.version, 3);
  assert.deepEqual(new Set(cloud.favorite.data[0].itemKeys), new Set([
    "property:A", "property:REMOTE", "property:LOCAL"
  ]));
  assert.deepEqual(new Set(app.window.JSV6ListStore.load("favorite")[0].itemKeys), new Set([
    "property:A", "property:REMOTE", "property:LOCAL"
  ]));
});

test("a remote folder rename survives a newer local item-only change", async () => {
  const baseFolder = {
    id: "folder-rename", name: "Old", itemKeys: ["property:A"],
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z"
  };
  const cloud = {
    favorite: { version: 1, data: [clone(baseFolder)] },
    visit: { version: 0, data: [] }
  };
  const app = createApp(cloud);
  await new Promise((resolve) => setTimeout(resolve, 40));

  // Another device changes only the name. This device then changes only the
  // membership, with a later timestamp that must not erase the remote rename.
  cloud.favorite.version = 2;
  cloud.favorite.data = [{
    ...clone(baseFolder), name: "Renamed", updatedAt: "2026-09-10T00:01:00Z"
  }];
  app.window.JSV6ListStore.save("favorite", [{
    ...clone(baseFolder), itemKeys: ["property:A", "property:B"], updatedAt: "2026-09-10T00:02:00Z"
  }]);

  await new Promise((resolve) => setTimeout(resolve, 420));
  assert.deepEqual(app.requests.map((payload) => payload.expectedVersion), [1, 2]);
  assert.equal(cloud.favorite.data[0].name, "Renamed");
  assert.deepEqual(cloud.favorite.data[0].itemKeys, ["property:A", "property:B"]);
  assert.equal(app.window.JSV6ListStore.load("favorite")[0].name, "Renamed");
});

test("offline folder edit survives a new page and merges with an independent remote membership change", async () => {
  const email = "reload@example.test";
  const encodedEmail = encodeURIComponent(email);
  const envelopeKey = `js_list_sync_dirty_envelope_v1_favorite::${encodedEmail}`;
  const dirtyKey = `js_list_sync_dirty_v6_favorite::${encodedEmail}`;
  const baseFolder = {
    id: "folder-reload", name: "Old", itemKeys: ["property:A"],
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z"
  };
  const cloud = {
    favorite: { version: 1, data: [clone(baseFolder)] },
    visit: { version: 0, data: [] }
  };
  const firstPage = createApp(cloud, { email });
  await new Promise((resolve) => setTimeout(resolve, 40));

  cloud.failSaves = true;
  firstPage.window.JSV6ListStore.save("favorite", [{
    ...clone(baseFolder), name: "Renamed", updatedAt: "2026-09-10T00:02:00Z"
  }]);
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(firstPage.localValues.has(envelopeKey), true);
  const pending = JSON.parse(firstPage.localValues.get(envelopeKey));
  assert.equal(pending.version, 1);
  assert.equal(pending.baseKnown, true);
  assert.equal(pending.base[0].name, "Old");
  assert.equal(pending.snapshot[0].name, "Renamed");
  firstPage.destroy();

  // Exercise the real auth-gate account-switch path before A signs in again.
  runAuthAccountFlow(firstPage.localValues, [email, "other@example.test", email]);
  assert.equal(firstPage.localValues.has(envelopeKey), true);

  cloud.failSaves = false;
  cloud.favorite.version = 2;
  cloud.favorite.data = [{
    ...clone(baseFolder), itemKeys: ["property:A", "property:B"], updatedAt: "2026-09-10T00:01:00Z"
  }];
  const reloadedPage = createApp(cloud, { email, localValues: firstPage.localValues });
  await new Promise((resolve) => setTimeout(resolve, 360));

  assert.deepEqual(reloadedPage.requests.map((payload) => payload.expectedVersion), [2]);
  assert.equal(cloud.favorite.data[0].name, "Renamed");
  assert.deepEqual(cloud.favorite.data[0].itemKeys, ["property:A", "property:B"]);
  assert.equal(reloadedPage.window.JSV6ListStore.load("favorite")[0].name, "Renamed");
  assert.equal(reloadedPage.localValues.has(envelopeKey), false, "cloud acknowledgement clears the envelope");
  assert.equal(reloadedPage.localValues.has(dirtyKey), false);
  reloadedPage.destroy();
});

test("a dirty list envelope is never restored into another authenticated account", async () => {
  const accountA = "a@example.test";
  const accountB = "b@example.test";
  const encodedA = encodeURIComponent(accountA);
  const privateA = {
    id: "private-a", name: "A private", itemKeys: ["property:PRIVATE-A"],
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:01:00Z"
  };
  const publicB = {
    id: "folder-b", name: "B folder", itemKeys: ["property:B"],
    createdAt: "2026-09-10T01:00:00Z", updatedAt: "2026-09-10T01:00:00Z"
  };
  const localValues = new Map([
    ["js_list_account_email_v6", accountA],
    [`js_favorite_lists_v6::${encodedA}`, JSON.stringify([privateA])],
    [`js_list_sync_dirty_v6_favorite::${encodedA}`, "1"],
    [`js_list_sync_dirty_envelope_v1_favorite::${encodedA}`, JSON.stringify({
      accountEmail: accountA,
      type: "favorite",
      snapshot: [privateA],
      base: [],
      baseKnown: true,
      version: 1
    })]
  ]);
  const cloud = {
    favorite: { version: 4, data: [publicB] },
    visit: { version: 0, data: [] }
  };

  const pageB = createApp(cloud, { email: accountB, localValues });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const restoredIds = pageB.window.JSV6ListStore.load("favorite").map((list) => list.id);
  assert.deepEqual(restoredIds, ["folder-b"]);
  assert.equal(restoredIds.includes("private-a"), false);
  assert.deepEqual(pageB.requests, []);
  pageB.destroy();
});

test("legacy dirty state without a merge ancestor conservatively preserves both memberships", async () => {
  const email = "legacy-dirty@example.test";
  const encodedEmail = encodeURIComponent(email);
  const localValues = new Map([
    ["js_list_account_email_v6", email],
    [`js_favorite_lists_v6::${encodedEmail}`, JSON.stringify([{
      id: "folder-legacy", name: "Locally renamed", itemKeys: ["property:A", "property:LOCAL"],
      createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:02:00Z"
    }])],
    [`js_list_sync_dirty_v6_favorite::${encodedEmail}`, "1"]
  ]);
  const cloud = {
    favorite: { version: 5, data: [{
      id: "folder-legacy", name: "Old", itemKeys: ["property:A", "property:REMOTE"],
      createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:01:00Z"
    }] },
    visit: { version: 0, data: [] }
  };

  const app = createApp(cloud, { email, localValues });
  await new Promise((resolve) => setTimeout(resolve, 360));

  assert.deepEqual(app.requests.map((payload) => payload.expectedVersion), [5]);
  assert.equal(cloud.favorite.data[0].name, "Locally renamed");
  assert.deepEqual(new Set(cloud.favorite.data[0].itemKeys), new Set(["property:A", "property:LOCAL", "property:REMOTE"]));
  app.destroy();
});

test("acknowledged list tombstones are cleared and do not cause a save on reload", async () => {
  const email = "delete-ack@example.test";
  const encodedEmail = encodeURIComponent(email);
  const deletedKey = `js_list_deleted_ids_v6_favorite::${encodedEmail}`;
  const folderA = {
    id: "folder-a", name: "A", itemKeys: ["property:A"],
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z"
  };
  const folderB = {
    id: "folder-b", name: "B", itemKeys: ["property:B"],
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z"
  };
  const cloud = {
    favorite: { version: 1, data: [clone(folderA), clone(folderB)], deletedIds: {} },
    visit: { version: 0, data: [], deletedIds: {} }
  };
  const firstPage = createApp(cloud, { email });
  await new Promise((resolve) => setTimeout(resolve, 40));
  firstPage.window.JSV6ListStore.remove("favorite", folderA.id, [clone(folderB)]);
  await new Promise((resolve) => setTimeout(resolve, 360));

  assert.equal(firstPage.requests.length, 1);
  assert.ok(firstPage.requests[0].deletedIds[folderA.id] > 0);
  assert.deepEqual(JSON.parse(firstPage.localValues.get(deletedKey) || "{}"), {});
  firstPage.destroy();

  const reloadedPage = createApp(cloud, { email, localValues: firstPage.localValues });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(reloadedPage.requests, [], "remote tombstones must not become local dirty state");
  assert.deepEqual(reloadedPage.window.JSV6ListStore.load("favorite").map((list) => list.id), [folderB.id]);
  reloadedPage.destroy();
});

test("a newer deletion created during an in-flight acknowledgement stays dirty", () => {
  const current = { "folder-a": 200, "folder-b": 300 };
  const persisted = [];
  const context = {
    Number,
    Object,
    loadDeletedIds() { return current; },
    persistDeletedIds() { persisted.push({ ...current }); }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction("clearAcknowledgedDeletedIds"), context);
  context.clearAcknowledgedDeletedIds("favorite", { "folder-a": 100 }, { "folder-a": 100 });

  assert.deepEqual(current, { "folder-a": 200, "folder-b": 300 });
  assert.equal(persisted.length, 1);
});

test("a stale list tab sends its captured account and stops retrying on account_changed", async () => {
  const email = "captured@example.test";
  const encodedEmail = encodeURIComponent(email);
  const envelopeKey = `js_list_sync_dirty_envelope_v1_favorite::${encodedEmail}`;
  const folder = {
    id: "folder-stale", name: "Before", itemKeys: ["property:A"],
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z"
  };
  const cloud = {
    favorite: { version: 1, data: [clone(folder)] },
    visit: { version: 0, data: [] }
  };
  const app = createApp(cloud, { email });
  await new Promise((resolve) => setTimeout(resolve, 40));
  cloud.accountChangedSaves = true;
  app.window.JSAuthenticatedAccountEmail = "different@example.test";
  app.window.JSV6ListStore.save("favorite", [{ ...folder, name: "Unsynced", updatedAt: "2026-09-10T00:01:00Z" }]);
  await new Promise((resolve) => setTimeout(resolve, 1300));

  assert.equal(app.requests.length, 1, "account_changed is terminal, not a CAS conflict or transient retry");
  assert.equal(app.requests[0].expectedAccountEmail, email);
  assert.equal(app.localValues.has(envelopeKey), true, "the captured account's recovery envelope is retained");
  app.window.JSV6ListStore.save("favorite", [{ ...folder, name: "Latest local", updatedAt: "2026-09-10T00:02:00Z" }]);
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(app.requests.length, 1);
  app.destroy();
});

test("a 409 whose latest-state read also fails uses bounded retry backoff", async () => {
  const scheduled = [];
  const conflict = Object.assign(new Error("conflict"), { status: 409 });
  const context = {
    JSON,
    Math,
    Number,
    Promise,
    console: { warn() {} },
    cloudBaseKnown: { favorite: true },
    cloudBaseLists: { favorite: [] },
    cloudRevisions: { favorite: 1 },
    cloudSaveRetries: { favorite: 0 },
    cloudSaveTimers: { favorite: 0 },
    cloudVersions: { favorite: 1 },
    pendingCloudSave: { favorite: true },
    cloudSyncAccountChanged: false,
    window: {
      clearTimeout() {},
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      }
    },
    cloudScope(type) { return type; },
    loadDeletedIds() { return {}; },
    loadLists() { return [{ id: "folder", itemKeys: ["property:A"] }]; },
    mutateCloudData() { return Promise.reject(conflict); },
    readCloudData() { return Promise.reject(new Error("latest state unavailable")); },
    showListToast() {},
    typeLabel() { return "찜"; },
    stopCloudSyncForAccountChange() { return false; },
    writeListDirtyEnvelope() {}
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction("scheduleCloudSaveRetry"),
    extractFunction("flushCloudSave")
  ].join("\n"), context);

  context.flushCloudSave("favorite", context.loadLists(), 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scheduled.map((entry) => entry.delay), [900]);

  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scheduled.map((entry) => entry.delay), [900, 2500]);
  assert.equal(context.pendingCloudSave.favorite, true);
});
