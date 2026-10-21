import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi, runCollectorMaintenance } from "../cloudflare/src/collector-api.js";

function database(t, beforeRun = async () => {}) {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(fs.readFileSync(new URL(file, migrations), "utf8"));
  }
  t.after(() => sqlite.close());
  const prepare = (sql, values = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, number) => {
      indexes.push(Number(number) - 1);
      return "?";
    });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return {
      sql,
      executeSync() { return {meta: {changes: Number(sqlite.prepare(compiled).run(...args()).changes)}}; },
      bind: (...parameters) => prepare(sql, parameters),
      async first() { return sqlite.prepare(compiled).get(...args()) || null; },
      async all() { return { results: sqlite.prepare(compiled).all(...args()) }; },
      async run() {
        await beforeRun(sql);
        return { meta: { changes: Number(sqlite.prepare(compiled).run(...args()).changes) } };
      }
    };
  };
  const env = { COLLECTOR_ACCESS_KEY: "test-only", DB: {
    prepare, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  } };
  const call = async (body, key = "test-only") => {
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", {
      method: "POST", headers: { Origin: "https://www.gongsilbox.com", "Content-Type": "application/json" },
      body: JSON.stringify({ collectorKey: key, ...body })
    }), env);
    return { status: response.status, result: await response.json() };
  };
  return { sqlite, env, call };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function record(id='one', address='서구 탄방동 678') {
  const list={Bfidx:id,TypeView:'상가',Ho:'107',Me:0,Bo:2000,Mm:150,Area:11};
  return {externalId:id,tradeType:'lease',listSnapshot:JSON.stringify(list),raw:{list},
    values:['검수상가',address,'107호','일반상가',2000,150,0,0,11,'','','합성 검수']};
}
async function body(records=[record()], extra={}) {
  const value={action:'gongsilImportBatch',requestId:'gongsil-session-batch-1',requestPolicyVersion:63,
    collectorVersion:'2.3.3',sessionId:'session',collectionTradeType:'lease',records,...extra};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  value.requestHashV63=Buffer.from(digest).toString('hex');
  return value;
}

test('concurrent reconnects to one Gongsil request execute once and return its exact durable receipt',async t=>{
  const entered=deferred(),release=deferred();let first=true;
  const f=database(t,async sql=>{
    if(first&&/INSERT INTO collector_sessions/.test(sql)){first=false;entered.resolve();await release.promise;}
  });
  const request=await body(),pending=f.call(request);await entered.promise;
  const second=await f.call(request);assert.equal(second.status,409);assert.equal(second.result.requestPending,true);
  release.resolve();const initial=await pending;
  assert.equal(initial.result.ok,true);assert.equal(initial.result.created,1);
  const replay=await f.call(request);assert.deepEqual(replay.result,initial.result);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM listing_sources').get().n,1);
  const totals=JSON.parse(f.sqlite.prepare('SELECT totals_json FROM collector_sessions').get().totals_json);
  assert.equal(totals.received,1);assert.equal(totals.created,1);
});

test('reusing a request ID with changed values fails before it can return another batch receipt',async t=>{
  const f=database(t);await f.call(await body());
  const changed=record();changed.values[5]=200;
  const mismatch=await f.call(await body([changed]));
  assert.equal(mismatch.status,409);assert.match(mismatch.result.message,/매물 내용이 다릅니다/);
  assert.equal(f.sqlite.prepare('SELECT monthly_rent FROM listings').get().monthly_rent,150);
});

