import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';

const baseline = !!process.env.JS_EDIT_BASELINE;
async function setup(page, context) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (baseline && ['/js/property-edit-v648.js', '/css/style.css'].includes(url.pathname)) {
      return route.fulfill({contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: execFileSync('git', ['show', '651633c6:' + url.pathname.slice(1)], {encoding: 'utf8'})});
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await page.locator('#fixtureControls').evaluate(node => node.remove());
}

for (const [width, height] of [[390, 744], [1280, 724], [1280, 550], [800, 1100]]) {
  test('edit form fits visible ' + width + 'x' + height + ' with fixed save/cancel and no clipped fields', async ({page, context}) => {
    await page.setViewportSize({width, height});
    await setup(page, context);
    await page.evaluate(() => openPropertyEditModalV630(encodeURIComponent('id:FIXTURE-LEASE-1')));
    const metrics = await page.locator('#propertyEditModalV630').evaluate(modal => {
      const viewport = visualViewport;
      const rect = element => {const r = element.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right};};
      const body = modal.querySelector('.property-edit-body-v135');
      return {visible: {top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height,
        left: viewport.offsetLeft, right: viewport.offsetLeft + viewport.width},
        dialog: rect(modal.querySelector('[role="dialog"]')), title: rect(modal.querySelector('#propertyEditTitleV630')),
        save: rect(modal.querySelector('#propertyEditSaveBtnV630')), cancel: rect(modal.querySelector('.property-edit-cancel-v630')),
        formFits: !!body && body.scrollHeight <= body.clientHeight + 1};
    });
    for (const name of ['dialog', 'title', 'save', 'cancel']) {
      expect(metrics[name].top, name).toBeGreaterThanOrEqual(metrics.visible.top - 1);
      expect(metrics[name].bottom, name).toBeLessThanOrEqual(metrics.visible.bottom + 1);
      expect(metrics[name].left, name).toBeGreaterThanOrEqual(metrics.visible.left - 1);
      expect(metrics[name].right, name).toBeLessThanOrEqual(metrics.visible.right + 1);
    }
    expect(metrics.formFits).toBe(true);
  });
}

test('keyboard-sized viewport keeps the save controls visible and the memo reachable without losing input', async ({page, context}) => {
  await page.setViewportSize({width: 390, height: 744}); await setup(page, context);
  const session = await context.newCDPSession(page);
  const metrics = {width: 390, screenWidth: 390, screenHeight: 844, mobile: true, deviceScaleFactor: 1,
    screenOrientation: {type: 'portraitPrimary', angle: 0}};
  await session.send('Emulation.setDeviceMetricsOverride', {...metrics, height: 744});
  await page.evaluate(() => openPropertyEditModalV630(encodeURIComponent('id:FIXTURE-LEASE-1')));
  await page.locator('#pePremiumV630').fill('300');
  await session.send('Emulation.setDeviceMetricsOverride', {...metrics, height: 330});
  await page.locator('#peMemoV630').fill('키보드가 떠도 보존할 초안');
  await expect(page.locator('#pePremiumV630')).toHaveValue('300');
  const bounds = await page.locator('#propertyEditSaveBtnV630').boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(330);
  await expect(page.locator('#peMemoV630')).toBeInViewport();
  await expect(page.locator('#peMemoV630')).toBeFocused();
});

