import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,market){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
for(const market of ['building_sale','land_sale'])test(market+' money conversion is live, accessible and never writes until saved',async({page,isMobile},info)=>{
  await mode(page,isMobile,market);let writes=0;
  const row=await page.evaluate(()=>{const i=allItems.find(i=>i.propertyId===document.querySelector('#list .item').dataset.propertyId);return {property_id:i.propertyId,title:i.name,address:i.address,trade_type:'sale',sale_category:i.saleCategory,status:'active',sale_price:99500,sale_details_json:JSON.stringify({landAreaM2:160,totalDeposit:0,monthlyIncome:350})};});
  await page.route('**/api/data**',route=>{const req=route.request(),action=new URL(req.url()).searchParams.get('action');if(req.method()==='POST')writes++;if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});return route.continue();});
  await page.locator('#list .item-edit-btn-v630').first().click();const d=page.locator('.sale-property-edit-v1'),input=d.locator('[data-sale-edit="salePrice"]'),preview=d.locator('[data-sale-money-preview="salePrice"]');
  await expect(preview).toHaveText('9억 9,500만원');await expect(input).toHaveAttribute('aria-describedby',await preview.getAttribute('id'));
  await input.fill('80000');await expect(preview).toHaveText('8억원');await expect(input).toHaveValue('80000');
  if(market==='building_sale'){
    await expect(d.locator('[data-sale-money-preview="totalDeposit"]')).toHaveText('0원');
    await expect(d.locator('[data-sale-money-preview="loanAmount"]')).toHaveText('금액 미입력');
    await d.locator('[data-sale-edit="monthlyIncome"]').fill('0.5');await expect(d.locator('[data-sale-money-preview="monthlyIncome"]')).toHaveText('5,000원');
  }else await expect(d.locator('[data-sale-money-preview]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath(market+'-money-edit.png')});
  await input.fill('');await expect(preview).toHaveText('금액 미입력');await input.fill('-1');await expect(preview).toHaveText('입력 금액을 확인해 주세요');
  await d.locator('[data-sale-edit-cancel]').click();expect(writes).toBe(0);
});
test('sale theme changes no lease, toolbar or map presentation and keeps narrow land cards compact',async({page,isMobile},info)=>{
  const styles=()=>page.evaluate(()=>[...document.querySelectorAll('#list .item,#list .item button,#list .item img,#map,#jsMobileAppShellV2,#mapToolDockV1')].map(el=>({cls:el.className,css:[...getComputedStyle(el)].map(k=>k+':'+getComputedStyle(el).getPropertyValue(k)).join(';')})));
  await mode(page,isMobile,'lease');const before=await styles();
  await page.evaluate(()=>{document.querySelector('link[href*="sale-design-v24.css"]').sheet.disabled=true;});expect(await styles()).toEqual(before);
  await page.evaluate(()=>{document.querySelector('link[href*="sale-design-v24.css"]').sheet.disabled=false;});
  await mode(page,isMobile,'land_sale');const card=page.locator('#list .listing-land-card-v4').first();
  for(const width of isMobile?[390,320]:[1280,820,700]){
    await page.setViewportSize({width,height:844});
    const geometry=await card.evaluate(el=>{const g=el.querySelector('.standard-card-grid-v661'),main=el.querySelector('.item-compact-main-v650');return {overflow:el.scrollWidth>el.clientWidth+1,unused:g.getBoundingClientRect().height-Math.max(main.getBoundingClientRect().height,el.querySelector('.unified-thumb-v8').getBoundingClientRect().height)};});
    expect(geometry.overflow).toBe(false);expect(geometry.unused).toBeLessThan(8);
  }
  await page.screenshot({path:info.outputPath('land-narrow.png')});
  await page.setViewportSize({width:isMobile?390:1280,height:844});
  await page.locator('#list .item-building-name').first().click();const drawer=page.locator('#unifiedDetailDrawerV8');
  await expect(drawer.locator('.sale-overview-v2')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.screenshot({path:info.outputPath('land-detail.png')});
  await page.evaluate(()=>JSUnifiedListingsV8.close());await mode(page,isMobile,'lease');
});
test('sale redesign preserves contact and transaction-review state colours',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');
  await page.addStyleTag({content:'* { transition: none !important; animation: none !important; }'});
  const card=page.locator('#list .listing-sale-card-v1').first(),phone=card.locator('.item-action-left > .item-contact-button-v654'),source=card.locator('.item-source-link-btn');
  await card.evaluate(el=>{[el,...el.querySelectorAll('button')].forEach(e=>{e.style.setProperty('transition','none','important');e.style.setProperty('animation','none','important');});});
  const state=()=>card.evaluate(el=>[el,el.querySelector('.item-contact-button-v654'),el.querySelector('.item-source-link-btn')].map((e,i)=>{const s=getComputedStyle(e);return [i?s.color:null,s.backgroundColor,s.backgroundImage,s.borderColor,s.boxShadow];}));
  for(const selected of [false,true]){
    await card.evaluate((el,s)=>el.classList.toggle('selected',s),selected);
    await source.evaluate(el=>{el.disabled=false;el.classList.add('transaction-check-button-v8135');});
    for(const available of [false,true]){
      await phone.evaluate((el,a)=>{el.classList.toggle('has-contacts',a);el.classList.toggle('no-contacts',!a);},available);
      const before=await state();
      await page.evaluate(()=>{document.querySelector('link[href*="sale-design-v24.css"]').sheet.disabled=true;});
      expect(await state()).toEqual(before);
      await page.evaluate(()=>{document.querySelector('link[href*="sale-design-v24.css"]').sheet.disabled=false;});
    }
  }
});
