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
  expect(stable.facts).toEqual(['price-fee','price-premium']);
  await expect(first.locator('.item-address-room-v650 .price-area')).toHaveCount(1);
  const geometry=await first.evaluate(card=>{
    const bounds=card.getBoundingClientRect(),main=card.querySelector('.price-main'),thumb=card.querySelector('.unified-thumb-v8').getBoundingClientRect();
    return {height:bounds.height,actions:card.querySelector('.item-action-row').getBoundingClientRect().toJSON(),photo:{left:thumb.left,width:thumb.width,height:thumb.height,bottom:thumb.bottom},price:parseFloat(getComputedStyle(main).fontSize),fees:[...card.querySelectorAll('.price-fee,.price-premium')].map(e=>parseFloat(getComputedStyle(e).fontSize)),buttons:[...card.querySelectorAll('.item-action-left>button,.item-memo-toggle')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,font:parseFloat(getComputedStyle(e).fontSize),inside:r.left>=bounds.left&&r.right<=bounds.right+1&&r.bottom<=bounds.bottom+1};})};
  });
  expect(geometry.height).toBeGreaterThanOrEqual(136);expect(geometry.photo.width).toBeGreaterThanOrEqual(104);expect(geometry.photo.height).toBeGreaterThanOrEqual(108);
  expect(geometry.price).toBeGreaterThanOrEqual(26);expect(geometry.fees.every(size=>size>=14)).toBe(true);
  expect(geometry.buttons.length).toBe(6);
  expect(geometry.height).toBeLessThanOrEqual(180);
  expect(geometry.actions.left).toBeGreaterThan(geometry.photo.left+geometry.photo.width);
  for(const button of geometry.buttons){expect(button.width,button.label).toBeGreaterThanOrEqual(95.99);expect(Math.round(button.height*1000)/1000,button.label).toBe(38);expect(button.font,button.label).toBeGreaterThanOrEqual(13);expect(button.inside,button.label).toBe(true);}
  const sorted=geometry.buttons.slice().sort((a,b)=>Math.abs(a.top-b.top)>1?a.top-b.top:a.left-b.left);
  expect(sorted.map(b=>b.label.trim())).toEqual(['연락처','미확인','로드뷰','더보기 ⋯','링크','메모 ▼']);
  for(let i=0;i<geometry.buttons.length;i++)for(let j=i+1;j<geometry.buttons.length;j++){
    const a=geometry.buttons[i],b=geometry.buttons[j];
    if(Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)expect(Math.max(a.left-b.right,b.left-a.right)).toBeGreaterThanOrEqual(8);
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1)expect(Math.max(a.top-b.bottom,b.top-a.bottom)).toBeGreaterThanOrEqual(8);
  }
  // Exercise the actual inline handlers at both edges of Roadview, where a
  // narrow neighboring Navigation target caused the reported wrong action.
  await page.evaluate(()=>{const nav=window.openKakaoNavigation,road=window.openKakaoRoadview;window.v281Actions=[];window.openKakaoNavigation=key=>v281Actions.push({action:'nav',key});window.openKakaoRoadview=key=>v281Actions.push({action:'road',key});window.restoreV281Actions=()=>{window.openKakaoNavigation=nav;window.openKakaoRoadview=road;};});
  try{
    const road=await first.locator('.item-roadview-btn').boundingBox();
    for(const point of [{x:road.x+4,y:road.y+road.height/2},{x:road.x+road.width-4,y:road.y+road.height/2}]){
      if(isMobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
    }
    await first.locator('.lease-more-button-v283').click();
    await first.locator('.item-nav-btn').evaluate(button=>{button.disabled=true;});
    await page.locator('.lease-popup-v283').getByRole('button',{name:'내비',exact:true}).click();
    expect(await page.evaluate(()=>v281Actions)).toEqual([{action:'road',key:'fixture-lease-1'},{action:'road',key:'fixture-lease-1'}]);
    await first.locator('.item-nav-btn').evaluate(button=>{button.disabled=false;});
    await first.locator('.lease-more-button-v283').click();await page.locator('.lease-popup-v283').getByRole('button',{name:'내비',exact:true}).click();
    expect(await page.evaluate(()=>v281Actions)).toEqual([{action:'road',key:'fixture-lease-1'},{action:'road',key:'fixture-lease-1'},{action:'nav',key:'fixture-lease-1'}]);
  }finally{await page.evaluate(()=>window.restoreV281Actions());}
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
    await expect(first.locator('.lease-address-line-v283 .item-address-text')).toHaveText('대전 서구 괴정동 1-1');
  }
  await page.screenshot({path:info.outputPath('approved-design-7-'+(isMobile?'phone-rotation':'desktop')+'.png')});
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toEqual([]);expect(errors).toEqual([]);
});


