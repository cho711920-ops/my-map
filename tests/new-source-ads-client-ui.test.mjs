import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read=name=>fs.readFileSync('js/'+name,'utf8');
function functions(source,names,context={}) {
  const code=names.map(name=>{
    const match=source.match(new RegExp('^  (?:async )?function '+name+'\\([^]*?^  }','m'));
    assert.ok(match,name);return match[0];
  }).join('\n');
  vm.runInNewContext(code,context);return context;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const number=value=>Number(value||0);
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

test('all collector clients require an explicit supported counter and preserve known zero versus unrecorded',()=>{
  for (const file of ['naver-collector.js','daangn-collector.js','gongsil-collector.js']) {
    const api=functions(read(file),['newSourceAdCounts']);
    for (const result of [{},{newSourceAds:12},{newSourceAdsReported:true,newSourceAds:null},
      {newSourceAdsReported:false,newSourceAds:0},{newSourceAdsReported:true,newSourceAds:true},
      {newSourceAdsReported:true,newSourceAds:-1},{newSourceAdsReported:true,newSourceAds:1.5}]) {
      assert.deepEqual(plain(api.newSourceAdCounts(result)),{newSourceAds:null,newSourceAdsReported:false},file);
    }
    assert.deepEqual(plain(api.newSourceAdCounts({newSourceAdsReported:true,newSourceAds:0})),{newSourceAds:0,newSourceAdsReported:true});
    assert.equal(api.newSourceAdCounts({newSourceAdsReported:true,newSourceAds:12}).newSourceAds,12);
  }
});

test('web overview and scope table distinguish new ads from created masters and never present a partial known total as complete',()=>{
  const api=functions(read('operations-collection-v8.js'),['newSourceAdsText','resultCells','collectionDayHtml'],{
    number,escape,extraState:{collectionSource:'',collectionTrade:'',collectionDate:'2026-10-15'}
  });
  const html=api.resultCells({newSourceAdsReported:true,newSourceAds:8,created:2});
  assert.match(html,/<b>8<\/b><small>신규광고<\/small>/);
  assert.match(html,/<b>2<\/b><small>신규통합매물<\/small>/);
  assert.match(api.resultCells({created:7}),/<b>미기록<\/b><small>신규광고<\/small>/);
  assert.match(api.resultCells({newSourceAdsReported:true,newSourceAds:0}),/<b>0<\/b><small>신규광고<\/small>/);
  const table=api.collectionDayHtml({daySummary:{totals:{newSourceAdsReported:false,newSourceAds:null,
    newSourceAdsKnownTotal:8,unknownNewSourceAdsScopes:1},items:[{source:'네이버',scope:'서구',created:2,
      newSourceAdsReported:true,newSourceAds:8},{source:'당근',scope:'서구',created:1}]}});
  assert.match(table,/부분합이며 전체 합계가 아닙니다/);
  assert.match(table,/<th>신규광고<\/th><th>신규통합매물<\/th>/);
  assert.match(table,/<td>8<\/td><td>2<\/td>/);
  assert.match(table,/<td>미기록<\/td><td>1<\/td>/);
});

test('Naver and Gongsil dashboards do not turn old or unsupported results into zero new advertisements',()=>{
  for (const file of ['naver-collector.js','gongsil-collector.js']) {
    const nodes=new Map();
    const api=functions(read(file),['newSourceAdCounts','createEmptyDashboard','formatNumber','updateDashboard'],{
      panel:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}},state:{dashboard:{}}
    });
    api.state.dashboard=api.createEmptyDashboard();api.updateDashboard({created:3});
    assert.equal(nodes.get('[data-metric="newSourceAds"]').textContent,'미기록');
    api.updateDashboard({newSourceAdsReported:true,newSourceAds:0});
    assert.equal(nodes.get('[data-metric="newSourceAds"]').textContent,'0');
    api.updateDashboard({newSourceAdsReported:true,newSourceAds:9});
    assert.equal(nodes.get('[data-metric="newSourceAds"]').textContent,'9');
    api.updateDashboard({newSourceAdsReported:false,newSourceAds:null});
    assert.equal(nodes.get('[data-metric="newSourceAds"]').textContent,'미기록');
    assert.equal(api.state.dashboard.created,3);
  }
});

