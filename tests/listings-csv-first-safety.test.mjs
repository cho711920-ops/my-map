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
    "latitude","longitude","building_elevator_capacity","trade_type","sale_category","sale_price","sale_details_json","source_snapshot_key"];
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
  const csvReads = [], originalReads = [], scopedReads = [], writes = [], renders = [], events = [], restored = [], invalidations = [];
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
    memoSavePendingKeysV655: {}, doneTogglePendingKeys: {},
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
      read(action, params) {
        if (action === 'dataRevision') return Promise.resolve({ok:true,revision:context.jsListingsRevisionV682});
        if (action === 'listingOriginals') {const pending = deferred(); scopedReads.push({params, ...pending}); return pending.promise;}
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
    captureAutoUpdateViewState() {return {favoriteOnly: context.favoriteOnly, folderId: context.activeFavoriteFolderId, scroll: context.testScrollTop ?? 77};},
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
    'matchingListingSnapshotRevisionV1','parseDirectSaleDetailsV1','scopedReadLocalValuesV1','captureScopedReadV1','ensureCompleteBaseV1','applyScopedListingsV1','applyOriginalsSnapshotV1',
    'compatibleOriginalsResultV1','compatibleOriginalsCacheV1','originalMetadataMutationPendingV1','refreshScopedOriginalsV1',
    'requestVisibleOriginalMetadataV1','refreshOriginalMetadataPresentationV1','recoverOriginalMetadataV1','loadSheet',
    'fetchDataRevisionV682','refreshListingsWhenChangedV682',
    'applyListingChangesV683']) {
    vm.runInContext(fn(map,name),context);
  }
  vm.runInContext(unified.replace('  global.JSUnifiedListingsV8 = {',
    '  global.__synchronizeDetailOriginals = synchronizeDetailOriginals;\n  global.JSUnifiedListingsV8 = {'),context);
  context.JSListingRefreshV1 = {
    applyScoped: context.applyScopedListingsV1, captureScopedRead: context.captureScopedReadV1, ensureCompleteBase: context.ensureCompleteBaseV1, applyOriginals: context.applyOriginalsSnapshotV1,
    generation: () => context.jsListingsLoadGenerationV1,
    hasCompleteBase: () => context.jsListingsCompleteBaseV1
  };
  return {context, csvReads, originalReads, scopedReads, writes, renders, events, restored, invalidations, timers,
    finishGeocode() {assert.equal(typeof geocodeCallback, 'function'); geocodeCallback();},
    runTimers() {const pending = [...timers.entries()]; pending.forEach(([id, timer]) => {timers.delete(id); timer.callback();});}}
}

const proof = number => 'sha256-v1:' + String(number).padStart(64, '0');
function provenOriginals(entries, revision = 'UNRELATED-GLOBAL') {
  const groups = {}, sourceSnapshotKeys = {}, sourceSnapshotPropertyIds = {}, sourceSearchIds = {};
  for (const [publicId, key, photo = publicId] of entries) {
    const internalId = 'internal-' + publicId;
    groups[internalId] = [{propertyId:internalId,originalId:publicId+'-original',source:'네이버',
      active:1,availabilityKind:'active',thumbnail:'https://landthumb-phinf.pstatic.net/'+photo+'.jpg'}];
    sourceSnapshotKeys[internalId] = key;
    sourceSnapshotPropertyIds[internalId] = publicId;
    sourceSearchIds[internalId] = ['naver:'+publicId];
  }
  return {ok:true,groups,sourceSnapshotKeys,sourceSnapshotPropertyIds,sourceSearchIds,snapshotRevision:revision};
}

test('matching property proofs connect immediately despite different global revisions without another download', async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1)})],'CSV-GLOBAL'));
  await loading;
  h.originalReads[0].resolve(provenOriginals([['A',proof(1),'current']]));
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8,/current\.jpg/);
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status,'ready');
  assert.equal(h.csvReads.length,1);
  assert.equal(h.originalReads.length,1);
  assert.equal(h.scopedReads.length,0);
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].result.sourceSnapshotKeys.A,proof(1));
  assert.equal(h.writes[0].result.snapshotRevision,undefined,'do not relabel unrelated global revisions');
});

