import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function open(page,isMobile,value='building_sale'){await mode(page,isMobile,value);await page.locator('#list .item-building-name').first().click();return page.locator('#unifiedDetailDrawerV8');}
async function seed(page,market,count=180){await page.evaluate(({market,count})=>{
  const base=allItems.find(i=>i.propertyId===(market==='land_sale'?'FIXTURE-LAND':'FIXTURE-BUILDING'));
  const items=Array.from({length:count},(_,i)=>({...base,key:'v10-'+i,propertyId:'SALE-V10-'+i,name:'조건표 '+i,address:'대전 서구 괴정동 '+(i+1)+'-1',salePrice:30000+i*100,
    saleDetails:{...base.saleDetails,landAreaM2:(100+i)*3.305785,monthlyIncome:i%2?0:200,roadAccess:i%2?'8m 한면':'',zoning:'일반주거지역'}}));
  allItems=allItems.filter(i=>i.tradeType!=='sale').concat(items);JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.propertyId+'-O',buildingName:i.name,images:[],photoCount:0}]]))});document.getElementById('fixtureControls').hidden=true;
},{market,count});}
for(const market of ['building_sale','land_sale'])test(market+' table uses bounded virtual rows, sorting, selection and stable switching without changing lease',async({page,isMobile},info)=>{
  test.skip(isMobile,'PC table layout keeps mobile cards.');
  await seed(page,market);await page.evaluate(()=>applyFilter());const lease=await page.locator('#list .item').first().innerHTML();await mode(page,false,market);
  const data=await page.evaluate(()=>JSON.stringify(allItems));
  await page.locator('[data-sale-layout="table"]').click();await expect(page.locator('html')).toHaveAttribute('data-sale-table-v10',market==='land_sale'?'land':'building');
  await expect(page.locator('#saleTableHeadV10')).toContainText(market==='land_sale'?'도로접면':'월수입');
  expect(await page.locator('#list .item').count()).toBeLessThan(100);
  await page.locator('#list [data-table-select]').first().check();await expect(page.locator('#list [data-table-select]').first()).toBeChecked();await expect(page.locator('#saleComparisonTrayV5')).toContainText('1개');
  await page.locator('[data-table-sort="salePriceLow"]').click();await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id','SALE-V10-0');
  await page.locator('[data-table-sort="salePriceLow"]').click();await expect(page.locator('#list .item').first()).toHaveAttribute('data-property-id','SALE-V10-179');
  await page.evaluate(()=>{let s=getListingScrollContainerV2();s.scrollTop=5000;s.dispatchEvent(new Event('scroll'));});
  await expect.poll(()=>page.locator('#list .item').first().getAttribute('data-list-index-v1')).not.toBe('0');
  await page.locator('#list [data-table-open]').first().click();await expect(page.locator('#unifiedDetailDrawerV8')).toHaveAttribute('aria-hidden','false');await page.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  await page.screenshot({path:info.outputPath(market+'-table.png'),animations:'disabled'});
  await page.locator('[data-sale-layout="detail"]').click();await expect(page.locator('html')).not.toHaveAttribute('data-sale-table-v10');await expect(page.locator('#list .item-building-name').first()).toBeVisible();
  await page.locator('[data-sale-layout="table"]').click();await page.setViewportSize({width:720,height:800});await expect(page.locator('html')).not.toHaveAttribute('data-sale-table-v10');await page.setViewportSize({width:1280,height:800});await expect(page.locator('html')).toHaveAttribute('data-sale-table-v10');
  await page.evaluate(()=>JSMapListPanelV1.close());await expect(page.locator('#saleTableHeadV10')).toBeHidden();await page.evaluate(()=>JSMapListPanelV1.open());await expect(page.locator('#saleTableHeadV10')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(data);await mode(page,false,'lease');await expect(page.locator('#saleTableHeadV10')).toBeHidden();expect(await page.locator('#list .item').first().innerHTML()).toBe(lease);
});
test('comparison keeps headings and distinguishes unavailable facts when showing differences',async({page,isMobile},info)=>{
  await seed(page,'building_sale',3);await page.evaluate(()=>{allItems.find(i=>i.propertyId==='SALE-V10-1').saleDetails.totalDeposit=null;});await mode(page,isMobile,'building_sale');
  for(const id of ['0','1'])await page.locator('#list [data-property-id="SALE-V10-'+id+'"] .action-select-check').check();
  await page.locator('#saleComparisonTrayV5 [data-sale-compare]').click();const d=page.locator('#saleWorkbenchDialogV1');await expect(d.locator('thead')).toContainText('조건표');
  await d.locator('[data-compare-differences]').check();await expect(d.locator('thead')).toBeVisible();await expect(d.locator('tr').filter({has:d.getByText('연면적',{exact:true})})).toBeHidden();await expect(d.locator('tbody')).toContainText('0만원');await expect(d.locator('.sale-compare-missing-label-v10')).not.toHaveCount(0);
  await page.screenshot({path:info.outputPath('sale-differences.png')});
});
test('table columns stay aligned horizontally, contact colours stay current, and density changes retain the visible row',async({page,isMobile},info)=>{
  test.skip(isMobile,'The table is PC-only.');await seed(page,'building_sale',350);await mode(page,false,'building_sale');await page.locator('[data-sale-layout="table"]').click();
  const first=page.locator('#list .item').first(),source=first.locator('.item-action-left>.item-contact-button-v654'),proxy=first.locator('[data-table-phone]');
  const no=await proxy.evaluate(el=>getComputedStyle(el).backgroundColor);
  await source.evaluate(el=>{el.classList.remove('no-contacts');el.classList.add('has-contacts');el.title='연락처 있음';el.setAttribute('aria-label','연락처 있음');el.onclick=()=>window.__contactClickV10=true;});
  await expect(proxy).toHaveClass(/has-contacts/);expect(await proxy.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(no);
  await proxy.click();expect(await page.evaluate(()=>window.__contactClickV10)).toBe(true);
  await page.evaluate(()=>{const s=getListingScrollContainerV2();s.scrollLeft=250;});
  const cols=await page.evaluate(()=>{const h=[...document.querySelectorAll('#saleTableHeadV10>span')],r=[...document.querySelector('#list .sale-table-row-v10').children];return h.map((el,i)=>Math.abs(el.getBoundingClientRect().x-r[i].getBoundingClientRect().x)).slice(1,-1);});
  expect(Math.max(...cols)).toBeLessThan(3);
  await page.evaluate(()=>{const s=getListingScrollContainerV2();s.scrollTop=5000;s.dispatchEvent(new Event('scroll'));});await expect.poll(()=>page.locator('#list .item').first().getAttribute('data-list-index-v1')).not.toBe('0');
  const anchor=await page.evaluate(()=>{const s=getListingScrollContainerV2(),c=[...document.querySelectorAll('#list .item')].find(el=>el.getBoundingClientRect().bottom>s.getBoundingClientRect().top);return {id:c.dataset.propertyId,top:c.getBoundingClientRect().top};});
  await page.locator('[data-sale-layout="detail"]').click();const target=page.locator('#list [data-property-id="'+anchor.id+'"]');expect(Math.abs(await target.evaluate(el=>el.getBoundingClientRect().top)-anchor.top)).toBeLessThan(3);
  await page.locator('[data-sale-layout="table"]').click();await page.screenshot({path:info.outputPath('table-contact-and-scroll.png'),animations:'disabled'});
});
test('cashflows update from worksheet inputs and clear an invalid calculation in building and land',async({page,isMobile},info)=>{
  const drawer=await open(page,isMobile);await drawer.locator('[data-sale-action="worksheet"]').click();let d=page.locator('#saleWorkbenchDialogV1');
  for(const [k,v] of Object.entries({price:'50000',deposit:'5000',income:'200',loan:'12000',interest:'6',vacancy:'10',expense:'150',acquisition:'1000'}))await d.locator('[data-calc="'+k+'"]').fill(v);
  await expect(d.locator('.sale-money-flow-v10')).toContainText('34,000만원');await expect(d.locator('.sale-money-flow-v10 li.negative')).toContainText('-30만원');
  await d.locator('[data-calc="income"]').fill('');await expect(d.locator('.sale-money-flow-v10')).toHaveCount(0);await d.locator('[data-calc="income"]').fill('200');
  await d.locator('.sale-money-flow-v10').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('building-money-flow.png')});await d.locator('[data-sale-close]').click();await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  await mode(page,isMobile,'land_sale');await page.locator('#list .item-building-name').click();await drawer.locator('[data-sale-action="worksheet"]').click();d=page.locator('#saleWorkbenchDialogV1');
  await expect(d.locator('.sale-money-flow-v10')).toContainText('총 매입비용');await expect(d.locator('.sale-money-flow-v10')).not.toContainText('임대보증금');
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
});
test('selected building highlights follow explicit building choice and retain zero parking',async({page,isMobile},info)=>{
  await page.evaluate(()=>{JSParcelExternalLinksV1.resolve=async address=>({address,pnu:'3017010800100030003'});window.JSBuildingRegisterReadOnlyV6={load:async()=>({ok:true,queriedAt:'2026-10-18T18:05:00Z',buildings:[{mainUse:'업무시설',approvalDate:'20200101',indoorSelfParking:0,outdoorSelfParking:0,indoorMechanicalParking:5,outdoorMechanicalParking:0,passengerElevators:1,emergencyElevators:0},{mainUse:'창고',approvalDate:'19990101'}]})};});
  const drawer=await open(page,isMobile);await expect(drawer.locator('.sale-building-highlights-v10')).toHaveCount(0);await drawer.locator('[data-sale-section="register"] [data-public-load]').click();await drawer.getByLabel('건물 제원 건물 선택',{exact:true}).selectOption('0');
  await expect(drawer.locator('.sale-building-highlights-v10')).toContainText('0대');await expect(drawer.locator('.sale-building-highlights-v10')).toContainText('5대');await expect(drawer.locator('.sale-public-source-v6')).toContainText('2026.10.19 03:05 KST');
  await drawer.getByLabel('건물 제원 건물 선택',{exact:true}).selectOption('1');await expect(drawer.locator('.sale-building-highlights-v10')).toContainText('창고');await expect(drawer.locator('.sale-building-highlights-v10')).not.toContainText('5대');
  await page.screenshot({path:info.outputPath('building-highlights.png')});
});
test('exact source quotes jump into escaped original text and secondary tools remain reachable',async({page,isMobile},info)=>{
  await page.route('**/api/data?*',async route=>{if(new URL(route.request().url()).searchParams.get('action')!=='unifiedListingDetail')return route.continue();const response=await route.fetch(),data=await response.json();data.originals[0].saleDetails={...data.originals[0].saleDetails,descriptionText:'안내 <img src=x onerror=alert(1)>\n월세 200만원\n끝',descriptionEvidence:{'월 임대수입':'월세 200만원','다른 원본':'월세 999만원'}};await route.fulfill({response,json:data});});
  const drawer=await open(page,isMobile);await expect(drawer.locator('.sale-original-evidence-v10 button')).toHaveCount(1);await drawer.getByRole('button',{name:'월 임대수입 · 원문 근거',exact:true}).click();await expect(drawer.locator('.listing-sale-description-v1 mark')).toHaveText('월세 200만원');await expect(drawer.locator('.listing-sale-description-v1 img')).toHaveCount(0);await expect(drawer.locator('.listing-sale-description-v1')).toContainText('<img src=x');
  await drawer.locator('.sale-secondary-tools-v10>summary').click();await expect(drawer.locator('[data-sale-action="lookup"]')).toBeVisible();await expect(drawer.locator('.sale-asking-history-v9')).toBeVisible();
  await page.screenshot({path:info.outputPath('original-evidence.png')});
});
