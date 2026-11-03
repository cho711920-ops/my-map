import {test,expect} from '@playwright/test';
const tile='https://mts.kakaocdn.net/api/v1/tile/PNGSD02/test/latest/1/1/1.png';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d9e7d4"/></svg>';
async function setup(page,context) {
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/__fixture/map-tiles-v105',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>#map{position:relative;width:min(500px,95vw);height:400px;overflow:hidden}img{position:absolute;width:256px;height:256px;left:0;top:0}</style><div id="map"></div><div id="outside"></div>'}));
 await page.goto('/__fixture/map-tiles-v105');await page.addScriptTag({url:'/js/map-tile-recovery-v105.js'});
 await page.evaluate(()=>{
   window.__mapEvents={};window.__sdkLoads=0;
   window.kakao={maps:{event:{addListener(map,name,fn){(__mapEvents[name]||(__mapEvents[name]=[])).push(fn);},removeListener(map,name,fn){__mapEvents[name]=__mapEvents[name].filter(f=>f!==fn);}}}};
   window.map={setCenter(){throw Error('Recovery must not recenter');},relayout(){throw Error('Recovery must not relayout');}};
   window.fireMap=name=>(__mapEvents[name]||[]).forEach(fn=>fn());
   window.controller=JSMapTileRecoveryV105.attach(document.getElementById('map'),map);
   window.addTile=(url,id='tile',parent='map')=>{const img=document.createElement('img');img.id=id;img.addEventListener('load',()=>__sdkLoads++);document.getElementById(parent).appendChild(img);img.src=url;};
 });
}
test('healthy tiles are never reloaded by normal map navigation',async({page,context})=>{
 await setup(page,context);let requests=0;
 await page.route(tile,route=>{requests++;return route.fulfill({contentType:'image/svg+xml',body:svg});});
 await page.evaluate(url=>addTile(url,'healthy'),tile);
 await expect.poll(()=>page.evaluate(()=>document.getElementById('healthy').naturalWidth)).toBe(256);
 await page.evaluate(()=>{fireMap('idle');fireMap('idle');});await page.waitForTimeout(500);expect(requests).toBe(1);
});

test('a transient failed visible tile recovers with its URL and native handlers intact',async({page,context})=>{
 await setup(page,context);let requests=0;const urls=[];
 await page.route(tile,route=>{requests++;urls.push(route.request().url());return requests===1?route.abort('failed'):route.fulfill({contentType:'image/svg+xml',body:svg});});
 await page.evaluate(url=>addTile(url),tile);
 await expect.poll(()=>page.evaluate(()=>document.getElementById('tile').naturalWidth)).toBe(256);
 expect(requests).toBe(2);expect(new Set(urls).size).toBe(1);
 expect(await page.evaluate(()=>__sdkLoads)).toBe(1);
 expect(await page.evaluate(()=>JSMapTileRecoveryV105.stats())).toMatchObject({errors:1,retries:1,recovered:1,pending:0});
});

test('persistent tile failures stop after two retries without an idle or timer loop',async({page,context})=>{
 await setup(page,context);let requests=0;
 await page.route(tile,route=>{requests++;return route.abort('failed');});
 await page.evaluate(url=>addTile(url),tile);
 await expect.poll(()=>requests).toBe(3);
 await page.evaluate(()=>{for(let i=0;i<8;i++)fireMap('idle');});await page.waitForTimeout(600);expect(requests).toBe(3);
 expect(await page.evaluate(()=>JSMapTileRecoveryV105.stats())).toMatchObject({retries:2,pending:0});
});

test('dragging and page suspension defer retries until idle or pageshow',async({page,context})=>{
 await setup(page,context);let requests=0;
 await page.route(tile,route=>{requests++;return requests===1?route.abort('failed'):route.fulfill({contentType:'image/svg+xml',body:svg});});
 await page.evaluate(url=>{fireMap('dragstart');addTile(url);},tile);
 await expect.poll(()=>page.evaluate(()=>JSMapTileRecoveryV105.stats().errors)).toBe(1);
 await page.waitForTimeout(450);expect(requests).toBe(1);
 await page.evaluate(()=>{dispatchEvent(new Event('pagehide'));fireMap('idle');});await page.waitForTimeout(150);expect(requests).toBe(1);
 await page.evaluate(()=>dispatchEvent(new Event('pageshow')));
 await expect.poll(()=>page.evaluate(()=>document.getElementById('tile').naturalWidth)).toBe(256);expect(requests).toBe(2);
});

