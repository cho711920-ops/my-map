import {test,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../../js/map.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('map.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['listingChangeRowToItemV683','parseDirectSaleDetailsV1','scopedReadLocalValuesV1','captureScopedReadV1','originalMetadataMutationPendingV1','applyScopedListingsV1','refreshMovedListingsV99']);
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
