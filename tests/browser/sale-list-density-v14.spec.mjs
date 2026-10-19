import {test,expect} from '@playwright/test';
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="160"><rect width="180" height="160" fill="#c7d7df"/><path fill="#6f8b97" d="M20 20h140v140H20z"/></svg>');
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function seed(page,market,rich=false){await page.evaluate(({market,rich,photo})=>{
  const base=allItems.find(i=>i.propertyId===(market==='land_sale'?'FIXTURE-LAND':'FIXTURE-BUILDING'));
  const items=Array.from({length:180},(_,i)=>({...base,key:'density14-'+i,propertyId:'DENSITY14-'+i,source:'당근',regDate:'2026-09-30T11:04:00Z',name:i===4?'길이가 긴 건물 이름과 원본 광고의 매물명까지 확인하는 검수용 매매':'괴정 매매 '+i,address:'서구 괴정동 '+(126+i)+'-17',saleCategory:market==='land_sale'?'land':'one_room',
    saleDetails:market==='land_sale'?{...base.saleDetails,roadAccess:rich?'8m 한면':'',parcelShape:rich?'부정형':'',zoning:rich?'제2종일반주거지역':'일반주거지역'}:rich?{...base.saleDetails,exclusiveAreaM2:80,buildingAreaM2:100,buildingUse:'근린생활시설'}:{scope:'unit',exclusiveAreaM2:19.9}}));
  allItems=allItems.filter(i=>i.tradeType!=='sale').concat(items);JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-O',buildingName:i.name,images:[photo],photoCount:1}]]))});document.getElementById('fixtureControls').hidden=true;
},{market,rich,photo});}
async function mode(page,isMobile,market){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
for(const market of ['building_sale','land_sale'])test(market+' shows more cards without collection dates or lost facts',async({page,isMobile},info)=>{
  if(!isMobile)await page.setViewportSize({width:1794,height:866});
  await seed(page,market);await mode(page,isMobile,market);
  const original=await page.evaluate(()=>JSON.stringify(allItems));
  const card=page.locator('#list .listing-sale-card-v1').first();
  await expect(card).not.toContainText('2026.09.30');await expect(card).not.toContainText('KST');
  await expect(card).toContainText('당근');await expect(card).toContainText('평');
  const geometry=await page.evaluate(()=>{const scroll=getListingScrollContainerV2(),bounds=scroll.getBoundingClientRect(),cards=[...document.querySelectorAll('#list .listing-sale-card-v1')];return {height:cards[0].getBoundingClientRect().height,visible:cards.filter(c=>{const r=c.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=Math.min(bounds.bottom,innerHeight);}).length};});
  if(!isMobile&&market==='building_sale'){expect(geometry.height).toBeLessThan(175);expect(geometry.visible).toBeGreaterThanOrEqual(4);}
  console.log(JSON.stringify({market,isMobile,...geometry}));
  await page.screenshot({path:info.outputPath(market+'-dense.png'),animations:'disabled'});
  for(const width of isMobile?[320,390]:[1280,800,700]){
    await page.setViewportSize({width,height:866});
    expect(await card.evaluate(c=>c.scrollWidth<=c.clientWidth+1)).toBe(true);
    const overlap=await card.evaluate(c=>{const p=c.querySelector('.unified-thumb-v8').getBoundingClientRect(),n=c.querySelector('.item-building-name').getBoundingClientRect();return n.left-p.right;});expect(overlap).toBeGreaterThanOrEqual(6);
  }
  if(!isMobile)await page.setViewportSize({width:1794,height:866});
  await card.locator('.action-select-check').check();await expect(card.locator('.action-select-check')).toBeChecked();
  const phoneBefore=await card.locator('.item-contact-button-v654').first().evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor]);
  await page.evaluate(()=>{const s=getListingScrollContainerV2();s.scrollTop=5000;s.dispatchEvent(new Event('scroll'));});
  await expect.poll(()=>page.locator('#list .item').first().getAttribute('data-list-index-v1')).not.toBe('0');
  await page.evaluate(()=>{const s=getListingScrollContainerV2();s.scrollTop=0;s.dispatchEvent(new Event('scroll'));});
  await expect(card.locator('.action-select-check')).toBeChecked();expect(await card.locator('.item-contact-button-v654').first().evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor])).toEqual(phoneBefore);
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(original);
});

test('rich sale cards retain metrics and lease cards retain original dates and markup',async({page,isMobile})=>{
  await seed(page,'building_sale',true);await page.evaluate(()=>applyFilter());const lease=await page.locator('#list .item').first().innerHTML();await mode(page,isMobile,'building_sale');
  const card=page.locator('#list .listing-sale-card-v1').first();await expect(card).toContainText('월 임대수입');await expect(card).toContainText('연면적');
  if(!isMobile){await page.locator('[data-sale-layout="card"]').click();await expect(card.locator('.sale-list-metrics-v16')).toBeVisible();await page.locator('[data-sale-layout="table"]').click();await expect(page.locator('html')).toHaveAttribute('data-sale-table-v10','building');}
  await mode(page,isMobile,'lease');expect(await page.locator('#list .item').first().innerHTML()).toBe(lease);
});
