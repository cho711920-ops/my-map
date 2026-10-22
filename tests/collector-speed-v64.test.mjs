import test from 'node:test';
import assert from 'node:assert/strict';
import {privateCollector,speedDatabase,speedAd} from './fixtures/collector-speed-v64.mjs';
import {resolveCollectorOfferIds} from '../cloudflare/src/collector-offer-identity.js';
import {resolveGongsilOfferIds} from '../cloudflare/src/gongsil-offers.js';
import {refreshListingRepresentativesFromActiveSources} from '../cloudflare/src/source-representative-selection.js';
const {ingestRecords,attachSource,normalizedRecord}=await privateCollector();

for (const provider of ['네이버','당근','공실박스']) for (const market of ['lease','sale']) {
  test(`${provider}/${market}: failed creation history rolls back the new master, source and assets together`, async t => {
    const f=speedDatabase(); t.after(()=>f.db.close());
    f.failWhen(sql=>/INSERT INTO listing_history/.test(sql) && /collectorCreated/.test(sql));
    const result=await ingestRecords(f.env,provider,[speedAd(provider,market)],{sessionId:'atomic-new',collectionTradeType:market});
    assert.equal(result.failed,1); assert.equal(result.created,0);
    for(const table of ['listings','listing_sources','listing_media','listing_contacts','listing_history']) {
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
    }
    assert.equal(JSON.parse(f.db.prepare('SELECT totals_json FROM collector_sessions').get().totals_json).newSourceAds,0);
  });
}

test('new listing uses one bounded master/source/assets/history transaction without rereading the just-created master', async t => {
  const f=speedDatabase(); t.after(()=>f.db.close());
  const result=await ingestRecords(f.env,'네이버',[speedAd('네이버','sale')],{sessionId:'atomic-new'});
  assert.equal(result.created,1);
  const transaction=f.batches.find(batch=>batch.some(sql=>/^INSERT INTO listings/.test(sql)));
  assert.ok(transaction.some(sql=>/INSERT INTO listing_sources/.test(sql)));
  assert.ok(transaction.some(sql=>/INSERT INTO listing_media/.test(sql)));
  assert.ok(transaction.some(sql=>/collectorCreated/.test(sql)));
  assert.ok(transaction.length<=80);
  assert.equal(f.calls.filter(call=>/SELECT main_source, operating_memo, status, trade_type, listing_type FROM listings/.test(call.sql||'')).length,0);
});

test('legacy Gongsil receipts without a running claim still save their session counters', async t => {
  const f=speedDatabase(); t.after(()=>f.db.close());
  const result=await ingestRecords(f.env,'공실박스',[speedAd('공실박스','sale')],{
    sessionId:'legacy-receipt',collectionTradeType:'sale',requestId:'legacy-result',action:'gongsilImportBatch'
  });
  assert.equal(result.created,1);
  assert.equal(JSON.parse(f.db.prepare('SELECT totals_json FROM collector_sessions').get().totals_json).created,1);
  assert.equal(JSON.parse(f.db.prepare('SELECT result_json FROM mutation_results').get().result_json).created,1);
});

