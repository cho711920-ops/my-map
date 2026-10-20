import {test,expect} from '@playwright/test';
function landData(pnu){return {ok:true,action:'saleParcelFacts',pnu,address:'대전광역시 유성구 장대동 4-4',landUse:'대',areaM2:1243,price:{available:true,wonPerM2:986600,baseYear:2026,baseMonth:1},regulations:[{key:'planning',label:'국토계획법에 따른 지역·지구',available:true,complete:true,items:[{label:'제3종일반주거지역'},{label:'지구단위계획구역(검수용 가상 지정)'},{label:'중로1류(폭 20m~25m)(저촉)'}]},{key:'other',label:'다른 법령에 따른 지역·지구',available:true,complete:true,items:[{label:'교육환경보호구역(검수용 가상 지정)'}]},{key:'additional',label:'그 밖의 확인사항',available:true,complete:true,items:[]}],complete:true,source:'토지이음 공개 열람 · 검수용 가상 자료',fetchedAt:new Date().toISOString()};}
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/building-register-v6.js'});
  await page.evaluate(()=>{
    window.__parcelRequests=0;window.__registerRequests=0;
    window.JSParcelExternalLinksV1.resolve=async address=>{window.__parcelRequests++;const pnu=address.includes('장대동')?'3020010700100040004':'3017010800100030003';return {address:address.includes('장대동')?'대전광역시 유성구 장대동 4-4':'대전광역시 서구 괴정동 3-3',pnu,links:{eum:'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu='+pnu,valuemap:'https://www.valueupmap.com/properties/lands/'+pnu}};};
  });
  page.__landRequests=[];
  await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleParcelFacts')return route.continue();page.__landRequests.push(u);return route.fulfill({json:landData(u.searchParams.get('pnu'))});});
});
async function open(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();await page.locator('#list .item-building-name').click();return page.locator('#unifiedDetailDrawerV8');}
const building={mainUse:'제2종근린생활시설',structure:'철근콘크리트구조',approvalDate:'20020304',siteArea:330,buildingArea:160,totalArea:650,floorArea:600,buildingCoverageRatio:48.48,floorAreaRatio:181.82,indoorSelfParking:4,outdoorSelfParking:2,indoorMechanicalParking:0,outdoorMechanicalParking:0,passengerElevators:1,emergencyElevators:0,lotAddress:'대전 서구 괴정동 3-3'};
async function leaseMarkup(page){return page.locator('#list .item').first().evaluate(e=>{const clone=e.cloneNode(true);clone.removeAttribute('data-building-badge-retries');for(const node of [clone,...clone.querySelectorAll('*')]){const attrs=[...node.attributes].map(a=>[a.name,a.value]).sort(([a],[b])=>a.localeCompare(b));for(const a of [...node.attributes])node.removeAttribute(a.name);for(const [k,v] of attrs)node.setAttribute(k,v);}return clone.outerHTML;});}
test('building public facts load on click, show source and preserve the lease UI',async({page,isMobile},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let requested=0;
  await page.route('**/api/data?*',async route=>{
    const url=new URL(route.request().url());if(url.searchParams.get('action')!=='buildingRegister')return route.continue();
    requested++;expect(url.searchParams.get('propertyId')).toBe('');expect(url.searchParams.get('mode')).toBe('summary');
    const data={ok:true,action:'buildingRegister',version:11,buildings:[building],source:'국토교통부 건축물대장',queriedAt:'2026. 10. 18. 오전 11:00',fetchedAt:new Date().toISOString()};
    return route.fulfill({contentType:'text/javascript',body:url.searchParams.get('callback')+'('+JSON.stringify(data)+');'});
  });
  const lease=await leaseMarkup(page);
  const drawer=await open(page,isMobile,'building_sale');
  expect(requested).toBe(0);expect(await page.evaluate(()=>window.__parcelRequests)).toBe(0);
  const snapshot=await page.evaluate(()=>JSON.stringify(window.allItems));
  await drawer.locator('[data-sale-section-target="register"]').click();
  const panel=drawer.locator('[data-sale-section="register"]');await panel.locator('[data-public-load]').click();
  await expect(panel).toContainText('철근콘크리트구조');await expect(panel).toContainText('6대');await expect(panel).toContainText('181.82%');await expect(panel).toContainText('2026. 10. 18.');expect(requested).toBe(1);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(snapshot);
  await panel.screenshot({path:info.outputPath('building-public-facts.png'),animations:'disabled'});
  await drawer.getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('lease');
  expect(await leaseMarkup(page)).toBe(lease);
  expect(errors).toEqual([]);
});
test('multiple buildings require a deliberate choice and missing counts stay unknown',async({page,isMobile})=>{
  await page.evaluate(b=>{window.JSBuildingRegisterReadOnlyV6.load=async()=>({ok:true,buildings:[b,{...b,buildingName:'별동',indoorSelfParking:null}]});},building);
  const drawer=await open(page,isMobile,'building_sale'),panel=drawer.locator('[data-sale-section="register"]');
  await drawer.locator('[data-sale-section-target="register"]').click();await panel.locator('[data-public-load]').click();
  await expect(panel).toContainText('확인할 건물·동을 선택');await expect(panel.locator('.sale-public-facts-v6')).toHaveCount(0);
  await panel.locator('select').selectOption('1');await expect(panel).toContainText('별동');
  expect(await panel.locator('.sale-public-facts-v6').textContent()).not.toContain('주차 총대수');
});
test('land facts show official area, designations and dated public price without changing ad values',async({page,isMobile},info)=>{
  const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-section-target="publicland"]').click();
  const panel=drawer.locator('[data-sale-section="publicland"]');await expect(drawer.locator('[data-sale-section="register"]')).toHaveCount(0);
  const before=await page.evaluate(()=>JSON.stringify(window.allItems));expect(page.__landRequests.length).toBe(0);
  await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-official-land]')).toBeVisible();
  await expect(panel.locator('a').first()).toHaveAttribute('href',/eum\.go\.kr/);
  await expect(panel.locator('[data-public-status]')).toContainText('공적자료를 불러왔습니다');
  await expect(panel.locator('[data-official-land-data]')).toContainText('986,600');await expect(panel.locator('[data-official-land-data]')).toContainText('2026.01');
  await expect(panel.locator('[data-official-land-data]')).toContainText('1,243㎡');await expect(panel).toContainText('광고면적');
  expect(page.__landRequests.length).toBe(1);expect(page.__landRequests[0].searchParams.get('pnu')).toBe('3020010700100040004');
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(before);
  await expect(panel.locator('.sale-public-land-price-v7')).toBeInViewport();
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await panel.locator('[data-public-load]').click();await expect(panel.locator('.sale-public-land-price-v7')).toBeInViewport();}
  await page.screenshot({path:info.outputPath('land-official-reference.png'),animations:'disabled'});
  await panel.locator('[data-public-guidance] summary').click();await expect(panel).toContainText('광고 금액·면적·주소는 변경하지 않습니다');
});
test('unavailable or wrong-parcel official data stays separate from confirmed ad data',async({page,isMobile})=>{
  let phase='partial';
  await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleParcelFacts')return route.fallback();
    const d=landData(u.searchParams.get('pnu'));if(phase==='partial')return route.fulfill({json:{...d,complete:false,price:{available:false,message:'공시지가를 확인하지 못했습니다.'}}});
    if(phase==='wrong')return route.fulfill({json:{...d,pnu:'3011011700100560001'}});
    return route.fulfill({json:{ok:false,code:'source_unavailable',message:'토지이음 자료를 확인하지 못했습니다.'}});
  });
  const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-section-target="publicland"]').click();const panel=drawer.locator('[data-sale-section="publicland"]');
  await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('일부 항목');await expect(panel).toContainText('공시지가를 확인하지 못했습니다');
  await expect(panel.locator('.sale-public-land-price-v7')).toHaveCount(0);await expect(panel.locator('[data-official-land-data]')).toContainText('1,243㎡');
  phase='wrong';await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('요청한 필지와 응답이 다릅니다');await expect(panel.locator('[data-official-land-data]')).toBeEmpty();
  phase='error';await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('토지이음 자료를 확인하지 못했습니다');await expect(panel.locator('[data-official-land] a').first()).toBeVisible();
});
test('nearby references filter legal town, area, month and whole-building records without new filter requests',async({page,isMobile},info)=>{
  let calls=0;
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleTransactions')return route.continue();calls++;
    expect(u.searchParams.get('expectedAccountEmail')).toBe('browser-fixture@example.invalid');
    const row={date:'2026-09-10',district:'서구',town:'괴정동',lot:'3**',amount:40000,landAreaM2:300,buildingAreaM2:600,buildingType:'일반',buildingUse:'근린생활시설',zoning:'일반주거지역',method:'중개거래'};
    return route.fulfill({json:{ok:true,month:u.searchParams.get('month'),records:[row,{...row,town:'탄방동',amount:90000},{...row,buildingType:'집합',amount:10000},{...row,landAreaM2:20,amount:1000}],complete:true,source:'국토교통부 실거래가',fetchedAt:new Date().toISOString()}});
  });
  const drawer=await open(page,isMobile,'building_sale');await drawer.locator('[data-sale-group-sections*="transactions"]').click();
  const panel=drawer.locator('[data-sale-section="transactions"]');expect(calls).toBe(0);
  await panel.locator('[type="month"]').fill('2026-09');await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('조건 일치 2건');
  await panel.locator('[data-trade-filter="size"]').check();await expect(panel.locator('[data-public-status]')).toContainText('조건 일치 1건');expect(calls).toBe(1);
  await expect(panel.locator('.sale-public-trades-v6')).toContainText('4억원');await expect(panel).toContainText('현재 광고 호가 5억원');
  await panel.locator('[type="month"]').fill('2026-08');await expect(panel.locator('.sale-public-trades-v6')).toHaveCount(0);expect(calls).toBe(1);
  await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('2026.08');expect(calls).toBe(2);
  await panel.screenshot({path:info.outputPath('building-similar-trades.png'),animations:'disabled'});
});
test('approval and empty results are distinct, and a closed/replaced panel ignores late requests',async({page,isMobile})=>{
  let fail=true,release;
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleTransactions')return route.continue();
    if(fail)return route.fulfill({json:{ok:false,code:'approval_required',message:'실거래 자료 이용 승인이 필요합니다.'}});
    await new Promise(r=>release=r);return route.fulfill({json:{ok:true,month:u.searchParams.get('month'),records:[],complete:true,source:'국토부',fetchedAt:new Date().toISOString()}});
  });
  const drawer=await open(page,isMobile,'land_sale');await drawer.locator('[data-sale-group-sections*="transactions"]').click();
  const panel=drawer.locator('[data-sale-section="transactions"]');await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('승인이 필요');await expect(panel).not.toContainText('공개 거래가 없습니다');
  fail=false;await panel.locator('[data-public-load]').click();await expect.poll(()=>typeof release).toBe('function');
  await drawer.locator('[aria-label="공적자료 조회용 지번"]').fill('서구 괴정동 3-3');await drawer.locator('.sale-public-query-v6 button').click();release();
  await expect(drawer.locator('[data-public-address-status]')).toContainText('조회용 주소를 적용');await expect(drawer.locator('[data-sale-section="transactions"] [data-public-content]')).toBeEmpty();
});

