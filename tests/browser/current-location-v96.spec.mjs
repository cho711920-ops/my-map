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

test('one tap gets a fresh position and moves to level 1 while preserving filters and checked listings', async ({page, context}, info) => {
  const h = await prepare(page, context);
  const before = await page.evaluate(() => ({source: document.getElementById('sourceFilter').value, market: window.currentListingTradeTypeV8, checked: (window.selectedPrintKeys || []).slice()}));
  expect(await page.evaluate(() => locationTestV96.requests.length)).toBe(0);
  await h.button.click();
  await expect(h.button).toBeDisabled();
  await page.locator('[data-current-location-v96]').evaluateAll(buttons => buttons.forEach(b => b.click()));
  expect(await page.evaluate(() => locationTestV96.requests)).toEqual([{enableHighAccuracy: true, maximumAge: 0, timeout: 10000}]);
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
  await h.button.click();
  await page.evaluate(() => locationTestV96.calls[0].success({coords: {latitude: 37, longitude: 128, accuracy: 1}}));
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.3, 127.3]);
  await expect(h.button).toBeDisabled();
  await page.evaluate(() => locationTestV96.calls[1].success({coords: {latitude: 36.35, longitude: 127.38, accuracy: 250}}));
  await expect(h.button).toBeEnabled();
  await expect(page.locator('#mapCurrentLocationStatusV96')).toContainText('위치 오차 약 250m');
  expect(await page.evaluate(() => locationTestV96.center)).toEqual([36.35, 127.38]);
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('unavailable GPS, invalid coordinates and unsupported browsers never move the map', async ({page, context}) => {
  const h = await prepare(page, context);
  await h.button.click();
  await page.evaluate(() => locationTestV96.calls[0].error({code: 2}));
  await expect(h.button).toBeEnabled();
  await h.button.click();
  await page.evaluate(() => locationTestV96.calls[1].success({coords: {latitude: 999, longitude: null}}));
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
  await expect(page.locator('#mapCurrentLocationBtnV96')).toBeInViewport();
  await expect(page.locator('#mapCurrentLocationPhoneBtnV96')).toBeHidden();
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator('#mapCurrentLocationPhoneBtnV96')).toBeVisible();
  expect(h.errors).toEqual([]);
});
