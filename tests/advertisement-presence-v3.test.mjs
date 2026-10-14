import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  advertisementCensusAudit, advertisementScopeKey, trackAdvertisementPresence, validatedAdvertisementScope
} from "../cloudflare/src/advertisement-presence.js";

const scope = (source = "네이버", fields = {}) => source === "공실박스" ? {
  version: 1, selectionKind: "full-map-result", bounds: [36.2, 127.2, 36.5, 127.5],
  level: 13, btype: "Xone", filtersHash: "a".repeat(64), ...fields
} : {
  version: 1, selectionKind: source === "네이버" ? "provider-region" : "provider-cluster",
  regionCode: "3017000000", filters: { tradeTypes: ["B2"], realEstateTypes: ["SG"] }, ...fields
};
const offer = (sourceId, tradeType = "lease") => ({ sourceId, tradeType });

function fixture(t) {
  let clock = Date.parse("2026-10-14T03:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: clock });
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const name of fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(name, migrations), "utf8"));
  }
  t.after(() => db.close());
  let beforeBatch;
  let beforeRun;
  const prepare = (sql, values = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, number) => { indexes.push(Number(number) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return {
      bind: (...parameters) => prepare(sql, parameters),
      async all() {
        if (beforeRun && /^\s*UPDATE\b/.test(sql)) await beforeRun(sql);
        return { results: db.prepare(compiled).all(...args()) };
      },
      async first() { return db.prepare(compiled).get(...args()) || null; },
      async run() {
        if (beforeRun) await beforeRun(sql);
        return { meta: { changes: Number(db.prepare(compiled).run(...args()).changes) } };
      }
    };
  };
  const env = { DB: { prepare, async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = undefined; await hook(); }
    db.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      db.exec("COMMIT");
      return result;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  const step = (milliseconds = 1_000) => { clock += milliseconds; t.mock.timers.setTime(clock); return new Date().toISOString(); };
  const seed = (id, fields = {}) => {
    const source = fields.source || "네이버";
    const trade = fields.tradeType || "lease";
    const listingId = fields.listingId || `listing-${id}`;
    const prior = new Date(clock - 60_000).toISOString();
    db.prepare(`INSERT OR IGNORE INTO listings (id,property_id,status,operating_memo,trade_type,updated_at)
      VALUES (?,?,?,?,?,?)`).run(listingId, listingId, "active", "사용자 메모·계약상태 보존", trade, prior);
    db.prepare(`INSERT INTO listing_sources
      (id,listing_id,source,source_listing_id,trade_type,active,missing_count,session_id,last_collected_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`source-${source}-${id}`, listingId, source, id, trade,
      fields.active ?? 1, fields.missingCount ?? 0, fields.sessionId || "initial-save", prior, prior);
    return listingId;
  };
  const state = (id, source = "네이버") => ({ ...db.prepare(`SELECT active,missing_count,last_collected_at,updated_at,session_id
    FROM listing_sources WHERE source=? AND source_listing_id=?`).get(source, id) });
  const presence = (id, source = "네이버") => db.prepare(`SELECT * FROM collector_source_presence
    WHERE source=? AND source_listing_id=? ORDER BY scope_key`).all(source, id).map(row => ({ ...row }));
  const body = (offers, fields = {}) => ({
    validationVersion: 3, presenceScope: scope(fields.source),
    completionProof: {
      version: 1, terminalReached: true, listComplete: true, scopeVerified: true, issueCodes: [],
      observedUniqueCount: offers.length, expectedCountKnown: true, providerExpectedCount: offers.length,
      emptyConfirmed: offers.length === 0, capturedAt: new Date().toISOString()
    }, ...fields
  });
  const run = (sessionId, offers, fields = {}) => {
    const source = fields.source || "네이버";
    return trackAdvertisementPresence(env, { source, sessionId, offers, markets: ["lease"],
      complete: true, providerCount: offers.length, body: body(offers, { source }), ...fields });
  };
  return { db, env, seed, state, presence, body, run, step,
    beforeBatch: hook => { beforeBatch = hook; }, beforeRun: hook => { beforeRun = hook; } };
}

test("v3 census validates exact scope, terminal/count evidence, provider-specific unknown totals and empty proof", async t => {
  const f = fixture(t);
  for (const source of ["네이버", "당근", "공실박스"]) {
    const valid = f.body([offer("a")], { source });
    assert.equal(advertisementCensusAudit(source, valid, 1).valid, true, source);
    assert.equal(validatedAdvertisementScope(source, valid.presenceScope)?.version, 1);
    for (const change of [
      { validationVersion: 2 }, { validationVersion: undefined }, { validationVersion: "bad" },
      { validationVersion: 3.5 }, { presenceScope: null },
      { completionProof: { ...valid.completionProof, terminalReached: false } },
      { completionProof: { ...valid.completionProof, listComplete: false } },
      { completionProof: { ...valid.completionProof, scopeVerified: false } },
      { completionProof: { ...valid.completionProof, issueCodes: ["page_failed"] } },
      { completionProof: { ...valid.completionProof, observedUniqueCount: 2 } },
      { completionProof: { ...valid.completionProof, providerExpectedCount: 2 } },
      { completionProof: { ...valid.completionProof, capturedAt: "invalid" } },
      { completionProof: { ...valid.completionProof, capturedAt: new Date(Date.now() + 60_001).toISOString() } }
    ]) assert.equal(advertisementCensusAudit(source, { ...valid, ...change }, 1).valid, false, JSON.stringify(change));
    const unknown = { ...valid, completionProof: { ...valid.completionProof, expectedCountKnown: false } };
    assert.equal(advertisementCensusAudit(source, unknown, 1).valid, source === "당근");
    assert.equal(advertisementCensusAudit(source, { ...valid, validationVersion: "3" }, 1).valid, true);
    assert.equal(advertisementCensusAudit(source, { ...unknown,
      completionProof: { ...unknown.completionProof, observedUniqueCount: -1 } }, -1).valid, false);
    const empty = f.body([], { source });
    assert.equal(advertisementCensusAudit(source, empty, 0).valid, true);
    empty.completionProof.emptyConfirmed = false;
    assert.equal(advertisementCensusAudit(source, empty, 0).valid, false);
  }
  const left = scope("네이버");
  const right = { filters: { realEstateTypes: ["SG"], tradeTypes: ["B2"] },
    regionCode: left.regionCode, selectionKind: left.selectionKind, version: 1 };
  assert.equal(await advertisementScopeKey("네이버", left), await advertisementScopeKey("네이버", right));
});

test("a second proven census ends only the missing source advertisement, never its master or other originals", async t => {
  const f = fixture(t);
  for (const source of ["네이버", "당근", "공실박스"]) {
    f.seed("missing", { source, listingId: "shared-master" });
    f.seed("seen", { source });
    f.seed("outside", { source });
    const baseline = await f.run(`base-${source}`, [offer("missing"), offer("seen")], { source });
    assert.equal(baseline.presenceScopeEstablished, true);
    assert.equal(baseline.deactivated, 0);
    f.step();
    const result = await f.run(`next-${source}`, [offer("seen")], { source });
    assert.equal(result.presenceTracking, true);
    assert.equal(result.presenceScopeEstablished, false);
    assert.equal(result.deactivated, 1);
    assert.equal(result.missingMarked, 1);
    assert.deepEqual(result.affectedListingIds, ["shared-master"]);
    assert.equal(f.state("missing", source).active, 0);
    assert.equal(f.state("missing", source).missing_count, 1);
    assert.equal(f.state("seen", source).active, 1);
    assert.equal(f.state("outside", source).active, 1);
    assert.equal(f.presence("missing", source)[0].missing_count, 1);
    f.step();
  }
  assert.deepEqual({ ...f.db.prepare("SELECT status,operating_memo FROM listings WHERE id='shared-master'").get() },
    { status: "active", operating_memo: "사용자 메모·계약상태 보존" });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 0);
});

test("a confirmed reappearance resets only its original and its scoped misses", async t => {
  const f = fixture(t); f.seed("a"); f.seed("b");
  await f.run("base", [offer("a"), offer("b")]); f.step();
  await f.run("miss", [offer("a")]); f.step();
  const result = await f.run("return", [offer("a"), offer("b")]);
  assert.equal(result.adsReappeared, 1); assert.equal(result.presenceReset, 1);
  assert.deepEqual(result.affectedListingIds, ["listing-b"]);
  assert.equal(f.state("b").active, 1); assert.equal(f.state("b").missing_count, 0);
  assert.equal(f.presence("b")[0].missing_count, 0);
  assert.equal(f.presence("b")[0].last_seen_at, new Date().toISOString());
});

test("partial positive evidence may clear a genuine reappearance but may never infer another absence", async t => {
  const f = fixture(t); f.seed("a"); f.seed("b");
  await f.run("base", [offer("a"), offer("b")]); f.step();
  await f.run("miss", [offer("a")]); f.step();
  const result = await f.run("partial-return", [offer("b")], { complete: false });
  assert.equal(result.presenceTracking, false); assert.equal(result.deactivated, 0);
  assert.equal(result.adsReappeared, 1); assert.equal(f.state("a").active, 1);
  assert.equal(f.state("b").active, 1); assert.equal(f.presence("b")[0].missing_count, 0);
});

test("partial, wrong-count and changed-filter/region censuses cannot age another scope", async t => {
  const f = fixture(t); f.seed("a"); f.seed("b");
  await f.run("base", [offer("a"), offer("b")]);
  for (const [index, fields] of [
    { complete: false },
    { body: f.body([offer("a")], { completionProof: {
      ...f.body([offer("a")]).completionProof, providerExpectedCount: 2
    } }) },
    { body: f.body([offer("a")], { presenceScope: scope("네이버", { filters: { tradeTypes: ["B2"], realEstateTypes: ["SMS"] } }) }) },
    { body: f.body([offer("a")], { presenceScope: scope("네이버", { regionCode: "different-region" }) }) }
  ].entries()) {
    f.step();
    const result = await f.run(`unsafe-${index}`, [offer("a")], fields);
    assert.equal(result.missingMarked, 0);
    assert.equal(result.deactivated, 0);
    assert.equal(f.state("b").active, 1);
    assert.equal(f.presence("b")[0].missing_count, 0);
  }
});

test("lease observations cannot reset or terminate a sale source with the same provider ID", async t => {
  const f = fixture(t); f.seed("collision", { tradeType: "sale" }); f.seed("lease-only");
  await f.run("sale-base", [offer("collision", "sale")], { markets: ["sale"] }); f.step();
  const lease = await f.run("lease-base", [offer("collision"), offer("lease-only")]);
  assert.equal(lease.deactivated, 0); assert.equal(f.state("collision").active, 1); f.step();
  const missingLease = await f.run("lease-next", [offer("lease-only")]);
  assert.equal(missingLease.deactivated, 0); assert.equal(f.state("collision").active, 1); f.step();
  await f.run("sale-empty", [], { markets: ["sale"] });
  assert.equal(f.state("collision").active, 0); f.step();
  const wrongMarketReturn = await f.run("lease-return", [offer("collision"), offer("lease-only")]);
  assert.equal(wrongMarketReturn.adsReappeared, 0); assert.equal(f.state("collision").active, 0);
  assert.equal(f.state("lease-only").active, 1);
});

test("empty complete results require explicit empty proof; an approved empty census ends baseline originals", async t => {
  const f = fixture(t); f.seed("a"); await f.run("base", [offer("a")]); f.step();
  const unproved = f.body([]); unproved.completionProof.emptyConfirmed = false;
  assert.equal((await f.run("empty-unproved", [], { body: unproved })).deactivated, 0);
  assert.equal(f.state("a").active, 1); f.step();
  const confirmed = await f.run("empty-confirmed", []);
  assert.equal(confirmed.deactivated, 1); assert.equal(f.state("a").active, 0);
});

test("same session replay never adds a miss or repeats an ended-source count", async t => {
  const f = fixture(t); f.seed("a"); f.seed("b");
  await f.run("base", [offer("a"), offer("b")]); f.step();
  // Even a malformed replay with a reduced list may not age the same session.
  assert.equal((await f.run("base", [offer("a")])).deactivated, 0);
  assert.equal(f.state("b").active, 1); f.step();
  assert.equal((await f.run("missing", [offer("a")])).deactivated, 1); f.step();
  assert.equal((await f.run("missing", [offer("a")])).deactivated, 0);
  assert.equal(f.state("b").missing_count, 1);
});

test("a stale census cannot end an advertisement saved after its snapshot", async t => {
  const f = fixture(t); f.seed("a"); f.seed("b");
  await f.run("base", [offer("a"), offer("b")]); f.step();
  const stale = f.body([offer("a")]); f.step();
  f.db.prepare("UPDATE listing_sources SET session_id=?,last_collected_at=?,updated_at=? WHERE source_listing_id='b'")
    .run("newer-save", new Date().toISOString(), new Date().toISOString());
  const before = f.state("b"); f.step();
  assert.equal((await f.run("stale", [offer("a")], { body: stale })).deactivated, 0);
  assert.deepEqual(f.state("b"), before);
  assert.equal(f.presence("b")[0].missing_count, 0);
});

test("a save racing after the census read is protected by the SQL compare-and-set guards", async t => {
  const f = fixture(t); f.seed("a"); f.seed("b");
  await f.run("base", [offer("a"), offer("b")]); f.step();
  f.beforeBatch(() => {
    f.step();
    f.db.prepare("UPDATE listing_sources SET session_id=?,last_collected_at=?,updated_at=? WHERE source_listing_id='b'")
      .run("concurrent-save", new Date().toISOString(), new Date().toISOString());
  });
  const result = await f.run("raced", [offer("a")]);
  assert.equal(result.deactivated, 0); assert.equal(result.missingMarked, 0);
  assert.equal(f.state("b").active, 1); assert.equal(f.state("b").session_id, "concurrent-save");
  assert.equal(f.presence("b")[0].missing_count, 0);
});

test("a stale positive snapshot cannot reactivate an original ended by a newer save", async t => {
  const f = fixture(t); f.seed("a"); await f.run("base", [offer("a")]); f.step();
  const old = f.body([offer("a")]); f.step();
  f.db.prepare("UPDATE listing_sources SET active=0,missing_count=1,session_id=?,updated_at=? WHERE source_listing_id='a'")
    .run("newer-ended", new Date().toISOString());
  const before = f.state("a"); f.step();
  const result = await f.run("late-return", [offer("a")], { body: old });
  assert.equal(result.adsReappeared, 0); assert.equal(result.presenceReset, 0);
  assert.deepEqual(f.state("a"), before);
});

test("a save racing with reappearance does not report rows rejected by the SQL time guard", async t => {
  const f = fixture(t); f.seed("a", { active: 0, missingCount: 1 });
  f.beforeRun(sql => {
    if (!/^UPDATE listing_sources SET active=1/.test(sql)) return;
    f.step();
    f.db.prepare("UPDATE listing_sources SET session_id=?,updated_at=? WHERE source_listing_id='a'")
      .run("newer-ended", new Date().toISOString());
  });
  const result = await f.run("late-return", [offer("a")]);
  assert.equal(result.adsReappeared, 0); assert.equal(result.presenceReset, 0);
  assert.deepEqual(result.affectedListingIds, []);
  assert.equal(f.state("a").active, 0); assert.equal(f.state("a").session_id, "newer-ended");
});

test("late old observed evidence cannot erase a more recent proved missing advertisement", async t => {
  const f = fixture(t); f.seed("a"); f.seed("b");
  await f.run("base", [offer("a"), offer("b")]); f.step();
  const olderObserved = f.body([offer("a"), offer("b")]); f.step();
  await f.run("newer-missing", [offer("a")]);
  const latest = f.presence("b")[0]; assert.equal(latest.missing_count, 1); f.step();
  const late = await f.run("late-older", [offer("a"), offer("b")], { body: olderObserved });
  assert.equal(late.adsReappeared, 0); assert.equal(f.state("b").active, 0);
  assert.deepEqual(f.presence("b")[0], latest);
});