test('only a mismatched property is re-read while matching photos stay available', async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1)}),row('B',{source_snapshot_key:proof(2)})],'CSV'));
  await loading;
  h.originalReads[0].resolve(provenOriginals([['A',proof(1),'preserved'],['B',proof(3),'wrong']]));
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8,/preserved\.jpg/);
  assert.equal(h.scopedReads.length,1);
  assert.equal(h.scopedReads[0].params.ids,'B');
  h.scopedReads[0].resolve({ok:true,items:[row('B',{source_snapshot_key:proof(4),monthly_rent:75})],
    unified:provenOriginals([['B',proof(4),'fresh']])});
  await flush();
  assert.equal(h.context.allItems[1].rent,75);
  assert.match(h.context.allItems[1].thumbnailV8,/fresh\.jpg/);
  assert.match(h.context.allItems[0].thumbnailV8,/preserved\.jpg/);
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status,'ready');
  assert.equal(h.csvReads.length,1);
  assert.equal(h.originalReads.length,1);
  assert.equal(h.writes.length,1);
  assert.equal(h.restored.at(-1).preserveVisibleListV1,false);
});

test('equal global revisions cannot override a mismatched property proof', async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1)})],'SAME'));
  await loading;
  h.originalReads[0].resolve(provenOriginals([['A',proof(2),'wrong']],'SAME'));
  await flush();
  assert.equal(h.context.allItems[0].thumbnailV8,'');
  assert.equal(h.scopedReads.length,1);
  assert.equal(h.writes.length,0);
  h.scopedReads[0].reject(new Error('offline'));
  await flush();
  assert.equal(h.csvReads.length,1);
});

test('manual full-original retry uses property proofs instead of bypassing them with a global revision', async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1)})],'SAME'));
  await loading;
  assert.equal(h.context.applyOriginalsSnapshotV1(provenOriginals([['A',proof(2),'wrong']],'SAME'),
    'SAME',h.context.jsListingsLoadGenerationV1),true);
  await flush();
  assert.equal(h.context.allItems[0].thumbnailV8,'');
  assert.equal(h.scopedReads.length,1);
  h.scopedReads[0].reject(new Error('offline'));
  await flush();
  assert.equal(h.context.applyOriginalsSnapshotV1(provenOriginals([['A',proof(1),'correct']],'DIFFERENT'),
    'SAME',h.context.jsListingsLoadGenerationV1),true);
  assert.match(h.context.allItems[0].thumbnailV8,/correct\.jpg/);
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status,'ready');
});

test('a scoped response cannot overwrite a memo edited after the request began', async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1),operating_memo:'old'})],'CSV'));
  await loading;
  h.originalReads[0].resolve(provenOriginals([['A',proof(2),'wrong']]));
  await flush();
  h.context.allItems[0].memo='직접 수정한 메모';
  h.scopedReads[0].resolve({ok:true,items:[row('A',{source_snapshot_key:proof(3),operating_memo:'old'})],
    unified:provenOriginals([['A',proof(3),'late']])});
  await flush();
  assert.equal(h.context.allItems[0].memo,'직접 수정한 메모');
  assert.equal(h.context.allItems[0].sourceSnapshotKey,proof(1));
  assert.equal(h.context.allItems[0].thumbnailV8,'');
  assert.equal(h.writes.length,0);
});

test('a memo save already pending before a scoped request preserves the same item object and blocks cache writes', async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1),operating_memo:'OLD'})],'CSV'));
  await loading;
  const item=h.context.allItems[0];
  h.context.memoSavePendingKeysV655[item.key]={previousMemo:'OLD'};
  item.memo='저장 중인 새 메모';
  h.originalReads[0].resolve(provenOriginals([['A',proof(2),'wrong']]));
  await flush();
  delete h.context.memoSavePendingKeysV655[item.key];
  h.scopedReads[0].resolve({ok:true,items:[row('A',{source_snapshot_key:proof(3),operating_memo:'OLD'})],
    unified:provenOriginals([['A',proof(3),'late']])});
  await flush();
  assert.equal(h.context.allItems[0],item);
  assert.equal(item.memo,'저장 중인 새 메모');
  assert.equal(h.writes.length,0);
});

