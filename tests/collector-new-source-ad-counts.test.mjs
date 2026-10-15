import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi } from "../cloudflare/src/collector-api.js";
import { normalizeCollectionCounts, summarizeCollectionDay } from "../cloudflare/src/collection-status-summary.js";
import { sanitizeAutomationRunReport } from "../cloudflare/src/automation-run-reports.js";

function database(t) {
  const db = new DatabaseSync(":memory:");
  for (const name of fs.readdirSync("cloudflare/migrations").filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(`cloudflare/migrations/${name}`, "utf8"));
  }
  t.after(() => db.close());
  const queries = [];
  let failCounterWrite = false;
  const prepare = (sql, bindings = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => bindings[index]) : bindings;
    return { bind: (...values) => prepare(sql, values),
      async all() { queries.push(sql); return { results: db.prepare(compiled).all(...args()) }; },
      async first() { queries.push(sql); return db.prepare(compiled).get(...args()) || null; },
      async run() {
        queries.push(sql);
        if (failCounterWrite && /newSourceAds.*COALESCE/s.test(sql) && !/newSourceAdsReported/.test(sql)) {
          throw new Error("synthetic counter failure");
        }
        return { meta: { changes: Number(db.prepare(compiled).run(...args()).changes) } };
      } };
  };
  const env = { COLLECTOR_ACCESS_KEY: "fixture-key", DB: { prepare,
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT"); return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    } } };
  const call = async body => {
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", {
      method: "POST", headers: { Origin: "https://fin.land.naver.com", "Content-Type": "application/json" },
      body: JSON.stringify({ collectorKey: "fixture-key", source: "네이버", ...body })
    }), env);
    const output = await response.json();
    assert.equal(response.status, 200, JSON.stringify(output));
    assert.equal(output.ok, true, JSON.stringify(output));
    return output;
  };
  const save = (ads, sessionId = "new-session", extra = {}) => call({ action: "saveNaverBatch", data: ads, sessionId, ...extra });
  const totals = (id = "new-session") => JSON.parse(db.prepare("SELECT totals_json FROM collector_sessions WHERE id=?").get(id).totals_json);
  return { db, env, call, save, totals, queries, failCounter: value => { failCounterWrite = value; } };
}

const ad = (id, fields = {}) => ({ articleNo: id, tradeType: "lease", category: "상가점포", buildingName: "검수상가",
  jibunAddress: "서구 갈마동 361-14", roomInfo: "101호", deposit: 1000, monthly: 50,
  areaSquareMeter: 66.1, managementFee: 5, description: "검수용 합성 매물", imageUrls: [],
  listSnapshot: "new-count-fixture", latitude: 36.35, longitude: 127.37, ...fields });

test("a new source ad is counted whether it creates a master or joins an existing master", async t => {
  const f = database(t);
  const first = await f.save([ad("one")]);
  assert.equal(first.created, 1); assert.equal(first.newSourceAds, 1); assert.equal(first.newSourceAdsReported, true);
  const second = await f.save([ad("two")]);
  assert.equal(second.created, 0); assert.equal(second.merged, 1); assert.equal(second.newSourceAds, 1);
  assert.equal(f.totals().created, 1); assert.equal(f.totals().merged, 1);
  assert.equal(f.totals().newSourceAds, 2); assert.equal(f.totals().newSourceAdsReported, true);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM listing_sources").get().n, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM listings").get().n, 1);
  assert.ok(f.queries.every(sql => !/SELECT\s+\*\s+FROM\s+listing_sources/i.test(sql)));
});

