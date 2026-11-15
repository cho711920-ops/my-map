import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {webcrypto, createHash} from "node:crypto";

const source = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const registrationSource = readFileSync(new URL("../js/pwa-v1.js", import.meta.url), "utf8");
const origin = "https://js-map.com";
const versionedScript = "/js/example.js?v=1&build=0123456789abcdef";

function runtime({shell=false, fetchImpl=null, build='test-version', shellBuild='a'.repeat(24)}={}) {
  const handlers = new Map();
  const stores = new Map();
  const requests = [];
  let offline = false;
  let nextResponse;
  let now = 10000;
  const pending = [];
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
    URL, URLSearchParams, Request, Response, Headers, Set, Promise, Uint8Array, TextDecoder, AbortController,
    crypto:webcrypto, setTimeout, clearTimeout, Date:class extends Date {static now(){return now;}},
    self: { location: { origin }, addEventListener(name, handler) { handlers.set(name, handler); } },
    caches: cacheApi,
    async fetch(request) {
      requests.push(request);
      if (offline) throw new TypeError("Network unavailable");
      if (nextResponse) { const response = nextResponse; nextResponse = undefined; return response; }
      const path = new URL(request.url).pathname;
      if(fetchImpl){const response=await fetchImpl(request);if(response)return response;}
      if(path==='/public-release-v240.json')return new Response('',{status:404});
      const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".png") ? "image/png"
        : path.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
      return new Response(path === "/offline" ? "PUBLIC OFFLINE NOTICE" : "PUBLIC ASSET", {
        headers: { "content-type": type, "cache-control": "public, max-age=3600" }
      });
    }
  };
  vm.runInNewContext(source.replace('"__JS_MAP_BUILD_VERSION__"', JSON.stringify(build))
    .replace('"__JS_MAP_STARTUP_SHELL__"', JSON.stringify(shell?'/startup-shell-v216-'+shellBuild:''))
    .replace("/* __JS_MAP_PUBLIC_ASSETS__ */ []", JSON.stringify([versionedScript, "/offline", "/icons/js-192.png"])), context);
  return {
    stores, requests, cacheApi,
    advance(){now+=1001;},
    async drain(){await Promise.all(pending.splice(0));},
    message(data, url=origin+'/') {handlers.get('message')?.({data,source:{url},waitUntil(value){pending.push(value);}});},
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
      handlers.get("fetch")({ request, respondWith(value) { response = value; },waitUntil(value){pending.push(value);} });
      return response;
    }
  };
}

test("service worker never intercepts APIs, mutations, authenticated assets, or unversioned URLs", () => {
  const app = runtime();
  for (const path of ["/api/data?action=customers", "/api/sheet", "/api/session", "/api/listing-image?url=x",
    "/js/example.js?v=old", "https://other.example/js/example.js"]) {
    assert.equal(app.dispatch(path), undefined, path);
  }
  assert.equal(app.dispatch("/api/data", { navigate: true }), undefined);
  assert.equal(app.dispatch(versionedScript, { method: "POST", body: "private memo" }), undefined);
  assert.equal(app.dispatch(versionedScript, { headers: { authorization: "Bearer private" } }), undefined);
  assert.equal(app.stores.size, 0);
});

test('v240 unknown fingerprint URL variants pass through and are never added to public caches',async()=>{
  const app=runtime();const url=versionedScript+'&email=private@example.com';
  assert.equal(await(await app.dispatch(url)).text(),'PUBLIC ASSET');
  for(const values of app.stores.values())assert.equal(values.size,0);
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
  await app.drain();
  assert.ok(app.requests.slice(before).every(request=>new URL(request.url).pathname==='/public-release-v240.json'));
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
    window: { isSecureContext: true }, document: { readyState: "complete", addEventListener() {} },
    setTimeout(callback) { callback(); }
  });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].url, "/sw.js");
  assert.equal(registrations[0].updateViaCache, "none");
  assert.doesNotMatch(registrationSource, /location\.reload|controllerchange|SKIP_WAITING/);
});

