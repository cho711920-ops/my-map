import {test, expect} from '@playwright/test';

async function prepare(page, context) {
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if(url.hostname !== '127.0.0.1') return route.abort();
    if(url.pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(url.pathname);
    return route.continue();
  });
  await page.goto('/?mapFirst=1');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await page.locator('#fixtureControls').evaluate(el => el.hidden = true);
  await page.evaluate(() => {
    window.locationTestV96 = {calls: [], requests: [], level: 7, center: [36.3, 127.3], selected: true, overlays: 0, refreshes: 0};
    window.map = {
      setCenter(point) {locationTestV96.center = [point.lat, point.lng];},
      setLevel(level) {locationTestV96.level = level;},
      getLevel() {return locationTestV96.level;},
      jump(point, level, options) {this.setCenter(point);this.setLevel(level);locationTestV96.jumpOptions = options;}
    };
    window.kakao = {maps: {LatLng: function(lat, lng) {this.lat = lat;this.lng = lng;}}};
    window.jsLastIdleViewportKeyV638 = 'old-selection-bounds';
    window.clearMapListSelectionForNavigationV6571 = () => {locationTestV96.selected = false;};
    window.updateCurrentLocationOverlayV630 = () => {locationTestV96.overlays++;};
    window.scheduleMapIdleRefreshV638 = () => {locationTestV96.refreshes++;};
    Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {
      getCurrentPosition(success, error, options) {locationTestV96.requests.push(options);locationTestV96.calls.push({success, error});}
    }});
  });
  await page.addScriptTag({url: '/js/current-location-v96.js'});
  const button = page.getByRole('button', {name: '현위치로 이동, 20m 축척', exact: true}).filter({visible: true});
  await expect(button).toHaveCount(1);
  await expect(button).toBeInViewport();
  return {button, errors, writes};
}

test('one tap accepts a recent browser position and moves to level 1 while preserving filters and checked listings', async ({page, context}, info) => {
  const h = await prepare(page, context);
  const before = await page.evaluate(() => ({source: document.getElementById('sourceFilter').value, market: window.currentListingTradeTypeV8, checked: (window.selectedPrintKeys || []).slice()}));
  expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(0);
  await h.button.click();
  await expect(h.button).toBeDisabled();
  await page.locator('[data-current-location-v96]').evaluateAll(buttons => buttons.forEach(b => b.click()));
  expect(await page.evaluate(() => locationTestV96.requests)).toEqual([{enableHighAccuracy: false, maximumAge: 8000, timeout: 1500}]);
  await page.evaluate(() => locationTestV96.calls[0].success({coords: {latitude: 36.3504, longitude: 127.3845, accuracy: 12}}));
  await expect(h.button).toBeEnabled();
  expect(await page.evaluate(() => ({level: locationTestV96.level, center: locationTestV96.center, selected: locationTestV96.selected, overlays: locationTestV96.overlays, refreshes: locationTestV96.refreshes, viewportKey: jsLastIdleViewportKeyV638})))
    .toEqual({level: 1, center: [36.3504, 127.3845], selected: false, overlays: 1, refreshes: 1, viewportKey: ''});
  expect(await page.evaluate(() => ({source: document.getElementById('sourceFilter').value, market: window.currentListingTradeTypeV8, checked: (window.selectedPrintKeys || []).slice()}))).toEqual(before);
  await expect(page.locator('#mapCurrentLocationStatusV96')).toHaveText('현위치로 이동했습니다.');
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
  await page.screenshot({path: info.outputPath('current-location.png')});
});

