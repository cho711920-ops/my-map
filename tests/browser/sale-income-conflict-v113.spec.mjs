import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../../cloudflare/src/d1-api.js';
const ad=withSaleFinancialDisplay({source:'네이버',tradeType:'sale',saleCategory:'mixed_house',salePrice:82000,
 saleDetails:{scope:'whole_building',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,
 descriptionText:'상가주택 매매가 82,000만, 보증금합계 24,000만/월220만, 실투자금 58,000만',
 monthlyIncome:2200,totalDeposit:24000}}, {naverPriceInfo:{previousDeposit:240000000,previousMonthlyRent:22000000}});
const summary=compactSaleSummary(ad);
test('list and the selected original detail both show 220 and retain the numeric conflict without changing other ads',async({page,context,isMobile})=>{
 let writes=0;
 await context.route('**/*',route=>{
   if(route.request().method()!=='GET')writes++;
   return new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort();
 });
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(({ad,summary})=>{
   document.getElementById('fixtureControls').remove();
   const seed=allItems.find(item=>item.propertyId==='FIXTURE-BUILDING');
   allItems=[{...seed,...ad,saleDetails:summary,propertyId:'A',key:'source-A',name:'상가주택 광고 A',address:'서구 탄방동 56-24'},
     {...seed,propertyId:'B',key:'source-B',name:'다가구 광고 B',address:'서구 탄방동 56-24',salePrice:82000,
       saleDetails:{scope:'whole_building',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,totalDeposit:30000,monthlyIncome:188}}];
   window.__v113Originals={A:[{...allItems[0],...ad,propertyId:'A',originalId:'original-A',buildingName:'상가주택 광고 A',saleSummary:summary}],
     B:[{...allItems[1],originalId:'original-B',buildingName:'다가구 광고 B',saleSummary:allItems[1].saleDetails}]};
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups:__v113Originals});JSListingTradeV1.setMode('building_sale');applyFilter();
 },{ad,summary});
 if(isMobile)await page.locator('[data-mobile-view="list"]').click();
 await page.route('**/api/data?**',async route=>{
   const u=new URL(route.request().url());if(u.searchParams.get('action')!=='unifiedListingDetail')return route.fallback();
   return route.fulfill({json:{ok:true,originals:await page.evaluate(id=>__v113Originals[id],u.searchParams.get('propertyId'))}});
 });
 const facts=page.locator('#list .sale-card-facts-v2');
 await expect(facts).toContainText('220만원');await expect(facts).toContainText('숫자·설명 불일치');
 await expect(facts).toContainText('2,200만원');await expect(facts).toContainText('4.55%');
 await expect(facts).not.toContainText('45.52%');
 await page.locator('#list .item-building-name').click();
 await expect(page.locator('#unifiedDetailTitleV8')).toHaveText('상가주택 광고 A');
 await expect(page.locator('.wide-detail-primary-v26')).toContainText('220만원');
 await expect(page.locator('#unifiedDetailBodyV8 [data-original-id="original-B"]')).toContainText('188만원');
 expect(writes).toBe(0);
});
