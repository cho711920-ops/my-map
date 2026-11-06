import test from "node:test";
import assert from "node:assert/strict";
import {speedDatabase} from "./fixtures/collector-speed-v64.mjs";
import {buildSheetSnapshot} from "../cloudflare/src/bounded-snapshot-build.js";

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture(t){
  const f=speedDatabase();t.after(()=>f.db.close());
  f.db.prepare("INSERT INTO listings(id,property_id,title,address,status) VALUES('one','one','검수매물','검수동 1','active')").run();
  const objects=new Map(),stats={created:0,aborted:0,completed:0,heads:0};
  f.env.MEDIA={
    async head(key){stats.heads++;return objects.get(key)||null;},
    async createMultipartUpload(key,metadata){
      stats.created++;let parts=[];
      return {async uploadPart(number,bytes){parts.push(Buffer.from(bytes));return {partNumber:number,etag:String(number)};},
        async complete(){objects.set(key,{...metadata,bytes:Buffer.concat(parts)});stats.completed++;},
        async abort(){stats.aborted++;}};
    }
  };
  return {...f,objects,stats};
}

test("separate Worker environments share a cold listing build through its committed R2 token, without another full listing scan",async t=>{
  const f=fixture(t),entered=deferred(),release=deferred(),polled=deferred();
  const create=f.env.MEDIA.createMultipartUpload,head=f.env.MEDIA.head;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{const upload=await create(...args);entered.resolve();await release.promise;return upload;};
  f.env.MEDIA.head=async(...args)=>{polled.resolve();return head(...args);};
  const owner=buildSheetSnapshot(f.env,"csv","revision");await entered.promise;
  const other={...f.env,DB:{...f.env.DB}};
  const follower=buildSheetSnapshot(other,"csv","revision");await polled.promise;
  release.resolve();await Promise.all([owner,follower]);
  assert.equal(f.stats.created,1);assert.equal(f.stats.completed,1);
  assert.equal(f.calls.filter(c=>c.kind==="all"&&c.sql.includes("AS source_snapshot_proof")).length,1);
  const job=f.db.prepare("SELECT state,leased_until FROM jobs").get();
  assert.equal(job.state,"completed");assert.equal(job.leased_until,"");
  assert.ok(f.objects.get("csv").customMetadata.snapshotBuildToken);
});

test("a failed build preserves the previous complete object and releases its own lease for a later retry",async t=>{
  const f=fixture(t),old={bytes:Buffer.from("verified previous cache")};f.objects.set("csv",old);
  const create=f.env.MEDIA.createMultipartUpload;
  f.env.MEDIA.createMultipartUpload=async(...args)=>({...await create(...args),async uploadPart(){throw Error("synthetic upload failure");}});
  await assert.rejects(buildSheetSnapshot(f.env,"csv","r"),/synthetic upload failure/);
  assert.equal(f.objects.get("csv"),old);assert.equal(f.stats.aborted,1);
  assert.equal(f.db.prepare("SELECT state FROM jobs").get().state,"failed");
  f.env.MEDIA.createMultipartUpload=create;
  await buildSheetSnapshot({...f.env,DB:{...f.env.DB}},"csv","r");
  assert.equal(f.stats.completed,1);assert.notEqual(f.objects.get("csv"),old);
});

test("an expired snapshot lease can recover, while an old owner cannot publish or clear a newer owner's lease",async t=>{
  const f=fixture(t),old={bytes:Buffer.from("verified old cache")};f.objects.set("csv",old);
  f.db.prepare("INSERT INTO jobs(id,job_type,state,leased_until,progress_json) VALUES('listing-snapshot-build-v126:database','listing-snapshot-build','running','2000-01-01T00:00:00Z','{}')").run();
  const entered=deferred(),release=deferred(),create=f.env.MEDIA.createMultipartUpload;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{
    const upload=await create(...args),part=upload.uploadPart;
    upload.uploadPart=async(...values)=>{entered.resolve();await release.promise;return part(...values);};return upload;
  };
  const owner=buildSheetSnapshot(f.env,"csv","r");await entered.promise;
  f.db.prepare("UPDATE jobs SET progress_json=?,leased_until=? WHERE id='listing-snapshot-build-v126:database'")
    .run(JSON.stringify({token:"new-owner"}),new Date(Date.now()+120000).toISOString());
  release.resolve();await assert.rejects(owner,/소유권/);
  assert.equal(f.objects.get("csv"),old);assert.equal(f.stats.completed,0);assert.equal(f.stats.aborted,1);
  const job=f.db.prepare("SELECT state,progress_json FROM jobs").get();
  assert.equal(job.state,"running");assert.equal(JSON.parse(job.progress_json).token,"new-owner");
});
async function flush(){for(let i=0;i<24;i++)await Promise.resolve();}

test('a healthy shared build exceeding 40 seconds is awaited without duplicate scans or a premature 503',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const f=fixture(t),entered=deferred(),release=deferred(),polled=deferred();
  const create=f.env.MEDIA.createMultipartUpload,head=f.env.MEDIA.head;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{const u=await create(...args);entered.resolve();await release.promise;return u;};
  f.env.MEDIA.head=async(...args)=>{polled.resolve();return head(...args);};
  const owner=buildSheetSnapshot(f.env,'csv','r');await entered.promise;
  let outcome='pending';const follower=buildSheetSnapshot({...f.env,DB:{...f.env.DB}},'csv','r').then(()=>{outcome='ready';},e=>{outcome=e;});
  await polled.promise;
  for(let i=0;i<86;i++){t.mock.timers.tick(500);await flush();}
  assert.equal(outcome,'pending','live owner may legitimately need more than forty seconds');
  release.resolve();await owner; t.mock.timers.tick(500);await flush();await follower;
  assert.equal(outcome,'ready');assert.equal(f.stats.created,1);assert.equal(f.stats.completed,1);
});

