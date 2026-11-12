import {test,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../../js/map.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('map.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['listingChangeRowToItemV683','parseDirectSaleDetailsV1','scopedReadLocalValuesV1','captureScopedReadV1','originalMetadataMutationPendingV1','applyScopedListingsV1','persistCompleteDeltaCacheV125','refreshMovedListingsV99','getFieldVisitClusterClassV684']);
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name.text)).map(node=>node.getText(ast)).join('\n');
const proof='sha256-v1:'+'9'.repeat(64);
async function setup(page,isMobile){
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
 await page.addScriptTag({url:'/js/selected-listing-merge-v99.js'});
 await page.addScriptTag({content:functions});
 await page.evaluate(()=>{
   window.jsListingsLoadGenerationV1=1;window.jsListingsRevisionV682='complete-base';window.jsListingsCompleteBaseV1=true;
   window.ensureCompleteBaseV1=()=>{};window.captureAutoUpdateViewState=()=>({});window.restoreAutoUpdateViewState=()=>{};
   window.notifyListingsSnapshotV1=()=>{};
   window.JSListingRefreshV1={refreshMoved:refreshMovedListingsV99,reloadAfterMutation(){throw new Error('Unexpected full reload');}};
   window.JSInitialListingsCacheV1={clear(){window.__cacheCleared=true;}};
   window.selectedPrintKeys=allItems.filter(i=>i.tradeType==='lease').map(actionSelectionKeyV660);showList(allItems.filter(i=>i.tradeType==='lease'));
 });
 if(isMobile)await page.locator('[data-mobile-view="list"]').click();
 await expect(page.locator('#mergeSelectedListingsBtnV99')).toBeVisible();await expect(page.locator('#mergeSelectedListingsBtnV99')).toBeEnabled();
}
function response(primary,duplicates){return {ok:true,persisted:true,consolidated:duplicates.length,primaryPropertyId:primary,duplicatePropertyIds:duplicates,
 affectedPropertyIds:[primary,...duplicates],keyMap:Object.fromEntries(duplicates.map(id=>['property:'+id,'property:'+primary]))};}
