import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const mapSource=await readFile('js/map.js','utf8'),ast=ts.createSourceFile('map.js',mapSource,ts.ScriptTarget.Latest,true);
const pendingGuard=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='originalMetadataMutationPendingV1').getText(ast);
const card=(page,id)=>page.locator('#list .item[data-property-id="'+id+'"]');
async function setup(page,context,isMobile) {
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.addScriptTag({content:pendingGuard});
 await page.evaluate(()=>{
   const base=allItems[0];
   const make=(id,n)=>{const row={...base,propertyId:id,name:'일반상가',address:'서구 괴정동 1-37',room:'1층',memo:n+'번 기존 메모',sheetRow:n};row.key=itemKey(row);return row;};
   const first=make('MEMO-1',1),second=make('MEMO-2',2),third=make('MEMO-3',3);
   allItems=[second,third,first];currentItems=[{...first},{...second},{...third}];showList(currentItems);
   window.__memoCacheClears=0;window.JSInitialListingsCacheV1={clear(){__memoCacheClears++;}};
 });
 if(isMobile) {
   // Inline memo actions use the existing desktop/phone landscape list.
   await page.setViewportSize({width:930,height:530});
   await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
   await page.evaluate(()=>JSMapListPanelV1.open());
 }
 await page.locator('#fixtureControls').evaluate(el=>el.remove());
}
async function edit(page,id,text,mode='수정') {
 const row=card(page,id);await row.getByRole('button',{name:'메모 열기',exact:true}).click();
 await row.getByRole('button',{name:mode,exact:true}).click();await row.locator('textarea').fill(text);
 return row;
}
test('same parcel and same legacy key save only the clicked master, including displayed clones and re-render',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const writes=[];
 await page.route('**/api/data',async route=>{
   const body=route.request().postDataJSON();if(body.action!=='updatePropertyMemo')return route.fallback();
   writes.push(body);await route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:body.key.propertyId,memo:body.memo,contacts:[]}});
 });
 await card(page,'MEMO-1').getByRole('button',{name:'메모 열기',exact:true}).click();
 await expect(card(page,'MEMO-1').locator('.item-memo-content')).toHaveText('1번 기존 메모');
 await card(page,'MEMO-1').getByRole('button',{name:'수정',exact:true}).click();
 await card(page,'MEMO-1').locator('textarea').fill('첫 번째 매물에만 저장');
 await page.evaluate(()=>{showList(visibleListItems);});
 await expect(card(page,'MEMO-1').locator('textarea')).toHaveValue('첫 번째 매물에만 저장');
 await card(page,'MEMO-1').getByRole('button',{name:'저장',exact:true}).click();
 await expect(card(page,'MEMO-1').locator('.memo-inline-status')).toHaveText('저장완료');
 expect(writes).toHaveLength(1);expect(writes[0].key.propertyId).toBe('MEMO-1');
 expect(await page.evaluate(()=>allItems.map(i=>[i.propertyId,i.memo]))).toEqual([['MEMO-2','2번 기존 메모'],['MEMO-3','3번 기존 메모'],['MEMO-1','첫 번째 매물에만 저장']]);
 expect(await page.evaluate(()=>__memoCacheClears)).toBeGreaterThan(0);
 await page.evaluate(()=>{showList(visibleListItems);});
 await expect(card(page,'MEMO-1').locator('.item-memo-content')).toHaveText('첫 번째 매물에만 저장');
 await expect(card(page,'MEMO-2').locator('.item-memo-panel')).toHaveCount(0);
 await expect(card(page,'MEMO-3').locator('.item-memo-panel')).toHaveCount(0);
 const second=await edit(page,'MEMO-2','두 번째 추가','추가하기');await second.getByRole('button',{name:'저장',exact:true}).click();
 await expect(second.locator('.memo-inline-status')).toHaveText('저장완료');expect(writes[1].key.propertyId).toBe('MEMO-2');
 expect(writes[1].memo).toMatch(/^2번 기존 메모\n\[\d{2}\.\d{2}\.\d{2}\] 두 번째 추가$/);
});

for(const fail of [false,true])test('a late '+(fail?'failure':'success')+' for the first memo preserves another master editor and draft',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);let release;const pending=new Promise(resolve=>{release=resolve;});let sent;
 await page.route('**/api/data',async route=>{
   const body=route.request().postDataJSON();if(body.action!=='updatePropertyMemo')return route.fallback();sent=body;await pending;
   await route.fulfill(fail?{status:400,json:{ok:false,message:'검사 저장 실패'}}:{json:{ok:true,persisted:true,propertyId:body.key.propertyId,memo:body.memo,contacts:[]}});
 });
 const first=await edit(page,'MEMO-1','첫 매물 저장',fail?'추가하기':'수정');await first.getByRole('button',{name:'저장',exact:true}).click();
 await expect.poll(()=>sent?.key.propertyId).toBe('MEMO-1');
 expect(await page.evaluate(()=>['MEMO-1','MEMO-2'].map(id=>originalMetadataMutationPendingV1(allItems.find(i=>i.propertyId===id))))).toEqual([true,false]);
 const second=await edit(page,'MEMO-2','둘째 입력 유지');
 await page.evaluate(()=>{showList(visibleListItems);});
 await expect(second.locator('textarea')).toHaveValue('둘째 입력 유지');
 release();await expect.poll(()=>page.evaluate(()=>Object.keys(memoSavePendingKeysV655).length)).toBe(0);
 await expect(second.locator('textarea')).toHaveValue('둘째 입력 유지');
 await expect(first.locator('textarea')).toHaveCount(0);
 await page.evaluate(()=>{showList(visibleListItems);});
 await expect(second.locator('textarea')).toHaveValue('둘째 입력 유지');
 expect(await page.evaluate(()=>allItems.find(i=>i.propertyId==='MEMO-2').memo)).toBe('2번 기존 메모');
 if(fail) {
   await second.getByRole('button',{name:'메모 닫기',exact:true}).click();
   await first.getByRole('button',{name:'메모 열기',exact:true}).click();
   await first.getByRole('button',{name:'수정',exact:true}).click();
   await expect(first.locator('textarea')).toHaveValue('첫 매물 저장');
   expect(await page.evaluate(()=>memoEditMode)).toBe('append');
 }
});

test('merge guards see the edited master draft by its stable ID and release it after cancel',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});await page.addScriptTag({url:'/js/selected-listing-merge-v99.js'});
 await card(page,'MEMO-1').locator('input[type="checkbox"]').check();await card(page,'MEMO-2').locator('input[type="checkbox"]').check();
 const first=await edit(page,'MEMO-1','저장하지 않은 첫 매물 메모');
 let warning='';page.once('dialog',async dialog=>{warning=dialog.message();await dialog.accept();});
 await page.locator('#mergeSelectedListingsBtnV99').click();expect(warning).toContain('메모를 먼저 저장');
 await expect(page.locator('#selectedMergeDialogV99')).not.toBeVisible();
 await first.getByRole('button',{name:'취소',exact:true}).click();
 await page.locator('#mergeSelectedListingsBtnV99').click();await expect(page.locator('#selectedMergeDialogV99')).toBeVisible();
});
