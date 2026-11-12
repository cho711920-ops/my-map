import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const tile='https://tiles-v195.kakaocdn.net/sdk-managed/test.png';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d9e7d4"/></svg>';
async function setup(page,context){
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.route('**/__fixture/map-tiles-v105',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>#map{position:relative;width:min(500px,95vw);height:400px;overflow:hidden}img{position:absolute;width:256px;height:256px;left:0;top:0}</style><div id="map"></div><div id="outside"></div>'}));
 await page.goto('/__fixture/map-tiles-v105');await page.addScriptTag({url:'/js/map-tile-recovery-v105.js'});
 await page.evaluate(()=>{
  window.__mapEvents={};window.__sdkLoads=0;window.__relayouts=0;window.__centerSets=0;window.__srcWrites=0;
  window.kakao={maps:{event:{addListener(m,n,fn){(__mapEvents[n]||(__mapEvents[n]=[])).push(fn);},removeListener(m,n,fn){__mapEvents[n]=__mapEvents[n].filter(f=>f!==fn);}}}};
  const point=n=>({n,equals(other){return other.n===n;}});let center=point(1);
  window.map={getCenter(){return center;},getLevel(){return 3;},setCenter(value){__centerSets++;center=value;},relayout(){__relayouts++;if(window.__shiftCenter)center=point(2);}};
  window.fireMap=name=>(__mapEvents[name]||[]).forEach(fn=>fn());window.controller=JSMapTileRecoveryV105.attach(document.getElementById('map'),map);
  window.addTile=(url,id='tile',parent='map')=>{const img=document.createElement('img');img.id=id;img.addEventListener('load',()=>__sdkLoads++);img.src=url;document.getElementById(parent).append(img);new MutationObserver(records=>{__srcWrites+=records.length;}).observe(img,{attributes:true,attributeFilter:['src']});};
 });
}
const restored=page=>expect.poll(()=>page.evaluate(()=>__relayouts)).toBe(1);

test('healthy navigation never refetches images or forces a map layout',async({page,context})=>{
 await setup(page,context);let hits=0;await page.route(tile,r=>{hits++;return r.fulfill({contentType:'image/svg+xml',body:svg});});await page.evaluate(url=>addTile(url),tile);
 await expect.poll(()=>page.locator('#tile').evaluate(i=>i.naturalWidth)).toBe(256);await page.evaluate(()=>{for(let i=0;i<10;i++){fireMap('dragstart');fireMap('dragend');fireMap('zoom_start');fireMap('idle');}});await page.waitForTimeout(150);
 expect(hits).toBe(1);expect(await page.evaluate(()=>({writes:__srcWrites,layouts:__relayouts}))).toEqual({writes:0,layouts:0});
});
test('failed SDK resources are never directly re-requested or reported recovered',async({page,context})=>{
 await setup(page,context);let hits=0;await page.route(tile,r=>{hits++;return r.abort('failed');});await page.evaluate(url=>addTile(url),tile);await expect.poll(()=>hits).toBe(1);
 await page.evaluate(()=>dispatchEvent(new Event('online')));await restored(page);expect(hits).toBe(1);expect(await page.evaluate(()=>__srcWrites)).toBe(0);expect(await page.evaluate(()=>JSMapTileRecoveryV105.stats())).toEqual({mode:'sdk-managed-v195',relayouts:1,pending:false});
});
test('persistent resource errors and repeated SDK idle events cannot create a retry loop',async({page,context})=>{
 await setup(page,context);let hits=0;await page.route(tile,r=>{hits++;return r.abort('failed');});await page.evaluate(url=>addTile(url),tile);await expect.poll(()=>hits).toBe(1);
 await page.evaluate(()=>{for(let i=0;i<40;i++)fireMap('idle');});await page.waitForTimeout(150);expect(hits).toBe(1);expect(await page.evaluate(()=>__relayouts)).toBe(0);
});
test('online restoration waits for dragging or zooming to end',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{fireMap('dragstart');dispatchEvent(new Event('online'));});await page.waitForTimeout(100);expect(await page.evaluate(()=>__relayouts)).toBe(0);await page.evaluate(()=>fireMap('dragend'));await restored(page);
});
test('zero-size and hidden containers defer a pending public relayout',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{document.getElementById('map').style.display='none';dispatchEvent(new Event('online'));});await page.waitForTimeout(100);expect(await page.evaluate(()=>__relayouts)).toBe(0);
 await page.evaluate(()=>{document.getElementById('map').style.display='block';fireMap('idle');});await restored(page);
});
test('listing photos and images outside the map receive no private-resource handling',async({page,context})=>{
 await setup(page,context);let hits=0;await page.route('https://photos.example.invalid/**',r=>{hits++;return r.abort('failed');});await page.evaluate(()=>{addTile('https://photos.example.invalid/a.jpg','photo');addTile('https://photos.example.invalid/b.jpg','outside-photo','outside');});await expect.poll(()=>hits).toBe(2);await page.waitForTimeout(100);expect(await page.evaluate(()=>({writes:__srcWrites,layouts:__relayouts}))).toEqual({writes:0,layouts:0});
});
test('page suspension cancels pending layout work until pageshow',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{dispatchEvent(new Event('online'));dispatchEvent(new Event('pagehide'));});await page.waitForTimeout(100);expect(await page.evaluate(()=>__relayouts)).toBe(0);await page.evaluate(()=>dispatchEvent(new Event('pageshow')));await restored(page);
});
test('restoration has a bounded per-minute budget and coalesces repeated events',async({page,context})=>{
 await setup(page,context);for(let n=1;n<=2;n++){await page.evaluate(()=>{for(let i=0;i<20;i++)dispatchEvent(new Event('online'));});await expect.poll(()=>page.evaluate(()=>__relayouts)).toBe(n);}
 await page.evaluate(()=>{for(let i=0;i<20;i++)dispatchEvent(new Event('pageshow'));});await page.waitForTimeout(150);expect(await page.evaluate(()=>__relayouts)).toBe(2);await page.evaluate(()=>controller.destroy());
});
test('SDK images loaded off-DOM retain their native handlers when inserted',async({page,context})=>{
 await setup(page,context);let hits=0;await page.route(tile,r=>{hits++;return r.fulfill({contentType:'image/svg+xml',body:svg});});await page.evaluate(url=>addTile(url,'detached','outside'),tile);await expect.poll(()=>page.locator('#detached').evaluate(i=>i.naturalWidth)).toBe(256);await page.evaluate(()=>document.getElementById('map').append(document.getElementById('detached')));expect(hits).toBe(1);expect(await page.evaluate(()=>__sdkLoads)).toBe(1);expect(await page.evaluate(()=>__srcWrites)).toBe(0);
});
test('returning to a visible page uses the public map API once',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(100);expect(await page.evaluate(()=>__relayouts)).toBe(0);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await restored(page);
});
test('a stalled original request remains SDK-owned until its real response arrives',async({page,context})=>{
 await setup(page,context);let hits=0,held;await page.route(tile,r=>{hits++;held=r;});await page.evaluate(url=>addTile(url),tile);await expect.poll(()=>hits).toBe(1);await page.evaluate(()=>dispatchEvent(new Event('online')));await restored(page);expect(hits).toBe(1);expect(await page.evaluate(()=>__srcWrites)).toBe(0);await held.fulfill({contentType:'image/svg+xml',body:svg});await expect.poll(()=>page.locator('#tile').evaluate(i=>i.naturalWidth)).toBe(256);expect(await page.evaluate(()=>__sdkLoads)).toBe(1);
});
test('partial and whole-view network recovery displays actual native images without URL substitution',async({page,context})=>{
 await setup(page,context);const held=[];await page.route('https://tiles-v195.kakaocdn.net/**',r=>held.push(r));await page.evaluate(url=>{for(let i=0;i<24;i++)addTile(url+'?sdk='+i,'view-'+i);},tile);await expect.poll(()=>held.length).toBe(24);await page.evaluate(()=>dispatchEvent(new Event('online')));await restored(page);
 await Promise.all(held.splice(0,12).map(r=>r.fulfill({contentType:'image/svg+xml',body:svg})));await expect.poll(()=>page.locator('#map img').evaluateAll(a=>a.filter(i=>i.naturalWidth===256).length)).toBe(12);
 await Promise.all(held.map(r=>r.fulfill({contentType:'image/svg+xml',body:svg})));await expect.poll(()=>page.locator('#map img').evaluateAll(a=>a.filter(i=>i.naturalWidth===256).length)).toBe(24);expect(await page.evaluate(()=>({loads:__sdkLoads,writes:__srcWrites}))).toEqual({loads:24,writes:0});
});
test('changed CDN hosts and SDK parameters are neither interpreted nor rewritten by the app',async({page,context})=>{
 await setup(page,context);let hits=0;const future='https://future-v195.kakaocdn.net/changed-resource?token=native';await page.route(future,r=>{hits++;return r.fulfill({contentType:'image/svg+xml',body:svg});});await page.evaluate(url=>addTile(url),future);await expect.poll(()=>page.locator('#tile').evaluate(i=>i.naturalWidth)).toBe(256);await page.evaluate(()=>dispatchEvent(new Event('online')));await restored(page);expect(await page.locator('#tile').getAttribute('src')).toBe(future);expect(hits).toBe(1);expect(await page.evaluate(()=>__srcWrites)).toBe(0);
});
test('ordinary slow resources preserve a single native request and load handler',async({page,context})=>{
 await setup(page,context);let held,hits=0;await page.route(tile,r=>{held=r;hits++;});await page.evaluate(url=>addTile(url),tile);await expect.poll(()=>hits).toBe(1);await page.evaluate(()=>{fireMap('idle');fireMap('idle');});await page.waitForTimeout(150);expect(hits).toBe(1);await held.fulfill({contentType:'image/svg+xml',body:svg});await expect.poll(()=>page.locator('#tile').evaluate(i=>i.naturalWidth)).toBe(256);expect(await page.evaluate(()=>({loads:__sdkLoads,writes:__srcWrites,layouts:__relayouts}))).toEqual({loads:1,writes:0,layouts:0});
});
test('public layout restoration preserves current center, zoom and application data',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{window.__shiftCenter=true;window.listingDraft={id:'exact-master',memo:'keep'};window.selectedGroup='keep-selected';dispatchEvent(new Event('online'));});await restored(page);expect(await page.evaluate(()=>({center:map.getCenter().n,level:map.getLevel(),sets:__centerSets,draft:listingDraft,selection:selectedGroup}))).toEqual({center:1,level:3,sets:1,draft:{id:'exact-master',memo:'keep'},selection:'keep-selected'});
});
test('destroyed or replaced adapters cannot schedule work or duplicate listeners',async({page,context})=>{
 await setup(page,context);await page.evaluate(()=>{dispatchEvent(new Event('online'));controller.destroy();});await page.waitForTimeout(100);expect(await page.evaluate(()=>__relayouts)).toBe(0);await page.evaluate(()=>{controller=JSMapTileRecoveryV105.attach(document.getElementById('map'),map);dispatchEvent(new Event('online'));});await restored(page);expect(await page.evaluate(()=>__mapEvents.idle.length)).toBe(1);
});

