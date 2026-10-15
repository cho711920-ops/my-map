import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { handleD1GetAction } from '../cloudflare/src/d1-api.js';
import { withSourceOriginalMetadata } from '../cloudflare/src/source-original-display.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync('cloudflare/migrations').filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync('cloudflare/migrations/' + name, 'utf8'));
  }
  t.after(() => db.close());
  const queries = [];
  const env = { DB: { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; }, async all() {
      queries.push({ sql, count: values.length }); return { results: db.prepare(sql).all(...values) };
    }, async first() { queries.push({ sql, count: values.length }); return db.prepare(sql).get(...values) || null; } };
  } } };
  const master = (id, room = '1층', status = 'active', publicId = id) => db.prepare(`INSERT INTO listings
    (id,property_id,title,address,room,status,operating_memo) VALUES (?,?,?,?,?,?,?)`)
    .run(id, publicId, '보존할 대표', '서구 테스트동 1-1', room, status, '보존할 사용자 메모');
  const source = (id, parent, active = 1, raw = {}, sourceName = '네이버', room = '1층') => {
    const original = { originalId: id, source: sourceName, room, deposit: 1000, rent: 50,
      buildingName: '원본 광고', address: '서구 테스트동 1-1', tradeType: 'lease', revision: 1,
      thumbnail: 'https://landthumb-phinf.pstatic.net/fixture.jpg' };
    db.prepare(`INSERT INTO listing_sources (id,listing_id,source,source_listing_id,source_url,active,
      missing_count,updated_at,list_snapshot_json,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, parent, sourceName, id + '::lease', 'https://example.test/original/' + id, active, active ? 0 : 1,
        '2026-10-14T02:00:00Z', JSON.stringify(original), JSON.stringify(raw));
    if (!active) db.prepare("INSERT INTO listing_source_availability(source_id,kind) VALUES (?,'census_missing')").run(id);
  };
  return { db, env, queries, master, source,
    get: action => handleD1GetAction(env, {}, { action }),
    unified: ids => handleD1GetAction(env, {}, { action: 'newListingPeriod', market: 'lease', days: '1' }) };
}
const expand = result => Object.fromEntries(Object.entries(result.groups).map(([key, values]) => [key,
  values.map(value => Object.fromEntries(result.fields.map((field, index) => [field, value[index]])))]));

test('compact and detail retain each ended ad beside nine live siblings, without raw payload leakage', async t => {
  const f = fixture(t); f.master('M');
  for (let index = 0; index < 10; index++) f.source('ad-' + index, 'M', index === 9 ? 0 : 1,
    { floorInfo: '1/4', roomInfo: '1층', secretRawPayload: 'not-for-browser' });
  const result = await f.get('unifiedListings'), originals = expand(result).M;
  assert.equal(originals.length, 10); assert.equal(result.unavailableCount, 1);
  const ended = originals.find(original => original.sourceUnavailable);
  assert.equal(ended.originalId, 'ad-9'); assert.equal(ended.providerSourceId, 'ad-9');
  assert.equal(ended.missingCount, 1); assert.equal(ended.endedAt, '');
  assert.equal(ended.absenceConfirmedAt, undefined, 'missing proof never falls back to source.updated_at; empty compact tails are omitted');
  assert.equal(ended.floor, 1); assert.equal(originals.filter(original => !original.sourceUnavailable).length, 9);
  assert.doesNotMatch(JSON.stringify(result), /secretRawPayload|not-for-browser/);
  const detail = await handleD1GetAction(f.env, {}, { action: 'unifiedListingDetail', propertyId: 'M' });
  assert.equal(detail.originals.length, 10); assert.equal(detail.originals.filter(original => original.sourceUnavailable).length, 1);
  assert.doesNotMatch(JSON.stringify(detail), /secretRawPayload|not-for-browser/);
  assert.equal(f.queries.filter(query => /FROM listing_history h/.test(query.sql)).length, 2);
  assert.ok(f.queries.every(query => query.count <= 77));
});

test('all ended ads remain real records; held and deleted masters do not leak', async t => {
  const f = fixture(t); f.master('ended'); f.source('one', 'ended', 0); f.source('two', 'ended', 0);
  f.master('deleted', '1층', 'deleted'); f.source('deleted-ad', 'deleted', 0);
  f.master('held'); f.source('held-ad', 'held', 0);
  f.db.prepare(`INSERT INTO listing_data_quality_holds
    (listing_id,state,issue_code,blocks_publication) VALUES ('held','open','fixture',1)`).run();
  const result = await f.get('unifiedListings');
  const originals = expand(result).ended;
  assert.equal(originals.length, 2); assert.ok(originals.every(original => original.sourceUnavailable && !original.masterFallback));
  assert.equal(result.groups.deleted, undefined); assert.equal(result.groups.held, undefined);
});

test('candidate API counts distinct masters having candidate ads, including masters with active siblings', async t => {
  const f = fixture(t); f.master('M'); f.source('live', 'M'); f.source('ended-one', 'M', 0); f.source('ended-two', 'M', 0);
  f.master('manual-done', '1층', '계약완료'); f.source('not-candidate', 'manual-done', 0);
  f.master('unavailable'); f.source('ended-a', 'unavailable', 0); f.source('ended-b', 'unavailable', 0);
  const result = await f.get('transactionCandidates');
  assert.equal(result.count, 2); assert.equal(result.returnedCount, 2); assert.equal(result.hasMore, false);
  assert.equal(new Set(result.candidates.map(row => row.propertyId)).size, 2);
  const mixed = result.candidates.find(row => row.propertyId === 'M');
  assert.equal(mixed.sourceCount, 3); assert.equal(mixed.activeSourceCount, 1); assert.equal(mixed.candidateOriginalCount, 2);
  assert.equal(result.candidateAdCount, 4);
  assert.equal(result.candidates[0].sourceUnavailable, true); assert.equal(result.manualCompleted, 1);
  assert.equal(result.completedOnlyTotal, 3);
  assert.equal(f.db.prepare("SELECT status FROM listings WHERE id='M'").get().status, 'active');
});

test('provider floor/room are authoritative but only an actual room edit protects manual room', async t => {
  const f = fixture(t); f.master('manual', '지하2층 B03호'); f.master('price-only', '6층');
  f.source('manual-ad', 'manual', 1, { list: { Ff: -1, Ho: 'B03' } }, '공실박스', '지하3층');
  f.source('price-ad', 'price-only', 1, { list: { Ff: 1, Ho: '' } }, '공실박스', '6층');
  f.db.prepare(`INSERT INTO listing_history (listing_id,action,before_json,after_json) VALUES (?,?,?,?)`)
    .run('manual', 'updateProperty', JSON.stringify({ room: '1층' }), JSON.stringify({ room: '지하2층 B03호' }));
  f.db.prepare(`INSERT INTO listing_history (listing_id,action,before_json,after_json) VALUES (?,?,?,?)`)
    .run('price-only', 'updateProperty', JSON.stringify({ room: '6층', deposit: 100 }), JSON.stringify({ room: '6층', deposit: 200 }));
  const result = expand(await f.get('unifiedListings'));
  assert.equal(result.manual[0].room, '지하2층 B03호'); assert.equal(result.manual[0].floor, -2);
  assert.equal(result.manual[0].hasManualRoomOverride, true); assert.equal(result.manual[0].sourceFloor, -1);
  assert.equal(result['price-only'][0].room, '1층');
  // Explicit provider floor is present even if a legacy display label remains.
  assert.equal(result['price-only'][0].floor, 1); assert.equal(result['price-only'][0].hasManualRoomOverride, false);
});

test('literal B03 is not guessed as basement three without provider floor evidence', () => {
  const row = { id: 'O', listing_id: 'M', source: '공실박스', active: 1,
    floor_metadata_json: JSON.stringify({ room: 'B03' }) };
  const result = withSourceOriginalMetadata({ room: '지하3층' }, row);
  assert.equal(result.room, 'B03호'); assert.equal(result.floor, '');
});

test('sale adapters keep their established display room while source floor and literal unit stay separate', () => {
  const row = { id: 'sale-ad', listing_id: 'sale-master', source: '공실박스', active: 1,
    floor_metadata_json: JSON.stringify({ floor: 3, room: '301' }) };
  const original = { tradeType: 'sale', room: '1층' };
  const result = withSourceOriginalMetadata(original, row);
  assert.equal(result.room, '1층'); assert.equal(result.floor, 3); assert.equal(result.sourceRoom, '301호');
  const manual = withSourceOriginalMetadata(original, row, new Map([['sale-master', '2층 201호']]));
  assert.equal(manual.room, '2층 201호'); assert.equal(manual.floor, 2);
});

function frontend(payload) {
  const events = {};
  const context = { console, URL, Date, Promise, Set, Map, AbortController, setTimeout, clearTimeout,
    document: { getElementById() { return null; }, addEventListener() {}, querySelector() { return null; } } };
  context.window = { document: context.document, innerWidth: 1200, hideDone: true, doneOnly: false,
    allItems: [], addEventListener(name, listener) { events[name] = listener; }, setTimeout, clearTimeout,
    JSDataAccessV6: { async read() { return payload; } } };
  vm.runInNewContext(fs.readFileSync('js/unified-listings-v8.js', 'utf8'), context);
  return context.window;
}

test('attach overlays only active lease floor evidence, preferring the master link without changing its room key', () => {
  const browser = frontend(), api = browser.JSUnifiedListingsV8;
  const item = { propertyId: 'M', tradeType: 'lease', sourceLink: 'https://example.test/current', room: '지하3층', floor: -3 };
  const ads = [
    { originalId: 'priority', source: '당근', link: 'https://example.test/other', room: '2층', floor: 2 },
    { originalId: 'current', source: '공실박스', link: item.sourceLink, room: '지하1층 B03호', floor: -1 },
    { originalId: 'ended', source: '네이버', link: item.sourceLink, room: '9층', floor: 9, sourceUnavailable: true }
  ];
  api.attach([item], { ok: true, groups: { M: ads } });
  assert.equal(item.sourceFloorVerifiedV1, true); assert.equal(item.floor, -1);
  assert.equal(item.advertisedRoomV1, '지하1층 B03호'); assert.equal(item.room, '지하3층');
  browser.doneOnly = true; api.attach([item]);
  assert.equal(item.floor, -1, 'the ended-only view cannot replace active floor evidence');
  ads[1].sourceUnavailable = true; api.attach([item]);
  assert.equal(item.floor, 2, 'an ended representative falls back to a living source');
  ads[0].floor = ''; ads[0].room = 'B03호'; api.attach([item]);
  assert.equal(item.floor, ''); assert.equal(item.sourceFloorVerifiedV1, true);
  assert.equal(item.advertisedRoomV1, 'B03호'); assert.equal(item.room, '지하3층');
  ads[0].sourceUnavailable = true; api.attach([item]);
  assert.equal(item.floor, -3); assert.equal(item.sourceFloorVerifiedV1, undefined);
  assert.equal(item.advertisedRoomV1, undefined); assert.equal(item.room, '지하3층');
});

test('attach never overlays sale floors or legacy originals lacking explicit floor metadata', () => {
  const browser = frontend(), api = browser.JSUnifiedListingsV8;
  const sale = { propertyId: 'sale', tradeType: 'sale', room: '전체', floor: 7 };
  const legacy = { propertyId: 'legacy', tradeType: 'lease', room: '1층' };
  api.attach([sale, legacy], { ok: true, groups: {
    sale: [{ source: '공실박스', tradeType: 'sale', room: '3층', floor: 3 }],
    legacy: [{ source: '네이버', room: '2층' }]
  } });
  assert.equal(sale.floor, 7); assert.equal(sale.room, '전체');
  assert.equal(sale.sourceFloorVerifiedV1, undefined); assert.equal(sale.advertisedRoomV1, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'floor'), false);
  assert.equal(legacy.sourceFloorVerifiedV1, undefined); assert.equal(legacy.room, '1층');
});

test('hideDone removes ended originals only; toggling or detail cache cannot delete live siblings', async t => {
  const f = fixture(t); f.master('M'); for (let i = 0; i < 10; i++) f.source('ad-' + i, 'M', i < 9 ? 1 : 0);
  f.master('all-ended'); f.source('ended-a', 'all-ended', 0); f.source('ended-b', 'all-ended', 0);
  const apiResult = await f.get('unifiedListings');
  const browser = frontend(apiResult), api = browser.JSUnifiedListingsV8;
  await api.load();
  const items = [{ propertyId: 'M', state: '' }, { propertyId: 'all-ended', state: '' }]; browser.allItems = items;
  api.attach(items);
  assert.equal(api.allOriginals('M').length, 10); assert.equal(api.visibleOriginals('M').length, 9);
  assert.equal(items[0].unifiedActiveOriginalCountV1, 9); assert.equal(items[0].unifiedEndedOriginalCountV1, 1);
  assert.equal(items[0].sourceAllUnavailableV1, false); assert.equal(items[1].sourceAllUnavailableV1, true);
  assert.equal(api.visibleOriginals('all-ended').length, 0);
  browser.hideDone = false; api.refreshOriginalVisibility(items);
  assert.equal(api.visibleOriginals('M').length, 10); assert.equal(api.visibleOriginals('all-ended').length, 2);
  assert.match(api.cardParts(items[1]).badge, /원본 광고 미노출 · 거래완료 후보/);
  browser.doneOnly = true; api.refreshOriginalVisibility(items);
  assert.equal(api.visibleOriginals('M').length, 1);
  items[0].state = '계약완료'; api.refreshOriginalVisibility(items);
  assert.equal(api.visibleOriginals('M').length, 10);
  browser.doneOnly = false; browser.hideDone = true; api.refreshOriginalVisibility(items);
  assert.equal(api.visibleOriginals('M').length, 9); assert.equal(api.allOriginals('M').length, 10);
});

test('integrated candidate UI keeps archived links without treating an old ad as proof of a completed contract', () => {
  const source = fs.readFileSync('js/operations-center-v7.js', 'utf8');
  assert.match(source, /연결 원본/); assert.match(source, /거래확인 후보 · 통합매물 기준/);
  assert.match(source, /이 후보 광고 원본 링크/);
  assert.match(source, /window\.openTransactionCandidateSourceV1 = function/);
  const compatibility = source.match(/window\.completeTransactionCandidateV1 = function\(\) \{([^]*?)\n\s{2}};/)[1];
  assert.doesNotMatch(compatibility, /apiPost|toggleDone|loadSheet/);
  assert.match(compatibility, /실제 계약완료와 별도/);
});
