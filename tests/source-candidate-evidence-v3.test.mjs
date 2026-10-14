import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleD1GetAction, refreshOperationsDashboard, buildD1SheetCsv } from '../cloudflare/src/d1-api.js';
import { koreanCalendarDay } from '../cloudflare/src/new-listing-period.js';
import { sourceAvailability, candidateSourceWhereSql, publicSourceWhereSql, candidateAdCountSql } from '../cloudflare/src/source-availability.js';

const migration = fs.readFileSync('cloudflare/migrations/0027_source_candidate_evidence.sql','utf8');
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync('cloudflare/migrations').filter(file => file.endsWith('.sql') && file < '0027').sort()) {
    db.exec(fs.readFileSync('cloudflare/migrations/' + file,'utf8'));
  }
  t.after(() => db.close());
  const sqls = [];
  const env = { DB: { prepare(sql) { let values = []; sqls.push(sql); return {
    bind(...args) { values=args; return this; }, async first() { return db.prepare(sql).get(...values) || null; },
    async all() { return {results:db.prepare(sql).all(...values)}; },
    async run() { return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}}; }
  }; } } };
  const master = id => db.prepare(`INSERT INTO listings(id,property_id,title,address,room,operating_memo)
    VALUES (?,?,?,'서구 검수동 1','1층','사용자 메모')`).run(id,'public-'+id,'보존할 제목');
  const source = (id,parent,active=1) => db.prepare(`INSERT INTO listing_sources
    (id,listing_id,source,source_listing_id,source_url,active,missing_count,list_snapshot_json,raw_json)
    VALUES (?,?,'네이버',?,?,?, ?,?,?)`).run(id,parent,id,'https://example.test/'+id,active,active?0:3,
    JSON.stringify({originalId:id,source:'네이버',propertyId:'public-'+parent,room:'1층',deposit:1000,rent:50,tradeType:'lease'}),
    JSON.stringify({floorInfo:'1/4',privateRaw:'never-send'}));
  return {db,env,sqls,master,source,migrate:()=>db.exec(migration),get:action=>handleD1GetAction(env,{}, {action})};
}

test('cutover freezes old all-inactive candidates and archives mixed inactive records without changing source/master data', async t => {
  const f=fixture(t); f.master('gone');f.master('mixed');
  f.source('gone-a','gone',0);f.source('gone-b','gone',0);f.source('mixed-live','mixed');f.source('mixed-old','mixed',0);
  const sources=f.db.prepare('SELECT * FROM listing_sources ORDER BY id').all();
  const masters=f.db.prepare('SELECT * FROM listings ORDER BY id').all();
  f.migrate();
  assert.deepEqual(f.db.prepare('SELECT source_id,kind FROM listing_source_availability ORDER BY source_id').all().map(row=>[row.source_id,row.kind]),[
    ['gone-a','legacy_candidate'],['gone-b','legacy_candidate'],['mixed-old','legacy_unverified']
  ]);
  assert.deepEqual(f.db.prepare('SELECT * FROM listing_sources ORDER BY id').all(),sources);
  assert.deepEqual(f.db.prepare('SELECT * FROM listings ORDER BY id').all(),masters);
  f.db.prepare("UPDATE listing_sources SET active=0 WHERE id='mixed-live'").run();f.migrate();
  assert.equal(f.db.prepare("SELECT kind FROM listing_source_availability WHERE source_id='mixed-old'").get().kind,'legacy_unverified');
  const evidence=JSON.parse(f.db.prepare("SELECT evidence_json FROM listing_source_availability WHERE source_id='gone-a'").get().evidence_json);
  assert.equal(evidence.providerEndVerified,false);
});

test('public list/search/detail exclude archived and unclassified inactive sources but preserve their DB records', async t => {
  const f=fixture(t);f.master('gone');f.master('mixed');f.master('unclassified');
  f.source('gone-a','gone',0);f.source('live','mixed');f.source('archived','mixed',0);f.migrate();
  f.source('unknown','unclassified',0);
  for(const [id,value] of [['live','9001'],['archived','9002'],['unknown','9003']]) {
    f.db.prepare('UPDATE listing_sources SET source_listing_id=? WHERE id=?').run(value,id);
  }
  const list=await f.get('unifiedListings');
  assert.equal(list.originalCount,2);assert.equal(list.groups.gone.length,1);assert.equal(list.groups.mixed.length,1);
  assert.equal(list.groups.unclassified,undefined);
  assert.deepEqual(list.sourceSearchIds.mixed,['n:9001']);assert.equal(list.sourceSearchIds.unclassified,undefined);
  const gone=await handleD1GetAction(f.env,{}, {action:'unifiedListingDetail',propertyId:'public-gone'});
  assert.equal(gone.originals[0].candidateEligible,true);assert.equal(gone.originals[0].availabilityKind,'legacy_candidate');
  const mixed=await handleD1GetAction(f.env,{}, {action:'unifiedListingDetail',propertyId:'public-mixed'});
  assert.equal(mixed.originals.length,1);assert.equal(mixed.originals[0].availabilityKind,'active');
  const unknown=await handleD1GetAction(f.env,{}, {action:'unifiedListingDetail',propertyId:'public-unclassified'});
  assert.deepEqual(unknown.originals,[],'archived rows must not reappear as a fabricated master fallback');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM listing_sources').get().n,4);
  for(const response of [list,gone,mixed,unknown]) assert.doesNotMatch(JSON.stringify(response),/evidence_json|privateRaw|never-send|legacy-cutover/);
});

