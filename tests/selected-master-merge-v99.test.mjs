import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {mergeSelectedMasters,remapMergedListKey} from '../cloudflare/src/selected-master-merge.js';
import {handleD1GetAction} from '../cloudflare/src/d1-api.js';
import {handlePersonalListingCover} from '../cloudflare/src/personal-listing-cover.js';

const owner={email:'merge@test.invalid'};
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const dir=new URL('../cloudflare/migrations/',import.meta.url);
  for(const file of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file,dir),'utf8'));
  const prepare=(sql,args=[])=>{
    const indexes=[],compiled=sql.replace(/\?(\d+)/g,(_,n)=>{indexes.push(Number(n)-1);return '?';});
    const params=()=>indexes.length?indexes.map(i=>args[i]):args;
    return {bind:(...values)=>prepare(sql,values),
      async first(){return db.prepare(compiled).get(...params())||null;},
      async all(){return {results:db.prepare(compiled).all(...params())};},
      async run(){return {meta:{changes:Number(db.prepare(compiled).run(...params()).changes)}};}};
  };
  let beforeBatch=()=>{};
  const env={DB:{prepare,async batch(statements){beforeBatch();db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}}};
  const add=(id,source='네이버',trade='lease',category='')=>{
    db.prepare('INSERT INTO listings(id,property_id,title,address,main_source,operating_memo,trade_type,sale_category) VALUES(?,?,?,?,?,?,?,?)')
      .run(id,'public-'+id,'제목 '+id,'서구 테스트동 '+id,source,'메모 '+id,trade,category);
    if(source==='네이버')db.prepare('INSERT INTO listing_sources(id,listing_id,source,source_listing_id,list_snapshot_json) VALUES(?,?,?,?,?)')
      .run('O-'+id,id,source,'ad-'+id,JSON.stringify({propertyId:id,deposit:1000,rent:id==='A'?50:60}));
  };
  ['A','B','C'].forEach(id=>add(id));
  const body={selectedMerge:true,requestId:'selected-merge-fixture-12345678',primaryMasterId:'public-A',duplicateMasterIds:['public-B','public-C']};
  const cloud=(email,scope,key,value)=>db.prepare('INSERT INTO cloud_state(owner_email,scope,record_key,value_json) VALUES(?,?,?,?)').run(email,scope,key,JSON.stringify(value));
  return {db,env,add,body,cloud,setBeforeBatch:fn=>{beforeBatch=fn;}};
}
test('selected merge moves every original in one transaction, preserves distinct terms and memos, and replays safely',async t=>{
  const f=fixture(t);
  f.db.prepare("INSERT INTO listing_media(id,listing_id,source_id) VALUES('photo','B','O-B')").run();
  f.db.prepare("INSERT INTO listing_contacts(id,listing_id,source_id) VALUES('contact','C','O-C')").run();
  const result=await mergeSelectedMasters(f.env,owner,f.body);
  assert.equal(result.persisted,true);assert.equal(result.consolidated,2);
  assert.deepEqual(result.affectedPropertyIds,['public-A','public-B','public-C']);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM listing_sources WHERE listing_id='A'").get().n,3);
  assert.equal(JSON.parse(f.db.prepare("SELECT list_snapshot_json AS j FROM listing_sources WHERE id='O-B'").get().j).rent,60);
  assert.equal(f.db.prepare("SELECT listing_id FROM listing_media").get().listing_id,'A');
  assert.equal(f.db.prepare("SELECT listing_id FROM listing_contacts").get().listing_id,'A');
  assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE id='A'").get().operating_memo,'메모 A\n\n메모 B\n\n메모 C');
  const replay=await mergeSelectedMasters(f.env,owner,f.body);assert.equal(replay.replayed,true);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM listing_history').get().n,1);
  await assert.rejects(mergeSelectedMasters(f.env,{email:'other@test.invalid'},f.body),/요청이 변경/);
});

