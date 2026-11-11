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

for(const reuse of [false,true])test('typing keeps the same connected editor, caret and Korean composition through list refresh reuse='+reuse,async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const first=await edit(page,'MEMO-1','긴 메모 첫 줄\n둘째 줄 작성 중입니다');
 const editor=first.locator('textarea'),original=await editor.elementHandle();
 await editor.evaluate(el=>{window.__memoLiveEditor=el;window.__memoBlurCount=0;el.addEventListener('blur',()=>__memoBlurCount++);
   el.focus();el.setSelectionRange(12,15,'backward');el.dispatchEvent(new CompositionEvent('compositionstart',{data:'가',bubbles:true}));});
 for(let i=0;i<3;i++)await page.evaluate(({reuse,i})=>{
   const next=visibleListItems.map(item=>({...item,rent:item.propertyId==='MEMO-1'?180+i:item.rent}));
   window.jsReuseListCardsOnNextRenderV6521=reuse;showList(next);
 },{reuse,i});
 expect(await editor.evaluate((el,old)=>el===old,original)).toBe(true);
 expect(await editor.evaluate(el=>({focused:document.activeElement===el,connected:el.isConnected,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,blur:__memoBlurCount})))
   .toEqual({focused:true,connected:true,start:12,end:15,direction:'backward',blur:0});
 await expect(first.locator('.price-main')).toContainText('182');
 await editor.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{data:'가',bubbles:true})));
 await page.keyboard.type(' 계속 작성');
 expect(await editor.inputValue()).toContain(' 계속 작성');
 expect(await page.evaluate(()=>allItems.find(i=>i.propertyId==='MEMO-2').memo)).toBe('2번 기존 메모');
});

test('memo status expiry preserves the active editor and never takes focus back from another control',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const first=await edit(page,'MEMO-1','상태 갱신 중에도 입력 유지');
 const editor=first.locator('textarea'),original=await editor.elementHandle();
 await editor.evaluate(el=>{el.focus();el.setSelectionRange(4,4);});
 await page.evaluate(()=>showMemoStatusV655('property:MEMO-1','이전 저장완료','success',30));
 await expect(first.locator('.memo-inline-status')).toHaveCount(0);
 expect(await editor.evaluate((el,old)=>el===old&&document.activeElement===el&&el.selectionStart===4,original)).toBe(true);
 await page.locator('#keyword').click();await page.evaluate(()=>showList(visibleListItems));
 await expect(page.locator('#keyword')).toBeFocused();
});

test('a composing editor follows its exact master through reordered virtual windows, not a same-parcel sibling',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const first=await edit(page,'MEMO-1','자리 이동 중 작성할 긴 초안');
 const editor=first.locator('textarea'),original=await editor.elementHandle();
 await editor.evaluate(el=>{el.focus();el.setSelectionRange(7,7);});
 await page.evaluate(()=>{
   const target=allItems.find(i=>i.propertyId==='MEMO-1');
   const prefix=Array.from({length:90},(_,i)=>({...target,propertyId:'PREFIX-'+i,sheetRow:100+i,memo:'다른 원장'}));
   showList([...prefix,...visibleListItems.map(i=>({...i}))]);
 });
 expect(await editor.evaluate((el,old)=>el===old&&document.activeElement===el&&el.selectionStart===7,original)).toBe(true);
 await page.evaluate(()=>showList(visibleListItems.filter(i=>i.propertyId!=='MEMO-1')));
 await expect(card(page,'MEMO-1')).toHaveCount(0);await expect(page.locator('#list textarea')).toHaveCount(0);
 expect(await page.evaluate(()=>memoDraftValuesV655['property:MEMO-1'])).toBe('자리 이동 중 작성할 긴 초안');
 expect(await page.evaluate(()=>allItems.find(i=>i.propertyId==='MEMO-2').memo)).toBe('2번 기존 메모');
});

