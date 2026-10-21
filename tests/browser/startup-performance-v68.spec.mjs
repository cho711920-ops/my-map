import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// Private production captures never enter the repository, fixtures or reports.
test('full-size cold list renders without a cached desktop snapshot',async({page,context})=>{
  test.skip(!process.env.JS_STARTUP_CAPTURE_DIR,'Optional private read-only production capture');
  test.setTimeout(180000);
  const dir=process.env.JS_STARTUP_CAPTURE_DIR;
  const csv=await readFile(dir+'/masters.csv');
  const unified=await readFile(dir+'/originals.json');
  let live=false;
  const errors=[];
  const photoQa=process.env.JS_STARTUP_PHOTO_QA==='1';
  page.on('pageerror',e=>errors.push(e.name));
  await context.route('**/*',async r=>{
    const u=new URL(r.request().url());
    if(photoQa&&(r.request().resourceType()==='image')&&
      (u.pathname==='/api/listing-image'||/^(?:img\.kr\.gcp-karroter\.net|dnvefa72aowie\.cloudfront\.net|landthumb-phinf\.pstatic\.net|file1\.gongsilbox\.com)$/.test(u.hostname))) {
      return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#d8efe7"/></svg>'});
    }
    if(photoQa&&u.hostname==='127.0.0.1'&&u.pathname==='/'){
      const response=await r.fetch(),headers={...response.headers()};
      headers['content-security-policy']=headers['content-security-policy'].replace("img-src 'self' data:","img-src 'self' data: https://img.kr.gcp-karroter.net https://dnvefa72aowie.cloudfront.net https://landthumb-phinf.pstatic.net https://file1.gongsilbox.com");
      return r.fulfill({response,headers});
    }
    return u.hostname==='127.0.0.1'?r.continue():r.abort();
  });
  await page.route('**/api/sheet',r=>r.fulfill({headers:{'x-js-listings-revision':'capture-v68'},contentType:'text/csv',body:csv}));
  await page.route('**/api/data?**',r=>live&&new URL(r.request().url()).searchParams.get('action')==='unifiedListings'
    ?r.fulfill({headers:{'x-js-listings-revision':'capture-v68'},contentType:'application/json',body:unified}):r.fallback());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  if(photoQa&&await page.locator('[data-mobile-view="list"]').isVisible())await page.locator('[data-mobile-view="list"]').click();
  await page.evaluate(()=>{window.kakao={maps:{load(){},LatLng:function(lat,lng){this.getLat=()=>lat;this.getLng=()=>lng;}}};});
  await page.addScriptTag({content:await readFile(process.env.JS_STARTUP_MAP_SOURCE||new URL('../../js/map.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{
    document.getElementById('fixtureControls')?.remove();
    window.drawItems=items=>{showList(items);updateMapListingCountV825(items);};
    window.clearPinnedClusterSelectionV6515=()=>{};
    window.JSInitialListingsCacheV1=undefined;
    const load=JSUnifiedListingsV8.load;
    JSUnifiedListingsV8.load=(_,options)=>load(true,options);
    allItems=[];currentItems=[];visibleListItems=[];document.getElementById('list').replaceChildren();
    window.__startupLongTasks=[];
    window.__startupStages={};
    for(const name of ['parseCSVRecordsV655','getFilteredItems','showList','updateTypeOptions','refreshOriginalMetadataPresentationV1']) {
      const fn=window[name];if(!fn)continue;
      window[name]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{__startupStages[name]=(__startupStages[name]||0)+Math.round(performance.now()-start);}};
    }
    for(const name of ['attach','attachCompatible']) {
      const fn=JSUnifiedListingsV8[name];
      JSUnifiedListingsV8[name]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{__startupStages[name]=(__startupStages[name]||0)+Math.round(performance.now()-start);}};
    }
    new PerformanceObserver(list=>list.getEntries().forEach(e=>__startupLongTasks.push(e.duration))).observe({type:'longtask',buffered:false});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  live=true;
  const start=Date.now();
  await page.evaluate(photoQa=>{
    window.__firstCardV69=0;window.__firstPhotoV69=0;window.__photoStartV69=performance.now();
    if(photoQa){
      const loaded=JSUnifiedListingsV8.thumbnailImageLoaded;
      JSUnifiedListingsV8.thumbnailImageLoaded=function(image){loaded(image);if(!__firstPhotoV69)__firstPhotoV69=performance.now()-__photoStartV69;};
      const frame=()=>{if(document.querySelector('#list .item'))__firstCardV69=performance.now()-__photoStartV69;else requestAnimationFrame(frame);};requestAnimationFrame(frame);
    }
    window.__startupLoad=loadSheet(false,false);
  },photoQa);
  await expect.poll(()=>page.evaluate(()=>allItems.length),{timeout:120000}).toBeGreaterThan(30000);
  await expect.poll(()=>page.evaluate(()=>visibleListItems.length),{timeout:120000}).toBeGreaterThan(1000);
  await expect(page.locator('#jsListingsLoadStatusV65')).toHaveCount(0,{timeout:120000});
  if(photoQa)await page.evaluate(()=>{
    window.__photoCardShownV69=window.__firstCardV69;
    if(window.__firstPhotoV69)return;
    // A real inventory can start with legitimately photo-less cards. Bring
    // its first photo-bearing card into view rather than waiting for an
    // offscreen image that the viewport loader deliberately does not fetch.
    const index=visibleListItems.findIndex(i=>i.thumbnailV8);
    if(index<0)throw Error('The private capture contains no photo-bearing cards');
    window.__photoCardShownV69=performance.now()-__photoStartV69;
    getListingScrollContainerV2().scrollTop=listVirtualOffsetsV2[Math.max(0,index-1)]||0;
  });
  if(photoQa)await expect.poll(()=>page.evaluate(()=>window.__firstPhotoV69),{timeout:20000}).toBeGreaterThan(0).catch(async error=>{
    console.log(JSON.stringify(await page.evaluate(()=>({photoDiagnostic:true,
      cards:document.querySelectorAll('#list .item').length,images:document.querySelectorAll('#list .unified-thumb-v8 img').length,
      pendingImages:document.querySelectorAll('#list .unified-thumb-v8 img[data-thumbnail-pending-v69]').length,
      loadedImages:[...document.querySelectorAll('#list .unified-thumb-v8 img')].filter(i=>i.naturalWidth>0).length,
      knownPhotoItems:visibleListItems.filter(i=>i.thumbnailV8).length,
      firstRenderedPhotoIndex:visibleListItems.findIndex(i=>i.thumbnailV8),
      rootId:getListingScrollContainerV2().id,view:document.documentElement.getAttribute('data-jsm-mobile-view'),
      sidebarRect:((r)=>[r.x,r.y,r.width,r.height])(document.getElementById('sidebar').getBoundingClientRect()),
      listRect:((r)=>[r.x,r.y,r.width,r.height])(document.getElementById('list').getBoundingClientRect())}))));throw error;
  });
  const report=await page.evaluate(()=>({masters:allItems.length,visible:visibleListItems.length,
    maxLongTask:Math.round(Math.max(0,...__startupLongTasks)),longTasks:__startupLongTasks.length,
    originalMs:document.documentElement.getAttribute('data-originals-read-ms'),
    heap:performance.memory?.usedJSHeapSize,stages:__startupStages,
    firstCardMs:Math.round(window.__firstCardV69||0),firstPhotoMs:Math.round(window.__firstPhotoV69||0),
    photoCardShownMs:Math.round(window.__photoCardShownV69||0)}));
  console.log(JSON.stringify({project:test.info().project.name,elapsedMs:Date.now()-start,csvBytes:csv.length,unifiedBytes:unified.length,...report,errors}));
  expect(errors).toEqual([]);
  // The previous full-size path blocked this CPU-limited fixture for >9s.
  // Keep a generous margin for hosts while rejecting that regression.
  expect(report.maxLongTask).toBeLessThan(6000);
  if(photoQa)expect(report.firstPhotoMs-report.photoCardShownMs).toBeLessThan(5000);
});
