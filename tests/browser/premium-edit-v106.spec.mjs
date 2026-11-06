import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const mapSource=await readFile('js/map.js','utf8'),mapAst=ts.createSourceFile('map.js',mapSource,ts.ScriptTarget.Latest,true);
const names=new Set(['listingChangeRowToItemV683','parseDirectSaleDetailsV1','scopedReadLocalValuesV1','captureScopedReadV1','originalMetadataMutationPendingV1','applyScopedListingsV1','persistCompleteDeltaCacheV125','refreshMovedListingsV99']);
const refreshRuntime=mapAst.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(mapAst)).join('\n');
async function setup(page,context,isMobile) {
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 if(isMobile){await page.setViewportSize({width:930,height:530});await page.evaluate(()=>JSMapListPanelV1.open());}
 await page.locator('#fixtureControls').evaluate(el=>el.remove());
 await page.evaluate(()=>{
   const base=allItems[0];allItems=[{...base,propertyId:'PREMIUM-A',premium:2000},{...base,propertyId:'PREMIUM-B',premium:3300}];
   const groups=Object.fromEntries(allItems.map(item=>[item.propertyId,[{...item,originalId:item.propertyId+'-ad',sourceId:item.propertyId+'-ad',buildingName:item.name,images:[],photoCount:0,manualDisplayFields:''}]]));
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups});applyFilter();
   window.__refreshes=[];window.__cacheCleared=0;window.JSInitialListingsCacheV1={clear(){__cacheCleared++;}};
   window.JSListingRefreshV1={refreshMoved:async result=>{__refreshes.push(result);return true;}};
   window.loadSheet=()=>{throw Error('Whole inventory read is unnecessary for one edit');};
 });
}
const card=(page,id)=>page.locator('#list .item[data-property-id="'+id+'"]');
for(const room of ['지하1층','-1'])test('re-entering '+room+' as the stored basement explicitly corrects an unknown preferred source and keeps the neighbor',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.evaluate(()=>{
   allItems[0].room='지하1층';allItems[1].room='4층';
   const original=(id,source,room,floor)=>({propertyId:id,originalId:id+'-'+source,source,room,floor,active:1,
     deposit:2000,rent:90,area:25,manualDisplayFields:''});
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{
     'PREMIUM-A':[original('PREMIUM-A','당근','',''),original('PREMIUM-A','네이버','지하1층',-1)],
     'PREMIUM-B':[original('PREMIUM-B','네이버','4층',4)]}});applyFilter();
 });
 let sent;
 await page.route('**/api/data',async r=>{const body=r.request().postDataJSON();if(body.action!=='updateProperty')return r.fallback();sent=body;
   await r.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:'PREMIUM-A',changedFields:['room'],updated:{...body.updated,room:'지하1층'}}});
 });
 await expect(card(page,'PREMIUM-A').locator('.item-room-badge')).toContainText(/층수 미확인|호실 -/);
 await card(page,'PREMIUM-A').getByRole('button',{name:'임대조건 수정',exact:true}).click();
 await expect(page.locator('#peRoomV630')).toHaveValue('지하1층');
 await page.locator('#peRoomV630').fill(room);await page.locator('#propertyEditSaveBtnV630').click();
 await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
 expect(sent.editedFields).toEqual(['room']);expect(sent.key.propertyId).toBe('PREMIUM-A');
 await expect(card(page,'PREMIUM-A').locator('.item-room-badge')).toContainText('지하1층');
 await expect(card(page,'PREMIUM-B').locator('.item-room-badge')).toContainText('4층');
 await page.evaluate(()=>JSUnifiedListingsV8.toggleCardDetail(encodeURIComponent('PREMIUM-A')));
 await expect(page.locator('#unifiedDetailBodyV8')).toContainText('지하1층');
 // Opening another master must clear the touched-field intent.
 await page.evaluate(()=>{JSUnifiedListingsV8.close();openPropertyEditModalV630(encodeURIComponent('id:PREMIUM-B'));});
 expect(await page.evaluate(()=>propertyEditRoomTouchedV130)).toBe(false);
});
for(const [room,ended] of [['지하1층',false],['-1',false],['-1',true]])test('manual floor '+room+(ended?' on an archived candidate':'')+' immediately replaces source floor only on the selected master',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.evaluate(ended=>{
   if(ended)hideDone=false;
   const groups=Object.fromEntries(allItems.map(item=>[item.propertyId,[{...item,room:'2층',floor:2,
     active:ended?0:1,sourceUnavailable:ended,availabilityKind:ended?'census_missing':'',candidateEligible:ended,
     originalId:item.propertyId+'-ad',propertyId:item.propertyId,buildingName:item.name,manualDisplayFields:''}]]));
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups});applyFilter();
 },ended);
 let sent;
 await page.route('**/api/data',async r=>{const body=r.request().postDataJSON();if(body.action!=='updateProperty')return r.fallback();sent=body;
   await r.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:'PREMIUM-A',changedFields:['room'],updated:body.updated}});
 });
 await expect(card(page,'PREMIUM-A').locator('.item-room-badge')).toContainText('2층');
 await card(page,'PREMIUM-A').getByRole('button',{name:'임대조건 수정',exact:true}).click();
 await page.locator('#peRoomV630').fill(room);await page.locator('#propertyEditSaveBtnV630').click();
 await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
 await expect(card(page,'PREMIUM-A').locator('.item-room-badge')).toContainText('지하1층');
 await expect(card(page,'PREMIUM-B').locator('.item-room-badge')).toContainText('2층');
 expect(sent.key.propertyId).toBe('PREMIUM-A');expect(sent.updated.room).toBe(room);
 await page.evaluate(()=>applyFilter());
 await expect(card(page,'PREMIUM-A').locator('.item-room-badge')).toContainText('지하1층');
 await page.evaluate(()=>JSUnifiedListingsV8.toggleCardDetail(encodeURIComponent('PREMIUM-A')));
 await expect(page.locator('#unifiedDetailBodyV8')).toContainText('지하1층');
 // Simulate a reload from the server's history-backed manual override.
 await page.evaluate(()=>{
   JSUnifiedListingsV8.close();allItems=allItems.map(item=>{const copy={...item};delete copy.manualFinancialFieldsV106;return copy;});
   const groups=Object.fromEntries(allItems.map(item=>[item.propertyId,[{...item,room:'2층',floor:2,
     originalId:item.propertyId+'-ad',propertyId:item.propertyId,buildingName:item.name,manualDisplayFields:item.propertyId==='PREMIUM-A'?'room':''}]]));
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups});applyFilter();
 });
 await expect(card(page,'PREMIUM-A').locator('.item-room-badge')).toContainText('지하1층');
 await expect(card(page,'PREMIUM-B').locator('.item-room-badge')).toContainText('2층');
});
for(const amount of [800,0])test('saved premium '+amount+' replaces stale source terms immediately without altering another same-parcel master',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);let sent;
 await page.route('**/api/data',async r=>{const body=r.request().postDataJSON();if(body.action!=='updateProperty')return r.fallback();sent=body;await r.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:'PREMIUM-A',changedFields:['premium'],updated:{...body.updated,premium:amount}}});});
 await expect(card(page,'PREMIUM-A').locator('.price-premium')).toContainText('2,000');
 await card(page,'PREMIUM-A').getByRole('button',{name:'임대조건 수정',exact:true}).click();await page.locator('#pePremiumV630').fill(String(amount));await page.locator('#propertyEditSaveBtnV630').click();
 await expect(page.locator('#propertyEditModalV630')).not.toHaveClass(/open/);
 await expect(card(page,'PREMIUM-A').locator('.price-premium')).toContainText(new RegExp('권\\s*'+amount.toLocaleString('ko-KR')+'$'));
 await expect(card(page,'PREMIUM-B').locator('.price-premium')).toContainText(/권\s*3,300$/);
 expect(sent.key.propertyId).toBe('PREMIUM-A');expect(sent.updated.premium).toBe(amount);
 expect(await page.evaluate(()=>JSUnifiedListingsV8.allOriginals('PREMIUM-A')[0].premium)).toBe(2000);
 await page.evaluate(()=>applyFilter());await expect(card(page,'PREMIUM-A').locator('.price-premium')).toContainText(new RegExp('권\\s*'+amount.toLocaleString('ko-KR')+'$'));
 expect(await page.evaluate(()=>__cacheCleared)).toBeGreaterThan(0);expect(await page.evaluate(()=>__refreshes.map(r=>r.affectedPropertyIds))).toEqual([['PREMIUM-A']]);
 await page.evaluate(()=>JSUnifiedListingsV8.toggleCardDetail(encodeURIComponent('PREMIUM-A')));
 await expect(page.locator('#unifiedDetailBodyV8 .unified-detail-manual-condition-v106')).toBeVisible();
 await expect(page.locator('#unifiedDetailBodyV8')).toContainText(amount.toLocaleString('ko-KR'));
 // A fresh server snapshot carries history-backed manual flags, rather than
 // relying on the temporary post-save browser marker.
 await page.evaluate(()=>{
   JSUnifiedListingsV8.close();allItems=allItems.map(item=>{const row={...item};delete row.manualFinancialFieldsV106;return row;});
   const groups=Object.fromEntries(allItems.map(item=>[item.propertyId,[{...item,premium:item.propertyId==='PREMIUM-A'?2100:3300,originalId:item.propertyId+'-ad',buildingName:item.name,images:[],photoCount:0,manualDisplayFields:item.propertyId==='PREMIUM-A'?'premium':''}]]));
   JSUnifiedListingsV8.attach(allItems,{ok:true,groups});applyFilter();
 });
 await expect(card(page,'PREMIUM-A').locator('.price-premium')).toContainText(new RegExp('권\\s*'+amount.toLocaleString('ko-KR')+'$'));
});

