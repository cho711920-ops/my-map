import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const fields=Array.from({length:33},(_,i)=>'field'+i);
const row=(i)=>['연결 검수상가 '+i,'대전 서구 괴정동 '+i+'-1','1층','상가',2000,90,0,0,25,'','','가상 검수','active','2026-10-21','네이버','FIXTURE-LEASE-'+i,'','',2000,0,'20200101','2026-10-21','ok','2026-10-21','2026-10-21',36.35,127.38,0,'lease','','','',''];
const csv=[fields,row(1),row(2)].map(r=>r.join(',')).join('\n');

async function setup(page,{mode='transient',preserve=false}={}) {
  const stats={requests:0,writes:0,mode};
  await page.context().route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.route('**/api/sheet',route=>{
    stats.requests++;
    if(stats.mode==='auth')return route.fulfill({status:401,json:{ok:false,message:'세션 만료'}});
    if(stats.mode==='failure'||stats.mode==='transient'&&stats.requests===1)return route.fulfill({status:503,json:{ok:false,message:'일시적인 통신 오류'}});
    return route.fulfill({headers:{'x-js-listings-revision':'fixture-v65'},contentType:'text/csv',
      body:stats.mode==='html'?'<html>잘못된 중간 응답</html>':stats.mode==='empty'?fields.join(','):csv});
  });
  await page.route('**/api/data?**',route=>new URL(route.request().url()).searchParams.get('action')==='unifiedListings'
    ?route.fulfill({headers:{'x-js-listings-revision':'fixture-v65'},json:{ok:true,groups:{},sourceSearchIds:{}}}):route.fallback());
  page.on('request',request=>{if(request.method()==='POST')stats.writes++;});
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>{window.kakao={maps:{load(){},LatLng:function(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}}};});
  const source=await readFile(process.env.JS_BASELINE_MAP_V65 || new URL('../../js/map.js',import.meta.url),'utf8');
  await page.addScriptTag({content:source});
  await page.evaluate(preserve=>{
    document.getElementById('fixtureControls')?.remove();
    window.drawItems=items=>{showList(items);updateMapListingCountV825(items);};
    window.clearPinnedClusterSelectionV6515=()=>{};
    window.JSInitialListingsCacheV1=undefined;
    if(preserve)jsListingsCompleteBaseV1=true;
    else {allItems=[];currentItems=[];visibleListItems=[];document.getElementById('list').replaceChildren();}
    window.__v65Load=()=>{window.__v65Pending=loadSheet(jsListingsCompleteBaseV1,false);};
  },preserve);
  return stats;
}

test('a transient first load recovers once and shows the complete list on desktop and mobile',async({page})=>{
  const stats=await setup(page);
  await page.evaluate(()=>__v65Load());
  await expect.poll(()=>stats.requests,{timeout:8000}).toBe(2);
  await expect.poll(()=>page.evaluate(()=>visibleListItems.length)).toBe(2);
  await expect(page.locator('#jsListingsLoadStatusV65')).toHaveCount(0);
  await expect(page.locator('#mapListingCountValueV825')).toHaveText('2개');
  expect(stats.writes).toBe(0);
});

test('persistent failures stay visible with a bounded retry and a working manual recovery',async({page})=>{
  const stats=await setup(page,{mode:'failure'});
  await page.evaluate(()=>__v65Load());
  await expect.poll(()=>stats.requests).toBe(2);
  await expect(page.locator('#jsListingsLoadStatusV65')).toContainText('다시 시도');
  await expect(page.locator('#mapListingCountValueV825')).toHaveText('확인 필요');
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));refreshListingsWhenChangedV682();});
  await page.waitForTimeout(200);expect(stats.requests).toBe(2);
  const panel=await page.locator('#jsListingsLoadStatusV65').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x+panel.width).toBeLessThanOrEqual(page.viewportSize().width+1);
  stats.mode='success';await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>visibleListItems.length)).toBe(2);
  await expect(page.locator('#jsListingsLoadStatusV65')).toHaveCount(0);expect(stats.requests).toBe(3);expect(stats.writes).toBe(0);
});