test('a large compatible recovery is bounded per pass but continues while successful progress is made', async () => {
  const h=harness();
  let now=Date.now();
  h.context.Date=class extends Date {static now(){return now;}};
  const ids=Array.from({length:205},(_,i)=>'P'+i);
  const loading=h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv(ids.map(id=>row(id,{source_snapshot_key:proof(1)})),'CSV'));
  await loading;
  h.originalReads[0].resolve(provenOriginals(ids.map(id=>[id,proof(2)])));
  await flush();
  for(let index=0;index<4;index++) {
    const request=h.scopedReads[index],batch=request.params.ids.split(',');
    assert.equal(batch.length,50);
    request.resolve({ok:true,items:batch.map(id=>row(id,{source_snapshot_key:proof(3)})),
      unified:provenOriginals(batch.map(id=>[id,proof(3)]))});
    await flush();
  }
  assert.equal(h.scopedReads.length,4);
  assert.equal(h.context.JSUnifiedListingsV8.pendingCompatibleIds().length,5);
  assert.equal(h.context.loadSheet.originalsRecoveryV1.attempts,0,'progress must not exhaust a permanent auto-recovery ceiling');
  now+=60_001;
  const poll=h.context.refreshListingsWhenChangedV682();
  await flush();
  const request=h.scopedReads[4],batch=request.params.ids.split(',');
  assert.equal(batch.length,5);
  request.resolve({ok:true,items:batch.map(id=>row(id,{source_snapshot_key:proof(3)})),
    unified:provenOriginals(batch.map(id=>[id,proof(3)]))});
  await poll;
  await flush();
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status,'ready');
  assert.equal(h.csvReads.length,1);
  assert.equal(h.originalReads.length,1);
});

test('a bounded full recovery connects rendered cards before an unrelated 200-row prefix', async () => {
  const h=harness(),ids=Array.from({length:250},(_,i)=>'P'+i);
  const loading=h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv(ids.map(id=>row(id,{source_snapshot_key:proof(1)})),'CSV'));
  await loading;
  h.context.visibleListItems=[h.context.allItems[249],h.context.allItems[240]];
  h.context.listRenderStart=0;h.context.listRenderLimit=2;
  h.originalReads[0].resolve(provenOriginals(ids.map(id=>[id,proof(2)])));
  await flush();
  const batch=h.scopedReads[0].params.ids.split(',');
  assert.equal(batch.length,50);
  assert.deepEqual(batch.slice(0,2),['P249','P240']);
  h.scopedReads[0].reject(new Error('bounded fixture stop'));
  await flush();
});

test('visible recovery coalesces scroll renders, reads only the render window, and backs off failures',async()=>{
  const h=harness(),ids=Array.from({length:60},(_,i)=>'V'+i);
  let now=Date.now();h.context.Date=class extends Date{static now(){return now;}};
  h.context.allItems=ids.map(id=>h.context.listingChangeRowToItemV683(row(id,{source_snapshot_key:proof(1)})));
  h.context.currentItems=h.context.allItems;
  h.context.visibleListItems=h.context.allItems;
  h.context.listRenderStart=40;h.context.listRenderLimit=58;
  h.context.JSUnifiedListingsV8.attachCompatible(h.context.allItems,provenOriginals(ids.map(id=>[id,proof(2)])));
  h.context.requestVisibleOriginalMetadataV1();h.context.requestVisibleOriginalMetadataV1();
  assert.equal(h.timers.size,1);assert.equal(h.scopedReads.length,0);
  h.runTimers();await flush();
  assert.equal(h.scopedReads.length,1);
  assert.deepEqual(h.scopedReads[0].params.ids.split(','),ids.slice(40,58));
  h.scopedReads[0].reject(new Error('offline'));await flush();
  h.context.requestVisibleOriginalMetadataV1();h.runTimers();await flush();
  assert.equal(h.scopedReads.length,1,'failed rerenders must not loop requests');
  now+=30_001;h.context.requestVisibleOriginalMetadataV1();h.runTimers();await flush();
  assert.equal(h.scopedReads.length,2);
  const batch=h.scopedReads[1].params.ids.split(',');
  h.scopedReads[1].resolve({ok:true,items:batch.map(id=>row(id,{source_snapshot_key:proof(3)})),
    unified:provenOriginals(batch.map(id=>[id,proof(3),'visible-photo']))});
  await flush();
  assert.match(h.context.allItems[40].thumbnailV8,/visible-photo/);
  assert.equal(h.context.JSUnifiedListingsV8.pendingCompatibleIds().length,42);
  assert.equal(h.csvReads.length,0);assert.equal(h.originalReads.length,0);
});