test('physical handheld classification and native landscape desktop-fit keep the complete edit form inside the visible area', async ({browser, baseURL}, info) => {
  test.skip(info.project.name !== 'desktop', 'Dedicated handheld contexts run once.');
  for (const [width, height] of [[390, 844], [844, 390], [800, 1280], [1280, 800]]) {
    const phone = Math.min(width, height) < 600;
    const context = await browser.newContext({viewport: {width, height}, screen: {width, height}, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; ' + (phone ? 'Pixel 8' : 'SM-X710') + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 ' + (phone ? 'Mobile ' : '') + 'Safari/537.36'});
    try {
      await context.addInitScript(() => Object.defineProperty(navigator, 'platform', {configurable: true, get: () => 'Linux armv8l'}));
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setDeviceMetricsOverride', {width, height, screenWidth: width, screenHeight: height, mobile: true,
        deviceScaleFactor: 1, screenOrientation: {type: width > height ? 'landscapePrimary' : 'portraitPrimary', angle: width > height ? 90 : 0}});
      await setup(page, context); // Relative URL belongs to the test baseURL.
      expect(new URL(page.url()).origin).toBe(baseURL);
      await page.evaluate(() => openPropertyEditModalV630(encodeURIComponent('id:FIXTURE-LEASE-1')));
      const bounds = await page.locator('#propertyEditModalV630').evaluate(modal => {
        const viewport = visualViewport, rect = modal.querySelector('[role="dialog"]').getBoundingClientRect();
        const body = modal.querySelector('.property-edit-body-v135');
        return {handheld: JSPhoneDeviceV1.isHandheld(), fit: document.documentElement.classList.contains('js-landscape-desktop-fit-v1'),
          inside: rect.top >= viewport.offsetTop - 1 && rect.bottom <= viewport.offsetTop + viewport.height + 1,
          bodyFits: !!body && body.scrollHeight <= body.clientHeight + 1};
      });
      expect(bounds.handheld).toBe(true); expect(bounds.inside).toBe(true); expect(bounds.bodyFits).toBe(true);
      if (width === 844) expect(bounds.fit).toBe(true);
      if (process.env.JS_EDIT_SCREENSHOT && width === 1280) await page.screenshot({path: 'outputs/v135-edit-tablet-fixture.png'});
    } finally {await context.close();}
  }
});

for (const premium of [300, 0]) test('missing premium stays distinct from zero, submits ' + premium + ' once, and leaves untouched missing fields and the neighbor intact', async ({page, context}) => {
  await setup(page, context);
  await page.evaluate(() => {
    const item = allItems[0]; item.premium = 0; item.fee = 0;
    item.displayValuePresence = {deposit: true, rent: true, area: true, premium: false, fee: false};
    window.JSListingRefreshV1 = {refreshMoved: async () => true};
    window.loadSheet = () => {throw Error('No whole inventory reload for one edit');};
    openPropertyEditModalV630(encodeURIComponent('id:' + item.propertyId));
  });
  await expect(page.locator('#pePremiumV630')).toHaveValue('');
  await expect(page.locator('#peFeeV630')).toHaveValue('');
  const neighbor = await page.evaluate(() => JSON.stringify(allItems[1]));
  const writes = [];
  await page.route('**/api/data', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'updateProperty') return route.fallback();
    writes.push(body);
    // Match the real NULL baseline boundary; the SQLite integration test
    // separately executes the real backend and its atomic conflict checks.
    if (body.originalValues[7] !== null || body.originalValues[6] !== null) return route.fulfill({status: 409, json: {ok: false, code: 'PROPERTY_EDIT_CONFLICT'}});
    return route.fulfill({json: {ok: true, persisted: true, propertyId: 'FIXTURE-LEASE-1',
      changedFields: ['premium'], updated: body.updated}});
  });
  await page.locator('#pePremiumV630').fill(String(premium)); await page.locator('#propertyEditSaveBtnV630').click();
  await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
  expect(writes).toHaveLength(1); expect(writes[0].key.propertyId).toBe('FIXTURE-LEASE-1');
  expect(writes[0].updated.premium).toBe(premium); expect(writes[0].updated.fee).toBeNull();
  expect(writes[0].editedFields).toEqual(['premium']);
  expect(await page.evaluate(() => JSON.stringify(allItems[1]))).toBe(neighbor);
  await page.evaluate(() => openPropertyEditModalV630(encodeURIComponent('id:FIXTURE-LEASE-1')));
  await expect(page.locator('#pePremiumV630')).toHaveValue(String(premium));
  await expect(page.locator('#peFeeV630')).toHaveValue('');
});
