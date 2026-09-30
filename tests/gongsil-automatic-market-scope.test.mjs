import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("js/gongsil-collector.js", "utf8");
function functions(names, context = {}) {
  const code = names.map(name => {
    const found = source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  }`, "m"));
    assert.ok(found, name);
    return found[0];
  }).join("\n");
  vm.runInNewContext(code + "\nthis.api = {" + names.join(",") + "};", context);
  return context.api;
}
const plain = value => JSON.parse(JSON.stringify(value));

test("automatic market terms and observed IDs are isolated while manual terms stay dual", () => {
  const helper = functions(["gongsilAdvertisedOffers", "getTradeOffers", "getTradeTerms", "observedOffers", "observedTradeTypes"], {
    getSaleCategory: () => "commercial", recordSourceId: item => item.Bfidx
  });
  const item = { Bfidx: "dual", Subtype: "13", Me: 37000, Bo: 2000, Mm: 150 };
  assert.deepEqual(plain(helper.observedTradeTypes([item])), ["lease", "sale"]);
  for (const market of ["lease", "sale"]) {
    assert.equal(helper.getTradeTerms(item, null, market).tradeType, market);
    assert.deepEqual(plain(helper.observedOffers([item], market)), [{ sourceId: "dual", tradeType: market }]);
    assert.deepEqual(plain(helper.observedTradeTypes([item], market)), [market]);
  }
  assert.equal(helper.getTradeTerms({ Subtype: "3", Me: 0, Bo: 9999, Mm: 100 }, null, "sale"), null);
  const detail = { floorinfo: { Moneys: [{ Ty: "매매", Price: 40000 }] } };
  assert.equal(helper.getTradeTerms(item, detail, "lease"), null);
});

test("automatic execution scope always resets and cannot resume another market's pending save", async () => {
  const state = { busy: false, collectionTradeType: "", pendingSave: null };
  const calls = [];
  const helper = functions(["runAutomatic"], { state, runAutomaticTarget: async target => {
    calls.push(state.collectionTradeType);
    if (target.fail) throw new Error("provider failure");
    return state.collectionTradeType;
  } });
  assert.equal(await helper.runAutomatic({}), "lease");
  assert.equal(state.collectionTradeType, "");
  assert.equal(await helper.runAutomatic({ tradeType: "sale" }), "sale");
  await assert.rejects(helper.runAutomatic({ tradeType: "sale", fail: true }), /provider failure/);
  assert.equal(state.collectionTradeType, "");
  await assert.rejects(helper.runAutomatic({ tradeType: "mixed" }), /거래유형/);
  state.pendingSave = { metadata: {} };
  await assert.rejects(helper.runAutomatic({ tradeType: "lease" }), /다른 거래유형/);
  state.pendingSave = { metadata: { collectionTradeType: "sale" } };
  await assert.rejects(helper.runAutomatic({ tradeType: "lease" }), /다른 거래유형/);
  assert.equal(await helper.runAutomatic({ tradeType: "sale" }), "sale");
  assert.deepEqual(calls, ["lease", "sale", "sale", "sale"]);
});

test("lease, sale and old mixed checkpoints cannot reuse each other's offsets", () => {
  let stored;
  const helper = functions(["collectionSignature", "getSavedProgressForRecords"], {
    recordSignatureId: item => item?.externalId || "", SAVE_PROGRESS_KEY: "test-progress",
    localStorage: { getItem: () => JSON.stringify(stored) }
  });
  const manual = [{ externalId: "same" }];
  const lease = [{ externalId: "same", collectionTradeType: "lease" }];
  const sale = [{ externalId: "same", collectionTradeType: "sale" }];
  assert.equal(new Set([manual, lease, sale].map(helper.collectionSignature)).size, 3);
  stored = { signature: helper.collectionSignature(sale), offset: 1 };
  assert.equal(helper.getSavedProgressForRecords(lease), null);
  assert.equal(helper.getSavedProgressForRecords(manual), null);
  assert.equal(helper.getSavedProgressForRecords(sale).offset, 1);
  stored = { signature: "1||", updatedAt: new Date().toISOString(), offset: 1 };
  assert.equal(helper.getSavedProgressForRecords(lease), null);
  assert.equal(helper.getSavedProgressForRecords(sale), null);
  assert.equal(helper.getSavedProgressForRecords(manual).offset, 1);
});

test("both server request stages carry the explicit scoped market without rewriting raw evidence", async () => {
  const requests = [];
  const context = { VERSION: "test", state: { stopRequested: false }, text: value => String(value || ""),
    setStatus() {}, updateDashboard() {}, setProgress() {},
    postAppsScriptWithRetry: async body => { requests.push(body); },
    pollMutationStatus: async () => ({ ok: true, unchanged: 0, changed: 0, unknown: 1, needsDetail: ["dual"] }),
    isBusyMutationResult: () => false, getTradeTerms: (_item, _detail, market) => ({ tradeType: market, deposit: 1000, rent: 50 }),
    recordSourceId: item => item.Bfidx, gongsilListSnapshot: item => JSON.stringify(item), getPyeong: () => 20, getRoom: () => "1층"
  };
  const helper = functions(["classifyGongsilManifest", "sendAppsScriptBatch"], context);
  const item = { Bfidx: "dual", Me: 50000, Bo: 1000, Mm: 50 };
  for (const market of ["lease", "sale"]) {
    const metadata = { sessionId: `session-${market}`, collectionTradeType: market };
    await helper.classifyGongsilManifest([item], metadata, "test-key");
    await helper.sendAppsScriptBatch([{ raw: { list: item } }], "test-key", 0, metadata);
    assert.equal(requests.at(-2).collectionTradeType, market);
    assert.equal(requests.at(-2).entries[0].tradeType, market);
    assert.deepEqual(JSON.parse(requests.at(-2).entries[0].listSnapshot), item);
    assert.equal(requests.at(-1).collectionTradeType, market);
    assert.deepEqual(requests.at(-1).records[0].raw.list, item);
  }
});
