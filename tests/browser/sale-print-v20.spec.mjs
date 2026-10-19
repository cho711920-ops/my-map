import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{
    window.__fixturePrintCalls=0;const open=window.open;
    window.open=function(...args){const popup=open.apply(window,args);if(popup)popup.print=()=>window.__fixturePrintCalls++;return popup;};
    document.getElementById('fixtureControls').hidden=true;
    allItems=allItems.map(i=>i.propertyId==='FIXTURE-BUILDING'?{...i,name:'수익형 건물 검수',salePrice:180000,memo:('원본 광고와 직접 작성한 메모를 보존합니다. 대지와 건물 조건은 현장에서 다시 확인합니다. ').repeat(10)+'<메모 끝>',saleDetails:{scope:'whole_building',saleExtent:'whole_building',landAreaM2:330.5785,grossAreaM2:661.157,totalDeposit:30000,monthlyIncome:642,loanAmount:90000,investmentAmount:60000,buildingUse:'단독주택',approvalDate:'2016-07-01',aboveGroundFloors:4,belowGroundFloors:0}}:i.propertyId==='FIXTURE-LAND'?{...i,name:'토지 검수',room:'잘못된 임대층 5층',saleDetails:{scope:'land',landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'8m 도로',parcelShape:'장방형'}}:i);
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,buildingName:i.name,originalId:i.propertyId+'-O',saleSummary:i.saleDetails}]]))});applyFilter();
  });
});

for(const market of ['building_sale','land_sale','lease'])test(market+' selection opens its matching print document and keeps selection/data',async({page,context,isMobile},info)=>{
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const select=page.locator('#list .item .action-select-check').first();
  // The existing phone lease presentation hides this legacy checkbox. Exercise
  // its unchanged selection handler without changing the phone lease layout.
  if(isMobile&&market==='lease')await select.evaluate(e=>e.click());else await select.check();
  const before=await page.evaluate(()=>({data:JSON.stringify(allItems),selection:selectedPrintKeys.slice()}));let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  const popupPromise=context.waitForEvent('page');
  await page.locator('#printSelectedBtn').evaluate(e=>e.click());const popup=await popupPromise;
  await popup.waitForLoadState('load');await expect.poll(()=>page.evaluate(()=>window.__fixturePrintCalls)).toBe(1);
  if(market==='lease'){
    await expect(popup).toHaveTitle('JS부동산 임장리스트');await expect(popup.locator('.js-print-table')).toContainText('보2000 / 월90 / 관0 / 권0');
    await expect(popup.locator('.sale-print-card')).toHaveCount(0);
  }else{
    await expect(popup).toHaveTitle('JS부동산 '+(market==='land_sale'?'토지매매':'건물매매')+' 검토목록');
    await expect(popup.locator('.sale-print-card')).toHaveCount(1);await expect(popup.locator('.col-date,.js-print-table')).toHaveCount(0);
    if(market==='building_sale'){
      await expect(popup.locator('.sale-print-price')).toContainText('18억원');await expect(popup.locator('.sale-print-facts')).toContainText('642만원');await expect(popup.locator('.sale-print-facts')).toContainText('5.14%');
      await expect(popup.locator('.sale-print-memo')).toContainText('<메모 끝>');await expect(popup.locator('script')).toHaveCount(1);
    }else{
      await expect(popup.locator('.sale-print-facts')).toContainText('300만원/평');await expect(popup.locator('.sale-print-facts')).toContainText('8m 도로');
      await expect(popup.locator('body')).not.toContainText('5층');await expect(popup.locator('body')).not.toContainText('월 임대수입');
    }
    await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:734,height:1030});
    await expect(popup.locator('.sale-print-price strong')).toHaveCSS('font-size','21.3333px');
    expect(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    const memo=popup.locator('.sale-print-memo');if(await memo.count())expect((await memo.boundingBox()).width).toBeGreaterThan(650);
    await popup.screenshot({path:info.outputPath(market+'-print-sheet.png'),fullPage:true});
    if(!isMobile)await popup.pdf({path:info.outputPath(market+'-print-sheet.pdf'),preferCSSPageSize:true,printBackground:true});
  }
  expect(await page.evaluate(()=>({data:JSON.stringify(allItems),selection:selectedPrintKeys.slice()}))).toEqual(before);expect(writes).toBe(0);await popup.close();
});

test('mixed selection prints every chosen market instead of applying the currently selected market to all rows',async({page,context})=>{
  await page.evaluate(()=>{selectedPrintKeys=allItems.map(i=>actionSelectionKeyV660(i));updatePrintSelectedButton();});
  const popupPromise=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(e=>e.click());const popup=await popupPromise;
  await popup.waitForLoadState('load');await expect(popup).toHaveTitle('JS부동산 선택매물 검토목록');await expect(popup.locator('.sale-print-card')).toHaveCount(4);
  await expect(popup.locator('[data-print-trade="lease"]')).toHaveCount(2);await expect(popup.locator('[data-print-trade="building"]')).toHaveCount(1);await expect(popup.locator('[data-print-trade="land"]')).toHaveCount(1);
  await popup.close();
});
