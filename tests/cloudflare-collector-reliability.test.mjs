import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi, runCollectorMaintenance } from "../cloudflare/src/collector-api.js";

function testDatabase(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE collector_sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, owner_email TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'running', totals_json TEXT NOT NULL DEFAULT '{}',
      error_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, job_type TEXT NOT NULL, owner_email TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'pending', priority INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}', progress_json TEXT NOT NULL DEFAULT '{}',
      attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, leased_until TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE mutation_results (
      request_id TEXT PRIMARY KEY, owner_email TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'completed', result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL DEFAULT ''
    );
  `);
  t.after(() => sqlite.close());
  const prepare = (sql, args = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_match, number) => {
      indexes.push(Number(number) - 1);
      return "?";
    });
    const parameters = () => indexes.length ? indexes.map((index) => args[index]) : args;
    return {
      bind(...values) { return prepare(sql, values); },
      async first() { return sqlite.prepare(compiled).get(...parameters()) || null; },
      async all() { return { results: sqlite.prepare(compiled).all(...parameters()) }; },
      async run() {
        const result = sqlite.prepare(compiled).run(...parameters());
        return { meta: { changes: Number(result.changes) } };
      }
    };
  };
  return {
    sqlite,
    env: {
      COLLECTOR_ACCESS_KEY: "test-key",
      DB: {
        prepare,
        async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
      }
    }
  };
}

function collectorRequest(body, options = {}) {
  return new Request("https://js-map.com/api/collector", {
    method: "POST",
    headers: {
      origin: "https://fin.land.naver.com",
      "content-type": "text/plain;charset=utf-8",
      ...(options.headers || {})
    },
    body: typeof body === "string" ? body : JSON.stringify({ collectorKey: "test-key", ...body })
  });
}

test("collector rejects declared and actual oversized bodies before authentication or JSON parsing", async (t) => {
  const { env } = testDatabase(t);
  env.COLLECTOR_MAX_BODY_BYTES = "65536";
  const declared = await handleCollectorApi(collectorRequest("{}", {
    headers: { "content-length": "65537" }
  }), env);
  assert.equal(declared.status, 413);

  const multibyte = JSON.stringify({ action: "saveNaverBatch", collectorKey: "wrong", padding: "가".repeat(24_000) });
  assert.ok(multibyte.length < 65536);
  const actual = await handleCollectorApi(collectorRequest(multibyte), env);
  assert.equal(actual.status, 413);
  assert.match((await actual.json()).message, /요청 크기/);
});

test("collector mutation status is owner/action scoped and offers a key-safe POST path", async (t) => {
  const { sqlite, env } = testDatabase(t);
  sqlite.prepare(`INSERT INTO mutation_results
    (request_id,owner_email,action,state,result_json,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?)`).run(
      "shared-id", "collector", "saveNaverBatch", "completed", '{"ok":true,"saved":3}',
      "2026-09-10T00:00:00.000Z", "2099-01-01T00:00:00.000Z"
    );

  const matching = await handleCollectorApi(collectorRequest({
    action: "mutationStatus", targetAction: "saveNaverBatch", requestId: "shared-id"
  }), env);
  assert.equal(matching.status, 200);
  assert.deepEqual(await matching.json(), {
    ok: true, ready: true, requestId: "shared-id", mutationAction: "saveNaverBatch",
    result: { ok: true, saved: 3 }
  });

  const mismatched = await handleCollectorApi(collectorRequest({
    action: "mutationStatus", targetAction: "gongsilImportBatch", requestId: "shared-id"
  }), env);
  assert.equal((await mismatched.json()).ready, false);

  const collision = await handleCollectorApi(collectorRequest({
    action: "gongsilImportBatch", requestId: "shared-id", records: []
  }), env);
  assert.equal(collision.status, 409);

  const legacyUrl = new URL("https://js-map.com/api/collector");
  legacyUrl.searchParams.set("action", "mutationStatus");
  legacyUrl.searchParams.set("requestId", "shared-id");
  legacyUrl.searchParams.set("collectorKey", "test-key");
  const legacy = await handleCollectorApi(new Request(legacyUrl), env);
  const legacyPayload = await legacy.json();
  assert.equal(legacyPayload.ready, true);
  assert.equal(legacyPayload.legacyActionScope, true);
});

test("scheduled collector maintenance abandons stale sessions, fails stale jobs and deletes expired results", async (t) => {
  const { sqlite, env } = testDatabase(t);
  const session = sqlite.prepare(`INSERT INTO collector_sessions
    (id,source,state,totals_json,error_json,started_at,finished_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
  session.run("old", "네이버", "running", "{}", '{"kept":true}', "2026-09-10T07:00:00.000Z", "", "2026-09-10T07:59:00.000Z");
  session.run("fresh", "네이버", "running", "{}", "{}", "2026-09-10T09:00:00.000Z", "", "2026-09-10T09:30:00.000Z");
  session.run("stuck-finalize", "공실박스", "finalizing", "{}", "{}", "2026-09-10T07:00:00.000Z", "", "2026-09-10T07:30:00.000Z");
  session.run("done", "당근", "completed", "{}", "{}", "2026-09-01T00:00:00.000Z", "2026-09-01T01:00:00.000Z", "2026-09-01T01:00:00.000Z");
  const job = sqlite.prepare(`INSERT INTO jobs
    (id,job_type,state,payload_json,progress_json,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
  job.run("collector-daangn-old", "daangn-collector", "running", "{}", "{}",
    "2026-09-10T07:00:00.000Z", "2026-09-10T07:00:00.000Z", "2026-09-10T07:59:00.000Z");
  job.run("collector-daangn-fresh", "daangn-collector", "running", "{}", "{}",
    "2026-09-10T09:00:00.000Z", "2026-09-10T09:00:00.000Z", "2026-09-10T09:30:00.000Z");
  const mutation = sqlite.prepare(`INSERT INTO mutation_results
    (request_id,owner_email,action,state,result_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?)`);
  mutation.run("expired", "collector", "saveNaverBatch", "completed", "{}",
    "2026-09-01T00:00:00.000Z", "2026-09-09T00:00:00.000Z");
  mutation.run("future", "collector", "saveNaverBatch", "completed", "{}",
    "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z");

  const result = await runCollectorMaintenance(env, {
    now: "2026-09-10T10:00:00.000Z", staleMinutes: 120
  });
  assert.deepEqual(result, {
    ok: true, staleMinutes: 120, abandonedSessions: 2, failedJobs: 1, expiredMutationsDeleted: 1
  });
  assert.equal(sqlite.prepare("SELECT state FROM collector_sessions WHERE id='old'").get().state, "abandoned");
  assert.equal(sqlite.prepare("SELECT state FROM collector_sessions WHERE id='fresh'").get().state, "running");
  assert.equal(sqlite.prepare("SELECT state FROM collector_sessions WHERE id='stuck-finalize'").get().state, "abandoned");
  const errors = JSON.parse(sqlite.prepare("SELECT error_json FROM collector_sessions WHERE id='old'").get().error_json);
  assert.equal(errors.kept, true);
  assert.equal(errors.lastFailure.type, "stale-session");
  assert.equal(sqlite.prepare("SELECT state FROM jobs WHERE id='collector-daangn-old'").get().state, "failed");
  assert.deepEqual(sqlite.prepare("SELECT request_id FROM mutation_results ORDER BY request_id").all()
    .map((row) => row.request_id), ["future"]);
});

test("session finalization is claimed once and later request IDs replay the stored result", async (t) => {
  const { sqlite, env } = testDatabase(t);
  const first = await handleCollectorApi(collectorRequest({
    action: "finalizeCollectionSession", requestId: "finalize-1", source: "네이버",
    sessionId: "session-once", complete: false, collectorVersion: "test"
  }), env);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).state, "partial");

  const second = await handleCollectorApi(collectorRequest({
    action: "finalizeCollectionSession", requestId: "finalize-2", source: "네이버",
    sessionId: "session-once", complete: false, collectorVersion: "test"
  }), env);
  assert.equal(second.status, 200);
  const replay = await second.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.state, "partial");
  const totals = JSON.parse(sqlite.prepare("SELECT totals_json FROM collector_sessions WHERE id='session-once'").get().totals_json);
  assert.equal(totals.finalizationResult.state, "partial");
});

test("a Daangn provider failure closes both job and session and the checkpoint can resume", async (t) => {
  const { sqlite, env } = testDatabase(t);
  const url = new URL("https://realty.daangn.com/?cluster_id=REGION1154&js_district=유성구");
  url.searchParams.set("af", JSON.stringify({ tradeTypes: ["MONTH"], salesTypes: ["STORE"] }));
  const start = await handleCollectorApi(collectorRequest({
    action: "danggeunStartJob", requestId: "start-1", clientId: "reliability-test",
    url: url.toString(), tradeType: "lease", collectorVersion: "test"
  }), env);
  assert.equal(start.status, 200);
  const sessionId = (await start.json()).job.sessionId;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"errors":[{"message":"Forbidden"}]}', {
    status: 403, headers: { "content-type": "application/json" }
  });
  try {
    const failed = await handleCollectorApi(collectorRequest({
      action: "danggeunRunJobChunk", requestId: "chunk-1", clientId: "reliability-test",
      tradeType: "lease"
    }), env);
    assert.equal(failed.status, 400);
    assert.match((await failed.json()).message, /HTTP 오류: 403/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const failedJob = sqlite.prepare("SELECT state,last_error,progress_json FROM jobs WHERE id='collector-daangn-reliability-test'").get();
  assert.equal(failedJob.state, "failed");
  assert.match(failedJob.last_error, /HTTP 오류: 403/);
  assert.equal(JSON.parse(failedJob.progress_json).failureCount, 1);
  assert.equal(sqlite.prepare("SELECT state FROM collector_sessions WHERE id=?").get(sessionId).state, "failed");
  const failure = JSON.parse(sqlite.prepare("SELECT error_json FROM collector_sessions WHERE id=?").get(sessionId).error_json);
  assert.equal(failure.lastFailure.type, "daangn-job-error");

  const resumed = await handleCollectorApi(collectorRequest({
    action: "danggeunResumeJob", requestId: "resume-1", clientId: "reliability-test",
    tradeType: "lease"
  }), env);
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).job.status, "running");
  assert.match(sqlite.prepare("SELECT last_error FROM jobs WHERE id='collector-daangn-reliability-test'").get().last_error,
    /HTTP 오류: 403/);
  assert.equal(sqlite.prepare("SELECT state FROM collector_sessions WHERE id=?").get(sessionId).state, "running");
});
