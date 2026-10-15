import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const map = fs.readFileSync("js/map.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
function fn(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
function row(id, extra = {}) {
  return Object.assign({property_id: id, title: id, address: "서구 테스트동 " + id,
    room: "1층", listing_type: "일반상가", deposit: 1000, monthly_rent: 50,
    maintenance_fee: 0, premium: 0, area_m2: 10, status: "active", main_source: "네이버",
    first_collected_at: "2026-10-13T07:00:00.000Z", latitude: 36.35, longitude: 127.38,
    trade_type: "lease", sale_price: null, sale_details_json: ""}, extra);
}
function csv(rows, revision) {
  const fields = ["title","address","room","listing_type","deposit","monthly_rent",
    "maintenance_fee","premium","area_m2","landlord_phone","tenant_phone",
    "operating_memo","status","first_collected_at","main_source","property_id",
    "source_url","contacts_json","building_year","building_elevators","building_approval_date",
    "building_info_checked_at","building_info_status","registration_at","last_collected_at",
    "latitude","longitude","building_elevator_capacity","trade_type","sale_category","sale_price","sale_details_json"];
  const body = [fields, ...rows.map(item => fields.map(field => item[field] ?? ""))]
    .map(values => values.map(value => '"' + String(value).replaceAll('"','""') + '"').join(',')).join('\r\n');
  return {body, revision};
}
function originals(id, revision, name = "photo") {
  return {ok: true, groups: {[id]: [{originalId: id + '-original', source: '네이버',
    thumbnail: 'https://landthumb-phinf.pstatic.net/' + name + '.jpg'}]},
    sourceSearchIds: {[id]: ['n:' + id]}, snapshotRevision: revision};
}
function harness(options = {}) {
  const csvReads = [], originalReads = [], writes = [], renders = [], events = [], restored = [], invalidations = [];
  const timers = new Map();
  let timerId = 0;
  let geocodeCallback;
  const status = {innerHTML: '', textContent: ''};
  function LatLng(lat,lng) { this.getLat = () => lat; this.getLng = () => lng; }
  const context = {
    console: {error() {}, warn() {}}, URLSearchParams, Date, Promise,
    CustomEvent: class {constructor(type, init) {this.type = type; this.detail = init.detail;}},
    isLoadingSheet: false, pendingAutoUpdate: false, errorItems: [], allItems: [], currentItems: [],
    jsListingsLoadGenerationV1: 0, jsListingsCompleteBaseV1: !!options.complete,
    jsListingsFullBaseTimerV1: null, jsListingsRevisionV682: 'BASE', jsListingsRevisionPendingV682: false,
    jsInitialFullListingsCacheHitV1: false, jsInitialFullListingsCacheItemsV1: null,
    jsInitialFullListingsCacheSignatureV1: '', jsInitialFullListingsCacheUnifiedSignatureV1: '',
    jsInitialFullListingsLoadingV1: true, innerWidth: 1280,
    preserveActionSelectionDuringRender: false, selectedPrintKeys: ['checked-fixture'], favoriteOnly: true,
    activeFavoriteFolderId: 'folder-fixture', favoriteFilterKeys: ['property:OUTSIDE'],
    geocodeCache: {}, sheetURL: '/fixture-sheet',
    kakao: {maps: {LatLng}},
    document: {
      getElementById(id) {return id === 'status' ? status : null;},
      documentElement: {setAttribute() {}}, addEventListener() {}
    },
    addEventListener() {}, dispatchEvent(event) {events.push(event);},
    setTimeout(callback, ms) {const id = ++timerId; timers.set(id, {callback, ms}); return id;},
    clearTimeout(id) {timers.delete(id);},
    JSDataAccessV6: {
      listingsSnapshot(force) {const pending = deferred(); csvReads.push({force, ...pending}); return pending.promise;},
      read(action) {
        if (action === 'dataRevision') return Promise.resolve({ok:true,revision:context.jsListingsRevisionV682});
        if (action === 'listingChanges') return Promise.resolve({ok:true,items:options.deltaItems || []});
        assert.equal(action, 'unifiedListings');
        const pending = deferred(); originalReads.push(pending); return pending.promise;
      },
      invalidateRead(action) {invalidations.push(action);}
    },
    JSInitialListingsCacheV1: {
      read() {return Promise.resolve(options.cache || null);},
      write(items, result) {writes.push({items, result}); return Promise.resolve(true);},
      unifiedSignatureForItems(_items, result) {return JSON.stringify(result && result.groups || {});}
    },
    getFilteredItems() {return context.allItems;},
    applyFilter() {renders.push(context.allItems.map(item => item.propertyId));},
    updateTypeOptions() {}, updateErrorStatus() {},
    normalizeAddressForCache: value => value,
    captureAutoUpdateViewState() {return {favoriteOnly: context.favoriteOnly, folderId: context.activeFavoriteFolderId, scroll: 77};},
    restoreAutoUpdateViewState(value) {restored.push(value);},
    geocodeItems(items, callback) {
      if (options.holdGeocode) geocodeCallback = () => callback(items);
      else callback(items);
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const name of ['clean','parseCSVRecordsV655','itemKey']) vm.runInContext(fn(script,name),context);
  for (const name of ['listingChangeRowToItemV683','notifyListingsSnapshotV1','getItemsDataSignatureV638',
    'hydrateInitialFullListingsCacheItemsV1','showInitialFullListingsCacheV1','hasReadyCoordinateWithoutSharedCacheV8213',
    'matchingListingSnapshotRevisionV1','parseDirectSaleDetailsV1','applyScopedListingsV1','applyOriginalsSnapshotV1',
    'refreshOriginalMetadataPresentationV1','recoverOriginalMetadataV1','loadSheet',
    'fetchDataRevisionV682','refreshListingsWhenChangedV682',
    'applyListingChangesV683']) {
    vm.runInContext(fn(map,name),context);
  }
  vm.runInContext(unified,context);
  context.JSListingRefreshV1 = {
    applyScoped: context.applyScopedListingsV1, applyOriginals: context.applyOriginalsSnapshotV1,
    generation: () => context.jsListingsLoadGenerationV1,
    hasCompleteBase: () => context.jsListingsCompleteBaseV1
  };
  return {context, csvReads, originalReads, writes, renders, events, restored, invalidations, timers,
    finishGeocode() {assert.equal(typeof geocodeCallback, 'function'); geocodeCallback();},
    runTimers() {const pending = [...timers.entries()]; pending.forEach(([id, timer]) => {timers.delete(id); timer.callback();});}}
}

test("a complete latest CSV displays before a stalled original response, retaining today's records", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('TODAY'),row('OLD',{first_collected_at:'2026-10-12T02:00:00Z'})], 'NEW'));
  assert.equal(await loading, true);
  assert.deepEqual(Array.from(h.context.allItems, item => item.propertyId), ['TODAY','OLD']);
  assert.equal(h.context.isLoadingSheet, false);
  assert.equal(h.context.jsInitialFullListingsLoadingV1, false);
  assert.equal(h.context.jsListingsRevisionV682, 'NEW');
  assert.equal(h.renders.length, 1);
  assert.equal(h.writes.length, 0, 'an incomplete pair is never persisted as current');
  assert.equal(h.events[0].detail.kind, 'full');
});