for (const readyState of ["loading", "interactive"]) test("PWA update checks still start when map/image loading never finishes: " + readyState, () => {
  const handlers = new Map(), registrations = [], timers = [];
  vm.runInNewContext(registrationSource, {
    navigator: { serviceWorker: { register(url, options) { registrations.push({url, ...options}); return Promise.resolve({}); } } },
    window: { isSecureContext: true, addEventListener() { throw Error("Window load must not gate public update checks"); } },
    document: { readyState, addEventListener(event, callback, options) { handlers.set(event, {callback, options}); } },
    setTimeout(callback, delay) { timers.push({callback, delay}); }
  });
  if (readyState === "loading") {
    assert.equal(timers.length, 0);assert.equal(handlers.get("DOMContentLoaded").options.once, true);
    handlers.get("DOMContentLoaded").callback();
  }
  assert.equal(timers.length, 1);assert.equal(timers[0].delay, 1000);assert.equal(registrations.length, 0);
  timers[0].callback();assert.equal(registrations.length, 1);assert.equal(registrations[0].updateViaCache, "none");
});

const releaseBuildV240='b'.repeat(24);
const newScriptV240='window.publicEditorBuild="new";',newScriptShaV240=createHash('sha256').update(newScriptV240).digest('hex');
const newScriptUrlV240='/js/editor.js?build='+newScriptShaV240.slice(0,16);
const publicHtmlV240='<template id="jsAuthenticatedHeadAssets"><script src="'+newScriptUrlV240+'"></script></template><main>NEW EDITOR</main>';
function publicReleaseV240(html=publicHtmlV240, fields={}) {
  return {version:240,build:releaseBuildV240,shellUrl:'/startup-shell-v216-'+releaseBuildV240,
    shellSha256:createHash('sha256').update(html).digest('hex'),assets:[{url:newScriptUrlV240,sha256:newScriptShaV240}],...fields};
}
function publicResponseV240(body, contentType='text/html', headers={}) {
  return new Response(body,{headers:{'content-type':contentType,'cache-control':'public,max-age=0,must-revalidate',...headers}});
}

test('v240 a later verified public release reaches ordinary root reloads while the old worker and editing page can remain alive',async()=>{
  let releaseManifest,htmlReads=0;
  const app=runtime({shell:true,fetchImpl:request=>{
    const path=new URL(request.url).pathname;
    if(path==='/public-release-v240.json')return releaseManifest;
    if(path==='/startup-shell-v216-'+releaseBuildV240){htmlReads++;return publicResponseV240(publicHtmlV240);}
    if(path==='/js/editor.js')return publicResponseV240(newScriptV240,'text/javascript');
  }});
  await app.lifecycle('install');
  let finish;
  releaseManifest=new Promise(resolve=>{finish=()=>resolve(publicResponseV240(JSON.stringify(publicReleaseV240()),'application/json'));});
  // The release network is deliberately stalled. The real response body is
  // available before it finishes; no timeout/race is added to the fast refresh.
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),'PUBLIC ASSET');
  assert.equal(htmlReads,0);
  finish();await app.drain();
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),publicHtmlV240);
  assert.equal(await(await app.dispatch('/index.html',{navigate:true})).text(),publicHtmlV240);
  assert.equal(htmlReads,1);
  app.setOffline(true);
  assert.equal(await(await app.dispatch(newScriptUrlV240)).text(),newScriptV240);
  app.setOffline(false);
  app.advance();releaseManifest=publicResponseV240(JSON.stringify(publicReleaseV240()),'application/json');
  app.message({type:'CHECK_PUBLIC_RELEASE_V240'});await app.drain();assert.equal(htmlReads,1);
  for(const request of app.requests.filter(request=>/public-release|startup-shell/.test(request.url))){
    assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');assert.equal(request.cache,'no-cache');
  }
  app.setOffline(true);app.advance();
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),publicHtmlV240);await app.drain();
  assert.equal(app.dispatch('/api/session'),undefined);assert.equal(app.dispatch('/api/data'),undefined);
  assert.doesNotMatch(source,/self\.skipWaiting\(|clients\.claim\(/);
});

