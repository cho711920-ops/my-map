import {test,expect} from '@playwright/test';

test('v280 enlarged lease actions preserve contacts, exact selection, memo and original nodes',async({page,context,isMobile},info)=>{
  const writes=[],errors=[];
  page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());});
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  if(isMobile){
    const session=await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride',{width:930,height:530,screenWidth:1100,screenHeight:720,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
  }
  await page.evaluate(()=>{
    document.getElementById('fixtureControls')?.remove();JSMapListPanelV1.open();
    allItems.find(item=>item.propertyId==='FIXTURE-LEASE-1').memo='임대인 01011112222';
    showList(allItems.filter(item=>item.tradeType==='lease'));
  });
  const before=await page.evaluate(()=>JSON.stringify(allItems));
  const first=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]');
  const second=page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"]');
  await expect(first).toHaveClass(/lease-card-v280/);
  await expect(first.locator('.item-contact-button-v654')).toHaveClass(/has-contacts/);
  await expect(second.locator('.item-contact-button-v654')).toHaveClass(/no-contacts/);
  expect(await first.locator('.item-contact-button-v654').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(16, 185, 129)');
  expect(await second.locator('.item-contact-button-v654').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(229, 231, 235)');
  const stable=await first.evaluate(card=>{
    const image=card.querySelector('.unified-thumb-v8'),fields=['.item-address-text','.item-room-badge','.price-main','.price-area','.price-fee','.price-premium'];
    const nodes=fields.map(s=>card.querySelector(s));
    const target=card.querySelector('.item-edit-btn-v630').getAttribute('onclick');
    JSDesignReviewV261.list(document.getElementById('list'));JSDesignReviewV261.list(document.getElementById('list'));
    return {same:image===card.querySelector('.unified-thumb-v8')&&fields.every((s,i)=>nodes[i]===card.querySelector(s)),target,sameTarget:target===card.querySelector('.item-edit-btn-v630').getAttribute('onclick'),facts:[...card.querySelector('.lease-facts-v280').querySelectorAll('.price-area,.price-fee,.price-premium')].map(e=>e.className)};
  });
  expect(stable.same).toBe(true);expect(stable.sameTarget).toBe(true);expect(stable.target).toContain('FIXTURE-LEASE-1');
  expect(stable.facts).toEqual(['price-area','price-fee','price-premium']);
  const geometry=await first.evaluate(card=>{
    const bounds=card.getBoundingClientRect(),main=card.querySelector('.price-main'),thumb=card.querySelector('.unified-thumb-v8').getBoundingClientRect();
    return {height:bounds.height,photo:{width:thumb.width,height:thumb.height},price:parseFloat(getComputedStyle(main).fontSize),fees:[...card.querySelectorAll('.price-fee,.price-premium')].map(e=>parseFloat(getComputedStyle(e).fontSize)),buttons:[...card.querySelectorAll('.item-action-left>button,.item-memo-toggle')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent,width:r.width,height:r.height,font:parseFloat(getComputedStyle(e).fontSize),inside:r.left>=bounds.left&&r.right<=bounds.right+1&&r.bottom<=bounds.bottom+1};})};
  });
  expect(geometry.height).toBeGreaterThanOrEqual(136);expect(geometry.photo.width).toBeGreaterThanOrEqual(104);expect(geometry.photo.height).toBeGreaterThanOrEqual(108);
  expect(geometry.price).toBeGreaterThanOrEqual(26);expect(geometry.fees.every(size=>size>=14)).toBe(true);
  expect(geometry.buttons.length).toBeGreaterThanOrEqual(7);
  for(const button of geometry.buttons){expect(button.width,button.label).toBeGreaterThanOrEqual(44);expect(button.height,button.label).toBeGreaterThanOrEqual(44);expect(button.font,button.label).toBeGreaterThanOrEqual(13);expect(button.inside,button.label).toBe(true);}
  await first.locator('.action-select-check').check();await expect(second.locator('.action-select-check')).not.toBeChecked();
  await first.locator('.item-memo-toggle').click();await expect(first).toHaveClass(/memo-open/);await expect(page.locator('#unifiedDetailDrawerV8')).not.toBeVisible();
  await first.locator('.item-memo-toggle').click();await expect(first).not.toHaveClass(/memo-open/);
  await expect(first.locator('.action-select-check')).toBeChecked();
  if(isMobile){
    const session=await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,screenWidth:390,screenHeight:844,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'portraitPrimary',angle:0}});
    await expect(page.locator('html')).toHaveClass(/js-phone-app-v2/);
    await page.locator('[data-mobile-view="list"]').click();
    await expect(page.locator('#list .lease-card-v280')).toHaveCount(0);
    await expect(first.locator('.action-select-check')).toBeChecked();
    await expect(first.locator('.item-address-room-v650 .item-address-text')).toHaveText('대전 서구 괴정동 1-1');
  }
  await page.screenshot({path:info.outputPath('approved-design-7-'+(isMobile?'phone-rotation':'desktop')+'.png')});
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toEqual([]);expect(errors).toEqual([]);
});
