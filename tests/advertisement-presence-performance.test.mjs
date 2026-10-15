import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { advertisementScopeKey, trackAdvertisementPresence } from "../cloudflare/src/advertisement-presence.js";

const SOURCE = "네이버";
const SOURCE_COUNT = 90_000;
const OBSERVED_COUNT = 8_000;
const scope = regionCode => ({ version: 1, selectionKind: "provider-region", regionCode,
  filters: { tradeTypes: ["B2"], realEstateTypes: ["SG"] } });

function positiveStatement(sql) {
  return /SELECT (?:s\.)?id,(?:s\.)?listing_id,(?:s\.)?active FROM (?:observed|listing_sources)\b/.test(sql) ||
    /UPDATE listing_sources SET active=1/.test(sql) ||
    /UPDATE collector_source_presence SET missing_count=0/.test(sql);
}

function assertObservedDrivenPlan(sql, plan) {
  const details = plan.map(row => row.detail);
  assert.ok(details.some(detail => /MATERIALIZE observed/.test(detail)),
    "Materialize the observed ID/market pairs once, not once per historic source");
  assert.ok(details.some(detail => /SCAN observed/.test(detail)), "The observed set drives the lookup");
  const presence = /UPDATE collector_source_presence/.test(sql);
  assert.ok(details.some(detail => presence
    ? /SEARCH p USING (?:COVERING )?INDEX idx_collector_source_presence_observed \(source=\? AND trade_type=\? AND source_listing_id=\?\)/.test(detail)
    : /SEARCH s USING INDEX sqlite_autoindex_listing_sources_\d+ \(source=\? AND source_listing_id=\?\)/.test(detail)),
  "Each observed identity uses the full source/ID index (and presence market index)");
  assert.ok(!details.some(detail => /SEARCH (?:s|p|listing_sources|collector_source_presence) .*\(source=\?\)$/.test(detail)),
    "A source-only scan must not return to the provider's historic inventory");
  const byId = new Map(plan.map(row => [row.id, row]));
  for (const row of plan.filter(entry => /SCAN .*VIRTUAL TABLE/.test(entry.detail))) {
    let parent = byId.get(row.parent);
    while (parent) {
      assert.doesNotMatch(parent.detail, /CORRELATED/,
        "Do not parse and scan the observed JSON inside a correlated historic-row subquery");
      parent = byId.get(parent.parent);
    }
  }
}

