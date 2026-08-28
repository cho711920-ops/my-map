import test from 'node:test';
import assert from 'node:assert/strict';
import { background, result, extract, read, fixture } from './fixtures/daangn-report-fixture.mjs';
import { normalizedRecord, collectorCompletionAudit } from '../cloudflare/src/collector-api.js';

const context = { state: fixture(), STATUS_TEXT: { partial: '부분완료', completed: '완료' } };
const ui = extract(read('edge-automation/extension/options.js'),
  ['escapeHtml', 'registeredTime', 'displayCounts', 'countText', 'statusDetail', 'reportStatus', 'renderDiagnostics', 'renderRunSummary'], context);
const client = extract(read('js/daangn-collector.js'), ['jobDisplay'], {}, '  ');

for (const [found, details, held] of [[2078,42,19], [3876,56,27], [613,15,13], [641,10,5], [641,27,23]]) {
  test(`Aug28 census ${found} counts unchanged + detail processing, separately from ${held} held ads`, () => {
    const run = result(found, details, held);
    const counts = background.resultCounts(run);
    assert.equal(counts.expected, found); assert.equal(counts.processed, found);
    assert.equal(counts.unchanged, found - details); assert.equal(counts.detailProcessed, details);
    assert.equal(counts.addressDeferred, held); assert.equal(counts.failed, 0); assert.equal(counts.listComplete, true);
    assert.equal(background.completedTargetWithWarnings(run), true);
    const item = { source: 'daangn', status: 'partial', counts };
    assert.equal(ui.reportStatus(item), '완료·주소보류');
    assert.match(ui.countText(item), new RegExp(`주소 보류 ${held}`));
    assert.doesNotMatch(ui.countText(item), /오류/);
  });
}
test('actual network/save failure is never hidden by address exclusions', () => {
  const run = result(); run.result.totals.failed++;
  const counts = background.resultCounts(run);
  assert.equal(counts.failed, 1); assert.equal(counts.addressDeferred, 19);
  assert.equal(background.completedTargetWithWarnings(run), false);
  assert.match(background.resultNotice(run), /조회·저장 실패 1건/);
  assert.match(client.jobDisplay(run.result.totals).title, /실패/);
});
test('a missing or inconsistent census proof never gets the completed-address-held label', () => {
  for (const change of [j => delete j.completionProof, j => j.completionProof.listExhausted = false,
    j => j.skippedUnchanged--, j => j.completionProof.processed--]) {
    const run = result(); change(run.result.totals);
    const counts = background.resultCounts(run);
    assert.equal(counts.listComplete, false);
    assert.equal(ui.reportStatus({ status: 'partial', counts }), '부분완료');
    assert.doesNotMatch(background.resultNotice(run), /전체 목록 확인 완료/);
  }
});
test('old reports expose detail count as detail count, never invent unchanged or full completion', () => {
  const item = { source: 'daangn', status: 'partial', counts: { processed: 42, expected: 2078, failed: 19 },
    message: '목록 처리 완료 · 확인사항: 실패 19건, 주소·층 오류 19건' };
  assert.match(ui.countText(item), /이전 기록: 대상 2,078 · 상세 처리 42건/);
  assert.match(ui.countText(item), /주소 보류 19/);
  assert.doesNotMatch(ui.statusDetail(item), /오류|실패 19/);
  assert.equal(ui.reportStatus(item), '부분완료');
  assert.equal(item.counts.failed, 19); // display only; original history is intact
});
test('Naver and Gongsil legacy counts/zero values are preserved', () => {
  const counts = background.resultCounts({ result: { source: 'naver', session: {
    expectedCount: null, manifestCount: 1200, processedCount: 1200 }, totals: { created: 4, failed: 0 } } });
  assert.equal(counts.expected, 1200); assert.equal(counts.processed, 1200); assert.equal(counts.failed, 0);
  assert.equal(background.resultCounts({ result: { selectedCount: 797, processed: 797 } }).expected, 797);
});
test('report detail limits payload and escapes untrusted IDs/reasons', () => {
  const run = result();
  run.result.totals.detailErrors = Array.from({ length: 70 }, () => ({ sourceId: '"><script>alert(1)</script>', message: '<img onerror=alert(1)>', raw: 'secret' }));
  const diagnostics = background.resultDiagnostics(run);
  assert.equal(diagnostics.length, 60); assert.deepEqual(Object.keys(diagnostics[0]), ['sourceId', 'message']);
  const html = ui.renderDiagnostics({ diagnostics });
  assert.doesNotMatch(html, /<script>|<img|href=/); assert.match(html, /&lt;img/);
  assert.match(ui.renderDiagnostics({ diagnostics: background.resultDiagnostics(result()) }), /article_id=%222068835%22/);
});
test('summary never calls partial districts all normal', () => {
  const html = ui.renderRunSummary();
  assert.match(html, /정상 0 · 부분\/보류 5/); assert.match(html, /보류·실패 내역 확인/);
  assert.doesNotMatch(html, /<small>정상<\/small>/);
});
test('hidden coordinate, broker lot and complex road alone cannot fabricate a property lot', () => {
  const record = normalizedRecord('당근', { originalId: '2068835', isHideAddress: true,
    address: '대전광역시 동구 삼성동', publicJibunAddress: '대전광역시 동구 삼성동',
    bizProfile: { jibunAddress: '대전광역시 동구 신흥동 2-1' },
    complex: { buildingsForAddress: { edges: [{ node: { jibunAddress: null, roadAddress: '대전광역시 동구 대전로 935' } }] } },
    publicCoordinate: { lat: 36.34, lon: 127.41 }, trades: [{ type: 'MONTH', deposit: 1000, monthlyPay: 50 }], salesTypeV3: { type: 'STORE' } });
  assert.equal(record.address, ''); assert.equal(record.latitude, null); assert.equal(record.longitude, null);
  assert.equal(record.roadAddress, '대전광역시 동구 대전로 935');
});
test('full-census safety remains unchanged and next collection can retry held ads', () => {
  const body = { source: '당근', scope: '대전 유성구 완전수집', complete: true, validationVersion: 2,
    collectorVersion: '1.5.2', expectedCount: 2078, manifestCount: 2078, processedCount: 2078, failed: 19, addressMissing: 19 };
  assert.equal(collectorCompletionAudit(body, 2078).complete, true);
  assert.equal(collectorCompletionAudit({ ...body, failed: 20 }, 2078).complete, false);
  assert.equal(collectorCompletionAudit({ ...body, truncated: true }, 2078).complete, false);
  assert.match(read('cloudflare/src/collector-api.js'), /processing_state <> 'error'/);
});
test('manual collector separates address holds from failures and incomplete census', () => {
  const job = result().result.totals;
  assert.equal(client.jobDisplay(job).failed, 0); assert.equal(client.jobDisplay(job).checked, 2078);
  assert.match(client.jobDisplay(job).title, /주소 보류/);
  job.completeCollection = false;
  assert.match(client.jobDisplay(job).title, /목록 확인 필요/);
});
