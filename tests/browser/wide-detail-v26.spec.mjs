import {test,expect} from '@playwright/test';
const sizes=[[900,1500],[1600,900],[2000,600],[1200,900]];
function svg(index){const [w,h]=sizes[index];return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#dfd9cb"/><path d="M0 0H${w}V${h}H0Z" fill="none" stroke="#147e88" stroke-width="40"/><path d="M0 0 ${w} ${h}M${w} 0 0 ${h}" stroke="#af9d88" stroke-width="10"/><text x="${w/2}" y="${h/2}" text-anchor="middle" font-size="70">${w} × ${h}</text></svg>`;}
test.beforeEach(async({page,context})=>{
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
    if(u.pathname.startsWith('/wide-photo-'))return route.fulfill({contentType:'image/svg+xml',body:svg(Number(u.pathname.match(/wide-photo-(\d)/)[1]))});
    if(u.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action'))){
      const response=await route.fetch(),data=await response.json();
      for(const o of data.groups?Object.values(data.groups).flat():data.originals||[])Object.assign(o,{images:sizes.map((_,i)=>'/wide-photo-'+i+'.svg'),photoCount:sizes.length});
      return route.fulfill({response,json:data});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
for(const market of ['lease','building_sale','land_sale'])test(market+' wide detail keeps a uniform uncropped photo frame, icons, source and actions',async({page,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  if(!isMobile)await page.setViewportSize({width:1794,height:1000});
  await mode(page,isMobile,market);const first=page.locator('#list .item').first(),id=await first.getAttribute('data-property-id');
  await first.locator('.item-building-name').click();const d=page.locator('#unifiedDetailDrawerV8'),g=d.locator('.unified-detail-gallery-v8'),image=g.locator('img');
  await expect(d).toHaveAttribute('data-wide-layout-v26',isMobile?'stack':'wide');
  await expect(d).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  await expect(d.locator('.wide-detail-layout-v26')).toHaveCount(1);await expect(d.locator('.unified-detail-gallery-v8')).toHaveCount(1);
  const header=d.locator(':scope > header');
  await expect(header).toHaveCSS('background-color','rgb(25, 59, 87)');
  expect((await header.boundingBox()).height).toBeLessThanOrEqual(60);
  await expect(header.locator('#unifiedDetailTitleV8')).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(header.locator('.wide-detail-address-v35')).not.toHaveText('');
  await expect(d.locator('.wide-detail-original-count-v35')).toContainText('원본');
  if(market!=='lease'){
    await expect(header.locator('.sale-fixed-summary-v9')).toHaveCount(0);
    const units=d.locator('.wide-detail-primary-v26 [data-sale-unit="m2"]');
    await units.click();await expect(units).toHaveAttribute('aria-pressed','true');
    await d.locator('.wide-detail-primary-v26 [data-sale-unit="py"]').click();
  }
  let frame;
  for(let i=0;i<sizes.length;i++){
    await expect.poll(()=>image.evaluate(e=>e.complete&&e.naturalWidth)).toBe(sizes[i][0]);
    await expect(g.locator('.photo-transition-ghost-v1')).toHaveCount(0);
    const metrics=await image.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),d=e.closest('#unifiedDetailDrawerV8'),v=d.getBoundingClientRect();return {w:r.width,h:r.height,nw:e.naturalWidth,nh:e.naturalHeight,fit:s.objectFit,overflow:d.scrollWidth>d.clientWidth+1,left:v.left,right:v.right,viewport:innerWidth};});
    expect(metrics.h).toBeCloseTo(metrics.w*3/4,1);expect(metrics.fit).toBe('contain');
    const bounds=await g.boundingBox();
    if(!frame)frame=bounds;
    expect(bounds.width).toBeCloseTo(frame.width,1);expect(bounds.height).toBeCloseTo(frame.height,1);
    expect(bounds.y).toBeCloseTo(frame.y,1);
    expect(metrics.w).toBeGreaterThan(isMobile?300:500);expect(metrics.overflow).toBe(false);expect(metrics.left).toBeGreaterThanOrEqual(-1);expect(metrics.right).toBeLessThanOrEqual(metrics.viewport+1);
    if(i===0)await page.screenshot({path:info.outputPath(market+'-portrait-uniform.png'),animations:'disabled'});
    if(i===1){await d.locator('#unifiedDetailBodyV8').evaluate(el=>el.scrollTop=0);await page.screenshot({path:info.outputPath(market+'-landscape-wide.png'),animations:'disabled'});}
    if(i<sizes.length-1)await g.locator('.next').click();
  }
  if(!isMobile){
    // Portrait phone uses its existing in-detail gallery rather than a modal.
    await g.locator('.unified-detail-hero-v8').click();
    const expanded=page.locator('#unifiedGalleryV8');
    await expect(expanded).toHaveClass(/open/);
    await expect(expanded.locator('img')).toHaveAttribute('src','/wide-photo-3.svg');
    await expanded.locator('.close').click();
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
for(const market of ['lease','building_sale','land_sale'])test(market+' opens each detail from the top instead of inheriting the previous reading position',async({page,isMobile})=>{
  await mode(page,isMobile,market);
  const first=page.locator('#list .item').first(),id=await first.getAttribute('data-property-id');
  await page.evaluate(id=>JSUnifiedListingsV8.open(id),id);
  const drawer=page.locator('#unifiedDetailDrawerV8'),body=drawer.locator('#unifiedDetailBodyV8');
  await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(0);
  for(const closeFirst of [true,false]){
    await body.evaluate(el=>{el.scrollTop=Math.min(350,el.scrollHeight-el.clientHeight);});
    expect(await body.evaluate(el=>el.scrollTop)).toBeGreaterThan(80);
    if(closeFirst)await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
    const listTop=await page.locator(isMobile?'#list':'#sidebar').evaluate(el=>el.scrollTop);
    await page.evaluate(id=>JSUnifiedListingsV8.open(id),id);
    await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(0);
    expect(await page.locator(isMobile?'#list':'#sidebar').evaluate(el=>el.scrollTop)).toBe(listTop);
  }
});

test('late detail enrichment preserves a reader who has scrolled after the new opening',async({page,isMobile})=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{started=resolve;});
  await page.route('**/api/data**',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('action')!=='unifiedListingDetail')return route.fallback();
    const response=await route.fetch(),data=await response.json();
    for(const original of data.originals||[])Object.assign(original,{buildingName:'지연 응답 확인',images:sizes.map((_,i)=>'/wide-photo-'+i+'.svg'),photoCount:sizes.length});
    started();await gate;await route.fulfill({response,json:data});
  });
  try{
    await mode(page,isMobile,'building_sale');
    await page.locator('#list .item-building-name').first().click();
    await pending;
    const body=page.locator('#unifiedDetailBodyV8');
    await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(0);
    await body.evaluate(el=>{el.scrollTop=300;});
    const top=await body.evaluate(el=>el.scrollTop);expect(top).toBeGreaterThan(200);
    release();
    await expect(page.locator('#unifiedDetailTitleV8')).toHaveText('지연 응답 확인');
    await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(top);
  }finally{release();}
});

for(const market of ['building_sale','land_sale'])test(market+' section menu stays above scrolling content without a clipped or floating strip',async({page,isMobile},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  if(!isMobile)await page.setViewportSize({width:1794,height:865});
  await mode(page,isMobile,market);
  await page.locator('#list .item-building-name').first().click();
  const drawer=page.locator('#unifiedDetailDrawerV8'),body=drawer.locator('#unifiedDetailBodyV8'),nav=drawer.locator('.sale-dossier-nav-v3');
  const initial=await nav.boundingBox();
  for(const offset of [0,100,400,900]){
    await body.evaluate((el,top)=>{el.scrollTop=top;},offset);
    const menu=await nav.boundingBox(),content=await body.boundingBox();
    expect(menu.height).toBeGreaterThanOrEqual(44);
    expect(menu.y).toBeCloseTo(initial.y,1);
    expect(menu.y+menu.height).toBeLessThanOrEqual(content.y+1);
    await expect(nav.getByRole('button').first()).toBeInViewport({ratio:1});
  }
  const publicTab=nav.getByRole('button',{name:'공적자료',exact:true});
  await publicTab.click();
  await expect(publicTab).toHaveAttribute('aria-current','location');
  await nav.getByRole('button',{name:'요약',exact:true}).click();
  await expect.poll(()=>body.evaluate(el=>Math.abs(el.querySelector('[data-sale-section="summary"]').getBoundingClientRect().top-el.getBoundingClientRect().top-10))).toBeLessThanOrEqual(2);
  await page.screenshot({path:info.outputPath(market+'-fixed-section-menu.png'),animations:'disabled'});
  // Switching ads/markets must not accumulate fixed menus.
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIXTURE-LEASE-1'));
  await expect(drawer.locator('.sale-dossier-nav-v3')).toHaveCount(0);
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

test('long title and address keep the compact close control visible without horizontal overflow',async({page,isMobile},info)=>{
  await mode(page,isMobile,'building_sale');
  await page.locator('#list .item-building-name').first().click();
  const drawer=page.locator('#unifiedDetailDrawerV8');
  await page.evaluate(()=>{
    const title=document.getElementById('unifiedDetailTitleV8'),address=document.querySelector('.wide-detail-address-v35');
    title.textContent='긴 건물 이름과 여러 필지로 구성된 상가주택 매매 '.repeat(4);
    address.textContent='대전광역시 유성구 봉명동 559-30 외 여러 필지 지하1층 및 지상 전체 '.repeat(4);
  });
  for(const width of isMobile?[390,320]:[1794,1280,820]){
    await page.setViewportSize({width,height:900});
    const header=drawer.locator(':scope > header');
    expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(header.getByRole('button',{name:'상세매물보기 닫기',exact:true})).toBeInViewport({ratio:1});
    expect((await header.boundingBox()).height).toBeLessThanOrEqual(60);
    expect(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  }
  await page.screenshot({path:info.outputPath('compact-long-header.png'),animations:'disabled'});
});
