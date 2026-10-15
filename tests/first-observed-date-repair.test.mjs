import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {buildFirstObservedRepairPlan} from '../tools/repair-first-observed-dates.mjs';

const now='2026-10-15T06:00:00.000Z',old='2026-10-09T02:00:00.000Z',today='2026-10-15T03:00:00.000Z';
function fixture() {
  return {candidateSourceIds:['S'],listings:[{id:'M',property_id:'P',first_collected_at:today,registration_at:today}],
    sources:[{id:'S',listing_id:'M',source:'네이버',source_listing_id:'네이버-123::lease',trade_type:'lease',first_collected_at:today,created_at:today}],
    raw:[{id:'R',source:'네이버',source_listing_id:'123',trade_type:'lease',processing_state:'processed',created_at:old,
      payload_json:JSON.stringify({source:'네이버',sourceId:'네이버-123',tradeType:'lease',address:'서구 갈마동 123-1',deposit:1000,rent:50})}]};
}
function dbFor(dataset) {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE listings(id TEXT PRIMARY KEY,first_collected_at TEXT,registration_at TEXT,version INTEGER DEFAULT 1,updated_at TEXT,memo TEXT,room TEXT,status TEXT);
    CREATE TABLE listing_sources(id TEXT PRIMARY KEY,listing_id TEXT,trade_type TEXT,first_collected_at TEXT,active INTEGER DEFAULT 1);
    CREATE TABLE listing_history(listing_id TEXT,action TEXT,actor_email TEXT,before_json TEXT,after_json TEXT);`);
  for(const row of dataset.listings) db.prepare('INSERT INTO listings(id,first_collected_at,registration_at,memo,room,status) VALUES (?,?,?,\'보존 메모\',\'101호\',\'계약완료\')').run(row.id,row.first_collected_at,row.registration_at);
  for(const row of dataset.sources) db.prepare('INSERT INTO listing_sources(id,listing_id,trade_type,first_collected_at) VALUES (?,?,?,?)').run(row.id,row.listing_id,row.trade_type,row.first_collected_at);
  return db;
}

test('repair restores the first verified observation and keeps publication time distinct',()=>{
  const data=fixture(),plan=buildFirstObservedRepairPlan(data,{now});
  assert.equal(plan.sourceChanges.length,1);assert.equal(plan.sourceChanges[0].after,old);
  assert.equal(plan.masterChanges[0].after.first_collected_at,old);
  assert.equal(plan.masterChanges[0].after.registration_at,old);
  assert.equal(data.sources[0].created_at,today);
  assert.deepEqual(plan.sourceChanges[0].rawEvidenceIds,['R']);
  assert.doesNotMatch(plan.forwardSql,/\bDELETE\b|UPDATE (?:cloud_state|listing_media|listing_contacts)|SET (?:memo|room|status|active)=/i);
});

test('forward and rollback preserve manual state, room, memo and current version increments',()=>{
  const data=fixture(),plan=buildFirstObservedRepairPlan(data,{now}),db=dbFor(data);
  try {
    db.exec(plan.forwardSql);
    let row=db.prepare('SELECT * FROM listings').get();
    assert.equal(row.first_collected_at,old);assert.equal(row.memo,'보존 메모');assert.equal(row.status,'계약완료');assert.equal(row.room,'101호');assert.equal(row.version,2);
    db.exec("UPDATE listings SET memo='보정 후 편집',version=version+1");
    db.exec(plan.rollbackSql);
    row=db.prepare('SELECT * FROM listings').get();
    assert.equal(row.first_collected_at,today);assert.equal(row.memo,'보정 후 편집');assert.equal(row.version,4);
    assert.equal(db.prepare('SELECT active FROM listing_sources').get().active,1);
    assert.ok(row.updated_at>=today,'rollback may not move the modification time backward');
  } finally {db.close();}
});

test('preview-time and later manual-edit timestamps never regress in forward or rollback',()=>{
  const data=fixture(),plan=buildFirstObservedRepairPlan(data,{now}),db=dbFor(data);
  try {
    const future='2099-01-01T01:00:00.000Z';
    db.prepare('UPDATE listings SET updated_at=?').run(future);
    db.exec(plan.forwardSql);assert.equal(db.prepare('SELECT updated_at FROM listings').get().updated_at,future);
    db.exec(plan.rollbackSql);assert.equal(db.prepare('SELECT updated_at FROM listings').get().updated_at,future);
  } finally {db.close();}
});

test('an independently selected registration date is not overwritten',()=>{
  const data=fixture();data.listings[0].registration_at='2026-10-10T04:00:00.000Z';
  const plan=buildFirstObservedRepairPlan(data,{now});
  assert.equal(plan.masterChanges[0].after.first_collected_at,old);
  assert.equal(plan.masterChanges[0].after.registration_at,data.listings[0].registration_at);
});

test('invalid or opposite-market historical raw never moves a date backward',()=>{
  for(const update of [{processing_state:'error'},{error_text:'failed'},{trade_type:'sale'},{created_at:'2027-01-01T00:00:00Z'},
    {payload_json:'{}'}]) {
    const data=fixture();Object.assign(data.raw[0],update);
    assert.equal(buildFirstObservedRepairPlan(data,{now}).sourceChanges.length,0,JSON.stringify(update));
  }
});

test('a changed source date aborts the whole guarded transaction instead of undoing a concurrent repair',()=>{
  const data=fixture(),plan=buildFirstObservedRepairPlan(data,{now}),db=dbFor(data);
  try {
    db.exec("UPDATE listing_sources SET first_collected_at='2026-10-08T01:00:00Z'");
    db.exec('BEGIN');
    assert.throws(()=>db.exec(plan.forwardSql),/CHECK constraint failed/);
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT first_collected_at FROM listings').get().first_collected_at,today);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM listing_history').get().n,0);
  } finally {db.close();}
});

test('an unexpectedly earlier sibling aborts the preview but a newer advertisement may continue collecting',()=>{
  for(const date of ['2026-10-01T00:00:00.000Z','2026-10-15T05:00:00.000Z']) {
    const data=fixture(),plan=buildFirstObservedRepairPlan(data,{now}),db=dbFor(data);
    try {
      db.prepare("INSERT INTO listing_sources(id,listing_id,trade_type,first_collected_at) VALUES ('NEW','M','lease',?)").run(date);
      db.exec('BEGIN');
      if(date<old) {assert.throws(()=>db.exec(plan.forwardSql),/CHECK constraint failed/);db.exec('ROLLBACK');}
      else {db.exec(plan.forwardSql);db.exec('COMMIT');assert.equal(db.prepare('SELECT first_collected_at FROM listings').get().first_collected_at,old);}
    } finally {db.close();}
  }
});

test('rollback cannot ignore a newly observed older advertisement that was not in the original evidence',()=>{
  const data=fixture(),plan=buildFirstObservedRepairPlan(data,{now}),db=dbFor(data);
  try {
    db.exec(plan.forwardSql);
    db.prepare("INSERT INTO listing_sources(id,listing_id,trade_type,first_collected_at) VALUES ('NEW','M','lease',?)").run('2026-10-10T05:00:00.000Z');
    db.exec('BEGIN');assert.throws(()=>db.exec(plan.rollbackSql),/CHECK constraint failed/);db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT first_collected_at FROM listings').get().first_collected_at,old);
  } finally {db.close();}
});