test('scrolling outside an in-flight recovery coalesces one visible follow-up without parallel reads',async()=>{
  const h=harness(),ids=Array.from({length:205},(_,i)=>'S'+i);
  h.context.allItems=ids.map(id=>h.context.listingChangeRowToItemV683(row(id,{source_snapshot_key:proof(1)})));
  h.context.currentItems=h.context.allItems;
  h.context.JSUnifiedListingsV8.attachCompatible(h.context.allItems,provenOriginals(ids.map(id=>[id,proof(2)])));
  const recovery=h.context.recoverOriginalMetadataV1(h.context.jsListingsLoadGenerationV1);
  await flush();
  h.context.visibleListItems=[h.context.allItems[204]];h.context.listRenderStart=0;h.context.listRenderLimit=1;
  h.context.requestVisibleOriginalMetadataV1();h.runTimers();await flush();
  assert.equal(h.scopedReads.length,1,'do not overlap the current pass');
  for(let index=0;index<4;index++){
    const request=h.scopedReads[index],batch=request.params.ids.split(',');
    request.resolve({ok:true,items:batch.map(id=>row(id,{source_snapshot_key:proof(3)})),
      unified:provenOriginals(batch.map(id=>[id,proof(3)]))});await flush();
  }
  await recovery;await flush();
  assert.equal(h.scopedReads.length,4);assert.equal(h.timers.size,1);
  h.runTimers();await flush();
  assert.equal(h.scopedReads.length,5);assert.equal(h.scopedReads[4].params.ids,'S204');
  h.scopedReads[4].reject(new Error('fixture stop'));await flush();
});

test('a proof-bearing Today subset commits only after all rows validate and retains unrelated pending coverage', async () => {
  const h=harness({complete:true});
  const loading=h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1)}),row('C',{source_snapshot_key:proof(1)})],'FULL'));
  await loading;
  h.originalReads[0].resolve(provenOriginals([['A',proof(1)],['C',proof(2)]]));
  await flush();
  const phase=h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status;
  const subset=provenOriginals([['B',proof(3),'today-photo']],'PERIOD');
  assert.equal(h.context.applyScopedListingsV1({ok:true,snapshotRevision:'PERIOD',
    items:[row('B',{source_snapshot_key:proof(3)})],unified:subset}),true);
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['A','C','B']);
  assert.match(h.context.allItems[2].thumbnailV8,/today-photo\.jpg/);
  assert.deepEqual(Array.from(h.context.JSUnifiedListingsV8.pendingCompatibleIds()),['C']);
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status,phase);
});

test('a proof-bearing Today subset with one invalid row mutates neither masters nor original groups', async () => {
  const h=harness({complete:true});
  const loading=h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1)})],'FULL'));
  await loading;
  h.originalReads[0].resolve(provenOriginals([['A',proof(1),'before']]));
  await flush();
  const items=h.context.allItems,generation=h.context.jsListingsLoadGenerationV1;
  assert.equal(h.context.applyScopedListingsV1({ok:true,snapshotRevision:'PERIOD',
    items:[row('A',{source_snapshot_key:proof(3)}),row('B',{source_snapshot_key:proof(4)})],
    unified:provenOriginals([['A',proof(3),'must-not-commit'],['B',proof(5)]],'PERIOD')}),false);
  assert.equal(h.context.allItems,items);
  assert.match(h.context.allItems[0].thumbnailV8,/before\.jpg/);
  assert.equal(h.context.jsListingsLoadGenerationV1,generation);
  assert.equal(h.context.JSUnifiedListingsV8.allOriginals('B').length,0);
});

test('per-property pages need no fabricated aggregate revision and wait for the final page before cold full-base recovery',()=>{
  const h=harness();
  const page=(id,key,more)=>({ok:true,snapshotConsistency:'per-property-v1',snapshotRevision:'',hasMore:more,
    items:[row(id,{source_snapshot_key:key})],unified:{...provenOriginals([[id,key]],''),snapshotConsistency:'per-property-v1'}});
  assert.equal(h.context.applyScopedListingsV1(page('A',proof(1),true)),true);
  assert.equal(h.timers.size,0,'no competing full reload between verified pages');
  assert.equal(h.context.applyScopedListingsV1(page('B',proof(2),false)),true);
  assert.equal(h.timers.size,1);
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['A','B']);
});