test('one new missing ad remains a candidate beside nine active ads; legacy archives never join its count', async t => {
  const f=fixture(t);f.master('M');for(let i=0;i<10;i++)f.source('live-'+i,'M');f.source('old','M',0);f.migrate();
  f.db.prepare("UPDATE listing_sources SET active=0,missing_count=1 WHERE id='live-0'").run();
  f.db.prepare("INSERT INTO listing_source_availability(source_id,kind,evidence_json) VALUES ('live-0','census_missing','{\"secretEvidence\":\"never-send\"}')").run();
  const result=await f.get('transactionCandidates'),dashboard=await refreshOperationsDashboard(f.env);
  assert.equal(result.count,1);assert.equal(result.candidateAdCount,1);assert.equal(dashboard.transactionCheckCandidates,1);
  assert.equal(dashboard.candidateAdCount,1);assert.equal(result.candidates[0].activeSourceCount,9);
  assert.equal(result.candidates[0].sourceCount,10);assert.equal(result.candidates[0].candidateOriginalCount,1);
  assert.equal(result.candidates[0].candidateOriginals.length,1);
  const original=result.candidates[0].candidateOriginals[0];
  assert.equal(original.originalId,'live-0');assert.equal(original.propertyId,'public-M');
  assert.equal(original.candidateEligible,true);assert.equal(original.availabilityKind,'census_missing');
  assert.equal(original.deposit,1000);assert.equal(original.rent,50);assert.equal(original.floor,1);
  const plan=f.db.prepare('EXPLAIN QUERY PLAN SELECT '+candidateAdCountSql()).all();
  assert.match(JSON.stringify(plan),/idx_listing_source_availability_kind/);
  assert.doesNotMatch(JSON.stringify(result),/secretEvidence|never-send|raw_json|evidence_json/);
  f.db.prepare("UPDATE listing_sources SET active=1,missing_count=0 WHERE id='live-0'").run();
  assert.equal((await f.get('transactionCandidates')).count,0);
  assert.equal(sourceAvailability(1,'census_missing').candidateEligible,false);
});

test('candidate nested lists are bounded and expose exact counts instead of silently losing advertisements', async t => {
  const f=fixture(t);f.master('many');for(let i=0;i<105;i++)f.source('ad-'+i,'many',0);f.migrate();
  const result=await f.get('transactionCandidates'),row=result.candidates[0];
  assert.equal(result.count,1);assert.equal(result.candidateAdCount,105);assert.equal(row.candidateOriginalCount,105);
  assert.equal(row.candidateOriginals.length,100);assert.equal(row.returnedCandidateOriginalCount,100);
  assert.equal(row.candidateOriginalsHasMore,true);assert.equal(result.candidateOriginalsHasMore,true);
});

test('manual field metadata is actual-change-only and never overwrites advertised financial terms', async t => {
  const f=fixture(t);f.master('M');f.source('ad','M');f.migrate();
  f.db.prepare(`UPDATE listings SET deposit=9000,room='직접 호실',operating_memo='보존할 메모' WHERE id='M'`).run();
  f.db.prepare(`INSERT INTO listing_history(listing_id,action,before_json,after_json) VALUES ('M','updateProperty',?,?)`)
    .run(JSON.stringify({deposit:1000,room:'1층',monthly_rent:50}),JSON.stringify({deposit:9000,room:'직접 호실',monthly_rent:50}));
  const list=await f.get('unifiedListings'),fields=list.fields,record=list.groups.M[0];
  assert.equal(record[fields.indexOf('manualDisplayFields')],'room,deposit');
  assert.equal(record[fields.indexOf('deposit')],1000);assert.equal(record[fields.indexOf('room')],'직접 호실');
  const detail=await handleD1GetAction(f.env,{}, {action:'unifiedListingDetail',propertyId:'public-M'});
  assert.equal(detail.originals[0].manualDisplayFields,'room,deposit');assert.equal(detail.originals[0].deposit,1000);
  assert.ok(f.sqls.some(sql=>/FROM listing_history WHERE action='updateProperty'/.test(sql)&&!sql.includes('listing_id IN')));
});

