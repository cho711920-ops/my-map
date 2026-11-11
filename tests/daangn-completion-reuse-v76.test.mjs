import test from 'node:test';
import assert from 'node:assert/strict';
import {extract,read} from './fixtures/daangn-report-fixture.mjs';
import {speedDatabase} from './fixtures/collector-speed-v64.mjs';
import {parseDaangnUrl} from '../cloudflare/src/collector-api.js';

const runId='run-1792661633103-fixture';
const url='https://realty.daangn.com/?cluster_id=REGION1154&js_district=유성구&af='+encodeURIComponent(JSON.stringify({tradeTypes:['BUY']}));
const parsed=parseDaangnUrl(url,'sale');
const names=['retryableDaangnCheckpointV190','recoverFailedDaangnCheckpointV190','startDaangnJob','completedDaangnRunReusableV76','sameDaangnRunScopeV76','loadDaangnJob','saveDaangnJob','publicDaangnJob','stableJson','parseJson','clean'];
function fixture(t){
  const f=speedDatabase();t.after(()=>f.db.close());let sessions=0;
  const api=extract(read('cloudflare/src/collector-api.js'),names,{
    Date,crypto,parseDaangnUrl,nowIso:()=>new Date().toISOString(),daangnJobId:()=> 'collector-daangn-fixture',
    ensureSession:async()=> 'DAANGN-fixture-'+(++sessions)
  });
  return {...f,api,sessions:()=>sessions,body:{url,tradeType:'sale',automationRunId:runId}};
}
function completed(job){return {...job,phase:'complete',status:'complete',completeCollection:true,
  found:2,processed:2,total:2,remaining:0,skippedUnchanged:0,failed:1,addressMissing:1,
  ids:['one','two'],pendingDetailIds:[],completionProof:{version:1,terminalReached:true,listComplete:true,
    scopeVerified:true,expectedCountKnown:false,observedUniqueCount:2,capturedAt:new Date().toISOString(),issueCodes:[]}};}

test('a lost automatic start response resumes its exact checkpoint without recreating the session',async t=>{
  const f=fixture(t);
  const first=await f.api.startDaangnJob(f.env,f.body);
  const job=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');
  job.page=4;job.found=400;job.ids=['one'];await f.api.saveDaangnJob(f.env,job);
  const second=await f.api.startDaangnJob(f.env,f.body);
  assert.equal(second.resumedCheckpoint,true);assert.equal(second.job.page,4);
  assert.equal(second.job.sessionId,first.job.sessionId);assert.equal(second.job.automationRunId,runId);
  assert.equal(f.sessions(),1);
});

test('completed census with address-only exclusions returns the same completion instead of starting over',async t=>{
  const f=fixture(t);await f.api.startDaangnJob(f.env,f.body);
  const job=completed(await f.api.loadDaangnJob(f.env,'collector-daangn-fixture'));
  await f.api.saveDaangnJob(f.env,job);f.reset();
  const recovered=await f.api.startDaangnJob(f.env,f.body);
  assert.equal(recovered.recoveredCompletion,true);assert.equal(recovered.job.status,'complete');
  assert.equal(recovered.job.sessionId,job.sessionId);assert.equal(recovered.job.addressMissing,1);
  assert.equal(f.sessions(),1);assert.ok(f.calls.every(call=>['first','all'].includes(call.kind)));
});

test('another automatic run and explicit manual collection create a fresh session rather than reusing yesterday completion',async t=>{
  for(const automationRunId of ['run-1792661633999-next','']){
    const f=fixture(t);await f.api.startDaangnJob(f.env,f.body);
    await f.api.saveDaangnJob(f.env,completed(await f.api.loadDaangnJob(f.env,'collector-daangn-fixture')));
    const result=await f.api.startDaangnJob(f.env,{...f.body,automationRunId});
    assert.equal(result.recoveredCompletion,undefined);assert.equal(result.job.status,'running');
    assert.equal(f.sessions(),2);
  }
});

test('scope, market, real save failures, incomplete coverage or proof never qualify as automatic completion',t=>{
  const f=fixture(t),base=completed({...parsed,automationRunId:runId});
  assert.equal(f.api.completedDaangnRunReusableV76(base,runId,parsed),true);
  for(const patch of [{automationRunId:'old'},{url:url+'x'},{tradeType:'lease'},{propertyFilter:{tradeTypes:['MONTH']}},
    {completeCollection:false},{failed:2},{processed:1},{phase:'details'},
    {completionProof:{...base.completionProof,terminalReached:false}},
    {completionProof:{...base.completionProof,observedUniqueCount:3}},
    {completionProof:{...base.completionProof,issueCodes:['incomplete']}}]){
    assert.equal(f.api.completedDaangnRunReusableV76({...base,...patch},runId,parsed),false,JSON.stringify(patch));
  }
});

test('client forwards a stable automatic run identity but manual collection has no reusable run identity',async()=>{
  const state={automaticRunning:true,automationRunId:runId,tradeType:'sale',selectedUrl:url};
  const bodies=[];
  const api=extract(read('js/daangn-collector.js'),['callServer'],{
    Date,Math,state,VERSION:'1.5.10',location:{href:url},getCollectorKey:()=> 'fixture-only',
    getScopedClientId:()=> 'fixture-client',
    postServerWithRetry:async body=>{bodies.push(body);return {ok:true,job:{status:'complete'}};}
  },'  ');
  await api.callServer('danggeunStartJob',{url});
  await api.callServer('danggeunRunJobChunk',{});
  state.automaticRunning=false;
  await api.callServer('danggeunStartJob',{url});
  assert.equal(bodies[0].automationRunId,runId);assert.equal(bodies[1].automationRunId,runId);
  assert.equal(bodies[2].automationRunId,'');
});


