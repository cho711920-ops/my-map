import assert from "node:assert/strict";
import test from "node:test";

import { handleD1PostAction } from "../cloudflare/src/d1-api.js";

function quickAddDatabase({ exact = null, similar = null } = {}) {
  const calls = [];
  const database = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          calls.push({ sql, args });
          return this;
        },
        async first() {
          if (/AND address = \?1 AND room = \?2/.test(sql)) return exact;
          if (/AND address = \?1 LIMIT 1/.test(sql)) return similar;
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { database, calls };
}

function quickAddValues({ room = "6층", area = 20 } = {}) {
  const values = Array(25).fill("");
  values[0] = "서림빌딩";
  values[1] = "서구 탄방동 1028";
  values[2] = room;
  values[3] = "사무실";
  values[4] = 1000;
  values[5] = 80;
  values[8] = area;
  values[14] = "직접등록";
  values[15] = `TEST-${room}-${area}`;
  return values;
}

const user = { email: "owner@example.com", role: "member" };

test("quick add saves a distinct floor even when the same address already exists", async () => {
  const existing = {
    property_id: "EXISTING-1",
    title: "서림빌딩",
    address: "서구 탄방동 1028",
    room: "1층",
    deposit: 1000,
    monthly_rent: 80
  };
  const { database, calls } = quickAddDatabase({ exact: null, similar: existing });

  const result = await handleD1PostAction({ DB: database }, user, {
    action: "quickAdd",
    requestId: "quick-add-distinct-floor",
    values: quickAddValues({ room: "6층", area: 20 })
  });

  assert.equal(result.persisted, true);
  assert.equal(result.propertyId, "TEST-6층-20");
  assert.ok(calls.some(({ sql }) => /INSERT INTO listings/.test(sql)));
  const exactLookup = calls.find(({ sql }) => /AND address = \?1 AND room = \?2/.test(sql));
  assert.deepEqual(exactLookup.args, ["서구 탄방동 1028", "6층", 1000, 80, 20]);
});

test("quick add still blocks a fully identical listing", async () => {
  const existing = {
    property_id: "EXISTING-2",
    title: "서림빌딩",
    address: "서구 탄방동 1028",
    room: "6층",
    deposit: 1000,
    monthly_rent: 80
  };
  const { database, calls } = quickAddDatabase({ exact: existing });

  const result = await handleD1PostAction({ DB: database }, user, {
    action: "quickAdd",
    requestId: "quick-add-exact-duplicate",
    values: quickAddValues({ room: "6층", area: 20 })
  });

  assert.equal(result.persisted, false);
  assert.equal(result.duplicateType, "exact");
  assert.equal(calls.some(({ sql }) => /INSERT INTO listings/.test(sql)), false);
});
