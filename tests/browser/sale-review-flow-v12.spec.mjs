import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function open(page,isMobile,value='building_sale'){await mode(page,isMobile,value);await page.locator('#list .item-building-name').first().click();return page.locator('#unifiedDetailDrawerV8');}
test('saved assumptions show current ad differences and only an explicit field application edits the draft',async({page,isMobile},info)=>{
  let saves=0,saved;
  await page.route('**/api/data*',route=>{const req=route.request(),u=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():{};
    if(u.searchParams.get('action')==='loadCloudState'&&u.searchParams.get('scope')==='saleWorksheetV1')return route.fulfill({json:{ok:true,found:true,version:3,data:{assumptions:{price:60000,deposit:1234,income:400,loan:9000,interest:5,vacancy:3,expense:20,acquisition:200},savedAt:'2026-10-18T00:00:00Z',note:'나의 검토'}}});
    if(body.action==='saveCloudState'){saves++;saved=body;return route.fulfill({json:{ok:true,version:4}});}return route.continue();
  });
  const drawer=await open(page,isMobile),before=await page.evaluate(()=>JSON.stringify(allItems));await drawer.locator('[data-sale-action="worksheet"]').click();const d=page.locator('#saleWorkbenchDialogV1'),diff=d.locator('.sale-saved-diff-v12');
  await expect(d.locator('[data-work-save]')).toBeEnabled();await expect(diff).toContainText('60,000만원');await expect(diff).toContainText('50,000만원');await expect(diff).toContainText('2026.10.18 09:00 KST');
  expect(saves).toBe(0);await expect(d.locator('[data-calc="price"]')).toHaveValue('60000');
  await diff.locator('[data-sale-apply-field="price"]').click();await expect(d.locator('[data-calc="price"]')).toHaveValue('50000');await expect(d.locator('[data-calc="deposit"]')).toHaveValue('1234');await expect(d.locator('[data-calc="loan"]')).toHaveValue('9000');await expect(d.locator('[data-work-status]')).toContainText('아직 저장되지');expect(saves).toBe(0);
  await diff.locator('[data-sale-apply-field="income"]').click();await expect(diff.locator('[data-sale-apply-field="income"]')).toBeDisabled();
  await page.screenshot({path:info.outputPath('saved-ad-differences.png')});
  await d.locator('[data-work-save]').click();await expect.poll(()=>saves).toBe(1);expect(saved.data.assumptions.price).toBe('50000');expect(saved.data.assumptions.deposit).toBe('1234');expect(saved.data.note).toBe('나의 검토');expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}
});
test('late worksheet loading retains typed input and land exposes only the price comparison',async({page,isMobile})=>{
  let release;
  await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='loadCloudState'||u.searchParams.get('scope')!=='saleWorksheetV1')return route.continue();await new Promise(resolve=>release=resolve);return route.fulfill({json:{ok:true,found:true,version:1,data:{assumptions:{price:60000},savedAt:'2026-10-18'}}});});
  const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-action="worksheet"]').click();const d=page.locator('#saleWorkbenchDialogV1');
  await d.locator('[data-calc="price"]').fill('45000');await expect.poll(()=>typeof release).toBe('function');release();await expect(d.locator('[data-work-save]')).toBeEnabled();
  await expect(d.locator('[data-calc="price"]')).toHaveValue('45000');await expect(d.locator('[data-sale-apply-field]')).toHaveCount(1);await expect(d.locator('[data-sale-apply-field="price"]')).toBeEnabled();await expect(d.locator('.sale-saved-diff-v12')).toContainText('60,000만원');
});
test('missing ad income stays unavailable while a provided zero deposit can be explicitly applied',async({page,isMobile})=>{
  await mode(page,isMobile,'building_sale');
  await page.route('**/api/data?*',route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='loadCloudState'||u.searchParams.get('scope')!=='saleWorksheetV1')return route.continue();return route.fulfill({json:{ok:true,found:true,version:1,data:{assumptions:{price:50000,deposit:100,income:200}}}});});
  await page.evaluate(()=>JSSaleWorkbenchV1.worksheet({originalId:'FLOW-MISSING',propertyId:'FIXTURE-BUILDING',tradeType:'sale',saleCategory:'building',salePrice:50000,source:'네이버',address:'대전 서구 괴정동 3-3',saleDetails:{totalDeposit:0,monthlyIncome:null}}));
  const d=page.locator('#saleWorkbenchDialogV1');await expect(d.locator('[data-work-save]')).toBeEnabled();await expect(d.locator('[data-sale-apply-field="income"]')).toBeDisabled();await expect(d.locator('[data-sale-apply-field="income"]')).toContainText('미제공');
  await expect(d.locator('[data-calc="income"]')).toHaveValue('200');await d.locator('[data-sale-apply-field="deposit"]').click();await expect(d.locator('[data-calc="deposit"]')).toHaveValue('0');await expect(d.locator('[data-calc="income"]')).toHaveValue('200');
});
test('failed private review load cannot claim a match or enable saving',async({page,isMobile})=>{
  await page.route('**/api/data?*',route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='loadCloudState'||u.searchParams.get('scope')!=='saleWorksheetV1')return route.continue();return route.fulfill({status:403,json:{ok:false,message:'검수용 접근 제한'}});});
  const drawer=await open(page,isMobile);await drawer.locator('[data-sale-action="worksheet"]').click();const d=page.locator('#saleWorkbenchDialogV1');await expect(d.locator('.sale-saved-diff-v12')).toContainText('비교할 수 없습니다');await expect(d.locator('[data-work-save]')).toBeDisabled();await expect(d.locator('[data-calc="price"]')).toHaveValue('50000');
});
test('building composition follows exact selected building and hides percentages for partial data',async({page,isMobile},info)=>{
  let calls=0,partial=false;
  await page.evaluate(()=>{JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3017010800100030003',links:{}});});
  await page.route('**/api/data?*',route=>{if(new URL(route.request().url()).searchParams.get('action')!=='buildingRegister')return route.continue();calls++;return route.fulfill({json:{ok:true,partial,queriedAt:'2026-10-19T00:00:00Z',parcel:{sigunguCd:'30170',bjdongCd:'10800',platGbCd:'0',bun:'0003',ji:'0003'},buildings:[{managementKey:'A',buildingName:'본동',floors:[{managementKey:'A',floorNo:1,mainUse:'근린생활시설',area:150},{managementKey:'A',floorNo:2,mainUse:'주택',area:50},{managementKey:'B',floorNo:9,mainUse:'다른동',area:900}]},{managementKey:'B',buildingName:'별동',floors:[{managementKey:'B',floorNo:1,mainUse:'창고',area:80}]}]}});});
  const drawer=await open(page,isMobile);expect(calls).toBe(0);await drawer.locator('[data-floors-load]').click();const section=drawer.locator('.sale-floors-v9');await section.locator('select').selectOption('0');
  const composition=section.locator('.sale-use-composition-v12');await expect(composition).toContainText('75%');await expect(composition).toContainText('25%');await expect(composition).not.toContainText('다른동');
  await composition.scrollIntoViewIfNeeded();await expect(drawer.locator('.sale-fixed-summary-v9')).toBeInViewport();await expect(drawer.locator('.sale-detail-pager-v12')).toBeInViewport();expect(await drawer.evaluate(el=>el.querySelector('.unified-detail-body-v8').getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom+1)).toBe(true);await page.screenshot({path:info.outputPath('building-use-composition.png')});await section.locator('select').selectOption('1');await expect(composition).toContainText('100%');await expect(composition).not.toContainText('주택');
  partial=true;await section.locator('[data-floors-load]').click();await section.locator('select').selectOption('0');await expect(composition).toContainText('전체 비율은 표시하지');await expect(composition.locator('.sale-area-track-v12')).toHaveCount(0);expect(calls).toBe(2);
});
test('parcel composition responds to entered areas, missing areas and deletion without saving or changing ad areas',async({page,isMobile},info)=>{
  let saves=0;page.on('request',req=>{if(req.method()==='POST'&&req.url().includes('/api/data'))saves++;});
  const drawer=await open(page,isMobile,'land_sale'),before=await page.evaluate(()=>JSON.stringify(allItems));await drawer.locator('[data-sale-action="worksheet"]').click();const d=page.locator('#saleWorkbenchDialogV1');await expect(d.locator('[data-work-save]')).toBeEnabled();await d.getByText('복수 필지 일괄 매매 관리',{exact:true}).click();
  const rows=d.locator('[data-parcel-row]'),composition=d.locator('.sale-parcel-composition-v12');await rows.first().locator('[data-parcel-address]').fill('대전 서구 도마동 1-1');await rows.first().locator('[data-parcel-area]').fill('100');
  await d.locator('[data-parcel-add]').click();await rows.nth(1).locator('[data-parcel-address]').fill('대전 서구 도마동 1-2');await expect(composition.locator('.sale-area-track-v12')).toHaveCount(0);
  await rows.nth(1).locator('[data-parcel-area]').fill('300');await expect(composition).toContainText('75%');await expect(composition).toContainText('25%');
  await composition.scrollIntoViewIfNeeded();if(isMobile){await page.setViewportSize({width:320,height:720});expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}await page.screenshot({path:info.outputPath('parcel-area-composition.png')});await rows.nth(1).locator('[data-parcel-remove]').click();await expect(composition).toContainText('100%');expect(saves).toBe(0);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
});
async function seedNavigation(page,market,count){
  await page.evaluate(({market,count})=>{const base=allItems.find(i=>i.propertyId===(market==='land_sale'?'FIXTURE-LAND':'FIXTURE-BUILDING'));
    const items=Array.from({length:count},(_,n)=>({...base,key:'flow-'+n,propertyId:'FLOW-'+n,name:'검토 후보 '+n,address:'대전 서구 괴정동 '+(n+1)+'-1',salePrice:30000+n*100}));
    allItems=allItems.filter(i=>i.tradeType!=='sale').concat(items);window.__flowGroups=Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-O',buildingName:i.name,images:[],photoCount:0}]]));JSUnifiedListingsV8.attach(allItems,{ok:true,groups:__flowGroups});document.getElementById('fixtureControls').hidden=true;
  },{market,count});
  await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='unifiedListingDetail')return route.continue();const originals=await page.evaluate(id=>__flowGroups[id]||[],u.searchParams.get('propertyId'));return route.fulfill({json:{ok:true,originals}});});
}
test('next detail keeps the exact source original selected by the active filter and makes no write requests',async({page,isMobile})=>{
  await seedNavigation(page,'building_sale',2);
  await page.evaluate(()=>{for(const originals of Object.values(__flowGroups)){if(originals[0].tradeType!=='sale')continue;originals.push({...originals[0],originalId:originals[0].originalId+'-ALT',source:'당근',salePrice:75000});}JSUnifiedListingsV8.attach(allItems,{ok:true,groups:__flowGroups});});
  let writes=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/data'))writes++;});
  await mode(page,isMobile,'building_sale');await page.evaluate(()=>{document.getElementById('sourceFilter').value='당근';applyFilter();});await page.locator('#list .item-building-name').first().click();
  const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer.locator('.sale-fixed-summary-v9')).toContainText('당근');await drawer.locator('[data-sale-step="1"]').click();await expect(drawer.locator('.sale-fixed-summary-v9')).toContainText('7억5,000만원');await expect(drawer.locator('.sale-fixed-summary-v9')).toContainText('당근');
  expect(await drawer.evaluate(el=>el.__detailPresentationV2.originalId)).toBe('FLOW-1-O-ALT');expect(writes).toBe(0);
});
for(const market of ['building_sale','land_sale'])test(market+' detail navigation uses the full filtered virtual list and preserves scroll and selections',async({page,isMobile},info)=>{
  await seedNavigation(page,market,150);await mode(page,isMobile,market);
  await page.evaluate(()=>{const s=getListingScrollContainerV2();s.scrollTop=10000;s.dispatchEvent(new Event('scroll'));});
  await expect.poll(()=>page.locator('#list .item').first().getAttribute('data-list-index-v1')).not.toBe('0');
  const snapshot=await page.evaluate(()=>({top:getListingScrollContainerV2().scrollTop,selected:JSON.stringify(selectedPrintKeys),data:JSON.stringify(allItems)}));
  await page.evaluate(()=>JSUnifiedListingsV8.open('FLOW-100','FLOW-100-O'));const drawer=page.locator('#unifiedDetailDrawerV8'),pager=drawer.locator('.sale-detail-pager-v12');await expect(pager).toContainText('101 / 150');
  await pager.locator('[data-sale-step="1"]').click();await expect(pager).toContainText('102 / 150');await expect(drawer.locator('#unifiedDetailTitleV8')).toContainText('검토 후보 101');await pager.locator('[data-sale-step="-1"]').click();await expect(pager).toContainText('101 / 150');
  expect(Math.abs(await page.evaluate(()=>getListingScrollContainerV2().scrollTop)-snapshot.top)).toBeLessThan(3);
  await page.evaluate(()=>{document.getElementById('minDeposit').value='39900';document.getElementById('maxDeposit').value='40000';selectSortOption('salePriceHigh');});await expect(pager).toContainText('1 / 2');await expect(pager.locator('[data-sale-step="-1"]')).toBeDisabled();await pager.locator('[data-sale-step="1"]').click();await expect(drawer.locator('#unifiedDetailTitleV8')).toContainText('검토 후보 99');await expect(pager.locator('[data-sale-step="1"]')).toBeDisabled();
  await page.screenshot({path:info.outputPath(market+'-detail-navigation.png')});
  await page.evaluate(()=>{document.getElementById('minDeposit').value='99999999';document.getElementById('maxDeposit').value='';applyFilter();});await expect(pager).toContainText('현재 목록 밖');await expect(pager.locator('button:disabled')).toHaveCount(2);
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(snapshot.data);expect(await page.evaluate(()=>JSON.stringify(selectedPrintKeys))).toBe(snapshot.selected);
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();await page.evaluate(()=>{document.getElementById('minDeposit').value='';applyFilter();});await mode(page,isMobile,'lease');await page.locator('#list .item-building-name').first().click();await expect(drawer.locator('.sale-detail-pager-v12')).toHaveCount(0);
});
