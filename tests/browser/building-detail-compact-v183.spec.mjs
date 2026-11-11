import {test,expect} from '@playwright/test';
const pnu='3017010800100030003';
async function open(page,isMobile,market='building_sale'){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#list .item').first().locator('.item-building-name').click();
  const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer).toBeVisible();return drawer;
}
test.beforeEach(async({page,context})=>{
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(['www.valueupmap.com','www.eum.go.kr'].includes(u.hostname))return route.fulfill({contentType:'text/html',body:'<title>검수용 외부 연결</title>검수용 필지 연결'});
    if(u.hostname!=='127.0.0.1')return route.abort();
    if(u.pathname.startsWith('/__v183/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="'+(u.pathname.includes('2')?'#19856c':'#537d9b')+'"/></svg>'});
    if(u.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action'))){
      const response=await route.fetch(),data=await response.json();for(const o of data.groups?Object.values(data.groups).flat():data.originals||[])Object.assign(o,{images:['/__v183/1.svg','/__v183/2.svg'],photoCount:2});
      return route.fulfill({response,json:data});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{
    window.__v183Queries=[];window.__v183GeoMode='ok';window.kakao=window.kakao||{maps:{}};
    kakao.maps.services={Status:{OK:'OK'},AnalyzeType:{EXACT:'exact'},Geocoder:function(){this.addressSearch=(query,callback)=>{
      __v183Queries.push(query);const rows=[{address:{address_name:__v183GeoMode==='mismatch'?'대전광역시 서구 괴정동 99-1':query,b_code:'3017010800',main_address_no:'3',sub_address_no:'3',mountain_yn:'N'}}];
      if(__v183GeoMode==='held')window.__v183Release=()=>callback(rows,'OK');else callback(rows,'OK');
    };}};
  });
});
test('building overview removes retired panels and keeps exact finance, memo, attachment and decoded photos',async({page,isMobile})=>{
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  const drawer=await open(page,isMobile);await expect(drawer).toHaveAttribute('data-building-compact-v183','');
  await expect(drawer.locator('.sale-overview-price-v2')).toContainText('5억원');
  await expect(drawer.locator('.building-money-grid-v183')).toContainText('5,000만원');await expect(drawer.locator('.building-money-grid-v183')).toContainText('200만원');await expect(drawer.locator('.building-money-grid-v183')).toContainText('5.33%');
  await expect(drawer.locator('.building-areas-v183')).toContainText('100평');await expect(drawer.locator('.building-areas-v183')).toContainText('200평');
  await expect(drawer.locator('.sale-public-review-v6,.sale-original-evidence-v10,.sale-floors-v9,.sale-evidence-calculation-v36,[data-building-area-lookup-v84],.listing-sale-description-v1,.sale-dossier-nav-v3')).toHaveCount(0);
  await expect(drawer.locator('.unified-detail-memo-v8')).toContainText('브라우저 검사 전용 가상 자료');await expect(drawer.locator('[data-listing-attachment-v181]')).toHaveCount(1);
  const more=drawer.locator('.building-more-v183');await expect(more).not.toHaveAttribute('open','');await more.locator(':scope > summary').click();await expect(more.locator('.sale-asking-history-v9')).toHaveCount(1);await expect(more.getByRole('button',{name:'선택 매물 비교',exact:true})).toBeVisible();await more.locator('[data-sale-action="worksheet"]').click();await expect(page.locator('#saleWorkbenchDialogV1')).toBeVisible();await page.locator('#saleWorkbenchDialogV1 [data-sale-close]').click();
  const image=drawer.locator('.unified-detail-hero-v8 img');await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth===960)).toBe(true);await drawer.locator('.unified-detail-photo-nav-v8.next').click();await expect(image).toHaveAttribute('src',/__v183\/2\.svg/);await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth===960)).toBe(true);
  expect(await page.evaluate(()=>__v183Queries)).toEqual([]);expect(writes).toEqual([]);expect(errors).toEqual([]);
});
test('each external button opens its exact verified parcel in one click without an address dialog',async({page,context,isMobile})=>{
  const drawer=await open(page,isMobile);
  for(const [provider,expected] of [['valuemap','https://www.valueupmap.com/properties/lands/'+pnu],['eum','https://www.eum.go.kr/web/ar/lu/luLandDet.jsp']]){
    const pending=context.waitForEvent('page');await drawer.locator('[data-building-parcel-v183="'+provider+'"]').click();const popup=await pending;
    await expect(popup).toHaveURL(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));if(provider==='eum')expect(new URL(popup.url()).searchParams.get('pnu')).toBe(pnu);
    expect(await popup.evaluate(()=>window.opener===null)).toBe(true);await popup.close();
  }
  expect(await page.evaluate(()=>__v183Queries)).toEqual(['대전광역시 서구 괴정동 3-3']);await expect(page.locator('#saleWorkbenchDialogV1')).toHaveCount(0);
});
test('failed parcel matching closes the temporary tab and keeps retry available',async({page,context,isMobile})=>{
  await page.evaluate(()=>{__v183GeoMode='mismatch';});const drawer=await open(page,isMobile),pending=context.waitForEvent('page');
  await drawer.locator('[data-building-parcel-v183="eum"]').click();const popup=await pending;await expect.poll(()=>popup.isClosed()).toBe(true);await expect(drawer.locator('.building-parcel-links-v183 [role=status]')).toContainText('정확히 일치');await expect(drawer.locator('[data-building-parcel-v183="eum"]')).toBeEnabled();
});
test('late parcel resolution cannot navigate for a closed or replaced detail',async({page,context,isMobile})=>{
  await page.evaluate(()=>{__v183GeoMode='held';});const drawer=await open(page,isMobile),pending=context.waitForEvent('page');await drawer.locator('[data-building-parcel-v183="eum"]').click();const popup=await pending;
  await drawer.locator('header button[aria-label="상세매물보기 닫기"]').click();await page.evaluate(()=>__v183Release());await expect.poll(()=>popup.isClosed()).toBe(true);
});
test('compact detail fits desktop, tablet and phone with readable controls',async({page,isMobile},info)=>{
  if(!isMobile)await page.setViewportSize({width:1794,height:1000});const drawer=await open(page,isMobile);
  for(const size of isMobile?[{width:390,height:844},{width:844,height:390}]:[{width:1794,height:1000},{width:1280,height:800},{width:1024,height:768}]){
    await page.setViewportSize(size);await expect.poll(()=>drawer.evaluate(d=>d.scrollWidth<=d.clientWidth+1)).toBe(true);
    expect(await drawer.locator('.building-parcel-links-v183 button').first().evaluate(b=>b.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36);
    if(!isMobile&&size.width===1280){const photo=await drawer.locator('.wide-detail-media-v26').boundingBox(),primary=await drawer.locator('.wide-detail-primary-v26').boundingBox();expect(Math.abs(photo.y-primary.y)).toBeLessThan(2);expect(primary.x).toBeGreaterThan(photo.x+photo.width);}
    await page.screenshot({path:'outputs/v183-detail-'+info.project.name+'-'+size.width+'.png',animations:'disabled'});
  }
});
test('lease and land keep their existing presentation and data panels',async({page,isMobile})=>{
  for(const market of ['lease','land_sale']){
    const drawer=await open(page,isMobile,market);await expect(drawer).not.toHaveAttribute('data-building-compact-v183','');await expect(drawer.locator('.building-parcel-links-v183')).toHaveCount(0);
    if(market==='land_sale')await expect(drawer.locator('.sale-public-review-v6')).toHaveCount(1);
    await drawer.locator('header button[aria-label="상세매물보기 닫기"]').click();
  }
});
