const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const mapSource = fs.readFileSync("js/map.js", "utf8");
const unifiedSource = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const proof = value => "sha256-v1:" + String(value).padStart(64, "0");
function functionSource(name) {
  const start = mapSource.indexOf("function " + name + "(");
  assert.ok(start >= 0, name);
  return mapSource.slice(start, mapSource.indexOf("\n}", start) + 2);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function flush() { for (let index = 0; index < 16; index++) await Promise.resolve(); }
function item(id, version = 1) {
  return {propertyId:id, sourceSnapshotKey:proof(version), address:"서구 테스트동 " + id,
    key:"favorite-" + id, room:"1층", memo:"보존 메모 " + id, source:"네이버",
    deposit:1000, rent:60, area:23.2, state:"active", sheetRow:3};
}
function original(id, options = {}) {
  return {propertyId:id, originalId:"source-" + id, providerSourceId:"advertisement-" + id,
    source:"네이버", active:1, availabilityKind:"active", candidateEligible:false,
    thumbnail:"https://example.invalid/" + id + ".jpg", photoCount:1,
    deposit:1000, rent:60, area:23.2, lastCheckedAt:"2026-10-15T01:00:00.000Z", ...options};
}
function inventory(entries) {
  const groups = {}, sourceSnapshotKeys = {}, sourceSnapshotPropertyIds = {}, sourceSearchIds = {};
  for (const [id, version, source = original(id)] of entries) {
    groups[id] = [source];
    sourceSnapshotKeys[id] = proof(version);
    sourceSnapshotPropertyIds[id] = id;
    sourceSearchIds[id] = ["naver:advertisement-" + id];
  }
  return {ok:true, groups, sourceSnapshotKeys, sourceSnapshotPropertyIds, sourceSearchIds};
}
function preserved(row) {
  const {key, memo, room, state, deposit, rent, area} = row;
  return {key, memo, room, state, deposit, rent, area};
}
function harness() {
  const reads = [], events = [], presentations = [];
  const context = {
    console:{warn(){}, error(){}}, Date, Promise, URLSearchParams,
    innerWidth:1280, allItems:[item("A"), item("B"), item("C")], currentItems:[],
    hideDone:true, doneOnly:false, isLoadingSheet:false, preserveActionSelectionDuringRender:false,
    jsListingsLoadGenerationV1:4, jsListingsRevisionV682:"production-current",
    addEventListener(){}, dispatchEvent(event){events.push(event);},
    CustomEvent:class {constructor(type, init){this.type = type; this.detail = init.detail;}},
    document:{getElementById(){return null;}, addEventListener(){}},
    JSDataAccessV6:{read(action, params, options) {
      const pending = deferred(); reads.push({action, params, options, ...pending}); return pending.promise;
    }},
    clean:value => String(value == null ? "" : value).trim(),
    itemKey:row => row.key,
    listingChangeRowToItemV683:row => ({...row}),
    getItemsDataSignatureV638:rows => JSON.stringify(rows.map(row =>
      [row.propertyId, row.key, row.memo, row.room, row.state, row.deposit, row.rent, row.sourceSnapshotKey])),
    captureAutoUpdateViewState:() => ({scrollTop:77, selectedKey:"favorite-A"}),
    applyFilter(){presentations.push(context.allItems.map(row => row.propertyId));},
    restoreAutoUpdateViewState(view){assert.equal(view.preserveVisibleListV1, false);},
    loadSheet(){throw new Error("Pending proof recovery must not redownload the complete dataset");}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(unifiedSource, context);
  for (const name of ["compatibleOriginalsResultV1", "originalMetadataMutationPendingV1",
    "refreshScopedOriginalsV1", "refreshOriginalMetadataPresentationV1", "recoverOriginalMetadataV1"]) {
    vm.runInContext(functionSource(name), context);
  }
  const api = context.JSUnifiedListingsV8;
  const oldCandidate = original("C", {active:0, candidateEligible:true, availabilityKind:"legacy_candidate"});
  api.attachCompatible(context.allItems, inventory([["A",1], ["B",1], ["C",1,oldCandidate]]));
  context.allItems[1].sourceSnapshotKey = proof(2);
  context.allItems[2].sourceSnapshotKey = proof(2);
  api.attachCompatible(context.allItems, inventory([["A",1]]), {scoped:true, preserveGlobalStatus:true});
  return {context, api, reads, events, presentations};
}

test("ready global phase with pending property proofs still performs bounded scoped recovery", async () => {
  const h = harness();
  assert.equal(h.api.getOriginalMetadataStatus().status, "ready");
  assert.equal(h.api.getOriginalMetadataStatus().retryable, false);
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()), ["B", "C"]);
  const pending = h.context.recoverOriginalMetadataV1(4);
  await flush();
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].action, "listingOriginals");
  assert.equal(h.reads[0].params.ids, "B,C");
  assert.equal(h.reads[0].options.cache, "no-store");
  h.reads[0].resolve({ok:true, items:[item("B",2),item("C",2)], unified:inventory([
    ["B",2,original("B",{lastCheckedAt:"2026-10-15T02:00:00.000Z"})],
    ["C",2,original("C",{lastCheckedAt:"2026-10-15T02:00:00.000Z"})]
  ])});
  assert.equal(await pending, true);
  assert.equal(h.api.getOriginalMetadataStatus().status, "ready");
  assert.equal(h.api.pendingCompatibleIds().length, 0);
  assert.match(h.api.cardParts(h.context.allItems[2]).thumbnail, /C\.jpg/);
  assert.equal(h.api.allOriginals("C")[0].active, 1);
  assert.equal(h.context.allItems[2].state, "active");
});

