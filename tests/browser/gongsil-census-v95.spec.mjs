import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const root='https://www.gongsilbox.com/__isolated_v95';
const loader=await fs.readFile(new URL('../../js/collector-loader.js',import.meta.url),'utf8');
const files=Object.fromEntries(await Promise.all(['gongsil-scope-capture.js','gongsil-census-v95.js','gongsil-collector.js'].map(async name=>[name,await fs.readFile(new URL('../../js/'+name,import.meta.url),'utf8')])));

async function setup(page,context) {
  const receipts=new Map(),finalizations=[],circles=[],scripts=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    const json=data=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
    if(url.href===root)return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>
      <button id="map">지도 확인</button><button id="all">전체 선택</button><script>
      window.providerIds=['one','two'];window.providerBody={btype:'Xone',level:13,search:{type:'상가'},
        areacoord:{minlat:36.2,minlng:127.2,maxlat:36.5,maxlng:127.5},removecoord:{minlat:0}};
      document.getElementById('map').onclick=()=>fetch('/api/maps/circle',{method:'POST',body:JSON.stringify(providerBody)}).then(r=>r.json());
      document.getElementById('all').onclick=()=>fetch('/api/maps/lists',{method:'POST',body:JSON.stringify({bfidxs:providerIds,bidxs:[],level:13,btype:'Xone'})}).then(r=>r.json());
      localStorage.setItem('js_gongsil_collector_access_key_v3','fixture-key');
      </script></body></html>`});
    if(url.hostname==='js-map.com'&&url.pathname.startsWith('/js/')) {
      const name=url.pathname.split('/').pop();scripts.push(name);
      if(files[name])return route.fulfill({contentType:'text/javascript; charset=utf-8',body:files[name]});
    }
    if(url.pathname==='/api/maps/circle') {
      const body=request.postDataJSON();circles.push(body);
      return json({res:'success',datas:{res:[{fidxs:body.areacoord.minlat===36.2?['one','two']:['one','two','outside']}]}});
    }
    if(url.pathname==='/api/maps/lists')return json({res:'success',datas:request.postDataJSON().bfidxs.map(Bfidx=>({Bfidx,Subtype:'3',Bo:1000,Mm:80,Area:20,Address:'대전 테스트동 1'})),more:false});
    if(url.hostname==='js-map.com'&&url.pathname==='/api/collector') {
      const body=request.postDataJSON();
      if(body.action==='mutationStatus')return json({ok:true,ready:true,result:receipts.get(body.requestId)});
      let result={ok:true};
      if(body.action==='classifySourceManifest')result={ok:true,needsDetail:[],refreshDetail:[],unchanged:body.entries.length};
      if(body.action==='finalizeCollectionSession') {
        finalizations.push(body);result={ok:true,complete:true,completionValidated:true,censusValidatedV95:true,presenceTracking:true,
          presenceScopeEstablished:finalizations.length===1,deactivated:0,adsReappeared:0,newSourceAds:0,newSourceAdsReported:true};
      }
      receipts.set(body.requestId,result);return json({ok:true,accepted:true});
    }
    return route.abort();
  });
  await page.goto(root);return {finalizations,circles,scripts,errors};
}

test('bookmark installs manual scope capture; full collection sends independent census and remembers its bounds',async({page,context},info)=>{
  const data=await setup(page,context);
  await page.addScriptTag({content:loader});
  await expect.poll(()=>page.evaluate(()=>window.__JS_GONGSIL_COLLECTOR__?.version)).toBe('2.3.4');
  expect(data.scripts).toEqual(['gongsil-scope-capture.js','gongsil-census-v95.js','gongsil-collector.js']);
  await expect(page.locator('[data-role="census"]')).toContainText('수집창을 먼저');
  await page.getByRole('button',{name:'지도 확인',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__JS_GONGSIL_SCOPE_CAPTURE_V1__?.capture?.groups?.length)).toBe(1);
  await page.getByRole('button',{name:'전체 선택',exact:true}).click();
  await expect(page.locator('[data-action="save"]')).toBeEnabled();
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('[data-role="census"]')).toContainText('광고 비교기준 저장');
  expect(data.finalizations[0].censusV95.ids).toEqual(['one','two']);
  expect(data.finalizations[0].providerObservedOffersV95).toHaveLength(2);
  expect(data.circles).toHaveLength(1);
  await page.screenshot({path:info.outputPath('census-baseline.png')});
  // A resized view keeps saving all selected rows, while absence proof is
  // confined to the pinned original bounds and never changes visible markers.
  await page.evaluate(()=>{providerBody.areacoord={minlat:36.1,minlng:127.1,maxlat:36.6,maxlng:127.6};providerIds=['one','two','outside'];});
  await page.getByRole('button',{name:'지도 확인',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture?.groups?.[0]?.fidxs?.length)).toBe(3);
  await page.getByRole('button',{name:'전체 선택',exact:true}).click();
  await expect(page.locator('[data-action="save"]')).toBeEnabled();
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('[data-role="census"]')).toContainText('광고 전체대조 완료');
  expect(data.finalizations[1].censusV95.ids).toEqual(['one','two']);expect(data.finalizations[1].observedSourceIds).toHaveLength(3);
  expect(data.circles).toHaveLength(3);expect(data.circles[2].areacoord.minlat).toBe(36.2);
  expect(await page.evaluate(()=>window.__JS_GONGSIL_SCOPE_CAPTURE_V1__.capture.groups[0].fidxs.length)).toBe(3);
  expect(data.errors).toEqual([]);
});

test('opening updated bookmark during a busy or pending run loads no dependency and preserves the running instance',async({page,context})=>{
  const data=await setup(page,context);
  await page.evaluate(()=>{window.oldRun={isBusy:()=>true,getPendingSave:()=>({records:[1]}),reopen:()=>{window.reopened=true;}};window.__JS_GONGSIL_COLLECTOR__=window.oldRun;window.beforeFetch=window.fetch;});
  await page.addScriptTag({content:loader});
  expect(await page.evaluate(()=>window.__JS_GONGSIL_COLLECTOR__===window.oldRun&&window.fetch===window.beforeFetch&&window.reopened)).toBe(true);
  expect(data.scripts).toEqual([]);expect(data.circles).toEqual([]);expect(data.errors).toEqual([]);
});
