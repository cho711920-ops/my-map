import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const worker = readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
const map = readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
const access = readFileSync(new URL("../js/data-access-v6.js", import.meta.url), "utf8");
function fn(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function harness() {
  const store = new Map(), counts = { reads: 0, writes: 0, d1: 0 };
  let sequence = 0;
  const env = { DB: {}, MEDIA: {
    async get(key) {
      counts.reads++;
      const row = store.get(key);
      return row ? { ...row, text: async () => row.body } : null;
    },
    async put(key, body, options = {}) {
      counts.writes++;
      const current = store.get(key);
      if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
      if (options.onlyIf?.etagDoesNotMatch === "*" && current) return null;
      const row = { body, ...options, etag: String(++sequence) };
      store.set(key, row);
      return row;
    }
  } };
  const context = vm.createContext({ Response, Date, crypto, console,
    D1_SHEET_CACHE_KEY: "sheet", LISTINGS_REVISION_KEY: "listings", OPERATIONS_REVISION_KEY: "operations",
    sheetCache: { body: "", fetchedAt: 0 }, requireSession: async () => ({}),
    sha256Etag: async (body) => body,
    buildD1SheetCsv: async () => { counts.d1++; return "NEW"; }
  });
  for (const name of ["cacheAgeMs", "readR2TextCache", "writeR2TextCache", "revisionKey",
    "readDataRevision", "appendDataRevision", "touchDataRevision", "handleSheet"]) {
    vm.runInContext(fn(worker, name), context);
  }
  const write = (info) => context.touchDataRevision(env, null, ["listings"], null, info);
  const read = (since) => context.readDataRevision(env, "listings", since);
  return { context, env, store, counts, write, read };
}
function browser(h) {
  const counts = { full: 0, delta: 0 };
  const context = vm.createContext({ console, Promise, URLSearchParams,
    jsListingsRevisionV682: "", jsListingsRevisionInfoV683: null, jsListingsRevisionPendingV682: false,
    isLoadingSheet: false,
    window: { JSDataAccessV6: { read: (_action, args) => h.read(args.since) } },
    loadSheet: async () => {
      counts.full++;
      context.jsListingsRevisionV682 = (await h.read()).revision;
      return true;
    },
    applyListingChangesV683: async (info) => { if (info.fullReload) return false; counts.delta++; return true; }
  });
  for (const name of ["fetchDataRevisionV682", "rememberListingsRevisionV682", "refreshListingsWhenChangedV682"]) {
    vm.runInContext(fn(map, name), context);
  }
  return { context, counts };
}

test("collection full reload cannot be erased by a following single-property delta", async () => {
  const h = harness();
  await h.write({ changeIds: ["BASE"] });
  const base = (await h.read()).revision;
  await h.write({ fullReload: true, changeAction: "finalizeCollectionSession" });
  await h.write({ changeIds: ["ONE"], changeAction: "elevatorCapacity" });
  assert.equal((await h.read(base)).fullReload, true);
  const b = browser(h);
  b.context.jsListingsRevisionV682 = base;
  await b.context.refreshListingsWhenChangedV682();
  assert.equal(b.counts.full, 1);
  for (let i = 0; i < 31; i++) await b.context.refreshListingsWhenChangedV682();
  assert.equal(b.counts.full, 1, "unchanged polling must not repeatedly download all listings");
  assert.equal(b.counts.delta, 0);
});

test("small intervening changes accumulate into one bounded delta", async () => {
  const h = harness();
  await h.write({ changeIds: ["BASE"] });
  const base = (await h.read()).revision;
  await h.write({ changeIds: ["A", "B"] });
  await h.write({ changeIds: ["B", "C"] });
  const result = await h.read(base);
  assert.equal(result.fullReload, false);
  assert.deepEqual(Array.from(result.changeIds), ["A", "B", "C"]);
  const before = { ...h.counts };
  const same = await h.read(result.revision);
  assert.equal(same.fullReload, false);
  assert.equal(same.changeIds.length, 0);
  assert.equal(h.counts.reads - before.reads, 1);
  assert.equal(h.counts.d1, 0);
});

test("concurrent conditional journal writes retain both changes", async () => {
  const h = harness();
  await h.write({ changeIds: ["BASE"] });
  const base = (await h.read()).revision;
  await Promise.all([h.write({ changeIds: ["A"] }), h.write({ changeIds: ["B"] })]);
  assert.deepEqual(Array.from((await h.read(base)).changeIds).sort(), ["A", "B"]);
});

test("unknown/pruned baselines and large deltas request a full refresh", async () => {
  const h = harness();
  await h.write({ changeIds: ["BASE"] });
  const base = (await h.read()).revision;
  for (let i = 0; i < 70; i++) await h.write({ changeIds: [`ID-${i}`] });
  assert.equal((await h.read(base)).fullReload, true);
  assert.equal((await h.read("unknown")).fullReload, true);
  assert.equal(JSON.parse(h.store.get("listings").body).history.length, 64);
  const recent = JSON.parse(h.store.get("listings").body).history[0].revision;
  assert.equal((await h.read(recent)).fullReload, true, "more than 50 IDs must never be truncated into a partial delta");
});

test("conditional-write exhaustion falls back to an explicit full-refresh event", async () => {
  const h = harness(), put = h.env.MEDIA.put;
  let attempts = 0;
  h.env.MEDIA.put = async (...args) => {
    if (args[2]?.onlyIf) { attempts++; return null; }
    return put(...args);
  };
  await h.write({ changeIds: ["A"] });
  assert.equal(attempts, 8);
  assert.equal((await h.read()).fullReload, true);
});

test("old memory CSV carries its own revision and catches up on the first check", async () => {
  const h = harness();
  await h.write({ changeIds: ["BASE"] });
  const base = (await h.read()).revision;
  h.context.sheetCache = { body: "OLD", revision: base, fetchedAt: Date.now(), key: "sheet", etag: "old" };
  await h.write({ fullReload: true });
  const response = await h.context.handleSheet(new Request("http://local/api/sheet"), h.env, null);
  assert.equal(await response.text(), "OLD");
  assert.equal(response.headers.get("x-js-listings-revision"), base);
  const b = browser(h);
  b.context.jsListingsRevisionV682 = base;
  await b.context.rememberListingsRevisionV682();
  assert.equal(b.counts.full, 1);
});

test("a transient journal read failure still publishes a conservative refresh event", async () => {
  const h = harness(), get = h.env.MEDIA.get;
  h.env.MEDIA.get = async () => { throw new Error("temporary read failure"); };
  await h.write({ changeIds: ["A"] });
  h.env.MEDIA.get = get;
  assert.equal((await h.read()).fullReload, true);
});

test("CSV query captures baseline before concurrent mutation and preserves it in R2 metadata", async () => {
  const h = harness();
  await h.write({ changeIds: ["BASE"] });
  const base = (await h.read()).revision;
  h.context.buildD1SheetCsv = async () => { await h.write({ fullReload: true }); return "OLD-SNAPSHOT"; };
  const pending = [];
  const response = await h.context.handleSheet(new Request("http://local/api/sheet", {
    headers: { "x-js-force-refresh": "1" }
  }), h.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(response.headers.get("x-js-listings-revision"), base);
  assert.equal(h.store.get("sheet").customMetadata.revision, base);
  assert.notEqual((await h.read()).revision, base);
});

test("legacy CSV cache without a snapshot revision is rebuilt once", async () => {
  const h = harness();
  await h.env.MEDIA.put("sheet", "OLD", { customMetadata: { savedAt: String(Date.now()) } });
  const request = new Request("http://local/api/sheet");
  const response = await h.context.handleSheet(request, h.env, null);
  assert.equal(await response.text(), "NEW");
  assert.equal(response.headers.get("x-js-listings-revision"), "0");
  await h.context.handleSheet(request, h.env, null);
  assert.equal(h.counts.d1, 1);
});

test("failed refresh cannot advance baseline; successful refresh owns its baseline", async () => {
  const h = harness();
  await h.write({ fullReload: true });
  const b = browser(h);
  b.context.jsListingsRevisionV682 = "OLD";
  b.context.loadSheet = async () => false;
  await b.context.refreshListingsWhenChangedV682();
  assert.equal(b.context.jsListingsRevisionV682, "OLD");
  b.context.loadSheet = async () => { b.context.jsListingsRevisionV682 = "SNAPSHOT-DURING-REFRESH"; return true; };
  await b.context.refreshListingsWhenChangedV682();
  assert.equal(b.context.jsListingsRevisionV682, "SNAPSHOT-DURING-REFRESH");
});

test("snapshot access reuses initial warmup and keeps text compatibility", async () => {
  let reads = 0;
  const window = { fetch: async () => { reads++; return new Response("csv", { headers: { "x-js-listings-revision": "R1" } }); } };
  vm.runInNewContext(access, { window, URLSearchParams });
  window.JSDataAccessV6.warmInitialData();
  const result = await window.JSDataAccessV6.listingsSnapshot(false);
  assert.equal(result.body, "csv");
  assert.equal(result.revision, "R1");
  assert.equal(reads, 2, "one CSV and one unified warmup, not a duplicate CSV");
  assert.equal(await window.JSDataAccessV6.listingsCsv(true), "csv");
});

test("forced unified refresh bypasses a stale warmup and exposes matching revision", async () => {
  const requests = [];
  const window = { fetch: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ ok: true, groups: {} }), { headers: {
      "x-js-listings-revision": options.headers?.["X-JS-Force-Refresh"] ? "NEW" : "OLD"
    } });
  } };
  vm.runInNewContext(access, { window, URLSearchParams });
  window.JSDataAccessV6.warmInitialData();
  const result = await window.JSDataAccessV6.read("unifiedListings", {}, {
    headers: { "X-JS-Force-Refresh": "1" }, cache: "reload"
  });
  assert.equal(result.snapshotRevision, "NEW");
  assert.equal(requests.length, 3);
});

test("mixed CSV and original-summary snapshots never become a latest baseline", () => {
  const context = vm.createContext({});
  vm.runInContext(fn(map, "matchingListingSnapshotRevisionV1"), context);
  const match = context.matchingListingSnapshotRevisionV1;
  assert.equal(match({ revision: "R1" }, { snapshotRevision: "R1" }), "R1");
  assert.equal(match({ revision: "NEW" }, { snapshotRevision: "OLD" }), "");
  assert.equal(match({ revision: "R1" }, { snapshotRevision: "R1", ok: false }), "");
  assert.equal(match({ revision: "R1" }, {}), "");
});
