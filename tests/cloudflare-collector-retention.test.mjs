import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { collectorRetentionPolicy, planCollectorRetention, runCollectorRetention,
  runScheduledCollectorRetention } from "../cloudflare/src/collector-retention.js";
import { bindPreviewSql } from "../tools/preview-collector-retention.mjs";

const NOW = "2026-09-14T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const FRESH = "2026-09-01T00:00:00.000Z";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE collector_sessions (id TEXT PRIMARY KEY,source TEXT,owner_email TEXT DEFAULT '',
      state TEXT DEFAULT 'completed',totals_json TEXT DEFAULT '{}',error_json TEXT DEFAULT '{}',
      started_at TEXT,finished_at TEXT,updated_at TEXT);
    CREATE TABLE collector_raw (id TEXT PRIMARY KEY, session_id TEXT REFERENCES collector_sessions(id) ON DELETE CASCADE,
      source TEXT DEFAULT '네이버',source_listing_id TEXT,snapshot_hash TEXT DEFAULT '',payload_json TEXT,
      processing_state TEXT DEFAULT 'processed',result_json TEXT DEFAULT '{}',error_text TEXT DEFAULT '',
      created_at TEXT,processed_at TEXT,legacy_original_id TEXT DEFAULT '',trade_type TEXT DEFAULT 'lease',
      sale_category TEXT DEFAULT '',sale_price REAL);
    CREATE TABLE listing_sources (id TEXT PRIMARY KEY,listing_id TEXT,source TEXT,source_listing_id TEXT,session_id TEXT DEFAULT '');
    CREATE TABLE jobs (id TEXT PRIMARY KEY,state TEXT,payload_json TEXT DEFAULT '{}',progress_json TEXT DEFAULT '{}');
    CREATE TABLE listing_data_quality_holds (listing_id TEXT,source_id TEXT,state TEXT,evidence_json TEXT DEFAULT '{}');
    CREATE INDEX idx_raw_provider ON collector_raw(source,source_listing_id,created_at DESC);
  `);
  sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0021_collector_retention.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  const prepare = (sql, values = []) => {
    const indexes = [];
    const query = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return {
      bind(...bindings) { return prepare(sql, bindings); },
      async all() { return { results: sqlite.prepare(query).all(...args()) }; },
      async first() { return sqlite.prepare(query).get(...args()) || null; },
      async run() { return { meta: { changes: Number(sqlite.prepare(query).run(...args()).changes) } }; }
    };
  };
  const archives = new Map();
  const env = {
    DB: { prepare, async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = await Promise.all(statements.map(s => s.run())); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    } },
    MEDIA: {
      async put(key, body) { archives.set(key, body); },
      async get(key) { return archives.has(key) ? { async text() { return archives.get(key); } } : null; }
    }
  };
  const session = (id, state = "completed", at = OLD, scope = "") => sqlite.prepare(`INSERT INTO collector_sessions
    (id,source,state,totals_json,started_at,finished_at,updated_at) VALUES (?,'네이버',?,?,?,?,?)`)
    .run(id, state, JSON.stringify({ scope }), at, state === "running" ? "" : at, at);
  const raw = (id, sourceId = "100", options = {}) => sqlite.prepare(`INSERT INTO collector_raw
    (id,session_id,source_listing_id,payload_json,processing_state,result_json,created_at,processed_at,legacy_original_id,trade_type)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, options.session || "old", sourceId,
      options.payload ?? JSON.stringify({ sourceId, raw: { phone: "test-only", floor: 2 } }),
      options.state || "processed", JSON.stringify(options.result || {}), options.at || OLD,
      options.processedAt || options.at || OLD, options.legacy || "", options.trade || "lease");
  session("old"); session("fresh", "completed", FRESH);
  return { env, sqlite, archives, session, raw };
}

test("retention defaults to dry-run with conservative bounded policy", () => {
  assert.equal(collectorRetentionPolicy({}, { now: NOW }).mode, "dry-run");
  const policy = collectorRetentionPolicy({ COLLECTOR_RETENTION_RAW_DAYS: "-1", COLLECTOR_RETENTION_SESSION_DAYS: "1",
    COLLECTOR_RETENTION_BATCH_LIMIT: "9999", COLLECTOR_RETENTION_MODE: "archive" }, { now: NOW, dryRun: true });
  assert.equal(policy.mode, "dry-run"); assert.equal(policy.rawDays, 90);
  assert.equal(policy.sessionDays, 180); assert.equal(policy.batchLimit, 100);
  assert.throws(() => collectorRetentionPolicy({}, { now: "invalid" }), /Invalid/);
});

test("dry-run reports superseded old rows but never writes R2 or deletes D1", async (t) => {
  const { env, sqlite, archives, raw } = fixture(t);
  raw("first"); raw("latest", "100", { session: "fresh", at: FRESH });
  const report = await runCollectorRetention(env, { now: NOW });
  assert.deepEqual(report.eligible, { raw: 1, sessions: 0 });
  assert.deepEqual(report.deleted, { raw: 0, sessions: 0 });
  assert.equal(archives.size, 0); assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM collector_raw").get().n, 2);
});

