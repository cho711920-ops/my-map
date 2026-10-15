const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('js/today-listings-v1.js', 'utf8');
const dataAccessSource = fs.readFileSync('js/data-access-v6.js', 'utf8');
const mapSource = fs.readFileSync('js/map.js', 'utf8');

function fixture() {
  const events = {}, reads = [], applied = [], timers = new Map(), elements = new Map();
  let seq = 0, market = 'lease';
  const makeElement = () => ({ children: [], hidden: false, listeners: {},
    replaceChildren() { this.children = []; }, appendChild(node) { this.children.push(node); },
    setAttribute() {}, addEventListener(name, listener) { this.listeners[name] = listener; } });
  const host = makeElement();
  host.parentNode = { insertBefore(node) { elements.set(node.id, node); } };
  elements.set('activeFilterChipsV844', host);
  const context = { Date, Set, Promise, Object, String, Number, Boolean, AbortController,
    document: { getElementById(id) { return elements.get(id); }, createElement: makeElement },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
  context.window = context;
  context.newListingDays = 1;
  context.allItems = [{ propertyId: 'old', regDate: '2026-10-12', tradeType: 'lease' }];
  context.addEventListener = (name, handler) => { events[name] = handler; };
  context.JSListingTradeV1 = { getMode: () => market, matchesItem: item => (item.tradeType || 'lease') === (market === 'lease' ? 'lease' : 'sale') };
  context.getFilteredItems = () => context.allItems.filter(item => context.JSTodayListingsV1.matches(item));
  context.applyFilter = () => {};
  context.listingRegistrationDayV1 = value => String(value).slice(0, 10);
  context.isRegistrationWithinDays = value => String(value).startsWith('2026-10-13');
  context.JSDataAccessV6 = { read(action, params, options) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    reads.push({ action, params, options, resolve, reject });
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    return promise;
  }};
  context.JSListingRefreshV1 = { applyScoped(result) {
    applied.push(result);
    const changed = new Set(result.items.map(item => item.property_id));
    context.allItems = context.allItems.filter(item => !changed.has(item.propertyId)).concat(result.items.map(item => ({
      propertyId: item.property_id, regDate: item.first_collected_at, tradeType: item.trade_type || 'lease'
    })));
    return true;
  }};
  vm.createContext(context); vm.runInContext(source, context);
  function result(ids, patch = {}) { return { ok: true, days: 1, market, day: '2026-10-13', rangeStart: '2026-10-12T15:00:00Z', rangeEnd: '2026-10-13T15:00:00Z',
    snapshotRevision: 'r1', hasMore: false, nextCursor: '', todayOriginalIds:Object.fromEntries(ids.map(id=>[id,[]])),todayAdCount:0,todayManualCount:ids.length,
    items: ids.map(id => ({ id, property_id: id, first_collected_at: '2026-10-13T09:00:00Z', trade_type: market === 'lease' ? 'lease' : 'sale' })),
    unified: { ok: true, groups: {}, sourceSearchIds: {}, snapshotRevision: 'r1' }, ...patch }; }
  return { context, api: context.JSTodayListingsV1, reads, applied, events, timers, elements, result,
    setMarket(value) { market = value; }, tick: async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}

test('Today reads only the fresh period and updates a yesterday cache without waiting for full data', async () => {
  const h = fixture();
  const pending = h.api.refresh(true);
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].action, 'newListingPeriod');
  assert.equal(h.api.state().phase, 'loading');
  h.reads[0].resolve(h.result(['new-1', 'new-2']));
  assert.equal(await pending, true);
  assert.equal(h.applied.length, 1); assert.equal(h.api.state().count, 2);
  assert.equal(h.context.allItems.length, 3);
  assert.equal(h.api.matches(h.context.allItems[0]), false);
  assert.equal(h.api.globalScope(), true);
});