test('tampered payload hashes and mismatched request/session IDs are rejected before any import starts',async t=>{
  const f=database(t),request=await body();request.records[0].values[5]=999;
  assert.equal((await f.call(request)).status,409);
  assert.equal((await f.call(await body(undefined,{requestId:'gongsil-other-batch-1'}))).status,400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM collector_sessions').get().n,0);
});

test('a mixed batch retains its successful advertisements and reports invalid addresses once',async t=>{
  const f=database(t),request=await body([record('a'),record('bad',''),record('b','서구 괴정동 1-1')]);
  const response=await f.call(request);
  assert.equal(response.result.ok,true);assert.equal(response.result.received,3);
  assert.equal(response.result.failed,1);assert.equal(response.result.created,2);
  assert.equal(response.result.errors.length,1);assert.match(response.result.errors[0].message,/지번주소/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM listings').get().n,2);
  assert.deepEqual((await f.call(request)).result,response.result);
});

test('Gongsil census counters and its exact receipt commit in the same SQLite transaction',async t=>{
  const f=database(t);let receipts=0;const ordinaryBatch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{
    if(!statements.some(s=>s.sql.includes('INSERT INTO mutation_results')))return ordinaryBatch(statements);
    assert.equal(statements.length,2);assert.match(statements[0].sql,/UPDATE collector_sessions/);
    f.sqlite.exec('BEGIN');
    try{const result=statements.map(s=>s.executeSync());f.sqlite.exec('COMMIT');receipts++;return result;}
    catch(error){f.sqlite.exec('ROLLBACK');throw error;}
  };
  const request=await body(),response=await f.call(request);
  assert.equal(response.result.ok,true);assert.equal(receipts,1);
  const saved=f.sqlite.prepare('SELECT result_json FROM mutation_results WHERE request_id=?').get(request.requestId);
  assert.deepEqual(JSON.parse(saved.result_json),response.result);
});

test('receipt transaction failures roll back counters and never become a successful collection',async t=>{
  const f=database(t),ordinaryBatch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{
    if(!statements.some(s=>s.sql.includes('INSERT INTO mutation_results')))return ordinaryBatch(statements);
    f.sqlite.exec('BEGIN');try{statements[0].executeSync();throw Error('synthetic receipt failure');}
    catch(error){f.sqlite.exec('ROLLBACK');throw error;}
  };
  const response=await f.call(await body());assert.equal(response.result.ok,false);
  assert.match(response.result.message,/receipt failure/);
  const totals=JSON.parse(f.sqlite.prepare('SELECT totals_json FROM collector_sessions').get().totals_json);
  assert.equal(Number(totals.received||0),0);
});

test('receipt status distinguishes missing and running writes without changing data',async t=>{
  const f=database(t),request=await body();
  const query={action:'mutationStatus',targetAction:'gongsilImportBatch',requestId:request.requestId};
  assert.equal((await f.call(query)).result.requestState,'missing');
  await f.call(request);
  f.sqlite.prepare("UPDATE mutation_results SET state='running',expires_at='' WHERE request_id=?").run(request.requestId);
  const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
  const status=(await f.call(query)).result;assert.equal(status.ready,false);assert.equal(status.requestState,'running');
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
});

test('old clients retain their live import contract while gaining atomic receipt storage',async t=>{
  const f=database(t),response=await f.call({action:'gongsilImportBatch',requestId:'legacy',sessionId:'legacy',
    collectorVersion:'2.3.2',collectionTradeType:'lease',records:[record()]});
  assert.equal(response.result.ok,true);assert.equal(response.result.created,1);
});

test('weekly expiry and deferred contacts are counted separately without postponing either refresh',async t=>{
  const f=database(t),records=[record('expired'),record('deferred'),record('fresh')];await f.call(await body(records));
  f.sqlite.prepare("UPDATE listing_sources SET last_collected_at=datetime('now','-8 days') WHERE source_listing_id LIKE 'expired%'").run();
  f.sqlite.prepare("UPDATE listing_sources SET list_snapshot_json=json_set(list_snapshot_json,'$.contactCaptureStatus','deferred') WHERE source_listing_id LIKE 'deferred%'").run();
  const result=await f.call({action:'classifySourceManifest',source:'공실박스',sessionId:'manifest',collectionTradeType:'lease',entries:records.map(r=>({sourceId:r.externalId,
    listSnapshot:r.listSnapshot,tradeType:'lease',room:'107호',deposit:2000,rent:150,area:11}))});
  assert.equal(result.result.ok,true);assert.deepEqual(result.result.refreshDetail.sort(),['deferred','expired']);
  assert.deepEqual(result.result.refreshReasons,{expired:1,contactDeferred:1,intervalDays:7});
});

test('a proven stale owning Gongsil session requires a new manifest without resolving or replaying the old claim',async t=>{
  const f=database(t),request=await body();await f.call(request);
  const now=Date.now(),closed=new Date(now-10*60_000).toISOString();
  f.sqlite.prepare("UPDATE mutation_results SET state='running',created_at=?,expires_at='' WHERE request_id=?")
    .run(new Date(now-3*3600_000).toISOString(),request.requestId);
  f.sqlite.prepare("UPDATE collector_sessions SET state='abandoned',started_at=?,updated_at=?,finished_at=?,error_json=? WHERE id=?")
    .run(new Date(now-4*3600_000).toISOString(),closed,closed,JSON.stringify({lastFailure:{type:'stale-session',at:closed}}),request.sessionId);
  const before=f.sqlite.prepare('SELECT * FROM listing_sources').all();
  const status=(await f.call({action:'mutationStatus',targetAction:'gongsilImportBatch',requestId:request.requestId})).result;
  assert.equal(status.ready,true);assert.equal(status.result.code,'gongsil_closed_session_rescan');
  assert.equal(status.result.requiresFreshManifest,true);assert.equal(status.result.ok,false);
  const replay=await f.call(request);assert.equal(replay.status,409);assert.equal(replay.result.requiresFreshManifest,true);
  assert.equal(f.sqlite.prepare('SELECT state FROM mutation_results').get().state,'running');
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM listing_sources').all(),before);
});

test('age alone and another owning source cannot release an uncertain Gongsil claim',async t=>{
  const f=database(t),request=await body();await f.call(request);
  f.sqlite.prepare("UPDATE mutation_results SET state='running',created_at=?,expires_at='' WHERE request_id=?")
    .run(new Date(Date.now()-3*3600_000).toISOString(),request.requestId);
  const query={action:'mutationStatus',targetAction:'gongsilImportBatch',requestId:request.requestId};
  assert.equal((await f.call(query)).result.ready,false);
  const closed=new Date(Date.now()-10*60_000).toISOString();
  f.sqlite.prepare("UPDATE collector_sessions SET source='네이버',state='abandoned',updated_at=?,finished_at=?,error_json=?")
    .run(closed,closed,JSON.stringify({lastFailure:{type:'stale-session',at:closed}}));
  assert.equal((await f.call(query)).result.ready,false);
});

