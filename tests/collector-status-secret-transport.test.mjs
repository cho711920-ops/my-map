import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [daangn, gongsil] = await Promise.all([
  readFile(new URL("../js/daangn-collector.js", import.meta.url), "utf8"),
  readFile(new URL("../js/gongsil-collector.js", import.meta.url), "utf8")
]);

function statusTransport(source) {
  const start = source.indexOf("async function fetchMutationStatus(");
  const end = source.indexOf("\n  function pollMutationStatus(", start);
  assert.ok(start >= 0 && end > start, "상태 조회 전송 함수를 찾을 수 있어야 합니다.");
  return source.slice(start, end);
}

function buildStatusFetcher(source, fetchBinding, calls) {
  const factory = new Function("fakeFetch", `
    var COLLECTOR_API_URL = "https://js-map.com/api/collector";
    var VERSION = "test-version";
    var ${fetchBinding} = fakeFetch;
    var window = {
      setTimeout: function () { return 1; },
      clearTimeout: function () {}
    };
    function AbortController() {
      this.signal = {testSignal: true};
      this.abort = function () {};
    }
    ${statusTransport(source)}
    return fetchMutationStatus;
  `);
  return factory(async (url, options) => {
    calls.push({url, options});
    return {
      ok: true,
      status: 200,
      json: async () => ({ready: false})
    };
  });
}

test("collector mutation status secrets are sent only in guarded CORS POST bodies", () => {
  for (const source of [daangn, gongsil]) {
    const transport = statusTransport(source);
    assert.match(transport, /method: "POST"/);
    assert.match(transport, /mode: "cors"/);
    assert.match(transport, /credentials: "omit"/);
    assert.match(transport, /redirect: "error"/);
    assert.match(transport, /referrerPolicy: "no-referrer"/);
    assert.match(transport, /action: "mutationStatus"/);
    assert.match(transport, /targetAction: targetAction/);
    assert.match(transport, /collectorKey: collectorKey/);
    assert.doesNotMatch(source, /[?&]collectorKey=/);
    assert.doesNotMatch(source, /callback=.*collectorKey|collectorKey=.*callback/);
    assert.doesNotMatch(source, /createElement\("script"\)[\s\S]{0,1200}mutationStatus/);
  }
});

test("status transports keep the collector key out of the actual request URL", async () => {
  for (const [source, fetchBinding] of [
    [daangn, "nativeFetch"],
    [gongsil, "originalFetch"]
  ]) {
    const calls = [];
    const fetchStatus = buildStatusFetcher(source, fetchBinding, calls);
    await fetchStatus("request/id?visible", "private key +/?", "gongsilImportBatch");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://js-map.com/api/collector");
    assert.ok(!calls[0].url.includes("private"));
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body, {
      action: "mutationStatus",
      targetAction: "gongsilImportBatch",
      requestId: "request/id?visible",
      collectorKey: "private key +/?",
      collectorVersion: "test-version"
    });
  }
});

test("Daangn scopes each status lookup to its original mutation action", () => {
  assert.match(daangn, /pollMutationStatus\(requestId, collectorKey, action\)/);
  assert.match(
    daangn,
    /pollMutationStatus\(\s*body\.requestId,\s*collectorKey,\s*body\.action,\s*\{maxAttempts:/
  );
});

test("Gongsil scopes manifest, batch, and finalization lookups independently", () => {
  assert.match(
    gongsil,
    /pollMutationStatus\(\s*requestId,\s*collectorKey,\s*"classifySourceManifest"\s*\)/
  );
  assert.match(
    gongsil,
    /pollMutationStatus\(\s*requestId,\s*collectorKey,\s*"gongsilImportBatch"\s*\)/
  );
  assert.match(
    gongsil,
    /pollMutationStatus\(\s*requestId,\s*collectorKey,\s*"finalizeCollectionSession"\s*\)/
  );
});
