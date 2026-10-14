import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi, validatedGongsilPresenceScope } from "../cloudflare/src/collector-api.js";

const scope = (fields = {}) => ({ version: 1, selectionKind: "full-map-result",
  bounds: [36.2, 127.2, 36.5, 127.5], level: 13, btype: "Xone", filtersHash: "a".repeat(64), ...fields });
const filler = Array.from({ length: 100 }, (_, index) => `filler-${index}`);
const proof = (ids, fields = {}) => ({ version: 1, terminalReached: true, listComplete: true,
  scopeVerified: true, issueCodes: [], expectedCountKnown: true, providerExpectedCount: ids.length,
  observedUniqueCount: ids.length, capturedAt: new Date().toISOString(), emptyConfirmed: ids.length === 0, ...fields });
function database(t) {
  let clock = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: clock });
  const db = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync("cloudflare/migrations").filter(file => file.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(`cloudflare/migrations/${file}`, "utf8"));
  }
  t.after(() => db.close());
  const statements = [];
  let beforeBatch = null;
  const prepare = (sql, args = []) => {
    const numbers = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, n) => { numbers.push(Number(n) - 1); return "?"; });
    const params = () => numbers.length ? numbers.map(n => args[n]) : args;
    return { bind: (...values) => prepare(sql, values),
      async all() { statements.push(sql); return { results: db.prepare(compiled).all(...params()) }; },
      async first() { statements.push(sql); return db.prepare(compiled).get(...params()) || null; },
      async run() { statements.push(sql); const row = db.prepare(compiled).run(...params()); return { meta: { changes: Number(row.changes) } }; }
    };
  };
  const env = { COLLECTOR_ACCESS_KEY: "test-only", DB: { prepare,
    async batch(rows) { if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook(); }
      db.exec("BEGIN"); try { const results = []; for (const row of rows) results.push(await row.run()); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; } } } };
  const call = async body => {
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", {
      method: "POST", headers: { Origin: "https://www.gongsilbox.com", "Content-Type": "application/json" },
      body: JSON.stringify({ collectorKey: "test-only", source: "공실박스", collectorVersion: "2.3.0", ...body })
    }), env);
    const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const seed = (id, tradeType = "lease", fields = {}) => {
    db.prepare(`INSERT INTO listings (id,property_id,address,title,room,trade_type,status,operating_memo)
      VALUES (?,?,?,?,?,?,?,?)`).run(`${id}-${tradeType}`, `${id}-${tradeType}`, "서구 테스트동 123", "확인 매물", "101호",
      tradeType, "active", "사용자 확인 메모");
    db.prepare(`INSERT INTO listing_sources (id,listing_id,source,source_listing_id,trade_type,active,missing_count,last_collected_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(`source-${id}-${tradeType}`, `${id}-${tradeType}`, "공실박스", `${id}::${tradeType}`, tradeType,
      fields.active ?? 1, fields.missingCount ?? 0, "2026-09-01T00:00:00.000Z", new Date(clock - 60_000).toISOString());
  };
  const finalize = (sessionId, ids, fields = {}) => {
    clock += 1_000; t.mock.timers.setTime(clock);
    const providerIds = Array.isArray(fields.providerObservedSourceIds) ? fields.providerObservedSourceIds : ids;
    return call({ action: "finalizeCollectionSession", sessionId,
      tradeType: "lease", collectionTradeType: "lease", presenceVersion: 1, presenceScope: scope(), complete: true,
      validationVersion: 3, scope: "공실박스 현재 지도 전체결과", expectedCount: ids.length,
      manifestCount: ids.length, processedCount: ids.length, observedSourceIds: ids,
      completionProof: proof(providerIds, { providerExpectedCount: fields.providerExpectedCount ?? providerIds.length }),
      observedOffers: ids.map(sourceId => ({ sourceId, tradeType: "lease" })), ...fields });
  };
  const sourceState = (id, tradeType = "lease") => db.prepare("SELECT active,missing_count FROM listing_sources WHERE id=?")
    .get(`source-${id}-${tradeType}`);
  return { db, seed, call, finalize, sourceState, statements, beforeBatch: hook => { beforeBatch = hook; } };
}

test("v3 Gongsil baseline ends an absent original on the next proved census, never auto-contracting its master", async t => {
  const f = database(t); f.seed("tracked"); f.seed("outside"); f.seed("tracked", "sale");
  const baseline = await f.finalize("baseline", [...filler, "tracked"]);
  assert.equal(baseline.presenceScopeEstablished, true); assert.equal(baseline.missingMarked, 0);
  for (let pass = 1; pass <= 3; pass++) {
    const result = await f.finalize(`miss-${pass}`, filler);
    assert.equal(result.complete, true); assert.equal(result.presenceTracking, true);
    assert.equal(result.missingMarked, pass === 1 ? 1 : 0);
    assert.equal(result.deactivated, pass === 1 ? 1 : 0);
    assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
    assert.deepEqual({ ...f.sourceState("outside") }, { active: 1, missing_count: 0 });
    assert.deepEqual({ ...f.sourceState("tracked", "sale") }, { active: 1, missing_count: 0 });
    const replay = await f.finalize(`miss-${pass}`, filler);
    assert.equal(replay.replayed, true); assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
  }
  const master = f.db.prepare("SELECT status,operating_memo FROM listings WHERE id='tracked-lease'").get();
  assert.deepEqual({ ...master }, { status: "active", operating_memo: "사용자 확인 메모" });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM collector_source_presence WHERE source_listing_id='tracked::lease'").get().n, 1);
});

test("legacy v2 clients without census proof cannot infer absence, even after repeated complete runs", async t => {
  const f = database(t); f.seed("tracked");
  await f.finalize("v3-base", [...filler, "tracked"]);
  for (let pass = 1; pass <= 3; pass++) {
    const result = await f.finalize(`legacy-${pass}`, filler, { validationVersion: 2, completionProof: null });
    assert.equal(result.complete, true);
    assert.equal(result.presenceTracking, false);
    assert.equal(result.missingMarked, 0); assert.equal(result.deactivated, 0);
    assert.deepEqual({ ...f.sourceState("tracked") }, { active: 1, missing_count: 0 });
  }
});

test("failed, stopped, incomplete, mixed-scope and unproved selections never add misses", async t => {
  const f = database(t); f.seed("tracked"); await f.finalize("baseline", [...filler, "tracked"]);
  for (const [index, fields] of [
    { complete: false }, { stopped: true }, { failed: 1 }, { truncated: true },
    { manifestCount: 99 }, { presenceScope: null }, { presenceScope: scope({ selectionKind: "largest-cluster" }) },
    { completionProof: proof(filler, { terminalReached: false }) },
    { completionProof: proof(filler, { scopeVerified: false }) },
    { completionProof: proof(filler, { providerExpectedCount: 101 }) }
  ].entries()) {
    const result = await f.finalize(`unsafe-${index}`, filler, fields);
    assert.equal(result.missingMarked, 0);
    assert.deepEqual({ ...f.sourceState("tracked") }, { active: 1, missing_count: 0 });
  }
  const result = await f.finalize("foreign-market", filler,
    { observedOffers: filler.map(sourceId => ({ sourceId, tradeType: "sale" })) });
  assert.equal(result.complete, false); assert.equal(result.missingMarked, 0);
});

test("different viewports and filters establish separate baselines instead of adding cross-scope misses", async t => {
  const f = database(t); f.seed("tracked"); await f.finalize("baseline", [...filler, "tracked"]);
  for (const [index, altered] of [scope({ bounds: [36.3, 127.3, 36.6, 127.6] }), scope({ filtersHash: "b".repeat(64) })].entries()) {
    const result = await f.finalize(`different-${index}`, filler, { presenceScope: altered });
    assert.equal(result.presenceScopeEstablished, true); assert.equal(result.missingMarked, 0);
    assert.deepEqual({ ...f.sourceState("tracked") }, { active: 1, missing_count: 0 });
  }
  const result = await f.finalize("first-same-scope-miss", filler);
  assert.equal(result.deactivated, 1);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
});

test("complete mixed advertisements are isolated into both markets; scoped automation ages only its chosen market", async t => {
  const f = database(t); f.seed("tracked"); f.seed("tracked", "sale");
  const all = [...filler, "tracked"];
  const mixed = ids => ({ collectionTradeType: "", observedOffers: ids.flatMap(sourceId =>
    [{ sourceId, tradeType: "lease" }, { sourceId, tradeType: "sale" }]) });
  const baseline = await f.finalize("mixed-baseline", all, mixed(all));
  assert.equal(baseline.complete, true); assert.equal(baseline.presenceTracking, true);
  await f.finalize("lease-only", filler);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
  assert.deepEqual({ ...f.sourceState("tracked", "sale") }, { active: 1, missing_count: 0 });
  await f.finalize("mixed-miss", filler, mixed(filler));
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
  assert.deepEqual({ ...f.sourceState("tracked", "sale") }, { active: 0, missing_count: 1 });
});

test("a partial observation cancels misses in every established scope without proving a full collection", async t => {
  const f = database(t); f.seed("tracked");
  await f.finalize("baseline-a", [...filler, "tracked"]);
  await f.finalize("baseline-b", [...filler, "tracked"], { presenceScope: scope({ filtersHash: "b".repeat(64) }) });
  await f.finalize("miss-a", filler);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
  await f.finalize("partial-return-a", ["tracked"], { complete: false });
  assert.equal(f.db.prepare("SELECT SUM(missing_count) n FROM collector_source_presence WHERE source_listing_id='tracked::lease'").get().n, 0);
  await f.finalize("miss-b", filler, { presenceScope: scope({ filtersHash: "b".repeat(64) }) });
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
  const returned = await f.finalize("partial-return-b", ["tracked"], { complete: false });
  assert.equal(returned.complete, false); assert.equal(returned.adsReappeared, 1);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 1, missing_count: 0 });
  assert.equal(f.db.prepare("SELECT SUM(missing_count) n FROM collector_source_presence WHERE source_listing_id='tracked::lease'").get().n, 0);
  await f.finalize("new-miss-a", filler);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
});

test("bulk scope membership is a bounded number of SQL statements, not one write per offer", async t => {
  const f = database(t);
  const ids = Array.from({ length: 5000 }, (_, index) => `provider-${index}`);
  const result = await f.finalize("large-baseline", ids);
  assert.equal(result.presenceScopeEstablished, true);
  const writes = f.statements.filter(sql => /INSERT INTO collector_source_presence|UPDATE collector_source_presence/.test(sql));
  assert.equal(writes.length, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM collector_source_presence").get().n, 5000);
});

test("full provider proof can age a now-empty selected market without saving or aging the opposite market", async t => {
  const f = database(t); f.seed("tracked"); f.seed("tracked", "sale");
  await f.finalize("baseline", [...filler, "tracked"]);
  const result = await f.finalize("empty-lease", [], { providerExpectedCount: filler.length,
    providerObservedSourceIds: filler });
  assert.equal(result.complete, true); assert.equal(result.expectedCount, 0); assert.equal(result.providerExpectedCount, 100);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
  assert.deepEqual({ ...f.sourceState("tracked", "sale") }, { active: 1, missing_count: 0 });
  const corrupt = await f.finalize("corrupt-full-proof", filler, {
    providerExpectedCount: 101, providerObservedSourceIds: filler.slice(1) });
  assert.equal(corrupt.complete, false); assert.equal(corrupt.missingMarked, 0);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 0, missing_count: 1 });
});

test("concurrent re-observation between presence read and commit cannot age or deactivate a freshly seen source", async t => {
  const f = database(t); f.seed("tracked");
  await f.finalize("baseline", [...filler, "tracked"]);
  f.beforeBatch(() => {
    f.db.prepare(`UPDATE listing_sources SET active=1,missing_count=0,last_collected_at=?,updated_at=?,session_id=?
      WHERE id='source-tracked-lease'`).run("2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z", "different-run-observed");
    f.db.prepare(`UPDATE collector_source_presence SET missing_count=0,last_seen_at=?,updated_at=?
      WHERE source_listing_id='tracked::lease'`).run("2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
  });
  const result = await f.finalize("racing-first-miss", filler);
  assert.equal(result.missingMarked, 0); assert.equal(result.deactivated, 0);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 1, missing_count: 0 });
  assert.equal(f.db.prepare("SELECT missing_count FROM collector_source_presence WHERE source_listing_id='tracked::lease'").get().missing_count, 0);
});

test("concurrent source-only save also prevents a stale full-scope miss even before its own finalization", async t => {
  const f = database(t); f.seed("tracked"); await f.finalize("baseline", [...filler, "tracked"]);
  f.beforeBatch(() => {
    f.db.prepare(`UPDATE listing_sources SET active=1,missing_count=0,last_collected_at=?,updated_at=?,session_id=?
      WHERE id='source-tracked-lease'`).run("2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z", "saved-not-finalized");
  });
  const result = await f.finalize("stale-first-miss", filler);
  assert.equal(result.missingMarked, 0); assert.equal(result.deactivated, 0);
  assert.deepEqual({ ...f.sourceState("tracked") }, { active: 1, missing_count: 0 });
});

function scopeHelpers(context) {
  const source = fs.readFileSync("js/gongsil-collector.js", "utf8");
  const names = ["stableGongsilScopeJson", "capturedGongsilPresenceScope", "observedSourceIds"];
  const code = names.map(name => source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  }`, "m"))[0]).join("\n");
  vm.runInNewContext(code + "\nthis.helper = capturedGongsilPresenceScope;", context);
  return context.helper;
}
const plain = value => JSON.parse(JSON.stringify(value));
test("client scope identity excludes changing IDs and counts but rejects partial map results, deltas and filter mismatches", async () => {
  const context = { window: {}, crypto: globalThis.crypto, TextEncoder, Uint8Array,
    text: value => String(value ?? "").trim(), pick: (item, keys) => keys.map(key => item[key]).find(value => value != null) };
  const helper = scopeHelpers(context);
  const map = ids => ({ body: { level: 13, btype: "Xone", areacoord: { minlat: 36.2, minlng: 127.2, maxlat: 36.5, maxlng: 127.5 },
    removecoord: { minlat: 0, minlng: 0, maxlat: 0, maxlng: 0 }, search: { sch_lndtype: ["상가"], sch_lndsubtype: [] } },
    groups: [{ fidxs: ids }] });
  const capture = ids => ({ body: { level: 13, btype: "Xone", bfidxs: ids } });
  const items = ids => ids.map(Bfidx => ({ Bfidx }));
  context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__ = { capture: map(["one", "two"]) };
  const first = await helper(capture(["one", "two"]), items(["one", "two"]));
  assert.ok(validatedGongsilPresenceScope(plain(first)));
  context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture = map(["one", "new"]);
  assert.deepEqual(plain(await helper(capture(["one", "new"]), items(["one", "new"]))), plain(first));
  assert.equal(await helper(capture(["one"]), items(["one"])), null);
  assert.equal(await helper(capture(["one", "new"]), items(["one", "new", "outside"])), null);
  context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.body.removecoord.minlat = 36;
  assert.equal(await helper(capture(["one", "new"]), items(["one", "new"])), null);
  context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture = map(["one", "new"]);
  const mismatched = capture(["one", "new"]); mismatched.body.btype = "Xother";
  assert.equal(await helper(mismatched, items(["one", "new"])), null);
  context.window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture = null;
  assert.equal(await helper(capture(["one", "new"]), items(["one", "new"])), null);
});
