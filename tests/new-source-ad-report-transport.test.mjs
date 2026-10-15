import test from 'node:test';
import assert from 'node:assert/strict';
import {background, result, extract, read} from './fixtures/daangn-report-fixture.mjs';
import {sanitizeAutomationRunReport} from '../cloudflare/src/automation-run-reports.js';

const ui = extract(read('edge-automation/extension/options.js'), ['displayCounts','countText'], {});
for (const source of ['naver','daangn','gongsil']) {
  test(`${source} report distinguishes new source ads from newly created masters, including zero`, () => {
    for (const count of [0,4]) {
      const run = source === 'daangn' ? result() : {result:{source,totals:{created:1}}};
      Object.assign(run.result.totals,{newSourceAds:count,newSourceAdsReported:true});
      const counts=background.resultCounts(run);
      assert.equal(counts.newSourceAds,count);
      assert.equal(counts.newSourceAdsReported,true);
      assert.equal(counts.created,1);
      const label=ui.countText({source,status:'completed',counts});
      assert.match(label,new RegExp(`신규광고 ${count}건`));
      assert.match(label,/통합신규 1/);
    }
  });
}

test('legacy, malformed and explicitly unreported ad counts are not reported as a known zero', () => {
  for(const fields of [{},{newSourceAds:7,newSourceAdsReported:false},
    {newSourceAds:null,newSourceAdsReported:true},{newSourceAds:-1,newSourceAdsReported:true},
    {newSourceAds:'4',newSourceAdsReported:true}]) {
    const counts=background.resultCounts({result:{source:'naver',totals:{created:3,...fields}}});
    assert.equal(counts.newSourceAdsReported,false);
    assert.equal(counts.newSourceAds,undefined);
    const label=ui.countText({source:'naver',status:'completed',counts});
    assert.doesNotMatch(label,/신규광고 \d/);
    assert.match(label,/통합신규 3/);
  }
});

test('progress snapshots carry an explicit measured ad count without manufacturing support for old stages', () => {
  const progress=extract(read('edge-automation/extension/background.js'),['progressCounts','cleanSource']);
  const base={found:10,processed:5,created:1};
  assert.equal(progress.progressCounts({source:'naver'},base).newSourceAds,undefined);
  const counted=progress.progressCounts({source:'naver'},{...base,newSourceAds:3,newSourceAdsReported:true});
  assert.equal(counted.newSourceAds,3);
  assert.equal(counted.newSourceAdsReported,true);
  const visible=ui.displayCounts({source:'naver',status:'running',counts:{},progressStage:{...base,newSourceAds:3,newSourceAdsReported:true}});
  assert.equal(visible.newSourceAds,3);
  assert.equal(visible.created,1);
});

test('cloud report keeps only supported ad counts and preserves unknown legacy status', async () => {
  const api=extract(read('edge-automation/extension/background.js'),['minimalAutomationReport'],{
    BACKGROUND_BUILD:'1.1.15',getConfig:async()=>({targets:[]}),automationReadiness:async()=>({}),
    targetKey:value=>value.key,inferredTradeType:()=> 'lease'
  });
  const now=Date.now();
  const local=await api.minimalAutomationReport({runId:`run-${now}-newsource`,updatedAt:now,
    startedAt:now,items:[{source:'naver',status:'completed',counts:{created:1,newSourceAds:4,newSourceAdsReported:true}},
      {source:'daangn',status:'completed',counts:{created:2,newSourceAds:6,newSourceAdsReported:false}}]});
  const cloud=sanitizeAutomationRunReport(JSON.parse(JSON.stringify(local)),now+1);
  for(const report of [local,cloud]){
    assert.equal(report.items[0].counts.newSourceAds,4);
    assert.equal(report.items[0].counts.newSourceAdsReported,true);
    assert.equal(report.items[0].counts.created,1);
    assert.equal(report.items[1].counts.newSourceAdsReported,false);
    assert.ok(report.items[1].counts.newSourceAds == null);
  }
});