test('denied permission leaves the map and selection unchanged and allows retry', async ({page, context}) => {
  const h = await prepare(page, context);
  await h.button.click();
  await page.evaluate(() => locationTestV96.calls[0].error({code: 1}));
  await expect(h.button).toBeEnabled();
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('위치 권한');
  expect(await page.evaluate(() => ({center: locationTestV96.center, level: locationTestV96.level, selected: locationTestV96.selected}))).toEqual({center: [36.3, 127.3], level: 7, selected: true});
  await h.button.click();
  expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(2);
  await page.evaluate(() => locationTestV96.calls[1].success({coords: {latitude: 36.36, longitude: 127.39, accuracy: 20}}));
  await expect(h.button).toBeEnabled();
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('a missing callback expires and a late old fix cannot override a new request', async ({page, context}) => {
  const h = await prepare(page, context);
  await page.clock.install();
  await h.button.click();
  await page.clock.runFor(12001);
  await expect(h.button).toBeEnabled();
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('지연');
  expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(2);
  const retryIndex = await page.evaluate(() => locationTestV96.calls.length);
  await h.button.click();
  await page.evaluate(() => locationTestV96.calls[0].success({coords: {latitude: 37, longitude: 128, accuracy: 1}}));
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.3, 127.3]);
  await expect(h.button).toBeDisabled();
  await page.evaluate(index => locationTestV96.calls[index].success({coords: {latitude: 36.35, longitude: 127.38, accuracy: 250}}), retryIndex);
  await expect(h.button).toBeEnabled();
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('위치 오차 약 250m');
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.35, 127.38]);
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('unavailable GPS, invalid coordinates and unsupported browsers never move the map', async ({page, context}) => {
  const h = await prepare(page, context);
  await h.button.click();
  await page.evaluate(() => locationTestV96.calls[0].error({code: 2}));
  await expect(h.button).toBeDisabled();
  await page.evaluate(() => locationTestV96.calls[1].error({code: 2}));
  await expect(h.button).toBeEnabled();
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('기기에서 현재 위치를 제공하지 못했습니다');
  await h.button.click();
  await page.evaluate(() => locationTestV96.calls[2].success({coords: {latitude: 999, longitude: null}}));
  await expect(h.button).toBeEnabled();
  await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', {configurable: true, value: null}));
  await h.button.click();
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('이 기기');
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.3, 127.3]);
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('portrait and landscape keep exactly one reachable location button', async ({page, context, isMobile}) => {
  test.skip(!isMobile, 'Phone orientation uses a separate desktop-fit layout');
  const h = await prepare(page, context);
  await expect(page.locator('#mapCurrentLocationPhoneBtnV96')).toBeVisible();
  const location = await h.button.boundingBox(), parking = await page.locator('#mapParkingPhoneBtnV1').boundingBox();
  expect(location.y).toBeGreaterThanOrEqual(parking.y + parking.height);
  await page.setViewportSize({width: 844, height: 390});
  await expect(page.locator('#mapCurrentLocationBtnV96')).toBeVisible();
  await page.locator('#mapCurrentLocationBtnV96').scrollIntoViewIfNeeded();
  await expect(page.locator('#mapCurrentLocationBtnV96')).toBeInViewport();
  await expect(page.locator('#mapCurrentLocationPhoneBtnV96')).toBeHidden();
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator('#mapCurrentLocationPhoneBtnV96')).toBeVisible();
  expect(h.errors).toEqual([]);
});

test('a slow or unavailable quick position falls back once and ignores its late callback', async ({page, context}) => {
  const h = await prepare(page, context);await page.clock.install();
  await h.button.click();
  await page.clock.runFor(1501);
  expect(await page.evaluate(() => locationTestV96.requests)).toEqual([
    {enableHighAccuracy: false, maximumAge: 8000, timeout: 1500},
    {enableHighAccuracy: true, maximumAge: 0, timeout: 7000}
  ]);
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('다시 확인');
  await page.evaluate(() => locationTestV96.calls[0].success({coords: {latitude: 37, longitude: 128, accuracy: 2000}}));
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.3, 127.3]);
  await page.evaluate(() => locationTestV96.calls[1].success({coords: {latitude: 36.35, longitude: 127.38, accuracy: 15}}));
  await expect(h.button).toBeEnabled();
  expect(await page.evaluate(() => ({center:locationTestV96.center,level:locationTestV96.level})))
    .toEqual({center:[36.35,127.38],level:1});
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(2);
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('permission denial never falls back or moves the map and the button recovers its label', async ({page, context}) => {
  const h = await prepare(page, context);await page.clock.install();
  await h.button.click();await expect(h.button.locator('span')).toHaveText('확인 중');
  await page.evaluate(() => locationTestV96.calls[0].error({code:1}));
  await expect(h.button).toBeEnabled();await expect(h.button.locator('span')).toHaveText('현위치');
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('위치 권한');
  await page.clock.runFor(13000);
  expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(1);
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.3,127.3]);
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('leaving the page cancels the pending fallback and ignores late coordinates', async ({page, context}) => {
  const h = await prepare(page, context);await page.clock.install();
  await h.button.click();await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.clock.runFor(13000);
  await page.evaluate(() => locationTestV96.calls[0].success({coords:{latitude:37,longitude:128,accuracy:10}}));
  await expect(h.button).toBeEnabled();await expect(h.button.locator('span')).toHaveText('현위치');
  expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(1);
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.3,127.3]);
  await h.button.click();expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(2);
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('location is the last vertical tool after polygon drawing', async ({page, context, isMobile}, info) => {
  const h = await prepare(page, context);
  if(isMobile)await page.setViewportSize({width:844,height:390});
  const location = page.locator('#mapCurrentLocationBtnV96');
  await expect(page.locator('.map-quick-tools-inner > :last-child')).toHaveAttribute('id','mapCurrentLocationBtnV96');
  await expect(location).toBeVisible();await location.scrollIntoViewIfNeeded();await expect(location).toBeInViewport();
  const [last,draw] = await Promise.all([location.boundingBox(),page.locator('#mapPolygonBtn').boundingBox()]);
  expect(last.y).toBeGreaterThanOrEqual(draw.y+draw.height);
  await page.screenshot({path:info.outputPath('current-location-last.png')});
  expect(h.errors).toEqual([]);
});

