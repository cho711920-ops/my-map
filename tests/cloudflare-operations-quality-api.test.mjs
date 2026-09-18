import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../cloudflare/src/worker.js";
import { createSessionToken, SESSION_COOKIE } from "../cloudflare/src/security.js";
import { handleOperationsQualityGet, handleOperationsQualityPost,
  isOperationsQualityGetAction, isOperationsQualityPostAction } from "../cloudflare/src/operations-quality-api.js";

const ADMIN = { email: "admin@example.com", role: "admin" };
const AT = "2026-09-14T00:00:00.000Z";
const URL = "https://www.daangn.com/kr/realty-posts/123";
const ISSUE = "daangn_monthly_terms_stale";
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0001_initial.sql", "0019_listing_trade_foundation.sql", "0020_listing_data_quality_holds.sql"]) {
    sqlite.exec(readFileSync(new globalThis.URL(`../cloudflare/migrations/${migration}`, import.meta.url), "utf8"));
  }
  sqlite.exec(`CREATE TABLE collector_retention_state(id TEXT PRIMARY KEY,lease_until TEXT DEFAULT '',next_run_at TEXT DEFAULT '',
    last_report_json TEXT DEFAULT '{}',updated_at TEXT DEFAULT '');`);
  t.after(() => sqlite.close());
  const prepare = (sql, values = []) => {
    const indexes = [];
    const query = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return {
      sql, values,
      bind(...bindings) { return prepare(sql, bindings); },
      async all() { return { results: sqlite.prepare(query).all(...args()) }; },
      async first() { return sqlite.prepare(query).get(...args()) || null; },
      async run() { return { meta: { changes: Number(sqlite.prepare(query).run(...args()).changes) } }; }
    };
  };
  const env = { DB: { prepare, beforeBatch: null, async batch(statements) {
    this.beforeBatch?.();
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        assert.ok(statement.values.length <= 100, "D1 bind parameter limit");
        results.push(await statement.run());
      }
      sqlite.exec("COMMIT"); return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } };
  sqlite.prepare(`INSERT INTO listings(id,property_id,address,room,deposit,monthly_rent,updated_at)
    VALUES('L','P','대전광역시 중구 테스트로 1','201',3000,50,?)`).run(AT);
  const source = (id = "S", overrides = {}) => sqlite.prepare(`INSERT INTO listing_sources
    (id,listing_id,source,source_listing_id,source_url,active,trade_type,list_snapshot_json,updated_at)
    VALUES(?,'L','당근',?,?,?,?,?,?)`).run(id, id, overrides.url || URL, overrides.active ?? 1, overrides.tradeType || "lease",
      JSON.stringify({ sourceId: id, address: "대전광역시 중구 테스트로 1", room: "201", tradeType: "lease", deposit: 3000,
        rent: 50, ...overrides.snapshot }), AT);
  const hold = (issue = ISSUE, overrides = {}) => sqlite.prepare(`INSERT INTO listing_data_quality_holds
    (listing_id,issue_code,source_id,state,blocks_publication,evidence_json,updated_at)
    VALUES('L',?,?,?,?,?,?)`).run(issue, overrides.sourceId ?? null, overrides.state || "open", overrides.blocks ?? 1,
      JSON.stringify(overrides.evidence || {}), overrides.at || AT);
  source(); hold();
  const body = { action: "resolveOperationsQualityHold", listingId: "L", issueCode: ISSUE,
    expectedVersion: 1, expectedHoldUpdatedAt: AT,
    evidence: { note: "원본을 열어 임대조건과 동일 호실임을 확인했습니다.", sourceUrl: URL,
      tradeType: "lease", deposit: 3000, monthlyRent: 50 } };
  return { env, sqlite, source, hold, body };
}
const status = expected => error => error.statusCode === expected;

