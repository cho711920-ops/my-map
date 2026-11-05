import {test, expect} from '@playwright/test';
async function ready(page,context) {
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
}
test('confirmed edits preserve the complete cache and exact master through a refresh',async({page,context})=>{
 await ready(page,context);
 const result=await page.evaluate(async()=>{
  const c=JSInitialListingsCacheV1;
  const items=[{propertyId:'A',memo:'old A',premium:2000,room:'1층',displayValuePresence:{premium:true}},{propertyId:'B',memo:'old B',premium:3000,room:'1층'}];
  const groups={A:[{originalId:'ad-A',premium:2000,manualDisplayFields:''}],B:[{originalId:'ad-B',premium:3000,manualDisplayFields:''}]};
  await c.write(items,{ok:true,groups});
  const oldWrite=c.write(items,{ok:true,groups});
  const a=c.commitItem({propertyId:'A',displayValuePresence:{premium:true},manualFinancialFieldsV106:['premium']},{persisted:true,propertyId:'A',updated:{premium:0,memo:'saved A'},changedFields:['premium']});
  const b=c.commitItem({propertyId:'B'},{persisted:true,propertyId:'B',memo:'saved B',contacts:[]});
  const success=await Promise.all([oldWrite,a,b]); const s=await c.read();
  return {success,items:s.items.map(i=>({id:i.propertyId,memo:i.memo,premium:i.premium})),flags:s.unified.groups.A[0].manualDisplayFields,original:s.unified.groups.A[0].premium,count:s.totalItemCount,usable:c.usable(s)};
 });
 expect(result.success.slice(1)).toEqual([true,true]);expect(result.items).toEqual([{id:'A',memo:'saved A',premium:0},{id:'B',memo:'saved B',premium:3000}]);
 expect(result.flags).toBe('premium');expect(result.original).toBe(2000);expect(result.count).toBe(2);expect(result.usable).toBe(true);
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await page.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
 expect(await page.evaluate(async()=>(await JSInitialListingsCacheV1.read()).items.map(i=>[i.propertyId,i.memo,i.premium]))).toEqual([['A','saved A',0],['B','saved B',3000]]);
});
test('logout/structural invalidation wins over a pending confirmed cache patch',async({page,context})=>{
 await ready(page,context);
 expect(await page.evaluate(async()=>{
  const c=JSInitialListingsCacheV1;await c.write([{propertyId:'A',memo:'old'}],{ok:true,groups:{A:[{originalId:'a'}]}});
  const patch=c.commitItem({propertyId:'A'},{persisted:true,propertyId:'A',memo:'saved'});await c.clear();await patch;return await c.read();
 })).toBeNull();
});
async function photos(page,context) {
 const stats={photo:0,detail:0,fail:false,failureCount:0,reportedCount:7};
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="blue"/></svg>';
 await context.route('**/*',async r=>{
  const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();
  if(u.pathname.startsWith('/photo-v118-'))return r.fulfill({contentType:'image/svg+xml',body:svg,headers:{'cache-control':'public,max-age=3600'}});
  if(u.pathname==='/api/data'&&u.searchParams.get('action')==='unifiedListingPhotos'){
   stats.photo++;if(stats.fail||stats.failureCount-- > 0)return r.fulfill({status:503,json:{ok:false,message:'controlled failure'}});
   return r.fulfill({json:{ok:true,propertyId:'FIXTURE-LEASE-1',originalId:u.searchParams.get('originalId'),images:Array.from({length:7},(_,i)=>'/photo-v118-'+i+'.svg'),photoCount:stats.reportedCount}});
  }
  if(u.pathname==='/api/data'&&u.searchParams.get('action')==='unifiedListingDetail'){stats.detail++;return r.fulfill({status:503,json:{ok:false,message:'controlled detail failure'}});}
  if(u.pathname==='/api/data'&&u.searchParams.get('action')==='unifiedListings'){
   const response=await r.fetch({maxRetries:1}),data=await response.json();for(const o of data.groups['FIXTURE-LEASE-1'])Object.assign(o,{source:'네이버',thumbnail:'/photo-v118-0.svg',images:['/photo-v118-0.svg'],photoCount:7});return r.fulfill({response,json:data});
  }
  return r.continue();
 });
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');return stats;
}
const counter=p=>p.locator('.unified-detail-photo-count-v8');
test('opening prepares photos before a click and same-ad cached photos survive refresh and detail failure',async({page,context})=>{
 const stats=await photos(page,context);
 await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
 await expect(counter(page)).toHaveText('1 / 7');expect(stats.photo).toBe(1);
 const first=await page.evaluate(()=>{const t=performance.now();document.querySelector('.unified-detail-photo-nav-v8.next').click();return {ms:performance.now()-t,count:document.querySelector('.unified-detail-photo-count-v8').textContent};});
 expect(first.count).toBe('2 / 7');expect(first.ms).toBeLessThan(100);
 stats.fail=true;await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
 await expect(counter(page)).toHaveText('1 / 7');await page.locator('.unified-detail-photo-nav-v8.next').click();await expect(counter(page)).toHaveText('2 / 7');expect(stats.photo).toBe(1);
});
test('cached photos never migrate to another ad or signed-in account',async({page,context})=>{
 const stats=await photos(page,context);await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));await expect(counter(page)).toHaveText('1 / 7');
 stats.fail=true;await page.evaluate(()=>{JSUnifiedListingsV8.close();JSAuthenticatedAccountEmail='another@example.invalid';JSUnifiedListingsV8.open('FIXTURE-LEASE-1');});
 await expect(counter(page)).toHaveText('사진 목록 조회 실패 · 다음 버튼으로 재시도');expect(stats.photo).toBe(3);
 await page.evaluate(()=>{JSUnifiedListingsV8.close();JSAuthenticatedAccountEmail='browser-fixture@example.invalid';const items=allItems;const groups=Object.fromEntries(items.map(i=>[i.propertyId,JSUnifiedListingsV8.allOriginals(i.propertyId).map(o=>({...o,originalId:o.originalId+'-different'}))]));JSUnifiedListingsV8.attach(items,{ok:true,groups});applyFilter();JSUnifiedListingsV8.open('FIXTURE-LEASE-1');});
 await expect(counter(page)).toHaveText('사진 목록 조회 실패 · 다음 버튼으로 재시도');expect(stats.photo).toBe(5);
});

