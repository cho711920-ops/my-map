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
  function result(ids, patch = {}) { return { ok: true, todayPolicy: 'first-observed-property-v1', days: 1, market, day: '2026-10-13', rangeStart: '2026-10-12T15:00:00Z', rangeEnd: '2026-10-13T15:00:00Z',
    snapshotRevision: 'r1', hasMore: false, nextCursor: '', todayOriginalIds:Object.fromEntries(ids.map(id=>[id,[]])),todayAdCount:0,todayManualCount:ids.length,
    items: ids.map(id => ({ id, property_id: id, first_collected_at: '2026-10-13T09:00:00Z', trade_type: market === 'lease' ? 'lease' : 'sale' })),
    unified: { ok: true, groups: {}, sourceSearchIds: {}, snapshotRevision: 'r1' }, ...patch }; }
  return { context, api: context.JSTodayListingsV1, reads, applied, events, timers, elements, result,
    setMarket(value) { market = value; }, tick: async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}

function provenPage(h,ids,revision,patch={}) {
  const key='sha256-v1:'+'a'.repeat(64),base=h.result(ids);
  return {...base,snapshotConsistency:'per-property-v1',dataRevision:revision,snapshotRevision:revision,
    items:base.items.map(item=>({...item,source_snapshot_key:key})),todayAdCount:ids.length,todayManualCount:0,
    todayOriginalIds:Object.fromEntries(ids.map(id=>[id,['ad-'+id]])),
    unified:{ok:true,format:'expanded-v2',snapshotConsistency:'per-property-v1',snapshotRevision:revision,
      groups:Object.fromEntries(ids.map(id=>[id,[{propertyId:id,originalId:'ad-'+id,source:'네이버',active:1}]])),
      sourceSnapshotKeys:Object.fromEntries(ids.map(id=>[id,key])),sourceSnapshotPropertyIds:Object.fromEntries(ids.map(id=>[id,id]))},...patch};
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
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.equal(h.api.matchesOriginal({propertyId:'A'},{originalId:'ad-A1',active:1}),true);
  assert.equal(h.api.matchesOriginal({propertyId:'A'},{originalId:'old-ad',active:1}),false);
  assert.equal(h.api.matchesOriginal({propertyId:'A'},{originalId:'ad-A1',active:0}),false);
});