test("an old complete cache is replaced by today's complete CSV even while originals remain pending", async () => {
  const cache = {
    itemCount:1,totalItemCount:1,unifiedSignature:'OLD-CACHE',
    items:[{name:'OLD',address:'서구 테스트동 OLD',room:'1층',type:'일반상가',
      deposit:1000,rent:50,area:10,propertyId:'OLD',regDate:'2026-10-12T07:00:00Z',
      latitude:36.35,longitude:127.38}],unified:originals('OLD','OLD-CACHE','cached')
  };
  const h = harness({cache});
  const loading = h.context.loadSheet(false,false);
  await flush();
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['OLD']);
  assert.equal(h.context.jsListingsCompleteBaseV1,true);
  h.csvReads[0].resolve(csv([row('OLD',{first_collected_at:'2026-10-12T07:00:00Z'}),row('TODAY')],'NEW'));
  await loading;
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['OLD','TODAY']);
  assert.match(h.context.allItems[0].thumbnailV8,/cached\.jpg/);
  assert.equal(h.context.isLoadingSheet,false);
  assert.equal(h.context.jsListingsRevisionV682,'NEW');
  assert.equal(h.originalReads.length,1);
});

test("late matching originals attach with the current view preserved and one complete cache write", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('TODAY')], 'NEW'));
  await loading;
  h.context.activeFavoriteFolderId = 'folder-chosen-after-csv';
  h.originalReads[0].resolve(originals('TODAY','NEW'));
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8, /photo\.jpg/);
  assert.equal(h.renders.length, 2);
  assert.equal(h.restored[0].folderId, 'folder-chosen-after-csv');
  assert.equal(h.context.selectedPrintKeys[0], 'checked-fixture');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].items.length, 1);
});

