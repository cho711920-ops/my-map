import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const baseline=process.env.JS_PHOTO_DECODE_BASELINE==='1';
const svg=(n,large)=>'<svg xmlns="http://www.w3.org/2000/svg" width="'+(large?3000:640)+'" height="'+(large?2000:480)+'"><rect width="100%" height="100%" fill="'+(n%2?'orange':'blue')+'"/></svg>';
async function setup(page,context,{large=false,gateDecode=false,noOpen=false,saveData=false,alternate=false}={}){
 const calls=new Map(),held=[];let detailCalls=0;let released=false;const urls=Array.from({length:8},(_,i)=>'/decoded-photo-v120-'+i+'.svg');
 await page.addInitScript(({gateDecode,saveData})=>{if(saveData)Object.defineProperty(navigator,'connection',{configurable:true,value:{saveData:true}});const NativeImage=window.Image;window.__preparedV120=[];window.__releaseDecodeV120=()=>{window.__decodeReleasedV120=true;window.__decodeWaitersV120.splice(0).forEach(r=>r());};window.__decodeWaitersV120=[];window.Image=function(...args){const image=new NativeImage(...args),decode=image.decode.bind(image);image.decode=()=>decode().then(async()=>{if(gateDecode&&image.src.includes('-1.svg')&&!window.__decodeReleasedV120)await new Promise(r=>__decodeWaitersV120.push(r));image.__decodedV120=true;});window.__preparedV120.push(image);return image;};window.Image.prototype=NativeImage.prototype;},{gateDecode,saveData});
 await context.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(u.pathname.startsWith('/decoded-photo-v120-')){calls.set(u.pathname,(calls.get(u.pathname)||0)+1);await new Promise(r=>setTimeout(r,100));return r.fulfill({contentType:'image/svg+xml',body:svg(Number(u.pathname.match(/-(\d).svg/)[1]),large&&u.pathname.includes('-1.svg')),headers:{'cache-control':'no-store'}});}
 if(baseline&&u.pathname==='/js/unified-listings-v8.js')return r.fulfill({contentType:'text/javascript',body:execFileSync('git',['show','70f4bac:js/unified-listings-v8.js'],{encoding:'utf8'})});
 if(u.searchParams.get('action')==='unifiedListings'){const response=await r.fetch(),data=await response.json();for(const o of data.groups['FIXTURE-LEASE-1'])Object.assign(o,{source:'네이버',originalId:'DECODED-A',images:urls,thumbnail:urls[0],photoCount:urls.length});if(alternate)data.groups['FIXTURE-LEASE-1'].push({...data.groups['FIXTURE-LEASE-1'][0],originalId:'DECODED-B',images:urls.slice().reverse(),thumbnail:urls.at(-1)});return r.fulfill({response,json:data});}if(u.searchParams.get('action')==='unifiedListingDetail'){detailCalls++;if(!released)await new Promise(r=>held.push(r));return r.fulfill({status:503,json:{ok:false}});}return r.continue();});
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await expect.poll(()=>page.evaluate(()=>JSUnifiedListingsV8.allOriginals('FIXTURE-LEASE-1')[0]?.images?.length)).toBe(8);await page.evaluate(noOpen=>{document.getElementById('fixtureControls')?.remove();if(!noOpen)void JSUnifiedListingsV8.open('FIXTURE-LEASE-1');},noOpen);
 if(!noOpen)await expect.poll(()=>page.locator('.unified-detail-hero-v8 img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
 return {calls,urls,get detailCalls(){return detailCalls;},release(){released=true;held.splice(0).forEach(r=>r());}};
}
test.afterEach(async({context})=>{await context.unrouteAll({behavior:'ignoreErrors'});});
for(const enlarged of [false,true])test('prepared second image is displayed without a new load or animation wait '+(enlarged?'enlarged':'detail'),async({page,context},info)=>{
 const s=await setup(page,context);try{
 if(enlarged)await page.evaluate(()=>JSUnifiedListingsV8.openGallery('FIXTURE-LEASE-1','DECODED-A',0));
 await expect.poll(()=>page.evaluate(()=>__preparedV120.some(i=>i.src.endsWith('-1.svg')&&i.complete&&i.naturalWidth>0))).toBe(true);
 await page.evaluate(()=>new Promise(r=>setTimeout(r,50)));
 const before=s.calls.get('/decoded-photo-v120-1.svg')||0;
 const result=await page.evaluate(enlarged=>{const container=document.querySelector(enlarged?'#unifiedGalleryV8':'.unified-detail-gallery-v8'),prepared=__preparedV120.find(i=>i.src.endsWith('-1.svg')&&i.complete);const start=performance.now();container.querySelector(enlarged?'.next':'.unified-detail-photo-nav-v8.next').click();const image=container.querySelector('img');return {samePreparedNode:image===prepared,decoded:!!image.__decodedV120,complete:image.complete&&image.naturalWidth>0,source:image.src.endsWith('-1.svg'),loading:!container.querySelector('.photo-load-status-v114')?.hidden,ghosts:container.querySelectorAll('.photo-transition-ghost-v1').length,ms:performance.now()-start};},enlarged);
 console.log('DECODED_PHOTO',JSON.stringify({project:info.project.name,enlarged,baseline,...result}));
 expect(result.samePreparedNode).toBe(true);expect(result.decoded).toBe(true);expect(result.complete).toBe(true);expect(result.source).toBe(true);expect(result.loading).toBe(false);expect(result.ghosts).toBe(0);expect(result.ms).toBeLessThan(100);
 await page.waitForTimeout(150);expect(s.calls.get('/decoded-photo-v120-1.svg')||0).toBe(before);
 }finally{s.release();}
});
test('decoded node storage is bounded and clearing the photo cache releases prepared images',async({page,context})=>{
 const s=await setup(page,context,{large:true});try{
 await expect.poll(()=>page.evaluate(()=>__preparedV120.some(i=>i.__decodedV120&&i.getAttribute('src')===null))).toBe(true);
 const result=await page.evaluate(()=>{const waiting=__preparedV120.filter(i=>!i.isConnected&&i.getAttribute('src'));return {nodes:waiting.length,pixels:waiting.reduce((n,i)=>n+i.naturalWidth*i.naturalHeight,0)};});expect(result.nodes).toBeLessThanOrEqual(4);expect(result.pixels).toBeLessThanOrEqual(4_000_000);
 await page.evaluate(()=>JSUnifiedListingsV8.clearPhotoCache());expect(await page.evaluate(()=>__preparedV120.filter(i=>!i.isConnected&&i.getAttribute('src')).length)).toBe(0);
 }finally{s.release();}
});
test('a late decode after closing cannot restore an evicted photo or replace another gallery',async({page,context})=>{
 const s=await setup(page,context,{gateDecode:true});try{
 await expect.poll(()=>page.evaluate(()=>__decodeWaitersV120.length)).toBeGreaterThan(0);await page.evaluate(()=>{JSUnifiedListingsV8.close();__releaseDecodeV120();});
 expect(await page.evaluate(()=>__preparedV120.filter(i=>!i.isConnected&&i.getAttribute('src')).length)).toBe(0);
 await page.waitForTimeout(50);expect(await page.evaluate(()=>__preparedV120.filter(i=>!i.isConnected&&i.getAttribute('src')).length)).toBe(0);
 }finally{s.release();}
});

test('card intent prepares the requested advert before opening even when metadata is already complete',async({page,context})=>{
 const s=await setup(page,context,{noOpen:true,alternate:true});try{
 await page.evaluate(()=>JSUnifiedListingsV8.prefetch('FIXTURE-LEASE-1','DECODED-B'));
 await expect.poll(()=>page.evaluate(()=>__preparedV120.some(i=>i.src.endsWith('-6.svg')&&i.__decodedV120))).toBe(true);
 expect(s.calls.get('/decoded-photo-v120-1.svg')||0).toBe(0);expect(s.detailCalls).toBe(0);
 await expect(page.locator('.unified-detail-drawer-v8.open')).toHaveCount(0);
 }finally{s.release();}
});
test('data saver does not download extra photos on card intent',async({page,context})=>{
 const s=await setup(page,context,{noOpen:true,saveData:true});try{
 await page.evaluate(()=>JSUnifiedListingsV8.prefetch('FIXTURE-LEASE-1','DECODED-A'));
 expect(await page.evaluate(()=>__preparedV120.length)).toBe(0);expect(s.calls.get('/decoded-photo-v120-1.svg')||0).toBe(0);expect(s.detailCalls).toBe(0);
 }finally{s.release();}
});
