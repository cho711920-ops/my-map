import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleD1GetAction } from '../cloudflare/src/d1-api.js';
import { absenceMetadataSql, sourceAbsenceConfirmedAt } from '../cloudflare/src/source-availability.js';
import { withSourceOriginalMetadata } from '../cloudflare/src/source-original-display.js';

const checkedAt = '2026-10-14T03:05:00.000Z';
const capturedAt = '2026-10-14T03:00:00.000Z';
const now = Date.parse('2026-10-15T03:00:00.000Z');
const prefixes = {'네이버':'naver-region','당근':'daangn-cluster','공실박스':'gongsil-map'};
function evidence(source = '네이버', overrides = {}) {
  return {version:1,validationVersion:3,reason:'scoped-census-missing',
    scopeKey:prefixes[source]+'-v1-'+'a'.repeat(64),sessionId:'confirmed-session',
    capturedAt,checkedAt,providerEndVerified:false,privateEvidence:'never-public',...overrides};
}
function row(source = '네이버', overrides = {}) {
  return {id:'ad',listing_id:'M',source,active:0,availability_kind:'census_missing',
    updated_at:'2026-10-15T01:00:00.000Z',last_collected_at:'2026-10-15T02:00:00.000Z',
    absence_metadata_json:JSON.stringify({...evidence(source),updatedAt:checkedAt}),...overrides};
}

test('the confirmed absence date is the verified server event, never the capture/source-update/migration date', () => {
  for (const source of Object.keys(prefixes)) {
    assert.equal(sourceAbsenceConfirmedAt(row(source),now),checkedAt);
    const original=withSourceOriginalMetadata({room:'1층',endedAt:'wrong'},row(source));
    assert.equal(original.absenceConfirmedAt,checkedAt);
    assert.equal(original.endedAt,checkedAt,'the compatibility alias must not retain a made-up provider end date');
    assert.equal(original.lastCheckedAt,'2026-10-15T01:00:00.000Z');
    assert.doesNotMatch(JSON.stringify(original),/privateEvidence|never-public|absence_metadata_json|scopeKey/);
  }
});

test('active, legacy and unclassified originals never acquire a date from timestamps or stale proof', () => {
  for (const values of [{active:1},{availability_kind:'legacy_candidate'},
    {availability_kind:'legacy_unverified'},{availability_kind:''},{absence_metadata_json:''}]) {
    const original=withSourceOriginalMetadata({endedAt:'2026-01-01',absenceConfirmedAt:'2026-01-01'},row('네이버',values));
    assert.equal(original.absenceConfirmedAt,'');assert.equal(original.endedAt,'');
  }
});

test('malformed, wrong-source, unverified, inconsistent and impossible absence proofs fail closed', () => {
  const changes=[{version:2},{validationVersion:2},{validationVersion:'3'},
    {reason:'legacy-cutover'},{scopeKey:prefixes['당근']+'-v1-'+'a'.repeat(64)},
    {scopeKey:[prefixes['네이버']+'-v1-'+'a'.repeat(64)]},
    {sessionId:''},{checkedAt:'not-a-date'},{capturedAt:null},
    {updatedAt:'2026-10-14T03:06:00.000Z'},
    {capturedAt:'2026-10-14T03:06:01.000Z'},
    {checkedAt:'2026-02-30T03:00:00.000Z',updatedAt:'2026-02-30T03:00:00.000Z'},
    {checkedAt:'2026-10-16T03:00:00.000Z',updatedAt:'2026-10-16T03:00:00.000Z'}];
  for (const change of changes) {
    const data=row('네이버',{absence_metadata_json:JSON.stringify({...evidence(),updatedAt:checkedAt,...change})});
    assert.equal(sourceAbsenceConfirmedAt(data,now),'',JSON.stringify(change));
  }
  for (const value of ['{broken','null','[]','0']) {
    assert.equal(sourceAbsenceConfirmedAt(row('네이버',{absence_metadata_json:value}),now),'',value);
  }
  assert.throws(()=>absenceMetadataSql('s;drop table listings'));
});

