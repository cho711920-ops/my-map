import {test,expect} from '@playwright/test';

const publicParking={id:'public-1',name:'검사 공영주차장',kind:'공영',type:'노외',address:'대전광역시 서구 검사로 1',parcelAddress:'대전광역시 서구 탄방동 1',lat:36.35,lng:127.38,capacity:45,
  days:'평일+토요일',weekday:['09:00','22:00'],saturday:['09:00','18:00'],holiday:[],charge:'유료',basicMinutes:30,basicFee:1000,extraMinutes:10,extraFee:300,referenceDate:'2026-04-20'};
const source={schemaVersion:1,sourceUrl:'https://www.data.go.kr/data/15012896/standard.do',items:[publicParking]};

async function prepare(page,{data=source,failData=false,mode='ok'}={}){
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname,method:request.method()});
    if(url.pathname==='/data/daejeon-parking-v1.json')return route.fulfill({status:failData?503:200,contentType:'application/json',body:JSON.stringify(data)});
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/?mapFirst=1');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#fixtureControls').evaluate(el=>el.hidden=true);
  await page.evaluate(mode=>{
    const host=document.getElementById('map');host.style.background='#edf4f6';
    const sentinel=document.createElement('div');sentinel.className='circle-marker';sentinel.textContent='탄방동 매물 12';sentinel.style.cssText='position:absolute;left:180px;top:300px';host.append(sentinel);
    window.parkingAudit={calls:[],mode,events:new Set(),lat:36.35,lng:127.38};
    function LatLng(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}
    const bounds=()=>({getSouthWest:()=>new LatLng(parkingAudit.lat-.03,parkingAudit.lng-.03),getNorthEast:()=>new LatLng(parkingAudit.lat+.03,parkingAudit.lng+.03),
      contain:p=>Math.abs(p.getLat()-parkingAudit.lat)<.03&&Math.abs(p.getLng()-parkingAudit.lng)<.03});
    window.map={getBounds:bounds,getCenter:()=>new LatLng(parkingAudit.lat,parkingAudit.lng),getLevel:()=>5};
    window.kakao={maps:{LatLng,event:{addListener:(map,name,fn)=>parkingAudit.events.add(fn),removeListener:(map,name,fn)=>parkingAudit.events.delete(fn)},
      CustomOverlay:class{
        constructor(options){this.wrapper=document.createElement('div');this.wrapper.style.cssText='position:absolute;left:'+(Math.min(host.clientWidth-100,370)+(options.position.getLng()-127.38)*20000)+'px;top:280px;z-index:'+options.zIndex;
          this.wrapper.append(options.content);if(options.map)this.setMap(options.map);}
        setMap(target){if(target)host.append(this.wrapper);else this.wrapper.remove();}
        setPosition(position){this.wrapper.style.left=(Math.min(host.clientWidth-100,370)+(position.getLng()-127.38)*20000)+'px';}
      },services:{Status:{OK:'OK',ERROR:'ERROR',ZERO_RESULT:'ZERO_RESULT'},Places:class{
        categorySearch(category,callback,options){
          parkingAudit.calls.push({category,page:options.page});
          const items=[{id:'duplicate',place_name:'검사 공영주차장',category_name:'교통 > 주차장',address_name:'대전광역시 서구 탄방동 1',road_address_name:'대전광역시 서구 검사로 1',y:'36.35',x:'127.38'},
            {id:'private',place_name:'검사 민영주차장',category_name:'교통 > 민영주차장',address_name:'대전광역시 서구 탄방동 2',y:'36.35',x:'127.383'},
            {id:'unknown',place_name:'<img src=x onerror=alert(1)>',category_name:'교통 > 주차장',address_name:'대전광역시 서구 탄방동 3',y:'36.35',x:'127.386'}];
          if(parkingAudit.mode==='same-address')Object.assign(items[1],{x:'127.38',road_address_name:'대전광역시 서구 검사로 1',address_name:'대전광역시 서구 탄방동 1'});
          const done=()=>callback(items,parkingAudit.mode==='error'?'ERROR':'OK',{hasNextPage:parkingAudit.mode==='pages'});
          if(parkingAudit.mode==='delayed')parkingAudit.deliver=done;else setTimeout(done,0);
        }
      }}}};
    window.selectedGroupKey='existing-cluster';window.selectedItemKey='existing-item';document.getElementById('maxRent').value='130';
  },mode);
  await page.addScriptTag({url:'/js/map-parking-v1.js'});
  return {errors,requests};
}
function trigger(page){return page.evaluate(()=>parkingAudit.events.forEach(fn=>fn()));}
function state(page){return page.evaluate(()=>({selectedGroupKey,selectedItemKey,data:JSON.stringify(allItems),count:document.getElementById('mapListingCountV825')?.textContent,
  rent:document.getElementById('maxRent').value,lat:map.getCenter().getLat(),lng:map.getCenter().getLng(),level:map.getLevel(),cluster:document.querySelector('.circle-marker')?.outerHTML}));}
