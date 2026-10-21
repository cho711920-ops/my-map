import {test,expect} from '@playwright/test';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  // The fixture's bottom-right developer controls cover the production badge.
  await page.locator('#fixtureControls').evaluate(el=>el.remove());
  await page.evaluate(()=>{
    window.alert=()=>{throw Error('Address review must not use a blocking alert');};
    allItems.forEach(item=>{delete item.latlng;item.geocodeErrorReason='주소·건물명 검색 결과 없음';});
    errorItems=allItems.concat([allItems[0],{...allItems[0],propertyId:'STALE-SNAPSHOT'}]);updateErrorStatus();
  });
});
async function mode(page,isMobile,value){await page.locator(isMobile?'#jsMobileTradeModeV1':'#listingTradeModeSelectV1').selectOption(value);}

test('original address non-disclosure is explained without hiding the ad or guessing its coordinates', async ({page}) => {
  await page.evaluate(() => {
    const item = allItems[0];
    item.unifiedDisplayOriginalsV2 = [{active: 1, addressDisclosure: 'hidden'}];
    errorItems = [item]; updateErrorStatus();
  });
  await page.locator('#errorStatus').click();
  await expect(page.locator('#addressReviewV41')).toContainText('원본 주소 비공개');
  await expect(page.locator('#addressReviewV41')).toContainText('정확한 지번');
  expect(await page.evaluate(() => !!allItems[0].latlng)).toBe(false);
  expect(await page.evaluate(() => allItems.length)).toBe(4);
});
test('address review separates markets and ignores duplicate or obsolete snapshot errors',async({page,isMobile})=>{
  await expect(page.locator('#errorStatus')).toHaveText('주소 확인 2개');
  await page.locator('#errorStatus').press('Enter');await expect(page.locator('#addressReviewV41 li')).toHaveCount(2);
  await page.locator('#addressReviewV41').getByRole('button',{name:'주소 확인 닫기'}).click();
  await mode(page,isMobile,'building_sale');await expect(page.locator('#errorStatus')).toHaveText('주소 확인 1개');
  await page.locator('#errorStatus').click();await expect(page.locator('#addressReviewV41')).toContainText('테스트 건물매매');await expect(page.locator('#addressReviewV41 li')).toHaveCount(1);
  expect(await page.locator('#addressReviewV41').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.keyboard.press('Escape');await mode(page,isMobile,'land_sale');await page.locator('#errorStatus').click();await expect(page.locator('#addressReviewV41')).toContainText('테스트 토지매매');
});
test('malformed addresses and source text cannot become coordinates or executable markup',async({page})=>{
  await page.evaluate(()=>{const item=allItems[0];item.address='소형상가 12';item.name='<img src=x onerror=alert(1)>';item.link='javascript:alert(1)';item.sourceLink='javascript:alert(1)';item.unifiedDisplayOriginalsV2=[];item.unifiedAllOriginalsV1=[];errorItems=[item];updateErrorStatus();});
  await page.locator('#errorStatus').click();const dialog=page.locator('#addressReviewV41');await expect(dialog.locator('img,a')).toHaveCount(0);await expect(dialog).toContainText('<img src=x onerror=alert(1)>');await expect(dialog.getByRole('button',{name:'지번 다시 조회'})).toBeDisabled();
});
async function mockLookup(page,phase){await page.evaluate(phase=>{
  window.__lookupCalls=0;window.__cacheWrites=0;window.__redraws=0;
  window.saveGeocodeCache=()=>window.__cacheWrites++;window.queueSharedGeocodeEntry=()=>{};window.applyFilter=()=>window.__redraws++;
  window.kakao={maps:{LatLng:function(lat,lng){this.lat=lat;this.lng=lng;},services:{Status:{OK:'OK'},AnalyzeType:{EXACT:'exact'},Geocoder:function(){this.addressSearch=(query,callback,options)=>{
    window.__lookupCalls++;window.__query=query;window.__options=options;
    const row={x:'127.38',y:'36.35',address:{address_name:'대전광역시 서구 괴정동 '+(phase==='approximate'?'999-9':'1-1'),b_code:'3017010800',main_address_no:phase==='approximate'?'999':'1',sub_address_no:phase==='approximate'?'9':'1',mountain_yn:'N'}};
    if(phase==='held')window.__lookupRelease=()=>callback([row],'OK');else callback(phase==='empty'?[]:[row],'OK');
  };}}}};
},phase);}
test('an unlocated row stays reviewable after map rendering excludes it, and can rejoin the map',async({page,isMobile})=>{
  await page.evaluate(()=>{const item=allItems.find(item=>item.tradeType==='lease');item.sourceLink='https://fin.land.naver.com/articles/1234567890';item.unifiedDisplayOriginalsV2=[];item.unifiedAllOriginalsV1=[];addressErrorSnapshotV41=allItems.slice();allItems=allItems.filter(value=>value!==item);errorItems=[item];updateErrorStatus();});
  await expect(page.locator('#errorStatus')).toHaveText('주소 확인 1개');
  const count=await page.evaluate(()=>allItems.length);await mockLookup(page,'normal');
  await page.locator('#errorStatus').click();await expect(page.locator('#addressReviewV41').getByRole('link',{name:'원본 확인'})).toHaveAttribute('href','https://fin.land.naver.com/articles/1234567890');await page.locator('#addressReviewV41 li').first().getByRole('button',{name:'지번 다시 조회'}).click();
  await expect(page.locator('#addressReviewV41 [role="status"]')).toContainText('보완했습니다');
  expect(await page.evaluate(()=>allItems.length)).toBe(count+1);await expect(page.locator('#errorStatus')).toBeHidden();
});
test('one exact parcel lookup restores only its coordinates without changing the ad or other errors',async({page})=>{
  await mockLookup(page,'normal');const before=await page.evaluate(()=>allItems.map(({address,deposit,rent,salePrice})=>({address,deposit,rent,salePrice})));
  await page.locator('#errorStatus').click();await page.locator('#addressReviewV41 li').first().getByRole('button',{name:'지번 다시 조회'}).click();
  await expect(page.locator('#addressReviewV41 [role="status"]')).toContainText('보완했습니다');await expect(page.locator('#errorStatus')).toHaveText('주소 확인 1개');
  expect(await page.evaluate(()=>({calls:__lookupCalls,writes:__cacheWrites,redraws:__redraws,analyze:__options.analyze_type}))).toEqual({calls:1,writes:1,redraws:1,analyze:'exact'});
  expect(await page.evaluate(()=>allItems.map(({address,deposit,rent,salePrice})=>({address,deposit,rent,salePrice})))).toEqual(before);
});
for(const phase of ['empty','approximate','held'])test(phase+' lookup never saves guessed or stale coordinates',async({page})=>{
  await mockLookup(page,phase);await page.locator('#errorStatus').click();await page.locator('#addressReviewV41 li').first().getByRole('button',{name:'지번 다시 조회'}).click();
  if(phase==='held'){
    await expect(page.locator('#addressReviewV41 li button:enabled')).toHaveCount(0);
    await page.evaluate(()=>{allItems=allItems.map(item=>({...item}));__lookupRelease();});
  }
  await expect(page.locator('#addressReviewV41 [role="status"]')).toContainText(phase==='held'?'갱신됐습니다':'일치하는 필지');
  expect(await page.evaluate(()=>__cacheWrites)).toBe(0);expect(await page.evaluate(()=>__lookupCalls)).toBe(1);
});