test('expired reads await reauthentication and recover only the read after login',async({page})=>{
  const stats=await setup(page,{mode:'auth'});
  await page.evaluate(()=>{window.__v65Auth=0;window.addEventListener('js-auth-required',()=>__v65Auth++);__v65Load();});
  await expect(page.locator('#jsListingsLoadStatusV65')).toContainText('로그인이 만료');
  await page.waitForTimeout(2200);expect(stats.requests).toBe(1);
  await page.getByRole('button',{name:'다시 로그인',exact:true}).click();
  expect(await page.evaluate(()=>__v65Auth)).toBe(2);
  stats.mode='success';await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-restored')));
  await expect.poll(()=>page.evaluate(()=>visibleListItems.length)).toBe(2);expect(stats.requests).toBe(2);expect(stats.writes).toBe(0);
});

test('failed refresh preserves existing cards, selection and memo drafts without automatic full downloads',async({page})=>{
  const stats=await setup(page,{mode:'failure',preserve:true});
  const before=await page.evaluate(()=>{
    selectedPrintKeys=['fixture-lease-1'];memoDraftValuesV655['fixture-lease-1']='저장 전 메모';
    window.__v65Card=document.querySelector('#list .item');__v65Load();return visibleListItems.map(i=>i.propertyId);
  });
  await expect(page.locator('#jsListingsLoadStatusV65')).toContainText('최근 확인한 목록');
  await page.waitForTimeout(2200);expect(stats.requests).toBe(1);
  expect(await page.evaluate(()=>visibleListItems.map(i=>i.propertyId))).toEqual(before);
  expect(await page.evaluate(()=>({selected:selectedPrintKeys,draft:memoDraftValuesV655['fixture-lease-1'],same:__v65Card===document.querySelector('#list .item')})))
    .toEqual({selected:['fixture-lease-1'],draft:'저장 전 메모',same:true});
  expect(stats.writes).toBe(0);
});

test('a confirmed empty CSV is distinct from an invalid HTML response',async({page})=>{
  const stats=await setup(page,{mode:'empty'});await page.evaluate(()=>__v65Load());
  await expect(page.locator('#mapListingCountValueV825')).toHaveText('0개');
  await expect(page.locator('#jsListingsLoadStatusV65')).toHaveCount(0);
  stats.mode='html';await page.evaluate(()=>__v65Load());
  await expect(page.locator('#jsListingsLoadStatusV65')).toContainText('매물을 불러오지 못했습니다');
});

test('a stalled response body reaches its deadline and never leaves an endless zero-count screen',async({page})=>{
  await setup(page,{mode:'success'});await page.clock.install();
  await page.evaluate(()=>{
    var original=window.fetch;window.__v65Held=0;
    window.fetch=function(url,options){
      if(String(url)==='/api/sheet') {__v65Held++;return Promise.resolve({ok:true,headers:new Headers(),text:()=>new Promise(()=>{})});}
      return original(url,options);
    };
    __v65Load();
  });
  await expect(page.locator('#mapListingCountValueV825')).toHaveText('불러오는 중');
  await page.clock.fastForward(45001);
  await expect(page.locator('#jsListingsLoadStatusV65')).toContainText('매물을 불러오지 못했습니다');
  await page.clock.fastForward(2001);
  await expect.poll(()=>page.evaluate(()=>__v65Held)).toBe(2);
  await page.clock.fastForward(45001);
  await expect(page.locator('#mapListingCountValueV825')).toHaveText('확인 필요');
  await expect(page.getByRole('button',{name:'다시 불러오기',exact:true})).toBeVisible();
  await page.clock.fastForward(120000);
  expect(await page.evaluate(()=>__v65Held)).toBe(2);
});

test('Samsung tablet landscape keeps a visible retry and loads listings after a connection failure',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1280,height:853},screen:{width:1280,height:853},isMobile:true,hasTouch:true,
    userAgent:'Mozilla/5.0 (Linux; Android 14; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36'});
  try {
    const page=await context.newPage();const stats=await setup(page,{mode:'failure'});await page.evaluate(()=>__v65Load());
    await expect.poll(()=>stats.requests).toBe(2);await expect(page.getByRole('button',{name:'다시 불러오기',exact:true})).toBeVisible();
    await page.screenshot({path:test.info().outputPath('tablet-visible-load-error.png')});
    stats.mode='success';await page.getByRole('button',{name:'다시 불러오기',exact:true}).tap();
    await expect.poll(()=>page.evaluate(()=>visibleListItems.length)).toBe(2);
    await page.screenshot({path:test.info().outputPath('tablet-recovered-list.png')});expect(stats.writes).toBe(0);
  } finally {await context.close();}
});