async function routeScoped(page,readActions){
 await page.route('**/api/data?*',async route=>{
   const url=new URL(route.request().url()),action=url.searchParams.get('action');readActions.push(action);
   if(action!=='listingOriginals')return route.fallback();
   const primary='FIXTURE-LEASE-2',other='FIXTURE-LEASE-1';
   await route.fulfill({json:{ok:true,requestedIds:[primary,other],missingIds:[other],items:[{property_id:primary,title:'남길 대표매물',address:'대전 서구 탄방동 2-2',room:'2층',listing_type:'상가',trade_type:'lease',deposit:3000,monthly_rent:150,area_m2:40,status:'active',source_snapshot_key:proof,operating_memo:'두 메모 보존'}],
    unified:{ok:true,format:'compact-v2',fields:['originalId','rent'],groups:{[primary]:[['ad-one',90],['ad-two',150]]},sourceSnapshotKeys:{[primary]:proof},sourceSnapshotPropertyIds:{[primary]:primary},sourceSearchIds:{}}}});
 });
}
test('bulk selection opens review, allows cancel, keeps chosen representative and refreshes only affected masters',async({page,context,isMobile})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await setup(page,isMobile);let writes=[];const reads=[];
 await page.route('**/api/data',async route=>{
   if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();
   if(body.action!=='consolidateExistingMasters')return route.fallback();writes.push(body);
   await route.fulfill({json:response(body.primaryMasterId,body.duplicateMasterIds)});
 });
 await page.locator('#mergeSelectedListingsBtnV99').click();await expect(page.locator('#selectedMergeDialogV99')).toBeVisible();
 await page.locator('#selectedMergeDialogV99 [data-cancel]').click();expect(writes).toHaveLength(0);
 await page.locator('#mergeSelectedListingsBtnV99').click();await page.locator('input[value="FIXTURE-LEASE-2"]').check();
 await mkdir('outputs/v99',{recursive:true});await page.screenshot({path:'outputs/v99/review-'+(isMobile?'mobile':'desktop')+'.png'});
 await routeScoped(page,reads);await page.locator('#selectedMergeDialogV99 [data-submit]').click();
 await expect(page.locator('#selectedMergeDialogV99')).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>allItems.some(i=>i.propertyId==='FIXTURE-LEASE-1'))).toBe(false);
 expect(writes).toHaveLength(1);expect(writes[0].primaryMasterId).toBe('FIXTURE-LEASE-2');expect(writes[0].duplicateMasterIds).toEqual(['FIXTURE-LEASE-1']);
 expect(writes[0].expectedAccountEmail).toBe('browser-fixture@example.invalid');
 expect(reads.filter(a=>a==='listingOriginals')).toHaveLength(1);expect(reads).not.toContain('unifiedListings');expect(await page.evaluate(()=>__cacheCleared)).toBe(true);
 expect(await page.evaluate(()=>JSUnifiedListingsV8.allOriginals('FIXTURE-LEASE-2').length)).toBe(2);
 await page.screenshot({path:'outputs/v99/merged-'+(isMobile?'mobile':'desktop')+'.png'});
});
test('failed save keeps selection and retries with the same request ID without a blind write retry',async({page,isMobile})=>{
 await setup(page,isMobile);const writes=[];
 await page.route('**/api/data',async route=>{
   if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();
   if(body.action!=='consolidateExistingMasters')return route.fallback();writes.push(body);await route.fulfill({status:503,json:{ok:false,message:'검사 저장 지연'}});
 });
 await page.route('**/api/data?*',route=>new URL(route.request().url()).searchParams.get('action')==='mutationStatus'?route.fulfill({json:{ok:true,ready:false}}):route.fallback());
 await page.locator('#mergeSelectedListingsBtnV99').click();await page.locator('#selectedMergeDialogV99 [data-submit]').click();
 await expect(page.locator('.merge-message-v99')).toContainText('검사 저장 지연');expect(writes).toHaveLength(1);
 expect(await page.evaluate(()=>selectedPrintKeys.length)).toBe(2);
 await page.locator('#selectedMergeDialogV99 [data-submit]').click();await expect.poll(()=>writes.length).toBe(2);expect(writes[0].requestId).toBe(writes[1].requestId);
});

test('representative choices follow the displayed order and conditions, not storage or click order',async({page,isMobile})=>{
 await setup(page,isMobile);
 await page.route('**/__fixture/merge-photo-*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="'+(route.request().url().endsWith('a')?'#accade':'#d8c5b0')+'"/><text x="30" y="55" font-size="25">'+(route.request().url().endsWith('a')?'A':'B')+'</text></svg>'}));
 await page.evaluate(()=>{
   const items=allItems.filter(i=>i.tradeType==='lease');
   const originals=(count,photo)=>Array.from({length:count},(_,index)=>({originalId:photo+index,thumbnail:location.origin+'/__fixture/merge-photo-'+photo,source:'네이버'}));
   const first={...items[1],name:'일반상가',address:'서구 괴정동 425-5',room:'1층',deposit:3000,rent:270,area:26,unifiedDisplayOriginalsV2:originals(4,'a')};
   const second={...items[0],name:'일반상가',address:first.address,room:'1층',deposit:3000,rent:270,area:31,unifiedDisplayOriginalsV2:originals(2,'b')};
   showList([first,second]);selectedPrintKeys=items.map(actionSelectionKeyV660);updatePrintSelectedButton();
 });
 const requests=[];page.on('request',req=>{if(req.url().includes('/api/data'))requests.push(req.url());});
 await page.locator('#mergeSelectedListingsBtnV99').click();
 const rows=page.locator('#selectedMergeDialogV99 label');
 await expect(rows).toHaveCount(2);
 await expect(rows.nth(0).locator('input')).toHaveValue('FIXTURE-LEASE-2');await expect(rows.nth(0).locator('input')).toBeChecked();
 await expect(rows.nth(0)).toContainText('목록 1번');await expect(rows.nth(0)).toContainText('26평');await expect(rows.nth(0)).toContainText('동일매물 4개');
 await expect(rows.nth(1)).toContainText('목록 2번');await expect(rows.nth(1)).toContainText('31평');await expect(rows.nth(1)).toContainText('동일매물 2개');
 await expect(rows.nth(0).locator('img')).toHaveAttribute('src',/merge-photo-a/);await expect(rows.nth(1).locator('img')).toHaveAttribute('src',/merge-photo-b/);
 await expect.poll(()=>rows.nth(0).locator('img').evaluate(img=>img.naturalWidth)).toBe(80);
 expect(requests).toEqual([]);
 expect(await page.locator('#selectedMergeDialogV99').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 await mkdir('outputs/v102',{recursive:true});await page.screenshot({path:'outputs/v102/choices-'+(isMobile?'mobile':'desktop')+'.png'});
 // A sort behind the open chooser cannot retarget the already chosen ID.
 const writes=[];
 await page.route('**/api/data',async route=>{
   const body=route.request().postDataJSON();if(body.action!=='consolidateExistingMasters')return route.fallback();
   writes.push(body);await route.fulfill({json:response(body.primaryMasterId,body.duplicateMasterIds)});
 });
 await page.evaluate(()=>{visibleListItems.reverse();JSUnifiedListingsV8.finishSelectedMerge=()=>{};});
 await rows.nth(1).locator('input').check();await page.locator('#selectedMergeDialogV99 [data-submit]').click();
 await expect(page.locator('#selectedMergeDialogV99')).not.toBeVisible();
 expect(writes).toHaveLength(1);expect(writes[0].primaryMasterId).toBe('FIXTURE-LEASE-1');
 expect(writes[0].duplicateMasterIds).toEqual(['FIXTURE-LEASE-2']);
});

