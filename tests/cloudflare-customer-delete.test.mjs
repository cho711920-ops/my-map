import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { deleteCustomer } from "../cloudflare/src/d1-api.js";

test("customer deletion removes matches and activities in the same D1 batch", async () => {
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          values: [],
          bind(...values) { this.values = values; return this; },
          async first() {
            if (sql.includes("SELECT id, name FROM customers")) return { id: "C-1", name: "하하99" };
            return { match_count: 43, activity_count: 2 };
          }
        };
        statements.push(statement);
        return statement;
      },
      async batch(batchStatements) {
        assert.deepEqual(batchStatements.map((entry) => entry.sql), [
          "DELETE FROM customer_matches WHERE customer_id=?1",
          "DELETE FROM customer_activities WHERE customer_id=?1",
          "DELETE FROM customers WHERE id=?1"
        ]);
        assert.ok(batchStatements.every((entry) => entry.values[0] === "C-1"));
        return [{ meta: { changes: 43 } }, { meta: { changes: 2 } }, { meta: { changes: 1 } }];
      }
    }
  };

  const result = await deleteCustomer(env, { customerId: "C-1" });
  assert.equal(result.deleted, true);
  assert.equal(result.customerName, "하하99");
  assert.equal(result.deletedMatches, 43);
  assert.equal(result.deletedActivities, 2);
});

test("customer matching UI requires confirmation and refreshes after deletion", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../js/operations-center-v7.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/operations-center-v7.css", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");

  assert.match(ui, /class="customer-delete-button-v728"[^>]+deleteSelectedCustomerV728/);
  assert.match(ui, /window\.confirm\(message\)/);
  assert.match(ui, /삭제 후에는 복구할 수 없습니다/);
  assert.match(ui, /apiPost\("deleteCustomer", \{ customerId: customerId \}\)/);
  assert.match(ui, /sessionStorage\.removeItem\(OPERATIONS_CACHE_KEY\)/);
  assert.match(ui, /return loadOperationsData\(true\)/);
  assert.match(css, /customer-delete-button-v728[^}]+color:#bd1e2d/);
  assert.match(worker, /OPERATIONS_CACHE_ACTIONS[\s\S]*?"deleteCustomer"/);
  assert.match(html, /operations-center-v7\.css\?v=7\.20\.7-customer-delete/);
  assert.match(html, /operations-center-v7\.js\?v=7\.22\.4-overlay-exclusivity/);
});
