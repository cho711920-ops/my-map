import {test,expect} from '@playwright/test';

test.beforeEach(async({page,context})=>{
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.route('**/api/data?**',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('action')!=='unifiedListingDetail')return route.fallback();
    const originals=await page.evaluate(id=>window.__v55Originals?.[id]||[],url.searchParams.get('propertyId'));
    await route.fulfill({json:{ok:true,originals}});
  });
  await page.evaluate(()=>{
    const seed=allItems.find(x=>x.propertyId==='FIXTURE-BUILDING');
    allItems=['A','B'].map((id,index)=>({...seed,propertyId:id,key:'saved-'+id,name:index?'단독 광고 B':'다가구 광고 A',
      address:'서구 갈마동 1197',type:index?'단독':'다가구',saleCategory:index?'multifamily':'house',
      salePrice:index?72000:63000,memo:'보존 메모 '+id,state:index?'확인':'미확인',
      saleDetails:{scope:'whole_building',saleExtent:'whole_building',wholeBuildingGroupEligibleV55:true,
        landAreaM2:180,grossAreaM2:400,totalDeposit:index?9800:9500,monthlyIncome:index?410:394}}));
    window.__v55Originals=Object.fromEntries(allItems.map(item=>[item.propertyId,[{...item,
      originalId:'original-'+item.propertyId,buildingName:item.name,sourceId:'source-'+item.propertyId,
      providerSourceId:'source-'+item.propertyId,saleSummary:item.saleDetails,images:[],photoCount:0,revision:1,
      sourceUnavailable:false,active:1,link:location.origin+'/original/'+item.propertyId}]]));
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:__v55Originals});
    sortType='address';JSListingTradeV1.setMode('building_sale');applyFilter();
  });
});

test('map/list filtering shows one whole-building card and each original retains its own financial conditions',async({page})=>{
  expect(await page.evaluate(()=>getFilteredItems().length)).toBe(1);
  await expect(page.locator('#list .item')).toHaveCount(1);
  await expect(page.locator('#list .unified-expand-btn-v8')).toHaveText('원본 광고 2개');
  expect(await page.evaluate(()=>({ids:allItems.map(x=>x.propertyId),memos:allItems.map(x=>x.memo),states:allItems.map(x=>x.state)})))
    .toEqual({ids:['A','B'],memos:['보존 메모 A','보존 메모 B'],states:['미확인','확인']});
  await page.evaluate(()=>JSUnifiedListingsV8.open('A'));
  await expect(page.locator('#unifiedDetailSubtitleV8')).toHaveText('건물 전체 · 원본 광고 2개');
  const rows=page.locator('#unifiedDetailBodyV8 .unified-original-row-v8');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('보증금 9,500만원 · 월 임대수입 394만원');
  await expect(rows.nth(1)).toContainText('보증금 9,800만원 · 월 임대수입 410만원');
  await page.locator('#unifiedDetailBodyV8 [data-original-id="original-B"]').click();
  await expect(page.locator('#unifiedDetailTitleV8')).toHaveText('단독 광고 B');
  await expect(page.locator('.wide-detail-primary-v26')).toContainText('7억2,000만원');
  await expect(page.locator('.wide-detail-primary-v26')).toContainText('9,800만원');
  await expect(page.locator('.wide-detail-primary-v26')).toContainText('410만원');
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(()=>getFilteredItems().length)).toBe(1);
});

test('member notes remain reachable and editing selected original targets its own saved parent',async({page})=>{
  await page.evaluate(()=>JSUnifiedListingsV8.open('A','original-B'));
  const records=page.locator('.unified-group-records-v55');
  await records.locator('summary').click();
  await expect(records).toContainText('보존 메모 A');await expect(records).toContainText('보존 메모 B');
  await page.evaluate(()=>{window.openPropertyEditModalV630=id=>{window.__editedId=decodeURIComponent(id);};});
  await records.locator('section').nth(1).getByRole('button',{name:'이 기록 수정'}).click();
  expect(await page.evaluate(()=>__editedId)).toBe('id:B');
  expect(await page.evaluate(()=>JSUnifiedListingsV8.allOriginals('A').map(x=>x.propertyId))).toEqual(['A']);
  expect(await page.evaluate(()=>JSUnifiedListingsV8.allOriginals('B').map(x=>x.propertyId))).toEqual(['B']);
});

test('price filter keeps only the matching ad and unknown scope never collapses',async({page})=>{
  const result=await page.evaluate(()=>{
    const api=JSUnifiedListingsV8;
    let filtered=api.collapseWholeBuildingSalesV55(allItems.map(x=>api.filterItemForView(x,o=>o.salePrice>70000,'active')).filter(Boolean));
    const price=filtered.map(x=>({id:x.propertyId,count:x.unifiedOriginalCountV8,income:x.saleDetails.monthlyIncome}));
    __v55Originals.B[0].saleSummary={...__v55Originals.B[0].saleSummary,saleExtent:'unknown',wholeBuildingGroupEligibleV55:false};
    api.attach(allItems,{ok:true,groups:__v55Originals});applyFilter();
    return {price,count:getFilteredItems().length};
  });
  expect(result).toEqual({price:[{id:'B',count:1,income:410}],count:2});
});
