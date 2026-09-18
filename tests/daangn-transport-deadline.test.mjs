import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const client = readFileSync(new URL("../js/daangn-collector.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");

function extract(source, names, context = {}, indent = "  ") {
  const code = names.map(name => {
    const match = source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?^${indent}}`, "m"));
    assert.ok(match, `missing function ${name}`);
    return match[0];
  }).join("\n");
  vm.runInNewContext(code + "\nthis.api = {" + names.join(",") + "};", context);
  return context.api;
}

function constant(source, name) {
  const value = source.match(new RegExp(`(?:var|const) ${name} = ([\\w]+);`));
  assert.ok(value, name);
  return /^\d/.test(value[1]) ? Number(value[1].replaceAll("_", "")) : constant(source, value[1]);
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function clock() {
  let now = 1000;
  let sequence = 0;
  const timers = new Map();
  return {
    timers,
    Date: { now: () => now },
    setTimeout(callback, ms) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + ms, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      now += ms;
      const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        if (timers.delete(id)) timer.callback();
      }
      await flush();
    }
  };
}

const jobResult = () => ({ ok: true, sourceBackend: "D1", job: { status: "running", processed: 8 } });
const response = (payload, extra = {}) => ({ ok: true, type: "cors", json: async () => payload, ...extra });

function collector(fetcher) {
  const time = clock();
  const calls = [];
  const api = extract(client, ["callServer", "postServerWithRetry", "fetchMutationStatus", "pollMutationStatus", "isUnauthorizedError"], {
    AbortController, Object, Array, Date: time.Date, window: time,
    setTimeout: time.setTimeout,
    COLLECTOR_API_URL: "https://js-map.com/api/collector", VERSION: "1.5.6",
    COLLECTOR_POST_TIMEOUT_MS: constant(client, "COLLECTOR_POST_TIMEOUT_MS"),
    MUTATION_STATUS_TIMEOUT_MS: constant(client, "MUTATION_STATUS_TIMEOUT_MS"),
    state: { selectedUrl: "https://realty.daangn.com/", tradeType: "lease" },
    getCollectorKey: () => "test-private-key", getScopedClientId: () => "test-client",
    setStatus() {}, clearCollectorKey() { throw new Error("unexpected auth retry"); },
    nativeFetch: async (url, options) => {
      const call = { url, options, body: JSON.parse(options.body) };
      calls.push(call);
      return fetcher(call, calls.length);
    }
  });
  return { api, calls, time };
}

test("completed Daangn POST is consumed directly without polling or a polling timer", async () => {
  const expected = jobResult();
  const h = collector(() => response(expected));
  assert.deepEqual(await h.api.callServer("danggeunRunJobChunk", {}), expected);
  assert.equal(h.calls.length, 1);
  assert.equal(h.time.timers.size, 0);
  const { url, options, body } = h.calls[0];
  assert.equal(url, "https://js-map.com/api/collector");
  assert.equal(options.mode, "cors");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(body.collectorKey, "test-private-key");
  assert.ok(!url.includes(body.collectorKey));
});

test("an in-flight chunk longer than the former 15s timeout is not aborted or replayed", async () => {
  let finish;
  const slow = new Promise(resolve => { finish = resolve; });
  const expected = jobResult();
  const h = collector(() => slow);
  const pending = h.api.callServer("danggeunRunJobChunk", {});
  await flush();
  await h.time.advance(20000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.signal.aborted, false);
  finish(response(expected));
  assert.deepEqual(await pending, expected);
  assert.equal(h.calls.length, 1);
  assert.equal(h.time.timers.size, 0);
});

for (const kind of ["opaque", "malformed", "unrecognized", "lost response"]) {
  test(`${kind} response recovers the same stored result without replaying the mutation`, async () => {
    const expected = jobResult();
    const h = collector(({ body }) => {
      if (body.action === "mutationStatus") return response({ ready: true, result: expected });
      if (kind === "lost response") throw new TypeError("Failed to fetch");
      if (kind === "opaque") return response(null, { type: "opaque", ok: false, json: () => assert.fail("opaque body read") });
      if (kind === "malformed") return response(null, { json: async () => { throw new SyntaxError("invalid JSON"); } });
      return response({ ok: true });
    });
    const result = h.api.callServer("danggeunRunJobChunk", {});
    await flush();
    assert.equal(h.calls.length, 1);
    await h.time.advance(900);
    assert.deepEqual(await result, expected);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].body.action, "mutationStatus");
    assert.equal(h.calls[1].body.requestId, h.calls[0].body.requestId);
    assert.equal(h.calls[1].body.targetAction, h.calls[0].body.action);
  });
}

test("not-ready status after a lost POST never replays the mutation and expires by elapsed time", async () => {
  const h = collector(({ body }) => {
    if (body.action !== "mutationStatus") throw new TypeError("Failed to fetch");
    return response({ ready: false });
  });
  const result = h.api.callServer("danggeunRunJobChunk", {});
  const rejected = assert.rejects(result, /결과 확인 시간 초과/);
  await flush();
  await h.time.advance(300);
  await h.time.advance(900);
  assert.equal(h.calls.filter(call => call.body.action === "danggeunRunJobChunk").length, 1);
  const countBeforeExpiry = h.calls.length;
  await h.time.advance(constant(client, "MUTATION_STATUS_TIMEOUT_MS"));
  await rejected;
  assert.equal(h.calls.length, countBeforeExpiry, "a late timer must not issue another status request");
});

test("server-declared mutation errors are surfaced immediately without polling or reposting", async () => {
  const h = collector(() => response({ ok: false, message: "당근 API HTTP 오류: 403" }, { ok: false }));
  await assert.rejects(h.api.callServer("danggeunRunJobChunk", {}), /HTTP 오류: 403/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.time.timers.size, 0);
});

function provider(fetcher, extra = {}) {
  const time = clock();
  const api = extract(server, ["daangnGraphql"], {
    AbortController, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    DAANGN_REQUEST_TIMEOUT_MS: constant(server, "DAANGN_REQUEST_TIMEOUT_MS"),
    DAANGN_GRAPHQL_URL: "https://provider.invalid/graphql", fetch: fetcher, ...extra
  }, "");
  return { api, time };
}

for (const stalledStage of ["headers", "body"]) {
  test(`Daangn provider deadline aborts a stalled ${stalledStage} download`, async () => {
    let signal;
    const h = provider(async (_url, options) => {
      signal = options.signal;
      const stall = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      return stalledStage === "headers" ? stall() : { ok: true, json: stall };
    });
    const pending = h.api.daangnGraphql("test-hash", { articleId: "123" });
    const rejected = assert.rejects(pending, /당근 API 응답 시간 초과 \(10초\)/);
    await flush();
    assert.equal(signal.aborted, false);
    await h.time.advance(constant(server, "DAANGN_REQUEST_TIMEOUT_MS"));
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(h.time.timers.size, 0);
  });
}

test("provider success clears deadline, preserves the list/detail GraphQL request", async () => {
  const calls = [];
  const payload = { data: { valid: true } };
  const h = provider(async (url, options) => { calls.push({ url, ...options }); return response(payload); });
  for (const variables of [{ first: 100, after: null }, { articleId: "123" }]) {
    assert.deepEqual(await h.api.daangnGraphql("test-hash", variables), payload);
    const sent = JSON.parse(calls.at(-1).body);
    assert.deepEqual(sent.variables, variables);
    assert.equal(sent.extensions.persistedQuery.sha256Hash, "test-hash");
    assert.equal(h.time.timers.size, 0);
  }
});

test("provider auth/schema errors stop detail retries; rate limits retain bounded transient retries", async () => {
  for (const sample of [
    { status: 401 }, { status: 403 },
    { errors: [{ message: "operation unavailable", extensions: { code: "PERSISTED_QUERY_NOT_FOUND" } }] },
    { errors: [{ message: "Cannot query field originalId" }] },
    { errors: [{ message: "invalid", extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] },
    { status: 429 }
  ]) {
    let requests = 0;
    const h = provider(async () => {
      requests += 1;
      return response(sample, { ok: !sample.status, status: sample.status });
    });
    const delays = [];
    const api = extract(server, ["fetchDaangnDetail"], {
      DAANGN_DETAIL_HASH: "detail", daangnGraphql: h.api.daangnGraphql,
      clean: value => String(value || "").trim(), sleep: async ms => { delays.push(ms); }
    }, "");
    if (sample.status === 429) {
      const result = await api.fetchDaangnDetail("123");
      assert.equal(result.article, null);
      assert.equal(result.attempts, 3);
      assert.equal(requests, 3);
      assert.deepEqual(delays, [450, 1800]);
    } else {
      await assert.rejects(api.fetchDaangnDetail("123"), error => error.stopCollection === true);
      assert.equal(requests, 1);
      assert.deepEqual(delays, []);
    }
  }
});

test("a provider stop prevents workers from launching remaining queued details", async () => {
  const calls = [];
  let releaseSecond;
  const second = new Promise(resolve => { releaseSecond = resolve; });
  const api = extract(server, ["mapWithConcurrency"], { sleep: async () => {} }, "");
  const stopped = Object.assign(new Error("auth stop"), { stopCollection: true });
  await assert.rejects(api.mapWithConcurrency([1, 2, 3, 4], 2, async id => {
    calls.push(id);
    if (id === 1) throw stopped;
    await second;
    return id;
  }), /auth stop/);
  releaseSecond();
  await flush();
  assert.deepEqual(calls, [1, 2]);
});

test("client deadline accommodates the unchanged maximum serial detail retry budget", () => {
  const providerBudget = constant(server, "DAANGN_REQUEST_TIMEOUT_MS");
  const maximumSerialChunk = 8 * (3 * providerBudget + 450 + 1800) + 7 * 100;
  assert.ok(constant(client, "COLLECTOR_POST_TIMEOUT_MS") > maximumSerialChunk + 60_000);
  assert.ok(constant(client, "MUTATION_STATUS_TIMEOUT_MS") >= constant(client, "COLLECTOR_POST_TIMEOUT_MS"));
  const api = extract(client, ["isProviderStopError"]);
  assert.equal(api.isProviderStopError("당근 API HTTP 오류: 403"), true);
  assert.equal(api.isProviderStopError("당근 API HTTP 오류: 429"), false);
});
