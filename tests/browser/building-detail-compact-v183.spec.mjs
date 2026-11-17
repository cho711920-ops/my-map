import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../../cloudflare/src/d1-api.js';
const pnu='3017010800100030003';
async function open(page,isMobile,market='building_sale'){
  const mobileMenu=await page.locator('#jsMobileTradeModeV1').isVisible();
  await page.locator(mobileMenu?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);
  if(mobileMenu)await page.locator('[data-mobile-view="list"]').click();
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
for(const cached of [false,true])test('v256 unit rent is consistent in list and selected detail without a giant conflict or writes: '+(cached?'prepared v113':'fresh source'),async({page,isMobile})=>{
  const raw={source:'네이버',tradeType:'sale',saleCategory:'multifamily',salePrice:110000,saleDetails:{scope:'whole_building',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,totalDeposit:68100,monthlyIncome:6040000,descriptionText:'다가구 매매가 11억원 보증금 6억8100만원 월세604만원 실투자금4억1900만원'}};
  const ad=withSaleFinancialDisplay(raw,{naverPriceInfo:{price:1100000000,previousDeposit:0,previousMonthlyRent:60400000000}}),summary=compactSaleSummary(ad);
  if(cached)summary.monthlyIncomeConflict={structured:6040000,description:604,basis:'description'};
  let writes=0;page.on('request',r=>{if(r.method()!=='GET')writes++;});
  const started=Date.now();await page.evaluate(({ad,summary})=>{
    const seed=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');allItems=[{...seed,...ad,saleDetails:summary,propertyId:'UNIT256',key:'unit256',name:'단위 검사 매물',address:'서구 갈마동1354'}];
    window.__v256Originals=[{...allItems[0],...ad,propertyId:'UNIT256',originalId:'UNIT256-AD',buildingName:'단위 검사 매물',images:['/__v183/1.svg','/__v183/2.svg'],photoCount:2,saleSummary:compact(ad.saleDetails)}];
    function compact(d){return {...summary,monthlyIncome:d.monthlyIncome,monthlyIncomeConflict:undefined};}
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{UNIT256:__v256Originals}});JSListingTradeV1.setMode('building_sale');applyFilter();
  },{ad,summary});
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const facts=page.locator('#list .sale-card-facts-v2');await expect(facts).toContainText('604만원',{timeout:1000});expect(Date.now()-started).toBeLessThan(1000);await expect(facts).toContainText('17.30%');await expect(facts).not.toContainText('6,040,000');await expect(facts).not.toContainText('숫자·설명 불일치');
  await page.route('**/api/data?**',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='unifiedListingDetail')return route.fallback();return route.fulfill({json:{ok:true,originals:await page.evaluate(()=>__v256Originals)}});});
  await page.locator('#list .item[data-property-id="UNIT256"] .item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer).toBeVisible();await expect(drawer.locator('.building-money-grid-v183')).toContainText('604만원');await expect(drawer.locator('.building-money-grid-v183')).not.toContainText('6,040,000');
  const image=drawer.locator('.unified-detail-hero-v8 img');await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:1000}).toBe(true);expect(writes).toBe(0);
});