async function fixture(t) {
  let clock = Date.parse("2026-10-15T03:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: clock });
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const name of fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(name, migrations), "utf8"));
  }
  t.after(() => db.close());
  const keys = await Promise.all(Array.from({ length: 6 }, (_, index) => advertisementScopeKey(SOURCE, scope("region-" + index))));
  const prior = "2026-10-15T00:00:00.000Z";
  const master = db.prepare(`INSERT OR IGNORE INTO listings
    (id,property_id,status,trade_type,operating_memo,room,first_collected_at,updated_at)
    VALUES (?,?,'active',?,'사용자 메모 보존','1층','2023-01-01',?)`);
  const source = db.prepare(`INSERT INTO listing_sources
    (id,listing_id,source,source_listing_id,trade_type,active,missing_count,session_id,
      first_collected_at,last_collected_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'baseline','2023-01-01',?,?)`);
  const presence = db.prepare(`INSERT INTO collector_source_presence
    (scope_key,source,trade_type,source_listing_id,missing_count,last_seen_at,last_checked_session_id,updated_at)
    VALUES (?,?,?,?,?,?,'baseline',?)`);
  const seed = (id, options = {}) => {
    const provider = options.source || SOURCE, market = options.market || "lease", region = options.region ?? 0;
    const parent = "M-" + region + "-" + market + "-" + provider;
    const active = options.active ?? 1, at = options.at || prior;
    master.run(parent, parent, market, prior);
    source.run("O-" + id + "-" + provider, parent, provider, id, market, active,
      options.missing ?? (active ? 0 : 1), at, at);
    if (options.presence !== false) presence.run(keys[region], provider, market, id,
      options.missing ?? (active ? 0 : 1), at, at);
  };
  // The same daily read must stay cheap even when old inactive advertisements
  // outnumber this district's current observed IDs by more than ten to one.
  db.exec("BEGIN");
  for (let index = 0; index < SOURCE_COUNT; index += 1) {
    const observed = index < OBSERVED_COUNT;
    seed("ad-" + index, observed
      ? { active: index < 64 ? 0 : 1 }
      : { source: index % 9 === 0 ? "당근" : SOURCE, market: index % 5 === 0 ? "sale" : "lease",
        region: 1 + index % 5, active: index % 11 === 0 ? 1 : 0 });
  }
  seed("missing"); seed("missing-race"); seed("missing-newer");
  seed("newer-positive", { active: 0 }); seed("wrong-market", { market: "sale", active: 0 });
  seed("ad-0", { source: "당근", active: 0 });
  presence.run(keys[4], SOURCE, "lease", "ad-1", 1, prior, prior);
  db.exec("COMMIT");
  const queries = [], positivePlans = [];
  let beforeRun, beforeBatch;
  function prepare(sql, values = []) {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, number) => { indexes.push(Number(number) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    const execute = async method => {
      const bindings = args();
      if (positiveStatement(sql)) {
        const plan = db.prepare("EXPLAIN QUERY PLAN " + compiled).all(...bindings);
        assertObservedDrivenPlan(sql, plan); // Fail before executing a quadratic regression.
        positivePlans.push(plan.map(row => row.detail));
      }
      queries.push({ sql, bindings: values.length });
      if (beforeRun) await beforeRun(sql);
      const statement = db.prepare(compiled);
      if (method === "all") return { results: statement.all(...bindings) };
      if (method === "first") return statement.get(...bindings) || null;
      return { meta: { changes: Number(statement.run(...bindings).changes) } };
    };
    return { bind: (...parameters) => prepare(sql, parameters),
      all: () => execute("all"), first: () => execute("first"), run: () => execute("run") };
  }
  const env = { DB: { prepare, async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook(); }
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run());
      db.exec("COMMIT"); return results;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  const body = (offers, region = 0) => ({ validationVersion: 3, presenceScope: scope("region-" + region),
    completionProof: { version: 1, terminalReached: true, listComplete: true, scopeVerified: true, issueCodes: [],
      observedUniqueCount: offers.length, expectedCountKnown: true, providerExpectedCount: offers.length,
      capturedAt: new Date().toISOString(), emptyConfirmed: offers.length === 0 } });
  const offers = Array.from({ length: OBSERVED_COUNT }, (_, index) => ({ sourceId: "ad-" + index, tradeType: "lease" }));
  const run = (sessionId, entries = offers, options = {}) => trackAdvertisementPresence(env, {
    source: SOURCE, sessionId, offers: entries, markets: ["lease"], complete: true,
    providerCount: entries.length, body: body(entries), ...options });
  const state = (id, provider = SOURCE) => ({ ...db.prepare(`SELECT active,missing_count,session_id,
    last_collected_at,updated_at FROM listing_sources WHERE source=? AND source_listing_id=?`).get(provider, id) });
  const scoped = (id, region = 0) => ({ ...db.prepare(`SELECT missing_count,last_seen_at,last_checked_session_id,updated_at
    FROM collector_source_presence WHERE scope_key=? AND source=? AND trade_type='lease' AND source_listing_id=?`)
    .get(keys[region], SOURCE, id) });
  const step = () => { clock += 1_000; t.mock.timers.setTime(clock); return new Date().toISOString(); };
  return { db, run, offers, body, state, scoped, step, keys, queries, positivePlans,
    beforeRun: hook => { beforeRun = hook; }, beforeBatch: hook => { beforeBatch = hook; } };
}