test('a recent accurate ordinary GPS fix moves synchronously without a new browser position request',async({page,context})=>{
  const h=await prepare(page,context);
  const result=await page.evaluate(()=>{
    window.jsLastCurrentLocationPositionV1={timestamp:Date.now()-1000,coords:{latitude:36.352,longitude:127.382,accuracy:12}};
    const button=Array.from(document.querySelectorAll('[data-current-location-v96]')).find(b=>b.getBoundingClientRect().width>0);
    button.click();
    return {requests:locationTestV96.requests.length,center:locationTestV96.center,level:locationTestV96.level,busy:button.disabled,refreshes:locationTestV96.refreshes};
  });
  expect(result).toEqual({requests:0,center:[36.352,127.382],level:1,busy:false,refreshes:1});
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('an existing watcher can finish a pending tap early, without recursion or later automatic following',async({page,context})=>{
  const h=await prepare(page,context);await page.clock.install();
  await h.button.click();
  await page.clock.runFor(200);
  await page.evaluate(()=>{
    window.updateCurrentLocationOverlayV630=position=>{
      locationTestV96.overlays++;
      window.dispatchEvent(new CustomEvent('js-current-location-fix-v100',{detail:{position}}));
    };
    window.dispatchEvent(new CustomEvent('js-current-location-fix-v100',{detail:{position:{timestamp:Date.now(),coords:{latitude:36.353,longitude:127.383,accuracy:10}}}}));
  });
  await expect(h.button).toBeEnabled();
  expect(await page.evaluate(()=>({center:locationTestV96.center,refreshes:locationTestV96.refreshes,overlays:locationTestV96.overlays})))
    .toEqual({center:[36.353,127.383],refreshes:1,overlays:1});
  await page.evaluate(()=>{
    locationTestV96.calls[0].success({coords:{latitude:37,longitude:128,accuracy:1}});
    window.dispatchEvent(new CustomEvent('js-current-location-fix-v100',{detail:{position:{timestamp:Date.now(),coords:{latitude:36.4,longitude:127.4,accuracy:1}}}}));
  });
  await page.clock.runFor(15000);
  expect(await page.evaluate(()=>locationTestV96.center)).toEqual([36.353,127.383]);
  expect(await page.evaluate(()=>locationTestV96.requests.length)).toBe(1);
  expect(h.errors).toEqual([]);
});

test('stale, coarse and future memory fixes never shortcut GPS verification',async({page,context})=>{
  const h=await prepare(page,context);
  for(const data of [{age:8001,accuracy:5},{age:1000,accuracy:51},{age:-10000,accuracy:1}]){
    await page.evaluate(({age,accuracy})=>{window.jsLastCurrentLocationPositionV1={timestamp:Date.now()-age,coords:{latitude:37,longitude:128,accuracy}};},data);
    const index=await page.evaluate(()=>locationTestV96.requests.length);
    await h.button.click();await expect(h.button).toBeDisabled();
    expect(await page.evaluate(()=>locationTestV96.center)).toEqual([36.3,127.3]);
    await page.evaluate(index=>locationTestV96.calls[index].error({code:1}),index);
    await expect(h.button).toBeEnabled();
  }
  expect(h.errors).toEqual([]);
});
