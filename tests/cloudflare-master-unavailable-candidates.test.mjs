import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleD1GetAction, refreshOperationsDashboard, adjustOperationsDashboard } from '../cloudflare/src/d1-api.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync('cloudflare/migrations').filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync('cloudflare/migrations/' + name, 'utf8'));
  }
  t.after(() => db.close());
  const env = { DB: { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; }
    };
  } } };
  const master = (id, status = 'active', market = 'lease', publicId = 'public-' + id) => {
    db.prepare(`INSERT INTO listings(id,property_id,status,title,address,room,trade_type,operating_memo,source_url)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, publicId, status, '보존할 매물', '서구 검수동 1', '직접 수정한 호실', market,
      '보존할 메모', 'https://example.test/saved/' + id);
  };
  const source = (id, parent, active, missing = active ? 0 : 3, market = 'lease', kind = 'census_missing') => {
    const snapshot = { originalId: id, source: '네이버', room: '다른 원본 호실', tradeType: market };
    db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,missing_count,trade_type,list_snapshot_json)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, parent, '네이버', id, active, missing, market, JSON.stringify(snapshot));
    if (!active && kind) db.prepare('INSERT INTO listing_source_availability(source_id,kind) VALUES (?,?)').run(id, kind);
  };
  const hold = id => db.prepare(`INSERT INTO listing_data_quality_holds(listing_id,issue_code,state,blocks_publication)
    VALUES (?,'fixture','open',1)`).run(id);
  const candidates = () => handleD1GetAction(env, {}, { action: 'transactionCandidates' });
  return { db, env, master, source, hold, candidates };
}

test('candidate API and dashboard count distinct masters with candidate ads even with active siblings', async t => {
  const f = fixture(t);
  f.master('mixed'); f.source('mixed-live', 'mixed', 1);
  for (let i = 0; i < 9; i++) f.source('mixed-ended-' + i, 'mixed', 0);
  f.master('gone'); f.source('gone-1', 'gone', 0, 1); f.source('gone-3', 'gone', 0, 3);
  f.master('zero'); f.source('zero-0', 'zero', 0, 0);
  f.master('sale', 'active', 'sale'); f.source('sale-2', 'sale', 0, 2, 'sale'); f.source('sale-3', 'sale', 0, 3, 'sale');
  f.master('empty'); f.master('live'); f.source('live-ad', 'live', 1);
  f.master('held'); f.source('held-ad', 'held', 0); f.hold('held');
  f.master('deleted', 'deleted'); f.source('deleted-ad', 'deleted', 0);
  f.master('done', '계약완료'); f.source('done-ad', 'done', 0);
  f.master('done-held', '계약완료'); f.source('done-held-ad', 'done-held', 0); f.hold('done-held');
  const before = f.db.prepare('SELECT id,property_id,status,room,operating_memo FROM listings ORDER BY id').all();
  const rawBefore = f.db.prepare('SELECT id,active,missing_count,list_snapshot_json FROM listing_sources ORDER BY id').all();
  const result = await f.candidates(), dashboard = await refreshOperationsDashboard(f.env);
  assert.equal(result.count, 4); assert.equal(result.returnedCount, 4); assert.equal(result.hasMore, false);
  assert.deepEqual(result.candidates.map(row => row.propertyId).sort(), ['public-gone', 'public-mixed', 'public-sale', 'public-zero']);
  assert.equal(new Set(result.candidates.map(row => row.propertyId)).size, 4);
  assert.equal(result.candidateAdCount, 14);
  for (const row of result.candidates) {
    assert.equal(row.endedSourceCount, row.candidateOriginalCount);
    assert.equal(row.candidateKind, 'master-source-candidates'); assert.equal(row.sourceUnavailable, true);
    assert.equal(row.room, '직접 수정한 호실'); assert.equal(row.memo, '보존할 메모');
    assert.match(row.evidenceNotice, /실제 광고 삭제·거래완료 확인은 아닙니다/);
    assert.equal(Object.hasOwn(row, 'originalId'), false);
  }
  assert.equal(result.candidates.find(row => row.propertyId === 'public-zero').missingCount, 0);
  for (const value of [result, dashboard]) {
    assert.equal(value.totalUnavailable, 4); assert.equal(value.manualCompleted, 1);
    assert.equal(value.completedOnlyTotal, 5); assert.equal(value.advertisementPolicyVersion, 3);
  }
  assert.equal(dashboard.transactionCheckCandidates, result.count);
  assert.deepEqual(f.db.prepare('SELECT id,property_id,status,room,operating_memo FROM listings ORDER BY id').all(), before);
  assert.deepEqual(f.db.prepare('SELECT id,active,missing_count,list_snapshot_json FROM listing_sources ORDER BY id').all(), rawBefore);
  const detail = await handleD1GetAction(f.env, {}, { action: 'unifiedListingDetail', propertyId: 'public-gone' });
  assert.equal(detail.originals.length, 2, 'changing candidate units must not erase source history');
});

test('one returning source removes only itself from candidates, keeping its absent sibling', async t => {
  const f = fixture(t); f.master('M'); f.source('old', 'M', 0); f.source('returned', 'M', 0);
  assert.equal((await f.candidates()).count, 1);
  f.db.prepare("UPDATE listing_sources SET active=1,missing_count=0 WHERE id='returned'").run();
  const after = await f.candidates();
  assert.equal(after.count, 1); assert.equal(after.candidateAdCount, 1); assert.equal(after.candidates[0].activeSourceCount, 1);
  assert.equal((await refreshOperationsDashboard(f.env)).transactionCheckCandidates, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM listing_sources WHERE listing_id='M'").get().n, 2);
  assert.equal(f.db.prepare("SELECT status FROM listings WHERE id='M'").get().status, 'active');
});

test('fast snapshot adjustments refresh unavailable/manual totals without recounting history', async t => {
  const f = fixture(t); f.master('M'); f.source('old', 'M', 0);
  await refreshOperationsDashboard(f.env);
  f.db.prepare("UPDATE listings SET status='계약완료' WHERE id='M'").run();
  const statements = [];
  const env = { DB: { prepare(sql) { statements.push(sql); return f.env.DB.prepare(sql); } } };
  const result = await adjustOperationsDashboard(env, { history: 1 });
  assert.equal(result.transactionCheckCandidates, 0); assert.equal(result.totalUnavailable, 0);
  assert.equal(result.manualCompleted, 1); assert.equal(result.completedOnlyTotal, 1);
  assert.equal(result.advertisementPolicyVersion, 3); assert.equal(result.history, 1);
  assert.equal(statements.filter(sql => /SELECT/.test(sql)).length, 2);
  assert.ok(statements.every(sql => !/FROM listing_history/.test(sql)));
  assert.equal((await f.candidates()).manualCompleted, result.manualCompleted);
});

test('adjusting an old advertisement-count snapshot refreshes the authoritative policy instead of extending it', async t => {
  const f = fixture(t); f.master('M'); f.source('old-a', 'M', 0); f.source('old-b', 'M', 0);
  const now = new Date().toISOString();
  f.db.prepare(`INSERT INTO operations_snapshots(snapshot_key,payload_json,calculated_at,updated_at) VALUES ('main',?,?,?)`)
    .run(JSON.stringify({ advertisementPolicyVersion: 1, activeMaster: 999, transactionCheckCandidates: 53221 }), now, now);
  const result = await adjustOperationsDashboard(f.env, { activeMaster: 10, history: 99 });
  assert.equal(result.advertisementPolicyVersion, 3); assert.equal(result.activeMaster, 1);
  assert.equal(result.transactionCheckCandidates, 1); assert.equal(result.history, 0);
});

test('candidate total is not silently capped when the bounded list returns two thousand masters', async t => {
  const f = fixture(t);
  f.db.exec('BEGIN');
  for (let i = 0; i < 2001; i++) { f.master('M' + i); f.source('S' + i, 'M' + i, 0); }
  f.db.exec('COMMIT');
  const result = await f.candidates();
  assert.equal(result.count, 2001); assert.equal(result.returnedCount, 2000); assert.equal(result.hasMore, true);
  assert.equal(new Set(result.candidates.map(row => row.propertyId)).size, 2000);
  assert.equal((await refreshOperationsDashboard(f.env)).transactionCheckCandidates, 2001);
});