function toggle(page,isMobile){return page.locator(isMobile?'#mapParkingPhoneBtnV1':'#mapParkingBtnV1');}

test('parking is lazy, independent of listings, deduplicated, filterable and opens one safe detail table',async({page,isMobile},info)=>{
  const audit=await prepare(page),before=await state(page);
  expect(audit.requests.filter(r=>r.path.startsWith('/data/'))).toEqual([]);
  await toggle(page,isMobile).click();await expect(page.locator('.parking-pin-v1')).toHaveCount(3);
  await expect(page.locator('.circle-marker')).toHaveText('탄방동 매물 12');
  await page.locator('[data-parking-id="public-1"]').click();
  const detail=page.locator('.parking-detail-v1');await expect(detail).toBeVisible();
  await expect(detail).toContainText('45면');await expect(detail).toContainText('30분 / 1,000원');await expect(detail).toContainText('2026-04-20');
  await expect(detail).toContainText('실시간 빈자리가 아닙니다');expect(await state(page)).toEqual(before);
  await expect(detail.locator('dd').filter({hasText:'미확인'})).not.toHaveCount(0);
  if(isMobile)await expect(page.locator('#jsPhoneMapListV2')).toBeHidden();
  await page.screenshot({path:info.outputPath('parking-layer-detail.png')});
  await page.getByRole('button',{name:'주차장 상세 닫기'}).click();await expect(detail).toBeHidden();
  await page.getByRole('combobox',{name:'주차장 구분'}).selectOption('민영');await expect(page.locator('.parking-pin-v1')).toHaveCount(1);
  await page.locator('.parking-pin-v1').click();await expect(detail).toContainText('미확인');await expect(detail).not.toContainText('45면');
  await page.keyboard.press('Escape');await expect(detail).toBeHidden();
  await page.getByRole('combobox',{name:'주차장 구분'}).selectOption('미확인');await page.locator('.parking-pin-v1').click();
  await expect(detail.locator('h2')).toHaveText('<img src=x onerror=alert(1)>');await expect(detail.locator('img')).toHaveCount(0);
  await toggle(page,isMobile).click();await expect(page.locator('.parking-pin-v1')).toHaveCount(0);await expect(detail).toBeHidden();
  expect(await page.evaluate(()=>parkingAudit.events.size)).toBe(0);expect(await state(page)).toEqual(before);
  expect(audit.requests.filter(r=>r.path.startsWith('/data/'))).toHaveLength(1);
  expect(audit.requests.filter(r=>r.method!=='GET')).toEqual([]);expect(audit.errors).toEqual([]);
});

test('same viewport uses cache, changed viewport removes offscreen pins and hides after late callbacks',async({page,isMobile})=>{
  const audit=await prepare(page);await toggle(page,isMobile).click();await expect(page.locator('.parking-pin-v1')).toHaveCount(3);
  for(let i=0;i<3;i++)await trigger(page);await page.waitForTimeout(650);expect(await page.evaluate(()=>parkingAudit.calls.length)).toBe(1);
  await page.evaluate(()=>{parkingAudit.lat=36.5;parkingAudit.mode='delayed';});await trigger(page);
  await expect(page.locator('.parking-pin-v1')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>parkingAudit.calls.length)).toBe(2);
  await toggle(page,isMobile).click();await page.evaluate(()=>parkingAudit.deliver());await page.waitForTimeout(600);
  await expect(page.locator('.parking-pin-v1')).toHaveCount(0);await expect(page.locator('.parking-controls-v1')).toBeHidden();expect(audit.errors).toEqual([]);
});

test('different parking facilities at the same address do not inherit public capacity or disappear',async({page,isMobile})=>{
  const audit=await prepare(page,{mode:'same-address'});await toggle(page,isMobile).click();await expect(page.locator('.parking-pin-v1')).toHaveCount(3);
  await page.getByRole('combobox',{name:'주차장 구분'}).selectOption('민영');await page.locator('.parking-pin-v1').click();
  await expect(page.locator('.parking-detail-v1')).toContainText('검사 민영주차장');await expect(page.locator('.parking-detail-v1')).not.toContainText('45면');expect(audit.errors).toEqual([]);
});