test("incomplete scoped inventory retains omitted photos and candidates until a later verified recovery", async () => {
  const h = harness(), saved = h.context.allItems.map(preserved), originalC = h.api.allOriginals("C")[0];
  let pending = h.context.recoverOriginalMetadataV1(4);
  await flush();
  h.reads[0].resolve({ok:true, items:[item("B",2)], unified:inventory([
    ["B",2,original("B",{thumbnail:"https://example.invalid/fresh-B.jpg",lastCheckedAt:"2026-10-15T02:00:00.000Z"})]
  ])});
  assert.equal(await pending, false);
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()), ["C"]);
  assert.equal(h.api.allOriginals("C")[0], originalC);
  assert.equal(h.context.allItems[2].unifiedCandidateOriginalCountV2, 1);
  assert.match(h.api.cardParts(h.context.allItems[1]).thumbnail, /fresh-B\.jpg/);
  h.context.doneOnly = true;
  assert.match(h.api.cardParts(h.context.allItems[2]).thumbnail, /C\.jpg/);
  h.context.doneOnly = false;
  assert.deepEqual(h.context.allItems.map(preserved), saved);
  pending = h.context.recoverOriginalMetadataV1(4, true);
  await flush();
  assert.equal(h.reads.length, 2);
  assert.equal(h.reads[1].params.ids, "C");
  h.reads[1].resolve({ok:true, items:[item("C",2)], unified:inventory([
    ["C",2,original("C",{lastCheckedAt:"2026-10-15T03:00:00.000Z"})]
  ])});
  assert.equal(await pending, true);
  assert.equal(h.api.getOriginalMetadataStatus().status, "ready");
  assert.equal(h.context.allItems[2].unifiedCandidateOriginalCountV2, 0);
  assert.deepEqual(h.context.allItems.map(preserved), saved);
  assert.equal(h.reads.length, 2, "No implicit per-card request or full download");
});

test("failed scoped recovery preserves known source groups and user values without an automatic request storm", async () => {
  const h = harness(), saved = h.context.allItems.map(preserved);
  const groups = h.context.allItems.map(row => h.api.allOriginals(row.propertyId)[0]);
  const pending = h.context.recoverOriginalMetadataV1(4);
  await flush();
  h.reads[0].reject(new Error("Fixture temporary D1 failure"));
  assert.equal(await pending, false);
  assert.deepEqual(h.context.allItems.map(preserved), saved);
  assert.deepEqual(h.context.allItems.map(row => h.api.allOriginals(row.propertyId)[0]), groups);
  assert.equal(h.context.allItems[2].unifiedCandidateOriginalCountV2, 1);
  for (const row of h.context.allItems.slice(0,2)) assert.match(h.api.cardParts(row).thumbnail, /\.jpg/);
  h.context.doneOnly = true;
  assert.match(h.api.cardParts(h.context.allItems[2]).thumbnail, /C\.jpg/);
  assert.equal(h.context.recoverOriginalMetadataV1(4), false);
  await flush();
  assert.equal(h.reads.length, 1);
});