test('Naver automation keeps authoritative finalized new-ad counts rather than confusing them with dashboard-created masters',async()=>{
  const api=functions(read('naver-collector.js'),['newSourceAdCounts','runAutomatic'],{
    panel:{style:{}},state:{busy:false,preparing:false,dashboard:{created:2}},VERSION:'6.0.9',
    isFinNaver:()=>true,DAEJEON_DISTRICTS:[{name:'서구',cortarNo:'30170'}],autoDistrictSelect:{},autoRegisterButton:{},
    collectFinSelectedAndSave:async()=>({ok:true,complete:true,finalResult:{newSourceAdsReported:true,newSourceAds:19}})
  });
  const result=await api.runAutomatic({district:{name:'서구'}});
  assert.equal(result.totals.created,2);assert.equal(result.totals.newSourceAds,19);assert.equal(result.totals.newSourceAdsReported,true);
});

test('Gongsil finalized session totals survive both the save result and automatic result, including cumulative counts after resume',async()=>{
  const context={state:{stopRequested:false},importItemTotal:()=>0,collectionSignature:()=>'',localStorage:{removeItem(){}},
    finalizeGongsilSession:async()=>({newSourceAdsReported:true,newSourceAds:23,presenceTracking:true}),text:value=>String(value??'')};
  const api=functions(read('gongsil-collector.js'),['newSourceAdCounts','sendToAppsScript'],context);
  const saved=await api.sendToAppsScript([],{sessionId:'resumed',manifestRegistered:true,complete:true},'test-only');
  assert.equal(saved.created,0);assert.equal(saved.newSourceAds,23);assert.equal(saved.newSourceAdsReported,true);
  assert.match(saved.message,/신규광고 23/);
  const auto=functions(read('gongsil-collector.js'),['newSourceAdCounts','runAutomaticTarget'],{
    panel:{style:{}},state:{dashboard:{created:2,found:0,processed:0},collectionTradeType:'lease'},VERSION:'2.3.1',
    setStatus(){},emptyGongsilMapCapture:()=>({emptyMapConfirmed:true}),capturedGongsilPresenceScope:async()=>({}),
    getSelectedItemCount:()=>0,collectAndSave:async function(){this.state.lastResult=saved;}
  });
  // Function calls do not bind globalThis as `this` in strict contexts.
  auto.collectAndSave=async()=>{auto.state.lastResult=saved;};
  const result=await auto.runAutomaticTarget({tradeType:'lease'});
  assert.equal(result.totals.created,2);assert.equal(result.totals.newSourceAds,23);assert.equal(result.totals.newSourceAdsReported,true);
  assert.equal(result.session.newSourceAds,23);
});

test('Daangn job metrics show genuine new-ad counters separately and clear back to unrecorded',()=>{
  const nodes=new Map(),api=functions(read('daangn-collector.js'),['newSourceAdCounts','metric','renderJob','clearMetrics'],{
    state:{job:{newSourceAdsReported:true,newSourceAds:10,created:2,status:'complete'}},VERSION:'1.5.8',
    panel:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}},
    jobDisplay:()=>({failed:0,deferred:0,checked:0,title:'완료'}),setStatus(){},setProgress(){},startButton:{},stopButton:{}
  });
  assert.match(api.metric('newSourceAds','신규광고'),/>미기록<\/b>/);
  api.renderJob();assert.equal(nodes.get('[data-metric="newSourceAds"]').textContent,'10');
  assert.equal(nodes.get('[data-metric="created"]').textContent,'2');
  api.clearMetrics();assert.equal(nodes.get('[data-metric="newSourceAds"]').textContent,'미기록');
});