test('building overview removes retired panels and keeps exact finance, memo, attachment and decoded photos',async({page,isMobile})=>{
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  const drawer=await open(page,isMobile);await expect(drawer).toHaveAttribute('data-building-compact-v183','');
  await expect(drawer.locator('.sale-overview-price-v2')).toContainText('5억원');
  await expect(drawer.locator('.building-money-grid-v183')).toContainText('5,000만원');await expect(drawer.locator('.building-money-grid-v183')).toContainText('200만원');await expect(drawer.locator('.building-money-grid-v183')).toContainText('5.33%');
  await expect(drawer.locator('.building-areas-v183')).toContainText('100평');await expect(drawer.locator('.building-areas-v183')).toContainText('200평');
  await expect(drawer.locator('.sale-public-review-v6,.sale-original-evidence-v10,.sale-floors-v9,.sale-evidence-calculation-v36,[data-building-area-lookup-v84],.listing-sale-description-v1,.sale-dossier-nav-v3')).toHaveCount(0);
  await expect(drawer.locator('.unified-detail-memo-v8')).toContainText('브라우저 검사 전용 가상 자료');await expect(drawer.locator('[data-listing-attachment-v181]')).toHaveCount(1);
  const more=drawer.locator('.building-more-v183');await expect(more).not.toHaveAttribute('open','');await more.locator(':scope > summary').click();await expect(more.locator('.sale-asking-history-v9')).toHaveCount(1);await expect(more.getByRole('button',{name:'선택 매물 비교',exact:true})).toBeVisible();await more.locator(':scope > summary').click();await drawer.getByRole('button',{name:'매입검토 계산',exact:true}).click();await expect(page.locator('#saleWorkbenchDialogV1')).toBeVisible();await page.locator('#saleWorkbenchDialogV1 [data-sale-close]').click();
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

test('building has no property pager and opens its exact calculation in one click while more information stays closed',async({page,isMobile})=>{
  const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  const before=await page.evaluate(()=>JSON.stringify(allItems));
  const drawer=await open(page,isMobile),more=drawer.locator('.building-more-v183');
  await expect(drawer.locator('.sale-detail-pager-v12,[data-sale-step]')).toHaveCount(0);
  await expect(more).not.toHaveAttribute('open','');
  const button=drawer.getByRole('button',{name:'매입검토 계산',exact:true});await expect(button).toBeVisible();
  await expect(more.locator('[data-sale-action="worksheet"]')).toHaveCount(0);
  await button.click();const calculator=page.locator('#saleWorkbenchDialogV1');await expect(calculator).toBeVisible();
  await expect(calculator.locator('[data-calc="price"]')).toHaveValue('50000');
  await expect(calculator.locator('[data-calc="income"]')).toHaveValue('200');
  await calculator.locator('[data-calc="income"]').fill('300');
  await expect(calculator.locator('[data-calc-result]')).toContainText('8%');
  await calculator.locator('[data-sale-close]').click();
  await expect(more).not.toHaveAttribute('open','');
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toEqual([]);
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  const land=await open(page,isMobile,'land_sale');await expect(land.locator('.sale-detail-pager-v12')).toHaveCount(1);
});

test('building description text and floor highlights inherit the lease description font at every supported viewport',async({page,isMobile},info)=>{
  await page.route('**/api/data?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    const response=await route.fetch(),data=await response.json();
    for(const original of data.originals||[])original.memo='주차가능\n1층 보증금 1000만원 / 월세 80만원\n2층 보증금 2000만원 / 월세 100만원\n공인중개사사무소 상담문의 환영, 책임중개 합니다.';
    return route.fulfill({response,json:data});
  });
  for(const size of isMobile?[{width:390,height:844},{width:844,height:390}]:[{width:1794,height:1000},{width:1280,height:800},{width:1024,height:768}]){
    await page.setViewportSize(size);
    let drawer=await open(page,isMobile,'lease');
    const leaseFont=await drawer.locator('.unified-detail-memo-v8').evaluate(el=>getComputedStyle(el).fontSize);
    await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
    drawer=await open(page,isMobile);
    const memo=drawer.locator('.unified-detail-memo-v8');
    expect(await memo.evaluate(el=>getComputedStyle(el).fontSize)).toBe(leaseFont);
    await expect(memo.locator('.source-description-clean-v140')).toHaveCount(1);
    const descendants=await memo.locator('.source-description-clean-v140,.sale-occupancy-highlight-v180').evaluateAll(nodes=>nodes.map(el=>({size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight})));
    expect(descendants.length).toBeGreaterThan(1);for(const text of descendants){expect(text.size).toBe(leaseFont);expect(text.weight).toBe('400');}
    expect(await drawer.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:info.outputPath('readable-building-'+size.width+'.png'),animations:'disabled'});
    await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  }
});
