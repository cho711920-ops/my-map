import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { handleD1GetAction, handleD1PostAction } from "../cloudflare/src/d1-api.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE mutation_results (
      request_id TEXT PRIMARY KEY, owner_email TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'completed', result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE cloud_state (
      owner_email TEXT NOT NULL, scope TEXT NOT NULL, record_key TEXT NOT NULL,
      value_json TEXT NOT NULL DEFAULT 'null', version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(owner_email, scope, record_key)
    );
  `);
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
  return {
    sqlite,
    DB: {
      prepare,
      async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
    }
  };
}

test("generic cloud state uses account-scoped compare-and-swap versions", async () => {
  const { sqlite, DB } = database();
  const alice = { email: "alice@example.test", role: "member" };
  const bob = { email: "bob@example.test", role: "member" };
  try {
    const first = await handleD1PostAction({ DB }, alice, {
      action: "saveCloudState", requestId: "alice-create", scope: "preferences",
      recordKey: "default", expectedVersion: 0, data: { theme: "light" }
    });
    assert.equal(first.version, 1);

    await assert.rejects(handleD1PostAction({ DB }, alice, {
      action: "saveCloudState", requestId: "alice-stale", scope: "preferences",
      recordKey: "default", expectedVersion: 0, data: { theme: "stale-dark" }
    }), (error) => error.statusCode === 409);
    assert.deepEqual(JSON.parse(sqlite.prepare(
      "SELECT value_json FROM cloud_state WHERE owner_email=? AND scope='preferences'"
    ).get(alice.email).value_json), { theme: "light" });

    const next = await handleD1PostAction({ DB }, alice, {
      action: "saveCloudState", requestId: "alice-update", scope: "preferences",
      recordKey: "default", expectedVersion: 1, data: { theme: "dark" }
    });
    assert.equal(next.version, 2);

    const separateAccount = await handleD1PostAction({ DB }, bob, {
      action: "saveCloudState", requestId: "bob-create", scope: "preferences",
      recordKey: "default", expectedVersion: 0, data: { theme: "blue" }
    });
    assert.equal(separateAccount.version, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM cloud_state WHERE scope='preferences'").get().count, 2);

    await assert.rejects(handleD1PostAction({ DB }, alice, {
      action: "saveCloudState", requestId: "alice-no-precondition", scope: "preferences",
      recordKey: "default", data: { theme: "unsafe" }
    }), (error) => error.statusCode === 428);
  } finally {
    sqlite.close();
  }
});

test("favorite list values and deletion tombstones reject a stale device atomically", async () => {
  const { sqlite, DB } = database();
  const user = { email: "favorite@example.test", role: "member" };
  const save = (requestId, expectedVersion, data, deletedIds = {}) => handleD1PostAction({ DB }, user, {
    action: "saveCloudState", requestId, scope: "favorites", recordKey: "default",
    expectedVersion, data, deletedIds
  });
  try {
    const base = [{ id: "folder-1", name: "관심", itemKeys: ["property:A"], updatedAt: "2026-09-10T00:00:00Z" }];
    assert.equal((await save("favorite-create", 0, base)).version, 1);

    const remoteWinner = [{ ...base[0], itemKeys: ["property:A", "property:REMOTE"], updatedAt: "2026-09-10T00:01:00Z" }];
    assert.equal((await save("favorite-remote", 1, remoteWinner)).version, 2);
    await assert.rejects(save("favorite-stale", 1, [{
      ...base[0], itemKeys: ["property:A", "property:LOCAL"], updatedAt: "2026-09-10T00:02:00Z"
    }]), (error) => error.statusCode === 409);

    let loaded = await handleD1GetAction({ DB }, user, {
      action: "loadCloudState", scope: "favorites", recordKey: "default"
    });
    assert.equal(loaded.version, 2);
    assert.deepEqual(loaded.data, remoteWinner);

    assert.equal((await save("favorite-delete", 2, [], { "folder-1": 12345 })).version, 3);
    await assert.rejects(save("favorite-resurrect", 2, remoteWinner), (error) => error.statusCode === 409);
    loaded = await handleD1GetAction({ DB }, user, {
      action: "loadCloudState", scope: "favorites", recordKey: "default"
    });
    assert.deepEqual(loaded.data, []);
    assert.equal(loaded.deletedIds["folder-1"], 12345);

    const rows = sqlite.prepare(`SELECT scope, version FROM cloud_state
      WHERE owner_email=? ORDER BY scope`).all(user.email);
    assert.deepEqual(rows.map((row) => [row.scope, row.version]), [
      ["favorites", 3], ["favoritesDeleted", 3]
    ]);
  } finally {
    sqlite.close();
  }
});

test("an operations snapshot older than five minutes is recalculated before use", async () => {
  const { sqlite, DB } = database();
  try {
    sqlite.exec(`
      CREATE TABLE listings (id TEXT PRIMARY KEY, status TEXT);
      CREATE TABLE listing_sources (id TEXT PRIMARY KEY, listing_id TEXT, active INTEGER, missing_count INTEGER);
      CREATE TABLE collector_raw (id TEXT PRIMARY KEY, processing_state TEXT);
      CREATE TABLE customers (id TEXT PRIMARY KEY, status TEXT);
      CREATE TABLE customer_matches (id TEXT PRIMARY KEY, customer_id TEXT, state TEXT, created_at TEXT);
      CREATE TABLE customer_activities (id TEXT PRIMARY KEY, next_contact_date TEXT);
      CREATE TABLE listing_history (id INTEGER PRIMARY KEY);
      CREATE TABLE operations_snapshots (
        snapshot_key TEXT PRIMARY KEY, payload_json TEXT, calculated_at TEXT, updated_at TEXT
      );
      INSERT INTO listings(id,status) VALUES ('P-1','active');
      INSERT INTO operations_snapshots(snapshot_key,payload_json,calculated_at,updated_at)
      VALUES ('main','{"activeMaster":999}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    `);
    const result = await handleD1GetAction({ DB }, { email: "reader@example.test", role: "member" }, {
      action: "operationsDashboard"
    });
    assert.equal(result.activeMaster, 1);
    assert.equal(result.source, "D1-SNAPSHOT");
    const saved = JSON.parse(sqlite.prepare(
      "SELECT payload_json FROM operations_snapshots WHERE snapshot_key='main'"
    ).get().payload_json);
    assert.equal(saved.activeMaster, 1);
  } finally {
    sqlite.close();
  }
});
