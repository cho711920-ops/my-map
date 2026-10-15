import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleD1GetAction } from '../cloudflare/src/d1-api.js';
import { newListingPeriod, REGISTRATION_DAY_SQL, koreanCalendarDay } from '../cloudflare/src/new-listing-period.js';
import worker from '../cloudflare/src/worker.js';
import { createSessionToken, SESSION_COOKIE } from '../cloudflare/src/security.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../cloudflare/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL('../cloudflare/migrations/' + name, import.meta.url), 'utf8'));
  }
  const queries = [];
  const env = { DB: { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; }, async first() {
      queries.push({ sql, bindings: values.length });
      return db.prepare(sql).get(...values) || null;
    }, async all() {
      queries.push({ sql, bindings: values.length });
      return { results: db.prepare(sql).all(...values) };
    }};
  }}};
  function listing(id, day, patch = {}) {
    const row = { property_id: id, first_collected_at: day, address: '서구 테스트동 1-1', trade_type: 'lease', status: 'active', ...patch };
    const fields = ['id', ...Object.keys(row)];
    db.prepare(`INSERT INTO listings (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(id, ...Object.values(row));
  }
  function source(id, listingId, active = 1, missing = 0, patch = {}) {
    const original = { source: '네이버', originalId: id, thumbnail: 'https://landthumb-phinf.pstatic.net/fixture.jpg', tradeType: 'lease', revision: 1 };
    const first = patch.first_collected_at ?? db.prepare('SELECT first_collected_at FROM listings WHERE id=?').get(listingId).first_collected_at;
    db.prepare(`INSERT INTO listing_sources (id,listing_id,source,source_listing_id,list_snapshot_json,active,missing_count,first_collected_at,last_collected_at,trade_type) VALUES (?,?,'네이버',?,?,?,?,?,?,?)`)
      .run(id, listingId, id, JSON.stringify(original), active, missing, first, patch.last_collected_at || first, patch.trade_type || 'lease');
    if (!active) db.prepare("INSERT INTO listing_source_availability(source_id,kind) VALUES (?,'census_missing')").run(id);
  }
  return { db, env, queries, listing, source, originals: () => handleD1GetAction(env, {}, { action: 'unifiedListings' }) };
}

test('Today API uses KST timestamps, legacy calendar dates and an expression index', async () => {
  const h = fixture();
  h.listing('utc-morning', '2026-10-12T23:40:00Z');
  h.listing('utc-last', '2026-10-13T14:59:59Z');
  h.listing('utc-next', '2026-10-13T15:00:00Z');
  h.listing('legacy-evening', '2026-10-13 23:30');
  h.listing('legacy-short', '26.10.13');
  h.listing('yesterday', '2026-10-12 23:59');
  h.listing('bad', 'not a date');
  const result = await newListingPeriod(h.env, { days: '1', market: 'lease' }, h.originals, new Date('2026-10-13T09:00:00Z'));
  assert.deepEqual(result.items.map(row => row.id), ['legacy-evening', 'legacy-short', 'utc-last', 'utc-morning']);
  assert.equal(result.day, '2026-10-13');
  assert.equal(result.rangeStart, '2026-10-12T15:00:00.000Z');
  assert.equal(result.rangeEnd, '2026-10-13T15:00:00.000Z');
  const plan = h.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM listings WHERE (${REGISTRATION_DAY_SQL})=? AND trade_type=? AND status<>'deleted' AND id>? ORDER BY id LIMIT 76`)
    .all('2026-10-13', 'lease', '');
  assert.match(JSON.stringify(plan), /idx_listings_registration_day_market_id/);
  h.db.close();
});

