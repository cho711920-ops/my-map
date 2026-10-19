import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function open(page,isMobile,value){await mode(page,isMobile,value);await page.locator('#list .item-building-name').first().click();return page.locator('#unifiedDetailDrawerV8');}
async function seed(page,market){await page.evaluate(market=>{
  const base=window.allItems.find(i=>i.propertyId===(market==='land_sale'?'FIXTURE-LAND':'FIXTURE-BUILDING'));
  const items=Array.from({length:180},(_,i)=>({...base,key:'density-'+i,propertyId:'DENSITY-'+i,name:'매매 검수 '+i,originalId:'ORIGINAL-'+i,
    saleDetails:{...base.saleDetails,monthlyIncome:i%2?0:200,roadAccess:'8m 도로 광고',zoning:i%3?'일반주거지역':'검수용으로 긴 용도지역 표시'}}));
  const leases=window.allItems.filter(i=>i.tradeType!=='sale');window.allItems=leases.concat(items);window.JSUnifiedListingsV8.attach(window.allItems,{ok:true,groups:Object.fromEntries(window.allItems.map(i=>[i.propertyId,[{...i,originalId:i.originalId||i.propertyId+'-ORIGINAL',link:location.origin+'/original/'+i.propertyId,saleSummary:i.saleDetails,images:[],photoCount:0}]]))});document.getElementById('fixtureControls').hidden=true;
},market);}
for(const market of ['building_sale','land_sale'])test(market+' unified PC card preserves source facts, selection, contacts and virtual scroll',async({page,isMobile},info)=>{
  test.skip(isMobile,'The layout selector is PC-only.');
  const lease=await page.locator('#list .item').first().innerHTML();
  await seed(page,market);await mode(page,isMobile,market);
  const business=await page.evaluate(()=>JSON.stringify(window.allItems));
  const first=page.locator('#list .item').first(),height=await first.evaluate(e=>e.getBoundingClientRect().height);
  const phone=await first.locator('.item-phone').count()?first.locator('.item-phone'):first.locator('.item-action-left button').first();
  const phoneStyle=await phone.evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor]);
  await first.locator('.action-select-check').check();
  await page.locator('[data-sale-layout="card"]').click();
  await expect(first.locator('.sale-list-metrics-v16')).toBeVisible();
  expect(await first.evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(height+1);
  const title=await first.locator('.item-building-name').boundingBox(),cardBounds=await first.boundingBox();expect(title.x-cardBounds.x).toBeGreaterThan(25);
  expect(await phone.evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor])).toEqual(phoneStyle);
  await expect(first.locator('.action-select-check')).toBeChecked();
  await page.screenshot({path:info.outputPath(market+'-card.png')});
  await page.setViewportSize({width:720,height:800});await expect(page.locator('html')).not.toHaveAttribute('data-sale-list-compact-v8');
  await page.setViewportSize({width:1280,height:800});await expect(page.locator('html')).not.toHaveAttribute('data-sale-list-compact-v8');
  await page.evaluate(()=>{const s=window.getListingScrollContainerV2();s.scrollTop=6000;s.dispatchEvent(new Event('scroll'));});
  await expect.poll(()=>page.locator('#list .item').first().getAttribute('data-list-index-v1')).not.toBe('0');
  const anchor=await page.evaluate(()=>{const s=window.getListingScrollContainerV2(),top=s.getBoundingClientRect().top;const c=[...document.querySelectorAll('#list .item')].find(c=>c.getBoundingClientRect().bottom>top);return {id:c.dataset.propertyId,top:c.getBoundingClientRect().top};});
  await page.locator('[data-sale-layout="card"]').click();
  const target=page.locator('#list [data-property-id="'+anchor.id+'"]');
  expect(Math.abs(await target.evaluate(e=>e.getBoundingClientRect().top)-anchor.top)).toBeLessThan(3);
  const before=await page.evaluate(()=>window.getListingScrollContainerV2().scrollTop);
  await page.mouse.move(1100,550);await page.mouse.wheel(0,500);
  await expect.poll(()=>page.evaluate(()=>window.getListingScrollContainerV2().scrollTop)).toBeGreaterThan(before);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(business);
  await mode(page,isMobile,'lease');await expect(page.locator('#saleListLayoutV8')).toBeHidden();
  expect(await page.locator('#list .item').first().innerHTML()).toBe(lease);
});
test('grouped detail navigation has at most five groups and leaves lease detail alone',async({page,isMobile})=>{
  const drawer=await open(page,isMobile,'building_sale');
  expect(await drawer.locator('.sale-dossier-nav-v3 button').count()).toBeLessThanOrEqual(5);
  await expect(drawer.locator('.sale-dossier-nav-v3')).toContainText('공적자료');
  await drawer.locator('[data-sale-action="worksheet"]').click();
  const dialog=page.locator('#saleWorkbenchDialogV1');
  await expect(dialog.locator('.sale-scenarios-v8')).toBeVisible();
  for(const [key,value] of Object.entries({loan:'12000',interest:'4',vacancy:'5',expense:'10',acquisition:'1000',income:'250'}))await dialog.locator('[data-calc="'+key+'"]').fill(value);
  await expect(dialog.locator('[data-scenario-result]')).toContainText('187.5만원');
  await expect(dialog.locator('[data-scenario-result]')).toContainText('177.5만원');
  await expect(dialog.locator('[data-scenario-result]')).toContainText('162.5만원');
  await dialog.locator('[data-scenario-interest]').fill('2');await expect(dialog.locator('[data-calc="interest"]')).toHaveValue('4');
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
  await dialog.locator('[data-sale-close]').click();await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  await mode(page,isMobile,'lease');await page.locator('#list .item-building-name').first().click();
  await expect(drawer.locator('.sale-dossier-nav-v3')).toHaveCount(0);await expect(drawer.locator('[data-sale-action="report"]')).toHaveCount(0);
});
async function mockLand(page){
  await page.evaluate(()=>{window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3020010700100040004',links:{eum:'https://www.eum.go.kr/',valuemap:'https://www.valueupmap.com/'}});});
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleParcelFacts')return route.continue();
    return route.fulfill({json:{ok:true,pnu:u.searchParams.get('pnu'),address:'검수용 공개 필지',landUse:'대',areaM2:1243,price:{available:true,wonPerM2:986600,baseYear:2026,baseMonth:1},complete:true,regulations:[{key:'planning',label:'국토계획법',available:true,complete:true,items:[{label:'중로1류(폭20m~25m)(저촉)'}]}],source:'검수용 토지이음 가상자료',fetchedAt:'2026-10-18T00:00:00Z'}});
  });
}
test('land reference summary and road provenance reset on another lookup address',async({page,isMobile},info)=>{
  await mockLand(page);const drawer=await open(page,isMobile,'land_sale'),panel=drawer.locator('[data-sale-section="publicland"]');
  const before=await page.evaluate(()=>JSON.stringify(window.allItems));
  await panel.locator('[data-public-load]').click();await expect(drawer.locator('.sale-reference-summary-v8')).toContainText('토지면적');
  await expect(panel.locator('.sale-road-evidence-v8')).toContainText('중로1류');
  await expect(panel.locator('.sale-road-evidence-v8')).toContainText('광고 미제공');
  await drawer.locator('[data-sale-section-target="summary"]').click();
  await page.screenshot({path:info.outputPath('land-reference-summary.png')});
  await drawer.locator('[aria-label="공적자료 조회용 지번"]').fill('대전 유성구 장대동 5-5');await drawer.getByRole('button',{name:'주소 적용',exact:true}).click();
  await expect(drawer.locator('.sale-reference-summary-v8')).toHaveCount(0);
  await panel.locator('[data-public-load]').click();await expect(drawer.locator('.sale-reference-summary-v8')).toContainText('다른 지번');
  await expect(drawer.locator('.sale-reference-summary-v8 table')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(before);
});
test('single report prints official provenance and includes private notes only with explicit selection',async({page,isMobile},info)=>{
  await mockLand(page);const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-section="publicland"] [data-public-load]').click();
  let reads=0;await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='loadCloudState')return route.fallback();
    reads++;expect(u.searchParams.get('expectedAccountEmail')).toBe('browser-fixture@example.invalid');
    return route.fulfill({json:{ok:true,found:true,version:1,data:{note:'내 계정 전용 검토 메모'}}});
  });
  await page.evaluate(()=>{window.__reportPrinted=0;window.print=()=>window.__reportPrinted++;});
  await drawer.locator('[data-sale-action="report"]').click();const dialog=page.locator('.sale-single-report-dialog-v8');
  expect(reads).toBe(0);await expect(dialog.locator('[data-report-note-section]')).toBeHidden();
  await expect(dialog).toContainText('986,600원/㎡');await expect(dialog).toContainText('2026.01');
  await dialog.locator('[data-report-include-note]').check();await expect(dialog.locator('[data-report-note]')).toContainText('내 계정 전용 검토 메모');
  await dialog.locator('[data-report-include-note]').uncheck();await expect(dialog.locator('[data-report-note]')).toHaveText('');
  await dialog.locator('[data-report-print]').click();expect(await page.evaluate(()=>window.__reportPrinted)).toBe(1);
  await page.emulateMedia({media:'print'});await expect(page.locator('#wrap')).toBeHidden();await expect(dialog.locator('article')).toBeVisible();await expect(dialog.locator('[data-report-print]')).toBeHidden();
  await page.screenshot({path:info.outputPath('single-report-print.png'),fullPage:true});await page.emulateMedia({media:'screen'});
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
});
test('unchecking private notes prevents a late response from appearing in the report',async({page,isMobile})=>{
  const drawer=await open(page,isMobile,'building_sale');let release;
  await page.route('**/api/data?*',async route=>{if(new URL(route.request().url()).searchParams.get('action')!=='loadCloudState')return route.continue();await new Promise(r=>release=r);return route.fulfill({json:{ok:true,found:true,data:{note:'늦게 온 비공개 메모'}}});});
  await drawer.locator('[data-sale-action="report"]').click();const dialog=page.locator('.sale-single-report-dialog-v8');await dialog.locator('[data-report-include-note]').check();await expect.poll(()=>typeof release).toBe('function');await dialog.locator('[data-report-include-note]').uncheck();release();
  await expect(dialog.locator('[data-report-note]')).toHaveText('');await expect(dialog.locator('[data-report-note-section]')).toBeHidden();await expect(dialog.locator('[data-report-print]')).toBeEnabled();
});
test('building report includes the selected register and current photo but excludes a later-account memo',async({page,isMobile},info)=>{
  await page.route('**/test-report-photo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="green"/></svg>'}));
  await page.route('**/api/data?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    const response=await route.fetch(),data=await response.json();for(const original of data.originals||[])Object.assign(original,{images:['/test-report-photo.svg'],photoCount:1});return route.fulfill({response,json:data});
  });
  const drawer=await open(page,isMobile,'building_sale');
  await page.evaluate(()=>{
    window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3017010800100030003',links:{}});
    window.JSBuildingRegisterReadOnlyV6={cached:()=>null,load:async()=>({ok:true,queriedAt:'검수일시',source:'검수용 건축물대장',buildings:[{lotAddress:'대전 서구 괴정동 3-3',buildingName:'검수 별동',mainUse:'근린생활시설',structure:'철근콘크리트구조',siteArea:600,totalArea:800,indoorSelfParking:5,outdoorSelfParking:0,indoorMechanicalParking:0,outdoorMechanicalParking:0,passengerElevators:1,emergencyElevators:0}]})};
    window.print=()=>{};
  });
  await expect(drawer.locator('.unified-detail-hero-v8 img')).toHaveJSProperty('naturalWidth',30);
  await drawer.locator('[data-sale-section="register"] [data-public-load]').click();await expect(drawer.locator('.sale-reference-summary-v8')).toContainText('대지면적');
  await drawer.locator('[data-sale-action="report"]').click();const dialog=page.locator('.sale-single-report-dialog-v8');
  await expect(dialog).toContainText('5대');await expect(dialog).toContainText('철근콘크리트구조');await expect(dialog.locator('.sale-report-photo-v8')).toHaveCount(1);
  await page.route('**/api/data?*',async route=>new URL(route.request().url()).searchParams.get('action')==='loadCloudState'?route.fulfill({json:{ok:true,found:true,data:{note:'검수 계정 메모'}}}):route.continue());
  await dialog.locator('[data-report-include-note]').check();await expect(dialog.locator('[data-report-note]')).toHaveText('검수 계정 메모');
  await page.evaluate(()=>{window.JSAuthenticatedAccountEmail='different@example.invalid';});await dialog.locator('[data-report-print]').click();await expect(dialog.locator('[data-report-note]')).toHaveText('');
  await expect(dialog.locator('[data-report-status]')).toContainText('계정이 변경');
  await page.screenshot({path:info.outputPath('building-single-report.png')});
});