test("a mixed original revision never attaches or writes a falsely current full snapshot", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('TODAY')], 'NEW'));
  await loading;
  h.originalReads[0].resolve(originals('TODAY','OLD','stale'));
  await flush();
  assert.equal(h.context.allItems[0].thumbnailV8, '');
  assert.equal(h.renders.length, 2, 'stale metadata is visibly identified instead of waiting forever');
  assert.equal(h.writes.length, 0);
  assert.equal(h.context.jsListingsRevisionV682, 'NEW', 'complete CSV remains the master baseline');
  assert.equal(h.csvReads.length, 2, 'one bounded recovery pair is requested');
  assert.equal(h.csvReads[1].force, true);
  h.csvReads[1].resolve(csv([row('TODAY')], 'NEWER'));
  h.originalReads[1].resolve(originals('TODAY','STILL-OLD','stale'));
  await flush();
  assert.equal(h.csvReads.length, 2, 'continued collection changes cannot create a retry loop');
  assert.equal(h.originalReads.length, 2);
  assert.equal(h.writes.length, 0);
  assert.equal(h.context.allItems[0].thumbnailV8, '');
});

test("a mismatched initial pair recovers current photos once without changing favorite selection", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('TODAY')], 'NEW'));
  await loading;
  h.originalReads[0].resolve(originals('TODAY','OLD','stale'));
  await flush();
  assert.equal(h.csvReads.length, 2);
  h.csvReads[1].resolve(csv([row('TODAY')], 'RECOVERED'));
  h.originalReads[1].resolve(originals('TODAY','RECOVERED','fresh'));
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8, /fresh\.jpg/);
  assert.equal(h.context.jsListingsRevisionV682, 'RECOVERED');
  assert.equal(h.context.favoriteOnly, true);
  assert.equal(h.context.activeFavoriteFolderId, 'folder-fixture');
  assert.equal(h.context.selectedPrintKeys[0], 'checked-fixture');
  assert.equal(h.csvReads.length, 2);
  assert.equal(h.originalReads.length, 2);
});

test("a failed full original read recovers candidate metadata and photos with one forced pair", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('CANDIDATE'),row('MANUAL',{status:'계약완료'})], 'CURRENT'));
  await loading;
  h.originalReads[0].reject(Object.assign(new Error('Timed out'), {name:'TimeoutError'}));
  await flush();
  assert.equal(h.csvReads.length, 2);
  assert.equal(h.csvReads[1].force, true);
  const payload = originals('CANDIDATE','CURRENT','candidate-photo');
  Object.assign(payload.groups.CANDIDATE[0], {active:0,sourceUnavailable:true,
    availabilityKind:'census_missing',candidateEligible:true});
  h.csvReads[1].resolve(csv([row('CANDIDATE'),row('MANUAL',{status:'계약완료'})], 'CURRENT'));
  h.originalReads[1].resolve(payload);
  await flush();
  assert.equal(h.context.allItems[0].unifiedCandidateOriginalCountV2, 1);
  assert.equal(h.context.allItems[1].state, '계약완료');
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'ready');
  assert.equal(h.context.JSUnifiedListingsV8.allOriginals('CANDIDATE')[0].thumbnail,
    'https://landthumb-phinf.pstatic.net/candidate-photo.jpg');
  assert.equal(h.context.loadSheet.originalsRecoveryV1, undefined);
  assert.equal(h.context.selectedPrintKeys[0], 'checked-fixture');
  assert.equal(h.context.favoriteOnly, true);
  assert.equal(h.originalReads.length, 2);
});

test("unchanged revision polls recover missing metadata with a cooldown and finite retry budget", async () => {
  const h = harness();
  let now = Date.now();
  h.context.Date = class extends Date {static now() {return now;}};
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('TODAY')], 'UNCHANGED'));
  await loading;
  h.originalReads[0].reject(new Error('offline'));
  await flush();
  h.csvReads[1].resolve(csv([row('TODAY')], 'UNCHANGED'));
  h.originalReads[1].reject(new Error('still offline'));
  await flush();
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'error');
  await h.context.refreshListingsWhenChangedV682();
  assert.equal(h.originalReads.length, 2, 'no retry before the 60-second cooldown');
  for (let attempt = 2; attempt <= 3; attempt++) {
    now += 60_001;
    const poll = h.context.refreshListingsWhenChangedV682();
    await flush();
    assert.equal(h.originalReads.length, attempt + 1);
    h.csvReads[attempt].resolve(csv([row('TODAY')], 'UNCHANGED'));
    h.originalReads[attempt].reject(new Error('offline'));
    await poll;
    await flush();
  }
  now += 10 * 60_000;
  for (let i = 0; i < 10; i++) await h.context.refreshListingsWhenChangedV682();
  assert.equal(h.originalReads.length, 4, 'three recovery attempts cannot become endless full downloads');
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'error');
  assert.equal(h.context.allItems[0].unifiedOriginalMetadataPendingV1, true);
});

