import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleD1GetAction, sourceListingSearchIndex } from "../cloudflare/src/d1-api.js";
import { koreanCalendarDay } from "../cloudflare/src/new-listing-period.js";
import { publicSourceWhereSql } from "../cloudflare/src/source-availability.js";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../cloudflare/migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL("../cloudflare/migrations/" + name, import.meta.url), "utf8"));
  }
  t.after(() => db.close());
  const queries = [];
  const env = { DB: { prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { queries.push({ sql, values }); return db.prepare(sql).get(...values) || null; },
      async all() { queries.push({ sql, values }); return { results: db.prepare(sql).all(...values) }; }
    };
  } } };
  function master(id, patch = {}) {
    const row = { property_id: id, address: "서구 검수동 1", room: "1층", status: "active", trade_type: "lease",
      first_collected_at: koreanCalendarDay() + " 09:00", operating_memo: "보존할 메모", ...patch };
    const fields = ["id", ...Object.keys(row)];
    db.prepare(`INSERT INTO listings (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(id, ...Object.values(row));
  }
  const insert = db.prepare(`INSERT INTO listing_sources
    (id,listing_id,source,source_listing_id,source_url,active,missing_count,list_snapshot_json,raw_json,updated_at,last_collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,'2020-01-02T00:00:00Z','2020-01-01T00:00:00Z')`);
  function source(id, parent, provider, number, { active = 1, kind = "", market = "lease", photoCount = 7 } = {}) {
    const thumbnail = "https://example.test/" + id + ".jpg";
    insert.run(id, parent, provider, number, "https://example.test/ad/" + id, active, active ? 0 : 1,
      JSON.stringify({ originalId: id, propertyId: parent, source: provider, tradeType: market,
        room: "1층", deposit: 1000, rent: 60, thumbnail, photoCount, type: "일반상가" }),
      provider === "공실박스" ? JSON.stringify({ list: { Photos: Array.from({ length: photoCount }, (_, i) => i ? thumbnail + "?photo=" + i : thumbnail) } }) : "{}");
    if (kind) {
      const proof = { version: 1, validationVersion: 3, reason: "scoped-census-missing",
        scopeKey: "naver-region-v1-" + "a".repeat(64), sessionId: "verified-session",
        capturedAt: "2020-01-02T00:00:00Z", checkedAt: "2020-01-03T00:00:00Z" };
      db.prepare(`INSERT INTO listing_source_availability(source_id,kind,evidence_json,updated_at)
        VALUES (?,?,?,'2020-01-03T00:00:00Z')`).run(id, kind, JSON.stringify(proof));
    }
    return { id, parent, thumbnail, photoCount };
  }
  function legacyIndex(ids = null) {
    const scope = ids ? ` AND s.listing_id IN (${ids.map(() => "?").join(",")})` : "";
    const rows = db.prepare(`SELECT s.listing_id,s.source,s.source_listing_id
      FROM listing_sources s JOIN listings l ON l.id=s.listing_id
      WHERE l.status<>'deleted' AND ${publicSourceWhereSql("s")}
        AND s.source IN ('네이버','당근','공실박스','직접등록','직접확인')
        AND NOT EXISTS (SELECT 1 FROM listing_data_quality_holds quality_hold
          WHERE quality_hold.listing_id=l.id AND quality_hold.state='open' AND quality_hold.blocks_publication=1)
        ${scope} ORDER BY s.rowid`).all(...(ids || []));
    return sourceListingSearchIndex(rows);
  }
  function snapshot() {
    return ["listings", "listing_sources", "listing_source_availability", "listing_media", "listing_history"]
      .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  }
  return { db, env, queries, master, source, legacyIndex, snapshot };
}

function expand(result, parent) {
  return result.groups[parent].map(values => Object.fromEntries(result.fields.map((field, index) => [field, values[index]])));
}

function assertSingleScan(queries, expectedPages) {
  const sources = queries.filter(query => /SELECT rowid AS __page_cursor,[\s\S]*FROM listing_sources WHERE/.test(query.sql));
  assert.ok(!queries.some(query => /FROM listing_sources s JOIN listings/.test(query.sql)), "The old whole-index SELECT is not issued");
  assert.equal(sources.length, expectedPages, "Only the existing rowid source pages are queried; no second index scan");
  for (const query of sources) {
    assert.match(query.sql, /rowid >/);
    assert.doesNotMatch(query.sql, /OFFSET|FROM listing_sources s JOIN listings/);
  }
}

test("one public-source scan preserves the old search IDs, row order, candidate proof and photos", async t => {
  const f = fixture(t);
  for (const id of ["live", "legacy", "held", "resolved", "nonblock", "deleted"]) f.master(id, { status: id === "deleted" ? "deleted" : "active" });
  const kept = [
    f.source("z-first", "live", "네이버", "네이버-9001::lease"),
    f.source("a-second", "live", "당근", "9002"),
    f.source("missing-third", "live", "네이버", "9003", { active: 0, kind: "census_missing", photoCount: 16 }),
    f.source("same-public-number", "live", "네이버", "9001"),
    f.source("unknown-provider", "live", "알수없음", "9004"),
    f.source("direct", "live", "직접등록", "9005"),
    f.source("legacy-first", "legacy", "공실박스", "9006::sale", { active: 0, kind: "legacy_candidate", market: "sale" }),
    f.source("resolved-ad", "resolved", "당근", "9007"),
    f.source("nonblock-ad", "nonblock", "직접확인", "9008")
  ];
  f.source("archive", "live", "네이버", "9100", { active: 0, kind: "legacy_unverified" });
  f.source("unclassified", "live", "당근", "9101", { active: 0 });
  f.source("held-ad", "held", "네이버", "9102");
  f.source("deleted-ad", "deleted", "네이버", "9103");
  f.source("orphan", null, "네이버", "9104");
  for (const [id, state, blocks] of [["held", "open", 1], ["resolved", "resolved", 1], ["nonblock", "open", 0]]) {
    f.db.prepare("INSERT INTO listing_data_quality_holds(listing_id,issue_code,state,blocks_publication) VALUES (?,'fixture',?,?)").run(id, state, blocks);
  }
  const before = f.snapshot();
  const expectedIndex = f.legacyIndex();
  const result = await handleD1GetAction(f.env, {}, { action: "unifiedListings" });
  assert.deepEqual(result.sourceSearchIds, expectedIndex);
  assert.deepEqual(result.sourceSearchIds.live, ["n:9001", "d:9002", "n:9003", "m:9005"]);
  assert.equal(result.originalCount, kept.length);
  assert.equal(result.unavailableCount, 2);
  assert.deepEqual(expand(result, "live").map(original => original.originalId), kept.filter(row => row.parent === "live").map(row => row.id));
  for (const expected of kept) {
    const original = expand(result, expected.parent).find(row => row.originalId === expected.id);
    assert.ok(original, "No public advertisement is dropped: " + expected.id);
    assert.equal(original.thumbnail, expected.thumbnail);
    assert.equal(original.photoCount, expected.photoCount);
  }
  const missing = expand(result, "live").find(original => original.originalId === "missing-third");
  assert.equal(missing.availabilityKind, "census_missing");
  assert.equal(missing.candidateEligible, true);
  assert.equal(missing.absenceConfirmedAt, "2020-01-03T00:00:00.000Z");
  assert.equal(expand(result, "legacy")[0].availabilityKind, "legacy_candidate");
  assert.deepEqual(f.snapshot(), before, "The optimization is read-only, including photos, candidate state and user fields");
  assertSingleScan(f.queries, 1);
});

test("the Today scoped path keeps provider IDs, market scope and publication guards identical", async t => {
  const f = fixture(t);
  f.master("today"); f.master("old", { first_collected_at: "2020-01-01" });
  f.master("sale", { trade_type: "sale", sale_category: "building" });
  f.master("held"); f.master("deleted", { status: "deleted" });
  f.source("today-nav", "today", "네이버", "네이버-123::lease");
  f.source("today-gongsil", "today", "공실박스", "456::lease");
  f.source("today-missing", "today", "당근", "789", { active: 0, kind: "census_missing" });
  f.source("old-nav", "old", "네이버", "999");
  f.source("sale-nav", "sale", "네이버", "네이버-123::sale", { market: "sale" });
  f.source("held-nav", "held", "네이버", "321");
  f.source("deleted-nav", "deleted", "네이버", "654");
  f.db.prepare("INSERT INTO listing_data_quality_holds(listing_id,issue_code,state,blocks_publication) VALUES ('held','fixture','open',1)").run();
  const before = f.snapshot();
  const result = await handleD1GetAction(f.env, {}, { action: "newListingPeriod", days: "1", market: "lease" });
  assert.deepEqual(result.items.map(row => row.id), ["today"]);
  assert.deepEqual(result.unified.sourceSearchIds, f.legacyIndex(["today"]));
  assert.deepEqual(result.unified.sourceSearchIds.today, ["n:123", "g:456", "d:789"]);
  assert.equal(result.unified.originalCount, 3);
  assert.deepEqual(expand(result.unified, "today").map(row => row.originalId), ["today-nav", "today-gongsil", "today-missing"]);
  assertSingleScan(f.queries, 1);
  assert.ok(f.queries.some(query => /FROM listing_sources/.test(query.sql) && /listing_id IN \(\?1\)/.test(query.sql) && query.values[0] === "today"));
  assert.deepEqual(f.snapshot(), before);
});

test("crossing the 4,000-row page boundary loses neither an advertisement nor a searchable ID", async t => {
  const f = fixture(t); f.master("many");
  f.db.exec("BEGIN");
  for (let i = 0; i < 4001; i += 1) f.source("S-" + String(i).padStart(5, "0"), "many", "네이버", String(100000 + i));
  f.db.exec("COMMIT");
  const before = f.db.prepare("SELECT total_changes() AS n").get().n;
  const result = await handleD1GetAction(f.env, {}, { action: "unifiedListings" });
  assert.equal(result.originalCount, 4001);
  assert.equal(result.groups.many.length, 4001);
  assert.deepEqual(result.sourceSearchIds, f.legacyIndex());
  assert.equal(result.sourceSearchIds.many.length, 4001);
  assert.equal(result.sourceSearchIds.many[0], "n:100000");
  assert.equal(result.sourceSearchIds.many.at(-1), "n:104000");
  assert.equal(expand(result, "many").at(-1).photoCount, 7);
  assertSingleScan(f.queries, 2);
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get().n, before);
});
