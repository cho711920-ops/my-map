import {test,expect} from '@playwright/test';
const card=(page,id)=>page.locator('#list .item[data-property-id="'+id+'"]');
test.beforeEach(async({page,context,isMobile})=>{
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.route('**/__v203/*.svg',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#638798"/></svg>'}));
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{
  const base=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');
  const items=[1,9].map(floor=>({...base,propertyId:'TARGET-V203-'+floor,key:'stable-'+floor,sheetRow:20300+floor,address:'서구 괴정동 5-9',source:'네이버',sourceLink:'https://example.invalid/ad/'+floor,room:floor+'층',tradeType:'sale',saleCategory:'commercial',type:'일반상가',salePrice:floor===1?45000:115000,
   memo:floor===1?'도로노출1층 내부시설완비':'크리닉건물 9층매매. 탑층 9층 전체 매매합니다. [다른동 미용실 2층 전용120평 2억 월1200]',
   saleDetails:{saleExtent:'unit',saleTargetFloor:floor+'층',exclusiveAreaM2:floor===1?57.88:519.01},unifiedOriginalsV8:[],unifiedAllOriginalsV1:[]}));
  allItems=items;JSUnifiedListingsV8.attach(items,{ok:true,groups:Object.fromEntries(items.map(i=>[i.propertyId,[{...i,link:i.sourceLink,originalId:i.propertyId+'-O',thumbnail:location.origin+'/__v203/'+i.propertyId+'.svg',images:[location.origin+'/__v203/'+i.propertyId+'.svg'],photoCount:1,saleSummary:i.saleDetails}]]))});
  JSListingTradeV1.setMode('building_sale');showList(items.map(i=>JSUnifiedListingsV8.filterItemForView(i,()=>true,'active')));
  window.__targetBeforeV203=JSON.stringify(allItems);
 });
 if(isMobile)await page.locator('[data-mobile-view="list"]').click();
});
test('own floor subject is visible next to the address with actual decoded thumbnails and intact master values',async({page},info)=>{
 const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
 await expect(card(page,'TARGET-V203-1').locator('.building-sale-target-v203')).toHaveText('1층 · 호실 매매');
 await expect(card(page,'TARGET-V203-9').locator('.building-sale-target-v203')).toHaveText('9층 전체 매매');

 for(const id of ['TARGET-V203-1','TARGET-V203-9']){
  const c=card(page,id),badge=c.locator('.building-sale-target-v203');await expect(badge).toBeVisible();
  expect(await badge.evaluate(el=>el.getBoundingClientRect().right<=el.closest('.item').getBoundingClientRect().right)).toBe(true);
  await expect.poll(()=>c.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 }
 expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(await page.evaluate(()=>__targetBeforeV203));expect(writes).toEqual([]);
 await page.screenshot({path:'outputs/v203-target-'+info.project.name+'.png',animations:'disabled'});
});
test('filtering to a different advertisement never borrows representative memo and manual floor stays with its exact master',async({page})=>{
 const result=await page.evaluate(()=>{
  const master=allItems.find(i=>i.propertyId==='TARGET-V203-9');
  const other={...master.unifiedAllOriginalsV1[0],originalId:'OTHER',link:'https://example.invalid/other',salePrice:45000,room:'1층',saleSummary:{saleExtent:'unit',saleTargetFloor:'1층'}};
  master.unifiedAllOriginalsV1.push(other);
  const projected=JSUnifiedListingsV8.filterItemForView(master,i=>i.salePrice===45000,'active');
  const label=JSListingTradeV1.buildingSaleTargetLabelV203(projected);
  const primary=allItems.find(i=>i.propertyId==='TARGET-V203-1');primary.room='지하1층';primary.manualFinancialFieldsV106=['room'];
  const edited=JSUnifiedListingsV8.filterItemForView(primary,()=>true,'active');showList([edited,projected]);
  return {label,otherPrice:projected.salePrice,masterPrice:master.salePrice,otherRoom:projected.room,edited:JSListingTradeV1.buildingSaleTargetLabelV203(edited)};
 });
 expect(result).toEqual({label:'1층 · 호실 매매',otherPrice:45000,masterPrice:115000,otherRoom:'9층',edited:'지하1층 · 직접 입력'});
 await expect(card(page,'TARGET-V203-1').locator('.building-sale-target-v203')).toHaveText('지하1층 · 직접 입력');
 await expect(card(page,'TARGET-V203-9').locator('.building-sale-target-v203')).toHaveText('1층 · 호실 매매');
});
test('changing own memo repaints selling extent immediately without another request',async({page})=>{
 const requests=[];page.on('request',r=>requests.push(r.method()+' '+r.url()));
 await page.evaluate(()=>{const i=allItems.find(i=>i.propertyId==='TARGET-V203-9');i.memo='9층 매매';showList(allItems.map(i=>JSUnifiedListingsV8.filterItemForView(i,()=>true,'active')));});
 await expect(card(page,'TARGET-V203-9').locator('.building-sale-target-v203')).toHaveText('9층 · 호실 매매');
 expect(requests.filter(r=>r.startsWith('POST ')||r.includes('listingOriginals')||r.includes('unifiedListingDetail'))).toEqual([]);
});

test('alternate ad for the same natively confirmed unit keeps its operating memo, while another floor at the same price does not',async({page})=>{
 const labels=await page.evaluate(()=>{
  const m=allItems.find(i=>i.propertyId==='TARGET-V203-9'),own=m.unifiedAllOriginalsV1[0];
  m.unifiedAllOriginalsV1.push({...own,originalId:'ALT-SAME',link:'https://example.invalid/alternate'});
  m.unifiedAllOriginalsV1.push({...own,originalId:'ALT-FLOOR',link:'https://example.invalid/floor',saleSummary:{saleExtent:'unit',saleTargetFloor:'1층'}});
  return ['ALT-SAME','ALT-FLOOR'].map(id=>JSListingTradeV1.buildingSaleTargetLabelV203(JSUnifiedListingsV8.filterItemForView(m,i=>i.unifiedFilterOriginalV2.originalId===id,'active')));
 });
 expect(labels).toEqual(['9층 전체 매매','1층 · 호실 매매']);
});
