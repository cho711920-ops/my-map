const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/list-manager-v6.js", "utf8");
const deletedFolder = { id: "fav_777", name: "777", itemKeys: ["property:MM-777"] };
const storage = new Map([
  ["js_favorite_lists_v6", "[]"],
  ["js_favorite_lists_v6_migrated", "1"],
  ["js_list_sync_dirty_v6_favorite", "1"],
  ["js_list_deleted_ids_v6_favorite", JSON.stringify({ fav_777: Date.now() })]
]);
const posts = [];
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
const document = {
  body: { appendChild() {} },
  addEventListener() {},
  createElement() { return { firstChild: null, innerHTML: "" }; },
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
const fetchMock = async (url, options = {}) => {
  if (options.method === "POST") {
    posts.push(JSON.parse(options.body));
    return { ok: true, async json() { return { ok: true }; } };
  }
  const isFavorite = String(url).includes("scope=favorites");
  return {
    ok: true,
    async json() {
      return { ok: true, found: true, data: isFavorite ? [deletedFolder] : [] };
    }
  };
};
const window = {
  addEventListener() {}, clearTimeout, document, fetch: fetchMock, innerWidth: 1280,
  localStorage, matchMedia() { return { matches: false }; },
  requestAnimationFrame(callback) { callback(); }, saveApiURL: "/api/apps-script", setTimeout
};
window.window = window;

vm.runInNewContext(source, {
  alert() {}, console: { error() {}, warn() {}, log() {} },
  CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options && options.detail; },
  document, fetch: fetchMock, localStorage, requestAnimationFrame: window.requestAnimationFrame,
  setTimeout, clearTimeout, window
}, { filename: "list-manager-v6.js" });

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 340));
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.JSV6ListStore.load("favorite"))),
    [],
    "서버에 남은 이전 폴더가 삭제 직후 재접속에서 되살아나면 안 된다"
  );
  const favoriteSave = posts.find((payload) => payload.scope === "favorites");
  assert.ok(favoriteSave, "삭제 상태를 계정 저장소에 다시 확정해야 한다");
  assert.deepEqual(favoriteSave.data, []);
  console.log("favorite delete persistence v7.0.4 tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
