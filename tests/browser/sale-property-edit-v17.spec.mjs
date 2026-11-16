import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,market){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function seed(page,isMobile,market){await mode(page,isMobile,market);return page.evaluate(()=>{
  const id=document.querySelector('#list .item').dataset.propertyId,item=allItems.find(i=>i.propertyId===id);
  window.schedulePropertyEditReloadV634=()=>{};
  return {property_id:id,title:item.name,address:item.address,listing_type:item.type,room:item.room,deposit:777,monthly_rent:88,maintenance_fee:9,premium:10,area_m2:33,landlord_phone:'',tenant_phone:'',operating_memo:'검수용 기존 메모',status:'active',trade_type:'sale',sale_category:item.saleCategory,
    sale_price:99500,sale_details_json:JSON.stringify({...item.saleDetails,scope:item.saleCategory==='land'?'land':'whole_building',landAreaM2:160,totalDeposit:30000,monthlyIncome:350,descriptionText:'보존해야 할 원본 설명'})};
});}

for(const market of ['building_sale','land_sale'])test('common building name is consistent in '+market+' editor without copying its overlay into an unrelated condition save',async({page,isMobile})=>{
  const row=await seed(page,isMobile,market),writes=[];let version=1;row.title='광고 표시명과 다른 원장 이름';
  let registry={schema:164,buildings:[],contacts:[],names:[{parcel:await page.evaluate(address=>JSBuildingRegistryCoreV164.parcel(address),row.address),name:'공통 건물이름'}]};
  await page.route('**/api/data**',route=>{
    const req=route.request(),url=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||url.searchParams.get('action');
    if(action==='loadCloudState'&&url.searchParams.get('scope')==='buildingRegistryV164')return route.fulfill({json:{ok:true,found:true,scope:'buildingRegistryV164',recordKey:'default',version,data:registry}});
    if(action==='saveCloudState'&&body.scope==='buildingRegistryV164'){registry=body.data;version++;return route.fulfill({json:{ok:true,persisted:true,queued:false,scope:body.scope,recordKey:'default',version}});}
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes.push(body);return route.fulfill({status:503,json:{ok:false,message:'합성 저장 실패'}});}
    return route.fallback();
  });
  await page.evaluate(()=>JSBuildingRegistryV164.load(true));await page.locator('#list .item-edit-btn-v630').first().click();
  const dialog=page.locator('.sale-property-edit-v1'),name=dialog.locator('[data-sale-edit="name"]'),button=dialog.locator('.building-name-controls-v247 button');
  await expect(name).toHaveValue('공통 건물이름');await expect(button).toHaveText('✓ 공통 적용');
  await name.fill('변경한 공통 이름');await button.click();await expect(button).toHaveText('✓ 공통 적용');
  expect(registry.names[0].name).toBe('변경한 공통 이름');expect(writes).toEqual([]);
  await dialog.locator('[data-sale-edit="salePrice"]').fill('99600');await dialog.locator('[data-sale-edit-save]').click();
  await expect.poll(()=>writes.length).toBeGreaterThan(0);expect(writes[0].updated).not.toHaveProperty('name');
});
test('v235 building investment calculates on opening and each basis input, saves only its master and recalculates after reopening',async({page,isMobile})=>{
  const row=await seed(page,isMobile,'building_sale'),writes=[];row.sale_price=270000;
  row.sale_details_json=JSON.stringify({totalDeposit:155800,loanAmount:55000,investmentAmount:null,manualSaleFieldsV1:['investmentAmount'],descriptionText:'보존할 광고 원문'});
  await page.route('**/api/data**',route=>{const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes.push(body);const details=JSON.parse(row.sale_details_json),patch=body.saleEdit.patch;row.sale_price=patch.salePrice??row.sale_price;row.sale_details_json=JSON.stringify({...details,investmentAutoV235:!!body.saleEdit.investmentCalculationV235,...Object.fromEntries(Object.entries(patch).filter(([key])=>key!=='salePrice')),manualSaleFieldsV1:[...new Set([...(details.manualSaleFieldsV1||[]),...Object.keys(patch).filter(key=>key!=='salePrice')])]});return route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:row.property_id,updated:{salePrice:row.sale_price,saleDetails:JSON.parse(row.sale_details_json)}}});}return route.fallback();});
  const neighbors=await page.evaluate(id=>JSON.stringify(allItems.filter(item=>item.propertyId!==id)),row.property_id);
  const open=()=>page.locator('#list .item[data-property-id="'+row.property_id+'"] .item-edit-btn-v630').click();await open();const dialog=page.locator('.sale-property-edit-v1'),investment=dialog.locator('[data-sale-edit="investmentAmount"]');
  await expect(investment).toHaveValue('59200');await expect(dialog.locator('[data-sale-investment-mode-v235]')).toHaveText('자동계산');expect(writes).toEqual([]);
  const timing=await dialog.locator('[data-sale-edit="salePrice"]').evaluate(el=>{const start=performance.now();el.value='280000';el.dispatchEvent(new Event('input',{bubbles:true}));return {ms:performance.now()-start,value:el.form.querySelector('[data-sale-edit="investmentAmount"]').value};});
  expect(timing.ms).toBeLessThanOrEqual(250);expect(timing.value).toBe('69200');await dialog.locator('[data-sale-edit="salePrice"]').fill('270000');
  await dialog.locator('[data-sale-edit="totalDeposit"]').fill('150000');await expect(investment).toHaveValue('65000');await dialog.locator('[data-sale-edit="totalDeposit"]').fill('155800');
  await dialog.locator('[data-sale-edit="loanAmount"]').fill('0');await expect(investment).toHaveValue('114200');await dialog.locator('[data-sale-edit="loanAmount"]').fill('55000');await expect(investment).toHaveValue('59200');
  await expect(dialog.locator('[data-sale-money-preview="investmentAmount"]')).toHaveText('5억 9,200만원');await dialog.locator('[data-sale-edit-save]').click();await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);expect(writes[0].key.propertyId).toBe(row.property_id);expect(writes[0].saleEdit.patch).toEqual({salePrice:270000,totalDeposit:155800,loanAmount:55000,investmentAmount:59200});expect(writes[0].saleEdit.investmentCalculationV235).toMatchObject({salePrice:'270000',totalDeposit:'155800',loanAmount:'55000'});
  expect(JSON.parse(row.sale_details_json).descriptionText).toBe('보존할 광고 원문');expect(await page.evaluate(id=>JSON.stringify(allItems.filter(item=>item.propertyId!==id)),row.property_id)).toBe(neighbors);
  await expect(page.locator('#list .item[data-property-id="'+row.property_id+'"]')).toContainText('59,200만원');await open();await expect(investment).toHaveValue('59200');await expect(dialog.locator('[data-sale-investment-mode-v235]')).toHaveText('자동계산');
  await dialog.locator('[data-sale-edit="salePrice"]').fill('280000');await expect(investment).toHaveValue('69200');await dialog.locator('[data-sale-edit-cancel]').click();expect(writes).toHaveLength(1);
  await open();await investment.fill('59200');await dialog.locator('[data-sale-edit="salePrice"]').fill('280000');await expect(investment).toHaveValue('59200');await expect(dialog.locator('[data-sale-investment-mode-v235]')).toHaveText('직접입력');
  await dialog.locator('[data-sale-edit-save]').click();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(2);expect(writes[1].saleEdit.patch.investmentAmount).toBe(59200);expect(writes[1].saleEdit).not.toHaveProperty('investmentCalculationV235');expect(JSON.parse(row.sale_details_json).investmentAutoV235).toBe(false);
  row.sale_price=270000;await open();await expect(investment).toHaveValue('59200');await expect(dialog.locator('[data-sale-investment-mode-v235]')).toHaveText('직접입력');await dialog.locator('[data-sale-edit="salePrice"]').fill('280000');await expect(investment).toHaveValue('59200');await dialog.locator('[data-sale-edit-cancel]').click();
});
test('v235 explicit manual investment survives basis changes and failed save, clearing it restores automatic calculation',async({page,isMobile})=>{
  const row=await seed(page,isMobile,'building_sale'),writes=[];row.sale_price=270000;row.sale_details_json=JSON.stringify({totalDeposit:155800,loanAmount:55000,investmentAmount:42000,manualSaleFieldsV1:['investmentAmount']});
  await page.route('**/api/data**',route=>{const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});if(action==='updateProperty'){writes.push(body);return route.fulfill({status:503,json:{ok:false,message:'합성 저장 실패'}});}return route.fallback();});
  await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1'),investment=dialog.locator('[data-sale-edit="investmentAmount"]');
  await expect(investment).toHaveValue('42000');await dialog.locator('[data-sale-edit="salePrice"]').fill('280000');await expect(investment).toHaveValue('42000');await expect(dialog.locator('[data-sale-investment-mode-v235]')).toHaveText('직접입력');
  await investment.fill('');await expect(investment).toHaveValue('69200');await investment.fill('62000');await dialog.locator('[data-sale-edit="salePrice"]').fill('270000');await expect(investment).toHaveValue('62000');
  await dialog.locator('[data-sale-edit-save]').click();await expect.poll(()=>writes.length).toBeGreaterThan(0);expect(writes[0].saleEdit).not.toHaveProperty('investmentCalculationV235');await expect(investment).toHaveValue('62000');await expect(dialog.locator('[data-sale-investment-mode-v235]')).toHaveText('직접입력');
  await dialog.locator('[data-sale-edit-cancel]').click();await page.locator('#list .item-edit-btn-v630').first().click();await expect(investment).toHaveValue('42000');await dialog.locator('[data-sale-edit-cancel]').click();
});
test('v235 unknown loan is never zero and incomplete or negative-equity bases cannot produce a stale automatic number',async({page,isMobile})=>{
  const row=await seed(page,isMobile,'building_sale');row.sale_price=270000;row.sale_details_json=JSON.stringify({totalDeposit:155800,loanAmount:null,investmentAmount:null,manualSaleFieldsV1:['investmentAmount','loanAmount']});
  await page.route('**/api/data**',route=>new URL(route.request().url()).searchParams.get('action')==='listingChanges'?route.fulfill({json:{ok:true,items:[row]}}):route.fallback());
  await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1'),investment=dialog.locator('[data-sale-edit="investmentAmount"]'),loan=dialog.locator('[data-sale-edit="loanAmount"]');
  await expect(investment).toHaveValue('');await loan.fill('0');await expect(investment).toHaveValue('114200');await loan.fill('');await expect(investment).toHaveValue('');await loan.fill('300000');await expect(investment).toHaveValue('');await loan.fill('114200');await expect(investment).toHaveValue('0');await dialog.locator('[data-sale-edit-cancel]').click();
});
test('v235 automatic investment rebases all selected financial inputs after conflict without an implicit second save',async({page,isMobile})=>{
  const row=await seed(page,isMobile,'building_sale'),writes=[];row.sale_price=270000;row.sale_details_json=JSON.stringify({totalDeposit:155800,loanAmount:55000,investmentAmount:null,manualSaleFieldsV1:['investmentAmount']});
  await page.route('**/api/data**',route=>{const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});if(action==='updateProperty'){writes.push(body);row.sale_details_json=JSON.stringify({...JSON.parse(row.sale_details_json),totalDeposit:156800});return route.fulfill({status:409,json:{ok:false,code:'PROPERTY_EDIT_CONFLICT',message:'합성 동시 변경'}});}return route.fallback();});
  await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1'),investment=dialog.locator('[data-sale-edit="investmentAmount"]');await expect(investment).toHaveValue('59200');await dialog.locator('[data-sale-edit-save]').click();
  await expect(dialog.getByRole('checkbox',{name:'임대보증금 합계 내 입력 유지',exact:true})).toBeVisible();await expect(dialog.getByRole('checkbox',{name:'실투자금 내 입력 유지',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'선택한 값으로 편집 계속 (아직 저장 안 함)',exact:true}).click();await expect(investment).toHaveValue('58200');expect(writes).toHaveLength(1);
  await dialog.locator('[data-sale-edit-save]').click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1].saleEdit.patch.investmentAmount).toBe(58200);expect(writes[1].saleEdit.investmentCalculationV235.totalDeposit).toBe('156800');await dialog.locator('[data-sale-edit-cancel]').click();
});
test('v235 old advertisement hints never fill unknown investment basis under a newer source proof',async({page,isMobile})=>{
  const row=await seed(page,isMobile,'building_sale');row.source_snapshot_key='new-source-v235';row.sale_details_json=JSON.stringify({investmentAmount:null,manualSaleFieldsV1:['investmentAmount']});
  await page.evaluate(id=>{const item=allItems.find(item=>item.propertyId===id);item.saleDetails={totalDeposit:30000,loanAmount:10000};item.sourceSnapshotKey='old-source-v235';},row.property_id);
  await page.route('**/api/data**',route=>new URL(route.request().url()).searchParams.get('action')==='listingChanges'?route.fulfill({json:{ok:true,items:[row]}}):route.fallback());
  await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1');await expect(dialog.locator('[data-sale-edit="totalDeposit"]')).toHaveValue('');await expect(dialog.locator('[data-sale-edit="loanAmount"]')).toHaveValue('');await expect(dialog.locator('[data-sale-edit="investmentAmount"]')).toHaveValue('');await dialog.locator('[data-sale-edit-cancel]').click();
});
test('sale edit shows memo roles and submits autofilled phones only for its exact master',async({page,isMobile})=>{
  const row=await seed(page,isMobile,'building_sale'),writes=[];
  row.operating_memo='임대인01011112222\n사모님01033334444\n세입자01044445555\n관리0421234567';
  await page.route('**/api/data**',async route=>{const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes.push(body);return route.fulfill({status:503,json:{ok:false,message:'합성 저장 실패'}});}
    return route.continue();
  });
  await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1');
  await expect(dialog.locator('[data-sale-edit="landlordPhone"]')).toHaveValue('010-1111-2222');
  await expect(dialog.locator('[data-sale-edit="tenantPhone"]')).toHaveValue('010-4444-5555');
  await expect(dialog.locator('[data-memo-contacts-v224]')).toContainText('사모');
  await dialog.locator('[data-sale-edit-save]').click();
  await expect.poll(()=>writes.length).toBeGreaterThan(0);
  expect(writes[0].key.propertyId).toBe(row.property_id);expect(writes[0].originalValues[9]).toBe('');
  expect(writes[0].updated.landlordPhone).toBe('010-1111-2222');expect(writes[0].updated.tenantPhone).toBe('010-4444-5555');
  await expect(dialog).toBeVisible();
});
for(const market of ['building_sale','land_sale'])test('v233 contact choice changes only the selected sale editor draft '+market,async({page,isMobile})=>{
  const row=await seed(page,isMobile,market),writes=[];row.operating_memo='임대인01011112222 / 사모01033334444 / 세입자01044445555';
  await page.route('**/api/data**',route=>{const req=route.request();if(req.method()==='POST')writes.push(req.postDataJSON());if(new URL(req.url()).searchParams.get('action')==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});return route.fallback();});
  const before=await page.evaluate(()=>JSON.stringify(allItems));await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1'),chip=dialog.locator('[data-memo-contacts-v224] button').filter({hasText:'사모'});
  await chip.click();await expect(dialog.locator('[data-sale-edit="landlordPhone"]')).toHaveValue('010-3333-4444');await expect(chip).toHaveAttribute('aria-pressed','true');expect(writes).toEqual([]);
  await dialog.locator('[data-sale-edit="memo"]').fill(row.operating_memo+'\n현장 확인');await expect(dialog.locator('[data-sale-edit="landlordPhone"]')).toHaveValue('010-3333-4444');
  await dialog.locator('[data-sale-edit="landlordPhone"]').fill('010-9999-8888');await expect(dialog.locator('[data-memo-contacts-v224] button[aria-pressed="true"]')).toHaveCount(0);
  await dialog.locator('[data-sale-edit-cancel]').click();expect(writes).toEqual([]);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
});
for(const market of ['building_sale','land_sale'])test(market+' edit uses sale fields and submits only dirty management values',async({page,isMobile},info)=>{
  const row=await seed(page,isMobile,market),land=market==='land_sale',writes=[];
  await page.route('**/api/data**',async route=>{const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes.push(body);return route.fulfill({json:{ok:true,persisted:true,queued:false,propertyId:row.property_id,changedFields:['sale_price','sale_details_json'],updated:{salePrice:98000,saleDetails:{...JSON.parse(row.sale_details_json),...body.saleEdit.patch,manualSaleFieldsV1:Object.keys(body.saleEdit.patch).filter(k=>k!=='salePrice')}}}});}
    return route.continue();
  });
  await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1');await expect(dialog).toContainText(land?'토지매매 정보 수정':'건물매매 정보 수정');
  await expect(dialog.locator('[data-sale-edit="salePrice"]')).toHaveValue('99500');await expect(dialog).not.toContainText('권리금');await expect(dialog).not.toContainText('관리비');
  await expect(dialog.locator('[data-sale-edit="landAreaM2"]')).toHaveValue('160');await expect(dialog.locator('[data-sale-edit-py="landAreaM2"]')).toContainText('48.4평');
  await expect(dialog.locator('[data-sale-edit="memo"]')).toHaveValue('검수용 기존 메모');await expect(dialog.locator('.sale-unit-switch-v9')).toHaveCount(0);
  await dialog.locator('[data-sale-edit="salePrice"]').fill('98000');
  if(land){await expect(dialog.locator('[data-sale-edit="monthlyIncome"],[data-sale-edit="grossAreaM2"],[data-sale-edit="tenantPhone"],[data-sale-edit="room"]')).toHaveCount(0);await dialog.locator('[data-sale-edit="landUse"]').fill('대');await dialog.locator('[data-sale-edit="roadAccess"]').fill('8m 도로');}
  else {await expect(dialog.locator('[data-sale-edit="totalDeposit"]')).toHaveValue('30000');await dialog.locator('[data-sale-edit="monthlyIncome"]').fill('370');await dialog.locator('[data-sale-edit="loanAmount"]').fill('0');}
  await page.screenshot({path:info.outputPath(market+'-edit.png')});
  if(isMobile){await page.setViewportSize({width:320,height:800});expect(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth+1)).toBe(true);}
  await dialog.locator('[data-sale-edit-save]').click();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(1);
  await expect(page.locator('#list .item[data-property-id="'+row.property_id+'"]')).toContainText('9억8,000만원');
  expect(await page.evaluate(id=>allItems.find(i=>i.propertyId===id).salePrice,row.property_id)).toBe(98000);
  const request=writes[0];expect(request.key.propertyId).toBe(row.property_id);expect(request.saleEdit.patch.salePrice).toBe(98000);expect(request.updated).toEqual({});
  expect(request.saleEdit.original.salePrice).toBe(99500);expect(request.originalValues.slice(4,9)).toEqual([777,88,9,10,33]);
  expect(request.saleEdit.patch).not.toHaveProperty('descriptionText');expect(request.saleEdit.patch).not.toHaveProperty('scope');
  if(!land){expect(request.saleEdit.patch.monthlyIncome).toBe(370);expect(request.saleEdit.patch.loanAmount).toBe(0);expect(request.saleEdit.original.saleDetails.loanAmount).toBeNull();}
  await mode(page,isMobile,'lease');await page.evaluate(()=>openPropertyEditModalV630(encodeURIComponent('id:'+allItems.find(i=>i.tradeType==='lease').propertyId)));await expect(page.locator('#propertyEditTitleV630')).toHaveText('매물 임대조건 수정');await expect(page.locator('#peRentV630')).toBeVisible();await expect(page.locator('.sale-property-edit-v1')).toHaveCount(0);
});
test('sale conflict preserves input, compares the new baseline and never retries without an explicit save',async({page,isMobile})=>{
  const row=await seed(page,isMobile,'building_sale'),writes=[];let conflict=true;
  await page.route('**/api/data**',route=>{const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes.push(body);if(conflict){row.sale_details_json=JSON.stringify({...JSON.parse(row.sale_details_json),monthlyIncome:360});return route.fulfill({status:409,json:{ok:false,code:'PROPERTY_EDIT_CONFLICT',message:'다른 작업에서 변경됨'}});}return route.fulfill({json:{ok:true,persisted:true,queued:false,updated:{salePrice:row.sale_price,saleDetails:{...JSON.parse(row.sale_details_json),monthlyIncome:370}}}});}
    return route.continue();
  });
  await page.locator('#list .item-edit-btn-v630').first().click();const dialog=page.locator('.sale-property-edit-v1');await dialog.locator('[data-sale-edit="monthlyIncome"]').fill('370');await dialog.locator('[data-sale-edit-save]').click();
  await expect(dialog.locator('[data-sale-edit-conflict]')).toContainText('최신: 360 / 내 입력: 370');await expect(dialog.locator('[data-sale-edit="monthlyIncome"]')).toHaveValue('370');
  await expect(dialog.getByRole('checkbox',{name:'월 임대수입 내 입력 유지',exact:true})).not.toBeChecked();await dialog.locator('[data-sale-edit-save]').click();expect(writes).toHaveLength(1);
  await dialog.getByRole('checkbox',{name:'월 임대수입 내 입력 유지',exact:true}).check();await dialog.getByRole('button',{name:'선택한 값으로 편집 계속 (아직 저장 안 함)',exact:true}).click();expect(writes).toHaveLength(1);
  conflict=false;await dialog.locator('[data-sale-edit-save]').click();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(2);expect(writes[1].saleEdit.original.saleDetails.monthlyIncome).toBe(360);expect(writes[1].saleEdit.patch.monthlyIncome).toBe(370);
});
test('manual sale display merges edited fields without freezing fresh advertiser facts',async({page,isMobile})=>{
  await seed(page,isMobile,'building_sale');await page.evaluate(()=>{
    const item=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');item.salePrice=98000;item.saleDetails={monthlyIncome:370,loanAmount:null,manualSaleFieldsV1:['monthlyIncome','loanAmount']};
    JSUnifiedListingsV8.attach(allItems,{ok:true,groups:{[item.propertyId]:[{...item,originalId:'MANUAL-SALE-O',salePrice:99500,saleDetails:undefined,saleSummary:{monthlyIncome:350,loanAmount:20000,landAreaM2:233,grossAreaM2:492},manualDisplayFields:'sale_price,sale_details_json',images:[],photoCount:0}]}});applyFilter();
  });const card=page.locator('#list .listing-sale-card-v1').first();await expect(card).toContainText('9억8,000만원');await expect(card).toContainText('370만원');await expect(card).not.toContainText('20,000만원');await expect(card).toContainText('70.48평');await expect(card).toContainText('148.83평');
});


