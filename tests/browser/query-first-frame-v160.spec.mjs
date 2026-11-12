import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('public startup preloads download code while a denied session cannot execute listing code or read private data',async({page,context})=>{
  let downloaded=0,privateReads=0;
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/js/data-access-v6.js*',route=>{downloaded++;return route.continue();});
  await context.route('**/api/session',route=>route.fulfill({status:401,json:{ok:false}}));
  await context.route('**/api/auth-config',route=>route.fulfill({json:{googleClientId:'',localLoginEnabled:true}}));
  await context.route('**/api/data**',route=>{privateReads++;return route.fulfill({status:401,json:{ok:false}});});
  await context.route('**/',async route=>route.fulfill({contentType:'text/html',body:await readFile('index.html','utf8')}));
  await page.goto('/');await expect(page.locator('#jsLocalLoginForm')).toBeVisible();
  await expect.poll(()=>downloaded).toBeGreaterThan(0);expect(privateReads).toBe(0);
  expect(await page.evaluate(()=>typeof window.JSDataAccessV6)).toBe('undefined');
  await expect(page.locator('#list .item')).toHaveCount(0);
});

test('refresh preview contains only proof-validated first-window cards even when virtualization has already appended another window',async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/preview-photo-v160.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#2563eb"/></svg>'}));
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/query-collection-v152.js'});await page.addScriptTag({url:'/js/query-preview-v154.js'});
  const result=await page.evaluate(()=>{
    map.getCenter=()=>({getLat:()=>36.3504,getLng:()=>127.3845});map.getLevel=()=>7;
    const ids=Array.from({length:12},(_,i)=>'FIRST-FRAME-'+i),proof='sha256-v1:'+'a'.repeat(64),signature=JSON.stringify({mode:'lease',filters:{sortFilter:'latest'},hideDone:true});
    const points=ids.slice(0,6).map(id=>({row:{property_id:id,source_snapshot_key:proof},unified:{ok:true,format:'expanded-v2',
      groups:{[id]:[{propertyId:id,originalId:'original-'+id}]},sourceSnapshotKeys:{[id]:proof},sourceSnapshotPropertyIds:{[id]:id}}}));
    const value={kind:'query-scope-v152',completeCatalog:false,account:JSAuthenticatedAccountEmail,cacheEpochV152:'',signature,points,
      packet:{ok:true,version:152,completeQuery:true,grouping:'client-v152',revision:'fixture-current',total:12,fields:['propertyId','sourceSnapshotKey'],rows:ids.map(id=>[id,proof])}};
    document.querySelector('#list').innerHTML=ids.map(id=>'<div class="item" data-property-id="'+id+'"><button><img src="/preview-photo-v160.svg" alt="검사 사진"></button></div>').join('');
    value.preview=JSQueryPreviewV154.capture(value);
    document.querySelector('#list').replaceChildren();document.documentElement.classList.add('auth-pending');document.querySelector('#wrap').inert=true;
    return {ids:value.preview?.ids,shown:JSQueryPreviewV154.show(value,signature,()=>true)};
  });
  expect(result.ids).toEqual(Array.from({length:6},(_,i)=>'FIRST-FRAME-'+i));expect(result.shown).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(6);
  await expect.poll(()=>page.locator('#list img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth===320))).toBe(true);
  expect(await page.locator('#wrap').evaluate(node=>node.inert)).toBe(true);
});

for(const mode of ['lease','building_sale','land_sale'])test('v216 real authenticated boot paints decoded '+mode+' photos within 1s without reading the full catalog',async({page,context})=>{
  const account='browser-fixture@example.invalid';let release,fullReads=0;
  const hold=new Promise(resolve=>{release=resolve;});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/v216-photo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#16a34a"/></svg>'}));
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/query-collection-v152.js'});await page.addScriptTag({url:'/js/query-preview-v154.js'});
  await page.evaluate(async({mode,account})=>{
    map.getCenter=()=>({getLat:()=>36.3504,getLng:()=>127.3845});map.getLevel=()=>7;
    const id='V216-'+mode,proof='sha256-v1:'+'a'.repeat(64);
    const value={kind:'query-scope-v152',completeCatalog:false,account,cacheEpochV152:'',signature:JSON.stringify({mode,hideDone:true,filters:{sortFilter:'latest'}}),points:[{
      row:{property_id:id,source_snapshot_key:proof},unified:{ok:true,format:'expanded-v2',groups:{[id]:[{propertyId:id}]},sourceSnapshotKeys:{[id]:proof},sourceSnapshotPropertyIds:{[id]:id}}
    }],packet:{ok:true,version:152,completeQuery:true,grouping:'client-v152',revision:'v216-proof',total:1,fields:['propertyId','sourceSnapshotKey'],rows:[[id,proof]]}};
    document.querySelector('#list').innerHTML='<div class="item" data-property-id="'+id+'"><button><img src="/v216-photo.svg" width="120" height="90"></button></div>';
    value.preview=JSQueryPreviewV154.capture(value);
    const compact=JSQueryPreviewV154.compact(value);
    const database=await new Promise(resolve=>{const open=indexedDB.open('js-query-scopes-v152',1);open.onupgradeneeded=()=>open.result.createObjectStore('views');open.onsuccess=()=>resolve(open.result);});
    await new Promise((resolve,reject)=>{const tx=database.transaction('views','readwrite');tx.objectStore('views').put(compact,account+'|'+mode+'|first-frame-v216');tx.oncomplete=resolve;tx.onerror=reject;});database.close();
    await new Promise(resolve=>{const img=document.querySelector('#list img');if(img.complete&&img.naturalWidth)return resolve();img.onload=resolve;});
  },{mode,account});
  let html=await readFile('index.html','utf8');
  html=html.replace(/(<option value="(?:lease|building_sale|land_sale)")[^>]*>/g,(_all,start)=>start+(start.includes('"'+mode+'"')?' selected':'')+'>');
  await context.route('**/',route=>route.fulfill({contentType:'text/html',body:html}));
  await context.route('**/api/session',route=>route.fulfill({json:{ok:true,email:account,queryListingsV152:true}}));
  await context.route('**/js/data-access-v6.js*',async route=>{await hold;return route.continue();});
  await context.route('**/api/data**',route=>{fullReads++;return route.abort();});
  await page.addInitScript(()=>{
    window.__decodedFrameV216=null;window.__largeFrameReadsV216=0;
    const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){if(this.name==='views'&&!String(key).endsWith('|first-frame-v216'))window.__largeFrameReadsV216++;return get.call(this,key);};
    function inspect(){const img=document.querySelector('#list [data-query-preview-v154] img');if(img?.complete&&img.naturalWidth===320&&img.getBoundingClientRect().height>0&&getComputedStyle(img).visibility==='visible')window.__decodedFrameV216=performance.now();else requestAnimationFrame(inspect);}requestAnimationFrame(inspect);
  });
  try{
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.locator('#list .item[data-query-preview-v154]')).toHaveCount(1,{timeout:1000});
    await expect.poll(()=>page.evaluate(()=>window.__decodedFrameV216),{timeout:1000}).not.toBeNull();
    const result=await page.evaluate(()=>({ms:__decodedFrameV216,reads:__largeFrameReadsV216,inert:document.querySelector('#wrap').inert}));
    expect(result.ms).toBeLessThanOrEqual(1000);expect(result.reads).toBe(0);expect(result.inert).toBe(true);expect(fullReads).toBe(0);
    await test.info().attach('v216-'+mode+'-decoded-first-frame',{body:Buffer.from(JSON.stringify(result)),contentType:'application/json'});
  }finally{release();await context.unrouteAll({behavior:'ignoreErrors'});}
});

