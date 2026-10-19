import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
const description='매매가 20억 (절충가능) 대출 9억 / 보증금 8억8천 / 총월세 638만 → 실투자금 2억2천 / 월순수익 226만 / 연수익 12.3%';
const projected=withSaleFinancialDisplay({source:'네이버',tradeType:'sale',saleCategory:'mixed_house',salePrice:200000,
  saleDetails:{scope:'whole_building',descriptionVersion:2,descriptionText:description,monthlyIncome:638}}, {naverPriceInfo:{previousDeposit:0,previousMonthlyRent:0}});

test('shorthand financial correction reaches cards and detail without turning profit into rent or changing saved data',async({page,context,isMobile},info)=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(projected=>{
    const base=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING'),item={...base,...projected,name:'금액 단위 검수용 건물',originalId:'FINANCIAL21-O',propertyId:'FINANCIAL21',key:'financial21',images:[],photoCount:0};
    allItems=allItems.filter(i=>i.tradeType!=='sale').concat(item);
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.originalId||i.propertyId+'-O'}]]))});document.getElementById('fixtureControls').hidden=true;
  },projected);
  await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListingDetail'?route.fulfill({json:{ok:true,originals:[{...projected,originalId:'FINANCIAL21-O',propertyId:'FINANCIAL21',name:'금액 단위 검수용 건물',buildingName:'금액 단위 검수용 건물',images:[],photoCount:0}]}}):route.continue());
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  const businessSnapshot=()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.tradeType,i.salePrice,i.deposit,i.rent,...['totalDeposit','monthlyIncome','loanAmount','investmentAmount','statedMonthlyIncome'].map(k=>i.saleDetails?.[k])]));
  await page.evaluate(()=>applyFilter());const before=await page.evaluate(businessSnapshot);
  const select=page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1');await select.selectOption('building_sale');if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const card=page.locator('#list .listing-sale-card-v1').first();
  for(const value of ['88,000만원','638만원','90,000만원','22,000만원','226만원'])await expect(card).toContainText(value);
  await expect(card).toContainText('기준 미확인');await expect(card).not.toContainText('0.00%');
  for(const width of isMobile?[320,390]:[1794,1280,800,700]){await page.setViewportSize({width,height:866});expect(await card.evaluate(c=>c.scrollWidth<=c.clientWidth+1)).toBe(true);}
  if(!isMobile)await page.setViewportSize({width:1794,height:866});
  await page.screenshot({path:info.outputPath('sale-financial-v21-list.png'),animations:'disabled'});
  await card.locator('.item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');
  for(const value of ['88,000','638','22,000','226'])await expect(drawer).toContainText(value);
  await expect(drawer).toContainText('광고 월수익 (계산 기준 미확인)');
  await page.screenshot({path:info.outputPath('sale-financial-v21-detail.png'),animations:'disabled'});
  expect(await page.evaluate(businessSnapshot)).toBe(before);expect(writes).toBe(0);
});
