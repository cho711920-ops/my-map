import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
const description='매매가 16억5천만원 / 보증금액 2억1천만원 / 월임대료 640만원 / 대출 9억5천만원 / 실투자금 4억9천만원';
const full=withSaleFinancialDisplay({propertyId:'FIXTURE-BUILDING',originalId:'PRINT22-O',source:'당근',tradeType:'sale',saleCategory:'building',salePrice:165000,
  saleDetails:{scope:'whole_building',saleExtent:'whole_building',landAreaM2:224.8,grossAreaM2:422.46,descriptionVersion:2,descriptionText:description} });
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{
    window.__fixturePrintCalls=0;const open=window.open;window.open=function(...args){const popup=open.apply(window,args);if(popup)popup.print=()=>window.__fixturePrintCalls++;return popup;};
    document.getElementById('fixtureControls').hidden=true;
    allItems=allItems.map(i=>i.propertyId==='FIXTURE-BUILDING'?{...i,source:'당근',salePrice:165000,name:'매매 검토용 건물',memo:'보존할 관리 메모 / 출처: 당근',saleDetails:{scope:'whole_building',landAreaM2:224.8,grossAreaM2:422.46}}:i);
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.propertyId==='FIXTURE-BUILDING'?'PRINT22-O':i.propertyId+'-O',buildingName:i.name,saleSummary:i.saleDetails}]]))});applyFilter();
  });
});
async function selectAndPrint(page,context,isMobile){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#list .item .action-select-check').first().check();
  const opened=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(e=>e.click());const popup=await opened;
  await expect.poll(()=>page.evaluate(()=>window.__fixturePrintCalls)).toBe(1);return popup;
}
test('printing re-reads only the chosen original and shows income, price comparison and no source',async({page,context,isMobile},info)=>{
  let forcedReads=0,writes=0;
  page.on('request',r=>{if(r.method()==='POST')writes++;});
  await page.route('**/api/data?*',route=>{
    if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();
    if(route.request().headers()['x-js-force-refresh']==='1')forcedReads++;
    return route.fulfill({json:{ok:true,originals:[{...full,buildingName:'매매 검토용 건물'}, {...full,originalId:'OTHER-O',salePrice:999999,saleDetails:{monthlyIncome:9999,totalDeposit:99999}}]}});
  });
  const business=()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.salePrice,i.saleDetails,i.memo]));const before=await page.evaluate(business);
  const popup=await selectAndPrint(page,context,isMobile),facts=popup.locator('.sale-print-facts');
  for(const text of ['2억1,000만원','640만원','7,680만원','5.33%','9억5,000만원','4억9,000만원','대지 기준 매매단가','연면적 기준 매매단가'])await expect(facts).toContainText(text);
  await expect(popup.locator('.sale-print-contact')).not.toContainText('출처');await expect(popup.locator('body')).not.toContainText('출처:');await expect(popup.locator('body')).not.toContainText('9,999만원');
  await expect(popup.locator('.sale-print-memo')).toContainText('보존할 관리 메모');expect(forcedReads).toBe(1);expect(writes).toBe(0);expect(await page.evaluate(business)).toBe(before);
  await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:734,height:1030});
  expect(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await popup.screenshot({path:info.outputPath('sale-print-review-v22.png'),fullPage:true});if(!isMobile)await popup.pdf({path:info.outputPath('sale-print-review-v22.pdf'),preferCSSPageSize:true,printBackground:true});
});
test('manual blank and manual income survive fresh detail projection',async({page,context,isMobile})=>{
  await page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');item.saleDetails={...item.saleDetails,totalDeposit:null,monthlyIncome:371,manualSaleFieldsV1:['totalDeposit','monthlyIncome']};});
  await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListingDetail'?route.fulfill({json:{ok:true,originals:[{...full,manualDisplayFields:'sale_details_json'}]}}):route.continue());
  const popup=await selectAndPrint(page,context,isMobile);await expect(popup.locator('.sale-print-facts')).toContainText('371만원');await expect(popup.locator('.sale-print-facts')).not.toContainText('2억1,000만원');await expect(popup.locator('.sale-print-warning')).toContainText('임대보증금');
});
test('a different original is not substituted when the chosen source is missing',async({page,context,isMobile})=>{
  await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListingDetail'?route.fulfill({json:{ok:true,originals:[{...full,originalId:'OTHER-O',saleDetails:{monthlyIncome:9999}}]}}):route.continue());
  const popup=await selectAndPrint(page,context,isMobile);await expect(popup.locator('.sale-print-warning')).toContainText('최신 상세조건 조회 실패');await expect(popup.locator('body')).not.toContainText('9,999만원');
});
test('failed detail request prints a visible verification note without fake zeros',async({page,context,isMobile})=>{
  await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListingDetail'?route.fulfill({status:503,json:{ok:false}}):route.continue());
  const popup=await selectAndPrint(page,context,isMobile);await expect(popup.locator('.sale-print-warning')).toContainText('최신 상세조건 조회 실패');await expect(popup.locator('.sale-print-facts')).not.toContainText('0만원');
});