test('all pages are assembled at one revision, never displaying a partial page as the full Today result', async () => {
  const h = fixture(), pending = h.api.refresh(true);
  h.reads[0].resolve(h.result(['first'], { hasMore: true, nextCursor: 'page2' })); await h.tick();
  assert.equal(h.applied.length, 0); assert.equal(h.reads.length, 2);
  assert.equal(h.reads[1].params.revision, 'r1');
  h.reads[1].resolve(h.result(['second']));
  assert.equal(await pending, true); assert.equal(h.applied[0].items.length, 2);
});

test('all Today pages merge original-ID gates and per-property proof maps, with explicit advertisement and property counts',async()=>{
  const h=fixture(),pending=h.api.refresh(true),a='sha256-v1:'+'1'.repeat(64),b='sha256-v1:'+'2'.repeat(64);
  h.reads[0].resolve(h.result(['A'],{hasMore:true,nextCursor:'page2',todayOriginalIds:{A:['ad-A1','ad-A2']},
    unified:{ok:true,groups:{A:[]},sourceSearchIds:{A:['naver:A']},sourceSnapshotKeys:{A:a},sourceSnapshotPropertyIds:{A:'A'},snapshotRevision:'r1'}}));
  await h.tick();
  h.reads[1].resolve(h.result(['B'],{todayOriginalIds:{B:[]},
    unified:{ok:true,groups:{B:[]},sourceSearchIds:{B:[]},sourceSnapshotKeys:{B:b},sourceSnapshotPropertyIds:{B:'B'},snapshotRevision:'r1'}}));
  assert.equal(await pending,true);
  const applied=h.applied[0];
  assert.deepEqual(Object.keys(applied.unified.sourceSnapshotKeys).sort(),['A','B']);
  assert.equal(applied.unified.sourceSnapshotKeys.A,a);assert.equal(applied.unified.sourceSnapshotPropertyIds.B,'B');
  assert.deepEqual(Array.from(applied.todayOriginalIds.A),['ad-A1','ad-A2']);
  assert.equal(h.api.state().adCount,2);assert.equal(h.api.state().count,2);assert.equal(h.api.state().manualCount,1);
  assert.match(h.elements.get('todayListingStatusV1').children[0].textContent,/신규 광고 2개 · 매물 2건 · 직접등록 1건/);
  assert.equal(h.api.matchesOriginal({propertyId:'A'},{originalId:'ad-A1',active:1}),true);
  assert.equal(h.api.matchesOriginal({propertyId:'A'},{originalId:'old-ad',active:1}),false);
  assert.equal(h.api.matchesOriginal({propertyId:'A'},{originalId:'ad-A1',active:0}),false);
});

test('Today projection selects only new-ad conditions/photos without changing old parent dates, memos or source groups',async()=>{
  const h=fixture();h.context.console={warn(){},error(){}};h.context.hideDone=true;h.context.doneOnly=false;
  vm.runInContext(fs.readFileSync('js/unified-listings-v8.js','utf8'),h.context);
  const pending=h.api.refresh(true);
  const old={propertyId:'A',originalId:'old',source:'당근',active:1,deposit:100,rent:10,area:30,thumbnail:'https://example.invalid/old.jpg'};
  const fresh={propertyId:'A',originalId:'new',source:'네이버',active:1,deposit:1000,rent:60,area:30,thumbnail:'https://example.invalid/new.jpg'};
  h.reads[0].resolve(h.result(['A'],{items:[{id:'A',property_id:'A',first_collected_at:'2024-01-01',trade_type:'lease'}],
    todayOriginalIds:{A:['new']},unified:{ok:true,groups:{A:[old,fresh]},sourceSearchIds:{},snapshotRevision:'r1'}}));
  await pending;
  const master=h.context.allItems.find(item=>item.propertyId==='A');Object.assign(master,{key:'favorite-A',memo:'keep memo',deposit:100,rent:10,area:30});
  const before={regDate:master.regDate,key:master.key,memo:master.memo,rent:master.rent};
  h.context.JSUnifiedListingsV8.attach([master],h.applied[0].unified);
  const projected=h.context.JSUnifiedListingsV8.filterItemForView(master,probe=>h.api.matches(probe)&&probe.rent<=80,'active');
  assert.deepEqual(Array.from(projected.unifiedDisplayOriginalsV2,row=>row.originalId),['new']);
  assert.equal(projected.rent,60);assert.match(projected.thumbnailV8,/new\.jpg/);
  assert.equal(h.context.JSUnifiedListingsV8.filterItemForView(master,probe=>h.api.matches(probe)&&probe.rent<=20,'active'),null);
  assert.deepEqual({regDate:master.regDate,key:master.key,memo:master.memo,rent:master.rent},before);
  assert.equal(master.unifiedAllOriginalsV1.length,2);
  h.context.newListingDays=0;
  assert.equal(h.context.JSUnifiedListingsV8.filterItemForView(master,()=>true,'active').unifiedDisplayOriginalsV2.length,2);
});

