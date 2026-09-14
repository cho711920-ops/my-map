import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizeCollectionCounts, collectionDateRange, summarizeCollectionDay, collectorActionGuidance } from "../cloudflare/src/collection-status-summary.js";
import { saveAutomationRunReport, sanitizeAutomationRunReport, readAutomationRunReports } from "../cloudflare/src/automation-run-reports.js";
import { handleCollectorApi, handleCollectorAdminGet } from "../cloudflare/src/collector-api.js";

function database(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../cloudflare/migrations/0001_initial.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../cloudflare/migrations/0022_collector_automation_reports.sql", import.meta.url), "utf8"));
  t.after(() => db.close());
  const prepare = (sql, values = []) => {
    const indexes = [];
    const query = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return { bind(...bindings) { return prepare(sql, bindings); },
      async first() { return db.prepare(query).get(...args()) || null; },
      async all() { return {results: db.prepare(query).all(...args())}; },
      async run() { return {meta: {changes: Number(db.prepare(query).run(...args()).changes)}}; } };
  };
  return {db, env: {DB: {prepare}, COLLECTOR_ACCESS_KEY: "test-secret"}};
}
test("web counts map persisted observed/manifest fields and keep unknown distinct from zero", () => {
  assert.equal(normalizeCollectionCounts({observed: 123, created: 5}).found, 123);
  assert.equal(normalizeCollectionCounts({manifestCount: 456}).found, 456);
  assert.equal(normalizeCollectionCounts({manifest: 50}).found, 50);
  assert.equal(normalizeCollectionCounts({found: 9}).found, 9);
  assert.equal(normalizeCollectionCounts({observed: 0, manifestCount: 456}).found, 0);
  assert.equal(normalizeCollectionCounts({expectedCount: 456}).found, null);
});
test("address-only exclusion is not an operational failure and normalization is idempotent", () => {
  const result = normalizeCollectionCounts({failed: 23, addressMissing: 23, requiredFieldRejected: 23,
    completionIssues: ["실패 23건", "주소·층 오류 23건"]});
  assert.equal(result.failed, 0);
  assert.equal(result.addressDeferred, 23);
  assert.equal(result.requiredFieldExcluded, 0);
  assert.ok(result.completionIssues.every(issue => !/^실패/.test(issue)));
  assert.equal(normalizeCollectionCounts(result).failed, 0);
  assert.equal(normalizeCollectionCounts({failed: 25, addressMissing: 23}).failed, 2);
});
test("Korean calendar date boundaries are explicit and invalid dates rejected", () => {
  assert.deepEqual(collectionDateRange("2026-09-14"), {date: "2026-09-14", start: "2026-09-13T15:00:00.000Z", end: "2026-09-14T15:00:00.000Z", baselineStart: "2026-08-30T15:00:00.000Z"});
  assert.throws(() => collectionDateRange("2026-02-31"), /올바른/);
});
const row = (id, district, created, extra = {}) => ({sessionId: id, source: "당근", scope: `대전 ${district} 완전수집`, tradeType: "lease",
  startedAt: "2026-09-14T02:00:00.000Z", endedAt: "2026-09-14T03:00:00.000Z", complete: true, observed: 1000, created, ...extra});