test('Today pages cannot replace an edit made during the read or a save already pending when it began',async()=>{
  const h=harness({complete:true});
  const loading=h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('A',{source_snapshot_key:proof(1),operating_memo:'OLD'})],'FULL'));await loading;
  h.originalReads[0].resolve(provenOriginals([['A',proof(1),'before']]));await flush();
  const item=h.context.allItems[0];
  const result={ok:true,snapshotConsistency:'per-property-v1',items:[row('A',{source_snapshot_key:proof(2),operating_memo:'OLD'})],
    unified:{...provenOriginals([['A',proof(2),'must-not-commit']]),snapshotConsistency:'per-property-v1'}};
  const context=h.context.captureScopedReadV1();item.memo='새 메모';
  assert.equal(h.context.applyScopedListingsV1(result,context),false);
  assert.equal(h.context.allItems[0],item);assert.match(item.thumbnailV8,/before\.jpg/);
  h.context.memoSavePendingKeysV655[item.key]={};
  const pendingContext=h.context.captureScopedReadV1();
  delete h.context.memoSavePendingKeysV655[item.key];
  assert.equal(h.context.applyScopedListingsV1(result,pendingContext),false);
  assert.equal(item.memo,'새 메모');
});

test('late Today pages cannot erase a newly attached advertisement or a master that arrived during the read',()=>{
  for (const previouslyPresent of [true,false]) {
    const h=harness({complete:true});
    if (previouslyPresent) h.context.allItems=[h.context.listingChangeRowToItemV683(row('A',{source_snapshot_key:proof(1)}))];
    const context=h.context.captureScopedReadV1();
    const current=h.context.listingChangeRowToItemV683(row('A',{source_snapshot_key:proof(2)}));
    h.context.allItems=[current];
    const latest=provenOriginals([['A',proof(2),'latest']]);
    latest.groups['internal-A'].push({propertyId:'internal-A',originalId:'A-new-ad',source:'네이버',active:1,availabilityKind:'active'});
    h.context.JSUnifiedListingsV8.attachCompatible(h.context.allItems,latest,{scoped:true,scopedFresh:true});
    const late={ok:true,snapshotConsistency:'per-property-v1',items:[row('A',{source_snapshot_key:proof(1)})],
      unified:{...provenOriginals([['A',proof(1),'stale']]),snapshotConsistency:'per-property-v1'}};
    assert.equal(h.context.applyScopedListingsV1(late,context),false);
    assert.equal(h.context.allItems[0],current);
    assert.equal(h.context.JSUnifiedListingsV8.allOriginals('A').length,2);
    assert.match(current.thumbnailV8,/latest\.jpg/);
  }
});

test('cold partial Today failures can recover the complete base once without a request storm',async()=>{
  const h=harness();
  const page={ok:true,snapshotConsistency:'per-property-v1',hasMore:true,
    items:[row('A',{source_snapshot_key:proof(1)})],unified:{...provenOriginals([['A',proof(1)]]),snapshotConsistency:'per-property-v1'}};
  assert.equal(h.context.applyScopedListingsV1(page),true);
  assert.equal(h.timers.size,0);
  h.context.ensureCompleteBaseV1();h.context.ensureCompleteBaseV1();
  assert.equal(h.timers.size,1);
  h.runTimers();
  assert.equal(h.csvReads.length,1);
  h.context.ensureCompleteBaseV1();assert.equal(h.timers.size,0,'in-flight full read is reused');
  h.csvReads[0].resolve(csv([row('A'),row('OUTSIDE')],'FULL'));await flush();
  assert.equal(h.context.jsListingsCompleteBaseV1,true);
  h.context.ensureCompleteBaseV1();assert.equal(h.timers.size,0,'a complete base needs no extra read');
  assert.equal(h.context.allItems.length,2);
});

