import {test,expect} from '@playwright/test';
test.afterEach(async({context})=>{await context.unrouteAll({behavior:'ignoreErrors'});});
async function setup(page,context){const stats={photos:0,detail:0},pending=[];let release=false;stats.release=()=>{release=true;pending.splice(0).forEach(r=>r());};const images=Array.from({length:7},(_,i)=>'/photo-address-v119-'+i+'.svg');const first=images[0],tail='v1\n'+images.slice(1).map(url=>{let n=0;while(first[n]&&first[n]===url[n])n++;return n+' '+url.slice(n);}).join('\n');
 await context.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(u.pathname.startsWith('/photo-address-v119-'))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="blue"/></svg>'});
 const action=u.searchParams.get('action');if(action==='unifiedListingPhotos'){stats.photos++;return r.fulfill({status:503,json:{ok:false}});}if(action==='unifiedListingDetail'){stats.detail++;if(!release)await new Promise(r=>pending.push(r));return r.fulfill({status:503,json:{ok:false}});}
 if(action==='unifiedListings'){const response=await r.fetch({maxRetries:1}),data=await response.json();for(const o of data.groups['FIXTURE-LEASE-1'])Object.assign(o,{images:[first],thumbnail:first,photoCount:7,photoPathsV119:tail});return r.fulfill({response,json:data});}return r.continue();});
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await page.locator('#fixtureControls').evaluate(el=>el.remove());await page.evaluate(()=>localStorage.removeItem('js-original-photo-lists-v118'));return stats;
}
test('cold detail goes straight to all seven photos even when both metadata endpoints are unavailable',async({page,context,isMobile},info)=>{
 const s=await setup(page,context);try{await page.evaluate(()=>{void JSUnifiedListingsV8.open('FIXTURE-LEASE-1');});await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('1 / 7');
 const result=await page.evaluate(()=>{const t=performance.now();document.querySelector('.unified-detail-photo-nav-v8.next').click();return {ms:performance.now()-t,label:document.querySelector('.unified-detail-photo-count-v8').textContent};});expect(result.label).toBe('2 / 7');expect(result.ms).toBeLessThan(100);
 await expect.poll(()=>page.locator('.unified-detail-hero-v8 img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);expect(s.photos).toBe(0);
 for(let i=0;i<5;i++)await page.locator('.unified-detail-photo-nav-v8.next').click();await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('7 / 7');
 s.release();await expect(page.locator('#unifiedDetailBodyV8')).toContainText('원본 최신 조회에 실패');await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('7 / 7');expect(s.photos).toBe(0);expect(s.detail).toBe(1);
 await page.screenshot({path:info.outputPath('metadata-unavailable-photos-ready.png')});console.log('PHOTO_ADDRESS_READY',JSON.stringify({project:info.project.name,clickMs:result.ms,photoListRequests:s.photos}));
 }finally{s.release();}
});
test('all photo addresses remain available after refresh without the per-ad photo cache',async({page,context})=>{const s=await setup(page,context);try{await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await page.evaluate(()=>{void JSUnifiedListingsV8.open('FIXTURE-LEASE-1');});await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('1 / 7');await page.locator('.unified-detail-photo-nav-v8.prev').click();await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('7 / 7');expect(s.photos).toBe(0);}finally{s.release();}});

test('same-proof inventory upgrade supplies photos to an already open waiting gallery',async({page,context})=>{
 const s=await setup(page,context);try{
 await page.evaluate(()=>{
  const item={...allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1'),sourceSnapshotKey:'sha256-v1:'+'a'.repeat(64)};allItems=[item];
  const old={...JSUnifiedListingsV8.allOriginals(item.propertyId)[0],source:'네이버',originalId:'UPGRADE-A',propertyId:item.propertyId};
  window.__v119new=old.photoPathsV119;delete old.photoPathsV119;
  const result={ok:true,groups:{[item.propertyId]:[old]},sourceSnapshotKeys:{[item.propertyId]:item.sourceSnapshotKey},sourceSnapshotPropertyIds:{[item.propertyId]:item.propertyId}};
  JSUnifiedListingsV8.attach(allItems,result);JSUnifiedListingsV8.attachCompatible(allItems,result);applyFilter();window.__v119old=result;
  void JSUnifiedListingsV8.open(item.propertyId);
 });
 await page.evaluate(()=>document.querySelector('.unified-detail-photo-nav-v8.next').click());
 const gallery=await page.locator('.unified-detail-gallery-v8').elementHandle();
 await page.evaluate(()=>{const result=__v119old,id='FIXTURE-LEASE-1';result.groups[id]=result.groups[id].map(o=>({...o,photoPathsV119:__v119new}));JSUnifiedListingsV8.attachCompatible(allItems,result);});
 await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('2 / 7');
 expect(await page.locator('.unified-detail-gallery-v8').evaluate((el,previous)=>el===previous,gallery)).toBe(true);
 await page.locator('.unified-detail-photo-nav-v8.next').click();await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('3 / 7');
 s.release();await expect(page.locator('#unifiedDetailBodyV8')).toContainText('원본 최신 조회에 실패');await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('3 / 7');
 }finally{s.release();}
});
