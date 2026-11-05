import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function setup(page, context) {
  await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await page.addScriptTag({url: '/js/initial-listings-cache-v1.js'});
  await page.evaluate(async () => {
    const a = {propertyId: 'A', address: '같은 지번', memo: 'A 원본', premium: 10};
    const b = {propertyId: 'B', address: '같은 지번', memo: 'B 원본', premium: 20};
    await JSInitialListingsCacheV1.write([a,b], {ok: true, groups: {A: [{originalId: 'ad-a'}], B: [{originalId: 'ad-b'}]}});
    window.__cacheReadsV124 = 0;
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {if (args[0] === 'js-realestate-initial-listings-v1') __cacheReadsV124++; return open(...args);};
  });
}

test('early warmup and startup consume one complete IDB read, not a second large clone', async ({page,context}) => {
  await setup(page,context);
  const result = await page.evaluate(async () => {
    const c = JSInitialListingsCacheV1;
    await Promise.all([c.warm(), c.warm()]);
    const value = await c.read();
    return {reads: __cacheReadsV124, ids: value.items.map(i=>i.propertyId), complete: c.usable(value)};
  });
  expect(result).toEqual({reads: 1, ids: ['A','B'], complete: true});
});

test('an edit after warmup cannot restore an old value or another same-parcel master', async ({page,context}) => {
  await setup(page,context);
  const result = await page.evaluate(async () => {
    const c = JSInitialListingsCacheV1;
    await c.warm();
    await c.commitItem({propertyId:'A'}, {persisted:true, propertyId:'A', memo:'A 확정 수정'});
    return (await c.read()).items.map(i=>[i.propertyId,i.memo]);
  });
  expect(result).toEqual([['A','A 확정 수정'],['B','B 원본']]);
});

test('scope changes and structural invalidation reject the warmed snapshot', async ({page,context}) => {
  await setup(page,context);
  expect(await page.evaluate(async () => {
    const c = JSInitialListingsCacheV1;
    await c.warm(); JSListingTradeV1.setMode('building_sale',{apply:false});
    const sale = await c.read();
    JSListingTradeV1.setMode('lease',{apply:false}); await c.warm(); await c.clear();
    return {sale, afterClear: await c.read()};
  })).toEqual({sale:null, afterClear:null});
});

test('the real authenticated boot starts the cache read and critical preloads before a delayed map SDK', async ({page,context}) => {
  await setup(page,context);
  let release, sdkRequested = false;
  const gate = new Promise(r=>{release=r;});
  const html = await readFile('index.html','utf8');
  await context.unroute('**/*');
  await context.route('**/*', async r => {
    const u = new URL(r.request().url());
    if (u.hostname === 'dapi.kakao.com') {sdkRequested=true; await gate; return r.fulfill({contentType:'text/javascript',body:'window.kakao={maps:{load(){}}};'});}
    if (u.hostname !== '127.0.0.1') return r.abort();
    if (u.pathname === '/') return r.fulfill({contentType:'text/html', body:html});
    return r.continue();
  });
  await page.addInitScript(() => {
    const open=indexedDB.open.bind(indexedDB);window.__earlyCacheReadV124=0;
    indexedDB.open=(...args)=>{if(args[0]==='js-realestate-initial-listings-v1')__earlyCacheReadV124++;return open(...args);};
  });
  try {
    await page.reload({waitUntil:'domcontentloaded'});
    await expect.poll(()=>sdkRequested).toBe(true);
    expect(await page.evaluate(()=>({reads:__earlyCacheReadV124, mapPreloaded:!!document.head.querySelector('link[rel="preload"][href*="js/map.js"]'), locked:document.getElementById('wrap').inert})))
      .toEqual({reads:1,mapPreloaded:true,locked:true});
    release();
    await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
    expect(await page.evaluate(async()=>({ids:(await JSInitialListingsCacheV1.read()).items.map(i=>i.propertyId),reads:__earlyCacheReadV124})))
      .toEqual({ids:['A','B'],reads:1});
  } finally {release();await context.unrouteAll({behavior:'ignoreErrors'});}
});
