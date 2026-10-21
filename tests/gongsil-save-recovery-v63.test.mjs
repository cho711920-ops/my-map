import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {extract} from './fixtures/daangn-report-fixture.mjs';

const source = fs.readFileSync('js/gongsil-collector.js','utf8');
function storage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key)};
}
function batchHarness(overrides = {}) {
  const localStorage = storage(), posts = [], polls = [];
  const context = {crypto, TextEncoder, Uint8Array, VERSION:'2.3.3', SAVE_PENDING_KEY_V63:'pending', SAVE_PROGRESS_KEY:'progress', state:{pendingSave:{records}}, localStorage,
    text: value => String(value || ''), setStatus() {}, isBusyMutationResult: () => false,
    postAppsScriptWithRetry: async payload => posts.push(structuredClone(payload)),
    pollMutationStatus: async (...args) => { polls.push(args); return {ok:true,received:1}; },
    fetchMutationStatus: async () => ({ok:true,ready:false,requestState:'running'}), ...overrides};
  const api = extract(source,['sendAppsScriptBatch'],context,'  ');
  return {api,context,localStorage,posts,polls};
}
const records = [{externalId:'one',values:['test'],contactList:[{phone:'fixture-private-contact'}]}];
const metadata = {sessionId:'session',collectionTradeType:'lease'};

test('an upload timeout reconciles the same receipt without resending the batch or persisting personal data', async () => {
  let posts=0;
  const f=batchHarness({postAppsScriptWithRetry:async()=>{posts++;throw Error('upload timeout');}});
  assert.equal((await f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata)).ok,true);
  assert.equal(posts,1);assert.equal(f.polls.length,1);
  assert.equal(f.polls[0][0],'gongsil-session-batch-1');
  assert.equal(f.localStorage.getItem('pending'),null);
});

test('an uncertain receipt survives failure and a reconnect reads it instead of creating a new request', async () => {
  const f=batchHarness({pollMutationStatus:async()=>{throw Error('receipt pending');}});
  await assert.rejects(f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata),/pending/);
  const pending=f.localStorage.getItem('pending');
  assert.doesNotMatch(pending,/fixture-key|fixture-private-contact|contactList/);
  assert.equal(JSON.parse(pending).size,1);assert.equal(f.posts.length,1);
  f.context.pollMutationStatus=async()=>({ok:true,received:1});
  await f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata);
  assert.equal(f.posts.length,1);assert.equal(f.localStorage.getItem('pending'),null);
});

test('only a server-confirmed missing receipt reconnects with exactly the same ID and payload', async () => {
  const f=batchHarness({pollMutationStatus:async()=>{throw Error('pending');}});
  await assert.rejects(f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata));
  const first=f.posts[0];
  f.context.fetchMutationStatus=async()=>({ready:false,requestState:'missing'});
  f.context.pollMutationStatus=async()=>({ok:true,received:1});
  await f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata);
  assert.deepEqual(f.posts,[first,first]);
  assert.equal(first.requestPolicyVersion,63);
});

test('pending receipt content changes fail closed before any lookup or write', async () => {
  const f=batchHarness({pollMutationStatus:async()=>{throw Error('pending');}});
  await assert.rejects(f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata));
  f.context.fetchMutationStatus=()=>{throw Error('must not lookup a different batch');};
  await assert.rejects(f.api.sendAppsScriptBatch([{...records[0],values:['changed']}],'fixture-key',1,metadata),/원래 저장 지점/);
  assert.equal(f.posts.length,1);assert.ok(f.localStorage.getItem('pending'));
});

test('unavailable local storage blocks an upload before it can become an untracked write', async () => {
  const f=batchHarness({localStorage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});
  await assert.rejects(f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata),/quota/);
  assert.equal(f.posts.length,0);
});

test('a verified closed-session rescan clears only local resume pointers and never retries the old write', async () => {
  const f=batchHarness({pollMutationStatus:async()=>({ok:false,code:'gongsil_closed_session_rescan',requiresFreshManifest:true,message:'최신 전체목록 확인 필요'})});
  f.localStorage.setItem('progress','old checkpoint');
  await assert.rejects(f.api.sendAppsScriptBatch(records,'fixture-key',1,metadata),/최신 전체목록/);
  assert.equal(f.localStorage.getItem('pending'),null);assert.equal(f.localStorage.getItem('progress'),null);
  assert.equal(f.context.state.pendingSave,null);assert.equal(f.posts.length,1);
});

test('the upload deadline settles a hung fetch once, including runtimes without AbortController', async () => {
  for (const abortable of [true,false]) {
    let timer,posts=0,signal;
    const context={state:{stopRequested:false},COLLECTOR_API_URL:'https://example.invalid/collector',AbortController:abortable?AbortController:undefined,
      window:{setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){}}, originalFetch:(_url,options)=>{posts++;signal=options.signal;return new Promise(()=>{});}};
    const api=extract(source,['postAppsScriptWithRetry'],context,'  ');
    const pending=api.postAppsScriptWithRetry({requestId:'same'});
    timer();await assert.rejects(pending,/전송 응답/);assert.equal(posts,1);
    if(abortable)assert.equal(signal.aborted,true);
  }
});

