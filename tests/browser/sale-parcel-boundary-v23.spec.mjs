import {test,expect} from '@playwright/test';
const pnu='3020010700100040004',pnu2='3020010700100050005';
const ring=[[127.34,36.36],[127.341,36.36],[127.341,36.361],[127.34,36.361],[127.34,36.36]];
function boundary(p=pnu){const dx=p===pnu2?.002:0;return {ok:true,pnu:p,geometry:{type:'MultiPolygon',coordinates:[[ring.map(([x,y])=>[x+dx,y])]]},source:'국토교통부 · 브이월드 연속지적도',fetchedAt:'2026-10-19T12:00:00Z'};}
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);if(isMobile)await page.locator('[data-mobile-view="list"]').click();}
async function setup(page,{available=true,reply}={}){
  await page.locator('#fixtureControls').evaluate(el=>el.hidden=true);
  const calls=[],writes=[];
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/data')writes.push(r.postDataJSON());});
  await page.route('**/api/data?*',async route=>{
    const u=new URL(route.request().url()),a=u.searchParams.get('action');
    if(a==='saleParcelBoundaryConfig'){calls.push(a);return route.fulfill({json:{ok:true,available}});}
    if(a==='saleParcelBoundary'){calls.push(u.searchParams.get('pnu'));return reply?reply(route,u):route.fulfill({json:boundary(u.searchParams.get('pnu'))});}
    return route.continue();
  });
  await page.evaluate(({pnu,pnu2})=>{
    window.__parcelShapes=[];window.__parcelFits=[];
    window.kakao=window.kakao||{};window.kakao.maps=window.kakao.maps||{};
    class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
    class Bounds{constructor(){this.points=[];}extend(point){this.points.push(point);}}
    class Shape{constructor(options){this.options=options;this.map=null;if(options.path||options.content?.classList?.contains('sale-parcel-badge-v23'))__parcelShapes.push(this);}setMap(map){this.map=map;}setOptions(options){Object.assign(this.options,options);}}
    class Overlay extends Shape{setMap(map){super.setMap(map);if(map)document.getElementById('map').append(this.options.content);else this.options.content.remove();}}
    Object.assign(kakao.maps,{LatLng,LatLngBounds:Bounds,Polygon:Shape,CustomOverlay:Overlay});
    Object.assign(window.map,{setBounds:(bounds,...padding)=>__parcelFits.push({points:bounds.points,padding}),relayout:()=>{}});
    JSParcelExternalLinksV1.resolve=async address=>{if(address.includes('숨김'))throw Error('정확한 지번 없음');return {address,pnu:address.includes('5-5')?pnu2:pnu,links:{}};};
  },{pnu,pnu2});return {calls,writes};
}
async function openLand(page,isMobile){await mode(page,isMobile,'land_sale');await page.locator('#list .item-building-name').first().click();const panel=page.locator('.sale-parcel-panel-v23');await expect(panel).toBeVisible();return panel;}

