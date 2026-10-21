import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../../cloudflare/src/d1-api.js';
const scenarios=[
  ['OJEONG','현세입자 보3천/월250만 - 승계가능 /매수자 입주가능'],
  ['PARTIAL','1층 상가 보3천/월250만'],
  ['PRICE','매매가9억원\n보3천/월250만'],
  ['DEPOSIT','보증금:3000만원'],
  ['INCOME','월세:250만원'],
  ['NET','월수익(이자제외):150만원'],
  ['EMPTY','창고 사용 가능']
].map(([id,text])=>({id,full:withSaleFinancialDisplay({source:'당근',tradeType:'sale',saleCategory:'factory_warehouse',salePrice:89000,saleDetails:{scope:'whole_building',descriptionText:text}})}));

test('all known rental conditions render on sale list cards and reference-only figures never become a yield',async({page,context,isMobile},info)=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const payload=scenarios.map(x=>({...x,summary:compactSaleSummary(x.full)}));
  const originals=await page.evaluate(payload=>{
    const seed=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING'),groups={},originals={};
    allItems=payload.map(({id,full,summary},i)=>{
      var row={...seed,...full,propertyId:id,key:id,name:id,address:i?'대전 대덕구 오정동 '+(331+i):'대전 대덕구 오정동 330-22',saleDetails:{scope:'whole_building'}};
      originals[id]={...row,...full,propertyId:id,originalId:id+'-O',providerSourceId:id,images:[],photoCount:0,saleSummary:summary};
      var compact={...originals[id]};delete compact.saleDetails;groups[id]=[compact];return row;
    });
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups});document.getElementById('fixtureControls').hidden=true;return originals;
  },payload);
  await page.route('**/api/data?*',r=>{var u=new URL(r.request().url());return u.searchParams.get('action')==='unifiedListingDetail'?r.fulfill({json:{ok:true,originals:[originals[u.searchParams.get('propertyId')]]}}):r.fallback();});
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  const before=await page.evaluate(()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.salePrice,i.saleDetails,i.memo,i.state])));
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const card=id=>page.locator('#list [data-property-id="'+id+'"]');
  for(const value of ['보증금 합계','3,000만원','월 임대수입','250만원','3.49%'])await expect(card('OJEONG')).toContainText(value);
  for(const id of ['PARTIAL','PRICE']){
    for(const value of ['원문 보증금 · 확인 필요','3,000만원','원문 월세 · 확인 필요','250만원'])await expect(card(id)).toContainText(value);
    await expect(card(id)).not.toContainText('단순 연 수익률');
  }
  await expect(card('DEPOSIT')).toContainText('3,000만원');await expect(card('DEPOSIT')).not.toContainText('월 임대수입');
  await expect(card('INCOME')).toContainText('250만원');await expect(card('INCOME')).not.toContainText('보증금 합계');
  await expect(card('NET')).toContainText('광고 월수익 · 이자 차감');await expect(card('NET')).not.toContainText('월 임대수입');
  await expect(card('EMPTY').locator('.sale-card-facts-v2')).toHaveCount(0);
  for(const width of isMobile?[320,390]:[1794,1280,800]){
    await page.setViewportSize({width,height:866});for(const id of ['OJEONG','PARTIAL','PRICE'])expect(await card(id).evaluate(c=>c.scrollWidth<=c.clientWidth+1)).toBe(true);
  }
  if(!isMobile)await page.setViewportSize({width:1794,height:866});
  await card('OJEONG').locator('.item-building-name').click();
  await expect(page.locator('#unifiedDetailDrawerV8')).toContainText('3,000만원');await expect(page.locator('#unifiedDetailDrawerV8')).toContainText('250만원');
  await expect(card('OJEONG')).toContainText('3,000만원');await expect(card('OJEONG')).toContainText('250만원');
  await page.screenshot({path:info.outputPath('rental-card-ojeong.png'),animations:'disabled'});
  expect(await page.evaluate(()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.salePrice,i.saleDetails,i.memo,i.state])))).toBe(before);expect(writes).toBe(0);
});
