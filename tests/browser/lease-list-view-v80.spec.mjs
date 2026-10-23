import {test, expect} from '@playwright/test';

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
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', {name: '크게 보기'})).toHaveAttribute('aria-pressed', 'true');
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
  await controls.getByRole('button', {name: '작게 보기'}).click();
  expect((await thumb.boundingBox()).width).toBeLessThan(large.width - 30);
  expect((await page.locator('#sidebar').boundingBox()).width).toBe(width);
  await controls.getByRole('button', {name: '크게 보기'}).click();
  expect((await thumb.boundingBox()).width).toBe(large.width);
  await expect(card.locator('.action-select-check')).toBeChecked();
  expect(await page.evaluate(() => JSON.stringify(allItems))).toBe(before);
  expect(state.writes).toEqual([]); expect(state.detailReads).toEqual([]); expect(state.errors).toEqual([]);
  await page.screenshot({path: info.outputPath('lease-large-view.png')});
});

test('the preference survives reload and sale markets keep their own layout', async ({page, context, isMobile}) => {
  const state = await setup(page, context, isMobile);
  const controls = page.locator('#leaseListViewV80');
  await controls.getByRole('button', {name: '작게 보기'}).click();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  if (isMobile) await page.locator('[data-mobile-view="list"]').click();
  await expect(controls.getByRole('button', {name: '작게 보기'})).toHaveAttribute('aria-pressed', 'true');
  for (const mode of ['building_sale', 'land_sale']) {
    await page.evaluate(mode => JSListingTradeV1.setMode(mode), mode);
    await expect(controls).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-lease-list-view-v80', /.+/);
    await expect(page.locator('#list .item')).toHaveCount(1);
  }
  await page.evaluate(() => JSListingTradeV1.setMode('lease'));
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', {name: '작게 보기'})).toHaveAttribute('aria-pressed', 'true');
  expect(state.errors).toEqual([]);
});

test('returning from sale remeasures the preferred large lease rows', async ({page, context, isMobile}) => {
  const state = await setup(page, context, isMobile);
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
  const card = page.locator('#list .item').first(), id = await card.getAttribute('data-property-id');
  await card.locator('.item-memo-toggle').click();
  await expect(card).toHaveClass(/memo-open/);
  await page.locator('#leaseListViewV80 [data-lease-list-view="small"]').click();
  await expect(card).toHaveClass(/memo-open/);
  await page.locator('#leaseListViewV80 [data-lease-list-view="large"]').click();
  expect(await card.getAttribute('data-property-id')).toBe(id);
  await expect(card).toHaveClass(/memo-open/);
  expect(state.errors).toEqual([]);
});