test('off-screen virtual choices retain list positions and hidden selections are clearly identified',async({page,isMobile})=>{
 await setup(page,isMobile);
 await page.evaluate(()=>{
   const items=allItems.filter(i=>i.tradeType==='lease');
   const fillers=Array.from({length:70},(_,i)=>({...items[0],propertyId:'FILLER-'+i,key:'filler-'+i}));
   showList([items[1],...fillers,items[0]]);selectedPrintKeys=items.map(actionSelectionKeyV660);updatePrintSelectedButton();
 });
 await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"]')).toHaveCount(0);
 await page.locator('#mergeSelectedListingsBtnV99').click();
 await expect(page.locator('#selectedMergeDialogV99 label').nth(1)).toContainText('목록 72번');
 await page.locator('#selectedMergeDialogV99 [data-cancel]').click();
 await page.evaluate(()=>{visibleListItems=visibleListItems.slice(0,1);});
 await page.locator('#mergeSelectedListingsBtnV99').click();
 await expect(page.locator('#selectedMergeDialogV99 label')).toHaveCount(2);
 await expect(page.locator('#selectedMergeDialogV99 label').nth(1)).toContainText('현재 목록 밖 선택');
 // Unknown area must not turn into 0평, and changes while reviewing block save.
 await page.locator('#selectedMergeDialogV99 [data-cancel]').click();
 await page.evaluate(()=>{allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1').displayValuePresence={area:false};});
 await page.locator('#mergeSelectedListingsBtnV99').click();
 await expect(page.locator('#selectedMergeDialogV99 label').nth(1)).toContainText('면적 미확인');
 await page.evaluate(()=>{allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1').memo='외부 변경';window.__unexpectedWrite=false;JSDataAccessV6={...JSDataAccessV6,mutate:()=>{__unexpectedWrite=true;}};});
 await page.locator('#selectedMergeDialogV99 [data-submit]').click();
 await expect(page.locator('.merge-message-v99')).toContainText('선택 매물이나 계정이 변경');
 expect(await page.evaluate(()=>__unexpectedWrite)).toBe(false);
});

test('confirmed status survives choosing a pending representative immediately and after scoped reload',async({page,context,isMobile})=>{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await setup(page,isMobile);
 await page.evaluate(()=>{
  allItems.find(i=>i.propertyId==='FIXTURE-LEASE-1').memo='(확인매물) / 확인 메모\n둘째 줄';
  allItems.find(i=>i.propertyId==='FIXTURE-LEASE-2').memo='(임장가자) / 미확인 메모\n다음 줄';
  applyFilter();
 });
 const memo='(확인매물) / 미확인 메모\n다음 줄\n\n확인 메모\n둘째 줄';
 let releaseRead;const readGate=new Promise(resolve=>{releaseRead=resolve;});
 await page.route('**/api/data',async route=>{
  const body=route.request().postDataJSON();if(body.action!=='consolidateExistingMasters')return route.fallback();
  await route.fulfill({json:{...response(body.primaryMasterId,body.duplicateMasterIds),confirmedVisit:true,primaryOperatingMemo:memo}});
 });
 await page.route('**/api/data?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('action')!=='listingOriginals')return route.fallback();
  await readGate;
  const primary='FIXTURE-LEASE-2',other='FIXTURE-LEASE-1';
  await route.fulfill({json:{ok:true,requestedIds:[primary,other],missingIds:[other],items:[{property_id:primary,title:'병합 대표',address:'대전 서구 탄방동 2-2',room:'2층',listing_type:'상가',trade_type:'lease',deposit:3000,monthly_rent:150,area_m2:40,status:'active',source_snapshot_key:proof,operating_memo:memo}],
   unified:{ok:true,format:'compact-v2',fields:['originalId','source','rent'],groups:{[primary]:[['ad-one','네이버',90],['ad-two','당근',150]]},sourceSnapshotKeys:{[primary]:proof},sourceSnapshotPropertyIds:{[primary]:primary},sourceSearchIds:{}}}});
 });
 await page.locator('#mergeSelectedListingsBtnV99').click();await page.locator('input[value="FIXTURE-LEASE-2"]').check();
 await page.locator('#selectedMergeDialogV99 [data-submit]').click();await expect(page.locator('#selectedMergeDialogV99')).not.toBeVisible();
 const result=()=>page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='FIXTURE-LEASE-2');return {confirmed:isConfirmedVisitItem(item),pending:isFieldVisitItem(item),cluster:getFieldVisitClusterClassV684({items:[item]},false),memo:item.memo};});
 await expect.poll(async()=> (await result()).confirmed).toBe(true);
 expect(await result()).toEqual({confirmed:true,pending:false,cluster:' visit-confirmed-v89',memo});
 await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"] .verification-done-v661')).toHaveText('확인');
 releaseRead();await expect.poll(()=>page.evaluate(()=>allItems.some(i=>i.propertyId==='FIXTURE-LEASE-1'))).toBe(false);
 expect(await result()).toEqual({confirmed:true,pending:false,cluster:' visit-confirmed-v89',memo});
 await expect(page.locator('#list .item[data-property-id="FIXTURE-LEASE-2"] .verification-pending-v661')).toHaveCount(0);
});

