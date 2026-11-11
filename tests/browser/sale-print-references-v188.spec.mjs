import {test,expect} from '@playwright/test';
const pnu='3017010800100030003',address='대전광역시 서구 괴정동 3-3';
const building={ok:true,action:'buildingRegister',parcel:{sigunguCd:'30170',bjdongCd:'10800',platGbCd:'0',bun:'0003',ji:'0003'},source:'국토교통부 건축HUB · 검수자료',fetchedAt:new Date().toISOString(),partial:true,detailsPending:true,recordCounts:{buildings:1},buildings:[{lotAddress:address,buildingName:'본동',mainUse:'단독주택',otherUse:'단독주택,제2종근린생활시설',siteArea:331,buildingArea:180,totalArea:650,approvalDate:'20160701',groundFloors:4,undergroundFloors:1}]};
const land={ok:true,action:'saleParcelFacts',pnu,address,source:'토지이음 공개 열람 · 검수자료',fetchedAt:new Date().toISOString(),complete:true,landUse:'대',areaM2:331,price:{available:true,wonPerM2:2500000,baseYear:2026,baseMonth:1},regulations:[{label:'국토계획법에 따른 지역·지구',available:true,complete:true,items:[{label:'제2종일반주거지역'},{label:'지구단위계획구역'}]},{label:'다른 법령에 따른 지역·지구',available:true,complete:true,items:[{label:'교육환경보호구역'}]}]};
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(({pnu,address})=>{
    window.__v188Reads=0;window.__v188Prints=0;const open=window.open;window.open=function(...args){const p=open.apply(window,args);if(p)p.print=()=>window.__v188Prints++;return p;};
    document.getElementById('fixtureControls').hidden=true;
    JSParcelExternalLinksV1.resolve=async()=>{window.__v188Reads++;return {pnu,address};};
    JSUnifiedListingsV8.printItem=async item=>({...item,memo:'내가 직접 작성한 메모',saleDetails:{...item.saleDetails,totalDeposit:5000,monthlyIncome:200}});
    window.extractListContactsV650=()=>[{role:'임',phone:{display:'010-1111-2222'}},{role:'관',phone:{display:'042-123-4567'}},{role:'기',phone:{display:'010-3333-4444'}}];
  },{pnu,address});
});
async function print(page,context,isMobile){
  await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption('building_sale');
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.locator('#list .item .action-select-check').first().check();
  const wait=context.waitForEvent('page');await page.locator('#printSelectedBtn').evaluate(e=>e.click());const popup=await wait;
  await expect.poll(()=>page.evaluate(()=>window.__v188Prints)).toBe(1);return popup;
}
async function routes(page,register=building,parcel=land){
  const reads=[];
  await page.route('**/api/data?*',route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action');
    if(!['buildingRegister','saleParcelFacts'].includes(action))return route.continue();
    reads.push(url);expect(route.request().method()).toBe('GET');expect(url.searchParams.has('propertyId')).toBe(false);
    return route.fulfill({json:action==='buildingRegister'?register:parcel});
  });return reads;
}
test('selected print shows separate ad/register/land evidence with date and horizontal contacts, without changing data',async({page,context,isMobile},info)=>{
  const reads=await routes(page);expect(reads.length).toBe(0);expect(await page.evaluate(()=>window.__v188Reads)).toBe(0);
  const before=await page.evaluate(()=>JSON.stringify(allItems));const popup=await print(page,context,isMobile);
  const ad=popup.locator('.sale-print-advertised'),official=popup.locator('.sale-print-official');
  await expect(ad).toContainText('200만원');await expect(ad).toContainText('661.16㎡');await expect(ad).toContainText('대장 확인값이 아닙니다');
  await expect(official).toHaveCount(2);await expect(official.nth(0)).toContainText('단독주택,제2종근린생활시설');await expect(official.nth(0)).toContainText('650㎡');await expect(official.nth(0)).toContainText('표기 차이');
  await expect(official.nth(1)).toContainText('2,500,000원/㎡');await expect(official.nth(1)).toContainText('2026.01 기준');await expect(official.nth(1)).toContainText('교육환경보호구역');
  await expect(popup.locator('.sale-print-source')).toContainText(['매매가','국토교통부','필지번호','토지이음']);
  await expect(popup.locator('.sale-print-memo')).toContainText('내가 직접 작성한 메모');
  expect(reads.length).toBe(2);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:794,height:1123});
  const phones=await popup.locator('.sale-print-contact .print-contact').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width})));
  expect(phones.length).toBe(3);expect(Math.abs(phones[0].y-phones[1].y)).toBeLessThan(2);expect(phones[1].x).toBeGreaterThan(phones[0].x+phones[0].width);
  expect(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await popup.screenshot({path:info.outputPath('sale-print-references-v188.png'),fullPage:true});
  if(!isMobile)await popup.pdf({path:info.outputPath('sale-print-references-v188.pdf'),preferCSSPageSize:true,printBackground:true});
});
test('unavailable public data stays visibly unavailable while ad values still print',async({page,context,isMobile})=>{
  await routes(page,{ok:false,message:'대장 조회 실패'},{ok:false,message:'토지이음 조회 실패'});
  const popup=await print(page,context,isMobile);await expect(popup.locator('.sale-print-advertised')).toContainText('661.16㎡');
  await expect(popup.locator('.sale-print-official').nth(0)).toContainText('대장 조회 실패');await expect(popup.locator('.sale-print-official').nth(1)).toContainText('토지이음 조회 실패');
  await expect(popup.locator('.sale-print-official .sale-print-facts')).toHaveCount(0);
});
test('multiple buildings are individually identified and incomplete lookup is flagged',async({page,context,isMobile})=>{
  await routes(page,{...building,incomplete:true,buildings:[building.buildings[0],{...building.buildings[0],buildingName:'별동',totalArea:80}],recordCounts:{buildings:2}});
  const popup=await print(page,context,isMobile),register=popup.locator('.sale-print-official').first();
  await expect(register).toContainText('2개 건물 각각 표시, 합산하지 않음');await expect(register.locator('h4')).toHaveCount(2);await expect(register).toContainText('80㎡');await expect(register).toContainText('일부 대장 자료');
  await expect(register).not.toContainText('730㎡');
});