test('single lot loads on click, keeps source data and can be hidden without changing listing filters',async({page,isMobile},info)=>{
  const {calls,writes}=await setup(page);const panel=await openLand(page,isMobile);expect(calls).toEqual(['saleParcelBoundaryConfig']);
  const before=await page.evaluate(()=>JSON.stringify(allItems));await panel.locator('[data-boundary-single]').click();
  const bar=page.locator('.sale-parcel-map-v23');await expect(bar).toBeVisible();await expect(bar).toContainText('선택 필지 1개');await expect(bar).toContainText('광고 면적 330.58㎡');await expect(bar).toContainText('지분·부분 매매');await expect(page.locator('.sale-parcel-badge-v23')).toHaveText('1');
  expect(calls).toEqual(['saleParcelBoundaryConfig',pnu]);expect(writes).toEqual([]);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  expect(await page.evaluate(()=>__parcelShapes[0].options.fillOpacity)).toBe(.12);
  expect(await bar.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('parcel-reference-controls.png')});
  await bar.getByRole('button',{name:'경계 숨기기'}).click();await expect(bar).toHaveCount(0);expect(await page.evaluate(()=>__parcelShapes.every(s=>s.map===null))).toBe(true);
});
test('saved parcels retain order, map numbers match the table, and focusing changes no prices or stored areas',async({page,isMobile})=>{
  const {writes}=await setup(page);let loads=0;
  await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='loadCloudState'||u.searchParams.get('scope')!=='saleWorksheetV1')return route.fallback();loads++;return route.fulfill({json:{ok:true,data:{parcels:[{address:'대전 유성구 장대동 5-5',areaM2:200},{address:'대전 유성구 장대동 4-4',areaM2:100}]}}});});
  const panel=await openLand(page,isMobile);await panel.locator('[data-boundary-group]').click();const bar=page.locator('.sale-parcel-map-v23');await expect(bar).toContainText('선택 필지 2개');await bar.locator('summary').click();
  await expect(bar.locator('li').nth(0)).toContainText('1. 대전 유성구 장대동 5-5');await expect(bar.locator('li').nth(0)).toContainText('내 입력 면적 200㎡');await expect(bar.locator('li').nth(1)).toContainText('2. 대전 유성구 장대동 4-4');
  await bar.locator('li > button:first-child').nth(1).click();await expect(bar.locator('li').nth(1)).toHaveClass('selected');expect(await page.evaluate(()=>__parcelFits.at(-1).points[0].lng)).toBe(127.34);expect(loads).toBe(1);expect(writes).toEqual([]);
  await mode(page,isMobile,'building_sale');await expect(bar).toHaveCount(0);expect(await page.evaluate(()=>__parcelShapes.every(s=>s.map===null))).toBe(true);
});
test('missing key hides controls; lease and building detail issue no boundary request',async({page,isMobile})=>{
  const {calls}=await setup(page,{available:false});
  for(const value of ['lease','building_sale']){await mode(page,isMobile,value);await page.locator('#list .item-building-name').first().click();await expect(page.locator('.sale-parcel-panel-v23')).toHaveCount(0);await page.locator('#unifiedDetailDrawerV8').getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();}
  expect(calls).toEqual([]);await mode(page,isMobile,'land_sale');await page.locator('#list .item-building-name').first().click();await expect.poll(()=>calls.length).toBe(1);await expect(page.locator('.sale-parcel-panel-v23')).toBeHidden();
});
test('late geometry after detail close is discarded and no overlay appears',async({page,isMobile})=>{
  let release;await setup(page,{reply:async route=>{await new Promise(r=>release=r);await route.fulfill({json:boundary()}).catch(()=>{});}});
  const panel=await openLand(page,isMobile);await panel.locator('[data-boundary-single]').click();await expect.poll(()=>typeof release).toBe('function');
  await page.locator('#unifiedDetailDrawerV8').getByRole('button',{name:'상세매물보기 닫기',exact:true}).click();release();await expect(page.locator('.sale-parcel-map-v23')).toHaveCount(0);expect(await page.evaluate(()=>__parcelShapes.length)).toBe(0);
});
test('wrong parcel or unavailable boundary shows a retry message and never draws an approximate lot',async({page,isMobile})=>{
  let valid=false;const {calls}=await setup(page,{reply:route=>route.fulfill({json:valid?boundary():boundary(pnu2)})});
  const panel=await openLand(page,isMobile);await panel.locator('[data-boundary-single]').click();await expect(panel.locator('[data-boundary-status]')).toContainText('응답이 다릅니다');await expect(page.locator('.sale-parcel-map-v23')).toHaveCount(0);expect(await page.evaluate(()=>__parcelShapes.length)).toBe(0);
  valid=true;await panel.locator('[data-boundary-single]').click();await expect(page.locator('.sale-parcel-map-v23')).toBeVisible();expect(calls.filter(c=>c===pnu)).toHaveLength(2);
});
test('duplicate saved parcels stop the whole group rather than silently dropping a lot',async({page,isMobile})=>{
  const {writes}=await setup(page);await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='loadCloudState'||u.searchParams.get('scope')!=='saleWorksheetV1')return route.fallback();return route.fulfill({json:{ok:true,data:{parcels:[{address:'대전 유성구 장대동 4-4',areaM2:100},{address:'대전 유성구 장대동 4-4',areaM2:100}]}}});});
  const panel=await openLand(page,isMobile);await panel.locator('[data-boundary-group]').click();await expect(panel.locator('[data-boundary-status]')).toContainText('중복');await expect(page.locator('.sale-parcel-map-v23')).toHaveCount(0);expect(writes).toEqual([]);
});
test('public parcel area is requested separately, validated by PNU, and never overwrites the advertised area',async({page,isMobile})=>{
  await setup(page);let calls=0,match=false;
  await page.route('**/api/data?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('action')!=='saleParcelFacts')return route.fallback();calls++;return route.fulfill({json:{ok:true,pnu:match?pnu:pnu2,areaM2:500}});});
  const panel=await openLand(page,isMobile);await panel.locator('[data-boundary-single]').click();const bar=page.locator('.sale-parcel-map-v23');await expect(bar).toBeVisible();expect(calls).toBe(0);
  await bar.locator('.sale-parcel-area-check-v23').click();await expect(bar).toContainText('같은 필지의 공부 면적을 확인하지 못했습니다');
  match=true;await bar.locator('.sale-parcel-area-check-v23').click();await expect(bar).toContainText('공부 면적 500㎡');await expect(bar).toContainText('광고 면적 330.58㎡');await expect(bar).toContainText('매매 범위 확인');expect(calls).toBe(2);
  expect(await page.evaluate(()=>allItems.find(i=>i.propertyId==='FIXTURE-LAND').saleDetails.landAreaM2)).toBe(330.5785);
});
