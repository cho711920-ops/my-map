import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { handleD1GetAction, handleD1PostAction } from "../cloudflare/src/d1-api.js";

function d1Database() {
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
  const wrap = (sql) => {
    const statement = sqlite.prepare(sql);
    const wrapped = {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return statement.get(...this.args) || null; },
      async all() { return { results: statement.all(...this.args) }; },
      async run() {
        const result = statement.run(...this.args);
        return { success: true, meta: { changes: Number(result.changes) } };
      }
    };
    return wrapped;
  };
  return { sqlite, DB: { prepare: wrap, async batch(statements) { return Promise.all(statements.map((entry) => entry.run())); } } };
}

test("mutation request IDs replay once and cannot cross account boundaries", async () => {
  const { sqlite, DB } = d1Database();
  const owner = { email: "owner@example.test", role: "owner" };
  const other = { email: "other@example.test", role: "owner" };
  try {
    const first = await handleD1PostAction({ DB }, owner, {
      action: "saveCloudState", requestId: "favorite-save-1", scope: "preferences",
      recordKey: "default", expectedVersion: 0, data: { theme: "light" }
    });
    assert.equal(first.replayed, undefined);

    const replay = await handleD1PostAction({ DB }, owner, {
      action: "saveCloudState", requestId: "favorite-save-1", scope: "preferences",
      recordKey: "default", expectedVersion: 0, data: { theme: "dark" }
    });
    assert.equal(replay.replayed, true);
    const stored = sqlite.prepare("SELECT value_json FROM cloud_state WHERE owner_email=?").get(owner.email);
    assert.deepEqual(JSON.parse(stored.value_json), { theme: "light" });

    await assert.rejects(() => handleD1PostAction({ DB }, other, {
      action: "saveCloudState", requestId: "favorite-save-1", scope: "preferences",
      recordKey: "default", expectedVersion: 0, data: { theme: "other" }
    }), (error) => error.statusCode === 409);

    const ownStatus = await handleD1GetAction({ DB }, owner, {
      action: "mutationStatus", requestId: "favorite-save-1"
    });
    assert.equal(ownStatus.ready, true);
    assert.equal(ownStatus.result.requestId, "favorite-save-1");
    const hiddenStatus = await handleD1GetAction({ DB }, other, {
      action: "mutationStatus", requestId: "favorite-save-1"
    });
    assert.deepEqual(hiddenStatus, { ok: true, ready: false, requestId: "favorite-save-1" });
  } finally {
    sqlite.close();
  }
});