test('metadata-only detail updates survive late Today pages even before the master proof changes',()=>{
  const h=harness({complete:true});
  const item=h.context.listingChangeRowToItemV683(row('A',{source_snapshot_key:proof(1)}));
  h.context.allItems=[item];
  h.context.JSUnifiedListingsV8.attachCompatible(h.context.allItems,provenOriginals([['A',proof(1),'old']]),{scoped:true,scopedFresh:true});
  const initial=h.context.captureScopedReadV1();
  h.context.JSUnifiedListingsV8.attach(h.context.allItems);
  const unchanged=h.context.captureScopedReadV1();
  assert.equal(initial.A.values.length,unchanged.A.values.length);
  assert.equal(initial.A.values.every((value,index)=>value===unchanged.A.values[index]),true,'ordinary reattach keeps original object identities');
  const detail=provenOriginals([['A',proof(1),'detail']]);
  detail.groups['internal-A'].push({propertyId:'internal-A',originalId:'A-new-detail-ad',source:'네이버',active:1,availabilityKind:'active'});
  const detailRows=detail.groups['internal-A'].map(original=>({...original,propertyId:'A'}));
  assert.equal(h.context.__synchronizeDetailOriginals('A',detailRows),true);
  const late={ok:true,snapshotConsistency:'per-property-v1',items:[row('A',{source_snapshot_key:proof(1)})],
    unified:{...provenOriginals([['A',proof(1),'stale']]),snapshotConsistency:'per-property-v1'}};
  assert.equal(h.context.applyScopedListingsV1(late,initial),false);
  assert.equal(h.context.JSUnifiedListingsV8.allOriginals('A').length,2);
  assert.match(item.thumbnailV8,/detail\.jpg/);
});

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
  assert.equal(h.events.find(event=>event.detail.kind==='full').detail.kind, 'full');
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
  assert.equal(h.csvReads.length, 1, 'recover the unknown property without another full pair');
  assert.equal(h.scopedReads.length, 1);
  h.scopedReads[0].resolve({ok:true,items:[row('TODAY',{source_snapshot_key:proof(3)})],
    unified:provenOriginals([['TODAY',proof(4),'wrong-scoped']])});
  await flush();
  assert.equal(h.csvReads.length, 1, 'continued collection changes cannot create a retry loop');
  assert.equal(h.originalReads.length, 1);
  assert.equal(h.scopedReads.length, 1);
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
  assert.equal(h.scopedReads.length, 1);
  h.scopedReads[0].resolve({ok:true,items:[row('TODAY',{source_snapshot_key:proof(3)})],
    unified:provenOriginals([['TODAY',proof(3),'fresh']])});
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8, /fresh\.jpg/);
  assert.equal(h.context.jsListingsRevisionV682, 'NEW','a property response cannot certify a whole-dataset revision');
  assert.equal(h.context.favoriteOnly, true);
  assert.equal(h.context.activeFavoriteFolderId, 'folder-fixture');
  assert.equal(h.context.selectedPrintKeys[0], 'checked-fixture');
  assert.equal(h.csvReads.length, 1);
  assert.equal(h.originalReads.length, 1);
});

