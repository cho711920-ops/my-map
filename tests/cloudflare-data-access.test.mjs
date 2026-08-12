import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/data-access-v6.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const operationsSources = [
  "operations-center-v7.js",
  "operations-collection-v8.js",
  "operations-admin-v1.js"
].map((name) => ({
  name,
  source: readFileSync(new URL(`../js/${name}`, import.meta.url), "utf8")
}));

function clientWith(fetch) {
  const window = { fetch, URLSearchParams };
  vm.runInNewContext(source, { window, URLSearchParams, Date, Error, JSON, Object, String, Number });
  return window.JSDataAccessV6;
}

test("data access reads Cloudflare D1 actions with session credentials", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true, revision: "42" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  const result = await client.read("dataRevision", { scope: "listings", action: "unsafeOverride" });
  assert.equal(result.revision, "42");
  assert.match(request.url, /^\/api\/data\?/);
  assert.match(request.url, /action=dataRevision/);
  assert.doesNotMatch(request.url, /unsafeOverride/);
  assert.match(request.url, /scope=listings/);
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.cache, "no-store");
});

test("data access loads before every legacy UI consumer", () => {
  const accessIndex = html.indexOf('src="js/data-access-v6.js');
  assert.ok(accessIndex >= 0);
  for (const consumer of [
    "js/unified-listings-v8.js",
    "js/script.js",
    "js/map.js",
    "js/operations-center-v7.js",
    "js/operations-collection-v8.js",
    "js/operations-admin-v1.js"
  ]) {
    assert.ok(accessIndex < html.indexOf(`src="${consumer}`), `${consumer} must load after the data boundary`);
  }
});

test("operations modules use the shared Cloudflare data boundary with a legacy fallback", () => {
  for (const entry of operationsSources) {
    assert.match(entry.source, /JSDataAccessV6\.read\(action, params,/,
      `${entry.name} must read through JSDataAccessV6`);
    assert.match(entry.source, /JSDataAccessV6\.mutate\(action, payload,/,
      `${entry.name} must mutate through JSDataAccessV6`);
    assert.match(entry.source, /typeof (?:window|global)\.JSDataAccessV6\.(?:read|mutate) === "function"/,
      `${entry.name} must retain a guarded legacy fallback`);
  }
  assert.match(html, /operations-center-v7\.js\?v=7\.22\.2-data-access/);
  assert.match(html, /operations-collection-v8\.js\?v=7\.25\.4-accessible-dialog/);
  assert.match(html, /operations-admin-v1\.js\?v=1\.0\.4-data-access/);
});

test("data access mutations preserve action payload and surface D1 failures", async () => {
  let savedBody;
  const client = clientWith(async (_url, options) => {
    savedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: false, message: "D1 write failed" }), {
      status: 409,
      headers: { "Content-Type": "application/json" }
    });
  });

  await assert.rejects(
    client.mutate("updateProperty", { propertyId: "M-1", memo: "test" }),
    (error) => error.message === "D1 write failed" && error.status === 409
  );
  assert.deepEqual(savedBody, { propertyId: "M-1", memo: "test", action: "updateProperty" });
});

test("listing CSV requests keep the existing force-refresh contract", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, options };
    return new Response("title,address\nshop,dunsan", { status: 200 });
  });

  const csv = await client.listingsCsv(true);
  assert.equal(csv, "title,address\nshop,dunsan");
  assert.equal(request.url, "/api/sheet");
  assert.equal(request.options.cache, "reload");
  assert.equal(request.options.headers["X-JS-Force-Refresh"], "1");
  assert.equal(request.options.credentials, "same-origin");
});
