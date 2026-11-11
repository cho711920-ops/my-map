import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
test('building filters apply every range and category, including formatted prices',async({page,isMobile},info)=>{
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const trigger=page.locator(isMobile?'#jsMobileSearchFormV1 [data-mobile-action="filter"]':'#detailBtn');
  const price=id=>isMobile?'#v6DetailSheet_'+id:'#'+id;
  for(const [field,value] of [['minDeposit','60000'],['maxDeposit','40,000'],['saleLandMin','101'],['saleLandMax','99'],['saleGrossMin','201'],['saleGrossMax','199'],['saleYieldMin','6'],['saleYieldMax','5'],['saleCategoryFilter','house']]){
    await trigger.click();
    const selector=field.startsWith('sale')?'#'+field:price(field);
    if(field==='saleCategoryFilter')await page.locator(selector).selectOption(value);else await page.locator(selector).fill(value);
    await page.locator(isMobile?'#v6DetailSheetPortal :is(.v6-detail-sheet-apply,.js-phone-filter-apply):visible':'#detailFilter .apply-btn').click();
    await expect(page.locator('#list .item'),field+' must exclude this building').toHaveCount(0);
    await trigger.click();
    if(field==='saleCategoryFilter')await page.locator(selector).selectOption('');else await page.locator(selector).fill('');
    await page.locator(isMobile?'#v6DetailSheetPortal :is(.v6-detail-sheet-apply,.js-phone-filter-apply):visible':'#detailFilter .apply-btn').click();
    await expect(page.locator('#list .item')).toHaveCount(1);
  }
  await trigger.click();
  const panel=page.locator(isMobile?'#v6DetailSheetPortal .v6-detail-sheet':'#detailFilter');
  expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'filter must not scroll horizontally').toBe(true);
  await panel.screenshot({path:info.outputPath('sale-filter.png')});
});
