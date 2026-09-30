import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, read } from './fixtures/daangn-report-fixture.mjs';

function uiFixture() {
  const targets = [
    { key: 'lease-on', source: 'naver', label: '네이버 유성구', tradeType: 'lease', enabled: true },
    { key: 'sale-nav', source: 'naver', label: '네이버 유성구 매매', tradeType: 'sale', enabled: false },
    { key: 'lease-off', source: 'daangn', label: '당근 서구', tradeType: 'lease', enabled: false },
    { key: 'sale-new', source: 'daangn', label: '당근 유성구 매매', tradeType: 'sale', enabled: false, selectedCount: 1234 }
  ];
  const nodes = new Map();
  const context = {
    URL,
    state: { backgroundBuild: '1.1.11', config: { enabled: true, schedule: '11:00', targets }, runReports: {}, runReport: null },
    chrome: { runtime: { getManifest: () => ({ version: '1.1.11' }) } },
    selectedOnce: new Set(),
    runPreviewMode: 'all',
    runPreviewMarket: 'sale',
    runLaunchPending: false,
    keyForTarget: target => String(target.key || [target.source, target.district, target.url].join('|')),
    SOURCE_ORDER: ['naver', 'daangn', 'gongsil'],
    SOURCE_LABELS: { naver: '네이버', daangn: '당근', gongsil: '공실박스' },
    MARKET_LABELS: { lease: '상가임대', sale: '매매' },
    STATUS_TEXT: { pending: '대기', completed: '완료', partial: '부분완료', failed: '실패' },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } }
  };
  const ui = extract(read('edge-automation/extension/options.js'), [
    'compatibleWorker', 'marketForTarget', 'reportForMarket', 'escapeHtml', 'registeredTime', 'targetSummary',
    'reportItem', 'displayCounts', 'countText', 'statusDetail', 'failureGuidance', 'reportStatus',
    'renderDiagnostics', 'renderRunSummary', 'portableTarget', 'renderTarget', 'renderSourceGroups',
    'renderTargets', 'previewRows', 'renderDeferredReview'
  ], context);
  return { ui, context, targets, nodes };
}

test('market previews include manual-only registrations but never cross into the other market', () => {
  const { ui, context, nodes } = uiFixture();
  assert.deepEqual([...ui.previewRows()].map(target => target.key), ['sale-nav', 'sale-new']);
  assert.match(nodes.get('runPreviewTitle').textContent, /^매매/);
  assert.match(nodes.get('runPreviewHint').textContent, /상가임대 수집.*변경하지 않습니다/);
  assert.doesNotMatch(nodes.get('runPreviewBody').innerHTML, /네이버 유성구<\/b>|당근 서구/);
  assert.match(nodes.get('runPreviewBody').innerHTML, /1,234건/);
  context.runPreviewMarket = 'lease';
  assert.deepEqual([...ui.previewRows()].map(target => target.key), ['lease-on', 'lease-off']);
});

test('one-time selections and failed-target retry both stay in their own market', () => {
  const { ui, context } = uiFixture();
  context.selectedOnce.add('lease-on');
  context.selectedOnce.add('sale-new');
  context.runPreviewMode = 'selected';
  assert.deepEqual([...ui.previewRows()].map(target => target.key), ['sale-new']);
  context.state.runReports = {
    lease: { items: [{ key: 'lease-on', status: 'failed' }] },
    sale: { items: [{ key: 'sale-nav', status: 'partial' }, { key: 'sale-new', status: 'completed' }] }
  };
  context.runPreviewMode = 'failed';
  assert.deepEqual([...ui.previewRows()].map(target => target.key), ['sale-nav']);
  context.runPreviewMarket = 'lease';
  assert.deepEqual([...ui.previewRows()].map(target => target.key), ['lease-on']);
});

test('a later sale report does not replace the displayed lease results', () => {
  const { ui, context, targets } = uiFixture();
  const leaseItem = { key: 'lease-on', status: 'completed', counts: { processed: 100, expected: 100 } };
  const saleItem = { key: 'sale-nav', status: 'failed' };
  context.state.runReports = { lease: { items: [leaseItem] }, sale: { items: [saleItem] } };
  context.state.runReport = context.state.runReports.sale;
  assert.equal(ui.reportItem(targets[0]), leaseItem);
  assert.equal(ui.reportItem(targets[1]), saleItem);
  assert.match(ui.renderTarget(targets[0], 0), /100 \/ 100건 확인/);
});

