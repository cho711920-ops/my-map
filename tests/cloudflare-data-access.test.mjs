import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/data-access-v6.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const listManagerSource = readFileSync(new URL("../js/list-manager-v6.js", import.meta.url), "utf8");
const unifiedListingsSource = readFileSync(new URL("../js/unified-listings-v8.js", import.meta.url), "utf8");
const aiVisitSource = readFileSync(new URL("../js/ai-visit-session-v6.js", import.meta.url), "utf8");
const asyncMutationSource = readFileSync(new URL("../js/async-mutation-queue-v1.js", import.meta.url), "utf8");
const diagnosisStorageSource = readFileSync(new URL("../js/diagnosis-storage.js", import.meta.url), "utf8");
const announcementSource = readFileSync(new URL("../js/announcement-v1.js", import.meta.url), "utf8");
const duplicateCleanupSource = readFileSync(new URL("../js/listing-duplicate-cleanup-v1.js", import.meta.url), "utf8");
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

test("large initial read endpoints use browser revalidation instead of cache-busting URLs", async () => {
  const requests = [];
  const client = clientWith(async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ ok: true, groups: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  await client.read("unifiedListings", {});
  await client.read("geocodeCache", {});

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.doesNotMatch(request.url, /[?&]_=/);
    assert.equal(request.options.cache, "default");
  }
});

