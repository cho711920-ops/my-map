import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
const description='▶ 매매가 : 6억7천 만원\n▶ 융 자 : 2억\n▶ 보증금 : 8천5백5십 만원\n▶ 월수익 : 월 211 만원 ▶실투자금 : 3억8천4백5십 만원';
const projected=withSaleFinancialDisplay({source:'당근',tradeType:'sale',saleCategory:'building',salePrice:67000,saleDetails:{scope:'whole_building',descriptionVersion:1,descriptionText:description,totalDeposit:8550,descriptionFinancials:{totalDeposit:8550},descriptionEvidence:{'보증금':'보증금 : 8천5백5십 만원'}}});

test('existing advertisement shows each financial basis without inventing gross rent or changing leases',async({page,context,isMobile},info)=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(projected=>{
    const base=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING'),item={...base,...projected,name:'금융정보 검수용 건물',originalId:'FINANCIAL15-O',propertyId:'FINANCIAL15',key:'financial15',images:[],photoCount:0};
    allItems=allItems.filter(i=>i.tradeType!=='sale').concat(item);window.__financial15=item;
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.originalId||i.propertyId+'-O'}]]))});document.getElementById('fixtureControls').hidden=true;
  },projected);
  await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListingDetail'?route.fulfill({json:{ok:true,originals:[{...projected,originalId:'FINANCIAL15-O',propertyId:'FINANCIAL15',name:'금융정보 검수용 건물',buildingName:'금융정보 검수용 건물',images:[],photoCount:0}]}}):route.continue());
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  const businessSnapshot=()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.tradeType,i.salePrice,i.deposit,i.rent,...['totalDeposit','monthlyIncome','monthlyNetIncome','statedMonthlyIncome','loanAmount','investmentAmount'].map(k=>i.saleDetails?.[k])]));
  await page.evaluate(()=>applyFilter());const lease=await page.locator('#list .item').first().innerHTML(),data=await page.evaluate(businessSnapshot);
  const select=page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1');await select.selectOption('building_sale');if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const card=page.locator('#list .listing-sale-card-v1').first(),facts=card.locator('.sale-card-facts-v2');
  for(const value of ['8,550만원','20,000만원','211만원','38,450만원','광고 월수익 · 기준 미확인'])await expect(facts).toContainText(value);
  await expect(facts).not.toContainText('월 임대수입');
  for(const width of isMobile?[320,390]:[1794,1280,800,700]){await page.setViewportSize({width,height:866});expect(await card.evaluate(c=>c.scrollWidth<=c.clientWidth+1)).toBe(true);}
  if(!isMobile){await page.setViewportSize({width:1794,height:866});await page.locator('[data-sale-layout="compact"]').click();const compact=card.locator('.sale-compact-metrics-v8');await expect(compact).toContainText('광고 월수익 · 기준 미확인');await expect(compact).toContainText('211만원');await expect(compact).toContainText('산정 불가');await page.locator('[data-sale-layout="detail"]').click();}
  await page.screenshot({path:info.outputPath('sale-financial-list.png'),animations:'disabled'});
  await card.locator('.action-select-check').check();await expect(card.locator('.action-select-check')).toBeChecked();
  await card.locator('.item-building-name').click();const drawer=page.locator('#unifiedDetailDrawerV8');
  await expect(drawer).toContainText('광고 월수익 (계산 기준 미확인)');await expect(drawer).toContainText('38,450');await expect(drawer).toContainText('20,000');
  await page.screenshot({path:info.outputPath('sale-financial-detail.png'),animations:'disabled'});
  expect(await page.evaluate(businessSnapshot)).toBe(data);expect(writes).toBe(0);
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();await select.selectOption('lease');expect(await page.locator('#list .item').first().innerHTML()).toBe(lease);
});
