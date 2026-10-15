import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleD1GetAction } from "../cloudflare/src/d1-api.js";
import { koreanCalendarDay } from "../cloudflare/src/new-listing-period.js";

test("real Today scoped SQL paginates 1,000 source-backed parents without compact/proof shape failures", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const name of readdirSync("cloudflare/migrations").filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync("cloudflare/migrations/" + name, "utf8"));
  }
  const day = koreanCalendarDay(), at = day + "T01:00:00Z", queries = [];
  const master = db.prepare("INSERT INTO listings(id,property_id,address,first_collected_at,updated_at) VALUES(?,?,?,?,?)");
  const source = db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,list_snapshot_json,
    snapshot_hash,first_collected_at,last_collected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  db.exec("BEGIN");
  for (let index = 0; index < 1000; index += 1) {
    const id = "M-test-" + String(index).padStart(4, "0"), publicId = index % 2 ? "public-" + id : id;
    const sourceId = "O-test-" + index;
    master.run(id, publicId, "서구 갈마동 " + (index + 1), "2024-01-01", at);
    source.run(sourceId, id, "네이버", "네이버-" + index + "::lease", JSON.stringify({
      originalId: sourceId, propertyId: id, source: "네이버", tradeType: "lease", room: "1층", thumbnail: "https://example.invalid/test.jpg"
    }), "snapshot-" + index, at, at, at);
  }
  db.exec("COMMIT");
  const env = { DB: { prepare(sql) {
    const positions = [], compiled = sql.replace(/\?(\d+)/g, (_, value) => { positions.push(Number(value) - 1); return "?"; });
    let values = [];
    const args = () => positions.length ? positions.map(position => values[position]) : values;
    return { bind(...bindings) { values = bindings; return this; }, async all() {
      queries.push({ sql, count: values.length });
      return { results: db.prepare(compiled).all(...args()) };
    }, async first() { return db.prepare(compiled).get(...args()) || null; } };
  } } };
  const ids = new Set(); let cursor = "", pages = 0, ads = 0;
  const started = performance.now();
  do {
    const result = await handleD1GetAction(env, {}, { action: "newListingPeriod", market: "lease", days: "1", cursor });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.snapshotConsistency, "per-property-v1");
    assert.equal(result.unified.snapshotConsistency, "per-property-v1");
    assert.equal(result.unified.format, "compact-v2");
    for (const item of result.items) {
      const id = item.property_id;
      assert.ok(!ids.has(id)); ids.add(id);
      assert.equal(result.unified.sourceSnapshotKeys[id], item.source_snapshot_key);
      assert.equal(result.unified.sourceSnapshotPropertyIds[id], id);
      const originals = result.unified.groups[id], activeAt = result.unified.fields.indexOf("active");
      assert.equal(originals.length, 1); assert.equal(originals[0][activeAt], 1);
      assert.deepEqual(result.todayOriginalIds[id], [originals[0][result.unified.fields.indexOf("originalId")]]);
    }
    ads += result.todayAdCount; pages += 1; cursor = result.nextCursor;
    assert.equal(result.hasMore, Boolean(cursor));
  } while (cursor);
  assert.equal(ids.size, 1000); assert.equal(ads, 1000); assert.equal(pages, 14);
  assert.ok(queries.every(query => query.count <= 100));
  const sourceReads = queries.filter(query => /FROM listing_sources WHERE/.test(query.sql));
  assert.equal(sourceReads.length, pages, "Use one scoped actual source read per page");
  assert.ok(sourceReads.every(query => /listing_id IN/.test(query.sql) && query.count <= 77));
  t.diagnostic(`Actual scoped Today SQL: ${pages} pages, ${queries.length} queries, ${Math.round(performance.now() - started)} ms locally`);
});

function changingFixture(t, mutate) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const name of readdirSync("cloudflare/migrations").filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync("cloudflare/migrations/" + name, "utf8"));
  }
  const at = koreanCalendarDay() + "T01:00:00Z";
  for (const id of ["inside", "outside"]) {
    db.prepare("INSERT INTO listings(id,property_id,first_collected_at) VALUES(?,?,?)").run(id, id, "2024-01-01");
    db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,list_snapshot_json,
      first_collected_at) VALUES(?,?,'네이버',?,'{}',?)`).run("O-" + id, id, id, id === "inside" ? at : "2024-01-01");
  }
  let reads = 0;
  const env = { DB: { prepare(sql) {
    const positions = [], compiled = sql.replace(/\?(\d+)/g, (_, value) => { positions.push(Number(value) - 1); return "?"; });
    let values = [];
    const args = () => positions.length ? positions.map(position => values[position]) : values;
    return { bind(...bindings) { values = bindings; return this; }, async all() {
      const results = db.prepare(compiled).all(...args());
      if (sql.startsWith("WITH today_parents")) { reads += 1; mutate(db, reads); }
      return { results };
    }, async first() { return db.prepare(compiled).get(...args()) || null; } };
  } } };
  return { env, reads: () => reads };
}

test("an unrelated property's concurrent collection does not invalidate this verified Today page", async t => {
  const h = changingFixture(t, (db, reads) => {
    db.prepare("UPDATE listing_sources SET snapshot_hash=? WHERE listing_id='outside'").run("outside-" + reads);
  });
  const result = await handleD1GetAction(h.env, {}, { action: "newListingPeriod", market: "lease" });
  assert.equal(result.ok, true); assert.equal(h.reads(), 1);
  assert.deepEqual(result.items.map(row => row.id), ["inside"]);
  assert.deepEqual(result.todayOriginalIds.inside, ["O-inside"]);
});

test("an actual in-page source change retries only that same page and succeeds on its stable proof", async t => {
  const h = changingFixture(t, (db, reads) => {
    if (reads === 1) db.prepare("UPDATE listing_sources SET snapshot_hash='newer' WHERE listing_id='inside'").run();
  });
  const result = await handleD1GetAction(h.env, {}, { action: "newListingPeriod", market: "lease" });
  assert.equal(result.ok, true); assert.equal(h.reads(), 2);
  assert.equal(result.snapshotConsistency, "per-property-v1");
  assert.equal(result.items[0].source_snapshot_key, result.unified.sourceSnapshotKeys.inside);
  assert.equal(result.todayAdCount, 1);
});

test("a continuously changing in-page source stops after three reads without authoritative zero or partial items", async t => {
  const h = changingFixture(t, (db, reads) => {
    db.prepare("UPDATE listing_sources SET snapshot_hash=? WHERE listing_id='inside'").run("changed-" + reads);
  });
  const result = await handleD1GetAction(h.env, {}, { action: "newListingPeriod", market: "lease" });
  assert.equal(result.ok, false); assert.equal(h.reads(), 3);
  assert.equal(result.snapshotChanged, true); assert.equal(result.retryScope, "page");
  assert.equal(result.snapshotConsistency, "per-property-v1");
  assert.equal(result.items, undefined); assert.equal(result.todayAdCount, undefined);
});
