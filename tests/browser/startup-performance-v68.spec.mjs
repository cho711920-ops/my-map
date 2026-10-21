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
  page.on('pageerror',e=>errors.push(e.name));
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.route('**/api/sheet',r=>r.fulfill({headers:{'x-js-listings-revision':'capture-v68'},contentType:'text/csv',body:csv}));
  await page.route('**/api/data?**',r=>live&&new URL(r.request().url()).searchParams.get('action')==='unifiedListings'
    ?r.fulfill({headers:{'x-js-listings-revision':'capture-v68'},contentType:'application/json',body:unified}):r.fallback());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
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
  await page.evaluate(()=>{window.__startupLoad=loadSheet(false,false);});
  await expect.poll(()=>page.evaluate(()=>allItems.length),{timeout:120000}).toBeGreaterThan(30000);
  await expect.poll(()=>page.evaluate(()=>visibleListItems.length),{timeout:120000}).toBeGreaterThan(1000);
  await expect(page.locator('#jsListingsLoadStatusV65')).toHaveCount(0,{timeout:120000});
  const report=await page.evaluate(()=>({masters:allItems.length,visible:visibleListItems.length,
    maxLongTask:Math.round(Math.max(0,...__startupLongTasks)),longTasks:__startupLongTasks.length,
    originalMs:document.documentElement.getAttribute('data-originals-read-ms'),
    heap:performance.memory?.usedJSHeapSize,stages:__startupStages}));
  console.log(JSON.stringify({project:test.info().project.name,elapsedMs:Date.now()-start,csvBytes:csv.length,unifiedBytes:unified.length,...report,errors}));
  expect(errors).toEqual([]);
});
