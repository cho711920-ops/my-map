import {test,expect} from '@playwright/test';
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect fill="#d6e1e8" width="180" height="180"/><path fill="#698294" d="M25 25h130v155H25z"/><path fill="#eaf2f7" d="M40 40h25v30H40zm40 0h25v30H80zm40 0h20v30h-20zM40 90h25v30H40zm40 0h25v30H80zm40 0h20v30h-20z"/></svg>');
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,market){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(market);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function seed(page){await page.evaluate(photo=>{
  const building=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING'),land=allItems.find(i=>i.propertyId==='FIXTURE-LAND');
  const cases=[
    {...building,propertyId:'CARD16-WHOLE',name:'둔산 수익형 건물',saleCategory:'building',salePrice:70000,saleDetails:{scope:'whole_building',landAreaM2:233,grossAreaM2:492,totalDeposit:5000,monthlyIncome:250,loanAmount:20000,investmentAmount:45000,buildingUse:'근린생활시설'}},
    {...building,propertyId:'CARD16-UNIT',name:'둔산 오피스텔',saleCategory:'office',salePrice:4300,saleDetails:{scope:'unit',exclusiveAreaM2:24.56}},
    {...building,propertyId:'CARD16-EMPTY',name:'면적 미제공 건물',saleCategory:'building',saleDetails:{}},
    {...building,propertyId:'CARD16-PROFIT',name:'원문 월수익 표기 건물',saleCategory:'building',salePrice:67000,saleDetails:{scope:'whole_building',totalDeposit:8550,statedMonthlyIncome:211,loanAmount:20000,investmentAmount:38450}},
    {...building,propertyId:'CARD16-ZERO',name:'현재 임대수입 0원 건물',saleCategory:'building',salePrice:50000,saleDetails:{scope:'whole_building',totalDeposit:0,monthlyIncome:0}},
    {...land,propertyId:'CARD16-LAND',name:'업무용 토지',saleDetails:{scope:'land',landAreaM2:330.5785,landUse:'대',zoning:'제2종일반주거지역',roadAccess:'8m 도로',parcelShape:'장방형'}},
    {...land,propertyId:'CARD16-LAND-EMPTY',name:'조건 미제공 토지',saleDetails:{scope:'land'}}
  ].map((i,n)=>({...i,key:'card16-'+n,address:'대전 서구 둔산동 '+(100+n)+'-1',originalId:i.propertyId+'-O',source:'당근',images:n%2?[photo]:[],photoCount:n%2?1:0}));
  allItems=allItems.filter(i=>i.tradeType!=='sale').concat(cases);JSUnifiedListingsV8.attach(allItems,{ok:true,groups:Object.fromEntries(allItems.map(i=>[i.propertyId,[{...i,originalId:i.originalId||i.propertyId+'-O'}]]))});document.getElementById('fixtureControls').hidden=true;
},photo);}
for(const market of ['building_sale','land_sale'])test(market+' uses one source-faithful card without duplicate or empty comparison slots',async({page,isMobile},info)=>{
  await seed(page);await page.evaluate(()=>applyFilter());const lease=await page.locator('#list .item').first().innerHTML(),before=await page.evaluate(()=>JSON.stringify(allItems));
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/data'))writes++;});
  await mode(page,isMobile,market);if(!isMobile)await page.setViewportSize({width:1794,height:866});
  await expect(page.locator('[data-sale-layout]')).toHaveCount(2);await expect(page.locator('[data-sale-layout="compact"],[data-sale-layout="detail"]')).toHaveCount(0);
  if(!isMobile)await expect(page.locator('[data-sale-layout="card"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#list .sale-compact-metrics-v8,#list .building-unit-prices-v5,#list .building-sale-area-info-v1,#list .land-card-metrics-v4')).toHaveCount(0);
  const card=id=>page.locator('#list [data-property-id="CARD16-'+id+'"]');
  if(market==='building_sale'){
    await expect(card('WHOLE').locator('[data-sale-metric-v16="대지면적"]')).toHaveCount(1);await expect(card('WHOLE').locator('[data-sale-metric-v16="연면적"]')).toHaveCount(1);
    await expect(card('WHOLE')).toContainText('만원/평');await expect(card('WHOLE').getByText('단순 연 수익률',{exact:true})).toHaveCount(1);
    await expect(card('WHOLE').locator('.listing-sale-yield-v1')).toHaveCount(0);
    await expect(card('UNIT').locator('[data-sale-metric-v16="전용면적"]')).toContainText('7.43평');await expect(card('UNIT')).not.toContainText('대지');await expect(card('UNIT').locator('.sale-card-facts-v2')).toHaveCount(0);
    await expect(card('EMPTY').locator('.sale-list-missing-v16')).toContainText('면적 정보 미제공');await expect(card('EMPTY')).not.toContainText('0만원');
    await expect(card('PROFIT')).toContainText('광고 월수익 · 기준 미확인');await expect(card('PROFIT')).toContainText('211만원');await expect(card('PROFIT')).toContainText('38,450만원');await expect(card('PROFIT')).not.toContainText('단순 연 수익률');
    await expect(card('ZERO')).toContainText('0만원');await expect(card('ZERO')).toContainText('0.00%');
  }else{
    await expect(card('LAND').locator('[data-sale-metric-v16="토지면적"]')).toHaveCount(1);await expect(card('LAND')).toContainText('8m 도로');await expect(card('LAND')).toContainText('제2종일반주거지역');await expect(card('LAND')).toContainText('장방형');
    await expect(card('LAND').getByText('지목: 대',{exact:true})).toHaveCount(1);await expect(card('LAND')).not.toContainText('연면적');await expect(card('LAND')).not.toContainText('월 임대수입');await expect(card('LAND-EMPTY').locator('.sale-card-facts-v2')).toHaveCount(0);
  }
  await page.screenshot({path:info.outputPath(market+'-unified-cards.png'),animations:'disabled'});
  const first=page.locator('#list .listing-sale-card-v1').first();await first.locator('.action-select-check').check();
  if(!isMobile){const metric=first.locator('.sale-list-metrics-v16'),value=await metric.innerText();await page.locator('#saleListLayoutV8 [data-sale-unit="m2"]').click();await expect(metric).toContainText('㎡');await page.locator('#saleListLayoutV8 [data-sale-unit="py"]').click();expect(await metric.innerText()).toBe(value);
    await page.locator('[data-sale-layout="table"]').click();await expect(page.locator('[data-sale-layout="table"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-sale-layout="card"]')).toHaveAttribute('aria-pressed','false');await expect(first.locator('[data-table-select]')).toBeChecked();
    await page.locator('[data-sale-layout="card"]').click();await expect(page.locator('[data-sale-layout="card"]')).toHaveAttribute('aria-pressed','true');await expect(first.locator('.action-select-check')).toBeChecked();}
  for(const width of isMobile?[390,320]:[1280,800,700]){await page.setViewportSize({width,height:866});expect(await page.locator('#list .listing-sale-card-v1').evaluateAll(cs=>cs.every(c=>c.scrollWidth<=c.clientWidth+1))).toBe(true);}
  expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);expect(writes).toBe(0);if(!isMobile)await page.setViewportSize({width:1794,height:866});await mode(page,isMobile,'lease');expect(await page.locator('#list .item').first().innerHTML()).toBe(lease);
});
