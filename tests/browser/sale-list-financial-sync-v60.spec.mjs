import {test,expect} from '@playwright/test';
import {withSaleFinancialDisplay} from '../../cloudflare/src/sale-financial-display.js';
import {compactSaleSummary} from '../../cloudflare/src/d1-api.js';

// Actual affected record's relevant shape: empty master JSON, source scope=unit,
// whole-building evidence, and finance supplied by the newer detail projection.
const full=withSaleFinancialDisplay({source:'네이버',tradeType:'sale',saleCategory:'building',salePrice:80000,
  saleDetails:{scope:'unit',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,grossAreaM2:968.6,
    descriptionText:'매매금액:8억\n보증금:5천\n총월세:253',totalDeposit:null,monthlyIncome:null}});
const summary=compactSaleSummary(full);

async function setup(page,context){
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const original=await page.evaluate(({full,summary})=>{
    const seed=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');
    const master={...seed,propertyId:'FIN60',key:'FIN60',source:'네이버',salePrice:80000,saleDetails:null,
      name:'금액 전달 검수',address:'대전 서구 갈마동 377-37'};
    const original={...full,propertyId:master.propertyId,originalId:'FIN60-O',providerSourceId:'FIN60-S',
      sourceListingId:'FIN60-S',buildingName:master.name,address:master.address,active:1,lastCheckedAt:'2026-10-21T04:00:00Z',
      saleSummary:summary,images:[],photoCount:0};
    const compact={...original,saleSummary:{scope:'unit',grossAreaM2:968.6,saleExtent:'whole_building'}};
    delete compact.saleDetails;
    allItems=[master];JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{FIN60:[compact]}});
    document.getElementById('fixtureControls').hidden=true;return original;
  },{full,summary});
  let reads=0,writes=0;
  await page.route('**/api/data?*',r=>{
    if(new URL(r.request().url()).searchParams.get('action')!=='unifiedListingDetail')return r.fallback();
    reads++;return r.fulfill({json:{ok:true,originals:[original]}});
  });
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');});
  return {original,reads:()=>reads,writes:()=>writes};
}

test('prefetched fresh detail must update an old financial card after verified open, including responsive layout',async({page,context,isMobile},info)=>{
  const audit=await setup(page,context);
  if(isMobile)await page.setViewportSize({width:1280,height:800});
  const card=page.locator('#list .listing-sale-card-v1');
  await expect(card).not.toContainText('253만원');
  await page.evaluate(()=>JSUnifiedListingsV8.prefetch('FIN60'));
  expect(audit.reads()).toBe(1);
  if(isMobile){await page.setViewportSize({width:390,height:844});await page.locator('[data-mobile-view="list"]').click();}
  // Fresh cache existed before clicking. The former fromCache branch returned
  // early forever: detail showed 5000/253 while the card stayed empty.
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIN60'));
  await expect(page.locator('#unifiedDetailBodyV8')).toContainText('253만원');
  for(const value of ['5,000만원','253만원','4.05%'])await expect(card).toContainText(value);
  expect(audit.reads()).toBe(2);
  await page.screenshot({path:info.outputPath('cached-detail-list-financial-sync.png'),animations:'disabled'});
  await page.evaluate(()=>JSUnifiedListingsV8.close());
  await page.evaluate(()=>JSUnifiedListingsV8.open('FIN60'));
  expect(audit.reads()).toBe(2);expect(audit.writes()).toBe(0);
  expect(await page.evaluate(()=>allItems[0].saleDetails)).toBe(null);
});

test('map card reuse updates changed financial facts while retaining card, memo and checks',async({page,context,isMobile})=>{
  const audit=await setup(page,context);
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  // Apply a new exact-source summary through the same DOM-reuse flag map idle uses.
  await page.evaluate(summary=>{
    const card=document.querySelector('#list .listing-sale-card-v1');
    card.querySelector('.action-select-check').click();card.querySelector('.item-memo-toggle').click();
    window.__fin60Card=document.querySelector('#list .listing-sale-card-v1');
    window.__fin60Memo=window.__fin60Card.querySelector('.item-memo-panel');
    const original={...JSUnifiedListingsV8.allOriginals('FIN60')[0],saleSummary:summary};
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{FIN60:[original]}});
    window.jsReuseListCardsOnNextRenderV6521=true;applyFilter();
  },summary);
  const card=page.locator('#list .listing-sale-card-v1');
  for(const value of ['5,000만원','253만원'])await expect(card).toContainText(value);
  expect(await card.evaluate(c=>c===window.__fin60Card)).toBe(true);
  expect(await card.evaluate(c=>c.querySelector('.item-memo-panel')===window.__fin60Memo)).toBe(true);
  await expect(card.locator('.action-select-check')).toBeChecked();await expect(card).toHaveClass(/memo-open/);
  await expect(card.locator('.sale-table-row-v10')).toContainText('253만원');
  await page.evaluate(()=>{
    const original={...JSUnifiedListingsV8.allOriginals('FIN60')[0],saleSummary:{scope:'unit',totalDeposit:0}};
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{FIN60:[original]}});
    window.jsReuseListCardsOnNextRenderV6521=true;applyFilter();
  });
  await expect(card.locator('.sale-card-facts-v2')).toContainText('0만원');
  await expect(card.locator('.sale-card-facts-v2')).not.toContainText('월 임대수입');
  await expect(card.locator('.sale-table-row-v10')).not.toContainText('253만원');
  expect(await card.evaluate(c=>c===window.__fin60Card)).toBe(true);
  expect(audit.writes()).toBe(0);
});