test('compact list and candidate originals preserve each advertised type without replacing the parent or inventing absent types', async t => {
  const f=fixture(t);f.master('M');f.source('live','M');f.source('missing','M');f.source('legacy','M');f.migrate();
  f.db.prepare("UPDATE listings SET listing_type='일반상가' WHERE id='M'").run();
  for (const [id,type] of [['live','빌라'],['missing','일반사무실']]) {
    f.db.prepare("UPDATE listing_sources SET list_snapshot_json=json_set(list_snapshot_json,'$.type',?) WHERE id=?").run(type,id);
  }
  f.db.prepare("UPDATE listing_sources SET active=0,missing_count=1 WHERE id='missing'").run();
  f.db.prepare("INSERT INTO listing_source_availability(source_id,kind) VALUES ('missing','census_missing')").run();
  const list=await f.get('unifiedListings');
  assert.equal(list.fields.at(-1),'type','append the new wire field without shifting existing compact positions');
  const originals=new Map(list.groups.M.map(record=>[record[list.fields.indexOf('originalId')],record]));
  assert.equal(originals.get('live')[list.fields.indexOf('type')],'빌라');
  assert.equal(originals.get('missing')[list.fields.indexOf('type')],'일반사무실');
  assert.equal(originals.get('legacy')[list.fields.indexOf('type')],undefined,'omitted compact tail keeps the existing master fallback');
  const candidates=await f.get('transactionCandidates');
  assert.equal(candidates.candidates[0].type,'일반상가');
  assert.equal(candidates.candidates[0].candidateOriginals[0].type,'일반사무실');
  const detail=await handleD1GetAction(f.env,{}, {action:'unifiedListingDetail',propertyId:'public-M'});
  assert.equal(detail.originals.find(original=>original.originalId==='live').type,'빌라');
  assert.equal(detail.originals.find(original=>original.originalId==='missing').type,'일반사무실');
  assert.equal(f.db.prepare("SELECT listing_type FROM listings WHERE id='M'").get().listing_type,'일반상가');
});

test('moving the last live ad hides an archive-only ghost from CSV, delta and Today without deleting its master or favorites keys', async t => {
  const f=fixture(t);f.master('origin');f.master('target');f.master('direct');
  f.source('live','origin');f.source('archive','origin',0);f.migrate();
  f.db.prepare("UPDATE listing_sources SET listing_id='target' WHERE id='live'").run();
  f.db.prepare('UPDATE listings SET first_collected_at=?').run(koreanCalendarDay()+' 12:00');
  const before=f.db.prepare("SELECT id,property_id,status,room,operating_memo FROM listings WHERE id='origin'").get();
  const csv=await buildD1SheetCsv(f.env);
  assert.doesNotMatch(csv,/public-origin/);assert.match(csv,/public-direct/);assert.match(csv,/public-target/);
  const changes=await handleD1GetAction(f.env,{}, {action:'listingChanges',ids:'public-origin,public-direct,public-target'});
  assert.deepEqual(changes.items.map(row=>row.property_id).sort(),['public-direct','public-target']);
  const today=await handleD1GetAction(f.env,{}, {action:'newListingPeriod',days:'1',market:'lease'});
  assert.deepEqual(today.items.map(row=>row.property_id).sort(),['public-direct','public-target']);
  assert.deepEqual(f.db.prepare("SELECT id,property_id,status,room,operating_memo FROM listings WHERE id='origin'").get(),before);
  assert.equal(f.db.prepare("SELECT kind FROM listing_source_availability WHERE source_id='archive'").get().kind,'legacy_unverified');
});

test('explicit manual completion remains published with parent details even when only archived sources remain', async t => {
  const f=fixture(t);f.master('M');f.master('target');f.source('live','M');f.source('archive','M',0);f.migrate();
  f.db.prepare("UPDATE listing_sources SET listing_id='target' WHERE id='live'").run();
  f.db.prepare("UPDATE listings SET status='계약완료',room='직접완료 호실',deposit=7777 WHERE id='M'").run();
  assert.match(await buildD1SheetCsv(f.env),/public-M/);
  const changes=await handleD1GetAction(f.env,{}, {action:'listingChanges',ids:'public-M'});
  assert.equal(changes.items.length,1);assert.equal(changes.items[0].status,'계약완료');
  const detail=await handleD1GetAction(f.env,{}, {action:'unifiedListingDetail',propertyId:'public-M'});
  assert.equal(detail.originals.length,1);assert.equal(detail.originals[0].masterFallback,true);
  assert.equal(detail.originals[0].room,'직접완료 호실');assert.equal(detail.originals[0].deposit,7777);
  assert.equal(detail.originals[0].sourceUnavailable,false);assert.equal(detail.originals[0].candidateEligible,false);
  assert.equal(detail.originals[0].availabilityKind,'manual_completed');assert.equal((await f.get('transactionCandidates')).count,0);
});

test('unclassified inactive data fails closed, active data wins, and SQL aliases are internal-only', () => {
  assert.deepEqual(sourceAvailability(0,''),{availabilityKind:'legacy_unverified',candidateEligible:false});
  assert.deepEqual(sourceAvailability(0,'legacy_unverified'),{availabilityKind:'legacy_unverified',candidateEligible:false});
  assert.deepEqual(sourceAvailability(1,'legacy_candidate'),{availabilityKind:'active',candidateEligible:false});
  assert.equal(sourceAvailability(0,'legacy_candidate').candidateEligible,true);
  assert.throws(()=>candidateSourceWhereSql('s; DROP TABLE listings'));
  assert.match(publicSourceWhereSql('s'),/s.active=1 OR/);
});
