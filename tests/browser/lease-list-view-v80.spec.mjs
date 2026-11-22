import {test, expect} from '@playwright/test';

async function showViewMenu(page,isMobile) {
  if(isMobile){
    if(!await page.locator('#v6DetailSheetPortal').isVisible())await page.locator('#jsMobileSearchFormV1 [data-mobile-action="filter"]').click();
  }else{
    if(!await page.evaluate(()=>typeof toggleMapQuickPopoverV657==='function'))await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
    if(await page.locator('#mapQuickViewBtn').getAttribute('aria-expanded')!=='true')await page.locator('#mapQuickViewBtn').click();
  }
}
async function closeViewMenu(page,isMobile) {
  if(isMobile)await page.locator('#v6DetailSheetPortal .v6-detail-sheet-close').click();
  else await page.locator('#mapQuickViewBtn').click();
}
async function expectDefaultView(page) {
  await expect(page.locator('#leaseListViewV80')).toHaveCount(0);
  await expect(page.locator('[data-lease-list-view]')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-lease-list-view-v80', /.+/);
}
async function setup(page, context, isMobile) {
  const errors = [], writes = [], detailReads = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.protocol !== 'data:') return route.abort();
    if (request.method() !== 'GET') writes.push(url.pathname);
    if (url.searchParams.get('action') === 'unifiedListingDetail') detailReads.push(url.pathname);
    return route.continue();
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#fixtureControls').evaluate(el => el.remove());
  return {errors, writes, detailReads};
}

test('default lease photos, visible actions and selection remain usable without a size selector', async ({page, context, isMobile}, info) => {
  const state = await setup(page, context, isMobile);
  await page.evaluate(() => {
    JSUnifiedListingsV8.attach(allItems, {ok:true, groups:Object.fromEntries(allItems.map((item, index) => [item.propertyId, [{...item,
      originalId:item.propertyId + '-PHOTO', images:index === 0 ? [location.origin + '/icons/js-192.png'] : [], photoCount:index === 0 ? 1 : 0}]]))});
    showList(allItems.filter(item => item.tradeType === 'lease'));
  });
  const card = page.locator('#list .item').first(), thumb = card.locator('.unified-thumb-v8');
  await expect(page.locator('.map-list-panel-head-v1')).toBeHidden();await expectDefaultView(page);
  const standard = await thumb.boundingBox(), image = thumb.locator('img');
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(Math.abs((await image.boundingBox()).width - standard.width)).toBeLessThanOrEqual(2);
  expect(Math.abs((await image.boundingBox()).height - standard.height)).toBeLessThanOrEqual(2);
  expect(standard.width).toBeLessThan(isMobile ? 130 : 178);
  const buttons = card.locator('.item-action-left > button, .item-memo-toggle');
  expect(await buttons.count()).toBe(6);
  let visibleActions=0;
  for (const button of await buttons.all()) {
    if(!await button.isVisible())continue;
    visibleActions++;
    const box = await button.boundingBox(), bounds = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  expect(visibleActions).toBeGreaterThan(0);
  for (const selector of ['.price-main', '.price-area', '.item-head-select-v650']) await expect(card.locator(selector)).toBeVisible();
  for(const selector of ['.price-fee','.price-premium']){
    await expect(card.locator(selector)).toBeVisible();
  }
  await expect(card.locator('.pyeong-mini-badge')).toHaveCount(0);
  const before = await page.evaluate(() => JSON.stringify(allItems));
  await card.locator('.action-select-check').check();state.writes.length = 0; state.detailReads.length = 0;
  const width = (await page.locator('#sidebar').boundingBox()).width;
  await showViewMenu(page,isMobile);await expectDefaultView(page);
  await page.screenshot({path:info.outputPath('lease-default-view-menu-v278.png')});await closeViewMenu(page,isMobile);
  expect((await thumb.boundingBox()).width).toBe(standard.width);
  expect((await page.locator('#sidebar').boundingBox()).width).toBe(width);
  await expect(card.locator('.action-select-check')).toBeChecked();
  expect(await page.evaluate(() => JSON.stringify(allItems))).toBe(before);
  expect(state.writes).toEqual([]); expect(state.detailReads).toEqual([]); expect(state.errors).toEqual([]);
});

test('a legacy large preference is ignored through reload and all markets keep their default layout', async ({page, context, isMobile}) => {
  await page.addInitScript(()=>localStorage.setItem('js_map_lease_list_view_v80','large'));
  const state = await setup(page, context, isMobile);
  await expectDefaultView(page);
  expect((await page.locator('#list .item .unified-thumb-v8').first().boundingBox()).width).toBeLessThan(isMobile ? 130 : 178);
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  for (const mode of ['building_sale', 'land_sale','lease']) {
    await page.evaluate(mode => JSListingTradeV1.setMode(mode), mode);
    await showViewMenu(page,isMobile);await expectDefaultView(page);await closeViewMenu(page,isMobile);
    if(mode!=='lease')await expect(page.locator('#list .item')).toHaveCount(1);
  }
  expect(await page.evaluate(()=>localStorage.getItem('js_map_lease_list_view_v80'))).toBe('large');
  expect(state.errors).toEqual([]);
});

test('returning from sale preserves the default lease card dimensions', async ({page, context, isMobile}) => {
  const state = await setup(page, context, isMobile),thumb=page.locator('#list .item .unified-thumb-v8').first();
  const before=await thumb.boundingBox();
  await page.evaluate(() => {JSListingTradeV1.setMode('building_sale'); JSListingTradeV1.setMode('lease');});
  await expectDefaultView(page);const after=await thumb.boundingBox();
  expect(after.width).toBeCloseTo(before.width,2);expect(after.height).toBeCloseTo(before.height,2);expect(state.errors).toEqual([]);
});

test('blocked size preference storage leaves default cards and exact memo actions usable', async ({page, context, isMobile}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {if (key === 'js_map_lease_list_view_v80') throw Error('fixture blocked'); return get.call(this, key);};
    Storage.prototype.setItem = function(key, value) {if (key === 'js_map_lease_list_view_v80') throw Error('fixture blocked'); return set.call(this, key, value);};
  });
  const state=await setup(page,context,isMobile);await expectDefaultView(page);
  const card=page.locator('#list .item').first(),id=await card.getAttribute('data-property-id');
  await card.locator('.item-memo-toggle').click();await expect(card).toHaveClass(/memo-open/);
  await showViewMenu(page,isMobile);await expectDefaultView(page);await closeViewMenu(page,isMobile);
  expect(await card.getAttribute('data-property-id')).toBe(id);await expect(card).toHaveClass(/memo-open/);expect(state.errors).toEqual([]);
});

