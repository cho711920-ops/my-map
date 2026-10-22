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
  f.db.prepare("INSERT INTO jobs(id,job_type,state,leased_until,progress_json) VALUES('listing-snapshot-build-v78:csv','listing-snapshot-build','running','2000-01-01T00:00:00Z','{}')").run();
  const entered=deferred(),release=deferred(),create=f.env.MEDIA.createMultipartUpload;
  f.env.MEDIA.createMultipartUpload=async(...args)=>{
    const upload=await create(...args),part=upload.uploadPart;
    upload.uploadPart=async(...values)=>{entered.resolve();await release.promise;return part(...values);};return upload;
  };
  const owner=buildSheetSnapshot(f.env,"csv","r");await entered.promise;
  f.db.prepare("UPDATE jobs SET progress_json=?,leased_until=? WHERE id='listing-snapshot-build-v78:csv'")
    .run(JSON.stringify({token:"new-owner"}),new Date(Date.now()+120000).toISOString());
  release.resolve();await assert.rejects(owner,/소유권/);
  assert.equal(f.objects.get("csv"),old);assert.equal(f.stats.completed,0);assert.equal(f.stats.aborted,1);
  const job=f.db.prepare("SELECT state,progress_json FROM jobs").get();
  assert.equal(job.state,"running");assert.equal(JSON.parse(job.progress_json).token,"new-owner");
});
