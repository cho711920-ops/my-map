import {test,expect} from '@playwright/test';
import {compactSaleSummary} from '../../cloudflare/src/d1-api.js';
const details={scope:'land',landAreaM2:330.5785,landUse:'답',zoning:'자연녹지지역',roadAccess:'진입도로 있음',currentUse:'농지',parcelShape:'장방형',recommendedUse:'주말농장'};
test.beforeEach(async({page,context})=>{
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
    if(u.pathname==='/api/data'&&['unifiedListings','unifiedListingDetail'].includes(u.searchParams.get('action'))){
      const r=await route.fetch(),data=await r.json();for(const o of data.groups?Object.values(data.groups).flat():data.originals||[])if(o.saleCategory==='land'){o.saleDetails=details;o.saleSummary=compactSaleSummary(o);}return route.fulfill({response:r,json:data});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(d=>{const i=allItems.find(i=>i.saleCategory==='land');i.saleDetails=null;for(const o of i.unifiedOriginalsV8||[])o.saleSummary=d;},details);
});
async function land(page,isMobile){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('land_sale');if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
function savedFacts(page){return page.evaluate(()=>JSON.stringify(allItems.map(i=>({key:i.key,propertyId:i.propertyId,address:i.address,salePrice:i.salePrice,area:i.area,tradeType:i.tradeType,saleCategory:i.saleCategory,memo:i.memo}))));}
test('land facts are immediate, source-local and do not introduce lookups or change lease cards',async({page,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let writes=0,publicCalls=0;page.on('request',r=>{if(r.method()==='POST')writes++;if(/action=saleParcel/.test(r.url()))publicCalls++;});
  const before=await savedFacts(page),lease=await page.locator('#list').innerText(),viewport=page.viewportSize();
  await land(page,isMobile);const card=page.locator('#list .item'),facts=card.locator('[data-land-facts-v93]');
  await expect(card.locator('.land-use-badge-v1')).toHaveText('지목: 답');
  for(const text of ['용도지역','자연녹지지역','도로접면','진입도로 있음','현재 이용','농지'])await expect(facts).toContainText(text);
  await card.locator('.item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8'),basics=drawer.locator('[data-land-basics-v93]');
  await expect(basics).toBeVisible();for(const text of ['토지 기본정보','100','300','답','자연녹지지역','장방형','주말농장'])await expect(basics).toContainText(text);
  for(const width of isMobile?[390,320,375]:[1280,820]){await page.setViewportSize({width,height:900});expect(await basics.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    expect(await drawer.evaluate(e=>e.dataset.wideLayoutV26!=='stack'||e.querySelector('.wide-detail-primary-v26').getBoundingClientRect().top<e.querySelector('.wide-detail-media-v26').getBoundingClientRect().top)).toBe(true);}
  await drawer.screenshot({path:info.outputPath('land-facts-detail.png'),animations:'disabled'});
  expect(publicCalls).toBe(0);expect(writes).toBe(0);expect(errors).toEqual([]);expect(await savedFacts(page)).toBe(before);
  await page.setViewportSize(viewport);
  await page.evaluate(()=>JSUnifiedListingsV8.close());await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('lease');if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await expect(page.locator('#list [data-land-facts-v93]')).toHaveCount(0);expect(await page.locator('#list').innerText()).toBe(lease);
});
test('public facts stay separate and clear after lookup failure or another parcel',async({page,isMobile})=>{
  await page.evaluate(()=>{window.__landPhase='normal';window.JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3020010700100040004',links:{}});});
  await page.route('**/api/data?**',route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleParcelFacts')return route.fallback();return page.evaluate(()=>__landPhase).then(phase=>route.fulfill({status:phase==='fail'?503:200,json:phase==='fail'?{ok:false,message:'조회 실패'}:{ok:true,pnu:'3020010700100040004',address:'대전 유성구 장대동 4-4',landUse:'전',areaM2:400,price:{available:true,wonPerM2:100000,baseYear:2026,baseMonth:1},regulations:[],complete:true,source:'토지이음',fetchedAt:'2026-10-27T05:00:00Z'}}));});
  await land(page,isMobile);await page.locator('#list .item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8'),basics=drawer.locator('[data-land-basics-v93]'),before=await page.evaluate(()=>JSON.stringify(allItems));
  await basics.locator('[data-land-lookup-v93]').click();await expect(basics.locator('.sale-land-official-v93')).toContainText('100,000원/㎡');await expect(basics).toContainText('400');await expect(basics.locator('[data-land-facts-v93]')).toContainText('답');
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await page.evaluate(()=>{__landPhase='fail';const now=Date.now;Date.now=()=>now()+7*3600000;});await basics.locator('[data-land-lookup-v93]').click();await expect(drawer.locator('[data-sale-section="publicland"] [data-public-status]')).toContainText('조회 실패');await expect(basics.locator('.sale-land-official-v93')).toHaveCount(0);
  await drawer.getByLabel('공적자료 조회용 지번',{exact:true}).fill('유성구 장대동 4-5');await drawer.locator('.sale-public-query-v6 button').click();await expect(basics.locator('.sale-land-official-v93')).toHaveCount(0);
});