test('a failed next page preserves the previous success and exposes a retry, not false zero', async () => {
  const h = fixture(); let pending = h.api.refresh(true);
  h.reads[0].resolve(h.result(['known'])); await pending;
  pending = h.api.refresh(true); h.reads[1].resolve(h.result(['partial'], { hasMore: true, nextCursor: 'page2' })); await h.tick();
  h.reads[2].reject(new Error('offline')); await pending;
  assert.equal(h.applied.length, 1); assert.equal(h.api.state().count, 1); assert.equal(h.api.state().phase, 'error');
  assert.match(h.elements.get('todayListingStatusV1').children[0].textContent, /마지막 확인 결과 유지/);
});

test('a changed server snapshot retries once without committing the incomplete previous pages', async () => {
  const h = fixture(), pending = h.api.refresh(true);
  h.reads[0].reject({ payload: { snapshotChanged: true } }); await h.tick();
  assert.equal(h.reads.length, 2); h.reads[1].resolve(h.result(['current'])); await pending;
  assert.equal(h.applied.length, 1); assert.equal(h.applied[0].items[0].id, 'current');
});

test('filter removal and market change abort old responses; repeated clicks share the active read', async () => {
  const h = fixture(); const lease = h.api.refresh(true);
  assert.equal(h.api.refresh(true), lease);
  h.setMarket('building'); h.events['js-listing-trade-mode-change'](); await h.tick();
  assert.equal(h.reads[0].options.signal.aborted, true);
  h.reads[1].resolve(h.result(['sale'])); await h.tick();
  assert.equal(await lease, false); assert.equal(h.applied.length, 1); assert.equal(h.applied[0].market, 'building');
  const next = h.api.refresh(true); h.context.newListingDays = 0; h.api.onPeriodChanged(0);
  await next; assert.equal(h.reads[2].options.signal.aborted, true); assert.equal(h.applied.length, 1);
  assert.equal(h.elements.get('todayListingStatusV1').hidden, true);
});

test('latest full master snapshots recheck source IDs rather than treating master dates as new ads', async () => {
  const h = fixture(); let pending = h.api.refresh(true); h.reads[0].resolve(h.result(['first'])); await pending;
  pending = h.api.refresh(true);
  h.context.allItems.push({ propertyId: 'later', regDate: '2026-10-13', tradeType: 'lease' });
  h.events['js-listings-full-snapshot']({ detail: { revision: 'r2' } }); await h.tick();
  assert.equal(h.api.matches({ propertyId: 'later' }), false,'a new master date cannot establish a newly collected advertisement');
  assert.equal(h.reads[1].options.signal.aborted, true); assert.equal(await pending, false);
  h.reads[2].resolve(h.result(['first', 'later'], { snapshotRevision: 'r2', unified: { snapshotRevision: 'r2', groups: {}, sourceSearchIds: {} } })); await h.tick();
  assert.equal(h.api.state().count, 2); assert.equal(h.api.state().revision, 'r2');
});

