import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("edge-automation/extension/gongsil-scope-capture.js", "utf8");
const requestBody = JSON.stringify({ btype: "Xone", level: 13, search: { sch_lndtype: ["상가"] },
  areacoord: { minlat: 36.2, minlng: 127.2, maxlat: 36.5, maxlng: 127.5 }, reqsID: "must-not-retain", collectorKey: "must-not-retain" });
const response = ids => new Response(JSON.stringify({ res: "success", datas: { res: [{ fidxs: ids, contact: "must-not-retain" }] }, key: "must-not-retain" }),
  { headers: { "Content-Type": "application/json" } });
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(fetch) {
  const calls = [];
  const context = { URL, Request, Response, WeakMap, location: { href: "https://www.gongsilbox.com/maps/Xone" },
    window: { fetch: async function() { calls.push([...arguments]); return fetch(...arguments); } } };
  vm.runInNewContext(source, context);
  return { context, calls, window: context.window };
}

test("document-start Gongsil scope hook observes existing circle responses without sending or consuming extra requests", async () => {
  const providerResponse = response(["one", "two"]);
  const h = harness(async () => providerResponse);
  const result = await h.window.fetch("/api/maps/circle", { method: "POST", body: requestBody });
  assert.equal(result, providerResponse); assert.equal(h.calls.length, 1);
  assert.equal((await result.json()).datas.res[0].fidxs.length, 2);
  await settle();
  const captured = h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture;
  assert.equal(captured.body.btype, "Xone"); assert.equal(captured.groups[0].fidxs[0], "one");
  assert.doesNotMatch(JSON.stringify(captured), /must-not-retain|contact|reqsID|collectorKey/);
  const wrapped = h.window.fetch; vm.runInNewContext(source, h.context); assert.equal(h.window.fetch, wrapped);
});

test("ordinary lists and unrelated API responses are untouched and never cloned", async () => {
  const h = harness(async () => ({ ok: true, clone() { throw new Error("unexpected clone"); } }));
  await h.window.fetch("/api/maps/lists", { method: "POST", body: requestBody });
  await h.window.fetch("https://other.example/api/maps/circle", { method: "POST", body: requestBody });
  assert.equal(h.calls.length, 2); assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture, null);
});

test("Request bodies are cloned before fetch consumes them, and provider failures remain failures", async () => {
  const h = harness(async request => { await request.text(); return response(["from-request"]); });
  await h.window.fetch(new Request("https://www.gongsilbox.com/api/maps/circle", { method: "POST", body: requestBody }));
  await settle();
  assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.groups[0].fidxs[0], "from-request");
  const broken = harness(async () => { throw new Error("provider connection failed"); });
  await assert.rejects(broken.window.fetch("/api/maps/circle", { method: "POST", body: requestBody }), /provider connection failed/);
  assert.equal(broken.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture, null);
});

test("older circle responses cannot overwrite the latest filter scope, and invalid responses clear proof", async () => {
  const waiting = [];
  const h = harness(() => new Promise(resolve => waiting.push(resolve)));
  const first = h.window.fetch("/api/maps/circle", { method: "POST", body: requestBody });
  const second = h.window.fetch("/api/maps/circle", { method: "POST", body: requestBody });
  waiting[1](response(["latest"])); await second;
  waiting[0](response(["stale"])); await first;
  await settle();
  assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.groups[0].fidxs[0], "latest");
  const third = h.window.fetch("/api/maps/circle", { method: "POST", body: requestBody });
  assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture, null);
  waiting[2](new Response(JSON.stringify({ res: "failed" }))); await third;
  await settle();
  assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture, null);
});

test("background scope parsing never delays the original provider fetch response", async () => {
  let finishClone;
  const providerResponse = { ok: true, clone: () => ({ json: () => new Promise(resolve => { finishClone = resolve; }) }) };
  const h = harness(async () => providerResponse);
  const original = await h.window.fetch("/api/maps/circle", { method: "POST", body: requestBody });
  assert.equal(original, providerResponse); assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture, null);
  finishClone({ res: "success", datas: { res: [{ fidxs: ["parsed-later"] }] } });
  await settle();
  assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.groups[0].fidxs[0], "parsed-later");
});

test("only an explicit successful empty group array can prove an empty map", async () => {
  const valid = harness(async () => new Response(JSON.stringify({res: "success", datas: {res: []}})));
  await valid.window.fetch("/api/maps/circle", {method: "POST", body: requestBody});
  await settle();
  assert.equal(valid.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.complete, true);
  assert.equal(valid.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.groups.length, 0);
  for (const payload of [{res: "success"}, {res: "success", datas: {res: [{}]}}, {res: "failed", datas: {res: []}}]) {
    const invalid = harness(async () => new Response(JSON.stringify(payload)));
    await invalid.window.fetch("/api/maps/circle", {method: "POST", body: requestBody});
    await settle();
    assert.equal(invalid.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture, null);
  }
});

test("extension installs only the small scope hook at document_start and leaves collectors at document_idle", () => {
  assert.equal(fs.readFileSync('js/gongsil-scope-capture.js','utf8'),source,'manual and extension capture stay identical');
  const manifest = JSON.parse(fs.readFileSync("edge-automation/extension/manifest.json", "utf8"));
  const early = manifest.content_scripts.find(entry => entry.js.includes("gongsil-scope-capture.js"));
  assert.equal(early.run_at, "document_start"); assert.equal(early.world, "MAIN");
  assert.ok(early.matches.every(pattern => pattern.includes("gongsilbox.com")));
  const collector = manifest.content_scripts.find(entry => entry.js.includes("collectors/gongsil-collector.js"));
  assert.equal(collector.run_at, "document_idle");
  assert.doesNotMatch(source, /setInterval|setTimeout|createElement|querySelector/);
});

test('pinned verification reads never replace the provider visual map capture',async()=>{
  const h=harness(async()=>response(['one']));
  await h.window.fetch('/api/maps/circle',{method:'POST',body:requestBody});await settle();
  const before=h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture;
  await h.window.fetch('/api/maps/circle',{method:'POST',body:requestBody,__jsGongsilCensusV95:true});await settle();
  assert.equal(h.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture,before);assert.equal(h.calls.length,2);
});