test('failed extra lookup does not retry in a loop and keeps public parking usable',async({page,isMobile})=>{
  const audit=await prepare(page,{mode:'error'});await toggle(page,isMobile).click();await expect(page.locator('.parking-pin-v1')).toHaveCount(1);
  await expect(page.locator('.parking-status-v1')).toContainText('추가검색 실패');await page.waitForTimeout(1500);
  expect(await page.evaluate(()=>parkingAudit.calls.length)).toBe(1);await page.locator('.parking-pin-v1').click();await expect(page.locator('.parking-detail-v1')).toContainText('45면');expect(audit.errors).toEqual([]);
});

test('snapshot load failure still permits category results without guessing capacity',async({page,isMobile})=>{
  const audit=await prepare(page,{failData:true});await toggle(page,isMobile).click();await expect(page.locator('.parking-pin-v1')).toHaveCount(3);
  await expect(page.locator('.parking-status-v1')).toContainText('공공자료 로드 실패');
  await page.locator('[data-parking-id="kakao:private"]').click();await expect(page.locator('.parking-detail-v1')).toContainText('미확인');expect(audit.errors).toEqual([]);
});

test('dense parking is bounded and category pagination is capped with an explicit notice',async({page,isMobile})=>{
  const items=Array.from({length:170},(_,i)=>({...publicParking,id:'public-'+i,name:'공영 '+i,lng:127.37+i*.0001}));
  const audit=await prepare(page,{data:{...source,items},mode:'pages'});await toggle(page,isMobile).click();
  await expect(page.locator('.parking-pin-v1')).toHaveCount(160);await expect(page.locator('.parking-status-v1')).toContainText('가까운 160개');
  await expect(page.locator('.parking-status-v1')).toContainText('최대 45곳');expect(await page.evaluate(()=>parkingAudit.calls.map(c=>c.page))).toEqual([1,2,3]);expect(audit.errors).toEqual([]);
});

test('zoomed-out parking groups can select every member without changing the listing map',async({page,isMobile})=>{
  const audit=await prepare(page);
  await page.evaluate(()=>{map.getLevel=()=>7;map.getProjection=()=>({containerPointFromCoords:()=>({x:400,y:300})});});
  const before=await state(page);await toggle(page,isMobile).click();await expect(page.locator('.parking-pin-v1')).toHaveCount(1);
  await expect(page.locator('.parking-group-count-v1')).toHaveText('3');await page.locator('.parking-pin-v1').click();
  await expect(page.getByRole('combobox',{name:'묶인 주차장 선택'}).locator('option')).toHaveCount(3);
  await page.getByRole('combobox',{name:'묶인 주차장 선택'}).selectOption('kakao:private');
  await expect(page.locator('.parking-detail-v1 h2')).toHaveText('검사 민영주차장');
  expect(await state(page)).toEqual(before);expect(audit.errors).toEqual([]);
});

test('fold landscape toolbar and parking detail fit in the map without blocking listing controls',async({page,isMobile},info)=>{
  test.skip(!isMobile,'Landscape fit requires handheld device evidence');
  const audit=await prepare(page);
  await page.setViewportSize({width:930,height:530});const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:930,height:530,deviceScaleFactor:1,mobile:true,screenWidth:1100,screenHeight:720,screenOrientation:{type:'landscapePrimary',angle:90}});
  await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
  await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
  await page.locator('#mapParkingBtnV1').click();await expect(page.locator('.parking-pin-v1')).toHaveCount(3);
  await page.locator('[data-parking-id="public-1"]').click();
  const geometry=await page.evaluate(()=>{const b=document.querySelector('.parking-detail-v1').getBoundingClientRect(),m=document.getElementById('map').getBoundingClientRect(),p=document.getElementById('mapPolygonBtn').getBoundingClientRect();return {inside:b.top>=m.top&&b.bottom<=m.bottom&&b.left>=m.left&&b.right<=m.right,toolbar:p.bottom<=innerHeight};});
  expect(geometry).toEqual({inside:true,toolbar:true});await page.screenshot({path:info.outputPath('parking-fold-landscape.png')});expect(audit.errors).toEqual([]);
});
