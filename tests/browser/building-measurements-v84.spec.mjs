import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
    if(u.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action'))){
      const response=await route.fetch(),data=await response.json();
      for(const row of data.groups?Object.values(data.groups).flat():data.originals||[])if(row.saleCategory==='building')row.saleDetails={...row.saleDetails,
        saleExtent:'whole_building',landAreaM2:223.5,buildingAreaM2:134.05,grossAreaM2:444.34,buildingCoverageRatio:59.98,floorAreaRatio:170.6};
      return route.fulfill({response,json:data});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{
    window.__areaLookupCalls=0;window.__areaLookupPhase='normal';
    window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3017010800100030003',links:{}});
    const b={lotAddress:'대전 서구 괴정동 3-3',buildingName:'검수용 건물',registerType:'일반건축물대장',siteArea:220,buildingArea:130,totalArea:440,buildingCoverageRatio:59.09,floorAreaRatio:165};
    window.JSBuildingRegisterReadOnlyV6={cached:()=>null,load:async()=>{window.__areaLookupCalls++;if(window.__areaLookupPhase==='fail')throw Error('조회 실패');return {ok:true,source:'국토교통부 건축물대장',fetchedAt:'2026-10-26T04:00:00Z',buildings:window.__areaLookupPhase==='multiple'?[b,{...b,buildingName:'별동',totalArea:300}]:[b]};}};
  });
});
async function open(page,isMobile,mode='building_sale'){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(mode);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#list .item-building-name').first().click();return page.locator('#unifiedDetailDrawerV8');
}

test('all five building measurements appear in primary detail without public API requests or data writes',async({page,isMobile},info)=>{
  if(!isMobile)await page.setViewportSize({width:1794,height:1000});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  const drawer=await open(page,isMobile),box=drawer.locator('[data-building-basics-v84]');
  await expect(box).toHaveCount(1);await expect(box.locator('[data-building-fact-v84]')).toHaveCount(5);
  for(const text of ['대지면적','건축면적','연면적','건폐율','용적률','59.98%','170.6%'])await expect(box).toContainText(text);
  await drawer.locator('.wide-detail-primary-v26 [data-sale-unit="m2"]').click();
  for(const [key,value]of [['landAreaM2','223.5㎡'],['buildingAreaM2','134.05㎡'],['grossAreaM2','444.34㎡']])await expect(box.locator('[data-building-fact-v84="'+key+'"]')).toContainText(value);
  const before=await page.evaluate(()=>JSON.stringify(allItems));
  if(!isMobile)await expect(box.locator('[data-building-fact-v84="landAreaM2"]')).toBeInViewport();
  expect(await page.evaluate(()=>__areaLookupCalls)).toBe(0);
  await drawer.screenshot({path:info.outputPath('building-basic-measurements.png'),animations:'disabled'});
  for(const width of isMobile?[390,320]:[1280,800]){await page.setViewportSize({width,height:900});expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toBe(0);expect(errors).toEqual([]);
});

test('official lookup complements the five facts, preserves source values, and clears failed or wrong-address results',async({page,isMobile})=>{
  const drawer=await open(page,isMobile),box=drawer.locator('[data-building-basics-v84]'),before=await page.evaluate(()=>JSON.stringify(allItems));
  await box.locator('[data-building-area-lookup-v84]').click();
  const official=box.locator('.sale-building-official-v84');await expect(official).toContainText('59.09%');await expect(official).toContainText('165%');
  await expect(box.locator(':scope > .sale-building-facts-v84')).toContainText('59.98%');
  expect(await page.evaluate(()=>__areaLookupCalls)).toBe(1);
  await page.evaluate(()=>window.__areaLookupPhase='fail');await drawer.locator('[data-sale-section="register"] [data-public-load]').click();
  await expect(official).toHaveCount(0);await expect(box).toContainText('59.98%');
  await page.evaluate(()=>window.__areaLookupPhase='normal');
  await drawer.getByLabel('공적자료 조회용 지번',{exact:true}).fill('서구 괴정동 3-4');await drawer.locator('.sale-public-query-v6 button').click();
  await drawer.locator('[data-sale-section="register"] [data-public-load]').click();await expect(official).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
});

test('multiple buildings require a choice before showing official whole-building facts',async({page,isMobile})=>{
  await page.evaluate(()=>window.__areaLookupPhase='multiple');const drawer=await open(page,isMobile),box=drawer.locator('[data-building-basics-v84]');
  await box.locator('button').click();const panel=drawer.locator('[data-sale-section="register"]');
  await expect(panel.locator('select')).toBeVisible();await expect(box.locator('.sale-building-official-v84')).toHaveCount(0);
  await panel.locator('select').selectOption('1');await expect(box.locator('.sale-building-official-v84')).toContainText('별동');
  await panel.locator('select').selectOption('');await expect(box.locator('.sale-building-official-v84')).toHaveCount(0);
});

test('unit unknowns are not inferred from generic area, and lease and land have no building facts panel',async({page,isMobile})=>{
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(!['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action')))return route.fallback();
    const response=await route.fetch(),data=await response.json();
    for(const row of data.groups?Object.values(data.groups).flat():data.originals||[])if(row.saleCategory==='building')row.saleDetails={scope:'unit',saleExtent:'unit',exclusiveAreaM2:59.5};
    return route.fulfill({response,json:data});
  });
  // Reopen with the changed original detail, as a fresh tablet/phone would.
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const drawer=await open(page,isMobile),box=drawer.locator('[data-building-basics-v84]');
  await expect(box).toContainText('매매 대상 전용면적');await expect(box).toContainText('매매 호실의 전용면적·대지권과 구분');
  await expect(box.locator('[data-building-fact-v84="landAreaM2"]')).toContainText('원본 미제공');await expect(box).not.toContainText('0%');
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  for(const mode of ['lease','land_sale']){await open(page,isMobile,mode);await expect(drawer.locator('[data-building-basics-v84]')).toHaveCount(0);await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();}
});