test('Today includes only active new ads and explicitly remaps source proof metadata to public parents', async () => {
  const h = fixture();
  const today = koreanCalendarDay();
  h.listing('new', today + ' 12:00'); h.listing('empty', today + ' 12:00');
  h.listing('unavailable', today + ' 12:00'); h.listing('outside', '2025-01-01');
  h.listing('legacy-pk', today + ' 12:00', { property_id: 'legacy-public' });
  h.source('12345', 'new'); h.source('s-outside', 'outside'); h.source('s-empty', 'empty', 0, 1); h.source('s-unavailable', 'unavailable', 0, 3);
  h.source('legacy-source', 'legacy-pk');
  const before = h.db.prepare('SELECT total_changes() AS n').get().n;
  const result = await handleD1GetAction(h.env, {}, { action: 'newListingPeriod', days: '1', market: 'lease' });
  assert.deepEqual(Object.keys(result.unified.groups).sort(), ['legacy-public', 'new']);
  assert.equal(result.unified.groups.new.length, 1);
  assert.equal(result.unified.groups['legacy-public'][0][result.unified.fields.indexOf('sourceUnavailable')], false);
  assert.equal(result.todayAdCount, 2);
  assert.deepEqual(result.todayOriginalIds, { 'legacy-public': ['legacy-source'], new: ['12345'] });
  assert.equal(result.unified.sourceSnapshotPropertyIds['legacy-public'], 'legacy-public');
  assert.equal(result.unified.sourceSnapshotKeys['legacy-public'], result.items.find(row => row.property_id === 'legacy-public').source_snapshot_key);
  assert.deepEqual(result.unified.sourceSearchIds.new, ['n:12345']);
  assert.doesNotMatch(JSON.stringify(result), /outside|s-outside/);
  assert.equal(h.db.prepare('SELECT total_changes() AS n').get().n, before);
  for (const query of h.queries) assert.ok(query.bindings <= 100);
  h.db.close();
});

test('Today preserves market separation, publication holds and deleted exclusions', async () => {
  const h = fixture();
  const day = '2026-10-13';
  h.listing('lease', day); h.listing('held', day); h.listing('deleted', day, { status: 'deleted' });
  h.listing('building', day, { trade_type: 'sale', sale_category: 'house' }); h.listing('land', day, { trade_type: 'sale', sale_category: 'land' });
  h.db.prepare("INSERT INTO listing_data_quality_holds (listing_id,issue_code,state,blocks_publication) VALUES ('held','fixture','open',1)").run();
  for (const market of ['lease', 'building', 'land']) {
    const result = await newListingPeriod(h.env, { market }, h.originals, new Date('2026-10-13T09:00:00Z'));
    assert.deepEqual(result.items.map(row => row.id), [market]);
  }
  h.db.close();
});

test('paging does not cap totals and pins the Korean calendar day across midnight', async () => {
  const h = fixture();
  for (let i = 0; i < 161; i++) h.listing('M-' + String(i).padStart(3, '0'), '2026-10-13T09:00:00Z');
  const originals = h.originals;
  const first = await newListingPeriod(h.env, { market: 'lease' }, originals, new Date('2026-10-13T14:59:59Z'));
  const second = await newListingPeriod(h.env, { market: 'lease', cursor: first.nextCursor }, originals, new Date('2026-10-13T15:00:01Z'));
  const third = await newListingPeriod(h.env, { market: 'lease', cursor: second.nextCursor }, originals, new Date('2026-10-13T15:00:02Z'));
  const all = [...first.items, ...second.items, ...third.items];
  assert.equal(all.length, 161); assert.equal(new Set(all.map(row => row.id)).size, 161);
  assert.equal(second.day, first.day); assert.equal(third.hasMore, false); assert.equal(third.nextCursor, '');
  h.db.close();
});

test('empty Today reads never request complete sources; bad cursors and ranges fail visibly', async () => {
  const h = fixture();
  const empty = await handleD1GetAction(h.env, {}, { action: 'newListingPeriod', market: 'lease' });
  assert.equal(empty.items.length, 0); assert.equal(h.queries.length, 1);
  for (const query of [{ days: '15' }, { market: 'all' }, { cursor: 'badcursor' }, { cursor: btoa(JSON.stringify({ v: 1, day: '2026-10-13', market: 'land', id: 'M-1' })) }]) {
    await assert.rejects(() => newListingPeriod(h.env, query, async () => ({}), new Date('2026-10-13T09:00:00Z')), error => error.statusCode === 400);
  }
  h.db.close();
});

