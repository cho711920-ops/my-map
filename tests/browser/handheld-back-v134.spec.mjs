import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';

const baseline = process.env.JS_BACK_BASELINE === '1';
const devices = [
  {name: 'phone portrait', width: 390, height: 844, phone: true},
  {name: 'phone landscape', width: 844, height: 390, phone: true},
  {name: 'tablet portrait', width: 800, height: 1280},
  {name: 'tablet landscape', width: 1280, height: 800}
];
async function setup(browser, baseURL, device) {
  const context = await browser.newContext({viewport: {width: device.width, height: device.height},
    screen: {width: device.width, height: device.height}, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; ' + (device.phone ? 'Pixel 8' : 'SM-X710') + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 ' + (device.phone ? 'Mobile ' : '') + 'Safari/537.36'});
  await context.addInitScript(() => Object.defineProperty(navigator, 'platform', {configurable: true, get: () => 'Linux armv8l'}));
  let writes = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (route.request().method() === 'POST') writes++;
    if (baseline && url.pathname === '/js/mobile-app-v1.js') return route.fulfill({contentType: 'text/javascript',
      body: execFileSync('git', ['show', '847f0d9a:js/mobile-app-v1.js'], {encoding: 'utf8'})});
    if (url.pathname === '/back-photo-v134.svg') return route.fulfill({contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="blue"/></svg>'});
    if (url.searchParams.get('action') === 'unifiedListingDetail') return route.fulfill({status: 503, json: {ok: false}});
    if (url.searchParams.get('action') === 'unifiedListings') {
      const response = await route.fetch(), data = await response.json();
      for (const original of data.groups['FIXTURE-LEASE-1']) Object.assign(original,
        {images: ['/back-photo-v134.svg'], thumbnail: '/back-photo-v134.svg', photoCount: 1});
      return route.fulfill({response, json: data});
    }
    return route.continue();
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {width: device.width, height: device.height,
    screenWidth: device.width, screenHeight: device.height, mobile: true, deviceScaleFactor: 1,
    screenOrientation: {type: device.width > device.height ? 'landscapePrimary' : 'portraitPrimary', angle: device.width > device.height ? 90 : 0}});
  await page.goto(baseURL + '/original/FIXTURE-BACK');
  await page.goto(baseURL + '/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await page.locator('#fixtureControls').evaluate(node => node.remove());
  return {context, page, get writes() {return writes;}};
}
async function tracked(page, before) {
  await expect.poll(() => page.evaluate(() => history.state?.jsmMobileLayerToken || '')).not.toBe(before || '');
  return page.evaluate(() => history.state.jsmMobileLayerToken);
}
test.beforeEach(async ({browserName}, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'desktop', 'Dedicated four-device contexts run once.');
});

for (const device of devices) {
  test(device.name + ': Back closes only the enlarged photo, then detail; X leaves no extra history', async ({browser, baseURL}) => {
    const fixture = await setup(browser, baseURL, device), {page} = fixture;
    try {
      const base = await page.evaluate(() => history.state?.jsmMobileLayerToken || '');
      await page.evaluate(() => JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
      await expect(page.locator('#unifiedDetailDrawerV8')).toHaveClass(/open/);
      const detail = await tracked(page, base);
      await page.locator('.unified-detail-hero-v8').click();
      await expect(page.locator('#unifiedGalleryV8')).toHaveClass(/open/);
      await tracked(page, detail);
      await page.goBack();
      await expect(page.locator('#unifiedGalleryV8')).not.toHaveClass(/open/);
      await expect(page.locator('#unifiedDetailDrawerV8')).toHaveClass(/open/);
      await page.locator('.unified-detail-hero-v8').click();
      await tracked(page, detail);
      await page.getByRole('button', {name: '사진 크게 보기 닫기', exact: true}).click();
      await expect.poll(() => page.evaluate(() => history.state?.jsmMobileLayerToken)).toBe(detail);
      await page.goBack();
      await expect(page.locator('#unifiedDetailDrawerV8')).not.toHaveClass(/open/);
      expect(new URL(page.url()).pathname).toBe('/');
      expect(fixture.writes).toBe(0);
    } finally {await fixture.context.close();}
  });

  test(device.name + ': Back preserves unsaved conditions on cancel, then permits close and normal navigation', async ({browser, baseURL}) => {
    const fixture = await setup(browser, baseURL, device), {page} = fixture;
    try {
      const base = await page.evaluate(() => history.state?.jsmMobileLayerToken || '');
      await page.evaluate(() => openPropertyEditModalV630(encodeURIComponent('id:FIXTURE-LEASE-1')));
      const edit = await tracked(page, base);
      await page.locator('#peRentV630').fill('77');
      await page.locator('#peMemoV630').fill('원장 A에만 남길 미저장 초안');
      page.once('dialog', dialog => dialog.dismiss());
      await page.goBack();
      await expect(page.locator('#propertyEditModalV630')).toHaveClass(/open/);
      await expect(page.locator('#peRentV630')).toHaveValue('77');
      await expect(page.locator('#peMemoV630')).toHaveValue('원장 A에만 남길 미저장 초안');
      await expect.poll(() => page.evaluate(() => history.state?.jsmMobileLayerToken)).toBe(edit);
      page.once('dialog', dialog => dialog.accept());
      await page.goBack();
      await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
      expect(await page.evaluate(() => allItems.find(item => item.propertyId === 'FIXTURE-LEASE-1').rent)).toBe(90);
      expect(await page.evaluate(() => allItems.find(item => item.propertyId === 'FIXTURE-LEASE-2').rent)).toBe(150);
      expect(fixture.writes).toBe(0);
      await page.goBack();
      await expect(page).toHaveURL(/\/original\/FIXTURE-BACK$/);
    } finally {await fixture.context.close();}
  });
}

test('tablet rotation keeps the same edit and native dialogs honor a blocked cancel', async ({browser, baseURL}) => {
  const fixture = await setup(browser, baseURL, devices[2]), {page} = fixture;
  try {
    await page.evaluate(() => openPropertyEditModalV630(encodeURIComponent('id:FIXTURE-LEASE-1')));
    const edit = await tracked(page);
    await page.locator('#peRentV630').fill('78');
    const session = await fixture.context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, screenWidth: 1280, screenHeight: 800,
      mobile: true, deviceScaleFactor: 1, screenOrientation: {type: 'landscapePrimary', angle: 90}});
    await expect(page.locator('html')).toHaveClass(/js-handheld-landscape-v1/);
    await expect(page.locator('#peRentV630')).toHaveValue('78');
    expect(await page.evaluate(() => history.state.jsmMobileLayerToken)).toBe(edit);
    // Synthetic native dialog uses the same cancel contract as sale editors and merge confirmations.
    await page.evaluate(() => {
      const dialog = document.createElement('dialog'); dialog.id = 'fixtureBackDialog';
      dialog.textContent = '합성 저장 중'; dialog.addEventListener('cancel', event => {if (!dialog.dataset.allowClose) event.preventDefault();});
      document.body.appendChild(dialog); dialog.showModal();
    });
    const native = await tracked(page, edit);
    await page.goBack();
    await expect(page.locator('#fixtureBackDialog')).toHaveAttribute('open', '');
    await expect.poll(() => page.evaluate(() => history.state.jsmMobileLayerToken)).toBe(native);
    await page.evaluate(() => {document.getElementById('fixtureBackDialog').dataset.allowClose = '1';});
    await page.goBack();
    await expect(page.locator('#fixtureBackDialog')).not.toHaveAttribute('open', '');
    await expect(page.locator('#peRentV630')).toHaveValue('78');
    page.once('dialog', dialog => dialog.dismiss());
    await page.goBack();
    await expect(page.locator('#propertyEditModalV630')).toHaveClass(/open/);
    expect(fixture.writes).toBe(0);
  } finally {await fixture.context.close();}
});

test('wide desktop keeps ordinary browser Back without adding modal history', async ({page, context, baseURL}) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(baseURL + '/original/FIXTURE-BACK'); await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await page.evaluate(() => JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
  await expect(page.locator('#unifiedDetailDrawerV8')).toHaveClass(/open/);
  expect(await page.evaluate(() => history.state?.jsmMobileLayerToken || '')).toBe('');
  await page.goBack(); await expect(page).toHaveURL(/\/original\/FIXTURE-BACK$/);
});
