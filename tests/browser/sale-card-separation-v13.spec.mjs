import {test,expect} from '@playwright/test';
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#bdd3e1"/><path fill="#44657c" d="M45 145V50h145v95z"/><path fill="#e2eef5" d="M60 65h25v25H60zm45 0h25v25h-25zm45 0h25v25h-25zM60 105h25v25H60zm45 0h25v25h-25zm45 0h25v25h-25z"/></svg>');
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function seed(page,market,count=9){await page.evaluate(({market,photo,count})=>{
  const base=allItems.find(i=>i.propertyId===(market==='land_sale'?'FIXTURE-LAND':'FIXTURE-BUILDING'));
  const items=Array.from({length:count},(_,i)=>({...base,key:'separation-'+i,propertyId:'SEPARATION-'+i,name:i%3===0?'대전 갈마동 업무용 건물과 주거시설이 함께 있는 긴 이름 매물 '+i:'갈마동 매매 후보 '+i,address:'대전 서구 갈마동 '+(i+1)+'-49',salePrice:70000+i*100,
    saleDetails:i%3===1?{}:{...base.saleDetails,monthlyIncome:i%2?0:200,zoning:'제2종일반주거지역',roadAccess:'8m 한면'}}));
  allItems=allItems.filter(i=>i.tradeType!=='sale').concat(items);window.__separationGroups=Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-O',buildingName:i.name,images:i.propertyId.startsWith('SEPARATION')&&Number(i.key.split('-').at(-1))%3!==1?[photo]:[],photoCount:i.propertyId.startsWith('SEPARATION')&&Number(i.key.split('-').at(-1))%3!==1?1:0}]]));
  __separationGroups['SEPARATION-3'][0].images=[location.origin+'/__fixture/missing-photo-v13.jpg'];
  JSUnifiedListingsV8.attach(allItems,{ok:true,groups:__separationGroups});document.getElementById('fixtureControls').hidden=true;
},{market,photo,count});
  await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='unifiedListingDetail')return route.continue();return route.fulfill({json:{ok:true,originals:await page.evaluate(id=>__separationGroups[id]||[],u.searchParams.get('propertyId'))}});});
}
async function mode(page,isMobile,market){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function inspect(page){return page.locator('#list .listing-sale-card-v1').evaluateAll(cards=>cards.slice(0,6).map(card=>{
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height};},thumb=card.querySelector('.unified-thumb-v8'),main=card.querySelector('.standard-card-main-v661'),style=thumb&&getComputedStyle(thumb);
  return {id:card.dataset.propertyId,card:rect(card),main:rect(main),photo:style?.display!=='none'&&!thumb?.classList.contains('no-photo'),thumb:thumb?rect(thumb):null,title:rect(card.querySelector('.item-building-name')),address:rect(card.querySelector('.item-address-text')),price:rect(card.querySelector('.listing-sale-price-v1')),overflow:card.scrollWidth-card.clientWidth,minWidth:style?.minWidth};
}));}
for(const market of ['building_sale','land_sale'])test(market+' photo and text keep separate columns in detail, compact and narrow layouts',async({page,isMobile},info)=>{
  await seed(page,market);await mode(page,isMobile,market);const before=await page.evaluate(()=>JSON.stringify(allItems));
  for(const layout of isMobile?['detail']:['detail','compact']){
    if(!isMobile){await page.setViewportSize({width:1794,height:866});await page.locator('[data-sale-layout="'+layout+'"]').click();}
    for(const width of isMobile?[390,320,1280]:[1794,1280,800,700]){
      await page.setViewportSize({width,height:isMobile?844:866});await page.evaluate(()=>JSMapListPanelV1.open());
      const cards=await inspect(page);expect(cards.length).toBeGreaterThan(2);
      if(width===1794)await page.screenshot({path:info.outputPath(market+'-'+layout+'-layout.png'),animations:'disabled'});
      for(const c of cards){expect(c.overflow,JSON.stringify(c)).toBeLessThanOrEqual(1);expect(c.main.right,JSON.stringify(c)).toBeLessThanOrEqual(c.card.right+1);
        if(c.photo){expect(c.main.x-c.thumb.right,JSON.stringify(c)).toBeGreaterThanOrEqual(7);for(const r of [c.title,c.address,c.price])expect(r.x,JSON.stringify(c)).toBeGreaterThanOrEqual(c.thumb.right+6);}
        else if(layout==='compact'&&width>=769&&!isMobile)expect(c.main.x-c.card.x,JSON.stringify(c)).toBeLessThan(25);
      }
      const separation=await page.locator('#list').evaluate(list=>{const cards=[...list.querySelectorAll('.listing-sale-card-v1')],first=cards[0],second=cards[1];return {gap:second.getBoundingClientRect().top-first.getBoundingClientRect().bottom,background:getComputedStyle(list).backgroundColor,card:getComputedStyle(first).backgroundColor,border:getComputedStyle(first).borderTopColor};});
      expect(separation.gap).toBeGreaterThanOrEqual(11);expect(separation.background).not.toBe(separation.card);expect(separation.border).not.toBe('rgba(0, 0, 0, 0)');
    }
  }
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
});
test('sale card separation preserves selection, photos and lease appearance',async({page,isMobile})=>{
  await seed(page,'building_sale');await page.evaluate(()=>applyFilter());
  const lease=await page.locator('#list .item').first().evaluate(el=>({html:el.innerHTML,background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderColor,margin:getComputedStyle(el).marginBottom}));
  await mode(page,isMobile,'building_sale');
  const first=page.locator('#list [data-property-id="SEPARATION-0"]');
  const source=first.locator('.item-source-link-btn');await source.evaluate(el=>el.classList.add('transaction-check-button-v8135'));if(!isMobile)expect(await first.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('linear-gradient');await source.evaluate(el=>el.classList.remove('transaction-check-button-v8135'));
  await first.locator('.action-select-check').check();await expect(first.locator('.action-select-check')).toBeChecked();
  const contact=await first.locator('.item-contact-button-v654').first().evaluate(el=>[getComputedStyle(el).color,getComputedStyle(el).backgroundColor]);
  if(!isMobile){await page.locator('[data-sale-layout="compact"]').click();await expect(first.locator('.action-select-check')).toBeChecked();expect(await first.locator('.item-contact-button-v654').first().evaluate(el=>[getComputedStyle(el).color,getComputedStyle(el).backgroundColor])).toEqual(contact);}
  await first.locator('.unified-thumb-v8').click();const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer).toHaveAttribute('aria-hidden','false');await expect(drawer.locator('.unified-detail-hero-v8 img')).toBeVisible();
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();await expect(first).toHaveClass(/selected/);const selected=await first.evaluate(el=>getComputedStyle(el).backgroundColor);await expect(first.locator('.action-select-check')).toBeChecked();
  await first.locator('.item-building-name').hover();expect(await first.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(selected);
  await mode(page,isMobile,'lease');expect(await page.locator('#list .item').first().evaluate(el=>({html:el.innerHTML,background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderColor,margin:getComputedStyle(el).marginBottom}))).toEqual(lease);
});