test("quality operations have explicit separate actions and require admin/owner", async t => {
  const { env } = fixture(t);
  assert.equal(isOperationsQualityGetAction("operationsQualityHolds"), true);
  assert.equal(isOperationsQualityPostAction("resolveOperationsQualityHold"), true);
  assert.equal(isOperationsQualityPostAction("updateProperty"), false);
  assert.equal(await handleOperationsQualityGet(env, null, { action: "not-ours" }), null);
  for (const user of [null, { role: "viewer" }, { role: "member" }]) {
    await assert.rejects(handleOperationsQualityGet(env, user, { action: "operationsQualityHolds" }), status(403));
    await assert.rejects(handleOperationsQualityGet(env, user, { action: "operationsRetentionStatus" }), status(403));
    await assert.rejects(handleOperationsQualityPost(env, user, { action: "resolveOperationsQualityHold" }), status(403));
  }
});

test("hold list separates publication holds from collector_raw and redacts arbitrary evidence", async t => {
  const { env, sqlite, hold } = fixture(t);
  sqlite.prepare(`UPDATE listing_data_quality_holds SET evidence_json=?`).run(JSON.stringify({
    verifiedJeonse: false, stored: { deposit: 3000, monthlyRent: 0, phone: "PRIVATE" },
    sourceIds: ["S"], token: "SECRET", raw: { phone: "PRIVATE" }, contact: "PRIVATE" }));
  hold("gongsil_verified_jeonse", { blocks: 0 });
  hold("resolved_test", { state: "resolved", blocks: 0 });
  const result = await handleOperationsQualityGet(env, ADMIN, { action: "operationsQualityHolds", limit: 1 });
  assert.equal(result.kind, "publication-quality-hold");
  assert.equal(result.total, 2); assert.equal(result.rows.length, 1);
  assert.equal(result.summary.openBlocking, 1); assert.equal(result.summary.openNonBlocking, 1);
  assert.equal(result.summary.resolved, 1);
  assert.equal(result.rows[0].sources[0].sourceUrl, URL);
  assert.equal(result.rows[0].version, 1);
  assert.equal(result.rows[0].releaseSupported, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|collector_raw/);
  const all = await handleOperationsQualityGet(env, ADMIN, { action: "operationsQualityHolds", state: "all", offset: 2 });
  assert.equal(all.total, 3); assert.equal(all.rows.length, 1);
  await assert.rejects(handleOperationsQualityGet(env, ADMIN, { action: "operationsQualityHolds", state: "injected" }), status(400));
});

test("hold source links reject credentials, executable links and unrelated hosts", async t => {
  const { env, sqlite } = fixture(t);
  for (const url of ["javascript:alert(1)", "https://example.com/123", "https://secret@daangn.com/123", "https://daangn.com/123?token=SECRET"]) {
    sqlite.prepare("UPDATE listing_sources SET source_url=?").run(url);
    const result = await handleOperationsQualityGet(env, ADMIN, { action: "operationsQualityHolds" });
    assert.equal(result.rows[0].sources[0].sourceUrl, "");
  }
});

test("Daangn unproven exact address is labeled, redacted and cannot be released with price evidence", async t => {
  const { env, sqlite, body, hold } = fixture(t);
  const issue = "daangn_exact_address_unproven";
  hold(issue, { sourceId: "S", evidence: {
    sourceIds: ["S"], token: "PRIVATE_TOKEN", raw: { phone: "PRIVATE_PHONE" }, contact: "PRIVATE_CONTACT"
  } });
  sqlite.prepare(`UPDATE listing_sources SET list_snapshot_json=json_set(list_snapshot_json,
    '$.raw',json(?),'$.contact',?)`).run(JSON.stringify({ phone: "PRIVATE_SOURCE_PHONE" }), "PRIVATE_SOURCE_CONTACT");
  const listingBefore = sqlite.prepare("SELECT * FROM listings").get();
  const sourceBefore = sqlite.prepare("SELECT * FROM listing_sources").get();
  const holdBefore = sqlite.prepare("SELECT * FROM listing_data_quality_holds WHERE issue_code=?").get(issue);
  const result = await handleOperationsQualityGet(env, ADMIN, { action: "operationsQualityHolds" });
  const row = result.rows.find(item => item.issueCode === issue);
  assert.equal(row.reason, "당근 정확한 지번 미제공 · 주소 확인 보류");
  assert.equal(row.state, "open");
  assert.equal(row.blocksPublication, true);
  assert.equal(row.releaseRequiresEvidence, true);
  assert.equal(row.releaseSupported, false);
  assert.equal(row.monthlyRent, body.evidence.monthlyRent);
  assert.equal(row.sources[0].sourceUrl, body.evidence.sourceUrl);
  assert.deepEqual(row.evidence, { sourceIds: ["S"] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|list_snapshot_json|evidence_json/);
  for (const resolutionState of ["resolved", "dismissed"]) {
    await assert.rejects(handleOperationsQualityPost(env, ADMIN, {
      ...body, issueCode: issue, resolutionState
    }), status(409));
  }
  assert.deepEqual(sqlite.prepare("SELECT * FROM listings").get(), listingBefore);
  assert.deepEqual(sqlite.prepare("SELECT * FROM listing_sources").get(), sourceBefore);
  assert.deepEqual(sqlite.prepare("SELECT * FROM listing_data_quality_holds WHERE issue_code=?").get(issue), holdBefore);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 0);
});

