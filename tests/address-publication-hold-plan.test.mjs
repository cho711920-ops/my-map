import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const plan = readFileSync(new URL('../tools/sql/hold-unresolved-naver-addresses-2026-10-01.sql', import.meta.url), 'utf8');
const targets = [
  ['M-dc75b2e0-c663-495c-bb4e-293c3a53d099', 'O-02b0a8f5-5372-48a9-ad6f-18e38b01ac28', '서구 탄방동 859-1', '지하1층', '2652436190', '2026-09-30T09:12:46.096Z'],
  ['M-b2c9b156-4dd0-48a4-857f-68f22cc82fb5', 'O-2ed2b4e4-5861-4f0d-ad1b-ebdf24b8d688', '서구 내동 17-5', '3층', '2647850512', '2026-09-30T09:17:35.128Z']
];
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../cloudflare/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../cloudflare/migrations/0019_listing_trade_foundation.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../cloudflare/migrations/0020_listing_data_quality_holds.sql', import.meta.url), 'utf8'));
  for (const [id, sid, address, room, article, at] of targets) {
    db.prepare(`INSERT INTO listings(id,address,room,trade_type,updated_at) VALUES(?,?,?,'sale',?)`).run(id,address,room,at);
    db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,list_snapshot_json,raw_json,updated_at)
      VALUES(?,?,'네이버',?,?,?,?)`).run(sid,id,`네이버-${article}::sale`,JSON.stringify({address}),
      JSON.stringify({jibunAddress:'대전시 '+address,latitude:'',longitude:''}),at);
  }
  db.prepare(`INSERT INTO listings(id,address) VALUES('unrelated','별도 매물')`).run();
  return db;
}
function apply(db) {
  db.exec('BEGIN');
  try { db.exec(plan); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
test('approved address hold plan affects only two holds and audit rows, preserving listings and sources', t => {
  const db = fixture(t);
  const before = ['listings','listing_sources','cloud_state','customer_matches'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
  apply(db);
  assert.deepEqual(['listings','listing_sources','cloud_state','customer_matches'].map(table => db.prepare(`SELECT * FROM ${table}`).all()),before);
  const holds = db.prepare('SELECT * FROM listing_data_quality_holds ORDER BY listing_id').all();
  assert.deepEqual(holds.map(row => row.listing_id),targets.map(row => row[0]).sort());
  for (const row of holds) {
    assert.equal(row.state,'open'); assert.equal(row.blocks_publication,1);
    assert.equal(row.issue_code,'address_lookup_unresolved');
    assert.equal(JSON.parse(row.evidence_json).userRequestedHold,true);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM listing_history').get().n,2);
  assert.throws(() => apply(db), /CHECK constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM listing_history').get().n,2);
});
test('address hold plan fails closed when either target address or coordinate has changed', t => {
  for (const sql of ["UPDATE listings SET latitude=36.35 WHERE id=?", "UPDATE listings SET address='수정된 주소' WHERE id=?",
    "UPDATE listing_sources SET raw_json=json_set(raw_json,'$.latitude',36.35) WHERE listing_id=?"]) {
    const db = fixture(t);
    db.prepare(sql).run(targets[0][0]);
    assert.throws(() => apply(db), /CHECK constraint failed/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM listing_data_quality_holds').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM listing_history').get().n,0);
  }
});
