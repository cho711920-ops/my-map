import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  auditLeaseMarketDataset,
  buildLeaseMarketRepairSql,
  classifyLeaseMarketListing,
  daangnTradeEvidence
} from "../tools/repair-lease-market-contamination.mjs";

const root = resolve(import.meta.dirname, "..");

function listing(id, source, extra = {}) {
  return {
    id,
    property_id: `property:${id}`,
    status: "active",
    main_source: source,
    trade_type: "lease",
    sale_category: "",
    sale_price: null,
    deposit: 0,
    monthly_rent: 0,
    version: 1,
    updated_at: "2026-09-10T00:00:00.000Z",
    address: `대전 중구 테스트동 ${id.replace(/\D/g, "") || "1"}`,
    building_name: "테스트",
    room: "1층",
    physical_key: `physical:${id}`,
    condition_key: `condition:${id}`,
    customer_match_count: 0,
    cloud_reference_count: 0,
    contact_count: 0,
    media_count: 0,
    history_count: 0,
    sale_collision_count: 0,
    ...extra
  };
}

function daangnSource(id, listingId, trades, { active = 0, preserve = false } = {}) {
  return {
    id,
    listing_id: listingId,
    source: "당근",
    source_listing_id: id,
    active,
    trade_type: "lease",
    sale_category: "",
    sale_price: null,
    snapshot_hash: "old-hash",
    list_snapshot_json: JSON.stringify({ tradeType: "lease", deposit: 0, rent: 0, preserveRepresentative: preserve }),
    raw_json: JSON.stringify({ salesTypeV3: { type: "STORE" }, trades }),
    updated_at: "2026-09-10T01:00:00.000Z"
  };
}

function gongsilSource(id, listingId, list) {
  return {
    id,
    listing_id: listingId,
    source: "공실박스",
    source_listing_id: id,
    active: 1,
    trade_type: "lease",
    sale_category: "",
    sale_price: null,
    snapshot_hash: "gongsil-hash",
    list_snapshot_json: JSON.stringify({ tradeType: "lease", deposit: 5000, rent: 0 }),
    raw_json: JSON.stringify({ list, detail: {} }),
    updated_at: "2026-09-10T02:00:00.000Z"
  };
}

test("Daangn evidence recognizes type and __typename without treating zero as proof", () => {
  const evidence = daangnTradeEvidence({ raw_json: JSON.stringify({
    salesTypeV3: { type: "FACTORY" },
    trades: [
      { __typename: "BuyTrade", price: 9500 },
      { type: "MONTH", deposit: 1000, monthlyPay: 0 },
      { type: "MONTH", deposit: 2000, monthlyPay: 120 }
    ]
  }) });
  assert.equal(evidence.buy.price, 9500);
  assert.deepEqual(evidence.month, { deposit: 2000, rent: 120, preferred: false });
  assert.equal(evidence.saleCategory, "factory_warehouse");
});

test("the classifier repairs only deterministic, unprotected Daangn evidence", () => {
  const pure = listing("L1", "당근");
  const pureSource = daangnSource("S1", pure.id, [{ type: "BUY", price: 18000 }]);
  assert.equal(classifyLeaseMarketListing({ listing: pure, sources: [pureSource] }).kind, "reclassify_sale");

  const dual = listing("L2", "당근");
  const dualSource = daangnSource("S2", dual.id, [
    { type: "BUY", price: 90000 },
    { type: "MONTH", deposit: 3000, monthlyPay: 180 }
  ], { active: 1 });
  const monthlyDecision = classifyLeaseMarketListing({ listing: dual, sources: [dualSource] });
  assert.equal(monthlyDecision.kind, "repair_monthly");
  assert.equal(monthlyDecision.correction.monthlyRent, 180);

  const protectedSource = daangnSource("S3", "L3", [
    { type: "BUY", price: 90000 },
    { type: "MONTH", deposit: 3000, monthlyPay: 180 }
  ], { active: 1, preserve: true });
  const protectedDecision = classifyLeaseMarketListing({ listing: listing("L3", "당근"), sources: [protectedSource] });
  assert.equal(protectedDecision.kind, "hold");
  assert.match(protectedDecision.reason, /preserveRepresentative/);

  const manuallyEdited = classifyLeaseMarketListing({ listing: pure, sources: [pureSource], historyActions: ["updateProperty"] });
  assert.equal(manuallyEdited.kind, "hold");
});

