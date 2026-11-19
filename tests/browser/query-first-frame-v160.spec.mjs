import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';

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
      const entries=await Promise.all((await caches.keys()).map(async key=>{const cache=await caches.open(key);return Promise.all((await cache.keys()).map(async request=>({path:new URL(request.url).pathname,private:/<script\b[^>]*\bid=["']jsNavigationSessionV149["']|browser-fixture@example/i.test(await(await cache.match(request)).text())})));}));
      return entries.flat().every(entry=>entry.path!=='/'&&!entry.private);
    })).toBe(true);
    await expect(page.locator('#wrap')).toHaveCount(0);
  });
});

test.describe('v240 ordinary-address release adoption',()=>{
  test.use({serviceWorkers:'allow'});
  test('another open editing tab cannot pin ordinary reloads to an old public shell, and release preparation never reloads its draft',async({context})=>{
    const oldBuild='a'.repeat(24),newBuild='b'.repeat(24),hash=body=>createHash('sha256').update(body).digest('hex');
    const script=build=>'window.executedBuild='+JSON.stringify(build)+';',scriptPath=build=>'/js/release-fixture.js?build='+hash(script(build)).slice(0,16);
    const html=build=>'<html><head><template id="jsAuthenticatedHeadAssets"></template></head><body>'+
      '<label>메모 초안<input id="draft"></label><p id="build">'+build+'</p>'+
      '<script src="'+scriptPath(build)+'"></script></body></html>';
    const oldHtml=html(oldBuild),newHtml=html(newBuild);
    const worker=(await readFile('sw.js','utf8')).replace('"__JS_MAP_BUILD_VERSION__"',JSON.stringify(oldBuild))
      .replace('"__JS_MAP_STARTUP_SHELL__"',JSON.stringify('/startup-shell-v216-'+oldBuild))
      .replace('/* __JS_MAP_PUBLIC_ASSETS__ */ []',JSON.stringify([scriptPath(oldBuild)]));
    let release;
    const ready=new Promise(resolve=>{release=resolve;});
    let rootReads=0,manifestReads=0;
    const server=createServer(async(request,response)=>{
      const url=new URL(request.url,'http://127.0.0.1');
      const send=(type,body)=>{response.writeHead(200,{'content-type':type,'cache-control':'public,max-age=0,must-revalidate','service-worker-allowed':'/'});response.end(body);};
      if(url.pathname==='/sw.js')return send('text/javascript',worker);
      if(url.pathname==='/public-release-v240.json'){
        if(request.method==='HEAD')return send('application/json','');
        manifestReads++;await ready;
        return send('application/json',JSON.stringify({version:240,build:newBuild,shellUrl:'/startup-shell-v216-'+newBuild,shellSha256:hash(newHtml),
          assets:[{url:scriptPath(newBuild),sha256:hash(script(newBuild))}]}));
      }
      if(url.pathname==='/startup-shell-v216-'+oldBuild)return send('text/html',oldHtml);
      if(url.pathname==='/startup-shell-v216-'+newBuild)return send('text/html',newHtml);
      if(url.pathname==='/js/release-fixture.js')return send('text/javascript',script(url.search===new URL(scriptPath(newBuild),'http://localhost').search?newBuild:oldBuild));
      if(url.pathname==='/'){rootReads++;return send('text/html',oldHtml);}
      return send(url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.webmanifest')?'application/manifest+json':'text/html','public fixture');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const editor=await context.newPage(),next=await context.newPage();
    try{
      await editor.goto(origin+'/');
      await editor.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js?fixture-v240',{scope:'/'});await navigator.serviceWorker.ready;});
      await editor.reload({waitUntil:'domcontentloaded'});await expect(editor.locator('#build')).toHaveText(oldBuild);
      await editor.locator('#draft').fill('저장 전 초안과 선택 원장 그대로');
      const before=rootReads;
      await next.goto(origin+'/',{waitUntil:'domcontentloaded'});await expect(next.locator('#build')).toHaveText(oldBuild);
      expect(rootReads).toBe(before); // No network-root round trip, even with release discovery blocked.
      expect(manifestReads).toBe(1);release();
      await expect.poll(()=>editor.evaluate(async()=>{
        const cache=await caches.open('js-map-public-shell-v240');
        return (await cache.match(location.origin+'/startup-current-v240'))?.headers.get('x-js-public-shell-build-v240');
      })).toBe(newBuild);
      await next.reload({waitUntil:'domcontentloaded'});
      await expect(next.locator('#build')).toHaveText(newBuild);
      expect(await next.evaluate(()=>window.executedBuild)).toBe(newBuild);
      expect(rootReads).toBe(before);
      await expect(editor.locator('#draft')).toHaveValue('저장 전 초안과 선택 원장 그대로');
      await expect(editor.locator('#build')).toHaveText(oldBuild);
      expect(await editor.evaluate(()=>window.executedBuild)).toBe(oldBuild);
      expect(await editor.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).active.scriptURL)).toBe(origin+'/sw.js?fixture-v240');
    }finally{
      release();await editor.close();await next.close();
      // A service-worker keep-alive can outlive both closed fixture tabs.
      // All release/draft assertions above must finish before cleanup.
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    }
  });
  test('installing v240 repairs the real pre-v240 worker navigation cache without claiming or reloading an open editor',async({context})=>{
    const oldBuild='c'.repeat(24),newBuild='d'.repeat(24),hash=body=>createHash('sha256').update(body).digest('hex');
    const script=build=>'window.executedBuild='+JSON.stringify(build)+';',scriptPath=build=>'/js/migration-editor.js?build='+hash(script(build)).slice(0,16);
    const html=build=>'<html><head><template id="jsAuthenticatedHeadAssets"></template></head><body><input id="draft"><p id="build">'+build+
      '</p><script src="'+scriptPath(build)+'"></script></body></html>';
    const makeWorker=(source,build)=>source.replace('"__JS_MAP_BUILD_VERSION__"',JSON.stringify(build))
      .replace('"__JS_MAP_STARTUP_SHELL__"',JSON.stringify('/startup-shell-v216-'+build))
      .replace('/* __JS_MAP_PUBLIC_ASSETS__ */ []',JSON.stringify([scriptPath(build)]));
    const oldWorker=makeWorker(await readFile('tests/fixtures/public-worker-before-v240.txt','utf8'),oldBuild);
    const newWorker=makeWorker(await readFile('sw.js','utf8'),newBuild);
    let upgraded=false,wrongAsset=false,rootReads=0;
    const server=createServer((request,response)=>{
      const url=new URL(request.url,'http://127.0.0.1');
      const send=(type,body)=>{response.writeHead(200,{'content-type':type,'cache-control':type==='text/javascript'?'public,max-age=31536000,immutable':'public,max-age=0,must-revalidate','service-worker-allowed':'/'});response.end(body);};
      if(url.pathname==='/sw.js')return send('text/javascript',upgraded?newWorker:oldWorker);
      if(url.pathname==='/public-release-v240.json')return send('application/json',JSON.stringify({version:240,build:newBuild,shellUrl:'/startup-shell-v216-'+newBuild,
        shellSha256:hash(html(newBuild)),assets:[{url:scriptPath(newBuild),sha256:hash(script(newBuild))}]}));
      if(url.pathname==='/startup-shell-v216-'+oldBuild)return send('text/html',html(oldBuild));
      if(url.pathname==='/startup-shell-v216-'+newBuild)return send('text/html',html(newBuild));
      if(url.pathname==='/js/migration-editor.js')return send('text/javascript',url.search===new URL(scriptPath(newBuild),'http://localhost').search
        ?wrongAsset?'window.executedBuild="WRONG SERVER BYTES";':script(newBuild):script(oldBuild));
      if(url.pathname==='/'){rootReads++;return send('text/html',html(oldBuild));}
      return send(url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.webmanifest')?'application/manifest+json':'text/html','public fixture');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
    const editor=await context.newPage(),next=await context.newPage();
    try{
      await editor.goto(origin+'/');
      await editor.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js?legacy-v240',{scope:'/'});await navigator.serviceWorker.ready;});
      await editor.reload({waitUntil:'domcontentloaded'});await expect(editor.locator('#build')).toHaveText(oldBuild);
      await editor.locator('#draft').fill('원장 A 저장 전 입력 보존');const before=rootReads;
      // A stale worker can have wrong bytes at a new fingerprint URL. Repair
      // that exact public entry rather than failing every later update.
      await editor.evaluate(async({path,build})=>{
        const cache=await caches.open('js-map-public-static-v1-'+build);
        await cache.put(location.origin+path,new Response('window.executedBuild="WRONG CACHED CODE";',{
          headers:{'content-type':'text/javascript','cache-control':'public,max-age=31536000,immutable'}
        }));
      },{path:scriptPath(newBuild),build:oldBuild});
      upgraded=true;await editor.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());
      await expect.poll(()=>editor.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).waiting?.state)).toBe('installed');
      // New deployment bytes are now unavailable at the server. The exact
      // verified new asset must come from its prepared public browser cache.
      wrongAsset=true;await next.goto(origin+'/',{waitUntil:'domcontentloaded'});
      await expect(next.locator('#build')).toHaveText(newBuild);
      expect(await next.evaluate(()=>window.executedBuild)).toBe(newBuild);expect(rootReads).toBe(before);
      expect(await next.evaluate(async({path,build})=>{
        const cache=await caches.open('js-map-public-static-v1-'+build);
        return (await cache.match(location.origin+path)).text();
      },{path:scriptPath(newBuild),build:oldBuild})).toBe(script(newBuild));
      await expect(editor.locator('#draft')).toHaveValue('원장 A 저장 전 입력 보존');
      await expect(editor.locator('#build')).toHaveText(oldBuild);expect(await editor.evaluate(()=>window.executedBuild)).toBe(oldBuild);
      expect(await editor.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).waiting?.state)).toBe('installed');
    }finally{await editor.close();await next.close();await new Promise(resolve=>server.close(resolve));}
  });
});

