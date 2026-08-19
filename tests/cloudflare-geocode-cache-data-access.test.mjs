import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/script.js", import.meta.url), "utf8");
const start = source.indexOf("function scheduleSharedGeocodeFlush(");
const end = source.indexOf("function loadSharedGeocodeCache(", start);

assert.ok(start >= 0 && end > start, "shared geocode persistence block must be extractable");
const geocodePersistenceSource = source.slice(start, end);

function createHarness({ shared = true, sharedResult, sharedError } = {}) {
  const mutateCalls = [];
  const fetchCalls = [];
  const warnings = [];
  const scheduledDelays = [];
  const window = {};

  if (shared) {
    window.JSDataAccessV6 = {
      mutate(action, payload, options) {
        mutateCalls.push({ action, payload, options });
        if (sharedError) return Promise.reject(sharedError);
        return Promise.resolve(sharedResult || { ok: true, persisted: true, saved: payload.entries.length });
      }
    };
  }

  const context = {
    window,
    saveApiURL: "/legacy-data",
    pendingSharedGeocodeEntries: Object.create(null),
    sharedGeocodeCacheReady: true,
    sharedGeocodeFlushInProgress: false,
    sharedGeocodeFlushTimer: null,
    sharedGeocodeFlushFailures: 0,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { ok: true, persisted: true, saved: 1 };
        }
      };
    },
    setTimeout(_callback, delay) {
      scheduledDelays.push(delay);
      return scheduledDelays.length;
    },
    clearTimeout() {},
    console: {
      warn(...args) {
        warnings.push(args);
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(geocodePersistenceSource, context);
  return { context, mutateCalls, fetchCalls, warnings, scheduledDelays };
}

function queueOne(context) {
  context.pendingSharedGeocodeEntries["대전광역시 서구 탄방동 1028"] = {
    address: "대전광역시 서구 탄방동 1028",
    lat: 36.345,
    lng: 127.389
  };
}

test("shared geocode batches persist through JSDataAccessV6", async () => {
  const app = createHarness();
  queueOne(app.context);

  await app.context.flushSharedGeocodeCache();

  assert.equal(app.mutateCalls.length, 1);
  assert.equal(app.mutateCalls[0].action, "saveGeocodeCache");
  assert.deepEqual(
    JSON.parse(JSON.stringify(app.mutateCalls[0].payload.entries)),
    [{ address: "대전광역시 서구 탄방동 1028", lat: 36.345, lng: 127.389 }]
  );
  assert.equal(app.mutateCalls[0].options.errorMessage, "공용 좌표 캐시 저장 실패");
  assert.equal(app.fetchCalls.length, 0);
  assert.equal(Object.keys(app.context.pendingSharedGeocodeEntries).length, 0);
  assert.equal(app.context.sharedGeocodeFlushFailures, 0);
});

test("legacy geocode persistence remains available only when the shared boundary is absent", async () => {
  const app = createHarness({ shared: false });
  queueOne(app.context);

  await app.context.flushSharedGeocodeCache();

  assert.equal(app.mutateCalls.length, 0);
  assert.equal(app.fetchCalls.length, 1);
  assert.equal(app.fetchCalls[0].url, "/legacy-data");
  assert.equal(app.fetchCalls[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(app.fetchCalls[0].options.body), {
    action: "saveGeocodeCache",
    entries: [{ address: "대전광역시 서구 탄방동 1028", lat: 36.345, lng: 127.389 }]
  });
  assert.equal(Object.keys(app.context.pendingSharedGeocodeEntries).length, 0);
});

test("a failed shared mutation stays queued and never falls through to a duplicate direct write", async () => {
  const app = createHarness({ sharedError: new Error("temporary D1 failure") });
  queueOne(app.context);

  await app.context.flushSharedGeocodeCache();

  assert.equal(app.mutateCalls.length, 1);
  assert.equal(app.fetchCalls.length, 0);
  assert.equal(Object.keys(app.context.pendingSharedGeocodeEntries).length, 1);
  assert.equal(app.context.sharedGeocodeFlushFailures, 1);
  assert.deepEqual(app.scheduledDelays, [2400]);
  assert.equal(app.warnings.length, 1);
});
