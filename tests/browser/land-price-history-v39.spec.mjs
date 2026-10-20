import {test,expect} from '@playwright/test';
const history=Array.from({length:10},(_,i)=>2017+i).filter(y=>y!==2024).map(y=>({baseYear:y,baseMonth:1,wonPerM2:y===2026?986600:y===2025?969900:500000+(y-2017)*30000}));
history.unshift({baseYear:1990,baseMonth:1,wonPerM2:200000});history.splice(history.length-1,0,{baseYear:2025,baseMonth:7,wonPerM2:980000});
test.beforeEach(async({page,context})=>{
  page.__historyCalls=0;page.__factsCalls=0;page.__historyPhase='normal';
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
    const action=url.searchParams.get('action');
    if(action==='saleParcelFacts'){page.__factsCalls++;const pnu=url.searchParams.get('pnu');return route.fulfill({json:{ok:true,pnu,address:pnu.startsWith('30200')?'대전 유성구 장대동 4-4':'대전 서구 괴정동 3-3',landUse:'대',areaM2:330.5785,price:{available:true,wonPerM2:986600,baseYear:2026,baseMonth:1},regulations:[],complete:true,source:'토지이음 · 검수용 가상 자료',fetchedAt:new Date().toISOString()}});}
    if(action==='saleLandPriceHistory'){
      page.__historyCalls++;if(page.__historyPhase==='error')return route.fulfill({json:{ok:false,code:'history_unavailable',message:'검수용 이력 조회 실패'}});
      if(page.__historyPhase==='hold')await new Promise(resolve=>page.__releaseHistory=resolve);
      const pnu=url.searchParams.get('pnu');return route.fulfill({json:{ok:true,pnu,address:pnu.startsWith('30200')?'대전 유성구 장대동 4-4':'대전 서구 괴정동 3-3',records:history,source:'토지이음 · 검수용 가상 이력',fetchedAt:new Date().toISOString(),regionalAverages:{available:false}}});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:address.includes('장대동')?'3020010700100040004':'3017010800100030003',links:{eum:'https://www.eum.go.kr',valuemap:'https://www.valueupmap.com'}});});
});
async function open(page,isMobile,market){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);if(isMobile)await page.locator('[data-mobile-view="list"]').click();await page.locator('#list .item-building-name').first().click();return page.locator('#unifiedDetailDrawerV8');}
for(const market of ['building_sale','land_sale'])test(market+' shows real dated points, hover/touch details and controls without extra requests',async({page,isMobile},info)=>{
  const drawer=await open(page,isMobile,market);expect(page.__historyCalls).toBe(0);const original=await page.evaluate(()=>JSON.stringify(allItems));
  const panel=drawer.locator('[data-sale-section="publicland"]');await panel.locator('[data-public-load]').click();const chart=panel.locator('.land-price-history-v39');
  await expect(chart.locator('svg')).toBeVisible();await expect(chart.locator('.land-history-summary-v39')).toContainText('986,600원/㎡');await expect(chart.locator('.land-history-summary-v39')).toContainText('+1.72%');
  await expect(chart).toContainText('동·구 평균: 집계 자료 미연결');expect(page.__historyCalls).toBe(1);
  await chart.locator('[data-history-range="all"]').click();await expect(chart.locator('[data-history-point]')).toHaveCount(history.length);
  await chart.locator('[data-history-range="5"]').click();await expect(chart.locator('[data-history-point]')).toHaveCount(5);
  const last=chart.locator('[data-history-point]').last();if(isMobile)await last.tap();else await last.hover();
  await expect(chart.locator('[data-history-tip]')).toBeVisible();await expect(chart.locator('[data-history-tip]')).toContainText('2026.01');await expect(chart.locator('[data-history-tip]')).toContainText('986,600');
  await chart.locator('[data-history-unit="py"]').click();await expect(chart.locator('.land-history-summary-v39')).toContainText((986600*3.305785).toLocaleString('ko-KR',{maximumFractionDigits:2})+'원/평');
  await chart.locator('[data-history-point]').last().focus();await page.keyboard.press('ArrowLeft');await expect(chart.locator('[data-history-selection]')).toContainText('2025.07');await expect(chart.locator('[data-history-selection]')).toContainText('자료 없음');
  await chart.locator('summary').click();await expect(chart.locator('table')).toContainText('2023.01');await expect(chart.locator('table')).not.toContainText('2024.01');
  expect(page.__historyCalls).toBe(1);expect(page.__factsCalls).toBe(1);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(original);
  const ticks=await chart.locator('svg text[y="245"]').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};}));
  for(let i=1;i<ticks.length;i++)expect(ticks[i].left).toBeGreaterThanOrEqual(ticks[i-1].right);
  await chart.locator('summary').click();await chart.locator('svg').evaluate(e=>e.scrollIntoView({block:'center'}));
  await chart.locator('[data-history-point]').last().evaluate(e=>e.focus({preventScroll:true}));await page.screenshot({path:info.outputPath(market+'-history.png'),animations:'disabled'});
  if(isMobile)await page.setViewportSize({width:320,height:844});
  expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
});
test('failure stays unavailable and retry does not repeat the parcel facts request',async({page,isMobile})=>{
  page.__historyPhase='error';const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-section="publicland"] [data-public-load]').click();const chart=drawer.locator('.land-price-history-v39');
  await expect(chart.locator('[role="status"]')).toContainText('조회 실패');await expect(chart.locator('svg')).toHaveCount(0);await expect(chart).not.toContainText('0원');
  page.__historyPhase='normal';await chart.locator('[data-history-retry]').click();await expect(chart.locator('svg')).toBeVisible();expect(page.__historyCalls).toBe(2);expect(page.__factsCalls).toBe(1);
});
test('address replacement discards a late history response and keeps the new panel empty',async({page,isMobile})=>{
  page.__historyPhase='hold';const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-section="publicland"] [data-public-load]').click();await expect.poll(()=>typeof page.__releaseHistory).toBe('function');
  await drawer.getByLabel('공적자료 조회용 지번',{exact:true}).fill('서구 괴정동 3-3');await drawer.locator('.sale-public-query-v6 button').click();page.__releaseHistory();
  await expect(drawer.locator('[data-public-address-status]')).toContainText('조회용 주소를 적용');await expect(drawer.locator('.land-price-history-v39')).toHaveCount(0);
});