function fixture(t) {
  const db=new DatabaseSync(':memory:');
  for (const file of fs.readdirSync('cloudflare/migrations').filter(file=>file.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync('cloudflare/migrations/'+file,'utf8'));
  }
  t.after(()=>db.close());
  const sqls=[];
  const env={DB:{prepare(sql){sqls.push(sql);let values=[];return {
    bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)||null;},
    async all(){return {results:db.prepare(sql).all(...values)};}
  };}}};
  db.prepare("INSERT INTO listings(id,property_id,title,address,room) VALUES ('M','public-M','보존할 제목','서구 검수동 1','1층')").run();
  const source=(id,active=0,kind='census_missing',proof=evidence())=>{
    db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,missing_count,updated_at,list_snapshot_json)
      VALUES (?,'M','네이버',?,?,?,'2026-10-15T01:00:00.000Z',?)`).run(id,id,active,active?0:1,
      JSON.stringify({originalId:id,source:'네이버',room:'1층',deposit:1000,rent:50,tradeType:'lease',endedAt:'wrong'}));
    db.prepare('INSERT INTO listing_source_availability(source_id,kind,evidence_json,updated_at) VALUES (?,?,?,?)')
      .run(id,kind,typeof proof==='string'?proof:JSON.stringify(proof),checkedAt);
  };
  const get=action=>handleD1GetAction(env,{}, {action,propertyId:'public-M'});
  return {db,sqls,source,get};
}
function expand(result) {
  return result.groups.M.map(values=>Object.fromEntries(result.fields.map((field,index)=>[field,values[index]??''])));
}

test('compact, detail and bounded candidate originals expose only verified absence timestamps without database writes', async t => {
  const f=fixture(t);f.source('valid');f.source('active',1);f.source('legacy',0,'legacy_candidate');
  f.source('malformed',0,'census_missing','{broken');
  const before=f.db.prepare('SELECT * FROM listing_sources ORDER BY id').all();
  const list=await f.get('unifiedListings');
  assert.equal(list.fields.at(-2),'absenceConfirmedAt');
  const detail=await f.get('unifiedListingDetail'),candidates=await f.get('transactionCandidates');
  for (const originals of [expand(list),detail.originals,candidates.candidates[0].candidateOriginals]) {
    assert.equal(originals.find(original=>original.originalId==='valid').absenceConfirmedAt,checkedAt);
    for (const original of originals.filter(original=>original.originalId!=='valid')) {
      assert.equal(original.absenceConfirmedAt,'');assert.equal(original.endedAt,'');
    }
    assert.doesNotMatch(JSON.stringify(originals),/never-public|privateEvidence|scopeKey|evidence_json|wrong/);
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM listing_sources ORDER BY id').all(),before);
  assert.ok(f.sqls.every(sql=>!/SELECT\s+(?:s\.)?evidence_json\b/i.test(sql)));
});

test('reappearing advertisements suppress the old date and a later proven absence uses its new event', async t => {
  const f=fixture(t);f.source('ad');
  assert.equal(expand(await f.get('unifiedListings'))[0].absenceConfirmedAt,checkedAt);
  f.db.prepare("UPDATE listing_sources SET active=1,missing_count=0 WHERE id='ad'").run();
  const returned=(await f.get('unifiedListingDetail')).originals[0];
  assert.equal(returned.absenceConfirmedAt,'');assert.equal(returned.endedAt,'');
  assert.equal((await f.get('transactionCandidates')).count,0);
  const later='2026-10-14T04:05:00.000Z';
  f.db.prepare("UPDATE listing_sources SET active=0,missing_count=1 WHERE id='ad'").run();
  f.db.prepare("UPDATE listing_source_availability SET evidence_json=?,updated_at=? WHERE source_id='ad'")
    .run(JSON.stringify(evidence('네이버',{capturedAt:'2026-10-14T04:00:00.000Z',checkedAt:later,sessionId:'next-session'})),later);
  assert.equal((await f.get('transactionCandidates')).candidates[0].candidateOriginals[0].absenceConfirmedAt,later);
});

test('manually completed source-less listings do not invent an absence timestamp', async t => {
  const f=fixture(t);f.db.prepare("UPDATE listings SET status='계약완료' WHERE id='M'").run();
  const original=(await f.get('unifiedListingDetail')).originals[0];
  assert.equal(original.masterFallback,true);assert.equal(original.absenceConfirmedAt,'');assert.equal(original.endedAt,'');
});