test('portrait filters and landscape View keep the default layout without a size selector',async({browser,baseURL})=>{
  const portrait={width:390,height:844},landscape={width:844,height:390};
  const context=await browser.newContext({baseURL,viewport:portrait,screen:portrait,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'});
  try{
    await context.addInitScript(()=>localStorage.setItem('js_map_lease_list_view_v80','large'));
    const page=await context.newPage(),state=await setup(page,context,true);await showViewMenu(page,true);await expectDefaultView(page);await closeViewMenu(page,true);
    const before=await page.evaluate(()=>JSON.stringify(allItems)),session=await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride',{...landscape,screenWidth:landscape.width,screenHeight:landscape.height,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    await expect(page.locator('html')).not.toHaveClass(/js-phone-app-v2/);await showViewMenu(page,false);await expectDefaultView(page);await closeViewMenu(page,false);
    await session.send('Emulation.setDeviceMetricsOverride',{...portrait,screenWidth:portrait.width,screenHeight:portrait.height,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'portraitPrimary',angle:0}});
    await expect(page.locator('html')).toHaveClass(/js-phone-app-v2/);await showViewMenu(page,true);await expectDefaultView(page);
    await expect(page.locator('.map-list-panel-head-v1')).toBeHidden();expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
    expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);expect(state.detailReads).toEqual([]);
  }finally{await context.close();}
});

