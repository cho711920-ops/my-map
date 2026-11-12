import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const registrationSource = readFileSync(new URL("../js/pwa-v1.js", import.meta.url), "utf8");
const origin = "https://js-map.com";
const versionedScript = "/js/example.js?v=1&build=0123456789abcdef";

function runtime({shell=false}={}) {
  const handlers = new Map();
  const stores = new Map();
  const requests = [];
  let offline = false;
  let nextResponse;
  const cacheApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        async put(key, response) { values.set(String(key), response.clone()); },
        async match(key) { return values.get(String(key))?.clone(); },
        async keys() { return [...values.keys()].map(url=>new Request(url)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const context = {
    URL, Request, Response, Set, Promise,
    self: { location: { origin }, addEventListener(name, handler) { handlers.set(name, handler); } },
    caches: cacheApi,
    async fetch(request) {
      requests.push(request);
      if (offline) throw new TypeError("Network unavailable");
      if (nextResponse) { const response = nextResponse; nextResponse = undefined; return response; }
      const path = new URL(request.url).pathname;
      const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".png") ? "image/png"
        : path.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
      return new Response(path === "/offline" ? "PUBLIC OFFLINE NOTICE" : "PUBLIC ASSET", {
        headers: { "content-type": type, "cache-control": "public, max-age=3600" }
      });
    }
  };
  vm.runInNewContext(source.replace('"__JS_MAP_BUILD_VERSION__"', '"test-version"')
    .replace('"__JS_MAP_STARTUP_SHELL__"', JSON.stringify(shell?'/startup-shell-v216-'+'a'.repeat(24):''))
    .replace("/* __JS_MAP_PUBLIC_ASSETS__ */ []", JSON.stringify([versionedScript, "/offline", "/icons/js-192.png"])), context);
  return {
    stores, requests, cacheApi,
    setOffline(value) { offline = value; },
    next(response) { nextResponse = response; },
    async lifecycle(name) {
      let pending;
      handlers.get(name)({ waitUntil(value) { pending = value; } });
      await pending;
    },
    dispatch(path, { navigate = false, ...init } = {}) {
      const request = new Request(new URL(path, origin), init);
      if (navigate) Object.defineProperty(request, "mode", { value: "navigate" });
      let response;
      handlers.get("fetch")({ request, respondWith(value) { response = value; } });
      return response;
    }
  };
}

test("service worker never intercepts APIs, mutations, authenticated assets, or unlisted URL variants", () => {
  const app = runtime();
  for (const path of ["/api/data?action=customers", "/api/sheet", "/api/session", "/api/listing-image?url=x",
    "/js/example.js?v=old", versionedScript + "&email=private@example.com", "https://other.example/js/example.js"]) {
    assert.equal(app.dispatch(path), undefined, path);
  }
  assert.equal(app.dispatch("/api/data", { navigate: true }), undefined);
  assert.equal(app.dispatch(versionedScript, { method: "POST", body: "private memo" }), undefined);
  assert.equal(app.dispatch(versionedScript, { headers: { authorization: "Bearer private" } }), undefined);
  assert.equal(app.stores.size, 0);
});

test("only exact public asset versions are cached without sending session cookies", async () => {
  const app = runtime();
  assert.equal(await (await app.dispatch(versionedScript)).text(), "PUBLIC ASSET");
  assert.equal(app.requests[0].credentials, "omit");
  assert.equal(app.requests[0].redirect, "error");
  app.setOffline(true);
  assert.equal(await (await app.dispatch(versionedScript)).text(), "PUBLIC ASSET");
  assert.equal(app.requests.length, 1);
  assert.equal([...app.stores.values()][0].size, 1);
  assert.equal(app.requests[0].cache,'force-cache');
});

test('activation reuses unchanged content hashes without carrying over changed code or private data',async()=>{
  const app=runtime(),old=await app.cacheApi.open('js-map-public-static-v1-previous');
  const asset=new Response('UNCHANGED CORE',{headers:{'content-type':'text/javascript','cache-control':'public, max-age=31536000, immutable'}});
  await old.put(origin+versionedScript,asset);
  await old.put(origin+'/js/example.js?v=1&build=ffffffffffffffff',asset);
  await old.put(origin+'/api/sheet',new Response('PRIVATE DATA'));
  await old.put(origin+'/js/unknown.js?build=0123456789abcdef',asset);
  await app.lifecycle('activate');
  app.setOffline(true);
  assert.equal(await (await app.dispatch(versionedScript)).text(),'UNCHANGED CORE');
  assert.equal(app.requests.length,0);
  const values=app.stores.get('js-map-public-static-v1-test-version');
  assert.deepEqual([...values.keys()],[origin+versionedScript]);
  assert.equal(app.stores.has('js-map-public-static-v1-previous'),false);
});

test("private and HTML responses cannot be saved as public JavaScript", async () => {
  for (const headers of [
    { "content-type": "text/javascript", "cache-control": "private, max-age=10" },
    { "content-type": "text/javascript", "cache-control": "no-store" },
    { "content-type": "text/html", "cache-control": "public" },
    { "content-type": "text/javascript", "set-cookie": "private=secret" }
  ]) {
    const app = runtime();
    app.next(new Response("SHOULD NOT PERSIST", { headers }));
    await app.dispatch(versionedScript);
    assert.equal([...app.stores.values()][0].size, 0);
  }
});

test("offline navigation shows a generic notice and never stores authenticated HTML", async () => {
  const app = runtime();
  await app.lifecycle("install");
  app.next(new Response("PRIVATE APP CONTENT", { headers: { "content-type": "text/html" } }));
  assert.equal(await (await app.dispatch("/?customer=secret", { navigate: true })).text(), "PRIVATE APP CONTENT");
  app.setOffline(true);
  assert.equal(await (await app.dispatch("/?customer=secret", { navigate: true })).text(), "PUBLIC OFFLINE NOTICE");
  for (const values of app.stores.values()) {
    assert.ok([...values.keys()].every((key) => !key.includes("customer") && new URL(key).pathname !== "/"));
    for (const response of values.values()) assert.doesNotMatch(await response.clone().text(), /PRIVATE APP/);
  }
});

test("a bare app refresh reuses only the install-time public shell and still leaves private/session requests on the network", async () => {
  const app=runtime({shell:true});await app.lifecycle('install');
  const shell=app.requests.find(request=>new URL(request.url).pathname.startsWith('/startup-shell-v216-'));
  assert.ok(shell);assert.equal(shell.credentials,'omit');assert.equal(shell.redirect,'error');
  const before=app.requests.length;
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),'PUBLIC ASSET');
  assert.equal(app.requests.length,before);
  assert.equal(app.dispatch('/api/session'),undefined);
  app.next(new Response('PRIVATE NAVIGATION',{headers:{'content-type':'text/html'}}));
  assert.equal(await(await app.dispatch('/?personal=1',{navigate:true})).text(),'PRIVATE NAVIGATION');
  app.setOffline(true);
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),'PUBLIC ASSET');
  for(const values of app.stores.values())for(const [key,response]of values){
    assert.notEqual(new URL(key).pathname,'/');assert.doesNotMatch(await response.clone().text(),/PRIVATE NAVIGATION/);
  }
});