test("scoped replies from an obsolete page generation cannot change sources or newly edited values", async () => {
  const h = harness();
  const before = h.api.allOriginals("B")[0];
  const pending = h.context.recoverOriginalMetadataV1(4);
  await flush();
  h.context.jsListingsLoadGenerationV1 = 5;
  h.context.allItems[1].memo = "새 화면에서 수정한 메모";
  h.reads[0].resolve({ok:true, items:[item("B",2)], unified:inventory([
    ["B",2,original("B",{thumbnail:"https://example.invalid/obsolete.jpg",lastCheckedAt:"2026-10-15T03:00:00.000Z"})]
  ])});
  assert.equal(await pending, false);
  assert.equal(h.api.allOriginals("B")[0], before);
  assert.equal(h.context.allItems[1].memo, "새 화면에서 수정한 메모");
  assert.doesNotMatch(h.api.cardParts(h.context.allItems[1]).thumbnail, /obsolete\.jpg/);
  assert.equal(h.presentations.length, 0);
});

test("a newly attached master is tracked for recovery even after a ready snapshot and repeated attachment emits no duplicate event", async () => {
  const h = harness();
  h.api.attachCompatible(h.context.allItems, inventory([["A",1], ["B",2],
    ["C",2,original("C",{lastCheckedAt:"2026-10-15T02:00:00.000Z"})]]));
  assert.equal(h.api.pendingCompatibleIds().length, 0);
  assert.equal(h.api.getOriginalMetadataStatus().status, "ready");
  const newItem = item("D");
  h.context.allItems.push(newItem);
  h.events.length = 0;
  h.api.attach(h.context.allItems);
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()), ["D"]);
  assert.equal(h.api.getOriginalMetadataStatus("D").ready, false);
  assert.match(h.api.cardParts(newItem).thumbnail, /사진 불러오기 지연/);
  assert.match(h.api.cardParts(newItem).sourceButton, /다시 불러오기/);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].detail.pendingCount, 1);
  h.api.attach(h.context.allItems);
  assert.equal(h.events.length, 1, "No duplicate event for an unchanged attachment");
  const pending = h.context.recoverOriginalMetadataV1(4);
  await flush();
  assert.equal(h.reads[0].params.ids, "D");
  h.reads[0].resolve({ok:true, items:[item("D")], unified:inventory([["D",1]])});
  assert.equal(await pending, true);
  assert.equal(h.api.pendingCompatibleIds().length, 0);
  assert.match(h.api.cardParts(h.context.allItems[3]).thumbnail, /D\.jpg/);
  assert.equal(h.events.length, 2, "The completed compatibility transaction publishes one final event");
});

test("explicit complete zero-source coverage stays known and reattachment never creates a false recovery request", () => {
  const h = harness();
  h.api.attach(h.context.allItems, {ok:true, groups:{}, snapshotRevision:"verified-source-less"});
  h.events.length = 0;
  h.api.attach(h.context.allItems);
  assert.equal(h.api.pendingCompatibleIds().length, 0);
  assert.equal(h.api.getOriginalMetadataStatus().pendingCount, 0);
  for (const row of h.context.allItems) {
    assert.equal(h.api.getOriginalMetadataStatus(row.propertyId).ready, true);
    assert.match(h.api.cardParts(row).thumbnail, /사진 없음/);
    assert.doesNotMatch(h.api.cardParts(row).thumbnail, /불러오기|불러오는/);
  }
  assert.equal(h.context.recoverOriginalMetadataV1(4), false);
  assert.equal(h.events.length, 0);
  assert.equal(h.reads.length, 0);
});

test("reattachment retains pending proof mismatches for known photos and emits one final phase transition per compatibility call", () => {
  const h = harness(), before = h.api.allOriginals("C")[0];
  h.events.length = 0;
  h.api.attach(h.context.allItems);
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()), ["B", "C"]);
  assert.equal(h.api.allOriginals("C")[0], before);
  assert.equal(h.events.length, 0);
  h.api.attachCompatible(h.context.allItems, inventory([["A",1], ["B",2]]));
  assert.deepEqual(Array.from(h.api.pendingCompatibleIds()), ["C"]);
  assert.equal(h.api.allOriginals("C")[0], before);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].detail.status, "pending");
  assert.equal(h.events[0].detail.pendingCount, 1);
});