test("authenticated asset loading warms the two initial datasets without duplicate requests", async () => {
  const requests = [];
  const client = clientWith(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/sheet") return new Response("title,address\nshop,dunsan", { status: 200 });
    return new Response(JSON.stringify({ ok: true, groups: { sample: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  client.warmInitialData();
  const [csv, unified] = await Promise.all([
    client.listingsCsv(false),
    client.read("unifiedListings", {})
  ]);

  assert.equal(csv, "title,address\nshop,dunsan");
  assert.deepEqual(JSON.parse(JSON.stringify(unified.groups)), { sample: [] });
  assert.deepEqual(requests.map((entry) => entry.url).sort(), [
    "/api/data?action=unifiedListings",
    "/api/sheet"
  ]);
});

test("data access loads before every legacy UI consumer", () => {
  const accessIndex = html.indexOf('src="js/data-access-v6.js');
  assert.ok(accessIndex >= 0);
  for (const consumer of [
    "js/unified-listings-v8.js",
    "js/async-mutation-queue-v1.js",
    "js/script.js",
    "js/list-manager-v6.js",
    "js/ai-visit-session-v6.js",
    "js/diagnosis-storage.js",
    "js/announcement-v1.js",
    "js/map.js",
    "js/operations-center-v7.js",
    "js/operations-collection-v8.js",
    "js/operations-admin-v1.js"
  ]) {
    assert.ok(accessIndex < html.indexOf(`src="${consumer}`), `${consumer} must load after the data boundary`);
  }
});

test("announcement uses the shared Cloudflare data boundary with a legacy fallback", () => {
  assert.match(announcementSource, /access\.read\("announcement", \{\},/);
  assert.match(announcementSource, /typeof access\.read === "function"/);
  assert.match(announcementSource, /fetch\(saveApiURL \+ separator \+ "action=announcement&_="/);
  assert.match(announcementSource, /credentials: "same-origin"/);
  assert.match(announcementSource, /result\.announcement/);
  assert.match(announcementSource, /source\.body/);
  assert.match(html, /announcement-v1\.js\?v=1\.0\.2-data-access/);
});

test("dormant duplicate cleanup uses the shared mutation boundary without being re-enabled", () => {
  assert.match(duplicateCleanupSource, /access\.mutate\("consolidateExistingMasters", payload,/);
  assert.match(duplicateCleanupSource, /typeof access\.mutate === "function"/);
  assert.match(duplicateCleanupSource, /fetch\(window\.saveApiURL \|\| "\/api\/data"/);
  assert.match(duplicateCleanupSource, /credentials: "same-origin"/);
  assert.doesNotMatch(html, /listing-duplicate-cleanup-v1\.(?:css|js)/);
});

test("diagnosis storage uses the shared Cloudflare data boundary with a legacy fallback", () => {
  assert.match(diagnosisStorageSource, /access\.read\("loadCloudState",/);
  assert.match(diagnosisStorageSource, /access\.mutate\("saveCloudState", payload,/);
  assert.match(diagnosisStorageSource, /typeof access\[method\] === "function"/);
  assert.match(diagnosisStorageSource, /request\(url, \{ credentials: "same-origin", cache: "no-store" \}\)/);
  assert.match(diagnosisStorageSource, /return request\(global\.saveApiURL \|\| "\/api\/data",/);
  assert.match(diagnosisStorageSource, /controller\.abort\(\)/);
  assert.match(html, /data-access-v6\.js\?v=6\.0\.3-earliest-warmup/);
  assert.match(html, /diagnosis-storage\.js\?v=1\.2\.1-data-access/);
});

test("async mutation queue uses the shared boundary and preserves its legacy fallback", () => {
  assert.match(asyncMutationSource, /JSDataAccessV6\.mutate\(action, payload,/);
  assert.match(asyncMutationSource, /JSDataAccessV6\.read\(action, params,/);
  assert.match(asyncMutationSource, /keepalive:\s*true/);
  assert.match(asyncMutationSource, /return fetch\(API_URL,/);
  assert.match(asyncMutationSource, /return fetch\(API_URL \+ "\?" \+ query\.toString\(\),/);
  assert.match(asyncMutationSource, /setTimeout\(sendOutbox, 3000\)/);
  assert.match(asyncMutationSource, /tasks\.some\(function\(item\) \{ return item\.requestId === requestId; \}\)/);
  assert.match(html, /async-mutation-queue-v1\.js\?v=1\.0\.9-data-access/);
});

test("AI visit sessions use the shared Cloudflare data boundary with a legacy fallback", () => {
  assert.match(aiVisitSource, /JSDataAccessV6\.read\(action, params,/);
  assert.match(aiVisitSource, /JSDataAccessV6\.mutate\(action, payload,/);
  assert.match(aiVisitSource, /readAiVisitData\("loadCloudState"/);
  assert.match(aiVisitSource, /mutateAiVisitData\("saveCloudState"/);
  assert.match(aiVisitSource, /mutateAiVisitData\("toggleDone"/);
  assert.match(aiVisitSource, /typeof window\.JSDataAccessV6\.read === "function"/);
  assert.match(aiVisitSource, /typeof window\.JSDataAccessV6\.mutate === "function"/);
  assert.match(aiVisitSource, /fetch\(\(window\.saveApiURL \|\| "\/api\/data"\)/);
  assert.match(aiVisitSource, /fetch\(window\.saveApiURL \|\| "\/api\/data"/);
  assert.match(aiVisitSource, /pollMutationResult\(requestId/);
  assert.match(html, /ai-visit-session-v6\.js\?v=6\.4\.39-data-access/);
});

test("list manager only uses the shared Cloudflare data boundary", () => {
  assert.match(listManagerSource, /JSDataAccessV6\.read\(action, params,/);
  assert.match(listManagerSource, /JSDataAccessV6\.mutate\(action, payload,/);
  assert.match(listManagerSource, /typeof window\.JSDataAccessV6\.read !== "function"/);
  assert.match(listManagerSource, /typeof window\.JSDataAccessV6\.mutate !== "function"/);
  assert.match(listManagerSource, /공통 데이터 연결이 준비되지 않았습니다/);
  assert.doesNotMatch(listManagerSource, /fetch\((?:window\.saveApiURL|saveApiURL|API)/);
  assert.match(html, /list-manager-v6\.js\?v=6\.4\.35-shared-data-only/);
});

test("operations modules only use the shared Cloudflare data boundary", () => {
  for (const entry of operationsSources) {
    assert.match(entry.source, /JSDataAccessV6\.read\(action, params,/,
      `${entry.name} must read through JSDataAccessV6`);
    assert.match(entry.source, /JSDataAccessV6\.mutate\(action, payload,/,
      `${entry.name} must mutate through JSDataAccessV6`);
    assert.match(entry.source, /typeof (?:window|global)\.JSDataAccessV6\.(?:read|mutate) !== "function"/,
      `${entry.name} must guard the shared data boundary`);
    assert.match(entry.source, /공통 데이터 연결이 준비되지 않았습니다/,
      `${entry.name} must expose a deterministic initialization error`);
    assert.doesNotMatch(entry.source, /\bfetch\(/,
      `${entry.name} must not bypass JSDataAccessV6`);
  }
  assert.match(html, /operations-center-v7\.js\?v=7\.22\.5-shared-data-only/);
  assert.match(html, /operations-collection-v8\.js\?v=7\.25\.8-shared-data-only/);
  assert.match(html, /operations-admin-v1\.js\?v=1\.0\.5-shared-data-only/);
});

test("unified listing reads and writes only through the shared data boundary", () => {
  assert.match(unifiedListingsSource, /JSDataAccessV6\.read\(action, params,/);
  assert.match(unifiedListingsSource, /JSDataAccessV6\.mutate\(action, payload,/);
  assert.match(unifiedListingsSource, /공통 데이터 연결이 준비되지 않았습니다/);
  assert.doesNotMatch(unifiedListingsSource, /\bfetch\(/);
  assert.match(html, /unified-listings-v8\.js\?v=8\.1\.33-unique-linked-selection/);
});

test("data access mutations preserve action payload and surface D1 failures", async () => {
  let savedBody;
  let requestOptions;
  const client = clientWith(async (_url, options) => {
    requestOptions = options;
    savedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: false, message: "D1 write failed" }), {
      status: 409,
      headers: { "Content-Type": "application/json" }
    });
  });

  await assert.rejects(
    client.mutate("updateProperty", { propertyId: "M-1", memo: "test" }, { keepalive: true }),
    (error) => error.message === "D1 write failed" && error.status === 409
  );
  assert.deepEqual(savedBody, { propertyId: "M-1", memo: "test", action: "updateProperty" });
  assert.equal(requestOptions.keepalive, true);
});

test("data access forwards caller cancellation signals", async () => {
  const requests = [];
  const signal = {aborted: false};
  const client = clientWith(async (url, options) => {
    requests.push({url, options});
    return new Response(JSON.stringify({ok: true}), {status: 200});
  });

  await client.read("loadCloudState", {scope: "permitDiagnosis"}, {signal});
  await client.mutate("saveCloudState", {scope: "permitDiagnosis"}, {signal});

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.signal, signal);
  assert.equal(requests[1].options.signal, signal);
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
