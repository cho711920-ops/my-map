import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/operations-collection-v8.js', import.meta.url), 'utf8');
const start = source.indexOf('  function renderOperationsQuality() {');
const end = source.indexOf('  window.changeOperationsQualityState', start);
assert.ok(start >= 0 && end > start);
function render(row) {
  const host = {innerHTML: ''};
  vm.runInNewContext(source.slice(start, end) + '\nrenderOperationsQuality();', {
    document: {getElementById: () => host},
    extraState: {qualityState: 'open', quality: {rows: [row], summary: {openBlocking: 1}, offset: 0, total: 1}},
    number: value => Number(value || 0), formatAt: value => value,
    escape: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  });
  return host.innerHTML;
}
test('address-held sale cards use address guidance and do not show misleading rent terms', () => {
  const html = render({issueCode: 'address_lookup_unresolved', tradeType: 'sale', state: 'open', blocksPublication: true,
    reason: '주소 검색 불가 · 원본 주소 확인 보류', releaseSupported: false,
    releaseNotice: '정확한 원본 주소 확인과 좌표 보정을 먼저 완료해야 합니다. <검수>',
    deposit: 0, monthlyRent: 0, sources: [{source: '네이버', tradeType: 'sale', deposit: 0, monthlyRent: 0}]});
  assert.match(html, /주소 검색 불가 · 원본 주소 확인 보류/);
  assert.match(html, /정확한 원본 주소 확인과 좌표 보정을 먼저/);
  assert.match(html, /&lt;검수&gt;/);
  assert.match(html, /매매/);
  assert.doesNotMatch(html, /보증금|월세|0 \/ 0만원|openOperationsQualityReview\(/);
});
test('lease quality cards keep their existing rental terms and supported review action', () => {
  const html = render({tradeType: 'lease', releaseSupported: true, deposit: 3000, monthlyRent: 50,
    sources: [{source: '당근', tradeType: 'lease', deposit: 3000, monthlyRent: 50}]});
  assert.match(html, /보증금 3000 \/ 월세 50만원/);
  assert.match(html, /openOperationsQualityReview\(0\)/);
});
