import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
});

test('saved separation rejects the nine-ad cache before delayed refresh and persists seven plus two across reload',async({page,context,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let mutations=0;
  await page.route('**/api/data',async r=>{
    if(r.request().method()!=='POST'||r.request().postDataJSON()?.action!=='moveOriginalListing')return r.fallback();
    mutations++;
    return r.fulfill({json:{ok:true,persisted:true,separated:true,originalId:'SPLIT-8',sourceMasterId:'SPLIT-A',targetMasterId:'SPLIT-B',propertyId:'SPLIT-B'}});
  });
  await page.evaluate(async()=>{
    const base={...allItems[0],propertyId:'SPLIT-A',key:'split-A',name:'분리 검수 상가',deposit:3000,rent:210,premium:1000,area:19.9};
    const ads=Array.from({length:9},(_,n)=>({propertyId:base.propertyId,source:'네이버',address:base.address,room:'1층',type:'상가',tradeType:'lease',originalId:'SPLIT-'+n,sourceId:'split-'+n,active:1,revision:1,
      deposit:n<7?3000:1000,rent:n<7?210:85,premium:n<7?1000:2000,area:n<7?19.9:null,images:[],photoCount:0}));
    window.__splitFixture={base,ads};
    allItems=[base];JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{'SPLIT-A':ads}});applyFilter();
    window.__oldSplitSnapshot=JSInitialListingsCacheV1.snapshot(allItems,{ok:true,groups:{'SPLIT-A':ads}});
    if(!await JSInitialListingsCacheV1.write(allItems,{ok:true,groups:{'SPLIT-A':ads}}))throw Error('initial cache not saved');
    window.JSListingRefreshV1={reloadAfterMutation(){return new Promise(resolve=>{window.__finishSplitRefresh=async()=>{
      const {base,ads}=__splitFixture,other={...base,propertyId:'SPLIT-B',key:'split-B',deposit:1000,rent:85,premium:2000,area:0};
      allItems=[base,other];const groups={'SPLIT-A':ads.slice(0,7),'SPLIT-B':ads.slice(7).map(o=>({...o,propertyId:'SPLIT-B'}))};
      JSUnifiedListingsV8.attach(allItems,{ok:true,groups});applyFilter();
      window.__splitSaved=await JSInitialListingsCacheV1.write(allItems,{ok:true,groups});resolve(true);
    };});}};
  });
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator('#list')).toContainText('동일매물 9개');
  const oldSnapshot=await page.evaluate(()=>__oldSplitSnapshot);
  page.once('dialog',dialog=>dialog.accept());
  await page.evaluate(()=>JSUnifiedListingsV8.separate(encodeURIComponent('SPLIT-8'),1));
  await expect.poll(()=>page.evaluate(()=>typeof __finishSplitRefresh)).toBe('function');
  expect(await page.evaluate(()=>JSInitialListingsCacheV1.read())).toBeNull();
  expect(await page.evaluate(()=>JSInitialListingsCacheV1.usable(__oldSplitSnapshot))).toBe(false);
  const otherTab=await context.newPage();
  await otherTab.goto('/');await expect(otherTab.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await otherTab.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
  expect(await otherTab.evaluate(s=>JSInitialListingsCacheV1.usable(s),oldSnapshot)).toBe(false);
  expect(await otherTab.evaluate(()=>JSInitialListingsCacheV1.read())).toBeNull();
  await page.evaluate(()=>__finishSplitRefresh());
  await expect(page.locator('#list .item')).toHaveCount(2);
  await expect(page.locator('#list .item').nth(0)).toContainText('동일매물 7개');
  await expect(page.locator('#list .item').nth(1)).toContainText('동일매물 2개');
  await page.locator('#list').screenshot({path:info.outputPath('split-seven-and-two.png')});
  expect(await page.evaluate(()=>__splitSaved)).toBe(true);
  await otherTab.reload();await expect(otherTab.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await otherTab.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
  const stored=await otherTab.evaluate(async()=>{const s=await JSInitialListingsCacheV1.read();return Object.fromEntries(Object.entries(s.unified.groups).map(([id,rows])=>[id,rows.map(o=>o.originalId)]));});
  expect(stored['SPLIT-A']).toHaveLength(7);expect(stored['SPLIT-B']).toHaveLength(2);
  expect(new Set(Object.values(stored).flat()).size).toBe(9);
  expect(mutations).toBe(1);expect(errors).toEqual([]);
  await otherTab.close();
});

test('queued writes from another tab cannot bring back old memberships after cache invalidation',async({page,context})=>{
  await page.evaluate(()=>{
    window.__idleWrites=[];window.requestIdleCallback=callback=>__idleWrites.push(callback);
    window.__queuedSnapshot=JSInitialListingsCacheV1.write(allItems,{ok:true,groups:{}});
  });
  const other=await context.newPage();await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await other.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
  await other.evaluate(()=>JSInitialListingsCacheV1.clear());
  const written=await page.evaluate(async()=>{__idleWrites[0]();return __queuedSnapshot;});
  expect(written).toBe(false);expect(await other.evaluate(()=>JSInitialListingsCacheV1.read())).toBeNull();
  await other.close();
});

test('a saved separation with a failed refresh stays saved and does not announce list synchronization complete',async({page})=>{
  await page.route('**/api/data',r=>r.request().method()==='POST'&&r.request().postDataJSON()?.action==='moveOriginalListing'
    ?r.fulfill({json:{ok:true,persisted:true,separated:true,originalId:'O',propertyId:'B'}}):r.fallback());
  await page.evaluate(()=>{window.JSListingRefreshV1={reloadAfterMutation:()=>Promise.resolve(false)};});
  page.once('dialog',dialog=>dialog.accept());
  await page.evaluate(()=>JSUnifiedListingsV8.separate('O',1));
  await expect(page.locator('#unifiedMergeNoticeV8139')).toContainText('저장은 완료됐지만 최신 목록 동기화가 지연됩니다');
  await expect(page.locator('#unifiedMergeNoticeV8139')).not.toContainText('반영도 끝났습니다');
  expect(await page.evaluate(()=>JSInitialListingsCacheV1.read())).toBeNull();
});
