import test from'node:test';import assert from'node:assert/strict';import{speedDatabase}from'./fixtures/collector-speed-v64.mjs';import{buildD1SheetCsv,handleD1GetAction}from'../cloudflare/src/d1-api.js';
test('lease startup is the exact complete lease subset of the full CSV and source snapshot',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());
 for(const [id,trade]of[['lease-a','lease'],['lease-b','lease'],['sale-a','sale']]){
 f.db.prepare("INSERT INTO listings(id,property_id,title,address,status,trade_type,operating_memo,monthly_rent) VALUES(?,?,?,'검수동 1','active',?,'보존할 메모',55)").run(id,id,id,trade);
 f.db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,list_snapshot_json,raw_json,trade_type) VALUES(?,?,'네이버',?,1,?,'{}',?)").run('S-'+id,id,id,JSON.stringify({originalId:'S-'+id,source:'네이버',tradeType:trade,room:'1층',deposit:700,rent:55,images:['https://landthumb-phinf.pstatic.net/one.jpg'],photoCount:1}),trade);
 }
 const all=await buildD1SheetCsv(f.env),lease=await buildD1SheetCsv(f.env,null,true);const rows=all.trim().split('\r\n');assert.equal(lease.trim(),[rows[0],...rows.slice(1).filter(r=>!r.includes('sale-a'))].join('\r\n'));assert.ok(lease.includes('보존할 메모'));assert.ok(!lease.includes('sale-a'));
 const full=await handleD1GetAction(f.env,{}, {action:'unifiedListings'}),scoped=await handleD1GetAction(f.env,{}, {action:'unifiedListings',leaseOnly:true});
 assert.deepEqual(Object.keys(scoped.groups).sort(),['lease-a','lease-b']);assert.deepEqual(scoped.fields,full.fields);
 for(const id of Object.keys(scoped.groups)){assert.deepEqual(scoped.groups[id],full.groups[id]);assert.equal(scoped.sourceSnapshotKeys[id],full.sourceSnapshotKeys[id]);}
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM listings').get().n,3);
});

test('bounded lease-original pages retain exactly the prior inventory without a repeated master scan or source sort',async t=>{
 const f=speedDatabase();t.after(()=>f.db.close());
 const parent=f.db.prepare("INSERT INTO listings(id,property_id,title,address,status,trade_type) VALUES(?,?,?,'검수동 1',?,?)");
 const source=f.db.prepare("INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,list_snapshot_json,raw_json) VALUES(?,?,'네이버',?,?,?,'{}')");
 f.db.exec('BEGIN');
 for(let i=0;i<160;i++){
  const id='P'+i,trade=i%3?'lease':'sale',deleted=i%11===0,active=i%5!==0;
  parent.run(id,id,id,deleted?'deleted':'active',trade);
  source.run('S'+i,id,String(i),active?1:0,JSON.stringify({originalId:'S'+i,source:'네이버',tradeType:trade,room:'1층',rent:55,images:['https://landthumb-phinf.pstatic.net/one.jpg']}));
  if(!active)f.db.prepare("INSERT INTO listing_source_availability(source_id,kind,updated_at) VALUES(?,?,'2026-11-06T00:00:00Z')").run('S'+i,i%10?'census_missing':'legacy_unverified');
 }
 f.db.exec('COMMIT');
 const env={...f.env,SNAPSHOT_READ_PAGE_SIZE_V125:7};
 const before=f.db.prepare('SELECT total_changes() AS n').get().n;
 const current=await handleD1GetAction(env,{}, {action:'unifiedListings',leaseOnly:true});
 const statement=f.calls.find(c=>c.kind==='all'&&c.sql.includes('FROM listing_sources WHERE'))?.sql;
 assert.ok(statement);assert.ok(f.calls.filter(c=>c.kind==='all'&&c.sql===statement).length>2);
 const plan=f.db.prepare('EXPLAIN QUERY PLAN '+statement).all(0,7).map(r=>r.detail).join('\n');
 assert.match(plan,/INTEGER PRIMARY KEY \(rowid>\?\)/);
 assert.doesNotMatch(plan,/SCAN listings|MULTI-INDEX OR|TEMP B-TREE FOR ORDER BY/);
 const originalPrepare=f.env.DB.prepare;
 const oldEnv={...env,DB:{...f.env.DB,prepare(sql){
  if(sql.includes('FROM listing_sources WHERE'))sql=sql.replace(/AND COALESCE\(parent\.trade_type,'lease'\)<>'sale'\s*\)/,
   ") AND listing_id IN (SELECT id FROM listings WHERE COALESCE(trade_type,'lease')<>'sale')");
  return originalPrepare(sql);
 }}};
 const prior=await handleD1GetAction(oldEnv,{}, {action:'unifiedListings',leaseOnly:true});
 assert.deepEqual(current,prior,'IDs, source proofs, conditions, availability and all photo paths remain identical');
 assert.equal(f.db.prepare('SELECT total_changes() AS n FROM listings LIMIT 1').get().n,before);
});