for(const invalid of ['external-url','hash','private','cookie','session-html','large-body','wrong-content-type','failed-shell'])
test('v240 rejects '+invalid+' without replacing a previously verified public shell',async()=>{
  let mode='good';
  const badHtml=invalid==='session-html'?publicHtmlV240+'<script id="jsNavigationSessionV149">PRIVATE</script>':
    invalid==='large-body'?publicHtmlV240+'x'.repeat(524288):publicHtmlV240+'CHANGED';
  const app=runtime({shell:true,fetchImpl:request=>{
    const path=new URL(request.url).pathname;
    if(path==='/public-release-v240.json'){
      const manifest=mode==='good'?publicReleaseV240():publicReleaseV240(badHtml,invalid==='external-url'?{shellUrl:'https://other.example/private'}:{});
      return publicResponseV240(JSON.stringify(manifest),'application/json');
    }
    if(path==='/startup-shell-v216-'+releaseBuildV240){
      if(mode==='good')return publicResponseV240(publicHtmlV240);
      if(invalid==='failed-shell')return new Response('failure',{status:503});
      return publicResponseV240(invalid==='hash'?badHtml+'MISMATCH':badHtml,
        invalid==='wrong-content-type'?'application/json':'text/html',
        invalid==='private'?{'cache-control':'private,no-store'}:invalid==='cookie'?{'set-cookie':'private=1'}:{});
    }
    if(path==='/js/editor.js')return publicResponseV240(newScriptV240,'text/javascript');
  }});
  await app.lifecycle('install');app.message({type:'CHECK_PUBLIC_RELEASE_V240'});await app.drain();
  mode='bad';app.advance();app.message({type:'CHECK_PUBLIC_RELEASE_V240'});await app.drain();
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),publicHtmlV240);
  assert.ok(app.requests.every(request=>new URL(request.url).origin===origin));
});

test('v240 release messages require a same-origin app page and duplicate checks share one fetch',async()=>{
  let done;
  const app=runtime({shell:true,fetchImpl:request=>new URL(request.url).pathname==='/public-release-v240.json'
    ?new Promise(resolve=>{done=()=>resolve(new Response('',{status:404}));}):null});
  await app.lifecycle('install');const before=app.requests.length;
  app.message({type:'CHECK_PUBLIC_RELEASE_V240'},'https://other.example/');
  app.message({type:'CHECK_PUBLIC_RELEASE_V240'},origin+'/collector-install');
  app.message({type:'OTHER'});assert.equal(app.requests.length,before);
  app.message({type:'CHECK_PUBLIC_RELEASE_V240'});app.message({type:'CHECK_PUBLIC_RELEASE_V240'});
  assert.equal(app.requests.length,before+1);done();await app.drain();
});

for(const problem of ['hash','private','undeclared'])test('v240 does not publish new markup before all matching assets are prepared: '+problem,async()=>{
  let finish,scriptReads=0;
  const app=runtime({shell:true,fetchImpl:request=>{
    const path=new URL(request.url).pathname;
    if(path==='/public-release-v240.json')return publicResponseV240(JSON.stringify(publicReleaseV240(publicHtmlV240,problem==='undeclared'?{assets:[]}:{})),'application/json');
    if(path==='/startup-shell-v216-'+releaseBuildV240)return publicResponseV240(publicHtmlV240);
    if(path==='/js/editor.js'){
      scriptReads++;
      return new Promise(resolve=>{finish=()=>resolve(publicResponseV240(problem==='hash'?'WRONG BUILD':newScriptV240,'text/javascript',problem==='private'?{'cache-control':'private,no-store'}:{}));});
    }
  }});
  await app.lifecycle('install');app.message({type:'CHECK_PUBLIC_RELEASE_V240'});
  // Flush actual stream/digest work until either the staged asset is requested
  // or an undeclared asset prevents staging. No app response awaits this work.
  for(let n=0;n<100&&!finish;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),'PUBLIC ASSET');
  finish?.();await app.drain();
  assert.equal(scriptReads,problem==='undeclared'?0:1);
  assert.equal(await(await app.dispatch('/',{navigate:true})).text(),'PUBLIC ASSET');
});

test('v240 visible-page release preparation posts only a public check without reloading or modifying inputs',async()=>{
  const events=new Map(),messages=[];
  const document={readyState:'complete',visibilityState:'visible',addEventListener(name,cb){events.set(name,cb);}};
  vm.runInNewContext(registrationSource,{
    document,window:{isSecureContext:true},setTimeout(callback){callback();},
    navigator:{serviceWorker:{controller:{postMessage(value){messages.push(value.type);}},register(){return Promise.resolve({});}}}
  });
  await Promise.resolve();assert.deepEqual(messages,['CHECK_PUBLIC_RELEASE_V240']);
  document.visibilityState='hidden';events.get('visibilitychange')();assert.equal(messages.length,1);
  document.visibilityState='visible';events.get('visibilitychange')();assert.equal(messages.length,2);
});

