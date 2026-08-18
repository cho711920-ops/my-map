import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync("js/listing-duplicate-cleanup-v1.js", "utf8");
const instrumentedSource = source.replace(
  /\}\)\(\);\s*$/,
  "window.__testRequestDuplicateCleanup = requestDuplicateCleanup;\n})();"
);

function loadModule(options = {}) {
  const fetchCalls = [];
  const fetchImpl = options.fetch || (async (...args) => {
    fetchCalls.push(args);
    throw new Error("unexpected direct fetch");
  });
  const window = {
    JSDataAccessV6: options.dataAccess,
    saveApiURL: options.saveApiURL,
  };
  const document = {
    readyState: "loading",
    addEventListener() {},
  };
  window.window = window;
  window.document = document;

  vm.runInNewContext(instrumentedSource, {
    window,
    document,
    fetch: fetchImpl,
    console,
    Promise,
    Object,
    Error,
    isFinite,
    setTimeout,
  });

  assert.equal(typeof window.__testRequestDuplicateCleanup, "function");
  return { requestCleanup: window.__testRequestDuplicateCleanup, fetchCalls };
}

const cleanupPayload = {
  primaryMasterId: "master-1",
  duplicateMasterIds: ["master-2", "master-3"],
  manualOverride: true,
  manualOverrideReason: "사용자 선택중복 직접 정리",
};

test("duplicate cleanup uses the shared mutation boundary when available", async () => {
  let mutation;
  const expected = { ok: true, consolidated: 2, primaryMasterId: "master-1" };
  const { requestCleanup, fetchCalls } = loadModule({
    dataAccess: {
      mutate(action, payload, options) {
        mutation = { action, payload, options };
        return Promise.resolve(expected);
      },
    },
  });

  const result = await requestCleanup(cleanupPayload);

  assert.equal(result, expected);
  assert.equal(mutation.action, "consolidateExistingMasters");
  assert.deepEqual(JSON.parse(JSON.stringify(mutation.payload)), cleanupPayload);
  assert.equal(mutation.options.errorMessage, "중복정리에 실패했습니다.");
  assert.equal(fetchCalls.length, 0);
});

test("duplicate cleanup retains the direct request fallback", async () => {
  let request;
  const { requestCleanup } = loadModule({
    saveApiURL: "/legacy-save?tenant=js",
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ ok: true, consolidated: 2 }),
      };
    },
  });

  const result = await requestCleanup(cleanupPayload);
  const body = JSON.parse(request.options.body);

  assert.equal(result.consolidated, 2);
  assert.equal(request.url, "/legacy-save?tenant=js");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.cache, "no-store");
  assert.equal(body.action, "consolidateExistingMasters");
  assert.equal(body.primaryMasterId, "master-1");
  assert.deepEqual(body.duplicateMasterIds, ["master-2", "master-3"]);
  assert.equal(body.manualOverride, true);
});

test("shared mutation failures do not retry a destructive cleanup", async () => {
  let fetchCount = 0;
  const { requestCleanup } = loadModule({
    dataAccess: {
      mutate() {
        return Promise.reject(new Error("shared mutation failed"));
      },
    },
    fetch: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });

  await assert.rejects(requestCleanup(cleanupPayload), /shared mutation failed/);
  assert.equal(fetchCount, 0);
});

test("direct fallback surfaces HTTP and API failures", async () => {
  const { requestCleanup } = loadModule({
    fetch: async () => ({
      ok: false,
      json: async () => ({ ok: false, message: "cleanup rejected" }),
    }),
  });

  await assert.rejects(requestCleanup(cleanupPayload), /cleanup rejected/);
});
