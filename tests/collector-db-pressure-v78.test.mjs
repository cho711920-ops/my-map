import test from "node:test";
import assert from "node:assert/strict";
import {speedDatabase,speedAd} from "./fixtures/collector-speed-v64.mjs";
import {handleCollectorApi} from "../cloudflare/src/collector-api.js";
import {runScheduledElevatorEnrichment} from "../cloudflare/src/elevator-enrichment.js";
import {commitCollectorSourceTransaction} from "../cloudflare/src/collector-source-transaction.js";

function fixture(t) {
  const f=speedDatabase();t.after(()=>f.db.close());f.env.COLLECTOR_ACCESS_KEY="fixture-only";
  f.call=async(body)=>{
    const response=await handleCollectorApi(new Request("https://js-map.com/api/collector",{method:"POST",
      headers:{Origin:"https://fin.land.naver.com","Content-Type":"application/json"},
      body:JSON.stringify({collectorKey:"fixture-only",...body})}),f.env);
    return {status:response.status,...await response.json()};
  };
  return f;
}
const step=statements=>statements.some(s=>s.sql.includes("INSERT INTO collector_source_write_receipts"));

test("a lost source COMMIT response is reconciled without missing rent, duplicate history or duplicate census counts",async t=>{
  const f=fixture(t),batch=f.env.DB.batch;let sourceAttempts=0;
  f.env.DB.batch=async statements=>{
    const result=await batch(statements);
    if(step(statements)&&++sourceAttempts===1)throw Error("D1_ERROR: Network connection lost.");
    return result;
  };
  const body={action:"saveNaverBatch",requestId:"v78-lost-commit",sessionId:"v78-sale",data:[{
    ...speedAd("네이버","sale"),salePrice:50000,description:"매매가 5억 보증금 합계 1,000만원 월 임대수입 101만원"}]};
  const result=await f.call(body);
  assert.equal(result.ok,true);assert.equal(result.failed,0);assert.equal(result.created,1);assert.equal(sourceAttempts,1);
  const first=f.db.prepare("SELECT COUNT(*) n FROM listing_history").get().n;
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_sources").get().n,1);
  const source=f.db.prepare("SELECT list_snapshot_json FROM listing_sources").get();
  assert.equal(JSON.parse(source.list_snapshot_json).saleDetails.monthlyIncome,101);
  const replay=await f.call(body);assert.equal(replay.created,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_history").get().n,first);
  const totals=JSON.parse(f.db.prepare("SELECT totals_json FROM collector_sessions WHERE id='v78-sale'").get().totals_json);
  assert.equal(totals.created,1);assert.equal(totals.newSourceAds,1);
});

test("queue overload before commit retries only the atomic source transaction, across lease and sale",async t=>{
  for(const market of ["lease","sale"]){
    const f=fixture(t),batch=f.env.DB.batch;let attempts=0;
    f.env.DB.batch=async statements=>{
      if(step(statements)&&++attempts===1)throw Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long.");
      return batch(statements);
    };
    const result=await f.call({action:"saveNaverBatch",requestId:"v78-overloaded-"+market,sessionId:market,data:[speedAd("네이버",market)]});
    assert.equal(result.ok,true);assert.equal(result.failed,0);assert.equal(result.created,1);assert.equal(attempts,2);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_sources").get().n,1);
  }
});

test("if both COMMIT response and first receipt read fail, the unique receipt rolls a duplicate transaction back",async t=>{
  const f=fixture(t),batch=f.env.DB.batch,prepare=f.env.DB.prepare;let attempts=0,failRead=true;
  f.env.DB.prepare=(sql)=>{
    const result=prepare(sql),bind=result.bind;
    result.bind=(...values)=>{
      const bound=bind(...values);
      if(sql.includes("SELECT result_json FROM collector_source_write_receipts")){
        const first=bound.first;
        bound.first=async()=>{if(failRead){failRead=false;throw Error("D1_ERROR: Network connection lost.");}return first();};
      }
      return bound;
    };return result;
  };
  f.env.DB.batch=async statements=>{
    if(step(statements))attempts++;
    const result=await batch(statements);
    if(step(statements)&&attempts===1)throw Error("D1_ERROR: Network connection lost.");
    return result;
  };
  const result=await f.call({action:"saveNaverBatch",requestId:"v78-receipt-read-fail",sessionId:"v78-read-fail",data:[speedAd("네이버","sale")]});
  assert.equal(result.failed,0);assert.equal(result.created,1);assert.equal(attempts,2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_sources").get().n,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_history WHERE action='collectorCreated'").get().n,1);
});

test("integrity failures roll back both source changes and the step receipt, and do not become successful saves",async t=>{
  const f=fixture(t);
  const statements=[f.env.DB.prepare("INSERT INTO listings(id,property_id) VALUES ('duplicate','duplicate')"),
    f.env.DB.prepare("INSERT INTO listings(id,property_id) VALUES ('duplicate','duplicate')")];
  await assert.rejects(commitCollectorSourceTransaction(f.env,statements,{requestId:"v78-integrity",source:"네이버",sourceId:"x",offset:0}),/UNIQUE/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM collector_source_write_receipts").get().n,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings").get().n,0);
});

test("active collection defers optional enrichment without querying listing or official-data tables",async t=>{
  const f=fixture(t);
  f.db.prepare("INSERT INTO collector_sessions(id,source,state,updated_at) VALUES('active','네이버','running',?)").run(new Date().toISOString());
  const result=await runScheduledElevatorEnrichment(f.env);
  assert.equal(result.deferred,"collector-active");assert.equal(result.changed,0);
  assert.equal(f.calls.length,1);assert.match(f.calls[0].sql,/collector_sessions/);
});

test("idle scheduled enrichment runs once per cooldown across separate Worker environments",async t=>{
  const f=fixture(t);
  const first=await runScheduledElevatorEnrichment(f.env);assert.equal(first.checked,0);
  f.reset();const other={...f.env,DB:{...f.env.DB}};
  assert.equal((await runScheduledElevatorEnrichment(other)).deferred,"not-due");
  assert.ok(f.calls.every(c=>!c.sql||!/(?:FROM|UPDATE) listings|FROM building_cache/.test(c.sql)));
  f.db.prepare("UPDATE jobs SET leased_until='2000-01-01T00:00:00Z'").run();
  assert.equal((await runScheduledElevatorEnrichment(other)).checked,0);
});

test("road and lot lookup use two indexes and preserve updates for all matching units",t=>{
  const f=fixture(t);
  const insert=f.db.prepare("INSERT INTO listings(id,property_id,address,road_address,status) VALUES(?,?,?,?,'active')");
  for(let i=0;i<2500;i++)insert.run(String(i),String(i),"검수동 "+i,"검수로 "+i);
  insert.run("lot","lot","대조동 1","다른로 2");insert.run("road","road","대조동 2","  대조로 1  ");
  const sql="UPDATE listings SET elevator_registry_checked_at='verified' WHERE status<>'deleted' AND ((?<>'' AND trim(COALESCE(road_address,''))=?) OR address=?) RETURNING id";
  const args=["대조로 1","대조로 1","대조동 1"];
  const plans=f.db.prepare("EXPLAIN QUERY PLAN "+sql).all(...args).map(p=>p.detail).join("\n");
  assert.doesNotMatch(plans,/SCAN listings/);assert.match(plans,/idx_listings_trimmed_road_address_v78/);assert.match(plans,/idx_listings_address/);
  assert.deepEqual(f.db.prepare(sql).all(...args).map(r=>r.id).sort(),["lot","road"]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings WHERE elevator_registry_checked_at='verified'").get().n,2);
});