for(const provider of ['네이버','당근','공실박스']) for(const market of ['lease','sale']) {
  test(`${provider}/${market}: changed advertisements commit source, photos and history together`,async t=>{
    const f=speedDatabase();t.after(()=>f.db.close());
    const save=revision=>ingestRecords(f.env,provider,[speedAd(provider,market,'one',revision)],{sessionId:'speed',collectionTradeType:market});
    const first=await save(1);assert.equal(first.failed,0,JSON.stringify(first));assert.equal(first.created,1);
    const source=f.db.prepare('SELECT * FROM listing_sources').get();
    f.db.prepare("UPDATE listings SET operating_memo='사용자 메모' WHERE id=?").run(source.listing_id);
    f.db.prepare("INSERT INTO listing_contacts (id,listing_id,source_id,role,name,phone) VALUES ('manual',?,NULL,'소유자','합성','000')").run(source.listing_id);
    f.reset();const result=await save(2);assert.equal(result.failed,0);assert.equal(result.updated,1);
    const transaction=f.batches.find(rows=>rows.some(sql=>/UPDATE listing_sources SET listing_id/.test(sql)));
    assert.ok(transaction);assert.ok(transaction.some(sql=>/DELETE FROM listing_media/.test(sql)));
    assert.ok(transaction.some(sql=>/INSERT INTO listing_media/.test(sql)));
    assert.ok(transaction.some(sql=>/INSERT INTO listing_history/.test(sql)));
    assert.equal(f.db.prepare('SELECT operating_memo FROM listings').get().operating_memo,'사용자 메모');
    assert.equal(f.db.prepare("SELECT count(*) n FROM listing_contacts WHERE id='manual'").get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM listing_media').get().n,2);
    assert.equal(f.db.prepare('SELECT count(*) n FROM listing_media WHERE external_url LIKE ?').get('%-2-%').n,2);
    assert.equal(f.db.prepare('SELECT id FROM listing_sources').get().id,source.id);
    assert.equal(result.writeTimingV64.records,1);
    const totals=JSON.parse(f.db.prepare('SELECT totals_json FROM collector_sessions').get().totals_json);
    assert.equal(totals.writeTimingV64.batches,2);assert.equal(totals.writeTimingV64.records,2);
    assert.equal(totals.failed,0);assert.equal(totals.newSourceAds,1);
  });
}

test('failed changed-source transaction rolls back photos, contacts, source, master and history',async t=>{
  const f=speedDatabase();t.after(()=>f.db.close());
  await ingestRecords(f.env,'네이버',[speedAd('네이버','lease')],{sessionId:'speed'});
  const tables=['listing_sources','listing_media','listing_contacts','listings','listing_history'];
  const before=Object.fromEntries(tables.map(table=>[table,f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  f.failWhen(sql=>/INSERT INTO listing_history/.test(sql));
  const result=await ingestRecords(f.env,'네이버',[speedAd('네이버','lease','one',2)],{sessionId:'speed'});
  assert.equal(result.failed,1);assert.equal(result.updated,0);
  for(const table of tables)assert.deepEqual(f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),before[table],table);
});

test('large legacy galleries preserve the 80-statement bound and existing-source counter',async t=>{
  const f=speedDatabase();t.after(()=>f.db.close());
  await ingestRecords(f.env,'네이버',[speedAd('네이버','lease')],{sessionId:'speed'});
  const source=f.db.prepare('SELECT * FROM listing_sources').get();
  const record=normalizedRecord('네이버',speedAd('네이버','lease','one',2));
  record.images=Array.from({length:95},(_,i)=>`https://images.example.test/legacy-${i}.jpg`);
  await attachSource(f.env,record,source.listing_id,'speed',source,false,'collector',{
    media:f.db.prepare('SELECT * FROM listing_media').all(),contacts:[]});
  assert.equal(f.db.prepare('SELECT count(*) n FROM listing_media').get().n,95);
  assert.ok(f.batches.every(rows=>rows.length<=80));
  const totals=JSON.parse(f.db.prepare('SELECT totals_json FROM collector_sessions').get().totals_json);
  assert.equal(totals.newSourceAds,1);
});

test('invalid-address reports are saved in one batch with every distinct ad and failure preserved',async t=>{
  const f=speedDatabase();t.after(()=>f.db.close());
  const records=Array.from({length:8},(_,i)=>({...speedAd('네이버','lease','bad'+i),jibunAddress:''}));
  const result=await ingestRecords(f.env,'네이버',records,{sessionId:'speed'});
  assert.equal(result.failed,8);assert.equal(result.addressMissing,8);assert.equal(result.created,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM collector_raw WHERE processing_state=\'error\'').get().n,8);
  assert.equal(f.batches.filter(rows=>rows.some(sql=>/INSERT INTO collector_raw/.test(sql))).length,1);
  assert.equal(result.errors.length,8);
});

test('deferred contact capture preserves source contacts during the combined transaction',async t=>{
  const f=speedDatabase();t.after(()=>f.db.close());
  await ingestRecords(f.env,'네이버',[speedAd('네이버','lease')],{sessionId:'speed'});
  const source=f.db.prepare('SELECT * FROM listing_sources').get();
  f.db.prepare("INSERT INTO listing_contacts (id,listing_id,source_id,role,name,phone,normalized_phone) VALUES ('source-contact',?,?,'소유자','합성','000','000')")
    .run(source.listing_id,source.id);
  const record={...normalizedRecord('네이버',speedAd('네이버','lease','one',2)),preserveContacts:true,contacts:[],collectionWarnings:[]};
  const existing=f.db.prepare('SELECT * FROM listing_sources').get();
  await attachSource(f.env,record,source.listing_id,'speed',existing,false,'collector',{
    media:f.db.prepare('SELECT * FROM listing_media').all(),contacts:f.db.prepare('SELECT * FROM listing_contacts').all()});
  assert.equal(f.db.prepare("SELECT count(*) n FROM listing_contacts WHERE id='source-contact'").get().n,1);
  const snapshot=JSON.parse(f.db.prepare('SELECT list_snapshot_json FROM listing_sources').get().list_snapshot_json);
  assert.equal(snapshot.contactCaptureStatus,'deferred');assert.equal(snapshot.contactCount,1);
});

for(const provider of ['네이버','당근','공실박스'])test(`${provider}: 1025-provider manifest uses three indexed reads without changing legacy market precedence`,async t=>{
  const f=speedDatabase();t.after(()=>f.db.close());
  await ingestRecords(f.env,provider,[speedAd(provider,'lease','legacy')],{sessionId:'speed',collectionTradeType:'lease'});
  // A pre-qualified legacy ad must keep its identity and the opposite market
  // receives a new ID, even across the larger JSON-bound query boundary.
  f.db.prepare("UPDATE listing_sources SET source_listing_id=?").run(provider==='네이버'?'네이버-legacy':'legacy');
  const base=provider==='네이버'?'네이버-legacy':'legacy';
  const records=Array.from({length:1025},(_,i)=>i===0?base:String(i)).flatMap(sourceId=>
    [{sourceId,tradeType:'lease'},{sourceId,tradeType:'sale'}]);
  f.reset();const resolved=provider==='공실박스'?await resolveGongsilOfferIds(f.env,records):await resolveCollectorOfferIds(f.env,provider,records);
  assert.equal(resolved.length,2050);assert.equal(resolved[0].sourceId,base);assert.equal(resolved[1].sourceId,base+'::sale');
  assert.equal(new Set(resolved.map(r=>r.sourceId)).size,2050);
  assert.equal(f.calls.length,3);
  for(const call of f.calls){
    assert.doesNotMatch(call.sql,/payload_json|raw_json/);
    const args=provider==='공실박스'?[JSON.stringify(['legacy','legacy::sale','legacy::lease'])]:[provider,JSON.stringify([base,base+'::sale',base+'::lease'])];
    const plan=f.db.prepare('EXPLAIN QUERY PLAN '+call.sql).all(...args).map(row=>row.detail).join('\n');
    assert.match(plan,/SEARCH (?:s|listing_sources) USING INDEX/);
    assert.match(plan,/SEARCH collector_raw USING INDEX idx_collector_raw_source_listing_created/);
  }
});

test('manual protection history is read only after the concurrent master read resolves',async t=>{
  const f=speedDatabase();t.after(()=>f.db.close());
  await ingestRecords(f.env,'네이버',[speedAd('네이버','lease')],{sessionId:'speed'});
  const id=f.db.prepare('SELECT id FROM listings').get().id;
  const ordinary=f.env.DB.prepare;let release,started,masterDone=false,manualTooEarly=false;
  const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  f.env.DB.prepare=(sql,values=[])=>{
    const statement=ordinary(sql,values);
    return {...statement,bind:(...args)=>f.env.DB.prepare(sql,args),async all(){
      if(/SELECT id,version,status,trade_type/.test(sql)){started();await gate;masterDone=true;}
      if(/FROM listing_history/.test(sql)&&!masterDone)manualTooEarly=true;
      return statement.all();
    }};
  };
  const pending=refreshListingRepresentativesFromActiveSources(f.env,[id]);await entered;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(manualTooEarly,false);
  release();await pending;assert.equal(masterDone,true);assert.equal(manualTooEarly,false);
});

test('new source insert, publication counter and assets roll back if its history transaction fails',async t=>{
  const f=speedDatabase();t.after(()=>f.db.close());
  await ingestRecords(f.env,'네이버',[speedAd('네이버','lease')],{sessionId:'speed'});
  const master=f.db.prepare('SELECT id FROM listings').get();let observedNew=0;
  const before=f.db.prepare('SELECT count(*) n FROM listing_sources').get().n;
  f.failWhen(sql=>/INSERT INTO listing_history/.test(sql));
  const record=normalizedRecord('네이버',speedAd('네이버','lease','another',2));
  await assert.rejects(attachSource(f.env,record,master.id,'speed',null,false,'collector',null,false,()=>observedNew++),/synthetic/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM listing_sources').get().n,before);assert.equal(observedNew,0);
  assert.equal(JSON.parse(f.db.prepare('SELECT totals_json FROM collector_sessions').get().totals_json).newSourceAds,1);
});