async function quickRailSetupV243(page,context,isMobile) {
  const state=await setup(page,context,false);
  if(isMobile){
    await page.setViewportSize({width:930,height:530});
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:930,height:530,screenWidth:1100,screenHeight:720,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    await page.evaluate(()=>dispatchEvent(new Event('orientationchange')));
    await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
  }
  await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  return state;
}
for(const device of [{name:'phone landscape',width:844,height:390,phone:true},{name:'tablet landscape',width:1280,height:800,phone:false}])test('v249 compact management popup stays reachable '+device.name,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width:device.width,height:device.height},screen:{width:device.width,height:device.height},isMobile:true,hasTouch:true,serviceWorkers:'block',userAgent:'Mozilla/5.0 (Linux; Android 14; '+(device.phone?'Pixel 8':'SM-X710')+') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 '+(device.phone?'Mobile ':'')+'Safari/537.36'});
  try{
    await context.addInitScript(()=>Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'Linux armv8l'}));const page=await context.newPage();
    const session=await context.newCDPSession(page);await session.send('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,screenWidth:device.width,screenHeight:device.height,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    const state=await setup(page,context,false);await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
    await page.locator('#mapMoreBtnV249').click();const menu=page.locator('#mapQuickPopoverMoreV249');await expect(menu).toBeVisible();await expect(menu).toBeInViewport({ratio:1});expect(await menu.evaluate(m=>m.offsetHeight)).toBeLessThanOrEqual(240);
    for(const button of await menu.locator(':scope > button').all())await expect(button).toBeInViewport({ratio:1});
    const size=await page.locator('#detailBtn').evaluate(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}));expect(size.h).toBeGreaterThanOrEqual(44);expect(size.w).toBeGreaterThanOrEqual(68);
    await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(page.locator('#mapMoreBtnV249')).toBeFocused();expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
  }finally{await context.unrouteAll({behavior:'ignoreErrors'});await context.close();}
});

test('v249 market tabs preserve mode actions and the larger filter target fits the reclaimed header',async({page,context,isMobile})=>{
  const state=await quickRailSetupV243(page,context,isMobile);state.writes.length=0;
  await page.evaluate(()=>{window.__marketAppliesV249=0;const apply=window.applyFilter;window.applyFilter=function(...args){__marketAppliesV249++;return apply.apply(this,args);};});
  for(const mode of ['building_sale','land_sale','lease']){
    const button=page.locator('.market-tabs-v249 [data-market-v249="'+mode+'"]');await button.click();
    await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.locator('#listingTradeModeSelectV1')).toHaveValue(mode);
    expect(await page.evaluate(()=>JSListingTradeV1.getMode())).toBe(mode);
  }
  expect(await page.evaluate(()=>__marketAppliesV249)).toBe(3);await page.locator('[data-market-v249="lease"]').click();expect(await page.evaluate(()=>__marketAppliesV249)).toBe(3);
  const geometry=await page.locator('#detailBtn').evaluate(b=>{const r=b.getBoundingClientRect(),search=document.getElementById('keyword').getBoundingClientRect(),tabs=document.querySelector('.market-tabs-v249').getBoundingClientRect();return{w:r.width,h:r.height,search:search.width,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0,tabsEnd:tabs.right,searchStart:search.left};});
  expect(geometry.w).toBeGreaterThanOrEqual(76);expect(geometry.h).toBeGreaterThanOrEqual(48);expect(geometry.search).toBeGreaterThan(90);expect(geometry.inside).toBe(true);expect(geometry.tabsEnd).toBeLessThanOrEqual(geometry.searchStart);
  const compact=await page.locator('#detailBtn').evaluate(b=>{const bar=b.closest('.filters'),primary=b.parentElement,style=getComputedStyle(bar),tabs=document.querySelector('.listing-trade-mode-v1'),tell=document.querySelector('.desktop-tell-v8'),field=document.getElementById('keyword'),search=document.querySelector('.search-row .search-btn'),reset=document.getElementById('topResetBtn'),gap=parseFloat(getComputedStyle(primary).columnGap)||0;const available=bar.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),fixed=tabs.offsetWidth+tell.offsetWidth+search.offsetWidth+b.offsetWidth+reset.offsetWidth+2*gap;const target=matchMedia('(min-width:1200px) and (hover:hover) and (pointer:fine)').matches?Math.max(180,(available-fixed+24)/4):(available-fixed)/2;return{halfDelta:Math.abs(field.offsetWidth-target),gap:tell.offsetLeft-tabs.offsetLeft-tabs.offsetWidth};});
  expect(compact.halfDelta).toBeLessThanOrEqual(2);expect(compact.gap).toBeGreaterThanOrEqual(12);
  if(!isMobile)for(const width of [1920,2560]){await page.setViewportSize({width,height:900});const wide=await page.locator('#detailBtn').evaluate(b=>{const bar=b.closest('.filters'),primary=b.parentElement,style=getComputedStyle(bar),tabs=document.querySelector('.listing-trade-mode-v1'),tell=document.querySelector('.desktop-tell-v8'),field=document.getElementById('keyword'),search=document.querySelector('.search-row .search-btn'),reset=document.getElementById('topResetBtn'),gap=parseFloat(getComputedStyle(primary).columnGap)||0,available=bar.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),fixed=tabs.offsetWidth+tell.offsetWidth+search.offsetWidth+80+reset.offsetWidth+2*gap;return{delta:Math.abs(field.offsetWidth-(available-fixed)/4),w:b.offsetWidth,h:b.offsetHeight,right:reset.getBoundingClientRect().right};});expect(wide.delta).toBeLessThanOrEqual(2);expect(wide.w).toBe(104);expect(wide.h).toBe(48);expect(wide.right).toBeLessThanOrEqual(width);}
  await page.locator('#detailBtn').click();
  if(isMobile){await expect(page.locator('#v6DetailSheetPortal .v6-detail-sheet')).toBeVisible();await page.locator('#v6DetailSheetPortal .v6-detail-sheet-close').click();}
  else{await expect(page.locator('#detailFilter')).toBeVisible();await page.locator('#detailBtn').click();}
  expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
});