test('legacy mixed reports are partitioned by registered market, without mutating history', () => {
  const { ui, context } = uiFixture();
  const items = [{ key: 'lease-on', status: 'completed' }, { key: 'sale-nav', status: 'failed' }];
  context.state.runReport = { items };
  assert.deepEqual([...ui.reportForMarket('lease').items].map(item => item.key), ['lease-on']);
  assert.deepEqual([...ui.reportForMarket('sale').items].map(item => item.key), ['sale-nav']);
  assert.equal(context.state.runReport.items.length, 2);
});

test('sale cards never have a schedule checkbox and lease manual selection is independent of scheduling', () => {
  const { ui, targets } = uiFixture();
  const sale = ui.renderTarget(targets[1], 1);
  assert.match(sale, /data-once="1"/);
  assert.doesNotMatch(sale, /data-toggle|disabled/);
  assert.match(sale, /자동수집 안 함/);
  const lease = ui.renderTarget(targets[2], 2);
  assert.match(lease, /data-once="2"/);
  assert.match(lease, /data-toggle="2"/);
  assert.doesNotMatch(lease, /disabled/);
  assert.match(lease, /자동실행 꺼짐 · 수동 수집 가능/);
});

test('market panels expose explicit scoped actions and keep busy actions disabled', () => {
  const { ui, context, targets } = uiFixture();
  const html = ui.renderTargets(targets);
  assert.match(html, /data-market="lease"/);
  assert.match(html, /data-market="sale"/);
  assert.match(html, /매일 11:00 자동실행/);
  for (const market of ['lease', 'sale']) {
    for (const mode of ['all', 'selected', 'failed']) {
      assert.match(html, new RegExp(`data-run-market="${market}" data-run-mode="${mode}"`));
    }
  }
  context.state.runState = { active: true };
  assert.equal((ui.renderTargets(targets).match(/data-run-mode="[a-z]+" disabled/g) || []).length, 6);
});

test('legacy market inference and export keep sales manual-only', () => {
  const { ui } = uiFixture();
  assert.equal(ui.marketForTarget({ url: 'https://new.land.naver.com/?tradeTypes=A1' }), 'sale');
  assert.equal(ui.marketForTarget({ url: 'https://realty.daangn.com/?af=%7B%22tradeTypes%22%3A%5B%22BUY%22%5D%7D' }), 'sale');
  assert.equal(ui.marketForTarget({ tradeType: 'lease', label: '네이버 매매', url: 'https://new.land.naver.com/?tradeType=A1' }), 'lease');
  assert.equal(ui.portableTarget({ tradeType: 'sale', enabled: true }).enabled, false);
  assert.equal(ui.portableTarget({ tradeType: 'lease', enabled: true }).enabled, true);
  assert.equal(ui.portableTarget({ tradeType: 'lease', enabled: false }).enabled, false);
});

test('old or unidentified background workers cannot enable any market run action', () => {
  const { ui, context, targets } = uiFixture();
  for (const backgroundBuild of [undefined, '', '1.1.10']) {
    context.state.backgroundBuild = backgroundBuild;
    assert.equal(ui.compatibleWorker(), false);
    assert.equal((ui.renderTargets(targets).match(/data-run-mode="[a-z]+" disabled/g) || []).length, 6);
  }
  context.state.backgroundBuild = '1.1.11';
  assert.equal(ui.compatibleWorker(), true);
  assert.equal((ui.renderTargets(targets).match(/data-run-mode="[a-z]+" disabled/g) || []).length, 0);
});

test('newly registered Daangn with no prior report has numeric registration baseline and no exception', () => {
  const { ui, targets } = uiFixture();
  assert.equal(ui.displayCounts(null, targets[3]).expected, 1234);
  assert.match(ui.countText(null, targets[3]), /0 \/ 1,234건 확인 \(등록 기준\)/);
  assert.match(ui.renderTarget(targets[3], 3), /아직 실행 기록 없음/);
});