test('an unresolved read has a visible bounded timeout and no full-list or mutation fallback', async () => {
  const h = fixture(), pending = h.api.refresh(true);
  [...h.timers.values()].find(timer => timer.ms === 45000).fn(); await pending;
  assert.equal(h.api.state().phase, 'error'); assert.equal(h.reads.length, 1); assert.equal(h.applied.length, 0);
  assert.match(h.elements.get('todayListingStatusV1').children[0].textContent, /최신 결과 미확인/);
});

test('the actual data transport sends no undefined cursor or revision on the first Today page', async () => {
  const h = fixture(), urls = [];
  h.context.URLSearchParams = URLSearchParams;
  h.context.fetch = async url => {
    const parsed = new URL(url, 'https://fixture.invalid');
    urls.push(parsed);
    assert.equal(parsed.searchParams.get('action'), 'newListingPeriod');
    assert.equal(parsed.searchParams.has('cursor'), false);
    assert.equal(parsed.searchParams.has('revision'), false);
    assert.equal(parsed.searchParams.get('market'), 'lease');
    return { ok: true, headers: new Headers(), json: async () => h.result(['fresh']) };
  };
  vm.runInContext(dataAccessSource, h.context);
  assert.equal(await h.api.refresh(true), true);
  assert.equal(urls.length, 1); assert.equal(h.applied.length, 1); assert.equal(h.api.state().count, 1);
});

test('yesterday pinned cards cannot override the confirmed Today subset', async () => {
  const h = fixture(), pending = h.api.refresh(true);
  h.reads[0].resolve(h.result(['fresh'])); await pending;
  h.context.jsPinnedClusterSelectionV6515 = { itemIdentities: ['property:old', 'property:fresh'] };
  h.context.getStableItemIdentityV638 = item => 'property:' + item.propertyId;
  const start = mapSource.indexOf('function getPinnedClusterItemsV6515(');
  vm.runInContext(mapSource.slice(start, mapSource.indexOf('\n}', start) + 2), h.context);
  assert.deepEqual(Array.from(h.context.getPinnedClusterItemsV6515(), item => item.propertyId), ['fresh']);
  h.context.newListingDays = 0;
  assert.deepEqual(Array.from(h.context.getPinnedClusterItemsV6515(), item => item.propertyId), ['old', 'fresh']);
});

test('crossing Korean midnight expires yesterday IDs without requiring another collection revision', async () => {
  const h = fixture(); let elapsed = 0;
  h.context.Date = class extends Date { static now() { return 100000 + elapsed; } };
  h.context.listingRegistrationDayV1 = value => /Z$/.test(String(value))
    ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10) : String(value).slice(0, 10);
  const pending = h.api.refresh(true);
  h.reads[0].resolve(h.result(['yesterday'], { serverNow: '2026-10-13T14:59:59.000Z' })); await pending;
  elapsed = 2000;
  assert.equal(h.api.matches({ propertyId: 'yesterday', regDate: '2026-10-13' }), false);
  h.api.render();
  [...h.timers.values()].find(timer => timer.ms === 0).fn(); await h.tick();
  assert.equal(h.reads.length, 2); assert.equal(h.api.state().phase, 'loading');
  h.reads[1].resolve(h.result(['newday'], { day: '2026-10-14', serverNow: '2026-10-13T15:00:01.000Z',
    rangeStart: '2026-10-13T15:00:00Z', rangeEnd: '2026-10-14T15:00:00Z',
    items: [{ id: 'newday', property_id: 'newday', first_collected_at: '2026-10-13T15:00:00Z', trade_type: 'lease' }] })); await h.tick();
  assert.equal(h.api.state().day, '2026-10-14');
  assert.equal(h.api.state().phase, 'ready'); assert.equal(h.api.matches({ propertyId: 'newday' }), true);
});
