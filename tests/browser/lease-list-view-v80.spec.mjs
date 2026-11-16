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
async function chooseSize(page,isMobile,value) {
  await showViewMenu(page,isMobile);
  await page.locator('#leaseListViewV80 [data-lease-list-view="'+value+'"]').click();
  await closeViewMenu(page,isMobile);
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

test('large lease photos, all eight actions, and the original small view remain usable', async ({page, context, isMobile}, info) => {
  const state = await setup(page, context, isMobile);
  await page.evaluate(() => {
    JSUnifiedListingsV8.attach(allItems, {ok:true, groups:Object.fromEntries(allItems.map((item, index) => [item.propertyId, [{...item,
      originalId:item.propertyId + '-PHOTO', images:index === 0 ? [location.origin + '/icons/js-192.png'] : [], photoCount:index === 0 ? 1 : 0}]]))});
    showList(allItems.filter(item => item.tradeType === 'lease'));
  });
  const card = page.locator('#list .item').first(), thumb = card.locator('.unified-thumb-v8');
  const controls = page.locator('#leaseListViewV80');
  await expect(page.locator('.map-list-panel-head-v1')).toBeHidden();
  await expect(controls).toBeHidden();
  await expect(controls.getByRole('button', {name: '작게 보기', includeHidden: true})).toHaveAttribute('aria-pressed', 'true');
  await chooseSize(page,isMobile,'large');
  await expect(controls.getByRole('button', {name: '크게 보기', includeHidden: true})).toHaveAttribute('aria-pressed', 'true');
  const large = await thumb.boundingBox();
  const image = thumb.locator('img');
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  // The thumbnail button may have a 1px border; the photo fills its inner box.
  expect(Math.abs((await image.boundingBox()).width - large.width)).toBeLessThanOrEqual(2);
  expect(Math.abs((await image.boundingBox()).height - large.height)).toBeLessThanOrEqual(2);
  expect(large.width).toBeGreaterThanOrEqual(isMobile ? 130 : 178);
  expect(large.height).toBeGreaterThanOrEqual(isMobile ? 130 : 178);
  const buttons = card.locator('.item-action-left > button, .item-memo-toggle');
  expect(await buttons.count()).toBe(8);
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox(), bounds = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  for (const selector of ['.price-main', '.price-fee', '.price-premium', '.price-area', '.pyeong-mini-badge', '.item-head-select-v650']) await expect(card.locator(selector)).toBeVisible();
  const before = await page.evaluate(() => JSON.stringify(allItems));
  await card.locator('.action-select-check').check();
  state.writes.length = 0; state.detailReads.length = 0;
  const width = (await page.locator('#sidebar').boundingBox()).width;
  await chooseSize(page,isMobile,'small');
  expect((await thumb.boundingBox()).width).toBeLessThan(large.width - 30);
  expect((await page.locator('#sidebar').boundingBox()).width).toBe(width);
  await chooseSize(page,isMobile,'large');
  expect((await thumb.boundingBox()).width).toBe(large.width);
  await expect(card.locator('.action-select-check')).toBeChecked();
  expect(await page.evaluate(() => JSON.stringify(allItems))).toBe(before);
  expect(state.writes).toEqual([]); expect(state.detailReads).toEqual([]); expect(state.errors).toEqual([]);
  await showViewMenu(page,isMobile);
  await page.screenshot({path:info.outputPath('lease-view-menu-v214.png')});
  await closeViewMenu(page,isMobile);
  await page.screenshot({path: info.outputPath('lease-large-view.png')});
});

test('the preference survives reload and sale markets keep their own layout', async ({page, context, isMobile}) => {
  const state = await setup(page, context, isMobile);
  const controls = page.locator('#leaseListViewV80');
  await expect(controls.getByRole('button', {name: '작게 보기', includeHidden: true})).toHaveAttribute('aria-pressed', 'true');
  await chooseSize(page,isMobile,'large');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(controls.getByRole('button', {name: '크게 보기', includeHidden: true})).toHaveAttribute('aria-pressed', 'true');
  for (const mode of ['building_sale', 'land_sale']) {
    await page.evaluate(mode => JSListingTradeV1.setMode(mode), mode);
    await showViewMenu(page,isMobile);
    await expect(controls).toBeHidden();
    await closeViewMenu(page,isMobile);
    await expect(page.locator('html')).not.toHaveAttribute('data-lease-list-view-v80', /.+/);
    await expect(page.locator('#list .item')).toHaveCount(1);
  }
  await page.evaluate(() => JSListingTradeV1.setMode('lease'));
  await showViewMenu(page,isMobile);
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', {name: '크게 보기', includeHidden: true})).toHaveAttribute('aria-pressed', 'true');
  expect(state.errors).toEqual([]);
});

test('returning from sale remeasures the preferred large lease rows', async ({page, context, isMobile}) => {
  const state = await setup(page, context, isMobile);
  await chooseSize(page,isMobile,'large');
  await page.evaluate(() => {JSListingTradeV1.setMode('building_sale'); JSListingTradeV1.setMode('lease');});
  await expect(page.locator('html')).toHaveAttribute('data-lease-list-view-v80', 'large');
  const result = await page.evaluate(() => [...document.querySelectorAll('#list .item')].map(card => {
    const index = Number(card.dataset.listIndexV1);
    return Math.abs(listVirtualItemHeightsV1[getListVirtualItemKeyV1(visibleListItems[index], index)] - measureListCardOuterHeightV1(card));
  }));
  expect(result.every(delta => delta < 1)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('switching size deep in a virtual list retains the card, memo and selection without data requests', async ({page, context, isMobile}) => {
  const state = await setup(page, context, isMobile);
  await chooseSize(page,isMobile,'large');
  await page.evaluate(() => {
    const base = allItems[0];
    allItems = Array.from({length: 240}, (_, n) => ({...base, propertyId: 'SIZE-' + n, key: 'size-' + n, name: '크기 검수 ' + n}));
    JSUnifiedListingsV8.attach(allItems, {ok: true, groups: Object.fromEntries(allItems.map(item => [item.propertyId, []]))});
    showList(allItems);
    getListingScrollContainerV2().scrollTop = getListingScrollContainerV2().scrollHeight * .6;
  });
  await page.waitForTimeout(150);
  state.writes.length = 0; state.detailReads.length = 0;
  const result = await page.evaluate(() => {
    const scroller = getListingScrollContainerV2(), top = scroller.getBoundingClientRect().top;
    const card = [...document.querySelectorAll('#list .item')].find(card => card.getBoundingClientRect().top >= top);
    const offset = card.getBoundingClientRect().top - top, id = card.dataset.propertyId;
    const item = visibleListItems[Number(card.dataset.listIndexV1)];
    selectedPrintKeys = [actionSelectionKeyV660(item)];
    const data = JSON.stringify(allItems), node = card;
    document.querySelector('#leaseListViewV80 [data-lease-list-view="small"]').click();
    const smallOffset = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    document.querySelector('#leaseListViewV80 [data-lease-list-view="large"]').click();
    return {delta: card.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset,
      smallDelta: smallOffset - offset, id, connected: node.isConnected, start: listRenderStart,
      selected: selectedPrintKeys.slice(), dataUnchanged: data === JSON.stringify(allItems), count: document.querySelectorAll('#list .item').length};
  });
  expect(Math.abs(result.delta)).toBeLessThanOrEqual(2); expect(Math.abs(result.smallDelta)).toBeLessThanOrEqual(2);
  expect(result.connected).toBe(true); expect(result.start).toBeGreaterThan(0); expect(result.dataUnchanged).toBe(true);
  expect(result.selected).toHaveLength(1); expect(result.count).toBeLessThanOrEqual(isMobile ? 28 : 36);
  expect(state.writes).toEqual([]); expect(state.detailReads).toEqual([]); expect(state.errors).toEqual([]);
});

test('blocked local storage still permits both views and memo actions retain the same target', async ({page, context, isMobile}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {if (key === 'js_map_lease_list_view_v80') throw Error('fixture blocked'); return get.call(this, key);};
    Storage.prototype.setItem = function(key, value) {if (key === 'js_map_lease_list_view_v80') throw Error('fixture blocked'); return set.call(this, key, value);};
  });
  const state = await setup(page, context, isMobile);
  await expect(page.locator('#leaseListViewV80 [data-lease-list-view="small"]')).toHaveAttribute('aria-pressed', 'true');
  await chooseSize(page,isMobile,'large');
  const card = page.locator('#list .item').first(), id = await card.getAttribute('data-property-id');
  await card.locator('.item-memo-toggle').click();
  await expect(card).toHaveClass(/memo-open/);
  await chooseSize(page,isMobile,'small');
  await expect(card).toHaveClass(/memo-open/);
  await chooseSize(page,isMobile,'large');
  expect(await card.getAttribute('data-property-id')).toBe(id);
  await expect(card).toHaveClass(/memo-open/);
  expect(state.errors).toEqual([]);
});

test('one size control follows portrait filters and landscape View without losing its preference',async({browser,baseURL})=>{
  const portrait={width:390,height:844},landscape={width:844,height:390};
  const context=await browser.newContext({baseURL,viewport:portrait,screen:portrait,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'});
  try{
    const page=await context.newPage(),state=await setup(page,context,true);
    await chooseSize(page,true,'large');
    await expect(page.locator('#v6DetailSheetPortal #leaseListViewV80')).toHaveCount(1);
    const before=await page.evaluate(()=>JSON.stringify(allItems));
    const session=await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride',{...landscape,screenWidth:landscape.width,screenHeight:landscape.height,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'landscapePrimary',angle:90}});
    await expect(page.locator('html')).not.toHaveClass(/js-phone-app-v2/);
    await showViewMenu(page,false);
    await expect(page.locator('#mapQuickPopoverView #leaseListViewV80')).toBeVisible();
    await expect(page.locator('[data-lease-list-view="large"]')).toHaveAttribute('aria-pressed','true');
    await closeViewMenu(page,false);await chooseSize(page,false,'small');
    await session.send('Emulation.setDeviceMetricsOverride',{...portrait,screenWidth:portrait.width,screenHeight:portrait.height,mobile:true,deviceScaleFactor:1,screenOrientation:{type:'portraitPrimary',angle:0}});
    await expect(page.locator('html')).toHaveClass(/js-phone-app-v2/);
    await showViewMenu(page,true);
    await expect(page.locator('#v6DetailSheetPortal #leaseListViewV80')).toBeVisible();
    await expect(page.locator('[data-lease-list-view="small"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#leaseListViewV80')).toHaveCount(1);
    await expect(page.locator('.map-list-panel-head-v1')).toBeHidden();
    expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
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

test('v243 six translucent tools keep view filters, map options and lease density in one reachable menu',async({page,context,isMobile},info)=>{
  const state=await quickRailSetupV243(page,context,isMobile);
  const primary=page.locator('.map-quick-tools-inner > .map-quick-tool-btn, .map-quick-tools-inner > .map-quick-tool-wrap > .map-quick-tool-btn');
  await expect(primary).toHaveCount(7);
  expect(await primary.locator(':scope > span').allTextContents()).toEqual(['보기','로드뷰','찜목록','다중선택','측정','현위치','더보기']);
  for(const button of await primary.all())await expect(button).toBeInViewport();
  await expect(page.locator('.map-quick-tools-inner')).toHaveCSS('background-color','rgba(255, 255, 255, 0.9)');
  const before=await page.evaluate(()=>JSON.stringify(allItems));state.writes.length=0;
  await page.locator('#mapQuickViewBtn').click();const menu=page.locator('#mapQuickPopoverView');await expect(menu).toBeVisible();await expect(menu).toBeInViewport({ratio:1});
  for(const id of ['mapQuickTodayBtn','mapQuickHideDoneBtn','mapQuickDoneOnlyBtn','saleMapViewsBtnV45','mapParkingBtnV1'])await expect(menu.locator('#'+id)).toBeVisible();
  await expect(menu.locator('#leaseListViewV80')).toBeVisible();
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
    if(mode==='lease')await expect(page.locator('#leaseListViewV80')).toBeVisible();else await expect(page.locator('#leaseListViewV80')).toBeHidden();
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
