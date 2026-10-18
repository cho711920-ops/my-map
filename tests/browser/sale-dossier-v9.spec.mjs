import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function open(page,isMobile,value='building_sale'){await mode(page,isMobile,value);await page.locator('#list .item-building-name').first().click();return page.locator('#unifiedDetailDrawerV8');}
test('fixed sale summary stays visible while reading and is removed from lease detail',async({page,isMobile},info)=>{
  const drawer=await open(page,isMobile),summary=drawer.locator('.sale-fixed-summary-v9');
  await expect(summary).toContainText('5억원');await expect(summary).toContainText('괴정동 3-3');
  await drawer.locator('.unified-detail-body-v8').evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect(summary).toBeInViewport();
  const buttons=summary.locator('[data-sale-unit]');const a=await buttons.nth(0).boundingBox(),b=await buttons.nth(1).boundingBox();expect(Math.abs(a.y-b.y)).toBeLessThan(2);expect(a.height).toBeLessThan(35);
  await page.screenshot({path:info.outputPath('sale-fixed-summary.png')});
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();await mode(page,isMobile,'lease');await page.locator('#list .item-building-name').first().click();await expect(drawer.locator('.sale-fixed-summary-v9')).toHaveCount(0);
});
test('original ad comparison highlights differences and switches to the exact chosen original',async({page,isMobile},info)=>{
  await page.route('**/api/data?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    const response=await route.fetch(),data=await response.json(),base=data.originals[0];
    data.originals.push({...base,originalId:base.originalId+'-ALT',source:'당근',salePrice:60000,saleDetails:{...base.saleDetails,monthlyIncome:0}});await route.fulfill({response,json:data});
  });
  const drawer=await open(page,isMobile);const before=await page.evaluate(()=>JSON.stringify(window.allItems));
  await drawer.getByRole('button',{name:'원본 광고 조건 비교',exact:true}).click();const dialog=page.locator('.sale-original-dialog-v9');
  await expect(dialog).toContainText('5억원');await expect(dialog).toContainText('6억원');await expect(dialog).toContainText('0만원');
  await expect(dialog.locator('.different')).not.toHaveCount(0);
  await dialog.locator('[data-compare-differences]').check();await expect(dialog.locator('tr').filter({has:dialog.getByText('광고 연면적',{exact:true})})).toBeHidden();await expect(dialog.locator('thead')).toBeVisible();
  await dialog.locator('[data-compare-differences]').uncheck();
  await dialog.locator('[data-sale-unit="m2"]').click();await expect(dialog.locator('.sale-unit-m2-v9').first()).toBeVisible();
  await page.screenshot({path:info.outputPath('sale-original-conditions.png')});
  await dialog.getByRole('button',{name:/당근 .*원본 선택/}).click();await expect(drawer.locator('.sale-fixed-summary-v9')).toContainText('6억원');await expect(drawer.locator('.sale-fixed-summary-v9')).toContainText('당근');
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(before);
});
test('parcel table saves the existing private format and keeps typed edits during a late load',async({page,isMobile},info)=>{
  let release,saved;
  await page.route('**/api/data*',async route=>{
    const r=route.request(),u=new URL(r.url()),body=r.method()==='POST'?r.postDataJSON():{};
    if(u.searchParams.get('action')==='loadCloudState'&&u.searchParams.get('scope')==='saleWorksheetV1'){await new Promise(r=>release=r);return route.fulfill({json:{ok:true,found:true,version:3,data:{parcels:[{address:'대전 유성구 장대동 7-7',areaM2:100}],note:'예전 메모'}}});}
    if(body.action==='saveCloudState'){saved=body;return route.fulfill({json:{ok:true,version:4}});}return route.continue();
  });
  await page.evaluate(()=>{window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3020010700100040004',links:{eum:'https://www.eum.go.kr/'}});});
  const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-action="worksheet"]').click();const dialog=page.locator('#saleWorkbenchDialogV1');
  await dialog.getByText('복수 필지 일괄 매매 관리',{exact:true}).click();
  const row=dialog.locator('[data-parcel-row]').first();await row.locator('[data-parcel-address]').fill('대전 유성구 장대동 4-4');await row.locator('[data-parcel-area]').fill('330.5785');
  await expect.poll(()=>typeof release).toBe('function');release();await expect(dialog.locator('[data-work-save]')).toBeEnabled();
  await expect(row.locator('[data-parcel-address]')).toHaveValue('대전 유성구 장대동 4-4');
  await row.locator('[data-parcel-check]').click();await expect(row.locator('[data-parcel-status]')).toContainText('입력 면적은 유지');
  await expect(dialog.locator('[data-parcel-totals]')).toContainText('100평');
  await dialog.locator('[data-parcel-add]').click();const second=dialog.locator('[data-parcel-row]').nth(1);await second.locator('[data-parcel-address]').fill('대전 유성구 장대동 5-5');await second.locator('[data-parcel-area]').fill('330.5785');
  await expect(dialog.locator('[data-parcel-totals]')).toContainText('2필지');await expect(dialog.locator('[data-parcel-totals]')).toContainText('200평');
  await expect(dialog.locator('[data-parcel-result]')).toBeHidden();
  await dialog.locator('[data-work-save]').click();await expect.poll(()=>saved?.data?.parcels?.length).toBe(2);expect(saved.data.parcels[0]).toEqual({address:'대전 유성구 장대동 4-4',areaM2:330.5785});
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}
  await page.screenshot({path:info.outputPath('land-parcel-table.png')});
});
test('floor diagram loads only on request, separates buildings and shows no occupancy inference',async({page,isMobile},info)=>{
  let calls=0;
  await page.evaluate(()=>{window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3017010800100030003',links:{}});});
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='buildingRegister')return route.continue();calls++;expect(u.searchParams.get('mode')).toBe('full');expect(u.searchParams.has('propertyId')).toBe(false);
    return route.fulfill({json:{ok:true,parcel:{sigunguCd:'30170',bjdongCd:'10800',platGbCd:'0',bun:'0003',ji:'0003'},queriedAt:'검수일시',partial:true,buildings:[{managementKey:'A',buildingName:'본동',floors:[{managementKey:'A',floorNo:1,mainUse:'소매점',area:100},{managementKey:'A',floorNo:2,mainUse:'사무소',area:80},{managementKey:'B',floorNo:9,mainUse:'다른동',area:999}]},{managementKey:'B',buildingName:'별동',floors:[{managementKey:'B',floorNo:1,mainUse:'창고',area:50}]}]}});
  });
  const drawer=await open(page,isMobile);expect(calls).toBe(0);await drawer.locator('[data-floors-load]').click();expect(calls).toBe(1);
  const section=drawer.locator('.sale-floors-v9');await expect(section.locator('.sale-floor-stack-v9')).toHaveCount(0);await section.locator('select').selectOption('0');
  await expect(section.locator('ol')).toContainText('소매점');await expect(section.locator('ol')).not.toContainText('다른동');await expect(section).toContainText('일부 자료');
  await section.locator('select').selectOption('1');await expect(section.locator('ol')).toContainText('창고');await expect(section.locator('ol')).not.toContainText('소매점');
  await page.screenshot({path:info.outputPath('building-floor-stack.png')});
});
test('area units switch across list, detail, comparison and report without changing source values',async({page,isMobile})=>{
  await mode(page,isMobile,'land_sale');const original=await page.evaluate(()=>JSON.stringify(window.allItems));
  await page.locator('#list .item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');await drawer.locator('[data-sale-unit="m2"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-sale-area-unit-v9','m2');
  await expect(page.locator('#list .land-card-metrics-v4 .sale-unit-m2-v9').first()).toBeVisible();await expect(page.locator('#list .land-card-metrics-v4 .sale-unit-py-v9').first()).toBeHidden();
  await drawer.locator('[data-sale-action="report"]').click();const dialog=page.locator('.sale-single-report-dialog-v8');await expect(dialog.locator('.sale-review-facts-v8 .sale-unit-m2-v9').first()).toBeVisible();
  await dialog.locator('[data-sale-unit="py"]').click();await expect(dialog.locator('.sale-review-facts-v8 .sale-unit-py-v9').first()).toBeVisible();await dialog.locator('[data-sale-close]').click();
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(original);
});
test('asking history is on demand, paginated and does not mutate a listing',async({page,isMobile},info)=>{
  let calls=0;await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleAskingHistory')return route.continue();calls++;const more=!u.searchParams.get('beforeId');
    return route.fulfill({json:{ok:true,originalId:u.searchParams.get('originalId'),source:'네이버',sourceListingId:'TEST-AD',hasMore:more,nextCursor:more?'20':'',entries:more?[{id:30,at:'2026-10-18T00:00:00Z',kind:'price_changed',beforePrice:300000,price:280000}]:[{id:10,at:'2026-10-17T00:00:00Z',kind:'conditions_changed',beforePrice:310000,price:300000}]}});
  });
  const drawer=await open(page,isMobile),history=drawer.locator('.sale-asking-history-v9');expect(calls).toBe(0);const before=await page.evaluate(()=>JSON.stringify(window.allItems));
  await drawer.locator('.sale-secondary-tools-v10>summary').click();await history.locator('summary').click();await history.locator('[data-history-load]').click();await expect(history).toContainText('30억원 → 28억원');
  await history.locator('[data-history-load]').click();await expect(history).toContainText('조건도 변경');await expect(history.locator('li')).toHaveCount(2);expect(calls).toBe(2);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(before);await page.screenshot({path:info.outputPath('sale-asking-history.png')});
});
