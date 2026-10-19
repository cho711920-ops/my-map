import {test,expect} from '@playwright/test';
const sizes=[[900,1500],[1600,900],[2000,600]];
function svg(index){const [w,h]=sizes[index];return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#dfd9cb"/><path d="M0 0H${w}V${h}H0Z" fill="none" stroke="#147e88" stroke-width="40"/><path d="M0 0 ${w} ${h}M${w} 0 0 ${h}" stroke="#af9d88" stroke-width="10"/><text x="${w/2}" y="${h/2}" text-anchor="middle" font-size="70">${w} × ${h}</text></svg>`;}
test.beforeEach(async({page,context})=>{
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
    if(u.pathname.startsWith('/wide-photo-'))return route.fulfill({contentType:'image/svg+xml',body:svg(Number(u.pathname.match(/wide-photo-(\d)/)[1]))});
    if(u.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action'))){
      const response=await route.fetch(),data=await response.json();
      for(const o of data.groups?Object.values(data.groups).flat():data.originals||[])Object.assign(o,{images:sizes.map((_,i)=>'/wide-photo-'+i+'.svg'),photoCount:3});
      return route.fulfill({response,json:data});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
for(const market of ['lease','building_sale','land_sale'])test(market+' wide detail preserves complete large photos, icons, source and actions',async({page,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  if(!isMobile)await page.setViewportSize({width:1794,height:1000});
  await mode(page,isMobile,market);const first=page.locator('#list .item').first(),id=await first.getAttribute('data-property-id');
  await first.locator('.item-building-name').click();const d=page.locator('#unifiedDetailDrawerV8'),g=d.locator('.unified-detail-gallery-v8'),image=g.locator('img');
  await expect(d).toHaveAttribute('data-wide-layout-v26',isMobile?'stack':'wide');
  await expect(d).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  await expect(d.locator('.wide-detail-layout-v26')).toHaveCount(1);await expect(d.locator('.unified-detail-gallery-v8')).toHaveCount(1);
  for(let i=0;i<3;i++){
    await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth)).toBe(sizes[i][0]);
    await expect(g.locator('.photo-transition-ghost-v1')).toHaveCount(0);
    const metrics=await image.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),d=e.closest('#unifiedDetailDrawerV8'),v=d.getBoundingClientRect();return {w:r.width,h:r.height,nw:e.naturalWidth,nh:e.naturalHeight,fit:s.objectFit,overflow:d.scrollWidth>d.clientWidth+1,left:v.left,right:v.right,viewport:innerWidth};});
    expect(metrics.h).toBeCloseTo(metrics.w*metrics.nh/metrics.nw,1);expect(metrics.fit).toBe('contain');
    expect(metrics.w).toBeGreaterThan(isMobile?300:500);expect(metrics.overflow).toBe(false);expect(metrics.left).toBeGreaterThanOrEqual(-1);expect(metrics.right).toBeLessThanOrEqual(metrics.viewport+1);
    if(i===1){await d.locator('#unifiedDetailBodyV8').evaluate(el=>el.scrollTop=0);await page.screenshot({path:info.outputPath(market+'-landscape-wide.png'),animations:'disabled'});}
    if(i<2)await g.locator('.next').click();
  }
  await d.locator('#unifiedDetailBodyV8').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:info.outputPath(market+'-wide.png'),animations:'disabled'});
  const actions=d.locator('.unified-detail-utility-actions-v8');
  await expect(actions.locator('[data-wide-action-v26="navigation"] svg')).toHaveCount(1);await expect(actions.locator('[data-wide-action-v26="roadview"] svg')).toHaveCount(1);
  if(!isMobile){
    await expect(d.locator(':scope > .unified-detail-utility-actions-v8')).toBeVisible();
    await expect(actions.locator('svg')).toHaveCount(4);await expect(actions).toContainText('대장');
    for(const [key,handler] of [['navigation','openKakaoNavigation'],['roadview','openKakaoRoadview'],['register','openBuildingRegisterV640'],['edit','openPropertyEditModalV630']]){
      await page.evaluate(handler=>{window[handler]=key=>window.__wideActionResult=key;},handler);
      await actions.locator('[data-wide-action-v26="'+key+'"]').click();expect(await page.evaluate(()=>window.__wideActionResult)).toBeTruthy();
    }
    const management=d.locator('.wide-detail-management-v26');await expect(management).toHaveCount(1);await expect(management).not.toHaveAttribute('open','');await management.locator('summary').click();await expect(management.locator('.whole-master')).toBeVisible();
    for(const width of [1280,820,700]){await page.setViewportSize({width,height:900});expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}
  }else{
    await page.setViewportSize({width:320,height:844});expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(d.locator('.phone-detail-actions-v2')).toBeVisible();
  }
  expect(await page.evaluate(id=>JSUnifiedListingsV8.isOpenForProperty(id),id)).toBe(true);expect(errors).toEqual([]);expect(writes).toBe(0);
});
test('reduced motion removes card movement, and re-opening never duplicates its fixed action bar',async({page,isMobile})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await mode(page,isMobile,'lease');
  for(const id of ['FIXTURE-LEASE-1','FIXTURE-LEASE-2','FIXTURE-LEASE-1']){
    await page.evaluate(id=>JSUnifiedListingsV8.open(id),id);
    const d=page.locator('#unifiedDetailDrawerV8');await expect(d).toHaveAttribute('aria-hidden','false');
    await expect(d.locator('.unified-detail-utility-actions-v8')).toHaveCount(1);await expect(d.locator('.wide-detail-layout-v26')).toHaveCount(1);
    await expect(d).toHaveCSS('transition-duration','0s');
    await page.evaluate(()=>JSUnifiedListingsV8.closeForOverlay());
  }
});
test('favorite folder keeps its embedded detail within the host and returns cleanly to the map',async({page,isMobile},info)=>{
  test.skip(isMobile,'Phone favorite details already use the full-screen presentation.');
  await page.evaluate(()=>openUnifiedFavoritesV7({source:'browse'}));await expect(page.locator('#unifiedFavoriteModalV7')).toHaveAttribute('aria-hidden','false');
  await page.evaluate(()=>openUnifiedFavoriteItemV7(encodeURIComponent('property:FIXTURE-LEASE-1')));
  const host=page.locator('#unifiedFavoriteDetailHostV7'),d=host.locator('#unifiedDetailDrawerV8');
  await expect(d).toHaveAttribute('data-wide-layout-v26','stack');
  expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('favorite-embedded-wide.png'),animations:'disabled'});
  await page.evaluate(()=>closeUnifiedFavoritesV7());await expect(page.locator('body > #unifiedDetailDrawerV8')).toHaveAttribute('aria-hidden','true');
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-2'));await expect(page.locator('body > #unifiedDetailDrawerV8')).toHaveAttribute('aria-hidden','false');
});
