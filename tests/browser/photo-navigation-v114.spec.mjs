import {test,expect} from '@playwright/test';
const cases=[['lease','네이버','landthumb-phinf.pstatic.net'],['lease','당근','img.kr.gcp-karroter.net'],['lease','공실박스','file1.gongsilbox.com'],['building_sale','네이버','landthumb-phinf.pstatic.net'],['land_sale','네이버','landthumb-phinf.pstatic.net']];
const svg=i=>'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="'+(i?'#fbbf24':'#17665b')+'"/><text x="50" y="200" font-size="70">PHOTO '+i+'</text></svg>';
for(const [market,source,host] of cases)for(const enlarged of [false,true])for(const fault of ['slow','broken','proxy','timeout'])test([market,source,enlarged?'enlarged':'detail',fault].join(' '),async({page,context},info)=>{
 test.skip(enlarged&&info.project.name==='mobile','Phone uses inline gallery');
 test.skip(fault==='timeout'&&(market!=='lease'||source!=='네이버'||enlarged),'Shared timeout lifecycle covered in inline PC and phone');
 let release,held=false,writes=0,recover=false;const wait=new Promise(r=>release=r);
 const imageUrl=i=>'https://'+host+'/photo-stall-audit-'+i+'.jpg?s=1440x1440&q=95';
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()!=='GET')writes++;
  const src=u.pathname==='/api/listing-image'?u.searchParams.get('url')||'':u.href;
  const m=src.match(/photo-stall-audit-(\d)/);
  if(m){const n=Number(m[1]);if(n===1){held=true;if(fault==='slow'||fault==='timeout')await wait;else if(!recover&&(fault==='broken'||u.pathname==='/api/listing-image'))return route.fulfill({status:503,body:'fixture unavailable'});}return route.fulfill({contentType:'image/svg+xml',body:svg(n),headers:{'cache-control':'public,max-age=3600'}});}
  if(u.hostname!=='127.0.0.1')return route.abort();
  if(u.pathname==='/'){const r=await route.fetch(),h={...r.headers()};h['content-security-policy']=h['content-security-policy'].replace("img-src 'self' data:","img-src 'self' data: https:");return route.fulfill({response:r,headers:h});}
  if(u.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action'))){const r=await route.fetch(),j=await r.json();for(const o of j.groups?Object.values(j.groups).flat():j.originals||[]){o.images=[0,1,2].map(imageUrl);o.thumbnail=o.images[0];o.photoCount=3;o.source=source;}return route.fulfill({response:r,json:j});}
  return route.continue();
 });
 try{
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const mobile=info.project.name==='mobile';await page.locator(mobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);if(mobile)await page.locator('[data-mobile-view="list"]').click();
  const id=await page.locator('#list .item').first().getAttribute('data-property-id');await page.evaluate(id=>JSUnifiedListingsV8.open(encodeURIComponent(id)),id);
  await expect.poll(()=>page.locator('.unified-detail-hero-v8 img').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  await expect.poll(()=>page.locator('.unified-detail-gallery-v8').evaluate(e=>e._imagesV8.length)).toBe(3);
  if(enlarged)await page.locator('.unified-detail-hero-v8').click();
  const container=page.locator(enlarged?'#unifiedGalleryV8':'.unified-detail-gallery-v8'),img=container.locator('img'),next=container.locator(enlarged?'.next':'.unified-detail-photo-nav-v8.next');
  if(fault==='timeout')await page.clock.install();
  await page.evaluate(selector=>document.querySelector(selector).click(),enlarged?'#unifiedGalleryV8 .next':'.unified-detail-photo-nav-v8.next');
  await expect.poll(()=>held).toBe(true);
  if(fault==='timeout'){
   await page.clock.fastForward(16000);await expect(img).toHaveAttribute('src',imageUrl(1));
   await page.clock.fastForward(16000);await expect(container.locator('.photo-load-status-v114')).toContainText('다시 시도');
   await expect(container.locator('.photo-transition-ghost-v1')).toHaveCount(1);
   await page.evaluate(()=>JSUnifiedListingsV8.close());
   await expect(container.locator('.photo-transition-ghost-v1')).toHaveCount(0);
   expect(await img.evaluate(e=>!!e._photoLoadCleanupV114)).toBe(false);
   await page.evaluate(id=>JSUnifiedListingsV8.open(encodeURIComponent(id)),id);
   await expect(img).toHaveAttribute('data-detail-source-v8144',imageUrl(0));
   release();await page.clock.fastForward(1000);
   await expect(img).toHaveAttribute('data-detail-source-v8144',imageUrl(0));
   await page.evaluate(()=>JSUnifiedListingsV8.close());
   expect(await img.evaluate(e=>!!e._photoLoadCleanupV114)).toBe(false);expect(writes).toBe(0);return;
  }
  await page.waitForTimeout(fault==='slow'?2300:150);
  if(fault==='proxy')await expect.poll(()=>img.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  const observed=await container.evaluate((e,enlarged)=>{const i=e.querySelector('img'),c=e.querySelector(enlarged?'span:not(.photo-transition-ghost-v1)':'.unified-detail-photo-count-v8');return {counter:c?.textContent,index:e._indexV8,imageComplete:i?.complete,naturalWidth:i?.naturalWidth,opacity:i?getComputedStyle(i).opacity:null,oldFrame:e.querySelectorAll('.photo-transition-ghost-v1').length};},enlarged);
  console.log('PHOTO_STALL_OBSERVATION',JSON.stringify({market,source,enlarged,fault,...observed,writes}));
  await info.attach('observation',{body:JSON.stringify(observed),contentType:'application/json'});

  expect(writes).toBe(0);
  // A slow/failed photo retains its decoded predecessor and exact index.
  if(fault==='slow'){expect(observed.index).toBe(1);expect(observed.oldFrame).toBe(1);expect(observed.imageComplete).toBe(false);}
  if(fault==='broken'){expect(observed.counter).toBe('2 / 3');expect(observed.naturalWidth).toBe(0);await expect(container.locator('.photo-load-status-v114')).toContainText('다시 시도');recover=true;await container.locator('.photo-load-status-v114 button').click();await expect.poll(()=>img.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);await expect(container.locator('.photo-load-status-v114')).toBeHidden();}
  if(fault==='proxy'){expect(observed.index).toBe(1);expect(observed.naturalWidth).toBeGreaterThan(0);await expect(img).toHaveAttribute('src',imageUrl(1));}
  if(fault==='slow'){release();await expect.poll(()=>img.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);await expect(container.locator('.photo-load-status-v114')).toBeHidden();}
 }finally{release();}
});
