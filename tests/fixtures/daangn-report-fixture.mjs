import fs from 'node:fs';
import vm from 'node:vm';
export const read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
export function extract(source, names, context = {}, indent = '') {
  const code = names.map(name => {
    const match = source.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?^${indent}}`, 'm'));
    if (!match) throw new Error(`Missing function ${name}`);
    return match[0];
  }).join('\n');
  vm.runInNewContext(code + '\nthis.api={' + names.join(',') + '}', context);
  return context.api;
}
export const background = extract(read('edge-automation/extension/background.js'),
  ['resultCounts', 'resultNotice', 'resultDiagnostics', 'cleanSource', 'completedTargetWithWarnings']);
export function result(found = 2078, processed = 42, addressMissing = 19) {
  return { ok: true, result: { source: 'daangn', partial: true,
    completionIssues: [`실패 ${addressMissing}건`, `주소·층 오류 ${addressMissing}건`],
    totals: { district: '유성구', status: 'complete', phase: 'complete', completeCollection: true,
      found, processed, skippedUnchanged: found - processed, failed: addressMissing, addressMissing,
      created: 1, updated: 0, review: 13,
      completionProof: { version: 1, listExhausted: true, expected: found, observed: found, processed: found },
      detailErrors: [{ sourceId: '2068835', message: '정확한 지번주소 없음', raw: { secret: 'never-render' } }]
    } } };
}
export function fixture() {
  const at = Date.parse('2026-08-28T02:30:00Z');
  const targets = ['유성구', '서구', '대덕구', '중구', '동구'].map((district, i) => ({
    source: 'daangn', key: 'daangn-' + i, district, label: '당근 ' + district,
    url: 'https://realty.daangn.com/', enabled: true, tradeType: 'lease', registeredAt: at
  }));
  const numbers = [[2078, 42, 19], [3876, 56, 27], [613, 15, 13], [641, 10, 5], [641, 27, 23]];
  const changes = [[1, 0, 13], [2, 1, 13], [1, 0, 1], [1, 0, 3], [1, 1, 2]];
  return { ok: true, backgroundBuild: '1.1.4', config: { enabled: true, closeTabs: true, schedule: '11:00', targets },
    runState: null, logs: [], runReport: { active: false, startedAt: at, items: targets.map((target, i) => {
      const run = result(...numbers[i]);
      [run.result.totals.created, run.result.totals.updated, run.result.totals.review] = changes[i];
      return { ...target, status: 'partial', finishedAt: at,
        message: background.resultNotice(run), counts: background.resultCounts(run),
        diagnostics: background.resultDiagnostics(run) };
    }) } };
}
