const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/list-manager-v6.js", "utf8");
const storage = new Map([
  ["js_favorite_lists_v6", JSON.stringify([{ id: "fav_gg", name: "GG 찜", itemKeys: ["property:GG-1"] }])],
  ["js_favorite_lists_v6_migrated", "1"]
]);
const cloudByEmail = {
  "ggjin8877@gmail.com": [{ id: "fav_gg_cloud", name: "GG cloud", itemKeys: ["property:GG-CLOUD-1"] }],
  "cho711920@gmail.com": [{ id: "fav_cho", name: "CHO 찜", itemKeys: ["property:CHO-1"] }]
};

function createApp(email, useSharedDataAccess) {
  const posts = [];
  const reads = [];
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const document = {
    body: { appendChild() {} }, addEventListener() {},
    createElement() { return { firstChild: null, innerHTML: "" }; },
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }
  };
  const fetchMock = async (url, options = {}) => {
    if (String(url) === "/api/session") {
      return { ok: true, async json() { return { ok: true, email }; } };
    }
    if (options.method === "POST") {
      const payload = JSON.parse(options.body);
      posts.push(payload);
      if (payload.scope === "favorites") cloudByEmail[email] = payload.data;
      return { ok: true, async json() { return { ok: true }; } };
    }
    const favorites = String(url).includes("scope=favorites");
    const data = favorites ? cloudByEmail[email] : [];
    return { ok: true, async json() { return { ok: true, found: data.length > 0, data }; } };
  };
  const window = {
    addEventListener() {}, clearTimeout, document, fetch: fetchMock, innerWidth: 1280,
    localStorage, matchMedia() { return { matches: false }; },
    requestAnimationFrame(callback) { callback(); }, saveApiURL: "/api/data", setTimeout
  };
  if (useSharedDataAccess) {
    window.JSDataAccessV6 = {
      async read(action, params) {
        reads.push({ action, params });
        const data = params.scope === "favorites" ? cloudByEmail[email] : [];
        return { ok: true, found: data.length > 0, data };
      },
      async mutate(action, payload) {
        posts.push(Object.assign({ action }, payload));
        if (payload.scope === "favorites") cloudByEmail[email] = payload.data;
        return { ok: true };
      }
    };
  }
  window.window = window;
  vm.runInNewContext(source, {
    alert() {}, console: { error() {}, warn() {}, log() {} },
    CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options && options.detail; },
    document, fetch: fetchMock, localStorage, requestAnimationFrame: window.requestAnimationFrame,
    setTimeout, clearTimeout, URLSearchParams, window
  }, { filename: "list-manager-v6.js" });
  return { window, posts, reads };
}

(async () => {
  const gg = createApp("ggjin8877@gmail.com", true);
  await new Promise((resolve) => setTimeout(resolve, 360));
  assert.deepEqual(
    Array.from(gg.window.JSV6ListStore.load("favorite"), (list) => list.id).sort(),
    ["fav_gg", "fav_gg_cloud"]
  );
  assert.ok(storage.has("js_favorite_lists_v6::ggjin8877%40gmail.com"));
  assert.ok(gg.posts.some((payload) => payload.scope === "favorites" &&
    payload.data.some((list) => list.id === "fav_gg") &&
    payload.data.some((list) => list.id === "fav_gg_cloud")));
  assert.ok(gg.reads.some((request) => request.action === "loadCloudState" &&
    request.params.scope === "favorites"));

  const cho = createApp("cho711920@gmail.com", true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(cho.window.JSV6ListStore.load("favorite")[0].id, "fav_cho");
  assert.ok(storage.has("js_favorite_lists_v6::cho711920%40gmail.com"));
  assert.equal(JSON.parse(storage.get("favoriteKeys")).includes("property:GG-1"), false);
  assert.ok(gg.window.JSV6ListStore.load("favorite").some((list) => list.id === "fav_gg"));
  console.log("account favorite sync tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