test('Today projection selects eligible ad conditions/photos on a first-observed property without changing its date, memo or full source group',async()=>{
  const h=fixture();h.context.console={warn(){},error(){}};h.context.hideDone=true;h.context.doneOnly=false;
  vm.runInContext(fs.readFileSync('js/unified-listings-v8.js','utf8'),h.context);
  const pending=h.api.refresh(true);
  const old={propertyId:'A',originalId:'old',source:'당근',active:1,deposit:100,rent:10,area:30,thumbnail:'https://example.invalid/old.jpg'};
  const fresh={propertyId:'A',originalId:'new',source:'네이버',active:1,deposit:1000,rent:60,area:30,thumbnail:'https://example.invalid/new.jpg'};
  h.reads[0].resolve(h.result(['A'],{items:[{id:'A',property_id:'A',first_collected_at:'2026-10-13T09:00:00Z',trade_type:'lease'}],
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

test('a failed next page preserves the previous success and allows a controller retry without an extra status row', async () => {
  const h = fixture(); let pending = h.api.refresh(true);
  h.reads[0].resolve(h.result(['known'])); await pending;
  pending = h.api.refresh(true); h.reads[1].resolve(h.result(['partial'], { hasMore: true, nextCursor: 'page2' })); await h.tick();
  h.reads[2].reject(new Error('offline')); await pending;
  assert.equal(h.applied.length, 1); assert.equal(h.api.state().count, 1); assert.equal(h.api.state().phase, 'error');
  assert.equal(h.api.matches({propertyId:'known'}),true);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.match(h.api.emptyMessage().title,/끝나지/);
  pending=h.api.refresh(true);h.reads[3].resolve(h.result(['known','recovered']));
  assert.equal(await pending,true);assert.equal(h.api.state().count,2);
});

test('Today never creates a summary row or refresh button while loading, ready, failed or recovered, and still automatically refreshes',async()=>{
  const h=fixture(),pending=h.api.refresh(true);
  h.context.document.createElement=()=>{throw new Error('Today must not create a status element');};
  assert.equal(h.elements.has('todayListingStatusV1'),false);assert.equal(h.api.state().phase,'loading');
  assert.match(h.api.emptyMessage().title,/확인하고/);
  h.reads[0].resolve(h.result(['first']));assert.equal(await pending,true);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  h.events['js-listings-full-snapshot']({detail:{revision:'next'}});
  await h.tick();assert.equal(h.reads.length,2,'removing the ready controls does not disable automatic reads');
  h.reads[1].reject(new Error('offline'));await h.tick();
  assert.equal(h.api.state().phase,'error');assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.match(h.api.emptyMessage().description,/필터를 껐다 켜면/);
  assert.doesNotMatch(h.api.emptyMessage().description,/위의|버튼|최신 확인/);
  const retry=h.api.refresh(true);await h.tick();
  assert.equal(h.reads.length,3);assert.equal(h.elements.has('todayListingStatusV1'),false);
  h.reads[2].resolve(h.result(['first','second']));assert.equal(await retry,true);
  assert.equal(h.api.state().phase,'ready');assert.equal(h.api.state().count,2);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
});

test('Today removes a legacy status node on initialization and rendering without depending on the filter-chip host',()=>{
  const h=fixture();let removed=0;
  const stale=()=>({remove(){removed+=1;h.elements.delete('todayListingStatusV1');}});
  h.elements.set('todayListingStatusV1',stale());
  vm.runInContext(source,h.context);
  assert.equal(removed,1);assert.equal(h.elements.has('todayListingStatusV1'),false);
  h.elements.delete('activeFilterChipsV844');
  h.elements.set('todayListingStatusV1',stale());
  let received;h.context.updateMapListingCountV825=items=>{received=items;};
  const shown=[];h.context.JSTodayListingsV1.render(shown);
  assert.equal(removed,2);assert.equal(received,shown);
  h.elements.set('todayListingStatusV1',stale());h.context.newListingDays=0;
  h.context.JSTodayListingsV1.render();
  assert.equal(removed,3);assert.equal(h.elements.has('todayListingStatusV1'),false);
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
  assert.equal(h.elements.has('todayListingStatusV1'),false);
});

test('latest full master snapshots retain the verified new-property gate until Today confirms eligible IDs', async () => {
  const h = fixture(); let pending = h.api.refresh(true); h.reads[0].resolve(h.result(['first'])); await pending;
  pending = h.api.refresh(true);
  h.context.allItems.push({ propertyId: 'later', regDate: '2026-10-13', tradeType: 'lease' });
  h.events['js-listings-full-snapshot']({ detail: { revision: 'r2' } }); await h.tick();
  assert.equal(h.api.matches({ propertyId: 'later' }), false,'a new master date alone cannot establish verified Today eligibility');
  assert.equal(h.reads[1].options.signal.aborted, false,'an in-flight Today request must not restart on a full snapshot');
  h.reads[1].resolve(h.result(['first']));assert.equal(await pending,true);
  [...h.timers.values()].find(timer=>timer.ms===0).fn();await h.tick();
  h.reads[2].resolve(h.result(['first', 'later'], { snapshotRevision: 'r2', unified: { snapshotRevision: 'r2', groups: {}, sourceSearchIds: {} } })); await h.tick();
  assert.equal(h.api.state().count, 2); assert.equal(h.api.state().revision, 'r2');
});

test('an unresolved read has an honest empty-state timeout and no full-list or mutation fallback', async () => {
  const h = fixture(), pending = h.api.refresh(true);
  [...h.timers.values()].find(timer => timer.ms === 45000).fn(); await pending;
  assert.equal(h.api.state().phase, 'error'); assert.equal(h.reads.length, 1); assert.equal(h.applied.length, 0);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.match(h.api.emptyMessage().title,/확인이 끝나지/);
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

test('three proven pages survive continuous full-snapshot churn and coalesce only one follow-up without restarting the deadline',async()=>{
  const h=fixture(),pending=h.api.refresh(true);
  const deadline=[...h.timers.values()].find(timer=>timer.ms===45000);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'cursor2'}));await h.tick();
  assert.equal(h.applied.length,1);assert.equal(h.api.matches({propertyId:'A'}),true);
  assert.equal(h.api.state().partial,true);assert.equal(h.api.state().progressCount,1);assert.equal(h.api.state().phase,'loading');
  for(let n=0;n<3;n++)h.events['js-listings-full-snapshot']({detail:{revision:'CHURN-'+n}});
  await h.tick();
  assert.equal(h.reads.length,2);assert.equal(h.reads[1].options.signal.aborted,false);
  assert.equal([...h.timers.values()].find(timer=>timer.ms===45000),deadline);
  assert.equal(h.reads[1].params.revision,undefined);
  h.reads[1].resolve(provenPage(h,['B'],'P2',{hasMore:true,nextCursor:'cursor3'}));await h.tick();
  assert.equal(h.api.state().progressCount,2);assert.equal(h.context.getFilteredItems().length,2);
  h.events['js-listings-full-snapshot']({detail:{revision:'CHURN-3'}});
  h.reads[2].resolve(provenPage(h,['C'],'P3'));assert.equal(await pending,true);
  assert.equal(h.api.state().count,3);assert.equal(h.api.state().adCount,3);assert.equal(h.api.state().revision,'P3');
  assert.equal(h.api.state().partial,false);assert.equal(h.api.state().confirmedPages,3);
  const followup=[...h.timers.entries()].find(([,timer])=>timer.ms===0);h.timers.delete(followup[0]);followup[1].fn();await h.tick();
  h.reads[3].resolve(provenPage(h,['A'],'P4',{hasMore:true,nextCursor:'again2'}));await h.tick();
  h.events['js-listings-full-snapshot']({detail:{revision:'CHURN-4'}});
  h.reads[4].resolve(provenPage(h,['B'],'P5',{hasMore:true,nextCursor:'again3'}));await h.tick();
  h.events['js-listings-full-snapshot']({detail:{revision:'CHURN-5'}});
  h.reads[5].resolve(provenPage(h,['C'],'P6'));await h.tick();
  assert.equal(h.api.state().phase,'ready');assert.equal(h.reads.length,6);assert.equal(h.applied.length,6);
  assert.equal([...h.timers.values()].some(timer=>timer.ms===0),false,'the second dirty request cannot start an endless chain');
});

test('a late proven page fails at the original 45-second deadline, preserving the confirmed subset without claiming empty or complete',async()=>{
  const h=fixture(),pending=h.api.refresh(true),deadline=[...h.timers.values()].find(timer=>timer.ms===45000);
  assert.match(h.api.emptyMessage().title,/확인하고/);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
  h.events['js-listings-full-snapshot']({detail:{revision:'unrelated'}});
  deadline.fn();assert.equal(await pending,false);
  assert.equal(h.api.matches({propertyId:'A'}),true);assert.equal(h.api.state().partial,true);
  assert.equal(h.api.state().phase,'error');assert.equal(h.api.state().confirmedPages,1);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.match(h.api.emptyMessage().title,/끝나지/);
  assert.equal(h.reads.length,2);assert.equal([...h.timers.values()].some(timer=>timer.ms===0),false);
});

test('a retryable page conflict retries only that cursor once and keeps earlier confirmed pages',async()=>{
  const h=fixture(),pending=h.api.refresh(true);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
  h.reads[1].reject({payload:{snapshotChanged:true,retryScope:'page'}});await h.tick();
  assert.equal(h.reads.length,3);assert.equal(h.reads[1].params.cursor,'second');assert.equal(h.reads[2].params.cursor,'second');
  assert.equal(h.api.matches({propertyId:'A'}),true);assert.equal(h.applied.length,1);
  h.reads[2].resolve(provenPage(h,['B'],'P2'));assert.equal(await pending,true);
  assert.equal(h.applied.length,2);assert.equal(h.api.state().count,2);
});

test('a local-edit preflight refusal captures a fresh read context and retries only that page before any Today gate changes',async()=>{
  const h=fixture(),contexts=[];let commits=0;
  const original=h.context.JSListingRefreshV1.applyScoped;
  h.context.JSListingRefreshV1.captureScopedRead=()=>({sequence:contexts.length});
  h.context.JSListingRefreshV1.applyScoped=(page,readContext)=>{contexts.push(readContext);return ++commits===1?false:original(page);};
  const pending=h.api.refresh(true);
  h.reads[0].resolve(provenPage(h,['A'],'P1'));await h.tick();
  assert.equal(h.api.matches({propertyId:'A'}),false);assert.equal(h.reads.length,2);assert.equal(h.applied.length,0);
  h.reads[1].resolve(provenPage(h,['A'],'P2'));assert.equal(await pending,true);
  assert.deepEqual(contexts.map(value=>value.sequence),[0,1]);assert.equal(h.applied.length,1);
});

test('unsupported protocol, mixed day and duplicate page IDs cannot mutate the confirmed subset',async()=>{
  for(const patch of [
    {snapshotConsistency:'unsupported',unified:{snapshotConsistency:'unsupported',snapshotRevision:'P2'}},
    {day:'2026-10-14'},
    {items:[{property_id:'A'}],todayOriginalIds:{A:['ad-A']}}
  ]) {
    const h=fixture(),pending=h.api.refresh(true);
    h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
    h.reads[1].resolve(provenPage(h,['B'],'P2',patch));await h.tick();
    // A day change can trigger the existing one full retry, but it must not
    // apply the invalid page or discard already verified original IDs.
    if(h.reads.length>2){h.reads[2].reject(new Error('stop fixture retry'));}
    await pending;
    assert.equal(h.applied.length,1);assert.equal(h.api.matches({propertyId:'A'}),true);
  }
});

test('the new-property policy is required and old parents cannot enter Today even with a new advertisement',async()=>{
  for(const patch of [
    {todayPolicy:undefined},
    {todayPolicy:'first-observed-advertisement-v1'},
    {todayPolicy:'unknown'},
    {items:[{property_id:'old-parent',first_collected_at:'2026-10-12T09:00:00Z'}],todayOriginalIds:{'old-parent':['new-ad']}}
  ]) {
    const h=fixture(),pending=h.api.refresh(true);
    h.reads[0].resolve(provenPage(h,['A'],'P1',patch));
    assert.equal(await pending,false);assert.equal(h.applied.length,0);
    assert.equal(h.api.state().phase,'error');assert.equal(h.api.globalScope(),false);
    assert.equal(h.reads.length,1,'a policy failure must not restart collection or loop');
  }
});

test('a legacy-policy continuation cannot replace a verified first-observed-property page',async()=>{
  const h=fixture(),pending=h.api.refresh(true);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
  h.reads[1].resolve(provenPage(h,['old-parent'],'P2',{todayPolicy:'first-observed-advertisement-v1'}));
  assert.equal(await pending,false);assert.equal(h.applied.length,1);
  assert.equal(h.api.matches({propertyId:'A'}),true);assert.equal(h.api.matches({propertyId:'old-parent'}),false);
  assert.equal(h.api.state().phase,'error');assert.equal(h.api.state().progressCount,1);
});

test('an account change cancels and rejects a late Today response before applying other-account data',async()=>{
  const h=fixture();h.context.JSAuthenticatedAccountEmail='old@example.invalid';
  const pending=h.api.refresh(true);h.context.JSAuthenticatedAccountEmail='new@example.invalid';
  h.reads[0].resolve(provenPage(h,['A'],'P1'));assert.equal(await pending,false);
  assert.equal(h.applied.length,0);assert.equal(h.reads[0].options.signal.aborted,true);assert.equal(h.api.state().phase,'error');
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.match(h.api.emptyMessage().title,/끝나지/);
});

test('the empty-list rendering uses Today load/error notices instead of advertising an authoritative zero',()=>{
  const script=fs.readFileSync('js/script.js','utf8');
  assert.match(script,/JSTodayListingsV1\.emptyMessage\(\)/);
  assert.match(script,/escapeHtml\(todayEmptyV1 \? todayEmptyV1\.title : "검색 결과가 없습니다\."\)/);
  const h=fixture();assert.equal(h.api.emptyMessage(),null);
  h.api.refresh(true);assert.match(h.api.emptyMessage().description,/0건으로 확정하지/);
  h.context.newListingDays=0;h.api.onPeriodChanged(0);assert.equal(h.api.emptyMessage(),null);
});

test('Today rendering shares one filtered result with the map badge so a cold pending read is not called zero',()=>{
  const h=fixture(),shown=[];let filters=0,received;
  h.context.getFilteredItems=()=>{filters+=1;return shown;};
  h.context.updateMapListingCountV825=items=>{received=items;};
  h.api.render();assert.equal(filters,1);assert.equal(received,shown);
});

test('a cold partial Today timeout schedules complete-base recovery once, never once per page',async()=>{
  const h=fixture();let recoveries=0;
  h.context.JSListingRefreshV1.ensureCompleteBase=()=>{recoveries+=1;};
  const pending=h.api.refresh(true),deadline=[...h.timers.values()].find(timer=>timer.ms===45000);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
  assert.equal(recoveries,0);
  h.reads[1].resolve(provenPage(h,['B'],'P2',{hasMore:true,nextCursor:'third'}));await h.tick();
  assert.equal(recoveries,0);
  deadline.fn();await pending;
  assert.equal(recoveries,1);assert.equal(h.api.state().phase,'error');
  assert.equal(h.api.matches({propertyId:'A'}),true);assert.equal(h.api.matches({propertyId:'B'}),true);
});

test('leaving Today or canceling into an inactive market restores the full base without waiting for an obsolete read',async()=>{
  for(const viaMarket of [false,true]) {
    const h=fixture();let recoveries=0;
    h.context.JSListingRefreshV1.ensureCompleteBase=()=>{recoveries+=1;};
    const pending=h.api.refresh(true);
    h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
    h.context.newListingDays=0;
    if(viaMarket)h.events['js-listing-trade-mode-change']();else h.api.onPeriodChanged(0);
    await pending;
    assert.equal(recoveries,1);assert.equal(h.reads[1].options.signal.aborted,true);
  }
});

test('a complete successful Today read also offers the complete-base bridge only after all pages finish',async()=>{
  const h=fixture();let recoveries=0;h.context.JSListingRefreshV1.ensureCompleteBase=()=>{recoveries+=1;};
  const pending=h.api.refresh(true);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
  assert.equal(recoveries,0);
  h.reads[1].resolve(provenPage(h,['B'],'P2'));assert.equal(await pending,true);
  assert.equal(recoveries,1);assert.equal(h.api.state().phase,'ready');
});

function scriptFunction(name) {
  const script=fs.readFileSync('js/script.js','utf8'),start=script.indexOf('function '+name+'(');
  assert.ok(start>=0,name);
  return script.slice(start,script.indexOf('\n}',start)+2);
}

function installFilterPresentation(h) {
  const draws=[],status={};let scans=0;
  h.elements.set('status',status);
  h.context.getFilteredItems=()=>{scans+=1;return h.context.allItems.filter(item=>
    h.context.newListingDays!==1||h.api.matches(item));};
  Object.assign(h.context,{currentItems:[],drawItems(items){draws.push(items);},
    renderActiveFilterChipsV844(){},syncFilterToggleControlsV844(){},getPinnedClusterItemsV6515:()=>[],
    selectedGroupKeys:[],multiClusterMode:false,jsInitialFullListingsLoadingV1:false});
  for(const name of ['applyFilter','toggleNewListingDays'])vm.runInContext(scriptFunction(name),h.context);
  return {draws,status,scans:()=>scans};
}

test('one Today toggle clears map focus and renders each confirmed page with the same filtered array, without duplicate scans',async()=>{
  const h=fixture(),presentation=installFilterPresentation(h),order=[],badges=[];
  h.context.newListingDays=0;
  h.context.favoriteOnly=true;h.context.favoriteFilterKeys=['property:keep'];
  h.context.clearPinnedClusterSelectionV6515=value=>order.push(['pinned',value]);
  h.context.clearAdministrativeListSelectionV6570=()=>order.push(['admin']);
  const start=mapSource.indexOf('function clearMapListSelectionForNavigationV6571(');
  vm.runInContext(mapSource.slice(start,mapSource.indexOf('\n}',start)+2),h.context);
  h.context.updateMapListingCountV825=items=>badges.push(items);
  h.context.toggleNewListingDays(1);
  assert.deepEqual(order,[['pinned',true],['admin']]);
  assert.equal(h.reads.length,1);assert.equal(presentation.scans(),1);
  assert.equal(presentation.draws.length,1);assert.equal(badges.at(-1),presentation.draws.at(-1));
  const pending=h.api.refresh(true);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
  assert.equal(presentation.scans(),2);assert.equal(presentation.draws.length,2);
  assert.equal(badges.at(-1),presentation.draws.at(-1));
  assert.equal(h.api.state().partial,true);assert.deepEqual(presentation.draws.at(-1).map(item=>item.propertyId),['A']);
  h.reads[1].resolve(provenPage(h,['B'],'P2'));assert.equal(await pending,true);
  assert.equal(presentation.scans(),4,'initial, each proven page and final ready presentation only');
  assert.equal(h.context.favoriteOnly,true);assert.deepEqual(h.context.favoriteFilterKeys,['property:keep']);
  h.context.toggleNewListingDays(1);
  assert.equal(h.context.newListingDays,0);assert.equal(presentation.scans(),5);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.deepEqual(presentation.draws.at(-1).map(item=>item.propertyId),['old','A','B']);
});

test('cold initial Today and a manual cancel keep honest loading state without redundant empty filters or late page renders',async()=>{
  const h=fixture(),presentation=installFilterPresentation(h),badges=[];
  h.context.allItems=[];h.context.newListingDays=0;h.context.jsInitialFullListingsLoadingV1=true;
  h.context.updateMapListingCountV825=items=>badges.push(items);
  h.context.toggleNewListingDays(1);
  assert.equal(h.reads.length,1);assert.equal(presentation.scans(),0);
  assert.equal(badges.length,1);assert.equal(badges[0].length,0);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
  assert.match(h.api.emptyMessage().title,/확인하고/);
  const pending=h.api.refresh(true);
  h.reads[0].resolve(provenPage(h,['A'],'P1',{hasMore:true,nextCursor:'second'}));await h.tick();
  assert.equal(presentation.scans(),1);assert.deepEqual(presentation.draws.at(-1).map(item=>item.propertyId),['A']);
  h.context.toggleNewListingDays(1);
  assert.equal(await pending,false);assert.equal(h.reads[1].options.signal.aborted,true);
  const afterCancel=presentation.scans();
  h.reads[1].resolve(provenPage(h,['late'],'P2'));await h.tick();
  assert.equal(presentation.scans(),afterCancel);assert.equal(h.applied.length,1);
  assert.equal(h.elements.has('todayListingStatusV1'),false);
});

test('Today render accepts an already filtered empty result and does not silently rescan it',()=>{
  const h=fixture(),shown=[];let scans=0,received;
  h.context.getFilteredItems=()=>{scans+=1;return [{propertyId:'wrong'}];};
  h.context.updateMapListingCountV825=items=>{received=items;};
  h.api.render(shown);
  assert.equal(scans,0);assert.equal(received,shown);
});

test('early Today master rejection preserves source-specific prices, photos, dates and manual fallback while reducing projections',async()=>{
  const h=fixture();h.context.console={warn(){},error(){}};
  Object.assign(h.context,{hideDone:true,doneOnly:false,favoriteOnly:false,gongsilOnly:false,
    map:{getBounds:()=>({contain:()=>true})},
    readOptionalFilterNumberV1(id,fallback){const value=h.elements.get(id)?.value;return value?Number(value):fallback;},
    readOptionalNumberInput:()=>null,matchesMultiKeyword:()=>true,getItemFloorNumber:()=>null,
    isDone:item=>item.state==='계약완료'});
  for(const id of ['keyword','typeFilter','sourceFilter','floorQuickFilter','brokerageFeeFilter','industryFilter',
    'minDeposit','maxDeposit','minRent','maxRent','minPremium','maxPremium','minArea','maxArea','sortFilter'])h.elements.set(id,{value:''});
  h.elements.get('sortFilter').value='latest';h.elements.get('maxDeposit').value='2000';
  h.elements.get('maxRent').value='80';h.elements.get('minArea').value='30';
  vm.runInContext(fs.readFileSync('js/unified-listings-v8.js','utf8'),h.context);
  const base=id=>({propertyId:id,key:'favorite-'+id,name:id,address:'서구 테스트동 1',room:'1층',source:'네이버',
    state:'',regDate:'2024-01-01',tradeType:'lease',deposit:1000,rent:60,area:35,fee:0,premium:0,memo:'보존 메모',latlng:{}});
  const masters=[{...base('A'),regDate:'2026-10-13'},{...base('B'),regDate:'2026-10-13'},{...base('manual'),source:'직접등록',regDate:'2026-10-13'},
    base('old'),{...base('reappeared'),regDate:'2026-10-13'},
    {...base('old-manual'),source:'직접등록',regDate:'2024-01-01'},
    {...base('unknown'),unifiedOriginalMetadataPendingV1:true}];
  const ad=(id,originalId,source,rent,area=35)=>({propertyId:id,originalId,source,active:1,room:'1층',
    deposit:1000,rent,area,fee:0,premium:0,thumbnail:'https://example.invalid/'+originalId+'.jpg'});
  const groups={A:[ad('A','old-cheap','당근',10),ad('A','new-A','네이버',60)],
    B:[ad('B','new-B','네이버',90)],old:[ad('old','old-only','네이버',20)],
    reappeared:[ad('reappeared','old-reappeared','당근',20)],manual:[],'old-manual':[]};
  h.context.allItems=masters;
  h.context.JSUnifiedListingsV8.attach(masters,{ok:true,groups});
  const pending=h.api.refresh(true);
  const optimized=scriptFunction('getFilteredItems');
  const gate='if (newListingDays === 1 && window.JSTodayListingsV1 && !window.JSTodayListingsV1.matches(master)) return;';
  assert.ok(optimized.includes(gate));
  const baseline=optimized.replace(gate,'');
  vm.runInContext(scriptFunction('listingRegistrationTime'),h.context);
  const project=h.context.JSUnifiedListingsV8.filterItemForView;let projections=0;
  h.context.JSUnifiedListingsV8.filterItemForView=(...args)=>{projections+=1;return project(...args);};
  function run(code){projections=0;vm.runInContext(code,h.context);const items=h.context.getFilteredItems();
    return {rows:JSON.stringify(items.map(item=>({id:item.propertyId,key:item.key,memo:item.memo,
      regDate:item.regDate,rent:item.rent,area:item.area,thumbnail:item.thumbnailV8,
      originals:(item.unifiedDisplayOriginalsV2||[]).map(original=>original.originalId)}))),projections};}
  let old=run(baseline),fast=run(optimized);
  assert.equal(fast.rows,old.rows);assert.deepEqual(JSON.parse(fast.rows).map(item=>item.id),['manual']);
  assert.equal(fast.projections,1,'the original source-less direct-entry fallback remains visible before page one');
  h.reads[0].resolve(h.result(['A','B','manual'],{todayOriginalIds:{A:['new-A'],B:['new-B'],manual:[]}}));
  await pending;
  h.context.allItems.forEach(item=>Object.assign(item,masters.find(master=>master.propertyId===item.propertyId)));
  h.context.JSUnifiedListingsV8.attach(h.context.allItems,{ok:true,groups});
  old=run(baseline);fast=run(optimized);
  assert.equal(fast.rows,old.rows);assert.equal(old.projections,7);assert.equal(fast.projections,3);
  assert.deepEqual(JSON.parse(fast.rows).map(item=>item.id).sort(),['A','manual']);
  const selected=JSON.parse(fast.rows).find(item=>item.id==='A');
  assert.equal(selected.rent,60);assert.equal(selected.regDate,'2026-10-13');assert.equal(selected.memo,'보존 메모');
  assert.match(selected.thumbnail,/new-A\.jpg/);assert.deepEqual(selected.originals,['new-A']);
  h.elements.get('sourceFilter').value='naver';
  old=run(baseline);fast=run(optimized);assert.equal(fast.rows,old.rows);
  assert.deepEqual(JSON.parse(fast.rows).map(item=>item.id),['A']);
  h.elements.get('maxRent').value='20';
  assert.equal(run(optimized).rows,run(baseline).rows);assert.deepEqual(JSON.parse(run(optimized).rows),[],
    'the cheap old sibling cannot satisfy a Today price condition');
  h.context.newListingDays=0;h.api.onPeriodChanged(0);
  old=run(baseline);fast=run(optimized);assert.equal(fast.rows,old.rows);assert.equal(fast.projections,7);
  assert.deepEqual(JSON.parse(fast.rows).map(item=>item.id),['old'],'normal view is not restricted to confirmed Today IDs');
});
