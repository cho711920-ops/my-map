import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
}
async function richDetail(page,id,detail){
  await page.route('**/api/data?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    const response=await route.fetch(),data=await response.json();
    for(const original of data.originals||[])if(original.propertyId===id)original.saleDetails=detail;
    await route.fulfill({response,json:data});
  });
}
test('sale map view choices preserve clusters, stored data and the prior lease base map',async({page,isMobile})=>{
  const controls=page.locator('#saleMapViewsV3');await expect(controls).toBeHidden();
  await page.evaluate(()=>{
    window.__saleMapCalls=[];window.kakao=window.kakao||{};window.kakao.maps=window.kakao.maps||{};
    window.kakao.maps.MapTypeId={ROADMAP:1,HYBRID:3,USE_DISTRICT:8};let type=1;
    Object.assign(window.map,{getMapTypeId:()=>type,setMapTypeId:n=>{type=n;window.__saleMapCalls.push(['base',n]);},addOverlayMapTypeId:n=>window.__saleMapCalls.push(['add',n]),removeOverlayMapTypeId:n=>window.__saleMapCalls.push(['remove',n])});
    window.__saleDataBefore=JSON.stringify(window.allItems);
  });
  await mode(page,isMobile,'land_sale');
  if(isMobile)await page.locator('[data-mobile-view="map"]').click();
  await expect(controls).toBeVisible();
  await controls.locator('[data-sale-map-view="satellite"]').click();
  await expect(controls.locator('[data-sale-map-view="satellite"]')).toHaveAttribute('aria-pressed','true');
  await controls.locator('[data-sale-map-view="district"]').click();
  await expect(controls.locator('[data-sale-map-note]')).toBeVisible();
  await mode(page,isMobile,'lease');
  await expect(controls).toBeHidden();
  expect(await page.evaluate(()=>window.__saleMapCalls)).toEqual([['base',3],['add',8],['remove',8],['base',1]]);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems)===window.__saleDataBefore)).toBe(true);
});
test('land dossier uses navigable condition tables and a separate asset summary',async({page,isMobile},info)=>{
  await richDetail(page,'FIXTURE-LAND',{scope:'land',landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'중로한면',parcelShape:'장방형',secondaryZoning:'지구단위계획구역',cadastralAreaM2:350,descriptionText:'검수용 가상 토지 광고 원문\n원본 조건은 변경하지 않습니다.'});
  await mode(page,isMobile,'land_sale');await page.locator('#list .item-building-name').click();
  const drawer=page.locator('#unifiedDetailDrawerV8'),body=drawer.locator('.unified-detail-body-v8');
  await expect(drawer.locator('.sale-dossier-nav-v3')).toHaveCount(1);
  await expect(drawer.locator('.sale-land-metrics-v3')).toContainText('제2종일반주거지역');
  await expect(drawer.locator('.sale-photo-slot-v3')).toBeHidden();
  await drawer.screenshot({path:info.outputPath('land-dossier-summary.png'),animations:'disabled'});
  await drawer.locator('[data-sale-section-target="land"]').click();
  await expect.poll(()=>body.evaluate(e=>e.scrollTop)).toBeGreaterThan(50);
  await expect(drawer.locator('[data-sale-section-target="land"]')).toHaveAttribute('aria-current','location');
  expect(await drawer.locator('[data-sale-section="land"] > dd > dl').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(1);
  await drawer.screenshot({path:info.outputPath('land-dossier-conditions.png'),animations:'disabled'});
  await drawer.locator('[data-sale-section-target="description"]').click();
  await expect(drawer.locator('.listing-sale-description-v1')).toHaveAttribute('open','');
  await expect(drawer.locator('.listing-sale-description-v1')).toContainText('검수용 가상 토지 광고 원문');
});
test('worksheet preserves edits during load and save, and can reapply only collected amounts',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');await page.locator('#list .item-building-name').click();
  let releaseLoad,releaseSave,savedRequest;
  await page.route('**/api/data*',async route=>{
    const request=route.request(),url=new URL(request.url()),data=request.method()==='POST'?request.postDataJSON():{};
    if(url.searchParams.get('action')==='loadCloudState'&&url.searchParams.get('scope')==='saleWorksheetV1'){
      await new Promise(r=>releaseLoad=r);
      return route.fulfill({json:{ok:true,found:true,version:1,data:{assumptions:{price:60000,deposit:7000,income:250,loan:15000,interest:4.8,vacancy:3,expense:10,acquisition:1000},note:'저장된 예전 메모',parcels:[]}}});
    }
    if(data.action==='saveCloudState'&&data.scope==='saleWorksheetV1'){
      savedRequest=data;await new Promise(r=>releaseSave=r);return route.continue();
    }
    return route.continue();
  });
  await page.locator('#unifiedDetailDrawerV8 [data-sale-action="worksheet"]').click();
  const dialog=page.locator('#saleWorkbenchDialogV1');
  await dialog.locator('[data-calc="income"]').fill('350');await dialog.locator('[data-work-note]').fill('불러오는 동안 쓴 메모');
  await expect.poll(()=>typeof releaseLoad).toBe('function');releaseLoad();
  await expect(dialog.locator('[data-work-save]')).toBeEnabled();
  await expect(dialog.locator('[data-calc="income"]')).toHaveValue('350');
  await expect(dialog.locator('[data-calc="price"]')).toHaveValue('60000');
  await expect(dialog.locator('[data-work-note]')).toHaveValue('불러오는 동안 쓴 메모');
  await dialog.locator('[data-apply-collected]').click();
  await expect(dialog.locator('[data-calc="price"]')).toHaveValue('50000');
  await expect(dialog.locator('[data-calc="income"]')).toHaveValue('200');
  await expect(dialog.locator('[data-calc="interest"]')).toHaveValue('4.8');
  await expect(dialog.locator('[data-calc="loan"]')).toHaveValue('15000');
  await dialog.locator('[data-work-save]').click();await expect.poll(()=>typeof releaseSave).toBe('function');
  await dialog.locator('[data-work-note]').fill('저장 요청 이후 새 메모');releaseSave();
  await expect(dialog.locator('[data-work-status]')).toContainText('그 뒤 입력한 변경사항');
  expect(savedRequest.data.note).toBe('불러오는 동안 쓴 메모');
  await expect(dialog.locator('[data-work-note]')).toHaveValue('저장 요청 이후 새 메모');
});
test('sale comparison includes exclusive and building area and prints only the comparison',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');
  await page.evaluate(()=>{
    const original=window.allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');
    const first={...original,saleDetails:{...original.saleDetails,exclusiveAreaM2:99.17,buildingAreaM2:165.29}};
    window.getSelectedPrintItems=()=>[first,{...first,propertyId:'COMPARE-2',name:'비교 검수 매물',salePrice:60000}];
    window.__printInvoked=0;window.print=()=>window.__printInvoked++;
    window.JSSaleWorkbenchV1.compare();
  });
  const dialog=page.locator('.sale-comparison-dialog-v2');
  await expect(dialog).toContainText('전용면적');await expect(dialog).toContainText('건축면적');
  await dialog.locator('[data-sale-print]').click();expect(await page.evaluate(()=>window.__printInvoked)).toBe(1);
  await page.emulateMedia({media:'print'});
  await expect(page.locator('#wrap')).toBeHidden();await expect(dialog.locator('table')).toBeVisible();
  await expect(dialog.locator('[data-sale-print]')).toBeHidden();
  await page.emulateMedia({media:'screen'});
});
test('sale photo navigation keeps the same gallery and counter after dossier mounting',async({page,isMobile})=>{
  let details=0;
  await page.route('**/sale-photo-*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#215449"/></svg>'}));
  await page.route('**/api/data?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    details++;const response=await route.fetch(),data=await response.json();
    for(const original of data.originals||[])if(original.propertyId==='FIXTURE-BUILDING')Object.assign(original,{images:['/sale-photo-1.svg','/sale-photo-2.svg'],photoCount:2});
    await route.fulfill({response,json:data});
  });
  await mode(page,isMobile,'building_sale');await page.locator('#list .item-building-name').click();
  const drawer=page.locator('#unifiedDetailDrawerV8'),counter=drawer.locator('.unified-detail-photo-count-v8');
  await expect(drawer.locator('.sale-photo-slot-v3 .unified-detail-gallery-v8')).toHaveCount(1);
  await drawer.locator('[data-sale-section-target="photos"]').click();
  await expect(counter).toHaveText('1 / 2');
  await drawer.locator('.unified-detail-photo-nav-v8.next').click();await expect(counter).toHaveText('2 / 2');
  expect(details).toBe(1);
});
