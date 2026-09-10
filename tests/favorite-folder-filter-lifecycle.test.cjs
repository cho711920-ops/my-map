const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/list-manager-v6.js", "utf8");
const mainSource = fs.readFileSync("js/script.js", "utf8");

function storageApi(values) {
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function waitForAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function createApp(options) {
  const listeners = {};
  const documentListeners = {};
  const buttonClasses = new Set();
  const favoriteButton = {
    classList: {
      add(name) { buttonClasses.add(name); },
      remove(name) { buttonClasses.delete(name); }
    }
  };
  const document = {
    title: "JS부동산",
    visibilityState: "visible",
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
    addEventListener(type, handler) { documentListeners[type] = handler; },
    createElement() { return { firstChild: null, innerHTML: "" }; },
    getElementById(id) { return id === "favoriteBtn" ? favoriteButton : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [options.clock.now])); }
    static now() { return options.clock.now; }
  }
  const localStorage = storageApi(options.localValues);
  const sessionStorage = storageApi(options.sessionValues);
  let applyCount = 0;
  const window = {
    addEventListener(type, handler) { listeners[type] = handler; },
    clearTimeout,
    document,
    fetch: async (url) => {
      if (String(url) === "/api/session") {
        return { ok: true, async json() { return { ok: true, email: options.email }; } };
      }
      throw new Error("unexpected fetch: " + url);
    },
    history: options.history,
    innerWidth: 1280,
    localStorage,
    matchMedia() { return { matches: false }; },
    requestAnimationFrame(callback) { callback(); },
    saveApiURL: "/api/data",
    sessionStorage,
    setTimeout,
    applyFilter() { applyCount += 1; },
    JSDataAccessV6: {
      async read(action, params) {
        assert.equal(action, "loadCloudState");
        const type = params.scope === "favorites" ? "favorite" : "visit";
        const data = clone(options.cloud[type] || []);
        return { ok: true, found: data.length > 0, data };
      },
      async mutate(action, payload) {
        assert.equal(action, "saveCloudState");
        const type = payload.scope === "favorites" ? "favorite" : "visit";
        options.cloud[type] = clone(payload.data || []);
        return { ok: true, data: clone(payload.data || []), deletedIds: payload.deletedIds || {} };
      }
    }
  };
  window.window = window;
  vm.runInNewContext(source, {
    alert() {},
    console: { error() {}, warn() {}, log() {} },
    CustomEvent: function CustomEvent(type, eventOptions) {
      this.type = type;
      this.detail = eventOptions && eventOptions.detail;
    },
    Date: FakeDate,
    document,
    fetch: window.fetch,
    localStorage,
    requestAnimationFrame: window.requestAnimationFrame,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    window
  }, { filename: "list-manager-v6.js" });
  return {
    window,
    listeners,
    documentListeners,
    buttonClasses,
    get applyCount() { return applyCount; }
  };
}

test("selected folder keys filter independently from the all-favorites membership union", () => {
  assert.match(
    mainSource,
    /function resetFilter\(\)[\s\S]*?clearActiveFavoriteFolderFilterV1\(\{ disableFilter: true, silent: true \}\)/
  );
  const start = mainSource.indexOf("function isFavorite(item)");
  const end = mainSource.indexOf("function toggleFavorite(key)", start);
  const context = {
    favoriteOnly: true,
    activeFavoriteFolderId: "folder-a",
    favoriteFilterKeys: ["property:A1"],
    favoriteKeys: ["property:A1", "property:B1"]
  };
  vm.runInNewContext(mainSource.slice(start, end), context);
  assert.equal(context.isFavorite({ propertyId: "A1", key: "legacy-a" }), true);
  assert.equal(context.isFavorite({ propertyId: "B1", key: "legacy-b" }), false);
  context.activeFavoriteFolderId = "";
  assert.equal(context.isFavorite({ propertyId: "B1", key: "legacy-b" }), true);
});

