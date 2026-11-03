import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const headers=await readFile('_headers','utf8'),policy=headers.match(/Content-Security-Policy: ([^\r\n]+)/)[1];
const origin='https://js-map.com/__naver-roadview-csp-v107';

for(const blocked of [true,false])test('NAVER panorama JSONP '+(blocked?'is reproduced as blocked by the previous policy':'and photo complete under production policy'),async({page,context})=>{
 const requests=[];
 await page.addInitScript(()=>{window.__violations=[];document.addEventListener('securitypolicyviolation',e=>__violations.push({uri:e.blockedURI,directive:e.effectiveDirective}));});
 await context.route('**/*',r=>{
   const u=new URL(r.request().url());
   if(u.href===origin)return r.fulfill({contentType:'text/html; charset=utf-8',headers:{'Content-Security-Policy':blocked?policy.replace(' https://panorama.map.naver.com',''):policy},body:'<!doctype html><meta charset="utf-8"><title>격리 CSP 검사</title><div id="status">조회 중</div>'});
   if(u.hostname!=='panorama.map.naver.com')return r.abort();
   requests.push(u.pathname);
   if(u.pathname.includes('/nearby/'))return r.fulfill({contentType:'text/javascript',body:'__nearby({panoId:"fixture-pano"});'});
   if(u.pathname.includes('/metadata/'))return r.fulfill({contentType:'text/javascript',body:'__metadata({image:"https://panorama.map.naver.com/image/fixture-pano/512/P"});'});
   return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="yellow"/></svg>'});
 });
 await page.goto(origin);
 await page.evaluate(()=>{
   function jsonp(url){const script=document.createElement('script');script.src=url;document.head.append(script);}
   window.__nearby=()=>jsonp('https://panorama.map.naver.com/ncp/metadata/fixture-pano?callback=__metadata');
   window.__metadata=data=>{const image=new Image();image.onload=()=>document.getElementById('status').textContent='사진 표시 완료';image.src=data.image;document.body.append(image);};
   jsonp('https://panorama.map.naver.com/ncp/api/v2/nearby/127.3783/36.3415/3?callback=__nearby');
 });
 if(blocked){
   await expect.poll(()=>page.evaluate(()=>__violations.length)).toBeGreaterThan(0);
   expect(requests).toHaveLength(0);await expect(page.locator('#status')).toHaveText('조회 중');
   expect(await page.evaluate(()=>__violations.some(v=>v.uri.startsWith('https://panorama.map.naver.com/')&&v.directive==='script-src-elem'))).toBe(true);
 }else{
   await expect(page.locator('#status')).toHaveText('사진 표시 완료');expect(requests).toHaveLength(3);
   expect(await page.evaluate(()=>__violations)).toEqual([]);await expect(page.locator('img')).toBeVisible();
 }
 // Keep the rest of the restrictive policy, without enabling arbitrary scripts.
 const scriptSources=policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1].split(/\s+/);
 expect(scriptSources).toContain('https://panorama.map.naver.com');expect(scriptSources).not.toContain('https:');expect(scriptSources.some(s=>s.includes('*'))).toBe(false);
});