test('a saved premium refreshes only its master and current manual-display metadata from the server',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);await page.addScriptTag({content:refreshRuntime});const reads=[];
 await page.evaluate(()=>{
   jsListingsLoadGenerationV1=1;jsListingsRevisionV682='complete-base';jsListingsCompleteBaseV1=true;
   window.ensureCompleteBaseV1=()=>{};window.captureAutoUpdateViewState=()=>({});window.restoreAutoUpdateViewState=()=>{};window.notifyListingsSnapshotV1=()=>{};
   JSListingRefreshV1.refreshMoved=refreshMovedListingsV99;
 });
 await page.route('**/api/data',async route=>{const body=route.request().postDataJSON();if(body.action!=='updateProperty')return route.fallback();await route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:'PREMIUM-A',changedFields:['premium'],updated:body.updated}});});
 await page.route('**/api/data?*',async route=>{
   const query=new URL(route.request().url()).searchParams;reads.push(query.get('action'));if(query.get('action')!=='listingOriginals')return route.fallback();
   expect(query.get('ids')).toBe('PREMIUM-A');const proof='sha256-v1:'+'8'.repeat(64);
   await route.fulfill({json:{ok:true,requestedIds:['PREMIUM-A'],missingIds:[],items:[{property_id:'PREMIUM-A',title:'테스트 괴정 상가',address:'대전 서구 괴정동 1-1',room:'1층',listing_type:'상가',trade_type:'lease',premium:800,deposit:2000,monthly_rent:90,maintenance_fee:0,area_m2:25,status:'active',source_snapshot_key:proof}],
     unified:{ok:true,groups:{'PREMIUM-A':[{propertyId:'PREMIUM-A',originalId:'PREMIUM-A-ad',source:'네이버',tradeType:'lease',premium:2000,deposit:2000,rent:90,fee:0,area:25,manualDisplayFields:'premium'}]},sourceSnapshotKeys:{'PREMIUM-A':proof},sourceSnapshotPropertyIds:{'PREMIUM-A':'PREMIUM-A'},sourceSearchIds:{}}}});
 });
 await card(page,'PREMIUM-A').getByRole('button',{name:'임대조건 수정',exact:true}).click();await page.locator('#pePremiumV630').fill('800');await page.locator('#propertyEditSaveBtnV630').click();
 await expect.poll(()=>page.evaluate(()=>allItems.find(i=>i.propertyId==='PREMIUM-A').sourceSnapshotKey)).toBe('sha256-v1:'+'8'.repeat(64));
 await expect(card(page,'PREMIUM-A').locator('.price-premium')).toContainText(/권\s*800$/);await expect(card(page,'PREMIUM-B').locator('.price-premium')).toContainText(/권\s*3,300$/);
 await expect(page.locator('#status')).not.toContainText('동기화 중');
 expect(await page.evaluate(()=>pendingPropertyEditStateV634)).toBeNull();
 expect(reads.filter(action=>action==='listingOriginals')).toHaveLength(1);expect(reads).not.toContain('unifiedListings');
});
