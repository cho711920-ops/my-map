import {test,expect} from '@playwright/test';

const photo=n=>'https://img.kr.gcp-karroter.net/realty/realty/articles/fixture-'+n+'.webp?s=1440x1440&q=95&t=inside';
const tile='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#d8efe7"/></svg>';
async function setup(page,context,{smallFails=false,noObserver=false}={}) {
  const requests=[],writes=[],details=[];
  let release;const held=new Promise(resolve=>{release=resolve;});
  if(noObserver)await page.addInitScript(mode=>{window.IntersectionObserver=mode==='throws'?function(){throw Error('fixture unsupported observer');}:undefined;},noObserver);
  await context.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());
    if(u.hostname==='img.kr.gcp-karroter.net'&&u.pathname.includes('/fixture-')) {
      requests.push({path:u.pathname,size:u.searchParams.get('s'),quality:u.searchParams.get('q'),time:Date.now()});
      if(smallFails&&u.searchParams.get('s')==='320x320')return route.fulfill({status:503,body:'fixture unavailable'});
      await held;return route.fulfill({contentType:'image/svg+xml',body:tile});
    }
    if(u.hostname!=='127.0.0.1')return route.abort();
    if(r.method()!=='GET')writes.push(u.pathname);
    if(u.searchParams.get('action')==='unifiedListingDetail')details.push(u.pathname);
    if(u.pathname==='/'){
      const response=await route.fetch(),headers={...response.headers()};
      headers['content-security-policy']=headers['content-security-policy'].replace("img-src 'self' data:","img-src 'self' data: https://img.kr.gcp-karroter.net");
      return route.fulfill({response,headers});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await expect.poll(()=>page.evaluate(()=>JSV6ListStore.load('favorite').some(f=>f.id==='fixture-favorites'))).toBe(true);
  return {requests,writes,details,release};
}
async function seed(page,isMobile) {
  if(isMobile)await page.locator('[data-mobile-view="list"]').click();
  await page.evaluate(photos=>{
    document.getElementById('fixtureControls')?.remove();
    const base=allItems.find(i=>i.tradeType==='lease');
    const items=photos.map((url,n)=>({...base,propertyId:'PHOTO-V69-'+n,key:'photo-v69-'+n,name:'사진 검수 '+n,
      regDate:'2026-10-21',registrationAt:'2026-10-21T10:00:00',sheetRow:photos.length-n}));
    const groups=Object.fromEntries(items.map((item,n)=>[item.propertyId,[{...item,source:'당근',originalId:item.propertyId+'-O',
      images:[photos[n]],thumbnail:photos[n],photoCount:1,active:1}]]));
    allItems=items;JSUnifiedListingsV8.attach(items,{ok:true,groups});
    const loaded=JSUnifiedListingsV8.thumbnailImageLoaded;
    JSUnifiedListingsV8.thumbnailImageLoaded=function(image){loaded(image);if(!window.__photoReadyV69)window.__photoReadyV69=performance.now();};
    window.__photoStartV69=performance.now();applyFilter();
    window.__photoBusinessV69=JSON.stringify(allItems);
  },Array.from({length:40},(_,n)=>photo(n)));
}

test('visible cards request small photos before offscreen cards and scrolling keeps business data intact',async({page,context,isMobile})=>{
  const state=await setup(page,context);await seed(page,isMobile);
  await expect.poll(()=>state.requests.length).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const initiallyRequested=state.requests.length;
  expect(initiallyRequested).toBeLessThanOrEqual(10);
  expect(initiallyRequested).toBeLessThan(await page.locator('#list .unified-thumb-v8 img').count());
  expect(state.requests.every(r=>r.size==='320x320'&&r.quality==='80')).toBe(true);
  await expect(page.locator('#list .unified-thumb-v8 img[src]').first()).toHaveAttribute('fetchpriority','high');
  state.release();
  await expect.poll(()=>page.locator('#list .unified-thumb-v8 img[src]').first().evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  await page.evaluate(()=>{getListingScrollContainerV2().scrollTop=1500;});
  await expect.poll(()=>state.requests.length).toBeGreaterThan(initiallyRequested);
  expect(await page.evaluate(()=>JSON.stringify(allItems)===window.__photoBusinessV69)).toBe(true);
  expect(state.writes).toEqual([]);expect(state.details).toEqual([]);
  console.log(JSON.stringify({project:test.info().project.name,initiallyRequested,firstDecodedMs:await page.evaluate(()=>Math.round(__photoReadyV69-__photoStartV69)),writes:state.writes.length,detailReads:state.details.length}));
});

for(const mode of [true,'throws'])test('a failed small photo uses its saved original with observer '+String(mode),async({page,context,isMobile})=>{
  const state=await setup(page,context,{smallFails:true,noObserver:mode});
  state.release();await seed(page,isMobile);
  const image=page.locator('#list .unified-thumb-v8 img').first();
  await expect.poll(()=>image.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  await expect(image).toHaveAttribute('src',photo(0));
  await expect(image).toHaveAttribute('data-thumbnail-source-v8144',photo(0));
  expect(state.requests.filter(r=>r.path.endsWith('/fixture-0.webp')).map(r=>r.size)).toEqual(['320x320','1440x1440']);
  expect(state.writes).toEqual([]);
});
