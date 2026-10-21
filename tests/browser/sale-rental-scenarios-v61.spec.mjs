import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../../cloudflare/src/d1-api.js';
const cases=[
  ['JUNGRI','매매가:8억 *월수익: 보3000/월760만 (만실기준임) *구조:1층 주차장\n2층 원룸8개\n3층 원룸8개\n4층 원룸8개\n5층 원룸8개'],
  ['HONGDO','1층 상가2개 보증금2천/월세80만\n2층 2룸2가구 보증금4500/월세30만\n3층 3룸1개 보증금6500']
].map(([id,text])=>({id,full:withSaleFinancialDisplay({source:'당근',tradeType:'sale',saleCategory:'building',salePrice:80000,saleDetails:{scope:'whole_building',descriptionText:text}})}));
test('full occupancy and floor conditions remain visible on list and detail without silently becoming current income',async({page,context,isMobile},info)=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const originals=await page.evaluate(cases=>{
    const seed=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING'),groups={},full={};
    allItems=cases.map(({id,original,summary},index)=>{
      const master={...seed,propertyId:id,key:id,name:id,address:index?'대전 동구 홍도동 136-38':'대전 대덕구 중리동 232-4',source:'당근',salePrice:80000,saleDetails:null};
      full[id]={...master,...original,propertyId:id,originalId:id+'-O',providerSourceId:id,saleSummary:summary,images:[],photoCount:0};
      const compact={...full[id]};delete compact.saleDetails;groups[id]=[compact];return master;
    });
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups});document.getElementById('fixtureControls').hidden=true;return full;
  },cases.map(c=>({id:c.id,original:c.full,summary:compactSaleSummary(c.full)})));
  await page.route('**/api/data?*',r=>{const u=new URL(r.request().url());return u.searchParams.get('action')==='unifiedListingDetail'?r.fulfill({json:{ok:true,originals:[originals[u.searchParams.get('propertyId')]]}}):r.fallback();});
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  const before=await page.evaluate(()=>JSON.stringify(allItems.map(i=>[i.salePrice,i.saleDetails,i.memo,i.state])));
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const card=id=>page.locator('#list [data-property-id="'+id+'"]');
  for(const v of ['만실 기준 보증금','3,000만원','만실 기준 월 임대수입','760만원','현재 임대수입·수익률 계산에 미반영'])await expect(card('JUNGRI')).toContainText(v);
  for(const v of ['층별 임대조건','6,500만원','미기재','13,000만원','110만원','일부 월세 미기재'])await expect(card('HONGDO')).toContainText(v);
  for(const id of ['JUNGRI','HONGDO'])await expect(card(id)).not.toContainText('단순 연 수익률');
  for(const width of isMobile?[320,390]:[1794,1280,800]){
    await page.setViewportSize({width,height:866});for(const id of ['JUNGRI','HONGDO'])expect(await card(id).evaluate(c=>c.scrollWidth<=c.clientWidth+1)).toBe(true);
  }
  if(!isMobile)await page.setViewportSize({width:1794,height:866});
  for(const id of ['JUNGRI','HONGDO']){
    await page.evaluate(id=>JSUnifiedListingsV8.open(id),id);
    const detail=page.locator('#unifiedDetailBodyV8');
    if(id==='JUNGRI')for(const v of ['만실 기준 월 임대수입','760만원','현재 임대 합계가 확인되지 않았습니다'])await expect(detail).toContainText(v);
    else {
      await expect(detail.locator('.sale-rental-breakdown-v61')).toContainText('6,500만원');await expect(detail.locator('.sale-rental-breakdown-v61')).toContainText('미기재');
      await detail.locator('.sale-rental-breakdown-v61').scrollIntoViewIfNeeded();
      await expect(detail.locator('.sale-rental-breakdown-v61 tbody tr').last()).toBeInViewport();
    }
    expect(await page.evaluate(id=>JSListingTradeV1.saleYield(currentItems.find(i=>i.propertyId===id)),id)).toBe(null);
    await page.screenshot({path:info.outputPath(id.toLowerCase()+'-rental-context.png'),animations:'disabled'});
    await page.evaluate(()=>JSUnifiedListingsV8.close());
  }
  expect(await page.evaluate(()=>JSON.stringify(allItems.map(i=>[i.salePrice,i.saleDetails,i.memo,i.state])))).toBe(before);expect(writes).toBe(0);
});
