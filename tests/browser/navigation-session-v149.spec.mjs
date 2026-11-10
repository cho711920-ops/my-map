import {test,expect} from '@playwright/test';

async function setup(page,context,value,{hold=false,deny=false,preview=false,sessionHold=false,sessionStatus=deny?401:200}={}) {
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
    <link rel="stylesheet" href="/css/auth-gate-v1.css"><script type="module" src="/js/auth-gate-v1.js"></script></head><body>
    <template id="jsAuthenticatedHeadAssets"><script src="/js/query-preview-v154.js"></script>${preview?'<script src="/js/query-startup-v152.js"></script>':''}${hold?'<script src="/fixture-hold-v149.js"></script>':''}</template>
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