test("a failed full original read recovers candidate metadata and photos with one scoped inventory", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false, false);
  h.csvReads[0].resolve(csv([row('CANDIDATE'),row('MANUAL',{status:'계약완료'})], 'CURRENT'));
  await loading;
  h.originalReads[0].reject(Object.assign(new Error('Timed out'), {name:'TimeoutError'}));
  await flush();
  assert.equal(h.csvReads.length, 1);
  assert.equal(h.scopedReads.length, 1);
  const payload = provenOriginals([['CANDIDATE',proof(3),'candidate-photo'],['MANUAL',proof(4)]]);
  payload.groups['internal-MANUAL']=[];
  Object.assign(payload.groups['internal-CANDIDATE'][0], {active:0,sourceUnavailable:true,
    availabilityKind:'census_missing',candidateEligible:true});
  h.scopedReads[0].resolve({ok:true,items:[row('CANDIDATE',{source_snapshot_key:proof(3)}),
    row('MANUAL',{status:'계약완료',source_snapshot_key:proof(4)})],unified:payload});
  await flush();
  assert.equal(h.context.allItems[0].unifiedCandidateOriginalCountV2, 1);
  assert.equal(h.context.allItems[1].state, '계약완료');
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'ready');
  assert.equal(h.context.JSUnifiedListingsV8.allOriginals('CANDIDATE')[0].thumbnail,
    'https://landthumb-phinf.pstatic.net/candidate-photo.jpg');
  assert.equal(h.context.loadSheet.originalsRecoveryV1, undefined);
  assert.equal(h.context.selectedPrintKeys[0], 'checked-fixture');
  assert.equal(h.context.favoriteOnly, true);
  assert.equal(h.originalReads.length, 1);
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
  h.scopedReads[0].reject(new Error('still offline'));
  await flush();
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'stale');
  await h.context.refreshListingsWhenChangedV682();
  assert.equal(h.scopedReads.length, 1, 'no retry before the 60-second cooldown');
  for (let attempt = 2; attempt <= 3; attempt++) {
    now += 60_001;
    const poll = h.context.refreshListingsWhenChangedV682();
    await flush();
    assert.equal(h.scopedReads.length, attempt);
    h.scopedReads[attempt-1].reject(new Error('offline'));
    await poll;
    await flush();
  }
  now += 10 * 60_000;
  for (let i = 0; i < 10; i++) await h.context.refreshListingsWhenChangedV682();
  assert.equal(h.scopedReads.length, 3, 'three recovery attempts cannot become endless requests');
  assert.equal(h.csvReads.length, 1);assert.equal(h.originalReads.length, 1);
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'stale');
  assert.equal(h.context.allItems[0].unifiedOriginalMetadataPendingV1, true);
});

test("property-proof recovery rerenders unchanged representatives instead of keeping the pending-only list", async () => {
  const h = harness();
  const loading = h.context.loadSheet(false,false);
  h.csvReads[0].resolve(csv([row('TODAY')], 'SAME'));
  await loading;
  h.originalReads[0].reject(new Error('first read failed'));
  await flush();
  assert.equal(h.csvReads.length,1);assert.equal(h.scopedReads.length,1);
  const rendersBeforeCsv = h.renders.length;
  h.scopedReads[0].resolve({ok:true,items:[row('TODAY',{source_snapshot_key:proof(3)})],
    unified:provenOriginals([['TODAY',proof(3),'metadata-first']])});
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8,/metadata-first\.jpg/);
  assert.equal(h.renders.length,rendersBeforeCsv+1,'changed metadata must render even with identical representative CSV');
  assert.equal(h.restored.at(-1).preserveVisibleListV1,false,'selection restoration cannot overwrite the fresh member set');
  assert.equal(h.writes.length,0,'a failed full response is never persisted as a verified complete cache');
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
  h.scopedReads[0].reject(new Error('offline'));
  await flush();
  now += 60_001;
  const poll = h.context.refreshListingsWhenChangedV682();
  await flush();
  h.scopedReads[1].resolve({ok:true,items:[row('TODAY',{source_snapshot_key:proof(3)})],
    unified:provenOriginals([['TODAY',proof(3),'restored']])});
  await poll;
  await flush();
  assert.match(h.context.allItems[0].thumbnailV8, /restored\.jpg/);
  assert.equal(h.context.JSUnifiedListingsV8.getOriginalMetadataStatus().status, 'ready');
  assert.equal(h.originalReads.length, 1);assert.equal(h.scopedReads.length, 2);
  await h.context.refreshListingsWhenChangedV682();
  assert.equal(h.scopedReads.length, 2, 'healthy unchanged polling remains a tiny revision check');
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

test('automatic completion restores the live reading position after network and geocode waits', async () => {
  const h = harness({complete:true,holdGeocode:true});
  h.context.allItems = [h.context.listingChangeRowToItemV683(row('BEFORE'))];
  h.context.testScrollTop = 100;
  const loading = h.context.loadSheet(true,true);
  h.context.testScrollTop = 900;
  h.csvReads[0].resolve(csv([row('AFTER')],'NEW'));
  await loading;
  await flush();
  h.context.testScrollTop = 1800;
  h.context.activeFavoriteFolderId = 'chosen-while-loading';
  h.finishGeocode();
  assert.equal(h.restored.at(-1).scroll,1800);
  assert.equal(h.restored.at(-1).folderId,'chosen-while-loading');
  assert.equal(h.restored.at(-1).preserveVisibleListV1,false);
  assert.deepEqual(Array.from(h.context.allItems,item=>item.propertyId),['AFTER']);
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