test('hidden maps wait until visible, and reused tile nodes cannot retry an obsolete URL',async({page,context})=>{
 await setup(page,context);const hits=new Map();
 await page.route(/https:\/\/mts\.kakaocdn\.net\/api\/v1\/tile\//,route=>{const url=route.request().url(),count=(hits.get(url)||0)+1;hits.set(url,count);return count===1?route.abort('failed'):route.fulfill({contentType:'image/svg+xml',body:svg});});
 await page.evaluate(url=>{document.getElementById('map').style.display='none';addTile(url);},tile);
 await expect.poll(()=>page.evaluate(()=>JSMapTileRecoveryV105.stats().errors)).toBe(1);await page.waitForTimeout(450);expect(hits.get(tile)).toBe(1);
 await page.evaluate(()=>{document.getElementById('map').style.display='block';fireMap('idle');});
 await expect.poll(()=>page.evaluate(()=>document.getElementById('tile').naturalWidth)).toBe(256);
 const old=tile.replace('/1.png','/2.png'),newer=tile.replace('/1.png','/3.png');
 await page.evaluate(url=>{document.getElementById('tile').src=url;},old);
 await expect.poll(()=>page.evaluate(()=>JSMapTileRecoveryV105.stats().errors)).toBe(2);
 await page.evaluate(url=>{document.getElementById('tile').src=url;},newer);
 await expect.poll(()=>page.evaluate(()=>document.getElementById('tile').naturalWidth)).toBe(256);
 expect(hits.get(old)).toBe(1);expect(hits.get(newer)).toBe(2);
});

test('listing photos, images outside the map and destroyed controllers receive no retries',async({page,context})=>{
 await setup(page,context);let photos=0,tiles=0;
 await page.route('https://landthumb-phinf.pstatic.net/listing.jpg',route=>{photos++;return route.abort('failed');});
 await page.route(tile,route=>{tiles++;return route.abort('failed');});
 await page.evaluate(url=>{addTile('https://landthumb-phinf.pstatic.net/listing.jpg','photo');addTile(url,'outside-tile','outside');},tile);
 await expect.poll(()=>photos+tiles).toBe(2);await page.waitForTimeout(450);expect(photos+tiles).toBe(2);
 expect(await page.evaluate(()=>JSMapTileRecoveryV105.stats().errors)).toBe(0);
 await page.evaluate(url=>{addTile(url+'?destroy=1','to-destroy');controller.destroy();},tile);
 await page.waitForTimeout(550);expect(await page.evaluate(()=>JSMapTileRecoveryV105.stats().retries)).toBe(0);
});

test('zero-size failed images and connected SDK buffer tiles recover before another navigation',async({page,context})=>{
 await setup(page,context);const counts=new Map();
 await page.route(/https:\/\/mts\.kakaocdn\.net\/api\/v1\/tile\//,route=>{const url=route.request().url(),count=(counts.get(url)||0)+1;counts.set(url,count);return count===1?route.abort('failed'):route.fulfill({contentType:'image/svg+xml',body:svg});});
 await page.evaluate(url=>{
   addTile(url,'zero');const img=document.getElementById('zero');img.style.width='auto';img.style.height='auto';
   addTile(url.replace('/1.png','/buffer.png'),'buffer');document.getElementById('buffer').style.left='900px';
 },tile);
 await expect.poll(()=>page.evaluate(()=>JSMapTileRecoveryV105.stats().recovered)).toBe(2);
 expect(await page.evaluate(()=>document.getElementById('zero').naturalWidth)).toBe(256);
 expect([...counts.values()]).toEqual([2,2]);
});

test('a widespread failure has a fixed per-minute retry budget',async({page,context})=>{
 await setup(page,context);let requests=0;
 await page.route(/https:\/\/mts\.kakaocdn\.net\/api\/v1\/tile\//,route=>{requests++;return route.abort('failed');});
 await page.evaluate(url=>{for(let i=0;i<35;i++)addTile(url.replace('/1.png','/'+i+'.png'),'tile-'+i);},tile);
 await expect.poll(()=>page.evaluate(()=>JSMapTileRecoveryV105.stats().retries)).toBe(32);
 await page.waitForTimeout(1600);expect(await page.evaluate(()=>JSMapTileRecoveryV105.stats().retries)).toBe(32);expect(requests).toBe(67);
});
