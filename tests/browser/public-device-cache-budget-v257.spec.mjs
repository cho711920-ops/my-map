import {test, expect} from '@playwright/test';

async function emptyPage(page, context) {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
  await page.route('**/__fixture/public-device-cache-v257', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><p>Cache isolation fixture</p>'
  }));
  await page.goto('/__fixture/public-device-cache-v257');
}

test('full legacy lookup caches release device space while login, memo, favorites and offline visits survive', async ({page, context}) => {
  await emptyPage(page, context);
  const before = await page.evaluate(() => {
    const protectedData = {
      js_authenticated_account_v1: 'fixture account', js_favorite_lists_v6: 'favorite draft',
      js_ai_visit_sessions_v6: 'offline visit', js_memo_draft: 'unsaved memo',
      js_list_sync_dirty_v6_favorite: 'unacknowledged favorite'
    };
    for (const [key, value] of Object.entries(protectedData)) localStorage.setItem(key, value);
    localStorage.setItem('js-building-register-v11:parcel', 'x'.repeat(2400000));
    localStorage.setItem('js-building-badge-v3:parcel', 'x'.repeat(2400000));
    let quota = false;
    try { localStorage.setItem('js_ai_visit_sessions_v6', 'v'.repeat(600000)); }
    catch (error) { quota = error.name === 'QuotaExceededError'; }
    return {quota, protectedData};
  });
  expect(before.quota).toBe(true);
  await page.addScriptTag({url: '/js/data-access-v6.js'});
  const result = await page.evaluate(protectedData => {
    const unchanged = Object.entries(protectedData).every(([key, value]) => localStorage.getItem(key) === value);
    localStorage.setItem('js_ai_visit_sessions_v6', 'v'.repeat(600000));
    return {unchanged, savedVisitLength: localStorage.getItem('js_ai_visit_sessions_v6').length,
      stats: window.JSOptionalPublicCacheV257.stats(), dataAccessReady: !!window.JSDataAccessV6};
  }, before.protectedData);
  expect(result.unchanged).toBe(true);
  expect(result.savedVisitLength).toBe(600000);
  expect(result.stats.obsoleteRemoved).toBe(2);
  expect(result.dataAccessReady).toBe(true);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('js_ai_visit_sessions_v6').length)).toBe(600000);
  expect(await page.evaluate(() => localStorage.getItem('js_memo_draft'))).toBe('unsaved memo');
});

test('new public lookups cannot refill the device quota or remove unsynced edits', async ({page, context}) => {
  await emptyPage(page, context);
  await page.addScriptTag({url: '/js/data-access-v6.js'});
  const result = await page.evaluate(() => {
    localStorage.setItem('js_memo_draft', 'memo pending');
    for (let i = 0; i < 32; i++) window.JSOptionalPublicCacheV257.setItem('js-building-badge-v4:' + i,
      JSON.stringify({savedAt: i + 1, data: 'x'.repeat(120000)}));
    const total = Object.keys(localStorage).filter(key => key.startsWith('js-building-'))
      .reduce((sum, key) => sum + key.length + localStorage.getItem(key).length, 0);
    localStorage.setItem('js_favorite_lists_v6', 'f'.repeat(900000));
    return {total, draft: localStorage.getItem('js_memo_draft'), favoriteLength: localStorage.getItem('js_favorite_lists_v6').length,
      newest: !!localStorage.getItem('js-building-badge-v4:31'), stats: window.JSOptionalPublicCacheV257.stats()};
  });
  expect(result.total).toBeLessThanOrEqual(1500000);
  expect(result.draft).toBe('memo pending');
  expect(result.favoriteLength).toBe(900000);
  expect(result.newest).toBe(true);
  expect(result.stats.evicted).toBeGreaterThan(0);
});