test('v240 installation upgrades only proven legacy public navigation slots, preserving old scripts and every private cache',async()=>{
  const app=runtime({shell:true,build:releaseBuildV240,shellBuild:releaseBuildV240,fetchImpl:request=>{
    const path=new URL(request.url).pathname;
    if(path==='/public-release-v240.json')return publicResponseV240(JSON.stringify(publicReleaseV240()),'application/json');
    if(path==='/startup-shell-v216-'+releaseBuildV240)return publicResponseV240(publicHtmlV240);
    if(path==='/js/editor.js')return publicResponseV240(newScriptV240,'text/javascript');
  }});
  const legacy=await app.cacheApi.open('js-map-public-static-v1-legacy');
  const oldKey=origin+'/startup-shell-v216-'+'a'.repeat(24);
  await legacy.put(oldKey,publicResponseV240('<template id="jsAuthenticatedHeadAssets"></template>OLD EDITOR'));
  await legacy.put(origin+versionedScript,publicResponseV240('OLD SCRIPT','text/javascript'));
  const privateCache=await app.cacheApi.open('user-owned-private');
  await privateCache.put(origin+'/api/data',new Response('PRIVATE DRAFT'));
  const invalidKey=origin+'/startup-shell-v216-'+'c'.repeat(24);
  await legacy.put(invalidKey,publicResponseV240('<template id="jsAuthenticatedHeadAssets"></template><script id="jsNavigationSessionV149">PRIVATE</script>'));
  await app.lifecycle('install');
  assert.equal(await(await legacy.match(oldKey)).text(),publicHtmlV240);
  assert.equal(await(await legacy.match(origin+versionedScript)).text(),'OLD SCRIPT');
  assert.match(await(await legacy.match(invalidKey)).text(),/PRIVATE/);
  assert.equal(await(await privateCache.match(origin+'/api/data')).text(),'PRIVATE DRAFT');
});

test('v240 failed legacy preparation cannot report a successful installation or overwrite the previous public editor',async()=>{
  const app=runtime({shell:true,build:releaseBuildV240,shellBuild:releaseBuildV240,fetchImpl:request=>{
    const path=new URL(request.url).pathname;
    if(path==='/public-release-v240.json')return publicResponseV240(JSON.stringify(publicReleaseV240()),'application/json');
    if(path==='/startup-shell-v216-'+releaseBuildV240)return publicResponseV240(publicHtmlV240);
    if(path==='/js/editor.js')return publicResponseV240('WRONG SERVER BUILD','text/javascript');
  }});
  const legacy=await app.cacheApi.open('js-map-public-static-v1-legacy'),oldKey=origin+'/startup-shell-v216-'+'a'.repeat(24);
  const oldHtml='<template id="jsAuthenticatedHeadAssets"></template>OLD EDITOR';await legacy.put(oldKey,publicResponseV240(oldHtml));
  await assert.rejects(app.lifecycle('install'),/Public release preparation did not finish/);
  assert.equal(await(await legacy.match(oldKey)).text(),oldHtml);
});

test('v241 a mismatched old public asset must be refetched instead of permanently blocking the release',async()=>{
 let networkScriptReads=0;
 const app=runtime({shell:true,build:releaseBuildV240,shellBuild:releaseBuildV240,fetchImpl:request=>{
  const path=new URL(request.url).pathname;
  if(path==='/public-release-v240.json')return publicResponseV240(JSON.stringify(publicReleaseV240()),'application/json');
  if(path==='/startup-shell-v216-'+releaseBuildV240)return publicResponseV240(publicHtmlV240);
  if(path==='/js/editor.js'){networkScriptReads++;return publicResponseV240(newScriptV240,'text/javascript');}
 }});
 const legacy=await app.cacheApi.open('js-map-public-static-v1-legacy');
 await legacy.put(origin+'/startup-shell-v216-'+'a'.repeat(24),publicResponseV240('<template id="jsAuthenticatedHeadAssets"></template>OLD'));
 await legacy.put(origin+newScriptUrlV240,publicResponseV240('OLD WRONG BYTES UNDER A NEW URL','text/javascript'));
 await app.lifecycle('install');
 assert.equal(networkScriptReads,1);
 assert.equal(await(await legacy.match(origin+'/startup-shell-v216-'+'a'.repeat(24))).text(),publicHtmlV240);
 assert.equal(await(await legacy.match(origin+newScriptUrlV240)).text(),newScriptV240);
 const diagnostics=app.requests.filter(request=>request.method==='HEAD');
 assert.deepEqual(diagnostics.map(request=>new URL(request.url).searchParams.get('release_status_v241')),['started','prepared']);
 assert.equal(new URL(diagnostics[1].url).searchParams.get('code'),'cache_repaired');
 assert.equal(new URL(diagnostics[1].url).searchParams.get('repairs'),'1');
});