test("previous repair resolutions are not misrepresented as publication-only releases", async t => {
  const { env, sqlite } = fixture(t);
  sqlite.prepare("UPDATE listing_data_quality_holds SET state='resolved',resolution_json=?").run(JSON.stringify({
    action: "repair_monthly", correctedAt: AT, preservedListingId: "L" }));
  const result = await handleOperationsQualityGet(env, ADMIN, { action: "operationsQualityHolds", state: "resolved" });
  assert.equal(result.rows[0].resolution.operation, "repair_monthly");
  assert.equal(result.rows[0].resolution.fieldsChanged, true);
  assert.equal(result.rows[0].resolution.reviewedAt, AT);
});

test("retention dashboard returns bounded policy, last scan, next run without secrets or mutation", async t => {
  const { env, sqlite } = fixture(t);
  const initial = await handleOperationsQualityGet(env, ADMIN, { action: "operationsRetentionStatus" });
  assert.equal(initial.configured, false); assert.equal(initial.lastReport, null);
  const report = { ok: true, mode: "archive", at: AT, scanned: { raw: 50, sessions: 50 }, eligible: { raw: 3, sessions: 2 },
    deleted: { raw: 3, sessions: 2 }, archiveKey: "collector-retention/2026-09-14/123abc.json", archiveSha256: "a".repeat(64),
    leaseToken: "SECRET", error: "PRIVATE CONNECTION" };
  sqlite.prepare("INSERT INTO collector_retention_state(id,next_run_at,last_report_json,updated_at) VALUES('daily',?,?,?)")
    .run("2026-09-15T00:00:00.000Z", JSON.stringify(report), AT);
  const result = await handleOperationsQualityGet(env, ADMIN, { action: "operationsRetentionStatus" });
  assert.equal(result.policy.rawDays, 90); assert.equal(result.policy.sessionDays, 180);
  assert.equal(result.nextRunAt, "2026-09-15T00:00:00.000Z");
  assert.equal(result.lastReport.archiveVerified, true);
  assert.deepEqual(result.lastReport.excludedInLastScan, { raw: 47, sessions: 48 });
  assert.equal(result.totalRemaining, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE/);
});

test("release rejects empty proof and mismatched source links or amounts without writes", async t => {
  const { env, sqlite, body } = fixture(t);
  for (const changed of [{ note: "  " }, { sourceUrl: "https://www.daangn.com/kr/realty-posts/999" },
    { monthlyRent: 51 }, { tradeType: "sale" }, { deposit: null }]) {
    await assert.rejects(handleOperationsQualityPost(env, ADMIN, { ...body, evidence: { ...body.evidence, ...changed } }));
  }
  assert.equal(sqlite.prepare("SELECT state FROM listing_data_quality_holds").get().state, "open");
  assert.equal(sqlite.prepare("SELECT version FROM listings").get().version, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 0);
});

