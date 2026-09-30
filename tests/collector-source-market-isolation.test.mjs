import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Exercise the actual private ingestion function without widening the
// production API or making a real request to either listing provider.
const collectorUrl = new URL("../cloudflare/src/collector-api.js", import.meta.url);
const collectorCode = fs.readFileSync(collectorUrl, "utf8").replace(
  /\bfrom\s+(["'])(\.\/[^"']+)\1/g,
  (_, quote, relative) => `from ${quote}${new URL(relative, collectorUrl).href}${quote}`
) + "\nexport { ingestRecords, classifyManifest, finalizeSession };\n//# sourceURL=collector-api-isolation-test.js";
const { ingestRecords, classifyManifest, finalizeSession, normalizedRecord } = await import(
  `data:text/javascript;base64,${Buffer.from(collectorCode).toString("base64")}`
);

function database(t, provider) {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Provider/network access is forbidden in this test"); });
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const name of fs.readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(name, migrations), "utf8"));
  }
  t.after(() => db.close());
  const prepare = (sql, args = []) => {
    const positions = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, n) => { positions.push(Number(n) - 1); return "?"; });
    const params = () => positions.length ? positions.map((n) => args[n]) : args;
    return {
      bind: (...values) => prepare(sql, values),
      async all() { return { results: db.prepare(compiled).all(...params()) }; },
      async first() { return db.prepare(compiled).get(...params()) || null; },
      async run() {
        const result = db.prepare(compiled).run(...params());
        return { meta: { changes: Number(result.changes) } };
      }
    };
  };
  const env = { DB: { prepare, async batch(statements) { return Promise.all(statements.map((stmt) => stmt.run())); } } };
  let sequence = 0;
  const save = async (record) => {
    const result = await ingestRecords(env, provider, [record], { sessionId: `save-${++sequence}` });
    assert.equal(result.ok, true);
    assert.equal(result.failed, 0, JSON.stringify(result));
    assert.equal(result.review, 0, JSON.stringify(result));
    return result;
  };
  const manifest = async (records) => classifyManifest(env, {
    source: provider, sessionId: `manifest-${++sequence}`, entries: records.map((record) => {
      const normalized = normalizedRecord(provider, record);
      return { sourceId: normalized.sourceId, tradeType: normalized.tradeType,
        salePrice: normalized.salePrice, saleCategory: normalized.saleCategory,
        deposit: normalized.deposit, rent: normalized.rent, room: normalized.room,
        area: normalized.area, address: normalized.address, listSnapshot: normalized.listSnapshot };
    })
  });
  const finalize = async (tradeType, record) => finalizeSession(env, {
    source: provider, sessionId: `finish-${++sequence}`, tradeType, complete: false,
    observedSourceIds: [normalizedRecord(provider, record).sourceId]
  });
  const sources = () => db.prepare(`SELECT id, listing_id, source_listing_id, trade_type
    FROM listing_sources ORDER BY trade_type`).all();
  return { db, env, save, manifest, finalize, sources };
}

function fixture(provider, tradeType, version = 1) {
  const listSnapshot = JSON.stringify({ id: "987654", tradeType, version });
  const image = `https://images.example.test/${tradeType}-${version}.jpg`;
  if (provider === "네이버") return {
    articleNo: "987654", tradeType, saleCategory: "commercial", salePrice: 50000 + version,
    category: "상가점포", buildingName: "거래분리 검수상가", jibunAddress: "서구 갈마동 361-14",
    roomInfo: "1층", deposit: 1000, monthly: 100 + version, areaSquareMeter: 66.1,
    managementFee: 5, description: "원본 검수 설명", imageUrls: [image], listSnapshot,
    latitude: 36.35, longitude: 127.37
  };
  return {
    originalId: "987654", tradeType, salesTypeV3: { type: "COMMERCIAL" },
    trades: [{ type: "MONTH", deposit: 1000, monthlyPay: 100 + version },
      { type: "BUY", price: 50000 + version, preferred: true }],
    publicJibunAddress: "서구 갈마동 361-14", buildingName: "거래분리 검수상가",
    floor: 1, area: 66.1, totalManageCost: 5, content: "원본 검수 설명", images: [image],
    listSnapshot, latitude: 36.35, longitude: 127.37
  };
}

function addContact(db, id, listingId, sourceId = null) {
  db.prepare(`INSERT INTO listing_contacts (id, listing_id, source_id, role, name, phone, normalized_phone)
    VALUES (?, ?, ?, '소유자', ?, '010-0000-0000', '01000000000')`).run(id, listingId, sourceId, id);
}

