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
for(const market of ['building_sale','land_sale'])test(market+' edit uses sale fields and submits only dirty management values',async({page,isMobile},info)=>{
  const row=await seed(page,isMobile,market),land=market==='land_sale',writes=[];
  await page.route('**/api/data**',async route=>{const req=route.request(),body=req.method()==='POST'?req.postDataJSON():{},action=body.action||new URL(req.url()).searchParams.get('action');
    if(action==='listingChanges')return route.fulfill({json:{ok:true,items:[row]}});
    if(action==='updateProperty'){writes.push(body);return route.fulfill({json:{ok:true,persisted:true,queued:false,updated:{salePrice:98000,saleDetails:{...JSON.parse(row.sale_details_json),...body.saleEdit.patch}}}});}
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
