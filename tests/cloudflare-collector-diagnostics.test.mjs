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
  const context=funcs(source,['sendToAppsScript'],{
    importItemTotal:()=>10,collectionSignature:()=>'',getSavedProgressForRecords:()=>{throw new Error('empty checkpoint must not be reused');},
    state:{stopRequested:false},localStorage:{removeItem(){}},
    finalizeGongsilSession:async(...args)=>{saved=args;}
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