test('building edit keeps conversions beside inputs and actions visible across viewports',async({page,isMobile},info)=>{
  const row=await seed(page,isMobile,'building_sale');let writes=0;
  await page.route('**/api/data**',route=>{
    const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes++;return route.fulfill({status:500,json:{ok:false}});}
    return route.continue();
  });
  await page.locator('#list .item-edit-btn-v630').first().click();
  const dialog=page.locator('.sale-edit-building-v186');
  await expect(dialog.locator('[data-sale-edit="salePrice"]')).toHaveValue('99500');
  await dialog.locator('[data-sale-edit="salePrice"]').fill('71000');
  await expect(dialog.locator('[data-sale-money-preview="salePrice"]')).toHaveText('7억 1,000만원');
  await dialog.locator('[data-sale-edit="landAreaM2"]').fill('192.06');
  await expect(dialog.locator('[data-sale-edit-py="landAreaM2"]')).toHaveText('58.1평');
  await dialog.locator('[data-sale-edit="loanAmount"]').fill('0');
  await expect(dialog.locator('[data-sale-money-preview="loanAmount"]')).toHaveText('0원');
  await expect(dialog.locator('[data-sale-money-preview="investmentAmount"]')).toHaveText('4억 1,000만원');
  for(const size of [{width:1280,height:800},{width:1024,height:768},{width:844,height:390},{width:390,height:844},{width:320,height:640}]){
    await page.setViewportSize(size);
    const result=await dialog.evaluate(d=>{
      const bounds=d.getBoundingClientRect(),save=d.querySelector('[data-sale-edit-save]').getBoundingClientRect(),header=d.querySelector('header').getBoundingClientRect();
      const conversions=[...d.querySelectorAll('.sale-edit-control-v186')].map(w=>{
        const input=w.querySelector('input').getBoundingClientRect(),hint=w.querySelector('small').getBoundingClientRect(),box=w.getBoundingClientRect();
        return input.right<=hint.left+1&&Math.abs((input.top+input.bottom-hint.top-hint.bottom)/2)<2&&hint.right<=box.right+1&&input.width>=46;
      });
      return {fits:d.scrollWidth<=d.clientWidth+1&&bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight+1,
        actions:save.top>=header.bottom&&save.bottom<=innerHeight&&save.height>=40,conversions:conversions.every(Boolean)};
    });
    expect(result,JSON.stringify(size)).toEqual({fits:true,actions:true,conversions:true});
    await dialog.locator('[data-sale-edit="memo"]').fill('긴 메모도 다른 조건을 가리지 않고 편집합니다.\n'.repeat(12));
    await expect(dialog.locator('[data-sale-edit="memo"]')).toBeFocused();
    await expect(dialog.locator('[data-sale-edit-save]')).toBeInViewport();
    if(size.width===1280||size.width===390)await page.screenshot({path:info.outputPath('compact-edit-'+size.width+'.png')});
  }
  await dialog.locator('[data-sale-edit-cancel]').click();await expect(dialog).toHaveCount(0);expect(writes).toBe(0);
});