test('safe stop forbids further advertisement uploads but permits its partial-session finalization', async () => {
  const actions=[],context={state:{stopRequested:true},AbortController,COLLECTOR_API_URL:'https://example.invalid',
    window:{setTimeout:()=>1,clearTimeout(){}},originalFetch:async(_url,init)=>{actions.push(JSON.parse(init.body).action);}};
  const api=extract(source,['postAppsScriptWithRetry'],context,'  ');
  await assert.rejects(api.postAppsScriptWithRetry({action:'gongsilImportBatch'}),/안전중단/);
  await api.postAppsScriptWithRetry({action:'finalizeCollectionSession',complete:false,stopped:true});
  assert.deepEqual(actions,['finalizeCollectionSession']);
});

function saveHarness(overrides = {}) {
  const localStorage=storage(),calls=[],finalized=[];
  const context={SAVE_PENDING_KEY_V63:'pending',SAVE_PROGRESS_KEY:'progress',SAVE_BATCH_SIZE:8,MIN_SAVE_BATCH_SIZE:1,MAX_SAVE_BATCH_SIZE:8,
    localStorage,state:{stopRequested:false},window:{setInterval:()=>1,clearInterval(){}},text:v=>String(v||''),
    importItemTotal:records=>records.length,getSavedProgressForRecords:()=>null,getCollectorKey:()=> 'fixture-key',createCollectionSessionId:()=> 'session',
    showGongsilSaveWait(){},setStatus(){},setProgress(){},updateDashboard(){},isBusyMutationError:()=>false,
    newSourceAdCounts:()=>({newSourceAds:null,newSourceAdsReported:false}),
    sendAppsScriptBatch:async batch=>{calls.push(batch.map(x=>x.externalId));localStorage.removeItem('pending');return {ok:true,received:batch.length,
      failed:batch.some(x=>x.externalId==='bad')?1:0,created:batch.filter(x=>x.externalId!=='bad').length,
      errors:batch.some(x=>x.externalId==='bad')?[{sourceId:'bad',message:'정확한 지번주소 없음'}]:[]};},
    finalizeGongsilSession:async (...args)=>{finalized.push(structuredClone(args));return {ok:true};},...overrides};
  const api=extract(source,['sendToAppsScript','collectionSignature','addImportResult'],context,'  ');
  return {api,context,localStorage,calls,finalized};
}

test('a partial batch never replays its successful siblings and its failed ad prevents complete finalization', async () => {
  const f=saveHarness(),input=Array.from({length:10},(_,i)=>({externalId:i===2?'bad':String(i)}));
  const result=await f.api.sendToAppsScript(input,{complete:true},'fixture-key');
  assert.deepEqual(f.calls,[input.slice(0,8).map(x=>x.externalId),input.slice(8).map(x=>x.externalId)]);
  assert.equal(result.failed,1);assert.equal(result.created,9);
  assert.equal(f.finalized[0][2],false);assert.equal(f.finalized[0][0].saveFailureReasons.length,1);
  assert.equal(f.finalized[0][0].processedCount,10);assert.equal(f.localStorage.getItem('progress'),null);
});

test('unknown transport results never cause an offset change, a smaller batch or another write', async () => {
  let calls=0;
  const f=saveHarness({sendAppsScriptBatch:async()=>{calls++;throw Error('uncertain transport');}});
  await assert.rejects(f.api.sendToAppsScript(Array.from({length:12},(_,i)=>({externalId:String(i)})),{},'fixture-key'),/uncertain/);
  assert.equal(calls,1);assert.equal(f.context.SAVE_BATCH_SIZE,8);assert.equal(f.localStorage.getItem('progress'),null);
});

test('resuming preserves the pending batch size after a page reload resets its adaptive size', async () => {
  const f=saveHarness({getSavedProgressForRecords:()=>({sessionId:'session',offset:0,batchIndex:0})});
  f.localStorage.setItem('pending',JSON.stringify({requestId:'gongsil-session-batch-1',size:3}));
  const input=Array.from({length:10},(_,i)=>({externalId:String(i)}));
  await f.api.sendToAppsScript(input,{},'fixture-key');
  assert.equal(f.calls[0].length,3);assert.deepEqual(f.calls.flat(),input.map(x=>x.externalId));
});

test('resume identity covers changes and reordering in the middle of a collection', () => {
  const api=extract(source,['collectionSignature'],{},'  '),a=[{externalId:'a'},{externalId:'middle',rent:50},{externalId:'z'}];
  assert.notEqual(api.collectionSignature(a),api.collectionSignature([a[0],{...a[1],rent:60},a[2]]));
  assert.notEqual(api.collectionSignature(a),api.collectionSignature([a[0],{externalId:'other'},a[2]]));
});

test('loading a new bookmark preserves a busy collector and its in-memory records', () => {
  const old={version:'old',isBusy:()=>true},context={location:{hostname:'www.gongsilbox.com'},window:{__JS_GONGSIL_COLLECTOR__:old},
    document:{getElementById:()=>null}};
  vm.runInNewContext(source,context);
  assert.equal(context.window.__JS_GONGSIL_COLLECTOR__,old);
});
