import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {speedDatabase} from "./fixtures/collector-speed-v64.mjs";
import {buildD1SheetCsv, handleD1GetAction} from "../cloudflare/src/d1-api.js";
import {buildSheetSnapshot, buildUnifiedSnapshot} from "../cloudflare/src/bounded-snapshot-build.js";
import worker from "../cloudflare/src/worker.js";
import {createSessionToken, SESSION_COOKIE} from "../cloudflare/src/security.js";

function fixture(t, count = 1, large = false) {
  const f = speedDatabase(); t.after(() => f.db.close());
  const insert = f.db.prepare(`INSERT INTO listings(id,property_id,title,address,status,trade_type,operating_memo,
    sale_details_json,version,updated_at) VALUES(?,?,?,'서구 검수동 1','active','sale',?,?,1,'2026-10-21T00:00:00Z')`);
  const source = f.db.prepare(`INSERT INTO listing_sources(id,listing_id,source,source_listing_id,active,
    list_snapshot_json,raw_json,trade_type) VALUES(?,?,'네이버',?,1,?,'{}','sale')`);
  f.db.exec("BEGIN");
  for (let i = 0; i < count; i++) {
    const id = "M" + i, memo = '보존, "메모"\r\n😀 ' + i + (large ? "가나다라abc".repeat(500) : "");
    insert.run(id,id,"검수"+i,memo,JSON.stringify({descriptionText:memo,totalDeposit:5000,monthlyIncome:253}));
    source.run("S"+i,id,String(100000+i),JSON.stringify({originalId:"S"+i,source:"네이버",tradeType:"sale",
      saleCategory:"building",salePrice:80000,deposit:5000,rent:253,room:"전체",saleDetails:{descriptionText:memo,totalDeposit:5000,monthlyIncome:253}}));
  }
  f.db.exec("COMMIT");
  const objects = new Map(), stats = {created:0,aborted:0,completed:0,sizes:[],failPart:0,readText:0};
  f.env.MEDIA = {
    async get(key) {
      const o = objects.get(key); if (!o) return null;
      return {...o,body:new ReadableStream({start(c){c.enqueue(o.bytes);c.close();}}),
        async text(){stats.readText++;throw Error("Full cached text must never be loaded");}};
    },
    async createMultipartUpload(key, metadata) {
      stats.created++; const parts = [];
      return {
        async uploadPart(partNumber, bytes) {
          stats.sizes.push(bytes.byteLength);
          if (stats.failPart === partNumber) throw Error("synthetic part failure");
          parts.push(Buffer.from(bytes));return {partNumber,etag:"part-"+partNumber};
        },
        async complete(uploaded) {
          assert.equal(uploaded.length,parts.length);
          for (const part of parts.slice(0,-1)) assert.equal(part.length,5*1024*1024);
          const bytes = Buffer.concat(parts);
          objects.set(key,{...metadata,bytes,httpEtag:'"'+createHash("sha256").update(bytes).digest("hex")+'"'});
          stats.completed++;
        },
        async abort(){stats.aborted++;}
      };
    }
  };
  return {...f,objects,stats};
}

test("large CSV streams identical complete UTF-8 bytes through fixed 5 MiB parts without database writes", async t => {
  const f = fixture(t,1401,true), before = f.db.prepare("SELECT total_changes() AS n").get().n;
  const expected = Buffer.from(await buildD1SheetCsv(f.env));
  await buildSheetSnapshot(f.env,"csv","before-query-revision");
  const actual = f.objects.get("csv");
  assert.deepEqual(actual.bytes,expected);
  assert.ok(actual.bytes.length > 20*1024*1024);
  assert.equal(actual.customMetadata.revision,"before-query-revision");
  assert.ok(f.stats.sizes.length > 3);
  assert.ok(f.stats.sizes.every(n => n <= 5*1024*1024));
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get().n,before);
});

