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
      method: "POST", headers: { Origin: "https://fin.land.naver.com", "Content-Type": "application/json" },
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

const listing = {
  articleNo: "987654", tradeType: "lease", category: "상가점포", buildingName: "검수상가",
  jibunAddress: "서구 갈마동 361-14", roomInfo: "1층", deposit: 1000, monthly: 100,
  areaSquareMeter: 66.1, managementFee: 5, description: "합성 검수용 매물", imageUrls: [],
  listSnapshot: "test-snapshot", latitude: 36.35, longitude: 127.37
};
const save = {
  action: "saveNaverBatch", requestId: "same-batch", sessionId: "same-session", data: [listing]
};

function closeOwningSession(f,sessionId,minutes=10){
  const now=Date.now(),closed=new Date(now-minutes*60_000).toISOString();
  f.sqlite.prepare(`UPDATE collector_sessions SET state='abandoned',started_at=?,updated_at=?,finished_at=?,error_json=? WHERE id=?`)
    .run(new Date(now-4*3600_000).toISOString(),closed,closed,JSON.stringify({lastFailure:{type:'stale-session',at:closed}}),sessionId);
}

test('a closed exact owning session requires a fresh census without releasing or replaying a possibly committed batch',async t=>{
  const f=database(t),sessionId='S-NAVER-1700000000000-test123',requestId=sessionId+'-batch-0-'+ 'a'.repeat(64);
  assert.equal((await f.call({...save,requestId,sessionId})).result.created,1);
  // Simulate the result ledger being lost after the advertisement was committed.
  f.sqlite.prepare("UPDATE mutation_results SET state='running',result_json='{}',created_at=?,expires_at='' WHERE request_id=?")
    .run(new Date(Date.now()-3*3600_000).toISOString(),requestId);
  closeOwningSession(f,sessionId);
  const before=f.sqlite.prepare('SELECT * FROM listing_sources').all();
  const status=await f.call({action:'mutationStatus',targetAction:'saveNaverBatch',requestId});
  assert.equal(status.result.ready,true);assert.equal(status.result.result.ok,false);
  assert.equal(status.result.result.requiresFreshManifest,true);
  assert.equal(status.result.result.code,'naver_closed_session_rescan');
  const replay=await f.call({...save,requestId,sessionId});assert.equal(replay.result.requiresFreshManifest,true);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM listing_sources').all(),before);
  assert.equal(f.sqlite.prepare('SELECT state FROM mutation_results WHERE request_id=?').get(requestId).state,'running');
  assert.equal(f.sqlite.prepare('SELECT state FROM collector_sessions WHERE id=?').get(sessionId).state,'abandoned');
  const fresh=await f.call({...save,requestId:'fresh-scan-batch',sessionId:'fresh-scan-session'});
  assert.equal(fresh.result.created,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM listings').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM listing_sources').get().n,1);
});

test('age alone, recent closure and a different owning source never resolve a running claim',async t=>{
  const f=database(t),sessionId='S-NAVER-1700000000000-test456',requestId=sessionId+'-batch-0-'+ 'b'.repeat(64);
  await f.call({...save,requestId,sessionId});
  f.sqlite.prepare("UPDATE mutation_results SET state='running',created_at=?,expires_at='' WHERE request_id=?")
    .run(new Date(Date.now()-3*3600_000).toISOString(),requestId);
  const status=()=>f.call({action:'mutationStatus',targetAction:'saveNaverBatch',requestId});
  assert.equal((await status()).result.ready,false);
  closeOwningSession(f,sessionId,1);assert.equal((await status()).result.ready,false);
  closeOwningSession(f,sessionId);f.sqlite.prepare("UPDATE collector_sessions SET source='당근' WHERE id=?").run(sessionId);
  assert.equal((await status()).result.ready,false);
  f.sqlite.prepare("UPDATE collector_sessions SET source='네이버',owner_email='other@example.test' WHERE id=?").run(sessionId);
  assert.equal((await status()).result.ready,false);
});

test('a closed Naver session cannot be resurrected by a new batch or manifest ID',async t=>{
  const f=database(t),sessionId='closed-session';await f.call({...save,sessionId});closeOwningSession(f,sessionId);
  for(const body of [{...save,requestId:'different-batch',sessionId},{action:'classifySourceManifest',requestId:'different-manifest',sessionId,source:'네이버',items:[]}]){
    const result=await f.call(body);assert.equal(result.status,409);assert.equal(result.result.requiresFreshManifest,true);
  }
  assert.equal(f.sqlite.prepare('SELECT state FROM collector_sessions WHERE id=?').get(sessionId).state,'abandoned');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM listings').get().n,1);
});