test("batch duplicates, later retries, existing changes and reappeared originals are not new ads", async t => {
  const f = database(t);
  const initial = await f.save([ad("one"), ad("one")], "new-session", { requestId: "first-batch" });
  assert.equal(initial.newSourceAds, 1); assert.equal(initial.failed, 0); assert.equal(initial.duplicate, 1);
  const replay = await f.save([ad("one")], "new-session", { requestId: "first-batch" });
  assert.deepEqual(replay, initial, "request replay returns stored result rather than inserting/counting again");
  const retry = await f.save([ad("one")]);
  assert.equal(retry.newSourceAds, 0); assert.equal(retry.newSourceAdsReported, true);
  const changed = await f.save([ad("one", { monthly: 70, listSnapshot: "changed" })]);
  assert.equal(changed.newSourceAds, 0); assert.equal(changed.updated, 1);
  f.db.exec("UPDATE listing_sources SET active=0, missing_count=1, updated_at='2000-01-01T00:00:00Z'");
  const reappeared = await f.save([ad("one")], "tomorrow", { completionProof: { capturedAt: new Date().toISOString() } });
  assert.equal(reappeared.newSourceAds, 0); assert.equal(reappeared.adsReappeared, 1);
  assert.equal(f.totals().newSourceAds, 1); assert.equal(f.totals("tomorrow").newSourceAds, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM listing_sources").get().n, 1);
});

test("one provider advertisement number in sale and lease is counted separately without crossing markets", async t => {
  const f = database(t);
  const lease = await f.save([ad("shared")], "lease-run");
  const sale = await f.save([ad("shared", { tradeType: "sale", salePrice: 70000 })], "sale-run");
  assert.equal(lease.newSourceAds, 1); assert.equal(sale.newSourceAds, 1);
  assert.deepEqual(f.db.prepare("SELECT source_listing_id,trade_type FROM listing_sources ORDER BY trade_type").all().map(row => ({ ...row })),
    [{ source_listing_id: "네이버-shared::lease", trade_type: "lease" }, { source_listing_id: "네이버-shared::sale", trade_type: "sale" }]);
  assert.equal((await f.save([ad("shared", { tradeType: "sale", salePrice: 71000 })], "next-sale")).newSourceAds, 0);
});

test("the atomic source/counter batch rolls back together and an old session stays unreported", async t => {
  const f = database(t);
  f.failCounter(true);
  const failed = await f.save([ad("fail")]);
  assert.equal(failed.failed, 1); assert.equal(failed.newSourceAds, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM listing_sources").get().n, 0);
  assert.equal(f.totals().newSourceAds, 0);
  f.failCounter(false);
  await f.save([ad("fail")]);
  assert.equal(f.totals().newSourceAds, 1);
  f.db.prepare("INSERT INTO collector_sessions(id,source,totals_json) VALUES ('old','네이버',?)").run(JSON.stringify({ received: 8, created: 5 }));
  assert.equal((await f.save([ad("old-session-new")], "old")).newSourceAds, 1);
  assert.equal(f.totals("old").newSourceAds, 1);
  assert.equal(f.totals("old").newSourceAdsReported, false);
  assert.deepEqual(normalizeCollectionCounts(f.totals("old")).newSourceAds, null);
});

test("Gongsil two-market offers and ordinary refreshes report exact new source counts", async t => {
  const f = database(t);
  const list = { Bfidx: "box-one", TypeView: "상가", Ho: "101", Me: 37000, Bo: 1000, Mm: 50, Area: 20 };
  const record = { externalId: "box-one", listSnapshot: JSON.stringify(list), raw: { list },
    values: ["검수상가", "서구 갈마동 361-14", "101호", "일반상가", 1000, 50, 0, 0, 20] };
  const save = () => f.call({ action: "gongsilImportBatch", source: "공실박스", sessionId: "box-session", records: [record] });
  assert.equal((await save()).newSourceAds, 2);
  assert.equal((await save()).newSourceAds, 0);
  assert.equal(f.totals("box-session").newSourceAds, 2);
});

test("finalization and replay retain authoritative source-ad counts without replacing created", async t => {
  const f = database(t); await f.save([ad("one"), ad("two")]);
  const body = { action: "finalizeCollectionSession", sessionId: "new-session", tradeType: "lease", complete: false,
    observedSourceIds: ["one", "two"], expectedCount: 2, processedCount: 2, manifestCount: 2 };
  const final = await f.call(body);
  assert.equal(final.newSourceAds, 2); assert.equal(final.newSourceAdsReported, true); assert.equal(final.created, 1);
  const replay = await f.call(body);
  assert.equal(replay.newSourceAds, 2); assert.equal(replay.replayed, true);
  const status = await f.call({ action: "getNaverSessionResult", sessionId: "new-session" });
  assert.equal(status.newSourceAds, 2); assert.equal(status.created, 1);
});

test("Daangn public job checkpoints and final results count new advertisements rather than only new masters", async t => {
  const f = database(t);
  const articles = ["carrot-one", "carrot-two"].map(originalId => ({ originalId, floor: 1, area: 66.1,
    publicJibunAddress: "서구 갈마동 361-14", salesTypeV3: { type: "STORE" },
    trades: [{ type: "MONTH", deposit: 1000, monthlyPay: 50 }], images: [] }));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const data = request.variables.articleId
      ? { articleByOriginalArticleId: articles.find(article => article.originalId === request.variables.articleId) }
      : { articleByClusterId: { edges: articles.map(article => ({ node: { article } })), totalCount: 2,
        pageInfo: { hasNextPage: false, endCursor: "" } } };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const url = "https://realty.daangn.com/?cluster_id=REGION1154&js_district=서구";
  const start = await f.call({ action: "danggeunStartJob", url, source: "당근", clientId: "new-ad-count", tradeType: "lease" });
  assert.equal(start.job.newSourceAds, 0); assert.equal(start.job.newSourceAdsReported, true);
  const chunk = () => f.call({ action: "danggeunRunJobChunk", source: "당근", clientId: "new-ad-count", tradeType: "lease" });
  assert.equal((await chunk()).job.phase, "details");
  const final = (await chunk()).job;
  assert.equal(final.phase, "complete"); assert.equal(final.newSourceAds, 2);
  assert.equal(final.newSourceAdsReported, true); assert.equal(final.created, 1); assert.equal(final.merged, 1);
  assert.equal(f.totals(start.job.sessionId).newSourceAds, 2);
  assert.equal((await chunk()).job.newSourceAds, 2, "completed checkpoint is not added again");
  const next = await f.call({ action: "danggeunStartJob", url, source: "당근", clientId: "new-ad-count", tradeType: "lease" });
  const unchanged = (await chunk()).job;
  assert.equal(unchanged.phase, "complete"); assert.equal(unchanged.newSourceAds, 0);
  assert.equal(unchanged.newSourceAdsReported, true); assert.equal(f.totals(next.job.sessionId).newSourceAds, 0);
});

test("unreported, invalid and verified zero source-ad counts are distinct and normalization is idempotent", () => {
  for (const input of [{}, { created: 12, merged: 5 }, { newSourceAds: 12 },
    { newSourceAds: null, newSourceAdsReported: true }, { newSourceAds: -1, newSourceAdsReported: true },
    { newSourceAds: true, newSourceAdsReported: true }]) {
    const row = normalizeCollectionCounts(input);
    assert.equal(row.newSourceAds, null); assert.equal(row.newSourceAdsReported, false);
    assert.equal(normalizeCollectionCounts(row).newSourceAds, null);
  }
  assert.equal(normalizeCollectionCounts({ newSourceAds: 0, newSourceAdsReported: true }).newSourceAds, 0);
});

test("day summaries keep latest-run scope policy and report unknown scopes rather than fabricating zero", () => {
  const row = (id, source, scope, count, extra = {}) => ({ sessionId: id, source, scope, tradeType: "lease",
    startedAt: "2026-10-15T02:00:00Z", complete: true, observed: 100,
    newSourceAds: count, newSourceAdsReported: true, ...extra });
  const first = row("one", "네이버", "서구 전체", 4, { created: 1, merged: 3 });
  const other = row("two", "네이버", "동구 전체", 0);
  const summary = summarizeCollectionDay([first, other], "2026-10-15");
  assert.equal(summary.totals.newSourceAds, 4); assert.equal(summary.totals.created, 1);
  assert.equal(summary.totals.newSourceAdsReported, true);
  const retry = { ...first, sessionId: "retry", startedAt: "2026-10-15T03:00:00Z", newSourceAds: 0 };
  assert.equal(summarizeCollectionDay([first, other, retry], "2026-10-15").totals.newSourceAds, 0);
  const unknown = row("legacy", "당근", "서구 전체", null, { newSourceAdsReported: false, created: 9 });
  const mixed = summarizeCollectionDay([first, other, unknown], "2026-10-15");
  assert.equal(mixed.totals.newSourceAds, null); assert.equal(mixed.totals.newSourceAdsReported, false);
  assert.equal(mixed.totals.newSourceAdsKnownTotal, 4); assert.equal(mixed.totals.unknownNewSourceAdsScopes, 1);
  assert.match(mixed.policy, /최신 실행 1회/); assert.match(mixed.policy, /일일 고유 신규 총계와 다를/);
  assert.equal(summarizeCollectionDay([], "2026-10-15").totals.newSourceAds, null);
});

test("automation upload preserves supported zero/new counts and marks old clients unreported", () => {
  const now = Date.now();
  const report = counts => sanitizeAutomationRunReport({ runId: `run-${now}-counts`, startedAt: now,
    revision: now + 1, active: false, finishedAt: now + 1,
    items: [{ source: "naver", status: "completed", counts }] }, now + 10).items[0].counts;
  for (const count of [0, 9]) {
    const sanitized = report({ created: 1, newSourceAds: count, newSourceAdsReported: true });
    assert.equal(sanitized.newSourceAds, count); assert.equal(sanitized.newSourceAdsReported, true);
    assert.equal(sanitized.created, 1);
  }
  const legacy = report({ created: 10 });
  assert.equal(legacy.newSourceAds, null); assert.equal(legacy.newSourceAdsReported, false);
});