test("a failed part preserves the previous cache, aborts unpublished parts, and releases the build for retry", async t => {
  const f = fixture(t,501,true), old = {bytes:Buffer.from("previous verified snapshot")};
  f.objects.set("csv",old);f.stats.failPart=2;
  await assert.rejects(buildSheetSnapshot(f.env,"csv","new"),/synthetic part failure/);
  assert.equal(f.objects.get("csv"),old);assert.equal(f.stats.aborted,1);assert.equal(f.stats.completed,0);
  f.stats.failPart=0;await buildSheetSnapshot(f.env,"csv","retry");
  assert.equal(f.stats.completed,1);assert.equal(f.objects.get("csv").customMetadata.revision,"retry");
});

test('two bounded uploads overlap latency but completion keeps byte order even when responses arrive out of order',async t=>{
  const f=fixture(t,701,true),expected=Buffer.from(await buildD1SheetCsv(f.env));
  let releaseFirst,active=0,peak=0;
  const secondStarted=new Promise(resolve=>{releaseFirst=resolve;});
  const stored=new Map(),finished=[];
  f.env.MEDIA.createMultipartUpload=async()=>({
    async uploadPart(number,bytes){
      active++;peak=Math.max(peak,active);assert.ok(active<=2);
      if(number===1)await secondStarted;
      stored.set(number,Buffer.from(bytes));finished.push(number);active--;
      if(number===2)releaseFirst();
      return {partNumber:number,etag:String(number)};
    },
    async complete(parts){
      assert.deepEqual(parts.map(p=>p.partNumber),Array.from({length:parts.length},(_,i)=>i+1));
      assert.deepEqual(Buffer.concat(parts.map(p=>stored.get(p.partNumber))),expected);
    },async abort(){throw Error('unexpected abort');}
  });
  await buildSheetSnapshot(f.env,'ordered','r');assert.equal(peak,2);
  assert.equal(finished[0],2);assert.equal(finished[1],1);
});

test("concurrent cold reads share only the exact environment and cache key; all originals and proof keys survive JSON serialization", async t => {
  const f = fixture(t,7), other = fixture(t,2), query = {action:"unifiedListings"};
  const expected = await handleD1GetAction(f.env,{},query);
  await Promise.all([buildUnifiedSnapshot(f.env,"unified","r",{},query),buildUnifiedSnapshot(f.env,"unified","r",{},query),
    buildSheetSnapshot(f.env,"csv","r"),buildUnifiedSnapshot(other.env,"unified","other",{},query)]);
  assert.equal(f.stats.created,2);assert.equal(other.stats.created,1);
  const text = f.objects.get("unified").bytes.toString();
  assert.ok(text.startsWith('{"ok":true,"version":2,"format":"compact-v2","fields":['));
  assert.deepEqual(JSON.parse(text),expected);
  assert.equal(JSON.parse(other.objects.get("unified").bytes).originalCount,2);
});

test("authenticated Worker cold/warm/forced/304 reads use the complete R2 stream and never load its full body", async t => {
  const f = fixture(t,3), env = {...f.env,ALLOWED_EMAILS:"snapshot-test@example.invalid",
    SESSION_SECRET:"synthetic-v66-secret-more-than-32-characters"};
  const token = await createSessionToken({email:env.ALLOWED_EMAILS,sub:"synthetic"},env);
  for (const action of ["sheet","data?action=unifiedListings"]) {
    const url="https://js-map.com/api/"+action;
    assert.equal((await worker.fetch(new Request(url),env)).status,401);
    const headers = {cookie:SESSION_COOKIE+"="+token};
    const cold=await worker.fetch(new Request(url,{headers}),env);
    assert.equal(cold.status,200);const bytes=Buffer.from(await cold.arrayBuffer());assert.ok(bytes.length);
    const count=f.stats.created;
    const warm=await worker.fetch(new Request(url,{headers}),env);
    assert.equal(warm.status,200);assert.deepEqual(Buffer.from(await warm.arrayBuffer()),bytes);
    assert.equal(f.stats.created,count);
    const unchanged=await worker.fetch(new Request(url,{headers:{...headers,"if-none-match":warm.headers.get("etag")}}),env);
    assert.equal(unchanged.status,304);
    const forced=await worker.fetch(new Request(url,{headers:{...headers,"x-js-force-refresh":"1"}}),env);
    assert.equal(forced.status,200);assert.deepEqual(Buffer.from(await forced.arrayBuffer()),bytes);
    assert.equal(f.stats.created,count+1);
  }
  assert.equal(f.stats.readText,0);
});
