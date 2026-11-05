import test from 'node:test';import assert from 'node:assert/strict';import {speedDatabase} from './fixtures/collector-speed-v64.mjs';import {handleD1GetAction} from '../cloudflare/src/d1-api.js';import {packPhotoPaths} from '../cloudflare/src/photo-list-paths.js';import {buildUnifiedSnapshot} from '../cloudflare/src/bounded-snapshot-build.js';
const decode=p=>[p.thumbnail,...p.photoPathsV119.slice(3).split('\n').filter(Boolean).map(line=>{const n=line.indexOf(' ');return p.thumbnail.slice(0,Number(line.slice(0,n)))+line.slice(n+1);})];
test('packed photo paths preserve exact order and query strings while rejecting profiles',()=>{
 const images=['https://cdn.example/a-1.jpg?q=88','https://cdn.example/a-2.jpg?q=88','https://other.example/b.jpg'];const p=packPhotoPaths([...images,images[1],'https://cdn.example/avatars/profile.png']);assert.deepEqual(decode(p),images);assert.equal(p.photoCount,3);assert.ok(p.photoPathsV119.length<JSON.stringify(images).length);assert.equal(packPhotoPaths([]),null);
});
function fixture(t){const f=speedDatabase();t.after(()=>f.db.close());for(const id of ['A','B'])f.db.prepare("INSERT INTO listings(id,property_id,address,status) VALUES(?,?,'같은 지번','active')").run(id,id);
 for(const [id,parent,source,raw]of [['SA','A','네이버',{}],['SB','B','네이버',{}],['SG','A','공실박스',{list:{Photos:[{Photo:'2026/real-1.jpg'},{Photo:'2026/real-2.jpg'},{Photo:'avatars/person.png'}]},Xbfimg:'unrelated.jpg'}]])f.db.prepare('INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,list_snapshot_json,raw_json) VALUES(?,?,?,?,1,?,?)').run(id,parent,source,id,JSON.stringify({source,thumbnail:'old-thumb',photoCount:9}),JSON.stringify(raw));
 for(const [id,parent,source,url,order,status]of [['m2','A','SA','https://cdn.example/2.jpg',1,'external'],['m1','A','SA','https://cdn.example/1.jpg',0,'external'],['md','A','SA','https://cdn.example/deleted.jpg',2,'deleted'],['mb','B','SB','https://cdn.example/other-room.jpg',0,'external'],['mx','B','SA','https://cdn.example/wrong-parent.jpg',3,'external']])f.db.prepare('INSERT INTO listing_media(id,listing_id,source_id,external_url,sort_order,status) VALUES(?,?,?,?,?,?)').run(id,parent,source,url,order,status);
 return f;}
const expand=p=>Object.fromEntries(Object.entries(p.groups).map(([id,rows])=>[id,rows.map(row=>Object.fromEntries(p.fields.map((k,i)=>[k,row[i]])))]));
test('inventory and scoped reads include complete same-ad paths with no extra client photo request',async t=>{
 const f=fixture(t),before=f.db.prepare('SELECT total_changes() n').get().n;const all=await handleD1GetAction(f.env,{},{action:'unifiedListings'}),a=expand(all).A.find(o=>o.originalId==='SA');assert.deepEqual(decode(a),['https://cdn.example/1.jpg','https://cdn.example/2.jpg']);assert.equal(a.photoCount,2);assert.deepEqual(decode(expand(all).A.find(o=>o.originalId==='SG')),['https://file1.gongsilbox.com/file/land_photo/2026/real-1.jpg','https://file1.gongsilbox.com/file/land_photo/2026/real-2.jpg']);
 const scoped=await handleD1GetAction(f.env,{},{action:'listingOriginals',ids:'A'});assert.deepEqual(decode(expand(scoped.unified).A.find(o=>o.originalId==='SA')),decode(a));assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
});
test('bounded R2 serialization emits the same manifests and releases batches without changing stored ads',async t=>{
 const f=fixture(t),before=f.db.prepare('SELECT total_changes() n').get().n,expected=await handleD1GetAction(f.env,{},{action:'unifiedListings'});let bytes;const parts=[];f.env.MEDIA={async createMultipartUpload(){return {async uploadPart(n,b){parts.push(Buffer.from(b));return {partNumber:n,etag:String(n)};},async complete(){bytes=Buffer.concat(parts);},async abort(){throw Error('Unexpected abort');}};}};
 await buildUnifiedSnapshot(f.env,'test-photo-addresses','test-revision',{}, {action:'unifiedListings'});assert.deepEqual(JSON.parse(bytes.toString()),expected);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
});

test('photo batches seek source/parent indexes instead of rescanning historical inventory',async t=>{
 const f=fixture(t);await handleD1GetAction(f.env,{},{action:'unifiedListings'});
 const call=f.calls.find(call=>call.sql.includes('AS media_photos'));
 assert.ok(call);const sql=call.sql.replaceAll('?1','?');
 const plan=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(JSON.stringify(['A'])).map(row=>row.detail).join('\n');
 assert.match(plan,/idx_listing_sources_listing/);assert.match(plan,/idx_listing_media_source/);assert.doesNotMatch(plan,/SCAN s(?:\s|$)/);
});