test("selected favorite folder survives 16-second cloud lifecycle sync and hard reload", async () => {
  const alpha = "alpha@example.com";
  const beta = "beta@example.com";
  const alphaKey = encodeURIComponent(alpha);
  const betaKey = encodeURIComponent(beta);
  const folders = [
    { id: "folder-a", name: "A 폴더", itemKeys: ["property:A1"], updatedAt: "2026-09-10T00:00:00Z" },
    { id: "folder-b", name: "B 폴더", itemKeys: ["property:B1"], updatedAt: "2026-09-10T00:00:00Z" }
  ];
  const localValues = new Map([
    ["js_list_account_email_v6", alpha],
    [`js_favorite_lists_v6::${alphaKey}`, JSON.stringify(folders)],
    [`js_favorite_lists_v6_migrated::${alphaKey}`, "1"],
    [`js_favorite_lists_v6::${betaKey}`, JSON.stringify([{ id: "folder-beta", name: "Beta", itemKeys: ["property:X1"] }])],
    [`js_favorite_lists_v6_migrated::${betaKey}`, "1"]
  ]);
  const sessionValues = new Map();
  const history = {
    state: {},
    replaceState(nextState) { this.state = nextState; }
  };
  const clock = { now: Date.parse("2026-09-10T09:00:00Z") };
  const cloud = { favorite: clone(folders), visit: [] };

  const first = createApp({ email: alpha, localValues, sessionValues, history, clock, cloud });
  await waitForAsyncWork();
  assert.equal(first.window.JSV6ListStore.activateFavoriteFilter("folder-a"), true);
  assert.deepEqual(Array.from(first.window.favoriteKeys), ["property:A1", "property:B1"]);
  assert.deepEqual(Array.from(first.window.favoriteFilterKeys), ["property:A1"]);
  assert.equal(first.window.activeFavoriteFolderId, "folder-a");
  assert.equal(first.window.favoriteOnly, true);
  assert.equal(first.buttonClasses.has("on"), true);

  cloud.favorite[0].itemKeys = ["property:A2"];
  cloud.favorite[0].updatedAt = "2026-09-10T00:01:00Z";
  clock.now += 16001;
  first.listeners.focus();
  await waitForAsyncWork();
  assert.deepEqual(Array.from(first.window.favoriteKeys), ["property:A2", "property:B1"]);
  assert.deepEqual(Array.from(first.window.favoriteFilterKeys), ["property:A2"]);
  assert.equal(first.window.activeFavoriteFolderId, "folder-a");
  assert.equal(first.window.favoriteOnly, true);

  cloud.favorite[0].itemKeys = ["property:A3"];
  cloud.favorite[0].updatedAt = "2026-09-10T00:02:00Z";
  clock.now += 16001;
  first.listeners.pageshow();
  await waitForAsyncWork();
  assert.deepEqual(Array.from(first.window.favoriteFilterKeys), ["property:A3"]);

  const reloaded = createApp({ email: alpha, localValues, sessionValues, history, clock, cloud });
  await waitForAsyncWork();
  assert.equal(reloaded.window.favoriteOnly, true);
  assert.equal(reloaded.window.activeFavoriteFolderId, "folder-a");
  assert.equal(reloaded.window.activeFavoriteFolderName, "A 폴더");
  assert.deepEqual(Array.from(reloaded.window.favoriteFilterKeys), ["property:A3"]);

  reloaded.window.JSV6ListStore.remove("favorite", "folder-a", [cloud.favorite[1]]);
  assert.equal(reloaded.window.favoriteOnly, false);
  assert.equal(reloaded.window.activeFavoriteFolderId, "");
  assert.equal(sessionValues.has("js_active_favorite_folder_filter_v1"), false);
  assert.equal(history.state.jsActiveFavoriteFolderFilterV1, undefined);

  assert.equal(reloaded.window.JSV6ListStore.activateFavoriteFilter("folder-b"), true);
  reloaded.window.clearActiveFavoriteFolderFilterV1({ disableFilter: true });
  assert.equal(reloaded.window.favoriteOnly, false);
  assert.equal(reloaded.window.activeFavoriteFolderId, "");

  assert.equal(reloaded.window.JSV6ListStore.activateFavoriteFilter("folder-b"), true);
  const switched = createApp({ email: beta, localValues, sessionValues, history, clock, cloud: {
    favorite: [{ id: "folder-beta", name: "Beta", itemKeys: ["property:X1"] }],
    visit: []
  } });
  await waitForAsyncWork();
  assert.equal(switched.window.favoriteOnly, false);
  assert.equal(switched.window.activeFavoriteFolderId, "");
  assert.equal(sessionValues.has("js_active_favorite_folder_filter_v1"), false);
  assert.equal(history.state.jsActiveFavoriteFolderFilterV1, undefined);
});