test('real NAVER SDK displays photos after repeated close/reopen and target changes without CSP blocks',async({page,context},testInfo)=>{
 test.skip(process.env.JS_NAVER_REAL_SDK!=='1','Opt in to live public SDK/photo reads with JS_NAVER_REAL_SDK=1.');
 test.setTimeout(60000);
 const [index,source]=await Promise.all([readFile('index.html','utf8'),readFile('js/script.js','utf8')]);
 const start=index.indexOf('<div id="roadviewModal"'),modal=index.slice(start,index.indexOf('</template>',start));
 const styles=Array.from(index.matchAll(/<link[^>]*href="(css\/[^"?]+\.css)[^"]*"/g),m=>m[1]);
 const runtime=source.slice(source.indexOf('var roadviewInstance = null;'),source.indexOf('function normalizeAngle('));
 const ast=ts.createSourceFile('script.js',source,ts.ScriptTarget.Latest,true);
 const close=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='closeRoadviewModal').getText(ast);
 const configResponse=await fetch('https://js-map.com/api/naver-maps-config');expect(configResponse.ok).toBe(true);const config=await configResponse.json();
 const errors=[],forbidden=[],network=[],timings=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__violations=[];document.addEventListener('securitypolicyviolation',e=>__violations.push({uri:e.blockedURI,directive:e.effectiveDirective}));});
 const sdkHosts=new Set(['oapi.map.naver.com','panorama.map.naver.com','apis.naver.com','map.pstatic.net','nrbe.pstatic.net','ssl.pstatic.net']);
 await context.route('**/*',async r=>{
   const u=new URL(r.request().url());
   // Block the SDK's optional error telemetry as well as all application writes.
   if(u.hostname==='kr-col-ext.nelo.navercorp.com'&&u.pathname==='/_store')return r.abort();
   if(r.request().method()!=='GET'){forbidden.push('write');return r.abort();}
   if(sdkHosts.has(u.hostname)||/\.(?:pstatic\.net|map\.naver\.com)$/.test(u.hostname)){network.push(u.hostname+u.pathname);return r.continue();}
   if(u.hostname==='cdn.jsdelivr.net')return r.fulfill({contentType:'text/css',body:''});
   if(u.href===origin)return r.fulfill({contentType:'text/html; charset=utf-8',headers:{'Content-Security-Policy':policy},body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles.map(p=>'<link rel="stylesheet" href="/'+p+'">').join('')+'</head><body>'+modal+'<script>currentRoadviewMode="naver";function escapeHtml(s){return String(s).replaceAll("<","&lt;")}</script></body></html>'});
   if(u.hostname==='js-map.com'&&u.pathname==='/api/naver-maps-config')return r.fulfill({json:config});
   if(u.hostname==='js-map.com'&&/^\/css\/[\w.-]+\.css$/.test(u.pathname))return r.fulfill({contentType:'text/css',body:await readFile(u.pathname.slice(1),'utf8')});
   forbidden.push(u.hostname+u.pathname);return r.abort();
 });
 await page.goto(origin);const began=Date.now();await page.addScriptTag({content:runtime+'\n'+close});await page.evaluate(()=>loadNaverMapsSdkV653());const sdkMs=Date.now()-began;
 for(let i=0;i<3;i++){
   const started=Date.now();
   await page.evaluate(i=>{
     if(i===1)closeRoadviewModal();
     document.getElementById('roadviewModal').classList.add('open');document.body.classList.add('roadview-modal-open');
     currentRoadviewMode='naver';currentRoadviewCoords={lat:36.3415+i*0.00012,lng:127.3783};roadviewOpenSequenceV653++;naverRoadviewLoadingV653=false;
     startNaverRoadviewV653(roadviewOpenSequenceV653);
   },i);
   await expect.poll(()=>page.evaluate(()=>naverRoadviewRequestReadyV658),{timeout:15000}).toBe(true);const connectionMs=Date.now()-started;
   await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('#naverRoadviewContainer img')].filter(img=>img.src.includes('/image/'+naverRoadviewInstanceV653.getPanoId()+'/')&&img.naturalWidth>0).length),{timeout:10000}).toBeGreaterThan(0);
   const box=await page.locator('#naverRoadviewContainer').boundingBox();expect(box.height).toBeGreaterThan(100);expect(box.width).toBeGreaterThan(100);
   timings.push({scenario:i===0?'first':i===1?'reopen':'new-target',connectionMs,photoMs:Date.now()-started});
 }
 expect(errors).toEqual([]);expect(forbidden).toEqual([]);expect(await page.evaluate(()=>__violations)).toEqual([]);
 expect(network.some(path=>path.includes('/ncp/api/v2/nearby/'))).toBe(true);expect(network.some(path=>path.includes('/ncp/metadata/'))).toBe(true);
 await testInfo.attach('naver-roadview-timings',{body:JSON.stringify({sdkMs,timings}),contentType:'application/json'});
 await page.screenshot({path:testInfo.outputPath('naver-roadview.png')});
});
