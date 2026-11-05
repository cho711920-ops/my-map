import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const baseline=process.env.JS_PENDING_PHOTO_BASELINE==='1';

async function setup(page,context) {
  let release;const gate=new Promise(r=>{release=r;});let requests=0;
  const urls=Array.from({length:5},(_,i)=>'/pending-v124-'+i+'.svg');
  await page.addInitScript(()=>{
    const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    window.__redundantPhotoSrcV124=0;
    Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value){
      if(this.getAttribute('src')===value&&this.closest('.unified-detail-gallery-v8,#unifiedGalleryV8'))__redundantPhotoSrcV124++;
      src.set.call(this,value);
    }});
    const Native=window.Image;window.__pendingImagesV124=[];
    window.Image=function(...args){const i=new Native(...args);__pendingImagesV124.push(i);return i;};window.Image.prototype=Native.prototype;
  });
  await context.route('**/*',async r=>{
    const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();
    if(baseline&&u.pathname==='/js/unified-listings-v8.js')return r.fulfill({contentType:'text/javascript',body:execFileSync('git',['show','154f9cb:js/unified-listings-v8.js'],{encoding:'utf8'})});
    if(u.pathname.startsWith('/pending-v124-')) {
      if(u.pathname===urls[1]){requests++;await gate;}
      return r.fulfill({contentType:'image/svg+xml',headers:{'cache-control':'no-store'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="orange"/></svg>'});
    }
    if(u.searchParams.get('action')==='unifiedListings') {
      const response=await r.fetch(),data=await response.json();
      for(const o of data.groups['FIXTURE-LEASE-1'])Object.assign(o,{images:urls,thumbnail:urls[0],photoCount:5});
      return r.fulfill({response,json:data});
    }
    if(u.searchParams.get('action')==='unifiedListingDetail')return r.fulfill({status:503,json:{ok:false}});
    return r.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{document.getElementById('fixtureControls')?.remove();void JSUnifiedListingsV8.open('FIXTURE-LEASE-1');});
  await expect.poll(()=>page.locator('.unified-detail-hero-v8 img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  await expect.poll(()=>requests).toBeGreaterThan(0);
  return {release, get requests(){return requests;}};
}
test.afterEach(async({context})=>{await context.unrouteAll({behavior:'ignoreErrors'});});

for(const enlarged of [false,true])test('a next click adopts the already downloading photo without resetting its src '+(enlarged?'enlarged':'detail'),async({page,context},info)=>{
  const s=await setup(page,context);try {
    if(enlarged)await page.evaluate(()=>JSUnifiedListingsV8.openGallery('FIXTURE-LEASE-1','FIXTURE-LEASE-1-ORIGINAL',0));
    const selector=enlarged?'#unifiedGalleryV8':'.unified-detail-gallery-v8';
    const before=await page.evaluate(()=>{
      const i=__pendingImagesV124.find(i=>i.getAttribute('src')==='/pending-v124-1.svg');
      window.__chosenPendingV124=i;window.__sameSrcWritesV124=0;
      const setter=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src').set;
      Object.defineProperty(i,'src',{configurable:true,get(){return this.getAttribute('src');},set(v){__sameSrcWritesV124++;setter.call(this,v);}});
      return !!i&&!i.complete;
    });expect(before).toBe(true);
    const result=await page.evaluate(selector=>{
      const c=document.querySelector(selector);c.querySelector('.next').click();
      return {samePendingNode:c.querySelector('img')===__chosenPendingV124, srcReassignments:__sameSrcWritesV124, redundantDisplayAssignments:__redundantPhotoSrcV124,
        oldFrame:c.querySelectorAll('.photo-transition-ghost-v1').length, count:c.querySelector('.unified-detail-photo-count-v8')?.textContent||c.querySelector('span:not(.photo-transition-ghost-v1)')?.textContent};
    },selector);
    console.log('PENDING_PHOTO_V124',JSON.stringify({project:info.project.name,baseline,enlarged,...result}));
    expect(result.samePendingNode).toBe(!baseline);expect(result.srcReassignments).toBe(0);expect(result.oldFrame).toBe(1);expect(result.count).toBe('2 / 5');
    if(!baseline)expect(result.redundantDisplayAssignments).toBe(0);
    s.release();await expect.poll(()=>page.locator(selector+' img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
    await expect(page.locator(selector+' .photo-load-status-v114')).toBeHidden();
    await expect(page.locator(selector+' .photo-transition-ghost-v1')).toHaveCount(0);
  } finally {s.release();}
});

test('an adopted pending photo cannot replace a later selection or survive closing',async({page,context})=>{
  const s=await setup(page,context);try {
    await page.evaluate(()=>{document.querySelector('.unified-detail-photo-nav-v8.next').click();document.querySelector('.unified-detail-photo-nav-v8.next').click();});
    s.release();await expect(page.locator('.unified-detail-photo-count-v8')).toHaveText('3 / 5');
    await expect(page.locator('.unified-detail-hero-v8 img')).toHaveAttribute('src','/pending-v124-2.svg');
    await expect.poll(()=>page.locator('.unified-detail-hero-v8 img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
    await page.evaluate(()=>JSUnifiedListingsV8.close());await expect(page.locator('#unifiedDetailDrawerV8')).toHaveAttribute('aria-hidden','true');
    expect(await page.evaluate(()=>__pendingImagesV124.filter(i=>!i.isConnected&&i.getAttribute('src')).length)).toBe(0);
  } finally {s.release();}
});
