import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
}
async function seed(page,market){
  await page.evaluate(market=>{
    const base=window.allItems.find(i=>i.propertyId===(market==='land_sale'?'FIXTURE-LAND':'FIXTURE-BUILDING'));
    const specs=[['A',50000,330.5785,661.157,200],['B',60000,661.157,330.5785,100],['C',40000,165.28925,1322.314,0],['D',null,null,null,null]];
    const items=specs.map(([key,price,area,gross,income])=>({...base,key:'sale-v5-'+key,propertyId:'SALE-V5-'+key,name:'검수 매물 '+key,source:'직접등록',salePrice:price,
      saleDetails:{landAreaM2:area,grossAreaM2:gross,totalDeposit:0,monthlyIncome:income,landUse:'대',zoning:'일반주거지역',roadAccess:'중로한면',parcelShape:'장방형',buildingUse:'근린생활시설'}}));
    window.allItems=window.allItems.filter(i=>i.tradeType!=='sale').concat(items);
    window.JSUnifiedListingsV8.attach(window.allItems,{ok:true,groups:Object.fromEntries(items.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-ORIGINAL',saleSummary:i.saleDetails,photoCount:0,images:[]}]]))});
    document.getElementById('fixtureControls').hidden=true;
    window.saleBusinessBeforeV5=JSON.stringify(window.allItems);
  },market);
}
const ids=page=>page.locator('#list .item').evaluateAll(cards=>cards.map(card=>card.dataset.propertyId));
test('building sorting is market-specific, missing-last, and preserves lease sort options',async({page,isMobile},info)=>{
  const leaseMenu=await page.locator('#sortDropdownMenu').innerHTML();
  await seed(page,'building_sale');await mode(page,isMobile,'building_sale');
  await expect(page.locator('#sortDropdownMenu')).toContainText('단순 수익률 높은순');
  await expect(page.locator('#sortDropdownMenu')).not.toContainText('토지 평당가');
  for(const [key,expected] of [['salePriceLow',['C','A','B','D']],['salePriceHigh',['B','A','C','D']],['saleLandHigh',['B','A','C','D']],['saleGrossHigh',['C','A','B','D']],['saleYieldHigh',['A','B','C','D']],['saleIncomeHigh',['A','B','C','D']]]){
    await page.evaluate(key=>window.selectSortOption(key),key);
    expect(await ids(page)).toEqual(expected.map(k=>'SALE-V5-'+k));
  }
  const card=page.locator('#list [data-property-id="SALE-V5-A"]');
  await expect(card).toHaveClass(/listing-building-card-v5/);
  await expect(card.locator('.building-unit-prices-v5')).toContainText('대지 기준 500만원/평');
  await expect(card.locator('.building-unit-prices-v5')).toContainText('연면적 기준 250만원/평');
  await expect(card.locator('.item-memo-toggle')).toBeVisible();
  expect(await card.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('building-cards-v5.png')});
  expect(await page.evaluate(()=>JSON.stringify(window.allItems)===window.saleBusinessBeforeV5)).toBe(true);
  await mode(page,isMobile,'lease');
  expect(await page.locator('#sortDropdownMenu').innerHTML()).toBe(leaseMenu);
  await expect(page.locator('#list .listing-building-card-v5')).toHaveCount(0);
});
test('land price-per-area sorting uses advertised area and no building-only choices',async({page,isMobile})=>{
  await seed(page,'land_sale');await mode(page,isMobile,'land_sale');
  await expect(page.locator('#sortDropdownMenu')).toContainText('토지 평당가 낮은순');
  await expect(page.locator('#sortDropdownMenu')).not.toContainText(/수익률|연면적|임대수입/);
  for(const [key,expected] of [['saleUnitLow',['B','A','C','D']],['saleUnitHigh',['C','A','B','D']],['saleLandLow',['C','A','B','D']]]){
    await page.evaluate(key=>window.selectSortOption(key),key);expect(await ids(page)).toEqual(expected.map(k=>'SALE-V5-'+k));
  }
});
for(const market of ['building_sale','land_sale'])test(market+' comparison tray opens a difference-focused comparison and clears on market switch',async({page,isMobile},info)=>{
  await seed(page,market);await mode(page,isMobile,market);
  const card=id=>page.locator('#list [data-property-id="SALE-V5-'+id+'"]');
  await card('A').locator('.action-select-check').check();
  const tray=page.locator('#saleComparisonTrayV5');await expect(tray).toBeVisible();
  await expect(tray.locator('[data-sale-compare]')).toBeDisabled();
  await card('B').locator('.action-select-check').check();
  await expect(tray).toContainText('검수 매물 A');await expect(tray).toContainText('6억원');
  await expect(tray.locator('[data-sale-compare]')).toBeEnabled();
  await page.screenshot({path:info.outputPath(market+'-tray-v5.png')});
  await tray.locator('[data-sale-compare]').click();
  const dialog=page.locator('.sale-comparison-dialog-v2');
  await expect(dialog.locator('.sale-compare-different-v5')).not.toHaveCount(0);
  const common=dialog.locator('[data-compare-same]').first();await expect(common).toBeVisible();
  await dialog.locator('[data-compare-differences]').check();await expect(common).toBeHidden();
  await expect(dialog.locator('.sale-compare-different-v5').first()).toBeVisible();
  await page.screenshot({path:info.outputPath(market+'-comparison-v5.png')});
  await dialog.locator('[data-compare-differences]').uncheck();await expect(common).toBeVisible();
  await dialog.locator('[data-sale-close]').click();
  await tray.locator('[data-sale-remove]').first().click();await expect(tray).toContainText('비교 후보 1개');
  await mode(page,isMobile,'lease');await expect(tray).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-sale-comparison-open-v5');
});
test('sort menu choices are reachable by the actual PC/phone controls',async({page,isMobile})=>{
  await seed(page,'land_sale');await mode(page,isMobile,'land_sale');
  await page.locator('#sortDropdownBtn').click();
  await page.getByText('토지 평당가 낮은순',{exact:true}).filter({visible:true}).click();
  await expect(page.locator('#sortFilter')).toHaveValue('saleUnitLow');
  expect((await ids(page))[0]).toBe('SALE-V5-B');
});
test('building income choice is reachable at the bottom of the sort menu',async({page,isMobile})=>{
  await seed(page,'building_sale');await mode(page,isMobile,'building_sale');
  await page.locator('#sortDropdownBtn').click();
  await page.getByText('월 임대수입 높은순',{exact:true}).filter({visible:true}).click();
  await expect(page.locator('#sortFilter')).toHaveValue('saleIncomeHigh');
  expect(await ids(page)).toEqual(['SALE-V5-A','SALE-V5-B','SALE-V5-C','SALE-V5-D']);
});
test('narrow phone sale cards and four-candidate tray stay within the viewport',async({page,isMobile})=>{
  test.skip(!isMobile,'phone width boundary');await page.setViewportSize({width:320,height:740});
  await seed(page,'building_sale');await mode(page,true,'building_sale');
  for(const id of ['A','B','C','D'])await page.locator('#list [data-property-id="SALE-V5-'+id+'"] .action-select-check').check();
  const tray=page.locator('#saleComparisonTrayV5'),rect=await tray.boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(321);
  await expect(tray.locator('[data-sale-compare]')).toBeEnabled();
  expect(await page.locator('#list .item').evaluateAll(items=>items.every(e=>e.scrollWidth<=e.clientWidth+1))).toBe(true);
  await tray.locator('[data-sale-clear]').click();await expect(tray).toBeHidden();
});
test('comparison uses the filtered original shown in the list instead of another master price',async({page,isMobile},info)=>{
  await seed(page,'building_sale');await mode(page,isMobile,'building_sale');
  for(const id of ['A','B'])await page.locator('#list [data-property-id="SALE-V5-'+id+'"] .action-select-check').check();
  await page.evaluate(()=>{
    const position=visibleListItems.findIndex(i=>i.propertyId==='SALE-V5-A');
    visibleListItems[position]={...visibleListItems[position],salePrice:43210,source:'선택된 원본',saleDetails:{landAreaM2:330.5785,totalDeposit:0,monthlyIncome:321}};
    JSSaleWorkbenchV1.syncComparisonTray();
  });
  const tray=page.locator('#saleComparisonTrayV5');await expect(tray).toContainText('4억3,210만원');
  await tray.locator('[data-sale-compare]').click();
  const dialog=page.locator('.sale-comparison-dialog-v2');
  await expect(dialog).toContainText('4억3,210만원');await expect(dialog).toContainText('321만원');
  expect(await dialog.locator('.sale-compare-differences-control-v5').evaluate(e=>getComputedStyle(e).display)).toBe('flex');
  await page.screenshot({path:info.outputPath('sale-original-comparison-v5.png')});
  expect(await page.evaluate(()=>JSON.stringify(allItems)===window.saleBusinessBeforeV5)).toBe(true);
});
