import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const expected='괴정동 1-37 일반상가 1층 상가 11평 월2000에55 출입기준';
async function setup(page,context,isMobile){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});await page.addScriptTag({url:'/js/visit-kakao-share-v101.js'});
 await page.evaluate(()=>{
   window.__visitShareCalls=[];window.__visitCopied=[];
   const key=document.createElement('script');key.type='application/json';key.src='https://dapi.kakao.com/v2/maps/sdk.js?appkey='+'1'.repeat(32);document.head.appendChild(key);
   window.Kakao={isInitialized:()=>true,Share:{sendDefault:payload=>__visitShareCalls.push(payload)}};
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>__visitCopied.push(text)}});
   Object.defineProperty(navigator,'geolocation',{configurable:true,get(){throw Error('Visit sharing must not read GPS');}});
   const item={...allItems[0],name:'일반상가',address:'서구 괴정동 1-37',room:'1층',type:'상가점포',area:11,deposit:2000,rent:55,memo:'현장 메모 보존'};
   allItems=[item];JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{[item.propertyId]:[{...item,propertyId:item.propertyId,originalId:'visit-ad',sourceId:'visit-ad',active:1,revision:1}]}});
   applyFilter();selectedPrintKeys=[actionSelectionKeyV660(item)];showList(allItems);
   window.loadSheet=()=>{};
 });
 if(isMobile)await page.locator('[data-mobile-view="list"]').click();
 return errors;
}
test('saved visit generates the exact note; share happens only after explicit click and copy preserves all text',async({page,context,isMobile})=>{
 const errors=await setup(page,context,isMobile);let writes=0;
 await page.route('**/api/data',async route=>{
   const body=route.request().postDataJSON();if(body?.action!=='toggleDone')return route.fallback();writes++;
   await route.fulfill({json:{ok:true,persisted:true,queued:false}});
 });
 page.once('dialog',dialog=>dialog.accept());await page.locator('#selectionActionBar .selection-visit-btn').click();
 const modal=page.locator('#visitKakaoShareDialogV101');await expect(modal).toBeVisible();await expect(modal.locator('textarea')).toHaveValue(expected);
 expect(await page.evaluate(()=>__visitShareCalls.length)).toBe(0);expect(writes).toBe(1);
 await expect(modal.locator('[data-share]')).toBeEnabled();await modal.locator('[data-copy]').click();expect(await page.evaluate(()=>__visitCopied)).toEqual([expected]);
 await modal.locator('[data-share]').click();const calls=await page.evaluate(()=>__visitShareCalls);
 expect(calls).toHaveLength(1);expect(calls[0].text).toBe(expected);expect(calls[0].objectType).toBe('text');
 await expect(modal.locator('[role="status"]')).toHaveText('카카오톡에서 보낼 채팅방을 선택해 주세요.');
 await mkdir('outputs/v101',{recursive:true});await page.screenshot({path:'outputs/v101/visit-share-'+(isMobile?'mobile':'desktop')+'.png'});
 expect(errors).toEqual([]);
});
test('a failed visit save never opens a share draft or submits Kakao content',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);await page.route('**/api/data',route=>route.request().postDataJSON()?.action==='toggleDone'?route.fulfill({status:400,json:{ok:false,message:'검사 저장 실패'}}):route.fallback());
 const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
 await page.locator('#selectionActionBar .selection-visit-btn').click();
 await expect.poll(()=>dialogs.length).toBe(2);await expect(page.locator('#visitKakaoShareDialogV101')).toHaveCount(0);
 expect(await page.evaluate(()=>__visitShareCalls.length)).toBe(0);
});
test('long notes can be copied whole without silently truncating or submitting a partial Kakao message',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.evaluate(()=>JSVisitKakaoShareV101.open({owner:JSAuthenticatedAccountEmail,lines:Array.from({length:6},()=>JSVisitKakaoShareV101.format(allItems[0]))}));
 const modal=page.locator('#visitKakaoShareDialogV101');await expect(modal).toBeVisible();await expect(modal.locator('[data-share]')).toBeDisabled();
 await modal.locator('[data-copy]').click();expect(await page.evaluate(()=>__visitCopied[0].split('\n').length)).toBe(6);
 expect(await page.evaluate(()=>__visitShareCalls.length)).toBe(0);
});
test('a share UI failure never rolls back a saved visit and its refresh stays scoped',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.evaluate(()=>{
   window.JSVisitKakaoShareV101.open=()=>{throw Error('fixture share UI failure');};
   window.__visitRefreshIds=[];window.JSListingRefreshV1={refreshMoved:async result=>{__visitRefreshIds.push(result.affectedPropertyIds);return true;}};
   window.JSInitialListingsCacheV1={clear(){window.__visitCacheCleared=true;}};
   window.loadSheet=()=>{throw Error('unexpected full download');};
 });
 await page.route('**/api/data',route=>route.request().postDataJSON()?.action==='toggleDone'?route.fulfill({json:{ok:true,persisted:true,queued:false}}):route.fallback());
 const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
 await page.locator('#selectionActionBar .selection-visit-btn').click();
 await expect.poll(()=>page.evaluate(()=>__visitRefreshIds.length)).toBe(1);
 expect(dialogs).toEqual(['임장을 완료할까요?']);
 expect(await page.evaluate(()=>allItems[0].memo)).toContain('(확인매물)');
 expect(await page.evaluate(()=>allItems[0].memo)).toContain('현장 메모 보존');
 expect(await page.evaluate(()=>__visitCacheCleared)).toBe(true);
});
