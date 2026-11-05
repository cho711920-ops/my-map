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