test('v190 a transient failed automatic job resumes its exact saved IDs and counters instead of starting a new session',async t=>{
  const f=fixture(t);const first=await f.api.startDaangnJob(f.env,f.body);
  const job=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');
  f.db.prepare("INSERT INTO collector_sessions(id,source,owner_email,state) VALUES(?,?,'collector','abandoned')").run(job.sessionId,'당근');
  Object.assign(job,{status:'failed',phase:'details',found:431,processed:304,skippedUnchanged:0,failed:50,addressMissing:50,
    ids:['saved','pending'],providerIds:['saved','pending'],detailIds:['saved','pending'],pendingDetailIds:['pending'],
    lastError:'heartbeat 120분 초과로 자동 종료',failedAt:new Date().toISOString()});
  await f.api.saveDaangnJob(f.env,job);
  const result=await f.api.startDaangnJob(f.env,f.body);
  assert.equal(result.resumedCheckpoint,true);assert.equal(result.job.status,'running');assert.equal(result.job.phase,'details');
  assert.equal(result.job.sessionId,first.job.sessionId);assert.equal(result.job.processed,304);assert.equal(result.job.addressMissing,50);
  assert.equal(f.sessions(),1);const saved=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');
  assert.deepEqual(Array.from(saved.pendingDetailIds),['pending']);assert.deepEqual(Array.from(saved.ids),['saved','pending']);
  assert.equal(f.db.prepare('SELECT state FROM collector_sessions WHERE id=?').get(job.sessionId).state,'running');
  assert.equal(saved.lastFailure.message,job.lastError);assert.equal(saved.lastError,undefined);
});


test('v190 authentication, schema and unknown failures keep their failed checkpoint without a fresh census',async t=>{
  for(const message of ['당근 API HTTP 오류: 403','PersistedQueryNotFound','필터 검증 오류','unknown failure']){
    const f=fixture(t);await f.api.startDaangnJob(f.env,f.body);const job=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');
    Object.assign(job,{status:'failed',phase:'list',page:4,lastError:message});await f.api.saveDaangnJob(f.env,job);
    await assert.rejects(()=>f.api.startDaangnJob(f.env,f.body),e=>e.statusCode===400);
    const saved=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');assert.equal(saved.page,4);assert.equal(saved.status,'failed');assert.equal(f.sessions(),1);
  }
});

test('v190 a completed session cannot be reopened by a stale failed job',async t=>{
  const f=fixture(t);await f.api.startDaangnJob(f.env,f.body);const job=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');
  f.db.prepare("INSERT INTO collector_sessions(id,source,owner_email,state) VALUES(?,?,'collector','completed')").run(job.sessionId,'당근');
  Object.assign(job,{status:'failed',phase:'details',processed:30,lastError:'HTTP 503'});await f.api.saveDaangnJob(f.env,job);
  await assert.rejects(()=>f.api.startDaangnJob(f.env,f.body),e=>e.statusCode===409);
  assert.equal((await f.api.loadDaangnJob(f.env,'collector-daangn-fixture')).status,'failed');
  assert.equal(f.db.prepare('SELECT state FROM collector_sessions WHERE id=?').get(job.sessionId).state,'completed');assert.equal(f.sessions(),1);
});

test('v190 a replacement between checkpoint read and recovery transaction is never overwritten',async t=>{
  const f=fixture(t);await f.api.startDaangnJob(f.env,f.body);const job=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');
  f.db.prepare("INSERT INTO collector_sessions(id,source,owner_email,state) VALUES(?,?,'collector','failed')").run(job.sessionId,'당근');
  Object.assign(job,{status:'failed',phase:'details',lastError:'HTTP 503'});await f.api.saveDaangnJob(f.env,job);
  const batch=f.env.DB.batch;let replaced=false;
  f.env.DB.batch=async statements=>{if(!replaced){replaced=true;await f.api.saveDaangnJob(f.env,{...job,automationRunId:'run-1792661633999-next'});}return batch(statements);};
  await assert.rejects(()=>f.api.startDaangnJob(f.env,f.body),e=>e.statusCode===409);
  const current=await f.api.loadDaangnJob(f.env,job._jobId);assert.equal(current.automationRunId,'run-1792661633999-next');assert.equal(current.status,'failed');
  assert.equal(f.db.prepare('SELECT state FROM collector_sessions WHERE id=?').get(job.sessionId).state,'failed');
});


test('v190 a same-run replacement session cannot be reported as the original resumed checkpoint',async t=>{
  const f=fixture(t);await f.api.startDaangnJob(f.env,f.body);const job=await f.api.loadDaangnJob(f.env,'collector-daangn-fixture');
  f.db.prepare("INSERT INTO collector_sessions(id,source,owner_email,state) VALUES(?,?,'collector','abandoned')").run(job.sessionId,'당근');
  Object.assign(job,{status:'failed',phase:'details',lastError:'HTTP 503'});await f.api.saveDaangnJob(f.env,job);
  const batch=f.env.DB.batch;let replaced=false;
  f.env.DB.batch=async statements=>{if(!replaced){replaced=true;await f.api.saveDaangnJob(f.env,{...job,status:'running',sessionId:'DAANGN-replacement'});}return batch(statements);};
  await assert.rejects(()=>f.api.startDaangnJob(f.env,f.body),e=>e.statusCode===409);
  assert.equal((await f.api.loadDaangnJob(f.env,job._jobId)).sessionId,'DAANGN-replacement');
  assert.equal(f.db.prepare('SELECT state FROM collector_sessions WHERE id=?').get(job.sessionId).state,'abandoned');
});