test('v181 manual master merge preserves each private attachment, upload date, bytes key and trash state',async t=>{
 const f=fixture(t),id=crypto.randomUUID(),value={id,listingId:'B',propertyId:'public-B',filename:'임대현황.pdf',objectKey:'private-immutable-key',uploadedAt:'2026-11-11T03:00:00Z',deletedAt:'2026-11-11T04:00:00Z'};
 f.cloud('private@test.invalid','listingAttachmentsV181',id,value);
 await mergeSelectedMasters(f.env,owner,f.body);
 const row=f.db.prepare("SELECT * FROM cloud_state WHERE scope='listingAttachmentsV181'").get(),next=JSON.parse(row.value_json);
 assert.deepEqual(next,{...value,listingId:'A',propertyId:'public-A'});assert.equal(row.owner_email,'private@test.invalid');assert.equal(row.record_key,id);assert.equal(row.version,2);
});
test('favorites and visit notes retain folder data and point to the surviving public ID, for each owner',async t=>{
  const f=fixture(t);
  for(const email of [owner.email,'other@test.invalid'])for(const scope of ['favorites','visitLists'])
    f.cloud(email,scope,'default',[{id:'folder',name:'보존',notes:'현장 기록',itemKeys:['property:public-B|row:3','property:public-A','unrelated']}]);
  await mergeSelectedMasters(f.env,owner,f.body);
  for(const row of f.db.prepare("SELECT value_json,version FROM cloud_state").all()){
    const folder=JSON.parse(row.value_json)[0];assert.equal(folder.notes,'현장 기록');assert.deepEqual(folder.itemKeys,['property:public-A','unrelated']);assert.equal(row.version,2);
  }
  assert.equal(remapMergedListKey('property:public-B|row:12',{'property:public-B':'property:public-A'}),'property:public-A');
});
test('inherits a personal cover only if that account has no representative record; explicit reset wins',async t=>{
  const f=fixture(t),imageId='00000000-0000-4000-8000-000000000001';
  f.cloud(owner.email,'personalListingCoverV85','public-B',{imageId});
  f.cloud('other@test.invalid','personalListingCoverV85','public-B',{imageId});
  f.cloud('other@test.invalid','personalListingCoverV85','public-A',{imageId:''});
  await mergeSelectedMasters(f.env,owner,f.body);
  const get=email=>JSON.parse(f.db.prepare("SELECT value_json FROM cloud_state WHERE scope='personalListingCoverV85' AND owner_email=? AND record_key='public-A'").get(email).value_json);
  assert.equal(get(owner.email).assetPropertyId,'public-B');assert.equal(get('other@test.invalid').imageId,'');
});
test('source-less manual cards retain their original conditions as source snapshots',async t=>{
  const f=fixture(t);f.db.exec('DELETE FROM listing_sources');f.db.exec("UPDATE listings SET main_source='직접등록'");
  await mergeSelectedMasters(f.env,owner,f.body);
  const rows=f.db.prepare("SELECT source_listing_id FROM listing_sources WHERE listing_id='A'").all();
  assert.deepEqual(rows.map(r=>r.source_listing_id).sort(),['merged-master:A','merged-master:B','merged-master:C']);
});
test('a concurrent memo or folder edit aborts all material writes and the receipt',async t=>{
  const f=fixture(t);f.setBeforeBatch(()=>f.db.exec("UPDATE listings SET version=version+1,operating_memo='동시 수정' WHERE id='B'"));
  await assert.rejects(mergeSelectedMasters(f.env,owner,f.body),/다른 작업/);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM listings WHERE status='deleted'").get().n,0);
  assert.equal(f.db.prepare("SELECT listing_id FROM listing_sources WHERE id='O-B'").get().listing_id,'B');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM mutation_results').get().n,0);
});
test('failure midway rolls back moved sources, master deletion and receipt',async t=>{
  const f=fixture(t);f.db.exec("CREATE TRIGGER fail_merge BEFORE UPDATE ON listings WHEN NEW.status='deleted' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await assert.rejects(mergeSelectedMasters(f.env,owner,f.body));
  assert.equal(f.db.prepare("SELECT listing_id FROM listing_sources WHERE id='O-B'").get().listing_id,'B');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM mutation_results').get().n,0);
});
test('cross-market and missing selection fail without changing any selected master',async t=>{
  const f=fixture(t);f.db.exec("UPDATE listings SET trade_type='sale',sale_category='land' WHERE id='C'");
  await assert.rejects(mergeSelectedMasters(f.env,owner,f.body),/거래유형/);
  await assert.rejects(mergeSelectedMasters(f.env,owner,{...f.body,duplicateMasterIds:['public-B','missing']}),/변경되었거나/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM listing_history').get().n,0);
});
test('the real scoped API returns compact originals and matching source proofs after a public-ID merge',async t=>{
  const f=fixture(t);await mergeSelectedMasters(f.env,owner,f.body);
  const result=await handleD1GetAction(f.env,owner,{action:'listingOriginals',ids:'public-A,public-B,public-C'});
  assert.equal(result.items.length,1);assert.deepEqual(result.missingIds,['public-B','public-C']);
  assert.equal(result.unified.format,'compact-v2');assert.equal(result.unified.groups['public-A'].length,3);
  assert.equal(result.items[0].source_snapshot_key,result.unified.sourceSnapshotKeys['public-A']);
});
test('an inherited cover reads the original owner-scoped asset; reset preserves shared files',async t=>{
  const f=fixture(t),imageId='00000000-0000-4000-8000-000000000001',reads=[],deletes=[];
  f.cloud(owner.email,'personalListingCoverV85','public-B',{imageId});
  await mergeSelectedMasters(f.env,owner,f.body);
  f.env.MEDIA={async get(key){reads.push(key);return {body:new Uint8Array([255,216,255,217])};},async delete(keys){deletes.push(keys);}};
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner.email))),b=>b.toString(16).padStart(2,'0')).join('');
  const url=`https://example.invalid/api/personal-cover?propertyId=public-A&imageId=${imageId}&owner=${hash}&kind=thumb`;
  const image=await handlePersonalListingCover(new Request(url),f.env,owner);
  assert.equal(image.status,200);assert.ok(reads[0].endsWith(`/public-B/${imageId}-thumb.jpg`));
  await assert.rejects(handlePersonalListingCover(new Request(url),f.env,{email:'different@test.invalid'}),/현재 계정/);
  const reset=await handlePersonalListingCover(new Request('https://example.invalid/api/personal-cover',{method:'POST'}),f.env,owner,
    {action:'reset',propertyId:'public-A',expectedVersion:1,requestId:'00000000-0000-4000-8000-000000000002'});
  assert.equal(reset.status,200);assert.deepEqual(deletes,[]);
});
for (const confirmedId of ['A','B']) for (const primaryId of ['A','B']) test('confirmed '+confirmedId+' survives selected merge with primary '+primaryId+' and preserves memo paragraphs',async t=>{
 const f=fixture(t),other=primaryId==='A'?'B':'A';
 f.db.prepare('UPDATE listings SET operating_memo=? WHERE id=?').run('(확인매물) / 확인 본문\n둘째 줄',confirmedId);
 f.db.prepare('UPDATE listings SET operating_memo=? WHERE id=?').run('(임장가자) / 미확인 본문\n다음 줄',confirmedId==='A'?'B':'A');
 const originalB=JSON.parse(f.db.prepare("SELECT list_snapshot_json FROM listing_sources WHERE id='O-B'").get().list_snapshot_json);
 const body={...f.body,primaryMasterId:'public-'+primaryId,duplicateMasterIds:['public-'+other]};
 const result=await mergeSelectedMasters(f.env,owner,body);
 const memo=f.db.prepare('SELECT operating_memo FROM listings WHERE id=?').get(primaryId).operating_memo;
 assert.match(memo,/^\(확인매물\)/);assert.doesNotMatch(memo,/\(\s*(?:임장가자|공실박스)\s*\)/);
 assert.ok(memo.includes('확인 본문\n둘째 줄'));assert.ok(memo.includes('미확인 본문\n다음 줄'));
 assert.equal((memo.match(/\(확인매물\)/g)||[]).length,1);
 assert.equal(result.confirmedVisit,true);assert.equal(result.primaryOperatingMemo,memo);
 const fresh=await handleD1GetAction(f.env,owner,{action:'listingOriginals',ids:'public-'+primaryId});
 assert.equal(fresh.items[0].operating_memo,memo);

 const replay=await mergeSelectedMasters(f.env,owner,body);assert.equal(replay.replayed,true);assert.equal(replay.primaryOperatingMemo,memo);
 const moved=JSON.parse(f.db.prepare("SELECT list_snapshot_json FROM listing_sources WHERE id='O-B'").get().list_snapshot_json);
 assert.equal(moved.deposit,originalB.deposit);assert.equal(moved.rent,originalB.rent);
});

test('only pending selections stay pending; source-based confirmation is carried only without a pending marker',async t=>{
 for(const gongsilConfirmed of [false,true]){
  const f=fixture(t);f.db.exec("UPDATE listings SET operating_memo='(공실박스) / 대기 본문' WHERE id IN ('A','B')");
  f.db.exec("UPDATE listing_sources SET source='공실박스' WHERE listing_id='B'");
  if(gongsilConfirmed)f.db.exec("UPDATE listings SET operating_memo='출입 확인 메모' WHERE id='B'");
  const result=await mergeSelectedMasters(f.env,owner,{...f.body,duplicateMasterIds:['public-B']});
  const memo=f.db.prepare("SELECT operating_memo FROM listings WHERE id='A'").get().operating_memo;
  if(gongsilConfirmed){assert.match(memo,/^\(확인매물\)/);assert.doesNotMatch(memo,/\(공실박스\)/);}
  else{assert.doesNotMatch(memo,/\(확인매물\)/);assert.match(memo,/\(공실박스\)/);}
  assert.equal(result.confirmedVisit,gongsilConfirmed);
 }
});