test('v249 bottom More preserves all four existing actions, closes outside and restores keyboard focus',async({page,context,isMobile},info)=>{
  const state=await quickRailSetupV243(page,context,isMobile);state.writes.length=0;
  const before=await page.evaluate(()=>JSON.stringify(allItems));
  await page.evaluate(()=>{window.__managementV249=[];JSSaleWorkbenchV1.openTopLookup=()=>__managementV249.push('parcel');window.openOperationsCenter=()=>__managementV249.push('operations');window.openQuickAddModal=()=>__managementV249.push('add');window.jsSecureLogout=()=>__managementV249.push('logout');});
  const more=page.locator('#mapMoreBtnV249'),menu=page.locator('#mapQuickPopoverMoreV249');
  for(const [selector,action] of [['.top-parcel-lookup-v1','parcel'],['.desktop-operations-action','operations'],['.quick-add-btn','add'],['#topLogoutBtnV1','logout']]){
    await more.click();await expect(menu).toBeVisible();await expect(menu).toBeInViewport({ratio:1});
    await expect(menu.locator(':scope > button')).toHaveCount(4);
    await menu.locator(selector).click();await expect(menu).toBeHidden();expect((await page.evaluate(()=>__managementV249)).at(-1)).toBe(action);
  }
  expect(await page.evaluate(()=>__managementV249)).toEqual(['parcel','operations','add','logout']);
  await more.click();await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(more).toBeFocused();
  await more.click();await page.locator('#mapQuickViewBtn').click();await expect(menu).toBeHidden();await page.locator('#map').click({position:{x:10,y:50}});await expect(page.locator('#mapQuickPopoverView')).toBeHidden();
  const placement=await page.evaluate(()=>({count:document.querySelectorAll('#topLogoutBtnV1').length,last:document.querySelector('.map-quick-tools-inner > :last-child')?.contains(document.getElementById('mapMoreBtnV249')),top:document.querySelectorAll('.v6-toolbar-secondary :is(.top-parcel-lookup-v1,.desktop-operations-action,.quick-add-btn,#topLogoutBtnV1)').length}));
  expect(placement).toEqual({count:1,last:true,top:0});expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
  await more.click();await page.screenshot({path:info.outputPath('market-management-v249.png')});
});