test('v283 lease selection toolbar exposes print before pale-red merge while sales keep their existing actions',async({page,context,isMobile})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});await page.addScriptTag({url:'/js/selected-listing-merge-v99.js'});
 if(isMobile)await page.locator('[data-mobile-view="list"]').click();
 for(const mode of ['lease','building_sale','land_sale','lease']){
  await page.evaluate(mode=>{JSListingTradeV1.setMode(mode);JSMapListPanelV1.open();applyFilter();},mode);
  await page.locator('#list .action-select-check').first().check();
  const bar=page.locator('#selectionActionBar');
  await expect(bar.locator(':scope>button:visible')).toHaveText(mode==='lease'?['찜하기','선택인쇄','선택병합','계약완료']:['찜하기','선택병합','임장완료','계약완료']);
  await expect(page.locator('#selectionMoreV242'))[mode==='lease'?'toBeHidden':'toBeVisible']();
  const mergeColor=await page.locator('#mergeSelectedListingsBtnV99').evaluate(el=>getComputedStyle(el).backgroundColor);
  if(mode==='lease'){
   expect(mergeColor).toBe('rgb(255, 240, 240)');
   const card=page.locator('#list .item').first();
   await expect(card.locator('.lease-more-button-v283')).toBeVisible();
   const check=await card.locator('.action-select-check').boundingBox(),address=await card.locator('.item-address-text').boundingBox();expect(check.x+check.width).toBeLessThanOrEqual(address.x);
   await card.locator('.lease-more-button-v283').click();await expect(page.locator('.lease-popup-v283')).toBeVisible();
   await page.locator('.lease-popup-v283').getByRole('button',{name:'수정',exact:true}).click();
   await expect(page.locator('#propertyEditModalV630.open')).toBeVisible();await page.locator('#propertyEditModalV630').getByRole('button',{name:'취소',exact:true}).click();
  }else{
   expect(mergeColor).not.toBe('rgb(255, 240, 240)');await expect(page.locator('#list .lease-actions-card-v283')).toHaveCount(0);
   await page.getByRole('button',{name:'선택 작업 더보기',exact:true}).click();await expect(page.locator('#saleCompareButtonV1')).toBeVisible();await page.keyboard.press('Escape');
  }
 }
});


test('v283 legacy state popup does not borrow the checked neighbor as its write target',async({page,context,isMobile})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const writes=[];
 await page.route('**/api/data',async route=>{if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();if(body.action!=='updateProperty')return route.fallback();writes.push(body);return route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:body.key.propertyId,updated:body.updated}});});
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');if(isMobile)await page.locator('[data-mobile-view="list"]').click();
 const before=await page.evaluate(()=>JSON.stringify(allItems.find(i=>i.propertyId==='FIXTURE-LEASE-2')));
 const first=page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]'),second=page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"]');
 await second.locator('.action-select-check').check();const selected=await page.evaluate(()=>selectedPrintKeys.slice());
 await first.locator('.lease-state-button-v283').click();await page.locator('.lease-popup-v283').getByRole('button',{name:'보류',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1').state)).toBe('보류');
 await expect(first.locator('.lease-state-button-v283')).toHaveText('보류');
 expect(writes).toHaveLength(1);expect(writes[0].key).toEqual({propertyId:'FIXTURE-LEASE-1'});expect(writes[0].updated).toEqual({state:'보류'});
 expect(await page.evaluate(()=>JSON.stringify(allItems.find(i=>i.propertyId==='FIXTURE-LEASE-2')))).toBe(before);
 expect(await page.evaluate(()=>selectedPrintKeys)).toEqual(selected);await expect(second.locator('.action-select-check')).toBeChecked();
});