for(const pointer of ['same-html-previous-build','same-build-without-verified-assets'])
test('v241 installation verifies and publishes current metadata despite '+pointer,async()=>{
  let scriptReads=0;
  const app=runtime({shell:true,build:releaseBuildV240,shellBuild:releaseBuildV240,fetchImpl:request=>{
    const path=new URL(request.url).pathname;
    if(path==='/public-release-v240.json')return publicResponseV240(JSON.stringify(publicReleaseV240()),'application/json');
    if(path==='/startup-shell-v216-'+releaseBuildV240)return publicResponseV240(publicHtmlV240);
    if(path==='/js/editor.js'){scriptReads++;return publicResponseV240(newScriptV240,'text/javascript');}
  }});
  const legacy=await app.cacheApi.open('js-map-public-static-v1-legacy'),oldKey=origin+'/startup-shell-v216-'+'a'.repeat(24);
  await legacy.put(oldKey,publicResponseV240('<template id="jsAuthenticatedHeadAssets"></template>OLD'));
  const releaseCache=await app.cacheApi.open('js-map-public-shell-v240');
  await releaseCache.put(origin+'/startup-current-v240',publicResponseV240(publicHtmlV240,'text/html',{
    'x-js-public-shell-sha-v240':publicReleaseV240().shellSha256,
    'x-js-public-shell-build-v240':pointer==='same-html-previous-build'?'a'.repeat(24):releaseBuildV240,
    'x-js-public-shell-assets-v241':'own'
  }));
  await app.lifecycle('install');assert.equal(scriptReads,1);
  const current=await releaseCache.match(origin+'/startup-current-v240');
  assert.equal(current.headers.get('x-js-public-shell-build-v240'),releaseBuildV240);
  assert.equal(current.headers.get('x-js-public-shell-assets-v241'),'verified');
  assert.equal(await(await legacy.match(oldKey)).text(),publicHtmlV240);
});

test('v241 invalid cached and server bytes fail safely without changing old editor, drafts or private caches',async()=>{
  const app=runtime({shell:true,build:releaseBuildV240,shellBuild:releaseBuildV240,fetchImpl:request=>{
    const path=new URL(request.url).pathname;
    if(path==='/public-release-v240.json')return publicResponseV240(JSON.stringify(publicReleaseV240()),'application/json');
    if(path==='/startup-shell-v216-'+releaseBuildV240)return publicResponseV240(publicHtmlV240);
    if(path==='/js/editor.js')return publicResponseV240('WRONG NETWORK CODE','text/javascript');
  }});
  const legacy=await app.cacheApi.open('js-map-public-static-v1-legacy'),oldKey=origin+'/startup-shell-v216-'+'a'.repeat(24);
  const html='<template id="jsAuthenticatedHeadAssets"></template>OLD';
  await legacy.put(oldKey,publicResponseV240(html));
  await legacy.put(origin+newScriptUrlV240,publicResponseV240('WRONG CACHE CODE','text/javascript'));
  const privateCache=await app.cacheApi.open('private-user');await privateCache.put(origin+'/api/data',new Response('SAVED USER MEMO'));
  await assert.rejects(app.lifecycle('install'),/Public release preparation did not finish/);
  assert.equal(await(await legacy.match(oldKey)).text(),html);
  assert.equal(await(await legacy.match(origin+newScriptUrlV240)).text(),'WRONG CACHE CODE');
  assert.equal(await(await privateCache.match(origin+'/api/data')).text(),'SAVED USER MEMO');
  const reports=app.requests.filter(request=>request.method==='HEAD').map(request=>new URL(request.url));
  assert.equal(reports.at(-1).searchParams.get('release_status_v241'),'blocked');
  assert.equal(reports.at(-1).searchParams.get('code'),'asset_invalid');
  for(const request of app.requests.filter(request=>request.method==='HEAD')){
    assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');assert.equal(request.cache,'no-cache');
  }
});
