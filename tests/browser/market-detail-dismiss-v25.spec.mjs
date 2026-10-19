import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){
  const select=page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1');
  // Phone detail covers the header: exercise its selector's real change handler.
  if(isMobile&&await page.locator('#unifiedDetailDrawerV8[aria-hidden="false"]').count())await select.evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  else await select.selectOption(value);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
}
const modes=['lease','building_sale','land_sale'];
for(const from of modes)for(const to of modes.filter(m=>m!==from))test(from+' → '+to+' dismisses the old detail and opens the new market normally',async({page,isMobile})=>{
  let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  await mode(page,isMobile,from);
  const first=page.locator('#list .item').first(),oldId=await first.getAttribute('data-property-id');
  await first.locator('.item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');
  await expect(drawer).toHaveAttribute('aria-hidden','false');expect(await page.evaluate(id=>JSUnifiedListingsV8.isOpenForProperty(id),oldId)).toBe(true);
  await page.evaluate(value=>JSListingTradeV1.setMode(value,{apply:false,resetFilters:false}),from);
  await expect(drawer).toHaveAttribute('aria-hidden','false');
  await mode(page,isMobile,to);
  await expect(drawer).toHaveAttribute('aria-hidden','true');await expect(drawer).not.toHaveClass(/\b(open|opening-v827|closing-v827)\b/);
  await expect(page.locator('#unifiedGalleryV8.open')).toHaveCount(0);
  expect(await page.evaluate(id=>JSUnifiedListingsV8.isOpenForProperty(id),oldId)).toBe(false);
  const next=page.locator('#list .item').first(),newId=await next.getAttribute('data-property-id');expect(newId).not.toBe(oldId);
  await next.locator('.item-building-name').click();await expect(drawer).toHaveAttribute('aria-hidden','false');
  expect(await page.evaluate(id=>JSUnifiedListingsV8.isOpenForProperty(id),newId)).toBe(true);
  await mode(page,isMobile,from);await expect(drawer).toHaveAttribute('aria-hidden','true');expect(writes).toBe(0);
});
test('market change also dismisses an open photo overlay without returning focus to the old listing',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');
  await page.route('**/api/data**',async route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    const response=await route.fetch(),data=await response.json();
    for(const original of data.originals||[])original.images=['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="navy"/></svg>')];
    await route.fulfill({response,json:data});
  });
  await page.locator('#list .item-building-name').first().click();
  await expect(page.locator('#unifiedDetailDrawerV8 .unified-detail-hero-v8 img')).toBeVisible();
  await page.evaluate(()=>JSUnifiedListingsV8.openGallery('FIXTURE-BUILDING','FIXTURE-BUILDING-ORIGINAL',0));
  await expect(page.locator('#unifiedGalleryV8')).toHaveAttribute('aria-hidden','false');
  await page.evaluate(()=>JSListingTradeV1.setMode('land_sale',{resetFilters:false}));
  await expect(page.locator('#unifiedGalleryV8')).toHaveAttribute('aria-hidden','true');
  await expect(page.locator('#unifiedDetailDrawerV8')).toHaveAttribute('aria-hidden','true');
  await expect(page.locator('#list .item')).toHaveAttribute('data-property-id','FIXTURE-LAND');
  expect(await page.evaluate(()=>!!document.activeElement?.closest('#unifiedDetailDrawerV8,#unifiedGalleryV8'))).toBe(false);
});
test('a delayed previous-market response cannot reopen or replace the next detail',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');let release,started,finished;
  const gate=new Promise(r=>{release=r;}),pending=new Promise(r=>{started=r;}),complete=new Promise(r=>{finished=r;});
  await page.route('**/api/data**',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='unifiedListingDetail'||u.searchParams.get('propertyId')!=='FIXTURE-BUILDING')return route.continue();
    const response=await route.fetch();started();await gate;await route.fulfill({response});finished();
  });
  await page.locator('#list .item-building-name').first().click();await pending;
  await mode(page,isMobile,'land_sale');const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer).toHaveAttribute('aria-hidden','true');
  await page.locator('#list .item-building-name').first().click();await expect(drawer).toHaveAttribute('data-sale-presentation-v2','land');
  release();await complete;
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  expect(await page.evaluate(()=>JSUnifiedListingsV8.isOpenForProperty('FIXTURE-LAND'))).toBe(true);
  await expect(drawer).toHaveAttribute('data-sale-presentation-v2','land');
  await mode(page,isMobile,'lease');await expect(drawer).toHaveAttribute('aria-hidden','true');
  await page.setViewportSize({width:isMobile?844:1100,height:isMobile?390:760});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(drawer).toHaveAttribute('aria-hidden','true');
});
