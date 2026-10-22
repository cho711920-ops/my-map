import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function land(page,isMobile,detail={landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'중로한면',parcelShape:'장방형'}){
  await page.evaluate(detail=>{
    const i=window.allItems.find(i=>i.propertyId==='FIXTURE-LAND');
    Object.assign(i,{sourceFloorVerifiedV1:true,advertisedRoomV1:'',floor:null,room:'301호',buildingYear:'2001',elevator:2,saleDetails:null,saleSummary:null});
    for(const o of i.unifiedOriginalsV8)Object.assign(o,{saleDetails:undefined,saleSummary:detail});
    window.landSnapshotV4=JSON.stringify(i);
  },detail);
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('land_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator('#list .listing-land-card-v4')).toHaveCount(1);
}
test('land list uses parcel metrics and actions even when collected building fields are present',async({page,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await land(page,isMobile);
  const card=page.locator('#list .item');
  await expect(card.locator('.land-use-badge-v1')).toHaveText('지목: 대');
  await expect(card.locator('.item-building-year-v650,.item-building-elevator-v843')).toHaveCount(0);
  await expect(card).not.toContainText(/층수|301호|준공|임대조건/);
  await expect(card.locator('.listing-sale-price-v1')).toContainText('3억원');
  await expect(card.locator('.sale-list-metrics-v16')).toContainText('100평');
  await expect(card.locator('.sale-list-metrics-v16')).toContainText('330.58㎡');
  await expect(card.locator('.sale-list-metrics-v16')).toContainText('300만원');
  await expect(card.locator('.sale-card-facts-v2')).toContainText('제2종일반주거지역');
  await expect(card.locator('.sale-card-facts-v2')).toContainText('중로한면');
  await expect(card.locator('.sale-card-facts-v2')).toContainText('장방형');
  await expect(card.locator('.item-edit-btn-v630')).toHaveAttribute('aria-label','매매정보 수정');
  await expect(card.locator('.land-parcel-lookup-v4')).toHaveText('필지조회');
  await expect(card.locator('.item-memo-toggle')).toBeVisible();
  if(isMobile)await expect(card.locator('.phone-card-favorite-v2')).toBeVisible();
  expect(await card.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems.find(i=>i.propertyId==='FIXTURE-LAND'))===window.landSnapshotV4)).toBe(true);
  await page.screenshot({path:info.outputPath('land-list-v4.png')});
  await card.locator('.land-parcel-lookup-v4').click();
  await expect(page.locator('#saleWorkbenchDialogV1')).toContainText('토지이음');
  await expect(page.locator('#unifiedDetailDrawerV8[aria-hidden="false"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('land card fits a narrow phone without losing its actions',async({page,isMobile})=>{
  test.skip(!isMobile,'phone layout boundary');
  await page.setViewportSize({width:320,height:740});await land(page,true);
  const card=page.locator('#list .item');
  expect(await card.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await expect(card.locator('.item-memo-toggle')).toBeVisible();
  await expect(card.locator('.phone-card-favorite-v2')).toBeVisible();
});
test('land list does not invent area, unit price, road or shape when absent',async({page,isMobile},info)=>{
  await land(page,isMobile,{});
  const card=page.locator('#list .item');
  await expect(card.locator('.sale-list-missing-v16')).toHaveText('면적 정보 미제공');
  await expect(card.locator('.sale-list-metrics-v16')).toHaveCount(0);
  await expect(card).not.toContainText(/0평|0만원|100평/);
  await expect(card.locator('.sale-card-facts-v2')).toHaveCount(0);
  await expect(card).not.toContainText(/층수|301호|준공/);
  await page.screenshot({path:info.outputPath('land-list-missing-v4.png')});
});
test('mixed land card heights maintain forward wheel scrolling with bounded DOM',async({page,isMobile})=>{
  await land(page,isMobile);
  await page.evaluate(()=>{
    const base=window.allItems.find(i=>i.propertyId==='FIXTURE-LAND');
    window.allItems=Array.from({length:180},(_,n)=>({...base,source:'직접등록',propertyId:'LAND-SCROLL-'+n,key:'land-scroll-'+n,
      name:'필지 비교 '+n,address:'대전 서구 검사동 '+n,saleDetails:n%2?{}:{landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'중로한면',parcelShape:'장방형'}}));
    window.JSUnifiedListingsV8.attach(window.allItems,{ok:true,groups:Object.fromEntries(window.allItems.map(i=>[i.propertyId,[]]))});
    window.showList(window.allItems);document.getElementById('fixtureControls').hidden=true;
  });
  const scroll=page.locator(isMobile?'#list':'#sidebar'),box=await scroll.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  for(let n=0;n<14;n++){
    const before=await scroll.evaluate(e=>e.scrollTop);await page.mouse.wheel(0,240);await page.waitForTimeout(50);
    expect(await scroll.evaluate(e=>e.scrollTop)).toBeGreaterThanOrEqual(before-1);
  }
  expect(await scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(600);
  expect(await page.locator('#list .item').count()).toBeLessThan(100);
});
