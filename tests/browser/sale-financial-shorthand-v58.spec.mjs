import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../../cloudflare/src/d1-api.js';
const description='매매금액:8억\n보증금:5천\n총월세:253';
const full=withSaleFinancialDisplay({source:'네이버',tradeType:'sale',saleCategory:'building',salePrice:80000,
  saleDetails:{scope:'whole_building',saleExtent:'whole_building',grossAreaM2:968.6,descriptionVersion:4,descriptionText:description,totalDeposit:null,monthlyIncome:null}});

test('stale master plus fresh compact originals show Galma shorthand on list, detail and comparison without mutating stored conditions',async({page,context,isMobile},info)=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const originals=await page.evaluate(({full,summary})=>{
    const seed=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');
    var originals={};
    allItems=['FIN58-A','FIN58-B'].map((id,index)=>{
      const master={...seed,...full,propertyId:id,key:id,name:'금액 누락 검수 '+index,address:'대전 서구 갈마동 '+(index?'378-1':'377-37'),
        saleDetails:{scope:'whole_building',descriptionText:full.saleDetails.descriptionText,totalDeposit:null,monthlyIncome:null}};
      originals[id]={...master,...full,saleSummary:summary,propertyId:id,originalId:id+'-O',sourceListingId:id,providerSourceId:id,images:[],photoCount:0};
      return master;
    });
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(Object.entries(originals).map(([id,o])=>{
      var compact={...o,saleSummary:summary};delete compact.saleDetails;return [id,[compact]];
    }))});
    document.getElementById('fixtureControls').hidden=true;return originals;
  },{full,summary:compactSaleSummary(full)});
  await page.route('**/api/data?*',r=>{
    const url=new URL(r.request().url());
    return url.searchParams.get('action')==='unifiedListingDetail'?r.fulfill({json:{ok:true,originals:[originals[url.searchParams.get('propertyId')]]}}):r.fallback();
  });
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  const before=await page.evaluate(()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.salePrice,i.saleDetails,i.memo,i.state])));
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  const card=page.locator('#list .listing-sale-card-v1').first();
  for(const value of ['5,000만원','253만원','원문 생략 · 만원 기준','4.05%'])await expect(card).toContainText(value);
  for(const width of isMobile?[320,390]:[1794,1280,800]){await page.setViewportSize({width,height:866});expect(await card.evaluate(c=>c.scrollWidth<=c.clientWidth+1)).toBe(true);}
  if(!isMobile)await page.setViewportSize({width:1794,height:866});
  await card.locator('.item-building-name').click();
  const detail=page.locator('#unifiedDetailDrawerV8');
  for(const value of ['5,000','253','원문 생략 · 만원 기준'])await expect(detail).toContainText(value);
  for(const value of ['5,000만원','253만원','원문 생략 · 만원 기준'])await expect(card).toContainText(value);
  await expect(detail.locator('.sale-review-gaps-v2')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('galma-shorthand-detail.png'),animations:'disabled'});
  await page.evaluate(()=>{
    JSUnifiedListingsV8.close();window.getSelectedPrintItems=()=>visibleListItems.slice(0,2);JSSaleWorkbenchV1.compare();
  });
  const comparison=page.locator('.sale-comparison-dialog-v2');
  await expect(comparison.locator('[data-building-compare-label="임대보증금 합계"]')).toContainText('5,000만원');
  await expect(comparison.locator('[data-building-compare-label="월 임대수입"]')).toContainText('253만원');
  await expect(comparison.locator('[data-building-compare-label="단순 연 수익률"]')).toContainText('4.05%');
  expect(await page.evaluate(()=>JSON.stringify(allItems.map(i=>[i.propertyId,i.salePrice,i.saleDetails,i.memo,i.state])))).toBe(before);
  expect(writes).toBe(0);
});