test('v243 six translucent tools keep view filters and map options in one reachable menu',async({page,context,isMobile},info)=>{
  const state=await quickRailSetupV243(page,context,isMobile);
  const primary=page.locator('.map-quick-tools-inner > .map-quick-tool-btn, .map-quick-tools-inner > .map-quick-tool-wrap > .map-quick-tool-btn');
  await expect(primary).toHaveCount(7);
  expect(await primary.locator(':scope > span').allTextContents()).toEqual(['보기','로드뷰','찜목록','다중선택','측정','현위치','더보기']);
  for(const button of await primary.all())await expect(button).toBeInViewport();
  await expect(page.locator('.map-quick-tools-inner')).toHaveCSS('background-color','rgba(255, 255, 255, 0.9)');
  const before=await page.evaluate(()=>JSON.stringify(allItems));state.writes.length=0;
  await page.locator('#mapQuickViewBtn').click();const menu=page.locator('#mapQuickPopoverView');await expect(menu).toBeVisible();await expect(menu).toBeInViewport({ratio:1});
  for(const id of ['mapQuickTodayBtn','mapQuickHideDoneBtn','mapQuickDoneOnlyBtn','saleMapViewsBtnV45','mapParkingBtnV1'])await expect(menu.locator('#'+id)).toBeVisible();
  await expectDefaultView(page);
  await page.locator('#mapQuickDoneOnlyBtn').click();await expect(page.locator('#mapQuickDoneOnlyBtn')).toHaveAttribute('aria-checked','true');await expect(page.locator('#mapQuickHideDoneBtn')).toHaveAttribute('aria-checked','false');
  await page.locator('#mapQuickHideDoneBtn').click();await expect(page.locator('#mapQuickHideDoneBtn')).toHaveAttribute('aria-checked','true');await expect(page.locator('#mapQuickDoneOnlyBtn')).toHaveAttribute('aria-checked','false');
  await page.locator('#mapQuickTodayBtn').click();await expect(page.locator('#mapQuickTodayBtn')).toHaveAttribute('aria-checked','true');
  await page.locator('#mapQuickTodayBtn').click();await expect(page.locator('#mapQuickTodayBtn')).toHaveAttribute('aria-checked','false');
  await page.screenshot({path:info.outputPath('view-menu-v243.png')});
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(page.locator('#mapQuickViewBtn')).toBeFocused();await expect(page.locator('#mapQuickViewBtn')).toHaveClass(/has-active-view-v243/);
  await page.locator('#mapQuickViewBtn').click();await page.locator('#saleMapViewsBtnV45').click();await expect(page.locator('#saleMapViewsV3')).toBeVisible();await expect(menu).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('#saleMapViewsV3')).toBeHidden();await expect(page.locator('#mapQuickViewBtn')).toBeFocused();
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('v243 measurement menu preserves radius choices, closes outside and keeps the six tools compact across markets',async({page,context,isMobile},info)=>{
  const state=await quickRailSetupV243(page,context,isMobile);state.writes.length=0;
  for(const mode of ['lease','building_sale','land_sale']){
    await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);
    await page.locator('#mapMeasureBtnV243').click();const menu=page.locator('#mapQuickPopoverMeasureV243');await expect(menu).toBeVisible();
    await expect(menu.locator('#mapDistanceBtn')).toBeVisible();await expect(menu.locator('#mapPolygonBtn')).toBeVisible();
    await page.locator('#mapRadiusBtn').click();await expect(page.locator('#mapQuickPopoverRadius')).toBeVisible();await expect(menu).toBeInViewport({ratio:1});
    expect(await page.locator('#mapQuickPopoverRadius button').allTextContents()).toEqual(['100m','300m','500m','1km','2km']);
    await page.keyboard.press('Escape');await expect(page.locator('#mapQuickPopoverRadius')).toBeHidden();await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(page.locator('#mapMeasureBtnV243')).toBeFocused();
    await page.locator('#mapQuickViewBtn').click();await expect(page.locator('#mapQuickPopoverView')).toBeVisible();
    await expectDefaultView(page);
    await page.locator('#mapMeasureBtnV243').click();await expect(page.locator('#mapQuickPopoverView')).toBeHidden();
    await page.locator('#map').click({position:{x:10,y:50}});await expect(menu).toBeHidden();
  }
  await page.evaluate(()=>{window.map={};window.kakao={maps:{event:{addListener(){}}}};});
  await page.locator('#mapMeasureBtnV243').click();await page.locator('#mapDistanceBtn').click();
  await expect(page.locator('#mapQuickPopoverMeasureV243')).toBeHidden();await expect(page.locator('#mapMeasureBtnV243')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#mapMeasureStatusTextV657')).toContainText('이동 경로');
  await page.locator('.map-measure-status-close-v660').click();await expect(page.locator('#mapMeasureBtnV243')).toHaveAttribute('aria-pressed','false');
  await page.locator('#mapMeasureBtnV243').click();await page.locator('#mapRadiusBtn').click();await page.locator('#mapQuickPopoverRadius').getByRole('button',{name:'300m',exact:true}).click();
  await expect(page.locator('#mapMeasureStatusTextV657')).toContainText('300m');await expect(page.locator('#mapMeasureBtnV243')).toHaveAttribute('aria-pressed','true');
  await page.locator('.map-measure-status-close-v660').click();
  await page.locator('#mapMeasureBtnV243').click();await page.locator('#mapPolygonBtn').click();await expect(page.locator('#map')).toHaveClass(/map-polygon-drawing-v661/);await expect(page.locator('#mapMeasureBtnV243')).toHaveAttribute('aria-pressed','true');
  await page.locator('.map-measure-status-close-v660').click();await expect(page.locator('#map')).not.toHaveClass(/map-polygon-drawing-v661/);await expect(page.locator('#mapMeasureBtnV243')).toHaveAttribute('aria-pressed','false');
  await page.screenshot({path:info.outputPath('six-tools-v243.png')});expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