test("concurrent duplicate Naver save waits, then status and replay return the original result without orphan masters", async t => {
  const started = deferred();
  const release = deferred();
  let listingInserts = 0;
  const f = database(t, async sql => {
    if (!/^INSERT INTO listings\s/.test(sql.trim())) return;
    listingInserts += 1;
    started.resolve();
    await release.promise;
  });
  const original = f.call(save);
  await started.promise;
  assert.equal(f.sqlite.prepare("SELECT state FROM mutation_results WHERE request_id=?").get(save.requestId).state, "running");
  assert.equal(f.sqlite.prepare("SELECT expires_at FROM mutation_results WHERE request_id=?").get(save.requestId).expires_at, "");

  const duplicate = await f.call(save);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.result, {
    ok: false, requestPending: true,
    message: "같은 저장 요청이 처리 중입니다. 결과를 확인한 뒤 이어갑니다."
  });
  assert.equal(listingInserts, 1);
  const statusBody = { action: "mutationStatus", targetAction: "saveNaverBatch", requestId: save.requestId };
  assert.equal((await f.call(statusBody)).result.ready, false);
  assert.equal(f.sqlite.prepare("SELECT state FROM mutation_results WHERE request_id=?").get(save.requestId).state, "running");

  // Even a much later maintenance run cannot release an unresolved write.
  const maintenance = await runCollectorMaintenance(f.env, { now: "2099-01-01T00:00:00.000Z" });
  assert.equal(maintenance.expiredMutationsDeleted, 0);
  assert.equal(f.sqlite.prepare("SELECT state FROM mutation_results WHERE request_id=?").get(save.requestId).state, "running");
  release.resolve();
  const completed = await original;
  assert.equal(completed.status, 200);
  assert.equal(completed.result.created, 1);
  assert.equal(completed.result.failed, 0);
  const before = f.sqlite.prepare("SELECT COUNT(*) AS count FROM listing_history").get().count;
  const lateStatus = await f.call(statusBody);
  assert.equal(lateStatus.result.ready, true);
  assert.deepEqual(lateStatus.result.result, completed.result);
  const replay = await f.call(save);
  assert.deepEqual(replay, completed);
  assert.equal(listingInserts, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM listing_sources").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM listing_history").get().count, before);
  assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS count FROM listings l
    WHERE NOT EXISTS (SELECT 1 FROM listing_sources s WHERE s.listing_id=l.id)`).get().count, 0);
});

test("Naver save claim rejects unauthenticated and cross-owner/action request IDs without replacing their results", async t => {
  const f = database(t);
  assert.equal((await f.call(save, "incorrect-key")).status, 403);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM mutation_results").get().count, 0);
  const insert = f.sqlite.prepare(`INSERT INTO mutation_results
    (request_id, owner_email, action, state, result_json, created_at, expires_at) VALUES (?,?,?,?,?,?,?)`);
  insert.run("foreign-owner", "other@example.test", "saveNaverBatch", "running", '{"kept":true}', "2000-01-01", "");
  insert.run("foreign-action", "collector", "gongsilImportBatch", "completed", '{"kept":true}', "2000-01-01", "2099-01-01");
  for (const requestId of ["foreign-owner", "foreign-action"]) {
    const before = f.sqlite.prepare("SELECT * FROM mutation_results WHERE request_id=?").get(requestId);
    const rejected = await f.call({ ...save, requestId });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.result.requestPending, undefined);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM mutation_results WHERE request_id=?").get(requestId), before);
    const hidden = await f.call({ action: "mutationStatus", targetAction: "saveNaverBatch", requestId });
    assert.equal(hidden.result.ready, false);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
});

test("an old running Naver save is not reclaimed while an expired completed result keeps the existing expiration behavior", async t => {
  const f = database(t);
  const insert = f.sqlite.prepare(`INSERT INTO mutation_results
    (request_id, owner_email, action, state, result_json, created_at, expires_at) VALUES (?,?,?,?,?,?,?)`);
  insert.run("old-running", "collector", "saveNaverBatch", "running", "{}", "2000-01-01", "");
  insert.run("expired-completed", "collector", "saveNaverBatch", "completed", '{"ok":true,"created":99}', "2000-01-01", "2000-01-02");
  const pending = await f.call({ ...save, requestId: "old-running" });
  assert.equal(pending.status, 409);
  assert.equal(pending.result.requestPending, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
  const fresh = await f.call({ ...save, requestId: "expired-completed" });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.result.created, 1);
  assert.equal(f.sqlite.prepare("SELECT state FROM mutation_results WHERE request_id='old-running'").get().state, "running");
});

test("a claimed Naver save records its terminal error and legacy saves without request IDs remain supported", async t => {
  let sessionWrites = 0;
  const f = database(t, async sql => {
    if (/^INSERT INTO collector_sessions\s/.test(sql.trim()) && ++sessionWrites === 1) {
      throw new Error("synthetic D1 failure");
    }
  });
  const failed = await f.call(save);
  assert.equal(failed.status, 400);
  assert.deepEqual(failed.result, { ok: false, message: "synthetic D1 failure" });
  const status = await f.call({ action: "mutationStatus", targetAction: "saveNaverBatch", requestId: save.requestId });
  assert.equal(status.result.ready, true);
  assert.deepEqual(status.result.result, failed.result);
  const replay = await f.call(save);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.result, failed.result);
  assert.equal(sessionWrites, 1);
  const legacy = await f.call({ ...save, requestId: "" });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.result.created, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM mutation_results").get().count, 1);
});
