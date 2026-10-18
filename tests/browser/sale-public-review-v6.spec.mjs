import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/building-register-v6.js'});
  await page.evaluate(()=>{
    window.__parcelRequests=0;window.__registerRequests=0;
    window.JSParcelExternalLinksV1.resolve=async address=>{window.__parcelRequests++;return {address:address.includes('장대동')?'대전광역시 유성구 장대동 4-4':'대전광역시 서구 괴정동 3-3',pnu:address.includes('장대동')?'3020010700100040004':'3017010800100030003',links:{eum:'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu=3017010800100030003',valuemap:'https://www.valueupmap.com/properties/lands/3017010800100030003'}};};
  });
});
async function open(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();await page.locator('#list .item-building-name').click();return page.locator('#unifiedDetailDrawerV8');}
const building={mainUse:'제2종근린생활시설',structure:'철근콘크리트구조',approvalDate:'20020304',siteArea:330,buildingArea:160,totalArea:650,floorArea:600,buildingCoverageRatio:48.48,floorAreaRatio:181.82,indoorSelfParking:4,outdoorSelfParking:2,indoorMechanicalParking:0,outdoorMechanicalParking:0,passengerElevators:1,emergencyElevators:0,lotAddress:'대전 서구 괴정동 3-3'};
async function leaseMarkup(page){return page.locator('#list .item').first().evaluate(e=>{const clone=e.cloneNode(true);clone.removeAttribute('data-building-badge-retries');for(const node of [clone,...clone.querySelectorAll('*')]){const attrs=[...node.attributes].map(a=>[a.name,a.value]).sort(([a],[b])=>a.localeCompare(b));for(const a of [...node.attributes])node.removeAttribute(a.name);for(const [k,v] of attrs)node.setAttribute(k,v);}return clone.outerHTML;});}
test('building public facts load on click, show source and preserve the lease UI',async({page,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let requested=0;
  await page.route('**/api/data?*',async route=>{
    const url=new URL(route.request().url());if(url.searchParams.get('action')!=='buildingRegister')return route.continue();
    requested++;expect(url.searchParams.get('propertyId')).toBe('');expect(url.searchParams.get('mode')).toBe('summary');
    const data={ok:true,action:'buildingRegister',version:11,buildings:[building],source:'국토교통부 건축물대장',queriedAt:'2026. 10. 18. 오전 11:00',fetchedAt:new Date().toISOString()};
    return route.fulfill({contentType:'text/javascript',body:url.searchParams.get('callback')+'('+JSON.stringify(data)+');'});
  });
  const lease=await leaseMarkup(page);
  const drawer=await open(page,isMobile,'building_sale');
  expect(requested).toBe(0);expect(await page.evaluate(()=>window.__parcelRequests)).toBe(0);
  const snapshot=await page.evaluate(()=>JSON.stringify(window.allItems));
  await drawer.locator('[data-sale-section-target="register"]').click();
  const panel=drawer.locator('[data-sale-section="register"]');await panel.locator('[data-public-load]').click();
  await expect(panel).toContainText('철근콘크리트구조');await expect(panel).toContainText('6대');await expect(panel).toContainText('181.82%');await expect(panel).toContainText('2026. 10. 18.');expect(requested).toBe(1);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(snapshot);
  await panel.screenshot({path:info.outputPath('building-public-facts.png'),animations:'disabled'});
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('lease');
  expect(await leaseMarkup(page)).toBe(lease);
  expect(errors).toEqual([]);
});
test('multiple buildings require a deliberate choice and missing counts stay unknown',async({page,isMobile})=>{
  await page.evaluate(b=>{window.JSBuildingRegisterReadOnlyV6.load=async()=>({ok:true,buildings:[b,{...b,buildingName:'별동',indoorSelfParking:null}]});},building);
  const drawer=await open(page,isMobile,'building_sale'),panel=drawer.locator('[data-sale-section="register"]');
  await drawer.locator('[data-sale-section-target="register"]').click();await panel.locator('[data-public-load]').click();
  await expect(panel).toContainText('확인할 건물·동을 선택');await expect(panel.locator('.sale-public-facts-v6')).toHaveCount(0);
  await panel.locator('select').selectOption('1');await expect(panel).toContainText('별동');
  expect(await panel.locator('.sale-public-facts-v6').textContent()).not.toContain('주차 총대수');
});
test('land links resolve the selected parcel and distinguish unconnected official data',async({page,isMobile},info)=>{
  const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-section-target="publicland"]').click();
  const panel=drawer.locator('[data-sale-section="publicland"]');await expect(drawer.locator('[data-sale-section="register"]')).toHaveCount(0);
  await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-official-land]')).toBeVisible();
  await expect(panel.locator('a').first()).toHaveAttribute('href',/eum\.go\.kr/);
  await panel.locator('summary').click();await expect(panel).toContainText('아직 자동 연계되지 않았습니다');
  await panel.screenshot({path:info.outputPath('land-official-reference.png'),animations:'disabled'});
});
test('nearby references filter legal town, area, month and whole-building records without new filter requests',async({page,isMobile},info)=>{
  let calls=0;
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleTransactions')return route.continue();calls++;
    expect(u.searchParams.get('expectedAccountEmail')).toBe('browser-fixture@example.invalid');
    const row={date:'2026-09-10',district:'서구',town:'괴정동',lot:'3**',amount:40000,landAreaM2:300,buildingAreaM2:600,buildingType:'일반',buildingUse:'근린생활시설',zoning:'일반주거지역',method:'중개거래'};
    return route.fulfill({json:{ok:true,month:u.searchParams.get('month'),records:[row,{...row,town:'탄방동',amount:90000},{...row,buildingType:'집합',amount:10000},{...row,landAreaM2:20,amount:1000}],complete:true,source:'국토교통부 실거래가',fetchedAt:new Date().toISOString()}});
  });
  const drawer=await open(page,isMobile,'building_sale');await drawer.locator('[data-sale-section-target="transactions"]').click();
  const panel=drawer.locator('[data-sale-section="transactions"]');expect(calls).toBe(0);
  await panel.locator('[type="month"]').fill('2026-09');await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('조건 일치 2건');
  await panel.locator('[data-trade-filter="size"]').check();await expect(panel.locator('[data-public-status]')).toContainText('조건 일치 1건');expect(calls).toBe(1);
  await expect(panel.locator('.sale-public-trades-v6')).toContainText('4억원');await expect(panel).toContainText('현재 광고 호가 5억원');
  await panel.locator('[type="month"]').fill('2026-08');await expect(panel.locator('.sale-public-trades-v6')).toHaveCount(0);expect(calls).toBe(1);
  await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('2026.08');expect(calls).toBe(2);
  await panel.screenshot({path:info.outputPath('building-similar-trades.png'),animations:'disabled'});
});
test('approval and empty results are distinct, and a closed/replaced panel ignores late requests',async({page,isMobile})=>{
  let fail=true,release;
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleTransactions')return route.continue();
    if(fail)return route.fulfill({json:{ok:false,code:'approval_required',message:'실거래 자료 이용 승인이 필요합니다.'}});
    await new Promise(r=>release=r);return route.fulfill({json:{ok:true,month:u.searchParams.get('month'),records:[],complete:true,source:'국토부',fetchedAt:new Date().toISOString()}});
  });
  const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-section-target="transactions"]').click();
  const panel=drawer.locator('[data-sale-section="transactions"]');await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('승인이 필요');await expect(panel).not.toContainText('공개 거래가 없습니다');
  fail=false;await panel.locator('[data-public-load]').click();await expect.poll(()=>typeof release).toBe('function');
  await drawer.locator('[aria-label="공적자료 조회용 지번"]').fill('서구 괴정동 3-3');await drawer.locator('.sale-public-query-v6 button').click();release();
  await expect(drawer.locator('[data-public-address-status]')).toContainText('조회용 주소를 적용');await expect(drawer.locator('[data-sale-section="transactions"] [data-public-content]')).toBeEmpty();
});
test('narrow sale detail stays within its viewport',async({page,isMobile})=>{
  test.skip(!isMobile);await page.setViewportSize({width:320,height:720});const drawer=await open(page,true,'land_sale');
  await expect(drawer.locator('.sale-public-review-v6')).toHaveCount(1);
  expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
});