test('the real Worker authenticates and proves Today pages without pinning unrelated global revisions', async () => {
  const h = fixture(), email = 'today-worker@example.invalid';
  h.listing('fresh-http', koreanCalendarDay() + ' 12:00');
  h.source('fresh-source', 'fresh-http');
  h.db.prepare("INSERT INTO allowed_users(email,role,active) VALUES (?,'owner',1)").run(email);
  let revisionReads = 0, changeDuringRead = false, writes = 0;
  Object.assign(h.env, { ALLOWED_EMAILS: email, SESSION_SECRET: 'today-local-worker-test-secret-at-least-32-characters',
    MEDIA: {
      async get(key) {
        assert.equal(key, 'api-cache/revision/listings.json');
        revisionReads += 1;
        const revision = changeDuringRead && revisionReads % 2 === 0 ? 'r2' : 'r1';
        return { customMetadata: { savedAt: String(Date.now()) }, text: async () => JSON.stringify({ revision }) };
      }, async put() { writes += 1; }
    } });
  const url = 'https://js-map.com/api/data?action=newListingPeriod&days=1&market=lease';
  const denied = await worker.fetch(new Request(url), h.env, {});
  assert.equal(denied.status, 401); assert.equal(revisionReads, 0);
  const token = await createSessionToken({ email, role: 'owner', name: 'Local fixture' }, h.env);
  const request = suffix => new Request(url + suffix, { headers: { Cookie: SESSION_COOKIE + '=' + token } });
  const beforeWrites = h.db.prepare('SELECT total_changes() AS n').get().n;
  const successful = await worker.fetch(request(''), h.env, {});
  assert.equal(successful.status, 200); assert.equal(successful.headers.get('cache-control'), 'private, no-store');
  const body = await successful.json(); assert.equal(body.items.length, 1);
  assert.equal(body.snapshotRevision, 'r1'); assert.equal(body.unified.snapshotRevision, 'r1');
  assert.equal(body.snapshotConsistency, 'per-property-v1');
  assert.equal(body.unified.snapshotConsistency, 'per-property-v1');
  const old = await worker.fetch(request('&revision=old'), h.env, {});
  assert.equal(old.status, 200); assert.equal((await old.json()).items.length, 1);
  revisionReads = 0; changeDuringRead = true;
  const changed = await worker.fetch(request(''), h.env, {});
  assert.equal(changed.status, 200); const changedBody = await changed.json();
  assert.equal(changedBody.snapshotRevision, 'r1'); assert.equal(revisionReads, 1);
  const nextRevision = await worker.fetch(request('&revision=r1'), h.env, {});
  assert.equal(nextRevision.status, 200);
  assert.equal((await nextRevision.json()).snapshotRevision, 'r2'); assert.equal(revisionReads, 2);
  assert.equal(h.db.prepare('SELECT total_changes() AS n').get().n, beforeWrites); assert.equal(writes, 0);

  // An actual source change between item and source reads is different: never
  // accept mismatched metadata or expose a partial list as a verified result.
  const prepare = h.env.DB.prepare;
  let changingPages = 0;
  h.env.DB.prepare = sql => {
    const statement = prepare(sql), all = statement.all;
    if (sql.startsWith('WITH today_parents')) statement.all = async function() {
      const rows = await all.call(this); changingPages += 1;
      h.db.prepare("UPDATE listing_sources SET snapshot_hash=? WHERE id='fresh-source'").run('changed-' + changingPages);
      return rows;
    };
    return statement;
  };
  const mismatched = await worker.fetch(request(''), h.env, {});
  assert.equal(mismatched.status, 409); const mismatchedBody = await mismatched.json();
  assert.equal(mismatchedBody.snapshotChanged, true); assert.equal(mismatchedBody.retryScope, 'page');
  assert.equal(mismatchedBody.items, undefined); assert.equal(changingPages, 3); assert.equal(writes, 0);
  h.db.close();
});