test('single and multifamily reference selects housing source, preserves areas and switches without stale results',async({page,isMobile},info)=>{
  const calls=[];
  await page.route('**/api/data?*',async route=>{
    const url=new URL(route.request().url());if(url.searchParams.get('action')!=='saleTransactions')return route.fallback();
    calls.push(url.searchParams.get('kind'));
    const kind=url.searchParams.get('kind'),row={date:'2026-09-10',district:'서구',town:'괴정동',lot:'3**',amount:40000,landAreaM2:300,buildingAreaM2:580.25,houseType:'다가구',buildYear:'2001',method:'중개거래'};
    return route.fulfill({json:{ok:true,kind,month:url.searchParams.get('month'),records:kind==='house'?[row,{...row,town:'탄방동',amount:90000}]:[{...row,houseType:'',buildingType:'일반',buildingUse:'근린생활시설',amount:80000}],complete:true,source:kind==='house'?'국토교통부 단독·다가구 매매 실거래가':'국토교통부 상업·업무용 매매 실거래가',fetchedAt:new Date().toISOString()}});
  });
  const drawer=await open(page,isMobile,'building_sale');
  const snapshot=await page.evaluate(()=>JSON.stringify(window.allItems));
  await page.evaluate(()=>{const root=document.querySelector('#unifiedDetailDrawerV8');root.querySelector('.sale-public-review-v6').remove();window.JSSalePublicReviewV6.mount(root,{tradeType:'sale',saleCategory:'multifamily',address:'대전 서구 괴정동 3-3',salePrice:50000,saleDetails:{landAreaM2:330,zoning:'일반주거지역'}});});
  await drawer.locator('[data-sale-group-sections*="transactions"]').click();
  const panel=drawer.locator('[data-sale-section="transactions"]'),selector=panel.getByLabel('실거래 유형',{exact:true});
  await expect(selector).toHaveValue('house');expect(calls).toEqual([]);
  await expect(panel.getByText('일반건축물만',{exact:false})).toBeHidden();
  await expect(panel.locator('[data-trade-filter="zoning"]')).toBeHidden();
  await panel.locator('[type="month"]').fill('2026-09');await panel.locator('[data-public-load]').click();
  await expect(panel.locator('[data-public-status]')).toContainText('조건 일치 1건');
  for(const text of ['다가구','연면적','580.25','2001년','4억원'])await expect(panel.locator('.sale-public-trades-v6')).toContainText(text);
  await panel.screenshot({path:info.outputPath('single-multifamily-trades.png'),animations:'disabled'});
  await selector.selectOption('commercial');await expect(panel.locator('.sale-public-trades-v6')).toHaveCount(0);
  await expect(panel.locator('[data-trade-filter="whole"]')).toBeVisible();expect(calls).toEqual(['house']);
  await panel.locator('[data-public-load]').click();await expect(panel.locator('.sale-public-trades-v6')).toContainText('8억원');expect(calls).toEqual(['house','commercial']);
  await selector.selectOption('house');await panel.locator('[data-public-load]').click();
  await expect(panel.locator('.sale-public-trades-v6')).toContainText('4억원');expect(calls).toEqual(['house','commercial']);
  expect(await page.evaluate(()=>JSON.stringify(window.allItems))).toBe(snapshot);
  if(isMobile){await page.setViewportSize({width:320,height:720});expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
});

test('ambiguous mixed-use requires transaction source selection and failed housing approval is not zero trades',async({page,isMobile})=>{
  let calls=0;
  await page.route('**/api/data?*',async route=>{const url=new URL(route.request().url());if(url.searchParams.get('action')!=='saleTransactions')return route.fallback();calls++;return route.fulfill({json:{ok:false,code:'approval_required',message:'해당 실거래 유형의 승인 확인이 필요합니다.'}});});
  const drawer=await open(page,isMobile,'building_sale');
  await page.evaluate(()=>{const root=document.querySelector('#unifiedDetailDrawerV8');root.querySelector('.sale-public-review-v6').remove();window.JSSalePublicReviewV6.mount(root,{tradeType:'sale',saleCategory:'mixed_house',address:'대전 서구 괴정동 3-3',salePrice:50000,saleDetails:{}});});
  await drawer.locator('[data-sale-group-sections*="transactions"]').click();
  const panel=drawer.locator('[data-sale-section="transactions"]');await expect(panel.getByLabel('실거래 유형',{exact:true})).toHaveValue('');
  await panel.locator('[data-public-load]').click();await expect(panel.locator('[data-public-status]')).toContainText('유형을 선택');expect(calls).toBe(0);
  await panel.getByLabel('실거래 유형',{exact:true}).selectOption('house');await panel.locator('[data-public-load]').click();
  await expect(panel.locator('[data-public-status]')).toContainText('승인');await expect(panel.locator('.sale-public-approval-v7 a')).toHaveAttribute('href','https://www.data.go.kr/data/15126465/openapi.do');
  await expect(panel).not.toContainText('공개 거래가 없습니다');expect(calls).toBe(1);
});
test('narrow sale detail stays within its viewport',async({page,isMobile})=>{
  test.skip(!isMobile);await page.setViewportSize({width:320,height:720});const drawer=await open(page,true,'land_sale');
  await expect(drawer.locator('.sale-public-review-v6')).toHaveCount(1);
  expect(await drawer.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
});