test('a failed owner releases followers promptly instead of leaving every device waiting for the full deadline',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const f=fixture(t),entered=deferred(),release=deferred(),polled=deferred();
  const create=f.env.MEDIA.createMultipartUpload,head=f.env.MEDIA.head;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{const u=await create(...args);entered.resolve();await release.promise;return u;};
  f.env.MEDIA.head=async(...args)=>{polled.resolve();return head(...args);};
  const owner=buildSheetSnapshot(f.env,'csv','r');const oldOwner=assert.rejects(owner,/소유권/);await entered.promise;
  const follower=buildSheetSnapshot({...f.env,DB:{...f.env.DB}},'csv','r');
  const failure=assert.rejects(follower,{statusCode:503,code:'listing_snapshot_owner_unavailable'});await polled.promise;
  f.db.prepare("UPDATE jobs SET state='failed'").run();
  for(let i=0;i<6;i++){t.mock.timers.tick(500);await flush();}
  await failure;release.resolve();await oldOwner;
  assert.equal(f.stats.created,1);assert.equal(f.stats.completed,0);
});

test('followers follow a replacement lease token and accept its complete object, never the abandoned owner',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const f=fixture(t),entered=deferred(),release=deferred(),polled=deferred();
  const create=f.env.MEDIA.createMultipartUpload,head=f.env.MEDIA.head;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{const u=await create(...args);entered.resolve();await release.promise;return u;};
  f.env.MEDIA.head=async(...args)=>{polled.resolve();return head(...args);};
  const owner=buildSheetSnapshot(f.env,'csv','r'),oldOwner=assert.rejects(owner,/소유권/);await entered.promise;
  const follower=buildSheetSnapshot({...f.env,DB:{...f.env.DB}},'csv','r');await polled.promise;
  f.db.prepare("UPDATE jobs SET progress_json=?").run(JSON.stringify({token:'replacement'}));
  f.objects.set('csv',{customMetadata:{snapshotBuildToken:'replacement'},bytes:Buffer.from('complete replacement')});
  for(let i=0;i<6;i++){t.mock.timers.tick(500);await flush();}
  await follower;release.resolve();await oldOwner;
  assert.equal(f.stats.created,1);assert.equal(f.objects.get('csv').customMetadata.snapshotBuildToken,'replacement');
});

test('an unresponsive owner still has a finite follower deadline and never starts another full query',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const f=fixture(t),entered=deferred(),release=deferred(),polled=deferred();
  const create=f.env.MEDIA.createMultipartUpload,head=f.env.MEDIA.head;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{const u=await create(...args);entered.resolve();await release.promise;return u;};
  f.env.MEDIA.head=async(...args)=>{polled.resolve();return head(...args);};
  const owner=buildSheetSnapshot(f.env,'csv','r');await entered.promise;
  const follower=buildSheetSnapshot({...f.env,DB:{...f.env.DB}},'csv','r');
  const failure=assert.rejects(follower,{statusCode:503,code:'listing_snapshot_pending'});await polled.promise;
  for(let i=0;i<162;i++){t.mock.timers.tick(500);await flush();}
  await failure;assert.equal(f.stats.created,1);release.resolve();await owner;
});

test('different snapshot files serialize across separate Workers and then publish their own exact bytes',async t=>{
  const f=fixture(t),entered=deferred(),release=deferred(),polled=deferred();
  const create=f.env.MEDIA.createMultipartUpload,head=f.env.MEDIA.head;
  let active=0,maxActive=0;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{
    active++;maxActive=Math.max(maxActive,active);
    const upload=await create(...args),complete=upload.complete;
    upload.complete=async(...values)=>{await complete(...values);active--;};
    if(args[0]==='lease-csv'){entered.resolve();await release.promise;}
    return upload;
  };
  f.env.MEDIA.head=async(...args)=>{polled.resolve();return head(...args);};
  const first=buildSheetSnapshot(f.env,'lease-csv','lease-revision',true);await entered.promise;
  const second=buildSheetSnapshot({...f.env,DB:{...f.env.DB}},'all-csv','all-revision');await polled.promise;
  assert.equal(f.stats.created,1);release.resolve();await Promise.all([first,second]);
  assert.equal(maxActive,1);assert.equal(f.stats.completed,2);
  assert.equal(f.objects.get('lease-csv').customMetadata.revision,'lease-revision');
  assert.equal(f.objects.get('all-csv').customMetadata.revision,'all-revision');
  assert.notEqual(f.objects.get('lease-csv').customMetadata.snapshotBuildToken,f.objects.get('all-csv').customMetadata.snapshotBuildToken);
});

for(const committed of [false,true])test(`transient snapshot lease acquisition recovers without duplicate scans (committed=${committed})`,async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const f=fixture(t),prepare=f.env.DB.prepare;
  let failed=false;
  f.env.DB.prepare=(sql)=>{
    const statement=prepare(sql);
    if(!sql.startsWith('INSERT INTO jobs'))return statement;
    return {bind(...args){const bound=statement.bind(...args);return {async run(){
      if(!failed){failed=true;if(committed)await bound.run();throw Error('D1_ERROR: Network connection lost.');}
      return bound.run();
    }};}};
  };
  const work=buildSheetSnapshot(f.env,'csv','verified-revision');
  await flush();t.mock.timers.tick(1000);await flush();await work;
  assert.equal(f.stats.created,1);assert.equal(f.stats.completed,1);
  assert.equal(f.calls.filter(c=>c.kind==='all'&&c.sql.includes('AS source_snapshot_proof')).length,1);
  assert.equal(f.db.prepare('SELECT state FROM jobs').get().state,'completed');
});
