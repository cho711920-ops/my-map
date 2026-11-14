import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { assetDigest, minifyPublicAsset, versionHtmlAssets, inlineStartupProjectionV228 } from "../tools/build-cloudflare-assets.mjs";

test('v228 only the two public projection modules are embedded inside the authenticated template, with identical ordered code',()=>{
  const files=['js/query-collection-v152.js','js/query-preview-v154.js'],sources=new Map(files.map(path=>[path,readFileSync(path,'utf8')]));
  const original=readFileSync('index.html','utf8'),html=inlineStartupProjectionV228(original,sources);
  const template=html.match(/<template id="jsAuthenticatedHeadAssets">([\s\S]*?)<\/template>/)[1];
  const blocks=[...template.matchAll(/<script data-auth-bootstrap-v228="([^"]+)">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length,2);assert.deepEqual(blocks.map(m=>m[1]),files.map(path=>path.split('/').pop()));
  for(let i=0;i<blocks.length;i++)assert.equal(blocks[i][2],sources.get(files[i]));
  assert.ok(html.indexOf('data-auth-bootstrap-v228')>html.indexOf('<template id="jsAuthenticatedHeadAssets">'));
  assert.match(template,/<script src="js\/data-access-v6\.js/);assert.match(html,/<link rel="preload" as="script" href="js\/query-collection-v152\.js/);
});

test('v228 authentication remains the identical deferred live-verification module embedded in HTML, without a second module fetch or private bootstrap data',()=>{
  const original=readFileSync('index.html','utf8'),source=readFileSync('js/auth-gate-v1.js','utf8');
  const html=inlineStartupProjectionV228(original,new Map([['js/auth-gate-v1.js',source]]));
  const module=html.match(/<script type="module" data-auth-gate-v228>([\s\S]*?)<\/script>/);
  assert.ok(module);assert.equal(module[1],source);assert.doesNotMatch(html,/<script type="module" src="js\/auth-gate-v1\.js/);
  assert.match(html,/<link rel="js-feature" id="authenticationModuleV228" href="js\/auth-gate-v1\.js/);
  assert.doesNotMatch(html,/id=["']jsNavigationSessionV149["']/);
});

test("asset minification preserves classic script globals called by inline HTML actions", async () => {
  const source = "var selectedProperty = 4;\nfunction applyFilter(extra) { return selectedProperty + extra; }\n";
  const result = await minifyPublicAsset(source, "js/example.js");
  const context = {};
  vm.runInNewContext(result, context);
  assert.equal(context.applyFilter(2), 6);
  assert.equal(context.selectedProperty, 4);
  assert.ok(Buffer.byteLength(result) < Buffer.byteLength(source));
  assert.equal(await minifyPublicAsset(source, "js/example.js"), result);
});

test("public asset URLs change with content and preserve existing version flags", () => {
  const html = '<script src="js/example.js?v=1&amp;feature=on"></script><link href="css/example.css?v=2">' +
    '<img src="/api/listing-image?url=private"><a href="https://other.example/script.js">x</a>';
  const digests = new Map([["js/example.js", assetDigest("first")], ["css/example.css", assetDigest("css")]]);
  const first = versionHtmlAssets(html, digests);
  assert.match(first.content, /v=1&amp;feature=on&amp;build=/);
  assert.equal(first.publicUrls.length, 2);
  assert.ok(first.publicUrls.every((url) => /^\/(?:js|css)\//.test(url)));
  assert.match(first.content, /src="\/api\/listing-image\?url=private"/);
  assert.deepEqual(versionHtmlAssets(html, digests), first);
  digests.set("js/example.js", assetDigest("second"));
  assert.notEqual(versionHtmlAssets(html, digests).publicUrls.find((url) => url.startsWith("/js/")),
    first.publicUrls.find((url) => url.startsWith("/js/")));
});

test("secondary scripts preload together while execution remains ordered and retries remain available", async () => {
  const source = readFileSync(new URL("../js/auth-gate-v1.js", import.meta.url), "utf8");
  const excerpt = source.slice(source.indexOf("function startDeferredAuthenticatedAssets("),
    source.indexOf("function retryDeferredAuthenticatedAssets("));
  const events = [];
  let failSecond = true;
  const scripts = ["/first.js", "/second.js", "/third.js"].map((src) => ({ getAttribute() { return src; } }));
  const context = {
    URL, Promise, AggregateError, deferredAuthenticatedAssetsPromise: null,
    deferredAuthenticatedScripts: scripts, authenticatedScriptLoads: new Map(),
    document: { baseURI: "https://js-map.com/", head: { appendChild(link) { events.push("preload:" + link.href); } },
      createElement() { return { remove() { events.push("remove:" + this.href); } }; } },
    scheduleDeferredLoad(callback) { return Promise.resolve().then(callback); },
    async loadScriptInOrder(script) {
      const src = script.getAttribute("src");
      events.push("execute:" + src);
      if (src === "/second.js" && failSecond) throw new Error("one transient failure");
      context.authenticatedScriptLoads.set(new URL(src, "https://js-map.com/").href, Promise.resolve(true));
    },
    warmInitialDataAfterScript() {}, refreshDeferredControls() {}, setDeferredFeatureReadiness() {}
  };
  vm.createContext(context);
  vm.runInContext(excerpt, context);
  await assert.rejects(context.startDeferredAuthenticatedAssets(), /1개 부가 기능/);
  assert.deepEqual(events.slice(0, 6), ["preload:/first.js", "preload:/second.js", "preload:/third.js",
    "execute:/first.js", "execute:/second.js", "execute:/third.js"]);
  assert.equal(context.deferredAuthenticatedAssetsPromise, null);
  events.length = 0;
  failSecond = false;
  await context.startDeferredAuthenticatedAssets();
  assert.equal(events.filter((event) => event.startsWith("preload:")).length, 1);
  assert.equal(events[0], "preload:/second.js");
});
