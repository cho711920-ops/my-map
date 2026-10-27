import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator('#list .item')).toHaveCount(value==='lease'?2:1);
}
async function details(page,id,values){
  await page.route('**/api/data?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    const response=await route.fetch(),data=await response.json();
    for(const item of data.originals||[])if(item.propertyId===id)Object.assign(item,{saleDetails:values});
    await route.fulfill({response,json:data});
  });
  await page.evaluate(({id,values})=>{
    const item=window.allItems.find(i=>i.propertyId===id);item.saleDetails=values;
    for(const original of item.unifiedOriginalsV8||[])original.saleSummary=values;
  },{id,values});
}
test('sale redesign keeps lease card markup and computed styles intact after mode roundtrip',async({page,isMobile})=>{
  await mode(page,isMobile,'lease');
  const snapshot=()=>page.locator('#list .item').evaluateAll(items=>items.map(item=>({
    text:item.innerText, facts:item.querySelector('.item-compact-main-v650').innerHTML,
    styles:['padding','borderRadius','fontSize'].map(k=>getComputedStyle(item)[k])
  })));
  const before=await snapshot();
  await mode(page,isMobile,'building_sale');await mode(page,isMobile,'land_sale');await mode(page,isMobile,'lease');
  expect(await snapshot()).toEqual(before);
  await page.locator('#list .item-building-name').first().click();
  const drawer=page.locator('#unifiedDetailDrawerV8');
  await expect(drawer).not.toHaveAttribute('data-sale-presentation-v2');
  await expect(drawer.locator('.sale-overview-v2,.sale-tools-v1')).toHaveCount(0);
});
test('building detail presents selected-original income, areas and original text on both screens',async({page,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await details(page,'FIXTURE-BUILDING',{landAreaM2:330.5785,grossAreaM2:661.157,exclusiveAreaM2:99.17,totalDeposit:5000,monthlyIncome:200,buildingUse:'제2종근린생활시설',approvalDate:'2008-03-12',zoning:'일반상업지역',descriptionText:'광고 원문 보존 확인'});
  await mode(page,isMobile,'building_sale');
  await expect(page.locator('#list .sale-card-facts-v2')).toContainText('월 임대수입200만원');
  await expect(page.locator('#list .listing-sale-price-v1')).toContainText('5억원');
  await page.screenshot({path:info.outputPath('building-list.png')});
  await page.locator('#list .item-building-name').click();
  const drawer=page.locator('#unifiedDetailDrawerV8');
  await expect(drawer).toHaveAttribute('data-sale-presentation-v2','building');
  await expect(drawer.locator('.sale-overview-price-v2')).toHaveText('매매5억원');
  await expect(drawer.locator('.sale-fact-group-v2 > dt')).toContainText(['광고 면적','임대·수익 현황','건물 기본정보','필지·이용 조건']);
  await expect(drawer.locator('[data-sale-action="worksheet"]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('building-detail.png'),animations:'disabled'});
  await drawer.locator('[data-sale-action="worksheet"]').click();
  const dialog=page.locator('#saleWorkbenchDialogV1');
  await expect(dialog.locator('[data-calc="income"]')).toHaveValue('200');
  await expect(dialog.locator('[data-calc-result]')).toContainText('5.33%');
  await page.screenshot({path:info.outputPath('building-review.png')});
  expect(errors).toEqual([]);
});
test('land review separates acquisition cost and preserves old hidden assumptions, parcels and notes',async({page,isMobile},info)=>{
  await details(page,'FIXTURE-LAND',{landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'중로한면',parcelShape:'장방형'});
  await mode(page,isMobile,'land_sale');
  await expect(page.locator('#list .sale-card-facts-v2')).toContainText('중로한면');
  await page.screenshot({path:info.outputPath('land-list.png')});
  await page.locator('#list .item-building-name').click();
  const drawer=page.locator('#unifiedDetailDrawerV8');
  await expect(drawer).toHaveAttribute('data-sale-presentation-v2','land');
  await expect(drawer.locator('[data-land-basics-v93] .land-card-metrics-v4')).toContainText('토지면적');
  await expect(drawer.locator('[data-land-basics-v93] .land-card-metrics-v4')).toContainText('100평');
  await expect(drawer.locator('[data-sale-calculations-v38]')).toContainText('300');
  await page.screenshot({path:info.outputPath('land-detail.png'),animations:'disabled'});
  await page.evaluate(async()=>{
    await window.JSDataAccessV6.mutate('saveCloudState',{scope:'saleWorksheetV1',recordKey:'FIXTURE-LAND-ORIGINAL',expectedVersion:0,data:{assumptions:{price:30000,acquisition:1500,loan:10000,interest:4.8,deposit:123,income:45,vacancy:6,expense:7},parcels:[{address:'유성구 장대동 4-4',areaM2:330.5785}],note:'기존 검토 유지'}});
  });
  await drawer.locator('[data-sale-action="worksheet"]').click();
  const dialog=page.locator('#saleWorkbenchDialogV1');
  await expect(dialog.locator('[data-work-save]')).toBeEnabled();
  await expect(dialog.locator('[data-calc="income"],[data-calc="deposit"],[data-calc="vacancy"],[data-calc="expense"]')).toHaveCount(0);
  await expect(dialog.locator('[data-work-note]')).toHaveValue('기존 검토 유지');
  await expect(dialog.locator('[data-calc-result]')).toContainText('3억1,500만원');
  await expect(dialog.locator('[data-calc-result]')).toContainText('315만원');
  await page.screenshot({path:info.outputPath('land-review.png')});
  await dialog.locator('[data-work-save]').click();
  await expect(dialog.locator('[data-work-status]')).toContainText('저장했습니다');
  const saved=await page.evaluate(()=>window.JSDataAccessV6.read('loadCloudState',{scope:'saleWorksheetV1',recordKey:'FIXTURE-LAND-ORIGINAL'}));
  expect(saved.data.assumptions.income).toBe(45);expect(saved.data.assumptions.deposit).toBe(123);
  expect(saved.data.note).toBe('기존 검토 유지');expect(saved.data.parcels).toHaveLength(1);
});
test('wide handheld sale cards and detail stay within the viewport',async({page},info)=>{
  await page.setViewportSize({width:1280,height:680});
  const desktopSelector=page.locator('#listingTradeModeSelectV1');
  await page.locator(await desktopSelector.isVisible()?'#listingTradeModeSelectV1':'#jsMobileTradeModeV1').selectOption('building_sale');
  const listTab=page.locator('[data-mobile-view="list"]');if(await listTab.isVisible())await listTab.click();
  await page.evaluate(()=>window.JSMapListPanelV1.open());
  const card=page.locator('#list .item');await expect(card).toBeVisible();
  const rect=await card.boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(1281);
  await page.locator('#list .item-building-name').click();
  const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer).toHaveAttribute('data-sale-presentation-v2','building');
  expect(await drawer.locator('.unified-detail-body-v8').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('sale-wide.png'),animations:'disabled'});
});
test('variable sale card heights keep forward wheel movement and a bounded render window',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');
  await page.evaluate(()=>{
    const base=window.allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');
    window.allItems=Array.from({length:200},(_,n)=>({...base,source:'직접등록',propertyId:'SALE-SCROLL-'+n,key:'sale-scroll-'+n,
      name:'건물 비교 '+n,address:'대전 서구 검사동 '+n,saleDetails:n%2?{}:{landAreaM2:300,grossAreaM2:650,exclusiveAreaM2:85,totalDeposit:5000,monthlyIncome:200,buildingUse:'제2종근린생활시설'}}));
    window.JSUnifiedListingsV8.attach(window.allItems,{ok:true,groups:Object.fromEntries(window.allItems.map(i=>[i.propertyId,[]]))});
    window.showList(window.allItems);document.getElementById('fixtureControls').hidden=true;
  });
  const scroller=page.locator(isMobile?'#list':'#sidebar'),box=await scroller.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  for(let n=0;n<14;n++){
    const before=await scroller.evaluate(e=>e.scrollTop);await page.mouse.wheel(0,240);await page.waitForTimeout(50);
    expect(await scroller.evaluate(e=>e.scrollTop)).toBeGreaterThanOrEqual(before-1);
    expect(await page.locator('#list .item').count()).toBeLessThanOrEqual(isMobile?28:36);
  }
});