test.describe('v216 installed public shell',()=>{
  test.use({serviceWorkers:'allow'});
  test('actual service worker avoids another HTML round trip but never authorizes private data from the cached shell',async({page,context})=>{
    const shell='/startup-shell-v216-'+'a'.repeat(24),html=await readFile('index.html','utf8');
    let navigations=0,privateReads=0,sessionChecks=0;
    const worker=(await readFile('sw.js','utf8')).replace('"__JS_MAP_BUILD_VERSION__"','"v216-isolated-browser"')
      .replace('"__JS_MAP_STARTUP_SHELL__"',JSON.stringify(shell));
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await context.route('**/sw.js?fixture-v216',route=>route.fulfill({contentType:'text/javascript',body:worker,headers:{'service-worker-allowed':'/'}}));
    await context.route('**'+shell,route=>route.fulfill({contentType:'text/html',body:html,headers:{'cache-control':'public,max-age=31536000,immutable'}}));
    await context.route(/\/(?:offline|manifest\.webmanifest|icons\/js-(?:192|512)\.png)$/,route=>{
      const path=new URL(route.request().url()).pathname;
      return route.fulfill({contentType:path.endsWith('.png')?'image/png':path.endsWith('.webmanifest')?'application/manifest+json':'text/html',body:'public install fixture',headers:{'cache-control':'public,max-age=3600'}});
    });
    await context.route('**/api/session',route=>{sessionChecks++;return route.fulfill({status:401,json:{ok:false}});});
    await context.route('**/api/auth-config',route=>route.fulfill({json:{localLoginEnabled:true}}));
    await context.route('**/api/data**',route=>{privateReads++;return route.abort();});
    await context.route('**/',route=>{navigations++;return route.continue();});
    await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
    await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js?fixture-v216',{scope:'/'});await navigator.serviceWorker.ready;});
    const before=navigations,beforePrivate=privateReads;await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.locator('#jsLocalLoginForm')).toBeVisible();
    expect(navigations).toBe(before);expect(sessionChecks).toBeGreaterThan(0);expect(privateReads).toBe(beforePrivate);
    expect(await page.evaluate(async()=>{
      const entries=await Promise.all((await caches.keys()).map(async key=>{const cache=await caches.open(key);return Promise.all((await cache.keys()).map(async request=>({path:new URL(request.url).pathname,private:/jsNavigationSessionV149|browser-fixture@example/.test(await(await cache.match(request)).text())})));}));
      return entries.flat().every(entry=>entry.path!=='/'&&!entry.private);
    })).toBe(true);
    await expect(page.locator('#wrap')).toHaveCount(0);
  });
});
