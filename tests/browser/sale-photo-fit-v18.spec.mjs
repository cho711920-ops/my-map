import {test,expect} from '@playwright/test';

// Colored perimeter and corner marks make accidental cropping visible in captures.
const dimensions=[[900,1500],[1600,900],[2000,600]];
function photo(index){const [w,h]=dimensions[index];return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#e7e0d2"/><path d="M0 0H${w}V${h}H0Z" fill="none" stroke="#087e8b" stroke-width="40"/><path d="M0 0L${w} ${h}M${w} 0L0 ${h}" stroke="#c2b59b" stroke-width="10"/><g fill="#b13743"><circle cx="60" cy="60" r="30"/><circle cx="${w-60}" cy="60" r="30"/><circle cx="60" cy="${h-60}" r="30"/><circle cx="${w-60}" cy="${h-60}" r="30"/></g><text x="${w/2}" y="${h/2}" text-anchor="middle" font-size="70">${w} × ${h}</text></svg>`;}

for(const market of ['building_sale','land_sale'])test(market+' shows the full portrait, landscape and panorama without opening the original',async({page,context,isMobile},info)=>{
  let details=0,writes=0;
  const id=market==='building_sale'?'FIXTURE-BUILDING':'FIXTURE-LAND';
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.hostname!=='127.0.0.1')return route.abort();
    if(req.method()!=='GET')writes++;
    if(url.pathname.startsWith('/sale-fit-'))return route.fulfill({contentType:'image/svg+xml',body:photo(Number(url.pathname.match(/sale-fit-(\d)/)[1]))});
    if(url.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(url.searchParams.get('action'))){
      if(url.searchParams.get('action')==='unifiedListingDetail')details++;
      const response=await route.fetch(),data=await response.json();
      for(const original of data.groups?Object.values(data.groups).flat():data.originals||[])if(original.propertyId===id)Object.assign(original,{images:dimensions.map((_,i)=>'/sale-fit-'+i+'.svg'),photoCount:3});
      return route.fulfill({response,json:data});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#list .item-building-name').first().click();
  const drawer=page.locator('#unifiedDetailDrawerV8'),stage=drawer.locator('.unified-detail-gallery-v8'),image=stage.locator('img'),counter=stage.locator('.unified-detail-photo-count-v8');
  await drawer.locator('[data-sale-section-target="photos"]').click();
  let height;
  for(let i=0;i<dimensions.length;i++){
    await expect(counter).toHaveText((i+1)+' / 3');
    await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth)).toBe(dimensions[i][0]);
    await expect(stage.locator('.photo-transition-ghost-v1')).toHaveCount(0);
    const geometry=await image.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),g=e.closest('.unified-detail-gallery-v8').getBoundingClientRect();const scale=Math.min(r.width/e.naturalWidth,r.height/e.naturalHeight);return {fit:s.objectFit,w:e.naturalWidth*scale,h:e.naturalHeight*scale,boxW:r.width,boxH:r.height,stageH:g.height,overflow:document.documentElement.scrollWidth>innerWidth};});
    expect(geometry.fit).toBe('contain');expect(geometry.w).toBeLessThanOrEqual(geometry.boxW+.1);expect(geometry.h).toBeLessThanOrEqual(geometry.boxH+.1);expect(geometry.overflow).toBe(false);
    if(height==null)height=geometry.stageH;else expect(geometry.stageH).toBeCloseTo(height,1);
    expect(height).toBeGreaterThanOrEqual(200);expect(height).toBeLessThanOrEqual(460);
    await stage.screenshot({path:info.outputPath(market+'-'+i+'-full-photo.png')});
    if(i<dimensions.length-1){await stage.locator('.next').click();await expect(stage.locator('.photo-transition-ghost-v1')).toHaveCSS('background-size','contain');}
  }
  await stage.locator('.prev').click();await expect(counter).toHaveText('2 / 3');
  await expect(page.locator('#unifiedGalleryV8.open')).toHaveCount(0);expect(details).toBe(1);expect(writes).toBe(0);
  // The shared lease gallery keeps its established presentation.
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('lease');
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
  await expect(drawer).not.toHaveAttribute('data-sale-presentation-v2');
});