for (const provider of ["네이버", "당근"]) {
  for (const firstTrade of ["lease", "sale"]) {
    test(`${provider}: ${firstTrade} then opposite market then recollection never moves legacy source, representative or assets`, async (t) => {
      const { db, save, sources } = database(t, provider);
      const oppositeTrade = firstTrade === "lease" ? "sale" : "lease";
      const first = fixture(provider, firstTrade);
      const opposite = fixture(provider, oppositeTrade);
      assert.equal((await save(first)).created, 1);
      const firstSource = sources()[0];
      const providerId = normalizedRecord(provider, first).sourceId;
      // Simulate an already-bookmarked source created before qualified IDs.
      db.prepare("UPDATE listing_sources SET source_listing_id=? WHERE id=?").run(providerId, firstSource.id);
      db.prepare("UPDATE listings SET status='계약완료', operating_memo='(확인) 사용자 검수 메모' WHERE id=?")
        .run(firstSource.listing_id);
      addContact(db, "manual-first", firstSource.listing_id);
      addContact(db, "source-first", firstSource.listing_id, firstSource.id);
      const protectedListing = db.prepare("SELECT * FROM listings WHERE id=?").get(firstSource.listing_id);
      const protectedMedia = db.prepare("SELECT * FROM listing_media WHERE listing_id=?").all(firstSource.listing_id);
      const protectedContacts = db.prepare("SELECT * FROM listing_contacts WHERE listing_id=? ORDER BY id").all(firstSource.listing_id);

      assert.equal((await save(opposite)).created, 1);
      assert.deepEqual(db.prepare("SELECT * FROM listings WHERE id=?").get(firstSource.listing_id), protectedListing);
      assert.deepEqual(db.prepare("SELECT * FROM listing_media WHERE listing_id=?").all(firstSource.listing_id), protectedMedia);
      assert.deepEqual(db.prepare("SELECT * FROM listing_contacts WHERE listing_id=? ORDER BY id").all(firstSource.listing_id), protectedContacts);
      const identities = sources();
      assert.equal(identities.length, 2);
      assert.equal(new Set(identities.map((row) => row.listing_id)).size, 2);
      assert.equal(identities.find((row) => row.trade_type === firstTrade).source_listing_id, providerId);
      const oppositeSource = identities.find((row) => row.trade_type === oppositeTrade);
      assert.equal(oppositeSource.source_listing_id, `${providerId}::${oppositeTrade}`);
      addContact(db, "manual-opposite", oppositeSource.listing_id);
      const untouchedOpposite = db.prepare("SELECT * FROM listings WHERE id=?").get(oppositeSource.listing_id);
      const untouchedOppositeMedia = db.prepare("SELECT * FROM listing_media WHERE listing_id=?").all(oppositeSource.listing_id);

      const updated = await save(fixture(provider, firstTrade, 2));
      assert.equal(updated.created, 0);
      assert.equal(updated.updated, 1);
      assert.deepEqual(sources(), identities, "source rows and both representative IDs survive recollection");
      assert.deepEqual(db.prepare("SELECT * FROM listings WHERE id=?").get(oppositeSource.listing_id), untouchedOpposite);
      assert.deepEqual(db.prepare("SELECT * FROM listing_media WHERE listing_id=?").all(oppositeSource.listing_id), untouchedOppositeMedia);
      assert.equal(db.prepare("SELECT listing_id FROM listing_contacts WHERE id='manual-first'").get().listing_id, firstSource.listing_id);
      assert.equal(db.prepare("SELECT listing_id FROM listing_contacts WHERE id='manual-opposite'").get().listing_id, oppositeSource.listing_id);
      assert.equal(db.prepare("SELECT status FROM listings WHERE id=?").get(firstSource.listing_id).status, "계약완료");
      const amounts = db.prepare("SELECT trade_type, deposit, monthly_rent, sale_price FROM listings ORDER BY trade_type").all();
      // Routine source refresh keeps representative terms unless an explicit
      // condition update/promotion occurs. Source prices still refresh apart.
      assert.deepEqual(amounts.map((row) => Object.values(row)), [
        ["lease", 1000, 101, null], ["sale", 0, 0, 50001]
      ]);
      for (const source of db.prepare("SELECT * FROM listing_sources").all()) {
        const snapshot = JSON.parse(source.list_snapshot_json);
        assert.equal(snapshot.propertyId, source.listing_id);
        assert.equal(snapshot.providerSourceId, providerId);
        assert.equal(snapshot.tradeType, source.trade_type);
        if (source.trade_type === "sale") {
          assert.equal(snapshot.salePrice, firstTrade === "sale" ? 50002 : 50001);
          assert.equal(snapshot.rent, 0);
        } else {
          assert.equal(snapshot.rent, firstTrade === "lease" ? 102 : 101);
          assert.equal(snapshot.salePrice, null);
        }
        assert.doesNotMatch(source.source_url, /::(?:sale|lease)/);
        assert.match(source.source_url, /987654/);
        const images = db.prepare("SELECT listing_id, external_url FROM listing_media WHERE source_id=?").all(source.id);
        assert.equal(images.length, 1);
        assert.equal(images[0].listing_id, source.listing_id);
        assert.match(images[0].external_url, new RegExp(`${source.trade_type}-`));
      }
      assert.equal(db.prepare("SELECT count(*) n FROM collector_raw WHERE processing_state='review'").get().n, 0);
    });
  }

  test(`${provider}: a mixed batch creates separate offers and later source price changes stay in their own market`, async (t) => {
    const { db, env, save, sources } = database(t, provider);
    const initial = await ingestRecords(env, provider,
      [fixture(provider, "lease"), fixture(provider, "sale")], { sessionId: "mixed-batch" });
    assert.equal(initial.failed, 0, JSON.stringify(initial));
    assert.equal(initial.created, 2);
    assert.equal(initial.review, 0);
    const identities = sources();
    await save(fixture(provider, "lease", 2));
    await save(fixture(provider, "sale", 3));
    assert.deepEqual(sources(), identities);
    assert.deepEqual(db.prepare("SELECT trade_type, deposit, monthly_rent, sale_price FROM listings ORDER BY trade_type").all()
      .map((row) => Object.values(row)), [["lease", 1000, 101, null], ["sale", 0, 0, 50001]]);
    assert.deepEqual(db.prepare(`SELECT trade_type, json_extract(list_snapshot_json,'$.deposit'),
      json_extract(list_snapshot_json,'$.rent'), sale_price FROM listing_sources ORDER BY trade_type`).all()
      .map((row) => Object.values(row)), [["lease", 1000, 102, null], ["sale", 0, 0, 50003]]);
  });

  test(`${provider}: manifest compares each market independently and returns only provider IDs for detail requests`, async (t) => {
    const { save, manifest, sources } = database(t, provider);
    const lease = fixture(provider, "lease");
    const sale = fixture(provider, "sale");
    const providerId = normalizedRecord(provider, lease).sourceId;
    await save(lease);
    const beforeSale = await manifest([sale]);
    assert.deepEqual(beforeSale.needsDetail, [providerId]);
    assert.equal(beforeSale.unknown, 1);
    await save(sale);
    const identities = sources();
    for (const record of [lease, sale]) {
      const same = await manifest([record]);
      assert.equal(same.unchanged, 1, JSON.stringify(same));
      assert.deepEqual(same.needsDetail, []);
      const changed = await manifest([fixture(provider, record.tradeType, 2)]);
      assert.equal(changed.changed, 1, JSON.stringify(changed));
      assert.deepEqual(changed.needsDetail, [providerId]);
      assert.doesNotMatch(changed.needsDetail[0], /::(?:sale|lease)/);
    }
    assert.deepEqual(sources(), identities);
  });

  for (const observedTrade of ["lease", "sale"]) {
    test(`${provider}: partial ${observedTrade} finalization cannot revive or touch the opposite offer`, async (t) => {
      const { db, save, finalize, sources } = database(t, provider);
      await save(fixture(provider, "lease"));
      await save(fixture(provider, "sale"));
      const identities = sources();
      db.exec("UPDATE listing_sources SET active=0, missing_count=3; UPDATE listings SET status='계약완료';");
      const opposite = db.prepare("SELECT * FROM listing_sources WHERE trade_type<>?").get(observedTrade);
      const oppositeListing = db.prepare("SELECT * FROM listings WHERE id=?").get(opposite.listing_id);
      const result = await finalize(observedTrade, fixture(provider, observedTrade));
      assert.equal(result.complete, false);
      assert.equal(result.missingMarked, 0);
      assert.deepEqual(sources(), identities);
      assert.deepEqual(db.prepare("SELECT * FROM listing_sources WHERE id=?").get(opposite.id), opposite);
      assert.deepEqual(db.prepare("SELECT * FROM listings WHERE id=?").get(opposite.listing_id), oppositeListing);
      assert.deepEqual(db.prepare("SELECT active, missing_count FROM listing_sources WHERE trade_type=?").all(observedTrade)
        .map((row) => Object.values(row)), [[1, 0]]);
    });
  }
}