test('long append-mode typing survives status and list updates and continues without another click',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);const first=await edit(page,'MEMO-1',('현장 기록을 길게 입력합니다.\n').repeat(30),'추가하기');
 const editor=first.locator('textarea'),original=await editor.elementHandle();
 await editor.press('Control+End');
 await page.evaluate(()=>{showMemoStatusV655('property:MEMO-1','안내','info',0);showList(visibleListItems);});
 expect(await editor.evaluate((el,old)=>el===old&&document.activeElement===el,original)).toBe(true);
 await page.keyboard.type('추가 입력 완료');expect(await editor.inputValue()).toMatch(/추가 입력 완료$/);
 expect(await page.evaluate(()=>memoEditMode)).toBe('append');
 await first.getByRole('button',{name:'취소',exact:true}).click();await expect(first.locator('textarea')).toHaveCount(0);
 expect(await page.evaluate(()=>memoDraftValuesV655['property:MEMO-1'])).toBeUndefined();
});
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

for(const mode of ['수정','추가하기'])test('v184 external manual phone columns do not falsely reject a committed building memo: '+mode,async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='MEMO-1');Object.assign(item,{tradeType:'sale',saleCategory:'building',source:'당근',landlordPhone:'010-1111-2222',tenantPhone:'010-3333-4444',manualFinancialFieldsV106:['landlord_phone','tenant_phone']});currentItems=allItems.map(i=>({...i}));showList(currentItems);window.__v184Writes=[];postSafeMutationV654=async(action,body)=>{__v184Writes.push({action,body});return {ok:true,persisted:true,queued:false,propertyId:body.key.propertyId,memo:body.memo,contacts:[{role:'관',phone:'010-5555-6666'}]};};});
 const first=await edit(page,'MEMO-1','관리소장)010-5555-6666\n현장 확인한 개인 메모',mode);
 await first.getByRole('button',{name:'저장',exact:true}).click();
 await expect(first.locator('textarea')).toHaveCount(0);await expect(first).toContainText('현장 확인한 개인 메모');
 const result=await page.evaluate(()=>({writes:__v184Writes,one:allItems.find(i=>i.propertyId==='MEMO-1'),two:allItems.find(i=>i.propertyId==='MEMO-2'),pending:Object.keys(memoSavePendingKeysV655)}));
 expect(result.writes).toHaveLength(1);expect(result.writes[0].body.expectedMemoV144).toBe('1번 기존 메모');
 expect(result.writes[0].body.contacts.map(c=>c.phone)).toEqual(['010-5555-6666']);
 expect(result.one.landlordPhone).toBe('010-1111-2222');expect(result.one.tenantPhone).toBe('010-3333-4444');
 expect(result.one.memo).toBe(result.writes[0].body.memo);expect(result.two.memo).toBe('2번 기존 메모');expect(result.pending).toEqual([]);
});

test('v184 a contact-index discrepancy never rolls back an exact committed memo or offers duplicate append',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);await page.evaluate(()=>{window.__v184WriteCount=0;postSafeMutationV654=async(action,body)=>{__v184WriteCount++;return{ok:true,persisted:true,propertyId:body.key.propertyId,memo:body.memo,contacts:[]};};});
 const first=await edit(page,'MEMO-1','임대인)010-5555-6666\n한 번만 추가할 기록','추가하기');await first.getByRole('button',{name:'저장',exact:true}).click();
 await expect(first.locator('textarea')).toHaveCount(0);await expect(first.locator('.memo-inline-status')).toContainText('메모 저장완료 · 연락처목록 반영 확인 필요');
 expect(await page.evaluate(()=>({count:__v184WriteCount,memo:allItems.find(i=>i.propertyId==='MEMO-1').memo,draft:memoDraftValuesV655['property:MEMO-1']||null}))).toMatchObject({count:1,draft:null});
 await expect(first).toContainText('한 번만 추가할 기록');
});