test("orphans and legacy Gongsil rows are classified without deletion", () => {
  const orphan = classifyLeaseMarketListing({ listing: listing("L4", "당근"), sources: [] });
  assert.equal(orphan.issueCode, "orphan_zero_rent_lease");
  assert.equal(orphan.blocksPublication, 1);

  const jeonseListing = listing("L5", "공실박스");
  const jeonse = classifyLeaseMarketListing({
    listing: jeonseListing,
    sources: [gongsilSource("S5", jeonseListing.id, { Subtype: "2", Jun: 5000 })]
  });
  assert.equal(jeonse.issueCode, "gongsil_verified_jeonse");
  assert.equal(jeonse.blocksPublication, 0);
});

test("guarded repair SQL preserves IDs, memo, favorites, customers, media and contacts", () => {
  const listings = [
    listing("L1", "당근", { customer_match_count: 1, cloud_reference_count: 1, contact_count: 1, media_count: 1 }),
    listing("L2", "당근"),
    listing("L3", "당근"),
    listing("L4", "당근"),
    listing("L5", "공실박스")
  ];
  const sources = [
    daangnSource("S1", "L1", [{ type: "BUY", price: 18000 }]),
    daangnSource("S2", "L2", [{ type: "BUY", price: 90000 }, { type: "MONTH", deposit: 3000, monthlyPay: 180 }], { active: 1 }),
    daangnSource("S3", "L3", [{ type: "BUY", price: 90000 }, { type: "MONTH", deposit: 3000, monthlyPay: 180 }], { active: 1, preserve: true }),
    gongsilSource("S5", "L5", { Subtype: "2", Jun: 5000 })
  ];
  const dataset = { listings, sources, history: [] };
  const audit = auditLeaseMarketDataset(dataset);
  assert.equal(audit.decisions.length, 5);
  const plan = buildLeaseMarketRepairSql(dataset, { now: "2026-09-10T03:00:00.000Z" });
  assert.equal(plan.expected.length, 2);
  assert.doesNotMatch(plan.forwardSql, /DELETE\s+FROM\s+(?:listings|listing_sources|listing_history|customer_matches|cloud_state|listing_contacts|listing_media)/i);
  assert.doesNotMatch(plan.forwardSql, /operating_memo\s*=/i);

  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0001_initial.sql", "0002_usage_counters.sql", "0003_primary_data.sql",
    "0004_detail_backfill.sql", "0005_standalone_cutover.sql", "0006_legacy_recovery.sql",
    "0007_collector_optimization.sql", "0008_gongsil_photo_recovery.sql",
    "0009_gongsil_collective_building_contacts.sql", "0010_operations_snapshot_and_access.sql",
    "0011_collector_raw_source_lookup.sql", "0012_collector_review_dedup.sql",
    "0013_collector_review_address_index.sql", "0014_elevator_capacity.sql",
    "0015_elevator_registry.sql", "0016_local_accounts.sql", "0017_link_local_google_identity.sql",
    "0018_daangn_monthly_trade_priority.sql", "0019_listing_trade_foundation.sql",
    "0020_listing_data_quality_holds.sql"]) {
    db.exec(readFileSync(resolve(root, "cloudflare/migrations", name), "utf8"));
  }

  const insertListing = db.prepare(`INSERT INTO listings
    (id,property_id,status,main_source,trade_type,sale_category,sale_price,deposit,monthly_rent,
      version,updated_at,address,building_name,room,physical_key,condition_key,operating_memo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of listings) insertListing.run(row.id, row.property_id, row.status, row.main_source,
    row.trade_type, row.sale_category, row.sale_price, row.deposit, row.monthly_rent, row.version,
    row.updated_at, row.address, row.building_name, row.room, row.physical_key, row.condition_key,
    row.id === "L1" ? "사용자 메모 보존" : "");
  const insertSource = db.prepare(`INSERT INTO listing_sources
    (id,listing_id,source,source_listing_id,active,trade_type,sale_category,sale_price,snapshot_hash,
      list_snapshot_json,raw_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of sources) insertSource.run(row.id, row.listing_id, row.source, row.source_listing_id,
    row.active, row.trade_type, row.sale_category, row.sale_price, row.snapshot_hash,
    row.list_snapshot_json, row.raw_json, row.updated_at);
  db.prepare("INSERT INTO customers(id,name) VALUES('C1','customer')").run();
  db.prepare("INSERT INTO customer_matches(customer_id,listing_id) VALUES('C1','L1')").run();
  db.prepare("INSERT INTO cloud_state(owner_email,scope,record_key,value_json) VALUES('owner@example.com','favorites','default',?)")
    .run(JSON.stringify({ ids: ["L1"] }));
  db.prepare("INSERT INTO listing_contacts(id,listing_id,source_id,phone) VALUES('C-L1','L1','S1','010-0000-0000')").run();
  db.prepare("INSERT INTO listing_media(id,listing_id,source_id,external_url) VALUES('I-L1','L1','S1','https://example.test/a.jpg')").run();

  db.exec(plan.forwardSql);
  assert.deepEqual({ ...db.prepare("SELECT trade_type,sale_price,deposit,monthly_rent FROM listings WHERE id='L1'").get() },
    { trade_type: "sale", sale_price: 18000, deposit: 0, monthly_rent: 0 });
  assert.deepEqual({ ...db.prepare("SELECT trade_type,deposit,monthly_rent FROM listings WHERE id='L2'").get() },
    { trade_type: "lease", deposit: 3000, monthly_rent: 180 });
  assert.equal(db.prepare("SELECT monthly_rent FROM listings WHERE id='L3'").get().monthly_rent, 0);
  assert.equal(db.prepare("SELECT operating_memo FROM listings WHERE id='L1'").get().operating_memo, "사용자 메모 보존");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customer_matches WHERE listing_id='L1'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cloud_state WHERE instr(value_json,'L1')>0").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_contacts WHERE listing_id='L1'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_media WHERE listing_id='L1'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_data_quality_holds").get().n, 5);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 5);
  assert.equal(db.prepare("SELECT state FROM listing_data_quality_holds WHERE listing_id='L1'").get().state, "resolved");
  assert.equal(db.prepare("SELECT blocks_publication FROM listing_data_quality_holds WHERE listing_id='L4'").get().blocks_publication, 1);
  db.exec(readFileSync(resolve(root, "tools/sql/lease-market-audit.sql"), "utf8"));
  db.exec(plan.rollbackSql);
  assert.deepEqual({ ...db.prepare("SELECT trade_type,sale_category,sale_price,deposit,monthly_rent,version FROM listings WHERE id='L1'").get() },
    { trade_type: "lease", sale_category: "", sale_price: null, deposit: 0, monthly_rent: 0, version: 3 });
  assert.deepEqual({ ...db.prepare("SELECT trade_type,sale_category,sale_price,deposit,monthly_rent,version FROM listings WHERE id='L2'").get() },
    { trade_type: "lease", sale_category: "", sale_price: null, deposit: 0, monthly_rent: 0, version: 3 });
  assert.equal(db.prepare("SELECT operating_memo FROM listings WHERE id='L1'").get().operating_memo, "사용자 메모 보존");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customer_matches WHERE listing_id='L1'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listing_history").get().n, 7);
  db.close();
});

test("audit SQL is read-only and avoids memo/contact payloads", () => {
  const sql = readFileSync(resolve(root, "tools/sql/lease-market-audit.sql"), "utf8");
  const statements = sql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(statements, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP)\b/i);
  assert.doesNotMatch(sql, /operating_memo|contacts_json|phone/i);
  assert.match(sql, /preserveRepresentative/);
  assert.match(sql, /sale_collision_count/);
});

test("an approved repair invalidates only reproducible listing query caches", () => {
  const source = readFileSync(resolve(root, "tools/repair-lease-market-contamination.mjs"), "utf8");
  assert.match(source, /api-cache\/d1-sheet\.csv/);
  assert.match(source, /api-cache\/unified-listings-v5-source-aware-review\.json/);
  assert.match(source, /api-cache\/unified-detail-v5-sale-metadata\/\$\{clean\(id\)\}\.json/);
  assert.match(source, /r2", "object", "delete", `js-map-media\/\$\{key\}`, "--remote"/);
  assert.doesNotMatch(source, /r2", "bucket", "delete"/);
});
