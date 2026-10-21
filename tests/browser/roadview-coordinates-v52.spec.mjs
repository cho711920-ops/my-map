import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{
    document.getElementById('fixtureControls').remove();window.__rvQueries=[];window.__rvStarts=[];window.__rvAlerts=[];
    window.alert=message=>__rvAlerts.push(message);
    window.kakao={maps:{LatLng:function(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;},services:{Status:{OK:'OK'},Geocoder:function(){this.addressSearch=(query,callback)=>__rvQueries.push({query,callback});}}}};
    window.switchRoadviewMode=mode=>{currentRoadviewMode=mode;if(currentRoadviewCoords)__rvStarts.push({...currentRoadviewCoords});};
    allItems.forEach(item=>{delete item.latlng;delete item.latitude;delete item.longitude;delete item.lat;delete item.lng;});
  });
});
test('list and detail roadview use stored numeric coordinates without a map object or lookup',async({page,isMobile})=>{
  await page.evaluate(()=>{const item=allItems[0];item.latitude=36.35;item.longitude=127.4;});
  if(isMobile)await page.evaluate(()=>JSUnifiedListingsV8.runDetailAction('roadview',encodeURIComponent(allItems[0].propertyId)));
  else await page.locator('.item-roadview-btn').first().click();
  await expect(page.locator('#roadviewModal')).toHaveClass(/open/);
  expect(await page.evaluate(()=>__rvStarts)).toEqual([{lat:36.35,lng:127.4}]);
  await page.evaluate(()=>{closeRoadviewModal();JSUnifiedListingsV8.runDetailAction('roadview',encodeURIComponent(allItems[0].propertyId));});
  expect(await page.evaluate(()=>__rvStarts.length)).toBe(2);
  expect(await page.evaluate(()=>({queries:__rvQueries.length,alerts:__rvAlerts}))).toEqual({queries:0,alerts:[]});
});
test('exact parcel lookup waits visibly, shares repeated clicks, and ignores closed or superseded requests',async({page})=>{
  await page.evaluate(()=>{allItems[0].address='대덕구 중리동 254-6';openKakaoRoadview(encodeURIComponent(allItems[0].key));openKakaoRoadview(encodeURIComponent(allItems[0].key));});
  await expect(page.locator('#naverRoadviewModalStatus')).toContainText('정확한 위치를 확인');
  expect(await page.evaluate(()=>__rvQueries.length)).toBe(1);
  await page.evaluate(()=>{
    allItems[1].address='서구 계룡로 123';openKakaoRoadview(encodeURIComponent(allItems[1].key));
    __rvQueries[0].callback([{x:'127.4',y:'36.35',address:{address_name:'대전광역시 대덕구 중리동 254-6',b_code:'3023010900',main_address_no:'254',sub_address_no:'6',mountain_yn:'N'}}],'OK');
  });
  expect(await page.evaluate(()=>__rvStarts.length)).toBe(0);
  await page.evaluate(()=>{closeRoadviewModal();__rvQueries[1].callback([{x:'127.4',y:'36.35',road_address:{address_name:'대전광역시 서구 계룡로 123'}}],'OK');});
  await expect(page.locator('#roadviewModal')).not.toHaveClass(/open/);
  expect(await page.evaluate(()=>({starts:__rvStarts.length,located:allItems.some(item=>item.latlng),alerts:__rvAlerts}))).toEqual({starts:0,located:false,alerts:[]});
});
test('a mismatched address shows an inline error, then a fresh exact retry opens without changing listings',async({page})=>{
  await page.evaluate(()=>{allItems[0].address='서구 계룡로 123';window.__rvBefore=JSON.stringify(allItems);openKakaoRoadview(encodeURIComponent(allItems[0].key));__rvQueries[0].callback([{x:'127.4',y:'36.35',road_address:{address_name:'대전광역시 서구 계룡로 124'}}],'OK');});
  await expect(page.locator('#naverRoadviewModalStatus')).toContainText('정확히 일치');
  expect(await page.evaluate(()=>JSON.stringify(allItems)===__rvBefore)).toBe(true);
  await page.evaluate(()=>{closeRoadviewModal();openKakaoRoadview(encodeURIComponent(allItems[0].key));__rvQueries[1].callback([{x:'127.4',y:'36.35',road_address:{address_name:'대전광역시 서구 계룡로 123'}}],'OK');});
  await expect.poll(()=>page.evaluate(()=>__rvStarts.length)).toBe(1);
  expect(await page.evaluate(()=>JSON.stringify(allItems.map(({latlng,...rest})=>rest))===__rvBefore)).toBe(true);
  expect(await page.evaluate(()=>__rvAlerts)).toEqual([]);
});
test('timeout is recoverable and a late response cannot move the listing',async({page})=>{
  await page.clock.install();
  await page.evaluate(()=>{allItems[0].address='서구 계룡로 123';openKakaoRoadview(encodeURIComponent(allItems[0].key));});
  await page.clock.fastForward(8100);
  await expect(page.locator('#naverRoadviewModalStatus')).toContainText('초과');
  await page.evaluate(()=>__rvQueries[0].callback([{x:'127.4',y:'36.35',road_address:{address_name:'대전광역시 서구 계룡로 123'}}],'OK'));
  expect(await page.evaluate(()=>({starts:__rvStarts.length,located:!!allItems[0].latlng}))).toEqual({starts:0,located:false});
});