test("metadata-first recovery rerenders identical CSV instead of keeping the pending-only list", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('TODAY')], 'SAME'));
  await loading;
  h.originalReads[0].reject(new Error('first read failed'));
  await flush();
  assert.equal(h.csvReads.length,2);
  h.originalReads[1].resolve(originals('TODAY','SAME','metadata-first'));
  await flush();
  const rendersBeforeCsv = h.renders.length;
  h.csvReads[1].resolve(csv([row('TODAY')], 'SAME'));
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8,/metadata-first\.jpg/);
  assert.equal(h.renders.length,rendersBeforeCsv+1,'changed metadata must render even with identical representative CSV');
  assert.equal(h.restored.at(-1).preserveVisibleListV1,false,'selection restoration cannot overwrite the fresh member set');
  assert.equal(h.writes.length,1,'the recovered complete pair is reusable after another refresh');
  assert.equal(h.context.loadSheet.originalsRecoveryV1,undefined);
});

test("a successful same-revision poll clears metadata failure without another user refresh", async () => {
  const h = harness();
  let now = Date.now();
  h.context.Date = class extends Date {static now() {return now;}};
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('TODAY')], 'SAME'));
  await loading;
  h.originalReads[0].reject(new Error('offline'));
  await flush();
  h.csvReads[1].resolve(csv([row('TODAY')], 'SAME'));
  h.originalReads[1].reject(new Error('offline'));
  await flush();
  now += 60_001;
  const poll = h.context.refreshListingsWhenChangedV682();
  await flush();
  h.csvReads[2].resolve(csv([row('TODAY')], 'SAME'));
  h.originalReads[2].resolve(originals('TODAY','SAME','restored'));
  await poll;
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8, /restored\.jpg/);
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'ready');
  assert.equal(h.originalReads.length, 3);
  await h.context.refreshListingsWhenChangedV682();
  assert.equal(h.originalReads.length, 3, 'healthy unchanged polling remains a tiny revision check');
});

test("scoped originals merge without deleting other photos and supersede a late old full CSV", async () => {
  const h = harness({complete: true});
  h.context.allItems = [h.context.listingChangeRowToItemV683(row('OUTSIDE'))];
  h.context.JSUnifiedListingsV8.attach(h.context.allItems, originals('OUTSIDE','BASE','outside'));
  const loading = h.context.loadSheet(true, true);
  const payload = {ok:true, items:[row('TODAY',{room:'2층'})], snapshotRevision:'SCOPED',
    unified:{ok:true, format:'compact-v2', fields:['originalId','source','thumbnail'],
      groups:{TODAY:[['today-original','네이버','https://landthumb-phinf.pstatic.net/fresh.jpg']]},
      sourceSearchIds:{TODAY:['n:TODAY']}, snapshotRevision:'SCOPED'}};
  assert.equal(h.context.applyScopedListingsV1(payload),true);
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['OUTSIDE','TODAY']);
  assert.match(h.context.allItems[0].thumbnailV8,/outside\.jpg/);
  assert.match(h.context.allItems[1].thumbnailV8,/fresh\.jpg/);
  assert.equal(h.context.allItems[1].room,'2층');
  assert.equal(h.context.jsListingsRevisionV682,'BASE','a subset never advances the complete revision');
  h.csvReads[0].resolve(csv([row('OBSOLETE')],'OLD'));
  assert.equal(await loading,false);
  h.originalReads[0].resolve(originals('TODAY','OLD','obsolete'));
  await flush();
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['OUTSIDE','TODAY']);
  assert.match(h.context.allItems[1].thumbnailV8,/fresh\.jpg/);
  assert.equal(h.context.favoriteOnly,true);
  assert.equal(h.context.activeFavoriteFolderId,'folder-fixture');
  assert.equal(h.context.selectedPrintKeys[0],'checked-fixture');
  assert.equal(h.timers.size,0,'complete cached datasets do not start an extra full refresh');
});