test('one transient photo-list failure recovers automatically without repeating the full detail',async({page,context})=>{
 const stats=await photos(page,context);stats.failureCount=1;
 await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
 await expect(counter(page)).toHaveText('1 / 7');expect(stats.photo).toBe(2);expect(stats.detail).toBe(1);
 await page.locator('.unified-detail-photo-nav-v8.next').click();await expect(counter(page)).toHaveText('2 / 7');
});

test('an unconfirmed or wrong-master receipt never replaces an existing cache',async({page,context})=>{
 await ready(page,context);
 expect(await page.evaluate(async()=>{
  const c=JSInitialListingsCacheV1;await c.write([{propertyId:'A',memo:'original'}],{ok:true,groups:{A:[{originalId:'ad-A'}]}});
  const wrong=await c.commitItem({propertyId:'A'},{persisted:true,propertyId:'B',memo:'wrong'});
  const pending=await c.commitItem({propertyId:'A'},{persisted:false,propertyId:'A',memo:'not saved'});
  return {wrong,pending,memo:(await c.read()).items[0].memo};
 })).toEqual({wrong:false,pending:false,memo:'original'});
});

test('a stale advertised photo count cannot create nonexistent gallery pages',async({page,context})=>{
 const stats=await photos(page,context);stats.reportedCount=12;
 await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
 await expect(counter(page)).toHaveText('1 / 7');
 await page.evaluate(()=>{for(let i=0;i<7;i++)document.querySelector('.unified-detail-photo-nav-v8.next').click();});
 await expect(counter(page)).toHaveText('1 / 7');expect(stats.photo).toBe(1);
});
