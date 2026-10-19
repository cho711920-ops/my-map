import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { refreshListingRepresentativesFromActiveSources, chooseActiveRepresentative } from '../cloudflare/src/source-representative-selection.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync('cloudflare/migrations').filter(name => name.endsWith('.sql')).sort())
    db.exec(fs.readFileSync('cloudflare/migrations/' + name, 'utf8'));
  t.after(() => db.close());
  let beforeBatch = null;
  const sqls = [];
  const prepare = (sql, args = []) => {
    const indexes = [], compiled = sql.replace(/\?(\d+)/g, (_, index) => { indexes.push(Number(index) - 1); return '?'; });
    const values = () => indexes.length ? indexes.map(index => args[index]) : args;
    return { bind: (...args) => prepare(sql, args), async all() {
      sqls.push(sql); return { results: db.prepare(compiled).all(...values()) };
    }, async first() { sqls.push(sql); return db.prepare(compiled).get(...values()); }, async run() {
      sqls.push(sql); return { meta: { changes: Number(db.prepare(compiled).run(...values()).changes) } };
    } };
  };
  const env = { DB: { prepare, async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook(); }
    db.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run());
      db.exec('COMMIT'); return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } } };
  const master = (id, patch = {}) => {
    const row = { property_id: id, title: '기존 제목', building_name: '기존 제목', address: '서구 테스트동 1-1',
      room: '1층', deposit: 1000, monthly_rent: 100, maintenance_fee: 5, premium: 0, area_m2: 30,
      main_source: '네이버', source_url: 'https://example.test/old', status: 'active',
      operating_memo: '사용자 메모/찜 관계 보존', trade_type: 'lease', ...patch };
    const fields = ['id', ...Object.keys(row)];
    db.prepare(`INSERT INTO listings (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(id, ...Object.values(row));
  };
  const source = (id, parent, sourceName, active = 1, snapshot = {}, patch = {}) => {
    const row = { listing_id: parent, source: sourceName, source_listing_id: id, active, trade_type: 'lease',
      source_url: 'https://example.test/' + id, updated_at: '2026-10-14T02:00:00Z', last_collected_at: '2026-10-14T02:00:00Z',
      list_snapshot_json: JSON.stringify({ buildingName: id + ' 제목', room: '2층', deposit: 2000, rent: 80,
        fee: 10, premium: 0, area: 40, ...snapshot }), ...patch };
    const fields = ['id', ...Object.keys(row)];
    db.prepare(`INSERT INTO listing_sources (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(id, ...Object.values(row));
  };
  return { db, env, sqls, master, source, row: id => ({ ...db.prepare('SELECT * FROM listings WHERE id=?').get(id) }),
    beforeBatch: hook => { beforeBatch = hook; }, run: ids => refreshListingRepresentativesFromActiveSources(env, ids) };
}

test('active existing URL stays representative even when a higher-priority source exists', async t => {
  const f = fixture(t); f.master('M'); f.source('old', 'M', '네이버'); f.source('new', 'M', '당근');
  const result = await f.run(['M']); assert.deepEqual(result.changedListingIds, ['M']);
  assert.equal(f.row('M').source_url, 'https://example.test/old'); assert.equal(f.row('M').main_source, '네이버');
  assert.equal(f.row('M').monthly_rent, 80);
});

test('ended representative is replaced by a surviving source, preserving ID, memo and manual contract state', async t => {
  const f = fixture(t); f.master('M', { status: '계약완료' }); f.source('old', 'M', '네이버', 0);
  f.source('new', 'M', '당근', 1, { rent: 70 });
  const before = f.row('M'), result = await f.run(['M']), after = f.row('M');
  assert.deepEqual(result.changedListingIds, ['M']); assert.equal(after.source_url, 'https://example.test/new');
  assert.equal(after.main_source, '당근'); assert.equal(after.monthly_rent, 70);
  for (const key of ['id','property_id','operating_memo','status','address']) assert.equal(after[key], before[key]);
});

test('only fields actually edited by a user are protected, not the entire representative', async t => {
  const f = fixture(t); f.master('M', { room: '지하1층 B03호', deposit: 5000, title: '사용자명', building_name: '사용자명' });
  f.source('new', 'M', '공실박스', 1, { rent: 90, fee: null }, { raw_json: JSON.stringify({ list: { Ff: 2, Ho: '201' } }) });
  f.db.prepare(`INSERT INTO listing_history (listing_id,action,before_json,after_json) VALUES (?,?,?,?)`)
    .run('M','updateProperty',JSON.stringify({ room: '1층', deposit: 1000, title: '기존명', monthly_rent: 100 }),
      JSON.stringify({ room: '지하1층 B03호', deposit: 5000, title: '사용자명', monthly_rent: 100 }));
  await f.run(['M']); const after = f.row('M');
  assert.equal(after.room, '지하1층 B03호'); assert.equal(after.deposit, 5000); assert.equal(after.title, '사용자명');
  assert.equal(after.building_name, '사용자명'); assert.equal(after.monthly_rent, 90); assert.equal(after.maintenance_fee, null);
});

test('no surviving source leaves master values untouched and does not invent a completed state', async t => {
  const f = fixture(t); f.master('M'); f.source('old', 'M', '네이버', 0); const before = f.row('M');
  const result = await f.run(['M']); assert.deepEqual(result.unchangedListingIds, ['M']); assert.deepEqual(f.row('M'), before);
});

test('representative selection isolates markets and orders source priority then latest observation', () => {
  const make = (id, source, trade_type = 'lease', last_collected_at = '2026-10-14T02:00:00Z') =>
    ({ id, source, trade_type, active: 1, source_url: id, last_collected_at });
  const candidates = [make('wrong-market','당근','sale'), make('older','네이버'), make('newer','네이버','lease','2026-10-14T03:00:00Z'), make('g','공실박스')];
  assert.equal(chooseActiveRepresentative({trade_type:'lease'}, candidates).id, 'newer');
});

test('a concurrent user edit or source deactivation prevents stale representative updates', async t => {
  for (const mutation of ['user', 'source']) {
    const f = fixture(t); f.master(mutation); f.source('new-' + mutation, mutation, '당근');
    f.beforeBatch(() => mutation === 'user'
      ? f.db.prepare('UPDATE listings SET monthly_rent=333, version=version+1 WHERE id=?').run(mutation)
      : f.db.prepare('UPDATE listing_sources SET active=0 WHERE listing_id=?').run(mutation));
    const result = await f.run([mutation]); assert.deepEqual(result.conflictListingIds, [mutation]);
    assert.equal(f.row(mutation).monthly_rent, mutation === 'user' ? 333 : 100);
  }
});

test('late reappearance of the previous representative blocks a now-obsolete replacement', async t => {
  const f = fixture(t); f.master('M'); f.source('old','M','네이버',0); f.source('new','M','당근');
  f.beforeBatch(() => f.db.prepare("UPDATE listing_sources SET active=1 WHERE id='old'").run());
  const result = await f.run(['M']); assert.deepEqual(result.conflictListingIds, ['M']);
  assert.equal(f.row('M').source_url, 'https://example.test/old');
});

test('source observations changing after selection cannot overwrite representative fields', async t => {
  const f = fixture(t); f.master('M'); f.source('new','M','당근');
  f.beforeBatch(() => f.db.prepare("UPDATE listing_sources SET snapshot_hash='updated-concurrently' WHERE id='new'").run());
  const result = await f.run(['M']); assert.deepEqual(result.conflictListingIds, ['M']); assert.equal(f.row('M').monthly_rent, 100);
});

test('surviving sale metadata updates the existing master columns used by CSV/delta reads', async t => {
  const f = fixture(t); f.master('M', { trade_type: 'sale', listing_type: '기타', sale_category: 'other',
    sale_details_json: JSON.stringify({ landAreaM2: 10 }) });
  f.source('new', 'M', '당근', 1, { tradeType: 'sale', type: '상가건물', saleCategory: 'building',
    salePrice: 90000, saleDetails: { landAreaM2: 200, grossAreaM2: 500 } }, { trade_type: 'sale' });
  await f.run(['M']); const after = f.row('M');
  assert.equal(after.listing_type, '상가건물'); assert.equal(after.sale_category, 'building');
  assert.deepEqual(JSON.parse(after.sale_details_json), { landAreaM2: 200, grossAreaM2: 500 });
});

test('manual sale fields survive collection while other source sale information remains fresh',async t=>{
  const f=fixture(t),saved={scope:'whole_building',monthlyIncome:370,loanAmount:null,landAreaM2:160,manualSaleFieldsV1:['monthlyIncome','loanAmount']};
  f.master('M',{trade_type:'sale',sale_category:'building',sale_price:98000,sale_details_json:JSON.stringify(saved)});
  f.source('new','M','당근',1,{tradeType:'sale',salePrice:99500,saleCategory:'building',saleDetails:{monthlyIncome:350,loanAmount:20000,landAreaM2:170,grossAreaM2:500,descriptionText:'새 원본 설명'}},{trade_type:'sale'});
  f.db.prepare("INSERT INTO listing_history(listing_id,action,before_json,after_json) VALUES('M','updateProperty',?,?)").run(JSON.stringify({sale_price:99500,sale_details_json:'{}'}),JSON.stringify({sale_price:98000,sale_details_json:JSON.stringify(saved)}));
  const original=f.db.prepare('SELECT * FROM listing_sources').all();await f.run(['M']);const after=f.row('M'),d=JSON.parse(after.sale_details_json);
  assert.equal(after.sale_price,98000);assert.equal(d.monthlyIncome,370);assert.equal(d.loanAmount,null);assert.equal(d.landAreaM2,170);assert.equal(d.grossAreaM2,500);assert.equal(d.descriptionText,'새 원본 설명');assert.deepEqual(f.db.prepare('SELECT * FROM listing_sources').all(),original);
});

test('same-label Naver code keeps the old favorite key while real type changes may refresh', async t => {
  const f = fixture(t); f.master('M', { listing_type: 'D02' });
  f.source('new','M','네이버',1,{ type: '상가점포' });
  await f.run(['M']); assert.equal(f.row('M').listing_type, 'D02');
  f.db.prepare("UPDATE listing_sources SET list_snapshot_json=json_set(list_snapshot_json,'$.type','사무실') WHERE id='new'").run();
  await f.run(['M']); assert.equal(f.row('M').listing_type, '사무실');
});
