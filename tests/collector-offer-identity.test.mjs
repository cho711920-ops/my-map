import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  collectorProviderSourceId, collectorOfferSourceId, resolveCollectorOfferIds
} from "../cloudflare/src/collector-offer-identity.js";
import { gongsilOfferSourceId, resolveGongsilOfferIds } from "../cloudflare/src/gongsil-offers.js";

function database(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE listings (id TEXT PRIMARY KEY, trade_type TEXT NOT NULL);
    CREATE TABLE listing_sources (source TEXT, source_listing_id TEXT, listing_id TEXT, trade_type TEXT,
      UNIQUE(source, source_listing_id));
    CREATE TABLE collector_raw (id TEXT PRIMARY KEY, source TEXT, source_listing_id TEXT,
      trade_type TEXT, processing_state TEXT, created_at TEXT);`);
  t.after(() => db.close());
  const calls = [];
  const env = { DB: { prepare(sql) { return { bind(...args) { return { async all() {
    calls.push({ sql, args });
    return { results: db.prepare(sql).all(...args) };
  } }; } }; } } };
  function source(provider, id, tradeType, listingType = tradeType) {
    const listingId = `${provider}-${id}`;
    db.prepare("INSERT INTO listings VALUES (?, ?)").run(listingId, listingType);
    db.prepare("INSERT INTO listing_sources VALUES (?, ?, ?, ?)").run(provider, id, listingId, tradeType);
  }
  function pending(provider, id, type, key = "pending", state = "review", created = "2026-09-30") {
    db.prepare("INSERT INTO collector_raw VALUES (?, ?, ?, ?, ?, ?)").run(key, provider, id, type, state, created);
  }
  return { db, env, calls, source, pending };
}

test("qualified storage IDs retain the provider's original article ID", () => {
  assert.equal(collectorProviderSourceId(" 123::sale "), "123");
  assert.equal(collectorProviderSourceId("123::lease"), "123");
  assert.equal(collectorProviderSourceId(123), "123");
  assert.equal(collectorProviderSourceId("article::part"), "article::part");
  assert.equal(collectorProviderSourceId(null), "");
  assert.equal(collectorOfferSourceId("", "sale"), "");
});

test("same article has independent sale and lease identities; existing Gongsil behavior stays compatible", () => {
  for (const saved of [new Map(), new Map([["123", "lease"]]), new Map([["123", "sale"]]),
    new Map([["123", "sale"], ["123::sale", "sale"], ["123::lease", "lease"]])]) {
    for (const type of ["lease", "sale"]) {
      assert.equal(collectorOfferSourceId("123", type, saved), gongsilOfferSourceId("123", type, saved));
    }
    assert.notEqual(collectorOfferSourceId("123", "sale", saved), collectorOfferSourceId("123", "lease", saved));
  }
});

test("only an absent legacy trade defaults to lease; explicit unknown types cannot acquire an identity", () => {
  for (const missing of [undefined, null, "", " "]) assert.equal(collectorOfferSourceId("123", missing), "123::lease");
  for (const invalid of ["unknown", "jeonse", "BUY", "매매", false, 0]) {
    assert.throws(() => collectorOfferSourceId("123", invalid), /거래유형/);
  }
  assert.throws(() => collectorOfferSourceId("123", "lease", new Map([["123", "unknown"]])), /거래유형/);
});

for (const provider of ["네이버", "당근", "공실박스"]) {
  for (const legacyType of ["lease", "sale"]) {
    test(`${provider}: legacy ${legacyType} remains attached while the opposite offer gets its own ID`, async (t) => {
      const { db, env, source } = database(t);
      source(provider, "123", legacyType);
      const before = db.prepare("SELECT * FROM listing_sources").all();
      const records = [{ sourceId: "123", tradeType: "sale", sourceUrl: "https://provider.example/123" },
        { sourceId: "123", tradeType: "lease", sourceUrl: "https://provider.example/123" }];
      const resolved = await resolveCollectorOfferIds(env, provider, records);
      assert.deepEqual(resolved.map((r) => [r.sourceId, r.providerSourceId]), [
        [legacyType === "sale" ? "123" : "123::sale", "123"],
        [legacyType === "lease" ? "123" : "123::lease", "123"]
      ]);
      assert.deepEqual(resolved.map((r) => r.sourceUrl), records.map((r) => r.sourceUrl));
      assert.deepEqual(db.prepare("SELECT * FROM listing_sources").all(), before);
      assert.equal(records[0].providerSourceId, undefined, "input records are not mutated");
      if (provider === "공실박스") assert.deepEqual(resolved, await resolveGongsilOfferIds(env, records));
    });
  }
}

test("attached representative's market wins over a stale, opposite source trade type", async (t) => {
  const { env, source } = database(t);
  source("당근", "123", "sale", "lease");
  const rows = await resolveCollectorOfferIds(env, "당근", [
    { sourceId: "123", tradeType: "sale" }, { sourceId: "123", tradeType: "lease" }
  ]);
  assert.deepEqual(rows.map((r) => r.sourceId), ["123::sale", "123"]);
});

test("resolving already qualified records is idempotent and isolates providers", async (t) => {
  const { env, source } = database(t);
  source("네이버", "123", "lease");
  source("당근", "123", "sale");
  source("당근", "123::sale", "sale");
  const records = [{ sourceId: "123", tradeType: "sale" }, { sourceId: "123", tradeType: "lease" }];
  const naver = await resolveCollectorOfferIds(env, "네이버", records);
  const daangn = await resolveCollectorOfferIds(env, "당근", records);
  assert.deepEqual(naver.map((r) => r.sourceId), ["123::sale", "123"]);
  assert.deepEqual(daangn.map((r) => r.sourceId), ["123::sale", "123::lease"]);
  assert.deepEqual(await resolveCollectorOfferIds(env, "네이버", naver), naver);
  assert.deepEqual(await resolveCollectorOfferIds(env, "당근", daangn), daangn);
});

test("pending legacy rows keep their own market, but attached rows take precedence and errors do not reserve IDs", async (t) => {
  const { db, env, source, pending } = database(t);
  pending("당근", "pending-id", "lease", "older", "review", "2026-09-29");
  pending("당근", "pending-id", "sale", "newer", "review", "2026-09-30");
  pending("당근", "error-id", "sale", "error", "error");
  pending("당근", "attached-id", "sale", "attached");
  source("당근", "attached-id", "lease");
  pending("네이버", "pending-id", "lease", "other-provider");
  const before = db.prepare("SELECT * FROM collector_raw ORDER BY id").all();
  const records = ["pending-id", "error-id", "attached-id"].flatMap((sourceId) => [
    { sourceId, tradeType: "sale" }, { sourceId, tradeType: "lease" }
  ]);
  const rows = await resolveCollectorOfferIds(env, "당근", records);
  assert.deepEqual(rows.map((r) => r.sourceId), ["pending-id", "pending-id::lease",
    "error-id::sale", "error-id::lease", "attached-id::sale", "attached-id"]);
  assert.deepEqual(db.prepare("SELECT * FROM collector_raw ORDER BY id").all(), before);
});

test("a qualified source incorrectly attached to the other market fails closed instead of stealing that source", async (t) => {
  const { db, env, source } = database(t);
  source("당근", "123::sale", "sale", "lease");
  const before = db.prepare("SELECT * FROM listing_sources").all();
  await assert.rejects(resolveCollectorOfferIds(env, "당근", [{ sourceId: "123", tradeType: "sale" }]),
    /수집 원본 거래유형 충돌/);
  assert.deepEqual(db.prepare("SELECT * FROM listing_sources").all(), before);
});

test("large manifests are deduplicated and chunked below D1's binding limit without fetching payloads", async (t) => {
  const { env, calls } = database(t);
  const records = Array.from({ length: 70 }, (_, i) => String(i)).flatMap((sourceId) => [
    { sourceId, tradeType: "sale" }, { sourceId, tradeType: "lease" }
  ]);
  const rows = await resolveCollectorOfferIds(env, "네이버", records);
  assert.equal(rows.length, 140);
  assert.equal(new Set(rows.map((r) => r.sourceId)).size, 140);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.ok(call.args.length <= 97);
    assert.equal(call.args[0], "네이버");
    assert.doesNotMatch(call.sql, /payload_json|raw_json/);
  }
  assert.deepEqual(await resolveCollectorOfferIds(env, "당근", []), []);
  assert.equal(calls.length, 3);
  await assert.rejects(resolveCollectorOfferIds(env, "", []), /출처/);
});
