import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
const description='매매가격:6억3000만원 총 보증금:1억4500만원 월세 수익:월215만원 (연2580만원)';
const projected=withSaleFinancialDisplay({source:'당근',tradeType:'sale',saleCategory:'building',salePrice:63000,
  saleDetails:{scope:'whole_building',descriptionVersion:3,descriptionText:description}});

test('explicit description deposit and monthly rent reach cards and detail while saved business data stays unchanged',async({page,context,isMobile},info)=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(projected=>{
    const base=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING'),item={...base,...projected,name:'금액 단위 검수용 건물',originalId:'FINANCIAL50-O',propertyId:'FINANCIAL50',key:'financial50',images:[],photoCount:0};
    allItems=allItems.filter(i=>i.tradeType!=='sale').concat(item);
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.originalId||i.propertyId+'-O'}]]))});document.getElementById('fixtureControls').hidden=true;
  },projected);
  await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListingDetail'?route.fulfill({json:{ok:true,originals:[{...projected,originalId:'FINANCIAL50-O',propertyId:'FINANCIAL50',name:'금액 단위 검수용 건물',buildingName:'금액 단위 검수용 건물',images:[],photoCount:0}]}}):route.continue());
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  const businessSnapshot=()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.tradeType,i.salePrice,i.deposit,i.rent,...['totalDeposit','monthlyIncome','loanAmount','investmentAmount','statedMonthlyIncome'].map(k=>i.saleDetails?.[k])]));
  await page.evaluate(()=>applyFilter());const before=await page.evaluate(businessSnapshot);
  const select=page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1');await select.selectOption('building_sale');if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const card=page.locator('#list .listing-sale-card-v1').first();
  for(const value of ['14,500만원','215만원'])await expect(card).toContainText(value);
  await expect(card).toContainText('월 임대수입');await expect(card).not.toContainText('0.00%');
  for(const width of isMobile?[320,390]:[1794,1280,800,700]){await page.setViewportSize({width,height:866});expect(await card.evaluate(c=>c.scrollWidth<=c.clientWidth+1)).toBe(true);}
  if(!isMobile)await page.setViewportSize({width:1794,height:866});
  await page.screenshot({path:info.outputPath('sale-financial-v50-list.png'),animations:'disabled'});
  await card.locator('.item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');
  for(const value of ['14,500','215'])await expect(drawer).toContainText(value);
  await expect(drawer).toContainText('월 임대수입');
  await page.screenshot({path:info.outputPath('sale-financial-v50-detail.png'),animations:'disabled'});
  expect(await page.evaluate(businessSnapshot)).toBe(before);expect(writes).toBe(0);
});
