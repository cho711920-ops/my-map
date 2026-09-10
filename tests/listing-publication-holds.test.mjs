import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { buildD1SheetCsv, handleD1GetAction } from "../cloudflare/src/d1-api.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE listings (
      id TEXT PRIMARY KEY, property_id TEXT UNIQUE, status TEXT, main_source TEXT,
      title TEXT, building_name TEXT, address TEXT, room TEXT, listing_type TEXT,
      deposit REAL, monthly_rent REAL, maintenance_fee REAL, premium REAL, area_m2 REAL,
      landlord_phone TEXT, tenant_phone TEXT, operating_memo TEXT, first_collected_at TEXT,
      source_url TEXT, contacts_json TEXT, building_year TEXT, building_elevators INTEGER,
      building_approval_date TEXT, building_info_checked_at TEXT, building_info_status TEXT,
      registration_at TEXT, last_collected_at TEXT, latitude REAL, longitude REAL,
      building_elevator_capacity INTEGER, trade_type TEXT, sale_category TEXT, sale_price REAL,
      version INTEGER DEFAULT 1, updated_at TEXT DEFAULT '2026-09-10T00:00:00Z'
    );
    CREATE TABLE listing_sources (
      id TEXT PRIMARY KEY, listing_id TEXT, source TEXT, source_listing_id TEXT,
      active INTEGER, missing_count INTEGER DEFAULT 0, list_snapshot_json TEXT DEFAULT '{}',
      raw_json TEXT DEFAULT '{}', last_collected_at TEXT DEFAULT ''
    );
    CREATE TABLE listing_media (
      id TEXT PRIMARY KEY, listing_id TEXT, source_id TEXT, external_url TEXT,
      r2_key TEXT DEFAULT '', thumbnail_r2_key TEXT DEFAULT '', sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE listing_contacts (
      id TEXT PRIMARY KEY, listing_id TEXT, source_id TEXT, role TEXT, name TEXT, phone TEXT,
      normalized_phone TEXT, status TEXT DEFAULT 'active', first_seen_at TEXT, last_seen_at TEXT
    );
  `);
  // The application queries this table directly, so migration 0020 must be
  // applied before publishing the Worker code that introduces the read guard.
  sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0020_listing_data_quality_holds.sql", import.meta.url), "utf8"));
  const rows = [
    ["P-visible", "공개매물", "대전 서구 공개로 1"],
    ["P-held", "차단매물", "대전 서구 차단로 2"],
    ["P-resolved", "해제매물", "대전 서구 해제로 3"],
    ["P-nonblock", "검토표시매물", "대전 서구 검토로 4"],
    ["P-held-fallback", "차단대체매물", "대전 서구 대체로 5"]
  ];
  const listingInsert = sqlite.prepare(`INSERT INTO listings (
    id,property_id,status,main_source,title,building_name,address,room,listing_type,
    deposit,monthly_rent,maintenance_fee,premium,area_m2,contacts_json,registration_at,
    first_collected_at,last_collected_at,trade_type,version
  ) VALUES (?,?, 'active','네이버',?,?,?,'1층','일반상가',1000,80,5,0,33,'[]',
    '2026-09-10T00:00:00Z','2026-09-10T00:00:00Z','2026-09-10T00:00:00Z','lease',1)`);
  const sourceInsert = sqlite.prepare(`INSERT INTO listing_sources (
    id,listing_id,source,source_listing_id,active,missing_count,list_snapshot_json,raw_json,last_collected_at
  ) VALUES (?,?,?,?,?,?,?, '{}','2026-09-10T00:00:00Z')`);
  rows.forEach(([id, title, address], index) => {
    listingInsert.run(id, id, title, title, address);
    sqlite.prepare(`UPDATE listings SET operating_memo=? WHERE id=?`).run(
      `임)010-2000-${String(index).padStart(4, "0")}`, id
    );
    const active = id === "P-held-fallback" ? 0 : 1;
    const missing = active ? 0 : 3;
    sourceInsert.run(`S-${id}`, id, "네이버", String(1000 + index), active, missing, JSON.stringify({
      propertyId: id, originalId: `naver:${1000 + index}`, source: "네이버", buildingName: title,
      address, room: "1층", tradeType: "lease", deposit: 1000, rent: 80
    }));
    sourceInsert.run(`G-${id}`, id, "공실박스", String(2000 + index), 0, 3, JSON.stringify({
      propertyId: id, originalId: `gongsil:${2000 + index}`, source: "공실박스", buildingName: title,
      address, room: "1층", tradeType: "lease", deposit: 1000, rent: 80
    }));
    sqlite.prepare(`INSERT INTO listing_contacts (
      id,listing_id,source_id,role,name,phone,normalized_phone,status,first_seen_at,last_seen_at
    ) VALUES (?,?,?,?,?,?,?,'active','2026-09-10T00:00:00Z','2026-09-10T00:00:00Z')`).run(
      `C-${id}`, id, `G-${id}`, "임대인", `${title} 연락처`, `010-1000-${String(index).padStart(4, "0")}`,
      `0101000${String(index).padStart(4, "0")}`
    );
  });
  const holdInsert = sqlite.prepare(`INSERT INTO listing_data_quality_holds
    (listing_id,issue_code,state,blocks_publication) VALUES (?,?,?,?)`);
  holdInsert.run("P-held", "lease_sale_contamination", "open", 1);
  holdInsert.run("P-held-fallback", "lease_sale_contamination", "open", 1);
  holdInsert.run("P-resolved", "lease_sale_contamination", "resolved", 1);
  holdInsert.run("P-nonblock", "review_note", "open", 0);

  const prepare = (sql) => {
    const statement = sqlite.prepare(sql);
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return statement.get(...this.args) || null; },
      async all() { return { results: statement.all(...this.args) }; },
      async run() {
        const result = statement.run(...this.args);
        return { success: true, meta: { changes: Number(result.changes) } };
      }
    };
  };
  return { sqlite, env: { DB: { prepare } } };
}

test("open publication holds are absent from every public listing read path", async () => {
  const { sqlite, env } = database();
  const user = { email: "reader@example.test", role: "member" };
  try {
    const csv = await buildD1SheetCsv(env);
    assert.match(csv, /공개매물/);
    assert.match(csv, /해제매물/);
    assert.match(csv, /검토표시매물/);
    assert.doesNotMatch(csv, /차단매물|차단대체매물/);

    const unified = await handleD1GetAction(env, user, { action: "unifiedListings" });
    assert.deepEqual(Object.keys(unified.groups).sort(), ["P-nonblock", "P-resolved", "P-visible"]);
    assert.deepEqual(Object.keys(unified.sourceSearchIds).sort(), ["P-nonblock", "P-resolved", "P-visible"]);

    const changes = await handleD1GetAction(env, user, {
      action: "listingChanges",
      ids: "P-visible,P-held,P-resolved,P-nonblock,P-held-fallback"
    });
    assert.deepEqual(changes.items.map((row) => row.property_id).sort(), [
      "P-nonblock", "P-resolved", "P-visible"
    ]);

    const blockedDetail = await handleD1GetAction(env, user, {
      action: "unifiedListingDetail", propertyId: "P-held"
    });
    assert.deepEqual(blockedDetail.originals, []);

    const blockedContacts = await handleD1GetAction(env, user, {
      action: "unifiedListingContacts", propertyId: "P-held"
    });
    assert.equal(blockedContacts.contactCount, 0);
    assert.deepEqual(blockedContacts.contacts, []);

    const nonblockingContacts = await handleD1GetAction(env, user, {
      action: "unifiedListingContacts", propertyId: "P-nonblock"
    });
    assert.equal(nonblockingContacts.contactCount, 1);
    assert.equal(nonblockingContacts.contacts[0].id, "C-P-nonblock");

    const blockedTellSearch = await handleD1GetAction(env, user, {
      action: "tellContacts", query: "차단매물"
    });
    assert.deepEqual(blockedTellSearch.contacts, []);

    const nonblockingTellSearch = await handleD1GetAction(env, user, {
      action: "tellContacts", query: "검토표시매물"
    });
    assert.deepEqual(
      [...new Set(nonblockingTellSearch.contacts.map((contact) => contact.propertyId))],
      ["P-nonblock"]
    );
    assert.deepEqual(
      nonblockingTellSearch.contacts.map((contact) => contact.contactSource).sort(),
      ["공실박스", "직접 메모"].sort()
    );

    sqlite.prepare(`UPDATE listing_data_quality_holds SET state='resolved'
      WHERE listing_id='P-held'`).run();
    const restoredDetail = await handleD1GetAction(env, user, {
      action: "unifiedListingDetail", propertyId: "P-held"
    });
    assert.equal(restoredDetail.originals.length, 1);
    assert.equal(restoredDetail.originals[0].propertyId, "P-held");

    const restoredContacts = await handleD1GetAction(env, user, {
      action: "unifiedListingContacts", propertyId: "P-held"
    });
    assert.equal(restoredContacts.contactCount, 1);

    const restoredTellSearch = await handleD1GetAction(env, user, {
      action: "tellContacts", query: "차단매물"
    });
    assert.deepEqual(
      [...new Set(restoredTellSearch.contacts.map((contact) => contact.propertyId))],
      ["P-held"]
    );
    assert.deepEqual(
      restoredTellSearch.contacts.map((contact) => contact.contactSource).sort(),
      ["공실박스", "직접 메모"].sort()
    );
  } finally {
    sqlite.close();
  }
});
