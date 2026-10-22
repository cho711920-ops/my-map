import test from 'node:test';
import assert from 'node:assert/strict';
import {extract,read} from './fixtures/daangn-report-fixture.mjs';
import {speedDatabase} from './fixtures/collector-speed-v64.mjs';
import {parseDaangnUrl} from '../cloudflare/src/collector-api.js';

const runId='run-1792661633103-fixture';
const url='https://realty.daangn.com/?cluster_id=REGION1154&js_district=유성구&af='+encodeURIComponent(JSON.stringify({tradeTypes:['BUY']}));
const parsed=parseDaangnUrl(url,'sale');
const names=['startDaangnJob','completedDaangnRunReusableV76','sameDaangnRunScopeV76','loadDaangnJob','saveDaangnJob','publicDaangnJob','stableJson','parseJson','clean'];
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
