import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { refreshCustomerMatchesForListings, remainingMasterValues, separatedMasterValues } from "../cloudflare/src/d1-api.js";
import { listingTradeTypesCanMerge, normalizeListingTradeType } from "../cloudflare/src/listing-trade.js";
import { carryConfirmedVisitMemo } from "../cloudflare/src/visit-status.js";

const source = readFileSync(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
const moveStart = source.indexOf("async function moveOriginal(");
const moveEnd = source.indexOf("function splitRequirement(", moveStart);
const moveOriginal = new Function("clean", "parseJson", "normalizeListingTradeType", "listingTradeTypesCanMerge",
  "remainingMasterValues", "separatedMasterValues", "carryConfirmedVisitMemo",
  source.slice(moveStart, moveEnd) + "; return moveOriginal;")(
  (value) => String(value ?? "").trim(), (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
  normalizeListingTradeType, listingTradeTypesCanMerge, remainingMasterValues, separatedMasterValues, carryConfirmedVisitMemo);

function moveEnv(overrides = {}, targetTrade = "lease") {
  const writes = [];
  const row = { id: "O-TEST", listing_id: "M-ORIGIN", trade_type: "lease", master_trade_type: "lease",
    list_snapshot_json: JSON.stringify({ tradeType: "lease", revision: 1 }), ...overrides };
  return {
    writes,
    DB: {
      prepare(sql) {
        return { sql, bind() { return this; },
          async first() {
            if (sql.includes("SELECT s.*")) {
              assert.match(sql, /l\.trade_type AS master_trade_type/);
              return row;
            }
            if (sql.includes("SELECT id, operating_memo, trade_type")) return { id: "M-TARGET", trade_type: targetTrade };
            throw new Error("Unexpected query: " + sql);
          },
          async all() { return { results: [] }; },
          async run() { writes.push(sql); return { meta: { changes: 0 } }; }
        };
      },
      async batch(statements) { writes.push(...statements.map((statement) => statement.sql)); return statements.map(() => ({ meta: { changes: 0 } })); }
    }
  };
}

test("original moves reject source, snapshot, and parent trade disagreements before any listing writes", async () => {
  for (const overrides of [
    { trade_type: "sale" },
    { master_trade_type: "sale" },
    { list_snapshot_json: JSON.stringify({ tradeType: "sale" }) },
    { trade_type: "unknown" },
    { list_snapshot_json: JSON.stringify({ tradeType: "unknown" }) }
  ]) {
    for (const targetMasterId of ["M-TARGET", "NEW"]) {
      const env = moveEnv(overrides);
      await assert.rejects(moveOriginal(env, { email: "test@example.com" }, { originalId: "O-TEST", targetMasterId }),
        (error) => error.statusCode === 400 && /거래유형/.test(error.message));
      assert.deepEqual(env.writes, []);
    }
  }
});

test("original moves still reject cross-market targets and accept a consistent same-market move", async () => {
  const crossed = moveEnv({}, "sale");
  await assert.rejects(moveOriginal(crossed, {}, { originalId: "O-TEST", targetMasterId: "M-TARGET" }), /서로 합칠 수 없습니다/);
  assert.deepEqual(crossed.writes, []);
  for (const trade of ["lease", "sale"]) {
    const env = moveEnv({ trade_type: trade, master_trade_type: trade,
      list_snapshot_json: JSON.stringify({ tradeType: trade }) }, trade);
    const result = await moveOriginal(env, {}, { originalId: "O-TEST", targetMasterId: "M-TARGET" });
    assert.equal(result.ok, true);
    assert.ok(env.writes.some((sql) => sql.startsWith("UPDATE listing_sources")));
  }
});

test("new sale listings cannot become zero-rent customer recommendations", async () => {
  const statements = [];
  const listings = [
    { id: "M-LEASE", trade_type: "lease" },
    { id: "M-SALE", trade_type: "sale" },
    { id: "M-UNKNOWN", trade_type: "unknown" },
    { id: "M-LEGACY" }
  ].map((row) => ({ status: "active", address: "서구 갈마동 1-1", deposit: 0, monthly_rent: 0, ...row }));
  const env = { DB: {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; }, async all() {
        if (sql.includes("FROM customers")) return { results: [{ id: "C-LEASE", requirements_json: "{}" }] };
        assert.match(sql, /listing_type, trade_type,/);
        return { results: listings };
      } };
    },
    async batch(batch) { statements.push(...batch); return []; }
  } };
  const result = await refreshCustomerMatchesForListings(env, listings.map((row) => row.id));
  assert.equal(result.matched, 2);
  assert.equal(result.removed, 2);
  assert.deepEqual(statements.filter((row) => row.sql.includes("INSERT INTO customer_matches")).map((row) => row.values[1]), ["M-LEASE", "M-LEGACY"]);
  assert.deepEqual(statements.filter((row) => row.sql.includes("DELETE FROM customer_matches")).map((row) => row.values[1]), ["M-SALE", "M-UNKNOWN"]);
  const rebuild = source.slice(source.indexOf("async function rebuildCustomerMatches("), source.indexOf("function customerRequirementsFromInput("));
  assert.match(rebuild, /listing_type, trade_type,/);
  assert.match(rebuild, /evaluateCustomerListing\(requirements, listing\)/);
});

const recoveryStart = source.indexOf("async function completionSourceRecoveryPlan(");
const recoveryEnd = source.indexOf("async function toggleDone(", recoveryStart);
const recoveryPlan = new Function("clean", "listingTradeTypesCanMerge",
  source.slice(recoveryStart, recoveryEnd) + "; return completionSourceRecoveryPlan;")(
  (value) => String(value ?? "").trim(), listingTradeTypesCanMerge);

test("completion recovery only reconnects detached originals from the same market", async () => {
  const rows = [
    { id: "O-LEASE", trade_type: "lease", active: 1 },
    { id: "O-SALE", trade_type: "sale", active: 1 },
    { id: "O-LEGACY", active: 0 },
    { id: "O-UNKNOWN", trade_type: "unknown", active: 1 },
    { id: "O-MOVED", listing_id: "M-OTHER", trade_type: "lease", active: 1 }
  ];
  for (const [targetTrade, expectedIds, conflicts] of [
    ["lease", ["O-LEASE", "O-LEGACY"], 3],
    ["sale", ["O-SALE"], 4],
    [undefined, ["O-LEASE", "O-LEGACY"], 3],
    ["unknown", [], 5]
  ]) {
    const env = { DB: { prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async first() { assert.match(sql, /SELECT trade_type FROM listings/); return { trade_type: targetTrade }; },
        async all() { assert.match(sql, /active, trade_type FROM listing_sources/); return { results: rows }; }
      };
    } } };
    const plan = await recoveryPlan(env, "M-TARGET", [...rows, { id: "O-MISSING" }], "2026-09-30T00:00:00Z");
    assert.deepEqual(plan.recovered.map((row) => row.id), expectedIds);
    assert.equal(plan.statements.length, expectedIds.length * 3);
    assert.equal(plan.conflicts, conflicts);
    assert.equal(plan.missing, 1);
    assert.ok(plan.statements.every((statement) => expectedIds.includes(statement.values[2])));
  }
});
