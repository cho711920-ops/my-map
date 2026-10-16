import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi } from "../cloudflare/src/collector-api.js";

function fixture(t, source) {
  let clock = Date.parse("2026-10-15T03:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: clock });
  const db = new DatabaseSync(":memory:");
  for (const name of fs.readdirSync("cloudflare/migrations").filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(`cloudflare/migrations/${name}`, "utf8"));
  }
  t.after(() => db.close());
  let failBackfill = false;
  const statements = [];
  const prepare = (sql, values = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, n) => { indexes.push(Number(n) - 1); return "?"; });
    const params = () => indexes.length ? indexes.map(index => values[index]) : values;
    return { bind: (...args) => prepare(sql, args),
      async all() { statements.push(sql); return { results: db.prepare(compiled).all(...params()) }; },
      async first() { statements.push(sql); return db.prepare(compiled).get(...params()) || null; },
      async run() {
        statements.push(sql);
        if (failBackfill && /^UPDATE listing_sources\s+SET snapshot_hash/.test(sql)) throw new Error("synthetic hash backfill failure");
        return { meta: { changes: Number(db.prepare(compiled).run(...params()).changes) } };
      } };
  };
  const env = { COLLECTOR_ACCESS_KEY: "fixture-key", DB: { prepare, async batch(rows) {
    db.exec("BEGIN");
    try { const results = []; for (const row of rows) results.push(await row.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } };
  const call = async (body, expectedStatus = 200) => {
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", {
      method: "POST", headers: { Origin: "https://fin.land.naver.com", "Content-Type": "application/json" },
      body: JSON.stringify({ collectorKey: "fixture-key", source, collectorVersion: "regression", validationVersion: 3, ...body })
    }), env);
    const result = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(result));
    return result;
  };
  const providerId = id => source === "네이버" ? `네이버-${id}` : id;
  const storageId = id => `${providerId(id)}::lease`;
  const prior = new Date(clock - 60000).toISOString();
  db.prepare(`INSERT INTO listings(id,property_id,title,address,room,trade_type,deposit,monthly_rent,area_m2,
    main_source,status,operating_memo,latitude,longitude) VALUES ('M','M','검수상가','서구 둔산동 1095','2층',
      'lease',1000,60,23.2,?,'active','사용자 메모 보존',36.35,127.38)`).run(source);
  const seed = (id, active) => {
    const snapshot = { originalId: `O-${id}`, propertyId: "M", source, tradeType: "lease", buildingName: "검수상가",
      address: "서구 둔산동 1095", room: "2층", type: "상가점포", deposit: 1000, rent: 60, area: 23.2,
      thumbnail: "https://landthumb-phinf.pstatic.net/fixture.jpg", photoCount: 1 };
    db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,trade_type,active,missing_count,
      snapshot_hash,list_snapshot_json,session_id,last_collected_at,updated_at) VALUES (?, 'M', ?, ?, 'lease', ?, ?, ?, ?, 'prior-session', ?, ?)`)
      .run(`O-${id}`, source, storageId(id), active, active ? 0 : 1, active ? "legacy-existing" : "", JSON.stringify(snapshot), prior, prior);
    if (!active) db.prepare("INSERT INTO listing_source_availability(source_id,kind,evidence_json,updated_at) VALUES (?,'legacy_candidate','{}',?)")
      .run(`O-${id}`, prior);
  };
  seed("returned", 0); seed("sibling", 1);
  const state = id => ({ ...db.prepare("SELECT * FROM listing_sources WHERE id=?").get(`O-${id}`) });
  const entry = id => ({ sourceId: providerId(id), tradeType: "lease", listSnapshot: `current-list-${id}`,
    address: "서구 둔산동 1095", room: "2층", deposit: 1000, rent: 60, area: 23.2 });
  const capture = ids => ({ ids, capturedAt: new Date().toISOString() });
  const step = () => { clock += 1000; t.mock.timers.setTime(clock); return new Date().toISOString(); };
  const classify = (sessionId, ids, expectedStatus = 200) => call({ action: "classifySourceManifest", sessionId,
    entries: ids.map(entry) }, expectedStatus);
  const finalize = (sessionId, captured, extra = {}) => call({ action: "finalizeCollectionSession", sessionId,
    tradeType: "lease", complete: true, expectedCount: captured.ids.length, manifestCount: captured.ids.length,
    processedCount: captured.ids.length, observedSourceIds: captured.ids.map(providerId),
    scope: "서구 동일 범위 전체수집", presenceScope: { version: 1,
      selectionKind: source === "네이버" ? "provider-region" : "provider-cluster", regionCode: "fixture-region",
      filters: { tradeTypes: ["MONTH"], salesTypes: ["STORE"] } },
    completionProof: { version: 1, terminalReached: true, listComplete: true, scopeVerified: true, issueCodes: [],
      expectedCountKnown: true, providerExpectedCount: captured.ids.length, observedUniqueCount: captured.ids.length,
      capturedAt: captured.capturedAt, emptyConfirmed: captured.ids.length === 0 }, ...extra });
  return { db, state, capture, step, classify, finalize, statements, failBackfill: value => { failBackfill = value; } };
}

test('Naver failed detail plus address exclusions cannot deactivate an unobserved sibling ad', async t => {
  const f=fixture(t,'네이버');
  const baseline=f.capture(['returned','sibling']); f.step();
  await f.finalize('baseline-complete',baseline);
  const sibling=f.state('sibling');
  f.step(); const captured=f.capture(['returned']); f.step();
  const result=await f.finalize('one-failed-detail',captured,{failed:1,addressMissing:81,
    diagnostics:[{stage:'상세조회',sourceId:'777',message:'상세 응답 시간초과'}]});
  assert.equal(result.state,'partial'); assert.equal(result.complete,false);
  assert.equal(result.presenceTracking,false); assert.equal(result.deactivated,0);
  assert.deepEqual(f.state('sibling'),sibling);
  assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE id='M'").get().operating_memo,'사용자 메모 보존');
  assert.equal(result.diagnostics[0].sourceId,'777');
});

for (const source of ["네이버", "당근"]) {
  test(`${source}: unchanged empty-hash manifest preserves availability clocks and the proved current ad reappears`, async t => {
    const f = fixture(t, source), before = f.state("returned"), sibling = f.state("sibling");
    const captured = f.capture(["returned", "sibling"]); f.step();
    const manifest = await f.classify("return-run", captured.ids);
    assert.equal(manifest.unchanged, 2); assert.deepEqual(manifest.needsDetail, []);
    const backfilled = f.state("returned");
    assert.match(backfilled.snapshot_hash, /^fnv1a-/);
    for (const key of ["active", "missing_count", "session_id", "last_collected_at", "updated_at", "list_snapshot_json"]) {
      assert.equal(backfilled[key], before[key], `fingerprint-only backfill must preserve ${key}`);
    }
    f.step();
    const returned = await f.finalize("return-run", captured);
    assert.equal(returned.complete, true); assert.equal(returned.adsReappeared, 1); assert.equal(returned.deactivated, 0);
    assert.equal(returned.newSourceAds, 0); assert.equal(f.state("returned").active, 1);
    assert.equal(f.state("returned").missing_count, 0);
    assert.deepEqual(f.state("sibling"), sibling);

    // One normal same-scope absence still ends just this ad; no three-run delay.
    f.step(); const missingCapture = f.capture(["sibling"]); f.step();
    const missing = await f.finalize("next-missing", missingCapture);
    assert.equal(missing.deactivated, 1); assert.equal(f.state("returned").active, 0);
    assert.equal(f.state("returned").missing_count, 1); assert.equal(f.state("sibling").active, 1);
    assert.equal(f.db.prepare("SELECT kind FROM listing_source_availability WHERE source_id='O-returned'").get().kind, "census_missing");

    // A real fingerprint match does not need details to restore the same ID.
    f.step(); const againCapture = f.capture(["returned", "sibling"]); f.step();
    assert.deepEqual((await f.classify("again", againCapture.ids)).needsDetail, []);
    f.step(); const again = await f.finalize("again", againCapture);
    assert.equal(again.adsReappeared, 1); assert.equal(again.newSourceAds, 0);
    assert.equal(f.state("returned").active, 1);
    const master = f.db.prepare("SELECT status,operating_memo FROM listings WHERE id='M'").get();
    assert.deepEqual({ ...master }, { status: "active", operating_memo: "사용자 메모 보존" });
  });

  test(`${source}: partial positive evidence restores its observed ad but never hides an unobserved sibling`, async t => {
    const f = fixture(t, source), sibling = f.state("sibling");
    const captured = f.capture(["returned"]); f.step();
    assert.equal((await f.classify("partial-return", captured.ids)).unchanged, 1);
    f.step(); const result = await f.finalize("partial-return", captured, { complete: false });
    assert.equal(result.complete, false); assert.equal(result.presenceTracking, false);
    assert.equal(result.adsReappeared, 1); assert.equal(result.deactivated, 0);
    assert.equal(f.state("returned").active, 1); assert.deepEqual(f.state("sibling"), sibling);
  });

  test(`${source}: a genuine newer absence still blocks an older unchanged-list reappearance`, async t => {
    const f = fixture(t, source), captured = f.capture(["returned"]); f.step();
    await f.classify("older-return", captured.ids);
    const newer = f.step();
    f.db.prepare("UPDATE listing_sources SET active=0,missing_count=1,session_id='newer-absence',updated_at=? WHERE id='O-returned'").run(newer);
    const before = f.state("returned");
    f.step(); const result = await f.finalize("older-return", captured);
    assert.equal(result.adsReappeared, 0); assert.equal(result.presenceReset, 0);
    assert.deepEqual(f.state("returned"), before);
  });

  test(`${source}: a failed fingerprint backfill cannot alter original activity, collection clocks, photos or memo`, async t => {
    const f = fixture(t, source), before = f.state("returned");
    f.step(); f.failBackfill(true);
    const result = await f.classify("failed-backfill", ["returned"], 400);
    assert.equal(result.ok, false); assert.match(result.message, /synthetic hash backfill failure/);
    assert.deepEqual(f.state("returned"), before);
    assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE id='M'").get().operating_memo, "사용자 메모 보존");
  });
}
