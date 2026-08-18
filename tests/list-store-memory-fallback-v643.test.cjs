const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/list-manager-v6.js", "utf8");
const requests = [];
const document = {
  body: { appendChild() {} },
  addEventListener() {},
  createElement() { return { firstChild: null, innerHTML: "" }; },
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
const localStorage = {
  getItem() { throw new Error("storage blocked"); },
  setItem() { throw new Error("storage blocked"); },
  removeItem() { throw new Error("storage blocked"); }
};
const window = {
  addEventListener() {},
  clearTimeout,
  document,
  fetch: async (url, options) => {
    requests.push({ url: String(url), options: options || {} });
    return {
      ok: true,
      async json() {
        return options && options.method === "POST"
          ? { ok: true }
          : { ok: true, found: false };
      }
    };
  },
  innerWidth: 1280,
  localStorage,
  matchMedia() { return { matches: false }; },
  requestAnimationFrame(callback) { callback(); },
  saveApiURL: "/api/apps-script",
  setTimeout
};
window.JSDataAccessV6 = {
  async read() {
    return { ok: true, found: false };
  },
  async mutate(action, payload) {
    requests.push({
      url: "shared:" + action,
      options: {
        method: "POST",
        body: JSON.stringify(Object.assign({ action }, payload))
      }
    });
    return { ok: true };
  }
};
window.window = window;

const sandbox = {
  alert() {},
  console: { error() {}, warn() {}, log() {} },
  CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options && options.detail; },
  document,
  fetch: window.fetch,
  localStorage,
  requestAnimationFrame: window.requestAnimationFrame,
  setTimeout,
  clearTimeout,
  window
};
vm.runInNewContext(source, sandbox, { filename: "list-manager-v6.js" });

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  const folder = { id: "fav_test", name: "검증", itemKeys: ["property:MM-1"] };
  assert.equal(window.JSV6ListStore.save("favorite", [folder]), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.JSV6ListStore.load("favorite"))),
    [folder],
    "브라우저 저장이 막혀도 메모리 목록은 즉시 유지되어야 한다"
  );
  await new Promise((resolve) => setTimeout(resolve, 330));
  const cloudSave = requests.find((request) => request.options.method === "POST");
  assert.ok(cloudSave, "브라우저 저장 실패와 무관하게 계정 클라우드 저장을 호출해야 한다");
  const payload = JSON.parse(cloudSave.options.body);
  assert.equal(payload.scope, "favorites");
  assert.deepEqual(payload.data, [folder]);
  console.log("list store memory fallback v6.4.29 tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
