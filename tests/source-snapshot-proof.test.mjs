import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { buildD1SheetCsv, handleD1GetAction } from "../cloudflare/src/d1-api.js";
import { sourceSnapshotParent, sourceSnapshotSource, sourceSnapshotProofSql, hashSourceSnapshotProof,
  hashSourceSnapshotRows, sourceSnapshotKeysFromReadRows } from "../cloudflare/src/source-snapshot-proof.js";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../cloudflare/migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL("../cloudflare/migrations/" + name, import.meta.url), "utf8"));
  }
  t.after(() => db.close());
  let afterRead = () => {};
  const queries = [];
  const env = { DB: { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async all() {
        queries.push({ sql, values });
        const results = db.prepare(sql).all(...values);
        afterRead(sql, results);
        return { results };
      },
      async first() { return db.prepare(sql).get(...values) || null; }
    };
  } } };
  function master(id, patch = {}) {
    const row = { property_id: id, address: "대전 서구 검수동 1", room: "1층", status: "active", version: 1,
      updated_at: "2026-10-15T03:00:00Z", operating_memo: "보존 메모", ...patch };
    const columns = ["id", ...Object.keys(row)];
    db.prepare(`INSERT INTO listings (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(id, ...Object.values(row));
  }
  const insert = db.prepare(`INSERT INTO listing_sources
    (id,listing_id,source,source_listing_id,active,missing_count,snapshot_hash,updated_at,last_collected_at,list_snapshot_json,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  function source(id, parent, patch = {}) {
    const row = { source: "네이버", source_listing_id: id, active: 1, missing_count: 0, snapshot_hash: "fnv1a-12345678",
      updated_at: "2026-10-15T03:00:00Z", last_collected_at: "2026-10-15T03:00:00Z", ...patch };
    const { kind, availabilityUpdatedAt, ...stored } = row;
    insert.run(id, parent, stored.source, stored.source_listing_id, stored.active, stored.missing_count, stored.snapshot_hash,
      stored.updated_at, stored.last_collected_at, JSON.stringify({ source: stored.source, thumbnail: "https://example.test/" + id + ".jpg",
        photoCount: 7, deposit: 1000, rent: 60, room: "1층", tradeType: "lease" }), "{}");
    if (kind) db.prepare("INSERT INTO listing_source_availability(source_id,kind,updated_at) VALUES (?,?,?)")
      .run(id, kind, availabilityUpdatedAt || "2026-10-15T03:00:00Z");
  }
  const list = () => handleD1GetAction(env, {}, { action: "unifiedListings" });
  const scoped = ids => handleD1GetAction(env, {}, { action: "listingOriginals", ids });
  const proof = id => db.prepare(`SELECT ${sourceSnapshotProofSql()} AS proof FROM listings WHERE id=?`).get(id).proof;
  return { db, env, queries, master, source, list, scoped, proof, afterRead: fn => { afterRead = fn; } };
}

test("SQL and read-row JavaScript produce the same canonical SHA proof with nulls, quotes and Unicode", async t => {
  const f = fixture(t); f.master("M-한글\"\\", { updated_at: "", status: "active" });
  const id = "M-한글\"\\";
  f.source("O-한글\n\"", id, { source_listing_id: "123::lease", snapshot_hash: "", last_collected_at: "" });
  f.source("O-null", id, { source: "당근", source_listing_id: "456", snapshot_hash: "", updated_at: "", last_collected_at: "" });
  f.source("O-missing", id, { source_listing_id: "789", active: 0, missing_count: 1, kind: "census_missing" });
  const parent = f.db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  const rows = f.db.prepare(`SELECT s.*,a.kind AS availability_kind,a.updated_at AS availability_updated_at
    FROM listing_sources s LEFT JOIN listing_source_availability a ON a.source_id=s.id WHERE listing_id=? ORDER BY s.rowid`).all(id);
  const js = [sourceSnapshotParent(parent), rows.map(sourceSnapshotSource)];
  assert.deepEqual(JSON.parse(f.proof(id)), js);
  assert.equal(await hashSourceSnapshotProof(f.proof(id)), await hashSourceSnapshotProof(js));
  const before = f.db.prepare("SELECT total_changes() n").get().n;
  const result = await f.list();
  assert.equal(result.sourceSnapshotKeys[id], await hashSourceSnapshotProof(js));
  assert.equal(result.groups[id].length, 3);
  assert.equal(f.db.prepare("SELECT total_changes() n").get().n, before);
  assert.ok(!JSON.stringify(result).includes("source_snapshot_parent_json"));
});

test("CSV appends the key at index 32 and a verified empty manual parent has explicit empty metadata", async t => {
  const f = fixture(t); f.master("manual"); f.master("linked"); f.source("123", "linked");
  const csv = (await buildD1SheetCsv(f.env)).trimEnd().split("\r\n").map(row => row.split(","));
  assert.equal(csv[0].length, 33); assert.equal(csv[0][32], "원본연결키");
  const unified = await f.list();
  for (const row of csv.slice(1)) {
    assert.match(row[32], /^sha256-v1:[a-f0-9]{64}$/);
    assert.equal(row[32], unified.sourceSnapshotKeys[row[15]]);
  }
  assert.deepEqual(unified.groups.manual, []); assert.deepEqual(unified.sourceSearchIds.manual, []);
  assert.equal(unified.sourceSnapshotPropertyIds.manual, "manual");
  const unverified = await sourceSnapshotKeysFromReadRows([], [{ id: "not-observed", version: 1,
    updated_at: "", status: "active", source_snapshot_source_count: 1 }]);
  assert.deepEqual(unverified.keys, {});
});

test("scoped originals retain public-ID mapping, candidates, manual edits and exact requested missing IDs", async t => {
  const f = fixture(t); f.master("internal", { property_id: "public" }); f.source("123", "internal");
  f.source("456", "internal", { active: 0, missing_count: 1, kind: "census_missing" });
  f.master("other"); f.source("789", "other");
  const before = f.db.prepare("SELECT total_changes() n").get().n;
  let result = await f.scoped("public,absent");
  assert.deepEqual(result.requestedIds, ["public", "absent"]); assert.deepEqual(result.missingIds, ["absent"]);
  assert.deepEqual(Object.keys(result.unified.groups), ["public"]);
  assert.deepEqual(result.unified.sourceSnapshotPropertyIds, { public: "public" });
  assert.equal(result.items[0].id, "internal");
  assert.equal(result.items[0].source_snapshot_key, result.unified.sourceSnapshotKeys.public);
  assert.equal(result.unified.groups.public.length, 2);
  assert.equal(result.unified.fields.length, 39);
  const original = result.unified.groups.public[1], fields = result.unified.fields;
  assert.equal(original[fields.indexOf("candidateEligible")], true);
  assert.match(original[fields.indexOf("thumbnail")], /456\.jpg/);
  assert.equal(f.db.prepare("SELECT total_changes() n").get().n, before);
  const previous = result.items[0].source_snapshot_key;
  f.db.prepare("UPDATE listings SET version=version+1,updated_at='2026-10-15T04:00:00Z',room='B03호' WHERE id='internal'").run();
  f.db.prepare(`INSERT INTO listing_history(listing_id,action,before_json,after_json)
    VALUES ('internal','updateProperty','{"room":"1층"}','{"room":"B03호"}')`).run();
  result = await f.scoped("public");
  assert.notEqual(result.items[0].source_snapshot_key, previous);
  assert.equal(result.items[0].source_snapshot_key, result.unified.sourceSnapshotKeys.public);
  assert.equal(result.unified.groups.public[0][fields.indexOf("room")], "B03호");
});

test("public holds, deleted masters and unverified sources cannot acquire publication proof", async t => {
  const f = fixture(t);
  for (const id of ["live", "held", "deleted", "archive"]) f.master(id, { status: id === "deleted" ? "deleted" : "active" });
  f.source("123", "live"); f.source("456", "held"); f.source("789", "deleted");
  f.source("999", "archive", { active: 0, kind: "legacy_unverified" });
  f.db.prepare("INSERT INTO listing_data_quality_holds(listing_id,issue_code,state,blocks_publication) VALUES ('held','fixture','open',1)").run();
  const full = await f.list();
  assert.deepEqual(Object.keys(full.sourceSnapshotKeys), ["live"]);
  const scoped = await f.scoped("live,held,deleted,archive");
  assert.deepEqual(scoped.items.map(row => row.id), ["live"]);
  assert.deepEqual(scoped.missingIds, ["held", "deleted", "archive"]);
  assert.deepEqual(Object.keys(scoped.unified.sourceSnapshotKeys), ["live"]);
});

test("an insert between source scan and final inventory suppresses the incomplete group's key without dropping its ads", async t => {
  const f = fixture(t); f.master("M"); f.source("123", "M"); let changed = false;
  f.afterRead(sql => {
    if (!changed && /FROM listing_sources WHERE/.test(sql)) { changed = true; f.source("456", "M"); }
  });
  const result = await f.list();
  assert.equal(result.groups.M.length, 1, "Keep the actual read advertisement; do not invent a second source");
  assert.equal(result.sourceSnapshotKeys.M, undefined, "One scanned row cannot certify a current two-source parent");
});

test("changed parent tokens across source pages reject only that parent's proof", async t => {
  const f = fixture(t); f.master("M"); f.master("stable");
  f.db.exec("BEGIN");
  for (let i = 0; i < 4001; i++) f.source(String(100000 + i), "M");
  f.source("stable-source", "stable"); f.db.exec("COMMIT");
  let changed = false;
  f.afterRead(sql => {
    if (!changed && /FROM listing_sources WHERE/.test(sql)) {
      changed = true; f.db.prepare("UPDATE listings SET version=version+1 WHERE id='M'").run();
    }
  });
  const result = await f.list();
  assert.equal(result.groups.M.length, 4001);
  assert.equal(result.sourceSnapshotKeys.M, undefined);
  assert.match(result.sourceSnapshotKeys.stable, /^sha256-v1:[a-f0-9]{64}$/);
});

test("a source change between scoped item and metadata reads is exposed as a key mismatch, never retagged", async t => {
  const f = fixture(t); f.master("M"); f.source("123", "M"); let changed = false;
  f.afterRead(sql => {
    if (!changed && /FROM listings WHERE property_id IN/.test(sql)) {
      changed = true; f.db.prepare("UPDATE listing_sources SET updated_at='2026-10-15T04:00:00Z',active=0,missing_count=1 WHERE id='123'").run();
      f.db.prepare("INSERT INTO listing_source_availability(source_id,kind) VALUES ('123','census_missing')").run();
    }
  });
  const result = await f.scoped("M");
  assert.notEqual(result.items[0].source_snapshot_key, result.unified.sourceSnapshotKeys.M);
  assert.equal(result.unified.groups.M[0][result.unified.fields.indexOf("candidateEligible")], true);
});

test("final parent inventory follows both manual helpers and rejects an edit racing their reads", async t => {
  const f = fixture(t); f.master("M"); f.source("123", "M");
  let edited = false;
  f.afterRead(sql => {
    if (!edited && /FROM listing_history h JOIN listings l/.test(sql)) {
      edited = true;
      f.db.prepare("UPDATE listings SET version=version+1,room='B03호',updated_at='2026-10-15T04:00:00Z' WHERE id='M'").run();
      f.db.prepare(`INSERT INTO listing_history(listing_id,action,before_json,after_json)
        VALUES ('M','updateProperty','{"room":"1층"}','{"room":"B03호"}')`).run();
    }
  });
  const result = await f.list();
  const sourceRead = f.queries.findIndex(query => /FROM listing_sources WHERE/.test(query.sql));
  const roomRead = f.queries.findIndex(query => /FROM listing_history h JOIN listings l/.test(query.sql));
  const fieldsRead = f.queries.findIndex(query => /FROM listing_history WHERE action='updateProperty'/.test(query.sql));
  const parentRead = f.queries.findIndex(query => /AS source_snapshot_source_count/.test(query.sql));
  assert.ok(sourceRead >= 0 && sourceRead < roomRead && roomRead < fieldsRead && fieldsRead < parentRead);
  assert.equal(edited, true);
  assert.equal(result.groups.M.length, 1, "Keep the actual read original, including its image");
  assert.equal(result.groups.M[0][result.fields.indexOf("manualDisplayFields")], "room");
  assert.equal(result.sourceSnapshotKeys.M, undefined, "New manual metadata must not be certified by the old source parent token");
  assert.equal(f.db.prepare("SELECT room FROM listings WHERE id='M'").get().room, "B03호");
});

test("scoped limits reject oversized inputs and a valid absent request is an explicit empty result", async t => {
  const f = fixture(t);
  for (const ids of ["", "M,,N", "X".repeat(101), Array.from({ length: 51 }, (_, i) => "M" + i).join(",")]) {
    await assert.rejects(f.scoped(ids), error => error.statusCode === 400);
  }
  const result = await f.scoped("absent");
  assert.deepEqual(result.items, []); assert.deepEqual(result.missingIds, ["absent"]);
  assert.deepEqual(result.unified.groups, {}); assert.deepEqual(result.unified.sourceSnapshotKeys, {});
});

test("24k SHA keys use bounded batches and reduce raw proof wire size", async t => {
  const rows = Array.from({ length: 24_312 }, (_, i) => ({ id: "M-" + i, source_snapshot_proof: JSON.stringify([
    ["M-" + i, 1, "2026-10-15T03:00:00Z", "active"], [0, 1].map(j => ["O-" + i + "-" + j, "네이버", String(2600000000 + i * 2 + j),
      1, 0, "fnv1a-12345678", "2026-10-15T03:00:00Z", "2026-10-15T03:00:00Z", "", ""])
  ]) }));
  const rawBytes = rows.reduce((sum, row) => sum + Buffer.byteLength(row.source_snapshot_proof), 0);
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalCrypto = globalThis.crypto;
  let activeDigests = 0, peakDigests = 0;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { subtle: { digest(...args) {
    activeDigests += 1; peakDigests = Math.max(peakDigests, activeDigests);
    return originalCrypto.subtle.digest(...args).finally(() => { activeDigests -= 1; });
  } } } });
  const start = performance.now();
  try { await hashSourceSnapshotRows(rows); }
  finally { Object.defineProperty(globalThis, "crypto", cryptoDescriptor); }
  const elapsed = performance.now() - start;
  assert.ok(peakDigests <= 24); assert.equal(activeDigests, 0);
  assert.ok(rows.every(row => /^sha256-v1:[a-f0-9]{64}$/.test(row.source_snapshot_key) && !("source_snapshot_proof" in row)));
  assert.equal(new Set(rows.map(row => row.source_snapshot_key)).size, rows.length);
  const wireBytes = rows.reduce((sum, row) => sum + Buffer.byteLength(row.source_snapshot_key), 0);
  assert.ok(wireBytes < rawBytes);
  t.diagnostic(JSON.stringify({ parents: rows.length, rawBytes, keyBytes: wireBytes, peakDigests, elapsedMs: Math.round(elapsed) }));
});