test("explicit empty scoped original groups clear only their own stale metadata", () => {
  const h = harness({complete: true});
  h.context.allItems = ['OUTSIDE','TODAY'].map(id=>h.context.listingChangeRowToItemV683(row(id)));
  h.context.JSUnifiedListingsV8.attach(h.context.allItems,{ok:true,groups:{
    ...originals('OUTSIDE','BASE','outside').groups,...originals('TODAY','BASE','old').groups},
    sourceSearchIds:{OUTSIDE:['n:OUTSIDE'],TODAY:['n:old']},snapshotRevision:'BASE'});
  assert.equal(h.context.applyScopedListingsV1({ok:true,items:[row('TODAY')],snapshotRevision:'SCOPED',
    unified:{ok:true,groups:{TODAY:[]},sourceSearchIds:{TODAY:[]},snapshotRevision:'SCOPED'}}),true);
  assert.equal(h.context.allItems[1].thumbnailV8,'');
  assert.equal(h.context.allItems[1].sourceListingSearchV6579.length,0);
  assert.match(h.context.allItems[0].thumbnailV8,/outside\.jpg/);
});

test("an obsolete geocode completion cannot overwrite a newer scoped result", async () => {
  const h = harness({complete:true,holdGeocode:true});
  const loading = h.context.loadSheet(true,true);
  h.csvReads[0].resolve(csv([row('TODAY',{room:'1층'})],'OLD'));
  await loading;
  await flush();
  assert.equal(h.context.isLoadingSheet,true);
  assert.equal(h.context.applyScopedListingsV1({ok:true,items:[row('TODAY',{room:'9층'})],snapshotRevision:'SCOPED',
    unified:originals('TODAY','SCOPED','fresh')}),true);
  h.finishGeocode();
  assert.equal(h.context.allItems[0].room,'9층');
  assert.equal(h.context.isLoadingSheet,false);
});

test("a cold Today response shows immediately but still prepares one complete normal dataset", async () => {
  const h = harness();
  const oldLoad = h.context.loadSheet(false,false);
  assert.equal(h.context.applyScopedListingsV1({ok:true,items:[row('TODAY')],snapshotRevision:'SCOPED',
    unified:originals('TODAY','SCOPED','fresh')}),true);
  assert.equal(h.context.allItems.length,1);
  assert.equal(h.context.jsListingsCompleteBaseV1,false);
  assert.equal(h.timers.size,1);
  h.runTimers();
  assert.equal(h.csvReads.length,2);
  assert.equal(h.csvReads[1].force,true);
  h.csvReads[0].resolve(csv([row('OBSOLETE')],'OLD'));
  assert.equal(await oldLoad,false);
  h.csvReads[1].resolve(csv([row('TODAY'),row('OUTSIDE')],'NEW-FULL'));
  await flush();
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['TODAY','OUTSIDE']);
  assert.equal(h.context.jsListingsCompleteBaseV1,true);
  assert.equal(h.context.isLoadingSheet,false);
  assert.equal(h.context.jsListingsRevisionV682,'NEW-FULL');
  assert.equal(h.csvReads.length,2,'no background request storm');
});

test("invalid scoped payloads leave generation, complete data and original metadata unchanged", () => {
  const h = harness({complete:true});
  h.context.allItems = [h.context.listingChangeRowToItemV683(row('OUTSIDE'))];
  const before = h.context.allItems;
  assert.equal(h.context.applyScopedListingsV1({ok:true,items:[row('TODAY')],snapshotRevision:'SCOPED',
    unified:{ok:true,groups:{TODAY:[]},snapshotRevision:'DIFFERENT'}}),false);
  assert.equal(h.context.allItems,before);
  assert.equal(h.context.jsListingsLoadGenerationV1,0);
  assert.equal(h.invalidations.length,0);
});

test("a small master delta renders immediately without joining a stalled full-originals read", async () => {
  const h = harness({complete:true,deltaItems:[row('TODAY',{room:'3층'})]});
  h.context.allItems = [h.context.listingChangeRowToItemV683(row('TODAY'))];
  h.context.JSUnifiedListingsV8.load(true,{deferCommit:true});
  assert.equal(h.originalReads.length,1);
  assert.equal(await h.context.applyListingChangesV683({changeIds:['TODAY'],revision:'DELTA'}),true);
  assert.equal(h.context.allItems[0].room,'3층');
  assert.equal(h.renders.length,1);
  assert.equal(h.originalReads.length,1,'master delta never adds or waits for a full metadata request');
  assert.equal(h.events[0].detail.kind,'delta');
});