test('v195 CSP permits the official wildcard subdomain and blocks a lookalike suffix',async({page,context})=>{
 const headers=await readFile('_headers','utf8'),csp=headers.match(/Content-Security-Policy: ([^\r\n]+)/)[1];let valid=0,invalid=0;
 await page.route('https://future-v195.kakaocdn.net/script.js',r=>{valid++;return r.fulfill({contentType:'text/javascript',body:'document.documentElement.dataset.futureCdn="loaded";'});});
 await page.route('https://future-v195.kakaocdn.net.evil.invalid/script.js',r=>{invalid++;return r.fulfill({contentType:'text/javascript',body:'document.documentElement.dataset.badCdn="loaded";'});});
 await page.route('**/__fixture/csp-v195',r=>r.fulfill({headers:{'Content-Security-Policy':csp},contentType:'text/html',body:'<!doctype html><script src="https://future-v195.kakaocdn.net/script.js"></script><script src="https://future-v195.kakaocdn.net.evil.invalid/script.js"></script>'}));
 await page.goto('/__fixture/csp-v195');await expect(page.locator('html')).toHaveAttribute('data-future-cdn','loaded');expect(valid).toBe(1);expect(invalid).toBe(0);await expect(page.locator('html')).not.toHaveAttribute('data-bad-cdn','loaded');
});
