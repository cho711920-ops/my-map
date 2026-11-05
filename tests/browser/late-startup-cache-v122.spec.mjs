import{test,expect}from'@playwright/test';import{readFile}from'node:fs/promises';
async function setup(page,context,{status=503}={}){
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
 await page.evaluate(async()=>{await JSInitialListingsCacheV1.write(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,JSUnifiedListingsV8.allOriginals(i.propertyId)]))});window.__v122Snapshot=await JSInitialListingsCacheV1.read();});
 await page.evaluate(()=>{window.kakao={maps:{load(){},LatLng:function(a,b){this.getLat=()=>a;this.getLng=()=>b;}}};});
 await page.addScriptTag({content:await readFile(new URL('../../js/map.js',import.meta.url),'utf8')});
 await page.route('**/api/sheet',r=>r.fulfill({status,json:{ok:false,message:'controlled network failure'}}));
 await page.route('**/api/data?**',r=>new URL(r.request().url()).searchParams.get('action')==='unifiedListings'?r.fulfill({status:503,json:{ok:false}}):r.fallback());
 await page.evaluate(()=>{
  document.getElementById('fixtureControls')?.remove();window.drawItems=items=>{showList(items);updateMapListingCountV825(items);};window.clearPinnedClusterSelectionV6515=()=>{};
  const actual=JSInitialListingsCacheV1;window.__v122Cache=actual;
  window.JSInitialListingsCacheV1={...actual,read:()=>new Promise(r=>{window.__v122Release=()=>r(__v122Snapshot);})};
  allItems=[];currentItems=[];visibleListItems=[];document.getElementById('list').replaceChildren();
  window.__v122Pending=loadSheet(false,false);
 });
 await expect.poll(()=>page.evaluate(()=>jsListingsLoadStateV65.phase)).toBe(status===401||status===403?'auth':'error');
}
test('late valid local snapshot restores the complete list after the network has already failed',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>__v122Release());
 await expect.poll(()=>page.locator('#list .item').count()).toBe(2);
 await expect(page.locator('#jsListingsLoadStatusV65')).toHaveCount(0);
 expect(await page.evaluate(()=>({phase:jsListingsLoadStateV65.phase,error:jsListingsLoadStateV65.errorCode,complete:jsListingsCompleteBaseV1,loading:isLoadingSheet}))).toEqual({phase:'error',error:'LIST_HTTP_503',complete:true,loading:false});
});
for(const status of[401,403])test('late snapshot never restores after auth failure '+status,async({page,context})=>{
 await setup(page,context,{status});await page.evaluate(()=>__v122Release());await expect(page.locator('#jsListingsLoadStatusV65')).toContainText('로그인이 만료');expect(await page.locator('#list .item').count()).toBe(0);
});
test('structural cache invalidation wins over a pending local snapshot',async({page,context})=>{
 await setup(page,context);await page.evaluate(async()=>{await __v122Cache.clear();__v122Release();});await expect(page.locator('#jsListingsLoadStatusV65')).toContainText('매물을 불러오지 못했습니다');expect(await page.locator('#list .item').count()).toBe(0);
});