test("archive is read back and verified before pruning only superseded rows", async (t) => {
  const { env, sqlite, archives, raw, session } = fixture(t);
  raw("first"); raw("latest", "100", { session: "fresh", at: FRESH });
  session("empty-old");
  env.COLLECTOR_RETENTION_MODE = "archive";
  const report = await runCollectorRetention(env, { now: NOW });
  assert.deepEqual(report.deleted, { raw: 1, sessions: 1 });
  assert.match(report.archiveKey, /^collector-retention\/2026-09-14\/.+\.json$/);
  const backup = JSON.parse(archives.get(report.archiveKey));
  assert.equal(backup.tables.collector_raw[0].id, "first");
  assert.equal(backup.tables.collector_sessions[0].id, "empty-old");
  assert.equal(report.archiveSha256.length, 64);
  assert.deepEqual(sqlite.prepare("SELECT id FROM collector_raw").all().map(row => row.id), ["latest"]);
  assert.ok(sqlite.prepare("SELECT id FROM collector_sessions WHERE id='old'").get(), "no cascading deletion of unplanned rows");
});

test("unresolved, legacy, recent, active-session and last full payload evidence survives", async (t) => {
  const { env, sqlite, raw, session } = fixture(t);
  const protectedStates = ["pending", "review", "held", "error"];
  for (const state of protectedStates) {
    raw(`old-${state}`, state); raw(`latest-${state}`, state, { at: FRESH }); raw(`unresolved-${state}`, state, { state });
  }
  raw("legacy", "legacy", { legacy: "original-12" }); raw("latest-legacy", "legacy", { at: FRESH });
  raw("recent", "recent", { at: FRESH }); raw("newest-recent", "recent", { at: NOW });
  raw("last-full", "compact"); raw("new-compact", "compact", { at: FRESH, state: "duplicate", payload: "{}" });
  session("running", "running"); raw("running-raw", "active", { session: "running" }); raw("active-new", "active", { at: FRESH });
  raw("last-lease", "two-markets"); raw("new-sale", "two-markets", { at: FRESH, trade: "sale" });
  raw("recently-processed", "processed", { processedAt: FRESH }); raw("new-processed", "processed", { at: FRESH });
  env.COLLECTOR_RETENTION_MODE = "archive";
  const before = sqlite.prepare("SELECT COUNT(*) n FROM collector_raw").get().n;
  const result = await runCollectorRetention(env, { now: NOW });
  assert.equal(result.eligible.raw, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM collector_raw").get().n, before);
});

test("open data-quality holds protect source-linked and explicit raw/session evidence", async (t) => {
  const { env, raw, sqlite } = fixture(t);
  for (const kind of ["source", "listing", "raw", "session", "candidate", "provider"]) {
    raw(`old-${kind}`, kind, { result: kind === "listing" ? { listingId: "L-listing" }
      : kind === "candidate" ? { candidateIds: ["L-candidate"] } : {} });
    raw(`new-${kind}`, kind, { at: FRESH });
    sqlite.prepare("INSERT INTO listing_data_quality_holds VALUES (?,?,?,?)").run(`L-${kind}`, kind === "source" ? "S-source" : null,
      "open", JSON.stringify(kind === "raw" ? { rawId: "old-raw" } : kind === "session" ? { sessionId: "old" }
        : kind === "provider" ? { sourceId: "provider" } : {}));
  }
  sqlite.exec("INSERT INTO listing_sources(id,listing_id,source,source_listing_id) VALUES ('S-source','L-source','네이버','source')");
  assert.equal((await planCollectorRetention(env, { now: NOW })).raw.length, 0);
});

test("job checkpoints, remaining raw children, source references, and last district session survive", async (t) => {
  const { env, session, sqlite, raw } = fixture(t);
  session("job-old"); session("source-old"); session("last-district", "completed", OLD, "동구");
  session("still-running", "running"); session("held-child");
  raw("held", "held", { state: "held", session: "held-child" });
  sqlite.exec(`INSERT INTO jobs(id,state,payload_json) VALUES ('paused','paused','{"sessionId":"job-old"}');
    INSERT INTO listing_sources(id,listing_id,source,source_listing_id,session_id)
      VALUES ('S','L','네이버','any','source-old');`);
  const plan = await planCollectorRetention(env, { now: NOW });
  assert.deepEqual(plan.sessions.map(row => row.id), ["old"]);
});

test("failed upload/readback cannot delete, and changed rows are skipped after verification", async (t) => {
  const { env, raw, sqlite } = fixture(t);
  raw("first"); raw("latest", "100", { at: FRESH });
  env.COLLECTOR_RETENTION_MODE = "archive";
  const originalGet = env.MEDIA.get;
  env.MEDIA.get = async () => ({ async text() { return "corrupted"; } });
  await assert.rejects(runCollectorRetention(env, { now: NOW }), /verification failed/);
  assert.ok(sqlite.prepare("SELECT id FROM collector_raw WHERE id='first'").get());
  env.MEDIA.get = async (key) => {
    sqlite.exec(`UPDATE collector_raw SET result_json='{"newer":true}' WHERE id='first'`);
    return originalGet(key);
  };
  const result = await runCollectorRetention(env, { now: NOW });
  assert.equal(result.deleted.raw, 0);
  assert.ok(sqlite.prepare("SELECT id FROM collector_raw WHERE id='first'").get());
});

test("a newly opened hold between archive and delete protects the original", async (t) => {
  const { env, raw, sqlite } = fixture(t);
  raw("first"); raw("latest", "100", { at: FRESH });
  env.COLLECTOR_RETENTION_MODE = "archive";
  const originalGet = env.MEDIA.get;
  env.MEDIA.get = async (key) => {
    sqlite.exec(`INSERT INTO listing_data_quality_holds VALUES ('L',NULL,'open','{"rawId":"first"}')`);
    return originalGet(key);
  };
  assert.equal((await runCollectorRetention(env, { now: NOW })).deleted.raw, 0);
});

test("indexed cursor advances past preserved evidence, wraps, and cron executes once daily", async (t) => {
  const { env, raw, sqlite } = fixture(t);
  env.COLLECTOR_RETENTION_BATCH_LIMIT = "1";
  raw("a-pinned", "pinned"); raw("b-eligible", "eligible"); raw("new-eligible", "eligible", { at: FRESH });
  const first = await runScheduledCollectorRetention(env, { now: NOW });
  assert.equal(first.eligible.raw, 0); assert.equal(first.cursor.rawId, "a-pinned");
  assert.equal((await runScheduledCollectorRetention(env, { now: NOW })).skipped, "not-due");
  const second = await runScheduledCollectorRetention(env, { now: "2026-09-15T00:00:00.000Z" });
  assert.equal(second.eligible.raw, 1); assert.equal(second.cursor.rawId, "b-eligible");
  const third = await runScheduledCollectorRetention(env, { now: "2026-09-16T00:00:00.000Z" });
  assert.equal(third.cursor.rawId, "");
  const queryPlan = sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id,created_at FROM collector_raw
    WHERE processing_state IN ('processed','duplicate') AND created_at<'2026-06-01'
    ORDER BY created_at,id LIMIT 50`).all();
  assert.ok(queryPlan.some(row => /idx_collector_raw_retention_scan/.test(row.detail)));
});

test("concurrent cron lease allows only one archive run; missing migration fails closed", async (t) => {
  const { env, raw, archives, sqlite } = fixture(t);
  raw("first"); raw("latest", "100", { at: FRESH }); env.COLLECTOR_RETENTION_MODE = "archive";
  const reports = await Promise.all([runScheduledCollectorRetention(env, { now: NOW }), runScheduledCollectorRetention(env, { now: NOW })]);
  assert.equal(reports.filter(report => report.skipped === "not-due").length, 1);
  assert.equal(archives.size, 1);
  sqlite.exec("DROP TABLE collector_retention_state");
  assert.equal((await runScheduledCollectorRetention(env, { now: NOW })).ok, false);
});

test("large valid batches shrink their scan without starving or skipping remaining rows", async (t) => {
  const { env, raw, archives, sqlite } = fixture(t);
  const largePayload = JSON.stringify({ raw: { description: "x".repeat(400 * 1024) } });
  for (let index = 0; index < 24; index += 1) {
    const sourceId = String(index).padStart(3, "0");
    raw(`old-${sourceId}`, sourceId, { payload: largePayload });
    raw(`new-${sourceId}`, sourceId, { at: FRESH });
  }
  env.COLLECTOR_RETENTION_MODE = "archive";
  const first = await runCollectorRetention(env, { now: NOW });
  assert.equal(first.ok, true); assert.ok(first.deleted.raw > 0 && first.deleted.raw < 24);
  assert.ok(first.batchLimit < 50);
  assert.ok(new TextEncoder().encode(archives.get(first.archiveKey)).byteLength <= 8 * 1024 * 1024);
  const second = await runCollectorRetention(env, { now: NOW, cursor: first.cursor });
  assert.equal(first.deleted.raw + second.deleted.raw, 24);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM collector_raw WHERE id LIKE 'old-%'").get().n, 0);
});

test("remote preview binds quotes as values and rejects every non-SELECT statement", () => {
  assert.equal(bindPreviewSql("SELECT id WHERE id=?1 OR n=?2 OR p=?3", ["a'b", 5, null]),
    "SELECT id WHERE id='a''b' OR n=5 OR p=NULL");
  assert.throws(() => bindPreviewSql("DELETE FROM collector_raw", []), /SELECT only/);
  assert.throws(() => bindPreviewSql("SELECT 1; DELETE FROM collector_raw", []), /SELECT only/);
});
