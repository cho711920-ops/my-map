import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { collectorDiagnostics } from '../cloudflare/src/collector-diagnostics.js';
import { collectorCompletionAudit } from '../cloudflare/src/collector-api.js';

const source = fs.readFileSync('js/gongsil-collector.js','utf8');
function funcs(text, names, context={}) {
  vm.runInNewContext(names.map(name => text.match(new RegExp('^  (?:async )?function '+name+'\\([^]*?^  }','m'))[0]).join('\n'),context);
  return context;
}
const client = funcs(source,['gongsilCompletionTitle','gongsilDiagnostics']);
test('market-qualified identities remain readable as provider numbers in diagnostics', () => {
  const rows = collectorDiagnostics([
    { sourceId: '네이버-123456::sale', message: '저장 실패' },
    { sourceId: 'abcdef::lease', message: '주소 확인' },
    { sourceId: '<img>::sale', message: '거부' }
  ]);
  assert.deepEqual(rows.map(row => row.sourceId), ['123456', 'abcdef', '']);
});
test('finished 797 capture clearly reports 10 excluded + 1 failure, not still running', () => {
  assert.equal(client.gongsilCompletionTitle({failed:1},10),'수집 완료 · 제외/실패 11건');
  assert.equal(client.gongsilCompletionTitle({failed:0},0),'수집·저장 완료');
  assert.equal(client.gongsilCompletionTitle({stopped:true},0),'공실박스 안전중단 완료');
});
test('per-listing reasons survive client finalization; bounded sanitized server result', () => {
  const result = client.gongsilDiagnostics({ listFailureReasons:[{sourceId:'123',message:'목록 없음'}],
    rejectedDetails:[{sourceId:'456',message:'매매가 없음'}], saveFailureReasons:[{sourceId:'789',message:'저장 실패'}] });
  assert.deepEqual(Array.from(collectorDiagnostics(result),r=>r.sourceId),['123','456','789']);
  assert.deepEqual(Array.from(collectorDiagnostics(result),r=>r.stage),['목록조회','필수정보','저장']);
  assert.match(source,/diagnostics: gongsilDiagnostics\(metadata\)/);
  const secret={sourceId:'<img>',message:'https://example.test/?token=secret collectorKey=private 010-1111-2222 a@b.test Bearer hidden'};
  const safe=collectorDiagnostics([secret,secret]);
  assert.equal(safe.length,1); assert.equal(safe[0].sourceId,'');
  assert.doesNotMatch(safe[0].message,/secret|private|hidden|1111|a@b/);
  assert.equal(collectorDiagnostics(Array.from({length:500},(_,i)=>({sourceId:String(i),message:'x'}))).length,200);
});
test('all-excluded records still finalize a partial session, without marking missing ads',async()=>{
  let saved;
  const context=funcs(source,['newSourceAdCounts','sendToAppsScript'],{
    importItemTotal:()=>10,collectionSignature:()=>'',getSavedProgressForRecords:()=>{throw new Error('empty checkpoint must not be reused');},
    state:{stopRequested:false},localStorage:{removeItem(){}},
    finalizeGongsilSession:async(...args)=>{saved=args;}, text:value=>String(value??'').trim()
  });
  const metadata={sessionId:'test',manifestRegistered:true,selectedCount:10,manifestCount:10,complete:true,rejectedCount:10};
  const result=await context.sendToAppsScript([],metadata,'test-key');
  assert.equal(result.ok,true); assert.equal(result.stopped,false); assert.equal(saved[2],false);
  assert.equal(saved[0].processedCount,10);
  const audit=collectorCompletionAudit({source:'공실박스',complete:true,validationVersion:2,expectedCount:797,
    manifestCount:796,processedCount:797,failed:1,requiredFieldRejected:10},796);
  assert.equal(audit.complete,false);
  assert.doesNotMatch(source,/throw new Error\(\s*"저장 가능한 매물이 없습니다/);
});
test('operations reasons are escaped and old missing diagnostics are not invented',()=>{
  const ops=funcs(fs.readFileSync('js/operations-collection-v8.js','utf8'),['collectionDiagnosticsHtml'],{
    number:v=>Number(v||0),escape:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;')
  });
  assert.match(ops.collectionDiagnosticsHtml({failed:1,requiredFieldRejected:10}),/이전 수집기는 개별 사유를 저장하지 않았습니다/);
  const html=ops.collectionDiagnosticsHtml({failed:1,diagnostics:[{sourceId:'123',stage:'저장',message:'<img onerror=bad>'}]});
  assert.match(html,/매물번호 123/); assert.doesNotMatch(html,/<img/);
  assert.equal(ops.collectionDiagnosticsHtml({}), '');
});

test('Naver operational failures cannot be cancelled by unrelated address exclusions', () => {
  const body = {source:'네이버', complete:true, validationVersion:2, scope:'대전 서구 전체',
    collectorVersion:'6.0.10', expectedCount:8316, manifestCount:8316, processedCount:8316,
    failed:1, addressMissing:81};
  const audit = collectorCompletionAudit(body,8316);
  assert.equal(audit.complete,false);
  assert.ok(audit.blockingIssues.includes('주소 외 실패 1건'));
  assert.equal(collectorCompletionAudit({...body, failed:0},8316).complete,true);
  assert.equal(collectorCompletionAudit({...body, source:'당근', failed:81},8316).complete,true);
});

test('Gongsil automatic results preserve server partial state and absence warnings', async () => {
  for (const complete of [false, true]) {
    const finalization = {ok:true, state:complete?'completed':'partial', complete,
      completionValidated:complete, completionIssues:complete?[]:['부분수집 요청']};
    const context=funcs(source,['runAutomaticTarget'],{
      panel:{style:{}}, state:{dashboard:{found:2783,processed:2783,failed:0},collectionTradeType:'lease'},
      setStatus(){}, getSelectedItemCount:()=>2783, emptyGongsilMapCapture:()=>({}),
      capturedGongsilPresenceScope:async()=>({}),
      collectAndSave:async()=>{context.state.lastResult={ok:true,finalization,
        presenceTrackingIssue:complete?'':'부분수집: 없어진 광고 판정 보류'};},
      newSourceAdCounts:()=>({}), VERSION:'2.3.2'
    });
    const result=await context.runAutomaticTarget({});
    assert.equal(result.partial,!complete);
    assert.equal(result.session.state,finalization.state);
    if (!complete) assert.ok(result.completionIssues.includes('부분수집 요청'));
  }
});

test('Naver diagnostics retain actual failure IDs ahead of address exclusions and sanitize on save', () => {
  const naver=fs.readFileSync('js/naver-collector.js','utf8');
  const context=funcs(naver,['addNaverDiagnostics'],{clean:v=>String(v??'').trim()});
  const totals={};
  context.addNaverDiagnostics(totals,Array.from({length:230},(_,i)=>({stage:'필수정보',sourceId:String(i),message:'주소 없음'})));
  context.addNaverDiagnostics(totals,[{stage:'상세조회',articleNo:'777',message:'조회 시간초과 https://example.test/?token=private'}]);
  assert.equal(totals.diagnostics.length,200);
  const safe=collectorDiagnostics(totals.diagnostics);
  assert.equal(safe[0].sourceId,'777');
  assert.doesNotMatch(safe[0].message,/private|https:/);
  assert.match(naver,/diagnostics: Array\.isArray\(metadata\.diagnostics\)/);
});

test('Naver automation returns a finalized partial result without losing its failure counts', async () => {
  const naver=fs.readFileSync('js/naver-collector.js','utf8');
  const finalResult={ok:true,state:'partial',complete:false,completeRequested:true,
    expectedCount:8316,processedCount:8316,failed:1,addressMissing:81,completionIssues:['실패 1건']};
  const context=funcs(naver,['runAutomatic'],{
    panel:{style:{}},state:{busy:false,preparing:false,dashboard:{failed:1}},VERSION:'6.0.10',
    isFinNaver:()=>true,DAEJEON_DISTRICTS:[{name:'서구',cortarNo:'30170'}],autoDistrictSelect:{},autoRegisterButton:{},
    newSourceAdCounts:()=>({}),
    collectFinSelectedAndSave:async()=>({ok:false,complete:false,finalResult,message:'실패 1건'})
  });
  const result=await context.runAutomatic({district:{name:'서구'}});
  assert.equal(result.partial,true);
  assert.equal(result.session.failed,1);
  assert.equal(result.totals.failed,1);
  finalResult.processedCount=100;
  await assert.rejects(context.runAutomatic({district:{name:'서구'}}),/실패 1건/);
});