test('Today includes a new source on an old parent but not old ads with new publication, last-seen or reappearance dates', async () => {
  const h = fixture(), now = new Date('2026-10-13T09:00:00Z');
  h.listing('existing-parent', '2024-01-01');
  h.listing('old-ad-new-parent', '2026-10-13');
  h.listing('reappeared', '2024-01-01');
  h.listing('manual', '2026-10-13');
  h.source('old-existing', 'existing-parent', 1, 0, { first_collected_at: '2024-01-01' });
  h.source('new-existing', 'existing-parent', 1, 0, { first_collected_at: '2026-10-12T15:00:00Z' });
  h.source('new-second', 'existing-parent', 1, 0, { first_collected_at: '2026-10-13T14:59:59Z' });
  h.source('publication-only', 'old-ad-new-parent', 1, 0, { first_collected_at: '2024-01-01', last_collected_at: '2026-10-13T09:00:00Z' });
  h.source('same-reappeared', 'reappeared', 1, 0, { first_collected_at: '2024-01-01', last_collected_at: '2026-10-13T09:00:00Z' });
  const result = await newListingPeriod(h.env, { market: 'lease' }, h.originals, now);
  assert.deepEqual(result.items.map(row => row.id), ['existing-parent','manual']);
  assert.equal(result.items[0].first_collected_at,'2024-01-01','Do not rewrite the parent registration history');
  assert.deepEqual(result.todayOriginalIds, { 'existing-parent':['new-existing','new-second'],manual:[] });
  assert.equal(result.todayAdCount,2);assert.equal(result.todayManualCount,1);
  assert.equal(result.unified.groups['existing-parent'].length,3,'Keep the whole original group outside the Today-only projection');
  const plan=h.db.prepare(`EXPLAIN QUERY PLAN SELECT listing_id FROM listing_sources
    WHERE active=1 AND (${REGISTRATION_DAY_SQL})=? AND trade_type=?`).all('2026-10-13','lease');
  assert.match(JSON.stringify(plan),/idx_listing_sources_registration_day_trade_parent/);
  h.db.close();
});

test('inactive today ads and the next KST day are excluded while boundary ads use their source-first day', async () => {
  const h=fixture(),now=new Date('2026-10-13T09:00:00Z');
  for(const id of ['start','before','next','inactive'])h.listing(id,'2024-01-01');
  h.source('start-ad','start',1,0,{first_collected_at:'2026-10-12T15:00:00Z'});
  h.source('before-ad','before',1,0,{first_collected_at:'2026-10-12T14:59:59Z'});
  h.source('next-ad','next',1,0,{first_collected_at:'2026-10-13T15:00:00Z'});
  h.source('inactive-ad','inactive',0,1,{first_collected_at:'2026-10-13T03:00:00Z'});
  const result=await newListingPeriod(h.env,{market:'lease'},h.originals,now);
  assert.deepEqual(result.items.map(row=>row.id),['start']);
  assert.deepEqual(result.todayOriginalIds.start,['start-ad']);
  h.db.close();
});

test('a changed source proof is returned as retryable uncertainty, never as an authoritative partial Today list', async()=>{
  const h=fixture();h.listing('A','2026-10-13');
  const result=await newListingPeriod(h.env,{market:'lease'},async()=>{
    const payload=await h.originals();payload.sourceSnapshotKeys.A='sha256-v1:'+'0'.repeat(64);return payload;
  },new Date('2026-10-13T09:00:00Z'));
  assert.equal(result.ok,false);assert.equal(result.snapshotChanged,true);
  assert.equal(result.items,undefined);assert.equal(result.todayOriginalIds,undefined);
  h.db.close();
});
