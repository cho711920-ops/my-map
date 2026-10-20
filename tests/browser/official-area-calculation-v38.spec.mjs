import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
    if(url.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(url.searchParams.get('action'))){
      const response=await route.fetch(),data=await response.json();
      for(const row of data.groups?Object.values(data.groups).flat():data.originals||[]){if(row.saleCategory==='building')row.saleDetails={...row.saleDetails,landAreaM2:null,grossAreaM2:null,saleExtent:'whole_building'};if(row.saleCategory==='land')row.saleDetails={...row.saleDetails,landAreaM2:null};}
      return route.fulfill({response,json:data});
    }
    if(url.searchParams.get('action')==='saleParcelFacts')return route.fulfill({json:{ok:true,pnu:url.searchParams.get('pnu'),address:url.searchParams.get('pnu').startsWith('30200')?'대전 유성구 장대동 4-4':'대전 서구 괴정동 3-3',landUse:'대',areaM2:330.5785,price:{available:true,wonPerM2:1000000,baseYear:2026,baseMonth:1},regulations:[],complete:true,source:'토지이음 · 가상 검수자료',fetchedAt:'2026-10-20T04:00:00Z'}});
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{
    window.__registerCalls=0;window.__registerPhase='normal';
    window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:address.includes('장대동')?'3020010700100040004':'3017010800100030003',links:{eum:'https://www.eum.go.kr',valuemap:'https://www.valueupmap.com'}});
    const building={lotAddress:'대전 서구 괴정동 3-3',buildingName:'검수 건물',managementKey:'test-one',registerType:'일반 · 일반건축물대장',siteArea:330.5785,totalArea:661.157,mainUse:'근린생활시설'};
    window.JSBuildingRegisterReadOnlyV6={cached:()=>null,load:async()=>{window.__registerCalls++;if(window.__registerPhase==='fail')throw Error('검수용 조회 실패');return {ok:true,source:'국토교통부 건축물대장',fetchedAt:'2026-10-20T04:00:00Z',buildings:window.__registerPhase==='multiple'?[building,{...building,managementKey:'test-two',buildingName:'별동',totalArea:330.5785}]:[building]};}};
  });
});
async function open(page,isMobile,mode){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(mode);if(isMobile)await page.locator('[data-mobile-view="list"]').click();await page.locator('#list .item-building-name').first().click();return page.locator('#unifiedDetailDrawerV8');}
test('missing ad areas calculate immediately after official lookup and are removed on failed refresh or address change',async({page,isMobile},info)=>{
  const drawer=await open(page,isMobile,'building_sale'),calc=drawer.locator('[data-sale-calculations-v38]'),panel=drawer.locator('[data-sale-section="register"]');
  const before=await page.evaluate(()=>JSON.stringify(allItems));expect(await page.evaluate(()=>__registerCalls)).toBe(0);
  await expect(calc).toContainText('산정 불가');await drawer.locator('.sale-area-lookup-v38').click();
  await expect(calc).toContainText('대지 기준 단가 · 대장 면적 기준');await expect(calc).toContainText('500만원/평');await expect(calc).toContainText('250만원/평');await expect(calc).toContainText('국토교통부 건축물대장');
  expect(await page.evaluate(()=>__registerCalls)).toBe(1);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await drawer.locator('[data-sale-group-sections*="workbench"]').click();
  await expect(calc.locator('dt').first()).toBeInViewport();
  await drawer.screenshot({path:info.outputPath('official-area-calculation.png'),animations:'disabled'});
  if(isMobile)await page.setViewportSize({width:320,height:844});expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.evaluate(()=>window.__registerPhase='fail');await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('조회 실패');await expect(calc).not.toContainText('500만원/평');
  await page.evaluate(()=>window.__registerPhase='normal');await panel.locator('[data-public-load]').click();await expect(calc).toContainText('500만원/평');
  await drawer.getByLabel('공적자료 조회용 지번',{exact:true}).fill('서구 괴정동 3-4');await drawer.locator('.sale-public-query-v6 button').click();await expect(calc).not.toContainText('500만원/평');
  await drawer.locator('[data-sale-section="register"] [data-public-load]').click();await expect(calc).toContainText('동일한 지번');await expect(calc).not.toContainText('500만원/평');
});
test('multiple buildings need a choice and scope confirmation, and never use shared site area',async({page,isMobile})=>{
  await page.evaluate(()=>window.__registerPhase='multiple');const drawer=await open(page,isMobile,'building_sale'),calc=drawer.locator('[data-sale-calculations-v38]');
  await drawer.locator('.sale-area-lookup-v38').click();const panel=drawer.locator('[data-sale-section="register"]');await expect(panel.locator('select')).toBeVisible();await expect(calc).not.toContainText('500만원/평');
  await panel.locator('select').selectOption('1');await expect(calc.locator('[data-confirm-official-area-v38]')).toHaveCount(1);await expect(calc).not.toContainText('500만원/평');
  await calc.locator('[data-confirm-official-area-v38]').check();await expect(calc).toContainText('연면적 기준 단가 · 대장 면적 기준');await expect(calc).toContainText('500만원/평');
  await expect(calc.locator('.sale-evidence-metrics-v36 > div').first()).toContainText('산정 불가');
  await panel.locator('select').selectOption('0');await expect(calc.locator('[data-confirm-official-area-v38]')).not.toBeChecked();await expect(calc).not.toContainText('250만원/평');
});
test('land official area fills the price denominator and building sales also expose a public land-price lookup',async({page,isMobile})=>{
  const drawer=await open(page,isMobile,'land_sale'),calc=drawer.locator('[data-sale-calculations-v38]');await expect(calc).toContainText('산정 불가');
  await drawer.locator('.sale-area-lookup-v38').click();await expect(calc).toContainText('토지 평당가 · 공부면적 기준');await expect(calc).toContainText('300만원/평');await expect(drawer.locator('.sale-public-land-price-v7')).toContainText('1,000,000');
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');if(isMobile)await page.locator('[data-mobile-view="list"]').click();await page.locator('#list .item-building-name').first().click();
  const land=drawer.locator('[data-sale-section="publicland"]');await expect(land.locator('[data-public-load]')).toHaveCount(1);
  await expect(land).toContainText('개별공시지가');expect(await page.evaluate(()=>__registerCalls)).toBe(0);
  await drawer.locator('.sale-area-lookup-v38').click();await expect(drawer.locator('[data-sale-calculations-v38]')).toContainText('500만원/평');
  await land.locator('[data-public-load]').click();await expect(land.locator('.sale-public-land-price-v7')).toContainText('1,000,000');
  await expect(drawer.locator('[data-sale-calculations-v38]')).toContainText('500만원/평');
});