test('v202 same-building provider categories reach review and merge only the chosen sale masters with both originals intact',async({page,context,isMobile})=>{
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await setup(page,isMobile);
 await page.evaluate(()=>{
  const items=allItems.filter(i=>i.tradeType==='lease').map((i,index)=>({...i,tradeType:'sale',saleCategory:index?'building':'mixed_house',type:index?'건물전체':'상가주택',name:index?'노블레스':'상가주택',address:'서구 가장동 56-29',room:'전체',salePrice:114000,saleDetails:{grossAreaM2:index?476:476.7,totalDeposit:index?17800:18000,monthlyIncome:597}}));
  allItems=items;JSUnifiedListingsV8.attach(items,{ok:true,groups:Object.fromEntries(items.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-O',source:i.propertyId.endsWith('1')?'네이버':'당근'}]]))});
  JSListingTradeV1.setMode('building_sale');showList(items);selectedPrintKeys=items.map(actionSelectionKeyV660);updatePrintSelectedButton();
 });
 const before=await page.evaluate(()=>JSON.stringify(allItems)),writes=[];
 await page.route('**/api/data',async route=>{if(route.request().method()!=='POST')return route.fallback();const body=route.request().postDataJSON();if(body.action!=='consolidateExistingMasters')return route.fallback();writes.push(body);await route.fulfill({json:response(body.primaryMasterId,body.duplicateMasterIds)});});
 await page.route('**/api/data?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('action')!=='listingOriginals')return route.fallback();
  await route.fulfill({json:{ok:true,requestedIds:['FIXTURE-LEASE-2','FIXTURE-LEASE-1'],missingIds:['FIXTURE-LEASE-1'],items:[{property_id:'FIXTURE-LEASE-2',title:'노블레스',address:'서구 가장동 56-29',room:'전체',listing_type:'건물전체',trade_type:'sale',sale_category:'building',sale_price:114000,sale_details_json:JSON.stringify({grossAreaM2:476,totalDeposit:17800,monthlyIncome:597}),status:'active',source_snapshot_key:proof,operating_memo:'보존된 메모'}],
   unified:{ok:true,format:'compact-v2',fields:['originalId','source','tradeType','saleCategory','salePrice','saleSummary'],groups:{'FIXTURE-LEASE-2':[['sale-one','네이버','sale','mixed_house',114000,{grossAreaM2:476.7,totalDeposit:18000,monthlyIncome:597}],['sale-two','당근','sale','building',114000,{grossAreaM2:476,totalDeposit:17800,monthlyIncome:597}]]},sourceSnapshotKeys:{'FIXTURE-LEASE-2':proof},sourceSnapshotPropertyIds:{'FIXTURE-LEASE-2':'FIXTURE-LEASE-2'},sourceSearchIds:{}}}});
 });
 await page.locator('#mergeSelectedListingsBtnV99').click();const dialog=page.locator('#selectedMergeDialogV99');await expect(dialog).toBeVisible();await expect(dialog.locator('label')).toHaveCount(2);
 await expect(dialog).toContainText('상가주택');await expect(dialog).toContainText('노블레스');expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toEqual([]);
 await page.locator('input[value="FIXTURE-LEASE-2"]').check();await dialog.screenshot({path:'outputs/v202-merge-review-'+(isMobile?'mobile':'desktop')+'.png'});
 await dialog.locator('[data-submit]').click();await expect(dialog).not.toBeVisible();await expect.poll(()=>page.evaluate(()=>allItems.some(i=>i.propertyId==='FIXTURE-LEASE-1'))).toBe(false);
 expect(writes).toHaveLength(1);expect(writes[0].primaryMasterId).toBe('FIXTURE-LEASE-2');expect(writes[0].duplicateMasterIds).toEqual(['FIXTURE-LEASE-1']);
 expect(await page.evaluate(()=>JSUnifiedListingsV8.allOriginals('FIXTURE-LEASE-2').map(i=>i.saleCategory).sort())).toEqual(['building','mixed_house']);
 expect(await page.evaluate(()=>{const i=allItems.find(i=>i.propertyId==='FIXTURE-LEASE-2');return [i.tradeType,i.saleCategory,i.salePrice];})).toEqual(['sale','building',114000]);
});

test('v202 cross-market and explicit unknown transaction selections cannot open the merge review or send writes',async({page,isMobile})=>{
 await setup(page,isMobile);const alerts=[],writes=[];page.on('dialog',async d=>{alerts.push(d.message());await d.dismiss();});page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
 for(const [trade,category] of [['sale','land'],['lease',''],['unexpected','building'],['sale','unrecognized-category']]){
  await page.evaluate(({trade,category})=>{
   const base=allItems.filter(i=>i.propertyId==='FIXTURE-LEASE-1'||i.propertyId==='FIXTURE-LEASE-2');
   base[0].tradeType='sale';base[0].saleCategory='mixed_house';base[1].tradeType=trade;base[1].saleCategory=category;
   JSListingTradeV1.setMode('building_sale');showList(base);selectedPrintKeys=base.map(actionSelectionKeyV660);updatePrintSelectedButton();
  },{trade,category});
  await page.locator('#mergeSelectedListingsBtnV99').click();await expect(page.locator('#selectedMergeDialogV99')).not.toBeVisible();
 }
 expect(alerts).toHaveLength(4);expect(alerts.every(s=>s.includes('거래유형'))).toBe(true);expect(writes).toEqual([]);
});