test("offline install uses the canonical URL without depending on an HTML redirect", async () => {
  const app = runtime();
  await app.lifecycle("install");
  assert.ok(app.requests.some((request) => new URL(request.url).pathname === "/offline"));
  assert.ok(app.requests.every((request) => new URL(request.url).pathname !== "/offline.html"));
});

test("activation removes only obsolete caches owned by this public service worker", async () => {
  const app = runtime();
  await app.cacheApi.open("js-map-public-static-v1-obsolete");
  await app.cacheApi.open("unrelated-cache");
  await app.lifecycle("install");
  await app.lifecycle("activate");
  assert.deepEqual([...app.stores.keys()].sort(), ["js-map-public-static-v1-test-version", "unrelated-cache"]);
  assert.doesNotMatch(source, /self\.skipWaiting\(|clients\.claim\(/);
});

test("PWA registration uses network update checks without forcing active pages to reload", async () => {
  const registrations = [];
  vm.runInNewContext(registrationSource, {
    navigator: { serviceWorker: { register(url, options) { registrations.push({ url, ...options }); return Promise.resolve({}); } } },
    window: { isSecureContext: true }, document: { readyState: "complete" },
    setTimeout(callback) { callback(); }
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].url, "/sw.js");
  assert.equal(registrations[0].updateViaCache, "none");
  assert.doesNotMatch(registrationSource, /location\.reload|controllerchange|SKIP_WAITING/);
});