test("five districts aggregate 22 new while latest retry replaces, never adds the same scope", () => {
  const rows = [row("1", "유성구", 3), row("2", "대덕구", 8), row("3", "중구", 2), row("4", "서구", 4), row("5", "동구", 5)];
  assert.equal(summarizeCollectionDay(rows, "2026-09-14").totals.created, 22);
  rows.push(row("6", "동구", 1, {startedAt: "2026-09-14T04:00:00.000Z"}));
  const summary = summarizeCollectionDay(rows, "2026-09-14");
  assert.equal(summary.totals.created, 18);
  assert.equal(summary.totals.scopes, 5);
  assert.match(summary.policy, /최신 실행 1회/);
});
test("sale/lease and selected clusters do not overwrite a full-district result", () => {
  const rows = [row("1", "서구", 2), row("2", "서구", 3, {tradeType: "sale"}), row("3", "서구", 4, {scope: "서구 선택클러스터"})];
  assert.equal(summarizeCollectionDay(rows, "2026-09-14").items.length, 3);
  assert.equal(summarizeCollectionDay(rows, "2026-09-14", {tradeType: "sale"}).totals.created, 3);
  const coverage = summarizeCollectionDay([], "2026-09-14").districtCoverage;
  assert.ok(coverage.every(source => source.districts.every(d => d.state === "missing")));
});
test("inventory drop is a review warning only after three previous complete days", () => {
  const rows = [row("today", "서구", 0, {observed: 200})];
  for (const day of ["11", "12", "13"]) rows.push(row(day, "서구", 1, {startedAt: `2026-09-${day}T02:00:00.000Z`, observed: 1000}));
  const item = summarizeCollectionDay(rows, "2026-09-14").items[0];
  assert.equal(item.dropWarning, true);
  assert.equal(item.complete, true);
  assert.equal(summarizeCollectionDay(rows.slice(0, 3), "2026-09-14").items[0].dropWarning, false);
});
test("collectionStatus maps actual SQLite session totals through to both cards and date summary", async t => {
  const {db, env} = database(t);
  db.prepare(`INSERT INTO collector_sessions(id,source,state,totals_json,started_at,finished_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run("one", "당근", "completed", JSON.stringify({scope: "대전 동구 완전수집", observed: 1800, created: 5, failed: 23, addressMissing: 23}),
      "2026-09-14T02:00:00.000Z", "2026-09-14T03:00:00.000Z", "2026-09-14T03:00:00.000Z");
  const result = await handleCollectorAdminGet(env, {role: "admin"}, {action: "collectionStatus", date: "2026-09-14"});
  assert.equal(result.sources.find(source => source.source === "당근").lastResult.found, 1800);
  assert.equal(result.recent[0].failed, 0);
  assert.equal(result.daySummary.totals.addressDeferred, 23);
});
function report(extra = {}) {
  const now = Date.now();
  return {runId: `run-${now}-example`, startedAt: now, revision: now + 1, active: true,
    extensionVersion: "1.1.9", readiness: {schedule: "11:00", windowsTaskState: "Unknown"},
    items: [{source: "daangn", district: "동구", tradeType: "lease", status: "running", counts: {created: 5}}], ...extra};
}
test("run upload strips URLs, contacts, keys and arbitrary diagnostics", () => {
  const input = report({collectorKey: "secret", url: "https://private.example/?token=secret", message: "010-1234-5678"});
  input.items[0].raw = {phone: "010-1234-5678"}; input.items[0].key = "https://secret.example";
  const result = JSON.stringify(sanitizeAutomationRunReport(input));
  assert.doesNotMatch(result, /secret|010-1234|private|https|collectorKey|raw/);
});
test("invalid and unfinished final reports are rejected", () => {
  assert.throws(() => sanitizeAutomationRunReport(report({runId: "bad"})), /실행번호/);
  assert.throws(() => sanitizeAutomationRunReport(report({active: false})), /미완료/);
  assert.throws(() => sanitizeAutomationRunReport(report({items: Array.from({length: 41}, () => ({source: "daangn"}))})), /대상/);
  assert.throws(() => sanitizeAutomationRunReport(report({startedAt: Date.now() - 31 * 86400000})), /시각/);
});
test("same revision is idempotent and completed reports cannot regress to running", async t => {
  const {env} = database(t);
  const input = report();
  assert.equal((await saveAutomationRunReport(env, input)).changed, true);
  assert.equal((await saveAutomationRunReport(env, input)).changed, false);
  const final = {...input, active: false, revision: input.revision + 1, finishedAt: input.revision + 1,
    items: [{source: "daangn", district: "동구", status: "completed", counts: {created: 5}}]};
  await saveAutomationRunReport(env, final);
  assert.equal((await saveAutomationRunReport(env, {...input, revision: input.revision + 2})).changed, false);
  assert.equal((await readAutomationRunReports(env)).runs[0].active, false);
});
test("external report action requires collector authentication and cannot mutate listing data", async t => {
  const {env, db} = database(t);
  const request = key => new Request("https://js-map.com/api/collector", {method: "POST", headers: {origin: "https://realty.daangn.com", "content-type": "text/plain"},
    body: JSON.stringify({action: "saveAutomationRunReport", collectorKey: key, report: report(), updateProperty: {deposit: 1}})});
  assert.equal((await handleCollectorApi(request("wrong"), env)).status, 403);
  assert.equal((await handleCollectorApi(request("test-secret"), env)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM listings").get().n, 0);
});
test("provider errors provide concrete next actions without recommending blind retries", () => {
  assert.match(collectorActionGuidance("HTTP 403"), /로그인/);
  assert.match(collectorActionGuidance("PersistedQueryNotFound"), /업데이트/);
  assert.match(collectorActionGuidance("정확한 지번 없음"), /보류/);
});
