import assert from "node:assert/strict";
import test from "node:test";
import { getBuildingRegister } from "../cloudflare/src/building-register-api.js";

const parcel = { sigunguCd: "30140", bjdongCd: "10200", platGbCd: "0", bun: "0012", ji: "0003" };
function cachedEnv(ageDays) {
  const checkedAt = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  const data = { ok: true, action: "buildingRegister", version: 11, fetchedAt: checkedAt,
    buildings: [{ buildingName: "saved", approvalDate: "20000101" }], units: [], parcel };
  const state = { cacheWrites: 0, badgeIds: [], data, checkedAt };
  const DB = { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        assert.match(sql, /FROM building_cache/);
        return { summary_json: JSON.stringify(state.data), details_json: JSON.stringify(state.data), checked_at: checkedAt };
      },
      async run() {
        if (/INSERT INTO building_cache/.test(sql)) {
          state.cacheWrites += 1;
          state.data = JSON.parse(args[3] || args[2]);
        } else {
          assert.match(sql, /UPDATE listings/);
          state.badgeIds.push(args[6]);
        }
        return { meta: { changes: 1 } };
      }
    };
  } };
  return { DB, DATA_GO_KR_SERVICE_KEY: "test", state };
}
function freshXml(input) {
  const title = String(input).includes("getBrTitleInfo");
  const row = title ? "<item><mgmBldrgstPk>fresh-1</mgmBldrgstPk><bldNm>fresh</bldNm><useAprDay>20100101</useAprDay></item>" : "";
  return `<response><header><resultCode>00</resultCode></header><body><items>${row}</items><totalCount>${title ? 1 : 0}</totalCount></body></response>`;
}

test("conditional revalidation keeps a fresh seven-day server cache without public API calls", async () => {
  const env = cachedEnv(6);
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("unexpected fetch"); };
  try {
    const data = await getBuildingRegister(env, { ...parcel, mode: "full", revalidate: "1" });
    assert.equal(data.cached, true);
    assert.equal(data.buildings[0].buildingName, "saved");
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("stale server registers are revalidated once for concurrent viewers with separate listing identities", async () => {
  const env = cachedEnv(8);
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async input => {
    fetches += 1;
    return new Response(freshXml(input), { status: 200 });
  };
  try {
    const [a, b] = await Promise.all([
      getBuildingRegister(env, { ...parcel, mode: "full", revalidate: "1", propertyId: "a" }),
      getBuildingRegister(env, { ...parcel, mode: "full", revalidate: "1", propertyId: "b" })
    ]);
    assert.equal(fetches, 6);
    assert.equal(env.state.cacheWrites, 1);
    assert.equal(a.propertyId, "a");
    assert.equal(b.propertyId, "b");
    assert.notEqual(a, b);
    assert.equal(a.buildings[0].buildingName, "fresh");
    assert.deepEqual(env.state.badgeIds.sort(), ["a", "b"]);
    await getBuildingRegister(env, { ...parcel, revalidate: "1" });
    assert.equal(fetches, 6, "the persisted fresh record is reused after completion");
  } finally { globalThis.fetch = originalFetch; }
});

test("failed server revalidation retains complete cache and prevents immediate retry storms", async () => {
  const env = cachedEnv(8);
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("offline"); };
  try {
    const data = await getBuildingRegister(env, { ...parcel, revalidate: "1" });
    assert.equal(data.cached, true);
    assert.equal(data.refreshDeferred, true);
    assert.equal(data.buildings[0].buildingName, "saved");
    assert.equal(env.state.cacheWrites, 0);
    const attempted = fetches;
    assert.equal(attempted, 6);
    await getBuildingRegister(env, { ...parcel, revalidate: "1" });
    assert.equal(fetches, attempted);
  } finally { globalThis.fetch = originalFetch; }
});

test("summary refresh cannot hide the age of an older full response", async () => {
  const env = cachedEnv(8);
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = function(sql) {
    const statement = originalPrepare(sql);
    if (/FROM building_cache/.test(sql)) {
      const first = statement.first;
      statement.first = async () => ({ ...await first(), checked_at: new Date().toISOString() });
    }
    return statement;
  };
  globalThis.fetch = async input => { fetches += 1; return new Response(freshXml(input)); };
  try {
    await getBuildingRegister(env, { ...parcel, revalidate: "1" });
    assert.equal(fetches, 6, "payload fetchedAt, not the row's most recent summary write, defines age");
  } finally { globalThis.fetch = originalFetch; }
});