test("sale, orphan and zero-rent unproven holds cannot be cleared by optimistic user assertion", async t => {
  const { env, sqlite, body, hold } = fixture(t);
  for (const issue of ["daangn_buy_only_in_lease", "gongsil_sale_in_lease", "orphan_zero_rent_lease", "unknown_issue"]) {
    hold(issue);
    await assert.rejects(handleOperationsQualityPost(env, ADMIN, { ...body, issueCode: issue }), status(409));
  }
  sqlite.exec("UPDATE listings SET monthly_rent=0");
  sqlite.prepare("UPDATE listing_sources SET list_snapshot_json=json_set(list_snapshot_json,'$.rent',0)").run();
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, { ...body, evidence: { ...body.evidence, monthlyRent: 0 } }), status(409));
});

test("all active sources must agree, and preserved representative changes require manual repair", async t => {
  const { env, sqlite, body, source } = fixture(t);
  source("OTHER", { snapshot: { rent: 60 } });
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, body), status(409));
  sqlite.exec("DELETE FROM listing_sources WHERE id='OTHER'");
  for (const changes of [{ room: "301" }, { address: "다른주소" }, { preserveRepresentative: true }, { tradeType: "sale" }]) {
    sqlite.prepare("UPDATE listing_sources SET list_snapshot_json=?").run(JSON.stringify({
      address: "대전광역시 중구 테스트로 1", room: "201", deposit: 3000, rent: 50, tradeType: "lease", ...changes }));
    await assert.rejects(handleOperationsQualityPost(env, ADMIN, body), status(409));
  }
});

test("review release logs proof and bumps version without changing listing values", async t => {
  const { env, sqlite, body, hold } = fixture(t);
  hold("another_issue");
  const before = sqlite.prepare("SELECT deposit,monthly_rent,address,room,trade_type,status FROM listings").get();
  const result = await handleOperationsQualityPost(env, ADMIN, body);
  assert.equal(result.persisted, true); assert.equal(result.version, 2);
  assert.equal(result.fieldsChanged, false); assert.equal(result.remainingBlockingHolds, 1);
  assert.deepEqual(sqlite.prepare("SELECT deposit,monthly_rent,address,room,trade_type,status FROM listings").get(), before);
  const updated = sqlite.prepare("SELECT * FROM listing_data_quality_holds WHERE issue_code=?").get(ISSUE);
  assert.equal(updated.state, "resolved"); assert.equal(updated.blocks_publication, 0);
  assert.equal(updated.resolved_by, ADMIN.email);
  assert.equal(JSON.parse(updated.resolution_json).note, body.evidence.note);
  const history = sqlite.prepare("SELECT * FROM listing_history").get();
  assert.equal(history.action, "resolveOperationsQualityHold");
  assert.equal(JSON.parse(history.after_json).sourceUrl, URL);
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, body), status(409));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 1);
});

test("verified normal jeonse is nonblocking and may be closed with exact source proof", async t => {
  const { env, sqlite, body, hold } = fixture(t);
  hold("gongsil_verified_jeonse", { blocks: 0, evidence: { verifiedJeonse: true } });
  sqlite.exec("UPDATE listings SET monthly_rent=0");
  sqlite.exec("UPDATE listing_sources SET list_snapshot_json=json_set(list_snapshot_json,'$.rent',0)");
  const result = await handleOperationsQualityPost(env, ADMIN, { ...body, issueCode: "gongsil_verified_jeonse",
    resolutionState: "dismissed", evidence: { ...body.evidence, monthlyRent: 0 } });
  assert.equal(result.state, "dismissed");
  assert.equal(result.remainingBlockingHolds, 1);
});

test("stale version and hold timestamp are rejected before a batch", async t => {
  const { env, body } = fixture(t);
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, { ...body, expectedVersion: 2 }), status(409));
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, { ...body, expectedHoldUpdatedAt: "old" }), status(409));
});

