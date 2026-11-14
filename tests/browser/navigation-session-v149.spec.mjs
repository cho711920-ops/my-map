import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {inlineStartupProjectionV228} from '../../tools/build-cloudflare-assets.mjs';
const earlySessionV228=(await readFile('index.html','utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const inlineProjectionV228=(await Promise.all(['query-collection-v152.js','query-preview-v154.js'].map(async name=>'<script data-auth-bootstrap-v228="'+name+'">'+await readFile('js/'+name,'utf8')+'</script>'))).join('');
const authModuleV228=await readFile('js/auth-gate-v1.js','utf8');

for(const embedded of [false,true])test('v229 a delayed auth stylesheet cannot gate the built live-approved screen: embedded='+embedded,async({page,context})=>{
  let checks=0,cssReads=0,privateReads=0,releaseCss;const cssGate=new Promise(resolve=>{releaseCss=resolve;});
  const css=await readFile('css/auth-gate-v1.css','utf8');
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.route('**/api/session',route=>{checks++;return route.fulfill({json:{ok:true,email:'fixture@example.invalid'}});});
  await page.route('**/api/data**',route=>{privateReads++;return route.abort();});
  await page.route('**/css/auth-gate-v1.css?blocking-v229',async route=>{cssReads++;await cssGate;return route.fulfill({contentType:'text/css',body:css});});
  let html=`<!doctype html><html class="auth-pending"><head><script>${earlySessionV228}</script><link rel="stylesheet" href="/css/auth-gate-v1.css?blocking-v229"><script type="module" src="/js/auth-gate-v1.js"></script></head><body><template id="jsAuthenticatedHeadAssets"></template><template id="jsAuthenticatedApplication"><main id="wrap" inert>검사 매물 화면</main></template><template id="jsAuthenticatedBodyAssets"></template></body></html>`;
  html=inlineStartupProjectionV228(html,new Map([['js/auth-gate-v1.js',authModuleV228],...(embedded?[['css/auth-gate-v1.css',css]]:[])]));
  await page.route('**/',route=>route.fulfill({contentType:'text/html',body:html}));
  const navigation=page.goto('/');
  try{
    await expect.poll(()=>checks).toBe(1);
    if(embedded){await expect(page.locator('#wrap')).toBeVisible({timeout:700});expect(cssReads).toBe(0);}
    else{await expect.poll(()=>cssReads).toBe(1);await expect(page.locator('#wrap')).toHaveCount(0);releaseCss();}
    await navigation;await expect(page.locator('html')).not.toHaveClass(/auth-pending/);expect(checks).toBe(1);expect(privateReads).toBe(0);
    await expect(page.locator('html')).toHaveAttribute('data-startup-session-headers-ms',/\d+/);
    await expect(page.locator('html')).toHaveAttribute('data-startup-auth-code-ms',/\d+/);
  }finally{releaseCss();await navigation.catch(()=>{});}
});

for(const status of [200,403])test('v228 parser starts a live session before the auth module and consumes it once without exposing account data: '+status,async({page,context})=>{
  let checks=0,releaseModule,releaseSession;const moduleGate=new Promise(resolve=>{releaseModule=resolve;}),sessionGate=new Promise(resolve=>{releaseSession=resolve;});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.route('**/api/session',async route=>{checks++;await sessionGate;await route.fulfill({status,json:status===200?{email:'fixture@example.invalid'}:{ok:false}});});
  await page.route('**/api/auth-config',route=>route.fulfill({json:{localLoginEnabled:true}}));
  await page.route('**/js/auth-gate-v1.js',async route=>{await moduleGate;await route.continue();});
  await page.route('**/',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html class="auth-pending"><head><script>${earlySessionV228}</script><script type="module" src="/js/auth-gate-v1.js"></script></head><body><template id="jsAuthenticatedHeadAssets"></template><template id="jsAuthenticatedApplication"><main id="wrap" inert>Account application</main></template><template id="jsAuthenticatedBodyAssets"></template></body></html>`}));
  const navigation=page.goto('/',{waitUntil:'domcontentloaded'});
  try{
    await expect.poll(()=>checks).toBe(1);await expect(page.locator('#wrap')).toHaveCount(0);await expect(page.locator('#jsLocalLoginForm')).toHaveCount(0);
    releaseSession();await expect(page.locator('#wrap')).toHaveCount(0);releaseModule();await navigation;
    if(status===200)await expect(page.locator('html')).not.toHaveClass(/auth-pending/);else await expect(page.locator('#jsLocalLoginForm')).toBeVisible();
    expect(checks).toBe(1);expect(await page.evaluate(()=>window.JSEarlySessionV228)).toBeUndefined();
    await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-required')));await expect.poll(()=>checks).toBe(2);
  }finally{releaseSession();releaseModule();await navigation.catch(()=>{});}
});

async function setup(page,context,value,{hold=false,deny=false,preview=false,sessionHold=false,publicPrime=false,inlineHead=false,inlineAuth=false,sessionStatus=deny?401:200}={}) {
  let checks=0,release,releaseSession,currentStatus=sessionStatus;
  const gate=new Promise(resolve=>{release=resolve;});
  const sessionGate=new Promise(resolve=>{releaseSession=resolve;});
  await page.addInitScript(()=>{
    window.loginFormsCreatedV168=0;
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType===1&&(node.matches('#jsLocalLoginForm')||node.querySelector('#jsLocalLoginForm')))window.loginFormsCreatedV168++;
    }))).observe(document,{childList:true,subtree:true});
  });
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await context.route('**/api/session',async r=>{checks++;if(sessionHold)await sessionGate;return r.fulfill({status:currentStatus,json:currentStatus===200?{ok:true,email:'fixture@example.invalid'}:{ok:false}});});
  await context.route('**/api/auth-config',r=>r.fulfill({json:{localLoginEnabled:true}}));
  await context.route('**/fixture-hold-v149.js',async r=>{await gate;return r.fulfill({contentType:'text/javascript',body:'document.documentElement.setAttribute("data-hold-loaded","true");'});});
  if(preview)await context.route('**/js/query-startup-v152.js',r=>r.fulfill({contentType:'text/javascript',body:
    'window.JSQueryListingsV152={paintCachedPreview(current){if(current())document.documentElement.setAttribute("data-preview-before-sdk","true");return Promise.resolve(true);}};'}));
  await context.route('**/',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html class="auth-pending"><head>
    <script type="application/json" id="jsNavigationSessionV149">${typeof value==='string'?value:JSON.stringify(value)}</script>
    <link rel="stylesheet" href="/css/auth-gate-v1.css">${inlineAuth?'<script type="module" data-auth-gate-v228>'+authModuleV228+'</script>':'<script type="module" src="/js/auth-gate-v1.js"></script>'}</head><body>
    <template id="jsAuthenticatedHeadAssets">${inlineHead?inlineProjectionV228:'<script src="/js/query-preview-v154.js"></script>'}${publicPrime?'<script src="/js/query-collection-v152.js?build=1111111111111111"></script><script src="/js/query-collection-v152.js?build=invalid"></script><script src="/api/query-collection-v152.js?build=1111111111111111"></script><script src="/js/script.js?build=2222222222222222"></script><script src="/js/map.js?build=2222222222222222"></script><script src="/js/unified-listings-v8.js?build=2222222222222222"></script>':''}${preview?'<script src="/js/query-startup-v152.js"></script>':''}${hold?'<script src="/fixture-hold-v149.js"></script>':''}</template>
    <template id="jsAuthenticatedApplication"><main id="wrap">Account-bound application</main></template>
    <template id="jsAuthenticatedBodyAssets"></template></body></html>`}));
  await page.goto('/',{waitUntil:'domcontentloaded'});return{checks:()=>checks,release,releaseSession,setStatus:status=>{currentStatus=status;}};
}

test('a delayed session and critical asset load never create login inputs during authenticated refresh',async({page,context})=>{
  const state=await setup(page,context,null,{sessionHold:true,hold:true});
  try{
    await expect.poll(state.checks).toBe(1);
    await expect(page.locator('#jsLocalLoginForm')).toHaveCount(0);
    await expect(page.locator('#jsAuthGate')).toHaveAttribute('data-auth-mode-v168','checking');
    await expect(page.locator('#wrap')).toHaveCount(0);
    state.releaseSession();await expect(page.locator('#wrap')).toHaveAttribute('inert');
    await expect(page.locator('#jsLocalLoginForm')).toHaveCount(0);
    state.release();await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
    expect(await page.evaluate(()=>window.loginFormsCreatedV168)).toBe(0);
    await page.reload();await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
    expect(await page.evaluate(()=>window.loginFormsCreatedV168)).toBe(0);
  }finally{state.releaseSession();state.release();}
});

test('v228 embedded proof-validating projection code executes only after live approval and adds no script or null-URL fetch',async({page,context})=>{
  const unexpected=[];page.on('request',request=>{if(/\/null(?:\?|$)|\/js\/(?:auth-gate-v1|query-collection-v152|query-preview-v154)\.js/.test(request.url()))unexpected.push(request.url());});
  const state=await setup(page,context,null,{sessionHold:true,hold:true,inlineHead:true,inlineAuth:true});
  try{
    expect(await page.evaluate(()=>window.JSQueryCollectionV152)).toBeUndefined();await expect(page.locator('#wrap')).toHaveCount(0);
    state.releaseSession();await expect.poll(()=>page.evaluate(()=>typeof window.JSQueryCollectionV152?.decode)).toBe('function');
    expect(await page.evaluate(()=>typeof window.JSQueryPreviewV154?.restoreInitial)).toBe('function');
    await expect(page.locator('#wrap')).toHaveAttribute('inert');expect(unexpected).toEqual([]);
    state.release();await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  }finally{state.releaseSession();state.release();}
});

test('v226 public fingerprinted downloads overlap session verification without executing code or loading private paths',async({page,context})=>{
 const reads=[];await page.route('**/js/query-collection-v152.js?build=1111111111111111',r=>{reads.push('public');return r.fulfill({contentType:'text/javascript',body:'window.primeExecutedV226=true;'});});
 await page.route('**/js/query-collection-v152.js?build=invalid',r=>{reads.push('invalid');return r.fulfill({contentType:'text/javascript',body:''});});
 await page.route('**/api/query-collection-v152.js?build=1111111111111111',r=>{reads.push('private');return r.fulfill({contentType:'text/javascript',body:''});});
 for(const name of ['script.js','map.js','unified-listings-v8.js'])await page.route('**/js/'+name+'?build=2222222222222222',r=>{reads.push('heavy-'+name);return r.fulfill({contentType:'text/javascript',body:'window.heavyReadyV229=true;'});});
 const state=await setup(page,context,null,{sessionHold:true,publicPrime:true});
 try{await expect.poll(()=>reads).toEqual(['public']);expect(await page.evaluate(()=>window.primeExecutedV226)).toBeUndefined();await expect(page.locator('#wrap')).toHaveCount(0);await expect(page.locator('html')).toHaveClass(/auth-pending/);
  state.releaseSession();await expect(page.locator('html')).not.toHaveClass(/auth-pending/);expect(await page.evaluate(()=>window.primeExecutedV226)).toBe(true);expect(await page.evaluate(()=>window.heavyReadyV229)).toBe(true);
 }finally{state.releaseSession();}
});

test('a temporary startup failure keeps a retryable checking status without presenting login',async({page,context})=>{
  const state=await setup(page,context,null,{sessionStatus:503});
  await expect(page.locator('#jsAuthStatus')).toContainText('인터넷 연결');
  await expect(page.locator('#jsLocalLoginForm')).toHaveCount(0);
  await expect(page.locator('#wrap')).toHaveCount(0);
  state.setStatus(200);await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  expect(state.checks()).toBe(2);expect(await page.evaluate(()=>window.loginFormsCreatedV168)).toBe(0);
});

for(const sessionStatus of [401,403])test('login inputs appear only after a confirmed session denial: '+sessionStatus,async({page,context})=>{
  const state=await setup(page,context,null,{sessionHold:true,sessionStatus});
  try{
    await expect.poll(state.checks).toBe(1);await expect(page.locator('#jsLocalLoginForm')).toHaveCount(0);
    state.releaseSession();await expect(page.locator('#jsLocalLoginForm')).toBeVisible();
    await expect(page.locator('#jsAuthGate')).toHaveAttribute('data-auth-mode-v168','login');
    await expect(page.locator('#wrap')).toHaveCount(0);
    await page.getByLabel('아이디',{exact:true}).fill('fixture-user');
    await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-required')));
    await expect.poll(state.checks).toBe(2);await expect(page.getByLabel('아이디',{exact:true})).toHaveValue('fixture-user');
  }finally{state.releaseSession();}
});

test('a fresh server-verified navigation avoids the second session round trip without changing account isolation',async({page,context})=>{
  const state=await setup(page,context,{version:149,email:'fixture@example.invalid',checkedAt:Date.now()});
  await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  await expect(page.locator('html')).toHaveAttribute('data-session-check-source-v149','navigation');
  expect(state.checks()).toBe(0);
  expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(false);
  expect(await page.locator('#jsNavigationSessionV149').count()).toBe(0);
});
test('authenticated cached paint starts before a slow map SDK or critical body script can finish',async({page,context})=>{
  const state=await setup(page,context,{version:149,email:'fixture@example.invalid',checkedAt:Date.now()},{hold:true,preview:true});
  try{
    await expect(page.locator('html')).toHaveAttribute('data-preview-before-sdk','true');
    await expect(page.locator('#jsLocalLoginForm')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-hold-loaded','true');
    expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(true);
    state.release();await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
    expect(await page.evaluate(()=>window.loginFormsCreatedV168)).toBe(0);
  }finally{state.release();}
});
for(const kind of ['stale','future','malformed','missing-account']) test('invalid navigation bootstrap falls back to the normal session check: '+kind,async({page,context})=>{
  const value=kind==='malformed'?'{invalid':{version:149,email:kind==='missing-account'?'':'fixture@example.invalid',
    checkedAt:Date.now()+(kind==='future'?60000:kind==='stale'?-60000:0)};
  const state=await setup(page,context,value);
  await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  await expect(page.locator('html')).toHaveAttribute('data-session-check-source-v149','api');
  expect(state.checks()).toBe(1);
});

test('a 401 while critical assets load cannot be undone by a late bootstrap unlock',async({page,context})=>{
  const state=await setup(page,context,{version:149,email:'fixture@example.invalid',checkedAt:Date.now()},{hold:true,deny:true});
  try {
    await expect(page.locator('#wrap')).toHaveCount(1);
    await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-required')));
    state.release();
    await expect(page.locator('html')).toHaveAttribute('data-hold-loaded','true');
    await expect(page.locator('#jsAuthGate')).toBeVisible();
    expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(true);
    await expect(page.locator('html')).toHaveClass(/auth-pending/);
  }finally{state.release();}
});

test('authentication loss after a bootstrap still performs a fresh server check',async({page,context})=>{
  const state=await setup(page,context,{version:149,email:'fixture@example.invalid',checkedAt:Date.now()},{deny:true});
  await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  await page.evaluate(()=>document.documentElement.classList.add('query-cache-preview-v154'));
  await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-required')));
  await expect(page.locator('#jsAuthGate')).toBeVisible();
  await expect.poll(state.checks).toBe(1);
  expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(true);
  await expect(page.locator('html')).not.toHaveClass(/query-cache-preview-v154/);
});