test("90k historic sources and 8k observations use observed-driven lookups while preserving presence/CAS/evidence semantics", async t => {
  const f = await fixture(t);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_sources").get().n, SOURCE_COUNT + 6);
  const previousQuadratic = `SELECT id,listing_id,active FROM listing_sources s WHERE source=?1
    AND (active=0 OR missing_count<>0) AND updated_at<=?2 AND EXISTS
      (SELECT 1 FROM json_each(?3) seen WHERE json_extract(seen.value,'$.sourceId')=s.source_listing_id
      AND json_extract(seen.value,'$.tradeType')=COALESCE(NULLIF(s.trade_type,''),'lease'))`;
  assert.equal(positiveStatement(previousQuadratic), true);
  const oldPlan = f.db.prepare("EXPLAIN QUERY PLAN " + previousQuadratic)
    .all(SOURCE, new Date().toISOString(), JSON.stringify(f.offers));
  assert.throws(() => assertObservedDrivenPlan(previousQuadratic, oldPlan), /Materialize the observed/,
    "The exact old quadratic SELECT must fail this guard before its 90k × 8k scan executes");
  const mastersBefore = f.db.prepare("SELECT * FROM listings ORDER BY id").all();
  const outsideBefore = f.state("ad-85008"), outsidePresence = f.scoped("ad-85008", 4);
  assert.equal(outsideBefore.active, 1);
  const wrongMarketBefore = f.state("wrong-market"), otherProviderBefore = f.state("ad-0", "당근");
  const activeSaleBefore = f.state("ad-85030"); assert.equal(activeSaleBefore.active, 1);
  const newer = f.step();
  f.db.prepare("UPDATE listing_sources SET updated_at=?,session_id='newer-save' WHERE source_listing_id IN ('newer-positive','missing-newer')")
    .run(newer);
  const captured = f.body(f.offers);
  f.step();
  f.db.prepare("UPDATE listing_sources SET updated_at=?,session_id='newer-save' WHERE source_listing_id IN ('newer-positive','missing-newer')")
    .run(new Date().toISOString());
  const newerPositiveBefore = f.state("newer-positive"), missingNewerBefore = f.state("missing-newer");
  let raced = false;
  f.beforeRun(sql => {
    if (raced || !/UPDATE listing_sources SET active=1/.test(sql)) return;
    raced = true;
    const at = f.step();
    f.db.prepare("UPDATE listing_sources SET updated_at=?,session_id='positive-race' WHERE source=? AND source_listing_id='ad-0'")
      .run(at, SOURCE);
  });
  const partialEntries = f.offers.concat([f.offers[1], f.offers[1], { sourceId: "newer-positive", tradeType: "lease" },
    { sourceId: "wrong-market", tradeType: "lease" }]);
  const partialBody = { ...captured, completionProof: { ...captured.completionProof,
    observedUniqueCount: partialEntries.length, providerExpectedCount: partialEntries.length } };
  const partial = await f.run("partial-positive", partialEntries, { complete: false, body: partialBody });
  f.beforeRun(null);
  assert.equal(partial.presenceTracking, false); assert.equal(partial.deactivated, 0);
  assert.equal(partial.adsReappeared, 63); assert.equal(partial.presenceReset, 63);
  assert.equal(new Set(partial.affectedListingIds).size, 1);
  assert.equal(partial.affectedListingIds.length, 63, "Repeated observed pairs do not multiply successful source transitions");
  assert.equal(f.state("ad-0").active, 0); assert.equal(f.state("ad-0").session_id, "positive-race");
  assert.equal(f.state("ad-1").active, 1); assert.equal(f.scoped("ad-1", 4).missing_count, 0,
    "Positive evidence resets the same advertisement across prior scopes without ending any other ad");
  assert.deepEqual(f.state("newer-positive"), newerPositiveBefore);
  assert.deepEqual(f.state("wrong-market"), wrongMarketBefore);
  assert.deepEqual(f.state("ad-0", "당근"), otherProviderBefore);
  assert.equal(f.state("missing").active, 1); assert.equal(f.state("missing-race").active, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_source_availability").get().n, 0);

  const queriesBeforeFull = f.queries.length;
  f.beforeBatch(() => {
    const at = f.step();
    f.db.prepare("UPDATE listing_sources SET updated_at=?,last_collected_at=?,session_id='missing-race' WHERE source_listing_id='missing-race'")
      .run(at, at);
  });
  const full = await f.run("complete-current", f.offers, { body: captured });
  assert.equal(full.presenceTracking, true); assert.equal(full.missingMarked, 1); assert.equal(full.deactivated, 1);
  assert.equal(full.adsReappeared, 0); assert.equal(full.presenceReset, 0);
  assert.equal(f.state("missing").active, 0); assert.equal(f.scoped("missing").missing_count, 1);
  assert.equal(f.state("missing-race").active, 1); assert.equal(f.scoped("missing-race").missing_count, 0);
  assert.deepEqual(f.state("missing-newer"), missingNewerBefore);
  assert.deepEqual(f.state("ad-85008"), outsideBefore); assert.deepEqual(f.scoped("ad-85008", 4), outsidePresence);
  assert.deepEqual(f.state("ad-85030"), activeSaleBefore);
  const annotations = f.db.prepare("SELECT source_id,kind,evidence_json,updated_at FROM listing_source_availability").all();
  assert.equal(annotations.length, 1); assert.equal(annotations[0].source_id, "O-missing-네이버");
  assert.equal(annotations[0].kind, "census_missing");
  const evidence = JSON.parse(annotations[0].evidence_json);
  assert.equal(evidence.sessionId, "complete-current"); assert.equal(evidence.capturedAt, captured.completionProof.capturedAt);
  assert.equal(evidence.checkedAt, annotations[0].updated_at); assert.equal(evidence.scopeKey, f.keys[0]);
  assert.equal(evidence.providerEndVerified, false); assert.equal(evidence.validationVersion, 3);

  const missingBefore = f.state("missing"), presenceBefore = f.scoped("missing");
  const late = await f.run("late-old-positive", [{ sourceId: "missing", tradeType: "lease" }],
    { complete: false, body: { ...captured, completionProof: { ...captured.completionProof, observedUniqueCount: 1, providerExpectedCount: 1 } } });
  assert.equal(late.presenceReset, 0); assert.equal(late.adsReappeared, 0);
  assert.deepEqual(f.state("missing"), missingBefore); assert.deepEqual(f.scoped("missing"), presenceBefore);
  assert.deepEqual(f.db.prepare("SELECT * FROM listings ORDER BY id").all(), mastersBefore,
    "Source census updates do not rewrite canonical keys, registration, room, memo or contract state");
  assert.ok(f.positivePlans.length >= 6);
  assert.ok(f.queries.length - queriesBeforeFull <= 15, "8k observed ads do not cause per-ad completion queries");
  assert.ok(f.queries.every(query => query.bindings <= 6));

  // Even at this inventory size, failed evidence creation must roll back the
  // corresponding disappearance transitions and scope counters together.
  const rollbackId = "rollback-missing";
  f.db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,trade_type,active,missing_count,
    session_id,last_collected_at,updated_at) VALUES (?,'M-0-lease-네이버',?,?,'lease',1,0,'baseline',?,?)`)
    .run("O-" + rollbackId, SOURCE, rollbackId, "2026-10-15T00:00:00.000Z", "2026-10-15T00:00:00.000Z");
  f.db.prepare(`INSERT INTO collector_source_presence(scope_key,source,trade_type,source_listing_id,
    missing_count,last_seen_at,last_checked_session_id,updated_at) VALUES (?,?,'lease',?,0,?,'baseline',?)`)
    .run(f.keys[0], SOURCE, rollbackId, "2026-10-15T00:00:00.000Z", "2026-10-15T00:00:00.000Z");
  const rollbackBefore = f.state(rollbackId), rollbackPresence = f.scoped(rollbackId);
  f.step();
  f.beforeRun(sql => { if (/INSERT INTO listing_source_availability/.test(sql)) throw new Error("fixture-evidence-failed"); });
  await assert.rejects(f.run("failed-evidence"), /fixture-evidence-failed/);
  f.beforeRun(null);
  assert.deepEqual(f.state(rollbackId), rollbackBefore); assert.deepEqual(f.scoped(rollbackId), rollbackPresence);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_source_availability").get().n, 1);
  t.diagnostic(`${SOURCE_COUNT + 6} source rows, ${OBSERVED_COUNT} observed IDs, ${f.positivePlans.length} indexed positive plans; no wall-clock threshold`);
});
