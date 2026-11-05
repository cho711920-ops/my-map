import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const baseline=process.env.JS_PHOTO_SPEED_BASELINE==='1';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="orange"/></svg>';
for(const host of ['landthumb-phinf.pstatic.net','img.kr.gcp-karroter.net','file1.gongsilbox.com']) for(const mode of ['direct-fast','direct-stalled','direct-error','alternate-late','retarget'])test(host+' '+mode,async({page,context},info)=>{
 test.skip(mode==='retarget'&&host!=='landthumb-phinf.pstatic.net','Shared pending-probe cancellation');
 let release;const held=new Promise(r=>release=r);let proxyCalls=0,writes=0;const paths=[];
 const urls=[0,1,2].map(i=>'https://'+host+'/photo-speed-v115-'+i+'.jpg');
 const old=baseline?execFileSync('git',['show','6f3dae5:js/unified-listings-v8.js'],{encoding:'utf8'}):null;
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),proxy=u.pathname==='/api/listing-image',src=proxy?u.searchParams.get('url')||'':u.href;
  if(req.method()!=='GET')writes++;
  if(src.includes('photo-speed-v115-')){
   const n=Number(src.match(/photo-speed-v115-(\d)/)[1]);
   if(n===1){paths.push(proxy?'proxy':'direct');if(proxy)proxyCalls++;
    if(mode==='retarget'||(!proxy&&mode==='direct-stalled')||(proxy&&mode==='alternate-late'))await held;
    else if(!proxy&&mode==='direct-error')return route.fulfill({status:503,body:'fixture failure'});
    else await new Promise(r=>setTimeout(r,proxy&&mode==='direct-fast'?1800:(!proxy&&mode==='alternate-late'?1500:80)));
   }
   return route.fulfill({contentType:'image/svg+xml',body:svg,headers:{'cache-control':'public,max-age=3600'}});
  }
  if(u.hostname!=='127.0.0.1')return route.abort();
  if(u.pathname==='/js/unified-listings-v8.js'&&old)return route.fulfill({contentType:'text/javascript',body:old});
  if(u.pathname==='/'){const r=await route.fetch(),h={...r.headers()};h['content-security-policy']=h['content-security-policy'].replace("img-src 'self' data:","img-src 'self' data: https:");return route.fulfill({response:r,headers:h});}
  if(u.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action'))){const r=await route.fetch(),data=await r.json();for(const o of data.groups?Object.values(data.groups).flat():data.originals||[])if(o.propertyId==='FIXTURE-LEASE-1')Object.assign(o,{images:urls,thumbnail:urls[0],photoCount:3});return route.fulfill({response:r,json:data});}
  return route.continue();
 });
 try{
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await expect.poll(()=>page.evaluate(()=>JSV6ListStore.load('favorite').length)).toBeGreaterThan(0);
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
  const image=page.locator('.unified-detail-hero-v8 img'),gallery=page.locator('.unified-detail-gallery-v8');
  await expect(gallery.locator('.unified-detail-photo-count-v8')).toHaveText('1 / 3');await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  const start=Date.now();await page.evaluate(()=>document.querySelector('.unified-detail-photo-nav-v8.next').click());
  if(mode==='retarget'){await expect.poll(()=>proxyCalls).toBe(1);await page.evaluate(()=>document.querySelector('.unified-detail-photo-nav-v8.next').click());await expect(gallery.locator('.unified-detail-photo-count-v8')).toHaveText('3 / 3');await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);release();await page.waitForTimeout(200);await expect(image).toHaveAttribute('src',urls[2]);await page.evaluate(()=>JSUnifiedListingsV8.close());expect(await image.evaluate(e=>!!e._photoLoadCleanupV114)).toBe(false);expect(writes).toBe(0);return;}
  await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth>0&&e.src.includes('photo-speed-v115-1')), {timeout:baseline?6000:4000}).toBe(true);
  const elapsed=Date.now()-start;console.log('PHOTO_SPEED',JSON.stringify({project:info.project.name,host,mode,baseline,elapsed,proxyCalls,paths,writes}));
  await expect(gallery.locator('.photo-load-status-v114')).toBeHidden();
  if(!baseline&&mode==='direct-fast'){expect(elapsed).toBeLessThan(1200);expect(proxyCalls).toBe(0);}
  if(!baseline&&mode==='direct-stalled'){expect(elapsed).toBeLessThan(3000);expect(proxyCalls).toBe(1);await expect(image).toHaveAttribute('src','/api/listing-image?url='+encodeURIComponent(urls[1]));}
  if(mode==='direct-error'){expect(elapsed).toBeLessThan(2000);expect(proxyCalls).toBe(1);}
  if(!baseline&&mode==='alternate-late'){
   expect(elapsed).toBeLessThan(3000);await expect(image).toHaveAttribute('src',urls[1]);release();await page.waitForTimeout(150);await expect(image).toHaveAttribute('src',urls[1]);
  }
  expect(writes).toBe(0);
 }finally{release();}
});
