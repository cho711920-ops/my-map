import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createFixtureServer} from './fixture-server.mjs';

// Private captures stay outside the repository. Keep their content out of
// screenshots/traces; only aggregate timings and a comparison hash are reported.
test.use({screenshot:'off',trace:'off',video:'off'});
test('full-size cold list renders without a cached desktop snapshot',async({page,context})=>{
  test.skip(!process.env.JS_STARTUP_CAPTURE_DIR,'Optional private read-only production capture');
  test.setTimeout(180000);
  const dir=process.env.JS_STARTUP_CAPTURE_DIR;
  const csv=await readFile(dir+'/masters.csv');
  const unified=await readFile(dir+'/originals.json');
  let live=false;
  // Stream large captures over loopback HTTP. DevTools fulfill base64 exceeds
  // Chromium's 100MB pipe frame limit once a CSV grows beyond about 75MB.
  const privateServer=createFixtureServer();
  const fixtureRequest=privateServer.listeners('request')[0];
  privateServer.removeAllListeners('request');
  privateServer.on('request',(request,response)=>{
    const u=new URL(request.url,'http://127.0.0.1');
    const body=live&&request.method==='GET'?(u.pathname==='/api/sheet'?csv:
      u.pathname==='/api/data'&&u.searchParams.get('action')==='unifiedListings'?unified:null):null;
    if(body){response.writeHead(200,{'content-type':u.pathname==='/api/sheet'?'text/csv':'application/json',
      'x-js-listings-revision':'capture-v68','cache-control':'no-store'});response.end(body);}
    else fixtureRequest(request,response);
  });
  await new Promise(resolve=>privateServer.listen(0,'127.0.0.1',resolve));
  const privateOrigin='http://127.0.0.1:'+privateServer.address().port;
  test.info().annotations.push({type:'capture',description:'Private loopback; aggregate measurements only'});
  context.on('close',()=>{privateServer.closeAllConnections();privateServer.close();});
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
  if(process.env.JS_STARTUP_UNIFIED_SOURCE)await page.route('**/js/unified-listings-v8.js',r=>r.fulfill({contentType:'text/javascript',path:process.env.JS_STARTUP_UNIFIED_SOURCE}));
  await page.goto(privateOrigin+'/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
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
  if(process.env.JS_STARTUP_PROFILE==='1'){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
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
  const inventoryHash=await page.evaluate(async()=>{
    const rows=allItems.map(i=>[i.propertyId,i.key,i.name,i.address,i.room,i.type,i.deposit,i.rent,i.fee,i.premium,i.area,i.tradeType,i.salePrice,i.state,i.source,i.thumbnailV8,
      JSUnifiedListingsV8.allOriginals(i.propertyId).map(o=>[o.originalId,o.source,o.active,o.deposit,o.rent,o.salePrice,o.thumbnail])]);
    const bytes=new TextEncoder().encode(JSON.stringify([rows,visibleListItems.map(i=>[i.propertyId,i.key,i.deposit,i.rent,i.fee,i.premium,i.area,i.salePrice,i.source,i.thumbnailV8,i.unifiedDisplayOriginalsV2?.map(o=>o.originalId)])]));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  });
  if(process.env.JS_STARTUP_EXPECTED_HASH)expect(inventoryHash).toBe(process.env.JS_STARTUP_EXPECTED_HASH);
  const report=await page.evaluate(()=>({masters:allItems.length,visible:visibleListItems.length,
    maxLongTask:Math.round(Math.max(0,...__startupLongTasks)),longTasks:__startupLongTasks.length,
    originalMs:document.documentElement.getAttribute('data-originals-read-ms'),
    heap:performance.memory?.usedJSHeapSize,stages:__startupStages,
    firstCardMs:Math.round(window.__firstCardV69||0),firstPhotoMs:Math.round(window.__firstPhotoV69||0),
    photoCardShownMs:Math.round(window.__photoCardShownV69||0)}));
  if(process.env.JS_STARTUP_PROFILE==='1'){const {profile}=await cdp.send('Profiler.stop');const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const times=new Map();profile.samples?.forEach((id,i)=>{const name=nodes.get(id)?.callFrame.functionName||'(anonymous)';times.set(name,(times.get(name)||0)+(profile.timeDeltas?.[i]||0));});console.log(JSON.stringify({cpuProfile:[...times].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([name,us])=>({name,ms:Math.round(us/1000)}))}));}
  console.log(JSON.stringify({project:test.info().project.name,elapsedMs:Date.now()-start,csvBytes:csv.length,unifiedBytes:unified.length,inventoryHash,...report,errors}));
  expect(errors).toEqual([]);
  // The previous full-size path blocked this CPU-limited fixture for >9s.
  // Keep a generous margin for hosts while rejecting that regression.
  expect(report.maxLongTask).toBeLessThan(6000);
  if(photoQa)expect(report.firstPhotoMs-report.photoCardShownMs).toBeLessThan(5000);
});