for (const [name, sql] of [
  ["listing version", "UPDATE listings SET version=version+1"],
  ["listing data without version", "UPDATE listings SET monthly_rent=60"],
  ["hold timestamp", "UPDATE listing_data_quality_holds SET updated_at='changed'"],
  ["hold evidence", "UPDATE listing_data_quality_holds SET evidence_json='{\"changed\":true}'"],
  ["hold source", "UPDATE listing_data_quality_holds SET source_id='S'"],
  ["source evidence", "UPDATE listing_sources SET list_snapshot_json=json_set(list_snapshot_json,'$.rent',60)"],
  ["source URL", "UPDATE listing_sources SET source_url='https://www.daangn.com/kr/realty-posts/999'"],
  ["new source", "INSERT INTO listing_sources(id,listing_id,source,source_listing_id) VALUES('NEW','L','당근','NEW')"]
]) test(`CAS rejects racing ${name} with no release/history/version write`, async t => {
  const { env, sqlite, body } = fixture(t);
  env.DB.beforeBatch = () => sqlite.exec(sql);
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, body), status(409));
  assert.equal(sqlite.prepare("SELECT state FROM listing_data_quality_holds").get().state, "open");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 0);
  assert.equal(sqlite.prepare("SELECT version FROM listings").get().version, name === "listing version" ? 2 : 1);
});

test("batch failure rolls back hold and listing together", async t => {
  const { env, sqlite, body } = fixture(t);
  sqlite.exec("CREATE TRIGGER reject_history BEFORE INSERT ON listing_history BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, body), /test failure/);
  assert.equal(sqlite.prepare("SELECT state FROM listing_data_quality_holds").get().state, "open");
  assert.equal(sqlite.prepare("SELECT version FROM listings").get().version, 1);
});

test("40 matching sources fit D1 bind limit and 41 sources require individual review", async t => {
  const { env, source, body } = fixture(t);
  for (let i = 1; i < 41; i++) source(`S${i}`);
  await assert.rejects(handleOperationsQualityPost(env, ADMIN, body), status(409));
  await env.DB.prepare("DELETE FROM listing_sources WHERE id='S40'").run();
  assert.equal((await handleOperationsQualityPost(env, ADMIN, body)).ok, true);
});

test("Worker routes quality reads privately and rejects member writes", async t => {
  const { env, body, sqlite } = fixture(t);
  Object.assign(env, {ALLOWED_EMAILS: "admin@example.com,member@example.com", SESSION_SECRET: "local-quality-test-only-secret-longer-than-32-characters"});
  const request = async (email, action, post) => {
    const token = await createSessionToken({sub: "test", email}, env);
    return worker.fetch(new Request("https://js-map.com/api/data" + (post ? "" : "?action=" + action), {
      method: post ? "POST" : "GET", headers: {cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, origin: "https://js-map.com", "content-type": "application/json"},
      ...(post ? {body: JSON.stringify(body)} : {})
    }), env);
  };
  const read = await request("admin@example.com", "operationsQualityHolds");
  assert.equal(read.status, 200); assert.match(read.headers.get("cache-control"), /private, no-store/);
  assert.equal((await read.json()).total, 1);
  assert.equal((await request("member@example.com", "operationsQualityHolds")).status, 403);
  assert.equal((await request("member@example.com", "resolveOperationsQualityHold", true)).status, 403);
  assert.equal(sqlite.prepare("SELECT state FROM listing_data_quality_holds").get().state, "open");
});

test("Worker waits for hold-release list/detail cache invalidation and publishes a revision", async t => {
  const { env, body } = fixture(t);
  const removed = [], written = [], pending = [];
  Object.assign(env, {ALLOWED_EMAILS: "admin@example.com", SESSION_SECRET: "local-quality-test-only-secret-longer-than-32-characters",
    MEDIA: {get: async () => null, delete: async keys => {removed.push(...keys);}, put: async key => {written.push(key);}}});
  const token = await createSessionToken({sub: "test", email: "admin@example.com"}, env);
  const response = await worker.fetch(new Request("https://js-map.com/api/data", {method: "POST",
    headers: {cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, origin: "https://js-map.com", "content-type": "application/json"}, body: JSON.stringify(body)}), env, {waitUntil: task => pending.push(task)});
  assert.equal(response.status, 200); assert.equal((await response.json()).persisted, true);
  for (const key of ["api-cache/d1-sheet.csv", "api-cache/unified-listings-v5-source-aware-review.json", "api-cache/operations-dashboard.json", "api-cache/unified-detail-v5-sale-metadata/P.json"]) assert.ok(removed.includes(key), key);
  await Promise.all(pending);
  assert.ok(written.includes("api-cache/revision/listings.json"));
});