// A real controlled navigation and script response, with failures limited to
// this isolated worker. This is mobile Chromium coverage, not Samsung 실기.
test.describe('v258 optional cache failure',()=>{
  test.use({serviceWorkers:'allow'});
  for(const mode of ['failure','stall'])for(const failure of ['open','match','put'])test('online navigation and actual code survive CacheStorage '+failure+' '+mode,async({context})=>{
    const build='e'.repeat(24),asset='/js/cache-failure-v258.js?build=0123456789abcdef';
    const html='<html><head><template id="jsAuthenticatedHeadAssets"></template></head><body><label>미저장 메모<input id="draft"></label><p id="result">코드 대기</p><script src="'+asset+'"></script></body></html>';
    const prefix='let cacheFaultV258=false;self.addEventListener("message",e=>{if(e.data==="fixture-cache-fault-v258"){cacheFaultV258=true;e.ports[0].postMessage("ready");}});'+
      'const originalV258='+ (failure==='open'?'CacheStorage':'Cache')+'.prototype.'+failure+';'+
      (failure==='open'?'CacheStorage':'Cache')+'.prototype.'+failure+'=function(...args){if(cacheFaultV258)return '+(mode==='stall'?'new Promise(()=>{})':'Promise.reject(new DOMException("Device cache unavailable","QuotaExceededError"))')+';return originalV258.apply(this,args);};';
    const worker=prefix+(await readFile('sw.js','utf8')).replace('"__JS_MAP_BUILD_VERSION__"',JSON.stringify(build))
      .replace('"__JS_MAP_STARTUP_SHELL__"',JSON.stringify('/startup-shell-v216-'+build))
      .replace('/* __JS_MAP_PUBLIC_ASSETS__ */ []',JSON.stringify([asset]));
    let rootReads=0;
    const server=createServer((request,response)=>{
      const url=new URL(request.url,'http://127.0.0.1');
      const send=(type,body)=>{response.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'public,max-age=3600','service-worker-allowed':'/'});response.end(body);};
      if(url.pathname==='/sw.js')return send('text/javascript',worker);
      if(url.pathname==='/public-release-v240.json'){response.writeHead(404);return response.end();}
      if(url.pathname==='/js/cache-failure-v258.js')return send('text/javascript','document.getElementById("result").textContent="실제 코드 실행 완료";');
      if(url.pathname.startsWith('/startup-shell-v216-'))return send('text/html',html);
      if(url.pathname==='/'){rootReads++;return send('text/html',html);}
      return send(url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.webmanifest')?'application/manifest+json':'text/html','public fixture');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
    const page=await context.newPage();
    try{
      await page.goto(origin+'/');await expect(page.locator('#result')).toHaveText('실제 코드 실행 완료');
      await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
      await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;await new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>resolve();registration.active.postMessage('fixture-cache-fault-v258',[channel.port2]);});localStorage.setItem('memoDraftV258','미저장 메모 보존');});
      const before=rootReads;await page.reload({waitUntil:'domcontentloaded'});
      await expect(page.locator('#result')).toHaveText('실제 코드 실행 완료');
      expect(await page.evaluate(()=>localStorage.getItem('memoDraftV258'))).toBe('미저장 메모 보존');
      if(failure!=='put')expect(rootReads).toBeGreaterThan(before);
      expect(await page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    }finally{await page.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
  });
});
